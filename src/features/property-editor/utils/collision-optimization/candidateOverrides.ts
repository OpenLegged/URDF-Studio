import { GeometryType } from '@/types';

import type {
  CollisionOptimizationCandidate,
  CollisionOptimizationReason,
} from '../collisionOptimization';
import { convertGeometryType, type MeshAnalysis } from '../geometryConversion';
import type { CollisionTargetRef } from './collisionTargets';
import { buildApproximateMeshCapsuleGeometries } from './meshCapsuleGeometries';

type MeshAnalysisByTargetId = Record<string, MeshAnalysis | null>;

function cloneGeometryOrigin(geometry: CollisionTargetRef['geometry']) {
  const origin = geometry.origin ?? {
    xyz: { x: 0, y: 0, z: 0 },
    rpy: { r: 0, p: 0, y: 0 },
  };

  return {
    xyz: { ...origin.xyz },
    rpy: { ...origin.rpy },
  };
}

function buildSuggestedGeometry(
  geometry: CollisionTargetRef['geometry'],
  type: GeometryType,
  meshAnalysis?: MeshAnalysis | null,
): CollisionTargetRef['geometry'] {
  const converted = convertGeometryType(geometry, type, meshAnalysis ?? undefined);
  return {
    ...geometry,
    type,
    dimensions: { ...converted.dimensions },
    origin: {
      xyz: { ...converted.origin.xyz },
      rpy: { ...converted.origin.rpy },
    },
    meshPath: type === GeometryType.MESH ? geometry.meshPath : undefined,
  };
}

export function getCandidateOverrideOptions(
  candidate: CollisionOptimizationCandidate,
): GeometryType[] {
  if (candidate.secondaryTarget) {
    return [GeometryType.CAPSULE, GeometryType.CYLINDER];
  }

  if (candidate.currentType === GeometryType.MESH) {
    return [
      GeometryType.CAPSULE,
      GeometryType.CYLINDER,
      GeometryType.BOX,
      GeometryType.SPHERE,
      GeometryType.MESH,
    ];
  }

  if (candidate.currentType === GeometryType.CYLINDER) {
    return [GeometryType.CAPSULE, GeometryType.CYLINDER];
  }

  if (candidate.currentType === GeometryType.BOX) {
    return [GeometryType.CAPSULE, GeometryType.CYLINDER, GeometryType.BOX];
  }

  return candidate.suggestedType ? [candidate.suggestedType] : [];
}

function getMergeOverrideReason(type: GeometryType): CollisionOptimizationReason {
  return type === GeometryType.CAPSULE ? 'coaxial-merge-to-capsule' : 'coaxial-merge-to-cylinder';
}

export function applyCandidateTypeOverride(
  candidate: CollisionOptimizationCandidate,
  overrideType: GeometryType | undefined,
  meshAnalysisByTargetId: MeshAnalysisByTargetId | undefined,
): CollisionOptimizationCandidate {
  if (!overrideType) {
    return candidate;
  }

  if (candidate.secondaryTarget) {
    if (
      (overrideType !== GeometryType.CAPSULE && overrideType !== GeometryType.CYLINDER) ||
      !candidate.nextGeometry
    ) {
      return candidate;
    }

    if (overrideType === candidate.suggestedType) {
      return candidate;
    }

    return {
      ...candidate,
      suggestedType: overrideType,
      reason: getMergeOverrideReason(overrideType),
      nextGeometry: {
        ...candidate.nextGeometry,
        type: overrideType,
        dimensions: { ...candidate.nextGeometry.dimensions },
        origin: cloneGeometryOrigin(candidate.nextGeometry),
      },
      mutations: candidate.mutations?.map((mutation) =>
        mutation.type === 'update' && mutation.nextGeometry
          ? {
              ...mutation,
              nextGeometry: {
                ...mutation.nextGeometry,
                type: overrideType,
                dimensions: { ...mutation.nextGeometry.dimensions },
                origin: cloneGeometryOrigin(mutation.nextGeometry),
              },
            }
          : mutation,
      ),
    };
  }

  if (overrideType === candidate.currentType) {
    return {
      ...candidate,
      eligible: false,
      suggestedType: null,
      status: 'disabled',
      reason: undefined,
      nextGeometry: undefined,
      mutations: undefined,
      affectedTargetIds: undefined,
    };
  }

  if (candidate.currentType === GeometryType.MESH) {
    const meshAnalysis = meshAnalysisByTargetId?.[candidate.target.id];
    if (!meshAnalysis) {
      return candidate;
    }

    const nextGeometries =
      overrideType === GeometryType.CAPSULE
        ? buildApproximateMeshCapsuleGeometries(candidate.target.geometry, meshAnalysis)
        : [buildSuggestedGeometry(candidate.target.geometry, overrideType, meshAnalysis)];

    return {
      ...candidate,
      eligible: true,
      suggestedType: overrideType,
      status: 'ready',
      reason: 'mesh-manual-fit',
      nextGeometry: nextGeometries[0],
      mutations: [
        {
          componentId: candidate.target.componentId,
          linkId: candidate.target.linkId,
          objectIndex: candidate.target.objectIndex,
          type: 'replace-many',
          nextGeometries,
        },
      ],
    };
  }

  if (candidate.currentType === GeometryType.CYLINDER && overrideType === GeometryType.CAPSULE) {
    return {
      ...candidate,
      eligible: true,
      suggestedType: GeometryType.CAPSULE,
      status: 'ready',
      reason: 'cylinder-to-capsule',
      nextGeometry: buildSuggestedGeometry(candidate.target.geometry, GeometryType.CAPSULE),
    };
  }

  if (
    candidate.currentType === GeometryType.BOX &&
    (overrideType === GeometryType.CAPSULE || overrideType === GeometryType.CYLINDER)
  ) {
    return {
      ...candidate,
      eligible: true,
      suggestedType: overrideType,
      status: 'ready',
      reason: overrideType === GeometryType.CAPSULE ? 'rod-box-to-capsule' : 'rod-box-to-cylinder',
      nextGeometry: buildSuggestedGeometry(candidate.target.geometry, overrideType),
    };
  }

  return candidate;
}
