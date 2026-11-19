import * as THREE from 'three';
import { getLowestMeshZ } from '@/shared/utils';

const PRESERVE_AUTHORED_ROOT_TRANSFORM_KEY = '__preserveAuthoredRootTransform';
const INITIAL_GROUND_ALIGNMENT_KEY = '__initialGroundAlignmentDone';

export function getRobotGroundOffset(robot: THREE.Object3D): number | null {
  let minZ = getLowestMeshZ(robot, {
    includeInvisible: false,
    includeVisual: true,
    includeCollision: false,
  });

  if (minZ === null) {
    minZ = getLowestMeshZ(robot, {
      includeInvisible: true,
      includeVisual: true,
      includeCollision: false,
    });
  }

  return minZ;
}

export function setPreserveAuthoredRootTransform(robot: THREE.Object3D, preserve: boolean): void {
  if (preserve) {
    robot.userData[PRESERVE_AUTHORED_ROOT_TRANSFORM_KEY] = true;
    return;
  }

  delete robot.userData[PRESERVE_AUTHORED_ROOT_TRANSFORM_KEY];
}

export function shouldPreserveAuthoredRootTransform(
  robot: THREE.Object3D | null | undefined,
): boolean {
  return robot?.userData?.[PRESERVE_AUTHORED_ROOT_TRANSFORM_KEY] === true;
}

export function copyRobotRootTransform(
  source: THREE.Object3D | null | undefined,
  target: THREE.Object3D,
): boolean {
  if (!source) {
    return false;
  }

  target.position.copy(source.position);
  target.quaternion.copy(source.quaternion);
  target.scale.copy(source.scale);
  target.updateMatrixWorld(true);
  setInitialGroundAlignment(target, hasInitialGroundAlignment(source));
  setPreserveAuthoredRootTransform(target, shouldPreserveAuthoredRootTransform(source));
  return true;
}

export function hasInitialGroundAlignment(robot: THREE.Object3D | null | undefined): boolean {
  return robot?.userData?.[INITIAL_GROUND_ALIGNMENT_KEY] === true;
}

export function setInitialGroundAlignment(robot: THREE.Object3D, aligned: boolean): void {
  if (aligned) {
    robot.userData[INITIAL_GROUND_ALIGNMENT_KEY] = true;
    return;
  }

  delete robot.userData[INITIAL_GROUND_ALIGNMENT_KEY];
}

export function beginInitialGroundAlignment(robot: THREE.Object3D | null | undefined): boolean {
  if (!robot || hasInitialGroundAlignment(robot)) {
    return false;
  }

  setInitialGroundAlignment(robot, true);
  return true;
}

export function alignRobotToGroundBeforeFirstMount(robot: THREE.Object3D, targetZ = 0): boolean {
  if (shouldPreserveAuthoredRootTransform(robot)) {
    // Authored world placement owns the height (e.g. an MJCF scene with its own
    // floor). Mark alignment done so scheduled passes do not ground it either.
    setInitialGroundAlignment(robot, true);
    return true;
  }

  const minZ = getRobotGroundOffset(robot);
  if (minZ === null) {
    return false;
  }

  robot.position.z += targetZ - minZ;
  robot.updateMatrixWorld(true);
  setInitialGroundAlignment(robot, true);
  return true;
}

/**
 * Align the rendered robot so its lowest visible visual geometry rests on the target plane.
 * This keeps the grid/canvas stable while switching assets with different authoring origins.
 */
export function offsetRobotToGround(robot: THREE.Object3D, targetZ = 0): void {
  if (shouldPreserveAuthoredRootTransform(robot)) {
    return;
  }

  const minZ = getRobotGroundOffset(robot);
  if (minZ === null) {
    return;
  }

  robot.position.z += targetZ - minZ;
  robot.updateMatrixWorld(true);
}
