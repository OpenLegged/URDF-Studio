import type { RobotFile } from '@/types';
import type { PreparedUsdStageOpenData } from '@/lib/robot-parser/usd/usdStageOpenPreparation';
import type {
  PrepareUsdStageOpenWorkerRequest,
  SyncUsdStageOpenWorkerContextRequest,
  UsdStageOpenPreparationWorkerRequest,
  UsdStageOpenPreparationWorkerResponse,
} from './usdStageOpenPreparationWorker.ts';
import { hydratePreparedUsdStageOpenDataFromWorker } from './usdStageOpenPreparationTransfer.ts';
import {
  buildUsdStageOpenPreparationWorkerDispatch,
  type PreparedUsdStageOpenWorkerDispatch,
  type UsdStageOpenPreparationWorkerContextSnapshot,
} from './usdStageOpenPreparationWorkerPayload.ts';

interface WorkerLike {
  addEventListener: (
    type: 'message' | 'error' | 'messageerror',
    listener: EventListenerOrEventListenerObject,
  ) => void;
  removeEventListener: (
    type: 'message' | 'error' | 'messageerror',
    listener: EventListenerOrEventListenerObject,
  ) => void;
  postMessage: (message: UsdStageOpenPreparationWorkerRequest) => void;
  terminate: () => void;
}

interface PendingWorkerRequest {
  resolve: (value: PreparedUsdStageOpenData) => void;
  reject: (error: unknown) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
}

interface CreateUsdStageOpenPreparationWorkerClientOptions {
  canUseWorker?: () => boolean;
  createWorker?: () => WorkerLike;
  requestTimeoutMs?: number;
}

const EMPTY_PREPARED_USD_STAGE_OPEN_DATA: PreparedUsdStageOpenData = {
  stageSourcePath: '',
  criticalDependencyPaths: [],
  preloadFiles: [],
};

interface UsdStageOpenPreparationWorkerClient {
  dispose: (rejectPendingWith?: unknown) => void;
  prepare: (
    sourceFile: Pick<RobotFile, 'name' | 'content' | 'blobUrl'>,
    availableFiles: Array<Pick<RobotFile, 'name' | 'content' | 'blobUrl' | 'format'>>,
    assets: Record<string, string>,
  ) => Promise<PreparedUsdStageOpenData>;
}

function createWorkerError(event: ErrorEvent | { error?: unknown; message?: string }): Error {
  if (event.error instanceof Error) {
    return event.error;
  }

  return new Error(event.message || 'USD stage preparation worker failed');
}

const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

function createWorkerTimeoutError(requestId: number, timeoutMs: number): Error {
  return new Error(
    'USD stage preparation worker did not respond within the timeout '
      + `(likely a worker crash). Request id: ${requestId}. Timeout: ${timeoutMs} ms.`,
  );
}

export function createUsdStageOpenPreparationWorkerClient(
  {
    canUseWorker = () => typeof Worker !== 'undefined',
    createWorker = () => new Worker(
      new URL('../workers/usdStageOpenPreparation.worker.ts', import.meta.url),
      { type: 'module' },
    ),
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  }: CreateUsdStageOpenPreparationWorkerClientOptions = {},
): UsdStageOpenPreparationWorkerClient {
  const pendingRequests = new Map<number, PendingWorkerRequest>();
  const syncedContextIdsByCacheKey = new Map<string, string>();
  let requestIdCounter = 0;
  let contextIdCounter = 0;
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
    const rejectionReason = rejectPendingWith ?? new Error('USD stage preparation worker disposed');

    if (sharedWorker) {
      sharedWorker.removeEventListener('message', handleSharedWorkerMessage as EventListener);
      sharedWorker.removeEventListener('error', handleSharedWorkerError as EventListener);
      sharedWorker.removeEventListener(
        'messageerror',
        handleSharedWorkerMessageError as EventListener,
      );
      sharedWorker.terminate();
      sharedWorker = null;
    }

    syncedContextIdsByCacheKey.clear();

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

  const handleSharedWorkerMessage = (event: MessageEvent<UsdStageOpenPreparationWorkerResponse>): void => {
    const message = event.data;
    if (!message) {
      return;
    }

    const pendingRequest = clearPendingRequest(message.requestId);
    if (!pendingRequest) {
      return;
    }

    if (message.type === 'prepare-usd-stage-open-error') {
      pendingRequest.reject(new Error(message.error || 'USD stage preparation worker failed'));
      return;
    }

    pendingRequest.resolve(
      message.result
        ? hydratePreparedUsdStageOpenDataFromWorker(message.result)
        : EMPTY_PREPARED_USD_STAGE_OPEN_DATA,
    );
  };

  const handleSharedWorkerError = (event: ErrorEvent): void => {
    workerUnavailable = true;
    disposeSharedWorker(createWorkerError(event));
  };

  const handleSharedWorkerMessageError = (): void => {
    workerUnavailable = true;
    disposeSharedWorker(new Error('USD stage preparation worker message transfer failed'));
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

  const ensureWorkerContext = (
    worker: WorkerLike,
    preparedDispatch: PreparedUsdStageOpenWorkerDispatch,
  ): string | undefined => {
    if (!preparedDispatch.contextCacheKey || !preparedDispatch.contextSnapshot) {
      return undefined;
    }

    const cachedContextId = syncedContextIdsByCacheKey.get(preparedDispatch.contextCacheKey);
    if (cachedContextId) {
      return cachedContextId;
    }

    const contextId = `usd-stage-open-context-${++contextIdCounter}`;
    const syncContextRequest: SyncUsdStageOpenWorkerContextRequest = {
      type: 'sync-context',
      contextId,
      context: preparedDispatch.contextSnapshot as UsdStageOpenPreparationWorkerContextSnapshot,
    };

    worker.postMessage(syncContextRequest);
    syncedContextIdsByCacheKey.set(preparedDispatch.contextCacheKey, contextId);

    if (syncedContextIdsByCacheKey.size > 24) {
      const oldestEntry = syncedContextIdsByCacheKey.keys().next();
      if (!oldestEntry.done) {
        syncedContextIdsByCacheKey.delete(oldestEntry.value);
      }
    }

    return contextId;
  };

  const prepare = async (
    sourceFile: Pick<RobotFile, 'name' | 'content' | 'blobUrl'>,
    availableFiles: Array<Pick<RobotFile, 'name' | 'content' | 'blobUrl' | 'format'>>,
    assets: Record<string, string>,
  ): Promise<PreparedUsdStageOpenData> => {
    if (workerUnavailable && sharedWorker) {
      throw new Error('USD stage preparation worker is unavailable');
    }

    if (!canUseWorker()) {
      throw new Error('Web Worker is not available in this environment');
    }

    return new Promise<PreparedUsdStageOpenData>((resolveRequest, rejectRequest) => {
      const requestId = ++requestIdCounter;
      let worker: WorkerLike;
      let preparedDispatch: PreparedUsdStageOpenWorkerDispatch;

      try {
        worker = ensureSharedWorker();
        preparedDispatch = buildUsdStageOpenPreparationWorkerDispatch(sourceFile, availableFiles, assets);
      } catch (error) {
        workerUnavailable = true;
        rejectRequest(error);
        return;
      }

      const contextId = ensureWorkerContext(worker, preparedDispatch);

      const request: PrepareUsdStageOpenWorkerRequest = {
        type: 'prepare-usd-stage-open',
        requestId,
        sourceFile: preparedDispatch.sourceFile,
        availableFiles: preparedDispatch.availableFiles,
        assets: preparedDispatch.assets,
        contextId,
      };

      const pendingRequest: PendingWorkerRequest = {
        resolve: resolveRequest,
        reject: rejectRequest,
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

const sharedUsdStageOpenPreparationWorkerClient = createUsdStageOpenPreparationWorkerClient();

export function prepareUsdStageOpenWithWorker(
  sourceFile: Pick<RobotFile, 'name' | 'content' | 'blobUrl'>,
  availableFiles: Array<Pick<RobotFile, 'name' | 'content' | 'blobUrl' | 'format'>>,
  assets: Record<string, string>,
): Promise<PreparedUsdStageOpenData> {
  return sharedUsdStageOpenPreparationWorkerClient.prepare(sourceFile, availableFiles, assets);
}

export function disposeUsdStageOpenPreparationWorker(rejectPendingWith?: unknown): void {
  sharedUsdStageOpenPreparationWorkerClient.dispose(rejectPendingWith);
}
