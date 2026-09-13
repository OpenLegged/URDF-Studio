import * as THREE from 'three';
import type { ViewerRobotDataResolution } from '@/lib/robot-parser/usd/viewerRobotData';
import type { ViewerInteractiveLayer } from '../../types.ts';
import type {
  UsdOffscreenInteractionState,
  UsdOffscreenMeshRole as UsdMeshRole,
  UsdOffscreenRuntimeMeshMeta as RuntimeMeshMeta,
} from '../../utils/usdOffscreenInteractionState.ts';
import {
  hasPickableMaterial,
  isInternalHelperObject,
  isVisibleInHierarchy,
} from '../../utils/pickFilter.ts';
import {
  resolveUsdHelperHit,
  sortUsdInteractionCandidates,
  type ResolvedUsdHelperHit,
} from '../../utils/usdInteractionPicking.ts';
import { resolveScreenSpaceUsdHelperHit } from '../../utils/usdScreenSpaceHelperInteraction.ts';

export type RuntimeInteractionTarget =
  | { kind: 'geometry'; meta: RuntimeMeshMeta }
  | { kind: 'helper'; selection: ResolvedUsdHelperHit };

function isPickableGeometryObject(object: THREE.Object3D): boolean {
  if (object.visible === false || isInternalHelperObject(object) || !isVisibleInHierarchy(object)) {
    return false;
  }
  return !(object as THREE.Mesh).isMesh || hasPickableMaterial((object as THREE.Mesh).material);
}

/** Resolves a target against one explicit scene projection; never emits selection or hover. */
export function pickUsdWorkerInteractionTarget({
  localX,
  localY,
  camera,
  viewport,
  index,
  resolution,
  interactionLayerPriority,
  raycaster,
  pointer,
}: {
  localX: number;
  localY: number;
  camera: THREE.PerspectiveCamera;
  viewport: { width: number; height: number };
  index: Pick<
    UsdOffscreenInteractionState<unknown>,
    'pickMeshes' | 'helperTargets' | 'meshMetaByObject'
  >;
  resolution: ViewerRobotDataResolution | null;
  interactionLayerPriority: ViewerInteractiveLayer[];
  raycaster: THREE.Raycaster;
  pointer: THREE.Vector2;
}): RuntimeInteractionTarget | null {
  const width = Math.max(1, viewport.width || 1);
  const height = Math.max(1, viewport.height || 1);
  if (localX < 0 || localX > width || localY < 0 || localY > height) {
    return null;
  }

  pointer.set((localX / width) * 2 - 1, -(localY / height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);

  const rawHits = raycaster.intersectObjects(index.pickMeshes, false);
  const geometryCandidates: Array<{
    kind: 'geometry';
    distance: number;
    layer: UsdMeshRole;
    meta: RuntimeMeshMeta;
    object: THREE.Object3D;
  }> = [];

  for (const hit of rawHits) {
    if (!isPickableGeometryObject(hit.object)) {
      continue;
    }

    const meta = index.meshMetaByObject.get(hit.object);
    if (!meta) {
      continue;
    }
    if (meta.role === 'collision' && !Number.isInteger(meta.objectIndex)) {
      continue;
    }

    geometryCandidates.push({
      kind: 'geometry',
      meta,
      layer: meta.role,
      object: hit.object,
      distance: hit.distance,
    });
  }

  const helperCandidates =
    index.helperTargets.length > 0
      ? raycaster.intersectObjects(index.helperTargets, false).flatMap((hit) => {
          const resolvedHelperHit = resolveUsdHelperHit(hit.object, resolution);
          if (!resolvedHelperHit) {
            return [];
          }

          return [
            {
              kind: 'helper' as const,
              distance: hit.distance,
              layer: resolvedHelperHit.layer,
              object: hit.object,
              selection: resolvedHelperHit,
            },
          ];
        })
      : [];

  const exactCandidates = sortUsdInteractionCandidates(
    [...geometryCandidates, ...helperCandidates],
    interactionLayerPriority,
  );
  const exactCandidate = exactCandidates[0] ?? null;
  if (exactCandidate?.kind === 'helper') {
    return {
      kind: 'helper',
      selection: exactCandidate.selection,
    };
  }

  if (exactCandidate?.kind === 'geometry') {
    return {
      kind: 'geometry',
      meta: exactCandidate.meta,
    };
  }

  const screenSpaceHelperHit = resolveScreenSpaceUsdHelperHit({
    pointerClientX: localX,
    pointerClientY: localY,
    helperTargets: index.helperTargets,
    resolution: resolution,
    camera,
    canvasRect: {
      x: 0,
      y: 0,
      width: width,
      height: height,
    },
    interactionLayerPriority,
  });
  if (screenSpaceHelperHit) {
    return {
      kind: 'helper',
      selection: screenSpaceHelperHit,
    };
  }

  return null;
}
