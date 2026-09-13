import * as THREE from 'three';

function isSelectableHelperNode(object: THREE.Object3D | null): boolean {
  return object?.userData?.isSelectableHelper === true;
}

function isBlockingGizmoNode(object: THREE.Object3D | null): boolean {
  if (!object || object.userData?.isGizmo !== true) {
    return false;
  }

  return !isSelectableHelperNode(object);
}

function resolveVisibleHandleAxis(object: THREE.Object3D | null): string | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current.userData?.urdfVisibleHandleTarget === true) {
      const axis = current.userData?.urdfAxis;
      return typeof axis === 'string' && axis.length > 0 ? axis : null;
    }
    current = current.parent;
  }
  return null;
}

export function isGizmoObject(object: THREE.Object3D | null): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if ((current as { isTransformControlsGizmo?: boolean }).isTransformControlsGizmo) {
      return true;
    }
    if (isBlockingGizmoNode(current)) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

export function collectGizmoRaycastTargets(scene: THREE.Object3D): THREE.Object3D[] {
  const targets: THREE.Object3D[] = [];

  scene.traverse((child) => {
    if (!child.visible) return;
    if (!isBlockingGizmoNode(child)) return;
    if (typeof (child as unknown as { raycast?: unknown }).raycast !== 'function') return;
    targets.push(child);
  });

  return targets;
}

/**
 * Resolve the hovered axis from the parent TransformControls for a gizmo hit
 * object.  Returns `null` when the pointer is on an invisible picker mesh
 * (no visible handle is targeted) and a non-null axis string when a visible
 * handle is being hovered.
 */
export function resolveGizmoHoverAxis(gizmoHitObject: THREE.Object3D): string | null {
  const visibleHandleAxis = resolveVisibleHandleAxis(gizmoHitObject);
  if (visibleHandleAxis) {
    return visibleHandleAxis;
  }

  let current: THREE.Object3D | null = gizmoHitObject;
  while (current) {
    if (typeof (current as any).dragging === 'boolean' && 'axis' in current) {
      return (current as any).axis ?? null;
    }
    current = current.parent;
  }
  return null;
}

export function shouldBlockBackgroundInteractionForGizmoHit(
  gizmoHitObject: THREE.Object3D | null,
): boolean {
  return Boolean(
    gizmoHitObject &&
      isGizmoObject(gizmoHitObject) &&
      resolveGizmoHoverAxis(gizmoHitObject) !== null,
  );
}

export function shouldPreserveSelectionForGizmoPointerDown(
  gizmoHitObject: THREE.Object3D | null,
): boolean {
  return shouldBlockBackgroundInteractionForGizmoHit(gizmoHitObject);
}

export function findFirstIntersection(
  intersections: THREE.Intersection[],
  predicate: (hit: THREE.Intersection) => boolean,
): THREE.Intersection | null {
  for (const hit of intersections) {
    if (predicate(hit)) {
      return hit;
    }
  }

  return null;
}
