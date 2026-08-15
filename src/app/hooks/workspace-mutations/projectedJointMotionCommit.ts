import { useCallback } from 'react';

import {
  projectRendererJointMotionToWorkspaceTargets,
  type ViewerJointChangeContext,
} from '@/features/editor';
import type { AssemblySceneProjection } from '@/core/robot';
import {
  useWorkspaceStore,
  type WorkspaceJointMotionTarget,
  type WorkspaceStoreState,
} from '@/store/workspaceStore';
import { logRegressionWarn } from '@/shared/debug/consoleDiagnostics';
import { flushPendingHistory } from '@/app/utils/pendingHistory';

type ProjectedJointMotionStore = Pick<
  WorkspaceStoreState,
  | 'beginWorkspaceTransaction'
  | 'cancelWorkspaceTransaction'
  | 'commitWorkspaceTransaction'
  | 'flushPendingJointMotion'
  | 'setWorkspaceJointMotion'
>;

interface CommitProjectedJointMotionTargetsOptions {
  flushPendingHistory: () => void;
  targets: readonly WorkspaceJointMotionTarget[];
  store: ProjectedJointMotionStore;
}

/** Commits one renderer motion projection as one canonical workspace transaction. */
export function commitProjectedJointMotionTargets({
  flushPendingHistory: flushHistory,
  targets,
  store,
}: CommitProjectedJointMotionTargetsOptions): boolean {
  if (targets.length === 0) {
    return false;
  }

  flushHistory();
  let operationId: string | null = null;
  try {
    const transactionId = store.beginWorkspaceTransaction('Commit viewer joint motion');
    operationId = transactionId;
    const changed = store.setWorkspaceJointMotion(targets, {
      operationId: transactionId,
    });
    store.flushPendingJointMotion({ operationId: transactionId });
    return store.commitWorkspaceTransaction(transactionId) && changed;
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
        commitProjectedJointMotionTargets({
          flushPendingHistory,
          targets: projectRendererJointMotionToWorkspaceTargets(sceneProjection, context),
          store: useWorkspaceStore.getState(),
        });
      } catch (error) {
        logRegressionWarn('[UnifiedViewer] Failed to commit projected joint motion.', error);
      }
    },
    [sceneProjection],
  );
}
