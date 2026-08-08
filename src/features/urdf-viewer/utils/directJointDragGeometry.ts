import * as THREE from 'three';
import {
  resolveRevoluteDragDelta,
  resolveRevoluteTangentAngleDelta,
} from './jointDragDelta';
import type { DraggableRuntimeJoint } from './directJointDragJointResolver';

export const JOINT_DRAG_EPSILON = 1e-5;

const MAX_REVOLUTE_DELTA_PER_INPUT = Math.PI;

/** Reuses scratch vectors while resolving pointer-ray motion in a joint's world frame. */
export function createDirectJointDragGeometry(camera: THREE.Camera) {
  const tempWorldQuat = new THREE.Quaternion();
  const tempAxisWorld = new THREE.Vector3();
  const tempPivotPoint = new THREE.Vector3();
  const tempPlane = new THREE.Plane();
  const tempProjStart = new THREE.Vector3();
  const tempProjEnd = new THREE.Vector3();
  const tempCross = new THREE.Vector3();
  const tempDelta = new THREE.Vector3();
  const tempTangentWorld = new THREE.Vector3();
  const tempCameraView = new THREE.Vector3();
  const tempCameraForward = new THREE.Vector3();
  const defaultAxis = new THREE.Vector3(0, 0, 1);

  const syncJointWorldFrame = (joint: DraggableRuntimeJoint) => {
    joint.getWorldQuaternion(tempWorldQuat);
    tempAxisWorld
      .copy(joint.axis ?? defaultAxis)
      .applyQuaternion(tempWorldQuat)
      .normalize();
    tempPivotPoint.setFromMatrixPosition(joint.matrixWorld);
  };

  const resolveRevoluteDelta = (
    joint: DraggableRuntimeJoint,
    startPoint: THREE.Vector3,
    endPoint: THREE.Vector3,
  ): number => {
    syncJointWorldFrame(joint);
    tempPlane.setFromNormalAndCoplanarPoint(tempAxisWorld, tempPivotPoint);
    tempPlane.projectPoint(startPoint, tempProjStart);
    tempPlane.projectPoint(endPoint, tempProjEnd);
    tempProjStart.sub(tempPivotPoint);
    tempProjEnd.sub(tempPivotPoint);

    if (
      tempProjStart.lengthSq() <= JOINT_DRAG_EPSILON ||
      tempProjEnd.lengthSq() <= JOINT_DRAG_EPSILON
    ) {
      return 0;
    }

    tempCross.crossVectors(tempProjStart, tempProjEnd);
    const worldDelta = Math.atan2(
      tempCross.dot(tempAxisWorld),
      tempProjStart.dot(tempProjEnd),
    );
    tempCameraView.copy(camera.position).sub(startPoint);
    if (tempCameraView.lengthSq() <= JOINT_DRAG_EPSILON) {
      camera.getWorldDirection(tempCameraView).multiplyScalar(-1);
    } else {
      tempCameraView.normalize();
    }

    camera.getWorldDirection(tempCameraForward);
    tempTangentWorld.copy(tempCameraForward).cross(tempAxisWorld);
    const tangentDistance =
      tempTangentWorld.lengthSq() > JOINT_DRAG_EPSILON
        ? tempTangentWorld.normalize().dot(tempDelta.subVectors(endPoint, startPoint))
        : 0;
    const tangentDelta =
      Math.abs(tangentDistance) > JOINT_DRAG_EPSILON
        ? resolveRevoluteTangentAngleDelta({
            tangentDistance,
            startRadius: tempProjStart.length(),
            endRadius: tempProjEnd.length(),
            epsilon: JOINT_DRAG_EPSILON,
          })
        : 0;

    return resolveRevoluteDragDelta({
      worldDelta,
      tangentDelta,
      planeFacingRatio: Math.abs(tempCameraView.dot(tempAxisWorld)),
      epsilon: JOINT_DRAG_EPSILON,
      maxDelta: MAX_REVOLUTE_DELTA_PER_INPUT,
    });
  };

  const resolvePrismaticDelta = (
    joint: DraggableRuntimeJoint,
    startPoint: THREE.Vector3,
    endPoint: THREE.Vector3,
  ): number => {
    syncJointWorldFrame(joint);
    tempDelta.subVectors(endPoint, startPoint);
    return tempDelta.dot(tempAxisWorld);
  };

  return { resolvePrismaticDelta, resolveRevoluteDelta };
}
