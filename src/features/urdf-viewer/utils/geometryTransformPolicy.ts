import type { InteractiveGeometrySubType } from './interactionMode';

export interface GeometryTransformVisibility {
  showVisual: boolean;
  showCollision: boolean;
}

export function canTransformGeometry(
  subType: InteractiveGeometrySubType | null | undefined,
  visibility: GeometryTransformVisibility,
): boolean {
  if (subType === 'collision') {
    return visibility.showCollision;
  }

  if (subType === 'visual') {
    return visibility.showVisual && !visibility.showCollision;
  }

  return false;
}

export function shouldNotifyVisualTransformLock(
  wasShowingCollision: boolean,
  isShowingCollision: boolean,
): boolean {
  return !wasShowingCollision && isShowingCollision;
}
