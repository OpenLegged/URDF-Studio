import * as THREE from 'three';
import { stackCoincidentVisualRoots } from '@/core/loaders/visualMeshStacking';
import { GENERATED_OBJ_MATERIAL_USER_DATA_KEY } from '@/core/loaders/objModelData';
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
  isUnactuatedJoint,
  resolveMjcfPassiveSpringJointMetadata,
  resolveVisualMaterialOverride as resolveRobotVisualMaterialOverride,
} from '@/core/robot';
import { createBoxFaceMaterialArray } from '@/core/utils/boxFaceMaterialArray';
import { colorRgbaTupleToHex, colorRgbaTupleToOpacity } from '@/core/utils/color.ts';
import { createMatteMaterial } from '@/core/utils/materialFactory';
import { applyVisualMeshMaterialGroupsToObject } from '@/core/utils/meshMaterialGroups';
import { forceObjectMaterialSide } from '@/core/utils/three/materialSide';
import { createMainThreadYieldController } from '@/core/utils/yieldToMainThread';
import { getJointMotionAngleFromActualAngle } from '@/core/robot/kinematics';
import { normalizeJointLimitOrder } from '@/core/robot/jointLimits';
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
import { createVisualRestackBatch } from './visualRestackBatch';
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

type RuntimeBallJoint = URDFJoint & {
  jointQuaternion: THREE.Quaternion;
  setJointQuaternion: (value: RobotJoint['quaternion']) => boolean;
};

function createFiniteQuaternion(value: RobotJoint['quaternion']): THREE.Quaternion | null {
  if (!value) {
    return null;
  }

  const quaternion = new THREE.Quaternion(value.x, value.y, value.z, value.w);
  if (
    !Number.isFinite(quaternion.x) ||
    !Number.isFinite(quaternion.y) ||
    !Number.isFinite(quaternion.z) ||
    !Number.isFinite(quaternion.w) ||
    quaternion.lengthSq() <= 0
  ) {
    return null;
  }

  return quaternion.normalize();
}

function attachBallJointQuaternionState(joint: URDFJoint, jointData: RobotJoint): void {
  if (jointData.type !== JointType.BALL) {
    return;
  }

  const ballJoint = joint as RuntimeBallJoint;
  const originQuaternion = joint.quaternion.clone();
  joint.origQuaternion = originQuaternion.clone();
  joint.userData.initialQuaternion = originQuaternion.clone();
  ballJoint.jointQuaternion = new THREE.Quaternion();
  ballJoint.setJointQuaternion = function setJointQuaternion(value: RobotJoint['quaternion']) {
    const motionQuaternion = createFiniteQuaternion(value);
    if (!motionQuaternion) {
      return false;
    }

    const initialQuaternion =
      this.origQuaternion ??
      (this.userData.initialQuaternion as THREE.Quaternion | undefined) ??
      this.quaternion.clone();
    this.origQuaternion = initialQuaternion.clone();
    this.userData.initialQuaternion = initialQuaternion.clone();
    this.jointQuaternion.copy(motionQuaternion);
    this.jointValue = [
      motionQuaternion.x,
      motionQuaternion.y,
      motionQuaternion.z,
      motionQuaternion.w,
    ];
    this.quaternion.copy(initialQuaternion).multiply(motionQuaternion);
    this.updateMatrixWorld(true);
    return true;
  };

  if (jointData.quaternion) {
    ballJoint.setJointQuaternion(jointData.quaternion);
  }
}

function loadedObjectShouldPreserveEmbeddedMaterials(object: THREE.Object3D): boolean {
  const materialNames = new Set<string>();
  let hasMaterialTexture = false;
  let hasMultiMaterialMesh = false;
  let hasExternalAuthoredMaterial = false;

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

      if (entry?.userData?.[GENERATED_OBJ_MATERIAL_USER_DATA_KEY] !== true) {
        hasExternalAuthoredMaterial = true;
      }

      if ('map' in (entry || {}) && (entry as THREE.MeshPhongMaterial).map) {
        hasMaterialTexture = true;
      }
    });
  });

  return hasExternalAuthoredMaterial || hasMaterialTexture || hasMultiMaterialMesh || materialNames.size > 1;
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
    // Fall back to a fuzzy match for Collada exports where the WASM fast-mesh
    // parser flattens nested transform-only `<node>` elements and emits the
    // inner `<geometry name="...">` instead of the authored `<node name>`.
    // Example: `<node name="Propeller">` wrapping `<instance_geometry url="#geom-Prop">`
    // (where `<geometry name="Prop">`) produces a leaf named "Prop", so a
    // request for "Propeller" should still resolve to it.  We require the
    // candidate to share a non-trivial prefix with the requested name to
    // avoid spurious matches.
    const candidates: THREE.Object3D[] = [];
    scene.traverse((child) => {
      if (child === scene || !child.name) return;
      if (
        submeshName.startsWith(child.name) ||
        child.name.startsWith(submeshName)
      ) {
        candidates.push(child);
      }
    });
    // Prefer the longest matching name (closest to the requested name).
    candidates.sort((a, b) => b.name.length - a.name.length);
    match = candidates[0] ?? null;
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
    .filter((child) => (child as { isURDFVisual?: boolean }).isURDFVisual === true)
    .map((child, index) => ({
      root: child,
      stableId: child.name || child.userData?.runtimeKey || index,
    }));

  if (visualRoots.length < 2) {
    return;
  }

  stackCoincidentVisualRoots(visualRoots);
}

function restackRobotVisualRoots(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);

  const visualRoots: Array<{ root: THREE.Object3D; stableId: number }> = [];
  let visualIndex = 0;
  root.traverse((child) => {
    if ((child as { isURDFVisual?: boolean }).isURDFVisual !== true) {
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

  const color = resolved.color ?? colorRgbaTupleToHex(resolved.colorRgba) ?? undefined;
  const opacity = resolved.opacity ?? colorRgbaTupleToOpacity(resolved.colorRgba);
  const override: VisualMaterialOverride = {
    ...(color ? { color } : {}),
    ...(resolved.texture ? { texture: resolved.texture } : {}),
    ...(opacity !== undefined ? { opacity } : {}),
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

function hasMirroredMeshScale(geometry: RobotLink['visual']): boolean {
  if (geometry.type !== GeometryType.MESH) {
    return false;
  }

  const scale = geometry.dimensions;
  const x = Number.isFinite(scale?.x) ? scale.x : 1;
  const y = Number.isFinite(scale?.y) ? scale.y : 1;
  const z = Number.isFinite(scale?.z) ? scale.z : 1;
  return x * y * z < 0;
}

function applyVisualMaterialSidePolicy(
  object: THREE.Object3D,
  geometry: RobotLink['visual'],
  isCollision: boolean,
): void {
  if (isCollision || (geometry.doubleSided !== true && !hasMirroredMeshScale(geometry))) {
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
        console.error('[EditorViewer] Heightmap image has no dimensions:', heightmapUri);
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
        console.error('[EditorViewer] Failed to create canvas for heightmap:', heightmapUri);
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

  const extrudeDepth = Math.max(height ?? 0, 1e-5);
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
  inspectionContext?: RobotData['inspectionContext'];
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
  inspectionContext,
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
  // Shares the resulting MeshStandardMaterial across geoms that resolve to the
  // same visual material override + source-material profile, so each robot
  // load only allocates one material per distinct profile instead of one per
  // mesh. Scope is intentionally one cache per load: dispose lifecycle stays
  // tied to the loaded robot and there is no cross-load aliasing.
  const visualMaterialOverrideCache = new Map<string, THREE.MeshStandardMaterial>();
  const visualRestackBatch = createVisualRestackBatch(() => restackRobotVisualRoots(robot));

  robot.robotName = robotName ?? null;
  robot.name = robotName || '';
  robot.urdfName = robot.name;
  robot.userData.displayName = robotName || '';
  if (inspectionContext?.sourceFormat === 'mjcf' && inspectionContext.mjcf?.tendons.length) {
    robot.userData.__mjcfTendonsData = inspectionContext.mjcf.tendons
      .filter((tendon) => tendon.type === 'spatial')
      .map((tendon) => ({
        name: tendon.name,
        rgba: tendon.rgba ? ([...tendon.rgba] as [number, number, number, number]) : undefined,
        attachmentRefs: [...tendon.attachmentRefs],
        attachments: tendon.attachments.map((attachment) => ({ ...attachment })),
        width: tendon.width,
      }));
  }

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
      Boolean(resolvedMaterialOverride.override) ||
      Boolean(visualMaterialOverride) ||
      (!resolvedMaterialOverride.override && hasExplicitGeometryMaterialOverride(geometry));
    group.name = runtimeKey;
    group.urdfName = runtimeKey;
    group.userData.runtimeKey = runtimeKey;
    group.userData.parentLinkId = linkKey;
    group.userData.displayName = runtimeKey;
    group.userData.geometryRole = isCollision ? 'collision' : 'visual';
    group.userData.geometryType = geometry.type;
    group.userData.geometryDimensions = { ...geometry.dimensions };
    if (geometry.name) {
      group.userData.geometryName = geometry.name;
    }

    applyOrigin(group, geometry.origin);
    applyMeshScale(group, geometry);

    if (geometry.type === GeometryType.MESH && geometry.meshPath) {
      if (isImageAssetPath(geometry.meshPath)) {
        group.add(createImagePreviewMesh(geometry, manager, isCollision));
      } else {
        const completeVisualMeshLoad = isCollision ? null : visualRestackBatch.trackLoad();

        loadMeshCb(geometry.meshPath, manager, (object, error) => {
          let didAttachVisualMesh = false;

          try {
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
              applyVisualMaterialOverrideToObject(
                meshObject,
                visualMaterialOverride,
                manager,
                visualMaterialOverrideCache,
              );
            }

            if (!isCollision && hasGeometryMeshMaterialGroups(geometry)) {
              applyVisualMeshMaterialGroupsToObject(meshObject, geometry, { manager });
            }

            applyVisualMaterialSidePolicy(meshObject, geometry, isCollision);
            group.add(meshObject);
            didAttachVisualMesh = !isCollision;
            if (group.parent && !isCollision) {
              restackLinkVisualRoots(group.parent);
            }
          } finally {
            completeVisualMeshLoad?.(didAttachVisualMesh);
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
          applyVisualMaterialOverrideToObject(
            primitiveMesh,
            visualMaterialOverride,
            manager,
            visualMaterialOverrideCache,
          );
        }
        if (!isCollision && hasGeometryMeshMaterialGroups(geometry)) {
          applyVisualMeshMaterialGroupsToObject(primitiveMesh, geometry, { manager });
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
    if (linkData.mjcfSites?.length) {
      linkTarget.userData.__mjcfSitesData = linkData.mjcfSites.map((site) => {
        const clonedSite = { ...site };
        if (site.size) {
          clonedSite.size = [...site.size];
        }
        if (site.rgba) {
          clonedSite.rgba = [...site.rgba] as [number, number, number, number];
        }
        if (site.pos) {
          clonedSite.pos = [...site.pos] as [number, number, number];
        }
        if (site.quat) {
          clonedSite.quat = [...site.quat] as [number, number, number, number];
        }
        return clonedSite;
      });
    }
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
    if (typeof jointData.dynamics?.stiffness === 'number') {
      joint.userData.mjcfJointStiffness = jointData.dynamics.stiffness;
      Object.assign(
        joint.userData,
        resolveMjcfPassiveSpringJointMetadata({
          stiffness: jointData.dynamics.stiffness,
          hasActuator: !isUnactuatedJoint(jointData),
        }),
      );
    }
    joint.jointType = resolveRuntimeJointType(jointData.type);
    const hasFinitePositionLimits =
      Number.isFinite(jointData.limit?.lower) && Number.isFinite(jointData.limit?.upper);
    if (jointData.type === JointType.REVOLUTE || jointData.type === JointType.PRISMATIC) {
      joint.ignoreLimits = !hasFinitePositionLimits;
    }

    if (jointData.axis) {
      joint.axis = new THREE.Vector3(jointData.axis.x, jointData.axis.y, jointData.axis.z);
      if (joint.axis.lengthSq() > 0) {
        joint.axis.normalize();
      }
    }

    if (jointData.limit) {
      if (hasFinitePositionLimits) {
        const motionLimit = normalizeJointLimitOrder({
          lower: getJointMotionAngleFromActualAngle(jointData, Number(jointData.limit.lower)),
          upper: getJointMotionAngleFromActualAngle(jointData, Number(jointData.limit.upper)),
        });
        joint.limit.lower = motionLimit.lower;
        joint.limit.upper = motionLimit.upper;
      }
      joint.limit.effort = Number.isFinite(jointData.limit.effort)
        ? Number(jointData.limit.effort)
        : undefined;
      joint.limit.velocity = Number.isFinite(jointData.limit.velocity)
        ? Number(jointData.limit.velocity)
        : undefined;
    }

    if (joint instanceof URDFMimicJoint && jointData.mimic) {
      joint.mimicJoint = jointData.mimic.joint;
      joint.multiplier = jointData.mimic.multiplier ?? 1;
      joint.offset = jointData.mimic.offset ?? 0;
    }

    applyOrigin(joint, jointData.origin);
    attachBallJointQuaternionState(joint, jointData);
    if (
      jointData.type !== JointType.BALL &&
      typeof jointData.angle === 'number' &&
      Number.isFinite(jointData.angle)
    ) {
      const originalIgnoreLimits = joint.ignoreLimits;
      joint.ignoreLimits = true;
      joint.setJointValue(getJointMotionAngleFromActualAngle(jointData, jointData.angle));
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

  visualRestackBatch.markHierarchyReady();
  restackRobotVisualRoots(robot);
  visualRestackBatch.resetAfterImmediateRestack();
  visualRestackBatch.flush();
  return robot;
}
