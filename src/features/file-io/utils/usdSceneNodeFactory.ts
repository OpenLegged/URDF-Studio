import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

import type { UrdfVisual } from '@/types';
import { parseThreeColorWithOpacity } from '@/core/utils/color.ts';
import {
  getBoxFaceMaterialPalette,
  getGeometryAuthoredMaterials,
  hasGeometryMeshMaterialGroups,
} from '@/core/robot';
import {
  shouldNormalizeColladaRoot,
  type ColladaRootNormalizationHints,
} from '@/core/loaders/colladaRootNormalization.ts';
import { loadColladaScene } from '@/core/loaders/colladaParseWorkerBridge.ts';
import {
  createSceneFromSerializedColladaData,
  parseColladaSceneData,
} from '@/core/loaders/colladaWorkerSceneData.ts';
import {
  createObjectFromSerializedObjData,
  loadSerializedObjModelData,
} from '@/core/loaders/objParseWorkerBridge.ts';
import {
  createGeometryFromSerializedMshData,
  parseMshGeometryData,
} from '@/core/loaders/mshGeometryData.ts';
import { createGeometryFromSerializedStlData } from '@/core/loaders/stlGeometryData.ts';
import { loadSerializedStlGeometryData } from '@/core/loaders/stlParseWorkerBridge.ts';
import { applyVisualMeshMaterialGroupsToObject } from '@/core/utils/meshMaterialGroups';
import { ensureWorkerXmlDomApis } from '@/core/utils/ensureWorkerXmlDomApis.ts';
import { disposeMaterial } from '@/shared/utils/three/dispose.ts';

import {
  createUsdTextureLoadingManager,
  resolveUsdAssetUrl,
  type UsdAssetRegistry,
} from './usdAssetRegistry.ts';
import {
  createUsdBaseMaterial,
  isUsdMeshObject,
  normalizeUsdRenderableMaterials,
} from './usdMaterialNormalization.ts';
import { applyUsdAuthoredMaterialPalette } from './usdAuthoredMaterialPalette.ts';
import { applyUsdMeshCompression } from './usdMeshCompression.ts';

export const USD_GEOMETRY_TYPES = {
  BOX: 'box',
  PLANE: 'plane',
  CYLINDER: 'cylinder',
  SPHERE: 'sphere',
  ELLIPSOID: 'ellipsoid',
  CAPSULE: 'capsule',
  HFIELD: 'hfield',
  POLYLINE: 'polyline',
  SDF: 'sdf',
  MESH: 'mesh',
  NONE: 'none',
} as const;

export type UsdVisualRole = 'visual' | 'collision';

export type UsdMaterialMetadata = {
  color?: string;
  colorRgba?: [number, number, number, number];
  texture?: string;
  forceUniformOverride?: boolean;
  preserveEmbeddedMaterials?: boolean;
  suppressVisualColor?: boolean;
};

export interface UsdMeshCompressionOptions {
  enabled: boolean;
  quality: number;
}

type CachedUsdGltfSceneAsset = {
  preserveSkeletons: boolean;
  scene: THREE.Object3D;
};

type SerializedPrimitiveType = 'Cube' | 'Sphere' | 'Cylinder' | 'Capsule';

type BuildUsdVisualSceneNodeOptions = {
  visual: UrdfVisual;
  role: UsdVisualRole;
  registry: UsdAssetRegistry;
  materialState?: UsdMaterialMetadata;
  meshCompression?: UsdMeshCompressionOptions;
  colladaRootNormalizationHints?: ColladaRootNormalizationHints | null;
};

const usdTextureLoadingManagerCache = new WeakMap<UsdAssetRegistry, THREE.LoadingManager>();
const usdGltfSceneAssetCache = new WeakMap<
  UsdAssetRegistry,
  Map<string, Promise<CachedUsdGltfSceneAsset>>
>();
const usdStlGeometryCache = new WeakMap<
  UsdAssetRegistry,
  Map<string, Promise<THREE.BufferGeometry>>
>();
const USD_ISAAC_NEUTRAL_FALLBACK_COLOR = '#999999';
const USD_BRIGHT_NEUTRAL_PLACEHOLDER_MIN = 0.96;
const USD_BRIGHT_NEUTRAL_PLACEHOLDER_DELTA = 0.02;
const USD_ISAAC_COLLADA_BAKED_ROTATION_EPSILON = 1e-5;
const USD_FALLBACK_BOX_THICKNESS = 0.001;
const USD_ISAAC_COLLADA_CYCLIC_MESH_QUATERNION = new THREE.Quaternion(0.5, 0.5, 0.5, 0.5);
const USD_ISAAC_COLLADA_VISUAL_QUATERNION = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(Math.PI / 2, 0, 0, 'XYZ'),
);

type LoadedUsdObjectMaterialProfile = {
  hasMaterialTexture: boolean;
  hasMultiMaterialMesh: boolean;
  hasSingleEmbeddedMaterialIdentity: boolean;
  hasPlaceholderWhiteOnly: boolean;
  materialNames: Set<string>;
};

const getUsdTextureLoadingManager = (registry: UsdAssetRegistry): THREE.LoadingManager => {
  const cachedManager = usdTextureLoadingManagerCache.get(registry);
  if (cachedManager) {
    return cachedManager;
  }

  const manager = createUsdTextureLoadingManager(registry);
  usdTextureLoadingManagerCache.set(registry, manager);
  return manager;
};

const getUsdGltfSceneAssetCache = (
  registry: UsdAssetRegistry,
): Map<string, Promise<CachedUsdGltfSceneAsset>> => {
  const cached = usdGltfSceneAssetCache.get(registry);
  if (cached) {
    return cached;
  }

  const nextCache = new Map<string, Promise<CachedUsdGltfSceneAsset>>();
  usdGltfSceneAssetCache.set(registry, nextCache);
  return nextCache;
};

const getUsdStlGeometryCache = (
  registry: UsdAssetRegistry,
): Map<string, Promise<THREE.BufferGeometry>> => {
  const cached = usdStlGeometryCache.get(registry);
  if (cached) {
    return cached;
  }

  const nextCache = new Map<string, Promise<THREE.BufferGeometry>>();
  usdStlGeometryCache.set(registry, nextCache);
  return nextCache;
};

const cloneMaterialInstance = <TMaterial extends THREE.Material>(
  material: TMaterial,
): TMaterial => {
  const clonedMaterial = material.clone() as TMaterial;
  clonedMaterial.userData = {
    ...(material.userData ?? {}),
    ...(clonedMaterial.userData ?? {}),
  };
  return clonedMaterial;
};

const objectHasSkinnedMeshes = (root: THREE.Object3D): boolean => {
  let hasSkinnedMeshes = false;

  root.traverse((child) => {
    if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
      hasSkinnedMeshes = true;
    }
  });

  return hasSkinnedMeshes;
};

const cloneUsdGltfSceneAsset = (asset: CachedUsdGltfSceneAsset): THREE.Object3D => {
  const clonedRoot = asset.preserveSkeletons ? cloneSkeleton(asset.scene) : asset.scene.clone(true);

  clonedRoot.traverse((child) => {
    const meshLike = child as THREE.Mesh;

    if (meshLike.geometry?.isBufferGeometry) {
      meshLike.geometry = meshLike.geometry.clone();
    }

    if (!meshLike.isMesh) {
      return;
    }

    if (Array.isArray(meshLike.material)) {
      meshLike.material = meshLike.material.map((material) => cloneMaterialInstance(material));
      return;
    }

    if (meshLike.material) {
      meshLike.material = cloneMaterialInstance(meshLike.material);
    }
  });

  return clonedRoot;
};

const loadUsdGltfSceneAsset = async (
  assetUrl: string,
  registry: UsdAssetRegistry,
): Promise<CachedUsdGltfSceneAsset> => {
  ensureWorkerXmlDomApis();
  const cache = getUsdGltfSceneAssetCache(registry);
  const cached = cache.get(assetUrl);
  if (cached) {
    return await cached;
  }

  const pendingLoad = (async (): Promise<CachedUsdGltfSceneAsset> => {
    const loader = new GLTFLoader(getUsdTextureLoadingManager(registry));
    const gltf = await loader.loadAsync(assetUrl);
    return {
      scene: gltf.scene,
      preserveSkeletons: objectHasSkinnedMeshes(gltf.scene),
    };
  })();

  cache.set(assetUrl, pendingLoad);

  try {
    return await pendingLoad;
  } catch (error) {
    cache.delete(assetUrl);
    throw error;
  }
};

export const getUsdGeometryType = (value: string | null | undefined): string => {
  return String(value || '')
    .trim()
    .toLowerCase();
};

const getUsdVisualScale = (visual: UrdfVisual): THREE.Vector3 => {
  const type = getUsdGeometryType(visual.type);
  if (type === USD_GEOMETRY_TYPES.BOX) {
    return new THREE.Vector3(
      visual.dimensions.x || 1,
      visual.dimensions.y || 1,
      visual.dimensions.z || 1,
    );
  }

  if (type === USD_GEOMETRY_TYPES.SPHERE) {
    return new THREE.Vector3(1, 1, 1);
  }

  if (type === USD_GEOMETRY_TYPES.CYLINDER || type === USD_GEOMETRY_TYPES.CAPSULE) {
    return new THREE.Vector3(1, 1, 1);
  }

  return new THREE.Vector3(
    visual.dimensions.x || 1,
    visual.dimensions.y || 1,
    visual.dimensions.z || 1,
  );
};

const getUsdFallbackBoxScale = (visual: UrdfVisual): THREE.Vector3 => {
  const type = getUsdGeometryType(visual.type);
  if (type === USD_GEOMETRY_TYPES.PLANE) {
    return new THREE.Vector3(
      Math.max(Math.abs(visual.dimensions.x || 0), USD_FALLBACK_BOX_THICKNESS),
      Math.max(Math.abs(visual.dimensions.y || 0), USD_FALLBACK_BOX_THICKNESS),
      USD_FALLBACK_BOX_THICKNESS,
    );
  }

  if (
    type === USD_GEOMETRY_TYPES.POLYLINE &&
    visual.polylinePoints &&
    visual.polylinePoints.length > 0
  ) {
    const xs = visual.polylinePoints.map((point) => point.x);
    const ys = visual.polylinePoints.map((point) => point.y);
    const width = Math.max(Math.max(...xs) - Math.min(...xs), USD_FALLBACK_BOX_THICKNESS);
    const depth = Math.max(Math.max(...ys) - Math.min(...ys), USD_FALLBACK_BOX_THICKNESS);
    const height = Math.max(Math.abs(visual.polylineHeight || 0), USD_FALLBACK_BOX_THICKNESS);
    return new THREE.Vector3(width, depth, height);
  }

  return new THREE.Vector3(
    Math.max(Math.abs(visual.dimensions.x || 0), USD_FALLBACK_BOX_THICKNESS),
    Math.max(Math.abs(visual.dimensions.y || 0), USD_FALLBACK_BOX_THICKNESS),
    Math.max(Math.abs(visual.dimensions.z || 0), USD_FALLBACK_BOX_THICKNESS),
  );
};

const applyUsdVisualOrigin = (object: THREE.Object3D, visual: UrdfVisual): void => {
  object.position.set(
    visual.origin?.xyz?.x ?? 0,
    visual.origin?.xyz?.y ?? 0,
    visual.origin?.xyz?.z ?? 0,
  );
  object.quaternion.copy(
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        visual.origin?.rpy?.r ?? 0,
        visual.origin?.rpy?.p ?? 0,
        visual.origin?.rpy?.y ?? 0,
        'ZYX',
      ),
    ),
  );
};

const createUsdPrimitiveSceneNode = (
  visual: UrdfVisual,
  role: UsdVisualRole,
  materialState?: UsdMaterialMetadata,
): THREE.Object3D | null => {
  const boxFacePalette = role === 'visual' ? getBoxFaceMaterialPalette(visual) : [];
  if (boxFacePalette.length > 0) {
    const anchor = new THREE.Group();
    const baseGeometry = new THREE.BoxGeometry(1, 1, 1);
    applyUsdVisualOrigin(anchor, visual);
    anchor.scale.copy(getUsdVisualScale(visual));
    anchor.name = role;

    boxFacePalette.forEach((entry) => {
      const faceGroup = baseGeometry.groups[entry.index];
      if (!faceGroup) {
        return;
      }

      const geometry = baseGeometry.clone();
      geometry.clearGroups();
      geometry.addGroup(faceGroup.start, faceGroup.count, 0);

      const color =
        entry.material.color ||
        materialState?.color ||
        visual.color ||
        (entry.material.texture ? '#ffffff' : undefined) ||
        '#ffffff';
      const mesh = new THREE.Mesh(geometry, createUsdBaseMaterial(color));
      mesh.name = `box_${entry.face}`;
      mesh.userData.usdGeomType = 'Cube';
      mesh.userData.usdDisplayColor = color;
      mesh.userData.usdMaterial = {
        color,
        ...(entry.material.texture ? { texture: entry.material.texture } : {}),
      };
      mesh.userData.usdSerializeFilteredGroups = true;
      anchor.add(mesh);
    });

    baseGeometry.dispose();
    return anchor.children.length > 0 ? anchor : null;
  }

  const type = getUsdGeometryType(visual.type);
  let primitiveType: SerializedPrimitiveType | null =
    type === USD_GEOMETRY_TYPES.BOX
      ? 'Cube'
      : type === USD_GEOMETRY_TYPES.SPHERE
        ? 'Sphere'
        : type === USD_GEOMETRY_TYPES.CYLINDER
          ? 'Cylinder'
          : type === USD_GEOMETRY_TYPES.CAPSULE
            ? 'Capsule'
            : null;
  const fallbackSourceType = primitiveType ? null : type;
  const fallbackScale = primitiveType ? null : getUsdFallbackBoxScale(visual);

  if (!primitiveType) {
    primitiveType = 'Cube';
  }

  const anchor = new THREE.Group();
  applyUsdVisualOrigin(anchor, visual);
  anchor.scale.copy(fallbackScale || getUsdVisualScale(visual));
  anchor.name = role;
  if (role === 'collision') {
    anchor.userData.usdPurpose = 'guide';
    anchor.userData.usdCollision = true;
  }

  const primitive = new THREE.Object3D();
  primitive.name = fallbackSourceType
    ? `${fallbackSourceType}_as_box`
    : type || primitiveType.toLowerCase();
  primitive.userData.usdGeomType = primitiveType;
  if (fallbackSourceType) {
    primitive.userData.usdFallbackSourceType = fallbackSourceType;
  }
  if (primitiveType === 'Sphere') {
    primitive.userData.usdRadius = visual.dimensions.x || 0.5;
  } else if (primitiveType === 'Cylinder' || primitiveType === 'Capsule') {
    primitive.userData.usdRadius = visual.dimensions.x || 0.5;
    primitive.userData.usdHeight = visual.dimensions.y || 1;
  }
  primitive.userData.usdDisplayColor = materialState?.suppressVisualColor
    ? null
    : materialState?.color || visual.color || null;
  if (role === 'collision') {
    primitive.userData.usdPurpose = 'guide';
    primitive.userData.usdCollision = true;
  }
  anchor.add(primitive);

  return anchor;
};

const applyExplicitMeshDisplayColor = (root: THREE.Object3D, color: string | undefined): void => {
  if (!color) {
    return;
  }

  root.traverse((child) => {
    if (!isUsdMeshObject(child)) {
      return;
    }

    child.userData.usdDisplayColor = color;
  });
};

const applyUniformMaterialOverride = (root: THREE.Object3D, color: string | undefined): void => {
  const resolvedColor = color?.trim() || '#808080';
  const replacedMaterials = new Set<THREE.Material>();

  root.traverse((child) => {
    if (!isUsdMeshObject(child)) {
      return;
    }

    if (Array.isArray(child.material)) {
      child.material.forEach((material) => {
        if (material) {
          replacedMaterials.add(material);
        }
      });
    } else if (child.material) {
      replacedMaterials.add(child.material);
    }

    child.material = createUsdBaseMaterial(resolvedColor);
  });

  replacedMaterials.forEach((material) => {
    disposeMaterial(material);
  });
};

const getLoadedUsdMaterialSrgbColor = (
  material: THREE.Material,
): [number, number, number] | null => {
  const sourceMaterial = material as THREE.Material & { color?: THREE.Color };
  if (!(sourceMaterial.color instanceof THREE.Color)) {
    return null;
  }

  const srgbColor = sourceMaterial.color.clone().convertLinearToSRGB();
  return [srgbColor.r, srgbColor.g, srgbColor.b];
};

const isBrightNeutralPlaceholderColor = (
  color: readonly [number, number, number] | null | undefined,
): boolean => {
  if (!color) {
    return false;
  }

  const minChannel = Math.min(...color);
  const maxChannel = Math.max(...color);
  return (
    minChannel >= USD_BRIGHT_NEUTRAL_PLACEHOLDER_MIN &&
    maxChannel - minChannel <= USD_BRIGHT_NEUTRAL_PLACEHOLDER_DELTA
  );
};

const analyzeLoadedUsdObjectMaterials = (
  object: THREE.Object3D,
): LoadedUsdObjectMaterialProfile => {
  const materialNames = new Set<string>();
  let hasMaterialTexture = false;
  let hasMultiMaterialMesh = false;
  let hasSingleEmbeddedMaterialIdentity = false;
  let hasPlaceholderWhiteOnly = true;
  let materialCount = 0;

  object.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) {
      return;
    }

    const meshUsdMaterial = (child.userData?.usdMaterial || {}) as Partial<UsdMaterialMetadata>;
    const hasExplicitUsdMaterialMetadata = Boolean(
      meshUsdMaterial.texture || meshUsdMaterial.colorRgba || meshUsdMaterial.color,
    );
    const material = (child as THREE.Mesh).material;
    const materials = Array.isArray(material) ? material : [material];
    if (materials.length > 1) {
      hasMultiMaterialMesh = true;
    }

    materials.forEach((entry) => {
      materialCount += 1;
      const isGeneratedBaseMaterial = Boolean(
        (
          entry as THREE.Material & {
            userData?: {
              usdGeneratedBaseMaterial?: boolean;
            };
          }
        ).userData?.usdGeneratedBaseMaterial,
      );
      const materialName = entry?.name?.trim();
      if (materialName && !isGeneratedBaseMaterial) {
        materialNames.add(materialName);
        hasSingleEmbeddedMaterialIdentity = true;
        hasPlaceholderWhiteOnly = false;
      }

      if ('map' in (entry || {}) && (entry as THREE.MeshStandardMaterial).map) {
        hasMaterialTexture = true;
        hasSingleEmbeddedMaterialIdentity = true;
        hasPlaceholderWhiteOnly = false;
      }

      const materialColor = getLoadedUsdMaterialSrgbColor(entry);
      if (
        materialColor &&
        !isBrightNeutralPlaceholderColor(materialColor) &&
        (!isGeneratedBaseMaterial || hasExplicitUsdMaterialMetadata)
      ) {
        hasSingleEmbeddedMaterialIdentity = true;
        hasPlaceholderWhiteOnly = false;
        return;
      }

      if (!materialColor) {
        hasPlaceholderWhiteOnly = false;
      }
    });
  });

  return {
    hasMaterialTexture,
    hasMultiMaterialMesh,
    hasSingleEmbeddedMaterialIdentity,
    hasPlaceholderWhiteOnly:
      materialCount > 0 &&
      hasPlaceholderWhiteOnly &&
      !hasMaterialTexture &&
      !hasMultiMaterialMesh &&
      materialNames.size === 0 &&
      !hasSingleEmbeddedMaterialIdentity,
    materialNames,
  };
};

const loadedUsdObjectShouldPreserveEmbeddedMaterials = (
  materialProfile: LoadedUsdObjectMaterialProfile,
): boolean => {
  return (
    materialProfile.hasMaterialTexture ||
    materialProfile.hasMultiMaterialMesh ||
    materialProfile.materialNames.size > 1 ||
    materialProfile.hasSingleEmbeddedMaterialIdentity
  );
};

const getUsdMaterialOverrideSrgbColor = (
  materialState: UsdMaterialMetadata | undefined,
): [number, number, number] | null => {
  if (
    Array.isArray(materialState?.colorRgba) &&
    materialState.colorRgba.length >= 3 &&
    materialState.colorRgba.every((value) => Number.isFinite(value))
  ) {
    return [materialState.colorRgba[0], materialState.colorRgba[1], materialState.colorRgba[2]];
  }

  const parsedColor = parseThreeColorWithOpacity(materialState?.color);
  if (!parsedColor) {
    return null;
  }

  const srgbColor = parsedColor.color.clone().convertLinearToSRGB();
  return [srgbColor.r, srgbColor.g, srgbColor.b];
};

const usdMaterialOverrideLooksLikePlaceholder = (
  materialState: UsdMaterialMetadata | undefined,
): boolean => {
  if (!materialState?.forceUniformOverride || materialState.texture) {
    return false;
  }

  return isBrightNeutralPlaceholderColor(getUsdMaterialOverrideSrgbColor(materialState));
};

const buildCachedUsdStlGeometry = async (
  assetUrl: string,
  registry: UsdAssetRegistry,
  meshCompression?: UsdMeshCompressionOptions,
): Promise<THREE.BufferGeometry> => {
  const compressionKey =
    meshCompression?.enabled && meshCompression.quality < 100
      ? `compressed:${meshCompression.quality}`
      : 'raw';
  const cacheKey = `${assetUrl}::${compressionKey}`;
  const cache = getUsdStlGeometryCache(registry);
  const cached = cache.get(cacheKey);
  if (cached) {
    return await cached;
  }

  const pendingGeometry = (async () => {
    const serializedGeometry = await loadSerializedStlGeometryData(assetUrl);
    const geometry = createGeometryFromSerializedStlData(serializedGeometry);
    if (meshCompression?.enabled && meshCompression.quality < 100) {
      const mesh = new THREE.Mesh(geometry, createUsdBaseMaterial('#ffffff'));
      applyUsdMeshCompression(mesh, meshCompression.quality);
      return mesh.geometry;
    }

    return geometry;
  })();

  cache.set(cacheKey, pendingGeometry);

  try {
    return await pendingGeometry;
  } catch (error) {
    cache.delete(cacheKey);
    throw error;
  }
};

const collapseTrivialColladaMeshWrapperChain = (object: THREE.Object3D): THREE.Object3D => {
  const wrapperChain: THREE.Object3D[] = [];
  let current: THREE.Object3D = object;

  while (!isUsdMeshObject(current) && current.children.length === 1) {
    wrapperChain.push(current);
    current = current.children[0]!;
  }

  if (!isUsdMeshObject(current) || wrapperChain.length === 0) {
    return object;
  }

  object.updateMatrixWorld(true);
  const collapsedMatrix = current.matrixWorld.clone();
  const inheritedVisibility = wrapperChain.every((node) => node.visible);

  current.removeFromParent();
  collapsedMatrix.decompose(current.position, current.quaternion, current.scale);
  current.visible = inheritedVisibility && current.visible;
  current.name = 'mesh';

  return current;
};

const quaternionNearlyEquals = (
  left: THREE.Quaternion,
  right: THREE.Quaternion,
  epsilon = USD_ISAAC_COLLADA_BAKED_ROTATION_EPSILON,
): boolean => {
  const normalizedLeft = left.clone().normalize();
  const normalizedRight = right.clone().normalize();
  return Math.abs(Math.abs(normalizedLeft.dot(normalizedRight)) - 1) <= epsilon;
};

const bakeObjectLocalTransformIntoMeshGeometry = (
  object: THREE.Object3D,
  replacementLocalMatrix: THREE.Matrix4,
): void => {
  object.updateMatrix();
  const bakedMatrix = replacementLocalMatrix.clone().invert().multiply(object.matrix);

  object.traverse((child) => {
    if (!isUsdMeshObject(child)) {
      return;
    }

    child.geometry = child.geometry.clone();
    // BufferGeometry.applyMatrix4 transforms both positions and normals.
    child.geometry.applyMatrix4(bakedMatrix);
    child.geometry.computeBoundingBox();
    child.geometry.computeBoundingSphere();
  });
};

const normalizeIsaacCompatibleColladaMeshTransform = (object: THREE.Object3D): void => {
  if (
    object.parent !== null ||
    !isUsdMeshObject(object) ||
    !quaternionNearlyEquals(object.quaternion, USD_ISAAC_COLLADA_CYCLIC_MESH_QUATERNION)
  ) {
    return;
  }

  // Isaac Sim's URDF importer keeps the visual prim at the standard +90deg X orientation.
  // Bake only the residual between that target transform and the authored cyclic transform;
  // baking the full authored transform would apply the +90deg rotation twice.
  const replacementLocalMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(),
    USD_ISAAC_COLLADA_VISUAL_QUATERNION,
    new THREE.Vector3(1, 1, 1),
  );
  bakeObjectLocalTransformIntoMeshGeometry(object, replacementLocalMatrix);
  object.position.set(0, 0, 0);
  object.quaternion.copy(USD_ISAAC_COLLADA_VISUAL_QUATERNION);
  object.scale.set(1, 1, 1);
  object.updateMatrix();
};

const loadUsdColladaSceneInProcess = async (
  assetUrl: string,
  registry: UsdAssetRegistry,
): Promise<THREE.Object3D> => {
  ensureWorkerXmlDomApis();
  const response = await fetch(assetUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch Collada asset: ${response.status} ${response.statusText}`);
  }

  const colladaText = await response.text();
  const serializedScene = parseColladaSceneData(colladaText, assetUrl);
  return createSceneFromSerializedColladaData(serializedScene, {
    manager: getUsdTextureLoadingManager(registry),
  });
};

const loadUsdColladaScene = async (
  assetUrl: string,
  registry: UsdAssetRegistry,
): Promise<THREE.Object3D> => {
  if (typeof Worker === 'undefined') {
    return loadUsdColladaSceneInProcess(assetUrl, registry);
  }

  try {
    return await loadColladaScene(assetUrl, getUsdTextureLoadingManager(registry));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/collada parse worker is (?:unavailable|not available)/i.test(message)) {
      throw error;
    }

    console.warn(`[USD export] ${message}; parsing Collada asset in-process.`);
    return loadUsdColladaSceneInProcess(assetUrl, registry);
  }
};

const loadUsdMeshObject = async (
  visual: UrdfVisual,
  registry: UsdAssetRegistry,
  options: {
    colorOverride?: string;
    meshCompression?: UsdMeshCompressionOptions;
    colladaRootNormalizationHints?: ColladaRootNormalizationHints | null;
    skipMaterialProcessing?: boolean;
  } = {},
): Promise<THREE.Object3D | null> => {
  const {
    colorOverride,
    meshCompression,
    colladaRootNormalizationHints,
    skipMaterialProcessing = false,
  } = options;
  const meshPath = String(visual.meshPath || '').trim();
  if (!meshPath) {
    return null;
  }

  const resolvedUrl = resolveUsdAssetUrl(meshPath, registry);
  if (!resolvedUrl) {
    console.error(`[USD export] Mesh asset not found for: ${meshPath}`);
    return null;
  }

  const lowerPath = meshPath.toLowerCase();

  if (lowerPath.endsWith('.stl')) {
    const geometry = await buildCachedUsdStlGeometry(resolvedUrl, registry, meshCompression);
    return new THREE.Mesh(geometry, createUsdBaseMaterial(colorOverride || visual.color));
  }

  if (lowerPath.endsWith('.msh')) {
    const response = await fetch(resolvedUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch MSH asset: ${response.status} ${response.statusText}`);
    }
    const geometry = createGeometryFromSerializedMshData(
      parseMshGeometryData(await response.arrayBuffer()),
    );
    return new THREE.Mesh(geometry, createUsdBaseMaterial(colorOverride || visual.color));
  }

  if (lowerPath.endsWith('.obj')) {
    const serializedObject = await loadSerializedObjModelData(resolvedUrl);
    const object = createObjectFromSerializedObjData(serializedObject);
    if (!skipMaterialProcessing) {
      normalizeUsdRenderableMaterials(object, colorOverride || visual.color);
    }
    if (!skipMaterialProcessing && hasGeometryMeshMaterialGroups(visual)) {
      applyVisualMeshMaterialGroupsToObject(object, visual, {
        manager: getUsdTextureLoadingManager(registry),
      });
    }
    return object;
  }

  if (lowerPath.endsWith('.dae')) {
    let object = await loadUsdColladaScene(resolvedUrl, registry);
    if (shouldNormalizeColladaRoot(meshPath, colladaRootNormalizationHints)) {
      object.rotation.set(0, 0, 0);
      object.updateMatrix();
    }
    object = collapseTrivialColladaMeshWrapperChain(object);
    normalizeIsaacCompatibleColladaMeshTransform(object);
    if (!skipMaterialProcessing) {
      normalizeUsdRenderableMaterials(object, colorOverride || visual.color);
    }
    if (!skipMaterialProcessing && hasGeometryMeshMaterialGroups(visual)) {
      applyVisualMeshMaterialGroupsToObject(object, visual, {
        manager: getUsdTextureLoadingManager(registry),
      });
    }
    return object;
  }

  if (lowerPath.endsWith('.gltf') || lowerPath.endsWith('.glb')) {
    const object = cloneUsdGltfSceneAsset(await loadUsdGltfSceneAsset(resolvedUrl, registry));
    if (!skipMaterialProcessing) {
      normalizeUsdRenderableMaterials(object, colorOverride || visual.color);
    }
    if (!skipMaterialProcessing && hasGeometryMeshMaterialGroups(visual)) {
      applyVisualMeshMaterialGroupsToObject(object, visual, {
        manager: getUsdTextureLoadingManager(registry),
      });
    }
    return object;
  }

  console.error(`[USD export] Unsupported mesh format for: ${meshPath}`);
  return null;
};

export const buildUsdVisualSceneNode = async ({
  visual,
  role,
  registry,
  materialState,
  meshCompression,
  colladaRootNormalizationHints,
}: BuildUsdVisualSceneNodeOptions): Promise<THREE.Object3D | null> => {
  const type = getUsdGeometryType(visual.type);
  if (type === USD_GEOMETRY_TYPES.NONE) {
    return null;
  }

  const isCollisionRole = role === 'collision';

  if (type !== USD_GEOMETRY_TYPES.MESH) {
    return createUsdPrimitiveSceneNode(visual, role, materialState);
  }

  const object = await loadUsdMeshObject(visual, registry, {
    colorOverride:
      !isCollisionRole && materialState?.forceUniformOverride ? materialState.color : undefined,
    meshCompression,
    colladaRootNormalizationHints,
    skipMaterialProcessing: isCollisionRole,
  });
  if (!object) {
    return null;
  }

  const meshPathLower = String(visual.meshPath || '')
    .trim()
    .toLowerCase();

  let shouldPreserveEmbeddedMaterials = false;
  let hasPlaceholderWhiteOnly = false;

  if (!isCollisionRole && !materialState?.forceUniformOverride) {
    const authoredMaterials = getGeometryAuthoredMaterials(visual);
    if (authoredMaterials.length > 0) {
      applyUsdAuthoredMaterialPalette(object, authoredMaterials);
    }
  }

  if (!isCollisionRole) {
    const loadedMaterialProfile = analyzeLoadedUsdObjectMaterials(object);
    const canPreserveEmbeddedMaterials =
      loadedUsdObjectShouldPreserveEmbeddedMaterials(loadedMaterialProfile);
    shouldPreserveEmbeddedMaterials =
      materialState?.preserveEmbeddedMaterials === true ||
      (usdMaterialOverrideLooksLikePlaceholder(materialState) && canPreserveEmbeddedMaterials) ||
      (!materialState?.forceUniformOverride && canPreserveEmbeddedMaterials);
    hasPlaceholderWhiteOnly = loadedMaterialProfile.hasPlaceholderWhiteOnly;

    if (!shouldPreserveEmbeddedMaterials && materialState?.forceUniformOverride) {
      applyUniformMaterialOverride(
        object,
        materialState.color || visual.color || (materialState.texture ? '#ffffff' : undefined),
      );
    }
  }

  if (
    !meshPathLower.endsWith('.stl') &&
    meshCompression?.enabled &&
    meshCompression.quality < 100 &&
    !shouldPreserveEmbeddedMaterials
  ) {
    applyUsdMeshCompression(object, meshCompression.quality);
  }

  const anchor = new THREE.Group();
  anchor.name = role;
  applyUsdVisualOrigin(anchor, visual);
  anchor.scale.copy(getUsdVisualScale(visual));
  if (role === 'collision') {
    anchor.userData.usdPurpose = 'guide';
    anchor.userData.usdCollision = true;
    anchor.userData.usdMeshCollision = true;
    object.traverse((child) => {
      child.userData.usdPurpose = 'guide';
      child.userData.usdCollision = true;
      child.userData.usdMeshCollision = isUsdMeshObject(child);
    });
  }

  if (!isCollisionRole && !shouldPreserveEmbeddedMaterials) {
    const isaacFallbackDisplayColor = hasPlaceholderWhiteOnly
      ? USD_ISAAC_NEUTRAL_FALLBACK_COLOR
      : undefined;
    applyExplicitMeshDisplayColor(
      object,
      materialState?.suppressVisualColor
        ? isaacFallbackDisplayColor
        : materialState?.color || isaacFallbackDisplayColor,
    );
  }
  if (
    !isCollisionRole &&
    shouldPreserveEmbeddedMaterials &&
    (materialState?.color || materialState?.texture)
  ) {
    anchor.userData.usdPreserveEmbeddedMaterialAppearance = true;
  }
  anchor.add(object);
  return anchor;
};
