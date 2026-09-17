import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';

import { buildAssetIndex, resolveManagedAssetUrl } from '@/core/loaders';
import { registerManagedTextureHandlers } from '@/core/loaders/textureLoaderHandlers';
import { loadColladaScene } from '@/core/loaders/colladaParseWorkerBridge';
import { loadObjScene } from '@/core/loaders/objMaterialUtils';
import { loadSerializedStlGeometryData } from '@/core/loaders/stlParseWorkerBridge';

export interface ManagedMeshPreloadRequest {
  assetBaseDir?: string;
  assetUrl: string;
  assets: Record<string, string>;
  extension: string;
}

const preloadedMeshAssetPromises = new Map<string, Promise<void>>();
const preloadedMeshRendererModulePromises = new Map<string, Promise<void>>();

function createManagedLoadingManager(
  assets: Record<string, string>,
  assetBaseDir = '',
): THREE.LoadingManager {
  const manager = new THREE.LoadingManager();
  const assetIndex = buildAssetIndex(assets, assetBaseDir);

  manager.setURLModifier((url) => resolveManagedAssetUrl(url, assetIndex, assetBaseDir));
  registerManagedTextureHandlers(manager);

  return manager;
}

function preloadMeshRendererModule(extension: string): Promise<void> {
  const normalizedExtension = extension.toLowerCase();
  const cachedPromise = preloadedMeshRendererModulePromises.get(normalizedExtension);
  if (cachedPromise) {
    return cachedPromise;
  }

  let preloadPromise: Promise<void>;
  if (normalizedExtension === 'stl') {
    preloadPromise = import('./renderers/STLRendererImpl').then(() => undefined);
  } else if (normalizedExtension === 'obj') {
    preloadPromise = import('./renderers/OBJRendererImpl').then(() => undefined);
  } else if (normalizedExtension === 'dae') {
    preloadPromise = import('./renderers/DAERendererImpl').then(() => undefined);
  } else if (normalizedExtension === 'gltf' || normalizedExtension === 'glb') {
    preloadPromise = import('./renderers/GLTFRendererImpl').then(() => undefined);
  } else {
    preloadPromise = Promise.resolve();
  }

  preloadedMeshRendererModulePromises.set(normalizedExtension, preloadPromise);
  return preloadPromise;
}

export async function preloadManagedMeshAsset({
  assetBaseDir = '',
  assetUrl,
  assets,
  extension,
}: ManagedMeshPreloadRequest): Promise<void> {
  const normalizedExtension = extension.toLowerCase();
  const preloadKey = `${normalizedExtension}:${assetUrl}`;
  const cachedPromise = preloadedMeshAssetPromises.get(preloadKey);
  if (cachedPromise) {
    await cachedPromise;
    return;
  }

  const preloadPromise = (async () => {
    await preloadMeshRendererModule(normalizedExtension);

    if (normalizedExtension === 'stl') {
      await loadSerializedStlGeometryData(assetUrl);
      return;
    }

    if (normalizedExtension === 'obj') {
      const manager = createManagedLoadingManager(assets, assetBaseDir);
      await loadObjScene(assetUrl, manager, assetBaseDir);
      return;
    }

    if (normalizedExtension === 'dae') {
      const manager = createManagedLoadingManager(assets, assetBaseDir);
      await loadColladaScene(assetUrl, manager);
      return;
    }

    if (normalizedExtension === 'gltf' || normalizedExtension === 'glb') {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const manager = createManagedLoadingManager(assets, assetBaseDir);
      await Promise.resolve(
        useLoader.preload(GLTFLoader, assetUrl, (loader) => {
          loader.manager = manager;
        }),
      );
    }
  })();

  preloadedMeshAssetPromises.set(preloadKey, preloadPromise);

  try {
    await preloadPromise;
  } catch (error) {
    preloadedMeshAssetPromises.delete(preloadKey);
    throw error;
  }
}
