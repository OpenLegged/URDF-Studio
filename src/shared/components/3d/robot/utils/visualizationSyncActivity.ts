const MODEL_OPACITY_EPSILON = 1e-3;

export function shouldRunVisualizationSync(isCurrentlyActive: boolean, wasPreviouslyActive: boolean): boolean {
  return isCurrentlyActive || wasPreviouslyActive;
}

export function isModelOpacitySyncActive(modelOpacity: number): boolean {
  return Math.abs(modelOpacity - 1) > MODEL_OPACITY_EPSILON;
}
