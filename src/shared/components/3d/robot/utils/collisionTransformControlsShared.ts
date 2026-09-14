import type { ToolMode } from '@/shared/components/3d/robot/types';

export type CollisionTransformMode = Extract<
  ToolMode,
  'select' | 'translate' | 'rotate' | 'universal'
>;

export interface DraggingControlLike {
  dragging?: boolean;
}

export function shouldUseCollisionTranslateProxy(transformMode: CollisionTransformMode): boolean {
  return transformMode === 'translate' || transformMode === 'universal';
}

export function resolveCollisionTransformControlMode(
  transformMode: CollisionTransformMode,
): 'translate' | 'rotate' | 'universal' {
  if (transformMode === 'rotate') {
    return 'rotate';
  }

  if (transformMode === 'universal') {
    return 'universal';
  }

  return 'translate';
}

export function resolveActiveCollisionDraggingControls<T extends DraggingControlLike>(
  translateControls: T | null | undefined,
  rotateControls: T | null | undefined,
  activeControls: T | null | undefined,
): T | null {
  if (rotateControls?.dragging) {
    return rotateControls;
  }

  if (translateControls?.dragging) {
    return translateControls;
  }

  return activeControls ?? null;
}

export function resolveCurrentCollisionDraggingControls<T extends DraggingControlLike>(
  translateControls: T | null | undefined,
  rotateControls: T | null | undefined,
): T | null {
  return resolveActiveCollisionDraggingControls(translateControls, rotateControls, null);
}

export function canRenderCollisionTransformControls(
  transformMode: CollisionTransformMode,
  shouldUseTranslateProxy: boolean,
  translateProxy: unknown,
): boolean {
  return transformMode === 'rotate' || !shouldUseTranslateProxy || Boolean(translateProxy);
}
