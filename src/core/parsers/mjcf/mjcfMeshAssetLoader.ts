import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { loadColladaScene } from '@/core/loaders/colladaParseWorkerBridge';
import { postProcessColladaScene } from '@/core/loaders';
import { registerManagedTextureHandlers } from '@/core/loaders/textureLoaderHandlers';
import {
  createObjectFromSerializedObjData,
  loadSerializedObjModelData,
} from '@/core/loaders/objParseWorkerBridge';
import { createGeometryFromSerializedMshData } from '@/core/loaders/mshGeometryData';
import { loadSerializedMshGeometryData } from '@/core/loaders/mshParseWorkerBridge';
import { createGeometryFromSerializedStlData } from '@/core/loaders/stlGeometryData';
import { loadSerializedStlGeometryData } from '@/core/loaders/stlParseWorkerBridge';
import { prepareMeshSurfaceForSingleSidedRendering } from '@/core/loaders';
import { createMatteMaterial } from '@/core/utils/materialFactory';
import {
  disposeTransientObject3D,
  isMJCFLoadAbortedError,
  type MJCFLoadAbortSignal,
  throwIfMJCFLoadAborted,
} from './mjcfLoadLifecycle';

type CachedMJCFMeshAsset = {
  createInstance: () => THREE.Object3D;
  disposeSource: () => void;
};

export type MJCFMeshCache = Map<string, CachedMJCFMeshAsset>;

const pendingMJCFMeshAssetLoads = new WeakMap<
  MJCFMeshCache,
  Map<string, Promise<CachedMJCFMeshAsset | null>>
>();

function createMJCFMeshLoadError(filePath: string, message: string, cause?: unknown): Error {
  return new Error(
    `[MJCFLoader] ${message}: ${filePath}`,
    cause === undefined ? undefined : { cause },
  );
}

export function finalizeLoadedMJCFColladaScene(scene: THREE.Object3D): THREE.Object3D {
  postProcessColladaScene(scene);
  return scene;
}

function createDefaultMaterial(): THREE.MeshStandardMaterial {
  return createMatteMaterial({
    color: 0x888888,
    name: 'mjcf_default',
  });
}

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

const cloneMaterialsInObject = <TObject extends THREE.Object3D>(root: TObject): TObject => {
  root.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) {
      return;
    }

    const mesh = child as THREE.Mesh;
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((material) => cloneMaterialInstance(material));
      return;
    }

    if (mesh.material) {
      mesh.material = cloneMaterialInstance(mesh.material);
    }
  });

  return root;
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

const cloneObject3DForReuse = (
  source: THREE.Object3D,
  options: { preserveSkeletons?: boolean } = {},
): THREE.Object3D => {
  const clonedRoot = options.preserveSkeletons ? cloneSkeleton(source) : source.clone(true);

  return cloneMaterialsInObject(clonedRoot);
};

const getPendingMeshAssetLoads = (
  meshCache: MJCFMeshCache,
): Map<string, Promise<CachedMJCFMeshAsset | null>> => {
  const cached = pendingMJCFMeshAssetLoads.get(meshCache);
  if (cached) {
    return cached;
  }

  const nextPendingLoads = new Map<string, Promise<CachedMJCFMeshAsset | null>>();
  pendingMJCFMeshAssetLoads.set(meshCache, nextPendingLoads);
  return nextPendingLoads;
};

const getMeshCacheKey = (assetUrl: string, filePath: string): string => {
  const extension = filePath.split('.').pop()?.toLowerCase() || '';
  return `${extension}:${assetUrl}`;
};

const loadCachedMJCFMeshAsset = async (
  assetUrl: string,
  filePath: string,
  abortSignal?: MJCFLoadAbortSignal,
): Promise<CachedMJCFMeshAsset | null> => {
  const extension = filePath.split('.').pop()?.toLowerCase() || '';

  try {
    throwIfMJCFLoadAborted(abortSignal);

    if (extension === 'stl') {
      const serializedGeometry = await loadSerializedStlGeometryData(assetUrl);
      const geometry = createGeometryFromSerializedStlData(serializedGeometry);
      if (abortSignal?.aborted) {
        geometry.dispose();
        throwIfMJCFLoadAborted(abortSignal);
      }
      return {
        createInstance: () => new THREE.Mesh(geometry, createDefaultMaterial()),
        disposeSource: () => geometry.dispose(),
      };
    }

    if (extension === 'msh') {
      const serializedGeometry = await loadSerializedMshGeometryData(assetUrl);
      const geometry = createGeometryFromSerializedMshData(serializedGeometry);
      if (abortSignal?.aborted) {
        geometry.dispose();
        throwIfMJCFLoadAborted(abortSignal);
      }
      return {
        createInstance: () => new THREE.Mesh(geometry, createDefaultMaterial()),
        disposeSource: () => geometry.dispose(),
      };
    }

    if (extension === 'dae') {
      const scene = finalizeLoadedMJCFColladaScene(
        await loadColladaScene(assetUrl, registerManagedTextureHandlers(new THREE.LoadingManager())),
      );
      if (abortSignal?.aborted) {
        disposeTransientObject3D(scene);
        throwIfMJCFLoadAborted(abortSignal);
      }
      return {
        createInstance: () => cloneObject3DForReuse(scene),
        disposeSource: () => disposeTransientObject3D(scene),
      };
    }

    if (extension === 'obj') {
      const serializedObject = await loadSerializedObjModelData(assetUrl);
      const object = createObjectFromSerializedObjData(serializedObject);
      prepareMeshSurfaceForSingleSidedRendering(object);
      if (abortSignal?.aborted) {
        disposeTransientObject3D(object);
        throwIfMJCFLoadAborted(abortSignal);
      }
      return {
        createInstance: () => cloneObject3DForReuse(object),
        disposeSource: () => disposeTransientObject3D(object),
      };
    }

    if (extension === 'gltf' || extension === 'glb') {
      const loader = new GLTFLoader();
      const result = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) => {
        loader.load(assetUrl, resolve, undefined, reject);
      });
      if (abortSignal?.aborted) {
        disposeTransientObject3D(result.scene);
        throwIfMJCFLoadAborted(abortSignal);
      }
      const preserveSkeletons = objectHasSkinnedMeshes(result.scene);
      return {
        createInstance: () => cloneObject3DForReuse(result.scene, { preserveSkeletons }),
        disposeSource: () => disposeTransientObject3D(result.scene),
      };
    }

    console.warn(`[MJCFLoader] Unsupported mesh format "${extension}" for "${filePath}". Skipping.`);
    return null;
  } catch (error) {
    if (isMJCFLoadAbortedError(error)) {
      throw error;
    }
    if (error instanceof Error && error.message.startsWith('[MJCFLoader]')) {
      throw error;
    }

    throw createMJCFMeshLoadError(filePath, 'Failed to load mesh', error);
  }
};

export async function loadMJCFMeshObject(
  assetUrl: string,
  filePath: string,
  meshCache: MJCFMeshCache,
  abortSignal?: MJCFLoadAbortSignal,
): Promise<THREE.Object3D | null> {
  throwIfMJCFLoadAborted(abortSignal);
  const cacheKey = getMeshCacheKey(assetUrl, filePath);
  const cachedAsset = meshCache.get(cacheKey);
  if (cachedAsset) {
    const cachedInstance = cachedAsset.createInstance();
    if (abortSignal?.aborted) {
      disposeTransientObject3D(cachedInstance);
      throwIfMJCFLoadAborted(abortSignal);
    }
    return cachedInstance;
  }

  const pendingLoads = getPendingMeshAssetLoads(meshCache);
  const pendingLoad = pendingLoads.get(cacheKey);
  if (pendingLoad) {
    const resolvedAsset = await pendingLoad;
    if (!resolvedAsset) {
      return null;
    }

    if (abortSignal?.aborted) {
      throwIfMJCFLoadAborted(abortSignal);
    }

    return resolvedAsset.createInstance();
  }

  const nextPendingLoad = loadCachedMJCFMeshAsset(assetUrl, filePath, abortSignal);
  pendingLoads.set(cacheKey, nextPendingLoad);

  try {
    const resolvedAsset = await nextPendingLoad;
    if (resolvedAsset) {
      if (abortSignal?.aborted) {
        resolvedAsset.disposeSource();
        throwIfMJCFLoadAborted(abortSignal);
      }
      meshCache.set(cacheKey, resolvedAsset);
      return resolvedAsset.createInstance();
    }

    return null;
  } finally {
    pendingLoads.delete(cacheKey);
  }
}

export function disposeMJCFMeshCache(meshCache: MJCFMeshCache): void {
  for (const cachedAsset of meshCache.values()) {
    cachedAsset.disposeSource();
  }

  meshCache.clear();
}
