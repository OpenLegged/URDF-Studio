import type {
  UseWorkspaceMutationsParams,
  WorkspaceMutationHandlers,
} from './useWorkspaceMutationsTypes';
import { useCollisionTransformHandlers } from './workspace-mutations/useCollisionTransformHandlers';
import { usePropertyHistoryCommands } from './workspace-mutations/usePropertyHistoryCommands';
import { useSourceAwareWorkspaceCommands } from './workspace-mutations/useSourceAwareWorkspaceCommands';
import { useViewerPreferenceCommands } from './workspace-mutations/useViewerPreferenceCommands';
import { useWorkspaceTransformCommands } from './workspace-mutations/useWorkspaceTransformCommands';

export function useWorkspaceMutations({
  focusOn,
  setSelection,
  setPendingCollisionTransform,
  clearPendingCollisionTransform,
  handleTransformPendingChange,
  patchEditableSourceAddChild,
  patchEditableSourceDeleteSubtree,
  patchEditableSourceAddCollisionBody,
  patchEditableSourceDeleteCollisionBody,
  patchEditableSourceUpdateCollisionBody,
  patchEditableSourceUpdateJointLimit,
  patchEditableSourceUpdateLinkInertial,
  patchEditableSourceRobotName,
  patchEditableSourceRenameEntities,
}: UseWorkspaceMutationsParams): WorkspaceMutationHandlers {
  const {
    commitPendingHistory,
    mutationOptions,
    runPropertyMutation,
  } = usePropertyHistoryCommands();
  const {
    handleAssemblyTransform,
    handleBridgeTransform,
    handleComponentTransform,
  } = useWorkspaceTransformCommands({ mutationOptions, runPropertyMutation });
  const {
    handleAddChild,
    handleAddCollisionBody,
    handleComponentNameChange,
    handleDelete,
    handleRobotNameChange,
    handleSetComponentVisibility,
    handleUpdate,
    handleWorkspaceNameChange,
    updateLinkProperty,
  } = useSourceAwareWorkspaceCommands({
    commitPendingHistory,
    focusOn,
    handleAssemblyTransform,
    handleComponentTransform,
    mutationOptions,
    patchEditableSourceAddChild,
    patchEditableSourceAddCollisionBody,
    patchEditableSourceDeleteCollisionBody,
    patchEditableSourceDeleteSubtree,
    patchEditableSourceRenameEntities,
    patchEditableSourceRobotName,
    patchEditableSourceUpdateCollisionBody,
    patchEditableSourceUpdateJointLimit,
    patchEditableSourceUpdateLinkInertial,
    runPropertyMutation,
    setSelection,
  });

  const {
    handleCollisionTransformPreview,
    handleCollisionTransform,
    handleCollisionTransformPendingChange,
  } = useCollisionTransformHandlers({
    setPendingCollisionTransform,
    clearPendingCollisionTransform,
    handleTransformPendingChange,
    applyUpdate: updateLinkProperty,
  });

  const {
    flushJointMotion,
    handleJointChange,
    handleResetJointAngles,
    handleSetShowVisual,
  } = useViewerPreferenceCommands({ commitPendingHistory });

  return {
    handleWorkspaceNameChange,
    handleComponentNameChange,
    handleRobotNameChange,
    handleUpdate,
    handleCollisionTransformPreview,
    handleCollisionTransform,
    handleCollisionTransformPendingChange,
    handleAssemblyTransform,
    handleComponentTransform,
    handleBridgeTransform,
    handleAddChild,
    handleAddCollisionBody,
    handleDelete,
    handleSetComponentVisibility,
    handleSetShowVisual,
    handleJointChange,
    handleResetJointAngles,
    flushJointMotion,
  };
}
