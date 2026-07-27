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
  InteractionSelection,
  LinkEntityRef,
  RobotFile,
  Theme,
  UrdfJoint,
  UrdfLink,
  UrdfOrigin,
  WorkspaceSelection,
} from '@/types';
import type { AssemblyScenePlacement, AssemblySceneProjection } from '@/core/robot';
import {
  isEntityEditorLocked,
  isWorkspaceSelectionEditorLocked,
} from '@/core/robot';
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
  projectJointPreviewToWorkspaceComponents,
  projectWorkspaceSelectionToRenderer,
  resolveDefaultViewerToolMode,
  resolveRendererSelectionToWorkspace,
  resolveWorkspaceFocusTarget,
  type ViewerHelperKind,
  type ToolMode,
  type ViewerDocumentLoadEvent,
  type ViewerJointMotionStateValue,
  type ViewerRobotSourceFormat,
  useViewerController,
  shouldNotifyVisualTransformLock,
} from '@/features/editor';
import { resolveViewerJointScopeKey } from '@/app/utils/viewerJointScopeKey';
import { resolveUnifiedViewerForcedSessionState } from '@/app/utils/unifiedViewerForcedSessionState';
import { resolveUnifiedViewerUsageGuideVisibility } from '@/app/utils/unifiedViewerUsageGuide';
import {
  captureUnifiedViewerOptionsVisibility,
  shouldRestoreUnifiedViewerOptionsPanel,
} from '@/app/utils/unifiedViewerOptionsRestore';
import { useUIStore } from '@/store';
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
import { useProjectedJointMotionCommit } from '@/app/hooks/workspace-mutations/projectedJointMotionCommit';
import { useUnifiedViewerSceneLifecycle } from './unified-viewer/useUnifiedViewerSceneLifecycle';

interface UnifiedViewerProps {
  workspace: AssemblyState;
  sceneProjection: AssemblySceneProjection;
  scenePlacement: AssemblyScenePlacement;
  mode: AppMode;
  onSelect: (selection: WorkspaceSelection) => void;
  onHover?: (selection: WorkspaceSelection) => void;
  onUpdate: (
    ref: Extract<EntityRef, { type: 'link' | 'joint' }>,
    data: Partial<UrdfLink> | Partial<UrdfJoint>,
  ) => void;
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
    onNotify,
  }: UnifiedViewerProps) => {
    const t = translations[lang];
    const workspaceInteractionEnabled = modelInteractionEnabled && !filePreview;
    const clearHover = useSelectionStore((state) => state.clearHover);
    const canonicalHoveredSelection = useSelectionStore((state) =>
      workspaceInteractionEnabled ? state.hoveredSelection : null,
    );
    const robot = scenePlacement.robotData;
    const rendererSelection = React.useMemo(
      () => projectWorkspaceSelectionToRenderer(sceneProjection, selection),
      [sceneProjection, selection],
    );
    const rendererHoveredSelection = React.useMemo(
      () => projectWorkspaceSelectionToRenderer(sceneProjection, canonicalHoveredSelection),
      [canonicalHoveredSelection, sceneProjection],
    );
    const rendererFocusTarget = React.useMemo(
      () => resolveWorkspaceFocusTarget(sceneProjection, scenePlacement, focusTarget),
      [focusTarget, scenePlacement, sceneProjection],
    );
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
    const handleRendererSelect = React.useCallback(
      (
        type: Exclude<InteractionSelection['type'], null>,
        id: string,
        subType?: 'visual' | 'collision',
        helperKind?: ViewerHelperKind,
      ) => {
        const nextSelection = resolveRendererSelectionToWorkspace(sceneProjection, {
          type,
          id,
          subType,
          helperKind,
        });
        if (!isWorkspaceSelectionEditorLocked(workspace, nextSelection)) {
          onSelect(nextSelection);
        }
      },
      [onSelect, sceneProjection, workspace],
    );
    const handleRendererMeshSelect = React.useCallback(
      (
        linkId: string,
        _jointId: string | null,
        objectIndex: number,
        objectType: 'visual' | 'collision',
      ) => {
        const nextSelection = resolveRendererSelectionToWorkspace(sceneProjection, {
          type: 'link',
          id: linkId,
          subType: objectType,
          objectIndex,
        });
        if (!isWorkspaceSelectionEditorLocked(workspace, nextSelection)) {
          onSelect(nextSelection);
        }
      },
      [onSelect, sceneProjection, workspace],
    );
    const handleRendererHover = React.useCallback(
      (
        type: InteractionSelection['type'],
        id: string | null,
        subType?: 'visual' | 'collision',
        objectIndex?: number,
        helperKind?: ViewerHelperKind,
        highlightObjectId?: number,
      ) => {
        const nextSelection = resolveRendererSelectionToWorkspace(sceneProjection, {
          type,
          id,
          subType,
          objectIndex,
          helperKind,
          highlightObjectId,
        });
        onHover?.(
          isWorkspaceSelectionEditorLocked(workspace, nextSelection)
            ? null
            : nextSelection,
        );
      },
      [onHover, sceneProjection, workspace],
    );
    const handleRendererUpdate = React.useCallback(
      (type: 'link' | 'joint', id: string, data: unknown) => {
        const resolved = resolveRendererSelectionToWorkspace(sceneProjection, { type, id });
        if (!resolved || (resolved.entity.type !== 'link' && resolved.entity.type !== 'joint')) {
          return;
        }
        if (isEntityEditorLocked(workspace, resolved.entity)) return;
        onUpdate(resolved.entity, data as Partial<UrdfLink> | Partial<UrdfJoint>);
      },
      [onUpdate, sceneProjection, workspace],
    );
    const resolveRendererLinkRef = React.useCallback(
      (linkId: string): LinkEntityRef | null => {
        const resolved = resolveRendererSelectionToWorkspace(sceneProjection, {
          type: 'link',
          id: linkId,
        });
        return resolved?.entity.type === 'link' ? resolved.entity : null;
      },
      [sceneProjection],
    );
    const handleRendererCollisionTransformPreview = React.useCallback(
      (
        linkId: string,
        position: { x: number; y: number; z: number },
        rotation: { r: number; p: number; y: number },
        objectIndex?: number,
      ) => {
        const ref = resolveRendererLinkRef(linkId);
        if (ref && !isEntityEditorLocked(workspace, ref)) {
          onCollisionTransformPreview?.(ref, position, rotation, objectIndex);
        }
      },
      [onCollisionTransformPreview, resolveRendererLinkRef, workspace],
    );
    const handleRendererCollisionTransform = React.useCallback(
      (
        linkId: string,
        position: { x: number; y: number; z: number },
        rotation: { r: number; p: number; y: number },
        objectIndex?: number,
      ) => {
        const ref = resolveRendererLinkRef(linkId);
        if (ref && !isEntityEditorLocked(workspace, ref)) {
          onCollisionTransform?.(ref, position, rotation, objectIndex);
        }
      },
      [onCollisionTransform, resolveRendererLinkRef, workspace],
    );
    const handleRendererAssemblyTransform = React.useCallback(
      (transform: AssemblyTransform) => {
        onAssemblyTransform?.({ type: 'assembly' }, transform);
      },
      [onAssemblyTransform],
    );
    const handleRendererComponentTransform = React.useCallback(
      (componentId: string, transform: AssemblyTransform, options?: UpdateCommitOptions) => {
        if (isEntityEditorLocked(workspace, { type: 'component', componentId })) return;
        onComponentTransform?.({ type: 'component', componentId }, transform, options);
      },
      [onComponentTransform, workspace],
    );
    const handleRendererBridgeTransform = React.useCallback(
      (bridgeId: string, origin: UrdfOrigin, options?: UpdateCommitOptions) => {
        if (isEntityEditorLocked(workspace, { type: 'bridge', bridgeId })) return;
        onBridgeTransform?.({ type: 'bridge', bridgeId }, origin, options);
      },
      [onBridgeTransform, workspace],
    );
    const commitProjectedJointMotion = useProjectedJointMotionCommit(sceneProjection);
    const assemblyAutoGrounding = useAssemblyAutoGroundingCoordinator({
      enabled: workspaceInteractionEnabled,
      onComponentTransform,
    });
    const projectJointInteractionPreview = React.useCallback(
      (preview: Parameters<typeof projectJointPreviewToWorkspaceComponents>[1]) =>
        projectJointPreviewToWorkspaceComponents(sceneProjection, preview),
      [sceneProjection],
    );
    const viewerController = useViewerController({
      onJointChange: (_jointName, _angle, context) => {
        if (context) {
          commitProjectedJointMotion(context);
        }
      },
      syncJointChangesToApp: effectiveSyncJointChangesToApp,
      showJointPanel,
      jointAngleState: effectiveJointAngleState,
      jointMotionState: effectiveJointMotionState,
      onSelect: handleRendererSelect,
      onMeshSelect: handleRendererMeshSelect,
      onHover: handleRendererHover,
      selection: rendererSelection,
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
      projectJointInteractionPreview,
    });
    const previousShowCollisionRef = React.useRef(viewerController.showCollision);

    useEffect(() => {
      const wasShowingCollision = previousShowCollisionRef.current;
      previousShowCollisionRef.current = viewerController.showCollision;
      if (shouldNotifyVisualTransformLock(wasShowingCollision, viewerController.showCollision)) {
        onNotify?.(t.visualTransformDisabledWithCollisions, 'info');
      }
    }, [onNotify, t.visualTransformDisabledWithCollisions, viewerController.showCollision]);
    const nextForcedViewerSession = resolveUnifiedViewerForcedSessionState({
      forcedViewerSession,
      pendingViewerToolMode,
      viewerToolMode: viewerController.toolMode,
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
    const showWorldOriginAxes = showWorldOriginAxesPreference && !viewerController.showOrigins;
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
        viewerController.handlePointerMissed();
      }
      restoreOptionsPanelIfNeeded(
        optionsVisibleAtPointerDownRef.current.viewer,
        viewerOptionsVisibleRef,
        setShowOptionsPanel,
      );
    }, [
      restoreOptionsPanelIfNeeded,
      setShowOptionsPanel,
      viewerController,
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

      viewerController.handleToolModeChange(pendingViewerToolMode);
      onConsumePendingViewerToolMode?.();
    }, [isViewerMode, onConsumePendingViewerToolMode, pendingViewerToolMode, viewerController]);

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

    useEffect(() => {
      if (!workspaceInteractionEnabled) {
        return undefined;
      }

      const handleWindowBlur = () => {
        clearHover();
      };
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'hidden') {
          clearHover();
        }
      };

      window.addEventListener('blur', handleWindowBlur);
      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        window.removeEventListener('blur', handleWindowBlur);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }, [clearHover, workspaceInteractionEnabled]);

    const handleWorkspaceMouseLeave = React.useCallback(() => {
      viewerController.handleMouseUp();
      if (workspaceInteractionEnabled) {
        clearHover();
      }
    }, [clearHover, viewerController, workspaceInteractionEnabled]);

    return (
      <WorkspaceCanvas
        className="relative w-full h-full overflow-hidden"
        theme={theme}
        lang={lang}
        robotName={activePreview ? activePreview.fileName : robot.name || 'robot'}
        renderKey={`viewer:stable:${viewerReloadKey}`}
        containerRef={viewerController.containerRef}
        snapshotAction={snapshotAction}
        previewAction={previewAction}
        onCreated={onCanvasCreated}
        onPointerDownCapture={handleWorkspacePointerDownCapture}
        onPointerMissed={handleViewerPointerMissed}
        onMouseMove={viewerController.handleMouseMove}
        onMouseUp={viewerController.handleMouseUp}
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
        controlLayerKey={controlLayerKey}
        gizmoMargin={gizmoMargin}
        showWorldOriginAxes={showWorldOriginAxes}
        cameraProjection={cameraProjection}
        orbitControlsProps={{
          minDistance: 0.05,
          maxDistance: 2000,
          enabled: !viewerController.isDragging,
          zoomSensitivity: navigationSensitivity.zoom,
          rotateSensitivity: navigationSensitivity.rotate,
          panSensitivity: navigationSensitivity.pan,
          onStart: () => {
            viewerController.isOrbitDragging.current = true;
          },
          onEnd: () => {
            viewerController.isOrbitDragging.current = false;
          },
        }}
        background={WORKSPACE_CANVAS_BACKGROUND}
        showUsageGuide={effectiveShowUsageGuide}
        overlays={
          <UnifiedViewerOverlays
            activePreview={activePreview}
            lang={lang}
            onClosePreview={onClosePreview}
            viewerController={viewerController}
            onUpdate={handleRendererUpdate}
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
          selection={rendererSelection}
          hoveredSelection={rendererHoveredSelection}
          onHover={handleRendererHover}
          onMeshSelect={handleRendererMeshSelect}
          onUpdate={handleRendererUpdate}
          onJointMotionCommit={commitProjectedJointMotion}
          robot={robot}
          focusTarget={rendererFocusTarget}
          onCollisionTransformPreview={handleRendererCollisionTransformPreview}
          onCollisionTransform={handleRendererCollisionTransform}
          isMeshPreview={isMeshPreview}
          viewerReloadKey={viewerReloadKey}
          workspace={workspace}
          sceneProjection={sceneProjection}
          scenePlacement={scenePlacement}
          workspaceSelection={selection}
          onAssemblyTransform={handleRendererAssemblyTransform}
          onComponentTransform={handleRendererComponentTransform}
          onBridgeTransform={handleRendererBridgeTransform}
          pendingAutoGroundComponentIds={assemblyAutoGrounding.pendingComponentIds}
          onAssemblyComponentAutoGroundResolved={assemblyAutoGrounding.onResolution}
          t={t}
          ikDragActive={ikDragActive}
        />
      </WorkspaceCanvas>
    );
  },
);
