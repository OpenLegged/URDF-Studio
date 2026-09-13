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
  UrdfOrigin,
  WorkspaceSelection,
} from '@/types';
import type { UpdateCommitOptions } from '@/types/viewer';
import type { ComponentSourceMutationCommand } from './workspace-source-sync/component_source_commands';

export interface UseWorkspaceMutationsParams {
  focusOn: (ref: EntityRef) => void;
  setSelection: (selection: WorkspaceSelection) => void;
  setPendingCollisionTransform: (transform: PendingCollisionTransform) => void;
  clearPendingCollisionTransform: () => void;
  handleTransformPendingChange: (pending: boolean) => void;
  synchronizeComponentSource?: ComponentSourceMutationCommand;
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
    ref: JointEntityRef | BridgeEntityRef,
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
  handleResetWorkspaceJointAngles: (
    targets: readonly {
      ref: JointEntityRef | BridgeEntityRef;
      angle: number;
    }[],
  ) => readonly {
    ref: JointEntityRef | BridgeEntityRef;
    angle: number;
  }[];
  flushJointMotion: () => void;
}
