import * as THREE from 'three';

import type {
  JointQuaternion,
  RobotClosedLoopConstraint,
  RobotClosedLoopDistanceConstraint,
  RobotData,
  UrdfJoint,
} from '@/types';

import {
  computeLinkWorldMatrices,
  createOriginMatrix,
  getJointEffectiveQuaternion,
  getChildJointsByParentLink,
  getParentJointByChildLink,
  type JointAngleOverrideMap,
  type JointKinematicOverrideMap,
  type JointOriginOverrideMap,
  type JointQuaternionOverrideMap,
} from './kinematics';
import { resolveMimicJointAngleTargets } from './mimic';
import { isHardPassiveSpringJoint } from './passiveSpringJoints';

const TEMP_POSITION = new THREE.Vector3();
const TEMP_ROTATION = new THREE.Quaternion();
const TEMP_SCALE = new THREE.Vector3();
const TEMP_ANCHOR_A = new THREE.Vector3();
const TEMP_ANCHOR_B = new THREE.Vector3();
const TEMP_DELTA = new THREE.Vector3();
const TEMP_DEPENDENT_POSITION = new THREE.Vector3();
const TEMP_NEXT_LOCAL_POSITION = new THREE.Vector3();
const TEMP_ERROR = new THREE.Vector3();
const TEMP_PERTURBED_ERROR = new THREE.Vector3();
const TEMP_BASE_POSITION = new THREE.Vector3();
const TEMP_BASE_ROTATION = new THREE.Quaternion();
const TEMP_BASE_SCALE = new THREE.Vector3();
const TEMP_TARGET_VECTOR = new THREE.Vector3();
const TEMP_TARGET_LOCAL_VECTOR = new THREE.Vector3();
const TEMP_ROTATION_FROM = new THREE.Vector3();
const TEMP_ROTATION_TO = new THREE.Vector3();
const TEMP_QUATERNION = new THREE.Quaternion();

const ANGLE_SOLVER_ITERATIONS = 24;
const ANGLE_SOLVER_PERTURBATION = 1e-4;
const ANGLE_SOLVER_TOLERANCE = 1e-5;
const ANGLE_SOLVER_DAMPING = 1e-6;
const CLOSED_LOOP_LINE_SEARCH_ATTEMPTS = 6;
const CLOSED_LOOP_SOLVER_MAX_VARIABLE_STEP = 0.2;
const DRIVEN_JOINT_PROJECTION_ITERATIONS = 18;
const DRIVEN_JOINT_PROJECTION_EPSILON = 1e-5;
const ORIGIN_SOLVER_MAX_PASSES = 6;
const ORIGIN_SOLVER_TOLERANCE_SQ = 1e-10;
const CLOSED_LOOP_SOLVER_BALL_AXES = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
] as const;

export interface ClosedLoopMotionCompensation {
  angles: JointAngleOverrideMap;
  quaternions: JointQuaternionOverrideMap;
}

export interface ClosedLoopDrivenJointMotionResult extends ClosedLoopMotionCompensation {
  appliedAngle: number;
  requestedAngle: number;
  constrained: boolean;
  constraintErrors: Record<string, number>;
  residual: number;
  iterations: number;
  converged: boolean;
}

export interface ClosedLoopOriginCompensation {
  origins: JointOriginOverrideMap;
  quaternions: JointQuaternionOverrideMap;
}

export interface ClosedLoopMotionSolveOptions extends JointKinematicOverrideMap {
  lockedJointIds?: string[];
  maxIterations?: number;
  tolerance?: number;
  damping?: number;
  maxVariableStep?: number;
}

export interface ClosedLoopDrivenJointMotionOptions
  extends Omit<ClosedLoopMotionSolveOptions, 'lockedJointIds'> {
  /**
   * Drive the selected joint past its authored limit. Only the driven joint is
   * released: passive joints keep their limits so the loop solver stays bounded.
   */
  ignoreLimits?: boolean;
}

export interface ClosedLoopMotionSolveResult extends ClosedLoopMotionCompensation {
  constraintErrors: Record<string, number>;
  residual: number;
  iterations: number;
  converged: boolean;
}

interface BallEndpointContext {
  endpoint: 'A' | 'B';
  joint: UrdfJoint;
  rootPosition: THREE.Vector3;
  baseQuaternion: THREE.Quaternion;
  anchorLocal: THREE.Vector3;
  radius: number;
}

interface ClosedLoopSolverVariable {
  joint: UrdfJoint;
  kind: 'angle' | 'ball';
  axis?: THREE.Vector3;
}

interface ClosedLoopErrorState {
  vector: number[];
  constraintErrors: Record<string, number>;
  residual: number;
}

function toVector3Value(vector: THREE.Vector3): { x: number; y: number; z: number } {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function toEulerValue(quaternion: THREE.Quaternion): { r: number; p: number; y: number } {
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'ZYX');
  return { r: euler.x, p: euler.y, y: euler.z };
}

function toQuaternionValue(quaternion: THREE.Quaternion): JointQuaternion {
  return {
    x: quaternion.x,
    y: quaternion.y,
    z: quaternion.z,
    w: quaternion.w,
  };
}

function collectDescendantLinks(
  childJointsByParent: Map<string, UrdfJoint[]>,
  rootLinkId: string,
): Set<string> {
  const visited = new Set<string>();
  const queue = [rootLinkId];

  while (queue.length > 0) {
    const linkId = queue.shift();
    if (!linkId || visited.has(linkId)) {
      continue;
    }

    visited.add(linkId);
    (childJointsByParent.get(linkId) ?? []).forEach((joint) => {
      queue.push(joint.childLinkId);
    });
  }

  return visited;
}

function computeConstraintAnchorWorld(
  linkMatrix: THREE.Matrix4 | undefined,
  anchorLocal: { x: number; y: number; z: number },
  target: THREE.Vector3,
): THREE.Vector3 {
  target.set(anchorLocal.x, anchorLocal.y, anchorLocal.z);
  if (linkMatrix) {
    target.applyMatrix4(linkMatrix);
  }
  return target;
}

function computeDistanceConstraintError(
  anchorA: THREE.Vector3,
  anchorB: THREE.Vector3,
  restDistance: number,
  target: THREE.Vector3,
): THREE.Vector3 {
  TEMP_DELTA.copy(anchorB).sub(anchorA);
  const distance = TEMP_DELTA.length();
  if (distance <= 1e-9) {
    return Math.abs(restDistance) <= 1e-9 ? target.set(0, 0, 0) : target.set(restDistance, 0, 0);
  }

  return target.copy(TEMP_DELTA.normalize()).multiplyScalar(distance - restDistance);
}

function computeDependentAnchorCorrection(
  constraint: RobotClosedLoopConstraint,
  stationaryAnchor: THREE.Vector3,
  dependentAnchor: THREE.Vector3,
  target: THREE.Vector3,
): THREE.Vector3 {
  if (constraint.type === 'distance') {
    TEMP_DELTA.copy(dependentAnchor).sub(stationaryAnchor);
    const distance = TEMP_DELTA.length();
    if (distance <= 1e-9) {
      return target.set(0, 0, 0);
    }

    return target.copy(TEMP_DELTA.normalize()).multiplyScalar(constraint.restDistance - distance);
  }

  return target.copy(stationaryAnchor).sub(dependentAnchor);
}

function buildCompensatedOrigin(
  currentJoint: UrdfJoint,
  parentMatrix: THREE.Matrix4 | undefined,
  dependentMatrix: THREE.Matrix4 | undefined,
  deltaWorld: THREE.Vector3,
): UrdfJoint['origin'] {
  if (!dependentMatrix) {
    return currentJoint.origin;
  }

  dependentMatrix.decompose(TEMP_POSITION, TEMP_ROTATION, TEMP_SCALE);
  TEMP_DEPENDENT_POSITION.copy(TEMP_POSITION).add(deltaWorld);
  TEMP_NEXT_LOCAL_POSITION.copy(TEMP_DEPENDENT_POSITION);

  if (parentMatrix) {
    const parentInverse = parentMatrix.clone().invert();
    TEMP_NEXT_LOCAL_POSITION.applyMatrix4(parentInverse);
  }

  return {
    xyz: toVector3Value(TEMP_NEXT_LOCAL_POSITION),
    rpy: currentJoint.origin.rpy ?? toEulerValue(TEMP_ROTATION),
  };
}

function jointOriginsApproximatelyEqual(a: UrdfJoint['origin'], b: UrdfJoint['origin']): boolean {
  return (
    Math.abs((a.xyz.x ?? 0) - (b.xyz.x ?? 0)) <= 1e-6 &&
    Math.abs((a.xyz.y ?? 0) - (b.xyz.y ?? 0)) <= 1e-6 &&
    Math.abs((a.xyz.z ?? 0) - (b.xyz.z ?? 0)) <= 1e-6 &&
    Math.abs((a.rpy.r ?? 0) - (b.rpy.r ?? 0)) <= 1e-6 &&
    Math.abs((a.rpy.p ?? 0) - (b.rpy.p ?? 0)) <= 1e-6 &&
    Math.abs((a.rpy.y ?? 0) - (b.rpy.y ?? 0)) <= 1e-6
  );
}

function computeJointBaseTransform(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId'>,
  joint: UrdfJoint,
  overrides: JointKinematicOverrideMap,
): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  const parentMatrices = computeLinkWorldMatrices(robot, overrides);
  const parentMatrix = parentMatrices[joint.parentLinkId] ?? new THREE.Matrix4().identity();
  const baseMatrix = parentMatrix
    .clone()
    .multiply(createOriginMatrix(overrides.origins?.[joint.id] ?? joint.origin));

  baseMatrix.decompose(TEMP_BASE_POSITION, TEMP_BASE_ROTATION, TEMP_BASE_SCALE);

  return {
    position: TEMP_BASE_POSITION.clone(),
    quaternion: TEMP_BASE_ROTATION.clone(),
  };
}

function getConstraintBallEndpointContext(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId'>,
  parentJointByChild: Map<string, UrdfJoint>,
  constraint: RobotClosedLoopConstraint,
  endpoint: 'A' | 'B',
  overrides: JointKinematicOverrideMap,
): BallEndpointContext | null {
  const linkId = endpoint === 'A' ? constraint.linkAId : constraint.linkBId;
  const joint = parentJointByChild.get(linkId);
  if (!joint || joint.type !== 'ball') {
    return null;
  }

  const anchorLocalValue = endpoint === 'A' ? constraint.anchorLocalA : constraint.anchorLocalB;
  const anchorLocal = new THREE.Vector3(anchorLocalValue.x, anchorLocalValue.y, anchorLocalValue.z);
  const radius = anchorLocal.length();
  if (radius <= 1e-9) {
    return null;
  }

  const baseTransform = computeJointBaseTransform(robot, joint, overrides);
  return {
    endpoint,
    joint,
    rootPosition: baseTransform.position,
    baseQuaternion: baseTransform.quaternion,
    anchorLocal,
    radius,
  };
}

function collectJointPathToRoot(
  parentJointByChild: Map<string, UrdfJoint>,
  linkId: string,
): UrdfJoint[] {
  const joints: UrdfJoint[] = [];
  let currentLinkId: string | null = linkId;

  while (currentLinkId) {
    const joint = parentJointByChild.get(currentLinkId);
    if (!joint) {
      break;
    }

    joints.push(joint);
    currentLinkId = joint.parentLinkId;
  }

  return joints;
}

function findLowestCommonAncestorLink(
  parentJointByChild: Map<string, UrdfJoint>,
  linkAId: string,
  linkBId: string,
): string | null {
  const ancestorsOfA = new Set<string>([linkAId]);
  let currentLinkId: string | null = linkAId;

  while (currentLinkId) {
    const joint = parentJointByChild.get(currentLinkId);
    if (!joint) {
      break;
    }

    currentLinkId = joint.parentLinkId;
    if (currentLinkId) {
      ancestorsOfA.add(currentLinkId);
    }
  }

  currentLinkId = linkBId;
  while (currentLinkId) {
    if (ancestorsOfA.has(currentLinkId)) {
      return currentLinkId;
    }

    const joint = parentJointByChild.get(currentLinkId);
    if (!joint) {
      break;
    }

    currentLinkId = joint.parentLinkId;
  }

  return null;
}

function collectBranchJointsFromAncestor(
  parentJointByChild: Map<string, UrdfJoint>,
  ancestorLinkId: string,
  targetLinkId: string,
): UrdfJoint[] {
  const joints: UrdfJoint[] = [];
  let currentLinkId: string | null = targetLinkId;

  while (currentLinkId && currentLinkId !== ancestorLinkId) {
    const joint = parentJointByChild.get(currentLinkId);
    if (!joint) {
      return [];
    }

    joints.unshift(joint);
    currentLinkId = joint.parentLinkId;
  }

  return currentLinkId === ancestorLinkId ? joints : [];
}

function isSolvableJointType(joint: UrdfJoint): boolean {
  return joint.type === 'revolute' || joint.type === 'continuous' || joint.type === 'prismatic';
}

function isMotionSolvableJointType(joint: UrdfJoint): boolean {
  return isSolvableJointType(joint) || joint.type === 'ball';
}

function wrapAngleNearReference(angle: number, reference: number): number {
  const tau = Math.PI * 2;
  let wrapped = angle;

  while (wrapped - reference > Math.PI) {
    wrapped -= tau;
  }

  while (wrapped - reference < -Math.PI) {
    wrapped += tau;
  }

  return wrapped;
}

function clampSolvedAngle(joint: UrdfJoint, angle: number, referenceAngle: number): number {
  if (joint.type === 'continuous') {
    return wrapAngleNearReference(angle, referenceAngle);
  }

  const lower = joint.limit?.lower;
  const upper = joint.limit?.upper;
  if (Number.isFinite(lower) && Number.isFinite(upper)) {
    return Math.max(lower!, Math.min(upper!, angle));
  }

  return angle;
}

function limitClosedLoopSolverDelta(delta: number[], maxVariableStep: number): number[] {
  if (!Number.isFinite(maxVariableStep) || maxVariableStep <= 0) {
    return delta;
  }

  let maxComponent = 0;
  delta.forEach((component) => {
    maxComponent = Math.max(maxComponent, Math.abs(component));
  });

  if (maxComponent <= maxVariableStep) {
    return delta;
  }

  const scale = maxVariableStep / maxComponent;
  return delta.map((component) => component * scale);
}

function computeConstraintError(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId'>,
  parentJointByChild: Map<string, UrdfJoint>,
  constraint: RobotClosedLoopConstraint,
  overrides: JointKinematicOverrideMap,
  target: THREE.Vector3,
): THREE.Vector3 {
  const linkWorldMatrices = computeLinkWorldMatrices(robot, overrides);
  const linkAMatrix = linkWorldMatrices[constraint.linkAId];
  const linkBMatrix = linkWorldMatrices[constraint.linkBId];

  computeConstraintAnchorWorld(linkAMatrix, constraint.anchorLocalA, TEMP_ANCHOR_A);
  computeConstraintAnchorWorld(linkBMatrix, constraint.anchorLocalB, TEMP_ANCHOR_B);

  if (constraint.type === 'distance') {
    return computeDistanceConstraintError(
      TEMP_ANCHOR_A,
      TEMP_ANCHOR_B,
      constraint.restDistance,
      target,
    );
  }

  const ballEndpointA = getConstraintBallEndpointContext(
    robot,
    parentJointByChild,
    constraint,
    'A',
    overrides,
  );
  if (ballEndpointA) {
    TEMP_TARGET_VECTOR.copy(TEMP_ANCHOR_B).sub(ballEndpointA.rootPosition);
    const distance = TEMP_TARGET_VECTOR.length();
    if (distance <= 1e-9) {
      return target.set(ballEndpointA.radius, 0, 0);
    }

    return target
      .copy(TEMP_TARGET_VECTOR.normalize())
      .multiplyScalar(distance - ballEndpointA.radius);
  }

  const ballEndpointB = getConstraintBallEndpointContext(
    robot,
    parentJointByChild,
    constraint,
    'B',
    overrides,
  );
  if (ballEndpointB) {
    TEMP_TARGET_VECTOR.copy(TEMP_ANCHOR_A).sub(ballEndpointB.rootPosition);
    const distance = TEMP_TARGET_VECTOR.length();
    if (distance <= 1e-9) {
      return target.set(ballEndpointB.radius, 0, 0);
    }

    return target
      .copy(TEMP_TARGET_VECTOR.normalize())
      .multiplyScalar(distance - ballEndpointB.radius);
  }

  return target.copy(TEMP_ANCHOR_B).sub(TEMP_ANCHOR_A);
}

function getClosedLoopMotionConstraints(
  robot: Pick<RobotData, 'closedLoopConstraints'>,
): RobotClosedLoopConstraint[] {
  return robot.closedLoopConstraints ?? [];
}

function createLockedJointIdSet(options: ClosedLoopMotionSolveOptions): Set<string> {
  const lockedJointIds = new Set(options.lockedJointIds ?? []);
  Object.keys(options.angles ?? {}).forEach((jointId) => lockedJointIds.add(jointId));
  Object.keys(options.quaternions ?? {}).forEach((jointId) => lockedJointIds.add(jointId));
  return lockedJointIds;
}

function getCurrentJointAngleValue(
  joint: UrdfJoint,
  angleOverrides: JointAngleOverrideMap = {},
): number {
  const override = angleOverrides[joint.id];
  if (Number.isFinite(override)) {
    return clampSolvedAngle(joint, override, override);
  }

  if (Number.isFinite(joint.angle)) {
    return clampSolvedAngle(joint, joint.angle!, joint.angle!);
  }

  if (Number.isFinite(joint.referencePosition)) {
    return clampSolvedAngle(joint, joint.referencePosition!, joint.referencePosition!);
  }

  return clampSolvedAngle(joint, 0, 0);
}

function collectClosedLoopMotionConstraints(
  robot: Pick<RobotData, 'joints' | 'closedLoopConstraints'>,
  constraints: RobotClosedLoopConstraint[],
  lockedJointIds: Set<string>,
): RobotClosedLoopConstraint[] {
  if (constraints.length === 0 || lockedJointIds.size === 0) {
    return constraints;
  }

  const childJointsByParent = getChildJointsByParentLink(robot);
  const affectedLinkIds = new Set<string>();

  lockedJointIds.forEach((jointId) => {
    const joint = robot.joints[jointId];
    if (!joint) {
      return;
    }

    collectDescendantLinks(childJointsByParent, joint.childLinkId).forEach((linkId) => {
      affectedLinkIds.add(linkId);
    });
  });

  return constraints.filter(
    (constraint) =>
      affectedLinkIds.has(constraint.linkAId) || affectedLinkIds.has(constraint.linkBId),
  );
}

function collectClosedLoopSolverJoints(
  robot: Pick<RobotData, 'joints'>,
  parentJointByChild: Map<string, UrdfJoint>,
  constraints: RobotClosedLoopConstraint[],
  lockedJointIds: Set<string>,
): UrdfJoint[] {
  const joints: UrdfJoint[] = [];
  const visitedJointIds = new Set<string>();

  constraints.forEach((constraint) => {
    const ancestorLinkId = findLowestCommonAncestorLink(
      parentJointByChild,
      constraint.linkAId,
      constraint.linkBId,
    );
    if (!ancestorLinkId) {
      return;
    }

    const branchJoints = [
      ...collectBranchJointsFromAncestor(parentJointByChild, ancestorLinkId, constraint.linkAId),
      ...collectBranchJointsFromAncestor(parentJointByChild, ancestorLinkId, constraint.linkBId),
    ];

    branchJoints.forEach((joint) => {
      if (
        visitedJointIds.has(joint.id) ||
        lockedJointIds.has(joint.id) ||
        !isMotionSolvableJointType(joint) ||
        !robot.joints[joint.id]
      ) {
        return;
      }

      visitedJointIds.add(joint.id);
      joints.push(joint);
    });
  });

  return joints;
}

function createClosedLoopSolverVariables(joints: UrdfJoint[]): ClosedLoopSolverVariable[] {
  const variables: ClosedLoopSolverVariable[] = [];

  joints.forEach((joint) => {
    if (joint.type === 'ball') {
      CLOSED_LOOP_SOLVER_BALL_AXES.forEach((axis) => {
        variables.push({ joint, kind: 'ball', axis });
      });
      return;
    }

    variables.push({ joint, kind: 'angle' });
  });

  return variables;
}

function setBallJointQuaternionOverride(
  jointId: string,
  baseQuaternion: THREE.Quaternion,
  axis: THREE.Vector3,
  deltaAngle: number,
  overrides: JointKinematicOverrideMap,
): void {
  const nextQuaternion = baseQuaternion.clone();
  if (Math.abs(deltaAngle) > 1e-12) {
    TEMP_QUATERNION.setFromAxisAngle(axis, deltaAngle);
    nextQuaternion.multiply(TEMP_QUATERNION).normalize();
  }

  (overrides.quaternions ??= {})[jointId] = toQuaternionValue(nextQuaternion);
}

function computeClosedLoopErrorState(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId'>,
  parentJointByChild: Map<string, UrdfJoint>,
  constraints: RobotClosedLoopConstraint[],
  overrides: JointKinematicOverrideMap,
): ClosedLoopErrorState {
  const vector: number[] = [];
  const constraintErrors: Record<string, number> = {};
  let residualSquared = 0;

  constraints.forEach((constraint) => {
    computeConstraintError(robot, parentJointByChild, constraint, overrides, TEMP_ERROR);
    vector.push(TEMP_ERROR.x, TEMP_ERROR.y, TEMP_ERROR.z);
    const errorMagnitude = TEMP_ERROR.length();
    constraintErrors[constraint.id] = errorMagnitude;
    residualSquared += errorMagnitude * errorMagnitude;
  });

  return {
    vector,
    constraintErrors,
    residual: Math.sqrt(residualSquared),
  };
}

function resetClosedLoopSolverState(
  overrides: JointKinematicOverrideMap,
  variables: ClosedLoopSolverVariable[],
  currentAngleValues: Map<string, number>,
  currentBallQuaternions: Map<string, THREE.Quaternion>,
): void {
  variables.forEach((variable) => {
    if (variable.kind === 'angle') {
      const currentAngle = currentAngleValues.get(variable.joint.id);
      if (currentAngle != null) {
        (overrides.angles ??= {})[variable.joint.id] = currentAngle;
      }
      return;
    }

    const currentQuaternion = currentBallQuaternions.get(variable.joint.id);
    if (currentQuaternion) {
      (overrides.quaternions ??= {})[variable.joint.id] = toQuaternionValue(currentQuaternion);
    }
  });
}

function applyClosedLoopSolverStep(
  robot: Pick<RobotData, 'joints'>,
  variables: ClosedLoopSolverVariable[],
  overrides: JointKinematicOverrideMap,
  currentAngleValues: Map<string, number>,
  currentBallQuaternions: Map<string, THREE.Quaternion>,
  delta: number[],
  scale = 1,
): boolean {
  let changed = false;
  const accumulatedAngleDelta = new Map<string, number>();
  const nextBallQuaternions = new Map<string, THREE.Quaternion>();

  variables.forEach((variable, variableIndex) => {
    const component = delta[variableIndex] ?? 0;
    if (Math.abs(component) <= 1e-12) {
      return;
    }

    if (variable.kind === 'angle') {
      accumulatedAngleDelta.set(
        variable.joint.id,
        (accumulatedAngleDelta.get(variable.joint.id) ?? 0) + component,
      );
      return;
    }

    const axis = variable.axis;
    const currentQuaternion =
      nextBallQuaternions.get(variable.joint.id) ??
      currentBallQuaternions.get(variable.joint.id)?.clone();
    if (!axis || !currentQuaternion) {
      return;
    }

    TEMP_QUATERNION.setFromAxisAngle(axis, -component * scale);
    currentQuaternion.multiply(TEMP_QUATERNION).normalize();
    nextBallQuaternions.set(variable.joint.id, currentQuaternion);
    changed = true;
  });

  accumulatedAngleDelta.forEach((component, jointId) => {
    const joint = robot.joints[jointId];
    const currentAngle = currentAngleValues.get(jointId);
    if (!joint || currentAngle == null) {
      return;
    }

    const nextAngle = clampSolvedAngle(joint, currentAngle - component * scale, currentAngle);
    (overrides.angles ??= {})[jointId] = nextAngle;
    if (Math.abs(nextAngle - currentAngle) > 1e-9) {
      changed = true;
    }
  });

  nextBallQuaternions.forEach((quaternion, jointId) => {
    (overrides.quaternions ??= {})[jointId] = toQuaternionValue(quaternion);
  });

  return changed;
}

function stripLockedJointOverrides(
  overrides: JointKinematicOverrideMap,
  lockedJointIds: Set<string>,
): ClosedLoopMotionCompensation {
  const angles = { ...(overrides.angles ?? {}) };
  const quaternions = { ...(overrides.quaternions ?? {}) };

  lockedJointIds.forEach((jointId) => {
    delete angles[jointId];
    delete quaternions[jointId];
  });

  return { angles, quaternions };
}

function mergeDrivenMotionCompensation(
  drivenAngles: JointAngleOverrideMap,
  compensation: ClosedLoopMotionCompensation,
): ClosedLoopMotionCompensation {
  return {
    angles: {
      ...drivenAngles,
      ...compensation.angles,
    },
    quaternions: { ...compensation.quaternions },
  };
}

function isFeasibleDrivenJointMotion(
  result: Pick<ClosedLoopDrivenJointMotionResult, 'converged' | 'residual' | 'constraintErrors'>,
  tolerance: number,
): boolean {
  return (
    result.converged &&
    result.residual <= tolerance &&
    Object.values(result.constraintErrors).every(
      (error) => Number.isFinite(error) && error <= tolerance,
    )
  );
}

function evaluateDrivenJointMotion(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'>,
  selectedJointId: string,
  selectedAngle: number,
  options: Omit<ClosedLoopMotionSolveOptions, 'angles' | 'quaternions' | 'lockedJointIds'> = {},
  preferredLockedJointIds: readonly string[] = [],
): ClosedLoopDrivenJointMotionResult {
  const drivenMotion = resolveMimicJointAngleTargets(robot, selectedJointId, selectedAngle);
  const lockedJointIds =
    preferredLockedJointIds.length > 0
      ? [...new Set([...drivenMotion.lockedJointIds, ...preferredLockedJointIds])]
      : drivenMotion.lockedJointIds;
  const solution = solveClosedLoopMotionCompensation(robot, {
    ...options,
    angles: drivenMotion.angles,
    lockedJointIds,
  });
  const merged = mergeDrivenMotionCompensation(drivenMotion.angles, solution);

  return {
    ...merged,
    appliedAngle: merged.angles[selectedJointId] ?? selectedAngle,
    requestedAngle: selectedAngle,
    constrained: false,
    constraintErrors: solution.constraintErrors,
    residual: solution.residual,
    iterations: solution.iterations,
    converged: solution.converged,
  };
}

function collectPreferredLockedPassiveSpringJointIds(
  robot: Pick<RobotData, 'joints' | 'closedLoopConstraints'>,
  selectedJointId: string,
  selectedAngle: number,
): string[] {
  const drivenMotion = resolveMimicJointAngleTargets(robot, selectedJointId, selectedAngle);
  const alreadyLocked = new Set([
    ...drivenMotion.lockedJointIds,
    ...Object.keys(drivenMotion.angles),
  ]);

  const motionConstraints = collectClosedLoopMotionConstraints(
    robot,
    getClosedLoopMotionConstraints(robot),
    alreadyLocked,
  );
  const parentJointByChild = getParentJointByChildLink(robot);
  const constraintEndpointLinkIds = new Set(
    motionConstraints.flatMap((constraint) => [constraint.linkAId, constraint.linkBId]),
  );

  return collectClosedLoopSolverJoints(robot, parentJointByChild, motionConstraints, alreadyLocked)
    .filter((joint) => joint.id !== selectedJointId)
    .filter((joint) => !constraintEndpointLinkIds.has(joint.childLinkId))
    .filter(isHardPassiveSpringJoint)
    .map((joint) => joint.id);
}

function applyClosedLoopBallJointCompensation(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId'>,
  parentJointByChild: Map<string, UrdfJoint>,
  constraints: RobotClosedLoopConstraint[],
  overrides: JointKinematicOverrideMap,
  lockedJointIds: Set<string>,
): void {
  constraints.forEach((constraint) => {
    if (constraint.type !== 'connect') {
      return;
    }

    const ballJointA = parentJointByChild.get(constraint.linkAId);
    if (ballJointA && ballJointA.type === 'ball' && !lockedJointIds.has(ballJointA.id)) {
      const quaternion = solveBallEndpointQuaternion(
        robot,
        parentJointByChild,
        constraint,
        'A',
        overrides,
      );
      if (quaternion) {
        (overrides.quaternions ??= {})[ballJointA.id] = quaternion;
      }
    }

    const ballJointB = parentJointByChild.get(constraint.linkBId);
    if (ballJointB && ballJointB.type === 'ball' && !lockedJointIds.has(ballJointB.id)) {
      const quaternion = solveBallEndpointQuaternion(
        robot,
        parentJointByChild,
        constraint,
        'B',
        overrides,
      );
      if (quaternion) {
        (overrides.quaternions ??= {})[ballJointB.id] = quaternion;
      }
    }
  });
}

function filterNoOpMotionCompensation(
  robot: Pick<RobotData, 'joints'>,
  compensation: ClosedLoopMotionCompensation,
): ClosedLoopMotionCompensation {
  const angles = { ...compensation.angles };
  const quaternions = { ...compensation.quaternions };

  Object.entries(angles).forEach(([jointId, angle]) => {
    const joint = robot.joints[jointId];
    if (!joint) {
      return;
    }

    const currentAngle = Number.isFinite(joint.angle) ? joint.angle! : 0;
    if (Math.abs(currentAngle - angle) <= 1e-9) {
      delete angles[jointId];
    }
  });

  Object.entries(quaternions).forEach(([jointId, quaternion]) => {
    const joint = robot.joints[jointId];
    const currentQuaternion = joint?.quaternion ?? { x: 0, y: 0, z: 0, w: 1 };
    if (
      Math.abs(currentQuaternion.x - quaternion.x) <= 1e-9 &&
      Math.abs(currentQuaternion.y - quaternion.y) <= 1e-9 &&
      Math.abs(currentQuaternion.z - quaternion.z) <= 1e-9 &&
      Math.abs(currentQuaternion.w - quaternion.w) <= 1e-9
    ) {
      delete quaternions[jointId];
    }
  });

  return { angles, quaternions };
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

    if (Math.abs(augmented[bestRow][pivotIndex]) <= 1e-12) {
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
      if (Math.abs(factor) <= 1e-12) {
        continue;
      }

      for (let columnIndex = pivotIndex; columnIndex <= size; columnIndex += 1) {
        augmented[rowIndex][columnIndex] -= factor * augmented[pivotIndex][columnIndex];
      }
    }
  }

  return augmented.map((row) => row[size] ?? 0);
}

function solveBallEndpointQuaternion(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId'>,
  parentJointByChild: Map<string, UrdfJoint>,
  constraint: RobotClosedLoopConstraint,
  endpoint: 'A' | 'B',
  overrides: JointKinematicOverrideMap,
): JointQuaternion | null {
  const context = getConstraintBallEndpointContext(
    robot,
    parentJointByChild,
    constraint,
    endpoint,
    overrides,
  );
  if (!context) {
    return null;
  }

  const linkWorldMatrices = computeLinkWorldMatrices(robot, overrides);
  const targetAnchorMatrix =
    endpoint === 'A'
      ? linkWorldMatrices[constraint.linkBId]
      : linkWorldMatrices[constraint.linkAId];
  const targetAnchorLocal = endpoint === 'A' ? constraint.anchorLocalB : constraint.anchorLocalA;

  computeConstraintAnchorWorld(targetAnchorMatrix, targetAnchorLocal, TEMP_ANCHOR_B);
  TEMP_TARGET_VECTOR.copy(TEMP_ANCHOR_B).sub(context.rootPosition);
  if (TEMP_TARGET_VECTOR.lengthSq() <= 1e-12) {
    return null;
  }

  TEMP_TARGET_LOCAL_VECTOR.copy(TEMP_TARGET_VECTOR).applyQuaternion(
    context.baseQuaternion.clone().invert(),
  );

  if (TEMP_TARGET_LOCAL_VECTOR.lengthSq() <= 1e-12) {
    return null;
  }

  TEMP_ROTATION_FROM.copy(context.anchorLocal).normalize();
  TEMP_ROTATION_TO.copy(TEMP_TARGET_LOCAL_VECTOR).normalize();
  TEMP_QUATERNION.setFromUnitVectors(TEMP_ROTATION_FROM, TEMP_ROTATION_TO).normalize();

  return toQuaternionValue(TEMP_QUATERNION);
}

export function resolveClosedLoopJointOriginCompensation(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'>,
  selectedJointId: string,
  selectedOrigin: UrdfJoint['origin'],
): JointOriginOverrideMap {
  return resolveClosedLoopJointOriginCompensationDetailed(robot, selectedJointId, selectedOrigin)
    .origins;
}

export function resolveClosedLoopJointOriginCompensationDetailed(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'>,
  selectedJointId: string,
  selectedOrigin: UrdfJoint['origin'],
): ClosedLoopOriginCompensation {
  if (!robot.closedLoopConstraints || robot.closedLoopConstraints.length === 0) {
    return { origins: {}, quaternions: {} };
  }

  const selectedJoint = robot.joints[selectedJointId];
  if (!selectedJoint) {
    return { origins: {}, quaternions: {} };
  }

  const childJointsByParent = getChildJointsByParentLink(robot);
  const parentJointByChild = getParentJointByChildLink(robot);
  const selectedSubtreeLinks = collectDescendantLinks(
    childJointsByParent,
    selectedJoint.childLinkId,
  );
  const originOverrides: JointOriginOverrideMap = {
    [selectedJointId]: selectedOrigin,
  };

  for (let passIndex = 0; passIndex < ORIGIN_SOLVER_MAX_PASSES; passIndex += 1) {
    let changedThisPass = false;

    robot.closedLoopConstraints.forEach((constraint) => {
      const linkAInSelectedSubtree = selectedSubtreeLinks.has(constraint.linkAId);
      const linkBInSelectedSubtree = selectedSubtreeLinks.has(constraint.linkBId);

      if (linkAInSelectedSubtree === linkBInSelectedSubtree) {
        return;
      }

      const stationaryLinkId = linkAInSelectedSubtree ? constraint.linkAId : constraint.linkBId;
      const dependentLinkId = linkAInSelectedSubtree ? constraint.linkBId : constraint.linkAId;
      const stationaryAnchorLocal = linkAInSelectedSubtree
        ? constraint.anchorLocalA
        : constraint.anchorLocalB;
      const dependentAnchorLocal = linkAInSelectedSubtree
        ? constraint.anchorLocalB
        : constraint.anchorLocalA;
      const dependentParentJoint = parentJointByChild.get(dependentLinkId);

      if (!dependentParentJoint) {
        return;
      }

      const linkWorldMatrices = computeLinkWorldMatrices(robot, { origins: originOverrides });
      const stationaryMatrix = linkWorldMatrices[stationaryLinkId];
      const dependentMatrix = linkWorldMatrices[dependentLinkId];

      computeConstraintAnchorWorld(stationaryMatrix, stationaryAnchorLocal, TEMP_ANCHOR_A);
      computeConstraintAnchorWorld(dependentMatrix, dependentAnchorLocal, TEMP_ANCHOR_B);

      computeDependentAnchorCorrection(constraint, TEMP_ANCHOR_A, TEMP_ANCHOR_B, TEMP_DELTA);
      if (TEMP_DELTA.lengthSq() <= ORIGIN_SOLVER_TOLERANCE_SQ) {
        return;
      }

      const nextOrigin = buildCompensatedOrigin(
        dependentParentJoint,
        linkWorldMatrices[dependentParentJoint.parentLinkId],
        dependentMatrix,
        TEMP_DELTA,
      );

      const previousOrigin =
        originOverrides[dependentParentJoint.id] ?? dependentParentJoint.origin;
      if (jointOriginsApproximatelyEqual(previousOrigin, nextOrigin)) {
        return;
      }

      originOverrides[dependentParentJoint.id] = nextOrigin;
      changedThisPass = true;
    });

    if (!changedThisPass) {
      break;
    }
  }

  const quaternionOverrides: JointQuaternionOverrideMap = {};
  robot.closedLoopConstraints.forEach((constraint) => {
    if (constraint.type !== 'connect') {
      return;
    }

    const linkAInSelectedSubtree = selectedSubtreeLinks.has(constraint.linkAId);
    const linkBInSelectedSubtree = selectedSubtreeLinks.has(constraint.linkBId);
    if (linkAInSelectedSubtree === linkBInSelectedSubtree) {
      return;
    }

    const dependentLinkId = linkAInSelectedSubtree ? constraint.linkBId : constraint.linkAId;
    const dependentEndpoint = dependentLinkId === constraint.linkAId ? 'A' : 'B';
    const dependentParentJoint = parentJointByChild.get(dependentLinkId);
    if (!dependentParentJoint || dependentParentJoint.type !== 'ball') {
      return;
    }

    const quaternion = solveBallEndpointQuaternion(
      robot,
      parentJointByChild,
      constraint,
      dependentEndpoint,
      { origins: originOverrides },
    );

    if (quaternion) {
      quaternionOverrides[dependentParentJoint.id] = quaternion;
    }
  });

  delete originOverrides[selectedJointId];
  return {
    origins: originOverrides,
    quaternions: quaternionOverrides,
  };
}

export function solveClosedLoopMotionCompensation(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'>,
  options: ClosedLoopMotionSolveOptions = {},
): ClosedLoopMotionSolveResult {
  const constraints = getClosedLoopMotionConstraints(robot);
  const lockedJointIds = createLockedJointIdSet(options);
  const motionConstraints = collectClosedLoopMotionConstraints(robot, constraints, lockedJointIds);
  const overrides: JointKinematicOverrideMap = {
    angles: { ...(options.angles ?? {}) },
    quaternions: { ...(options.quaternions ?? {}) },
  };
  const tolerance = options.tolerance ?? ANGLE_SOLVER_TOLERANCE;
  const maxIterations = options.maxIterations ?? ANGLE_SOLVER_ITERATIONS * 2;
  const damping = options.damping ?? ANGLE_SOLVER_DAMPING;
  const maxVariableStep = options.maxVariableStep ?? CLOSED_LOOP_SOLVER_MAX_VARIABLE_STEP;

  if (motionConstraints.length === 0) {
    const compensation = stripLockedJointOverrides(overrides, lockedJointIds);
    return {
      ...compensation,
      constraintErrors: {},
      residual: 0,
      iterations: 0,
      converged: true,
    };
  }

  const parentJointByChild = getParentJointByChildLink(robot);
  const solverJoints = collectClosedLoopSolverJoints(
    robot,
    parentJointByChild,
    motionConstraints,
    lockedJointIds,
  );
  const solverVariables = createClosedLoopSolverVariables(solverJoints);

  solverVariables.forEach((variable) => {
    if (variable.kind === 'angle') {
      (overrides.angles ??= {})[variable.joint.id] = getCurrentJointAngleValue(
        variable.joint,
        overrides.angles ?? {},
      );
      return;
    }

    (overrides.quaternions ??= {})[variable.joint.id] = toQuaternionValue(
      getJointEffectiveQuaternion(variable.joint, overrides.quaternions ?? {}),
    );
  });

  let iterations = 0;
  let evaluation = computeClosedLoopErrorState(
    robot,
    parentJointByChild,
    motionConstraints,
    overrides,
  );

  while (
    iterations < maxIterations &&
    evaluation.residual > tolerance &&
    solverVariables.length > 0
  ) {
    const baseErrorVector = evaluation.vector;
    const variableCount = solverVariables.length;
    const currentAngleValues = new Map<string, number>();
    const currentBallQuaternions = new Map<string, THREE.Quaternion>();
    const jacobian = Array.from({ length: baseErrorVector.length }, () =>
      new Array<number>(variableCount).fill(0),
    );

    solverVariables.forEach((variable) => {
      if (variable.kind === 'angle') {
        currentAngleValues.set(
          variable.joint.id,
          getCurrentJointAngleValue(variable.joint, overrides.angles ?? {}),
        );
        return;
      }

      currentBallQuaternions.set(
        variable.joint.id,
        getJointEffectiveQuaternion(variable.joint, overrides.quaternions ?? {}),
      );
    });

    solverVariables.forEach((variable, variableIndex) => {
      resetClosedLoopSolverState(
        overrides,
        solverVariables,
        currentAngleValues,
        currentBallQuaternions,
      );

      if (variable.kind === 'angle') {
        const baseAngle = currentAngleValues.get(variable.joint.id);
        if (baseAngle == null) {
          return;
        }
        (overrides.angles ??= {})[variable.joint.id] = baseAngle + ANGLE_SOLVER_PERTURBATION;
      } else if (variable.axis) {
        const baseQuaternion = currentBallQuaternions.get(variable.joint.id);
        if (!baseQuaternion) {
          return;
        }
        setBallJointQuaternionOverride(
          variable.joint.id,
          baseQuaternion,
          variable.axis,
          ANGLE_SOLVER_PERTURBATION,
          overrides,
        );
      }

      const perturbed = computeClosedLoopErrorState(
        robot,
        parentJointByChild,
        motionConstraints,
        overrides,
      ).vector;

      for (let rowIndex = 0; rowIndex < baseErrorVector.length; rowIndex += 1) {
        jacobian[rowIndex][variableIndex] =
          ((perturbed[rowIndex] ?? 0) - (baseErrorVector[rowIndex] ?? 0)) /
          ANGLE_SOLVER_PERTURBATION;
      }
    });

    resetClosedLoopSolverState(
      overrides,
      solverVariables,
      currentAngleValues,
      currentBallQuaternions,
    );

    const normalMatrix = Array.from({ length: variableCount }, () =>
      new Array<number>(variableCount).fill(0),
    );
    const rhs = new Array<number>(variableCount).fill(0);

    for (let rowIndex = 0; rowIndex < variableCount; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < variableCount; columnIndex += 1) {
        let dotProduct = 0;
        for (let errorIndex = 0; errorIndex < baseErrorVector.length; errorIndex += 1) {
          dotProduct += jacobian[errorIndex][rowIndex] * jacobian[errorIndex][columnIndex];
        }
        normalMatrix[rowIndex][columnIndex] = dotProduct;
      }

      normalMatrix[rowIndex][rowIndex] += damping;
      let projectedError = 0;
      for (let errorIndex = 0; errorIndex < baseErrorVector.length; errorIndex += 1) {
        projectedError += jacobian[errorIndex][rowIndex] * (baseErrorVector[errorIndex] ?? 0);
      }
      rhs[rowIndex] = projectedError;
    }

    const rawDelta = solveLinearSystem(normalMatrix, rhs);
    const delta = rawDelta ? limitClosedLoopSolverDelta(rawDelta, maxVariableStep) : null;
    if (!delta) {
      break;
    }

    let nextEvaluation: ClosedLoopErrorState | null = null;
    let improved = false;

    for (let attempt = 0; attempt < CLOSED_LOOP_LINE_SEARCH_ATTEMPTS; attempt += 1) {
      const scale = 0.5 ** attempt;
      resetClosedLoopSolverState(
        overrides,
        solverVariables,
        currentAngleValues,
        currentBallQuaternions,
      );
      const changed = applyClosedLoopSolverStep(
        robot,
        solverVariables,
        overrides,
        currentAngleValues,
        currentBallQuaternions,
        delta,
        scale,
      );
      if (!changed) {
        continue;
      }

      const candidateEvaluation = computeClosedLoopErrorState(
        robot,
        parentJointByChild,
        motionConstraints,
        overrides,
      );
      if (candidateEvaluation.residual + 1e-12 < evaluation.residual) {
        nextEvaluation = candidateEvaluation;
        improved = true;
        break;
      }
    }

    if (!improved || !nextEvaluation) {
      resetClosedLoopSolverState(
        overrides,
        solverVariables,
        currentAngleValues,
        currentBallQuaternions,
      );
      break;
    }

    evaluation = nextEvaluation;
    iterations += 1;
  }

  applyClosedLoopBallJointCompensation(
    robot,
    parentJointByChild,
    motionConstraints,
    overrides,
    lockedJointIds,
  );
  evaluation = computeClosedLoopErrorState(robot, parentJointByChild, motionConstraints, overrides);
  const compensation = filterNoOpMotionCompensation(
    robot,
    stripLockedJointOverrides(overrides, lockedJointIds),
  );
  return {
    ...compensation,
    constraintErrors: evaluation.constraintErrors,
    residual: evaluation.residual,
    iterations,
    converged: evaluation.residual <= tolerance,
  };
}

export function resolveClosedLoopDrivenJointMotion(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'>,
  selectedJointId: string,
  selectedAngle: number,
  options: Omit<ClosedLoopDrivenJointMotionOptions, 'angles' | 'quaternions'> = {},
): ClosedLoopDrivenJointMotionResult {
  const selectedJoint = robot.joints[selectedJointId];
  if (!selectedJoint || !isSolvableJointType(selectedJoint)) {
    const drivenMotion = resolveMimicJointAngleTargets(robot, selectedJointId, selectedAngle);
    return {
      angles: drivenMotion.angles,
      quaternions: {},
      appliedAngle: drivenMotion.angles[selectedJointId] ?? selectedAngle,
      requestedAngle: selectedAngle,
      constrained: false,
      constraintErrors: {},
      residual: 0,
      iterations: 0,
      converged: true,
    };
  }

  const tolerance = options.tolerance ?? ANGLE_SOLVER_TOLERANCE;
  const normalizedSelectedAngle = options.ignoreLimits
    ? selectedAngle
    : clampSolvedAngle(selectedJoint, selectedAngle, selectedAngle);
  const preferredLockedPassiveSpringJointIds = collectPreferredLockedPassiveSpringJointIds(
    robot,
    selectedJointId,
    normalizedSelectedAngle,
  );
  const preferredDirectResult =
    preferredLockedPassiveSpringJointIds.length > 0
      ? evaluateDrivenJointMotion(
          robot,
          selectedJointId,
          normalizedSelectedAngle,
          options,
          preferredLockedPassiveSpringJointIds,
        )
      : null;
  const directResult =
    preferredDirectResult && isFeasibleDrivenJointMotion(preferredDirectResult, tolerance)
      ? preferredDirectResult
      : evaluateDrivenJointMotion(
          robot,
          selectedJointId,
          normalizedSelectedAngle,
          options,
        );
  const shouldPreferLockedPassiveSpringJoints =
    preferredLockedPassiveSpringJointIds.length > 0 &&
    (preferredDirectResult === directResult ||
      !isFeasibleDrivenJointMotion(directResult, tolerance));
  const evaluatePreferredDrivenJointMotion = (angle: number): ClosedLoopDrivenJointMotionResult =>
    shouldPreferLockedPassiveSpringJoints
      ? evaluateDrivenJointMotion(
          robot,
          selectedJointId,
          angle,
          options,
          preferredLockedPassiveSpringJointIds,
        )
      : evaluateDrivenJointMotion(
          robot,
          selectedJointId,
          angle,
          options,
        );

  if (
    preferredDirectResult &&
    !isFeasibleDrivenJointMotion(preferredDirectResult, tolerance) &&
    isFeasibleDrivenJointMotion(directResult, tolerance)
  ) {
    const currentSelectedAngle = getCurrentJointAngleValue(selectedJoint, {});
    const preferredCurrentResult = evaluateDrivenJointMotion(
      robot,
      selectedJointId,
      currentSelectedAngle,
      options,
      preferredLockedPassiveSpringJointIds,
    );
    if (isFeasibleDrivenJointMotion(preferredCurrentResult, tolerance)) {
      let feasibleAngle = currentSelectedAngle;
      let infeasibleAngle = normalizedSelectedAngle;
      let bestResult = preferredCurrentResult;

      for (let iteration = 0; iteration < DRIVEN_JOINT_PROJECTION_ITERATIONS; iteration += 1) {
        const candidateAngle = (feasibleAngle + infeasibleAngle) * 0.5;
        const candidateResult = evaluateDrivenJointMotion(
          robot,
          selectedJointId,
          candidateAngle,
          options,
          preferredLockedPassiveSpringJointIds,
        );

        if (isFeasibleDrivenJointMotion(candidateResult, tolerance)) {
          feasibleAngle = candidateAngle;
          bestResult = candidateResult;
        } else {
          infeasibleAngle = candidateAngle;
        }

        if (Math.abs(infeasibleAngle - feasibleAngle) <= DRIVEN_JOINT_PROJECTION_EPSILON) {
          break;
        }
      }

      return {
        ...bestResult,
        constrained:
          Math.abs(bestResult.appliedAngle - selectedAngle) > DRIVEN_JOINT_PROJECTION_EPSILON,
      };
    }
  }

  const directResultForProjection = directResult;

  if (
    !robot.closedLoopConstraints?.length ||
    isFeasibleDrivenJointMotion(directResultForProjection, tolerance)
  ) {
    return {
      ...directResultForProjection,
      constrained:
        Math.abs(directResultForProjection.appliedAngle - selectedAngle) >
        DRIVEN_JOINT_PROJECTION_EPSILON,
    };
  }

  const currentSelectedAngle = getCurrentJointAngleValue(selectedJoint, {});
  if (Math.abs(normalizedSelectedAngle - currentSelectedAngle) <= DRIVEN_JOINT_PROJECTION_EPSILON) {
    return {
      ...directResultForProjection,
      constrained:
        Math.abs(directResultForProjection.appliedAngle - selectedAngle) >
        DRIVEN_JOINT_PROJECTION_EPSILON,
    };
  }

  const currentResult = evaluatePreferredDrivenJointMotion(currentSelectedAngle);
  if (!isFeasibleDrivenJointMotion(currentResult, tolerance)) {
    return {
      ...directResultForProjection,
      constrained:
        Math.abs(directResultForProjection.appliedAngle - selectedAngle) >
        DRIVEN_JOINT_PROJECTION_EPSILON,
    };
  }

  let feasibleAngle = currentSelectedAngle;
  let infeasibleAngle = normalizedSelectedAngle;
  let bestResult = currentResult;

  for (let iteration = 0; iteration < DRIVEN_JOINT_PROJECTION_ITERATIONS; iteration += 1) {
    const candidateAngle = (feasibleAngle + infeasibleAngle) * 0.5;
    const candidateResult = evaluatePreferredDrivenJointMotion(candidateAngle);

    if (isFeasibleDrivenJointMotion(candidateResult, tolerance)) {
      feasibleAngle = candidateAngle;
      bestResult = candidateResult;
    } else {
      infeasibleAngle = candidateAngle;
    }

    if (Math.abs(infeasibleAngle - feasibleAngle) <= DRIVEN_JOINT_PROJECTION_EPSILON) {
      break;
    }
  }

  return {
    ...bestResult,
    constrained:
      Math.abs(bestResult.appliedAngle - selectedAngle) > DRIVEN_JOINT_PROJECTION_EPSILON,
  };
}

export function resolveClosedLoopJointMotionCompensation(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'>,
  selectedJointId: string,
  selectedAngle: number,
): ClosedLoopMotionCompensation {
  const solution = resolveClosedLoopDrivenJointMotion(robot, selectedJointId, selectedAngle);

  return {
    angles: solution.angles,
    quaternions: solution.quaternions,
  };
}

export function resolveClosedLoopJointAngleCompensation(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'>,
  selectedJointId: string,
  selectedAngle: number,
): JointAngleOverrideMap {
  return resolveClosedLoopJointMotionCompensation(robot, selectedJointId, selectedAngle).angles;
}

export function createRobotClosedLoopConstraint(
  id: string,
  linkAId: string,
  linkBId: string,
  anchorLocalA: { x: number; y: number; z: number },
  anchorLocalB: { x: number; y: number; z: number },
  anchorWorld: { x: number; y: number; z: number },
  source?: RobotClosedLoopConstraint['source'],
): RobotClosedLoopConstraint {
  return {
    id,
    type: 'connect',
    linkAId,
    linkBId,
    anchorLocalA,
    anchorLocalB,
    anchorWorld,
    source,
  };
}

export function createRobotDistanceClosedLoopConstraint(
  id: string,
  linkAId: string,
  linkBId: string,
  anchorLocalA: { x: number; y: number; z: number },
  anchorLocalB: { x: number; y: number; z: number },
  anchorWorld: { x: number; y: number; z: number },
  restDistance: number,
  source?: RobotClosedLoopDistanceConstraint['source'],
): RobotClosedLoopDistanceConstraint {
  return {
    id,
    type: 'distance',
    linkAId,
    linkBId,
    anchorLocalA,
    anchorLocalB,
    anchorWorld,
    restDistance,
    source,
  };
}
