import * as THREE from 'three';
import type { ViewerInteractiveLayer } from '../types';
import { isGizmoObject } from './raycast.ts';
import {
  hasOverlayPresentation,
  hasPickableMaterial,
  isInternalHelperObject,
  isPickOnlyMesh,
  isPickableMeshObject,
  isSelectableHelperObject,
  isVisibleInHierarchy,
} from './pickFilter.ts';

export type PickTargetMode = 'all' | 'visual' | 'collision';

const GEOMETRY_DISTANCE_TIE_EPSILON = 1e-3;
const HIDDEN_HELPER_DISTANCE_EPSILON = 1e-3;

function matchesMode(key: string, mode: PickTargetMode): boolean {
  if (mode === 'all') return true;
  return key.endsWith(`:${mode}`);
}

function collectMjcfTendonPickTargets(
  root: THREE.Object3D,
  seen: Set<number>,
  targets: THREE.Object3D[],
): void {
  root.traverse((child) => {
    if (seen.has(child.id)) return;
    if (child.userData?.isMjcfTendon !== true) return;
    if (!isPickableMeshObject(child)) return;

    seen.add(child.id);
    targets.push(child);
  });
}

export function isCollisionPickObject(object: THREE.Object3D | null): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current.userData?.isCollisionMesh || (current as any).isURDFCollider) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function getEffectiveRenderOrder(object: THREE.Object3D | null): number {
  let current: THREE.Object3D | null = object;
  let renderOrder = 0;

  while (current) {
    if (
      !isPickOnlyMesh(current) &&
      typeof current.renderOrder === 'number' &&
      current.renderOrder > renderOrder
    ) {
      renderOrder = current.renderOrder;
    }
    current = current.parent;
  }

  return renderOrder;
}

function resolveSelectableHelperLayer(
  object: THREE.Object3D | null,
): ViewerInteractiveLayer | null {
  let current: THREE.Object3D | null = object;

  while (current) {
    switch (current.userData?.viewerHelperKind) {
      case 'ik-handle':
        return 'ik-handle';
      case 'origin-axes':
        return 'origin-axes';
      case 'joint-axis':
        return 'joint-axis';
      case 'center-of-mass':
        return 'center-of-mass';
      case 'inertia':
        return 'inertia';
      default:
        break;
    }

    switch (current.name) {
      case '__ik_handle__':
        return 'ik-handle';
      case '__origin_axes__':
        return 'origin-axes';
      case '__joint_axis__':
      case '__joint_axis_helper__':
        return 'joint-axis';
      case '__com_visual__':
        return 'center-of-mass';
      case '__inertia_box__':
        return 'inertia';
      default:
        break;
    }

    current = current.parent;
  }

  return null;
}

function resolveInteractionLayer(hit: THREE.Intersection): ViewerInteractiveLayer | null {
  const helperLayer = resolveSelectableHelperLayer(hit.object);
  if (helperLayer) {
    return helperLayer;
  }

  if (isCollisionPickObject(hit.object)) {
    return 'collision';
  }

  return 'visual';
}

function getInteractionLayerPriorityScore(
  hit: THREE.Intersection,
  interactionLayerPriority: readonly ViewerInteractiveLayer[] | undefined,
): number {
  if (!interactionLayerPriority || interactionLayerPriority.length === 0) {
    return 0;
  }

  const layer = resolveInteractionLayer(hit);
  if (!layer) {
    return 0;
  }

  const layerIndex = interactionLayerPriority.indexOf(layer);
  if (layerIndex === -1) {
    return 0;
  }

  return (interactionLayerPriority.length - layerIndex) * 1_000_000;
}

function getInteractionLayerScore(
  hit: THREE.Intersection,
  interactionLayerPriority: readonly ViewerInteractiveLayer[] | undefined,
): number {
  const renderOrderScore = getEffectiveRenderOrder(hit.object);
  const layerPriorityScore = getInteractionLayerPriorityScore(hit, interactionLayerPriority);
  const helperBias = layerPriorityScore === 0 && isSelectableHelperObject(hit.object) ? 100_000 : 0;
  const overlayBias = hasOverlayPresentation(hit.object) ? 10_000 : 0;

  return layerPriorityScore + helperBias + overlayBias + renderOrderScore;
}

function isSelectableHelperHit(hit: THREE.Intersection): boolean {
  return isSelectableHelperObject(hit.object);
}

function shouldYieldHelperHit(
  helperHit: THREE.Intersection,
  geometryHit: THREE.Intersection,
): boolean {
  if (!isSelectableHelperHit(helperHit) || isSelectableHelperHit(geometryHit)) {
    return false;
  }

  if (hasOverlayPresentation(helperHit.object)) {
    return false;
  }

  return geometryHit.distance + HIDDEN_HELPER_DISTANCE_EPSILON < helperHit.distance;
}

function sortByInteractionPriority(
  hits: THREE.Intersection[],
  interactionLayerPriority: readonly ViewerInteractiveLayer[] | undefined,
): THREE.Intersection[] {
  return hits.sort((left, right) => {
    const leftIsHelper = isSelectableHelperHit(left);
    const rightIsHelper = isSelectableHelperHit(right);

    if (leftIsHelper !== rightIsHelper) {
      const helperHit = leftIsHelper ? left : right;
      const geometryHit = leftIsHelper ? right : left;
      if (shouldYieldHelperHit(helperHit, geometryHit)) {
        return leftIsHelper ? 1 : -1;
      }
      return leftIsHelper ? -1 : 1;
    }

    if (
      !leftIsHelper &&
      !rightIsHelper &&
      Math.abs(left.distance - right.distance) > GEOMETRY_DISTANCE_TIE_EPSILON
    ) {
      return left.distance - right.distance;
    }

    const leftScore = getInteractionLayerScore(left, interactionLayerPriority);
    const rightScore = getInteractionLayerScore(right, interactionLayerPriority);

    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }

    if (left.distance !== right.distance) {
      return left.distance - right.distance;
    }

    return left.object.id - right.object.id;
  });
}

function matchesIntersectionMode(hit: THREE.Intersection, mode: PickTargetMode): boolean {
  if (isGizmoObject(hit.object) || isInternalHelperObject(hit.object)) return false;
  if (!isVisibleInHierarchy(hit.object)) return false;
  if (
    (hit.object as THREE.Mesh).isMesh &&
    !hasPickableMaterial((hit.object as THREE.Mesh).material)
  ) {
    return false;
  }
  if (mode === 'all') return true;

  const isCollision = isCollisionPickObject(hit.object);
  return mode === 'collision' ? isCollision : !isCollision;
}

export function collectPickTargets(
  linkMeshMap: Map<string, THREE.Mesh[]>,
  mode: PickTargetMode,
  root?: THREE.Object3D | null,
): THREE.Object3D[] {
  const targets: THREE.Object3D[] = [];
  const seen = new Set<number>();

  linkMeshMap.forEach((meshes, key) => {
    if (!matchesMode(key, mode)) return;

    meshes.forEach((mesh) => {
      if (seen.has(mesh.id)) return;
      if (!mesh.geometry) return;
      if (!isPickableMeshObject(mesh)) return;

      seen.add(mesh.id);
      targets.push(mesh);
    });
  });

  if (root && mode !== 'collision') {
    collectMjcfTendonPickTargets(root, seen, targets);
  }

  return targets;
}

export function collectSelectableHelperTargets(root: THREE.Object3D | null): THREE.Object3D[] {
  if (!root) {
    return [];
  }

  const targets: THREE.Object3D[] = [];
  const seen = new Set<number>();

  root.traverse((child) => {
    if (seen.has(child.id)) return;
    if (!isSelectableHelperObject(child)) return;
    if (!isVisibleInHierarchy(child)) return;
    if (typeof (child as unknown as { raycast?: unknown }).raycast !== 'function') return;

    const material = (child as THREE.Mesh & { material?: THREE.Material | THREE.Material[] })
      .material;
    if (material !== undefined && !hasPickableMaterial(material)) {
      return;
    }

    seen.add(child.id);
    targets.push(child);
  });

  return targets;
}

export function findPickIntersections(
  robot: THREE.Object3D | null,
  raycaster: THREE.Raycaster,
  pickTargets: THREE.Object3D[],
  mode: PickTargetMode,
  fallbackOnMiss = true,
  interactionLayerPriority?: readonly ViewerInteractiveLayer[],
  includeSelectableHelperHits = true,
): THREE.Intersection[] {
  const directHits =
    pickTargets.length > 0
      ? raycaster
          .intersectObjects(pickTargets, false)
          .filter((hit) => matchesIntersectionMode(hit, mode))
      : [];

  if (!robot) {
    return sortByInteractionPriority(directHits, interactionLayerPriority);
  }

  if (includeSelectableHelperHits) {
    const helperHits = raycaster
      .intersectObject(robot, true)
      .filter((hit) => isSelectableHelperObject(hit.object) && matchesIntersectionMode(hit, mode));

    if (helperHits.length > 0) {
      return sortByInteractionPriority(directHits.concat(helperHits), interactionLayerPriority);
    }
  }

  if (directHits.length > 0 || (!fallbackOnMiss && pickTargets.length > 0)) {
    return sortByInteractionPriority(directHits, interactionLayerPriority);
  }

  // Some callers already resolve selectable helpers from a cached target list.
  // Do not turn an interaction miss into a second recursive robot raycast in
  // those paths; the authoritative click handler will still use its direct
  // helper result when one exists.
  if (!includeSelectableHelperHits && !fallbackOnMiss) {
    return sortByInteractionPriority(directHits, interactionLayerPriority);
  }

  return sortByInteractionPriority(
    raycaster.intersectObject(robot, true).filter((hit) => matchesIntersectionMode(hit, mode)),
    interactionLayerPriority,
  );
}
