import {
  disposeUsdOffscreenViewerWorker,
  prepareSharedUsdOffscreenViewerStageOpenDispatch,
} from '@/features/urdf-viewer/utils/usdOffscreenViewerWorkerClient';
import { prepareUsdPreparedExportCacheWithWorker } from '@/features/urdf-viewer/utils/usdPreparedExportCacheWorkerBridge';
import type {
  UsdOffscreenViewerWorkerRequest,
  UsdOffscreenViewerWorkerResponse,
} from '@/features/urdf-viewer/utils/usdOffscreenViewerProtocol';
import type { PreparedUsdExportCacheResult } from '@/features/urdf-viewer/utils/usdExportBundle';
import { hydratePreparedUsdExportCacheFromWorker } from '@/features/urdf-viewer/utils/usdPreparedExportCacheWorkerTransfer';
import type { ViewerRobotDataResolution } from '@/features/urdf-viewer/utils/viewerRobotData';
import type { RobotData, RobotFile, UsdSceneSnapshot } from '@/types';
import { normalizeLibraryPathKey } from '@/shared/utils/pathKeys';

type HydrationWorkerEventHandler = (
  event: MessageEvent<UsdOffscreenViewerWorkerResponse | undefined>,
) => void;
type HydrationWorkerFailureHandler = (event: ErrorEvent | MessageEvent<unknown> | Event) => void;

export interface UsdRobotStateHydrationWorkerLike {
  addEventListener: (
    type: 'message' | 'error' | 'messageerror',
    listener: EventListenerOrEventListenerObject,
  ) => void;
  removeEventListener: (
    type: 'message' | 'error' | 'messageerror',
    listener: EventListenerOrEventListenerObject,
  ) => void;
  postMessage: (message: UsdOffscreenViewerWorkerRequest, transfer?: Transferable[]) => void;
}

export interface UsdRobotStateHydrationWorkerClient {
  prepareStageOpenDispatch: (
    sourceFile: Pick<RobotFile, 'name' | 'content' | 'blobUrl'>,
    availableFiles: Array<Pick<RobotFile, 'name' | 'content' | 'blobUrl' | 'format'>>,
    assets: Record<string, string>,
  ) => {
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
  preparedCache: PreparedUsdExportCacheResult;
  resolution: ViewerRobotDataResolution;
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
    snapshot: UsdSceneSnapshot,
    resolution: ViewerRobotDataResolution,
  ) => Promise<PreparedUsdExportCacheResult | null>;
  onDeferredSceneSnapshot?: (snapshot: UsdSceneSnapshot, stageSourcePath: string | null) => void;
  onEvent?: (event: UsdOffscreenViewerWorkerResponse) => void;
}

const defaultWorkerClient: UsdRobotStateHydrationWorkerClient = {
  prepareStageOpenDispatch: prepareSharedUsdOffscreenViewerStageOpenDispatch,
  shutdown: disposeUsdOffscreenViewerWorker,
};

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
  onDeferredSceneSnapshot,
  onEvent,
}: StartUsdRobotStateHydrationOptions): UsdRobotStateHydrationHandle {
  const normalizedSourceFileName = normalizeHydrationPath(sourceFile.name);
  let settled = false;
  let cleanedUp = false;
  let resolution: ViewerRobotDataResolution | null = null;
  let sceneSnapshot: UsdSceneSnapshot | null = null;
  let workerPreparedCache: PreparedUsdExportCacheResult | null = null;
  let rejectPromise: (reason?: unknown) => void = () => {};
  let deferredSceneSnapshotShutdownTimer: ReturnType<typeof setTimeout> | null = null;

  const stageDispatch = workerClient.prepareStageOpenDispatch(sourceFile, availableFiles, assets);
  const worker = stageDispatch.worker;
  const canvas = createCanvas();

  const cleanupListeners = () => {
    worker.removeEventListener('message', handleMessage as EventListener);
    worker.removeEventListener('error', handleWorkerFailure as EventListener);
    worker.removeEventListener('messageerror', handleWorkerFailure as EventListener);
    signal?.removeEventListener('abort', handleAbort);
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
    cleanupListeners();
    workerClient.shutdown();
  };

  const rejectOnce = (reason: unknown) => {
    if (settled) {
      return;
    }
    settled = true;
    shutdown();
    rejectPromise(reason);
  };

  const tryResolve = async (
    resolve: (value: UsdRobotStateHydrationResult) => void,
    reject: (reason?: unknown) => void,
  ) => {
    if (settled || !resolution) {
      return;
    }

    try {
      const resolvedSceneSnapshot =
        sceneSnapshot ??
        resolution.usdSceneSnapshot ??
        workerPreparedCache?.resolution.usdSceneSnapshot ??
        null;
      if (!resolvedSceneSnapshot) {
        return;
      }

      const preparedCache =
        workerPreparedCache ?? (await prepareExportCache(resolvedSceneSnapshot, resolution));
      if (settled) {
        return;
      }
      if (!preparedCache?.robotData) {
        throw new Error(
          `USD RobotState hydration did not produce a prepared cache for "${sourceFile.name}".`,
        );
      }

      const shouldWaitForDeferredSceneSnapshot = Boolean(
        workerPreparedCache && !sceneSnapshot && onDeferredSceneSnapshot,
      );

      settled = true;
      if (shouldWaitForDeferredSceneSnapshot) {
        deferredSceneSnapshotShutdownTimer = setTimeout(shutdown, 15_000);
      } else {
        shutdown();
      }
      resolve({
        robotData: preparedCache.robotData,
        preparedCache,
        resolution,
        sceneSnapshot: resolvedSceneSnapshot,
      });
    } catch (error) {
      if (settled) {
        return;
      }
      settled = true;
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

    if (settled) {
      if (
        message.type === 'scene-snapshot' &&
        !cleanedUp &&
        isMatchingSceneSnapshot(normalizedSourceFileName, resolution, message.stageSourcePath)
      ) {
        onDeferredSceneSnapshot?.(message.snapshot, message.stageSourcePath);
        shutdown();
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
      if (message.preparedCache) {
        workerPreparedCache = hydratePreparedUsdExportCacheFromWorker(message.preparedCache);
      }
      void tryResolve(resolvePromise, rejectPromise);
      return;
    }

    if (message.type === 'scene-snapshot') {
      if (!isMatchingSceneSnapshot(normalizedSourceFileName, resolution, message.stageSourcePath)) {
        return;
      }
      sceneSnapshot = message.snapshot;
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
      toHydrationError(signal?.reason, `USD RobotState hydration for "${sourceFile.name}" was cancelled.`),
    );
  }

  worker.addEventListener('message', handleMessage as HydrationWorkerEventHandler);
  worker.addEventListener('error', handleWorkerFailure as HydrationWorkerFailureHandler);
  worker.addEventListener('messageerror', handleWorkerFailure as HydrationWorkerFailureHandler);
  signal?.addEventListener('abort', handleAbort, { once: true });

  if (signal?.aborted) {
    handleAbort();
    return {
      promise,
      cleanup: () => rejectOnce(new Error('USD RobotState hydration was cancelled.')),
    };
  }

  worker.postMessage(
    {
      type: 'init',
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
      originSize: 0.2,
      sourceFile: stageDispatch.sourceFile,
      stageOpenContextKey: stageDispatch.stageOpenContextKey,
      stageOpenContext: stageDispatch.stageOpenContext as never,
      stageOpenContextCacheHit: stageDispatch.stageOpenContextCacheHit,
      initialInteractionState: null,
    },
    [canvas],
  );
  stageDispatch.commitStageOpenContext();

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
