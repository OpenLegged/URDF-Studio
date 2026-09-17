import * as THREE from 'three';

import type { SerializedColladaSceneData } from './colladaWorkerSceneData';
import {
  createDefaultMeshParseWorker,
  createMeshParseWorkerPoolClient,
  resolveDefaultMeshParseWorkerCount,
  sharedMeshParseWorkerPoolClient,
  type MeshParseWorkerPoolClient,
  type MeshParseWorkerPoolDiagnostics,
} from './meshParseWorkerBridge';
import { type WorkerLike } from '@/core/workers/workerPoolClient';

interface CreateColladaParseWorkerPoolClientOptions {
  cacheLimit?: number;
  canUseWorker?: () => boolean;
  createWorker?: () => WorkerLike;
  getWorkerCount?: () => number;
  meshClient?: MeshParseWorkerPoolClient;
}

interface ColladaParseWorkerPoolClient {
  clearCache: () => void;
  dispose: (rejectPendingWith?: unknown) => void;
  getDiagnostics: () => MeshParseWorkerPoolDiagnostics;
  load: (assetUrl: string, manager: THREE.LoadingManager) => Promise<THREE.Object3D>;
  loadSerialized: (assetUrl: string) => Promise<SerializedColladaSceneData>;
}

const DEFAULT_CACHE_LIMIT = 300;
const FAILURE_CACHE_LIMIT = 200;

export function createColladaParseWorkerPoolClient({
  cacheLimit = DEFAULT_CACHE_LIMIT,
  canUseWorker = () => typeof Worker !== 'undefined',
  createWorker = createDefaultMeshParseWorker,
  getWorkerCount = resolveDefaultMeshParseWorkerCount,
  meshClient = createMeshParseWorkerPoolClient({
    label: 'Collada parse',
    canUseWorker,
    createWorker,
    getWorkerCount,
  }),
}: CreateColladaParseWorkerPoolClientOptions = {}): ColladaParseWorkerPoolClient {
  const pendingLoads = new Map<string, Promise<SerializedColladaSceneData>>();
  const failureCache = new Map<string, unknown>();
  const resolvedCache = cacheLimit > 0 ? new Map<string, SerializedColladaSceneData>() : null;

  const getCached = (assetUrl: string): SerializedColladaSceneData | undefined => {
    return resolvedCache?.get(assetUrl);
  };

  const setCached = (assetUrl: string, result: SerializedColladaSceneData): void => {
    if (!resolvedCache) return;

    if (resolvedCache.has(assetUrl)) {
      resolvedCache.delete(assetUrl);
    }
    resolvedCache.set(assetUrl, result);

    while (resolvedCache.size > cacheLimit) {
      const oldestKey = resolvedCache.keys().next().value;
      if (oldestKey === undefined) return;
      resolvedCache.delete(oldestKey);
    }
  };

  const rememberFailure = (assetUrl: string, error: unknown): void => {
    if (failureCache.size >= FAILURE_CACHE_LIMIT) {
      const oldestKey = failureCache.keys().next().value;
      if (oldestKey !== undefined) failureCache.delete(oldestKey);
    }
    failureCache.set(assetUrl, error);
  };

  const loadSerialized = async (assetUrl: string): Promise<SerializedColladaSceneData> => {
    const cachedResult = getCached(assetUrl);
    if (cachedResult) {
      return cachedResult;
    }

    if (failureCache.has(assetUrl)) {
      throw failureCache.get(assetUrl);
    }

    const pendingLoad = pendingLoads.get(assetUrl);
    if (pendingLoad) {
      return await pendingLoad;
    }

    const nextLoad = meshClient
      .dispatchCollada(assetUrl)
      .then((workerResult) => {
        setCached(assetUrl, workerResult);
        return workerResult;
      })
      .catch((error) => {
        rememberFailure(assetUrl, error);
        throw error;
      })
      .finally(() => {
        pendingLoads.delete(assetUrl);
      });

    pendingLoads.set(assetUrl, nextLoad);
    return await nextLoad;
  };

  const load = async (assetUrl: string, manager: THREE.LoadingManager): Promise<THREE.Object3D> => {
    const serializedScene = await loadSerialized(assetUrl);
    const { createSceneFromSerializedColladaData } = await import('./colladaWorkerSceneData');
    return createSceneFromSerializedColladaData(serializedScene, { manager });
  };

  return {
    clearCache: () => {
      resolvedCache?.clear();
      failureCache.clear();
    },
    dispose: (rejectPendingWith) => meshClient.dispose(rejectPendingWith),
    getDiagnostics: () => meshClient.getDiagnostics(),
    load,
    loadSerialized,
  };
}

const sharedColladaParseWorkerPoolClient = createColladaParseWorkerPoolClient({
  meshClient: sharedMeshParseWorkerPoolClient,
});

export async function loadColladaScene(
  assetUrl: string,
  manager: THREE.LoadingManager,
): Promise<THREE.Object3D> {
  return await sharedColladaParseWorkerPoolClient.load(assetUrl, manager);
}

export async function loadSerializedColladaSceneData(
  assetUrl: string,
): Promise<SerializedColladaSceneData> {
  return await sharedColladaParseWorkerPoolClient.loadSerialized(assetUrl);
}

export function clearColladaParseWorkerPoolClientCache(): void {
  sharedColladaParseWorkerPoolClient.clearCache();
}

export function disposeColladaParseWorkerPoolClient(rejectPendingWith?: unknown): void {
  sharedColladaParseWorkerPoolClient.dispose(rejectPendingWith);
}

// The worker serializer now supports every Collada source accepted by the
// fallback parser. Keep this synchronous capability probe lightweight so
// importing the worker bridge does not also evaluate ColladaLoader.
export function canSerializeColladaInWorker(_content: string): boolean {
  return true;
}
