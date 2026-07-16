/**
 * Main App Component
 * Root component that assembles app workflows and overlay layers.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Providers } from './Providers';
import { AppLayout } from './AppLayout';
import type { AppContentProps, AppExposedActions } from './appExtensions';
import {
  AppOverlayLayer,
  type DisconnectedWorkspaceUrdfDialogState,
} from './components/AppOverlayLayer';
import { useAppShellState } from './hooks/useAppShellState';
import { useFileImport } from './hooks/useFileImport';
import { useFileExport } from './hooks/useFileExport';
import { useImportInputBinding } from './hooks/useImportInputBinding';
import { useUnsavedChangesPrompt } from './hooks/useUnsavedChangesPrompt';
import { usePluginLaunch } from './hooks/usePluginLaunch';
import { useRegressionDebugApi } from './hooks/useRegressionDebugApi';
import { resolveRobotFileDataWithWorker } from './hooks/robotImportWorkerBridge';
import {
  preserveDocumentLoadProgressForSameFile,
  shouldReuseResolvedMjcfViewerRuntime,
  shouldCommitResolvedRobotSelection,
} from './utils/documentLoadFlow';
import { peekPreResolvedRobotImport } from './utils/preResolvedRobotImportCache';
import { prewarmUsdSelectionInBackground } from './utils/usdSelectionPrewarm';
import { scheduleUsdRuntimeStartupIdlePrewarm } from './utils/usdRuntimeStartupPrewarm';
import { scheduleSourceCodeEditorStartupIdlePrewarm } from './utils/sourceCodeEditorStartupPrewarm';
import {
  cancelPendingUsdWorkspaceLoad,
  commitResolvedRobotLoad,
  getPendingUsdWorkspaceLoad,
  type CommitResolvedRobotLoadOutcome,
  type WorkspaceLoadIntent,
} from './utils/commitResolvedRobotLoad';
import { resolveUsdViewerRoundtripSelection } from './utils/usdViewerRoundtripSelection';
import { resolveExportErrorMessage } from './utils/exportErrorMessage';
import {
  mapRobotImportProgressToDocumentLoadPercent,
  resolveBootstrapDocumentLoadPhase,
  resolveRobotImportCompletedDocumentLoadPercent,
} from './utils/documentLoadProgress';
import {
  buildStandaloneImportAssetWarning,
  canProceedWithStandaloneImportAssetWarning,
  collectStandaloneImportSupportAssetPaths,
} from './utils/importPackageAssetReferences';
import { useUIStore, useAssetsStore } from '@/store';
import type { InspectionReport, RobotFile, RobotState } from '@/types';
import type { RobotImportResult } from '@/core/parsers/importRobotFile';
import { resolveMJCFSource } from '@/core/parsers/mjcf/mjcfSourceResolver';
import { translations } from '@/shared/i18n';
import type { ExportDialogConfig, ExportProgressState } from '@/features/file-io';
import type { ImportPreparationOverlayState } from './hooks/useFileImport';
import { useAssetImportFromUrl } from './hooks/useAssetImportFromUrl';
import {
  loadAIConversationConnectorModule,
  loadAIInspectionConnectorModule,
  loadDisconnectedWorkspaceUrdfExportDialogModule,
  loadExportDialogConnectorModule,
  loadExportProgressDialogModule,
} from './components/lazyAppOverlays';
import { logRegressionInfo, logRegressionWarn } from '@/shared/debug/consoleDiagnostics';
import { markUnsavedChangesBaselineSaved } from './utils/unsavedChangesBaseline';
import type {
  AIConversationFocusedIssue,
  AIConversationLaunchContext,
  AIConversationMode,
  AIConversationSelection,
} from '@/features/ai-assistant';
import type { ExportTarget } from './hooks/file-export/types';
import {
  createConversationLaunchContext,
  resolveCurrentAIRobotSnapshot,
} from './utils/aiConversationLaunch';
import { waitForNextPaint } from './utils/waitForNextPaint';
import { waitForAnimationFrame } from './utils/waitForAnimationFrame';

export function AppContent({ extensions, onExposeActions }: AppContentProps = {}) {
  useUnsavedChangesPrompt();

  // Refs for file inputs
  const importInputRef = useRef<HTMLInputElement>(null);
  const importFolderInputRef = useRef<HTMLInputElement>(null);
  const loadRobotByNameRef = useRef<
    | ((
        file: RobotFile,
        options?: { forceReload?: boolean; intent?: WorkspaceLoadIntent },
      ) => Promise<CommitResolvedRobotLoadOutcome | null> | CommitResolvedRobotLoadOutcome | null)
    | null
  >(null);
  const loadRequestIdRef = useRef(0);
  const aiConversationSessionIdRef = useRef(0);
  const [shouldRenderAIInspectionModal, setShouldRenderAIInspectionModal] = useState(false);
  const [shouldRenderAIConversationModal, setShouldRenderAIConversationModal] = useState(false);
  const [aiConversationLaunchContext, setAIConversationLaunchContext] =
    useState<AIConversationLaunchContext | null>(null);
  const [exportDialogTarget, setExportDialogTarget] = useState<ExportTarget>({
    type: 'current',
  });
  const [disconnectedWorkspaceUrdfDialog, setDisconnectedWorkspaceUrdfDialog] =
    useState<DisconnectedWorkspaceUrdfDialogState | null>(null);
  const [isDisconnectedWorkspaceUrdfExporting, setIsDisconnectedWorkspaceUrdfExporting] =
    useState(false);
  const [viewerReloadKey, setViewerReloadKey] = useState(0);
  const [importPreparationOverlay, setImportPreparationOverlay] =
    useState<ImportPreparationOverlayState | null>(null);

  // UI Store
  const { lang, setAppMode, openSettings, isSettingsOpen } = useUIStore(
    useShallow((state) => ({
      lang: state.lang,
      setAppMode: state.setAppMode,
      openSettings: state.openSettings,
      isSettingsOpen: state.isSettingsOpen,
    })),
  );
  const t = translations[lang];

  // Assets Store
  const setDocumentLoadState = useAssetsStore((state) => state.setDocumentLoadState);

  const {
    toast,
    closeToast,
    showToast,
    isAIInspectionOpen,
    setIsAIInspectionOpen,
    isAIConversationOpen,
    setIsAIConversationOpen,
    setAILaunchMode,
    openAIInspection,
    openAIConversation,
    isCodeViewerOpen,
    setIsCodeViewerOpen,
    isExportDialogOpen,
    setIsExportDialogOpen,
    isExporting,
    setIsExporting,
    projectExportProgress,
    setProjectExportProgress,
    viewConfig,
    setViewConfig,
  } = useAppShellState();

  const applyResolvedRobotImport = useCallback(
    (file: RobotFile, importResult: RobotImportResult) => {
      if (importResult.status === 'ready' || importResult.status === 'needs_hydration') {
        const currentDocumentLoadState = useAssetsStore.getState().documentLoadState;
        setDocumentLoadState(
          preserveDocumentLoadProgressForSameFile({
            currentState: currentDocumentLoadState,
            nextState: {
              status: importResult.status === 'needs_hydration' ? 'hydrating' : 'loading',
              fileName: file.name,
              format: file.format,
              error: null,
              phase:
                importResult.status === 'needs_hydration'
                  ? 'checking-path'
                  : file.format === 'usd'
                    ? 'checking-path'
                    : 'preparing-scene',
              message: null,
              progressMode: 'percent',
              progressPercent: resolveRobotImportCompletedDocumentLoadPercent(file.format),
              loadedCount: null,
              totalCount: null,
            },
          }),
        );
        return;
      }

      if (importResult.reason === 'source_only_fragment') {
        setDocumentLoadState({
          status: 'ready',
          fileName: file.name,
          format: file.format,
          error: null,
          phase: null,
          message: t.xacroSourceOnlyPreviewHint,
          progressPercent: 100,
          loadedCount: null,
          totalCount: null,
        });
        logRegressionInfo(`[urdf-studio] ${t.xacroSourceOnlyPreviewHint}`);
        return;
      }

      const message =
        importResult.message ??
        t.failedToParseFormat.replace('{format}', file.format.toUpperCase());
      setDocumentLoadState({
        status: 'error',
        fileName: file.name,
        format: file.format,
        error: message,
      });
      showToast(message, 'info');
    },
    [setDocumentLoadState, showToast, t],
  );

  // Keep one internal loader so debug automation can force a reload of the
  // currently selected file without changing normal click behavior.
  const loadRobotFile = useCallback(
    async (
      requestedFile: RobotFile,
      options?: { forceReload?: boolean; intent?: WorkspaceLoadIntent },
    ) => {
      if ((options?.intent ?? 'replace') === 'replace') {
        const pendingUsdLoad = getPendingUsdWorkspaceLoad();
        if (pendingUsdLoad) {
          cancelPendingUsdWorkspaceLoad(pendingUsdLoad.operationId, {
            restoreDocumentSession: true,
          });
        }
      }
      const liveAssetsState = useAssetsStore.getState();
      const previousDocumentLoadState = structuredClone(
        liveAssetsState.documentLoadState,
      );
      const file = resolveUsdViewerRoundtripSelection(
        requestedFile,
        liveAssetsState.availableFiles,
      );
      const currentSelectedFile = liveAssetsState.selectedFile;
      const preResolvedImportResult = peekPreResolvedRobotImport(file);

      const standaloneImportAssetWarning =
        preResolvedImportResult?.status === 'ready'
          ? null
          : buildStandaloneImportAssetWarning(
              file,
              collectStandaloneImportSupportAssetPaths(
                liveAssetsState.assets,
                liveAssetsState.availableFiles,
              ),
              {
                allFileContents: liveAssetsState.allFileContents,
                availableFiles: liveAssetsState.availableFiles,
                sourcePath: file.name,
              },
            );
      if (standaloneImportAssetWarning) {
        const assetLabel =
          standaloneImportAssetWarning.missingAssetPaths.length > 3
            ? `${standaloneImportAssetWarning.missingAssetPaths.slice(0, 3).join(', ')}, …`
            : standaloneImportAssetWarning.missingAssetPaths.join(', ');
        const message = t.importPackageAssetBundleHint
          .replace('{packages}', assetLabel)
          .replace('{assets}', assetLabel);
        logRegressionWarn(`[urdf-studio] ${message}`);
        if (!canProceedWithStandaloneImportAssetWarning(file)) {
          setDocumentLoadState({
            status: 'error',
            fileName: file.name,
            format: file.format,
            error: message,
          });
          return null;
        }
      }

      const currentResolvedMjcfSource =
        currentSelectedFile?.format === 'mjcf'
          ? resolveMJCFSource(currentSelectedFile, liveAssetsState.availableFiles)
          : null;
      const nextResolvedMjcfSource =
        file.format === 'mjcf' ? resolveMJCFSource(file, liveAssetsState.availableFiles) : null;
      const shouldReloadViewer =
        options?.forceReload ||
        !shouldReuseResolvedMjcfViewerRuntime({
          currentSelectedFile,
          nextFile: file,
          currentResolvedSource: currentResolvedMjcfSource
            ? {
                effectiveFileName: currentResolvedMjcfSource.effectiveFile.name,
                content: currentResolvedMjcfSource.content,
              }
            : null,
          nextResolvedSource: nextResolvedMjcfSource
            ? {
                effectiveFileName: nextResolvedMjcfSource.effectiveFile.name,
                content: nextResolvedMjcfSource.content,
              }
            : null,
        });

      setDocumentLoadState(
        preserveDocumentLoadProgressForSameFile({
          currentState: liveAssetsState.documentLoadState,
          nextState: {
            status: 'loading',
            fileName: file.name,
            format: file.format,
            error: null,
            phase: resolveBootstrapDocumentLoadPhase(file.format),
            message: null,
            progressMode: 'percent',
            progressPercent: 0,
            loadedCount: null,
            totalCount: null,
          },
        }),
      );
      const requestId = ++loadRequestIdRef.current;

      prewarmUsdSelectionInBackground(file, liveAssetsState.availableFiles, liveAssetsState.assets);

      if (preResolvedImportResult) {
        await waitForNextPaint();
        if (requestId !== loadRequestIdRef.current) {
          return null;
        }

        const loadOutcome = shouldCommitResolvedRobotSelection(preResolvedImportResult)
          ? commitResolvedRobotLoad({
              currentAppMode: useUIStore.getState().appMode,
              file,
              importResult: preResolvedImportResult,
              intent: options?.intent,
              markWorkspaceBaselineSaved: markUnsavedChangesBaselineSaved,
              onViewerReload: () => setViewerReloadKey((value) => value + 1),
              previousDocumentLoadState,
              reloadViewer: shouldReloadViewer,
              setAppMode,
            })
          : null;
        applyResolvedRobotImport(file, preResolvedImportResult);
        if (
          !shouldReloadViewer &&
          preResolvedImportResult.status === 'ready' &&
          file.format === 'mjcf'
        ) {
          setDocumentLoadState({
            status: 'ready',
            fileName: file.name,
            format: file.format,
            error: null,
            phase: 'ready',
            message: null,
            progressMode: 'percent',
            progressPercent: 100,
            loadedCount: null,
            totalCount: null,
          });
        }
        return loadOutcome;
      }

      const importResultPromise = resolveRobotFileDataWithWorker(
        file,
        {
          availableFiles: liveAssetsState.availableFiles,
          assets: liveAssetsState.assets,
          allFileContents: liveAssetsState.allFileContents,
          // Fresh USD loads must go through worker hydration instead of short-
          // circuiting through any previously prepared cache for the same path.
          usdRobotData:
            file.format === 'usd'
              ? null
              : (liveAssetsState.getUsdPreparedExportCache(file.name)?.robotData ?? null),
        },
        {
          onProgress: (progress) => {
            if (requestId !== loadRequestIdRef.current) {
              return;
            }

            const currentDocumentLoadState = useAssetsStore.getState().documentLoadState;
            const isIndeterminateProgress = progress.progressMode === 'indeterminate';
            const isCurrentFileLoading =
              currentDocumentLoadState.fileName === file.name &&
              (currentDocumentLoadState.status === 'loading' ||
                currentDocumentLoadState.status === 'hydrating');
            let nextProgressPercent: number | null;
            if (isIndeterminateProgress) {
              nextProgressPercent = isCurrentFileLoading
                ? (currentDocumentLoadState.progressPercent ?? null)
                : null;
            } else {
              const mappedProgressPercent = mapRobotImportProgressToDocumentLoadPercent(
                file.format,
                progress,
              );
              nextProgressPercent = isCurrentFileLoading
                ? Math.max(currentDocumentLoadState.progressPercent ?? 0, mappedProgressPercent)
                : mappedProgressPercent;
            }

            setDocumentLoadState({
              status: 'loading',
              fileName: file.name,
              format: file.format,
              error: null,
              phase: resolveBootstrapDocumentLoadPhase(file.format),
              message: progress.message ?? null,
              progressMode: isIndeterminateProgress ? 'indeterminate' : 'percent',
              progressPercent: nextProgressPercent,
              loadedCount: null,
              totalCount: null,
            });
          },
        },
      );

      await waitForNextPaint();

      let importResult: Awaited<ReturnType<typeof resolveRobotFileDataWithWorker>>;
      try {
        importResult = await importResultPromise;
      } catch (error) {
        if (requestId !== loadRequestIdRef.current) {
          return null;
        }

        const message =
          error instanceof Error
            ? error.message
            : t.failedToParseFormat.replace('{format}', file.format.toUpperCase());
        setDocumentLoadState({
          status: 'error',
          fileName: file.name,
          format: file.format,
          error: message,
        });
        showToast(message, 'info');
        return null;
      }

      if (requestId !== loadRequestIdRef.current) {
        return null;
      }

      const loadOutcome = shouldCommitResolvedRobotSelection(importResult)
        ? commitResolvedRobotLoad({
            currentAppMode: useUIStore.getState().appMode,
            file,
            importResult,
            intent: options?.intent,
            markWorkspaceBaselineSaved: markUnsavedChangesBaselineSaved,
            onViewerReload: () => setViewerReloadKey((value) => value + 1),
            previousDocumentLoadState,
            reloadViewer: shouldReloadViewer,
            setAppMode,
          })
        : null;
      applyResolvedRobotImport(file, importResult);
      if (!shouldReloadViewer && importResult.status === 'ready' && file.format === 'mjcf') {
        setDocumentLoadState({
          status: 'ready',
          fileName: file.name,
          format: file.format,
          error: null,
          phase: 'ready',
          message: null,
          progressMode: 'percent',
          progressPercent: 100,
          loadedCount: null,
          totalCount: null,
        });
      }
      return loadOutcome;
    },
    [
      applyResolvedRobotImport,
      setDocumentLoadState,
      setAppMode,
      setViewerReloadKey,
      showToast,
      t,
    ],
  );

  const handleLoadRobot = useCallback(
    (file: RobotFile, options?: { intent?: WorkspaceLoadIntent }) => {
      return loadRobotFile(file, options);
    },
    [loadRobotFile],
  );

  loadRobotByNameRef.current = loadRobotFile;

  useEffect(() => scheduleUsdRuntimeStartupIdlePrewarm(), []);
  useEffect(() => scheduleSourceCodeEditorStartupIdlePrewarm(), []);

  useRegressionDebugApi(loadRobotByNameRef);

  // File import/export hooks
  const { handleImport } = useFileImport({
    onLoadRobot: handleLoadRobot,
    onShowToast: showToast,
    onImportPreparationStateChange: setImportPreparationOverlay,
    onProjectImported: () => {
      setViewerReloadKey((value) => value + 1);
    },
  });
  const { importAssetFromBotWorld, ...botWorldImportState } = useAssetImportFromUrl({
    handleImport,
    onImportComplete: (success) => {
      if (success) {
        showToast(t.addedFilesToAssetLibrary.replace('{count}', '1'), 'success');
      }
    },
  });
  const {
    handleExportProject: runProjectExport,
    handleExportWithConfig,
    handleExportDisconnectedWorkspaceUrdfBundle,
  } = useFileExport();
  const projectExportInFlightRef = useRef(false);

  const handleExportProject = useCallback(() => {
    if (projectExportInFlightRef.current || isExporting) {
      return;
    }

    projectExportInFlightRef.current = true;
    void (async () => {
      void loadExportProgressDialogModule();
      setIsExporting(true);
      setProjectExportProgress({
        stepLabel: t.exportProgressPreparing,
        detail: t.exportProgressPreparingDetail,
        progress: 0.05,
        currentStep: 1,
        totalSteps: 6,
        indeterminate: true,
      });
      await waitForNextPaint();
      try {
        const result = await runProjectExport({
          onProgress: setProjectExportProgress,
        });
        if (result.partial && result.warnings.length > 0) {
          showToast(result.warnings[0], 'info');
        }
      } catch (error) {
        showToast(resolveExportErrorMessage(error, t), 'error');
      } finally {
        setProjectExportProgress(null);
        setIsExporting(false);
        projectExportInFlightRef.current = false;
      }
    })();
  }, [
    isExporting,
    runProjectExport,
    setIsExporting,
    setProjectExportProgress,
    showToast,
    t.exportFailedParse,
    t.exportProgressPreparing,
    t.exportProgressPreparingDetail,
  ]);

  // AI changes handler
  useImportInputBinding({
    importInputRef,
    importFolderInputRef,
    onImport: handleImport,
  });

  const ensureAIEntryAvailable = useCallback(() => {
    const liveAssetsState = useAssetsStore.getState();
    const currentSelectedFile = liveAssetsState.selectedFile;
    const currentDocumentLoadState = liveAssetsState.documentLoadState;
    const isSelectedUsdHydrating =
      currentSelectedFile?.format === 'usd' &&
      currentDocumentLoadState.status === 'hydrating' &&
      currentDocumentLoadState.fileName === currentSelectedFile.name;

    if (isSelectedUsdHydrating) {
      showToast(t.usdLoadInProgress, 'info');
      return false;
    }
    return true;
  }, [showToast, t.usdLoadInProgress]);

  const createConversationLaunchContextFromSnapshot = useCallback(
    (
      mode: AIConversationMode,
      robotSnapshot: RobotState,
      inspectionReportSnapshot: InspectionReport | null = null,
      options: {
        selectedEntity?: AIConversationSelection | null;
        focusedIssue?: AIConversationFocusedIssue | null;
      } = {},
    ) => {
      aiConversationSessionIdRef.current += 1;
      return createConversationLaunchContext({
        sessionId: aiConversationSessionIdRef.current,
        mode,
        robotSnapshot,
        inspectionReportSnapshot,
        selectedEntity: options.selectedEntity,
        focusedIssue: options.focusedIssue,
      });
    },
    [],
  );

  const handleOpenAIInspection = useCallback(() => {
    if (!ensureAIEntryAvailable()) {
      return;
    }

    setShouldRenderAIInspectionModal(true);
    void loadAIInspectionConnectorModule();
    openAIInspection();
  }, [ensureAIEntryAvailable, openAIInspection]);

  const handleOpenAIConversation = useCallback(() => {
    if (!ensureAIEntryAvailable()) {
      return;
    }

    if (aiConversationLaunchContext?.mode === 'general') {
      setShouldRenderAIConversationModal(true);
      void loadAIConversationConnectorModule();
      openAIConversation();
      return;
    }

    const launchContext = createConversationLaunchContextFromSnapshot(
      'general',
      resolveCurrentAIRobotSnapshot(),
    );

    setAIConversationLaunchContext(launchContext);
    setShouldRenderAIConversationModal(true);
    void loadAIConversationConnectorModule();
    openAIConversation();
  }, [
    aiConversationLaunchContext,
    createConversationLaunchContextFromSnapshot,
    ensureAIEntryAvailable,
    openAIConversation,
  ]);

  const handleOpenConversationWithReport = useCallback(
    (
      report: InspectionReport,
      robotSnapshot: RobotState,
      options: {
        selectedEntity?: AIConversationSelection | null;
        focusedIssue?: AIConversationFocusedIssue | null;
      } = {},
    ) => {
      if (!ensureAIEntryAvailable()) {
        return;
      }

      const launchContext = createConversationLaunchContextFromSnapshot(
        'inspection-followup',
        robotSnapshot,
        report,
        options,
      );

      setAIConversationLaunchContext(launchContext);
      setShouldRenderAIConversationModal(true);
      void loadAIConversationConnectorModule();
      setIsAIConversationOpen(true);
      setAILaunchMode('conversation');
    },
    [
      createConversationLaunchContextFromSnapshot,
      ensureAIEntryAvailable,
      setAILaunchMode,
      setIsAIConversationOpen,
    ],
  );

  const handleStartNewAIConversation = useCallback(
    (currentLaunchContext: AIConversationLaunchContext) => {
      const nextLaunchContext = createConversationLaunchContextFromSnapshot(
        currentLaunchContext.mode,
        currentLaunchContext.robotSnapshot,
        currentLaunchContext.inspectionReportSnapshot ?? null,
        {
          selectedEntity: currentLaunchContext.selectedEntity,
          focusedIssue: currentLaunchContext.focusedIssue,
        },
      );

      setAIConversationLaunchContext(nextLaunchContext);
    },
    [createConversationLaunchContextFromSnapshot],
  );

  const handleOpenExportDialog = useCallback(() => {
    void loadExportDialogConnectorModule();
    setExportDialogTarget({ type: 'current' });
    setIsExportDialogOpen(true);
  }, [setIsExportDialogOpen]);

  const handleOpenLibraryExportDialog = useCallback(
    (file: RobotFile) => {
      void loadExportDialogConnectorModule();
      setExportDialogTarget({ type: 'library-file', file });
      setIsExportDialogOpen(true);
    },
    [setIsExportDialogOpen],
  );

  const handleExportDialogExport = useCallback(
    async (
      config: ExportDialogConfig,
      options?: { onProgress?: (progress: ExportProgressState) => void },
    ) => {
      setIsExporting(true);
      await waitForAnimationFrame();
      try {
        const result =
          config.format === 'project'
            ? await runProjectExport({
                onProgress: options?.onProgress,
              })
            : await handleExportWithConfig(config, exportDialogTarget, {
                onProgress: options?.onProgress,
              });
        if (result.actionRequired?.type === 'disconnected-workspace-urdf') {
          void loadDisconnectedWorkspaceUrdfExportDialogModule();
          setDisconnectedWorkspaceUrdfDialog({
            config,
            request: result.actionRequired,
          });
          setIsExportDialogOpen(false);
          return;
        }
        if (result.partial && result.warnings.length > 0) {
          showToast(result.warnings[0], 'info');
        }
        setIsExportDialogOpen(false);
      } catch (error) {
        showToast(
          resolveExportErrorMessage(error, {
            exportFailedParse: t.exportFailedParse,
            exportUrdfBallJointUnsupported: t.exportUrdfBallJointUnsupported,
          }),
          'error',
        );
      } finally {
        setIsExporting(false);
      }
    },
    [
      exportDialogTarget,
      handleExportWithConfig,
      runProjectExport,
      setIsExportDialogOpen,
      setIsExporting,
      showToast,
      t.exportFailedParse,
      t.exportUrdfBallJointUnsupported,
    ],
  );

  // Expose internal actions to external consumers (ref keeps the reference fresh)
  const layoutActionsRef = useRef<{
    openIkTool: () => void;
    openCollisionOptimizer: () => void;
    openTool: (key: string) => void;
  }>({ openIkTool: () => {}, openCollisionOptimizer: () => {}, openTool: () => {} });
  const hasExposedLayoutActionsRef = useRef(false);

  const [layoutReady, setLayoutReady] = useState(false);

  const handleExportProjectBlob = useCallback(async (): Promise<Blob> => {
    const result = await runProjectExport({ skipDownload: true });
    if (!result.blob) {
      throw new Error('Project export did not produce an archive blob.');
    }
    return result.blob;
  }, [runProjectExport]);

  const handleCollectRawFilesBlob = useCallback(async (): Promise<Blob> => {
    const { collectRawFilesZip } = await import('@/features/file-io');
    const assetsState = useAssetsStore.getState();
    return collectRawFilesZip({
      assets: assetsState.assets,
      availableFiles: assetsState.availableFiles,
      allFileContents: assetsState.allFileContents,
      selectedFile: assetsState.selectedFile,
    });
  }, []);

  const exposedActionsRef = useRef<AppExposedActions | null>(null);
  exposedActionsRef.current = {
    importFiles: handleImport,
    openLibraryExport: handleOpenLibraryExportDialog,
    openAIInspection: handleOpenAIInspection,
    openAIConversation: handleOpenAIConversation,
    openIkTool: () => layoutActionsRef.current.openIkTool(),
    openCollisionOptimizer: () => layoutActionsRef.current.openCollisionOptimizer(),
    openTool: (key: string) => layoutActionsRef.current.openTool(key),
    exportProjectBlob: handleExportProjectBlob,
    collectRawFilesBlob: handleCollectRawFilesBlob,
  };

  useEffect(() => {
    onExposeActions?.(exposedActionsRef.current!);
  }, [onExposeActions]);

  // Plugin launch protocol: read ?plugin=<key> from URL and activate the tool
  usePluginLaunch(layoutReady ? layoutActionsRef.current.openTool : undefined);

  const handleExposeLayoutActions = useCallback(
    (actions: {
      openIkTool: () => void;
      openCollisionOptimizer: () => void;
      openTool: (key: string) => void;
    }) => {
      layoutActionsRef.current = actions;
      if (hasExposedLayoutActionsRef.current) {
        return;
      }

      hasExposedLayoutActionsRef.current = true;
      setLayoutReady(true);
    },
    [],
  );

  const handleConfirmDisconnectedWorkspaceUrdfExport = useCallback(async () => {
    if (!disconnectedWorkspaceUrdfDialog) {
      return;
    }

    setIsDisconnectedWorkspaceUrdfExporting(true);
    try {
      const result = await handleExportDisconnectedWorkspaceUrdfBundle(
        disconnectedWorkspaceUrdfDialog.config,
      );
      if (result.partial && result.warnings.length > 0) {
        showToast(result.warnings[0], 'info');
      }
      setDisconnectedWorkspaceUrdfDialog(null);
    } catch (error) {
      showToast(resolveExportErrorMessage(error, t), 'error');
    } finally {
      setIsDisconnectedWorkspaceUrdfExporting(false);
    }
  }, [
    disconnectedWorkspaceUrdfDialog,
    handleExportDisconnectedWorkspaceUrdfBundle,
    showToast,
    t.exportFailedParse,
  ]);

  const loadingLabel = t.loadingPanel;

  return (
    <>
      <AppLayout
        importInputRef={importInputRef}
        importFolderInputRef={importFolderInputRef}
        onFileDrop={(files) => {
          void handleImport(files);
        }}
        onOpenExport={handleOpenExportDialog}
        onOpenLibraryExport={handleOpenLibraryExportDialog}
        onExportProject={handleExportProject}
        isExportingProject={isExporting}
        showToast={showToast}
        onOpenAIInspection={handleOpenAIInspection}
        onOpenAIConversation={handleOpenAIConversation}
        isCodeViewerOpen={isCodeViewerOpen}
        setIsCodeViewerOpen={setIsCodeViewerOpen}
        onOpenSettings={() => openSettings()}
        viewConfig={viewConfig}
        setViewConfig={setViewConfig}
        onLoadRobot={handleLoadRobot}
        viewerReloadKey={viewerReloadKey}
        importPreparationOverlay={importPreparationOverlay}
        headerQuickAction={extensions?.config?.headerQuickAction}
        headerSecondaryAction={extensions?.config?.headerSecondaryAction}
        extensionToolboxItems={extensions?.config?.toolboxItems}
        onExposeLayoutActions={handleExposeLayoutActions}
      />

      <AppOverlayLayer
        aiConversationLaunchContext={aiConversationLaunchContext}
        botWorldImportState={botWorldImportState}
        closeToast={closeToast}
        disconnectedWorkspaceUrdfDialog={disconnectedWorkspaceUrdfDialog}
        exportDialogTarget={exportDialogTarget}
        extensions={extensions}
        handleConfirmDisconnectedWorkspaceUrdfExport={handleConfirmDisconnectedWorkspaceUrdfExport}
        handleExportDialogExport={handleExportDialogExport}
        handleOpenConversationWithReport={handleOpenConversationWithReport}
        handleStartNewAIConversation={handleStartNewAIConversation}
        isAIConversationOpen={isAIConversationOpen}
        isAIInspectionOpen={isAIInspectionOpen}
        isDisconnectedWorkspaceUrdfExporting={isDisconnectedWorkspaceUrdfExporting}
        isExportDialogOpen={isExportDialogOpen}
        isExporting={isExporting}
        isSettingsOpen={isSettingsOpen}
        lang={lang}
        loadingLabel={loadingLabel}
        projectExportProgress={projectExportProgress}
        setDisconnectedWorkspaceUrdfDialog={setDisconnectedWorkspaceUrdfDialog}
        setIsAIConversationOpen={setIsAIConversationOpen}
        setIsAIInspectionOpen={setIsAIInspectionOpen}
        setIsExportDialogOpen={setIsExportDialogOpen}
        shouldRenderAIConversationModal={shouldRenderAIConversationModal}
        shouldRenderAIInspectionModal={shouldRenderAIInspectionModal}
        toast={toast}
      />
    </>
  );
}

export default function App() {
  return (
    <Providers>
      <AppContent />
    </Providers>
  );
}
