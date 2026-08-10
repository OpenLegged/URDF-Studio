import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useUIStore } from '@/store/uiStore';
import type {
  JointInteractionPreviewSnapshot,
  WorkspaceJointInteractionPreview,
} from '@/store/jointInteractionPreviewStore';
import type { RuntimeRobotObject } from '@/shared/components/3d/runtimeRobotTypes';
import type { InteractionSelection, RobotState } from '@/types';
import type {
  ToolMode,
  ViewerHelperKind,
  ViewerJointChangeContext,
  ViewerJointMotionStateValue,
  ViewerProps,
} from '../types';
import { resolveActiveViewerJointKeyFromSelection } from '../utils/activeJointSelection';
import { createEmptyMeasureState } from '../utils/measurements';
import type { RuntimeViewerRobot } from '../utils/runtimeRobotMotion';
import { useRuntimeJointLimitOverride } from './useRuntimeJointLimitOverride';
import { useViewerSettings } from './useViewerSettings';
import { useJointInteractionController } from './viewer-controller/useJointInteractionController';
import { useJointInteractionPreviewPublisher } from './viewer-controller/useJointInteractionPreviewPublisher';
import { useJointPanelState } from './viewer-controller/useJointPanelState';
import { useJointRuntimeMotionState } from './viewer-controller/useJointRuntimeMotionState';
import { usePanelLayoutController } from './viewer-controller/usePanelLayoutController';
import { useRegressionBridge } from './viewer-controller/useRegressionBridge';
import { useSceneRefreshScheduler } from './viewer-controller/useSceneRefreshScheduler';
import { useToolModeController } from './viewer-controller/useToolModeController';
import { useViewerGroundingController } from './viewer-controller/useViewerGroundingController';
import { useViewerInteractionLock } from './viewer-controller/useViewerInteractionLock';
import type {
  ViewerControllerInteractionSurface,
  ViewerControllerJointsPanelSurface,
  ViewerControllerLayoutSurface,
  ViewerControllerMeasureToolSurface,
  ViewerControllerOptionsPanelSurface,
  ViewerControllerPaintToolSurface,
  ViewerControllerRuntimeSurface,
  ViewerControllerToolbarSurface,
} from './viewer-controller/viewerControllerSurfaces';

type Selection = ViewerProps['selection'];

interface UseViewerControllerProps {
  onJointChange?: ViewerProps['onJointChange'];
  syncJointChangesToApp?: boolean;
  showJointPanel?: boolean;
  jointAngleState?: ViewerProps['jointAngleState'];
  jointMotionState?: Record<string, ViewerJointMotionStateValue>;
  onSelect?: ViewerProps['onSelect'];
  onMeshSelect?: ViewerProps['onMeshSelect'];
  onHover?: ViewerProps['onHover'];
  selection?: Selection;
  showVisual?: ViewerProps['showVisual'];
  setShowVisual?: ViewerProps['setShowVisual'];
  onTransformPendingChange?: ViewerProps['onTransformPendingChange'];
  groundPlaneOffset?: number;
  setGroundPlaneOffset?: (offset: number) => void;
  groundPlaneOffsetReadOnly?: boolean;
  active?: boolean;
  enableRegressionBridge?: boolean;
  jointStateScopeKey?: string | null;
  defaultToolMode?: ToolMode;
  toolModeScopeKey?: string | null;
  closedLoopRobotState?: Pick<
    RobotState,
    'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'
  > | null;
  projectJointInteractionPreview?: (
    preview: Pick<
      JointInteractionPreviewSnapshot,
      'activeJointId' | 'jointAngles' | 'jointQuaternions' | 'jointOrigins'
    >,
  ) => Record<string, WorkspaceJointInteractionPreview>;
}

export const useViewerController = ({
  onJointChange,
  syncJointChangesToApp = false,
  jointAngleState,
  jointMotionState,
  onSelect,
  onHover,
  selection,
  showVisual: propShowVisual,
  setShowVisual: propSetShowVisual,
  onTransformPendingChange,
  groundPlaneOffset = 0,
  setGroundPlaneOffset,
  groundPlaneOffsetReadOnly = false,
  active = true,
  enableRegressionBridge = true,
  jointStateScopeKey = null,
  defaultToolMode = 'select',
  toolModeScopeKey = null,
  closedLoopRobotState = null,
  projectJointInteractionPreview,
}: UseViewerControllerProps) => {
  const isOrbitDragging = useRef(false);
  const justSelectedRef = useRef(false);
  const [robot, setRobot] = useState<RuntimeRobotObject | null>(null);
  const [jointPanelRobot, setJointPanelRobot] = useState<RuntimeRobotObject | null>(null);
  const {
    showCollision,
    setShowCollision,
    showCollisionAlwaysOnTop,
    setShowCollisionAlwaysOnTop,
    localShowVisual,
    setLocalShowVisual,
    showIkHandles,
    setShowIkHandles,
    showIkHandlesAlwaysOnTop,
    setShowIkHandlesAlwaysOnTop,
    showCenterOfMass,
    setShowCenterOfMass,
    showCoMOverlay,
    setShowCoMOverlay,
    centerOfMassSize,
    setCenterOfMassSize,
    showInertia,
    setShowInertia,
    showInertiaOverlay,
    setShowInertiaOverlay,
    showOrigins,
    setShowOrigins,
    showOriginsOverlay,
    setShowOriginsOverlay,
    originSize,
    setOriginSize: setOriginSizePreference,
    showMjcfSites,
    setShowMjcfSites,
    showJointAxes,
    setShowJointAxes,
    showJointAxesOverlay,
    setShowJointAxesOverlay,
    jointAxisSize,
    setJointAxisSize,
    interactionLayerPriority,
    recordInteractionLayerActivation,
    modelOpacity,
    setModelOpacity,
    highlightMode,
    setHighlightMode,
    isOptionsCollapsed,
    toggleOptionsCollapsed,
    isJointsCollapsed,
    toggleJointsCollapsed,
  } = useViewerSettings();

  const showVisual = propShowVisual !== undefined ? propShowVisual : localShowVisual;
  const setShowVisual = useCallback<React.Dispatch<React.SetStateAction<boolean>>>(
    (nextValue) => {
      const resolvedValue = typeof nextValue === 'function' ? nextValue(showVisual) : nextValue;
      (propSetShowVisual || setLocalShowVisual)(resolvedValue);
      if (resolvedValue) {
        recordInteractionLayerActivation('visual');
      }
    },
    [propSetShowVisual, recordInteractionLayerActivation, setLocalShowVisual, showVisual],
  );

  const {
    normalizedToolModeScopeKey,
    toolModeState,
    setToolModeState,
    resolvedToolModeState,
    toolMode,
    transformMode,
    measureState,
    setMeasureState,
    setMeasureMode,
    measureAnchorMode,
    setMeasureAnchorMode,
    showMeasureDecomposition,
    setShowMeasureDecomposition,
    measurePoseRepresentation,
    setMeasurePoseRepresentation,
    paintColor,
    setPaintColor,
    paintSelectionScope,
    setPaintSelectionScope,
    paintOperation,
    setPaintOperation,
    paintInteractionRef,
    paintStatus,
    setPaintStatus,
  } = useToolModeController({ defaultToolMode, toolModeScopeKey });
  const {
    containerRef,
    optionsPanelRef,
    jointPanelRef,
    measurePanelRef,
    paintPanelRef,
    optionsPanelPos,
    jointPanelPos,
    measurePanelPos,
    paintPanelPos,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  } = usePanelLayoutController();
  const updateGroundPlaneOffset = useCallback(
    (nextOffset: number) => {
      setGroundPlaneOffset?.(nextOffset);
    },
    [setGroundPlaneOffset],
  );

  useEffect(() => {
    if (resolvedToolModeState !== toolModeState) {
      setToolModeState(resolvedToolModeState);
    }
  }, [resolvedToolModeState, setToolModeState, toolModeState]);

  useEffect(() => {
    if (selection?.subType === 'collision') {
      setHighlightMode('collision');
    } else if (selection?.subType === 'visual') {
      setHighlightMode('link');
    }
  }, [selection?.subType, setHighlightMode]);

  const {
    activeJointRef,
    angleUnit,
    jointAnglesRef,
    jointPanelStore,
    patchJointPanelAngles,
    replaceJointPanelAngles,
    setAngleUnit,
    setPanelActiveJoint,
  } = useJointPanelState();
  const { handleTransformPending, isDragging, isDraggingRef, setIsDragging, transformPendingRef } =
    useViewerInteractionLock({ active, onTransformPendingChange });
  const jointControlRobot = (jointPanelRobot || robot) as RuntimeViewerRobot | null;
  const jointControlJoints = jointControlRobot?.joints;
  const ignoreJointLimits = useUIStore((state) => state.ignoreJointLimits);
  const { clearJointInteractionPreview, publishJointInteractionPreview } =
    useJointInteractionPreviewPublisher({ projectJointInteractionPreview });
  const emitJointChangeToApp = useCallback(
    (jointName: string, angle: number, context?: ViewerJointChangeContext) => {
      if (syncJointChangesToApp) {
        onJointChange?.(jointName, angle, context);
      }
    },
    [onJointChange, syncJointChangesToApp],
  );
  const { requestSceneRefresh, registerSceneRefresh, cancelSceneRefresh } =
    useSceneRefreshScheduler();
  const {
    handleAutoFitGround,
    originAxesSizeMax,
    registerRuntimeAutoFitGroundHandler,
    setOriginSize,
    syncOriginAxesSizeLimit,
  } = useViewerGroundingController({
    active,
    fallbackRobot: jointPanelRobot,
    groundPlaneOffset,
    requestSceneRefresh,
    robot,
    setOriginSizePreference,
  });

  useEffect(() => {
    if (active) {
      requestSceneRefresh();
    }
  }, [active, requestSceneRefresh, showCollision, showCollisionAlwaysOnTop, showVisual]);

  useRuntimeJointLimitOverride({
    joints: jointControlJoints,
    ignoreLimits: ignoreJointLimits,
    requestSceneRefresh,
  });

  const jointMotion = useJointRuntimeMotionState({
    panel: {
      activeJointRef,
      jointAnglesRef,
      patchJointPanelAngles,
      replaceJointPanelAngles,
      setPanelActiveJoint,
    },
    preview: { clearJointInteractionPreview, publishJointInteractionPreview },
    requestSceneRefresh,
    state: {
      closedLoopRobotState,
      jointAngleState,
      jointControlRobot,
      jointMotionState,
      jointStateScopeKey,
    },
  });
  const {
    commitIkJointKinematics,
    effectiveClosedLoopRobotState,
    getInitialJointAnglesForNextLoad,
    getJointAnglesSnapshot,
    initializeJointControlState,
    previewIkJointKinematics,
    resolveRuntimeMotionAngle,
  } = jointMotion;
  const {
    clearIkJointKinematicsPreview,
    handleActiveJointChange,
    handleJointAngleChange,
    handleJointChangeCommit,
    handleResetJoints,
    handleRuntimeJointAngleChange,
    handleRuntimeJointAnglesChange,
    handleRuntimeJointChangeCommit,
  } = useJointInteractionController({
    events: { emitJointChangeToApp, requestSceneRefresh },
    motion: jointMotion,
    panel: {
      activeJointRef,
      jointAnglesRef,
      patchJointPanelAngles,
      setPanelActiveJoint,
    },
    preview: { clearJointInteractionPreview, publishJointInteractionPreview },
    state: { isDraggingRef, jointControlRobot, jointStateScopeKey },
  });

  useEffect(() => {
    return () => {
      clearJointInteractionPreview();
      cancelSceneRefresh();
    };
  }, [cancelSceneRefresh, clearJointInteractionPreview]);

  useRegressionBridge({
    active,
    centerOfMassSize,
    enabled: enableRegressionBridge,
    highlightMode,
    jointAxisSize,
    modelOpacity,
    normalizedToolModeScopeKey,
    originSize,
    requestSceneRefresh,
    robot,
    toolMode,
    jointAnglesRef,
    activeJointRef,
    patchJointPanelAngles,
    resolveRuntimeMotionAngle,
    setCenterOfMassSize,
    setHighlightMode,
    setJointAxisSize,
    setMeasureState,
    setModelOpacity,
    setOriginSize,
    setPaintStatus,
    setShowCenterOfMass,
    setShowCoMOverlay,
    setShowCollision,
    setShowCollisionAlwaysOnTop,
    setShowInertia,
    setShowInertiaOverlay,
    setShowJointAxes,
    setShowJointAxesOverlay,
    setShowOrigins,
    setShowOriginsOverlay,
    setShowVisual,
    setToolModeState,
    showCenterOfMass,
    showCoMOverlay,
    showCollision,
    showCollisionAlwaysOnTop,
    showInertia,
    showInertiaOverlay,
    showJointAxes,
    showJointAxesOverlay,
    showOrigins,
    showOriginsOverlay,
    showVisual,
  });

  const handleRobotLoaded = useCallback(
    (loadedRobot: RuntimeRobotObject) => {
      clearJointInteractionPreview();
      setJointPanelRobot(null);
      setRobot(loadedRobot);
      initializeJointControlState(loadedRobot as RuntimeViewerRobot);
      syncOriginAxesSizeLimit(loadedRobot);
    },
    [clearJointInteractionPreview, initializeJointControlState, syncOriginAxesSizeLimit],
  );

  const handleJointPanelRobotLoaded = useCallback(
    (loadedRobot: RuntimeRobotObject | null) => {
      clearJointInteractionPreview();
      setJointPanelRobot(loadedRobot);
      syncOriginAxesSizeLimit(loadedRobot);
      if (loadedRobot) {
        initializeJointControlState(loadedRobot as RuntimeViewerRobot);
      }
    },
    [clearJointInteractionPreview, initializeJointControlState, syncOriginAxesSizeLimit],
  );

  const handleSelectWrapper = useCallback(
    (
      type: Exclude<InteractionSelection['type'], null>,
      id: string,
      subType?: 'visual' | 'collision',
      helperKind?: ViewerHelperKind,
    ) => {
      if (transformPendingRef.current) {
        return;
      }
      onSelect?.(type, id, subType, helperKind);
      const activeJointKey = resolveActiveViewerJointKeyFromSelection(
        jointControlJoints,
        type && id ? { type, id } : null,
      );
      setPanelActiveJoint(activeJointKey);
    },
    [jointControlJoints, onSelect, setPanelActiveJoint, transformPendingRef],
  );

  const handleHoverWrapper = useCallback<NonNullable<ViewerProps['onHover']>>(
    (...hoverArgs) => {
      onHover?.(...hoverArgs);
    },
    [onHover],
  );

  const handleToolModeChange = useCallback(
    (nextMode: ToolMode) => {
      setToolModeState({
        scopeKey: normalizedToolModeScopeKey,
        explicit: true,
        mode: nextMode,
      });
      if (nextMode !== 'measure') {
        setMeasureState((previous) =>
          previous.hoverTarget ? { ...previous, hoverTarget: null } : previous,
        );
      }
      if (nextMode !== 'paint') {
        setPaintStatus(null);
      }
    },
    [normalizedToolModeScopeKey, setMeasureState, setPaintStatus, setToolModeState],
  );

  const handleCloseMeasureTool = useCallback(() => {
    setMeasureState(createEmptyMeasureState());
    setToolModeState({
      scopeKey: normalizedToolModeScopeKey,
      explicit: true,
      mode: 'select',
    });
    onHover?.(null, null);
  }, [normalizedToolModeScopeKey, onHover, setMeasureState, setToolModeState]);

  const handleClosePaintTool = useCallback(() => {
    setPaintStatus(null);
    setToolModeState({
      scopeKey: normalizedToolModeScopeKey,
      explicit: true,
      mode: 'select',
    });
  }, [normalizedToolModeScopeKey, setPaintStatus, setToolModeState]);

  const handlePointerMissed = useCallback(() => {
    if (justSelectedRef.current || transformPendingRef.current) {
      return;
    }
    onSelect?.('link', '');
    setPanelActiveJoint(null);
  }, [onSelect, setPanelActiveJoint, transformPendingRef]);

  useEffect(() => {
    if (!jointControlRobot) {
      return;
    }
    const activeJointKey = resolveActiveViewerJointKeyFromSelection(jointControlJoints, selection);
    setPanelActiveJoint(activeJointKey);
  }, [jointControlJoints, jointControlRobot, selection, setPanelActiveJoint]);

  const runtime = useMemo<ViewerControllerRuntimeSurface>(
    () => ({
      robot,
      setRobot,
      jointPanelRobot,
      setJointPanelRobot,
      closedLoopRobotState: effectiveClosedLoopRobotState,
      getJointAnglesSnapshot,
      getInitialJointAnglesForNextLoad,
      registerSceneRefresh,
      registerRuntimeAutoFitGroundHandler,
      previewIkJointKinematics,
      commitIkJointKinematics,
      clearIkJointKinematicsPreview,
      handleRobotLoaded,
      handleJointPanelRobotLoaded,
      handleRuntimeJointAnglesChange,
      handleRuntimeJointAngleChange,
      handleRuntimeJointChangeCommit,
    }),
    [
      effectiveClosedLoopRobotState,
      clearIkJointKinematicsPreview,
      commitIkJointKinematics,
      getInitialJointAnglesForNextLoad,
      getJointAnglesSnapshot,
      handleJointPanelRobotLoaded,
      handleRobotLoaded,
      handleRuntimeJointAngleChange,
      handleRuntimeJointAnglesChange,
      handleRuntimeJointChangeCommit,
      jointPanelRobot,
      previewIkJointKinematics,
      registerRuntimeAutoFitGroundHandler,
      registerSceneRefresh,
      robot,
    ],
  );

  const interaction = useMemo<ViewerControllerInteractionSurface>(
    () => ({
      transformMode,
      interactionLayerPriority,
      isDragging,
      setIsDragging,
      isOrbitDragging,
      justSelectedRef,
      transformPendingRef,
      handleActiveJointChange,
      handleSelectWrapper,
      handleHoverWrapper,
      handleTransformPending,
      handlePointerMissed,
    }),
    [
      handleActiveJointChange,
      handleHoverWrapper,
      handlePointerMissed,
      handleSelectWrapper,
      handleTransformPending,
      interactionLayerPriority,
      isDragging,
      setIsDragging,
      transformMode,
      transformPendingRef,
    ],
  );

  const toolbar = useMemo<ViewerControllerToolbarSurface>(
    () => ({
      toolMode,
      handleToolModeChange,
    }),
    [handleToolModeChange, toolMode],
  );

  const layout = useMemo<ViewerControllerLayoutSurface>(
    () => ({
      containerRef,
      optionsPanelRef,
      jointPanelRef,
      measurePanelRef,
      paintPanelRef,
      optionsPanelPos,
      jointPanelPos,
      measurePanelPos,
      paintPanelPos,
      handleMouseDown,
      handleMouseMove,
      handleMouseUp,
    }),
    [
      handleMouseDown,
      handleMouseMove,
      handleMouseUp,
      containerRef,
      jointPanelPos,
      jointPanelRef,
      measurePanelPos,
      measurePanelRef,
      optionsPanelPos,
      optionsPanelRef,
      paintPanelPos,
      paintPanelRef,
    ],
  );

  const optionsPanel = useMemo<ViewerControllerOptionsPanelSurface>(
    () => ({
      showCollision,
      showCollisionAlwaysOnTop,
      setShowCollisionAlwaysOnTop,
      setShowCollision,
      showVisual,
      setShowVisual,
      showIkHandles,
      setShowIkHandles,
      showIkHandlesAlwaysOnTop,
      setShowIkHandlesAlwaysOnTop,
      showCenterOfMass,
      setShowCenterOfMass,
      showCoMOverlay,
      setShowCoMOverlay,
      centerOfMassSize,
      setCenterOfMassSize,
      showInertia,
      setShowInertia,
      showInertiaOverlay,
      setShowInertiaOverlay,
      showOrigins,
      setShowOrigins,
      showOriginsOverlay,
      setShowOriginsOverlay,
      originSize,
      originAxesSizeMax,
      setOriginSize,
      showMjcfSites,
      setShowMjcfSites,
      showJointAxes,
      setShowJointAxes,
      showJointAxesOverlay,
      setShowJointAxesOverlay,
      jointAxisSize,
      setJointAxisSize,
      modelOpacity,
      setModelOpacity,
      highlightMode,
      setHighlightMode,
      isOptionsCollapsed,
      toggleOptionsCollapsed,
      handleAutoFitGround,
      groundPlaneOffset,
      setGroundPlaneOffset: updateGroundPlaneOffset,
      groundPlaneOffsetReadOnly,
    }),
    [
      centerOfMassSize,
      groundPlaneOffset,
      groundPlaneOffsetReadOnly,
      handleAutoFitGround,
      highlightMode,
      isOptionsCollapsed,
      jointAxisSize,
      modelOpacity,
      originAxesSizeMax,
      originSize,
      setCenterOfMassSize,
      setHighlightMode,
      setJointAxisSize,
      setModelOpacity,
      setOriginSize,
      setShowCenterOfMass,
      setShowCoMOverlay,
      setShowCollision,
      setShowCollisionAlwaysOnTop,
      setShowIkHandles,
      setShowIkHandlesAlwaysOnTop,
      setShowInertia,
      setShowInertiaOverlay,
      setShowJointAxes,
      setShowJointAxesOverlay,
      setShowMjcfSites,
      setShowOrigins,
      setShowOriginsOverlay,
      setShowVisual,
      showCenterOfMass,
      showCoMOverlay,
      showCollision,
      showCollisionAlwaysOnTop,
      showIkHandles,
      showIkHandlesAlwaysOnTop,
      showInertia,
      showInertiaOverlay,
      showJointAxes,
      showJointAxesOverlay,
      showMjcfSites,
      showOrigins,
      showOriginsOverlay,
      showVisual,
      toggleOptionsCollapsed,
      updateGroundPlaneOffset,
    ],
  );

  const jointsPanel = useMemo<ViewerControllerJointsPanelSurface>(
    () => ({
      robot,
      jointPanelRobot,
      jointPanelStore,
      angleUnit,
      setAngleUnit,
      isJointsCollapsed,
      toggleJointsCollapsed,
      setActiveJoint: setPanelActiveJoint,
      handleJointAngleChange,
      handleJointChangeCommit,
      handleResetJoints,
      handleSelectWrapper,
      handleHoverWrapper,
      setIsDragging,
    }),
    [
      angleUnit,
      handleHoverWrapper,
      handleJointAngleChange,
      handleJointChangeCommit,
      handleResetJoints,
      handleSelectWrapper,
      isJointsCollapsed,
      jointPanelRobot,
      jointPanelStore,
      robot,
      setAngleUnit,
      setIsDragging,
      setPanelActiveJoint,
      toggleJointsCollapsed,
    ],
  );

  const measureTool = useMemo<ViewerControllerMeasureToolSurface>(
    () => ({
      toolMode,
      measureState,
      setMeasureState,
      setMeasureMode,
      measureAnchorMode,
      setMeasureAnchorMode,
      showMeasureDecomposition,
      setShowMeasureDecomposition,
      measurePoseRepresentation,
      setMeasurePoseRepresentation,
      handleCloseMeasureTool,
    }),
    [
      handleCloseMeasureTool,
      measureAnchorMode,
      measurePoseRepresentation,
      measureState,
      setMeasureAnchorMode,
      setMeasureMode,
      setMeasurePoseRepresentation,
      setMeasureState,
      setShowMeasureDecomposition,
      showMeasureDecomposition,
      toolMode,
    ],
  );

  const paintTool = useMemo<ViewerControllerPaintToolSurface>(
    () => ({
      toolMode,
      paintColor,
      setPaintColor,
      paintSelectionScope,
      setPaintSelectionScope,
      paintOperation,
      setPaintOperation,
      paintInteractionRef,
      paintStatus,
      setPaintStatus,
      handleClosePaintTool,
    }),
    [
      handleClosePaintTool,
      paintColor,
      paintInteractionRef,
      paintOperation,
      paintSelectionScope,
      paintStatus,
      setPaintColor,
      setPaintOperation,
      setPaintSelectionScope,
      setPaintStatus,
      toolMode,
    ],
  );

  return useMemo(
    () => ({
      runtime,
      interaction,
      toolbar,
      layout,
      optionsPanel,
      jointsPanel,
      measureTool,
      paintTool,
    }),
    [interaction, jointsPanel, layout, measureTool, optionsPanel, paintTool, runtime, toolbar],
  );
};

export type ViewerController = ReturnType<typeof useViewerController>;
export type ViewerSceneController = Pick<
  ViewerController,
  | 'runtime'
  | 'interaction'
  | 'toolbar'
  | 'optionsPanel'
  | 'jointsPanel'
  | 'measureTool'
  | 'paintTool'
>;
