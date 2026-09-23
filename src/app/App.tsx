/**
 * Main App Component
 * Root component that assembles app workflows and overlay layers.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Providers } from './Providers';
import { AppLayout } from './AppLayout';
import type { AppContentProps, AppExposedActions } from './appExtensions';
import { AppOverlayLayer } from './components/AppOverlayLayer';
import { useAppShellState } from './hooks/useAppShellState';
import { useAIWorkspaceSession } from './hooks/useAIWorkspaceSession';
import { useExportSession, type ExportSessionSurface } from './hooks/useExportSession';
import { useComponentSourceDraftCleanup } from './hooks/useAppEffects';
import { useFileImport } from './hooks/useFileImport';
import { useFileExport } from './hooks/useFileExport';
import { useImportInputBinding } from './hooks/useImportInputBinding';
import { useUnsavedChangesPrompt } from './hooks/useUnsavedChangesPrompt';
import { usePluginLaunch } from './hooks/usePluginLaunch';
import { useRegressionDebugApi } from './hooks/useRegressionDebugApi';
import { useRobotLoadWorkflow } from './hooks/useRobotLoadWorkflow';
import { scheduleUsdRuntimeStartupIdlePrewarm } from './utils/usdRuntimeStartupPrewarm';
import { useUIStore, useAssetsStore } from '@/store';
import type { RobotFile } from '@/types';
import { translations } from '@/shared/i18n';
// 深导入而非走 file-io barrel：barrel re-export 的 project 导入导出 utils
// 静态依赖 jszip/jspdf（export-vendor ~574KB），而启动期只需要这个格式常量。
import { EXPORT_FORMATS } from '@/features/file-io/components/ExportDialog/config';
import type { ExportFormat } from '@/features/file-io';
import type { ImportPreparationOverlayState } from './hooks/useFileImport';
import { useAssetImportFromUrl } from './hooks/useAssetImportFromUrl';
import {
  preloadAIConversationConnector,
  preloadAIInspectionConnector,
  preloadDisconnectedWorkspaceUrdfExportDialog,
  preloadExportDialogConnector,
  preloadExportProgressDialog,
  preloadSettingsModal,
} from './components/lazyAppOverlays';
// 深导入而非 ai-assistant barrel：barrel 会被 feature-ai-assistant chunk 化并
// 静态拉进首屏（transport/sessionStore 等运行时模块 ~512KB raw）；此处仅需
// 这个轻量快照读取函数（依赖只有 workspace/selection store）。
import { resolveCurrentAIRobotSnapshot } from '@/features/ai-assistant/utils/aiConversationRobotSnapshot';
import { applyAIUrdfModification } from './utils/applyAIUrdfModification';
import { logRegressionError } from '@/shared/debug/consoleDiagnostics';
import { createStudioAgentPorts } from './components/ai/studioAgentPorts';
import { installStudioAgentConsoleApi } from './components/ai/studioAgentConsoleApi';

function preloadOverlay(label: string, preload: () => Promise<unknown>): void {
  void preload().catch((error: unknown) => {
    logRegressionError(`[App] Failed to preload ${label}:`, error);
  });
}

function prefetchAIInspection(): void {
  preloadOverlay('AI inspection connector', preloadAIInspectionConnector);
}

function prefetchAIConversation(): void {
  preloadOverlay('AI conversation connector', preloadAIConversationConnector);
}

const EXPORT_SURFACE_PRELOADS = {
  configure: { label: 'export dialog connector', preload: preloadExportDialogConnector },
  progress: { label: 'export progress dialog', preload: preloadExportProgressDialog },
  disconnected: {
    label: 'disconnected workspace export dialog', preload: preloadDisconnectedWorkspaceUrdfExportDialog,
  },
};

function preloadExportSurface(surface: ExportSessionSurface): void {
  const resource = EXPORT_SURFACE_PRELOADS[surface];
  preloadOverlay(resource.label, resource.preload);
}

export function AppContent({ extensions, onExposeActions, externalImportEnabled = true }: AppContentProps = {}) {
  useUnsavedChangesPrompt();
  useComponentSourceDraftCleanup();

  // Refs for file inputs
  const importInputRef = useRef<HTMLInputElement>(null);
  const importFolderInputRef = useRef<HTMLInputElement>(null);
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
    isCodeViewerOpen,
    setIsCodeViewerOpen,
    viewConfig,
    setViewConfig,
  } = useAppShellState();
  const exportOperations = useFileExport();
  const exportSession = useExportSession({
    operations: exportOperations,
    preload: preloadExportSurface,
    showToast,
    labels: t,
  });
  const viewConfigRef = useRef(viewConfig);
  viewConfigRef.current = viewConfig;

  const updateAgentPanelConfig = useCallback((patch: Partial<typeof viewConfig>) => {
    const next = { ...viewConfigRef.current, ...patch };
    viewConfigRef.current = next;
    setViewConfig(next);
  }, [setViewConfig]);

  const handleViewerReload = useCallback(() => {
    setViewerReloadKey((value) => value + 1);
  }, []);
  const { loadRobotFile: handleLoadRobot, loadRobotFileRef: loadRobotByNameRef } =
    useRobotLoadWorkflow({
      labels: {
        failedToParseFormat: t.failedToParseFormat,
        robotLoadFailed: t.robotLoadFailed,
        usdBrowserUnsupported: t.usdBrowserUnsupported,
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
  const { importAssetFromBotWorld: _importAssetFromBotWorld, ...botWorldImportState } =
    useAssetImportFromUrl({
      enabled: externalImportEnabled,
      handleImport,
      onConvertToRequest: ({ convertTo, success }) => {
        // Asset was downloaded+imported; on success open the export dialog
        // preselected to the requested format so the user can export/convert.
        if (!success) return;
        if (!EXPORT_FORMATS.includes(convertTo as (typeof EXPORT_FORMATS)[number])) return;
        exportSession.open({ type: 'current' }, convertTo as ExportFormat);
      },
    });
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

  const aiSession = useAIWorkspaceSession({
    canEnter: ensureAIEntryAvailable,
    readRobotSnapshot: resolveCurrentAIRobotSnapshot,
    prefetchInspection: prefetchAIInspection,
    prefetchConversation: prefetchAIConversation,
  });
  const { openInspection } = aiSession;
  const { open: openExport } = exportSession;
  const handleOpenAIInspection = useCallback(() => openInspection(), [openInspection]);
  const handleAgentOpenAIInspection = useCallback(
    () => openInspection({ coexist: true }),
    [openInspection],
  );
  const handleOpenExportDialog = useCallback(() => openExport(), [openExport]);
  const handleOpenLibraryExportDialog = useCallback(
    (file: RobotFile) => openExport({ type: 'library-file', file }),
    [openExport],
  );

  const studioAgentPorts = useMemo(
    () => createStudioAgentPorts({
      openInspection: handleAgentOpenAIInspection,
      openExport: handleOpenExportDialog,
      readPanelConfig: () => viewConfigRef.current,
      updatePanelConfig: updateAgentPanelConfig,
    }),
    [handleAgentOpenAIInspection, handleOpenExportDialog, updateAgentPanelConfig],
  );

  useEffect(() => installStudioAgentConsoleApi(window, studioAgentPorts), [studioAgentPorts]);

  // Expose internal actions to external consumers (ref keeps the reference fresh)
  const layoutActionsRef = useRef<{
    openIkTool: () => void;
    openCollisionOptimizer: () => void;
    openTool: (key: string) => void;
  }>({ openIkTool: () => {}, openCollisionOptimizer: () => {}, openTool: () => {} });
  const hasExposedLayoutActionsRef = useRef(false);

  const [layoutReady, setLayoutReady] = useState(false);

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
    openAIConversation: aiSession.openConversation,
    openIkTool: () => layoutActionsRef.current.openIkTool(),
    openCollisionOptimizer: () => layoutActionsRef.current.openCollisionOptimizer(),
    openTool: (key: string) => layoutActionsRef.current.openTool(key),
    exportProjectBlob: exportSession.exportProjectBlob,
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
        onPrefetchExport={exportSession.prefetch}
        onOpenLibraryExport={handleOpenLibraryExportDialog}
        onExportProject={exportSession.exportProject}
        isExportingProject={exportSession.busy}
        showToast={showToast}
        onOpenAIInspection={handleOpenAIInspection}
        onPrefetchAIInspection={aiSession.prefetchInspection}
        onOpenAIConversation={aiSession.openConversation}
        onPrefetchAIConversation={aiSession.prefetchConversation}
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
        surfaceModeSelector={extensions?.config?.surfaceModeSelector}
        contextFileMenu={extensions?.config?.contextFileMenu}
        extensionToolboxItems={extensions?.config?.toolboxItems}
        onExposeLayoutActions={handleExposeLayoutActions}
      />

      <AppOverlayLayer
        aiSession={aiSession}
        exportSession={exportSession}
        botWorldImportState={botWorldImportState}
        closeToast={closeToast}
        extensions={extensions}
        onApplyAIUrdfModification={applyAIUrdfModification}
        isSettingsOpen={isSettingsOpen}
        lang={lang}
        loadingLabel={loadingLabel}
        studioAgentPorts={studioAgentPorts}
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
