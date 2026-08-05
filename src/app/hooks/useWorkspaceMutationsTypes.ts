import type { ViewerJointChangeContext } from '@/features/editor';
import type { PendingCollisionTransform } from '@/store/collisionTransformStore';
import type {
  WorkspacePropertyPatch,
} from '@/store/workspaceStore';
import type {
  AssemblyEntityRef,
  AssemblyTransform,
  BridgeEntityRef,
  ComponentEntityRef,
  EntityRef,
  JointEntityRef,
  LinkEntityRef,
  UrdfJoint,
  UrdfLink,
  UrdfOrigin,
  WorkspaceSelection,
} from '@/types';
import type { UpdateCommitOptions } from '@/types/viewer';
import type { MJCFRenameOperation } from '../utils/mjcfEditableSourcePatch';

export interface ComponentSourcePatchTarget {
  componentId: string;
  expectedRobotSnapshotHash: string;
}

export interface UseWorkspaceMutationsParams {
  focusOn: (ref: EntityRef) => void;
  setSelection: (selection: WorkspaceSelection) => void;
  setPendingCollisionTransform: (transform: PendingCollisionTransform) => void;
  clearPendingCollisionTransform: () => void;
  handleTransformPendingChange: (pending: boolean) => void;
  patchEditableSourceAddChild?: (
    args: ComponentSourcePatchTarget & {
      parentLinkName: string;
      linkName: string;
      joint: UrdfJoint;
    },
  ) => void;
  patchEditableSourceDeleteSubtree?: (
    args: ComponentSourcePatchTarget & { linkName: string },
  ) => void;
  patchEditableSourceAddCollisionBody?: (
    args: ComponentSourcePatchTarget & {
      linkName: string;
      geometry: UrdfLink['collision'];
    },
  ) => void;
  patchEditableSourceDeleteCollisionBody?: (
    args: ComponentSourcePatchTarget & {
      linkName: string;
      objectIndex: number;
    },
  ) => void;
  patchEditableSourceUpdateCollisionBody?: (
    args: ComponentSourcePatchTarget & {
      linkName: string;
      objectIndex: number;
      geometry: UrdfLink['collision'];
    },
  ) => void;
  patchEditableSourceUpdateJointLimit?: (
    args: ComponentSourcePatchTarget & {
      jointName: string;
      jointType: UrdfJoint['type'];
      limit: NonNullable<UrdfJoint['limit']>;
    },
  ) => void;
  patchEditableSourceUpdateLinkInertial?: (
    args: ComponentSourcePatchTarget & {
      linkName: string;
      inertial: NonNullable<UrdfLink['inertial']>;
    },
  ) => void;
  patchEditableSourceRobotName?: (
    args: ComponentSourcePatchTarget & { name: string },
  ) => void;
  patchEditableSourceRenameEntities?: (
    args: ComponentSourcePatchTarget & { operations: MJCFRenameOperation[] },
  ) => void;
}

export type WorkspacePropertyRef = EntityRef;

export interface WorkspaceMutationHandlers {
  handleWorkspaceNameChange: (name: string) => void;
  handleComponentNameChange: (ref: ComponentEntityRef, name: string) => void;
  handleRobotNameChange: (ref: ComponentEntityRef, name: string) => void;
  handleUpdate: (
    ref: WorkspacePropertyRef,
    data: WorkspacePropertyPatch,
    options?: UpdateCommitOptions,
  ) => void;
  handleCollisionTransformPreview: (
    ref: LinkEntityRef,
    position: { x: number; y: number; z: number },
    rotation: { r: number; p: number; y: number },
    objectIndex?: number,
  ) => void;
  handleCollisionTransform: (
    ref: LinkEntityRef,
    position: { x: number; y: number; z: number },
    rotation: { r: number; p: number; y: number },
    objectIndex?: number,
  ) => void;
  handleCollisionTransformPendingChange: (pending: boolean) => void;
  handleAssemblyTransform: (
    ref: AssemblyEntityRef,
    transform: AssemblyTransform,
    options?: UpdateCommitOptions,
  ) => void;
  handleComponentTransform: (
    ref: ComponentEntityRef,
    transform: AssemblyTransform,
    options?: UpdateCommitOptions,
  ) => void;
  handleBridgeTransform: (
    ref: BridgeEntityRef,
    origin: UrdfOrigin,
    options?: UpdateCommitOptions,
  ) => void;
  handleAddChild: (ref: LinkEntityRef) => void;
  handleAddCollisionBody: (ref: LinkEntityRef) => void;
  handleDelete: (ref: EntityRef) => void;
  handleSetComponentVisibility: (
    ref: ComponentEntityRef,
    visible: boolean,
  ) => void;
  handleSetShowVisual: (visible: boolean) => void;
  handleJointChange: (
    ref: JointEntityRef,
    angle: number,
    context?: ViewerJointChangeContext,
  ) => void;
  /**
   * Restore a component's joint angles as one undoable step, bypassing the
   * limit clamp that interactive dragging applies. Returns the angles the
   * workspace accepted (locked joints are skipped).
   */
  handleResetJointAngles: (
    componentId: string,
    jointAngles: Record<string, number>,
  ) => Record<string, number>;
  flushJointMotion: () => void;
}
