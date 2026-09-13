import type React from 'react';
import type * as THREE from 'three';
import type { translations } from '@/shared/i18n';
import type { JointPanelActiveJointOptions } from '@/shared/utils/jointPanelStore';
import type { ViewerRenderQuality } from '@/shared/utils/viewerRenderQuality';
import type { AssemblyTransform, InteractionSelection, JointQuaternion, RobotData, RobotFile, RobotState, UrdfJoint, UrdfLink } from '@/types';
import type { ViewerDocumentLoadEvent } from '@/shared/components/3d/loadingTypes';
import type { ToolMode, ViewerHelperKind, ViewerInteractiveLayer, ViewerRuntimeStageBridge, ViewerSceneMode } from '@/shared/components/3d/viewerInteractionTypes';
import type { RuntimeRobotObject } from '@/shared/components/3d/runtimeRobotTypes';
import type { ViewerRobotSourceFormat } from './renderers/sourceFormat';

export type { ViewerDocumentLoadEvent } from '@/shared/components/3d/loadingTypes';
export type { ToolMode, ViewerHelperKind, ViewerInteractiveLayer, ViewerRuntimeStageBridge, ViewerSceneMode } from '@/shared/components/3d/viewerInteractionTypes';
export type { ViewerRobotSourceFormat } from './renderers/sourceFormat';
export type MeasureMode = 'object' | 'point';

/** Runtime facts for optional scene attachments; the kernel owns the graph and refresh lifecycle. */
export interface RobotModelSceneState {
  robot: RuntimeRobotObject | null;
  assemblyRoot: THREE.Group | null;
  directComponentRoot: THREE.Group | null;
  requestSceneRefresh: (options?: { force?: boolean }) => void;
}

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

export interface RobotModelKernelProps {
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
  selection?: InteractionSelection;
  interactionEnabled?: boolean;
  hoverSelectionEnabled?: boolean;
  hoveredSelection?: InteractionSelection;
  interactionLayerPriority?: ViewerInteractiveLayer[];
  isMeshPreview?: boolean;
  groundPlaneOffset?: number;
  active?: boolean;
  suppressInitialAutoFrame?: boolean;
  cameraProjection?: 'perspective' | 'orthographic';
  renderQuality?: ViewerRenderQuality;
  showMjcfWorldLink?: boolean;
  hoverFrozen?: boolean;
  onHoverFrozenChange?: (frozen: boolean) => void;
  transformLocked?: boolean;
  jointControlsEnabled?: boolean;
  rootTransformActive?: boolean;
  hasRootTransformControls?: boolean;
  rootTransform?: AssemblyTransform | null;
  contentTransform?: AssemblyTransform | null;
  renderSceneAttachment?: (scene: RobotModelSceneState) => React.ReactNode;
}

export interface GeometryTransformControlsProps {
  robot: THREE.Object3D | null;
  robotVersion?: number;
  selection: InteractionSelection | undefined;
  geometrySubType: 'visual' | 'collision';
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

/** Structural joint contract shared by parsed URDF joints and host-owned runtime objects. */
export interface JointInteractionObject extends THREE.Object3D {
  axis?: THREE.Vector3 | { x: number; y: number; z: number };
  jointType?: string;
  angle?: number;
  jointValue?: number | number[] | null;
  referencePosition?: number;
  origPosition?: THREE.Vector3 | null;
  origQuaternion?: THREE.Quaternion | null;
  limit?: { lower?: number; upper?: number };
}

export interface JointInteractionProps {
  joint: JointInteractionObject;
  value: number;
  transformMode?: 'select' | 'translate' | 'rotate' | 'universal';
  onChange: (val: number) => void;
  onCommit?: (val: number) => void;
  setIsDragging?: (dragging: boolean) => void;
  onInteractionLockChange?: (locked: boolean) => void;
}
