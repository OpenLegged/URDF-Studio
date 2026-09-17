import { createSnapshotCaptureAbortError } from './snapshotConfig';

interface PendingAction<TAction> {
  resolve: (action: TAction) => void;
  reject: (error: unknown) => void;
  cleanup: () => void;
}

export interface SnapshotRuntimeActionRegistry<TAction> {
  waitForAction: (options: {
    getCurrentAction: () => TAction | null;
    signal?: AbortSignal;
    isActive: () => boolean;
  }) => Promise<TAction>;
  resolve: (action: TAction) => void;
  rejectAll: (error: unknown) => void;
}

/** Coordinates calls made while the lazy snapshot runtime is loading and mounting. */
export function createSnapshotRuntimeActionRegistry<
  TAction,
>(): SnapshotRuntimeActionRegistry<TAction> {
  const pendingActions = new Set<PendingAction<TAction>>();

  return {
    waitForAction({ getCurrentAction, signal, isActive }) {
      if (signal?.aborted || !isActive()) {
        return Promise.reject(createSnapshotCaptureAbortError());
      }

      const currentAction = getCurrentAction();
      if (currentAction) {
        return Promise.resolve(currentAction);
      }

      return new Promise<TAction>((resolve, reject) => {
        function handleAbort() {
          pendingActions.delete(pendingAction);
          pendingAction.cleanup();
          reject(createSnapshotCaptureAbortError());
        }
        const pendingAction: PendingAction<TAction> = {
          resolve,
          reject,
          cleanup: () => signal?.removeEventListener('abort', handleAbort),
        };
        signal?.addEventListener('abort', handleAbort, { once: true });
        pendingActions.add(pendingAction);

        // Close the unmount race between the initial active check and waiter registration.
        if (!isActive()) {
          pendingActions.delete(pendingAction);
          pendingAction.cleanup();
          reject(createSnapshotCaptureAbortError());
        }
      });
    },

    resolve(action) {
      for (const pendingAction of pendingActions) {
        pendingAction.cleanup();
        pendingAction.resolve(action);
      }
      pendingActions.clear();
    },

    rejectAll(error) {
      for (const pendingAction of pendingActions) {
        pendingAction.cleanup();
        pendingAction.reject(error);
      }
      pendingActions.clear();
    },
  };
}
