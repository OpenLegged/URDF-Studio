import { GeometryType, type UrdfVisual } from '@/types';

import { convertGeometryType, type MeshAnalysis } from '../geometryConversion';
import {
  applyMeshPointCollisionClearance,
  applySiblingCollisionClearance,
} from '../geometry-conversion/collisionClearance';
import {
  alignOriginToAxis,
  offsetOriginByLocalVector,
  rotateLocalVectorByOrigin,
} from '../geometry-conversion/originTransforms';
import type { CollisionClearanceContext } from './clearanceContext';
import { normalizeCollisionGeometry } from './collisionTargets';

const MAX_CAPSULE_SEGMENTS = 3;

function toPositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function buildFallbackCapsule(
  sourceGeometry: UrdfVisual,
  analysis: MeshAnalysis,
  clearanceContext?: CollisionClearanceContext,
): UrdfVisual {
  const normalized = normalizeCollisionGeometry(sourceGeometry);
  const converted = convertGeometryType(
    sourceGeometry,
    GeometryType.CAPSULE,
    analysis,
    clearanceContext,
  );
  return {
    ...normalized,
    type: GeometryType.CAPSULE,
    dimensions: { ...converted.dimensions },
    origin: {
      xyz: { ...converted.origin.xyz },
      rpy: { ...converted.origin.rpy },
    },
    meshPath: undefined,
  };
}

export function buildApproximateMeshCapsuleGeometries(
  sourceGeometry: UrdfVisual,
  analysis: MeshAnalysis,
  clearanceContext?: CollisionClearanceContext,
): UrdfVisual[] {
  const normalized = normalizeCollisionGeometry(sourceGeometry);
  const fits = (analysis.approximateCapsules?.segments ?? [])
    .filter(
      (fit) =>
        Number.isFinite(fit.radius) &&
        fit.radius > 0 &&
        Number.isFinite(fit.length) &&
        fit.length > 0,
    )
    .slice(0, MAX_CAPSULE_SEGMENTS);
  if (fits.length === 0) {
    return [buildFallbackCapsule(sourceGeometry, analysis, clearanceContext)];
  }

  return fits.map((fit, index) => {
    const centeredOrigin = offsetOriginByLocalVector(normalized.origin, fit.center);
    const axisInLinkSpace = rotateLocalVectorByOrigin(normalized.origin, fit.axis);
    const siblingAdjusted = applySiblingCollisionClearance(
      fit.radius,
      fit.length,
      axisInLinkSpace,
      GeometryType.CAPSULE,
      clearanceContext?.siblingGeometries,
      centeredOrigin,
    );
    const siblingShiftedOrigin =
      Math.abs(siblingAdjusted.centerShift) > 1e-8
        ? offsetOriginByLocalVector(centeredOrigin, {
            x: fit.axis.x * siblingAdjusted.centerShift,
            y: fit.axis.y * siblingAdjusted.centerShift,
            z: fit.axis.z * siblingAdjusted.centerShift,
          })
        : centeredOrigin;
    const meshAdjusted = applyMeshPointCollisionClearance(
      siblingAdjusted.radius,
      siblingAdjusted.length,
      axisInLinkSpace,
      GeometryType.CAPSULE,
      clearanceContext?.meshClearanceObstacles,
      siblingShiftedOrigin,
    );
    const shiftedOrigin =
      Math.abs(meshAdjusted.centerShift) > 1e-8
        ? offsetOriginByLocalVector(siblingShiftedOrigin, {
            x: fit.axis.x * meshAdjusted.centerShift,
            y: fit.axis.y * meshAdjusted.centerShift,
            z: fit.axis.z * meshAdjusted.centerShift,
          })
        : siblingShiftedOrigin;
    const radius = toPositive(meshAdjusted.radius, fit.radius);
    const totalLength = Math.max(toPositive(meshAdjusted.length, fit.length), radius * 2);

    return {
      ...normalized,
      name: index === 0 ? normalized.name : undefined,
      type: GeometryType.CAPSULE,
      dimensions: { x: radius, y: totalLength, z: radius },
      origin: alignOriginToAxis(shiftedOrigin, fit.axis),
      meshPath: undefined,
    };
  });
}
