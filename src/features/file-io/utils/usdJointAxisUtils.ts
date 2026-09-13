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

  const abs = {
    x: Math.abs(vector.x),
    y: Math.abs(vector.y),
    z: Math.abs(vector.z),
  };

  const magnitude = Math.max(abs.x, abs.y, abs.z);
  if (!Number.isFinite(magnitude) || magnitude === 0) return 'X';

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
  const scale = Math.max(Math.abs(targetAxis.x), Math.abs(targetAxis.y), Math.abs(targetAxis.z));
  if (!Number.isFinite(scale) || scale === 0) {
    targetAxis.copy(canonicalAxis);
  } else {
    // Scale first so valid non-unit axes neither underflow nor overflow when
    // Three.js computes the squared length during normalization.
    targetAxis.set(targetAxis.x / scale, targetAxis.y / scale, targetAxis.z / scale).normalize();
  }

  return new THREE.Quaternion().setFromUnitVectors(canonicalAxis, targetAxis).normalize();
};