import { useWorkspaceStore } from '@/store/workspaceStore';
import type {
  WorkspaceComponentPropertyPatch,
  WorkspaceLinkPropertyPatch,
} from '@/store/workspaceStore';
import type { ComponentEntityRef, LinkEntityRef } from '@/types';

interface EditorControlMutationOptions {
  commitPendingHistory: () => void;
}

interface ComponentEditorLockPatchOptions extends EditorControlMutationOptions {
  ref: ComponentEntityRef;
  patch: WorkspaceComponentPropertyPatch;
}

interface LinkEditorControlPatchOptions extends EditorControlMutationOptions {
  ref: LinkEntityRef;
  patch: WorkspaceLinkPropertyPatch;
}

export function applyComponentEditorLockPatch({
  ref,
  patch,
  commitPendingHistory,
}: ComponentEditorLockPatchOptions): void {
  if (typeof patch.editorLocked !== 'boolean') return;
  commitPendingHistory();
  useWorkspaceStore.getState().setComponentEditorLocked(
    ref.componentId,
    patch.editorLocked,
    {
      label: patch.editorLocked
        ? 'Lock component editing'
        : 'Unlock component editing',
    },
  );
}

export function applyLinkEditorControlPatch({
  ref,
  patch,
  commitPendingHistory,
}: LinkEditorControlPatchOptions): boolean {
  if (typeof patch.editorLocked === 'boolean') {
    commitPendingHistory();
    useWorkspaceStore.getState().setLinkEditorLocked(ref, patch.editorLocked, {
      label: patch.editorLocked ? 'Lock link editing' : 'Unlock link editing',
    });
    return true;
  }
  if (
    typeof patch.visible !== 'boolean'
    || Object.keys(patch).some((key) => key !== 'visible')
  ) {
    return false;
  }
  commitPendingHistory();
  useWorkspaceStore.getState().setLinkVisibility(ref, patch.visible, {
    label: 'Set link visibility',
  });
  return true;
}
