import React, { useEffect } from 'react';
import type { RootState } from '@react-three/fiber';
import type { Group as ThreeGroup, Object3D as ThreeObject3D } from 'three';
import type {
  AppMode,
  AssemblyEntityRef,
  AssemblyState,
  AssemblyTransform,
  BridgeEntityRef,
  ComponentEntityRef,
  EntityRef,
  LinkEntityRef,
  RobotFile,
  Theme,
  UrdfOrigin,
  WorkspaceSelection,
} from '@/types';
import type { AssemblyScenePlacement, AssemblySceneProjection } from '@/core/robot';
import type { Language } from '@/shared/i18n';
import { translations } from '@/shared/i18n';
import { WorkspaceCanvas } from '@/shared/components/3d';
import {
  STUDIO_ENVIRONMENT_INTENSITY,
  WORKSPACE_CANVAS_BACKGROUND,
  type SnapshotCaptureAction,
  type SnapshotPreviewAction,
  type WorkspaceOverlayGizmoMargin,
} from '@/shared/components/3d';
import {
  resolveDefaultViewerToolMode,
  type ToolMode,
  type ViewerDocumentLoadEvent,
  type ViewerJointMotionStateValue,
  type ViewerRobotSourceFormat,
  useViewerController,
} from '@/features/editor';
import { resolveViewerJointScopeKey } from '@/app/utils/viewerJointScopeKey';
import { resolveUnifiedViewerForcedSessionState } from '@/app/utils/unifiedViewerForcedSessionState';
import { resolveUnifiedViewerUsageGuideVisibility } from '@/app/utils/unifiedViewerUsageGuide';
import {
  captureUnifiedViewerOptionsVisibility,
  shouldRestoreUnifiedViewerOptionsPanel,
} from '@/app/utils/unifiedViewerOptionsRestore';
import { useUIStore } from '@/store';
import { VIEWER_RENDER_QUALITY_PROFILES } from '@/shared/utils/viewerRenderQuality';
import { subscribeWorkspaceGroundPlaneInvalidation } from '@/store/robotGroundPlaneInvalidation';
import type { DocumentLoadLifecycleState } from '@/store/assetsStore';
import type { UpdateCommitOptions } from '@/types/viewer';
import {
  syncGroupRaycastInteractivity,
  type RaycastableObject,
} from './unified-viewer/raycastInteractivity';
import { preloadDeferredViewerModeModules } from './unified-viewer/modeModuleLoaders';
import { schedulePostReadyBackgroundTask } from '@/app/utils/postReadyBackgroundTask';
import { UnifiedViewerOverlays } from './unified-viewer/UnifiedViewerOverlays';
import { UnifiedViewerSceneRoots } from './unified-viewer/UnifiedViewerSceneRoots';
import type { FilePreviewState } from './unified-viewer/types';
import { useUnifiedViewerDerivedState } from './unified-viewer/useUnifiedViewerDerivedState';
import { useSelectionStore } from '@/store/selectionStore';
import { logRegressionWarn } from '@/shared/debug/consoleDiagnostics';
import { useAssemblyAutoGroundingCoordinator } from '@/app/hooks/workspace-mutations/assemblyAutoGrounding';
import { useUnifiedViewerSceneLifecycle } from './unified-viewer/useUnifiedViewerSceneLifecycle';
import {
  useUnifiedViewerRendererAdapter,
  type UnifiedViewerWorkspaceUpdateHandler,
} from './unified-viewer/useUnifiedViewerRendererAdapter';

interface UnifiedViewerProps {
  workspace: AssemblyState;
  sceneProjection: AssemblySceneProjection;
  scenePlacement: AssemblyScenePlacement;
  mode: AppMode;
  onSelect: (selection: WorkspaceSelection) => void;
  onHover?: (selection: WorkspaceSelection) => void;
  onUpdate: UnifiedViewerWorkspaceUpdateHandler;
  assets: Record<string, string>;
  allFileContents: Record<string, string>;
  lang: Language;
  theme: Theme;
  showVisual?: boolean;
  setShowVisual?: (show: boolean) => void;
  showUsageGuide?: boolean;
  snapshotAction?: React.RefObject<SnapshotCaptureAction | null>;
  previewAction?: React.RefObject<SnapshotPreviewAction | null>;
  onCanvasCreated?: (state: RootState) => void;
  showOptionsPanel?: boolean;
  setShowOptionsPanel?: (show: boolean) => void;
  showJointPanel?: boolean;
  setShowJointPanel?: (show: boolean) => void;
  showToolbar?: boolean;
  availableFiles: RobotFile[];
  urdfContent: string;
  viewerSourceFormat?: ViewerRobotSourceFormat;
  sourceFilePath?: string;
  sourceFile?: RobotFile | null;
  onDocumentLoadEvent?: (event: ViewerDocumentLoadEvent) => void;
  onRuntimeRobotLoaded?: (robot: ThreeObject3D) => void;
  onRuntimeSceneReadyForDisplay?: () => void;
  jointAngleState?: Record<string, number>;
  jointMotionState?: Record<string, ViewerJointMotionStateValue>;
  selection: WorkspaceSelection;
  modelInteractionEnabled?: boolean;
  focusTarget?: EntityRef | null;
  isMeshPreview?: boolean;
  onTransformPendingChange?: (pending: boolean) => void;
  onCollisionTransformPreview?: (
    ref: LinkEntityRef,
    position: { x: number; y: number; z: number },
    rotation: { r: number; p: number; y: number },
    objectIndex?: number,
  ) => void;
  onCollisionTransform?: (
    ref: LinkEntityRef,
    position: { x: number; y: number; z: number },
    rotation: { r: number; p: number; y: number },
    objectIndex?: number,
  ) => void;
  onAssemblyTransform?: (
    ref: AssemblyEntityRef,
    transform: AssemblyTransform,
    options?: UpdateCommitOptions,
  ) => void;
  onComponentTransform?: (
    ref: ComponentEntityRef,
    transform: AssemblyTransform,
    options?: UpdateCommitOptions,
  ) => void;
  onBridgeTransform?: (
    ref: BridgeEntityRef,
    origin: UrdfOrigin,
    options?: UpdateCommitOptions,
  ) => void;
  filePreview?: FilePreviewState;
  onClosePreview?: () => void;
  ikDragActive?: boolean;
  pendingViewerToolMode?: ToolMode | null;
  onConsumePendingViewerToolMode?: () => void;
  viewerReloadKey?: number;
  documentLoadState: DocumentLoadLifecycleState;
  gizmoMargin?: WorkspaceOverlayGizmoMargin;
  onNotify?: (message: string, type?: 'info' | 'success' | 'error') => void;
}

export const UnifiedViewer = React.memo(
  ({
    workspace,
    sceneProjection,
    scenePlacement,
    mode,
    onSelect,
    onHover,
    onUpdate,
    assets,
    allFileContents,
    lang,
    theme,
    showVisual,
    setShowVisual,
    showUsageGuide,
    snapshotAction,
    previewAction,
    onCanvasCreated,
    showOptionsPanel = true,
    setShowOptionsPanel,
    showJointPanel = true,
    setShowJointPanel,
    showToolbar = true,
    availableFiles,
    urdfContent,
    viewerSourceFormat,
    sourceFilePath,
    sourceFile,
    onDocumentLoadEvent,
    onRuntimeRobotLoaded,
    onRuntimeSceneReadyForDisplay,
    jointAngleState,
    jointMotionState,
    selection,
    modelInteractionEnabled = true,
    focusTarget,
    isMeshPreview = false,
    onTransformPendingChange,
    onCollisionTransformPreview,
    onCollisionTransform,
    onAssemblyTransform,
    onComponentTransform,
    onBridgeTransform,
    filePreview,
    onClosePreview,
    ikDragActive = false,
    pendingViewerToolMode = null,
    onConsumePendingViewerToolMode,
    viewerReloadKey = 0,
    documentLoadState,
    gizmoMargin,
  }: UnifiedViewerProps) => {
    const t = translations[lang];
    const workspaceInteractionEnabled = modelInteractionEnabled && !filePreview;
    const clearHover = useSelectionStore((state) => state.clearHover);
    const canonicalHoveredSelection = useSelectionStore((state) =>
      workspaceInteractionEnabled ? state.hoveredSelection : null,
    );
    const robot = scenePlacement.robotData;
    const {
      groundPlaneOffset,
      setGroundPlaneOffset,
      forcedViewerSession,
      setForcedViewerSession,
      activePreview,
      isPreviewing,
      isViewerMode,
      viewerSceneMode,
      mountState,
      setMountState,
      resolvedTheme,
      viewerOptionsVisibleRef,
      optionsVisibleAtPointerDownRef,
      effectiveUrdfContent,
      effectiveSourceFilePath,
      effectiveSourceFile,
      viewerResourceScope,
      viewportState,
    } = useUnifiedViewerDerivedState({
      mode,
      filePreview,
      pendingViewerToolMode,
      theme,
      showOptionsPanel,
      robot,
      urdfContent,
      sourceFilePath,
      sourceFile,
      assets,
      allFileContents,
      availableFiles,
      viewerReloadKey,
      documentLoadState,
    });
    const effectiveJointAngleState = isPreviewing ? undefined : jointAngleState;
    const effectiveJointMotionState = isPreviewing ? undefined : jointMotionState;
    const effectiveSyncJointChangesToApp = !isPreviewing;
    const { viewerVisible, shouldRenderViewerScene, useViewerCanvasPresentation } = viewportState;
    const viewerGroupRef = React.useRef<ThreeGroup | null>(null);
    const viewerRaycastCacheRef = React.useRef(
      new WeakMap<RaycastableObject, NonNullable<RaycastableObject['raycast']>>(),
    );
    const handleInactiveViewerTimeout = React.useCallback(
      () =>
        setMountState((current) =>
          current.viewerMounted ? { ...current, viewerMounted: false } : current,
        ),
      [setMountState],
    );
    const { retainedRobot: retainedViewerRobot, onRuntimeRobotLoaded: retainRuntimeRobot } =
      useUnifiedViewerSceneLifecycle({
        viewerVisible,
        viewerMounted: mountState.viewerMounted,
        sourceFile: effectiveSourceFile,
        sourceFilePath: effectiveSourceFilePath,
        sourceFormat: viewerSourceFormat,
        onInactiveViewerTimeout: handleInactiveViewerTimeout,
      });
    const handleRuntimeRobotLoaded = React.useCallback(
      (loadedRobot: ThreeObject3D) => {
        retainRuntimeRobot(loadedRobot);
        onRuntimeRobotLoaded?.(loadedRobot);
      },
      [onRuntimeRobotLoaded, retainRuntimeRobot],
    );
    const viewerReadOnlyInteraction = isPreviewing || !modelInteractionEnabled;
    const viewerDefaultToolMode = viewerReadOnlyInteraction
      ? 'view'
      : resolveDefaultViewerToolMode(effectiveSourceFile?.format);
    const viewerToolModeScopeKey = effectiveSourceFile
      ? `${effectiveSourceFile.format}:${effectiveSourceFile.name}`
      : effectiveSourceFilePath
        ? `inline:${effectiveSourceFilePath}`
        : 'inline:unified-viewer';
    const rendererAdapter = useUnifiedViewerRendererAdapter({
      workspace,
      sceneProjection,
      scenePlacement,
      selection,
      hoveredSelection: canonicalHoveredSelection,
      focusTarget,
      workspaceInteractionEnabled,
      clearHover,
      onSelect,
      onHover,
      onUpdate,
      onCollisionTransformPreview,
      onCollisionTransform,
      onAssemblyTransform,
      onComponentTransform,
      onBridgeTransform,
    });
    const assemblyAutoGrounding = useAssemblyAutoGroundingCoordinator({
      enabled: workspaceInteractionEnabled,
      onComponentTransform,
    });
    const viewerController = useViewerController({
      onJointChange: (_jointName, _angle, context) => {
        if (context) {
          rendererAdapter.commitProjectedJointMotion(context);
        }
      },
      syncJointChangesToApp: effectiveSyncJointChangesToApp,
      showJointPanel,
      jointAngleState: effectiveJointAngleState,
      jointMotionState: effectiveJointMotionState,
      onSelect: rendererAdapter.handleRendererSelect,
      onMeshSelect: rendererAdapter.handleRendererMeshSelect,
      onHover: rendererAdapter.handleRendererHover,
      selection: rendererAdapter.rendererSelection,
      showVisual,
      setShowVisual,
      onTransformPendingChange,
      groundPlaneOffset,
      setGroundPlaneOffset,
      active: isViewerMode,
      jointStateScopeKey: resolveViewerJointScopeKey({
        previewFileName: activePreview?.fileName,
        sourceFile,
        sourceFilePath,
        robotName: robot.name,
      }),
      defaultToolMode: viewerDefaultToolMode,
      toolModeScopeKey: viewerToolModeScopeKey,
      closedLoopRobotState: robot,
      projectJointInteractionPreview: rendererAdapter.projectJointInteractionPreview,
    });
    const nextForcedViewerSession = resolveUnifiedViewerForcedSessionState({
      forcedViewerSession,
      pendingViewerToolMode,
      viewerToolMode: viewerController.toolbar.toolMode,
    });

    useEffect(() => {
      if (forcedViewerSession === nextForcedViewerSession) {
        return;
      }

      setForcedViewerSession(nextForcedViewerSession);
    }, [forcedViewerSession, nextForcedViewerSession]);

    const handleViewerDocumentLoadEvent = React.useCallback(
      (event: ViewerDocumentLoadEvent) => {
        onDocumentLoadEvent?.(event);
      },
      [onDocumentLoadEvent],
    );
    const handleViewerSceneReadyForDisplay = React.useCallback(() => {
      onRuntimeSceneReadyForDisplay?.();
    }, [onRuntimeSceneReadyForDisplay]);

    const controlLayerKey = 'shared';
    const workspaceEnvironment = 'studio' as const;
    const workspaceEnvironmentIntensity = useViewerCanvasPresentation
      ? STUDIO_ENVIRONMENT_INTENSITY.viewer[resolvedTheme]
      : STUDIO_ENVIRONMENT_INTENSITY.workspace[resolvedTheme];
    const showWorldOriginAxesPreference = useUIStore((state) => state.viewOptions.showAxes);
    const showUsageGuidePreference = useUIStore((state) => state.viewOptions.showUsageGuide);
    const navigationSensitivity = useUIStore((state) => state.navigationSensitivity);
    const cameraProjection = useUIStore((state) => state.viewOptions.cameraProjection);
    const renderQuality = useUIStore((state) => state.viewOptions.renderQuality);
    const renderQualityProfile = VIEWER_RENDER_QUALITY_PROFILES[renderQuality];
    const showWorldOriginAxes =
      showWorldOriginAxesPreference && !viewerController.optionsPanel.showOrigins;
    const effectiveShowUsageGuide = resolveUnifiedViewerUsageGuideVisibility(
      showUsageGuidePreference,
      showUsageGuide,
    );

    const handleWorkspacePointerDownCapture = React.useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        void event;
        optionsVisibleAtPointerDownRef.current = captureUnifiedViewerOptionsVisibility({
          showViewerOptions: showOptionsPanel,
        });
      },
      [showOptionsPanel],
    );

    // Blank-canvas clicks should clear selection, not dismiss an already-open options panel.
    const restoreOptionsPanelIfNeeded = React.useCallback(
      (
        wasVisibleAtPointerDown: boolean,
        panelVisibleRef: React.MutableRefObject<boolean>,
        restoreOptionsPanel: ((show: boolean) => void) | undefined,
      ) => {
        if (
          !shouldRestoreUnifiedViewerOptionsPanel({
            wasVisibleAtPointerDown,
            isVisibleNow: panelVisibleRef.current,
            hasRestoreHandler: Boolean(restoreOptionsPanel),
          }) ||
          !restoreOptionsPanel
        ) {
          return;
        }

        window.requestAnimationFrame(() => {
          if (
            shouldRestoreUnifiedViewerOptionsPanel({
              wasVisibleAtPointerDown,
              isVisibleNow: panelVisibleRef.current,
              hasRestoreHandler: true,
            })
          ) {
            restoreOptionsPanel(true);
          }
        });
      },
      [],
    );

    const handleViewerPointerMissed = React.useCallback(() => {
      if (!viewerReadOnlyInteraction) {
        viewerController.interaction.handlePointerMissed();
      }
      restoreOptionsPanelIfNeeded(
        optionsVisibleAtPointerDownRef.current.viewer,
        viewerOptionsVisibleRef,
        setShowOptionsPanel,
      );
    }, [
      restoreOptionsPanelIfNeeded,
      setShowOptionsPanel,
      viewerController.interaction,
      viewerReadOnlyInteraction,
    ]);

    useEffect(() => {
      const root = viewerGroupRef.current;
      syncGroupRaycastInteractivity(root, viewerVisible, viewerRaycastCacheRef.current);

      return () => {
        syncGroupRaycastInteractivity(root, true, viewerRaycastCacheRef.current);
      };
    }, [viewerVisible, shouldRenderViewerScene, viewerReloadKey]);

    useEffect(() => {
      if (!pendingViewerToolMode || !isViewerMode) {
        return;
      }

      viewerController.toolbar.handleToolModeChange(pendingViewerToolMode);
      onConsumePendingViewerToolMode?.();
    }, [
      isViewerMode,
      onConsumePendingViewerToolMode,
      pendingViewerToolMode,
      viewerController.toolbar,
    ]);

    useEffect(() => {
      return schedulePostReadyBackgroundTask(
        () => {
          void preloadDeferredViewerModeModules().catch((error) => {
            logRegressionWarn('[UnifiedViewer] Failed to preload deferred mode modules.', error);
          });
        },
        {
          delayMs: 1_500,
          idleTimeoutMs: 5_000,
        },
      );
    }, []);

    const handleWorkspaceMouseLeave = React.useCallback(() => {
      viewerController.layout.handleMouseUp();
      if (workspaceInteractionEnabled) {
        clearHover();
      }
    }, [clearHover, viewerController.layout, workspaceInteractionEnabled]);

    return (
      <WorkspaceCanvas
        className="relative w-full h-full overflow-hidden"
        theme={theme}
        lang={lang}
        robotName={activePreview ? activePreview.fileName : robot.name || 'robot'}
        renderKey={`viewer:stable:${viewerReloadKey}`}
        containerRef={viewerController.layout.containerRef}
        snapshotAction={snapshotAction}
        previewAction={previewAction}
        onCreated={onCanvasCreated}
        onPointerDownCapture={handleWorkspacePointerDownCapture}
        onPointerMissed={handleViewerPointerMissed}
        onMouseMove={viewerController.layout.handleMouseMove}
        onMouseUp={viewerController.layout.handleMouseUp}
        onMouseLeave={handleWorkspaceMouseLeave}
        environment={workspaceEnvironment}
        environmentIntensity={workspaceEnvironmentIntensity}
        subscribeGroundPlaneInvalidation={subscribeWorkspaceGroundPlaneInvalidation}
        cameraFollowPrimary={useViewerCanvasPresentation}
        // Keep the authored material colors, lighting, and drafting grid on the
        // same direct-render path while orbiting and while resting. The realtime
        // GTAO composer applies its final OutputPass only after interaction ends,
        // which visibly darkens the robot and softens the grid at rest.
        enableAmbientOcclusion={false}
        minDpr={renderQualityProfile.minDpr}
        maxDpr={renderQualityProfile.maxDpr}
        shadowMapSize={renderQualityProfile.shadowMapSize}
        controlLayerKey={controlLayerKey}
        gizmoMargin={gizmoMargin}
        showWorldOriginAxes={showWorldOriginAxes}
        cameraProjection={cameraProjection}
        orbitControlsProps={{
          // Keep the main editor's orbit pivot stable across rotate + zoom.
          // Cursor zoom needs surface-depth picking to avoid target drift.
          zoomToCursor: false,
          maxDistance: 2000,
          enabled: !viewerController.interaction.isDragging,
          zoomSensitivity: navigationSensitivity.zoom,
          rotateSensitivity: navigationSensitivity.rotate,
          panSensitivity: navigationSensitivity.pan,
          onStart: () => {
            viewerController.interaction.isOrbitDragging.current = true;
          },
          onEnd: () => {
            viewerController.interaction.isOrbitDragging.current = false;
          },
        }}
        background={WORKSPACE_CANVAS_BACKGROUND}
        showUsageGuide={effectiveShowUsageGuide}
        overlays={
          <UnifiedViewerOverlays
            activePreview={activePreview}
            lang={lang}
            onClosePreview={onClosePreview}
            viewerPanels={{
              toolbar: viewerController.toolbar,
              layout: viewerController.layout,
              optionsPanel: viewerController.optionsPanel,
              jointsPanel: viewerController.jointsPanel,
              measureTool: viewerController.measureTool,
              paintTool: viewerController.paintTool,
            }}
            onUpdate={rendererAdapter.handleRendererUpdate}
            showOptionsPanel={showOptionsPanel}
            setShowOptionsPanel={setShowOptionsPanel}
            showJointPanel={showJointPanel}
            setShowJointPanel={setShowJointPanel}
            showToolbar={showToolbar}
          />
        }
      >
        <UnifiedViewerSceneRoots
          shouldRenderViewerScene={shouldRenderViewerScene}
          viewerGroupRef={viewerGroupRef}
          viewerVisible={viewerVisible}
          viewerController={viewerController}
          activePreview={activePreview}
          modelInteractionEnabled={modelInteractionEnabled}
          viewerResourceScope={viewerResourceScope}
          retainedRobot={retainedViewerRobot}
          effectiveSourceFile={effectiveSourceFile}
          effectiveSourceFilePath={effectiveSourceFilePath}
          effectiveUrdfContent={effectiveUrdfContent}
          effectiveSourceFormat={viewerSourceFormat}
          onDocumentLoadEvent={handleViewerDocumentLoadEvent}
          onSceneReadyForDisplay={handleViewerSceneReadyForDisplay}
          onRuntimeRobotLoaded={handleRuntimeRobotLoaded}
          viewerSceneMode={viewerSceneMode}
          selection={rendererAdapter.rendererSelection}
          hoveredSelection={rendererAdapter.rendererHoveredSelection}
          onHover={rendererAdapter.handleRendererHover}
          onMeshSelect={rendererAdapter.handleRendererMeshSelect}
          onUpdate={rendererAdapter.handleRendererUpdate}
          onJointMotionCommit={rendererAdapter.commitProjectedJointMotion}
          robot={robot}
          focusTarget={rendererAdapter.rendererFocusTarget}
          onCollisionTransformPreview={rendererAdapter.handleRendererCollisionTransformPreview}
          onCollisionTransform={rendererAdapter.handleRendererCollisionTransform}
          isMeshPreview={isMeshPreview}
          viewerReloadKey={viewerReloadKey}
          workspace={workspace}
          sceneProjection={sceneProjection}
          scenePlacement={scenePlacement}
          workspaceSelection={selection}
          onAssemblyTransform={rendererAdapter.handleRendererAssemblyTransform}
          onComponentTransform={rendererAdapter.handleRendererComponentTransform}
          onBridgeTransform={rendererAdapter.handleRendererBridgeTransform}
          pendingAutoGroundComponentIds={assemblyAutoGrounding.pendingComponentIds}
          onAssemblyComponentAutoGroundResolved={assemblyAutoGrounding.onResolution}
          t={t}
          ikDragActive={ikDragActive}
        />
      </WorkspaceCanvas>
    );
  },
);
