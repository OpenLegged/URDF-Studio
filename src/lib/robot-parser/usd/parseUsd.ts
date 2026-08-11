import type { RobotData, RobotFile, UsdSceneSnapshot } from '@/types';
import type { ViewerRobotDataResolution } from './viewerRobotData';

export interface ParseUsdSceneOptions {
  /** Sibling USD layers and package files available to the root layer. */
  availableFiles?: Array<Pick<RobotFile, 'name' | 'content' | 'blobUrl' | 'format'>>;
  /** Package path to fetchable URL map for binary USD layers and textures. */
  assets?: Record<string, string>;
  /** Fetchable URL for a binary `.usd`/`.usdc` root layer. */
  sourceBlobUrl?: string;
  /** URL of the directory that directly contains `emHdBindings.*`. */
  wasmBaseUrl?: string;
  signal?: AbortSignal;
  onProgress?: (progress: UsdRuntimeLoadProgress) => void;
}

export interface UsdRuntimeLoadProgress {
  phase:
    | 'checking-path'
    | 'preloading-dependencies'
    | 'initializing-renderer'
    | 'streaming-meshes'
    | 'applying-stage-fixes'
    | 'resolving-metadata'
    | 'finalizing-scene'
    | 'ready';
  message?: string | null;
  progressMode?: 'count' | 'percent' | 'indeterminate' | null;
  progressPercent?: number | null;
  loadedCount?: number | null;
  totalCount?: number | null;
}

export interface ParsedUsdScene {
  resolution: ViewerRobotDataResolution;
  snapshot: UsdSceneSnapshot;
}

interface ParseUsdWorkerResponse {
  requestId: number;
  type: 'scene' | 'progress' | 'error';
  resolution?: ViewerRobotDataResolution;
  snapshot?: UsdSceneSnapshot;
  progress?: UsdRuntimeLoadProgress;
  error?: string;
}

interface PendingParseUsdRequest {
  resolve: (scene: ParsedUsdScene) => void;
  reject: (reason?: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
  onProgress?: (progress: UsdRuntimeLoadProgress) => void;
}

interface ParseUsdWorkerRegistration {
  worker: Worker;
  onMessage: (event: MessageEvent<ParseUsdWorkerResponse>) => void;
  onError: (event: ErrorEvent) => void;
  onMessageError: (event: MessageEvent<unknown>) => void;
}

let workerRegistration: ParseUsdWorkerRegistration | null = null;
let nextRequestId = 1;
const pendingRequests = new Map<number, PendingParseUsdRequest>();

function cleanupPendingRequest(requestId: number): PendingParseUsdRequest | undefined {
  const pending = pendingRequests.get(requestId);
  if (!pending) return undefined;
  pendingRequests.delete(requestId);
  if (pending.signal && pending.onAbort) {
    pending.signal.removeEventListener('abort', pending.onAbort);
  }
  return pending;
}

function createAbortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('USD runtime load aborted', 'AbortError');
}

function resetParseUsdWorker(worker: Worker, reason: Error): void {
  const registration = workerRegistration;
  if (!registration || registration.worker !== worker) return;

  workerRegistration = null;
  worker.removeEventListener('message', registration.onMessage);
  worker.removeEventListener('error', registration.onError);
  worker.removeEventListener('messageerror', registration.onMessageError);
  worker.terminate();

  Array.from(pendingRequests.keys()).forEach((requestId) => {
    cleanupPendingRequest(requestId)?.reject(reason);
  });
}

function createWorkerFailureError(event: ErrorEvent | MessageEvent<unknown>): Error {
  const details = event as { error?: unknown; message?: unknown };
  if (details.error instanceof Error) return details.error;
  if (typeof details.message === 'string' && details.message.trim()) {
    return new Error(details.message);
  }
  return new Error(
    event.type === 'messageerror'
      ? 'USD parser worker message deserialization failed'
      : 'USD parser worker failed',
  );
}

function handleParseUsdWorkerMessage(
  worker: Worker,
  event: MessageEvent<ParseUsdWorkerResponse>,
): void {
  if (workerRegistration?.worker !== worker) return;
  const data = event.data;
  const pending = pendingRequests.get(data.requestId);
  if (!pending) return;

  if (data.type === 'progress') {
    if (!data.progress || !pending.onProgress) return;
    try {
      pending.onProgress(data.progress);
    } catch (error) {
      cleanupPendingRequest(data.requestId)?.reject(error);
      try {
        worker.postMessage({ type: 'cancel', requestId: data.requestId });
      } catch (workerError) {
        resetParseUsdWorker(
          worker,
          workerError instanceof Error ? workerError : new Error(String(workerError)),
        );
      }
    }
    return;
  }

  cleanupPendingRequest(data.requestId);
  if (data.type === 'error') {
    pending.reject(new Error(data.error ?? 'USD scene parse failed'));
    return;
  }
  if (!data.resolution || !data.snapshot) {
    pending.reject(new Error('USD runtime returned an incomplete scene payload'));
    return;
  }
  pending.resolve({ resolution: data.resolution, snapshot: data.snapshot });
}

function getParseUsdWorker(): Worker {
  if (workerRegistration) return workerRegistration.worker;

  const worker = new Worker(new URL('./parseUsd.worker.ts', import.meta.url), {
    type: 'module',
  });
  const registration: ParseUsdWorkerRegistration = {
    worker,
    onMessage: (event) => handleParseUsdWorkerMessage(worker, event),
    onError: (event) => resetParseUsdWorker(worker, createWorkerFailureError(event)),
    onMessageError: (event) => resetParseUsdWorker(worker, createWorkerFailureError(event)),
  };
  try {
    worker.addEventListener('message', registration.onMessage);
    worker.addEventListener('error', registration.onError);
    worker.addEventListener('messageerror', registration.onMessageError);
  } catch (error) {
    worker.terminate();
    throw error;
  }
  workerRegistration = registration;
  return worker;
}

/**
 * Resolve USD into the complete package-owned baked scene payload. Unlike the
 * old metadata-only path, this keeps the native geometry and transform pools
 * needed to construct an actual Three.js hierarchy on the consumer thread.
 */
export async function parseUsdScene(
  content: string,
  fileName = 'robot.usda',
  options: ParseUsdSceneOptions = {},
): Promise<ParsedUsdScene> {
  if (options.signal?.aborted) {
    throw createAbortError(options.signal);
  }

  const worker = getParseUsdWorker();
  const requestId = nextRequestId++;

  return new Promise<ParsedUsdScene>((resolve, reject) => {
    const onAbort = () => {
      const pending = cleanupPendingRequest(requestId);
      if (!pending) return;
      try {
        worker.postMessage({ type: 'cancel', requestId });
      } catch (error) {
        resetParseUsdWorker(
          worker,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
      reject(createAbortError(options.signal!));
    };
    pendingRequests.set(requestId, {
      resolve,
      reject,
      signal: options.signal,
      onAbort,
      onProgress: options.onProgress,
    });
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    try {
      worker.postMessage({
        type: 'parse-scene',
        requestId,
        content,
        fileName,
        availableFiles: options.availableFiles ?? [],
        assets: options.assets ?? {},
        sourceBlobUrl: options.sourceBlobUrl,
        wasmBaseUrl: options.wasmBaseUrl,
      });
    } catch (error) {
      resetParseUsdWorker(
        worker,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  });
}

/** Metadata projection for callers that do not need a visible runtime. */
export async function parseUsd(
  content: string,
  fileName = 'robot.usda',
  options: ParseUsdSceneOptions = {},
): Promise<RobotData> {
  return (await parseUsdScene(content, fileName, options)).resolution.robotData;
}

/** Terminate the singleton USD worker and release its WASM/renderer state. */
export function disposeParseUsdWorker(): void {
  if (!workerRegistration) return;
  resetParseUsdWorker(workerRegistration.worker, new Error('USD parser worker disposed'));
}
