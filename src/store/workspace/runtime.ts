import type { AssemblyState, JointQuaternion, WorkspaceHistory } from '@/types';
import {
  assertCanonicalWorkspace,
  createAssemblySceneProjection,
  createDefaultWorkspace,
  isEntityEditorLocked,
  resolveClosedLoopDrivenJointMotion,
} from '@/core/robot';

import {
  JOINT_MOTION_EPSILON,
  MAX_WORKSPACE_ACTIVITY,
  MAX_WORKSPACE_HISTORY,
  cloneWorkspace,
  createWorkspaceActivity,
  repairPendingAutoGroundComponentIds,
  resolveActiveComponentId,
  workspaceSnapshotsEqual,
} from './helpers';
import type {
  BeginWorkspaceTransactionOptions,
  ReplaceWorkspaceOptions,
  WorkspaceActions,
  WorkspaceMutationOptions,
  WorkspaceStoreGet,
  WorkspaceStoreSet,
} from './types';

type WorkspaceRecipe = (draft: AssemblyState) => AssemblyState | void;

export interface WorkspaceRuntime {
  applyMutation: (
    label: string,
    recipe: WorkspaceRecipe,
    options?: WorkspaceMutationOptions,
  ) => boolean;
  isOperationAllowed: (options?: WorkspaceMutationOptions) => boolean;
  actions: Pick<
    WorkspaceActions,
    | 'replaceWorkspace'
    | 'restoreWorkspace'
    | 'resetWorkspace'
    | 'renameWorkspace'
    | 'setActiveComponent'
    | 'beginWorkspaceTransaction'
    | 'commitWorkspaceTransaction'
    | 'cancelWorkspaceTransaction'
    | 'undo'
    | 'redo'
    | 'canUndo'
    | 'canRedo'
    | 'clearHistory'
    | 'setJointMotion'
    | 'setComponentJointMotion'
    | 'flushPendingJointMotion'
    | 'consumePendingAutoGroundComponentIds'
    | 'clearPendingAutoGroundComponentIds'
    | 'getSceneProjection'
  >;
}

function appendHistory(
  history: WorkspaceHistory,
  before: AssemblyState,
  label: string,
): void {
  history.past = [...history.past, cloneWorkspace(before)].slice(-MAX_WORKSPACE_HISTORY);
  history.future = [];
  history.activity = [...history.activity, createWorkspaceActivity(label)].slice(
    -MAX_WORKSPACE_ACTIVITY,
  );
}

function quaternionValuesEqual(
  left: JointQuaternion | undefined,
  right: JointQuaternion,
): boolean {
  return Boolean(
    left &&
      Math.abs(left.x - right.x) <= JOINT_MOTION_EPSILON &&
      Math.abs(left.y - right.y) <= JOINT_MOTION_EPSILON &&
      Math.abs(left.z - right.z) <= JOINT_MOTION_EPSILON &&
      Math.abs(left.w - right.w) <= JOINT_MOTION_EPSILON,
  );
}

function isFiniteQuaternion(value: JointQuaternion): boolean {
  return [value.x, value.y, value.z, value.w].every(Number.isFinite);
}

export function createWorkspaceRuntime(
  set: WorkspaceStoreSet,
  get: WorkspaceStoreGet,
): WorkspaceRuntime {
  let transactionBefore: AssemblyState | null = null;
  let pendingJointMotionBefore: AssemblyState | null = null;
  let pendingJointMotionDirty = false;

  const isOperationAllowed = (options?: WorkspaceMutationOptions): boolean => {
    const transaction = get().transaction;
    if (transaction) {
      return options?.operationId === transaction.id;
    }
    return options?.operationId === undefined;
  };

  const hasDirtyTransaction = (): boolean => {
    const transaction = get().transaction;
    return Boolean(
      transaction
      && transactionBefore
      && !workspaceSnapshotsEqual(transactionBefore, get().workspace),
    );
  };

  const flushPendingJointMotion = (options?: WorkspaceMutationOptions): boolean => {
    if (!pendingJointMotionDirty) {
      return false;
    }
    const transaction = get().transaction;
    if (transaction && options?.operationId !== transaction.id) {
      return false;
    }

    const before = pendingJointMotionBefore;
    pendingJointMotionBefore = null;
    pendingJointMotionDirty = false;
    if (transaction || !before) {
      return true;
    }

    const current = get().workspace;
    if (workspaceSnapshotsEqual(before, current)) {
      return false;
    }
    if (!options?.skipHistory) {
      set((state) => {
        appendHistory(state.history, before, options?.label ?? 'Commit joint motion');
      });
    } else {
      set((state) => {
        state.history.future = [];
      });
    }
    return true;
  };

  const applyMutation = (
    label: string,
    recipe: WorkspaceRecipe,
    options?: WorkspaceMutationOptions,
  ): boolean => {
    if (!isOperationAllowed(options)) {
      return false;
    }
    if (!get().transaction) {
      flushPendingJointMotion();
    }

    const before = cloneWorkspace(get().workspace);
    const draft = cloneWorkspace(before);
    const recipeResult = recipe(draft);
    const next = recipeResult ?? draft;
    assertCanonicalWorkspace(next);
    if (workspaceSnapshotsEqual(before, next)) {
      return false;
    }

    set((state) => {
      state.workspace = next;
      state.activeComponentId = resolveActiveComponentId(next, state.activeComponentId);
      state.pendingAutoGroundComponentIds = repairPendingAutoGroundComponentIds(
        state.pendingAutoGroundComponentIds,
        next,
      );
      state.revision += 1;
      if (!state.transaction && !options?.skipHistory) {
        appendHistory(state.history, before, options?.label ?? label);
      } else if (!state.transaction) {
        state.history.future = [];
      }
    });
    return true;
  };

  const beginWorkspaceTransaction = (
    label: string,
    options: BeginWorkspaceTransactionOptions = {},
  ): string => {
    flushPendingJointMotion();
    if (get().transaction) {
      throw new Error(`Workspace transaction "${get().transaction?.id}" is already active.`);
    }

    const id =
      options.operationId ??
      `workspace_transaction_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    transactionBefore = cloneWorkspace(get().workspace);
    set((state) => {
      state.transaction = {
        id,
        label,
        startedRevision: state.revision,
        ...(options.componentId ? { componentId: options.componentId } : {}),
        exclusive: options.exclusive ?? false,
        ...(options.skipHistory ? { skipHistory: true } : {}),
      };
    });
    return id;
  };

  const commitWorkspaceTransaction = (operationId: string): boolean => {
    const transaction = get().transaction;
    if (!transaction || transaction.id !== operationId) {
      return false;
    }

    const before = transactionBefore;
    transactionBefore = null;
    pendingJointMotionBefore = null;
    pendingJointMotionDirty = false;
    const changed = Boolean(before && !workspaceSnapshotsEqual(before, get().workspace));
    set((state) => {
      state.transaction = null;
      if (changed && before && !transaction.skipHistory) {
        appendHistory(state.history, before, transaction.label);
      } else if (changed && transaction.skipHistory) {
        state.history.future = [];
      }
    });
    return true;
  };

  const cancelWorkspaceTransaction = (operationId: string): boolean => {
    const transaction = get().transaction;
    if (!transaction || transaction.id !== operationId) {
      return false;
    }

    const before = transactionBefore;
    transactionBefore = null;
    pendingJointMotionBefore = null;
    pendingJointMotionDirty = false;
    const changed = Boolean(before && !workspaceSnapshotsEqual(before, get().workspace));
    set((state) => {
      state.transaction = null;
      if (before && changed) {
        state.workspace = before;
        state.activeComponentId = resolveActiveComponentId(before, state.activeComponentId);
        state.pendingAutoGroundComponentIds = repairPendingAutoGroundComponentIds(
          state.pendingAutoGroundComponentIds,
          before,
        );
        state.revision += 1;
      }
    });
    return true;
  };

  const replaceWorkspace = (
    workspace: AssemblyState,
    options: ReplaceWorkspaceOptions = {},
  ): boolean => {
    assertCanonicalWorkspace(workspace);
    if (!isOperationAllowed(options)) {
      return false;
    }

    if (!options.resetHistory) {
      return applyMutation(
        'Replace workspace',
        () => cloneWorkspace(workspace),
        options,
      );
    }

    const next = cloneWorkspace(workspace);
    const changed = !workspaceSnapshotsEqual(get().workspace, next);
    transactionBefore = null;
    pendingJointMotionBefore = null;
    pendingJointMotionDirty = false;
    set((state) => {
      state.workspace = next;
      state.activeComponentId = resolveActiveComponentId(next, state.activeComponentId);
      state.history = {
        past: [],
        future: [],
        activity: [createWorkspaceActivity(options.label ?? 'Replace workspace')],
      };
      state.pendingAutoGroundComponentIds = [];
      state.transaction = null;
      if (changed) {
        state.revision += 1;
      }
    });
    return changed;
  };

  const restoreWorkspace = (
    workspace: AssemblyState,
    history: WorkspaceHistory,
  ): boolean => {
    if (get().transaction) {
      return false;
    }
    assertCanonicalWorkspace(workspace);
    history.past.forEach(assertCanonicalWorkspace);
    history.future.forEach(assertCanonicalWorkspace);
    history.activity.forEach((entry, index) => {
      if (
        !entry ||
        typeof entry.id !== 'string' ||
        !entry.id.trim() ||
        typeof entry.timestamp !== 'string' ||
        !entry.timestamp.trim() ||
        typeof entry.label !== 'string' ||
        !entry.label.trim()
      ) {
        throw new Error(`Invalid workspace history activity at index ${index}.`);
      }
    });
    const nextWorkspace = cloneWorkspace(workspace);
    const nextHistory: WorkspaceHistory = {
      past: history.past.map(cloneWorkspace),
      future: history.future.map(cloneWorkspace),
      activity: structuredClone(history.activity),
    };
    pendingJointMotionBefore = null;
    pendingJointMotionDirty = false;
    transactionBefore = null;
    set((state) => {
      state.workspace = nextWorkspace;
      state.activeComponentId = resolveActiveComponentId(
        nextWorkspace,
        state.activeComponentId,
      );
      state.history = nextHistory;
      state.pendingAutoGroundComponentIds = [];
      state.transaction = null;
      state.revision += 1;
    });
    return true;
  };

  const applyJointSolution = (
    componentId: string,
    angles: Record<string, number>,
    quaternions: Record<string, JointQuaternion>,
    options?: Pick<WorkspaceMutationOptions, 'operationId'>,
  ): boolean => {
    if (!isOperationAllowed(options)) {
      return false;
    }
    const component = get().workspace.components[componentId];
    if (!component) {
      return false;
    }

    const requestedJointIds = new Set([
      ...Object.keys(angles),
      ...Object.keys(quaternions),
    ]);
    if ([...requestedJointIds].some((entityId) => isEntityEditorLocked(
      get().workspace,
      { type: 'joint', componentId, entityId },
    ))) {
      return false;
    }

    const angleEntries = Object.entries(angles).filter(([jointId, angle]) => {
      const current = component.robot.joints[jointId]?.angle;
      return (
        Number.isFinite(angle) &&
        component.robot.joints[jointId] !== undefined &&
        (current === undefined || Math.abs(current - angle) > JOINT_MOTION_EPSILON)
      );
    });
    const quaternionEntries = Object.entries(quaternions).filter(([jointId, quaternion]) => {
      const joint = component.robot.joints[jointId];
      return (
        joint !== undefined &&
        isFiniteQuaternion(quaternion) &&
        !quaternionValuesEqual(joint.quaternion, quaternion)
      );
    });
    if (angleEntries.length === 0 && quaternionEntries.length === 0) {
      return false;
    }

    if (!get().transaction && !pendingJointMotionBefore) {
      pendingJointMotionBefore = cloneWorkspace(get().workspace);
    }
    pendingJointMotionDirty = true;
    set((state) => {
      const draftComponent = state.workspace.components[componentId];
      if (!draftComponent) {
        return;
      }
      angleEntries.forEach(([jointId, angle]) => {
        draftComponent.robot.joints[jointId]!.angle = angle;
      });
      quaternionEntries.forEach(([jointId, quaternion]) => {
        draftComponent.robot.joints[jointId]!.quaternion = { ...quaternion };
      });
      state.revision += 1;
      state.jointMotionRevision += 1;
    });
    return true;
  };

  const actions: WorkspaceRuntime['actions'] = {
    replaceWorkspace,
    restoreWorkspace,
    resetWorkspace: (name) => {
      replaceWorkspace(createDefaultWorkspace(name), {
        label: 'Reset workspace',
        resetHistory: true,
      });
    },
    renameWorkspace: (name, options) =>
      applyMutation(
        'Rename workspace',
        (draft) => {
          draft.name = name;
        },
        options,
      ),
    setActiveComponent: (componentId) => {
      if (!get().workspace.components[componentId] || get().activeComponentId === componentId) {
        return false;
      }
      set((state) => {
        state.activeComponentId = componentId;
      });
      return true;
    },
    beginWorkspaceTransaction,
    commitWorkspaceTransaction,
    cancelWorkspaceTransaction,
    undo: () => {
      if (get().transaction?.exclusive) {
        return false;
      }
      flushPendingJointMotion();
      const transactionId = get().transaction?.id;
      if (transactionId) {
        commitWorkspaceTransaction(transactionId);
      }
      const currentState = get();
      const previous = currentState.history.past.at(-1);
      if (!previous) {
        return false;
      }
      const current = cloneWorkspace(currentState.workspace);
      const restored = cloneWorkspace(previous);
      set((state) => {
        state.workspace = restored;
        state.activeComponentId = resolveActiveComponentId(restored, state.activeComponentId);
        state.history.past = state.history.past.slice(0, -1);
        state.history.future = [current, ...state.history.future].slice(
          0,
          MAX_WORKSPACE_HISTORY,
        );
        state.pendingAutoGroundComponentIds = repairPendingAutoGroundComponentIds(
          state.pendingAutoGroundComponentIds,
          restored,
        );
        state.revision += 1;
      });
      return true;
    },
    redo: () => {
      if (get().transaction?.exclusive) {
        return false;
      }
      flushPendingJointMotion();
      const transactionId = get().transaction?.id;
      if (transactionId) {
        commitWorkspaceTransaction(transactionId);
      }
      const currentState = get();
      const next = currentState.history.future[0];
      if (!next) {
        return false;
      }
      const current = cloneWorkspace(currentState.workspace);
      const restored = cloneWorkspace(next);
      set((state) => {
        state.workspace = restored;
        state.activeComponentId = resolveActiveComponentId(restored, state.activeComponentId);
        state.history.past = [...state.history.past, current].slice(-MAX_WORKSPACE_HISTORY);
        state.history.future = state.history.future.slice(1);
        state.pendingAutoGroundComponentIds = repairPendingAutoGroundComponentIds(
          state.pendingAutoGroundComponentIds,
          restored,
        );
        state.revision += 1;
      });
      return true;
    },
    canUndo: () =>
      !get().transaction?.exclusive
      && (
        get().history.past.length > 0
        || pendingJointMotionDirty
        || hasDirtyTransaction()
      ),
    canRedo: () =>
      !get().transaction?.exclusive
      && !pendingJointMotionDirty
      && !hasDirtyTransaction()
      && get().history.future.length > 0,
    clearHistory: () => {
      if (get().transaction) {
        return;
      }
      flushPendingJointMotion({ skipHistory: true });
      set((state) => {
        state.history.past = [];
        state.history.future = [];
      });
    },
    setJointMotion: (ref, angle, options) => {
      const component = get().workspace.components[ref.componentId];
      if (!component?.robot.joints[ref.entityId] || !Number.isFinite(angle)) {
        return false;
      }
      const solution = resolveClosedLoopDrivenJointMotion(
        component.robot,
        ref.entityId,
        angle,
      );
      return applyJointSolution(
        ref.componentId,
        solution.angles,
        solution.quaternions,
        options,
      );
    },
    setComponentJointMotion: (componentId, angles, quaternions = {}, options) =>
      applyJointSolution(componentId, angles, quaternions, options),
    flushPendingJointMotion,
    consumePendingAutoGroundComponentIds: (componentIds) => {
      const ids = new Set(componentIds);
      set((state) => {
        state.pendingAutoGroundComponentIds = state.pendingAutoGroundComponentIds.filter(
          (componentId) => !ids.has(componentId),
        );
      });
    },
    clearPendingAutoGroundComponentIds: () => {
      set((state) => {
        state.pendingAutoGroundComponentIds = [];
      });
    },
    getSceneProjection: () => createAssemblySceneProjection(get().workspace),
  };

  return { applyMutation, isOperationAllowed, actions };
}
