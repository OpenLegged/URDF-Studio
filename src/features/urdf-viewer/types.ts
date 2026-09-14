import type { RobotModelKernelProps, ViewerJointMotionStateValue, ViewerJointChangeContext } from '@/shared/components/3d/robot/types';
export type { ViewerPaintStatusTone, ViewerPaintSelectionScope, ViewerPaintOperation, ViewerPaintInteractionState, ViewerPaintStatus, ViewerPaintFaceHit, ViewerJointMotionStateValue, ViewerJointChangeContext, GeometryTransformControlsProps, JointInteractionProps } from '@/shared/components/3d/robot/types';
import React from 'react';
import * as THREE from 'three';
import type { Language } from '@/shared/i18n';
import type { SnapshotCaptureAction } from '@/shared/components/3d';
import type {
  AssemblyState,
  AssemblyTransform,
  InteractionSelection,
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
  ViewerSceneMode,
} from '@/shared/components/3d/viewerInteractionTypes';

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

export interface RobotModelProps extends RobotModelKernelProps {
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
