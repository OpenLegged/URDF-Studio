import * as THREE from 'three';

import type { UrdfJoint } from '../../../types/index.ts';

export type UsdJointAxisToken = 'X' | 'Y' | 'Z';

export const normalizeUsdJointAxisToken = (value: unknown): UsdJointAxisToken | null => {
  const normalized = String(value || '')
    .trim()
    .toUpperCase();
  return normalized === 'X' || normalized === 'Y' || normalized === 'Z' ? normalized : null;
};

export const getAxisVector = (
  axis: THREE.Vector3 | UrdfJoint['axis'] | undefined,
): THREE.Vector3 => {
  return axis
    ? new THREE.Vector3(axis.x ?? 0, axis.y ?? 0, axis.z ?? 0)
    : new THREE.Vector3(1, 0, 0);
};

export const getAxisToken = (
  axis: THREE.Vector3 | UrdfJoint['axis'] | undefined,
): UsdJointAxisToken => {
  const vector = getAxisVector(axis);

  if (!Number.isFinite(vector.lengthSq()) || vector.lengthSq() <= 1e-12) {
    return 'X';
  }

  const abs = {
    x: Math.abs(vector.x),
    y: Math.abs(vector.y),
    z: Math.abs(vector.z),
  };

  if (abs.y >= abs.x && abs.y >= abs.z) return 'Y';
  if (abs.z >= abs.x && abs.z >= abs.y) return 'Z';
  return 'X';
};

export const getAxisTokenVector = (axisToken: UsdJointAxisToken): THREE.Vector3 => {
  if (axisToken === 'Y') {
    return new THREE.Vector3(0, 1, 0);
  }
  if (axisToken === 'Z') {
    return new THREE.Vector3(0, 0, 1);
  }
  return new THREE.Vector3(1, 0, 0);
};

export const createJointAxisAlignmentQuaternion = (
  axis: THREE.Vector3 | UrdfJoint['axis'] | undefined,
  axisToken: UsdJointAxisToken,
): THREE.Quaternion => {
  const canonicalAxis = getAxisTokenVector(axisToken);
  const targetAxis = getAxisVector(axis);
  if (!Number.isFinite(targetAxis.lengthSq()) || targetAxis.lengthSq() <= 1e-12) {
    targetAxis.copy(canonicalAxis);
  } else {
    targetAxis.normalize();
  }

  return new THREE.Quaternion().setFromUnitVectors(canonicalAxis, targetAxis).normalize();
};