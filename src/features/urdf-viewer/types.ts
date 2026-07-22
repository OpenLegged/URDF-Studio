import React from 'react';
import * as THREE from 'three';
import type { Language, translations } from '@/shared/i18n';
import type { SnapshotCaptureAction } from '@/shared/components/3d';
import type { JointPanelActiveJointOptions } from '@/shared/utils/jointPanelStore';
import type {
  AssemblyState,
  AssemblyTransform,
  InteractionSelection,
  JointQuaternion,
  RobotData,
  RobotFile,
  RobotState,
  Theme,
  UrdfJoint,
  UrdfLink,
  UrdfOrigin,
  WorkspaceSelection,
} from '@/types';
import type { AssemblyScenePlacement, AssemblySceneProjection } from '@/core/robot';
import type {
  MeasureAnchorMode,
  MeasureGroup,
  MeasureMeasurement,
  MeasureMode,
  MeasureObjectType,
  MeasurePoseRepresentation,
  MeasureSlot,
  MeasureState,
  MeasureTarget,
} from './utils/measurements';
import type { MeasureSelectionLike } from './utils/measureTargetResolvers';
import type { ViewerDocumentLoadEvent } from '@/shared/components/3d/loadingTypes';
import type { ViewerRobotSourceFormat } from '@/features/urdf-viewer/renderers/sourceFormat';
import type {
  ToolMode,
  ViewerHelperKind,
  ViewerInteractiveLayer,
  ViewerRuntimeStageBridge,
  ViewerSceneMode,
} from '@/shared/components/3d/viewerInteractionTypes';
import type { RuntimeRobotObject } from '@/shared/components/3d/runtimeRobotTypes';

export type {
  RobotLoadingPhase,
  UsdLoadingPhase,
  UsdLoadingProgress,
  ViewerDocumentLoadEvent,
  ViewerLoadingPhase,
  UsdLoadingPhaseLabels,
} from '@/shared/components/3d/loadingTypes';
export type {
  ToolMode,
  ViewerHelperKind,
  ViewerInteractiveLayer,
  ViewerRuntimeStageBridge,
  ViewerSceneMode,
} from '@/shared/components/3d/viewerInteractionTypes';
export type { ViewerRobotSourceFormat } from '@/features/urdf-viewer/renderers/sourceFormat';
export type {
  MeasureAnchorMode,
  MeasureGroup,
  MeasureMeasurement,
  MeasureMode,
  MeasureObjectType,
  MeasurePoseRepresentation,
  MeasureSlot,
  MeasureState,
  MeasureTarget,
};
export type MeasureTargetResolver = (
  selection?: MeasureSelectionLike,
  fallbackSelection?: MeasureSelectionLike,
  anchorMode?: MeasureAnchorMode,
) => MeasureTarget | null;

export type ViewerPaintStatusTone = 'info' | 'success' | 'error';
export type ViewerPaintSelectionScope = 'face' | 'island';
export type ViewerPaintOperation = 'paint' | 'erase';

export interface ViewerPaintInteractionState {
  color: string;
  operation: ViewerPaintOperation;
  selectionScope: ViewerPaintSelectionScope;
}

export interface ViewerPaintStatus {
  tone: ViewerPaintStatusTone;
  message: string;
}

export interface ViewerPaintFaceHit {
  linkId: string;
  objectIndex: number;
  mesh: THREE.Mesh;
  faceIndex: number;
}

export interface ViewerJointMotionStateValue {
  angle?: number;
  quaternion?: JointQuaternion;
}

export interface ViewerJointChangeContext {
  jointAngles?: Record<string, number>;
  jointQuaternions?: Record<string, JointQuaternion>;
}

export interface ViewerProps {
  urdfContent: string;
  assets: Record<string, string>;
  sourceFile?: RobotFile | null;
  sourceFormat?: ViewerRobotSourceFormat;
  availableFiles?: RobotFile[];
  sourceFilePath?: string;
  onDocumentLoadEvent?: (event: ViewerDocumentLoadEvent) => void;
  onJointChange?: (jointName: string, angle: number, context?: ViewerJointChangeContext) => void;
  /** Runtime-global joint IDs; workspace adapters resolve these through projection maps. */
  onJointMotionCommit?: (context: ViewerJointChangeContext) => void;
  syncJointChangesToApp?: boolean;
  jointAngleState?: Record<string, number>;
  jointMotionState?: Record<string, ViewerJointMotionStateValue>;
  lang: Language;
  mode?: ViewerSceneMode;
  onSelect?: (
    type: Exclude<InteractionSelection['type'], null>,
    id: string,
    subType?: 'visual' | 'collision',
    helperKind?: ViewerHelperKind,
  ) => void;
  onMeshSelect?: (
    linkId: string,
    jointId: string | null,
    objectIndex: number,
    objectType: 'visual' | 'collision',
  ) => void;
  onHover?: (
    type: InteractionSelection['type'],
    id: string | null,
    subType?: 'visual' | 'collision',
    objectIndex?: number,
    helperKind?: ViewerHelperKind,
    highlightObjectId?: number,
  ) => void;
  onUpdate?: (type: 'link' | 'joint', id: string, data: unknown) => void;
  theme: Theme;
  selection?: InteractionSelection;
  hoveredSelection?: InteractionSelection;
  robotLinks?: Record<string, UrdfLink>;
  robotJoints?: Record<string, UrdfJoint>;
  robotData?: RobotData | null;
  ikRobotState?: Pick<
    RobotState,
    'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'
  > | null;
  focusTarget?: string | null;
  showVisual?: boolean;
  setShowVisual?: (show: boolean) => void;
  showOptionsPanel?: boolean;
  setShowOptionsPanel?: (show: boolean) => void;
  showJointPanel?: boolean;
  setShowJointPanel?: (show: boolean) => void;
  onCollisionTransformPreview?: (
    linkName: string,
    position: { x: number; y: number; z: number },
    rotation: { r: number; p: number; y: number },
    objectIndex?: number,
  ) => void;
  onCollisionTransform?: (
    linkName: string,
    position: { x: number; y: number; z: number },
    rotation: { r: number; p: number; y: number },
    objectIndex?: number,
  ) => void;
  snapshotAction?: React.RefObject<SnapshotCaptureAction | null>;
  /** True when previewing a standalone mesh asset from the library (STL/DAE/OBJ/GLB). */
  isMeshPreview?: boolean;
  ikDragActive?: boolean;
  /** Notify parent when collision transform has a pending confirm/cancel state */
  onTransformPendingChange?: (pending: boolean) => void;
  /** Visual ground alignment offset applied after load. */
  groundPlaneOffset?: number;
  workspace?: AssemblyState | null;
  sceneProjection?: AssemblySceneProjection | null;
  scenePlacement?: AssemblyScenePlacement | null;
  workspaceSelection?: WorkspaceSelection;
  onAssemblyTransform?: (transform: AssemblyTransform) => void;
  onComponentTransform?: (
    componentId: string,
    transform: AssemblyTransform,
    options?: import('@/types/viewer').UpdateCommitOptions,
  ) => void;
  onBridgeTransform?: (
    bridgeId: string,
    origin: UrdfOrigin,
    options?: import('@/types/viewer').UpdateCommitOptions,
  ) => void;
  pendingAutoGroundComponentIds?: readonly string[];
  onAssemblyComponentAutoGroundResolved?: (
    resolution: AssemblyComponentAutoGroundResolution,
  ) => void;
}

export interface RobotModelProps {
  urdfContent: string;
  assets: Record<string, string>;
  sourceFile?: RobotFile | null;
  availableFiles?: RobotFile[];
  sourceFormat?: ViewerRobotSourceFormat;
  allowUrdfXmlFallback?: boolean;
  reloadToken?: number;
  initialRobot?: THREE.Object3D | null;
  sourceFilePath?: string;
  onRobotLoaded?: (robot: RuntimeRobotObject) => void;
  onDocumentLoadEvent?: (event: ViewerDocumentLoadEvent) => void;
  runtimeBridge?: ViewerRuntimeStageBridge;
  showCollision?: boolean;
  showVisual?: boolean;
  showIkHandles?: boolean;
  showIkHandlesAlwaysOnTop?: boolean;
  showCollisionAlwaysOnTop?: boolean;
  onSelect?: (
    type: Exclude<InteractionSelection['type'], null>,
    id: string,
    subType?: 'visual' | 'collision',
    helperKind?: ViewerHelperKind,
  ) => void;
  onHover?: (
    type: InteractionSelection['type'],
    id: string | null,
    subType?: 'visual' | 'collision',
    objectIndex?: number,
    helperKind?: ViewerHelperKind,
    highlightObjectId?: number,
  ) => void;
  onMeshSelect?: (
    linkId: string,
    jointId: string | null,
    objectIndex: number,
    objectType: 'visual' | 'collision',
  ) => void;
  onUpdate?: (type: 'link' | 'joint', id: string, data: unknown) => void;
  paintColor?: string;
  paintSelectionScope?: ViewerPaintSelectionScope;
  paintOperation?: ViewerPaintOperation;
  paintInteractionRef?: React.RefObject<ViewerPaintInteractionState>;
  onPaintStatusChange?: (status: ViewerPaintStatus | null) => void;
  onJointChange?: (name: string, angle: number, context?: ViewerJointChangeContext) => void;
  onJointChangeCommit?: (name: string, angle: number) => void;
  onJointMotionCommit?: (context: ViewerJointChangeContext) => void;
  initialJointAngles?: Record<string, number>;
  registerSceneRefresh?: (refreshScene: ((options?: { force?: boolean }) => void) | null) => void;
  setIsDragging?: (dragging: boolean) => void;
  onIkPreviewKinematicOverrides?: (
    jointAngles: Record<string, number>,
    jointQuaternions: Record<string, ViewerJointMotionStateValue['quaternion']>,
  ) => void;
  onIkCommitKinematicOverrides?: (
    jointAngles: Record<string, number>,
    jointQuaternions: Record<string, ViewerJointMotionStateValue['quaternion']>,
  ) => void;
  onClearIkPreviewKinematicOverrides?: () => void;
  setActiveJoint?: (jointName: string | null, options?: JointPanelActiveJointOptions) => void;
  justSelectedRef?: React.RefObject<boolean>;
  t: (typeof translations)['en'];
  mode?: ViewerSceneMode;
  showInertia?: boolean;
  showInertiaOverlay?: boolean;
  showCenterOfMass?: boolean;
  showCoMOverlay?: boolean;
  centerOfMassSize?: number;
  showOrigins?: boolean;
  showOriginsOverlay?: boolean;
  originSize?: number;
  showMjcfSites?: boolean;
  showJointAxes?: boolean;
  showJointAxesOverlay?: boolean;
  jointAxisSize?: number;
  modelOpacity?: number;
  ikRobotState?: Pick<
    RobotState,
    'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'
  > | null;
  robotLinks?: Record<string, UrdfLink>;
  robotJoints?: Record<string, UrdfJoint>;
  robotData?: RobotData | null;
  focusTarget?: string | null;
  transformMode?: 'select' | 'translate' | 'rotate' | 'universal';
  toolMode?: ToolMode;
  measureMode?: MeasureMode;
  ikDragActive?: boolean;
  onCollisionTransformPreview?: (
    linkName: string,
    position: { x: number; y: number; z: number },
    rotation: { r: number; p: number; y: number },
    objectIndex?: number,
  ) => void;
  onCollisionTransformEnd?: (
    linkName: string,
    position: { x: number; y: number; z: number },
    rotation: { r: number; p: number; y: number },
    objectIndex?: number,
  ) => void;
  isOrbitDragging?: React.RefObject<boolean>;
  onTransformPending?: (pending: boolean) => void;
  isSelectionLockedRef?: React.RefObject<boolean>;
  selection?: ViewerProps['selection'];
  interactionEnabled?: boolean;
  hoverSelectionEnabled?: boolean;
  hoveredSelection?: ViewerProps['hoveredSelection'];
  interactionLayerPriority?: ViewerInteractiveLayer[];
  isMeshPreview?: boolean;
  groundPlaneOffset?: number;
  active?: boolean;
  workspace?: AssemblyState | null;
  sceneProjection?: AssemblySceneProjection | null;
  scenePlacement?: AssemblyScenePlacement | null;
  workspaceSelection?: WorkspaceSelection;
  onAssemblyTransform?: (transform: AssemblyTransform) => void;
  onComponentTransform?: (
    componentId: string,
    transform: AssemblyTransform,
    options?: import('@/types/viewer').UpdateCommitOptions,
  ) => void;
  onBridgeTransform?: (
    bridgeId: string,
    origin: UrdfOrigin,
    options?: import('@/types/viewer').UpdateCommitOptions,
  ) => void;
  pendingAutoGroundComponentIds?: readonly string[];
  onAssemblyComponentAutoGroundResolved?: (
    resolution: AssemblyComponentAutoGroundResolution,
  ) => void;
}

export interface AssemblyComponentGroundAdjustment {
  componentId: string;
  transform: AssemblyTransform;
}

export interface AssemblyComponentAutoGroundResolution {
  adjustments: AssemblyComponentGroundAdjustment[];
  measuredComponentIds: string[];
  runtimeRobotLocalPositionDelta: { x: number; y: number; z: number } | null;
}

export interface CollisionTransformControlsProps {
  robot: THREE.Object3D | null;
  robotVersion?: number;
  selection: ViewerProps['selection'];
  transformMode: 'select' | 'translate' | 'rotate' | 'universal';
  setIsDragging: (dragging: boolean) => void;
  onTransformChange?: (
    linkId: string,
    position: { x: number; y: number; z: number },
    rotation: { r: number; p: number; y: number },
    objectIndex?: number,
  ) => void;
  onTransformEnd?: (
    linkId: string,
    position: { x: number; y: number; z: number },
    rotation: { r: number; p: number; y: number },
    objectIndex?: number,
  ) => void;
  robotLinks?: Record<string, UrdfLink>;
  onTransformPending?: (pending: boolean) => void;
}

// Re-exported from shared layer
export type { JointControlItemProps } from '@/shared/components/Panel/JointControlItem';

export interface ViewerToolbarProps {
  activeMode: ToolMode;
  setMode: (mode: ToolMode) => void;
  lang?: Language;
}

export interface MeasureToolProps {
  active: boolean;
  robot: THREE.Object3D | null;
  robotLinks?: Record<string, UrdfLink>;
  measureState: MeasureState;
  setMeasureState: React.Dispatch<React.SetStateAction<MeasureState>>;
  measureAnchorMode: MeasureAnchorMode;
  showDecomposition: boolean;
  deleteTooltip?: string;
  measureTargetResolverRef?: React.RefObject<MeasureTargetResolver | null>;
  selection?: InteractionSelection;
  hoveredSelection?: InteractionSelection;
}

export interface JointInteractionProps {
  joint: any;
  value: number;
  transformMode?: 'select' | 'translate' | 'rotate' | 'universal';
  onChange: (val: number) => void;
  onCommit?: (val: number) => void;
  setIsDragging?: (dragging: boolean) => void;
  onInteractionLockChange?: (locked: boolean) => void;
}
