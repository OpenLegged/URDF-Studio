export const WORKSPACE_POINTER_MISS_DRAG_THRESHOLD_PX = 6;

interface WorkspacePointerDragThresholdOptions {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  thresholdPx?: number;
}

export function hasWorkspacePointerDragExceededThreshold({
  startX,
  startY,
  endX,
  endY,
  thresholdPx = WORKSPACE_POINTER_MISS_DRAG_THRESHOLD_PX,
}: WorkspacePointerDragThresholdOptions): boolean {
  const dx = endX - startX;
  const dy = endY - startY;

  return dx * dx + dy * dy > thresholdPx * thresholdPx;
}

export function shouldSuppressWorkspacePointerMissAfterDrag(
  options: WorkspacePointerDragThresholdOptions,
): boolean {
  return hasWorkspacePointerDragExceededThreshold(options);
}
