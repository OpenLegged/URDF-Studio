export function resolveHoverMoveEventName(
  targetWindow: { PointerEvent?: unknown } | null | undefined,
): 'pointermove' | 'mousemove' {
  return targetWindow?.PointerEvent ? 'pointermove' : 'mousemove';
}
