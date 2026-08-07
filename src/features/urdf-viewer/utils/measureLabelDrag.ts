export interface MeasureLabelScreenPoint {
  x: number;
  y: number;
}

export function resolveMeasureLabelDragOffset(
  initialOffset: MeasureLabelScreenPoint,
  pointerStart: MeasureLabelScreenPoint,
  pointerCurrent: MeasureLabelScreenPoint,
  screenScale: MeasureLabelScreenPoint = { x: 1, y: 1 },
): MeasureLabelScreenPoint {
  const scaleX = Math.abs(screenScale.x) > 1e-6 ? screenScale.x : 1;
  const scaleY = Math.abs(screenScale.y) > 1e-6 ? screenScale.y : 1;

  return {
    x: initialOffset.x + (pointerCurrent.x - pointerStart.x) / scaleX,
    y: initialOffset.y + (pointerCurrent.y - pointerStart.y) / scaleY,
  };
}
