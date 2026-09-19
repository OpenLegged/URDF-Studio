import * as THREE from 'three';

import type { RobotClosedLoopJointConstraint } from '@/types';
import { getNormalizedJointAxis } from './kinematics';

interface JointConstraintPose {
  anchorA: THREE.Vector3;
  anchorB: THREE.Vector3;
  frameQuaternion: THREE.Quaternion;
  originQuaternion: THREE.Quaternion;
  relativeQuaternion: THREE.Quaternion;
  displacement: THREE.Vector3;
  allowedQuaternion: THREE.Quaternion;
  allowedDisplacement: THREE.Vector3;
}

function getOriginQuaternion(constraint: RobotClosedLoopJointConstraint): THREE.Quaternion {
  const quaternion = constraint.origin?.quatXyzw;
  if (quaternion) {
    return new THREE.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w).normalize();
  }
  const rpy = constraint.origin?.rpy;
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rpy?.r ?? 0, rpy?.p ?? 0, rpy?.y ?? 0, 'ZYX'),
  );
}

function clampJointCoordinate(value: number, constraint: RobotClosedLoopJointConstraint): number {
  const lower = constraint.limit?.lower;
  const upper = constraint.limit?.upper;
  return Math.max(
    Number.isFinite(lower) ? lower! : -Infinity,
    Math.min(Number.isFinite(upper) ? upper! : Infinity, value),
  );
}

function getAllowedTwist(
  relative: THREE.Quaternion,
  axis: THREE.Vector3,
  constraint: RobotClosedLoopJointConstraint,
): THREE.Quaternion {
  const projected = relative.x * axis.x + relative.y * axis.y + relative.z * axis.z;
  const twist = new THREE.Quaternion(axis.x * projected, axis.y * projected, axis.z * projected, relative.w);
  if (twist.lengthSq() < 1e-20) {
    twist.identity();
  } else {
    twist.normalize();
  }
  let angle = 2 * Math.atan2(twist.x * axis.x + twist.y * axis.y + twist.z * axis.z, twist.w);
  angle = Math.atan2(Math.sin(angle), Math.cos(angle));
  if (constraint.jointType === 'revolute') {
    // A body pose determines rotation modulo 2π. Pick the equivalent angle
    // nearest the authored interval, including intervals outside [-π, π].
    const lower = constraint.limit?.lower;
    const upper = constraint.limit?.upper;
    const reference = Number.isFinite(lower) && Number.isFinite(upper)
      ? (lower! + upper!) / 2
      : Number.isFinite(lower) ? lower! : Number.isFinite(upper) ? upper! : angle;
    angle += Math.round((reference - angle) / (2 * Math.PI)) * 2 * Math.PI;
    angle = clampJointCoordinate(angle, constraint);
  }
  return new THREE.Quaternion().setFromAxisAngle(axis, angle);
}

function getJointConstraintPose(
  constraint: RobotClosedLoopJointConstraint,
  matrixA: THREE.Matrix4,
  matrixB: THREE.Matrix4,
): JointConstraintPose {
  const anchorA = new THREE.Vector3().copy(constraint.anchorLocalA).applyMatrix4(matrixA);
  const anchorB = new THREE.Vector3().copy(constraint.anchorLocalB).applyMatrix4(matrixB);
  const quaternionA = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(matrixA));
  const quaternionB = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(matrixB));
  const originQuaternion = getOriginQuaternion(constraint);
  const frameQuaternion = quaternionA.multiply(originQuaternion);
  const frameInverse = frameQuaternion.clone().invert();
  const relativeQuaternion = frameInverse.clone().multiply(quaternionB).normalize();
  const displacement = anchorB.clone().sub(anchorA).applyQuaternion(frameInverse);
  const allowedDisplacement = new THREE.Vector3();
  const allowedQuaternion = new THREE.Quaternion();
  const axis = getNormalizedJointAxis(constraint);

  switch (constraint.jointType) {
    case 'revolute':
    case 'continuous':
      allowedQuaternion.copy(getAllowedTwist(relativeQuaternion, axis, constraint));
      break;
    case 'prismatic':
      allowedDisplacement.copy(axis).multiplyScalar(clampJointCoordinate(displacement.dot(axis), constraint));
      break;
    case 'ball':
      allowedQuaternion.copy(relativeQuaternion);
      break;
    case 'planar':
      allowedDisplacement.copy(displacement).addScaledVector(axis, -displacement.dot(axis));
      allowedQuaternion.copy(getAllowedTwist(relativeQuaternion, axis, constraint));
      break;
    case 'floating':
      allowedDisplacement.copy(displacement);
      allowedQuaternion.copy(relativeQuaternion);
      break;
    case 'fixed':
      break;
  }

  return { anchorA, anchorB, frameQuaternion, originQuaternion, relativeQuaternion,
    displacement, allowedQuaternion, allowedDisplacement };
}

function quaternionRotationVector(quaternion: THREE.Quaternion): THREE.Vector3 {
  const sign = quaternion.w < 0 ? -1 : 1;
  const vector = new THREE.Vector3(quaternion.x * sign, quaternion.y * sign, quaternion.z * sign);
  const sine = vector.length();
  return sine < 1e-12
    ? vector.multiplyScalar(2)
    : vector.multiplyScalar(2 * Math.atan2(sine, quaternion.w * sign) / sine);
}

/** Residuals use joint-frame metres and radians; free joint coordinates contribute zero. */
export function computeClosedLoopJointResidual(
  constraint: RobotClosedLoopJointConstraint,
  matrixA: THREE.Matrix4,
  matrixB: THREE.Matrix4,
): number[] {
  const pose = getJointConstraintPose(constraint, matrixA, matrixB);
  const translation = pose.displacement.sub(pose.allowedDisplacement);
  const rotation = quaternionRotationVector(
    pose.allowedQuaternion.invert().multiply(pose.relativeQuaternion).normalize(),
  );
  return [translation.x, translation.y, translation.z, rotation.x, rotation.y, rotation.z];
}

/** Move one endpoint to the nearest legal joint pose while preserving its free coordinates. */
export function projectClosedLoopJointEndpoint(
  constraint: RobotClosedLoopJointConstraint,
  matrixA: THREE.Matrix4,
  matrixB: THREE.Matrix4,
  dependentEndpoint: 'A' | 'B',
): THREE.Matrix4 {
  const pose = getJointConstraintPose(constraint, matrixA, matrixB);
  const quaternion = dependentEndpoint === 'B'
    ? pose.frameQuaternion.clone().multiply(pose.allowedQuaternion)
    : new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(matrixB))
      .multiply(pose.allowedQuaternion.clone().invert()).multiply(pose.originQuaternion.clone().invert());
  const frameQuaternion = dependentEndpoint === 'B'
    ? pose.frameQuaternion
    : quaternion.clone().multiply(pose.originQuaternion);
  const displacementWorld = pose.allowedDisplacement.applyQuaternion(frameQuaternion);
  const anchor = dependentEndpoint === 'B'
    ? pose.anchorA.add(displacementWorld)
    : pose.anchorB.sub(displacementWorld);
  const dependentMatrix = dependentEndpoint === 'B' ? matrixB : matrixA;
  const scale = new THREE.Vector3().setFromMatrixScale(dependentMatrix);
  const localAnchor = dependentEndpoint === 'B' ? constraint.anchorLocalB : constraint.anchorLocalA;
  const position = anchor.sub(new THREE.Vector3().copy(localAnchor).multiply(scale).applyQuaternion(quaternion));
  return new THREE.Matrix4().compose(position, quaternion, scale);
}
