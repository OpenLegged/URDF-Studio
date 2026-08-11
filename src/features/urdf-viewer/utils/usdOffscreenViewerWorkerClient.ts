import { logRuntimeFailure } from '@/core/utils/runtimeDiagnostics';
import type { RobotFile } from '@/types';
import { getUsdRuntimeEnvironmentError } from '@/lib/robot-parser/usd/usdWasmRuntime';
import {
  buildUsdStageOpenPreparationWorkerDispatch,
  type PreparedUsdStageOpenWorkerDispatch,
} from './usdStageOpenPreparationWorkerPayload.ts';
import type {
  UsdOffscreenViewerSessionId,
  UsdOffscreenViewerWorkerRequest,
  UsdOffscreenViewerWorkerResponse,
} from './usdOffscreenViewerProtocol';

interface WorkerLike {
  addEventListener: Worker['addEventListener'];
  removeEventListener: Worker['removeEventListener'];
  postMessage: Worker['postMessage'];
  terminate: Worker['terminate'];
}

interface CreateUsdOffscreenViewerWorkerClientOptions {
  canUseWorker?: () => boolean;
  createWorker?: () => WorkerLike;
  getRuntimeEnvironmentError?: () => Error | null;
}

type WorkerResponseMessageEvent = MessageEvent<UsdOffscreenViewerWorkerResponse | undefined>;
type WorkerFailureEvent = ErrorEvent | MessageEvent<unknown> | Event;

export interface UsdOffscreenViewerWorkerClient {
  disposeStage: (sessionId?: UsdOffscreenViewerSessionId) => void;
  getWorker: () => WorkerLike;
  prepareStageOpenDispatch: (
    sourceFile: Pick<RobotFile, 'name' | 'content' | 'blobUrl'>,
    availableFiles: Array<Pick<RobotFile, 'name' | 'content' | 'blobUrl' | 'format'>>,
    assets: Record<string, string>,
  ) => {
    sessionId: UsdOffscreenViewerSessionId;
    worker: WorkerLike;
    sourceFile: PreparedUsdStageOpenWorkerDispatch['sourceFile'];
    stageOpenContextKey?: string;
    stageOpenContext: PreparedUsdStageOpenWorkerDispatch['contextSnapshot'];
    stageOpenContextCacheHit: boolean;
    commitStageOpenContext: () => void;
  };
  prewarmRuntime: () => void;
  shutdown: () => void;
}

export function createUsdOffscreenViewerWorkerClient({
  canUseWorker = () => typeof Worker !== 'undefined',
  createWorker = () =>
    new Worker(new URL('../workers/usdOffscreenViewer.worker.ts', import.meta.url), {
      type: 'module',
    }),
  getRuntimeEnvironmentError: resolveRuntimeEnvironmentError = getUsdRuntimeEnvironmentError,
}: CreateUsdOffscreenViewerWorkerClientOptions = {}): UsdOffscreenViewerWorkerClient {
  let sharedWorker: WorkerLike | null = null;
  let nextSessionId = 0;
  let activeSessionId: UsdOffscreenViewerSessionId | null = null;
  const syncedContextKeys = new Set<string>();
  const syncedContextKeyOrder: string[] = [];
  const CONTEXT_CACHE_LIMIT = 24;
  const handleSharedWorkerMessage: EventListener = (event): void => {
    const message = (event as WorkerResponseMessageEvent).data;
    if (!message || typeof message !== 'object') {
      return;
    }

    if (
      message.type === 'load-debug' &&
      message.entry?.status === 'rejected' &&
      message.entry?.detail?.prewarmOnly === true
    ) {
      return;
    }

    if (
      message.type === 'fatal-error' &&
      (activeSessionId === null || message.sessionId === activeSessionId)
    ) {
      logRuntimeFailure(
        'usdOffscreenViewerWorker',
        new Error(message.error || 'USD offscreen viewer worker reported a fatal error.'),
        'warn',
      );
      shutdownSharedWorker();
    }
  };
  const handleSharedWorkerError: EventListener = (event): void => {
    const workerEvent = event as WorkerFailureEvent;
    const errorEvent = workerEvent as Partial<ErrorEvent>;
    logRuntimeFailure(
      'usdOffscreenViewerWorker',
      errorEvent.error ??
        new Error(
          errorEvent.message ||
            (workerEvent.type === 'messageerror'
              ? 'USD offscreen viewer worker message deserialization failed.'
              : 'USD offscreen viewer worker failed.'),
        ),
      'warn',
    );
  };

  const clearSyncedContextCache = (): void => {
    syncedContextKeys.clear();
    syncedContextKeyOrder.splice(0, syncedContextKeyOrder.length);
  };

  const shutdownSharedWorker = (): void => {
    if (!sharedWorker) {
      return;
    }

    sharedWorker.removeEventListener('message', handleSharedWorkerMessage);
    sharedWorker.removeEventListener('error', handleSharedWorkerError);
    sharedWorker.removeEventListener('messageerror', handleSharedWorkerError);

    try {
      sharedWorker.postMessage({ type: 'dispose' });
    } catch (error) {
      logRuntimeFailure(
        'disposeUsdOffscreenViewerWorker',
        error instanceof Error
          ? error
          : new Error('Failed to dispose the shared USD offscreen viewer worker.'),
        'warn',
      );
    }

    sharedWorker.terminate();
    sharedWorker = null;
    activeSessionId = null;
    clearSyncedContextCache();
  };

  const getWorker = (): WorkerLike => {
    const runtimeEnvironmentError = resolveRuntimeEnvironmentError();
    if (runtimeEnvironmentError) {
      throw runtimeEnvironmentError;
    }

    if (!canUseWorker()) {
      throw new Error('USD offscreen viewer worker is unavailable in this environment');
    }

    if (!sharedWorker) {
      clearSyncedContextCache();
      sharedWorker = createWorker();
      sharedWorker.addEventListener('message', handleSharedWorkerMessage);
      sharedWorker.addEventListener('error', handleSharedWorkerError);
      sharedWorker.addEventListener('messageerror', handleSharedWorkerError);
    }

    return sharedWorker;
  };

  const postSharedMessage = (
    message: UsdOffscreenViewerWorkerRequest,
    transfer?: Transferable[],
  ): void => {
    const worker = getWorker();
    if (transfer) {
      worker.postMessage(message, transfer);
      return;
    }

    worker.postMessage(message);
  };

  const commitStageOpenContextKey = (contextKey?: string): void => {
    if (!contextKey || syncedContextKeys.has(contextKey)) {
      return;
    }

    syncedContextKeys.add(contextKey);
    syncedContextKeyOrder.push(contextKey);
    while (syncedContextKeyOrder.length > CONTEXT_CACHE_LIMIT) {
      const oldestContextKey = syncedContextKeyOrder.shift();
      if (oldestContextKey) {
        syncedContextKeys.delete(oldestContextKey);
      }
    }
  };

  return {
    getWorker,
    prepareStageOpenDispatch: (sourceFile, availableFiles, assets) => {
      const worker = getWorker();
      nextSessionId += 1;
      activeSessionId = nextSessionId;
      const preparedDispatch = buildUsdStageOpenPreparationWorkerDispatch(
        sourceFile,
        availableFiles,
        assets,
      );
      const stageOpenContextKey = preparedDispatch.contextCacheKey ?? undefined;
      const stageOpenContextCacheHit = Boolean(
        stageOpenContextKey &&
        preparedDispatch.contextSnapshot &&
        syncedContextKeys.has(stageOpenContextKey),
      );
      const stageOpenContext = stageOpenContextCacheHit
        ? null
        : (preparedDispatch.contextSnapshot ?? {
            availableFiles: preparedDispatch.availableFiles,
            assets: preparedDispatch.assets,
          });

      return {
        sessionId: activeSessionId,
        worker,
        sourceFile: preparedDispatch.sourceFile,
        stageOpenContextKey,
        stageOpenContext,
        stageOpenContextCacheHit,
        commitStageOpenContext: () => {
          if (!stageOpenContextCacheHit) {
            commitStageOpenContextKey(stageOpenContextKey);
          }
        },
      };
    },
    prewarmRuntime: () => {
      const runtimeEnvironmentError = resolveRuntimeEnvironmentError();
      if (runtimeEnvironmentError) {
        logRuntimeFailure('prewarmUsdOffscreenViewerRuntime', runtimeEnvironmentError, 'warn');
        return;
      }

      try {
        postSharedMessage({ type: 'prewarm-runtime' });
      } catch (error) {
        logRuntimeFailure(
          'prewarmUsdOffscreenViewerRuntime',
          error instanceof Error
            ? error
            : new Error('Failed to prewarm the shared USD offscreen viewer runtime.'),
          'warn',
        );
      }
    },
    disposeStage: (sessionId) => {
      if (!sharedWorker) {
        return;
      }

      const sessionIdToDispose = sessionId ?? activeSessionId;
      if (sessionIdToDispose === null || sessionIdToDispose === undefined) {
        return;
      }

      if (activeSessionId !== sessionIdToDispose) {
        return;
      }

      try {
        sharedWorker.postMessage({ type: 'dispose-stage', sessionId: sessionIdToDispose });
      } catch (error) {
        logRuntimeFailure(
          'disposeUsdOffscreenViewerStageInBackground',
          error instanceof Error
            ? error
            : new Error('Failed to dispose the shared USD offscreen viewer stage.'),
          'warn',
        );
      } finally {
        if (activeSessionId === sessionIdToDispose) {
          activeSessionId = null;
        }
      }
    },
    shutdown: shutdownSharedWorker,
  };
}

const sharedUsdOffscreenViewerWorkerClient = createUsdOffscreenViewerWorkerClient();

export function getSharedUsdOffscreenViewerWorker(): WorkerLike {
  return sharedUsdOffscreenViewerWorkerClient.getWorker();
}

export function prepareSharedUsdOffscreenViewerStageOpenDispatch(
  sourceFile: Pick<RobotFile, 'name' | 'content' | 'blobUrl'>,
  availableFiles: Array<Pick<RobotFile, 'name' | 'content' | 'blobUrl' | 'format'>>,
  assets: Record<string, string>,
): ReturnType<UsdOffscreenViewerWorkerClient['prepareStageOpenDispatch']> {
  return sharedUsdOffscreenViewerWorkerClient.prepareStageOpenDispatch(
    sourceFile,
    availableFiles,
    assets,
  );
}

export function prewarmUsdOffscreenViewerRuntimeInBackground(): void {
  sharedUsdOffscreenViewerWorkerClient.prewarmRuntime();
}

export function disposeUsdOffscreenViewerStageInBackground(
  sessionId?: UsdOffscreenViewerSessionId,
): void {
  sharedUsdOffscreenViewerWorkerClient.disposeStage(sessionId);
}

export function disposeUsdOffscreenViewerWorker(): void {
  sharedUsdOffscreenViewerWorkerClient.shutdown();
}
