import { useEffect } from 'react';

import { useSelectionStore } from '@/store/selectionStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import type { WorkspaceSelection } from '@/types';

function syncActiveComponentForSelection(selection: WorkspaceSelection): void {
  const entity = selection?.entity;
  if (!entity || !('componentId' in entity)) {
    return;
  }

  const workspaceState = useWorkspaceStore.getState();
  if (
    workspaceState.activeComponentId !== entity.componentId &&
    workspaceState.workspace.components[entity.componentId]
  ) {
    workspaceState.setActiveComponent(entity.componentId);
  }
}

/** App-owned command bridge between canonical selection and workspace ownership. */
export function useSelectionActiveComponentSync(): void {
  useEffect(() => {
    syncActiveComponentForSelection(useSelectionStore.getState().selection);
    return useSelectionStore.subscribe((state, previousState) => {
      if (state.selection !== previousState.selection) {
        syncActiveComponentForSelection(state.selection);
      }
    });
  }, []);
}
