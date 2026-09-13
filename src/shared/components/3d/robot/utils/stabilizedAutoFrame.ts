export interface StabilizedAutoFrameSample<TState> {
  stabilityKey: string | null;
  state: TState;
}

export interface ScheduleStabilizedAutoFrameOptions<TState> {
  sample: () => StabilizedAutoFrameSample<TState>;
  applyFrame: (sample: StabilizedAutoFrameSample<TState>) => boolean;
  isActive: () => boolean;
  delays?: readonly number[];
  onSettled?: (reason: 'stable' | 'exhausted') => void;
  scheduleTimeout?: (callback: () => void, delayMs: number) => unknown;
  clearScheduledTimeout?: (handle: unknown) => void;
}

type TimerHandle = ReturnType<typeof setTimeout>;

export function scheduleStabilizedAutoFrame<TState>({
  sample,
  applyFrame,
  isActive,
  delays = [0, 96, 224],
  onSettled,
  scheduleTimeout = (callback, delayMs) => setTimeout(callback, delayMs),
  clearScheduledTimeout = (handle) => clearTimeout(handle as TimerHandle),
}: ScheduleStabilizedAutoFrameOptions<TState>): () => void {
  const handles = new Set<unknown>();
  let disposed = false;
  let lastSample: StabilizedAutoFrameSample<TState> | null = null;
  let settled = false;

  const settle = (reason: 'stable' | 'exhausted') => {
    if (disposed || settled) {
      return;
    }

    settled = true;
    onSettled?.(reason);
  };

  const scheduleAttempt = (index: number) => {
    if (disposed || index >= delays.length) {
      return;
    }

    const handle = scheduleTimeout(() => {
      handles.delete(handle);
      if (disposed || !isActive()) {
        return;
      }

      const nextSample = sample();
      const isStable =
        lastSample !== null
        && nextSample.stabilityKey !== null
        && nextSample.stabilityKey === lastSample.stabilityKey;

      // Wait until bounds stop moving before reframing. Applying every sample
      // makes the import auto-frame visibly hop while late mesh/ground
      // alignment updates are still settling.
      if (isStable) {
        if (applyFrame(nextSample)) {
          settle('stable');
          return;
        }
      }

      lastSample = nextSample;

      if (index >= delays.length - 1) {
        applyFrame(nextSample);
        settle('exhausted');
        return;
      }

      scheduleAttempt(index + 1);
    }, delays[index] ?? 0);

    handles.add(handle);
  };

  scheduleAttempt(0);

  return () => {
    disposed = true;
    handles.forEach((handle) => clearScheduledTimeout(handle));
    handles.clear();
  };
}
