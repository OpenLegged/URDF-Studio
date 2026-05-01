import * as THREE from 'three';
import { stackCoincidentVisualRoots } from '@/core/loaders/visualMeshStacking';
import { isImageAssetPath } from '@/core/utils/assetFileTypes';
import {
  applyVisualMaterialOverrideToObject,
  hasExplicitGeometryMaterialOverride,
  resolveVisualMaterialOverrideFromGeometry,
} from '@/core/utils/visualMaterialOverrides';
import {
  getBoxFaceMaterialPalette,
  getCollisionGeometryEntries,
  hasGeometryMeshMaterialGroups,
  getVisualGeometryEntries,
  resolveVisualMaterialOverride as resolveRobotVisualMaterialOverride,
} from '@/core/robot';
import { createBoxFaceMaterialArray } from '@/core/utils/boxFaceMaterialArray';
import { createMatteMaterial } from '@/core/utils/materialFactory';
import { applyVisualMeshMaterialGroupsToObject } from '@/core/utils/meshMaterialGroups';
import { forceObjectMaterialSide } from '@/core/utils/three/materialSide';
import { createMainThreadYieldController } from '@/core/utils/yieldToMainThread';
import {
  createTerrainBlendMaterial,
  loadTexturesForBlending,
} from '@/core/utils/heightmapBlendMaterial';
import {
  GeometryType,
  JointType,
  type RobotData,
  type UrdfJoint as RobotJoint,
  type UrdfLink as RobotLink,
} from '@/types';
import {
  URDFCollider,
  URDFJoint,
  URDFLink,
  URDFMimicJoint,
  URDFRobot,
  URDFVisual,
} from './URDFClasses';
import type { MeshLoadFunc } from './URDFLoader';
import type { VisualMaterialOverride } from '@/core/utils/visualMaterialOverrides';

const DEFAULT_COLOR = '#808080';
const DEFAULT_ORIGIN = {
  xyz: { x: 0, y: 0, z: 0 },
  rpy: { r: 0, p: 0, y: 0 },
} as const;

const tempQuaternion = new THREE.Quaternion();
const tempEuler = new THREE.Euler();

function applyRotation(
  object: THREE.Object3D,
  rpy: [number, number, number],
  additive = false,
): void {
  if (!additive) {
    object.rotation.set(0, 0, 0);
  }

  tempEuler.set(rpy[0], rpy[1], rpy[2], 'ZYX');
  tempQuaternion.setFromEuler(tempEuler);
  tempQuaternion.multiply(object.quaternion);
  object.quaternion.copy(tempQuaternion);
}

function applyOrigin(
  object: THREE.Object3D,
  origin: RobotLink['visual']['origin'] | RobotJoint['origin'] | undefined,
): void {
  const xyz = origin?.xyz ?? DEFAULT_ORIGIN.xyz;
  const rpy = origin?.rpy ?? DEFAULT_ORIGIN.rpy;

  object.position.set(xyz.x, xyz.y, xyz.z);
  object.rotation.set(0, 0, 0);
  applyRotation(object, [rpy.r, rpy.p, rpy.y]);
}

function loadedObjectShouldPreserveEmbeddedMaterials(object: THREE.Object3D): boolean {
  const materialNames = new Set<string>();
  let hasMaterialTexture = false;
  let hasMultiMaterialMesh = false;

  object.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) {
      return;
    }

    const material = (child as THREE.Mesh).material;
    const materials = Array.isArray(material) ? material : [material];
    if (materials.length > 1) {
      hasMultiMaterialMesh = true;
    }

    materials.forEach((entry) => {
      const materialName = entry?.name?.trim();
      if (materialName) {
        materialNames.add(materialName);
      }

      if ('map' in (entry || {}) && (entry as THREE.MeshPhongMaterial).map) {
        hasMaterialTexture = true;
      }
    });
  });

  return hasMaterialTexture || hasMultiMaterialMesh || materialNames.size > 1;
}

function shouldAttachLoadedMeshObject(object: THREE.Object3D, isCollisionNode: boolean): boolean {
  if (isCollisionNode && object.userData?.isPlaceholder === true) {
    return false;
  }

  return true;
}

/**
 * Extract a named submesh from a loaded Collada/DAE scene object.
 *
 * SDF models often reference a single shared DAE file from multiple links,
 * using `<submesh><name>X</name></submesh>` to select a specific named node.
 * This function finds the child matching `submeshName` and returns a new
 * group containing only that subtree.
 *
 * The mesh loader may apply a unit-conversion scale (e.g. 0.001 for inch→meter)
 * to the root scene object.  Because `clone()` only copies the child's own
 * transform — not the parent's scale — we must carry the parent scale forward
 * so that the extracted submesh renders at the correct size.
 *
 * When `center` is true the extracted geometry is re-centered so that its
 * bounding-box center sits at the local origin (the SDF convention for
 * wheels and other symmetric parts).
 */
function extractSubmesh(
  scene: THREE.Object3D,
  submeshName: string,
  center: boolean,
): THREE.Object3D | null {
  // Search direct children first, then fall back to a deeper search.
  let match: THREE.Object3D | null =
    scene.children.find((child) => child.name === submeshName) ?? null;

  if (!match) {
    scene.traverse((child) => {
      if (!match && child !== scene && child.name === submeshName) {
        match = child;
      }
    });
  }

  if (!match) {
    return null;
  }

  const extracted = match.clone(true);

  // Remove named children from the clone.  In Collada scene graphs a
  // parent node like "Body" often contains sibling submeshes as named
  // children (e.g. Steering_Wheel, Wheels_Rear_Left, …).  Gazebo's
  // <submesh> element selects only the geometry of the named node —
  // not its named children — so we strip them to avoid rendering parts
  // that belong to other links.
  const namedChildren: THREE.Object3D[] = [];
  for (const child of extracted.children) {
    if (child.name) {
      namedChildren.push(child);
    }
  }
  for (const child of namedChildren) {
    extracted.remove(child);
  }

  // The mesh loader may apply a unit-conversion scale (e.g. 0.01 for
  // cm→meter) on the root scene object, and intermediate DAE nodes may carry
  // their own <scale> transforms.  Because `clone()` only copies the node's
  // own local transform — not any ancestor's — we must accumulate the full
  // parent scale chain from the scene root down to (but excluding) the
  // matched node, and bake it into the extracted submesh so that position AND
  // geometry render at the correct size and location.
  const parentScale = new THREE.Vector3(1, 1, 1);
  {
    let current = match.parent;
    while (current) {
      parentScale.multiply(current.scale);
      if (current === scene) break;
      current = current.parent;
    }
  }
  if (parentScale.x !== 1 || parentScale.y !== 1 || parentScale.z !== 1) {
    extracted.position.set(
      extracted.position.x * parentScale.x,
      extracted.position.y * parentScale.y,
      extracted.position.z * parentScale.z,
    );
    extracted.scale.set(
      extracted.scale.x * parentScale.x,
      extracted.scale.y * parentScale.y,
      extracted.scale.z * parentScale.z,
    );
  }

  if (center) {
    const bbox = new THREE.Box3().setFromObject(extracted);
    const centerVec = new THREE.Vector3();
    bbox.getCenter(centerVec);
    extracted.position.sub(centerVec);
  }

  return extracted;
}

function restackLinkVisualRoots(linkTarget: THREE.Object3D): void {
  const visualRoots = linkTarget.children
    .filter((child: any) => child?.isURDFVisual)
    .map((child, index) => ({
      root: child,
      stableId: child.name || child.userData?.runtimeKey || index,
    }));

  if (visualRoots.length < 2) {
    return;
  }

  stackCoincidentVisualRoots(visualRoots);
}

function findVisualRestackRoot(object: THREE.Object3D): THREE.Object3D {
  let current: THREE.Object3D | null = object;
  let highest: THREE.Object3D = object;

  while (current) {
    highest = current;
    if ((current as any).isURDFRobot) {
      return current;
    }
    current = current.parent;
  }

  return highest;
}

function restackRobotVisualRoots(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);

  const visualRoots: Array<{ root: THREE.Object3D; stableId: number }> = [];
  let visualIndex = 0;
  root.traverse((child: any) => {
    if (!child?.isURDFVisual) {
      return;
    }

    visualRoots.push({
      root: child,
      stableId: (visualIndex += 1),
    });
  });

  if (visualRoots.length < 2) {
    return;
  }

  stackCoincidentVisualRoots(visualRoots, { space: 'world' });
}

function createPrimitiveMaterial(color?: string): THREE.MeshStandardMaterial {
  return createMatteMaterial({
    color: color || DEFAULT_COLOR,
    preserveExactColor: Boolean(color),
  });
}

function colorRgbaToHex(colorRgba: [number, number, number, number] | undefined): string | undefined {
  if (!Array.isArray(colorRgba) || colorRgba.length !== 4) {
    return undefined;
  }

  const channels = colorRgba.map((value) => Number(value));
  if (!channels.every((value) => Number.isFinite(value))) {
    return undefined;
  }

  const to255 = (channel: number) => (Math.abs(channel) <= 1 ? channel * 255 : channel);
  const toHex = (channel: number) =>
    Math.max(0, Math.min(255, Math.round(to255(channel))))
      .toString(16)
      .padStart(2, '0');
  const [red, green, blue, alpha] = channels;
  const rgb = `${toHex(red)}${toHex(green)}${toHex(blue)}`;
  return alpha < 0.999 ? `#${rgb}${toHex(alpha)}` : `#${rgb}`;
}

function resolveStateVisualMaterialOverride({
  geometry,
  isPrimaryVisual,
  link,
  materials,
}: {
  geometry: RobotLink['visual'];
  isPrimaryVisual: boolean;
  link: Pick<RobotLink, 'id' | 'name'>;
  materials: RobotData['materials'] | undefined;
}): { override: VisualMaterialOverride | null; isExplicit: boolean } {
  const resolved = resolveRobotVisualMaterialOverride(
    { materials },
    link,
    geometry,
    { isPrimaryVisual },
  );

  if (resolved.source === 'none' || resolved.isMultiMaterial) {
    return { override: null, isExplicit: false };
  }

  const color = resolved.color ?? colorRgbaToHex(resolved.colorRgba);
  const override: VisualMaterialOverride = {
    ...(color ? { color } : {}),
    ...(resolved.texture ? { texture: resolved.texture } : {}),
    ...(resolved.opacity !== undefined ? { opacity: resolved.opacity } : {}),
    ...(resolved.roughness !== undefined ? { roughness: resolved.roughness } : {}),
    ...(resolved.metalness !== undefined ? { metalness: resolved.metalness } : {}),
    ...(resolved.emissive ? { emissive: resolved.emissive } : {}),
    ...(resolved.emissiveIntensity !== undefined
      ? { emissiveIntensity: resolved.emissiveIntensity }
      : {}),
  };

  return {
    override: Object.keys(override).length > 0 ? override : null,
    isExplicit:
      resolved.source === 'legacy-link' ||
      hasExplicitGeometryMaterialOverride(geometry),
  };
}

function applyMeshScale(group: THREE.Object3D, geometry: RobotLink['visual']): void {
  if (geometry.type !== GeometryType.MESH) {
    return;
  }

  const scale = geometry.dimensions;
  group.scale.set(
    Number.isFinite(scale?.x) ? scale.x : 1,
    Number.isFinite(scale?.y) ? scale.y : 1,
    Number.isFinite(scale?.z) ? scale.z : 1,
  );
}

function applyVisualMaterialSidePolicy(
  object: THREE.Object3D,
  geometry: RobotLink['visual'],
  isCollision: boolean,
): void {
  if (isCollision || geometry.doubleSided !== true) {
    return;
  }

  forceObjectMaterialSide(object, THREE.DoubleSide);
}

function createImagePreviewMesh(
  geometry: RobotLink['visual'],
  manager: THREE.LoadingManager,
  isCollision: boolean,
): THREE.Mesh {
  const material = createPrimitiveMaterial(isCollision ? undefined : geometry.color);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  const width = geometry.dimensions.x || 1;
  const fallbackHeight = geometry.dimensions.y || 1;
  mesh.scale.set(width, fallbackHeight, 1);
  material.side = THREE.DoubleSide;

  new THREE.TextureLoader(manager).load(
    geometry.meshPath || '',
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      material.map = texture;
      material.transparent = true;
      material.alphaTest = 0.001;
      material.needsUpdate = true;

      const image = texture.image as { width?: number; height?: number } | undefined;
      if (!image?.width || !image?.height) {
        return;
      }

      const aspectHeight = width * (image.height / image.width);
      const height = fallbackHeight === 1 ? aspectHeight : fallbackHeight;
      mesh.scale.set(width, height, 1);
    },
    undefined,
    (error) => {
      console.error('[EditorViewer] Failed to load image asset preview texture:', error);
    },
  );

  return mesh;
}

function createHeightfieldMesh(
  geometry: RobotLink['visual'],
  isCollision: boolean,
  manager?: THREE.LoadingManager,
): THREE.Mesh | null {
  const hfield = geometry.sdfHeightmap;
  if (!hfield || !geometry.meshPath) {
    return null;
  }

  const heightmapUri = geometry.meshPath;

  const material = createPrimitiveMaterial(isCollision ? undefined : geometry.color);
  material.side = THREE.DoubleSide;

  const width = hfield.size.x || 1;
  const height = hfield.size.y || 1;
  const depth = hfield.size.z || 1;

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height, 1, 1), material);

  if (hfield.pos) {
    mesh.position.set(hfield.pos.x || 0, hfield.pos.y || 0, hfield.pos.z || 0);
  }

  new THREE.TextureLoader(manager).load(
    heightmapUri,
    (texture) => {
      const image = texture.image;
      if (!image || !image.width || !image.height) {
        console.warn('[EditorViewer] Heightmap image has no dimensions:', heightmapUri);
        texture.dispose();
        return;
      }

      const imgWidth = image.width;
      const imgHeight = image.height;

      const canvas = document.createElement('canvas');
      canvas.width = imgWidth;
      canvas.height = imgHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        console.warn('[EditorViewer] Failed to create canvas for heightmap:', heightmapUri);
        texture.dispose();
        return;
      }
      ctx.drawImage(image, 0, 0);
      const imageData = ctx.getImageData(0, 0, imgWidth, imgHeight);

      const segmentsX = Math.min(imgWidth - 1, 512);
      const segmentsY = Math.min(imgHeight - 1, 512);

      const displacedGeometry = new THREE.PlaneGeometry(width, height, segmentsX, segmentsY);
      const positions = displacedGeometry.attributes.position;

      const colStep = (imgWidth - 1) / segmentsX;
      const rowStep = (imgHeight - 1) / segmentsY;

      for (let iy = 0; iy <= segmentsY; iy++) {
        for (let ix = 0; ix <= segmentsX; ix++) {
          const vertexIndex = iy * (segmentsX + 1) + ix;
          const sampleCol = Math.min(Math.round(iy * colStep), imgWidth - 1);
          const sampleRow = Math.min(Math.round(ix * rowStep), imgHeight - 1);
          const pixelIndex = (sampleRow * imgWidth + sampleCol) * 4;
          const elevation = imageData.data[pixelIndex] / 255;
          positions.setZ(vertexIndex, elevation * depth);
        }
      }

      positions.needsUpdate = true;
      displacedGeometry.computeVertexNormals();

      mesh.geometry.dispose();
      mesh.geometry = displacedGeometry;

      if (!isCollision && hfield.textures.length > 0) {
        const diffusePaths = hfield.textures.filter((t) => t.diffuse).map((t) => t.diffuse!);

        if (diffusePaths.length > 1) {
          // Multi-texture: use elevation-based blending
          const { material: blendMat, uniforms } = createTerrainBlendMaterial(
            hfield.textures,
            hfield.blends,
            width,
            height,
          );
          loadTexturesForBlending(hfield.textures, manager).then((loadedTextures) => {
            const diffuseKeys = [
              'uTerrainDiffuse0',
              'uTerrainDiffuse1',
              'uTerrainDiffuse2',
              'uTerrainDiffuse3',
            ] as const;
            for (let i = 0; i < loadedTextures.length; i++) {
              uniforms[diffuseKeys[i]].value = loadedTextures[i];
            }
            material.dispose();
            mesh.material = blendMat;
            blendMat.needsUpdate = true;
          });
        } else if (diffusePaths.length === 1) {
          // Single-texture: existing simple behavior
          const texSize = hfield.textures[0].size;
          new THREE.TextureLoader(manager).load(diffusePaths[0], (diffuseTex) => {
            diffuseTex.colorSpace = THREE.SRGBColorSpace;
            diffuseTex.wrapS = THREE.RepeatWrapping;
            diffuseTex.wrapT = THREE.RepeatWrapping;
            if (texSize) {
              diffuseTex.repeat.set(texSize, texSize);
            }
            material.map = diffuseTex;
            material.needsUpdate = true;
          });
        }
      }

      texture.dispose();
    },
    undefined,
    (error) => {
      console.error('[EditorViewer] Failed to load heightmap image:', heightmapUri, error);
    },
  );

  return mesh;
}

function createPolylineMesh(
  geometry: RobotLink['visual'],
  isCollision: boolean,
): THREE.Mesh | null {
  const points = geometry.polylinePoints;
  const height = geometry.polylineHeight;
  if (!points || points.length < 3) {
    return null;
  }

  const material = createPrimitiveMaterial(isCollision ? undefined : geometry.color);
  material.side = THREE.DoubleSide;

  const shape = new THREE.Shape();
  shape.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    shape.lineTo(points[i].x, points[i].y);
  }
  shape.closePath();

  const extrudeDepth = Math.max(height, 1e-5);
  const extrudeSettings: THREE.ExtrudeGeometryOptions = {
    depth: extrudeDepth,
    bevelEnabled: false,
  };

  const geometryBuffer = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  geometryBuffer.translate(0, 0, -extrudeDepth / 2);

  return new THREE.Mesh(geometryBuffer, material);
}

function createPrimitiveMesh(
  geometry: RobotLink['visual'],
  isCollision: boolean,
  manager?: THREE.LoadingManager,
): THREE.Mesh | null {
  const dimensions = geometry.dimensions;
  const material = createPrimitiveMaterial(isCollision ? undefined : geometry.color);
  const boxFacePalette = !isCollision ? getBoxFaceMaterialPalette(geometry) : [];

  if (geometry.type === GeometryType.BOX) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      boxFacePalette.length > 0
        ? createBoxFaceMaterialArray(
            boxFacePalette.map((entry) => entry.material),
            {
              fallbackColor: geometry.color,
              manager,
              label: 'EditorViewer:box-face-material',
            },
          )
        : material,
    );
    mesh.scale.set(dimensions.x || 0.1, dimensions.y || 0.1, dimensions.z || 0.1);
    return mesh;
  }

  if (geometry.type === GeometryType.PLANE) {
    material.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.scale.set(dimensions.x || 1, dimensions.y || 1, 1);
    return mesh;
  }

  if (geometry.type === GeometryType.SPHERE || geometry.type === GeometryType.ELLIPSOID) {
    const radius = dimensions.x || 0.1;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 30, 30), material);
    mesh.scale.set(radius, dimensions.y || radius, dimensions.z || radius);
    return mesh;
  }

  if (geometry.type === GeometryType.CYLINDER) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 30), material);
    mesh.scale.set(dimensions.x || 0.05, dimensions.y || 0.5, dimensions.z || dimensions.x || 0.05);
    mesh.rotation.set(Math.PI / 2, 0, 0);
    return mesh;
  }

  if (geometry.type === GeometryType.CAPSULE) {
    const radius = Math.max(dimensions.x || 0.05, 1e-5);
    const totalLength = Math.max(dimensions.y || 0.5, radius * 2);
    const bodyLength = Math.max(totalLength - 2 * radius, 0);
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, bodyLength, 8, 16), material);
    mesh.rotation.set(Math.PI / 2, 0, 0);
    return mesh;
  }

  return null;
}

function resolveRuntimeJointType(type: JointType): URDFJoint['jointType'] {
  switch (type) {
    case JointType.REVOLUTE:
      return 'revolute';
    case JointType.CONTINUOUS:
      return 'continuous';
    case JointType.PRISMATIC:
      return 'prismatic';
    case JointType.PLANAR:
      return 'planar';
    case JointType.FLOATING:
      return 'floating';
    case JointType.FIXED:
      return 'fixed';
    case JointType.BALL:
      return 'floating';
    default:
      return 'fixed';
  }
}

export interface BuildRuntimeRobotFromStateOptions {
  robotName?: string;
  links: Record<string, RobotLink>;
  joints: Record<string, RobotJoint>;
  materials?: RobotData['materials'];
  manager: THREE.LoadingManager;
  loadMeshCb: MeshLoadFunc;
  parseVisual?: boolean;
  parseCollision?: boolean;
  rootLinkId?: string;
  yieldIfNeeded?: () => Promise<void>;
}

export async function buildRuntimeRobotFromState({
  robotName,
  links,
  joints,
  materials,
  manager,
  loadMeshCb,
  parseVisual = true,
  parseCollision = true,
  rootLinkId,
  yieldIfNeeded = createMainThreadYieldController(),
}: BuildRuntimeRobotFromStateOptions): Promise<URDFRobot> {
  const robot = new URDFRobot();
  const linkMap: Record<string, URDFLink> = {};
  const jointMap: Record<string, URDFJoint> = {};
  const colliderMap: Record<string, URDFCollider> = {};
  const visualMap: Record<string, URDFVisual> = {};

  robot.robotName = robotName ?? null;
  robot.name = robotName || '';
  robot.urdfName = robot.name;
  robot.userData.displayName = robotName || '';

  const addGeometryGroup = (
    linkKey: string,
    linkTarget: URDFLink,
    geometry: RobotLink['visual'],
    runtimeKey: string,
    isCollision: boolean,
    objectIndex: number,
  ) => {
    const group = isCollision ? new URDFCollider() : new URDFVisual();
    const hasBoxFacePalette = !isCollision && getBoxFaceMaterialPalette(geometry).length > 0;
    const resolvedMaterialOverride =
      !isCollision && !hasBoxFacePalette
        ? resolveStateVisualMaterialOverride({
            geometry,
            isPrimaryVisual: objectIndex === 0,
            link: links[linkKey] ?? { id: linkKey, name: linkKey },
            materials,
          })
        : { override: null, isExplicit: false };
    const visualMaterialOverride =
      resolvedMaterialOverride.override ??
      (!isCollision && !hasBoxFacePalette
        ? resolveVisualMaterialOverrideFromGeometry(geometry)
        : null);
    const hasExplicitMaterialOverride =
      resolvedMaterialOverride.isExplicit ||
      (!resolvedMaterialOverride.override && hasExplicitGeometryMaterialOverride(geometry));
    group.name = runtimeKey;
    group.urdfName = runtimeKey;
    group.userData.runtimeKey = runtimeKey;
    group.userData.parentLinkId = linkKey;
    group.userData.displayName = runtimeKey;

    applyOrigin(group, geometry.origin);
    applyMeshScale(group, geometry);

    if (geometry.type === GeometryType.MESH && geometry.meshPath) {
      if (isImageAssetPath(geometry.meshPath)) {
        group.add(createImagePreviewMesh(geometry, manager, isCollision));
      } else {
        loadMeshCb(geometry.meshPath, manager, (object, error) => {
          if (error) {
            console.error('[EditorViewer] Failed to load mesh from robot state:', error);
          } else if (!object) {
            console.error(
              '[EditorViewer] Mesh loader completed without an object for robot state geometry:',
              geometry.meshPath,
            );
          }

          if (!object || !shouldAttachLoadedMeshObject(object, isCollision)) {
            return;
          }

          // Apply SDF submesh filtering: extract only the named child node
          // from the loaded Collada scene when the geometry specifies one.
          let meshObject = object;
          if (geometry.submeshName) {
            const submesh = extractSubmesh(
              object,
              geometry.submeshName,
              geometry.submeshCenter === true,
            );
            if (submesh) {
              meshObject = submesh;
            } else {
              console.warn(
                `[EditorViewer] Submesh "${geometry.submeshName}" not found in "${geometry.meshPath}", using full mesh.`,
              );
            }
          }

          if (
            !isCollision &&
            visualMaterialOverride &&
            (hasExplicitMaterialOverride ||
              !loadedObjectShouldPreserveEmbeddedMaterials(meshObject))
          ) {
            applyVisualMaterialOverrideToObject(meshObject, visualMaterialOverride, manager);
          }

          if (!isCollision && hasGeometryMeshMaterialGroups(geometry)) {
            applyVisualMeshMaterialGroupsToObject(meshObject, geometry, { manager });
          }

          applyVisualMaterialSidePolicy(meshObject, geometry, isCollision);
          group.add(meshObject);
          if (group.parent && !isCollision) {
            restackLinkVisualRoots(group.parent);
            restackRobotVisualRoots(findVisualRestackRoot(group.parent));
          }
        });
      }
    } else if (geometry.type === GeometryType.HFIELD && geometry.sdfHeightmap) {
      const hfieldMesh = createHeightfieldMesh(geometry, isCollision, manager);
      if (hfieldMesh) {
        group.add(hfieldMesh);
      }
    } else if (geometry.type === GeometryType.POLYLINE) {
      const polylineMesh = createPolylineMesh(geometry, isCollision);
      if (polylineMesh) {
        group.add(polylineMesh);
      }
    } else {
      const primitiveMesh = createPrimitiveMesh(geometry, isCollision, manager);
      if (primitiveMesh) {
        if (!isCollision && visualMaterialOverride) {
          applyVisualMaterialOverrideToObject(primitiveMesh, visualMaterialOverride, manager);
        }
        group.add(primitiveMesh);
      }

      // Add overlay meshes for multi-pass Gazebo materials (e.g. alpha-blended
      // texture layers like field marking lines on a grass carpet).
      if (!isCollision && geometry.type === GeometryType.PLANE) {
        const authoredMaterial = geometry.authoredMaterials?.[0];
        const overlayPasses =
          authoredMaterial?.passes?.filter(
            (pass) => pass.texture && pass.sceneBlend === 'alpha_blend',
          ) ?? [];

        for (const overlayPass of overlayPasses) {
          if (!overlayPass.texture) {
            continue;
          }

          const overlayMat = createMatteMaterial({
            color: '#ffffff',
            opacity: 1,
            transparent: true,
            preserveExactColor: true,
          });
          overlayMat.side = THREE.DoubleSide;
          overlayMat.depthWrite = false;
          overlayMat.polygonOffset = true;
          overlayMat.polygonOffsetFactor = -1;
          overlayMat.polygonOffsetUnits = -4;

          const dims = geometry.dimensions;
          const overlayMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), overlayMat);
          overlayMesh.scale.set(dims.x || 1, dims.y || 1, 1);
          overlayMesh.renderOrder = 1;
          group.add(overlayMesh);

          if (manager) {
            const loader = new THREE.TextureLoader(manager);
            loader.load(
              overlayPass.texture,
              (texture) => {
                texture.colorSpace = THREE.SRGBColorSpace;
                overlayMat.map = texture;
                overlayMat.needsUpdate = true;
              },
              undefined,
              (error) => {
                console.error(
                  '[EditorViewer] Failed to load multi-pass overlay texture:',
                  overlayPass.texture,
                  error,
                );
              },
            );
          }
        }
      }
    }

    linkTarget.add(group);

    if (isCollision) {
      colliderMap[runtimeKey] = group as URDFCollider;
    } else {
      visualMap[runtimeKey] = group as URDFVisual;
    }
  };

  for (const [linkId, linkData] of Object.entries(links)) {
    const linkKey = linkData.id || linkId;
    const linkTarget = new URDFLink();
    linkTarget.name = linkKey;
    linkTarget.urdfName = linkKey;
    linkTarget.userData.displayName = linkData.name || linkKey;
    linkTarget.userData.linkId = linkKey;
    linkMap[linkKey] = linkTarget;

    if (parseVisual) {
      const visualEntries = getVisualGeometryEntries(linkData);
      visualEntries.forEach((entry) => {
        addGeometryGroup(
          linkKey,
          linkTarget,
          entry.geometry,
          `${linkKey}::visual::${entry.objectIndex}`,
          false,
          entry.objectIndex,
        );
      });

      if (visualEntries.length > 0) {
        restackLinkVisualRoots(linkTarget);
      }
    }

    if (parseCollision) {
      const collisionEntries = getCollisionGeometryEntries(linkData);
      collisionEntries.forEach((entry) => {
        addGeometryGroup(
          linkKey,
          linkTarget,
          entry.geometry,
          `${linkKey}::collision::${entry.objectIndex}`,
          true,
          entry.objectIndex,
        );
      });
    }

    await yieldIfNeeded();
  }

  for (const [jointId, jointData] of Object.entries(joints)) {
    const jointKey = jointData.id || jointId;
    const jointDisplayName = jointData.name || jointKey;
    const joint = jointData.mimic ? new URDFMimicJoint() : new URDFJoint();
    joint.name = jointDisplayName;
    joint.urdfName = jointDisplayName;
    joint.userData.displayName = jointDisplayName;
    joint.userData.jointId = jointKey;
    joint.userData.originalJointType = jointData.type;
    joint.jointType = resolveRuntimeJointType(jointData.type);

    if (jointData.axis) {
      joint.axis = new THREE.Vector3(jointData.axis.x, jointData.axis.y, jointData.axis.z);
      if (joint.axis.lengthSq() > 0) {
        joint.axis.normalize();
      }
    }

    if (jointData.limit) {
      joint.limit.lower = jointData.limit.lower;
      joint.limit.upper = jointData.limit.upper;
      joint.limit.effort = jointData.limit.effort;
      joint.limit.velocity = jointData.limit.velocity;
    }

    if (joint instanceof URDFMimicJoint && jointData.mimic) {
      joint.mimicJoint = jointData.mimic.joint;
      joint.multiplier = jointData.mimic.multiplier ?? 1;
      joint.offset = jointData.mimic.offset ?? 0;
    }

    applyOrigin(joint, jointData.origin);
    if (typeof jointData.angle === 'number' && Number.isFinite(jointData.angle)) {
      const originalIgnoreLimits = joint.ignoreLimits;
      joint.ignoreLimits = true;
      joint.setJointValue(jointData.angle);
      joint.ignoreLimits = originalIgnoreLimits;
    }
    jointMap[jointKey] = joint;
    await yieldIfNeeded();
  }

  for (const jointData of Object.values(joints)) {
    const jointKey = jointData.id || jointData.name;
    const joint = jointMap[jointKey];
    const parentLink = linkMap[jointData.parentLinkId];
    const childLink = linkMap[jointData.childLinkId];
    if (!joint || !parentLink || !childLink) {
      continue;
    }

    parentLink.add(joint);
    joint.add(childLink);
    (joint as URDFJoint & { child?: URDFLink; parentLink?: URDFLink }).child = childLink;
    (joint as URDFJoint & { child?: URDFLink; parentLink?: URDFLink }).parentLink = parentLink;
    await yieldIfNeeded();
  }

  const childLinkIds = new Set(Object.values(joints).map((joint) => joint.childLinkId));
  const rootCandidates: string[] = [];
  if (rootLinkId && linkMap[rootLinkId]) {
    rootCandidates.push(rootLinkId);
  }

  Object.keys(linkMap).forEach((linkKey) => {
    if (!childLinkIds.has(linkKey) && !rootCandidates.includes(linkKey)) {
      rootCandidates.push(linkKey);
    }
  });

  rootCandidates.forEach((linkKey) => {
    const link = linkMap[linkKey];
    if (link && link.parent !== robot) {
      robot.add(link);
    }
  });

  Object.values(jointMap).forEach((joint) => {
    if (joint instanceof URDFMimicJoint && joint.mimicJoint) {
      const mimickedJoint = jointMap[joint.mimicJoint];
      if (mimickedJoint) {
        mimickedJoint.mimicJoints.push(joint);
      }
    }
  });

  Object.values(jointMap).forEach((joint) => {
    const uniqueJoints = new Set<URDFJoint>();
    const walk = (currentJoint: URDFJoint) => {
      if (uniqueJoints.has(currentJoint)) {
        throw new Error('URDFLoader: Detected an infinite loop of mimic joints.');
      }

      uniqueJoints.add(currentJoint);
      currentJoint.mimicJoints.forEach((mimicJoint) => walk(mimicJoint));
    };

    walk(joint);
  });

  robot.links = linkMap;
  robot.joints = jointMap;
  robot.colliders = colliderMap;
  robot.visual = visualMap;
  robot.visuals = visualMap;
  robot.frames = {
    ...colliderMap,
    ...visualMap,
    ...linkMap,
    ...jointMap,
  };

  restackRobotVisualRoots(robot);
  return robot;
}
