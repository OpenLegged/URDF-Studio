import { isEntityEditorLocked } from '@/core/robot';
import type { AssemblyState, BridgeEntityRef, JointEntityRef } from '@/types';
import type { WorkspaceStoreState } from '@/store/workspaceStore';

type JointMotionResetStore = Pick<
  WorkspaceStoreState,
  | 'beginWorkspaceTransaction'
  | 'cancelWorkspaceTransaction'
  | 'commitWorkspaceTransaction'
  | 'flushPendingJointMotion'
  | 'setComponentJointMotion'
  | 'setWorkspaceJointMotion'
>;

export interface WorkspaceJointMotionResetTarget {
  ref: JointEntityRef | BridgeEntityRef;
  angle: number;
}

const JOINT_RESET_EPSILON = 1e-9;

function isJointAlreadyAtResetAngle(currentAngle: unknown, resetAngle: number): boolean {
  return (
    typeof currentAngle === 'number' &&
    Number.isFinite(currentAngle) &&
    Math.abs(currentAngle - resetAngle) <= JOINT_RESET_EPSILON
  );
}

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
        joints[entityId] !== undefined &&
        Number.isFinite(angle) &&
        !isEntityEditorLocked(workspace, { type: 'joint', componentId, entityId })
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
    store.setComponentJointMotion(
      componentId,
      resettableAngles,
      {},
      {
        operationId: transactionId,
      },
    );
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

/** Restore every resettable component and bridge joint in one undoable step. */
export function commitWorkspaceJointMotionReset({
  targets,
  flushPendingHistory,
  store,
  workspace,
}: {
  targets: readonly WorkspaceJointMotionResetTarget[];
  flushPendingHistory: () => void;
  store: JointMotionResetStore;
  workspace: AssemblyState;
}): WorkspaceJointMotionResetTarget[] {
  type IndexedResetTarget = {
    index: number;
    target: WorkspaceJointMotionResetTarget;
  };

  const componentTargets = new Map<string, IndexedResetTarget[]>();
  const bridgeTargets: IndexedResetTarget[] = [];
  const acceptedTargetIndexes = new Set<number>();

  targets.forEach((target, index) => {
    if (!Number.isFinite(target.angle) || isEntityEditorLocked(workspace, target.ref)) {
      return;
    }
    if (target.ref.type === 'bridge') {
      const bridge = workspace.bridges[target.ref.bridgeId];
      if (!bridge) {
        return;
      }
      if (isJointAlreadyAtResetAngle(bridge.joint.angle, target.angle)) {
        acceptedTargetIndexes.add(index);
        return;
      }
      bridgeTargets.push({ index, target });
      return;
    }

    const joint = workspace.components[target.ref.componentId]?.robot.joints[target.ref.entityId];
    if (!joint) {
      return;
    }
    if (isJointAlreadyAtResetAngle(joint.angle, target.angle)) {
      acceptedTargetIndexes.add(index);
      return;
    }
    const componentResetTargets = componentTargets.get(target.ref.componentId) ?? [];
    componentResetTargets.push({ index, target });
    componentTargets.set(target.ref.componentId, componentResetTargets);
  });

  if (componentTargets.size === 0 && bridgeTargets.length === 0) {
    return targets.filter((_, index) => acceptedTargetIndexes.has(index));
  }

  flushPendingHistory();
  let operationId: string | null = null;
  try {
    const transactionId = store.beginWorkspaceTransaction('Reset joint angles');
    operationId = transactionId;
    const pendingTargets = [
      ...Array.from(componentTargets.values()).flat(),
      ...bridgeTargets,
    ];
    if (store.setWorkspaceJointMotion(
      pendingTargets.map(({ target }) => target),
      { operationId: transactionId },
    )) {
      pendingTargets.forEach(({ index }) => acceptedTargetIndexes.add(index));
    }
    store.flushPendingJointMotion({ operationId: transactionId });
    store.commitWorkspaceTransaction(transactionId);
    return targets.filter((_, index) => acceptedTargetIndexes.has(index));
  } catch (error) {
    if (operationId) {
      store.cancelWorkspaceTransaction(operationId);
    }
    throw error;
  }
}
