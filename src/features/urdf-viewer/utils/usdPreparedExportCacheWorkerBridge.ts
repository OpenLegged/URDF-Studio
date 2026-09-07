import type { RobotFile, UsdSceneSnapshot } from '@/types';
import type { UsdOffscreenViewerInitRequest, UsdOffscreenViewerWorkerResponse } from './usdOffscreenViewerProtocol';
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

/** Load an immutable USD file closure through the model editor's full hydration/export-cache path. */
export async function prepareUsdSourceExportCacheWithWorker({
  rootPath,
  files,
  signal,
  timeoutMs = DEFAULT_USD_PREPARED_EXPORT_CACHE_REQUEST_TIMEOUT_MS,
}: {
  rootPath: string;
  files: ReadonlyMap<string, Blob>;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<PreparedUsdExportCacheResult> {
  signal?.throwIfAborted();
  if (!files.has(rootPath)) throw new Error(`USD source entrypoint is missing: ${rootPath}`);
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    throw new Error('USD model export requires Worker and OffscreenCanvas support.');
  }
  const urls: string[] = [];
  let worker: Worker | undefined;
  try {
    const availableFiles: RobotFile[] = [];
    const assets: Record<string, string> = {};
    for (const [name, blob] of files) {
      const blobUrl = URL.createObjectURL(blob);
      urls.push(blobUrl);
      assets[name] = blobUrl;
      availableFiles.push({
        name,
        blobUrl,
        content: /\.usda$/i.test(name) ? await blob.text() : '',
        format: /\.(usd|usda|usdc|usdz)$/i.test(name) ? 'usd' : 'asset',
      });
    }
    signal?.throwIfAborted();
    const sourceFile = availableFiles.find((file) => file.name === rootPath)!;
    worker = new Worker(new URL('../workers/usdOffscreenViewer.worker.ts', import.meta.url), { type: 'module' });
    const sourceWorker = worker;
    const canvas = new OffscreenCanvas(1, 1);
    return await new Promise<PreparedUsdExportCacheResult>((resolve, reject) => {
      let prepared: PreparedUsdExportCacheResult | null = null;
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        sourceWorker.removeEventListener('message', onMessage);
        sourceWorker.removeEventListener('error', onError);
        sourceWorker.removeEventListener('messageerror', onError);
        if (error) reject(error);
        else if (prepared) resolve(prepared);
        else reject(new Error(`USD model export produced no prepared geometry: ${rootPath}`));
      };
      const onAbort = () => finish(signal?.reason ?? new Error('USD model export cancelled.'));
      const onError = (event: Event) => finish(new Error(
        event instanceof ErrorEvent ? event.message : 'USD model export worker response could not be decoded.',
      ));
      const onMessage = (event: MessageEvent<UsdOffscreenViewerWorkerResponse>) => {
        const message = event.data;
        if (message.type === 'fatal-error') finish(new Error(message.error));
        if (message.type === 'prepared-cache') {
          if (!message.preparedCache) finish(new Error(message.error || 'USD model export cache is unavailable.'));
          else {
            try { prepared = hydratePreparedUsdExportCacheFromWorker(message.preparedCache); }
            catch (error) { finish(error); }
          }
        }
        if (message.type === 'document-load' && message.event.status === 'ready') finish();
      };
      const timer = setTimeout(() => finish(new Error(`USD model export timed out: ${rootPath}`)), timeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      sourceWorker.addEventListener('message', onMessage);
      sourceWorker.addEventListener('error', onError);
      sourceWorker.addEventListener('messageerror', onError);
      const request: UsdOffscreenViewerInitRequest = {
        type: 'init', sessionId: 1, projectionMode: 'robot', includeAllAvailableFiles: true,
        canvas, width: 1, height: 1, devicePixelRatio: 1, theme: 'light', active: false,
        groundPlaneOffset: 0, showVisual: true, showCollision: false,
        showCollisionAlwaysOnTop: false, showOrigins: false, showOriginsOverlay: false,
        originSize: 0.08, sourceFile, completionMode: 'complete', forceHydraFullDraw: true,
        stageOpenContext: { availableFiles: availableFiles.filter((file) => file !== sourceFile), assets },
        stageOpenContextCacheHit: false, initialInteractionState: null,
      };
      try { sourceWorker.postMessage(request, [canvas]); }
      catch (error) { finish(error); }
    });
  } finally {
    worker?.terminate();
    urls.forEach((url) => URL.revokeObjectURL(url));
  }
}
