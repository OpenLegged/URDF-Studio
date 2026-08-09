import type React from 'react';

import type { JointPanelActiveJointOptions, JointPanelStore } from '@/shared/utils/jointPanelStore';
import type { RuntimeRobotObject } from '@/shared/components/3d/runtimeRobotTypes';
import type { InteractionSelection, RobotState } from '@/types';
import type {
  MeasureAnchorMode,
  MeasureMode,
  MeasurePoseRepresentation,
  MeasureState,
  ToolMode,
  ViewerHelperKind,
  ViewerInteractiveLayer,
  ViewerJointMotionStateValue,
  ViewerPaintInteractionState,
  ViewerPaintOperation,
  ViewerPaintSelectionScope,
  ViewerPaintStatus,
} from '../../types';

export interface ViewerControllerRuntimeSurface {
  robot: RuntimeRobotObject | null;
  setRobot: React.Dispatch<React.SetStateAction<RuntimeRobotObject | null>>;
  jointPanelRobot: RuntimeRobotObject | null;
  setJointPanelRobot: React.Dispatch<React.SetStateAction<RuntimeRobotObject | null>>;
  closedLoopRobotState: Pick<
    RobotState,
    'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'
  > | null;
  getJointAnglesSnapshot: () => Record<string, number>;
  getInitialJointAnglesForNextLoad: () => Record<string, number>;
  registerSceneRefresh: (refreshScene: ((options?: { force?: boolean }) => void) | null) => void;
  registerRuntimeAutoFitGroundHandler: (handler: (() => void) | null) => void;
  previewIkJointKinematics: (
    jointAngles: Record<string, number>,
    jointQuaternions: Record<string, ViewerJointMotionStateValue['quaternion']>,
  ) => void;
  commitIkJointKinematics: (
    jointAngles: Record<string, number>,
    jointQuaternions: Record<string, ViewerJointMotionStateValue['quaternion']>,
  ) => void;
  clearIkJointKinematicsPreview: () => void;
  handleRobotLoaded: (loadedRobot: RuntimeRobotObject) => void;
  handleJointPanelRobotLoaded: (loadedRobot: RuntimeRobotObject | null) => void;
  handleRuntimeJointAnglesChange: (nextAngles: Record<string, number>) => void;
  handleRuntimeJointAngleChange: (jointName: string, angle: number) => void;
  handleRuntimeJointChangeCommit: (jointName: string, angle: number) => void | Promise<void>;
}

export interface ViewerControllerInteractionSurface {
  transformMode: 'select' | 'translate' | 'rotate' | 'universal';
  interactionLayerPriority: ViewerInteractiveLayer[];
  isDragging: boolean;
  setIsDragging: React.Dispatch<React.SetStateAction<boolean>>;
  isOrbitDragging: React.MutableRefObject<boolean>;
  justSelectedRef: React.MutableRefObject<boolean>;
  transformPendingRef: React.MutableRefObject<boolean>;
  handleActiveJointChange: (jointName: string | null) => void;
  handleSelectWrapper: (
    type: Exclude<InteractionSelection['type'], null>,
    id: string,
    subType?: 'visual' | 'collision',
    helperKind?: ViewerHelperKind,
  ) => void;
  handleHoverWrapper: (
    type: InteractionSelection['type'],
    id: string | null,
    subType?: 'visual' | 'collision',
    objectIndex?: number,
    helperKind?: ViewerHelperKind,
    highlightObjectId?: number,
  ) => void;
  handleTransformPending: (pending: boolean) => void;
  handlePointerMissed: () => void;
}

export interface ViewerControllerToolbarSurface {
  toolMode: ToolMode;
  handleToolModeChange: (nextMode: ToolMode) => void;
}

export interface ViewerControllerLayoutSurface {
  containerRef: React.RefObject<HTMLDivElement | null>;
  optionsPanelRef: React.RefObject<HTMLDivElement | null>;
  jointPanelRef: React.RefObject<HTMLDivElement | null>;
  measurePanelRef: React.RefObject<HTMLDivElement | null>;
  paintPanelRef: React.RefObject<HTMLDivElement | null>;
  optionsPanelPos: { x: number; y: number } | null;
  jointPanelPos: { x: number; y: number } | null;
  measurePanelPos: { x: number; y: number } | null;
  paintPanelPos: { x: number; y: number } | null;
  handleMouseDown: (
    panel: 'options' | 'joints' | 'measure' | 'paint',
    event: React.MouseEvent,
  ) => void;
  handleMouseMove: (event: React.MouseEvent) => void;
  handleMouseUp: () => void;
}

export interface ViewerControllerOptionsPanelSurface {
  showCollision: boolean;
  showCollisionAlwaysOnTop: boolean;
  setShowCollisionAlwaysOnTop: React.Dispatch<React.SetStateAction<boolean>>;
  setShowCollision: React.Dispatch<React.SetStateAction<boolean>>;
  showVisual: boolean;
  setShowVisual: React.Dispatch<React.SetStateAction<boolean>>;
  showIkHandles: boolean;
  setShowIkHandles: React.Dispatch<React.SetStateAction<boolean>>;
  showIkHandlesAlwaysOnTop: boolean;
  setShowIkHandlesAlwaysOnTop: React.Dispatch<React.SetStateAction<boolean>>;
  showCenterOfMass: boolean;
  setShowCenterOfMass: React.Dispatch<React.SetStateAction<boolean>>;
  showCoMOverlay: boolean;
  setShowCoMOverlay: React.Dispatch<React.SetStateAction<boolean>>;
  centerOfMassSize: number;
  setCenterOfMassSize: React.Dispatch<React.SetStateAction<number>>;
  showInertia: boolean;
  setShowInertia: React.Dispatch<React.SetStateAction<boolean>>;
  showInertiaOverlay: boolean;
  setShowInertiaOverlay: React.Dispatch<React.SetStateAction<boolean>>;
  showOrigins: boolean;
  setShowOrigins: React.Dispatch<React.SetStateAction<boolean>>;
  showOriginsOverlay: boolean;
  setShowOriginsOverlay: React.Dispatch<React.SetStateAction<boolean>>;
  originSize: number;
  originAxesSizeMax: number;
  setOriginSize: React.Dispatch<React.SetStateAction<number>>;
  showMjcfSites: boolean;
  setShowMjcfSites: React.Dispatch<React.SetStateAction<boolean>>;
  showJointAxes: boolean;
  setShowJointAxes: React.Dispatch<React.SetStateAction<boolean>>;
  showJointAxesOverlay: boolean;
  setShowJointAxesOverlay: React.Dispatch<React.SetStateAction<boolean>>;
  jointAxisSize: number;
  setJointAxisSize: React.Dispatch<React.SetStateAction<number>>;
  modelOpacity: number;
  setModelOpacity: React.Dispatch<React.SetStateAction<number>>;
  highlightMode: 'link' | 'collision';
  setHighlightMode: React.Dispatch<React.SetStateAction<'link' | 'collision'>>;
  isOptionsCollapsed: boolean;
  toggleOptionsCollapsed: () => void;
  handleAutoFitGround: () => void;
  groundPlaneOffset: number;
  setGroundPlaneOffset: (offset: number) => void;
  groundPlaneOffsetReadOnly: boolean;
}

export interface ViewerControllerJointsPanelSurface {
  robot: RuntimeRobotObject | null;
  jointPanelRobot: RuntimeRobotObject | null;
  jointPanelStore: JointPanelStore;
  angleUnit: 'rad' | 'deg';
  setAngleUnit: React.Dispatch<React.SetStateAction<'rad' | 'deg'>>;
  isJointsCollapsed: boolean;
  toggleJointsCollapsed: () => void;
  setActiveJoint: (jointName: string | null, options?: JointPanelActiveJointOptions) => void;
  handleJointAngleChange: (jointName: string, angle: number) => void;
  handleJointChangeCommit: (jointName: string, angle: number) => void | Promise<void>;
  handleResetJoints: () => void;
  handleSelectWrapper: ViewerControllerInteractionSurface['handleSelectWrapper'];
  handleHoverWrapper: ViewerControllerInteractionSurface['handleHoverWrapper'];
  setIsDragging: React.Dispatch<React.SetStateAction<boolean>>;
}

export interface ViewerControllerMeasureToolSurface {
  toolMode: ToolMode;
  measureState: MeasureState;
  setMeasureState: React.Dispatch<React.SetStateAction<MeasureState>>;
  setMeasureMode: (mode: MeasureMode) => void;
  measureAnchorMode: MeasureAnchorMode;
  setMeasureAnchorMode: React.Dispatch<React.SetStateAction<MeasureAnchorMode>>;
  showMeasureDecomposition: boolean;
  setShowMeasureDecomposition: React.Dispatch<React.SetStateAction<boolean>>;
  measurePoseRepresentation: MeasurePoseRepresentation;
  setMeasurePoseRepresentation: React.Dispatch<React.SetStateAction<MeasurePoseRepresentation>>;
  handleCloseMeasureTool: () => void;
}

export interface ViewerControllerPaintToolSurface {
  toolMode: ToolMode;
  paintColor: string;
  setPaintColor: React.Dispatch<React.SetStateAction<string>>;
  paintSelectionScope: ViewerPaintSelectionScope;
  setPaintSelectionScope: React.Dispatch<React.SetStateAction<ViewerPaintSelectionScope>>;
  paintOperation: ViewerPaintOperation;
  setPaintOperation: React.Dispatch<React.SetStateAction<ViewerPaintOperation>>;
  paintInteractionRef: React.MutableRefObject<ViewerPaintInteractionState>;
  paintStatus: ViewerPaintStatus | null;
  setPaintStatus: React.Dispatch<React.SetStateAction<ViewerPaintStatus | null>>;
  handleClosePaintTool: () => void;
}
