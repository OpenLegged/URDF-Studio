import * as THREE from 'three';
import type { UrdfJoint, UrdfLink } from '@/types';
import type {
  ToolMode,
  ViewerInteractiveLayer,
  ViewerPaintFaceHit,
} from '../types';
import { resolveDirectHelperInteraction } from './directHelperInteraction';
import { isRuntimeInteractionEditorLocked } from './editorInteractionLock';
import {
  resolveHoverInteractionResolution,
  type ResolvedHoverInteractionCandidate,
} from './hoverInteractionResolution';
import { findPickIntersections } from './pickTargets';
import {
  collectProjectedHelperInteractionTargets,
  resolveScreenSpaceHelperInteraction,
} from './screenSpaceHelperInteraction';
import { resolveInteractionSelectionHit } from './selectionTargets';

export type PointerDownHitResolution =
  | { kind: 'miss' }
  | { kind: 'paint'; hit: ViewerPaintFaceHit }
  | { kind: 'selection'; hit: ResolvedHoverInteractionCandidate };

interface ResolvePointerDownHitOptions {
  robot: THREE.Object3D;
  camera: THREE.Camera;
  canvas: HTMLCanvasElement;
  raycaster: THREE.Raycaster;
  pickTargets: THREE.Object3D[];
  helperTargets: THREE.Object3D[];
  interactionLayerPriority: readonly ViewerInteractiveLayer[];
  robotLinks: Record<string, UrdfLink> | undefined;
  robotJoints: Record<string, UrdfJoint> | undefined;
  toolMode: ToolMode;
  rayIntersectsBoundingBox: (raycaster: THREE.Raycaster, forceRefresh?: boolean) => boolean;
  pointerClientX: number;
  pointerClientY: number;
}

function resolveHelperHit({
  robot,
  camera,
  canvas,
  raycaster,
  helperTargets,
  interactionLayerPriority,
  robotLinks,
  robotJoints,
  pointerClientX,
  pointerClientY,
}: Omit<ResolvePointerDownHitOptions, 'pickTargets' | 'toolMode' | 'rayIntersectsBoundingBox'>) {
  const directHelperInteraction = resolveDirectHelperInteraction({
    robot,
    raycaster,
    helperTargets,
    interactionLayerPriority,
  });
  const projectedHelperInteraction = resolveScreenSpaceHelperInteraction({
    pointerClientX,
    pointerClientY,
    projectedHelpers: collectProjectedHelperInteractionTargets({
      robot,
      camera,
      canvasRect: canvas.getBoundingClientRect(),
    }),
    interactionLayerPriority,
  });
  const helperCandidates = [directHelperInteraction, projectedHelperInteraction].filter(
    (candidate): candidate is ResolvedHoverInteractionCandidate =>
      candidate !== null &&
      !isRuntimeInteractionEditorLocked(candidate, robotLinks, robotJoints),
  );

  return helperCandidates.length > 0
    ? resolveHoverInteractionResolution(helperCandidates, interactionLayerPriority)
        .primaryInteraction
    : null;
}

/** Resolves one pointer-down raycast without mutating selection or drag state. */
export function resolvePointerDownHit(
  options: ResolvePointerDownHitOptions,
): PointerDownHitResolution {
  const {
    robot,
    raycaster,
    pickTargets,
    interactionLayerPriority,
    robotLinks,
    robotJoints,
    toolMode,
    rayIntersectsBoundingBox,
  } = options;

  if (pickTargets.length > 0 && !rayIntersectsBoundingBox(raycaster, true)) {
    if (toolMode === 'paint') {
      return { kind: 'miss' };
    }
    const helperHit = resolveHelperHit(options);
    return helperHit ? { kind: 'selection', hit: helperHit } : { kind: 'miss' };
  }

  const intersections = findPickIntersections(
    robot,
    raycaster,
    pickTargets,
    'all',
    false,
    interactionLayerPriority,
    false,
  );
  if (toolMode === 'paint') {
    const paintIntersection = intersections.find((intersection) => {
      if (intersection.faceIndex === undefined || intersection.faceIndex === null) {
        return false;
      }
      if (!(intersection.object instanceof THREE.Mesh)) {
        return false;
      }
      const selectionHit = resolveInteractionSelectionHit(robot, intersection.object);
      return (
        selectionHit?.type === 'link' &&
        selectionHit.subType === 'visual' &&
        !isRuntimeInteractionEditorLocked(selectionHit, robotLinks, robotJoints)
      );
    });
    if (
      !paintIntersection ||
      !(paintIntersection.object instanceof THREE.Mesh) ||
      paintIntersection.faceIndex === undefined ||
      paintIntersection.faceIndex === null
    ) {
      return { kind: 'miss' };
    }
    const paintSelectionHit = resolveInteractionSelectionHit(robot, paintIntersection.object);
    if (!paintSelectionHit?.linkId) {
      return { kind: 'miss' };
    }
    return {
      kind: 'paint',
      hit: {
        linkId: paintSelectionHit.linkId,
        objectIndex: paintSelectionHit.objectIndex ?? 0,
        mesh: paintIntersection.object,
        faceIndex: paintIntersection.faceIndex,
      },
    };
  }

  const resolvedCandidates = intersections.reduce<ResolvedHoverInteractionCandidate[]>(
    (candidates, rayHit) => {
      const selectionHit = resolveInteractionSelectionHit(robot, rayHit.object);
      if (selectionHit && !isRuntimeInteractionEditorLocked(selectionHit, robotLinks, robotJoints)) {
        candidates.push({ ...selectionHit, distance: rayHit.distance });
      }
      return candidates;
    },
    [],
  );
  const helperHit = resolveHelperHit(options);
  const { primaryInteraction } = resolveHoverInteractionResolution(
    helperHit ? resolvedCandidates.concat(helperHit) : resolvedCandidates,
    interactionLayerPriority,
  );

  return primaryInteraction
    ? { kind: 'selection', hit: primaryInteraction }
    : { kind: 'miss' };
}
