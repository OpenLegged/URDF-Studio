import * as THREE from 'three';

import type { Euler, JointQuaternion, RobotData, UrdfJoint } from '@/types';

const UNIT_SCALE = new THREE.Vector3(1, 1, 1);
const JOINT_AXIS_EPSILON_SQ = 1e-12;
const USD_JOINT_PIVOT_EPSILON_SQ = 1e-24;

export type JointOriginOverrideMap = Record<string, UrdfJoint['origin']>;
export type JointAngleOverrideMap = Record<string, number>;
export type JointQuaternionOverrideMap = Record<string, JointQuaternion>;

export interface JointKinematicOverrideMap {
  origins?: JointOriginOverrideMap;
  angles?: JointAngleOverrideMap;
  quaternions?: JointQuaternionOverrideMap;
}

export function createOriginMatrix(origin?: {
  xyz?: { x?: number; y?: number; z?: number };
  rpy?: Euler;
}): THREE.Matrix4 {
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3(origin?.xyz?.x ?? 0, origin?.xyz?.y ?? 0, origin?.xyz?.z ?? 0);
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(origin?.rpy?.r ?? 0, origin?.rpy?.p ?? 0, origin?.rpy?.y ?? 0, 'ZYX'),
  );

  matrix.compose(position, quaternion, UNIT_SCALE);
  return matrix;
}

export function getJointReferencePosition(joint: Pick<UrdfJoint, 'referencePosition'>): number {
  return Number.isFinite(joint.referencePosition) ? joint.referencePosition! : 0;
}

export function getNormalizedJointAxis(joint: Pick<UrdfJoint, 'axis'>): THREE.Vector3 {
  const axisVector = new THREE.Vector3(joint.axis?.x ?? 0, joint.axis?.y ?? 0, joint.axis?.z ?? 1);
  if (axisVector.lengthSq() <= JOINT_AXIS_EPSILON_SQ) {
    return new THREE.Vector3(0, 0, 1);
  }

  return axisVector.normalize();
}

/**
 * USD Physics keeps a joint frame on both connected bodies. The adapter stores
 * the zero-pose body transform in `joint.origin`, so motion must still be
 * conjugated around the child-body joint position (`localPos1`).
 */
export function getUsdJointMotionPivot(
  joint: Pick<UrdfJoint, 'type' | 'usdPhysics'>,
): THREE.Vector3 | null {
  if (joint.type === 'fixed') {
    return null;
  }

  const source = joint.usdPhysics?.localPos1;
  if (!source) {
    return null;
  }

  const pivot = new THREE.Vector3(Number(source.x), Number(source.y), Number(source.z));
  if (
    !Number.isFinite(pivot.x) ||
    !Number.isFinite(pivot.y) ||
    !Number.isFinite(pivot.z) ||
    pivot.lengthSq() <= USD_JOINT_PIVOT_EPSILON_SQ
  ) {
    return null;
  }

  return pivot;
}

export function getJointMotionAngleFromActualAngle(
  joint: Pick<UrdfJoint, 'referencePosition'>,
  actualAngle: number,
): number {
  return actualAngle - getJointReferencePosition(joint);
}

export function getJointActualAngleFromMotionAngle(
  joint: Pick<UrdfJoint, 'referencePosition'>,
  motionAngle: number,
): number {
  return motionAngle + getJointReferencePosition(joint);
}

export function extractSignedAngleAroundAxis(
  quaternion: THREE.Quaternion,
  axis: THREE.Vector3,
): number {
  const normalizedQuaternion = quaternion.clone().normalize();
  const normalizedAxis =
    axis.lengthSq() <= JOINT_AXIS_EPSILON_SQ
      ? new THREE.Vector3(0, 0, 1)
      : axis.clone().normalize();
  const vectorPart = new THREE.Vector3(
    normalizedQuaternion.x,
    normalizedQuaternion.y,
    normalizedQuaternion.z,
  );
  return 2 * Math.atan2(vectorPart.dot(normalizedAxis), normalizedQuaternion.w);
}

export function extractJointMotionAngleFromQuaternion(
  joint: Pick<UrdfJoint, 'axis'>,
  quaternion: THREE.Quaternion,
): number {
  return extractSignedAngleAroundAxis(quaternion, getNormalizedJointAxis(joint));
}

export function extractJointActualAngleFromQuaternion(
  joint: Pick<UrdfJoint, 'axis' | 'referencePosition'>,
  quaternion: THREE.Quaternion,
): number {
  return getJointActualAngleFromMotionAngle(
    joint,
    extractJointMotionAngleFromQuaternion(joint, quaternion),
  );
}

export function getJointEffectiveAngle(
  joint: UrdfJoint,
  angleOverrides: JointAngleOverrideMap = {},
): number {
  const override = angleOverrides[joint.id];

  if (Number.isFinite(override)) {
    return getJointMotionAngleFromActualAngle(joint, override);
  }

  return getJointMotionAngleFromActualAngle(joint, Number.isFinite(joint.angle) ? joint.angle! : 0);
}

function toThreeQuaternion(quaternion?: JointQuaternion): THREE.Quaternion {
  return new THREE.Quaternion(
    quaternion?.x ?? 0,
    quaternion?.y ?? 0,
    quaternion?.z ?? 0,
    quaternion?.w ?? 1,
  ).normalize();
}

export function getJointEffectiveQuaternion(
  joint: UrdfJoint,
  quaternionOverrides: JointQuaternionOverrideMap = {},
): THREE.Quaternion {
  const override = quaternionOverrides[joint.id];
  if (override) {
    return toThreeQuaternion(override);
  }

  if (joint.quaternion) {
    return toThreeQuaternion(joint.quaternion);
  }

  return new THREE.Quaternion();
}

export function getJointMotionPose(
  joint: UrdfJoint,
  overrides: JointKinematicOverrideMap = {},
): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  createJointMotionMatrix(joint, overrides).decompose(position, quaternion, scale);
  return { position, quaternion };
}

export function createJointMotionMatrix(
  joint: UrdfJoint,
  overrides: JointKinematicOverrideMap = {},
): THREE.Matrix4 {
  const matrix = new THREE.Matrix4().identity();
  const angle = getJointEffectiveAngle(joint, overrides.angles ?? {});

  if (joint.type === 'revolute' || joint.type === 'continuous') {
    if (Math.abs(angle) > 1e-12) {
      matrix.makeRotationAxis(getNormalizedJointAxis(joint), angle);
    }
  } else if (joint.type === 'ball') {
    matrix.makeRotationFromQuaternion(
      getJointEffectiveQuaternion(joint, overrides.quaternions ?? {}),
    );
  } else if (joint.type === 'prismatic') {
    if (Math.abs(angle) > 1e-12) {
      const axisVector = getNormalizedJointAxis(joint).multiplyScalar(angle);
      matrix.makeTranslation(axisVector.x, axisVector.y, axisVector.z);
    }
  }

  const usdPivot = getUsdJointMotionPivot(joint);
  if (usdPivot) {
    matrix.premultiply(new THREE.Matrix4().makeTranslation(usdPivot.x, usdPivot.y, usdPivot.z));
    matrix.multiply(new THREE.Matrix4().makeTranslation(-usdPivot.x, -usdPivot.y, -usdPivot.z));
  }

  return matrix;
}

export function getParentJointByChildLink(
  robot: Pick<RobotData, 'joints'>,
): Map<string, UrdfJoint> {
  const parentJointByChild = new Map<string, UrdfJoint>();
  Object.values(robot.joints).forEach((joint) => {
    parentJointByChild.set(joint.childLinkId, joint);
  });
  return parentJointByChild;
}

export function getChildJointsByParentLink(
  robot: Pick<RobotData, 'joints'>,
): Map<string, UrdfJoint[]> {
  const childJointsByParent = new Map<string, UrdfJoint[]>();

  Object.values(robot.joints).forEach((joint) => {
    const siblings = childJointsByParent.get(joint.parentLinkId) ?? [];
    siblings.push(joint);
    childJointsByParent.set(joint.parentLinkId, siblings);
  });

  return childJointsByParent;
}

export function computeLinkWorldMatrices(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId'>,
  overrides: JointKinematicOverrideMap = {},
): Record<string, THREE.Matrix4> {
  const linkMatrices: Record<string, THREE.Matrix4> = {};
  const childJointsByParent = getChildJointsByParentLink(robot);
  const childLinkIds = new Set<string>();
  const originOverrides = overrides.origins ?? {};

  Object.values(robot.joints).forEach((joint) => {
    childLinkIds.add(joint.childLinkId);
  });

  const visit = (linkId: string, parentMatrix: THREE.Matrix4) => {
    if (linkMatrices[linkId]) {
      return;
    }

    linkMatrices[linkId] = parentMatrix.clone();
    const childJoints = childJointsByParent.get(linkId) ?? [];

    childJoints.forEach((joint) => {
      const nextOrigin = originOverrides[joint.id] ?? joint.origin;
      const childMatrix = parentMatrix
        .clone()
        .multiply(createOriginMatrix(nextOrigin))
        .multiply(createJointMotionMatrix(joint, overrides));
      visit(joint.childLinkId, childMatrix);
    });
  };

  const rootCandidates = [
    robot.rootLinkId,
    ...Object.keys(robot.links).filter((linkId) => !childLinkIds.has(linkId)),
    ...Object.keys(robot.links),
  ].filter(
    (linkId, index, values): linkId is string =>
      Boolean(linkId) && values.indexOf(linkId) === index,
  );

  rootCandidates.forEach((rootLinkId) => {
    visit(rootLinkId, new THREE.Matrix4().identity());
  });

  return linkMatrices;
}
