import { isEntityEditorLocked } from '@/core/robot';
import type { AssemblyState } from '@/types';
import type { WorkspaceStoreState } from '@/store/workspaceStore';

type JointMotionResetStore = Pick<
  WorkspaceStoreState,
  | 'beginWorkspaceTransaction'
  | 'cancelWorkspaceTransaction'
  | 'commitWorkspaceTransaction'
  | 'flushPendingJointMotion'
  | 'setComponentJointMotion'
>;

interface CommitComponentJointMotionResetOptions {
  componentId: string;
  /** Joint angles captured when the component was loaded, keyed by joint id. */
  jointAngles: Record<string, number>;
  flushPendingHistory: () => void;
  store: JointMotionResetStore;
  workspace: AssemblyState;
}

/**
 * Drop joints a reset must not write.
 *
 * A locked joint is skipped individually rather than failing the whole reset,
 * because `setComponentJointMotion` rejects the entire batch as soon as one of
 * its joints is locked.
 */
export function resolveResettableJointAngles(
  workspace: AssemblyState,
  componentId: string,
  jointAngles: Record<string, number>,
): Record<string, number> {
  const joints = workspace.components[componentId]?.robot.joints;
  if (!joints) {
    return {};
  }

  return Object.entries(jointAngles).reduce<Record<string, number>>(
    (resettable, [entityId, angle]) => {
      if (
        joints[entityId] !== undefined
        && Number.isFinite(angle)
        && !isEntityEditorLocked(workspace, { type: 'joint', componentId, entityId })
      ) {
        resettable[entityId] = angle;
      }
      return resettable;
    },
    {},
  );
}

/**
 * Restore one component's joint angles as a single undoable step.
 *
 * Reset writes the captured load-time angles verbatim through
 * `setComponentJointMotion`, deliberately bypassing the driven-motion solver
 * used by interactive dragging: that solver clamps into `joint.limit`, and a
 * model whose load-time angle already sits outside its own limit (URDF has no
 * initial-position concept, so the viewer starts every joint at 0) would
 * otherwise be "reset" into a pose it never had.
 *
 * Returns the angles actually committed so callers can reconcile local panel
 * state with what the workspace accepted.
 */
export function commitComponentJointMotionReset({
  componentId,
  jointAngles,
  flushPendingHistory,
  store,
  workspace,
}: CommitComponentJointMotionResetOptions): Record<string, number> {
  const resettableAngles = resolveResettableJointAngles(workspace, componentId, jointAngles);
  if (Object.keys(resettableAngles).length === 0) {
    return {};
  }

  flushPendingHistory();
  let operationId: string | null = null;
  try {
    const transactionId = store.beginWorkspaceTransaction('Reset joint angles');
    operationId = transactionId;
    store.setComponentJointMotion(componentId, resettableAngles, {}, {
      operationId: transactionId,
    });
    store.flushPendingJointMotion({ operationId: transactionId });
    store.commitWorkspaceTransaction(transactionId);
    return resettableAngles;
  } catch (error) {
    if (operationId) {
      store.cancelWorkspaceTransaction(operationId);
    }
    throw error;
  }
}
