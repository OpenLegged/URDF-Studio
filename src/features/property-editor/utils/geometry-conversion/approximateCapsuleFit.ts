import * as THREE from 'three';

import { computeCapsuleVolume, type Point3 } from '@/core/geometry/primitiveGeometry';
import { computePrincipalAxes, type PrimitiveFit } from './primitiveFit';

const MAX_CAPSULE_SEGMENTS = 3;
const MIN_POINTS_PER_SEGMENT = 12;
const BODY_RADIUS_QUANTILE = 0.9;
const ERROR_TRIM_QUANTILE = 0.9;
const AXIS_VOLUME_WINDOW_RATIO = 1.05;
const MIN_TOTAL_LENGTH_TO_SPLIT = 0.25;
const MIN_SEGMENT_SPAN_RATIO = 0.18;
const MIN_SEGMENT_RADIUS = 0.005;
const SECOND_SEGMENT_ERROR_IMPROVEMENT = 0.25;
const THIRD_SEGMENT_ERROR_IMPROVEMENT = 0.35;
const SECOND_SEGMENT_VOLUME_RATIO = 1.3;
const THIRD_SEGMENT_VOLUME_RATIO = 1.15;
const ERROR_PROFILE_BIN_COUNT = 12;

interface ProjectionFrame {
  axis: THREE.Vector3;
  basisU: THREE.Vector3;
  basisV: THREE.Vector3;
}

interface ProjectedPoint {
  source: Point3;
  t: number;
  u: number;
  v: number;
}

interface EvaluatedCapsuleSegment {
  fit: PrimitiveFit;
  axialSpan: number;
}

interface EvaluatedCapsuleModel {
  normalizedError: number;
  segments: EvaluatedCapsuleSegment[];
  volume: number;
}

export interface ApproximateCapsuleDecomposition {
  normalizedError: number;
  segments: PrimitiveFit[];
}

function quantile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = Math.max(0, Math.min(1, fraction)) * (sorted.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const weight = position - lowerIndex;
  return sorted[lowerIndex]! * (1 - weight) + sorted[upperIndex]! * weight;
}

function createProjectionFrame(axisInput: Point3): ProjectionFrame | null {
  const axis = new THREE.Vector3(axisInput.x, axisInput.y, axisInput.z);
  if (axis.lengthSq() <= 1e-12) return null;
  axis.normalize();

  const reference =
    Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const basisU = new THREE.Vector3().crossVectors(reference, axis).normalize();
  const basisV = new THREE.Vector3().crossVectors(axis, basisU).normalize();
  if (basisU.lengthSq() <= 1e-12 || basisV.lengthSq() <= 1e-12) return null;

  return { axis, basisU, basisV };
}

function projectPoints(points: Point3[], frame: ProjectionFrame): ProjectedPoint[] {
  return points.map((point) => ({
    source: point,
    t: point.x * frame.axis.x + point.y * frame.axis.y + point.z * frame.axis.z,
    u: point.x * frame.basisU.x + point.y * frame.basisU.y + point.z * frame.basisU.z,
    v: point.x * frame.basisV.x + point.y * frame.basisV.y + point.z * frame.basisV.z,
  }));
}

function optimizeQuantileCenter(points: ProjectedPoint[]): { u: number; v: number } {
  const uValues = points.map((point) => point.u);
  const vValues = points.map((point) => point.v);
  const candidates = [
    {
      u: (Math.min(...uValues) + Math.max(...uValues)) / 2,
      v: (Math.min(...vValues) + Math.max(...vValues)) / 2,
    },
    { u: quantile(uValues, 0.5), v: quantile(vValues, 0.5) },
    {
      u: uValues.reduce((sum, value) => sum + value, 0) / uValues.length,
      v: vValues.reduce((sum, value) => sum + value, 0) / vValues.length,
    },
  ];
  const score = (center: { u: number; v: number }) =>
    quantile(
      points.map((point) => Math.hypot(point.u - center.u, point.v - center.v)),
      BODY_RADIUS_QUANTILE,
    );
  let best = candidates.reduce((currentBest, candidate) =>
    score(candidate) < score(currentBest) ? candidate : currentBest,
  );
  let bestScore = score(best);
  let step =
    Math.max(
      Math.max(...uValues) - Math.min(...uValues),
      Math.max(...vValues) - Math.min(...vValues),
    ) / 4;

  for (let iteration = 0; iteration < 12 && step > 1e-9; iteration += 1) {
    let improved = false;
    for (const deltaU of [-step, 0, step]) {
      for (const deltaV of [-step, 0, step]) {
        const candidate = { u: best.u + deltaU, v: best.v + deltaV };
        const candidateScore = score(candidate);
        if (candidateScore + 1e-10 >= bestScore) continue;
        best = candidate;
        bestScore = candidateScore;
        improved = true;
      }
    }
    if (!improved) step /= 2;
  }

  return best;
}

function fitCapsuleToProjectedPoints(
  points: ProjectedPoint[],
  frame: ProjectionFrame,
): EvaluatedCapsuleSegment | null {
  if (points.length < MIN_POINTS_PER_SEGMENT) return null;

  const center = optimizeQuantileCenter(points);
  const radialDistances = points.map((point) => Math.hypot(point.u - center.u, point.v - center.v));
  const tValues = points.map((point) => point.t);
  const axialSpan = Math.max(...tValues) - Math.min(...tValues);
  const numericalRadius = Math.max(axialSpan * 0.002, 1e-6);
  const coreRadius = Math.max(quantile(radialDistances, BODY_RADIUS_QUANTILE), numericalRadius);
  const coreIndices = radialDistances
    .map((distance, index) => (distance <= coreRadius + 1e-10 ? index : -1))
    .filter((index) => index >= 0);
  if (coreIndices.length === 0) return null;

  const coreTValues = coreIndices.map((index) => tValues[index]!);
  const coreMidpoint = (Math.min(...coreTValues) + Math.max(...coreTValues)) / 2;
  const maximumUsefulRadius = Math.max(
    coreRadius,
    ...coreIndices.map((index) =>
      Math.hypot(radialDistances[index]!, tValues[index]! - coreMidpoint),
    ),
  );

  const evaluateRadius = (radius: number) => {
    let bodyStartUpperBound = Number.NEGATIVE_INFINITY;
    let bodyEndLowerBound = Number.POSITIVE_INFINITY;
    coreIndices.forEach((index) => {
      const radialDistance = radialDistances[index]!;
      const axialSlack = Math.sqrt(Math.max(radius * radius - radialDistance * radialDistance, 0));
      bodyStartUpperBound = Math.max(bodyStartUpperBound, tValues[index]! - axialSlack);
      bodyEndLowerBound = Math.min(bodyEndLowerBound, tValues[index]! + axialSlack);
    });

    const bodyLength = Math.max(bodyStartUpperBound - bodyEndLowerBound, 0);
    const bodyCenter = (bodyStartUpperBound + bodyEndLowerBound) / 2;
    const bodyStart = bodyCenter - bodyLength / 2;
    const bodyEnd = bodyCenter + bodyLength / 2;
    const totalLength = bodyLength + radius * 2;

    return {
      bodyEnd,
      bodyStart,
      radius,
      totalLength,
      volume: computeCapsuleVolume(totalLength, radius),
    };
  };

  let best = evaluateRadius(coreRadius);
  let searchStart = coreRadius;
  let searchEnd = maximumUsefulRadius;
  for (let pass = 0; pass < 3; pass += 1) {
    const searchSpan = searchEnd - searchStart;
    for (let sample = 0; sample <= 24; sample += 1) {
      const candidate = evaluateRadius(searchStart + (searchSpan * sample) / 24);
      if (candidate.volume < best.volume) best = candidate;
    }
    const step = searchSpan / 24;
    searchStart = Math.max(coreRadius, best.radius - step * 1.5);
    searchEnd = Math.min(maximumUsefulRadius, best.radius + step * 1.5);
  }

  const centerT = (best.bodyStart + best.bodyEnd) / 2;
  const fitCenter = frame.axis
    .clone()
    .multiplyScalar(centerT)
    .addScaledVector(frame.basisU, center.u)
    .addScaledVector(frame.basisV, center.v);

  return {
    axialSpan,
    fit: {
      axis: { x: frame.axis.x, y: frame.axis.y, z: frame.axis.z },
      center: { x: fitCenter.x, y: fitCenter.y, z: fitCenter.z },
      radius: best.radius,
      length: best.totalLength,
      volume: best.volume,
    },
  };
}

function buildCandidateAxes(points: Point3[]): ProjectionFrame[] {
  const axisCandidates: Point3[] = [
    { x: 0, y: 0, z: 1 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    ...computePrincipalAxes(points),
  ];
  const frames: ProjectionFrame[] = [];

  axisCandidates.forEach((axisCandidate) => {
    const frame = createProjectionFrame(axisCandidate);
    if (!frame) return;
    const isDuplicate = frames.some((existing) => Math.abs(existing.axis.dot(frame.axis)) > 0.999);
    if (!isDuplicate) frames.push(frame);
  });

  return frames;
}

function distanceToCapsuleSurface(point: Point3, fit: PrimitiveFit): number {
  const deltaX = point.x - fit.center.x;
  const deltaY = point.y - fit.center.y;
  const deltaZ = point.z - fit.center.z;
  const axialOffset = deltaX * fit.axis.x + deltaY * fit.axis.y + deltaZ * fit.axis.z;
  const bodyHalfLength = Math.max(fit.length / 2 - fit.radius, 0);
  const clampedAxialOffset = Math.max(-bodyHalfLength, Math.min(bodyHalfLength, axialOffset));
  const radialX = deltaX - fit.axis.x * clampedAxialOffset;
  const radialY = deltaY - fit.axis.y * clampedAxialOffset;
  const radialZ = deltaZ - fit.axis.z * clampedAxialOffset;
  return Math.abs(Math.hypot(radialX, radialY, radialZ) - fit.radius);
}

function computeBalancedSurfaceError(
  points: ProjectedPoint[],
  segments: EvaluatedCapsuleSegment[],
  referenceRadius: number,
): number {
  const tValues = points.map((point) => point.t);
  const axialStart = Math.min(...tValues);
  const axialEnd = Math.max(...tValues);
  const axialSpan = axialEnd - axialStart;
  const squaredErrorsByBin: number[][] = Array.from({ length: ERROR_PROFILE_BIN_COUNT }, () => []);

  points.forEach((point) => {
    const binIndex =
      axialSpan <= 1e-10
        ? 0
        : Math.min(
            Math.floor(((point.t - axialStart) / axialSpan) * ERROR_PROFILE_BIN_COUNT),
            ERROR_PROFILE_BIN_COUNT - 1,
          );
    const residual = segments.reduce(
      (bestResidual, segment) =>
        Math.min(bestResidual, distanceToCapsuleSurface(point.source, segment.fit)),
      Number.POSITIVE_INFINITY,
    );
    squaredErrorsByBin[Math.max(binIndex, 0)]!.push(residual * residual);
  });

  const binMeanSquaredErrors = squaredErrorsByBin.flatMap((squaredErrors) => {
    if (squaredErrors.length === 0) return [];
    squaredErrors.sort((left, right) => left - right);
    const retainedCount = Math.max(1, Math.floor(squaredErrors.length * ERROR_TRIM_QUANTILE));
    const meanSquaredError =
      squaredErrors.slice(0, retainedCount).reduce((sum, squaredError) => sum + squaredError, 0) /
      retainedCount;
    return [meanSquaredError];
  });
  const balancedMeanSquaredError =
    binMeanSquaredErrors.reduce((sum, value) => sum + value, 0) /
    Math.max(binMeanSquaredErrors.length, 1);
  return Math.sqrt(balancedMeanSquaredError) / Math.max(referenceRadius, 1e-8);
}

function evaluateModel(
  projectedPoints: ProjectedPoint[],
  segments: EvaluatedCapsuleSegment[],
  referenceRadius: number,
): EvaluatedCapsuleModel {
  return {
    normalizedError: computeBalancedSurfaceError(projectedPoints, segments, referenceRadius),
    segments,
    volume: segments.reduce((sum, segment) => sum + segment.fit.volume, 0),
  };
}

function selectStableOneSegmentFit(
  points: Point3[],
): { frame: ProjectionFrame; segment: EvaluatedCapsuleSegment } | null {
  const evaluated = buildCandidateAxes(points).flatMap((frame) => {
    const segment = fitCapsuleToProjectedPoints(projectPoints(points, frame), frame);
    return segment ? [{ frame, segment }] : [];
  });
  if (evaluated.length === 0) return null;

  const bestByVolume = evaluated.reduce((best, candidate) =>
    candidate.segment.fit.volume < best.segment.fit.volume ? candidate : best,
  );
  const localZFit = evaluated.find((candidate) => Math.abs(candidate.frame.axis.z) > 0.999);
  if (
    localZFit &&
    localZFit.segment.fit.volume <= bestByVolume.segment.fit.volume * AXIS_VOLUME_WINDOW_RATIO
  ) {
    return localZFit;
  }
  return bestByVolume;
}

function buildSplitFractions(segmentCount: 2 | 3): number[][] {
  const fractions = Array.from({ length: 7 }, (_, index) => 0.2 + index * 0.1);
  if (segmentCount === 2) return fractions.map((fraction) => [fraction]);

  return fractions.flatMap((firstFraction) =>
    fractions
      .filter((secondFraction) => secondFraction >= firstFraction + 0.2)
      .map((secondFraction) => [firstFraction, secondFraction]),
  );
}

function findBestSegmentedModel(
  points: Point3[],
  frame: ProjectionFrame,
  segmentCount: 2 | 3,
  referenceRadius: number,
): EvaluatedCapsuleModel | null {
  const projectedPoints = projectPoints(points, frame);
  const tValues = projectedPoints.map((point) => point.t);
  const axialStart = Math.min(...tValues);
  const axialEnd = Math.max(...tValues);
  const axialSpan = axialEnd - axialStart;
  if (axialSpan <= 1e-8) return null;

  const models = buildSplitFractions(segmentCount).flatMap((fractions) => {
    const boundaries = [
      axialStart,
      ...fractions.map((fraction) => axialStart + axialSpan * fraction),
      axialEnd,
    ];
    const segments: EvaluatedCapsuleSegment[] = [];

    for (let index = 0; index < segmentCount; index += 1) {
      const segmentPoints = projectedPoints.filter(
        (point) =>
          point.t >= boundaries[index]! - 1e-10 &&
          (index === segmentCount - 1
            ? point.t <= boundaries[index + 1]! + 1e-10
            : point.t < boundaries[index + 1]!),
      );
      const segment = fitCapsuleToProjectedPoints(segmentPoints, frame);
      if (
        !segment ||
        segment.axialSpan < axialSpan * MIN_SEGMENT_SPAN_RATIO ||
        segment.fit.radius < MIN_SEGMENT_RADIUS
      ) {
        return [];
      }
      segments.push(segment);
    }

    return [evaluateModel(projectedPoints, segments, referenceRadius)];
  });
  if (models.length === 0) return null;

  return models.reduce((best, model) =>
    model.normalizedError < best.normalizedError - 1e-8 ||
    (Math.abs(model.normalizedError - best.normalizedError) <= 1e-8 && model.volume < best.volume)
      ? model
      : best,
  );
}

function hasRequiredImprovement(
  simplerModel: EvaluatedCapsuleModel,
  complexModel: EvaluatedCapsuleModel | null,
  minimumErrorImprovement: number,
  maximumVolumeRatio: number,
): complexModel is EvaluatedCapsuleModel {
  if (!complexModel) return false;
  const relativeImprovement =
    (simplerModel.normalizedError - complexModel.normalizedError) /
    Math.max(simplerModel.normalizedError, 1e-8);
  return (
    relativeImprovement >= minimumErrorImprovement &&
    complexModel.volume <= simplerModel.volume * maximumVolumeRatio
  );
}

export function computeApproximateCapsuleDecomposition(
  points: Point3[],
): ApproximateCapsuleDecomposition | undefined {
  const finitePoints = points.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z),
  );
  if (finitePoints.length < MIN_POINTS_PER_SEGMENT) return undefined;

  const stableFit = selectStableOneSegmentFit(finitePoints);
  if (!stableFit) return undefined;

  const projectedPoints = projectPoints(finitePoints, stableFit.frame);
  const referenceRadius = stableFit.segment.fit.radius;
  const oneSegmentModel = evaluateModel(projectedPoints, [stableFit.segment], referenceRadius);
  let selectedModel = oneSegmentModel;

  if (stableFit.segment.fit.length >= MIN_TOTAL_LENGTH_TO_SPLIT) {
    const twoSegmentModel = findBestSegmentedModel(
      finitePoints,
      stableFit.frame,
      2,
      referenceRadius,
    );
    const acceptsTwoSegments = hasRequiredImprovement(
      oneSegmentModel,
      twoSegmentModel,
      SECOND_SEGMENT_ERROR_IMPROVEMENT,
      SECOND_SEGMENT_VOLUME_RATIO,
    );
    if (acceptsTwoSegments) {
      selectedModel = twoSegmentModel;
    }

    const threeSegmentModel = findBestSegmentedModel(
      finitePoints,
      stableFit.frame,
      3,
      referenceRadius,
    );
    if (
      acceptsTwoSegments &&
      hasRequiredImprovement(
        twoSegmentModel,
        threeSegmentModel,
        THIRD_SEGMENT_ERROR_IMPROVEMENT,
        THIRD_SEGMENT_VOLUME_RATIO,
      )
    ) {
      selectedModel = threeSegmentModel;
    } else if (
      !acceptsTwoSegments &&
      hasRequiredImprovement(
        oneSegmentModel,
        threeSegmentModel,
        SECOND_SEGMENT_ERROR_IMPROVEMENT,
        SECOND_SEGMENT_VOLUME_RATIO,
      )
    ) {
      // Two capsules cannot describe a narrow-wide-narrow profile, while three
      // can. Permit that direct jump only under the same strict gain/volume gate.
      selectedModel = threeSegmentModel;
    }
  }

  return {
    normalizedError: selectedModel.normalizedError,
    segments: selectedModel.segments.slice(0, MAX_CAPSULE_SEGMENTS).map((segment) => segment.fit),
  };
}
