import type { SerializedStlGeometryData } from './stlGeometryData';
import type { ParseStlWorkerRequest, StlParseWorkerResponse } from './stlParseWorkerProtocol';
import {
  createWorkerPoolClient,
  resolveDefaultWorkerCount,
  type WorkerLike,
} from '@/core/workers/workerPoolClient';

interface CreateStlParseWorkerPoolClientOptions {
  canUseWorker?: () => boolean;
  cacheLimit?: number;
  createWorker?: () => WorkerLike;
  getWorkerCount?: () => number;
}

interface StlParseWorkerPoolClient {
  clearCache: () => void;
  dispose: (rejectPendingWith?: unknown) => void;
  load: (assetUrl: string) => Promise<SerializedStlGeometryData>;
}

const DEFAULT_CACHE_LIMIT = 300;
const FAILURE_CACHE_LIMIT = 200;
const DEFAULT_STL_PARSE_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

async function loadSerializedStlGeometryDataInline(
  assetUrl: string,
): Promise<SerializedStlGeometryData> {
  const response = await fetch(assetUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch STL asset: ${response.status} ${response.statusText}`);
  }

  const { parseStlGeometryData } = await import('./stlGeometryData');
  return parseStlGeometryData(await response.arrayBuffer());
}

function cloneSerializedStlGeometryData(
  result: SerializedStlGeometryData,
): SerializedStlGeometryData {
  return {
    positions: result.positions.slice(0),
    normals: result.normals.slice(0),
    maxDimension: result.maxDimension,
  };
}

export function createStlParseWorkerPoolClient({
  canUseWorker = () => typeof Worker !== 'undefined',
  cacheLimit = DEFAULT_CACHE_LIMIT,
  createWorker = () =>
    new Worker(new URL('./workers/stlParse.worker.ts', import.meta.url), { type: 'module' }),
  getWorkerCount = resolveDefaultWorkerCount,
}: CreateStlParseWorkerPoolClientOptions = {}): StlParseWorkerPoolClient {
  const client = createWorkerPoolClient<StlParseWorkerResponse, SerializedStlGeometryData>({
    label: 'STL parse',
    createWorker,
    canUseWorker,
    poolSize: getWorkerCount,
    cacheLimit,
    requestTimeoutMs: DEFAULT_STL_PARSE_REQUEST_TIMEOUT_MS,
    getRequestId: (response) => response.requestId,
    isError: (response) => response.type === 'parse-stl-error',
    getError: (response) => (response as { error?: string }).error || 'STL parse worker failed',
    getResult: (response) => (response as { result: SerializedStlGeometryData }).result,
  });

  const pendingLoads = new Map<string, Promise<SerializedStlGeometryData>>();
  const failureCache = new Map<string, unknown>();

  const rememberFailure = (assetUrl: string, error: unknown): void => {
    if (failureCache.size >= FAILURE_CACHE_LIMIT) {
      const oldestKey = failureCache.keys().next().value;
      if (oldestKey !== undefined) failureCache.delete(oldestKey);
    }
    failureCache.set(assetUrl, error);
  };

  const load = async (assetUrl: string): Promise<SerializedStlGeometryData> => {
    const cachedResult = client.getCached(assetUrl);
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

    const nextLoad = (
      client.canUseWorker
        ? client.dispatch({ type: 'parse-stl', assetUrl })
        : loadSerializedStlGeometryDataInline(assetUrl)
    )
      .then((result) => {
        client.setCached(assetUrl, result);
        return result;
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

  return {
    clearCache: () => {
      client.clearCache();
      failureCache.clear();
    },
    dispose: (rejectPendingWith) => client.dispose(rejectPendingWith),
    load,
  };
}

const sharedStlParseWorkerPoolClient = createStlParseWorkerPoolClient();

export async function loadSerializedStlGeometryData(
  assetUrl: string,
): Promise<SerializedStlGeometryData> {
  return await sharedStlParseWorkerPoolClient.load(assetUrl);
}

export function clearStlParseWorkerPoolClientCache(): void {
  sharedStlParseWorkerPoolClient.clearCache();
}

export function disposeStlParseWorkerPoolClient(rejectPendingWith?: unknown): void {
  sharedStlParseWorkerPoolClient.dispose(rejectPendingWith);
}

export { cloneSerializedStlGeometryData };
