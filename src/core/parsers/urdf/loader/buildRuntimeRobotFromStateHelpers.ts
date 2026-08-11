import * as THREE from 'three';
import { stackCoincidentVisualRoots } from '@/core/loaders/visualMeshStacking';
import { applyMeshAssetTransform } from '@/core/parsers/mjcf/mjcfGeometry';
import { GENERATED_OBJ_MATERIAL_USER_DATA_KEY } from '@/core/loaders/objModelData';
import { hasExplicitGeometryMaterialOverride } from '@/core/utils/visualMaterialOverrides';
import {
  getBoxFaceMaterialPalette,
  resolveVisualMaterialOverride as resolveRobotVisualMaterialOverride,
} from '@/core/robot';
import { createBoxFaceMaterialArray } from '@/core/utils/boxFaceMaterialArray';
import { colorRgbaTupleToHex, colorRgbaTupleToOpacity } from '@/core/utils/color.ts';
import { createMatteMaterial } from '@/core/utils/materialFactory';
import { forceObjectMaterialSide } from '@/core/utils/three/materialSide';
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
import { URDFJoint } from './URDFClasses';
import {
  createRobotCapsuleGeometry,
  createRobotCylinderGeometry,
  createRobotSphereGeometry,
  type RobotPrimitiveGeometryDetail,
} from './primitiveGeometry';
import type { VisualMaterialOverride } from '@/core/utils/visualMaterialOverrides';

export const DEFAULT_COLOR = '#ffffff';

export const DEFAULT_ORIGIN = {
  xyz: { x: 0, y: 0, z: 0 },
  rpy: { r: 0, p: 0, y: 0 },
} as const;

export const tempQuaternion = new THREE.Quaternion();

export const tempEuler = new THREE.Euler();

export function applyRotation(
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

export function applyOrigin(
  object: THREE.Object3D,
  origin: RobotLink['visual']['origin'] | RobotJoint['origin'] | undefined,
): void {
  const xyz = origin?.xyz ?? DEFAULT_ORIGIN.xyz;
  const rpy = origin?.rpy ?? DEFAULT_ORIGIN.rpy;

  object.position.set(xyz.x, xyz.y, xyz.z);
  object.rotation.set(0, 0, 0);
  applyRotation(object, [rpy.r, rpy.p, rpy.y]);
}

export type RuntimeBallJoint = URDFJoint & {
  jointQuaternion: THREE.Quaternion;
  setJointQuaternion: (value: RobotJoint['quaternion']) => boolean;
};

export function createFiniteQuaternion(value: RobotJoint['quaternion']): THREE.Quaternion | null {
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

export function attachBallJointQuaternionState(joint: URDFJoint, jointData: RobotJoint): void {
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

export function loadedObjectShouldPreserveEmbeddedMaterials(object: THREE.Object3D): boolean {
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

  return (
    hasExternalAuthoredMaterial ||
    hasMaterialTexture ||
    hasMultiMaterialMesh ||
    materialNames.size > 1
  );
}

export function loadedObjectHasSingleMaterialSlot(object: THREE.Object3D): boolean {
  let materialSlotCount = 0;

  object.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) {
      return;
    }

    const material = (child as THREE.Mesh).material;
    materialSlotCount += Array.isArray(material) ? material.length : material ? 1 : 0;
  });

  return materialSlotCount === 1;
}

export function shouldAttachLoadedMeshObject(
  object: THREE.Object3D,
  isCollisionNode: boolean,
): boolean {
  if (isCollisionNode && object.userData?.isPlaceholder === true) {
    return false;
  }

  return true;
}

export function extractSubmesh(
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
      if (submeshName.startsWith(child.name) || child.name.startsWith(submeshName)) {
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

export function restackLinkVisualRoots(linkTarget: THREE.Object3D): void {
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

export function restackRobotVisualRoots(root: THREE.Object3D): void {
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

export function createPrimitiveMaterial(color?: string): THREE.MeshStandardMaterial {
  return createMatteMaterial({
    color: color || DEFAULT_COLOR,
    preserveExactColor: Boolean(color),
    side: THREE.FrontSide,
  });
}

export function resolveStateVisualMaterialOverride({
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
  const resolved = resolveRobotVisualMaterialOverride({ materials }, link, geometry, {
    isPrimaryVisual,
  });

  if (resolved.source === 'none' || resolved.isMultiMaterial) {
    return { override: null, isExplicit: false };
  }

  const color = resolved.color ?? colorRgbaTupleToHex(resolved.colorRgba) ?? undefined;
  const opacity = resolved.opacity ?? colorRgbaTupleToOpacity(resolved.colorRgba);
  const override: VisualMaterialOverride = {
    ...(color ? { color } : {}),
    ...(resolved.texture ? { texture: resolved.texture } : {}),
    ...(resolved.textureRepeat ? { textureRepeat: [...resolved.textureRepeat] } : {}),
    ...(resolved.mjcfBuiltinTexture
      ? { mjcfBuiltinTexture: { ...resolved.mjcfBuiltinTexture } }
      : {}),
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
    isExplicit: resolved.source === 'legacy-link' || hasExplicitGeometryMaterialOverride(geometry),
  };
}

export function applyMeshScale(group: THREE.Object3D, geometry: RobotLink['visual']): void {
  if (geometry.type !== GeometryType.MESH) {
    return;
  }

  // MJCF scale belongs inside the asset reference transform. Applying it to
  // the outer geom group changes the order for non-uniform scale + refquat.
  if (geometry.mjcfMesh) {
    return;
  }

  const scale = geometry.dimensions;
  group.scale.set(
    Number.isFinite(scale?.x) ? scale.x : 1,
    Number.isFinite(scale?.y) ? scale.y : 1,
    Number.isFinite(scale?.z) ? scale.z : 1,
  );
}

export function applyRuntimeMeshAssetTransform(
  object: THREE.Object3D,
  geometry: RobotLink['visual'],
): THREE.Object3D {
  const meshAsset = geometry.mjcfMesh;
  if (!meshAsset) {
    return object;
  }

  const dimensions = geometry.dimensions;
  return applyMeshAssetTransform(object, {
    ...meshAsset,
    name: meshAsset.name || geometry.assetRef || geometry.name || 'mjcf_mesh',
    // RobotData dimensions are editable and are the canonical runtime scale.
    ...(geometry.type === GeometryType.MESH
      ? {
          scale: [
            Number.isFinite(dimensions.x) ? dimensions.x : 1,
            Number.isFinite(dimensions.y) ? dimensions.y : 1,
            Number.isFinite(dimensions.z) ? dimensions.z : 1,
          ] as [number, number, number],
        }
      : {}),
  });
}

export function hasMirroredMeshScale(geometry: RobotLink['visual']): boolean {
  if (geometry.type !== GeometryType.MESH) {
    return false;
  }

  const scale = geometry.dimensions;
  const x = Number.isFinite(scale?.x) ? scale.x : 1;
  const y = Number.isFinite(scale?.y) ? scale.y : 1;
  const z = Number.isFinite(scale?.z) ? scale.z : 1;
  return x * y * z < 0;
}

export function applyVisualMaterialSidePolicy(
  object: THREE.Object3D,
  geometry: RobotLink['visual'],
  isCollision: boolean,
): void {
  if (isCollision || (geometry.doubleSided !== true && !hasMirroredMeshScale(geometry))) {
    return;
  }

  forceObjectMaterialSide(object, THREE.DoubleSide);
}

export function createImagePreviewMesh(
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

export function createHeightfieldMesh(
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

export function createPolylineMesh(
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

export function createPrimitiveMesh(
  geometry: RobotLink['visual'],
  isCollision: boolean,
  manager?: THREE.LoadingManager,
  primitiveGeometryDetail?: RobotPrimitiveGeometryDetail,
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
    const mesh = new THREE.Mesh(createRobotSphereGeometry(primitiveGeometryDetail), material);
    mesh.scale.set(radius, dimensions.y || radius, dimensions.z || radius);
    return mesh;
  }

  if (geometry.type === GeometryType.CYLINDER) {
    const mesh = new THREE.Mesh(createRobotCylinderGeometry(primitiveGeometryDetail), material);
    mesh.scale.set(dimensions.x || 0.05, dimensions.y || 0.5, dimensions.z || dimensions.x || 0.05);
    mesh.rotation.set(Math.PI / 2, 0, 0);
    return mesh;
  }

  if (geometry.type === GeometryType.CAPSULE) {
    const radius = Math.max(dimensions.x || 0.05, 1e-5);
    // Canonical RobotData stores the straight cylindrical span. The rendered
    // end-to-end extent is this body length plus both hemispherical caps.
    const bodyLength = Math.max(dimensions.y || 0.5, 0);
    const mesh = new THREE.Mesh(
      createRobotCapsuleGeometry(radius, bodyLength, primitiveGeometryDetail),
      material,
    );
    mesh.rotation.set(Math.PI / 2, 0, 0);
    return mesh;
  }

  return null;
}

export function resolveRuntimeJointType(type: JointType): URDFJoint['jointType'] {
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
