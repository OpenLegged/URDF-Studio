import * as THREE from 'three';

import {
  detectPlanarFaceRegion,
  type PlanarFaceRegionOptions,
} from './planarFaceRegion.ts';

export { kasaCircleFit } from './planarFaceRegion.ts';

export interface CircleFitResult {
  center: THREE.Vector3;
  normal: THREE.Vector3;
  radius: number;
  rmsRatio: number;
  confidence: number;
}

export interface CircleFaceDetectOptions {
  coplanarCosThreshold?: number;
  maxFaces?: number;
  minBoundaryVertices?: number;
  maxRmsRatio?: number;
  planeDistanceTolerance?: number;
  weldTolerance?: number;
}

/**
 * Backward-compatible single-circle view of the richer planar region detector.
 * The outer boundary wins for circular disks/rings; otherwise the first valid
 * circular hole is returned.
 */
export function detectCircleFaceFromHit(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
  options?: CircleFaceDetectOptions,
): CircleFitResult | null {
  const regionOptions: PlanarFaceRegionOptions = {
    coplanarCosThreshold: options?.coplanarCosThreshold,
    maxFaces: options?.maxFaces,
    minBoundaryVertices: options?.minBoundaryVertices,
    maxCircleRmsRatio: options?.maxRmsRatio,
    planeDistanceTolerance: options?.planeDistanceTolerance,
    weldTolerance: options?.weldTolerance,
  };
  const region = detectPlanarFaceRegion(geometry, faceIndex, regionOptions);
  const candidate = region?.circleCandidates.find((circle) => !circle.isHole)
    ?? region?.circleCandidates[0];
  if (!candidate) {
    return null;
  }
  return {
    center: candidate.center.clone(),
    normal: candidate.normal.clone(),
    radius: candidate.radius,
    rmsRatio: candidate.rmsRatio,
    confidence: candidate.confidence,
  };
}
