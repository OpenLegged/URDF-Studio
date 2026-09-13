import type { ToolMode } from '@/shared/components/3d/robot/types';

export const DEFAULT_SELECT_CLICK_DRAG_THRESHOLD_PX = 6;

export interface PointerClickThresholdOptions {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  thresholdPx?: number;
}

export interface PointerInteractionFinalizationOptions {
  interactionStarted: boolean;
  dragging: boolean;
  hasPendingSelection: boolean;
}

export interface DeferredSelectionHoverStateOptions extends PointerClickThresholdOptions {
  hasPendingSelection: boolean;
  alreadyExceededClickThreshold: boolean;
}

export interface DeferredSelectionHoverState {
  pointerExceededClickThreshold: boolean;
  shouldClearHover: boolean;
}

export function shouldDeferSelectionUntilPointerUp(
  toolMode: ToolMode,
  hasDirectJointDragTarget = false,
  hasDeferredViewModeSelection = false,
  hasHelperTarget = false,
): boolean {
  if (hasHelperTarget) {
    return false;
  }

  return (
    (toolMode === 'select' && !hasDirectJointDragTarget) ||
    (toolMode === 'view' && hasDeferredViewModeSelection)
  );
}

export function isPointerInteractionWithinClickThreshold({
  startX,
  startY,
  endX,
  endY,
  thresholdPx = DEFAULT_SELECT_CLICK_DRAG_THRESHOLD_PX,
}: PointerClickThresholdOptions): boolean {
  const dx = endX - startX;
  const dy = endY - startY;
  return dx * dx + dy * dy <= thresholdPx * thresholdPx;
}

export function shouldFinalizePointerInteraction({
  interactionStarted,
  dragging,
  hasPendingSelection,
}: PointerInteractionFinalizationOptions): boolean {
  return interactionStarted || dragging || hasPendingSelection;
}

export function resolveDeferredSelectionHoverState({
  hasPendingSelection,
  alreadyExceededClickThreshold,
  ...pointerThresholdOptions
}: DeferredSelectionHoverStateOptions): DeferredSelectionHoverState {
  if (!hasPendingSelection) {
    return {
      pointerExceededClickThreshold: alreadyExceededClickThreshold,
      shouldClearHover: false,
    };
  }

  if (alreadyExceededClickThreshold) {
    return {
      pointerExceededClickThreshold: true,
      shouldClearHover: false,
    };
  }

  const pointerExceededClickThreshold =
    !isPointerInteractionWithinClickThreshold(pointerThresholdOptions);

  return {
    pointerExceededClickThreshold,
    shouldClearHover: false,
  };
}
