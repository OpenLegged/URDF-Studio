import type { InteractiveGeometrySubType } from '@/shared/components/3d/robot/utils/interactionMode';

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
    return visibility.showVisual;
  }

  return false;
}
