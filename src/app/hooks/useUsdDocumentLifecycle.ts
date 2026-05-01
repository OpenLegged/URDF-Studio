import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { ViewerDocumentLoadEvent } from '@/features/editor';
import { useAssetsStore, useRobotStore, useSelectionStore } from '@/store';
import type { DocumentLoadState, DocumentLoadStatus } from '@/store/assetsStore';
import type { InteractionSelection, RobotData, RobotFile } from '@/types';
import { createRobotSemanticSnapshot } from '@/shared/utils/robot/semanticSnapshot';
import { recordUsdStageLoadDebug } from '@/shared/debug/usdStageLoadDebug';
import { registerPendingUsdCacheFlusher } from '../utils/pendingUsdCache';
import {
  resolveUsdStageHydrationSelection,
  shouldApplyUsdStageHydration,
} from '../utils/usdStageHydration';
import {
  resolveUsdPreparedCacheRobotStateUpdate,
} from '../utils/usdPreparedCacheRobotState';
import { startUsdRobotStateHydration } from '../utils/usdRobotStateHydration';
import { mapViewerDocumentLoadEventToDocumentLoadPercent } from '../utils/documentLoadProgress';
import {
  resolveRuntimeRobotReadyDocumentLoadState,
  shouldIgnoreStaleViewerDocumentLoadEvent,
  shouldIgnoreViewerLoadRegressionAfterReadySameFile,
} from '../utils/documentLoadFlow';
import { scheduleFailFastInDev } from '@/core/utils/runtimeDiagnostics';
import { markUnsavedChangesBaselineSaved } from '../utils/unsavedChangesBaseline';
import { isGeneratedWorkspaceUrdfFileName } from './workspaceSourceSyncUtils';

interface UsdPersistenceBaseline {
  fileName: string | null;
  robotSnapshot: string | null;
  hadPreparedExportCache: boolean;
}

const EMPTY_USD_PERSISTENCE_BASELINE: UsdPersistenceBaseline = {
  fileName: null,
  robotSnapshot: null,
  hadPreparedExportCache: false,
};

function normalizeUsdPersistenceFileName(path: string | null | undefined): string {
  return String(path || '')
    .trim()
    .replace(/^\/+/, '')
    .split('?')[0];
}

interface UseUsdDocumentLifecycleLabels {
  addedComponent: string;
  failedToParseFormat: string;
}

interface UseUsdDocumentLifecycleOptions {
  clearAssemblyComponentPreparationOverlay: () => void;
  insertAssemblyComponentIntoWorkspace: (
    file: RobotFile,
    options?: { preResolvedRobotData?: RobotData | null },
  ) => Promise<{ name: string }>;
  isSelectedUsdHydrating: boolean;
  labels: UseUsdDocumentLifecycleLabels;
  pendingUsdAssemblyFileRef: MutableRefObject<RobotFile | null>;
  previewFile: RobotFile | null;
  selectedFile: RobotFile | null;
  setDocumentLoadState: (state: DocumentLoadState) => void;
  setRobot: (
    data: RobotData,
    options?: { label?: string; resetHistory?: boolean; skipHistory?: boolean },
  ) => void;
  setSelection: (selection: InteractionSelection) => void;
  showToast: (message: string, type?: 'info' | 'success') => void;
  updateProModeRoundtripBaseline: (generatedFileName: string | null) => unknown;
}

export function useUsdDocumentLifecycle({
  clearAssemblyComponentPreparationOverlay,
  insertAssemblyComponentIntoWorkspace,
  isSelectedUsdHydrating,
  labels,
  pendingUsdAssemblyFileRef,
  previewFile,
  selectedFile,
  setDocumentLoadState,
  setRobot,
  setSelection,
  showToast,
  updateProModeRoundtripBaseline,
}: UseUsdDocumentLifecycleOptions) {
  const pendingUsdHydrationFileRef = useRef<string | null>(null);
  const usdPersistenceBaselineRef = useRef<UsdPersistenceBaseline>(EMPTY_USD_PERSISTENCE_BASELINE);

  useEffect(() => {
    if (!isSelectedUsdHydrating || selectedFile?.format !== 'usd') {
      pendingUsdHydrationFileRef.current = null;
      return;
    }

    pendingUsdHydrationFileRef.current = selectedFile.name;
  }, [isSelectedUsdHydrating, selectedFile]);

  const flushPendingUsdCache = useCallback(() => {
    const liveAssetsState = useAssetsStore.getState();
    const currentSelectedFile = liveAssetsState.selectedFile;
    if (!currentSelectedFile || currentSelectedFile.format !== 'usd') {
      return;
    }

    const normalizedSelectedFileName = normalizeUsdPersistenceFileName(currentSelectedFile.name);
    const baseline = usdPersistenceBaselineRef.current;
    if (
      !baseline.fileName ||
      baseline.fileName !== normalizedSelectedFileName ||
      !baseline.robotSnapshot
    ) {
      return;
    }

    const liveRobotState = useRobotStore.getState();
    const currentRobotData: RobotData = {
      name: liveRobotState.name,
      links: liveRobotState.links,
      joints: liveRobotState.joints,
      rootLinkId: liveRobotState.rootLinkId,
      materials: liveRobotState.materials,
      closedLoopConstraints: liveRobotState.closedLoopConstraints,
    };
    const currentRobotSnapshot = createRobotSemanticSnapshot(currentRobotData);
    const hasSemanticEdits = currentRobotSnapshot !== baseline.robotSnapshot;

    if (!hasSemanticEdits) {
      if (!baseline.hadPreparedExportCache) {
        liveAssetsState.setUsdPreparedExportCache(currentSelectedFile.name, null);
      }
      return;
    }

    const preparedCacheUpdate = resolveUsdPreparedCacheRobotStateUpdate({
      existingPreparedExportCache: liveAssetsState.getUsdPreparedExportCache(currentSelectedFile.name),
      robotData: currentRobotData,
    });
    if (preparedCacheUpdate.status === 'missing-cache') {
      liveAssetsState.setUsdPreparedExportCache(currentSelectedFile.name, null);
      usdPersistenceBaselineRef.current = {
        fileName: normalizedSelectedFileName,
        robotSnapshot: currentRobotSnapshot,
        hadPreparedExportCache: false,
      };
      scheduleFailFastInDev(
        'useUsdDocumentLifecycle:flushPendingUsdCache',
        new Error(
          `Missing prepared USD RobotState cache for "${currentSelectedFile.name}" while semantic edits are pending.`,
        ),
        'warn',
      );
      return;
    }

    liveAssetsState.setUsdPreparedExportCache(
      currentSelectedFile.name,
      preparedCacheUpdate.preparedExportCache,
    );
    usdPersistenceBaselineRef.current = {
      fileName: normalizedSelectedFileName,
      robotSnapshot: currentRobotSnapshot,
      hadPreparedExportCache: true,
    };
  }, []);

  useEffect(() => {
    registerPendingUsdCacheFlusher(flushPendingUsdCache);
    return () => {
      registerPendingUsdCacheFlusher(null);
    };
  }, [flushPendingUsdCache]);

  useEffect(() => {
    if (selectedFile?.format === 'usd') {
      return;
    }

    usdPersistenceBaselineRef.current = EMPTY_USD_PERSISTENCE_BASELINE;
  }, [selectedFile?.format]);

  const commitRuntimeReadyDocumentLoadState = useCallback(() => {
    const liveAssetsState = useAssetsStore.getState();
    const activeDocumentFile = previewFile ?? liveAssetsState.selectedFile ?? selectedFile;
    if (!activeDocumentFile) {
      return;
    }

    const nextDocumentLoadState = resolveRuntimeRobotReadyDocumentLoadState({
      activeFile: activeDocumentFile,
      currentState: liveAssetsState.documentLoadState,
    });
    if (!nextDocumentLoadState) {
      return;
    }

    setDocumentLoadState(nextDocumentLoadState);
  }, [previewFile, selectedFile, setDocumentLoadState]);

  const handleViewerDocumentLoadEvent = useCallback(
    (event: ViewerDocumentLoadEvent) => {
      const liveAssetsState = useAssetsStore.getState();
      const activeDocumentFile = previewFile ?? liveAssetsState.selectedFile;
      const currentDocumentLoadState = liveAssetsState.documentLoadState;

      if (!activeDocumentFile) {
        return;
      }

      if (
        !previewFile &&
        activeDocumentFile.format === 'usd' &&
        currentDocumentLoadState.status === 'hydrating' &&
        currentDocumentLoadState.fileName === activeDocumentFile.name
      ) {
        return;
      }

      if (
        shouldIgnoreStaleViewerDocumentLoadEvent({
          isPreviewing: Boolean(previewFile),
          activeDocumentFileName: activeDocumentFile.name,
          documentLoadState: currentDocumentLoadState,
        })
      ) {
        return;
      }

      const keepHydrating =
        !previewFile &&
        activeDocumentFile.format === 'usd' &&
        currentDocumentLoadState.status === 'hydrating' &&
        currentDocumentLoadState.fileName === activeDocumentFile.name;

      const nextStatus: DocumentLoadStatus =
        event.status === 'ready'
          ? 'ready'
          : event.status === 'error'
            ? 'error'
            : keepHydrating
              ? 'hydrating'
              : 'loading';
      const mappedProgressPercent = mapViewerDocumentLoadEventToDocumentLoadPercent(
        activeDocumentFile.format,
        event,
      );
      const nextProgressPercent =
        event.status === 'error'
          ? 0
          : event.status === 'ready'
            ? 100
            : currentDocumentLoadState.fileName === activeDocumentFile.name &&
                (currentDocumentLoadState.status === 'loading' ||
                  currentDocumentLoadState.status === 'hydrating')
              ? Math.max(currentDocumentLoadState.progressPercent ?? 0, mappedProgressPercent)
              : mappedProgressPercent;

      const nextDocumentLoadState: DocumentLoadState = {
        status: nextStatus,
        fileName: activeDocumentFile.name,
        format: activeDocumentFile.format,
        error:
          event.status === 'error'
            ? (event.error ??
              labels.failedToParseFormat.replace(
                '{format}',
                activeDocumentFile.format.toUpperCase(),
              ))
            : null,
        phase: event.phase ?? null,
        message: event.message ?? null,
        progressMode: 'percent',
        progressPercent: nextProgressPercent,
        loadedCount: null,
        totalCount: null,
      };

      if (
        shouldIgnoreViewerLoadRegressionAfterReadySameFile({
          currentState: currentDocumentLoadState,
          nextState: nextDocumentLoadState,
        })
      ) {
        return;
      }

      if (
        currentDocumentLoadState.status !== nextDocumentLoadState.status ||
        currentDocumentLoadState.fileName !== nextDocumentLoadState.fileName ||
        currentDocumentLoadState.format !== nextDocumentLoadState.format ||
        currentDocumentLoadState.error !== nextDocumentLoadState.error ||
        currentDocumentLoadState.phase !== nextDocumentLoadState.phase ||
        currentDocumentLoadState.message !== nextDocumentLoadState.message ||
        currentDocumentLoadState.progressMode !== nextDocumentLoadState.progressMode ||
        currentDocumentLoadState.progressPercent !== nextDocumentLoadState.progressPercent ||
        currentDocumentLoadState.loadedCount !== nextDocumentLoadState.loadedCount ||
        currentDocumentLoadState.totalCount !== nextDocumentLoadState.totalCount
      ) {
        setDocumentLoadState(nextDocumentLoadState);
      }

      if (!previewFile && event.status === 'error' && activeDocumentFile.format === 'usd') {
        pendingUsdHydrationFileRef.current = null;
      }

      if (
        event.status === 'error' &&
        pendingUsdAssemblyFileRef.current &&
        pendingUsdAssemblyFileRef.current.name === activeDocumentFile.name
      ) {
        pendingUsdAssemblyFileRef.current = null;
        clearAssemblyComponentPreparationOverlay();
      }
    },
    [
      clearAssemblyComponentPreparationOverlay,
      labels.failedToParseFormat,
      pendingUsdAssemblyFileRef,
      previewFile,
      setDocumentLoadState,
    ],
  );

  useEffect(() => {
    if (!isSelectedUsdHydrating || selectedFile?.format !== 'usd') {
      return;
    }

    const hydrationFile = selectedFile;
    const controller = new AbortController();
    let cancelled = false;
    pendingUsdHydrationFileRef.current = hydrationFile.name;

    const commitHydrationLoadEvent = (event: ViewerDocumentLoadEvent) => {
      if (cancelled || event.status === 'ready') {
        return;
      }

      const liveAssetsState = useAssetsStore.getState();
      const liveSelectedFile = liveAssetsState.selectedFile;
      if (liveSelectedFile?.format !== 'usd' || liveSelectedFile.name !== hydrationFile.name) {
        return;
      }

      const currentDocumentLoadState = liveAssetsState.documentLoadState;
      const mappedProgressPercent = mapViewerDocumentLoadEventToDocumentLoadPercent('usd', event);
      const nextProgressPercent =
        event.status === 'error'
          ? 0
          : currentDocumentLoadState.fileName === hydrationFile.name &&
              currentDocumentLoadState.status === 'hydrating'
            ? Math.max(currentDocumentLoadState.progressPercent ?? 0, mappedProgressPercent)
            : mappedProgressPercent;

      const nextDocumentLoadState: DocumentLoadState = {
        status: event.status === 'error' ? 'error' : 'hydrating',
        fileName: hydrationFile.name,
        format: hydrationFile.format,
        error:
          event.status === 'error'
            ? (event.error ??
              labels.failedToParseFormat.replace('{format}', hydrationFile.format.toUpperCase()))
            : null,
        phase: event.phase ?? null,
        message: event.message ?? null,
        progressMode: 'percent',
        progressPercent: nextProgressPercent,
        loadedCount: null,
        totalCount: null,
      };

      if (
        currentDocumentLoadState.status !== nextDocumentLoadState.status ||
        currentDocumentLoadState.fileName !== nextDocumentLoadState.fileName ||
        currentDocumentLoadState.format !== nextDocumentLoadState.format ||
        currentDocumentLoadState.error !== nextDocumentLoadState.error ||
        currentDocumentLoadState.phase !== nextDocumentLoadState.phase ||
        currentDocumentLoadState.message !== nextDocumentLoadState.message ||
        currentDocumentLoadState.progressMode !== nextDocumentLoadState.progressMode ||
        currentDocumentLoadState.progressPercent !== nextDocumentLoadState.progressPercent ||
        currentDocumentLoadState.loadedCount !== nextDocumentLoadState.loadedCount ||
        currentDocumentLoadState.totalCount !== nextDocumentLoadState.totalCount
      ) {
        setDocumentLoadState(nextDocumentLoadState);
      }
    };

    let hydration: ReturnType<typeof startUsdRobotStateHydration>;
    try {
      hydration = startUsdRobotStateHydration({
        sourceFile: hydrationFile,
        availableFiles: useAssetsStore.getState().availableFiles,
        assets: useAssetsStore.getState().assets,
        signal: controller.signal,
        onDeferredSceneSnapshot: (snapshot, stageSourcePath) => {
          if (cancelled) {
            return;
          }
          const liveAssetsState = useAssetsStore.getState();
          const liveSelectedFile = liveAssetsState.selectedFile;
          if (liveSelectedFile?.format !== 'usd' || liveSelectedFile.name !== hydrationFile.name) {
            return;
          }
          if (
            !shouldApplyUsdStageHydration({
              pendingFileName: liveSelectedFile.name,
              selectedFileName: liveSelectedFile.name,
              stageSourcePath,
            })
          ) {
            return;
          }
          liveAssetsState.setUsdSceneSnapshot(liveSelectedFile.name, snapshot);
        },
        onEvent: (event) => {
          if (event.type === 'document-load') {
            commitHydrationLoadEvent(event.event);
          }
        },
      });
    } catch (error) {
      pendingUsdHydrationFileRef.current = null;
      const reason = error instanceof Error ? error.message : String(error);
      scheduleFailFastInDev(
        'useUsdDocumentLifecycle:startUsdRobotStateHydration:init',
        error instanceof Error
          ? error
          : new Error(`Failed to start USD RobotState hydration for "${hydrationFile.name}".`),
      );
      setDocumentLoadState({
        status: 'error',
        fileName: hydrationFile.name,
        format: hydrationFile.format,
        error: reason,
        phase: null,
        message: null,
        progressMode: 'percent',
        progressPercent: 0,
        loadedCount: null,
        totalCount: null,
      });
      return;
    }

    void hydration.promise
      .then((result) => {
        if (cancelled) {
          return;
        }

        const liveAssetsState = useAssetsStore.getState();
        const liveSelectedFile = liveAssetsState.selectedFile;
        if (liveSelectedFile?.format !== 'usd' || liveSelectedFile.name !== hydrationFile.name) {
          return;
        }

        const pendingHydrationFileName =
          pendingUsdHydrationFileRef.current ??
          (liveAssetsState.documentLoadState.status === 'hydrating'
            ? liveAssetsState.documentLoadState.fileName
            : null);
        if (
          !shouldApplyUsdStageHydration({
            pendingFileName: pendingHydrationFileName,
            selectedFileName: liveSelectedFile.name,
            stageSourcePath: result.resolution.stageSourcePath,
          })
        ) {
          return;
        }

        const normalizedSelectedFileName = normalizeUsdPersistenceFileName(liveSelectedFile.name);
        const normalizedStageSourcePath = normalizeUsdPersistenceFileName(
          result.resolution.stageSourcePath,
        );
        const robotSnapshot = createRobotSemanticSnapshot(result.robotData);

        liveAssetsState.setUsdSceneSnapshot(liveSelectedFile.name, result.sceneSnapshot);
        liveAssetsState.setUsdPreparedExportCache(liveSelectedFile.name, result.preparedCache);
        usdPersistenceBaselineRef.current = {
          fileName: normalizedSelectedFileName,
          robotSnapshot,
          hadPreparedExportCache: true,
        };

        setRobot(result.robotData, {
          resetHistory: true,
          label: 'Hydrate USD stage',
        });
        setSelection(
          resolveUsdStageHydrationSelection({
            currentSelection: useSelectionStore.getState().selection,
            robotData: result.robotData,
          }),
        );
        markUnsavedChangesBaselineSaved('robot');
        pendingUsdHydrationFileRef.current = null;
        recordUsdStageLoadDebug({
          sourceFileName: normalizedSelectedFileName,
          step: 'commit-worker-robot-data',
          status: 'resolved',
          timestamp: Date.now(),
          detail: {
            selectedFileName: normalizedSelectedFileName,
            stageSourcePath: normalizedStageSourcePath || null,
            linkCount: Object.keys(result.robotData.links || {}).length,
            jointCount: Object.keys(result.robotData.joints || {}).length,
            linkIdByPathCount: Object.keys(result.resolution.linkIdByPath || {}).length,
            childLinkPathByJointIdCount: Object.keys(
              result.resolution.childLinkPathByJointId || {},
            ).length,
            metadataSource: result.sceneSnapshot.robotMetadataSnapshot?.source ?? null,
            commitMode: 'reset-history',
            rendererMode: 'offscreen-worker-robotstate',
          },
        });
        setDocumentLoadState({
          status: 'ready',
          fileName: liveSelectedFile.name,
          format: liveSelectedFile.format,
          error: null,
          phase: 'ready',
          message: null,
          progressMode: 'percent',
          progressPercent: 100,
          loadedCount: null,
          totalCount: null,
        });

        const pendingUsdAssemblyFile = pendingUsdAssemblyFileRef.current;
        if (pendingUsdAssemblyFile?.name !== liveSelectedFile.name) {
          return;
        }

        pendingUsdAssemblyFileRef.current = null;
        void insertAssemblyComponentIntoWorkspace(pendingUsdAssemblyFile, {
          preResolvedRobotData: result.robotData,
        })
          .then((component) => {
            showToast(labels.addedComponent.replace('{name}', component.name), 'success');
            updateProModeRoundtripBaseline(
              isGeneratedWorkspaceUrdfFileName(pendingUsdAssemblyFile.name)
                ? pendingUsdAssemblyFile.name
                : null,
            );
          })
          .catch((error) => {
            scheduleFailFastInDev(
              'useUsdDocumentLifecycle:startUsdRobotStateHydration:prepareAssemblyComponent',
              error instanceof Error
                ? error
                : new Error(
                    `Failed to prepare assembly component "${pendingUsdAssemblyFile.name}".`,
                  ),
            );
            showToast(`Failed to add assembly component: ${pendingUsdAssemblyFile.name}`, 'info');
          })
          .finally(() => {
            clearAssemblyComponentPreparationOverlay();
          });
      })
      .catch((error) => {
        if (cancelled || controller.signal.aborted) {
          return;
        }

        pendingUsdHydrationFileRef.current = null;
        const reason = error instanceof Error ? error.message : String(error);
        scheduleFailFastInDev(
          'useUsdDocumentLifecycle:startUsdRobotStateHydration',
          error instanceof Error
            ? error
            : new Error(`Failed to hydrate USD RobotState for "${hydrationFile.name}": ${reason}`),
        );
        setDocumentLoadState({
          status: 'error',
          fileName: hydrationFile.name,
          format: hydrationFile.format,
          error: reason,
          phase: null,
          message: null,
          progressMode: 'percent',
          progressPercent: 0,
          loadedCount: null,
          totalCount: null,
        });

        if (pendingUsdAssemblyFileRef.current?.name === hydrationFile.name) {
          pendingUsdAssemblyFileRef.current = null;
          clearAssemblyComponentPreparationOverlay();
        }
      });

    return () => {
      cancelled = true;
      controller.abort(new Error(`USD RobotState hydration for "${hydrationFile.name}" was cancelled.`));
      hydration.cleanup();
    };
  }, [
    clearAssemblyComponentPreparationOverlay,
    insertAssemblyComponentIntoWorkspace,
    isSelectedUsdHydrating,
    labels.addedComponent,
    labels.failedToParseFormat,
    pendingUsdAssemblyFileRef,
    selectedFile,
    setDocumentLoadState,
    setRobot,
    setSelection,
    showToast,
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
