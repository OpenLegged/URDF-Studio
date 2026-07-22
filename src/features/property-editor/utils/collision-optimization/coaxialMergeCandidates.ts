import * as THREE from 'three';

import { GeometryType } from '@/types';
import type { GeometryType as GeometryTypeValue, RobotData, UrdfJoint, UrdfVisual } from '@/types';
import type {
  CoaxialJointMergeStrategy,
  CollisionOptimizationBaseAnalysis,
  CollisionOptimizationCandidate,
  CollisionOptimizationManualMergeStrategy,
  CollisionOptimizationSettings,
} from './contracts';
import type { MeshAnalysis } from '../geometryConversion';
import {
  normalizeCollisionGeometry,
  type CollisionTargetRef,
} from './collisionTargets';
import {
  applyOriginRotationToVector,
  createOriginMatrix,
  getDirectionAlignmentEuler,
  LOCAL_Z_AXIS,
  offsetLocalPointByOrigin,
  transformDirectionToLinkFrame,
  transformDirectionToWorld,
} from './geometryTransforms';
import { computeLinkWorldMatrices } from './skeletonProjection';

const COAXIAL_AXIS_ALIGNMENT_DOT = Math.cos(THREE.MathUtils.degToRad(8));
const COAXIAL_AXIS_OFFSET_RATIO = 0.35;
const COAXIAL_RADIUS_RATIO_LIMIT = 1.25;
const COAXIAL_MIN_RADIUS = 1e-4;
const COAXIAL_GAP_FLOOR = 0.01;
const COAXIAL_JOINT_PROXIMITY_FLOOR = 0.02;
const AUTO_COAXIAL_CONFLICT_PRIORITY = 1;
const MANUAL_COAXIAL_CONFLICT_PRIORITY = 2;

type PrimitiveFitCandidate = NonNullable<
  NonNullable<MeshAnalysis['primitiveFits']>['capsuleCandidates']
>[number];

interface PrimitiveAxisWorldDescriptor {
  centerWorld: THREE.Vector3;
  axisWorld: THREE.Vector3;
  radius: number;
  length: number;
  sourceType: GeometryTypeValue;
}

interface CoaxialMergeCandidateParams {
  parentTarget: CollisionTargetRef;
  jointAxisWorld: THREE.Vector3;
  jointOriginWorld: THREE.Vector3;
  parentDescriptor: PrimitiveAxisWorldDescriptor;
  childDescriptor: PrimitiveAxisWorldDescriptor;
  parentLinkMatrix: THREE.Matrix4;
  strategy: Exclude<CoaxialJointMergeStrategy, 'keep'>;
}

function getPrimitiveFitCandidates(
  analysis: MeshAnalysis,
  strategy: Exclude<CoaxialJointMergeStrategy, 'keep'>,
): PrimitiveFitCandidate[] {
  const primitiveFits = analysis.primitiveFits;
  if (!primitiveFits) {
    return [];
  }

  if (strategy === 'cylinder') {
    return (
      primitiveFits.cylinderCandidates ?? (primitiveFits.cylinder ? [primitiveFits.cylinder] : [])
    );
  }

  return primitiveFits.capsuleCandidates ?? (primitiveFits.capsule ? [primitiveFits.capsule] : []);
}

function buildPrimitiveAxisDescriptorForGeometry(
  geometry: UrdfVisual,
  meshAnalysis: MeshAnalysis | null | undefined,
  strategy: Exclude<CoaxialJointMergeStrategy, 'keep'>,
  linkMatrix: THREE.Matrix4,
  preferredAxisWorld?: THREE.Vector3,
): PrimitiveAxisWorldDescriptor | null {
  if (geometry.type === GeometryType.CYLINDER || geometry.type === GeometryType.CAPSULE) {
    const centerLocal = new THREE.Vector3(
      geometry.origin?.xyz?.x ?? 0,
      geometry.origin?.xyz?.y ?? 0,
      geometry.origin?.xyz?.z ?? 0,
    );
    const axisLocal = applyOriginRotationToVector(geometry.origin, LOCAL_Z_AXIS).normalize();
    const centerWorld = centerLocal.clone().applyMatrix4(linkMatrix);
    const axisWorld = transformDirectionToWorld(linkMatrix, axisLocal);

    return {
      centerWorld,
      axisWorld,
      radius: Math.max(geometry.dimensions?.x ?? 0, COAXIAL_MIN_RADIUS),
      length: Math.max(geometry.dimensions?.y ?? 0, COAXIAL_MIN_RADIUS * 2),
      sourceType: geometry.type,
    };
  }

  if (geometry.type !== GeometryType.MESH || !meshAnalysis) {
    return null;
  }

  const fitCandidates = getPrimitiveFitCandidates(meshAnalysis, strategy);
  if (fitCandidates.length === 0) {
    return null;
  }

  let bestFit: PrimitiveFitCandidate | null = null;
  let bestAlignment = -Infinity;

  for (const fit of fitCandidates) {
    const axisLocal = applyOriginRotationToVector(
      geometry.origin,
      new THREE.Vector3(fit.axis.x, fit.axis.y, fit.axis.z),
    ).normalize();
    const axisWorld = transformDirectionToWorld(linkMatrix, axisLocal);
    const alignment = preferredAxisWorld ? Math.abs(axisWorld.dot(preferredAxisWorld)) : 1;
    if (alignment > bestAlignment + 1e-8) {
      bestAlignment = alignment;
      bestFit = fit;
      continue;
    }

    if (Math.abs(alignment - bestAlignment) <= 1e-8 && bestFit && fit.volume < bestFit.volume) {
      bestFit = fit;
    }
  }

  if (!bestFit) {
    return null;
  }

  const centerLocal = offsetLocalPointByOrigin(geometry.origin, bestFit.center);
  const axisLocal = applyOriginRotationToVector(
    geometry.origin,
    new THREE.Vector3(bestFit.axis.x, bestFit.axis.y, bestFit.axis.z),
  ).normalize();

  return {
    centerWorld: centerLocal.clone().applyMatrix4(linkMatrix),
    axisWorld: transformDirectionToWorld(linkMatrix, axisLocal),
    radius: Math.max(bestFit.radius, COAXIAL_MIN_RADIUS),
    length: Math.max(bestFit.length, COAXIAL_MIN_RADIUS * 2),
    sourceType: geometry.type,
  };
}

function distanceToInterval(value: number, intervalStart: number, intervalEnd: number): number {
  if (value < intervalStart) return intervalStart - value;
  if (value > intervalEnd) return value - intervalEnd;
  return 0;
}

function buildCoaxialMergeGeometry(params: CoaxialMergeCandidateParams): UrdfVisual | null {
  const {
    parentTarget,
    jointAxisWorld,
    jointOriginWorld,
    parentDescriptor,
    childDescriptor,
    parentLinkMatrix,
    strategy,
  } = params;

  const axis = jointAxisWorld.clone().normalize();
  const parentCenterOffset = parentDescriptor.centerWorld.clone().sub(jointOriginWorld);
  const childCenterOffset = childDescriptor.centerWorld.clone().sub(jointOriginWorld);
  const parentT = parentCenterOffset.dot(axis);
  const childT = childCenterOffset.dot(axis);
  const parentHalfExtent = Math.max(parentDescriptor.length / 2, COAXIAL_MIN_RADIUS);
  const childHalfExtent = Math.max(childDescriptor.length / 2, COAXIAL_MIN_RADIUS);
  const parentStart = parentT - parentHalfExtent;
  const parentEnd = parentT + parentHalfExtent;
  const childStart = childT - childHalfExtent;
  const childEnd = childT + childHalfExtent;
  const jointProximityLimit = Math.max(
    Math.max(parentDescriptor.radius, childDescriptor.radius) * 1.2,
    COAXIAL_JOINT_PROXIMITY_FLOOR,
  );

  if (
    distanceToInterval(0, parentStart, parentEnd) > jointProximityLimit ||
    distanceToInterval(0, childStart, childEnd) > jointProximityLimit
  ) {
    return null;
  }

  const mergedStart = Math.min(parentStart, childStart);
  const mergedEnd = Math.max(parentEnd, childEnd);
  const mergedLength = Math.max(mergedEnd - mergedStart, COAXIAL_MIN_RADIUS * 2);
  const mergedCenterWorld = jointOriginWorld
    .clone()
    .add(axis.clone().multiplyScalar((mergedStart + mergedEnd) / 2));
  const mergedRadius = Math.max(
    parentDescriptor.radius,
    childDescriptor.radius,
    COAXIAL_MIN_RADIUS,
  );
  const centerLocal = mergedCenterWorld.clone().applyMatrix4(parentLinkMatrix.clone().invert());
  const axisLocal = transformDirectionToLinkFrame(parentLinkMatrix, axis);
  const alignedEuler = getDirectionAlignmentEuler(axisLocal);

  return {
    ...normalizeCollisionGeometry(parentTarget.geometry),
    type: strategy === 'capsule' ? GeometryType.CAPSULE : GeometryType.CYLINDER,
    meshPath: undefined,
    dimensions: {
      x: mergedRadius,
      y: strategy === 'capsule' ? Math.max(mergedLength, mergedRadius * 2) : mergedLength,
      z: mergedRadius,
    },
    origin: {
      xyz: {
        x: centerLocal.x,
        y: centerLocal.y,
        z: centerLocal.z,
      },
      rpy: {
        r: alignedEuler.x,
        p: alignedEuler.y,
        y: alignedEuler.z,
      },
    },
  };
}

function shouldAnalyzeCoaxialMerge(
  settings: CollisionOptimizationSettings,
): settings is CollisionOptimizationSettings & {
  coaxialJointMergeStrategy: Exclude<CoaxialJointMergeStrategy, 'keep'>;
} {
  return settings.coaxialJointMergeStrategy !== 'keep';
}

function shouldIncludeCoaxialPairForScope(
  settings: CollisionOptimizationSettings,
  parentTarget: CollisionTargetRef,
  childTarget: CollisionTargetRef,
): boolean {
  switch (settings.scope) {
    case 'selected':
      return Boolean(
        settings.selectedTargetId &&
          (parentTarget.id === settings.selectedTargetId ||
            childTarget.id === settings.selectedTargetId),
      );
    case 'mesh':
      return (
        parentTarget.geometry.type === GeometryType.MESH ||
        childTarget.geometry.type === GeometryType.MESH
      );
    case 'primitive':
      return (
        parentTarget.geometry.type !== GeometryType.MESH &&
        childTarget.geometry.type !== GeometryType.MESH
      );
    case 'all':
    default:
      return true;
  }
}

function buildCoaxialMergeCandidateForJoint(
  joint: UrdfJoint,
  parentTarget: CollisionTargetRef,
  childTarget: CollisionTargetRef,
  meshAnalysisByTargetId: Record<string, MeshAnalysis | null>,
  linkWorldMatrices: Record<string, THREE.Matrix4>,
  strategy: CollisionOptimizationManualMergeStrategy,
  conflictPriority: number,
): CollisionOptimizationCandidate | null {
  if (joint.type !== 'fixed' && joint.type !== 'revolute' && joint.type !== 'continuous') {
    return null;
  }

  if (parentTarget.componentId !== childTarget.componentId) {
    return null;
  }

  const parentLinkMatrix = linkWorldMatrices[joint.parentLinkId];
  const childLinkMatrix = linkWorldMatrices[joint.childLinkId];
  if (!parentLinkMatrix || !childLinkMatrix) {
    return null;
  }

  const jointAxis = joint.axis ?? { x: 0, y: 0, z: 1 };
  const jointAxisLocal = new THREE.Vector3(jointAxis.x, jointAxis.y, jointAxis.z);
  if (jointAxisLocal.lengthSq() <= 1e-12) {
    return null;
  }

  const jointWorldMatrix = parentLinkMatrix.clone().multiply(createOriginMatrix(joint.origin));
  const jointOriginWorld = new THREE.Vector3().setFromMatrixPosition(jointWorldMatrix);
  const jointAxisWorld = transformDirectionToWorld(jointWorldMatrix, jointAxisLocal.normalize());

  const parentDescriptor = buildPrimitiveAxisDescriptorForGeometry(
    parentTarget.geometry,
    meshAnalysisByTargetId[parentTarget.id],
    strategy,
    parentLinkMatrix,
    jointAxisWorld,
  );
  const childDescriptor = buildPrimitiveAxisDescriptorForGeometry(
    childTarget.geometry,
    meshAnalysisByTargetId[childTarget.id],
    strategy,
    childLinkMatrix,
    jointAxisWorld,
  );

  if (!parentDescriptor || !childDescriptor) {
    return null;
  }

  const parentAxisAlignment = Math.abs(parentDescriptor.axisWorld.dot(jointAxisWorld));
  const childAxisAlignment = Math.abs(childDescriptor.axisWorld.dot(jointAxisWorld));
  const mutualAxisAlignment = Math.abs(parentDescriptor.axisWorld.dot(childDescriptor.axisWorld));

  if (
    parentAxisAlignment < COAXIAL_AXIS_ALIGNMENT_DOT ||
    childAxisAlignment < COAXIAL_AXIS_ALIGNMENT_DOT ||
    mutualAxisAlignment < COAXIAL_AXIS_ALIGNMENT_DOT
  ) {
    return null;
  }

  const centerDelta = childDescriptor.centerWorld.clone().sub(parentDescriptor.centerWorld);
  const axialDelta = Math.abs(centerDelta.dot(jointAxisWorld));
  const lineOffset = centerDelta
    .sub(jointAxisWorld.clone().multiplyScalar(centerDelta.dot(jointAxisWorld)))
    .length();
  const maxRadius = Math.max(parentDescriptor.radius, childDescriptor.radius, COAXIAL_MIN_RADIUS);
  const radiusRatio =
    Math.max(parentDescriptor.radius, childDescriptor.radius) /
    Math.max(Math.min(parentDescriptor.radius, childDescriptor.radius), COAXIAL_MIN_RADIUS);
  const parentHalfExtent = Math.max(parentDescriptor.length / 2, COAXIAL_MIN_RADIUS);
  const childHalfExtent = Math.max(childDescriptor.length / 2, COAXIAL_MIN_RADIUS);
  const axialGap = Math.max(axialDelta - parentHalfExtent - childHalfExtent, 0);

  if (lineOffset > maxRadius * COAXIAL_AXIS_OFFSET_RATIO) {
    return null;
  }

  if (radiusRatio > COAXIAL_RADIUS_RATIO_LIMIT) {
    return null;
  }

  if (axialGap > Math.max(maxRadius * 1.15, COAXIAL_GAP_FLOOR)) {
    return null;
  }

  const mergedGeometry = buildCoaxialMergeGeometry({
    parentTarget,
    jointAxisWorld,
    jointOriginWorld,
    parentDescriptor,
    childDescriptor,
    parentLinkMatrix,
    strategy,
  });
  if (!mergedGeometry) {
    return null;
  }

  return {
    target: parentTarget,
    secondaryTarget: childTarget,
    eligible: true,
    currentType: parentTarget.geometry.type,
    suggestedType: strategy === 'capsule' ? GeometryType.CAPSULE : GeometryType.CYLINDER,
    status: 'ready',
    reason: strategy === 'capsule' ? 'coaxial-merge-to-capsule' : 'coaxial-merge-to-cylinder',
    nextGeometry: mergedGeometry,
    affectedTargetIds: [parentTarget.id, childTarget.id],
    conflictPriority,
    autoSelect: false,
    mutations: [
      {
        componentId: parentTarget.componentId,
        linkId: parentTarget.linkId,
        objectIndex: parentTarget.objectIndex,
        type: 'update',
        nextGeometry: mergedGeometry,
      },
      {
        componentId: childTarget.componentId,
        linkId: childTarget.linkId,
        objectIndex: childTarget.objectIndex,
        type: 'remove',
      },
    ],
  };
}

function buildCoaxialMergeCandidatesForRobot(
  robot: RobotData,
  settings: CollisionOptimizationSettings & {
    coaxialJointMergeStrategy: Exclude<CoaxialJointMergeStrategy, 'keep'>;
  },
  targets: CollisionTargetRef[],
  meshAnalysisByTargetId: Record<string, MeshAnalysis | null>,
  componentId?: string,
): CollisionOptimizationCandidate[] {
  const candidates: CollisionOptimizationCandidate[] = [];
  const linkWorldMatrices = computeLinkWorldMatrices(robot);
  const targetsByLink = new Map<string, CollisionTargetRef[]>();

  targets
    .filter((target) => target.componentId === componentId)
    .forEach((target) => {
      const key = target.linkId;
      const bucket = targetsByLink.get(key) ?? [];
      bucket.push(target);
      targetsByLink.set(key, bucket);
    });

  Object.values(robot.joints).forEach((joint) => {
    const parentTargets = targetsByLink.get(joint.parentLinkId) ?? [];
    const childTargets = targetsByLink.get(joint.childLinkId) ?? [];

    if (parentTargets.length !== 1 || childTargets.length !== 1) {
      return;
    }

    const parentTarget = parentTargets[0];
    const childTarget = childTargets[0];
    if (!shouldIncludeCoaxialPairForScope(settings, parentTarget, childTarget)) {
      return;
    }

    const candidate = buildCoaxialMergeCandidateForJoint(
      joint,
      parentTarget,
      childTarget,
      meshAnalysisByTargetId,
      linkWorldMatrices,
      settings.coaxialJointMergeStrategy,
      AUTO_COAXIAL_CONFLICT_PRIORITY,
    );

    if (candidate) {
      candidates.push(candidate);
    }
  });

  return candidates;
}

function buildManualMergeCandidatesForRobot(
  robot: RobotData,
  settings: CollisionOptimizationSettings,
  targets: CollisionTargetRef[],
  meshAnalysisByTargetId: Record<string, MeshAnalysis | null>,
  componentId?: string,
): CollisionOptimizationCandidate[] {
  if (!settings.manualMergePairs?.length) {
    return [];
  }

  const candidates: CollisionOptimizationCandidate[] = [];
  const componentTargets = targets.filter((target) => target.componentId === componentId);
  const targetsById = new Map(componentTargets.map((target) => [target.id, target] as const));
  const joints = Object.values(robot.joints);
  const linkWorldMatrices = computeLinkWorldMatrices(robot);
  const seenPairIds = new Set<string>();

  settings.manualMergePairs.forEach((pair) => {
    const firstTarget = targetsById.get(pair.primaryTargetId);
    const secondTarget = targetsById.get(pair.secondaryTargetId);

    if (!firstTarget || !secondTarget || firstTarget.id === secondTarget.id) {
      return;
    }

    let joint = joints.find(
      (entry) =>
        entry.parentLinkId === firstTarget.linkId && entry.childLinkId === secondTarget.linkId,
    );
    let parentTarget = firstTarget;
    let childTarget = secondTarget;

    if (!joint) {
      joint = joints.find(
        (entry) =>
          entry.parentLinkId === secondTarget.linkId && entry.childLinkId === firstTarget.linkId,
      );
      if (!joint) {
        return;
      }

      parentTarget = secondTarget;
      childTarget = firstTarget;
    }

    const pairKey = `${parentTarget.id}::${childTarget.id}`;
    if (seenPairIds.has(pairKey)) {
      return;
    }
    seenPairIds.add(pairKey);

    if (!shouldIncludeCoaxialPairForScope(settings, parentTarget, childTarget)) {
      return;
    }

    const candidate = buildCoaxialMergeCandidateForJoint(
      joint,
      parentTarget,
      childTarget,
      meshAnalysisByTargetId,
      linkWorldMatrices,
      pair.strategy ??
        (settings.coaxialJointMergeStrategy === 'keep'
          ? 'capsule'
          : settings.coaxialJointMergeStrategy),
      MANUAL_COAXIAL_CONFLICT_PRIORITY,
    );

    if (candidate) {
      candidates.push(candidate);
    }
  });

  return candidates;
}

export function buildManualMergeCandidates(
  baseAnalysis: CollisionOptimizationBaseAnalysis,
  settings: CollisionOptimizationSettings,
): CollisionOptimizationCandidate[] {
  if (!settings.manualMergePairs?.length) {
    return [];
  }

  if (baseAnalysis.source.kind === 'robot') {
    return buildManualMergeCandidatesForRobot(
      baseAnalysis.source.robot,
      settings,
      baseAnalysis.targets,
      baseAnalysis.meshAnalysisByTargetId,
      undefined,
    );
  }

  return Object.values(baseAnalysis.source.assembly.components).flatMap((component) =>
    buildManualMergeCandidatesForRobot(
      component.robot,
      settings,
      baseAnalysis.targets,
      baseAnalysis.meshAnalysisByTargetId,
      component.id,
    ),
  );
}

export function buildCoaxialMergeCandidates(
  baseAnalysis: CollisionOptimizationBaseAnalysis,
  settings: CollisionOptimizationSettings,
): CollisionOptimizationCandidate[] {
  if (!shouldAnalyzeCoaxialMerge(settings)) {
    return [];
  }

  if (baseAnalysis.source.kind === 'robot') {
    return buildCoaxialMergeCandidatesForRobot(
      baseAnalysis.source.robot,
      settings,
      baseAnalysis.targets,
      baseAnalysis.meshAnalysisByTargetId,
      undefined,
    );
  }

  return Object.values(baseAnalysis.source.assembly.components).flatMap((component) =>
    buildCoaxialMergeCandidatesForRobot(
      component.robot,
      settings,
      baseAnalysis.targets,
      baseAnalysis.meshAnalysisByTargetId,
      component.id,
    ),
  );
}
