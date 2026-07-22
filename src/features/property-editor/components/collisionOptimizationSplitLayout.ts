export const COLLISION_OPTIMIZATION_DEFAULT_PRIMARY_WIDTH = 430;
export const COLLISION_OPTIMIZATION_DIVIDER_WIDTH = 8;
export const COLLISION_OPTIMIZATION_STACKED_LAYOUT_MAX_WIDTH = 719;

const DIALOG_CONTENT_HORIZONTAL_INSET = 20;
const MIN_PRIMARY_WIDTH = 200;
const MIN_SECONDARY_WIDTH = 280;

export function shouldStackCollisionOptimizationPanels(dialogWidth: number): boolean {
  return dialogWidth <= COLLISION_OPTIMIZATION_STACKED_LAYOUT_MAX_WIDTH;
}

export function getCollisionOptimizationPrimaryWidthRange(dialogWidth: number): {
  max: number;
  min: number;
} {
  return {
    min: MIN_PRIMARY_WIDTH,
    max: Math.max(
      MIN_PRIMARY_WIDTH,
      dialogWidth -
        DIALOG_CONTENT_HORIZONTAL_INSET -
        COLLISION_OPTIMIZATION_DIVIDER_WIDTH -
        MIN_SECONDARY_WIDTH,
    ),
  };
}
