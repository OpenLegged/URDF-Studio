import {
  resolveDeferredUsdSceneSnapshotDelayMs,
  USD_DEFERRED_SCENE_SNAPSHOT_INITIAL_DELAY_MS,
  USD_DEFERRED_SCENE_SNAPSHOT_INTERACTION_IDLE_MS,
  USD_DEFERRED_SCENE_SNAPSHOT_MAX_DELAY_MS,
} from './deferredUsdSceneSnapshot.ts';

export interface UsdDeferredSceneSnapshotInteraction {
  active: boolean;
  lastInteractionAt: number;
}

export type UsdDeferredSceneSnapshotLogEntry =
  | {
      status: 'pending';
      sourceFileName: string;
      timestamp: number;
      detail: {
        initialDelayMs: number;
        interactionIdleMs: number;
        maxDelayMs: number;
      };
    }
  | {
      status: 'resolved';
      sourceFileName: string;
      timestamp: number;
      durationMs: number;
      detail: {
        deferredUntilIdle: true;
      };
    };

export interface UsdDeferredSceneSnapshotLifecyclePorts<TSnapshot> {
  isActive: (loadGeneration: number) => boolean;
  interaction: () => UsdDeferredSceneSnapshotInteraction;
  publish: (snapshot: TSnapshot, sourceFileName: string) => unknown;
  log: (entry: UsdDeferredSceneSnapshotLogEntry) => void;
  now?: () => number;
  scheduleTimeout?: (callback: () => void, delayMs: number) => unknown;
  clearScheduledTimeout?: (handle: unknown) => void;
}

export interface UsdDeferredSceneSnapshotLifecycle<TSnapshot> {
  schedule: (snapshot: TSnapshot, sourceFileName: string, loadGeneration: number) => void;
  clear: () => void;
  dispose: () => void;
}

interface PendingSnapshot<TSnapshot> {
  loadGeneration: number;
  requestedAt: number;
  snapshot: TSnapshot;
  sourceFileName: string;
}

type TimerHandle = ReturnType<typeof setTimeout>;

/**
 * Owns the single deferred snapshot timeout and pending payload. `clear` resets
 * stage-scoped work while keeping the owner reusable; `dispose` is terminal.
 */
export function createUsdDeferredSceneSnapshotLifecycle<TSnapshot>({
  isActive,
  interaction,
  publish,
  log,
  now = () => Date.now(),
  scheduleTimeout = (callback, delayMs) => setTimeout(callback, delayMs),
  clearScheduledTimeout = (handle) => clearTimeout(handle as TimerHandle),
}: UsdDeferredSceneSnapshotLifecyclePorts<TSnapshot>): UsdDeferredSceneSnapshotLifecycle<TSnapshot> {
  let disposed = false;
  let revision = 0;
  let scheduledTimeout: unknown | null = null;
  let scheduledAttemptToken: object | null = null;
  let pending: PendingSnapshot<TSnapshot> | null = null;

  const clear = (): void => {
    revision += 1;
    if (scheduledTimeout !== null) {
      clearScheduledTimeout(scheduledTimeout);
      scheduledTimeout = null;
    }
    scheduledAttemptToken = null;
    pending = null;
  };

  const scheduleAttempt = (delayMs: number, scheduledRevision: number): void => {
    const attemptToken = {};
    scheduledAttemptToken = attemptToken;
    const handle = scheduleTimeout(
      () => {
        if (scheduledAttemptToken === attemptToken) {
          scheduledAttemptToken = null;
          scheduledTimeout = null;
        }
        if (disposed || scheduledRevision !== revision || !pending) {
          return;
        }
        if (!isActive(pending.loadGeneration)) {
          pending = null;
          return;
        }

        const attemptAt = now();
        const interactionState = interaction();
        const nextDelayMs = resolveDeferredUsdSceneSnapshotDelayMs({
          activeInteraction: interactionState.active,
          lastInteractionAt: interactionState.lastInteractionAt,
          now: attemptAt,
          requestedAt: pending.requestedAt,
        });
        if (nextDelayMs > 0) {
          scheduleAttempt(nextDelayMs, scheduledRevision);
          return;
        }

        const snapshotToPublish = pending;
        pending = null;
        publish(snapshotToPublish.snapshot, snapshotToPublish.sourceFileName);
        const publishedAt = now();
        log({
          sourceFileName: snapshotToPublish.sourceFileName,
          status: 'resolved',
          timestamp: publishedAt,
          durationMs: publishedAt - snapshotToPublish.requestedAt,
          detail: {
            deferredUntilIdle: true,
          },
        });
      },
      Math.max(0, delayMs),
    );
    if (scheduledAttemptToken === attemptToken) {
      scheduledTimeout = handle;
    }
  };

  const schedule = (snapshot: TSnapshot, sourceFileName: string, loadGeneration: number): void => {
    clear();
    if (disposed) {
      return;
    }

    const requestedAt = now();
    pending = {
      loadGeneration,
      requestedAt,
      snapshot,
      sourceFileName,
    };
    log({
      sourceFileName,
      status: 'pending',
      timestamp: requestedAt,
      detail: {
        initialDelayMs: USD_DEFERRED_SCENE_SNAPSHOT_INITIAL_DELAY_MS,
        interactionIdleMs: USD_DEFERRED_SCENE_SNAPSHOT_INTERACTION_IDLE_MS,
        maxDelayMs: USD_DEFERRED_SCENE_SNAPSHOT_MAX_DELAY_MS,
      },
    });

    const scheduledRevision = revision;
    const interactionState = interaction();
    scheduleAttempt(
      resolveDeferredUsdSceneSnapshotDelayMs({
        activeInteraction: interactionState.active,
        lastInteractionAt: interactionState.lastInteractionAt,
        now: requestedAt,
        requestedAt,
      }),
      scheduledRevision,
    );
  };

  return {
    schedule,
    clear,
    dispose: () => {
      disposed = true;
      clear();
    },
  };
}
