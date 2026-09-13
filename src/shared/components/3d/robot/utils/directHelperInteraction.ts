import * as THREE from 'three';

import type { ViewerInteractiveLayer } from '@/shared/components/3d/robot/types';
import {
  resolveHoverInteractionResolution,
  type ResolvedHoverInteractionCandidate,
} from '@/shared/components/3d/robot/utils/hoverInteractionResolution';
import { resolveInteractionSelectionHit } from '@/shared/components/3d/robot/utils/selectionTargets';

export interface ResolveDirectHelperInteractionOptions {
  robot: THREE.Object3D | null;
  raycaster: THREE.Raycaster;
  helperTargets: THREE.Object3D[];
  interactionLayerPriority?: readonly ViewerInteractiveLayer[];
}

export function resolveDirectHelperInteraction({
  robot,
  raycaster,
  helperTargets,
  interactionLayerPriority,
}: ResolveDirectHelperInteractionOptions): ResolvedHoverInteractionCandidate | null {
  if (!robot || helperTargets.length === 0) {
    return null;
  }

  const resolvedCandidates = raycaster
    .intersectObjects(helperTargets, false)
    .reduce<ResolvedHoverInteractionCandidate[]>((candidates, hit) => {
      const resolved = resolveInteractionSelectionHit(robot, hit.object);
      if (!resolved || resolved.targetKind !== 'helper') {
        return candidates;
      }

      candidates.push({
        ...resolved,
        distance: hit.distance,
      });
      return candidates;
    }, []);

  if (resolvedCandidates.length === 0) {
    return null;
  }

  const { primaryInteraction } = resolveHoverInteractionResolution(
    resolvedCandidates,
    interactionLayerPriority,
  );
  return primaryInteraction?.targetKind === 'helper' ? primaryInteraction : null;
}
