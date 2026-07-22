import type {
  ExportArchiveAssetsWorkerPayload,
  ExportArchiveAssetsWorkerResponse,
  PrepareExportArchiveAssetsArgs,
  PrepareExportArchiveAssetsResult,
  PrepareExportArchiveAssetsWorkerRequest,
  PrepareExportArchiveAssetsProgress,
} from './exportArchiveAssetsContract.ts';

interface WorkerLike {
  addEventListener: Worker['addEventListener'];
  removeEventListener: Worker['removeEventListener'];
  postMessage: Worker['postMessage'];
  terminate: Worker['terminate'];
}

interface PendingWorkerRequest {
  resolve: (value: PrepareExportArchiveAssetsResult) => void;
  reject: (error: unknown) => void;
  onProgress?: (progress: PrepareExportArchiveAssetsProgress) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
}

interface CreateExportArchiveAssetsWorkerClientOptions {
  canUseWorker?: () => boolean;
  createWorker?: () => WorkerLike;
  requestTimeoutMs?: number;
}

export interface ExportArchiveAssetsWorkerClient {
  dispose: (rejectPendingWith?: unknown) => void;
  prepare: (args: PrepareExportArchiveAssetsArgs) => Promise<PrepareExportArchiveAssetsResult>;
}

function createWorkerError(event: ErrorEvent | { error?: unknown; message?: string }): Error {
  if (event.error instanceof Error) {
    return event.error;
  }

  return new Error(event.message || 'Export archive assets worker failed');
}

const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

function createWorkerTimeoutError(requestId: number, timeoutMs: number): Error {
  return new Error(
    'Export archive assets worker did not respond within the timeout '
      + `(likely a worker crash). Request id: ${requestId}. Timeout: ${timeoutMs} ms.`,
  );
}

function serializePrepareExportArchiveAssetsArgsForWorker(
  args: PrepareExportArchiveAssetsArgs,
): ExportArchiveAssetsWorkerPayload {
  return {
    robot: args.robot,
    assets: args.assets,
    compressOptions: args.compressOptions,
    extraMeshFiles: Array.from(args.extraMeshFiles?.entries() ?? []).map(([path, blob]) => ({
      path,
      blob,
    })),
    skipMeshPaths: Array.from(args.skipMeshPaths ?? []),
  };
}

export function createExportArchiveAssetsWorkerClient(
  {
    canUseWorker = () => typeof Worker !== 'undefined',
    createWorker = () => new Worker(
      new URL('../workers/exportArchiveAssets.worker.ts', import.meta.url),
      { type: 'module' },
    ),
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  }: CreateExportArchiveAssetsWorkerClientOptions = {},
): ExportArchiveAssetsWorkerClient {
  const pendingRequests = new Map<number, PendingWorkerRequest>();
  let requestIdCounter = 0;
  let sharedWorker: WorkerLike | null = null;
  let workerUnavailable = false;

  const clearPendingRequest = (requestId: number): PendingWorkerRequest | null => {
    const pendingRequest = pendingRequests.get(requestId) ?? null;
    if (!pendingRequest) {
      return null;
    }

    pendingRequests.delete(requestId);
    if (pendingRequest.timeoutId !== undefined) {
      clearTimeout(pendingRequest.timeoutId);
      pendingRequest.timeoutId = undefined;
    }
    return pendingRequest;
  };

  const disposeSharedWorker = (rejectPendingWith?: unknown): void => {
    const rejectionReason = rejectPendingWith ?? new Error('Export archive assets worker disposed');

    if (sharedWorker) {
      sharedWorker.removeEventListener('message', handleSharedWorkerMessage as EventListener);
      sharedWorker.removeEventListener('error', handleSharedWorkerError as EventListener);
      sharedWorker.removeEventListener('messageerror', handleSharedWorkerMessageError as EventListener);
      sharedWorker.terminate();
      sharedWorker = null;
    }

    if (pendingRequests.size > 0) {
      Array.from(pendingRequests.entries()).forEach(([requestId, request]) => {
        clearPendingRequest(requestId);
        request.reject(rejectionReason);
      });
    }
  };

  const registerRequestTimeout = (requestId: number, request: PendingWorkerRequest): void => {
    if (!requestTimeoutMs || !Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
      return;
    }

    request.timeoutId = setTimeout(() => {
      const timeoutError = createWorkerTimeoutError(requestId, requestTimeoutMs);
      disposeSharedWorker(timeoutError);
    }, requestTimeoutMs);
  };

  const handleSharedWorkerMessage = (
    event: MessageEvent<ExportArchiveAssetsWorkerResponse>,
  ): void => {
    const message = event.data;
    if (!message) {
      return;
    }

    const pendingRequest = pendingRequests.get(message.requestId) ?? null;
    if (!pendingRequest) {
      return;
    }

    if (message.type === 'prepare-export-archive-assets-progress') {
      pendingRequest.onProgress?.(message.progress);
      return;
    }

    clearPendingRequest(message.requestId);

    if (message.type === 'prepare-export-archive-assets-error') {
      pendingRequest.reject(new Error(message.error || 'Export archive assets worker failed'));
      return;
    }

    pendingRequest.resolve(message.result);
  };

  const handleSharedWorkerError = (event: ErrorEvent): void => {
    workerUnavailable = true;
    disposeSharedWorker(createWorkerError(event));
  };

  const handleSharedWorkerMessageError = (): void => {
    workerUnavailable = true;
    disposeSharedWorker(new Error('Export archive assets worker message transfer failed'));
  };

  const ensureSharedWorker = (): WorkerLike => {
    if (!sharedWorker) {
      workerUnavailable = false;
      sharedWorker = createWorker();
      sharedWorker.addEventListener('message', handleSharedWorkerMessage as EventListener);
      sharedWorker.addEventListener('error', handleSharedWorkerError as EventListener);
      sharedWorker.addEventListener('messageerror', handleSharedWorkerMessageError as EventListener);
    }

    return sharedWorker;
  };

  const prepare = async (
    args: PrepareExportArchiveAssetsArgs,
  ): Promise<PrepareExportArchiveAssetsResult> => {
    if (workerUnavailable && sharedWorker) {
      throw new Error('Export archive assets worker is unavailable');
    }

    if (!canUseWorker()) {
      throw new Error('Web Worker is not available in this environment');
    }

    const payload = serializePrepareExportArchiveAssetsArgsForWorker(args);

    return new Promise<PrepareExportArchiveAssetsResult>((resolveRequest, rejectRequest) => {
      const requestId = ++requestIdCounter;
      let worker: WorkerLike;

      try {
        worker = ensureSharedWorker();
      } catch (error) {
        workerUnavailable = true;
        rejectRequest(error);
        return;
      }

      const request: PrepareExportArchiveAssetsWorkerRequest = {
        type: 'prepare-export-archive-assets',
        requestId,
        payload,
      };

      const pendingRequest: PendingWorkerRequest = {
        resolve: resolveRequest,
        reject: rejectRequest,
        onProgress: args.onProgress,
      };
      pendingRequests.set(requestId, pendingRequest);
      registerRequestTimeout(requestId, pendingRequest);

      try {
        worker.postMessage(request);
      } catch (error) {
        workerUnavailable = true;
        clearPendingRequest(requestId);
        disposeSharedWorker(error);
        rejectRequest(error);
      }
    });
  };

  return {
    dispose: disposeSharedWorker,
    prepare,
  };
}

const sharedExportArchiveAssetsWorkerClient = createExportArchiveAssetsWorkerClient();

export function prepareExportArchiveAssetsWithWorker(
  args: PrepareExportArchiveAssetsArgs,
): Promise<PrepareExportArchiveAssetsResult> {
  return sharedExportArchiveAssetsWorkerClient.prepare(args);
}

export function disposeExportArchiveAssetsWorker(rejectPendingWith?: unknown): void {
  sharedExportArchiveAssetsWorkerClient.dispose(rejectPendingWith);
}
