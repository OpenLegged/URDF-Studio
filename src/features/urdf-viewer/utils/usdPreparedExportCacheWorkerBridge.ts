import type { UsdSceneSnapshot } from '@/types';
import type { ViewerRobotDataResolution } from '@/lib/robot-parser/usd/viewerRobotData';
import type { PreparedUsdExportCacheResult } from './usdExportBundle.ts';
import { hydratePreparedUsdExportCacheFromWorker } from './usdPreparedExportCacheWorkerTransfer.ts';
import type {
  PrepareUsdPreparedExportCacheWorkerRequest,
  UsdPreparedExportCacheWorkerResponse,
} from './usdPreparedExportCacheWorker.ts';
import { createWorkerPoolClient, type WorkerLike } from '@/core/workers/workerPoolClient';

interface CreateUsdPreparedExportCacheWorkerClientOptions {
  canUseWorker?: () => boolean;
  createWorker?: () => WorkerLike;
}

interface UsdPreparedExportCacheWorkerClient {
  dispose: (rejectPendingWith?: unknown) => void;
  prepare: (
    snapshot: UsdSceneSnapshot,
    resolution: ViewerRobotDataResolution,
  ) => Promise<PreparedUsdExportCacheResult | null>;
}

const DEFAULT_USD_PREPARED_EXPORT_CACHE_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

export function createUsdPreparedExportCacheWorkerClient({
  canUseWorker = () => typeof Worker !== 'undefined',
  createWorker = () =>
    new Worker(new URL('../workers/usdPreparedExportCache.worker.ts', import.meta.url), {
      type: 'module',
    }),
}: CreateUsdPreparedExportCacheWorkerClientOptions = {}): UsdPreparedExportCacheWorkerClient {
  const client = createWorkerPoolClient<
    UsdPreparedExportCacheWorkerResponse,
    PreparedUsdExportCacheResult | null
  >({
    label: 'USD prepared export cache',
    createWorker,
    canUseWorker,
    requestTimeoutMs: DEFAULT_USD_PREPARED_EXPORT_CACHE_REQUEST_TIMEOUT_MS,
    getRequestId: (response) => response.requestId,
    isError: (response) => response.type === 'prepare-usd-prepared-export-cache-error',
    getError: (response) =>
      (response as { error?: string }).error || 'USD prepared export cache worker failed',
    getResult: (response) => {
      const result = (response as { result?: unknown }).result;
      return result ? hydratePreparedUsdExportCacheFromWorker(result as any) : null;
    },
  });

  const prepare = async (
    snapshot: UsdSceneSnapshot,
    resolution: ViewerRobotDataResolution,
  ): Promise<PreparedUsdExportCacheResult | null> => {
    return client.dispatch({
      type: 'prepare-usd-prepared-export-cache',
      snapshot,
      resolution,
    } as PrepareUsdPreparedExportCacheWorkerRequest);
  };

  return {
    dispose: (rejectPendingWith) => client.dispose(rejectPendingWith),
    prepare,
  };
}

const sharedUsdPreparedExportCacheWorkerClient = createUsdPreparedExportCacheWorkerClient();

export function prepareUsdPreparedExportCacheWithWorker(
  snapshot: UsdSceneSnapshot,
  resolution: ViewerRobotDataResolution,
): Promise<PreparedUsdExportCacheResult | null> {
  return sharedUsdPreparedExportCacheWorkerClient.prepare(snapshot, resolution);
}

export function disposeUsdPreparedExportCacheWorker(rejectPendingWith?: unknown): void {
  sharedUsdPreparedExportCacheWorkerClient.dispose(rejectPendingWith);
}
