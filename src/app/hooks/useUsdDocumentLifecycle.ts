import { useCallback, useEffect } from 'react';

import type { ViewerDocumentLoadEvent } from '@/features/editor';
import { startUsdRobotStateHydration } from '@/app/utils/usdRobotStateHydration';
import { useAssetsStore } from '@/store/assetsStore';
import type { DocumentLoadState } from '@/store/assetsStore';
import type { RobotFile } from '@/types';
import { recordUsdStageLoadDebug } from '@/shared/debug/usdStageLoadDebug';

import {
  cancelPendingUsdWorkspaceLoad,
  completePendingUsdWorkspaceLoad,
  getPendingUsdWorkspaceLoad,
} from '../utils/commitResolvedRobotLoad';
import { mapViewerDocumentLoadEventToDocumentLoadPercent } from '../utils/documentLoadProgress';
import {
  resolveRuntimeRobotReadyDocumentLoadState,
  shouldIgnoreStaleViewerDocumentLoadEvent,
  shouldIgnoreViewerLoadRegressionAfterReadySameFile,
} from '../utils/documentLoadFlow';
import { handleUsdHydrationWorkerEvent } from '../utils/usdHydrationWorkerEvents';
import { shouldApplyUsdStageHydration } from '../utils/usdStageHydration';
import { markUnsavedChangesBaselineSaved } from '../utils/unsavedChangesBaseline';

interface UseUsdDocumentLifecycleLabels {
  failedToParseFormat: string;
}

interface UseUsdDocumentLifecycleOptions {
  clearAssemblyComponentPreparationOverlay: () => void;
  isSelectedUsdHydrating: boolean;
  labels: UseUsdDocumentLifecycleLabels;
  previewFile: RobotFile | null;
  selectedFile: RobotFile | null;
  setDocumentLoadState: (state: DocumentLoadState) => void;
  showToast: (message: string, type?: 'info' | 'success') => void;
  startHydration?: typeof startUsdRobotStateHydration;
  updateProModeRoundtripBaseline: (generatedFileName: string | null) => unknown;
}

function normalizeUsdPath(path: string | null | undefined): string {
  return String(path || '')
    .trim()
    .replace(/^\/+/, '')
    .split('?')[0];
}

function createDocumentStateFromViewerEvent(
  file: RobotFile,
  event: ViewerDocumentLoadEvent,
  failedMessage: string,
): DocumentLoadState {
  return {
    status:
      event.status === 'ready'
        ? 'ready'
        : event.status === 'error'
          ? 'error'
          : 'loading',
    fileName: file.name,
    format: file.format,
    error: event.status === 'error' ? event.error ?? failedMessage : null,
    phase: event.phase ?? (event.status === 'ready' ? 'ready' : null),
    message: event.message ?? null,
    progressMode: 'percent',
    progressPercent: mapViewerDocumentLoadEventToDocumentLoadPercent(
      file.format,
      event,
    ),
    loadedCount: null,
    totalCount: null,
  };
}

export function useUsdDocumentLifecycle({
  clearAssemblyComponentPreparationOverlay,
  isSelectedUsdHydrating,
  labels,
  previewFile,
  selectedFile,
  setDocumentLoadState,
  showToast,
  startHydration = startUsdRobotStateHydration,
  updateProModeRoundtripBaseline,
}: UseUsdDocumentLifecycleOptions) {
  const commitRuntimeReadyDocumentLoadState = useCallback(() => {
    const activeFile = previewFile ?? selectedFile;
    if (!activeFile) {
      return;
    }
    const currentState = useAssetsStore.getState().documentLoadState;
    if (currentState.status === 'hydrating') {
      return;
    }
    const nextState = resolveRuntimeRobotReadyDocumentLoadState({
      activeFile,
      currentState,
    });
    if (nextState && nextState !== currentState) {
      setDocumentLoadState(nextState);
    }
  }, [previewFile, selectedFile, setDocumentLoadState]);

  const handleViewerDocumentLoadEvent = useCallback(
    (event: ViewerDocumentLoadEvent) => {
      const activeFile = previewFile ?? selectedFile;
      if (!activeFile) {
        return;
      }
      const currentState = useAssetsStore.getState().documentLoadState;
      if (
        shouldIgnoreStaleViewerDocumentLoadEvent({
          isPreviewing: Boolean(previewFile),
          activeDocumentFileName: activeFile.name,
          documentLoadState: currentState,
        })
      ) {
        return;
      }
      const nextState = createDocumentStateFromViewerEvent(
        activeFile,
        event,
        labels.failedToParseFormat.replace(
          '{format}',
          activeFile.format.toUpperCase(),
        ),
      );
      if (
        shouldIgnoreViewerLoadRegressionAfterReadySameFile({
          currentState,
          nextState,
        })
      ) {
        return;
      }
      setDocumentLoadState(nextState);
    },
    [labels.failedToParseFormat, previewFile, selectedFile, setDocumentLoadState],
  );

  useEffect(() => {
    if (!isSelectedUsdHydrating) {
      return undefined;
    }
    const operation = getPendingUsdWorkspaceLoad();
    if (!operation) {
      return undefined;
    }

    const hydrationFile = operation.file;
    const operationId = operation.operationId;
    const controller = new AbortController();
    let cancelled = false;
    let committed = false;
    let deferredSceneSnapshot: Parameters<
      ReturnType<typeof useAssetsStore.getState>['setUsdSceneSnapshot']
    >[1] = null;
    let deferredSceneSnapshotPath: string | null = null;
    let deferredPreparedCache: Parameters<
      ReturnType<typeof useAssetsStore.getState>['setUsdPreparedExportCache']
    >[1] = null;

    const operationIsCurrent = (stageSourcePath?: string | null) => {
      const pending = getPendingUsdWorkspaceLoad();
      const liveDocumentState = useAssetsStore.getState().documentLoadState;
      return (
        !cancelled
        && pending?.operationId === operationId
        && liveDocumentState.fileName === hydrationFile.name
        && liveDocumentState.format === 'usd'
        && (!stageSourcePath
          || shouldApplyUsdStageHydration({
              pendingFileName: hydrationFile.name,
              selectedFileName: hydrationFile.name,
              stageSourcePath,
            }))
      );
    };

    const commitHydrationLoadEvent = (event: ViewerDocumentLoadEvent) => {
      if (!operationIsCurrent() || event.status === 'ready') {
        return;
      }
      const currentState = useAssetsStore.getState().documentLoadState;
      const nextState = createDocumentStateFromViewerEvent(
        hydrationFile,
        event,
        labels.failedToParseFormat.replace('{format}', 'USD'),
      );
      nextState.status = event.status === 'error' ? 'error' : 'hydrating';
      nextState.progressPercent = event.status === 'error'
        ? 0
        : Math.max(
            currentState.fileName === hydrationFile.name
              ? currentState.progressPercent ?? 0
              : 0,
            nextState.progressPercent ?? 0,
          );
      setDocumentLoadState(nextState);
    };

    let hydration: ReturnType<typeof startUsdRobotStateHydration>;
    try {
      const assetsState = useAssetsStore.getState();
      hydration = startHydration({
        sourceFile: hydrationFile,
        availableFiles: assetsState.availableFiles,
        assets: assetsState.assets,
        signal: controller.signal,
        completionMode: 'complete',
        resolveBeforePreparedCache: false,
        onDeferredSceneSnapshot: (snapshot, stageSourcePath) => {
          if (!operationIsCurrent(stageSourcePath)) return;
          deferredSceneSnapshot = snapshot;
          deferredSceneSnapshotPath = stageSourcePath;
        },
        onPreparedCache: (preparedCache, _resolution, stageSourcePath) => {
          if (!operationIsCurrent(stageSourcePath)) return;
          deferredPreparedCache = preparedCache;
        },
        onPreparedCacheError: (error) => {
          if (!operationIsCurrent()) return;
          commitHydrationLoadEvent({
            status: 'error',
            phase: null,
            error: error.message,
          });
        },
        onEvent: (event) => {
          handleUsdHydrationWorkerEvent(event, { commitHydrationLoadEvent });
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      cancelPendingUsdWorkspaceLoad(operationId, { restoreDocumentSession: true });
      clearAssemblyComponentPreparationOverlay();
      showToast(reason, 'info');
      return undefined;
    }

    void hydration.promise
      .then((result) => {
        if (!operationIsCurrent(result.resolution.stageSourcePath)) {
          hydration.cleanup();
          return;
        }
        const completion = completePendingUsdWorkspaceLoad(
          operationId,
          hydrationFile,
          result.robotData,
        );
        if (completion.status === 'stale') {
          hydration.cleanup();
          return;
        }
        committed = true;
        const assetsState = useAssetsStore.getState();
        assetsState.setUsdBakedScene(hydrationFile.name, result.bakedScene);
        assetsState.setUsdPreparedExportCache(
          hydrationFile.name,
          result.preparedCache ?? deferredPreparedCache,
        );
        if (deferredSceneSnapshot) {
          assetsState.setUsdSceneSnapshot(
            deferredSceneSnapshotPath ?? hydrationFile.name,
            deferredSceneSnapshot,
          );
        }
        setDocumentLoadState({
          status: 'ready',
          fileName: hydrationFile.name,
          format: 'usd',
          error: null,
          phase: 'ready',
          progressMode: 'percent',
          progressPercent: 100,
        });
        if (operation.intent === 'replace') {
          markUnsavedChangesBaselineSaved();
        }
        updateProModeRoundtripBaseline(null);
        clearAssemblyComponentPreparationOverlay();
        recordUsdStageLoadDebug({
          sourceFileName: normalizeUsdPath(hydrationFile.name),
          step: 'commit-worker-robot-data',
          status: 'resolved',
          timestamp: Date.now(),
          detail: {
            operationId,
            componentId: completion.component.id,
            intent: operation.intent,
            linkCount: Object.keys(result.robotData.links).length,
            jointCount: Object.keys(result.robotData.joints).length,
          },
        });
      })
      .catch((error) => {
        if (cancelled || controller.signal.aborted) {
          return;
        }
        const reason = error instanceof Error ? error.message : String(error);
        cancelPendingUsdWorkspaceLoad(operationId, { restoreDocumentSession: true });
        clearAssemblyComponentPreparationOverlay();
        showToast(reason, 'info');
      });

    return () => {
      cancelled = true;
      if (!committed) {
        cancelPendingUsdWorkspaceLoad(operationId, {
          restoreDocumentSession: true,
        });
        controller.abort(
          new Error(`USD hydration for "${hydrationFile.name}" was cancelled.`),
        );
      }
      hydration.cleanup();
    };
  }, [
    clearAssemblyComponentPreparationOverlay,
    isSelectedUsdHydrating,
    labels.failedToParseFormat,
    selectedFile,
    setDocumentLoadState,
    showToast,
    startHydration,
    updateProModeRoundtripBaseline,
  ]);

  const handleViewerRuntimeRobotLoaded = useCallback(() => {
    commitRuntimeReadyDocumentLoadState();
  }, [commitRuntimeReadyDocumentLoadState]);
  const handleViewerRuntimeSceneReadyForDisplay = useCallback(() => {
    commitRuntimeReadyDocumentLoadState();
  }, [commitRuntimeReadyDocumentLoadState]);

  return {
    handleViewerDocumentLoadEvent,
    handleViewerRuntimeRobotLoaded,
    handleViewerRuntimeSceneReadyForDisplay,
  };
}
