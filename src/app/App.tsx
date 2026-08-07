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
import { useRobotLoadWorkflow } from './hooks/useRobotLoadWorkflow';
import { scheduleUsdRuntimeStartupIdlePrewarm } from './utils/usdRuntimeStartupPrewarm';
import { resolveExportErrorMessage } from './utils/exportErrorMessage';
import { useUIStore, useAssetsStore } from '@/store';
import type { InspectionReport, RobotFile, RobotState } from '@/types';
import { translations } from '@/shared/i18n';
import type { ExportDialogConfig, ExportFormat, ExportProgressState } from '@/features/file-io';
import { EXPORT_FORMATS } from '@/features/file-io/components/ExportDialog/config';
import type { ImportPreparationOverlayState } from './hooks/useFileImport';
import { useAssetImportFromUrl } from './hooks/useAssetImportFromUrl';
import {
  preloadAIConversationConnector,
  preloadAIInspectionConnector,
  preloadDisconnectedWorkspaceUrdfExportDialog,
  loadExportDialogConnectorModule,
  preloadExportDialogConnector,
  preloadExportProgressDialog,
  preloadSettingsModal,
} from './components/lazyAppOverlays';
import { resolveCurrentAIRobotSnapshot } from '@/features/ai-assistant/utils/aiConversationRobotSnapshot';
import type {
  AIConversationFocusedIssue,
  AIConversationLaunchContext,
  AIConversationMode,
  AIConversationSelection,
} from '@/features/ai-assistant';
import type { ExportTarget } from './hooks/file-export/types';
import { createConversationLaunchContext } from './utils/aiConversationLaunch';
import { applyAIUrdfModification } from './utils/applyAIUrdfModification';
import { waitForNextPaint } from './utils/waitForNextPaint';
import { waitForAnimationFrame } from './utils/waitForAnimationFrame';
import { logRegressionError } from '@/shared/debug/consoleDiagnostics';

function preloadOverlay(label: string, preload: () => Promise<unknown>): void {
  void preload().catch((error: unknown) => {
    logRegressionError(`[App] Failed to preload ${label}:`, error);
  });
}

export function AppContent({ extensions, onExposeActions }: AppContentProps = {}) {
  useUnsavedChangesPrompt();

  // Refs for file inputs
  const importInputRef = useRef<HTMLInputElement>(null);
  const importFolderInputRef = useRef<HTMLInputElement>(null);
  const aiConversationSessionIdRef = useRef(0);
  const [shouldRenderAIInspectionModal, setShouldRenderAIInspectionModal] = useState(false);
  const [shouldRenderAIConversationModal, setShouldRenderAIConversationModal] = useState(false);
  const [aiConversationLaunchContext, setAIConversationLaunchContext] =
    useState<AIConversationLaunchContext | null>(null);
  const [exportDialogTarget, setExportDialogTarget] = useState<ExportTarget>({
    type: 'current',
  });
  // Initial export format to preselect (set by a `convertTo` handoff). Undefined
  // → the connector falls back to its default ('mjcf').
  const [exportDialogDefaultFormat, setExportDialogDefaultFormat] = useState<
    ExportFormat | undefined
  >(undefined);
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

  const handleViewerReload = useCallback(() => {
    setViewerReloadKey((value) => value + 1);
  }, []);
  const { loadRobotFile: handleLoadRobot, loadRobotFileRef: loadRobotByNameRef } =
    useRobotLoadWorkflow({
      labels: {
        failedToParseFormat: t.failedToParseFormat,
        importedRobotRecovered: t.importedRobotRecovered,
        importPackageAssetBundleHint: t.importPackageAssetBundleHint,
        xacroSourceOnlyPreviewHint: t.xacroSourceOnlyPreviewHint,
      },
      onViewerReload: handleViewerReload,
      setAppMode,
      showToast,
    });

  useEffect(() => scheduleUsdRuntimeStartupIdlePrewarm(), []);

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
    onConvertToRequest: ({ convertTo, success }) => {
      // Asset was downloaded+imported; on success open the export dialog
      // preselected to the requested format so the user can export/convert.
      if (!success) return;
      if (!EXPORT_FORMATS.includes(convertTo as (typeof EXPORT_FORMATS)[number])) return;
      setExportDialogDefaultFormat(convertTo as ExportFormat);
      setExportDialogTarget({ type: 'current' });
      void loadExportDialogConnectorModule();
      setIsExportDialogOpen(true);
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
      preloadOverlay('export progress dialog', preloadExportProgressDialog);
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
    preloadOverlay('AI inspection connector', preloadAIInspectionConnector);
    openAIInspection();
  }, [ensureAIEntryAvailable, openAIInspection]);

  const handlePrefetchAIInspection = useCallback(() => {
    preloadOverlay('AI inspection connector', preloadAIInspectionConnector);
  }, []);

  const handleOpenAIConversation = useCallback(() => {
    if (!ensureAIEntryAvailable()) {
      return;
    }

    if (aiConversationLaunchContext?.mode === 'general') {
      setShouldRenderAIConversationModal(true);
      preloadOverlay('AI conversation connector', preloadAIConversationConnector);
      openAIConversation();
      return;
    }

    const launchContext = createConversationLaunchContextFromSnapshot(
      'general',
      resolveCurrentAIRobotSnapshot(),
    );

    setAIConversationLaunchContext(launchContext);
    setShouldRenderAIConversationModal(true);
    preloadOverlay('AI conversation connector', preloadAIConversationConnector);
    openAIConversation();
  }, [
    aiConversationLaunchContext,
    createConversationLaunchContextFromSnapshot,
    ensureAIEntryAvailable,
    openAIConversation,
  ]);

  const handlePrefetchAIConversation = useCallback(() => {
    preloadOverlay('AI conversation connector', preloadAIConversationConnector);
  }, []);

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
      preloadOverlay('AI conversation connector', preloadAIConversationConnector);
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
        resolveCurrentAIRobotSnapshot(),
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
    preloadOverlay('export dialog connector', preloadExportDialogConnector);
    void loadExportDialogConnectorModule();
    setExportDialogDefaultFormat(undefined);
    setExportDialogTarget({ type: 'current' });
    setIsExportDialogOpen(true);
  }, [setIsExportDialogOpen]);

  const handlePrefetchExportDialog = useCallback(() => {
    preloadOverlay('export dialog connector', preloadExportDialogConnector);
  }, []);

  const handleOpenLibraryExportDialog = useCallback(
    (file: RobotFile) => {
      preloadOverlay('export dialog connector', preloadExportDialogConnector);
      setExportDialogDefaultFormat(undefined);
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
          preloadOverlay(
            'disconnected workspace export dialog',
            preloadDisconnectedWorkspaceUrdfExportDialog,
          );
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

  const handleOpenSettings = useCallback(() => {
    preloadOverlay('settings modal', preloadSettingsModal);
    openSettings();
  }, [openSettings]);

  const handlePrefetchSettings = useCallback(() => {
    preloadOverlay('settings modal', preloadSettingsModal);
  }, []);

  return (
    <>
      <AppLayout
        importInputRef={importInputRef}
        importFolderInputRef={importFolderInputRef}
        onFileDrop={(files) => {
          void handleImport(files);
        }}
        onOpenExport={handleOpenExportDialog}
        onPrefetchExport={handlePrefetchExportDialog}
        onOpenLibraryExport={handleOpenLibraryExportDialog}
        onExportProject={handleExportProject}
        isExportingProject={isExporting}
        showToast={showToast}
        onOpenAIInspection={handleOpenAIInspection}
        onPrefetchAIInspection={handlePrefetchAIInspection}
        onOpenAIConversation={handleOpenAIConversation}
        onPrefetchAIConversation={handlePrefetchAIConversation}
        isCodeViewerOpen={isCodeViewerOpen}
        setIsCodeViewerOpen={setIsCodeViewerOpen}
        onOpenSettings={handleOpenSettings}
        onPrefetchSettings={handlePrefetchSettings}
        viewConfig={viewConfig}
        setViewConfig={setViewConfig}
        onLoadRobot={handleLoadRobot}
        viewerReloadKey={viewerReloadKey}
        importPreparationOverlay={importPreparationOverlay}
        headerQuickAction={extensions?.config?.headerQuickAction}
        headerSecondaryAction={extensions?.config?.headerSecondaryAction}
        onExposeLayoutActions={handleExposeLayoutActions}
      />

      <AppOverlayLayer
        aiConversationLaunchContext={aiConversationLaunchContext}
        botWorldImportState={botWorldImportState}
        closeToast={closeToast}
        disconnectedWorkspaceUrdfDialog={disconnectedWorkspaceUrdfDialog}
        exportDialogTarget={exportDialogTarget}
        exportDialogDefaultFormat={exportDialogDefaultFormat}
        extensions={extensions}
        handleConfirmDisconnectedWorkspaceUrdfExport={handleConfirmDisconnectedWorkspaceUrdfExport}
        handleExportDialogExport={handleExportDialogExport}
        handleOpenConversationWithReport={handleOpenConversationWithReport}
        handleStartNewAIConversation={handleStartNewAIConversation}
        isAIConversationOpen={isAIConversationOpen}
        onApplyAIUrdfModification={applyAIUrdfModification}
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
