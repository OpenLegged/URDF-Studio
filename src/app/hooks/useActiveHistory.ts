import { useMemo } from 'react';

import { useWorkspaceStore } from '@/store/workspaceStore';
import { flushPendingHistory } from '../utils/pendingHistory';
import { reconcileComponentSourceDraftsWithWorkspace } from './workspace-source-sync/component_source_history';

export function useActiveHistory() {
  const undoWorkspace = useWorkspaceStore((state) => state.undo);
  const redoWorkspace = useWorkspaceStore((state) => state.redo);
  const canUndo = useWorkspaceStore((state) => state.canUndo());
  const canRedo = useWorkspaceStore((state) => state.canRedo());

  return useMemo(
    () => ({
      undo: () => {
        flushPendingHistory();
        const previousWorkspace = useWorkspaceStore.getState().workspace;
        if (undoWorkspace()) {
          reconcileComponentSourceDraftsWithWorkspace(previousWorkspace);
        }
      },
      redo: () => {
        flushPendingHistory();
        const previousWorkspace = useWorkspaceStore.getState().workspace;
        if (redoWorkspace()) {
          reconcileComponentSourceDraftsWithWorkspace(previousWorkspace);
        }
      },
      canUndo,
      canRedo,
    }),
    [canRedo, canUndo, redoWorkspace, undoWorkspace],
  );
}
