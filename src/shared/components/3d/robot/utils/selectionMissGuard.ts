export interface SelectionMissGuardRef {
  current: boolean;
}

export interface SelectionMissGuardTimerRef {
  current: ReturnType<typeof setTimeout> | null;
}

interface ScheduleSelectionMissGuardResetOptions {
  justSelectedRef?: SelectionMissGuardRef | null;
  timerRef: SelectionMissGuardTimerRef;
  delayMs?: number;
  onReset?: () => void;
}

interface ResolveSelectionMissGuardPointerMoveOptions {
  justSelected: boolean;
  pointerButtons: number;
  dragging: boolean;
  hasPendingSelection: boolean;
  hasResetTimer: boolean;
}

interface ResolvePointerUpBackgroundMissOptions {
  hasPendingSelection: boolean;
  dragging: boolean;
  interactionHitTarget: boolean;
  wasGizmoDrag: boolean;
  pointerMovedBeyondClickThreshold?: boolean;
}

const DEFAULT_SELECTION_SETTLE_MS = 100;

export function armSelectionMissGuard(justSelectedRef?: SelectionMissGuardRef | null): void {
  if (!justSelectedRef) return;
  justSelectedRef.current = true;
}

export function clearSelectionMissGuardTimer(timerRef: SelectionMissGuardTimerRef): void {
  if (timerRef.current === null) return;
  clearTimeout(timerRef.current);
  timerRef.current = null;
}

export function disarmSelectionMissGuard(
  justSelectedRef?: SelectionMissGuardRef | null,
  timerRef?: SelectionMissGuardTimerRef | null,
): void {
  if (timerRef) {
    clearSelectionMissGuardTimer(timerRef);
  }
  if (!justSelectedRef) return;
  justSelectedRef.current = false;
}

export function scheduleSelectionMissGuardReset({
  justSelectedRef,
  timerRef,
  delayMs = DEFAULT_SELECTION_SETTLE_MS,
  onReset,
}: ScheduleSelectionMissGuardResetOptions): void {
  if (!justSelectedRef) return;

  clearSelectionMissGuardTimer(timerRef);
  timerRef.current = setTimeout(() => {
    justSelectedRef.current = false;
    timerRef.current = null;
    onReset?.();
  }, delayMs);
}

export function shouldDisarmSelectionMissGuardOnPointerMove({
  justSelected,
  pointerButtons,
  dragging,
  hasPendingSelection,
  hasResetTimer,
}: ResolveSelectionMissGuardPointerMoveOptions): boolean {
  return (
    justSelected && pointerButtons === 0 && !dragging && !hasPendingSelection && !hasResetTimer
  );
}

export function shouldTreatPointerUpAsBackgroundMiss({
  hasPendingSelection,
  dragging,
  interactionHitTarget,
  wasGizmoDrag,
  pointerMovedBeyondClickThreshold = false,
}: ResolvePointerUpBackgroundMissOptions): boolean {
  return (
    !hasPendingSelection &&
    !dragging &&
    !interactionHitTarget &&
    !wasGizmoDrag &&
    !pointerMovedBeyondClickThreshold
  );
}
