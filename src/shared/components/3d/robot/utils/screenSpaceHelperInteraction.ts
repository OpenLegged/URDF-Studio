import * as THREE from 'three';

import type { ViewerHelperKind, ViewerInteractiveLayer } from '@/shared/components/3d/robot/types';
import type { RegressionProjectionCanvasRect } from '@/shared/components/3d/robot/utils/regressionProjectionTargets';
import type { ResolvedHoverInteractionCandidate } from '@/shared/components/3d/robot/utils/hoverInteractionResolution';
import { collectProjectedInteractionCandidateMatches } from '@/shared/components/3d/robot/utils/regressionProjectionTargets';
import { resolveInteractionSelectionHit } from '@/shared/components/3d/robot/utils/selectionTargets';

const DEFAULT_HELPER_PADDING_PX = 6;
const MIN_HELPER_HALF_EXTENT_PX = 6;

interface ProjectedHelperSelection {
  type: 'link' | 'joint';
  id: string;
  helperKind: ViewerHelperKind;
  linkObject?: THREE.Object3D;
  highlightTarget?: THREE.Object3D;
}

export interface ProjectedHelperInteractionTarget {
  type: 'link' | 'joint';
  id: string;
  helperKind: ViewerHelperKind;
  layer: ViewerInteractiveLayer;
  clientX: number;
  clientY: number;
  projectedWidth: number;
  projectedHeight: number;
  projectedArea: number;
  averageDepth: number;
  sourceName: string | null;
  object: THREE.Object3D;
  linkObject?: THREE.Object3D;
  highlightTarget?: THREE.Object3D;
}

export interface ResolveScreenSpaceHelperInteractionOptions {
  pointerClientX: number;
  pointerClientY: number;
  projectedHelpers: readonly ProjectedHelperInteractionTarget[];
  interactionLayerPriority?: readonly ViewerInteractiveLayer[];
}

function isHelperProjectionRoot(object: THREE.Object3D): boolean {
  const explicitHelperKind = object.userData?.viewerHelperKind;
  return (
    explicitHelperKind === 'ik-handle' ||
    explicitHelperKind === 'center-of-mass' ||
    explicitHelperKind === 'inertia' ||
    explicitHelperKind === 'origin-axes' ||
    explicitHelperKind === 'joint-axis' ||
    object.name === '__ik_handle__' ||
    object.name === '__com_visual__' ||
    object.name === '__inertia_box__' ||
    object.name === '__origin_axes__' ||
    object.name === '__joint_axis__' ||
    object.name === '__joint_axis_helper__'
  );
}

function resolveHelperLayer(helperKind: ViewerHelperKind): ViewerInteractiveLayer {
  switch (helperKind) {
    case 'ik-handle':
      return 'ik-handle';
    case 'origin-axes':
      return 'origin-axes';
    case 'joint-axis':
      return 'joint-axis';
    case 'center-of-mass':
      return 'center-of-mass';
    case 'inertia':
    default:
      return 'inertia';
  }
}

function getInteractionLayerPriorityScore(
  layer: ViewerInteractiveLayer,
  interactionLayerPriority: readonly ViewerInteractiveLayer[] | undefined,
): number {
  if (!interactionLayerPriority || interactionLayerPriority.length === 0) {
    return 0;
  }

  const layerIndex = interactionLayerPriority.indexOf(layer);
  if (layerIndex === -1) {
    return 0;
  }

  return (interactionLayerPriority.length - layerIndex) * 1_000_000;
}

function getHelperPaddingPx(helperKind: ViewerHelperKind): number {
  if (helperKind === 'joint-axis') {
    return DEFAULT_HELPER_PADDING_PX;
  }

  if (helperKind === 'origin-axes') {
    return 0;
  }

  return 4;
}

function supportsScreenSpaceHelperFallback(helperKind: ViewerHelperKind): boolean {
  // Inertia helpers already render large pickable solids, so expanding their
  // footprint in screen space makes hover/click trigger far outside what is
  // actually visible.
  if (helperKind === 'inertia' || helperKind === 'origin-axes') {
    return false;
  }

  return true;
}

function getMinimumHelperHalfExtentPx(helperKind: ViewerHelperKind): number {
  if (helperKind === 'origin-axes') {
    return 0;
  }

  return MIN_HELPER_HALF_EXTENT_PX;
}

function getDistanceToExpandedRect(
  pointerClientX: number,
  pointerClientY: number,
  target: ProjectedHelperInteractionTarget,
): number {
  const halfWidth =
    Math.max(target.projectedWidth * 0.5, getMinimumHelperHalfExtentPx(target.helperKind)) +
    getHelperPaddingPx(target.helperKind);
  const halfHeight =
    Math.max(target.projectedHeight * 0.5, getMinimumHelperHalfExtentPx(target.helperKind)) +
    getHelperPaddingPx(target.helperKind);
  const dx = Math.max(Math.abs(pointerClientX - target.clientX) - halfWidth, 0);
  const dy = Math.max(Math.abs(pointerClientY - target.clientY) - halfHeight, 0);

  return Math.hypot(dx, dy);
}

export function collectProjectedHelperInteractionTargets(options: {
  robot: THREE.Object3D | null;
  camera: THREE.Camera | null | undefined;
  canvasRect: RegressionProjectionCanvasRect;
}): ProjectedHelperInteractionTarget[] {
  const { robot, camera, canvasRect } = options;
  if (!robot || !camera) {
    return [];
  }

  const candidates: Array<{
    object: THREE.Object3D;
    selection: ProjectedHelperSelection;
  }> = [];

  robot.traverseVisible((object) => {
    if (!isHelperProjectionRoot(object)) {
      return;
    }

    const resolved = resolveInteractionSelectionHit(robot, object);
    if (
      !resolved ||
      resolved.targetKind !== 'helper' ||
      resolved.type === 'tendon' ||
      !resolved.helperKind
    ) {
      return;
    }

    candidates.push({
      object,
      selection: {
        type: resolved.type,
        id: resolved.id,
        helperKind: resolved.helperKind,
        linkObject: resolved.linkObject,
        highlightTarget: resolved.highlightTarget ?? object,
      },
    });
  });

  return collectProjectedInteractionCandidateMatches({
    camera,
    canvasRect,
    candidates,
  }).map((candidate) => ({
    type: candidate.selection.type,
    id: candidate.selection.id,
    helperKind: candidate.selection.helperKind,
    layer: resolveHelperLayer(candidate.selection.helperKind),
    clientX: candidate.clientX,
    clientY: candidate.clientY,
    projectedWidth: candidate.projectedWidth,
    projectedHeight: candidate.projectedHeight,
    projectedArea: candidate.projectedArea,
    averageDepth: candidate.averageDepth,
    sourceName: candidate.sourceName,
    object: candidate.object,
    linkObject: candidate.selection.linkObject,
    highlightTarget: candidate.selection.highlightTarget,
  }));
}

export function resolveScreenSpaceHelperInteraction({
  pointerClientX,
  pointerClientY,
  projectedHelpers,
  interactionLayerPriority,
}: ResolveScreenSpaceHelperInteractionOptions): ResolvedHoverInteractionCandidate | null {
  let bestMatch:
    | (ProjectedHelperInteractionTarget & {
        edgeDistance: number;
        centerDistance: number;
        layerPriorityScore: number;
      })
    | null = null;

  for (const helperTarget of projectedHelpers) {
    if (!supportsScreenSpaceHelperFallback(helperTarget.helperKind)) {
      continue;
    }

    const edgeDistance = getDistanceToExpandedRect(pointerClientX, pointerClientY, helperTarget);
    if (edgeDistance > 0) {
      continue;
    }

    const centerDistance = Math.hypot(
      pointerClientX - helperTarget.clientX,
      pointerClientY - helperTarget.clientY,
    );
    const layerPriorityScore = getInteractionLayerPriorityScore(
      helperTarget.layer,
      interactionLayerPriority,
    );
    const nextMatch = {
      ...helperTarget,
      edgeDistance,
      centerDistance,
      layerPriorityScore,
    };

    if (!bestMatch) {
      bestMatch = nextMatch;
      continue;
    }

    if (nextMatch.layerPriorityScore !== bestMatch.layerPriorityScore) {
      if (nextMatch.layerPriorityScore > bestMatch.layerPriorityScore) {
        bestMatch = nextMatch;
      }
      continue;
    }

    if (nextMatch.centerDistance !== bestMatch.centerDistance) {
      if (nextMatch.centerDistance < bestMatch.centerDistance) {
        bestMatch = nextMatch;
      }
      continue;
    }

    if (nextMatch.averageDepth !== bestMatch.averageDepth) {
      if (nextMatch.averageDepth < bestMatch.averageDepth) {
        bestMatch = nextMatch;
      }
      continue;
    }

    if (nextMatch.projectedArea > bestMatch.projectedArea) {
      bestMatch = nextMatch;
    }
  }

  if (!bestMatch) {
    return null;
  }

  return {
    type: bestMatch.type,
    id: bestMatch.id,
    targetKind: 'helper',
    helperKind: bestMatch.helperKind,
    linkObject: bestMatch.linkObject,
    highlightTarget: bestMatch.highlightTarget ?? bestMatch.object,
    distance: 0,
    screenSpaceProjected: true,
  };
}
