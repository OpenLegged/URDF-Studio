/** Main application layout driven exclusively by canonical AssemblyState. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AppLayoutView } from './components/AppLayoutView';
import { setOptionsPanelVisibility } from './components/header/viewMenuState.js';
import type { AppLayoutProps, ProModeRoundtripSession } from './appLayoutTypes';
import { buildAssemblyComponentPreparationOverlayState } from './hooks/assemblyComponentPreparation';
import { useAppLayoutEffects } from './hooks/useAppLayoutEffects';
import { useAppLayoutStoreSlices } from './hooks/useAppLayoutStoreSlices';
import { useAppLayoutSnapshotWorkflow } from './hooks/useAppLayoutSnapshotWorkflow';
import { useCollisionOptimizationWorkflow } from './hooks/useCollisionOptimizationWorkflow';
import { useEditableSourceCodeApply } from './hooks/useEditableSourceCodeApply';
import { useFlattenedGroupSourceApply } from './hooks/useFlattenedGroupSourceApply';
import { useEditableSourcePatches } from './hooks/useEditableSourcePatches';
import { useIkToolController } from './hooks/useIkToolController';
import { useIkDragPanelActions } from './hooks/use_ik_drag_panel_actions';
import { useLibraryFileActions } from './hooks/useLibraryFileActions';
import { useLibraryRobotLoadRequest } from './hooks/useLibraryRobotLoadRequest';
import { usePreparedUsdViewerAssets } from './hooks/usePreparedUsdViewerAssets';
import { usePreviewFileWithFeedback } from './hooks/usePreviewFileWithFeedback';
import { useResponsiveSidebarCollapse } from './hooks/useResponsiveSidebarCollapse';
import { useSelectionActiveComponentSync } from './hooks/useSelectionActiveComponentSync';
import { useSourceCodeEditorDocuments } from './hooks/useSourceCodeEditorDocuments';
import { useSourceCodeEditorWarmup } from './hooks/useSourceCodeEditorWarmup';
import { useToolItems } from './hooks/useToolItems';
import { useUsdDocumentLifecycle } from './hooks/useUsdDocumentLifecycle';
import { useViewerOrchestration } from './hooks/useViewerOrchestration';
import { useWorkspaceFilePreview } from './hooks/workspace-source-sync/useWorkspaceFilePreview';
import { useWorkspaceLayoutDerivations } from './hooks/useWorkspaceLayoutDerivations';
import { useWorkspaceModeTransitions } from './hooks/useWorkspaceModeTransitions';
import { useWorkspaceMutations } from './hooks/useWorkspaceMutations';
import { useWorkspaceOverlayActions } from './hooks/useWorkspaceOverlayActions';
import { useWorkspaceViewerDerivations } from './hooks/useWorkspaceViewerDerivations';
import { preloadSnapshotDialog } from './utils/overlayLoaders';
import { preloadSourceCodeEditorRuntime } from './utils/sourceCodeEditorLoader';
import type { SourceCodeDocumentChangeTarget } from './utils/sourceCodeDocuments';
import { normalizeMergedAppMode } from '@/shared/utils/appMode';
import { logRegressionError } from '@/shared/debug/consoleDiagnostics';
import { translations } from '@/shared/i18n';
import type {
  BridgeJoint,
  InteractionSelection,
  JointEntityRef,
  LinkEntityRef,
  RobotFile,
} from '@/types';
import type { ToolMode } from '@/features/editor';
import type { SourceCodeEditorApplyRequest } from '@/features/code-editor';
import type { ImportPreparationOverlayState } from './hooks/useFileImport';

export function AppLayout({
  importInputRef,
  importFolderInputRef,
  onFileDrop,
  onOpenExport,
  onPrefetchExport,
  onOpenLibraryExport,
  onExportProject,
  isExportingProject = false,
  showToast,
  onOpenAIInspection,
  onPrefetchAIInspection,
  onOpenAIConversation,
  onPrefetchAIConversation,
  isCodeViewerOpen,
  setIsCodeViewerOpen,
  onOpenSettings,
  onPrefetchSettings,
  headerQuickAction,
  headerSecondaryAction,
  viewConfig,
  setViewConfig,
  onLoadRobot,
  viewerReloadKey,
  importPreparationOverlay = null,
  onExposeLayoutActions,
}: AppLayoutProps) {
  const {
    uiStore: {
      appMode,
      lang,
      theme,
      sidebar,
      panelLayout,
      toggleSidebar,
      setSidebar,
      sourceCodeAutoApply,
      setViewOption,
      groundPlaneOffset,
    },
    selectionStore: {
      selection,
      setSelection,
      setHoveredSelection,
      clearSelection,
      focusTarget,
      focusOn,
      pulseSelection,
    },
    assetsStore: {
      assets,
      motorLibrary,
      availableFiles,
      selectedFile,
      documentLoadState,
      documentLoadLifecycleState,
      allFileContents,
      componentSourceDrafts,
      uploadAsset,
      removeRobotFile,
      removeRobotFolder,
      renameRobotFolder,
      clearRobotLibrary,
      getUsdPreparedExportCache,
      usdPreparedExportCaches,
      setDocumentLoadState,
    },
    workspaceStore: { workspace, semanticWorkspace, activeComponentId, addBridge },
    collisionTransformStore: { setPendingCollisionTransform, clearPendingCollisionTransform },
  } = useAppLayoutStoreSlices();

  useSelectionActiveComponentSync();
  useResponsiveSidebarCollapse({ sidebar, setSidebar });
  const mergedAppMode = normalizeMergedAppMode(appMode);
  const t = translations[lang];
  const activeComponent =
    workspace.components[activeComponentId] ?? Object.values(workspace.components)[0]!;

  const transformPendingRef = useRef(false);
  const proModeRoundtripSessionRef = useRef<ProModeRoundtripSession | null>(null);
  const [pendingViewerToolMode, setPendingViewerToolMode] = useState<ToolMode | null>(null);
  const [isBridgeModalOpen, setIsBridgeModalOpen] = useState(false);
  const [shouldRenderBridgeModal, setShouldRenderBridgeModal] = useState(false);
  const [bridgePreview, setBridgePreview] = useState<BridgeJoint | null>(null);
  const [isCollisionOptimizerOpen, setIsCollisionOptimizerOpen] = useState(false);
  const [assemblyComponentPreparationOverlay, setAssemblyComponentPreparationOverlay] =
    useState<ImportPreparationOverlayState | null>(null);

  const {
    sceneWorkspace,
    sceneProjection,
    scenePlacement,
    viewerRobot,
    viewerDocument,
    canonicalSource,
    jointAngleState,
    jointMotionState,
    showVisual,
  } = useWorkspaceViewerDerivations({
    workspace,
    semanticWorkspace,
    bridgePreview,
    activeComponentId,
    availableFiles,
    componentSourceDrafts,
    allFileContents,
  });
  const isUsdHydrationPending =
    documentLoadLifecycleState.status === 'hydrating' &&
    documentLoadLifecycleState.format === 'usd';

  const showAssemblyComponentPreparationOverlay = useCallback(
    (file: RobotFile, stage: 'prepare' | 'add' | 'ground') => {
      setAssemblyComponentPreparationOverlay(
        buildAssemblyComponentPreparationOverlayState(file, stage, t),
      );
    },
    [t],
  );
  const clearAssemblyComponentPreparationOverlay = useCallback(() => {
    setAssemblyComponentPreparationOverlay(null);
  }, []);

  const { filePreview, previewRobot, handlePreviewFile, handleClosePreview, activePreviewFile } =
    useWorkspaceFilePreview({
      availableFiles,
      assets,
      allFileContents,
      getUsdPreparedExportCache,
    });
  const additionalPreparedViewerSourceFiles = useMemo(
    () => (activePreviewFile ? [activePreviewFile] : []),
    [activePreviewFile],
  );
  const viewerAssets = usePreparedUsdViewerAssets({
    assemblyState: semanticWorkspace,
    assets,
    availableFiles,
    additionalSourceFiles: additionalPreparedViewerSourceFiles,
    preparedExportCaches: usdPreparedExportCaches,
    getUsdPreparedExportCache,
  });

  const { updateProModeRoundtripBaseline } = useWorkspaceModeTransitions({
    previewFile: activePreviewFile,
    selectedFile,
    availableFiles,
    allFileContents,
    assets,
    getUsdPreparedExportCache,
    showToast,
    t,
    handleClosePreview,
    proModeRoundtripSessionRef,
  });
  const {
    handleViewerDocumentLoadEvent,
    handleViewerRuntimeRobotLoaded,
    handleViewerRuntimeSceneReadyForDisplay,
  } = useUsdDocumentLifecycle({
    clearAssemblyComponentPreparationOverlay,
    isSelectedUsdHydrating: isUsdHydrationPending,
    labels: {
      addedComponent: t.addedComponent,
      failedToParseFormat: t.failedToParseFormat,
    },
    previewFile: activePreviewFile,
    selectedFile,
    setDocumentLoadState,
    showToast,
    updateProModeRoundtripBaseline,
  });

  const { ikDragActive, isIkToolPanelOpen, handleIkDragActiveChange, handleOpenIkTool } =
    useIkDragPanelActions({ selection, setSelection, setViewOption });
  const {
    ikToolSelectionState,
    ikLinkOptions,
    selectedIkLinkId,
    selectedIkLinkLabel,
    currentIkLinkLabel,
    selectIkLink,
  } = useIkToolController({
    ikDragActive,
    componentId: activeComponent.id,
    robot: activeComponent.robot,
    selection,
    setSelection,
  });
  const { workspaceLayoutClassNames, workspaceOverlaySafeAreaStyle, workspaceOverlayGizmoMargin } =
    useWorkspaceLayoutDerivations({ panelLayout, sidebar });
  const {
    handleSelect,
    handleSelectGeometry,
    handleViewerSelect,
    handleTransformPendingChange,
    handleHover,
    handleFocus,
  } = useViewerOrchestration({
    workspace,
    transformPendingRef,
    setSelection,
    pulseSelection,
    setHoveredSelection,
    focusOn,
  });

  const {
    patchEditableSourceAddChild,
    patchEditableSourceDeleteSubtree,
    patchEditableSourceAddCollisionBody,
    patchEditableSourceDeleteCollisionBody,
    patchEditableSourceUpdateCollisionBody,
    patchEditableSourceUpdateJointLimit,
    patchEditableSourceUpdateLinkInertial,
    patchEditableSourceRobotName,
    patchEditableSourceRenameEntities,
  } = useEditableSourcePatches({ showToast });
  const {
    handleUpdate,
    handleCollisionTransformPreview,
    handleCollisionTransform,
    handleAssemblyTransform,
    handleComponentTransform,
    handleBridgeTransform,
    handleAddChild,
    handleAddCollisionBody,
    handleDelete,
    handleSetShowVisual,
    handleJointChange: handleCommittedJointChange,
    flushJointMotion,
  } = useWorkspaceMutations({
    focusOn,
    setSelection,
    setPendingCollisionTransform,
    clearPendingCollisionTransform,
    handleTransformPendingChange,
    patchEditableSourceAddChild,
    patchEditableSourceDeleteSubtree,
    patchEditableSourceAddCollisionBody,
    patchEditableSourceDeleteCollisionBody,
    patchEditableSourceUpdateCollisionBody,
    patchEditableSourceUpdateJointLimit,
    patchEditableSourceUpdateLinkInertial,
    patchEditableSourceRobotName,
    patchEditableSourceRenameEntities,
  });
  const handleJointPreview = useCallback(
    (ref: JointEntityRef, angle: number) => handleCommittedJointChange(ref, angle),
    [handleCommittedJointChange],
  );
  const handleJointChange = useCallback(
    (ref: JointEntityRef, angle: number) => {
      handleCommittedJointChange(ref, angle);
      flushJointMotion();
    },
    [flushJointMotion, handleCommittedJointChange],
  );

  const {
    handleUploadAsset,
    handleDeleteLibraryFile,
    handleDeleteLibraryFolder,
    handleRenameLibraryFolder,
    handleDeleteAllLibraryFiles,
    handleExportLibraryFile,
  } = useLibraryFileActions({
    availableFiles,
    selectedFile,
    assemblyState: workspace,
    removeRobotFile,
    removeRobotFolder,
    renameRobotFolder,
    clearRobotLibrary,
    clearSelection,
    uploadAsset,
    openLibraryExportDialog: onOpenLibraryExport,
    showToast,
    t,
  });

  const {
    handleAddComponent,
    handleCreateBridge,
    handlePrefetchBridgeCreateModal,
    handleCloseBridgeModal,
    handleBridgePreviewChange,
    handleCreateBridgeCommit,
    handleOpenCollisionOptimizer,
    handlePrefetchCollisionOptimizer,
  } = useWorkspaceOverlayActions({
    onLoadRobot,
    showAssemblyComponentPreparationOverlay,
    clearAssemblyComponentPreparationOverlay,
    showToast,
    t,
    setBridgePreview,
    setShouldRenderBridgeModal,
    setIsBridgeModalOpen,
    addBridge,
    setIsCollisionOptimizerOpen,
  });
  const {
    collisionOptimizationSource,
    handlePreviewCollisionOptimizationTarget,
    handleApplyCollisionOptimization,
  } = useCollisionOptimizationWorkflow({
    assemblyState: workspace,
    focusOn,
    pulseSelection,
    setSelection,
    showToast,
    t,
  });

  const { handleCodeChange: handleComponentCodeChange } = useEditableSourceCodeApply({
    allFileContents,
    availableFiles,
  });
  const { handleCodeChange: handleGroupCodeChange } = useFlattenedGroupSourceApply();
  const handleCodeChange = useCallback((
    newCode: string,
    target?: SourceCodeDocumentChangeTarget,
    applyRequest?: SourceCodeEditorApplyRequest,
  ): Promise<boolean> => {
    if (target?.kind === 'component') {
      return handleComponentCodeChange(newCode, target, applyRequest);
    }
    if (target?.kind === 'group') {
      return handleGroupCodeChange(newCode, target, applyRequest);
    }
    return Promise.resolve(false);
  }, [handleComponentCodeChange, handleGroupCodeChange]);
  const sourceCodeEditorDocuments = useSourceCodeEditorDocuments(
    canonicalSource.documents,
    handleCodeChange,
  );
  const viewerDocumentLifecycleCallbacks = useMemo(
    () => ({
      onDocumentLoadEvent: handleViewerDocumentLoadEvent,
      onRuntimeRobotLoaded: handleViewerRuntimeRobotLoaded,
      onRuntimeSceneReadyForDisplay: handleViewerRuntimeSceneReadyForDisplay,
    }),
    [
      handleViewerDocumentLoadEvent,
      handleViewerRuntimeRobotLoaded,
      handleViewerRuntimeSceneReadyForDisplay,
    ],
  );

  const {
    snapshotActionRef,
    previewActionRef,
    viewerCanvasStateRef,
    isDialogOpen: isSnapshotDialogOpen,
    isCapturing: isSnapshotCapturing,
    captureProgress: snapshotCaptureProgress,
    previewSession: snapshotPreviewSession,
    handleCloseSnapshotDialog,
    handleSnapshotPreviewCaptureActionChange,
    handleSnapshot,
    handleCaptureSnapshot,
    handleCancelSnapshotCapture,
  } = useAppLayoutSnapshotWorkflow({
    availableFiles,
    groundPlaneOffset,
    jointAngleState,
    jointMotionState,
    selectedFileFormat: selectedFile?.format ?? null,
    theme,
    urdfContentForViewer: viewerDocument.urdfContent,
    viewerAssets,
    viewerDocumentReady:
      documentLoadLifecycleState.status === 'ready' &&
      documentLoadLifecycleState.fileName === selectedFile?.name,
    viewerReloadKey,
    viewerRobot,
    viewerShowVisual: showVisual,
    viewerSourceFile: viewerDocument.sourceFile,
    viewerSourceFilePath: viewerDocument.sourceFilePath,
    viewerSourceFormat: viewerDocument.sourceFormat,
    showToast,
    snapshotFailedMessage: t.snapshotFailed,
  });
  const handlePrefetchSnapshot = useCallback(() => {
    void preloadSnapshotDialog().catch((error: unknown) => {
      logRegressionError('[AppLayout] Failed to preload snapshot dialog:', error);
    });
  }, []);
  const handleOpenSnapshotDialog = useCallback(() => {
    handlePrefetchSnapshot();
    handleSnapshot();
  }, [handlePrefetchSnapshot, handleSnapshot]);
  const { items: toolboxItems, openTool } = useToolItems({
    t,
    openAIInspection: onOpenAIInspection,
    prefetchAIInspection: onPrefetchAIInspection,
    openAIConversation: onOpenAIConversation,
    prefetchAIConversation: onPrefetchAIConversation,
    openIkTool: handleOpenIkTool,
    openCollisionOptimizer: handleOpenCollisionOptimizer,
    prefetchCollisionOptimizer: handlePrefetchCollisionOptimizer,
  });
  useEffect(() => {
    onExposeLayoutActions?.({
      openIkTool: handleOpenIkTool,
      openCollisionOptimizer: handleOpenCollisionOptimizer,
      openTool,
    });
  }, [handleOpenCollisionOptimizer, handleOpenIkTool, onExposeLayoutActions, openTool]);

  const handleSetDetailOptionsPanelVisibility = useCallback(
    (show: boolean) => setViewConfig((current) => setOptionsPanelVisibility(current, show)),
    [setViewConfig],
  );
  const {
    isFileDragActive,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useAppLayoutEffects({
    workspace,
    selection,
    clearSelection,
    onFileDrop,
    onDropError: () => showToast(t.failedToProcessFiles, 'info'),
  });
  const handleSourceCodeEditorPreloadError = useCallback((error: unknown) => {
    logRegressionError('[AppLayout] Failed to preload source code editor runtime:', error);
  }, []);
  const { handleOpenCodeViewer, handlePrefetchCodeViewer } = useSourceCodeEditorWarmup({
    isSelectedUsdHydrating: isUsdHydrationPending,
    setIsCodeViewerOpen,
    showToast,
    usdLoadInProgressMessage: t.usdLoadInProgress,
    preloadRuntime: preloadSourceCodeEditorRuntime,
    onPreloadError: handleSourceCodeEditorPreloadError,
  });

  const assemblyComponentFileNames = useMemo(
    () =>
      new Set(
        Object.values(workspace.components).flatMap((component) =>
          component.sourceFile ? [component.sourceFile] : [],
        ),
      ),
    [workspace.components],
  );
  const { handlePreviewFileWithFeedback } = usePreviewFileWithFeedback({
    allFileContents,
    assemblyComponentFileNames,
    assets,
    availableFiles,
    getUsdPreparedExportCache,
    handlePreviewFile,
    labels: {
      failedToParseFormat: t.failedToParseFormat,
      importPackageAssetBundleHint: t.importPackageAssetBundleHint,
      importPrimitiveGeometryHint: t.importPrimitiveGeometryHint,
      usdPreviewRequiresOpen: t.usdPreviewRequiresOpen,
      xacroSourceOnlyPreviewHint: t.xacroSourceOnlyPreviewHint,
    },
    setDocumentLoadState,
    showToast,
  });
  const handleRequestLoadRobot = useLibraryRobotLoadRequest({
    handlePreviewFileWithFeedback,
    hasSimpleModeSourceEdits: false,
    onLoadRobot,
    selectedFile,
    shouldPreviewLibraryRobotLoad: false,
  });

  const collisionDialogSelection = useMemo<InteractionSelection>(() => {
    const ref = selection?.entity;
    if (!ref || ref.type !== 'link') return { type: null, id: null };
    return {
      type: 'link',
      id: ref.entityId,
      subType: selection.subType,
      objectIndex: selection.objectIndex,
    };
  }, [selection]);
  const handleViewerUpdate = useCallback(
    (ref: LinkEntityRef | JointEntityRef, patch: Parameters<typeof handleUpdate>[1]) => {
      handleUpdate(ref, patch);
    },
    [handleUpdate],
  );

  return (
    <AppLayoutView
      drag={{
        handlers: {
          onDragEnter: handleDragEnter,
          onDragOver: handleDragOver,
          onDragLeave: handleDragLeave,
          onDrop: handleDrop,
        },
        isFileDragActive,
        t,
      }}
      importInputs={{ importInputRef, importFolderInputRef }}
      header={{
        onOpenExport,
        onPrefetchExport,
        onExportProject,
        isExportingProject,
        onOpenSettings,
        onPrefetchSettings,
        headerQuickAction,
        headerSecondaryAction,
        viewConfig,
        setViewConfig,
        toolboxItems,
        handleOpenCodeViewer,
        handlePrefetchCodeViewer,
        handleSnapshot: handleOpenSnapshotDialog,
        handlePrefetchSnapshot,
      }}
      ikPanel={{
        isOpen: isIkToolPanelOpen,
        t,
        ikLinkOptions,
        selectedIkLinkId,
        selectedIkLinkLabel,
        currentIkLinkLabel,
        ikToolSelectionStatus: ikToolSelectionState.status,
        onSelectIkLink: selectIkLink,
        onClose: () => handleIkDragActiveChange(false),
      }}
      workspaceChrome={{
        classNames: workspaceLayoutClassNames,
        overlaySafeAreaStyle: workspaceOverlaySafeAreaStyle,
        overlayGizmoMargin: workspaceOverlayGizmoMargin,
      }}
      viewer={{
        workspace: sceneWorkspace,
        sceneProjection,
        scenePlacement,
        mergedAppMode,
        handleViewerSelect,
        handleHover,
        handleUpdate: handleViewerUpdate,
        viewerAssets,
        allFileContents,
        showVisual,
        handleSetShowVisual,
        handleSetDetailOptionsPanelVisibility,
        snapshotActionRef,
        previewActionRef,
        viewerCanvasStateRef,
        availableFiles,
        urdfContentForViewer: viewerDocument.urdfContent,
        viewerSourceFormat: viewerDocument.sourceFormat,
        viewerSourceFilePath: viewerDocument.sourceFilePath,
        viewerSourceFile: viewerDocument.sourceFile,
        viewerDocumentLifecycleCallbacks,
        jointAngleState,
        jointMotionState,
        selection,
        focusTarget,
        selectedFile,
        handleWorkspaceTransformPendingChange: handleTransformPendingChange,
        handleCollisionTransformPreview,
        handleCollisionTransform,
        handleAssemblyTransform,
        handleComponentTransform,
        handleBridgeTransform,
        ikDragActive,
        pendingViewerToolMode,
        setPendingViewerToolMode,
        viewerReloadKey,
        documentLoadLifecycleState,
        documentLoadState,
        importPreparationOverlay,
        lang,
        theme,
        viewConfig,
        onNotify: showToast,
      }}
      sidebars={{
        workspace,
        activeComponentId,
        selection,
        handleSelect,
        handleSelectGeometry,
        handleFocus,
        handleAddChild,
        handleAddCollisionBody,
        handleDelete,
        handleUpdate,
        showVisual,
        handleSetShowVisual,
        mergedAppMode,
        lang,
        theme,
        leftSidebarCollapsed: sidebar.leftCollapsed,
        rightSidebarCollapsed: sidebar.rightCollapsed,
        onToggleLeftSidebar: () => toggleSidebar('left'),
        onToggleRightSidebar: () => toggleSidebar('right'),
        availableFiles,
        handlePreviewFileWithFeedback,
        handleRequestLoadRobot,
        selectedFile,
        viewerSourceFilePath: viewerDocument.sourceFilePath,
        handleAddComponent,
        handleDeleteLibraryFile,
        handleDeleteLibraryFolder,
        handleRenameLibraryFolder,
        handleDeleteAllLibraryFiles,
        handleExportLibraryFile,
        handleCreateBridge,
        handlePrefetchCreateBridge: handlePrefetchBridgeCreateModal,
        isPreviewingWorkspaceSource: false,
        viewConfig,
        setViewConfig,
        handleJointPreview,
        handleJointChange,
        previewFile: activePreviewFile,
        previewRobot,
        filePreview,
        viewerAssets,
        allFileContents,
        documentLoadState,
        handleClosePreview,
        handleHover,
        handleUploadAsset,
        motorLibrary,
        t,
      }}
      snapshot={{
        isOpen: isSnapshotDialogOpen,
        isCapturing: isSnapshotCapturing,
        captureProgress: snapshotCaptureProgress,
        lang,
        previewSession: snapshotPreviewSession,
        onPreviewCaptureActionChange: handleSnapshotPreviewCaptureActionChange,
        onClose: handleCloseSnapshotDialog,
        onCapture: handleCaptureSnapshot,
        onCancelCapture: handleCancelSnapshotCapture,
        loadingLabel: t.loadingPanel,
      }}
      assemblyPreparation={{ overlay: assemblyComponentPreparationOverlay }}
      overlays={{
        isCodeViewerOpen,
        sourceCodeEditorDocuments,
        sourceCodeAutoApply,
        setIsCodeViewerOpen,
        theme,
        lang,
        labels: {
          loadingSourceCodeEditor: t.loadingPanel,
          loadingOptimizer: t.loadingOptimizer,
          loadingBridgeDialog: t.loadingBridgeDialog,
        },
        isCollisionOptimizerOpen,
        setIsCollisionOptimizerOpen,
        collisionOptimizationSource,
        viewerAssets,
        viewerSourceFilePath: viewerDocument.sourceFilePath,
        selection: collisionDialogSelection,
        handlePreviewCollisionOptimizationTarget,
        handleApplyCollisionOptimization,
        normalizedAssemblyState: workspace,
        shouldRenderBridgeModal,
        isBridgeModalOpen,
        handleCloseBridgeModal,
        handleCreateBridgeCommit,
        handleBridgePreviewChange,
      }}
    />
  );
}

export default AppLayout;
