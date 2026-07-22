import * as THREE from 'three';

import { JointType, type RobotData, type UrdfLink, type UrdfMjcfSite, type Vector3 } from '@/types';

import { resolveLinkRenderableBounds } from './assemblyPlacement';
import { solveClosedLoopMotionCompensation } from './closedLoops';
import { hasFiniteJointLimitBounds } from './jointLimits';
import {
  computeLinkWorldMatrices,
  createOriginMatrix,
  getJointActualAngleFromMotionAngle,
  getJointEffectiveAngle,
  getNormalizedJointAxis,
  getParentJointByChildLink,
  type JointAngleOverrideMap,
  type JointKinematicOverrideMap,
  type JointQuaternionOverrideMap,
} from './kinematics';

const IK_HANDLE_RADIUS = 0.03;
const IK_LINE_SEARCH_ATTEMPTS = 4;
const IK_COORDINATE_SEARCH_SCALES = [1, 0.5, 0.25] as const;
const IK_SOLVER_STEP_ANGLE_LIMIT = 0.2;
const IK_SOLVER_STEP_TRANSLATION_LIMIT = 0.02;
const IK_NUMERICAL_EPSILON = 1e-12;
const IK_WORLD_POINT_EPSILON = 1e-9;
const IK_AXIS_ANCHOR_EPSILON = 1e-8;

const SUPPORTED_LINK_IK_JOINT_TYPES = new Set<JointType>([
  JointType.FIXED,
  JointType.REVOLUTE,
  JointType.CONTINUOUS,
  JointType.PRISMATIC,
]);

const VARIABLE_LINK_IK_JOINT_TYPES = new Set<JointType>([
  JointType.REVOLUTE,
  JointType.CONTINUOUS,
  JointType.PRISMATIC,
]);

type SupportedVariableLinkIkJointType =
  | JointType.REVOLUTE
  | JointType.CONTINUOUS
  | JointType.PRISMATIC;

export type LinkIkHandleAnchorSource = 'visual-bounds' | 'collision-bounds' | 'mjcf-site';

export interface LinkIkHandleDescriptor {
  linkId: string;
  anchorLocal: Vector3;
  anchorSource: LinkIkHandleAnchorSource;
  radius: number;
  jointIds: string[];
}

export type LinkIkSolveFailureReason =
  | 'no-chain'
  | 'unsupported-joint'
  | 'stalled'
  | 'numerical-failure';

export interface LinkIkPositionSolveRequest {
  linkId: string;
  anchorLocal?: Vector3;
  targetWorldPosition: Vector3;
  seedAngles?: JointAngleOverrideMap;
  seedQuaternions?: JointQuaternionOverrideMap;
  maxIterations?: number;
  positionTolerance?: number;
  stallTolerance?: number;
  damping?: number;
  coordinatePairMaxDistance?: number;
}

export interface LinkIkPositionSolveResult {
  angles: JointAngleOverrideMap;
  quaternions: JointQuaternionOverrideMap;
  converged: boolean;
  iterations: number;
  residual: number;
  effectorWorldPosition: Vector3;
  failureReason?: LinkIkSolveFailureReason;
}

interface LinkIkChainJoint {
  jointId: string;
  type: SupportedVariableLinkIkJointType;
}

interface LinkIkChain {
  joints: LinkIkChainJoint[];
  jointIds: string[];
}

interface LinkIkEvaluation {
  overrides: JointKinematicOverrideMap;
  effectorWorldPosition: THREE.Vector3;
  error: THREE.Vector3;
  residual: number;
  numericalFailure: boolean;
}

const tempBoundsCenter = new THREE.Vector3();
const tempEffectorPosition = new THREE.Vector3();
const tempJointPosition = new THREE.Vector3();
const tempJointQuaternion = new THREE.Quaternion();
const tempMatrixPosition = new THREE.Vector3();
const tempTargetWorldPosition = new THREE.Vector3();
const tempErrorVector = new THREE.Vector3();
const tempJointAxis = new THREE.Vector3();
const tempJacobianColumn = new THREE.Vector3();
const tempAnchorAxis = new THREE.Vector3();
const tempAnchorCandidate = new THREE.Vector3();

function toVector3Value(vector: THREE.Vector3): Vector3 {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function toThreeVector3(vector: Vector3): THREE.Vector3 {
  return new THREE.Vector3(vector.x, vector.y, vector.z);
}

function getLeafLinkIds(robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId'>): string[] {
  const parentJointByChild = getParentJointByChildLink(robot);
  const parentLinkIds = new Set<string>();

  Object.values(robot.joints).forEach((joint) => {
    parentLinkIds.add(joint.parentLinkId);
  });

  return Object.keys(robot.links).filter((linkId) => {
    if (linkId === robot.rootLinkId) {
      return false;
    }

    return !parentLinkIds.has(linkId) && parentJointByChild.has(linkId);
  });
}

function hasOnlyDecorativeMjcfGeomDescendants(
  robot: Pick<RobotData, 'joints'>,
  linkId: string,
): boolean {
  const visitedLinkIds = new Set<string>();
  const pendingLinkIds = [linkId];
  let sawDecorativeDescendant = false;
  const decorativePrefix = `${linkId}_geom_`;

  while (pendingLinkIds.length > 0) {
    const currentLinkId = pendingLinkIds.pop();
    if (!currentLinkId || visitedLinkIds.has(currentLinkId)) {
      continue;
    }
    visitedLinkIds.add(currentLinkId);

    for (const joint of Object.values(robot.joints)) {
      if (joint.parentLinkId !== currentLinkId) {
        continue;
      }

      if (joint.type !== JointType.FIXED) {
        return false;
      }

      if (!joint.childLinkId.startsWith(decorativePrefix)) {
        return false;
      }

      sawDecorativeDescendant = true;
      pendingLinkIds.push(joint.childLinkId);
    }
  }

  return sawDecorativeDescendant;
}

function isLinkIkHandleCandidate(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId'>,
  linkId: string,
): boolean {
  if (linkId === robot.rootLinkId) {
    return true;
  }

  if (getLeafLinkIds(robot).includes(linkId)) {
    return true;
  }

  // MJCF imports can split extra visual/collision pairs into synthetic fixed
  // `${linkId}_geom_*` links. Keep the parent body draggable only for that
  // narrow case instead of treating any site-bearing fixed subtree as an IK tip.
  return (
    Boolean(robot.links[linkId]?.mjcfSites?.length) &&
    hasOnlyDecorativeMjcfGeomDescendants(robot, linkId)
  );
}

function getNonRootIkHandleCandidateLinkIds(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId'>,
): string[] {
  const leafLinkIds = getLeafLinkIds(robot);
  const leafLinkIdSet = new Set(leafLinkIds);
  const candidateLinkIds = [...leafLinkIds];

  Object.keys(robot.links).forEach((linkId) => {
    if (linkId === robot.rootLinkId || leafLinkIdSet.has(linkId)) {
      return;
    }

    if (
      Boolean(robot.links[linkId]?.mjcfSites?.length) &&
      hasOnlyDecorativeMjcfGeomDescendants(robot, linkId)
    ) {
      candidateLinkIds.push(linkId);
    }
  });

  return candidateLinkIds;
}

function isStrictJointIdPrefix(prefix: readonly string[], value: readonly string[]): boolean {
  if (prefix.length === 0 || prefix.length >= value.length) {
    return false;
  }

  return prefix.every((jointId, index) => value[index] === jointId);
}

function isShadowedByMoreDistalIkHandleCandidate(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId'>,
  linkId: string,
  variableJointIds: readonly string[],
): boolean {
  if (variableJointIds.length === 0) {
    return false;
  }

  return getNonRootIkHandleCandidateLinkIds(robot).some((candidateLinkId) => {
    if (candidateLinkId === linkId) {
      return false;
    }

    const candidateChainResult = collectLinkIkChain(robot, candidateLinkId);
    const candidateVariableJointIds = candidateChainResult.chain?.joints.map(
      (joint) => joint.jointId,
    );
    if (!candidateVariableJointIds) {
      return false;
    }

    return isStrictJointIdPrefix(variableJointIds, candidateVariableJointIds);
  });
}

function clampJointActualAngle(
  robot: Pick<RobotData, 'joints'>,
  jointId: string,
  requestedAngle: number,
): number {
  const joint = robot.joints[jointId];
  if (!joint) {
    return requestedAngle;
  }

  if (
    (joint.type === JointType.REVOLUTE || joint.type === JointType.PRISMATIC) &&
    hasFiniteJointLimitBounds(joint.limit)
  ) {
    return THREE.MathUtils.clamp(requestedAngle, joint.limit.lower, joint.limit.upper);
  }

  return requestedAngle;
}

function collectLinkIkChain(
  robot: Pick<RobotData, 'joints' | 'rootLinkId'>,
  linkId: string,
): { chain: LinkIkChain | null; failureReason?: LinkIkSolveFailureReason } {
  const parentJointByChild = getParentJointByChildLink(robot);
  const jointIds: string[] = [];
  const variableJoints: LinkIkChainJoint[] = [];
  const visitedJointIds = new Set<string>();
  let currentLinkId = linkId;

  while (currentLinkId && currentLinkId !== robot.rootLinkId) {
    const parentJoint = parentJointByChild.get(currentLinkId);
    if (!parentJoint) {
      break;
    }

    if (visitedJointIds.has(parentJoint.id)) {
      return { chain: null, failureReason: 'no-chain' };
    }
    visitedJointIds.add(parentJoint.id);
    jointIds.push(parentJoint.id);

    if (!SUPPORTED_LINK_IK_JOINT_TYPES.has(parentJoint.type)) {
      return { chain: null, failureReason: 'unsupported-joint' };
    }

    if (parentJoint.mimic) {
      return { chain: null, failureReason: 'unsupported-joint' };
    }

    if (
      parentJoint.type === JointType.REVOLUTE ||
      parentJoint.type === JointType.CONTINUOUS ||
      parentJoint.type === JointType.PRISMATIC
    ) {
      variableJoints.push({
        jointId: parentJoint.id,
        type: parentJoint.type,
      });
    }

    currentLinkId = parentJoint.parentLinkId;
  }

  if (variableJoints.length === 0) {
    return { chain: null, failureReason: 'no-chain' };
  }

  jointIds.reverse();
  variableJoints.reverse();
  return {
    chain: {
      jointIds,
      joints: variableJoints,
    },
  };
}

function resolveJointAxisForIkAnchor(
  robot: Pick<RobotData, 'joints'>,
  jointIds: string[],
): THREE.Vector3 | null {
  const distalJointId = jointIds[jointIds.length - 1];
  if (!distalJointId) {
    return null;
  }

  const distalJoint = robot.joints[distalJointId];
  if (!distalJoint?.axis) {
    return null;
  }

  tempAnchorAxis.set(distalJoint.axis.x ?? 0, distalJoint.axis.y ?? 0, distalJoint.axis.z ?? 0);
  if (tempAnchorAxis.lengthSq() <= IK_AXIS_ANCHOR_EPSILON) {
    return null;
  }

  return tempAnchorAxis.normalize().clone();
}

function getAnchorAxisDistanceSq(point: THREE.Vector3, axis: THREE.Vector3): number {
  const axisProjection = point.dot(axis);
  return Math.max(0, point.lengthSq() - axisProjection * axisProjection);
}

function resolveIkHandleAnchorLocal(
  bounds: THREE.Box3,
  preferredAxisLocal: THREE.Vector3 | null = null,
): Vector3 {
  bounds.getCenter(tempBoundsCenter);

  if (!preferredAxisLocal) {
    return toVector3Value(tempBoundsCenter);
  }

  const centerDistanceSq = getAnchorAxisDistanceSq(tempBoundsCenter, preferredAxisLocal);
  if (centerDistanceSq > IK_AXIS_ANCHOR_EPSILON) {
    return toVector3Value(tempBoundsCenter);
  }

  let bestDistanceSq = centerDistanceSq;
  let bestCandidate = tempBoundsCenter.clone();

  const faceCenterCandidates = [
    tempAnchorCandidate.set(bounds.min.x, tempBoundsCenter.y, tempBoundsCenter.z).clone(),
    tempAnchorCandidate.set(bounds.max.x, tempBoundsCenter.y, tempBoundsCenter.z).clone(),
    tempAnchorCandidate.set(tempBoundsCenter.x, bounds.min.y, tempBoundsCenter.z).clone(),
    tempAnchorCandidate.set(tempBoundsCenter.x, bounds.max.y, tempBoundsCenter.z).clone(),
    tempAnchorCandidate.set(tempBoundsCenter.x, tempBoundsCenter.y, bounds.min.z).clone(),
    tempAnchorCandidate.set(tempBoundsCenter.x, tempBoundsCenter.y, bounds.max.z).clone(),
  ];

  faceCenterCandidates.forEach((candidate) => {
    const candidateDistanceSq = getAnchorAxisDistanceSq(candidate, preferredAxisLocal);
    if (candidateDistanceSq > bestDistanceSq + IK_AXIS_ANCHOR_EPSILON) {
      bestDistanceSq = candidateDistanceSq;
      bestCandidate = candidate;
    }
  });

  return toVector3Value(bestCandidate);
}

function scoreMjcfSiteForIkAnchor(site: UrdfMjcfSite): number {
  const name = site.sourceName ?? site.name;
  let score = 0;

  if (/(attachment|tool|tip|tcp|eef|ee|grasp|target)/i.test(name)) {
    score += 1000;
  }

  const position = site.pos ?? [0, 0, 0];
  score += Math.hypot(position[0] ?? 0, position[1] ?? 0, position[2] ?? 0);

  return score;
}

function resolveLinkIkAnchorFromMjcfSites(
  link: Pick<RobotData['links'][string], 'mjcfSites'>,
): { anchorLocal: Vector3; anchorSource: LinkIkHandleAnchorSource } | null {
  const sites = link.mjcfSites?.filter((site) => Array.isArray(site.pos));
  if (!sites || sites.length === 0) {
    return null;
  }

  const preferredSite = sites.reduce(
    (bestSite, currentSite) => {
      if (!bestSite) {
        return currentSite;
      }

      return scoreMjcfSiteForIkAnchor(currentSite) > scoreMjcfSiteForIkAnchor(bestSite)
        ? currentSite
        : bestSite;
    },
    sites[0] as UrdfMjcfSite | undefined,
  );

  if (!preferredSite?.pos) {
    return null;
  }

  return {
    anchorLocal: {
      x: preferredSite.pos[0] ?? 0,
      y: preferredSite.pos[1] ?? 0,
      z: preferredSite.pos[2] ?? 0,
    },
    anchorSource: 'mjcf-site',
  };
}

function buildLinkIkHandleDescriptor(
  robot: Pick<RobotData, 'joints'>,
  link: UrdfLink,
  linkId: string,
  jointIds: string[],
): LinkIkHandleDescriptor | null {
  const boundsResult = resolveLinkRenderableBounds(link);
  const siteAnchorResult = !boundsResult ? resolveLinkIkAnchorFromMjcfSites(link) : null;
  if (!boundsResult && !siteAnchorResult) {
    return null;
  }

  if (!boundsResult) {
    return {
      linkId,
      anchorLocal: siteAnchorResult!.anchorLocal,
      anchorSource: siteAnchorResult!.anchorSource,
      radius: IK_HANDLE_RADIUS,
      jointIds,
    };
  }

  return {
    linkId,
    anchorLocal: resolveIkHandleAnchorLocal(
      boundsResult.bounds,
      resolveJointAxisForIkAnchor(robot, jointIds),
    ),
    anchorSource: boundsResult.source,
    radius: IK_HANDLE_RADIUS,
    jointIds,
  };
}

export function resolveLinkIkHandleDescriptor(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId'>,
  linkId: string,
): LinkIkHandleDescriptor | null {
  const link = robot.links[linkId];
  if (!link) {
    return null;
  }

  if (!isLinkIkHandleCandidate(robot, linkId)) {
    return null;
  }

  const chainResult = collectLinkIkChain(robot, linkId);
  if (!chainResult.chain && linkId !== robot.rootLinkId) {
    return null;
  }

  if (
    linkId !== robot.rootLinkId &&
    chainResult.chain &&
    isShadowedByMoreDistalIkHandleCandidate(
      robot,
      linkId,
      chainResult.chain.joints.map((joint) => joint.jointId),
    )
  ) {
    return null;
  }

  return buildLinkIkHandleDescriptor(robot, link, linkId, chainResult.chain?.jointIds ?? []);
}

export function resolveDirectManipulableLinkIkDescriptor(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId'>,
  linkId: string,
): LinkIkHandleDescriptor | null {
  const link = robot.links[linkId];
  if (!link || linkId === robot.rootLinkId) {
    return null;
  }

  const chainResult = collectLinkIkChain(robot, linkId);
  if (!chainResult.chain) {
    return null;
  }

  return buildLinkIkHandleDescriptor(robot, link, linkId, chainResult.chain.jointIds);
}

export function resolveDirectManipulableLinkIkJointIds(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId'>,
  linkId: string,
): string[] | null {
  if (!robot.links[linkId] || linkId === robot.rootLinkId) {
    return null;
  }

  const chainResult = collectLinkIkChain(robot, linkId);
  return chainResult.chain ? [...chainResult.chain.jointIds] : null;
}

export function resolveLinkIkHandleDescriptors(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId'>,
): LinkIkHandleDescriptor[] {
  return [robot.rootLinkId, ...getLeafLinkIds(robot)]
    .map((linkId) => resolveLinkIkHandleDescriptor(robot, linkId))
    .filter((descriptor): descriptor is LinkIkHandleDescriptor => descriptor !== null);
}

export function resolveSelectableIkHandleLinkId(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId'>,
  linkId: string,
): string | null {
  if (!robot.links[linkId]) {
    return null;
  }

  if (resolveLinkIkHandleDescriptor(robot, linkId)) {
    return linkId;
  }

  const visitedLinkIds = new Set<string>([linkId]);
  const pendingLinkIds = [linkId];
  const descendantCandidateIds = new Set<string>();

  while (pendingLinkIds.length > 0) {
    const currentLinkId = pendingLinkIds.shift();
    if (!currentLinkId) {
      continue;
    }

    Object.values(robot.joints).forEach((joint) => {
      if (joint.parentLinkId !== currentLinkId || visitedLinkIds.has(joint.childLinkId)) {
        return;
      }

      visitedLinkIds.add(joint.childLinkId);
      pendingLinkIds.push(joint.childLinkId);

      const descriptor = resolveLinkIkHandleDescriptor(robot, joint.childLinkId);
      if (!descriptor) {
        return;
      }

      descendantCandidateIds.add(descriptor.linkId);
    });
  }

  if (descendantCandidateIds.size !== 1) {
    return null;
  }

  return [...descendantCandidateIds][0] ?? null;
}

export function resolveLinkIkHandleWorldPosition(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId'>,
  descriptor: Pick<LinkIkHandleDescriptor, 'linkId' | 'anchorLocal'>,
  overrides: JointKinematicOverrideMap = {},
): Vector3 {
  return toVector3Value(
    computeLinkIkEffectorWorldPosition(robot, descriptor.linkId, descriptor.anchorLocal, overrides),
  );
}

function computeLinkIkEffectorWorldPosition(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId'>,
  linkId: string,
  anchorLocal: Vector3,
  overrides: JointKinematicOverrideMap,
): THREE.Vector3 {
  const linkMatrix = computeLinkWorldMatrices(robot, overrides)[linkId];
  tempEffectorPosition.copy(toThreeVector3(anchorLocal));

  if (linkMatrix) {
    tempEffectorPosition.applyMatrix4(linkMatrix);
  }

  return tempEffectorPosition.clone();
}

function mergeJointKinematicOverrides(
  base: JointKinematicOverrideMap,
  compensation: { angles?: JointAngleOverrideMap; quaternions?: JointQuaternionOverrideMap },
): JointKinematicOverrideMap {
  return {
    angles: {
      ...(base.angles ?? {}),
      ...(compensation.angles ?? {}),
    },
    quaternions: {
      ...(base.quaternions ?? {}),
      ...(compensation.quaternions ?? {}),
    },
  };
}

function buildLinkIkEvaluation(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'>,
  linkId: string,
  anchorLocal: Vector3,
  targetWorldPosition: THREE.Vector3,
  overrides: JointKinematicOverrideMap,
  lockedJointIds: string[],
  options: Required<Pick<LinkIkPositionSolveRequest, 'damping' | 'maxIterations'>> & {
    tolerance: number;
  },
): {} & LinkIkEvaluation {
  const compensation = solveClosedLoopMotionCompensation(robot, {
    angles: overrides.angles,
    quaternions: overrides.quaternions,
    lockedJointIds,
    damping: options.damping,
    maxIterations: Math.max(4, options.maxIterations),
    tolerance: Math.min(options.tolerance, 1e-4),
  });
  const mergedOverrides = mergeJointKinematicOverrides(overrides, compensation);
  const effectorWorldPosition = computeLinkIkEffectorWorldPosition(
    robot,
    linkId,
    anchorLocal,
    mergedOverrides,
  );
  const error = tempErrorVector.copy(targetWorldPosition).sub(effectorWorldPosition).clone();
  const residual = error.length();

  return {
    overrides: mergedOverrides,
    effectorWorldPosition,
    error,
    residual,
    numericalFailure:
      !Number.isFinite(residual) ||
      Object.values(mergedOverrides.angles ?? {}).some((value) => !Number.isFinite(value)) ||
      Object.values(mergedOverrides.quaternions ?? {}).some(
        (quaternion) =>
          !quaternion ||
          !Number.isFinite(quaternion.x) ||
          !Number.isFinite(quaternion.y) ||
          !Number.isFinite(quaternion.z) ||
          !Number.isFinite(quaternion.w),
      ),
  };
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const size = matrix.length;
  if (size === 0) {
    return [];
  }

  const augmented = matrix.map((row, rowIndex) => [...row, vector[rowIndex] ?? 0]);

  for (let pivotIndex = 0; pivotIndex < size; pivotIndex += 1) {
    let bestRow = pivotIndex;
    for (let rowIndex = pivotIndex + 1; rowIndex < size; rowIndex += 1) {
      if (Math.abs(augmented[rowIndex][pivotIndex]) > Math.abs(augmented[bestRow][pivotIndex])) {
        bestRow = rowIndex;
      }
    }

    if (Math.abs(augmented[bestRow][pivotIndex]) <= IK_NUMERICAL_EPSILON) {
      return null;
    }

    if (bestRow !== pivotIndex) {
      [augmented[pivotIndex], augmented[bestRow]] = [augmented[bestRow], augmented[pivotIndex]];
    }

    const pivot = augmented[pivotIndex][pivotIndex];
    for (let columnIndex = pivotIndex; columnIndex <= size; columnIndex += 1) {
      augmented[pivotIndex][columnIndex] /= pivot;
    }

    for (let rowIndex = 0; rowIndex < size; rowIndex += 1) {
      if (rowIndex === pivotIndex) {
        continue;
      }

      const factor = augmented[rowIndex][pivotIndex];
      if (Math.abs(factor) <= IK_NUMERICAL_EPSILON) {
        continue;
      }

      for (let columnIndex = pivotIndex; columnIndex <= size; columnIndex += 1) {
        augmented[rowIndex][columnIndex] -= factor * augmented[pivotIndex][columnIndex];
      }
    }
  }

  return augmented.map((row) => row[size] ?? 0);
}

function buildSeedOverrides(
  robot: Pick<RobotData, 'joints'>,
  chain: LinkIkChain,
  request: LinkIkPositionSolveRequest,
): JointKinematicOverrideMap {
  const angles: JointAngleOverrideMap = { ...(request.seedAngles ?? {}) };
  const quaternions: JointQuaternionOverrideMap = { ...(request.seedQuaternions ?? {}) };

  chain.joints.forEach(({ jointId }) => {
    const joint = robot.joints[jointId];
    if (!joint) {
      return;
    }

    if (!(jointId in angles)) {
      angles[jointId] = Number.isFinite(joint.angle) ? joint.angle! : 0;
    }

    if (joint.quaternion && !(jointId in quaternions)) {
      quaternions[jointId] = joint.quaternion;
    }
  });

  return { angles, quaternions };
}

function buildPositionJacobian(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId'>,
  chain: LinkIkChain,
  effectorWorldPosition: THREE.Vector3,
  overrides: JointKinematicOverrideMap,
): number[][] {
  const linkMatrices = computeLinkWorldMatrices(robot, overrides);
  return chain.joints.map(({ jointId, type }) => {
    const joint = robot.joints[jointId];
    const parentLinkMatrix = linkMatrices[joint.parentLinkId] ?? new THREE.Matrix4().identity();
    const jointBaseMatrix = parentLinkMatrix.clone().multiply(createOriginMatrix(joint.origin));
    jointBaseMatrix.decompose(tempJointPosition, tempJointQuaternion, tempMatrixPosition);

    tempJointAxis
      .copy(getNormalizedJointAxis(joint))
      .applyQuaternion(tempJointQuaternion)
      .normalize();

    if (type === JointType.PRISMATIC) {
      return [tempJointAxis.x, tempJointAxis.y, tempJointAxis.z];
    }

    tempEffectorPosition.subVectors(effectorWorldPosition, tempJointPosition);
    tempJacobianColumn.copy(tempJointAxis).cross(tempEffectorPosition);
    return [tempJacobianColumn.x, tempJacobianColumn.y, tempJacobianColumn.z];
  });
}

function solveDampedLeastSquaresStep(
  jacobianColumns: number[][],
  errorVector: THREE.Vector3,
  damping: number,
): number[] | null {
  const variableCount = jacobianColumns.length;
  const normalMatrix = Array.from({ length: variableCount }, () =>
    new Array<number>(variableCount).fill(0),
  );
  const rhs = new Array<number>(variableCount).fill(0);
  const errorComponents = [errorVector.x, errorVector.y, errorVector.z];

  for (let rowIndex = 0; rowIndex < variableCount; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < variableCount; columnIndex += 1) {
      let dotProduct = 0;
      for (let componentIndex = 0; componentIndex < 3; componentIndex += 1) {
        dotProduct +=
          (jacobianColumns[rowIndex]?.[componentIndex] ?? 0) *
          (jacobianColumns[columnIndex]?.[componentIndex] ?? 0);
      }
      normalMatrix[rowIndex][columnIndex] = dotProduct;
    }

    normalMatrix[rowIndex][rowIndex] += damping;
    let projectedError = 0;
    for (let componentIndex = 0; componentIndex < 3; componentIndex += 1) {
      projectedError +=
        (jacobianColumns[rowIndex]?.[componentIndex] ?? 0) * (errorComponents[componentIndex] ?? 0);
    }
    rhs[rowIndex] = projectedError;
  }

  return solveLinearSystem(normalMatrix, rhs);
}

function applyIkStep(
  robot: Pick<RobotData, 'joints'>,
  chain: LinkIkChain,
  baseOverrides: JointKinematicOverrideMap,
  delta: number[],
  scale: number,
): JointKinematicOverrideMap | null {
  const nextAngles: JointAngleOverrideMap = { ...(baseOverrides.angles ?? {}) };

  for (let index = 0; index < chain.joints.length; index += 1) {
    const variable = chain.joints[index];
    const joint = robot.joints[variable.jointId];
    const deltaValue = (delta[index] ?? 0) * scale;

    if (!joint || !Number.isFinite(deltaValue)) {
      return null;
    }

    const boundedDelta =
      variable.type === JointType.PRISMATIC
        ? THREE.MathUtils.clamp(
            deltaValue,
            -IK_SOLVER_STEP_TRANSLATION_LIMIT,
            IK_SOLVER_STEP_TRANSLATION_LIMIT,
          )
        : THREE.MathUtils.clamp(
            deltaValue,
            -IK_SOLVER_STEP_ANGLE_LIMIT,
            IK_SOLVER_STEP_ANGLE_LIMIT,
          );
    const currentMotionAngle = getJointEffectiveAngle(joint, baseOverrides.angles ?? {});
    const requestedMotionAngle = currentMotionAngle + boundedDelta;
    const requestedActualAngle = getJointActualAngleFromMotionAngle(joint, requestedMotionAngle);

    nextAngles[variable.jointId] = clampJointActualAngle(
      robot,
      variable.jointId,
      requestedActualAngle,
    );
  }

  return {
    angles: nextAngles,
    quaternions: { ...(baseOverrides.quaternions ?? {}) },
  };
}

function findCoordinateSearchImprovement(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'>,
  chain: LinkIkChain,
  acceptedEvaluation: LinkIkEvaluation,
  linkId: string,
  anchorLocal: Vector3,
  targetWorldPosition: THREE.Vector3,
  lockedJointIds: string[],
  options: Required<Pick<LinkIkPositionSolveRequest, 'damping' | 'maxIterations'>> & {
    coordinatePairMaxDistance: number;
    tolerance: number;
  },
): LinkIkEvaluation | null {
  let bestEvaluation: LinkIkEvaluation | null = null;
  let bestResidual = acceptedEvaluation.residual;
  const stepMagnitudes = chain.joints.map((variable) =>
    variable.type === JointType.PRISMATIC
      ? IK_SOLVER_STEP_TRANSLATION_LIMIT
      : IK_SOLVER_STEP_ANGLE_LIMIT,
  );

  const tryProbeDelta = (probeDelta: number[]): void => {
    const scaledOverrides = applyIkStep(robot, chain, acceptedEvaluation.overrides, probeDelta, 1);
    if (!scaledOverrides) {
      return;
    }

    const candidateEvaluation = buildLinkIkEvaluation(
      robot,
      linkId,
      anchorLocal,
      targetWorldPosition,
      scaledOverrides,
      lockedJointIds,
      options,
    );

    if (
      candidateEvaluation.numericalFailure ||
      candidateEvaluation.residual + IK_NUMERICAL_EPSILON >= bestResidual
    ) {
      return;
    }

    bestEvaluation = candidateEvaluation;
    bestResidual = candidateEvaluation.residual;
  };

  for (let jointIndex = 0; jointIndex < chain.joints.length; jointIndex += 1) {
    const baseStepMagnitude = stepMagnitudes[jointIndex] ?? IK_SOLVER_STEP_ANGLE_LIMIT;

    for (const scale of IK_COORDINATE_SEARCH_SCALES) {
      const stepMagnitude = baseStepMagnitude * scale;

      for (const direction of [-1, 1] as const) {
        const probeDelta = new Array<number>(chain.joints.length).fill(0);
        probeDelta[jointIndex] = stepMagnitude * direction;
        tryProbeDelta(probeDelta);
      }
    }
  }

  if (bestEvaluation) {
    return bestEvaluation;
  }

  for (let firstIndex = 0; firstIndex < chain.joints.length; firstIndex += 1) {
    const firstStepMagnitude = stepMagnitudes[firstIndex] ?? IK_SOLVER_STEP_ANGLE_LIMIT;

    for (let secondIndex = firstIndex + 1; secondIndex < chain.joints.length; secondIndex += 1) {
      if (secondIndex - firstIndex > options.coordinatePairMaxDistance) {
        continue;
      }

      const secondStepMagnitude = stepMagnitudes[secondIndex] ?? IK_SOLVER_STEP_ANGLE_LIMIT;

      for (const scale of IK_COORDINATE_SEARCH_SCALES) {
        const firstStep = firstStepMagnitude * scale;
        const secondStep = secondStepMagnitude * scale;

        for (const firstDirection of [-1, 1] as const) {
          for (const secondDirection of [-1, 1] as const) {
            const probeDelta = new Array<number>(chain.joints.length).fill(0);
            probeDelta[firstIndex] = firstStep * firstDirection;
            probeDelta[secondIndex] = secondStep * secondDirection;
            tryProbeDelta(probeDelta);
          }
        }
      }
    }
  }

  return bestEvaluation;
}

export function solveLinkIkPositionTarget(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'>,
  request: LinkIkPositionSolveRequest,
): LinkIkPositionSolveResult {
  const descriptor =
    request.anchorLocal === undefined
      ? (resolveDirectManipulableLinkIkDescriptor(robot, request.linkId) ??
        resolveLinkIkHandleDescriptor(robot, request.linkId))
      : null;
  const chainResult = collectLinkIkChain(robot, request.linkId);
  const maxIterations = request.maxIterations ?? 20;
  const positionTolerance = request.positionTolerance ?? 1e-3;
  const stallTolerance = request.stallTolerance ?? 1e-5;
  const damping = request.damping ?? 1e-3;
  const coordinatePairMaxDistance = request.coordinatePairMaxDistance ?? Number.POSITIVE_INFINITY;
  const anchorLocal = request.anchorLocal ?? descriptor?.anchorLocal;

  if (!anchorLocal || !chainResult.chain) {
    return {
      angles: {},
      quaternions: {},
      converged: false,
      iterations: 0,
      residual: Number.POSITIVE_INFINITY,
      effectorWorldPosition: toVector3Value(new THREE.Vector3()),
      failureReason: chainResult.failureReason ?? 'no-chain',
    };
  }

  tempTargetWorldPosition.copy(toThreeVector3(request.targetWorldPosition));
  const lockedJointIds = [...chainResult.chain.jointIds];
  let acceptedEvaluation = buildLinkIkEvaluation(
    robot,
    request.linkId,
    anchorLocal,
    tempTargetWorldPosition,
    buildSeedOverrides(robot, chainResult.chain, request),
    lockedJointIds,
    {
      damping,
      maxIterations,
      tolerance: positionTolerance,
    },
  );

  if (acceptedEvaluation.numericalFailure) {
    return {
      angles: {},
      quaternions: {},
      converged: false,
      iterations: 0,
      residual: Number.POSITIVE_INFINITY,
      effectorWorldPosition: toVector3Value(new THREE.Vector3()),
      failureReason: 'numerical-failure',
    };
  }

  if (acceptedEvaluation.residual <= positionTolerance) {
    return {
      angles: acceptedEvaluation.overrides.angles ?? {},
      quaternions: acceptedEvaluation.overrides.quaternions ?? {},
      converged: true,
      iterations: 0,
      residual: acceptedEvaluation.residual,
      effectorWorldPosition: toVector3Value(acceptedEvaluation.effectorWorldPosition),
    };
  }

  let failureReason: LinkIkSolveFailureReason | undefined;
  let iterations = 0;

  while (iterations < maxIterations) {
    const jacobianColumns = buildPositionJacobian(
      robot,
      chainResult.chain,
      acceptedEvaluation.effectorWorldPosition,
      acceptedEvaluation.overrides,
    );
    const delta = solveDampedLeastSquaresStep(jacobianColumns, acceptedEvaluation.error, damping);
    if (!delta) {
      failureReason = 'numerical-failure';
      break;
    }

    let nextEvaluation: LinkIkEvaluation | null = null;

    for (let attempt = 0; attempt < IK_LINE_SEARCH_ATTEMPTS; attempt += 1) {
      const scaledOverrides = applyIkStep(
        robot,
        chainResult.chain,
        acceptedEvaluation.overrides,
        delta,
        0.5 ** attempt,
      );
      if (!scaledOverrides) {
        failureReason = 'numerical-failure';
        continue;
      }

      const candidateEvaluation = buildLinkIkEvaluation(
        robot,
        request.linkId,
        anchorLocal,
        tempTargetWorldPosition,
        scaledOverrides,
        lockedJointIds,
        {
          damping,
          maxIterations,
          tolerance: positionTolerance,
        },
      );

      if (candidateEvaluation.numericalFailure) {
        failureReason = 'numerical-failure';
        continue;
      }

      if (candidateEvaluation.residual + IK_NUMERICAL_EPSILON < acceptedEvaluation.residual) {
        nextEvaluation = candidateEvaluation;
        break;
      }
    }

    if (!nextEvaluation) {
      nextEvaluation = findCoordinateSearchImprovement(
        robot,
        chainResult.chain,
        acceptedEvaluation,
        request.linkId,
        anchorLocal,
        tempTargetWorldPosition,
        lockedJointIds,
        {
          coordinatePairMaxDistance,
          damping,
          maxIterations,
          tolerance: positionTolerance,
        },
      );
      if (!nextEvaluation) {
        failureReason = failureReason ?? 'stalled';
        break;
      }
    }

    const improvement = acceptedEvaluation.residual - nextEvaluation.residual;
    acceptedEvaluation = nextEvaluation;
    iterations += 1;

    if (acceptedEvaluation.residual <= positionTolerance) {
      break;
    }

    if (improvement <= stallTolerance) {
      failureReason = 'stalled';
      break;
    }
  }

  return {
    angles: acceptedEvaluation.overrides.angles ?? {},
    quaternions: acceptedEvaluation.overrides.quaternions ?? {},
    converged: acceptedEvaluation.residual <= positionTolerance,
    iterations,
    residual: acceptedEvaluation.residual,
    effectorWorldPosition: toVector3Value(acceptedEvaluation.effectorWorldPosition),
    failureReason:
      acceptedEvaluation.residual <= positionTolerance ? undefined : (failureReason ?? 'stalled'),
  };
}
