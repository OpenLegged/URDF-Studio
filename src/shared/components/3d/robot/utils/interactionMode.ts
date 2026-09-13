import type { ToolMode } from '@/shared/components/3d/robot/types';
import type { MeasureMode } from '@/shared/components/3d/robot/utils/measurements';

export type ViewerHighlightMode = 'link' | 'collision';
export type InteractiveGeometrySubType = 'visual' | 'collision';

export interface EffectiveInteractionSubType {
  subType: InteractiveGeometrySubType | null;
  didFallback: boolean;
}

export interface TopLayerInteractionSubTypeOptions {
  showVisual: boolean;
  showCollision: boolean;
  collisionAlwaysOnTop: boolean;
}

export interface TopLayerInteractionSubTypeFromHitsOptions extends TopLayerInteractionSubTypeOptions {
  hits: ReadonlyArray<{ isCollision: boolean }>;
}

export function shouldBlockOrbitForGeometryHit(
  toolMode: ToolMode,
  measureMode?: MeasureMode,
): boolean {
  if (toolMode === 'measure') {
    return measureMode !== 'point';
  }

  return (
    toolMode === 'select' ||
    toolMode === 'translate' ||
    toolMode === 'rotate' ||
    toolMode === 'universal' ||
    toolMode === 'paint'
  );
}

export function shouldStartJointDragFromGeometryHit(toolMode: ToolMode): boolean {
  return (
    toolMode === 'select' ||
    toolMode === 'translate' ||
    toolMode === 'rotate' ||
    toolMode === 'universal'
  );
}

export function shouldDisableOrbitForDirectJointDrag(
  toolMode: ToolMode,
  hasDirectJointDragTarget: boolean,
): boolean {
  return hasDirectJointDragTarget && shouldStartJointDragFromGeometryHit(toolMode);
}

export function resolveEffectiveInteractionSubType(
  highlightMode: ViewerHighlightMode,
  showVisual: boolean,
  showCollision: boolean,
): EffectiveInteractionSubType {
  const preferredSubType: InteractiveGeometrySubType =
    highlightMode === 'collision' ? 'collision' : 'visual';
  const fallbackSubType: InteractiveGeometrySubType =
    preferredSubType === 'visual' ? 'collision' : 'visual';

  const isPreferredVisible = preferredSubType === 'visual' ? showVisual : showCollision;

  if (isPreferredVisible) {
    return { subType: preferredSubType, didFallback: false };
  }

  const isFallbackVisible = fallbackSubType === 'visual' ? showVisual : showCollision;

  if (isFallbackVisible) {
    return { subType: fallbackSubType, didFallback: true };
  }

  return { subType: null, didFallback: false };
}

export function resolveTopLayerInteractionSubType({
  showVisual,
  showCollision,
  collisionAlwaysOnTop,
}: TopLayerInteractionSubTypeOptions): InteractiveGeometrySubType | null {
  if (showVisual && showCollision) {
    return collisionAlwaysOnTop ? 'collision' : 'visual';
  }

  if (showCollision) {
    return 'collision';
  }

  if (showVisual) {
    return 'visual';
  }

  return null;
}

export function resolveTopLayerInteractionSubTypeFromHits({
  showVisual,
  showCollision,
  collisionAlwaysOnTop,
  hits,
}: TopLayerInteractionSubTypeFromHitsOptions): InteractiveGeometrySubType | null {
  const defaultSubType = resolveTopLayerInteractionSubType({
    showVisual,
    showCollision,
    collisionAlwaysOnTop,
  });
  if (!defaultSubType) {
    return null;
  }

  if (hits.length === 0) {
    return defaultSubType;
  }

  if (!showVisual) {
    return 'collision';
  }

  if (!showCollision) {
    return 'visual';
  }

  if (collisionAlwaysOnTop) {
    return hits.some((hit) => hit.isCollision) ? 'collision' : 'visual';
  }

  return hits[0]?.isCollision ? 'collision' : 'visual';
}
