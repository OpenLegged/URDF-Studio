/**
 * Geometry type conversion utilities.
 * Handles smart dimension/rotation conversion between geometry types,
 * and auto-align computation for cylinders.
 */
import * as THREE from 'three';
import type { RobotState } from '@/types';
import { GeometryType } from '@/types';
import { computeAxisAlignmentScore, type Point3 } from '@/core/geometry/primitiveGeometry';
import { type PrimitiveFit } from './geometry-conversion/primitiveFit';
import type { MeshAnalysis } from './geometry-conversion/meshAnalysis';
import {
  DEFAULT_DIMENSIONS,
  normalizeDimensions,
  normalizeOrigin,
} from './geometry-conversion/conversionDefaults';
import {
  applyMeshPointBoxClearance,
  applyMeshPointCollisionClearance,
  applySiblingBoxClearance,
  applySiblingCollisionClearance,
} from './geometry-conversion/collisionClearance';
import {
  computeApproximateCrossSectionRadius,
  computeBoxVolume,
  computeEquivalentCapsuleRadius,
  computeEquivalentSphereRadius,
  computePrimitiveVolume,
  getAxisVectorForPrimaryAxis,
  getCrossSectionDimensions,
  getPrimaryAxis,
  toPositive,
} from './geometry-conversion/conversionMath';
import type {
  ConversionContext,
  ConversionResult,
  GeomData,
  MeshPrimaryAxis,
} from './geometry-conversion/conversionTypes';
import {
  alignOriginToPrimaryAxis,
  applyLocalRotationToOrigin,
  offsetOriginByLocalVector,
  rotateLocalVectorByOrigin,
} from './geometry-conversion/originTransforms';

export {
  computeMeshAnalysisFromAssets,
  computeMeshBoundsFromAssets,
  type MeshAnalysis,
  type MeshAnalysisOptions,
  type MeshBounds,
  type MeshClearanceObstacle,
  type MeshClearanceObstaclePoint,
} from './geometry-conversion/meshAnalysis';
export type { ApproximateCapsuleDecomposition } from './geometry-conversion/approximateCapsuleFit';

// Reusable THREE objects - avoid allocation in render/compute paths
const _tempVec3A = new THREE.Vector3();
const _tempVec3B = new THREE.Vector3();
const _tempVec3C = new THREE.Vector3();
const _tempQuat = new THREE.Quaternion();
const _tempEuler = new THREE.Euler(0, 0, 0, 'ZYX');
const _zAxis = new THREE.Vector3(0, 0, 1);

/**
 * Compute auto-align for a cylinder geometry to match the child joint direction.
 * Returns dimensions and origin to align the cylinder along the joint vector,
 * or null if no child joint exists.
 */
export function computeAutoAlign(robot: RobotState, linkId: string) {
  const childJoint = Object.values(robot.joints).find((j) => j.parentLinkId === linkId);
  if (!childJoint) return null;

  _tempVec3A.set(childJoint.origin.xyz.x, childJoint.origin.xyz.y, childJoint.origin.xyz.z);
  const length = _tempVec3A.length();
  _tempVec3B.copy(_tempVec3A).multiplyScalar(0.5); // midpoint
  _tempVec3C.copy(_tempVec3A).normalize(); // direction

  // Calculate rotation to align Z-axis with the vector
  if (
    Math.abs(_tempVec3C.x) < 1e-8 &&
    Math.abs(_tempVec3C.y) < 1e-8 &&
    Math.abs(_tempVec3C.z + 1) < 1e-8
  ) {
    _tempQuat.setFromAxisAngle(_tempVec3A.set(1, 0, 0), Math.PI);
  } else {
    _tempQuat.setFromUnitVectors(_zAxis, _tempVec3C);
  }

  _tempEuler.setFromQuaternion(_tempQuat, 'ZYX');

  return {
    dimensions: { y: length },
    origin: {
      xyz: { x: _tempVec3B.x, y: _tempVec3B.y, z: _tempVec3B.z },
      rpy: { r: _tempEuler.x, p: _tempEuler.y, y: _tempEuler.z },
    },
  };
}

function selectBestPrimitiveFitCandidate(
  primitiveFits: MeshAnalysis['primitiveFits'] | undefined,
  newType: GeometryType,
  origin: ConversionResult['origin'],
  context?: ConversionContext,
  preferredAxis?: Point3,
): {
  fit: PrimitiveFit;
  centeredOrigin: ConversionResult['origin'];
  radius: number;
  length: number;
} | null {
  const candidates =
    newType === GeometryType.CYLINDER
      ? (primitiveFits?.cylinderCandidates ??
        (primitiveFits?.cylinder ? [primitiveFits.cylinder] : []))
      : newType === GeometryType.CAPSULE
        ? (primitiveFits?.capsuleCandidates ??
          (primitiveFits?.capsule ? [primitiveFits.capsule] : []))
        : [];

  if (candidates.length === 0) {
    return null;
  }

  const axisPreferredCandidates = preferredAxis
    ? (() => {
        let bestAlignmentScore = Number.NEGATIVE_INFINITY;
        const scoredCandidates = candidates.map((fit) => {
          const alignmentScore = computeAxisAlignmentScore(fit.axis, preferredAxis);
          if (alignmentScore > bestAlignmentScore) {
            bestAlignmentScore = alignmentScore;
          }
          return { fit, alignmentScore };
        });

        return scoredCandidates
          .filter(({ alignmentScore }) => alignmentScore >= bestAlignmentScore - 1e-6)
          .map(({ fit }) => fit);
      })()
    : candidates;

  const resolvedCandidates =
    axisPreferredCandidates.length > 0 ? axisPreferredCandidates : candidates;

  const evaluated = resolvedCandidates
    .map((fit) => {
      const centeredOrigin = offsetOriginByLocalVector(origin, fit.center);
      const axisInLinkSpace = rotateLocalVectorByOrigin(origin, fit.axis);
      const clearanceAdjustedSize = applySiblingCollisionClearance(
        fit.radius,
        fit.length,
        axisInLinkSpace,
        newType,
        context?.siblingGeometries,
        centeredOrigin,
        context?.overlapAllowanceRatio,
      );
      const siblingShiftedOrigin =
        Math.abs(clearanceAdjustedSize.centerShift) > 1e-8
          ? offsetOriginByLocalVector(centeredOrigin, {
              x: fit.axis.x * clearanceAdjustedSize.centerShift,
              y: fit.axis.y * clearanceAdjustedSize.centerShift,
              z: fit.axis.z * clearanceAdjustedSize.centerShift,
            })
          : centeredOrigin;
      const meshAdjustedSize = applyMeshPointCollisionClearance(
        clearanceAdjustedSize.radius,
        clearanceAdjustedSize.length,
        axisInLinkSpace,
        newType,
        context?.meshClearanceObstacles,
        siblingShiftedOrigin,
        context?.overlapAllowanceRatio,
      );
      const shiftedOrigin =
        Math.abs(meshAdjustedSize.centerShift) > 1e-8
          ? offsetOriginByLocalVector(siblingShiftedOrigin, {
              x: fit.axis.x * meshAdjustedSize.centerShift,
              y: fit.axis.y * meshAdjustedSize.centerShift,
              z: fit.axis.z * meshAdjustedSize.centerShift,
            })
          : siblingShiftedOrigin;
      const radius = toPositive(meshAdjustedSize.radius, 0.05);
      const length = toPositive(
        newType === GeometryType.CAPSULE
          ? Math.max(meshAdjustedSize.length, radius * 2)
          : meshAdjustedSize.length,
        0.1,
      );

      return {
        fit,
        centeredOrigin: shiftedOrigin,
        radius,
        length,
        adjustedVolume: computePrimitiveVolume(newType, radius, length),
        centerShiftMagnitude: Math.abs(
          clearanceAdjustedSize.centerShift + meshAdjustedSize.centerShift,
        ),
      };
    })
    .filter(
      (candidate) => Number.isFinite(candidate.adjustedVolume) && candidate.adjustedVolume > 0,
    );

  if (evaluated.length === 0) {
    return null;
  }

  const minFitVolume = evaluated.reduce(
    (minVolume, candidate) => Math.min(minVolume, candidate.fit.volume),
    Number.POSITIVE_INFINITY,
  );
  const fitVolumeWindowRatio = Math.max(context?.fitVolumeWindowRatio ?? 1.25, 1);
  const finalists = evaluated
    .filter((candidate) => candidate.fit.volume <= minFitVolume * fitVolumeWindowRatio + 1e-8)
    .sort(
      (left, right) =>
        right.adjustedVolume - left.adjustedVolume ||
        left.centerShiftMagnitude - right.centerShiftMagnitude ||
        left.fit.volume - right.fit.volume ||
        left.length - right.length ||
        left.radius - right.radius,
    );

  const best = finalists[0] ?? evaluated[0];
  return best ?? null;
}

/**
 * Convert geometry dimensions when switching between geometry types.
 * Uses stable, deterministic mapping and preserves origin rotation.
 * When meshBounds is supplied (from mesh bounding box), uses it for
 * smart sizing when converting FROM a mesh geometry.
 */
export function convertGeometryType(
  geomData: GeomData,
  newType: GeometryType,
  meshAnalysis?: MeshAnalysis,
  context?: ConversionContext,
): ConversionResult {
  const currentType = geomData.type;
  const currentDims = normalizeDimensions(geomData.dimensions);
  const origin = normalizeOrigin(geomData.origin);

  // ── Smart conversion FROM mesh using actual bounding box ──────────────────
  if (currentType === GeometryType.MESH && meshAnalysis?.bounds) {
    const preservedLocalAxis = getAxisVectorForPrimaryAxis('z');
    const fittedPrimitive = selectBestPrimitiveFitCandidate(
      meshAnalysis.primitiveFits,
      newType,
      origin,
      context,
      preservedLocalAxis,
    );

    if (fittedPrimitive) {
      return {
        type: newType,
        dimensions: {
          x: fittedPrimitive.radius,
          y: fittedPrimitive.length,
          z: fittedPrimitive.radius,
        },
        origin: fittedPrimitive.centeredOrigin,
      };
    }

    const { x: bx, y: by, z: bz, cx, cy, cz } = meshAnalysis.bounds;
    const centeredOrigin = offsetOriginByLocalVector(origin, { x: cx, y: cy, z: cz });
    const targetVolume = computeBoxVolume(meshAnalysis.bounds);

    if (newType === GeometryType.BOX) {
      const fittedBox = meshAnalysis.primitiveFits?.box;
      const fittedBoxVolumeThreshold = 0.98;
      const baseBoxDimensions = {
        x: toPositive(bx, DEFAULT_DIMENSIONS.x),
        y: toPositive(by, DEFAULT_DIMENSIONS.y),
        z: toPositive(bz, DEFAULT_DIMENSIONS.z),
      };
      const fittedBoxDims =
        fittedBox && fittedBox.volume <= targetVolume * fittedBoxVolumeThreshold
          ? {
              dimensions: {
                x: toPositive(fittedBox.dimensions.x, baseBoxDimensions.x),
                y: toPositive(fittedBox.dimensions.y, baseBoxDimensions.y),
                z: toPositive(fittedBox.dimensions.z, baseBoxDimensions.z),
              },
              origin: applyLocalRotationToOrigin(
                offsetOriginByLocalVector(origin, fittedBox.center),
                fittedBox.rotation,
              ),
            }
          : {
              dimensions: baseBoxDimensions,
              origin: centeredOrigin,
            };
      const siblingAdjustedOrigin = context?.siblingGeometries?.length
        ? applySiblingBoxClearance(
            fittedBoxDims.dimensions,
            fittedBoxDims.origin,
            context.siblingGeometries,
          )
        : fittedBoxDims.origin;
      const meshAdjustedBox = applyMeshPointBoxClearance(
        fittedBoxDims.dimensions,
        siblingAdjustedOrigin,
        context?.meshClearanceObstacles,
      );

      return {
        type: newType,
        dimensions: meshAdjustedBox.dimensions,
        origin: meshAdjustedBox.origin,
      };
    }

    if (newType === GeometryType.ELLIPSOID) {
      return {
        type: newType,
        dimensions: {
          x: toPositive(bx / 2, DEFAULT_DIMENSIONS.x / 2),
          y: toPositive(by / 2, DEFAULT_DIMENSIONS.y / 2),
          z: toPositive(bz / 2, DEFAULT_DIMENSIONS.z / 2),
        },
        origin: centeredOrigin,
      };
    }

    if (newType === GeometryType.SPHERE) {
      const sphereRadius = toPositive(computeEquivalentSphereRadius(targetVolume), 0.1);
      return {
        type: newType,
        dimensions: { x: sphereRadius, y: sphereRadius, z: sphereRadius },
        origin: centeredOrigin,
      };
    }

    if (newType === GeometryType.CYLINDER) {
      const localAxis = preservedLocalAxis;
      const { length, crossA, crossB } = getCrossSectionDimensions(meshAnalysis.bounds, 'z');
      const rawRadius = computeApproximateCrossSectionRadius(crossA, crossB);
      const radius = toPositive(rawRadius, 0.05);
      const safeLength = toPositive(length, 0.5);
      const axisInLinkSpace = rotateLocalVectorByOrigin(origin, localAxis);
      const clearanceAdjustedSize = applySiblingCollisionClearance(
        radius,
        safeLength,
        axisInLinkSpace,
        newType,
        context?.siblingGeometries,
        centeredOrigin,
        context?.overlapAllowanceRatio,
      );
      const siblingShiftedOrigin =
        Math.abs(clearanceAdjustedSize.centerShift) > 1e-8
          ? offsetOriginByLocalVector(centeredOrigin, {
              x: localAxis.x * clearanceAdjustedSize.centerShift,
              y: localAxis.y * clearanceAdjustedSize.centerShift,
              z: localAxis.z * clearanceAdjustedSize.centerShift,
            })
          : centeredOrigin;
      const meshAdjustedSize = applyMeshPointCollisionClearance(
        clearanceAdjustedSize.radius,
        clearanceAdjustedSize.length,
        axisInLinkSpace,
        newType,
        context?.meshClearanceObstacles,
        siblingShiftedOrigin,
        context?.overlapAllowanceRatio,
      );
      const shiftedOrigin =
        Math.abs(meshAdjustedSize.centerShift) > 1e-8
          ? offsetOriginByLocalVector(siblingShiftedOrigin, {
              x: localAxis.x * meshAdjustedSize.centerShift,
              y: localAxis.y * meshAdjustedSize.centerShift,
              z: localAxis.z * meshAdjustedSize.centerShift,
            })
          : siblingShiftedOrigin;

      return {
        type: newType,
        dimensions: {
          x: meshAdjustedSize.radius,
          y: meshAdjustedSize.length,
          z: meshAdjustedSize.radius,
        },
        origin: shiftedOrigin,
      };
    }

    if (newType === GeometryType.CAPSULE) {
      const localAxis = preservedLocalAxis;
      const { length, crossA, crossB } = getCrossSectionDimensions(meshAnalysis.bounds, 'z');
      const safeLength = toPositive(length, 0.5);
      const rawRadius = Math.min(
        computeEquivalentCapsuleRadius(safeLength, targetVolume),
        computeApproximateCrossSectionRadius(crossA, crossB),
      );
      const radius = toPositive(rawRadius, 0.05);
      const axisInLinkSpace = rotateLocalVectorByOrigin(origin, localAxis);
      const clearanceAdjustedSize = applySiblingCollisionClearance(
        radius,
        Math.max(safeLength, radius * 2),
        axisInLinkSpace,
        newType,
        context?.siblingGeometries,
        centeredOrigin,
        context?.overlapAllowanceRatio,
      );
      const siblingShiftedOrigin =
        Math.abs(clearanceAdjustedSize.centerShift) > 1e-8
          ? offsetOriginByLocalVector(centeredOrigin, {
              x: localAxis.x * clearanceAdjustedSize.centerShift,
              y: localAxis.y * clearanceAdjustedSize.centerShift,
              z: localAxis.z * clearanceAdjustedSize.centerShift,
            })
          : centeredOrigin;
      const meshAdjustedSize = applyMeshPointCollisionClearance(
        clearanceAdjustedSize.radius,
        Math.max(clearanceAdjustedSize.length, clearanceAdjustedSize.radius * 2),
        axisInLinkSpace,
        newType,
        context?.meshClearanceObstacles,
        siblingShiftedOrigin,
        context?.overlapAllowanceRatio,
      );
      const shiftedOrigin =
        Math.abs(meshAdjustedSize.centerShift) > 1e-8
          ? offsetOriginByLocalVector(siblingShiftedOrigin, {
              x: localAxis.x * meshAdjustedSize.centerShift,
              y: localAxis.y * meshAdjustedSize.centerShift,
              z: localAxis.z * meshAdjustedSize.centerShift,
            })
          : siblingShiftedOrigin;

      return {
        type: newType,
        dimensions: {
          x: meshAdjustedSize.radius,
          y: Math.max(meshAdjustedSize.length, meshAdjustedSize.radius * 2),
          z: meshAdjustedSize.radius,
        },
        origin: shiftedOrigin,
      };
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  if (newType === GeometryType.CYLINDER || newType === GeometryType.CAPSULE) {
    let radius = 0.05;
    let length = 0.5;
    let localAxis: Point3 = { x: 0, y: 0, z: 1 };
    let nextOrigin = origin;
    let primaryAxis: MeshPrimaryAxis | null = null;

    if (currentType === GeometryType.CYLINDER || currentType === GeometryType.CAPSULE) {
      radius = toPositive(currentDims.x, 0.05);
      length = toPositive(currentDims.y, 0.5);
    } else if (currentType === GeometryType.BOX) {
      primaryAxis = getPrimaryAxis(currentDims);
      localAxis = getAxisVectorForPrimaryAxis(primaryAxis);
      const crossSection = getCrossSectionDimensions(currentDims, primaryAxis);
      radius = toPositive(
        computeApproximateCrossSectionRadius(crossSection.crossA, crossSection.crossB),
        0.05,
      );
      length = toPositive(crossSection.length, 0.5);
    } else if (currentType === GeometryType.ELLIPSOID) {
      const ellipsoidDiameters = {
        x: currentDims.x * 2,
        y: currentDims.y * 2,
        z: currentDims.z * 2,
      };
      primaryAxis = getPrimaryAxis(ellipsoidDiameters);
      localAxis = getAxisVectorForPrimaryAxis(primaryAxis);
      const crossSection = getCrossSectionDimensions(ellipsoidDiameters, primaryAxis);
      radius = toPositive(
        computeApproximateCrossSectionRadius(crossSection.crossA, crossSection.crossB),
        0.05,
      );
      length = toPositive(crossSection.length, 0.5);
    } else if (currentType === GeometryType.SPHERE) {
      radius = toPositive(currentDims.x, 0.05);
      length = radius * 2;
    }

    if (context?.siblingGeometries?.length) {
      const axisInLinkSpace = rotateLocalVectorByOrigin(origin, localAxis);
      const clearanceAdjustedSize = applySiblingCollisionClearance(
        radius,
        length,
        axisInLinkSpace,
        newType,
        context.siblingGeometries,
        origin,
        context?.overlapAllowanceRatio,
      );
      radius = clearanceAdjustedSize.radius;
      length = clearanceAdjustedSize.length;
      nextOrigin =
        Math.abs(clearanceAdjustedSize.centerShift) > 1e-8
          ? offsetOriginByLocalVector(origin, {
              x: localAxis.x * clearanceAdjustedSize.centerShift,
              y: localAxis.y * clearanceAdjustedSize.centerShift,
              z: localAxis.z * clearanceAdjustedSize.centerShift,
            })
          : origin;
    }

    if (context?.meshClearanceObstacles?.length) {
      const axisInLinkSpace = rotateLocalVectorByOrigin(origin, localAxis);
      const meshAdjustedSize = applyMeshPointCollisionClearance(
        radius,
        length,
        axisInLinkSpace,
        newType,
        context.meshClearanceObstacles,
        nextOrigin,
        context?.overlapAllowanceRatio,
      );
      radius = meshAdjustedSize.radius;
      length = meshAdjustedSize.length;
      nextOrigin =
        Math.abs(meshAdjustedSize.centerShift) > 1e-8
          ? offsetOriginByLocalVector(nextOrigin, {
              x: localAxis.x * meshAdjustedSize.centerShift,
              y: localAxis.y * meshAdjustedSize.centerShift,
              z: localAxis.z * meshAdjustedSize.centerShift,
            })
          : nextOrigin;
    }

    if (primaryAxis) {
      nextOrigin = alignOriginToPrimaryAxis(nextOrigin, primaryAxis);
    }

    return {
      type: newType,
      dimensions: {
        x: radius,
        y: newType === GeometryType.CAPSULE ? Math.max(length, radius * 2) : length,
        z: radius,
      },
      origin: nextOrigin,
    };
  }

  if (newType === GeometryType.SPHERE) {
    let sphereRadius = 0.1;
    if (currentType === GeometryType.CYLINDER || currentType === GeometryType.CAPSULE) {
      sphereRadius = Math.max(currentDims.x, currentDims.y / 2);
    } else if (currentType === GeometryType.BOX) {
      sphereRadius = Math.max(currentDims.x, currentDims.y, currentDims.z) / 2;
    } else if (currentType === GeometryType.ELLIPSOID) {
      sphereRadius = Math.max(currentDims.x, currentDims.y, currentDims.z);
    } else {
      sphereRadius = currentDims.x;
    }
    sphereRadius = toPositive(sphereRadius, 0.1);

    return {
      type: newType,
      dimensions: { x: sphereRadius, y: sphereRadius, z: sphereRadius },
      origin,
    };
  }

  if (newType === GeometryType.ELLIPSOID) {
    let newDims = { x: 0.1, y: 0.1, z: 0.1 };

    if (currentType === GeometryType.CYLINDER || currentType === GeometryType.CAPSULE) {
      newDims = {
        x: currentDims.x,
        y: currentDims.x,
        z: Math.max(currentDims.y / 2, currentDims.x),
      };
    } else if (currentType === GeometryType.BOX) {
      newDims = {
        x: currentDims.x / 2,
        y: currentDims.y / 2,
        z: currentDims.z / 2,
      };
    } else if (currentType === GeometryType.SPHERE) {
      newDims = {
        x: currentDims.x,
        y: currentDims.x,
        z: currentDims.x,
      };
    } else if (currentType === GeometryType.ELLIPSOID) {
      newDims = { ...currentDims };
    }

    return {
      type: newType,
      dimensions: {
        x: toPositive(newDims.x, 0.1),
        y: toPositive(newDims.y, 0.1),
        z: toPositive(newDims.z, 0.1),
      },
      origin,
    };
  }

  if (newType === GeometryType.BOX) {
    let newDims = { ...currentDims };
    let nextOrigin = origin;
    if (currentType === GeometryType.CYLINDER || currentType === GeometryType.CAPSULE) {
      newDims = { x: currentDims.x * 2, y: currentDims.x * 2, z: currentDims.y };
    } else if (currentType === GeometryType.ELLIPSOID) {
      newDims = { x: currentDims.x * 2, y: currentDims.y * 2, z: currentDims.z * 2 };
    } else if (currentType === GeometryType.SPHERE) {
      const diameter = currentDims.x * 2;
      newDims = { x: diameter, y: diameter, z: diameter };
    }
    if (context?.siblingGeometries?.length) {
      nextOrigin = applySiblingBoxClearance(newDims, origin, context.siblingGeometries);
    }
    const meshAdjustedBox = applyMeshPointBoxClearance(
      newDims,
      nextOrigin,
      context?.meshClearanceObstacles,
    );
    return {
      type: newType,
      dimensions: meshAdjustedBox.dimensions,
      origin: meshAdjustedBox.origin,
    };
  }

  if (newType === GeometryType.MESH) {
    return {
      type: newType,
      dimensions: currentType === GeometryType.MESH ? currentDims : { x: 1, y: 1, z: 1 },
      origin,
    };
  }

  // NONE, or any other type
  return {
    type: newType,
    dimensions: currentDims,
    origin,
  };
}
