import * as THREE from 'three';

import type { InteractionHelperKind } from '@/types/index';
import type { RegressionProjectedInteractionTarget } from '@/shared/debug/regressionState';

export interface RegressionProjectionSelection {
  type: 'link' | 'joint';
  id: string;
  subType?: 'visual' | 'collision';
  objectIndex?: number;
  helperKind?: InteractionHelperKind;
}

export interface RegressionProjectionCandidate {
  object: THREE.Object3D;
  selection: RegressionProjectionSelection;
}

export interface ProjectedInteractionMetrics {
  clientX: number;
  clientY: number;
  projectedWidth: number;
  projectedHeight: number;
  projectedArea: number;
  averageDepth: number;
}

export interface ProjectedInteractionCandidateMatch<
  TSelection extends RegressionProjectionSelection = RegressionProjectionSelection,
> extends ProjectedInteractionMetrics {
  object: THREE.Object3D;
  selection: TSelection;
  targetKind: 'geometry' | 'helper';
  sourceName: string | null;
}

export interface RegressionProjectionCanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const pooledBounds = new THREE.Box3();
const projectedCorners = Array.from({ length: 8 }, () => new THREE.Vector3());
const projectedCorner = new THREE.Vector3();

function isFiniteRect(rect: RegressionProjectionCanvasRect): boolean {
  return Number.isFinite(rect.x)
    && Number.isFinite(rect.y)
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height)
    && rect.width > 0
    && rect.height > 0;
}

function buildSelectionKey(selection: RegressionProjectionSelection): string {
  return [
    selection.type,
    selection.id,
    selection.subType ?? '',
    selection.objectIndex ?? '',
    selection.helperKind ?? '',
  ].join(':');
}

function projectWorldBoundsToCanvas(
  bounds: THREE.Box3,
  camera: THREE.Camera,
  canvasRect: RegressionProjectionCanvasRect,
): ProjectedInteractionMetrics | null {
  const { min, max } = bounds;
  const corners = projectedCorners;
  corners[0].set(min.x, min.y, min.z);
  corners[1].set(min.x, min.y, max.z);
  corners[2].set(min.x, max.y, min.z);
  corners[3].set(min.x, max.y, max.z);
  corners[4].set(max.x, min.y, min.z);
  corners[5].set(max.x, min.y, max.z);
  corners[6].set(max.x, max.y, min.z);
  corners[7].set(max.x, max.y, max.z);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let depthSum = 0;
  let projectedCount = 0;

  for (const corner of corners) {
    projectedCorner.copy(corner).project(camera);
    if (
      !Number.isFinite(projectedCorner.x)
      || !Number.isFinite(projectedCorner.y)
      || !Number.isFinite(projectedCorner.z)
    ) {
      continue;
    }

    const localX = ((projectedCorner.x + 1) * 0.5) * canvasRect.width;
    const localY = ((1 - projectedCorner.y) * 0.5) * canvasRect.height;
    minX = Math.min(minX, localX);
    maxX = Math.max(maxX, localX);
    minY = Math.min(minY, localY);
    maxY = Math.max(maxY, localY);
    depthSum += projectedCorner.z;
    projectedCount += 1;
  }

  if (projectedCount === 0) {
    return null;
  }

  if (maxX < 0 || minX > canvasRect.width || maxY < 0 || minY > canvasRect.height) {
    return null;
  }

  const projectedWidth = Math.max(0, maxX - minX);
  const projectedHeight = Math.max(0, maxY - minY);

  return {
    clientX: canvasRect.x + (minX + maxX) * 0.5,
    clientY: canvasRect.y + (minY + maxY) * 0.5,
    projectedWidth,
    projectedHeight,
    projectedArea: projectedWidth * projectedHeight,
    averageDepth: depthSum / projectedCount,
  };
}

export function collectProjectedInteractionCandidateMatches<
  TSelection extends RegressionProjectionSelection,
>(options: {
  camera: THREE.Camera | null | undefined;
  canvasRect: RegressionProjectionCanvasRect;
  candidates: Iterable<{
    object: THREE.Object3D;
    selection: TSelection;
  }>;
}): ProjectedInteractionCandidateMatch<TSelection>[] {
  const { camera, canvasRect, candidates } = options;
  if (!camera || !isFiniteRect(canvasRect)) {
    return [];
  }

  const bySelectionKey = new Map<string, ProjectedInteractionCandidateMatch<TSelection>>();

  for (const candidate of candidates) {
    if (!candidate?.object || !candidate.selection?.type || !candidate.selection?.id) {
      continue;
    }

    pooledBounds.makeEmpty().setFromObject(candidate.object);
    if (pooledBounds.isEmpty()) {
      continue;
    }

    const projected = projectWorldBoundsToCanvas(pooledBounds, camera, canvasRect);
    if (!projected) {
      continue;
    }

    const nextTarget: ProjectedInteractionCandidateMatch<TSelection> = {
      object: candidate.object,
      selection: candidate.selection,
      targetKind: candidate.selection.helperKind ? 'helper' : 'geometry',
      sourceName: candidate.object.name || null,
      ...projected,
    };

    const key = buildSelectionKey(candidate.selection);
    const previous = bySelectionKey.get(key);
    if (
      !previous
      || nextTarget.projectedArea > previous.projectedArea
      || (
        nextTarget.projectedArea === previous.projectedArea
        && nextTarget.averageDepth < previous.averageDepth
      )
    ) {
      bySelectionKey.set(key, nextTarget);
    }
  }

  return [...bySelectionKey.values()].sort((left, right) => {
    if (left.projectedArea !== right.projectedArea) {
      return right.projectedArea - left.projectedArea;
    }

    if (left.averageDepth !== right.averageDepth) {
      return left.averageDepth - right.averageDepth;
    }

    return left.selection.id.localeCompare(right.selection.id);
  });
}

export function collectRegressionProjectedInteractionTargets(options: {
  camera: THREE.Camera | null | undefined;
  canvasRect: RegressionProjectionCanvasRect;
  candidates: Iterable<RegressionProjectionCandidate>;
}): RegressionProjectedInteractionTarget[] {
  return collectProjectedInteractionCandidateMatches(options).map((candidate) => ({
    type: candidate.selection.type,
    id: candidate.selection.id,
    subType: candidate.selection.subType,
    objectIndex: candidate.selection.objectIndex,
    helperKind: candidate.selection.helperKind,
    targetKind: candidate.targetKind,
    sourceName: candidate.sourceName,
    clientX: candidate.clientX,
    clientY: candidate.clientY,
    projectedWidth: candidate.projectedWidth,
    projectedHeight: candidate.projectedHeight,
    projectedArea: candidate.projectedArea,
    averageDepth: candidate.averageDepth,
  }));
}
