import type * as THREE from 'three';

import type { ViewerInteractiveLayer } from '@/shared/components/3d/robot/types';
import type { ResolvedInteractionSelectionHit } from '@/shared/components/3d/robot/utils/selectionTargets';
import { hasOverlayPresentation, isPickOnlyMesh } from '@/shared/components/3d/robot/utils/pickFilter';
import { isHoverSupportSurface } from '@/shared/utils/three/hoverSupportSurface';

export interface ResolvedHoverInteractionCandidate extends ResolvedInteractionSelectionHit {
  distance: number;
  screenSpaceProjected?: boolean;
}

export interface HoverInteractionResolution {
  primaryInteraction: ResolvedHoverInteractionCandidate | null;
}

const SUPPORT_SURFACE_HOVER_PENALTY = 10_000_000;
const SUPPORT_SURFACE_FOREGROUND_DISTANCE_EPSILON = 1e-3;
const GEOMETRY_DISTANCE_TIE_EPSILON = 1e-3;
const HIDDEN_HELPER_DISTANCE_EPSILON = 1e-3;

function resolveCandidateLayer(
  candidate: ResolvedHoverInteractionCandidate,
): ViewerInteractiveLayer | null {
  if (candidate.targetKind === 'helper') {
    switch (candidate.helperKind) {
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
        return null;
    }
  }

  if (candidate.subType === 'collision') {
    return 'collision';
  }

  if (candidate.subType === 'visual') {
    return 'visual';
  }

  return null;
}

function getCandidateObject(candidate: ResolvedHoverInteractionCandidate): THREE.Object3D | null {
  return candidate.highlightTarget ?? candidate.linkObject ?? null;
}

function getStableObjectId(candidate: ResolvedHoverInteractionCandidate): number {
  return getCandidateObject(candidate)?.id ?? 0;
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

function getInteractionLayerPriorityScore(
  layer: ViewerInteractiveLayer | null,
  interactionLayerPriority: readonly ViewerInteractiveLayer[] | undefined,
): number {
  if (!layer || !interactionLayerPriority || interactionLayerPriority.length === 0) {
    return 0;
  }

  const layerIndex = interactionLayerPriority.indexOf(layer);
  if (layerIndex === -1) {
    return 0;
  }

  return (interactionLayerPriority.length - layerIndex) * 1_000_000;
}

function getInteractionScore(
  candidate: ResolvedHoverInteractionCandidate,
  interactionLayerPriority: readonly ViewerInteractiveLayer[] | undefined,
): number {
  const interactionLayer = resolveCandidateLayer(candidate);
  const candidateObject = getCandidateObject(candidate);
  const layerPriorityScore = getInteractionLayerPriorityScore(
    interactionLayer,
    interactionLayerPriority,
  );
  const helperBias = layerPriorityScore === 0 && candidate.targetKind === 'helper' ? 100_000 : 0;
  const overlayBias = hasOverlayPresentation(candidateObject) ? 10_000 : 0;

  return layerPriorityScore + helperBias + overlayBias + getEffectiveRenderOrder(candidateObject);
}

function isSupportSurfaceGeometryCandidate(candidate: ResolvedHoverInteractionCandidate): boolean {
  return (
    candidate.targetKind === 'geometry' && isHoverSupportSurface(getCandidateObject(candidate))
  );
}

function shouldDeprioritizeSupportSurfaceCandidate(
  candidate: ResolvedHoverInteractionCandidate,
  candidates: readonly ResolvedHoverInteractionCandidate[],
): boolean {
  if (!isSupportSurfaceGeometryCandidate(candidate)) {
    return false;
  }

  return candidates.some(
    (otherCandidate) =>
      otherCandidate !== candidate &&
      !isSupportSurfaceGeometryCandidate(otherCandidate) &&
      otherCandidate.distance + SUPPORT_SURFACE_FOREGROUND_DISTANCE_EPSILON < candidate.distance,
  );
}

function isHelperCandidate(candidate: ResolvedHoverInteractionCandidate): boolean {
  return candidate.targetKind === 'helper';
}

function shouldPreferDirectManipulationHelper(
  helperCandidate: ResolvedHoverInteractionCandidate,
): boolean {
  if (
    helperCandidate.screenSpaceProjected ||
    (helperCandidate.helperKind !== 'origin-axes' && helperCandidate.helperKind !== 'joint-axis')
  ) {
    return false;
  }

  return !isPickOnlyMesh(getCandidateObject(helperCandidate));
}

function shouldYieldHelperToGeometry(
  helperCandidate: ResolvedHoverInteractionCandidate,
  geometryCandidate: ResolvedHoverInteractionCandidate,
): boolean {
  if (!isHelperCandidate(helperCandidate) || isHelperCandidate(geometryCandidate)) {
    return false;
  }

  const helperObject = getCandidateObject(helperCandidate);

  if (shouldPreferDirectManipulationHelper(helperCandidate)) {
    return false;
  }

  if (helperCandidate.screenSpaceProjected) {
    // Overlay helpers rendered on top should not yield to geometry behind
    // them, even when caught by screen-space fallback.
    if (hasOverlayPresentation(helperObject)) {
      return false;
    }
    return true;
  }

  if (hasOverlayPresentation(helperObject)) {
    return false;
  }

  return geometryCandidate.distance + HIDDEN_HELPER_DISTANCE_EPSILON < helperCandidate.distance;
}

function getCandidateSortDistance(
  candidate: ResolvedHoverInteractionCandidate,
  candidates: readonly ResolvedHoverInteractionCandidate[],
): number {
  if (shouldDeprioritizeSupportSurfaceCandidate(candidate, candidates)) {
    return candidate.distance + SUPPORT_SURFACE_HOVER_PENALTY;
  }

  return candidate.distance;
}

export function resolveHoverInteractionResolution(
  candidates: ResolvedHoverInteractionCandidate[],
  interactionLayerPriority?: readonly ViewerInteractiveLayer[],
): HoverInteractionResolution {
  const sortedCandidates = [...candidates].sort((left, right) => {
    if (left.screenSpaceProjected !== right.screenSpaceProjected) {
      const projectedCandidate = left.screenSpaceProjected ? left : right;
      const otherCandidate = left.screenSpaceProjected ? right : left;

      // Overlay helpers (e.g., center-of-mass) are rendered on top of
      // geometry and should win even when caught by screen-space fallback,
      // because the user clicks what they see rendered in front.
      if (
        isHelperCandidate(projectedCandidate) &&
        hasOverlayPresentation(getCandidateObject(projectedCandidate))
      ) {
        return left.screenSpaceProjected ? -1 : 1;
      }

      if (otherCandidate.targetKind === 'geometry') {
        return left.screenSpaceProjected ? 1 : -1;
      }
      return left.screenSpaceProjected ? -1 : 1;
    }

    const leftIsHelper = isHelperCandidate(left);
    const rightIsHelper = isHelperCandidate(right);

    if (leftIsHelper !== rightIsHelper) {
      const helperCandidate = leftIsHelper ? left : right;
      const geometryCandidate = leftIsHelper ? right : left;
      if (shouldYieldHelperToGeometry(helperCandidate, geometryCandidate)) {
        return leftIsHelper ? 1 : -1;
      }
      return leftIsHelper ? -1 : 1;
    }

    const leftSortDistance = getCandidateSortDistance(left, candidates);
    const rightSortDistance = getCandidateSortDistance(right, candidates);

    if (
      !leftIsHelper &&
      !rightIsHelper &&
      Math.abs(leftSortDistance - rightSortDistance) > GEOMETRY_DISTANCE_TIE_EPSILON
    ) {
      return leftSortDistance - rightSortDistance;
    }

    const leftScore = getInteractionScore(left, interactionLayerPriority);
    const rightScore = getInteractionScore(right, interactionLayerPriority);

    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }

    if (leftSortDistance !== rightSortDistance) {
      return leftSortDistance - rightSortDistance;
    }

    if (left.distance !== right.distance) {
      return left.distance - right.distance;
    }

    return getStableObjectId(left) - getStableObjectId(right);
  });

  return {
    primaryInteraction: sortedCandidates[0] ?? null,
  };
}
