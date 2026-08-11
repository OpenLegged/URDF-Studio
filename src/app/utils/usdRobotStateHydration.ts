import {
  disposeUsdOffscreenViewerStageInBackground,
  disposeUsdOffscreenViewerWorker,
  prepareSharedUsdOffscreenViewerStageOpenDispatch,
} from '@/features/editor/usd_offscreen_runtime';
import {
  hydratePreparedUsdExportCacheFromWorker,
  prepareUsdPreparedExportCacheWithWorker,
  type UsdOffscreenViewerCompletionMode,
  type UsdOffscreenViewerSessionId,
  type UsdOffscreenViewerWorkerResponse,
  type ViewerRobotDataResolution,
} from '@/features/editor/usd_hydration';
import type { PreparedUsdExportCacheResult } from '@/features/editor/usd_export';
import type { RobotData, RobotFile, UsdBakedScene, UsdSceneSnapshot } from '@/types';
import { DEFAULT_ORIGIN_AXES_SIZE } from '@/shared/components/3d/helpers/coordinateAxesSizing';
import { normalizeLibraryPathKey } from '@/core/utils/pathKeys';

export interface UsdRobotStateHydrationWorkerLike {
  addEventListener: Worker['addEventListener'];
  removeEventListener: Worker['removeEventListener'];
  postMessage: Worker['postMessage'];
}

export interface UsdRobotStateHydrationWorkerClient {
  disposeStage: (sessionId?: UsdOffscreenViewerSessionId) => void;
  prepareStageOpenDispatch: (
    sourceFile: Pick<RobotFile, 'name' | 'content' | 'blobUrl'>,
    availableFiles: Array<Pick<RobotFile, 'name' | 'content' | 'blobUrl' | 'format'>>,
    assets: Record<string, string>,
  ) => {
    sessionId: UsdOffscreenViewerSessionId;
    worker: UsdRobotStateHydrationWorkerLike;
    sourceFile: Pick<RobotFile, 'name' | 'content' | 'blobUrl'>;
    stageOpenContextKey?: string;
    stageOpenContext?: unknown | null;
    stageOpenContextCacheHit: boolean;
    commitStageOpenContext: () => void;
  };
  shutdown: () => void;
}

export interface UsdRobotStateHydrationResult {
  robotData: RobotData;
  preparedCache: PreparedUsdExportCacheResult | null;
  preparedCachePending: boolean;
  resolution: ViewerRobotDataResolution;
  bakedScene: UsdBakedScene;
  sceneSnapshot: UsdSceneSnapshot;
}

export interface UsdRobotStateHydrationHandle {
  promise: Promise<UsdRobotStateHydrationResult>;
  cleanup: () => void;
}

export interface StartUsdRobotStateHydrationOptions {
  sourceFile: RobotFile;
  availableFiles: RobotFile[];
  assets: Record<string, string>;
  signal?: AbortSignal;
  createCanvas?: () => OffscreenCanvas;
  workerClient?: UsdRobotStateHydrationWorkerClient;
  prepareExportCache?: (
    snapshot: UsdBakedScene,
    resolution: ViewerRobotDataResolution,
  ) => Promise<PreparedUsdExportCacheResult | null>;
  completionMode?: UsdOffscreenViewerCompletionMode;
  forceHydraFullDraw?: boolean;
  resolveBeforePreparedCache?: boolean;
  onDeferredSceneSnapshot?: (snapshot: UsdSceneSnapshot, stageSourcePath: string | null) => void;
  onPreparedCache?: (
    cache: PreparedUsdExportCacheResult,
    resolution: ViewerRobotDataResolution,
    stageSourcePath: string | null,
  ) => void;
  onPreparedCacheError?: (error: Error, stageSourcePath: string | null) => void;
  onEvent?: (event: UsdOffscreenViewerWorkerResponse) => void;
  hydrationTimeoutMs?: number;
}

const defaultWorkerClient: UsdRobotStateHydrationWorkerClient = {
  disposeStage: disposeUsdOffscreenViewerStageInBackground,
  prepareStageOpenDispatch: prepareSharedUsdOffscreenViewerStageOpenDispatch,
  shutdown: disposeUsdOffscreenViewerWorker,
};

const POST_RESOLVE_WORKER_GRACE_MS = 60_000;
const DEFAULT_USD_ROBOT_STATE_HYDRATION_TIMEOUT_MS = 5 * 60 * 1000;

function createDefaultOffscreenCanvas(): OffscreenCanvas {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('OffscreenCanvas is unavailable for USD RobotState hydration.');
  }

  return new OffscreenCanvas(1, 1);
}

function normalizeHydrationPath(path: string | null | undefined): string {
  return normalizeLibraryPathKey(path);
}

function toHydrationError(reason: unknown, fallbackMessage: string): Error {
  if (reason instanceof Error) {
    return reason;
  }
  if (typeof reason === 'string' && reason.trim()) {
    return new Error(reason);
  }
  return new Error(fallbackMessage);
}

function isMatchingSceneSnapshot(
  sourceFileName: string,
  resolution: ViewerRobotDataResolution | null,
  stageSourcePath: string | null | undefined,
): boolean {
  const normalizedSnapshotPath = normalizeHydrationPath(stageSourcePath);
  if (!normalizedSnapshotPath) {
    return true;
  }

  if (normalizedSnapshotPath === sourceFileName) {
    return true;
  }

  return normalizeHydrationPath(resolution?.stageSourcePath) === normalizedSnapshotPath;
}

export function startUsdRobotStateHydration({
  sourceFile,
  availableFiles,
  assets,
  signal,
  createCanvas = createDefaultOffscreenCanvas,
  workerClient = defaultWorkerClient,
  prepareExportCache = prepareUsdPreparedExportCacheWithWorker,
  completionMode = 'interactive',
  forceHydraFullDraw = false,
  resolveBeforePreparedCache = false,
  onDeferredSceneSnapshot,
  onPreparedCache,
  onPreparedCacheError,
  onEvent,
  hydrationTimeoutMs = DEFAULT_USD_ROBOT_STATE_HYDRATION_TIMEOUT_MS,
}: StartUsdRobotStateHydrationOptions): UsdRobotStateHydrationHandle {
  const normalizedSourceFileName = normalizeHydrationPath(sourceFile.name);
  let settled = false;
  let cleanedUp = false;
  let resolution: ViewerRobotDataResolution | null = null;
  let sceneSnapshot: UsdBakedScene | null = null;
  let resolvedRobotData: RobotData | null = null;
  let workerPreparedCache: PreparedUsdExportCacheResult | null = null;
  let preparedCachePending = false;
  let deferredSceneSnapshotPending = false;
  let rejectPromise: (reason?: unknown) => void = () => {};
  let deferredSceneSnapshotShutdownTimer: ReturnType<typeof setTimeout> | null = null;
  let hydrationTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

  const stageDispatch = workerClient.prepareStageOpenDispatch(sourceFile, availableFiles, assets);
  const sessionId = stageDispatch.sessionId;
  const worker = stageDispatch.worker;
  const canvas = createCanvas();

  const cleanupListeners = () => {
    worker.removeEventListener('message', handleMessage as EventListener);
    worker.removeEventListener('error', handleWorkerFailure as EventListener);
    worker.removeEventListener('messageerror', handleWorkerFailure as EventListener);
    signal?.removeEventListener('abort', handleAbort);
  };

  const clearHydrationTimeout = () => {
    if (!hydrationTimeoutTimer) {
      return;
    }
    clearTimeout(hydrationTimeoutTimer);
    hydrationTimeoutTimer = null;
  };

  const shutdown = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    if (deferredSceneSnapshotShutdownTimer) {
      clearTimeout(deferredSceneSnapshotShutdownTimer);
      deferredSceneSnapshotShutdownTimer = null;
    }
    clearHydrationTimeout();
    cleanupListeners();
    workerClient.disposeStage(sessionId);
  };

  const rejectOnce = (reason: unknown) => {
    if (settled) {
      return;
    }
    settled = true;
    shutdown();
    rejectPromise(reason);
  };

  const startHydrationTimeout = () => {
    if (!hydrationTimeoutMs || !Number.isFinite(hydrationTimeoutMs) || hydrationTimeoutMs <= 0) {
      return;
    }

    hydrationTimeoutTimer = setTimeout(() => {
      rejectOnce(
        new Error(
          `USD RobotState hydration for "${sourceFile.name}" did not respond within ${hydrationTimeoutMs} ms.`,
        ),
      );
    }, hydrationTimeoutMs);
  };

  const shouldKeepWorkerAliveAfterResolve = () =>
    Boolean(
      (preparedCachePending && onPreparedCache) ||
      (deferredSceneSnapshotPending && onDeferredSceneSnapshot),
    );

  const schedulePostResolveShutdown = () => {
    if (deferredSceneSnapshotShutdownTimer) {
      clearTimeout(deferredSceneSnapshotShutdownTimer);
    }
    deferredSceneSnapshotShutdownTimer = setTimeout(shutdown, POST_RESOLVE_WORKER_GRACE_MS);
  };

  const maybeShutdownAfterSettled = () => {
    if (!settled || cleanedUp) {
      return;
    }

    if (shouldKeepWorkerAliveAfterResolve()) {
      schedulePostResolveShutdown();
      return;
    }

    shutdown();
  };

  const tryResolve = async (
    resolve: (value: UsdRobotStateHydrationResult) => void,
    reject: (reason?: unknown) => void,
  ) => {
    if (settled || !resolution) {
      return;
    }

    try {
      const resolvedBakedScene =
        sceneSnapshot ??
        resolution.usdBakedScene ??
        resolution.usdSceneSnapshot ??
        workerPreparedCache?.resolution.usdBakedScene ??
        workerPreparedCache?.resolution.usdSceneSnapshot ??
        null;
      if (!resolvedBakedScene) {
        return;
      }

      if (completionMode === 'complete' && deferredSceneSnapshotPending && !sceneSnapshot) {
        return;
      }

      if (completionMode !== 'complete' && resolveBeforePreparedCache && !workerPreparedCache) {
        const robotData = resolvedRobotData ?? resolution.robotData;
        const isPreparedCachePending = preparedCachePending;
        settled = true;
        clearHydrationTimeout();
        if (shouldKeepWorkerAliveAfterResolve()) {
          schedulePostResolveShutdown();
        } else {
          shutdown();
        }
        resolve({
          robotData,
          preparedCache: null,
          preparedCachePending: isPreparedCachePending,
          resolution: {
            ...resolution,
            robotData,
          },
          bakedScene: resolvedBakedScene,
          sceneSnapshot: resolvedBakedScene,
        });
        return;
      }

      if (preparedCachePending && !workerPreparedCache) {
        return;
      }

      const preparedCache =
        workerPreparedCache ?? (await prepareExportCache(resolvedBakedScene, resolution));
      if (settled) {
        return;
      }
      if (!preparedCache?.robotData) {
        throw new Error(
          `USD RobotState hydration did not produce a prepared cache for "${sourceFile.name}".`,
        );
      }

      const shouldWaitForDeferredSceneSnapshot = Boolean(
        workerPreparedCache &&
        completionMode !== 'complete' &&
        deferredSceneSnapshotPending &&
        !sceneSnapshot &&
        onDeferredSceneSnapshot,
      );

      settled = true;
      clearHydrationTimeout();
      if (shouldWaitForDeferredSceneSnapshot) {
        schedulePostResolveShutdown();
      } else {
        shutdown();
      }
      resolve({
        robotData: preparedCache.robotData,
        preparedCache,
        preparedCachePending: false,
        resolution,
        bakedScene: resolvedBakedScene,
        sceneSnapshot: resolvedBakedScene,
      });
    } catch (error) {
      if (settled) {
        return;
      }
      settled = true;
      clearHydrationTimeout();
      shutdown();
      reject(error);
    }
  };

  let resolvePromise: (value: UsdRobotStateHydrationResult) => void = () => {};
  const promise = new Promise<UsdRobotStateHydrationResult>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  function handleMessage(event: MessageEvent<UsdOffscreenViewerWorkerResponse | undefined>): void {
    const message = event.data;
    if (!message) {
      return;
    }

    if (message.sessionId !== sessionId) {
      return;
    }

    if (settled) {
      if (
        message.type === 'progress' ||
        message.type === 'document-load' ||
        message.type === 'fatal-error' ||
        message.type === 'load-debug'
      ) {
        onEvent?.(message);
      }

      if (
        message.type === 'scene-snapshot' &&
        !cleanedUp &&
        isMatchingSceneSnapshot(normalizedSourceFileName, resolution, message.stageSourcePath)
      ) {
        sceneSnapshot = message.bakedScene ?? message.snapshot;
        deferredSceneSnapshotPending = false;
        onDeferredSceneSnapshot?.(message.snapshot, message.stageSourcePath);
        maybeShutdownAfterSettled();
        return;
      }

      if (
        message.type === 'prepared-cache' &&
        !cleanedUp &&
        isMatchingSceneSnapshot(normalizedSourceFileName, resolution, message.stageSourcePath)
      ) {
        preparedCachePending = false;
        if (message.preparedCache) {
          const preparedCache = hydratePreparedUsdExportCacheFromWorker(message.preparedCache);
          workerPreparedCache = preparedCache;
          onPreparedCache?.(preparedCache, preparedCache.resolution, message.stageSourcePath);
        } else if (message.error) {
          onPreparedCacheError?.(new Error(message.error), message.stageSourcePath);
        }
        maybeShutdownAfterSettled();
      }
      return;
    }

    if (
      message.type === 'progress' ||
      message.type === 'document-load' ||
      message.type === 'fatal-error' ||
      message.type === 'load-debug'
    ) {
      onEvent?.(message);
    }

    if (message.type === 'fatal-error') {
      rejectOnce(new Error(message.error || 'USD RobotState hydration failed.'));
      return;
    }

    if (message.type === 'robot-data') {
      const normalizedStageSourcePath = normalizeHydrationPath(message.resolution.stageSourcePath);
      if (normalizedStageSourcePath && normalizedStageSourcePath !== normalizedSourceFileName) {
        return;
      }
      resolution = message.resolution;
      resolvedRobotData = message.robotData ?? message.resolution.robotData;
      preparedCachePending = message.preparedCachePending === true;
      deferredSceneSnapshotPending =
        message.deferredSceneSnapshotPending ?? Boolean(message.preparedCache);
      if (message.preparedCache) {
        workerPreparedCache = hydratePreparedUsdExportCacheFromWorker(message.preparedCache);
        preparedCachePending = false;
      }
      void tryResolve(resolvePromise, rejectPromise);
      return;
    }

    if (message.type === 'prepared-cache') {
      if (!isMatchingSceneSnapshot(normalizedSourceFileName, resolution, message.stageSourcePath)) {
        return;
      }
      preparedCachePending = false;
      if (message.preparedCache) {
        workerPreparedCache = hydratePreparedUsdExportCacheFromWorker(message.preparedCache);
      } else if (message.error) {
        onPreparedCacheError?.(new Error(message.error), message.stageSourcePath);
      }
      void tryResolve(resolvePromise, rejectPromise);
      return;
    }

    if (message.type === 'scene-snapshot') {
      if (!isMatchingSceneSnapshot(normalizedSourceFileName, resolution, message.stageSourcePath)) {
        return;
      }
      sceneSnapshot = message.bakedScene ?? message.snapshot;
      deferredSceneSnapshotPending = false;
      onDeferredSceneSnapshot?.(message.snapshot, message.stageSourcePath);
      void tryResolve(resolvePromise, rejectPromise);
    }
  }

  function handleWorkerFailure(event: ErrorEvent | MessageEvent<unknown> | Event): void {
    const errorEvent = event as Partial<ErrorEvent>;
    rejectOnce(
      errorEvent.error ??
        new Error(
          errorEvent.message ||
            (event.type === 'messageerror'
              ? 'USD RobotState hydration worker message deserialization failed.'
              : 'USD RobotState hydration worker failed.'),
        ),
    );
  }

  function handleAbort(): void {
    rejectOnce(
      toHydrationError(
        signal?.reason,
        `USD RobotState hydration for "${sourceFile.name}" was cancelled.`,
      ),
    );
  }

  worker.addEventListener('message', handleMessage as EventListener);
  worker.addEventListener('error', handleWorkerFailure as EventListener);
  worker.addEventListener('messageerror', handleWorkerFailure as EventListener);
  signal?.addEventListener('abort', handleAbort, { once: true });

  if (signal?.aborted) {
    handleAbort();
    return {
      promise,
      cleanup: () => rejectOnce(new Error('USD RobotState hydration was cancelled.')),
    };
  }

  startHydrationTimeout();

  try {
    worker.postMessage(
      {
        type: 'init',
        sessionId,
        canvas,
        width: 1,
        height: 1,
        devicePixelRatio: 1,
        theme: 'light',
        active: false,
        groundPlaneOffset: 0,
        showVisual: true,
        showCollision: true,
        showCollisionAlwaysOnTop: true,
        showOrigins: false,
        showOriginsOverlay: false,
        originSize: DEFAULT_ORIGIN_AXES_SIZE,
        sourceFile: stageDispatch.sourceFile,
        completionMode,
        forceHydraFullDraw,
        stageOpenContextKey: stageDispatch.stageOpenContextKey,
        stageOpenContext: stageDispatch.stageOpenContext as never,
        stageOpenContextCacheHit: stageDispatch.stageOpenContextCacheHit,
        initialInteractionState: null,
      },
      [canvas],
    );
    stageDispatch.commitStageOpenContext();
  } catch (error) {
    rejectOnce(error);
  }

  return {
    promise,
    cleanup: () => {
      if (settled) {
        shutdown();
        return;
      }
      rejectOnce(new Error(`USD RobotState hydration for "${sourceFile.name}" was cancelled.`));
    },
  };
}
