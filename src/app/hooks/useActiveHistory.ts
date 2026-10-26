import { useMemo } from 'react';

import { useWorkspaceStore } from '@/store/workspaceStore';
import { flushPendingHistory } from '../utils/pendingHistory';
import { reconcileComponentSourceDraftsWithWorkspace } from './workspace-source-sync/component_source_history';

export interface HistoryActions {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const unavailableHistory: HistoryActions = {
  undo: () => {}, redo: () => {}, canUndo: false, canRedo: false,
};

/** undefined selects the model; null disables history while a host surface loads. */
export function useActiveHistory(override?: HistoryActions | null): HistoryActions {
  const undoWorkspace = useWorkspaceStore((state) => state.undo);
  const redoWorkspace = useWorkspaceStore((state) => state.redo);
  const canUndo = useWorkspaceStore((state) => state.canUndo());
  const canRedo = useWorkspaceStore((state) => state.canRedo());

  const modelHistory = useMemo(
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
  return override === undefined ? modelHistory : override ?? unavailableHistory;
}
