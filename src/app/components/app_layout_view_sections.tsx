import React, { Suspense } from 'react';

import { AppLayoutOverlays } from './AppLayoutOverlays';
import { FileDropOverlay } from './FileDropOverlay';
import { Header } from './Header';
import { IkToolPanel } from './IkToolPanel';
import { ImportPreparationOverlay } from './ImportPreparationOverlay';
import { LazyOverlayFallback } from './LazyOverlayFallback';
import type { AppLayoutViewProps } from './app_layout_view_types';
import { WorkspaceSidebars } from './workspace/WorkspaceSidebars';
import { WorkspaceViewerLayer } from './workspace/WorkspaceViewerLayer';
import { resolveDocumentLoadingOverlayTargetFileName } from '../utils/documentLoadProgress';
import { SnapshotDialog } from '../utils/overlayLoaders';
import { ROBOT_IMPORT_ACCEPT_ATTRIBUTE } from '@/shared/utils';
import { isWorkspaceSelectionEditorLocked } from '@/core/robot';

interface AppLayoutViewContentProps extends AppLayoutViewProps {
  shouldSuppressDocumentLoadingOverlay: boolean;
}

export function AppLayoutViewContent(props: AppLayoutViewContentProps) {
  const { drag, workspaceChrome } = props;

  return (
    <div
      className="flex flex-col h-screen bg-app-bg text-text-primary"
      onDragEnter={drag.handlers.onDragEnter}
      onDragOver={drag.handlers.onDragOver}
      onDragLeave={drag.handlers.onDragLeave}
      onDrop={drag.handlers.onDrop}
    >
      <AppLayoutDropOverlay drag={props.drag} />
      <AppLayoutImportInputs importInputs={props.importInputs} />
      <AppLayoutHeaderSection importInputs={props.importInputs} header={props.header} />
      <AppLayoutIkPanelSection ikPanel={props.ikPanel} />

      <div className={workspaceChrome.classNames.root}>
        <WorkspaceViewerSection
          workspaceChrome={props.workspaceChrome}
          viewer={props.viewer}
          shouldSuppressDocumentLoadingOverlay={props.shouldSuppressDocumentLoadingOverlay}
        />
        <WorkspaceSidebarsSection
          workspaceChrome={props.workspaceChrome}
          sidebars={props.sidebars}
        />
      </div>

      <SnapshotDialogSection snapshot={props.snapshot} />
      <AssemblyPreparationOverlaySection assemblyPreparation={props.assemblyPreparation} />
      <AppLayoutOverlaysSection overlays={props.overlays} />

      {/* Narrow-screen dock for the 3D viewer toolbar (phones, <640px).
          The ViewerToolbar portals a touch-friendly copy here; hidden on sm+. */}
      <div
        id="viewer-toolbar-bottom-dock"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-30 sm:hidden"
      />
    </div>
  );
}

function AppLayoutDropOverlay({ drag }: Pick<AppLayoutViewProps, 'drag'>) {
  return (
    <FileDropOverlay
      visible={drag.isFileDragActive}
      title={drag.t.dropFilesToImport}
      hint={drag.t.dropFilesToImportHint}
    />
  );
}

function AppLayoutImportInputs({ importInputs }: Pick<AppLayoutViewProps, 'importInputs'>) {
  return (
    <>
      <input
        type="file"
        accept={ROBOT_IMPORT_ACCEPT_ATTRIBUTE}
        ref={importInputs.importInputRef}
        className="hidden"
      />
      <input
        type="file"
        ref={importInputs.importFolderInputRef}
        className="hidden"
        {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
      />
    </>
  );
}

function AppLayoutHeaderSection({
  importInputs,
  header,
}: Pick<AppLayoutViewProps, 'importInputs' | 'header'>) {
  return (
    <Header
      onImportFile={() => importInputs.importInputRef.current?.click()}
      onImportFolder={() => importInputs.importFolderInputRef.current?.click()}
      onOpenExport={header.onOpenExport}
      onPrefetchExport={header.onPrefetchExport}
      onExportProject={header.onExportProject}
      isExportingProject={header.isExportingProject}
      toolboxItems={header.toolboxItems}
      onOpenCodeViewer={header.handleOpenCodeViewer}
      onPrefetchCodeViewer={header.handlePrefetchCodeViewer}
      onOpenSettings={header.onOpenSettings}
      onPrefetchSettings={header.onPrefetchSettings}
      quickAction={header.headerQuickAction}
      secondaryAction={header.headerSecondaryAction}
      onSnapshot={header.handleSnapshot}
      onPrefetchSnapshot={header.handlePrefetchSnapshot}
      viewConfig={header.viewConfig}
      viewAvailability={{ jointPanel: true }}
      setViewConfig={header.setViewConfig}
    />
  );
}

function AppLayoutIkPanelSection({ ikPanel }: Pick<AppLayoutViewProps, 'ikPanel'>) {
  return (
    <IkToolPanel
      show={ikPanel.isOpen}
      t={ikPanel.t}
      linkOptions={ikPanel.ikLinkOptions}
      selectedLinkId={ikPanel.selectedIkLinkId}
      selectedLinkLabel={ikPanel.selectedIkLinkLabel}
      currentLinkLabel={ikPanel.currentIkLinkLabel}
      selectionStatus={ikPanel.ikToolSelectionStatus}
      onSelectLink={ikPanel.onSelectIkLink}
      onClose={ikPanel.onClose}
    />
  );
}

function WorkspaceViewerSection({
  workspaceChrome,
  viewer,
  shouldSuppressDocumentLoadingOverlay,
}: Pick<
  AppLayoutViewContentProps,
  'workspaceChrome' | 'viewer' | 'shouldSuppressDocumentLoadingOverlay'
>) {
  return (
    <WorkspaceViewerLayer
      className={workspaceChrome.classNames.viewerLayer}
      style={workspaceChrome.overlaySafeAreaStyle}
      viewerProps={{
        workspace: viewer.workspace,
        sceneProjection: viewer.sceneProjection,
        scenePlacement: viewer.scenePlacement,
        mode: viewer.mergedAppMode,
        onSelect: viewer.handleViewerSelect,
        onHover: viewer.handleHover,
        onUpdate: viewer.handleUpdate,
        assets: viewer.viewerAssets,
        allFileContents: viewer.allFileContents,
        lang: viewer.lang,
        theme: viewer.theme,
        showVisual: viewer.showVisual,
        setShowVisual: viewer.handleSetShowVisual,
        snapshotAction: viewer.snapshotActionRef,
        previewAction: viewer.previewActionRef,
        onCanvasCreated: (state) => {
          viewer.viewerCanvasStateRef.current = state;
        },
        showOptionsPanel: viewer.viewConfig.showOptionsPanel,
        setShowOptionsPanel: viewer.handleSetDetailOptionsPanelVisibility,
        showJointPanel: false,
        availableFiles: viewer.availableFiles,
        urdfContent: viewer.urdfContentForViewer,
        viewerSourceFormat: viewer.viewerSourceFormat,
        sourceFilePath: viewer.viewerSourceFilePath,
        sourceFile: viewer.viewerSourceFile,
        onDocumentLoadEvent: viewer.viewerDocumentLifecycleCallbacks.onDocumentLoadEvent,
        onRuntimeRobotLoaded: viewer.viewerDocumentLifecycleCallbacks.onRuntimeRobotLoaded,
        onRuntimeSceneReadyForDisplay:
          viewer.viewerDocumentLifecycleCallbacks.onRuntimeSceneReadyForDisplay,
        jointAngleState: viewer.jointAngleState,
        jointMotionState: viewer.jointMotionState,
        selection: viewer.selection,
        focusTarget: viewer.focusTarget,
        isMeshPreview: viewer.selectedFile?.format === 'mesh',
        onTransformPendingChange: viewer.handleWorkspaceTransformPendingChange,
        onCollisionTransformPreview: viewer.handleCollisionTransformPreview,
        onCollisionTransform: viewer.handleCollisionTransform,
        onAssemblyTransform: viewer.handleAssemblyTransform,
        onComponentTransform: viewer.handleComponentTransform,
        onBridgeTransform: viewer.handleBridgeTransform,
        ikDragActive: viewer.ikDragActive,
        pendingViewerToolMode: viewer.pendingViewerToolMode,
        onConsumePendingViewerToolMode: () => viewer.setPendingViewerToolMode(null),
        viewerReloadKey: viewer.viewerReloadKey,
        documentLoadState: viewer.documentLoadLifecycleState,
        gizmoMargin: workspaceChrome.overlayGizmoMargin,
        onNotify: viewer.onNotify,
      }}
      documentLoadingOverlayLang={viewer.lang}
      documentLoadingOverlayTargetFileName={resolveDocumentLoadingOverlayTargetFileName({
        previewFileName: null,
        selectedFileName: viewer.selectedFile?.name ?? null,
        suppressDocumentLoadingOverlay: shouldSuppressDocumentLoadingOverlay,
        documentLoadState: viewer.documentLoadState,
      })}
      importPreparationOverlay={viewer.importPreparationOverlay}
    />
  );
}

function WorkspaceSidebarsSection({
  workspaceChrome,
  sidebars,
}: Pick<AppLayoutViewProps, 'workspaceChrome' | 'sidebars'>) {
  const selectionEditorLocked = isWorkspaceSelectionEditorLocked(
    sidebars.workspace,
    sidebars.selection,
  );
  return (
    <WorkspaceSidebars
      leftSidebarClassName={workspaceChrome.classNames.leftSidebarLayer}
      rightSidebarClassName={workspaceChrome.classNames.rightSidebarLayer}
      treeEditorProps={{
        workspace: sidebars.workspace,
        activeComponentId: sidebars.activeComponentId,
        onSelect: sidebars.handleSelect,
        onHover: sidebars.handleHover,
        onSelectGeometry: sidebars.handleSelectGeometry,
        onFocus: sidebars.handleFocus,
        onAddChild: sidebars.handleAddChild,
        onAddCollisionBody: sidebars.handleAddCollisionBody,
        onDelete: sidebars.handleDelete,
        onUpdate: sidebars.handleUpdate,
        showVisual: sidebars.showVisual,
        setShowVisual: sidebars.handleSetShowVisual,
        mode: sidebars.mergedAppMode,
        lang: sidebars.lang,
        theme: sidebars.theme,
        collapsed: sidebars.leftSidebarCollapsed,
        onToggle: sidebars.onToggleLeftSidebar,
        availableFiles: sidebars.availableFiles,
        onLoadRobot: sidebars.handlePreviewFileWithFeedback,
        onRequestLoadRobot: sidebars.handleRequestLoadRobot,
        currentFileName: sidebars.selectedFile?.name,
        sourceFilePath: sidebars.viewerSourceFilePath,
        onAddComponent: sidebars.handleAddComponent,
        onDeleteLibraryFile: sidebars.handleDeleteLibraryFile,
        onDeleteLibraryFolder: sidebars.handleDeleteLibraryFolder,
        onRenameLibraryFolder: sidebars.handleRenameLibraryFolder,
        onDeleteAllLibraryFiles: sidebars.handleDeleteAllLibraryFiles,
        onExportLibraryFile: sidebars.handleExportLibraryFile,
        onCreateBridge: sidebars.handleCreateBridge,
        onPrefetchCreateBridge: sidebars.handlePrefetchCreateBridge,
        isReadOnly: sidebars.isPreviewingWorkspaceSource,
        showJointPanel: sidebars.viewConfig.showJointPanel,
        showStructureGraph: sidebars.viewConfig.showStructureGraph,
        onCloseStructureGraph: () =>
          sidebars.setViewConfig((prev) => ({ ...prev, showStructureGraph: false })),
        onJointAnglePreview: sidebars.handleJointPreview,
        onJointAngleChange: sidebars.handleJointChange,
      }}
      filePreviewWindowProps={{
        file: sidebars.previewFile,
        previewRobot: sidebars.previewRobot,
        previewState: sidebars.filePreview,
        assets: sidebars.viewerAssets,
        allFileContents: sidebars.allFileContents,
        availableFiles: sidebars.availableFiles,
        documentLoadState: sidebars.documentLoadState,
        lang: sidebars.lang,
        theme: sidebars.theme,
        showVisual: sidebars.showVisual,
        onClose: sidebars.handleClosePreview,
        onAddComponent: sidebars.handleAddComponent,
      }}
      propertyEditorProps={{
        workspace: sidebars.workspace,
        selection: sidebars.selection,
        onUpdate: sidebars.handleUpdate,
        onSelect: sidebars.handleSelect,
        onSelectGeometry: sidebars.handleSelectGeometry,
        onAddCollisionBody: sidebars.handleAddCollisionBody,
        mode: sidebars.mergedAppMode,
        assets: sidebars.viewerAssets,
        onUploadAsset: sidebars.handleUploadAsset,
        motorLibrary: sidebars.motorLibrary,
        lang: sidebars.lang,
        collapsed: sidebars.rightSidebarCollapsed,
        onToggle: sidebars.onToggleRightSidebar,
        readOnlyMessage: sidebars.isPreviewingWorkspaceSource
          ? sidebars.t.previewReadOnlyHint
          : selectionEditorLocked
            ? sidebars.t.editingLockedMessage
            : undefined,
        readOnlyBadge: !sidebars.isPreviewingWorkspaceSource && selectionEditorLocked
          ? sidebars.t.editingLockedBadge
          : undefined,
        jointTypeLocked: sidebars.selection?.entity.type === 'bridge',
        sourceFilePath: sidebars.viewerSourceFilePath,
      }}
    />
  );
}

function SnapshotDialogSection({ snapshot }: Pick<AppLayoutViewProps, 'snapshot'>) {
  if (!snapshot.isOpen) {
    return null;
  }

  return (
    <Suspense fallback={<LazyOverlayFallback label={snapshot.loadingLabel} />}>
      <SnapshotDialog
        isOpen={snapshot.isOpen}
        isCapturing={snapshot.isCapturing}
        captureProgress={snapshot.captureProgress}
        lang={snapshot.lang}
        previewSession={snapshot.previewSession}
        onPreviewCaptureActionChange={snapshot.onPreviewCaptureActionChange}
        onClose={snapshot.onClose}
        onCapture={snapshot.onCapture}
        onCancelCapture={snapshot.onCancelCapture}
      />
    </Suspense>
  );
}

function AssemblyPreparationOverlaySection({
  assemblyPreparation,
}: Pick<AppLayoutViewProps, 'assemblyPreparation'>) {
  const { overlay } = assemblyPreparation;
  if (!overlay) {
    return null;
  }

  return (
    <ImportPreparationOverlay
      label={overlay.label}
      detail={overlay.detail}
      progress={overlay.progress}
      statusLabel={overlay.statusLabel}
      stageLabel={overlay.stageLabel}
    />
  );
}

function AppLayoutOverlaysSection({ overlays }: Pick<AppLayoutViewProps, 'overlays'>) {
  return (
    <AppLayoutOverlays
      isCodeViewerOpen={overlays.isCodeViewerOpen}
      sourceCodeDocuments={overlays.sourceCodeEditorDocuments}
      autoApplyEnabled={overlays.sourceCodeAutoApply}
      loadingSourceCodeEditorLabel={overlays.labels.loadingSourceCodeEditor}
      onCloseCodeViewer={() => overlays.setIsCodeViewerOpen(false)}
      theme={overlays.theme}
      lang={overlays.lang}
      isCollisionOptimizerOpen={overlays.isCollisionOptimizerOpen}
      loadingOptimizerLabel={overlays.labels.loadingOptimizer}
      collisionOptimizationSource={overlays.collisionOptimizationSource}
      assets={overlays.viewerAssets}
      sourceFilePath={overlays.viewerSourceFilePath}
      selection={overlays.selection}
      onCloseCollisionOptimizer={() => overlays.setIsCollisionOptimizerOpen(false)}
      onSelectCollisionTarget={overlays.handlePreviewCollisionOptimizationTarget}
      onApplyCollisionOptimization={overlays.handleApplyCollisionOptimization}
      assemblyState={overlays.normalizedAssemblyState}
      shouldRenderBridgeModal={overlays.shouldRenderBridgeModal}
      loadingBridgeDialogLabel={overlays.labels.loadingBridgeDialog}
      isBridgeModalOpen={overlays.isBridgeModalOpen}
      onCloseBridgeModal={overlays.handleCloseBridgeModal}
      onCreateBridge={overlays.handleCreateBridgeCommit}
      onPreviewBridgeChange={overlays.handleBridgePreviewChange}
    />
  );
}
