import { useCallback } from 'react';

import {
  groupProjectedJointMotionByComponent,
  type ViewerJointChangeContext,
  type WorkspaceJointMotionGroup,
} from '@/features/editor';
import type { AssemblySceneProjection } from '@/core/robot';
import { useWorkspaceStore, type WorkspaceStoreState } from '@/store/workspaceStore';
import { logRegressionWarn } from '@/shared/debug/consoleDiagnostics';
import { flushPendingHistory } from '@/app/utils/pendingHistory';

type ProjectedJointMotionStore = Pick<
  WorkspaceStoreState,
  | 'beginWorkspaceTransaction'
  | 'cancelWorkspaceTransaction'
  | 'commitWorkspaceTransaction'
  | 'flushPendingJointMotion'
  | 'setComponentJointMotion'
>;

interface CommitProjectedJointMotionGroupsOptions {
  flushPendingHistory: () => void;
  groups: WorkspaceJointMotionGroup[];
  store: ProjectedJointMotionStore;
}

/** Commits one renderer motion projection as one canonical workspace transaction. */
export function commitProjectedJointMotionGroups({
  flushPendingHistory: flushHistory,
  groups,
  store,
}: CommitProjectedJointMotionGroupsOptions): boolean {
  if (groups.length === 0) {
    return false;
  }

  flushHistory();
  let operationId: string | null = null;
  try {
    const transactionId = store.beginWorkspaceTransaction('Commit viewer joint motion');
    operationId = transactionId;
    groups.forEach((group) => {
      store.setComponentJointMotion(
        group.componentId,
        { ...group.jointAngles },
        { ...group.jointQuaternions },
        { operationId: transactionId },
      );
    });
    store.flushPendingJointMotion({ operationId: transactionId });
    return store.commitWorkspaceTransaction(transactionId);
  } catch (error) {
    if (operationId) {
      store.cancelWorkspaceTransaction(operationId);
    }
    throw error;
  }
}

/** Adapts renderer-keyed joint motion to the workspace transaction command. */
export function useProjectedJointMotionCommit(
  sceneProjection: AssemblySceneProjection,
): (context: ViewerJointChangeContext) => void {
  return useCallback(
    (context: ViewerJointChangeContext) => {
      try {
        commitProjectedJointMotionGroups({
          flushPendingHistory,
          groups: groupProjectedJointMotionByComponent(sceneProjection, context),
          store: useWorkspaceStore.getState(),
        });
      } catch (error) {
        logRegressionWarn('[UnifiedViewer] Failed to commit projected joint motion.', error);
      }
    },
    [sceneProjection],
  );
}
