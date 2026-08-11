import type * as THREE from 'three';

import type { ViewerInteractiveLayer } from '../types';
import type { ResolvedUsdHelperHit } from './usdInteractionPicking';
import type { ViewerRobotDataResolution } from '@/lib/robot-parser/usd/viewerRobotData';
import {
  collectProjectedInteractionCandidateMatches,
  type RegressionProjectionCanvasRect,
} from './regressionProjectionTargets';
import { resolveScreenSpaceHelperInteraction } from './screenSpaceHelperInteraction';
import { resolveUsdHelperHit } from './usdInteractionPicking';

function resolveHelperLayer(
  helperKind: ResolvedUsdHelperHit['helperKind'],
): ViewerInteractiveLayer {
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

export function resolveScreenSpaceUsdHelperHit(options: {
  pointerClientX: number;
  pointerClientY: number;
  helperTargets: readonly THREE.Object3D[];
  resolution: ViewerRobotDataResolution | null | undefined;
  camera: THREE.Camera | null | undefined;
  canvasRect: RegressionProjectionCanvasRect;
  interactionLayerPriority?: readonly ViewerInteractiveLayer[];
}): ResolvedUsdHelperHit | null {
  const {
    pointerClientX,
    pointerClientY,
    helperTargets,
    resolution,
    camera,
    canvasRect,
    interactionLayerPriority,
  } = options;

  if (!resolution || !camera || helperTargets.length <= 0) {
    return null;
  }

  const projectedHelpers = collectProjectedInteractionCandidateMatches({
    camera,
    canvasRect,
    candidates: helperTargets.flatMap((object) => {
      const selection = resolveUsdHelperHit(object, resolution);
      if (!selection) {
        return [];
      }

      return [
        {
          object,
          selection: {
            type: selection.type,
            id: selection.id,
            helperKind: selection.helperKind,
          },
        },
      ];
    }),
  }).map((candidate) => ({
    type: candidate.selection.type,
    id: candidate.selection.id,
    helperKind: candidate.selection.helperKind!,
    layer: resolveHelperLayer(candidate.selection.helperKind!),
    clientX: candidate.clientX,
    clientY: candidate.clientY,
    projectedWidth: candidate.projectedWidth,
    projectedHeight: candidate.projectedHeight,
    projectedArea: candidate.projectedArea,
    averageDepth: candidate.averageDepth,
    sourceName: candidate.sourceName,
    object: candidate.object,
    highlightTarget: candidate.object,
  }));

  if (projectedHelpers.length <= 0) {
    return null;
  }

  const resolvedInteraction = resolveScreenSpaceHelperInteraction({
    pointerClientX,
    pointerClientY,
    projectedHelpers,
    interactionLayerPriority,
  });

  if (!resolvedInteraction?.helperKind) {
    return null;
  }

  if (resolvedInteraction.type !== 'link' && resolvedInteraction.type !== 'joint') {
    return null;
  }

  return {
    type: resolvedInteraction.type,
    id: resolvedInteraction.id,
    helperKind: resolvedInteraction.helperKind,
    layer: resolveHelperLayer(resolvedInteraction.helperKind),
  };
}
