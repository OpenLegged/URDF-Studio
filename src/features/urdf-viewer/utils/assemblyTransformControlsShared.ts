import * as THREE from 'three';

import type { UrdfOrigin } from '@/types';

export interface TransformPivotDragSnapshot {
  pivotWorldMatrix: THREE.Matrix4;
  targetWorldMatrix: THREE.Matrix4;
}

function isFiniteVector3(vector: THREE.Vector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

function resolveParentInverse(object: THREE.Object3D): THREE.Matrix4 | null {
  if (!object.parent) {
    return new THREE.Matrix4();
  }

  object.parent.updateWorldMatrix(true, false);
  if (Math.abs(object.parent.matrixWorld.determinant()) < Number.EPSILON) {
    return null;
  }
  return object.parent.matrixWorld.clone().invert();
}

/**
 * Place a scene-level transform proxy at the center of world-space visible bounds
 * while preserving the selected object's world orientation and scale.
 */
export function alignTransformPivotToBoundsCenter(
  pivot: THREE.Object3D,
  target: THREE.Object3D,
  worldBounds: THREE.Box3,
): boolean {
  if (worldBounds.isEmpty()) {
    return false;
  }

  const center = worldBounds.getCenter(new THREE.Vector3());
  if (!isFiniteVector3(center)) {
    return false;
  }

  target.updateWorldMatrix(true, true);
  const worldQuaternion = target.getWorldQuaternion(new THREE.Quaternion());
  const worldScale = target.getWorldScale(new THREE.Vector3());
  if (!isFiniteVector3(worldScale)) {
    return false;
  }

  const parentInverse = resolveParentInverse(pivot);
  if (!parentInverse) {
    return false;
  }

  const pivotLocalMatrix = parentInverse.multiply(
    new THREE.Matrix4().compose(center, worldQuaternion, worldScale),
  );
  pivotLocalMatrix.decompose(pivot.position, pivot.quaternion, pivot.scale);
  pivot.updateMatrix();
  pivot.updateWorldMatrix(false, true);
  return true;
}

export function captureTransformPivotDrag(
  pivot: THREE.Object3D,
  target: THREE.Object3D,
): TransformPivotDragSnapshot | null {
  pivot.updateWorldMatrix(true, false);
  target.updateWorldMatrix(true, true);
  if (Math.abs(pivot.matrixWorld.determinant()) < Number.EPSILON) {
    return null;
  }

  return {
    pivotWorldMatrix: pivot.matrixWorld.clone(),
    targetWorldMatrix: target.matrixWorld.clone(),
  };
}

/**
 * Apply a transform proxy's world-space delta to the selected object. Keeping
 * the proxy separate lets the gizmo rotate around the visible-bounds center
 * without changing the selected object's canonical local origin.
 */
export function applyTransformPivotDrag(
  pivot: THREE.Object3D,
  target: THREE.Object3D,
  snapshot: TransformPivotDragSnapshot,
): boolean {
  const parentInverse = resolveParentInverse(target);
  if (!parentInverse) {
    return false;
  }

  pivot.updateWorldMatrix(true, false);
  const pivotStartInverse = snapshot.pivotWorldMatrix.clone().invert();
  const targetLocalMatrix = parentInverse
    .multiply(pivot.matrixWorld)
    .multiply(pivotStartInverse)
    .multiply(snapshot.targetWorldMatrix);

  const nextPosition = new THREE.Vector3();
  const nextQuaternion = new THREE.Quaternion();
  const nextScale = new THREE.Vector3();
  targetLocalMatrix.decompose(nextPosition, nextQuaternion, nextScale);
  if (
    !isFiniteVector3(nextPosition) ||
    !isFiniteVector3(nextScale) ||
    !Number.isFinite(nextQuaternion.x) ||
    !Number.isFinite(nextQuaternion.y) ||
    !Number.isFinite(nextQuaternion.z) ||
    !Number.isFinite(nextQuaternion.w)
  ) {
    return false;
  }

  target.position.copy(nextPosition);
  target.quaternion.copy(nextQuaternion);
  target.scale.copy(nextScale);
  target.updateMatrix();
  target.updateWorldMatrix(false, true);
  return true;
}

export function decomposeJointPivotMatrixToOrigin(matrix: THREE.Matrix4): UrdfOrigin {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, 'ZYX');

  matrix.decompose(position, quaternion, scale);
  euler.setFromQuaternion(quaternion, 'ZYX');

  return {
    xyz: { x: position.x, y: position.y, z: position.z },
    rpy: { r: euler.x, p: euler.y, y: euler.z },
    quatXyzw: {
      x: quaternion.x,
      y: quaternion.y,
      z: quaternion.z,
      w: quaternion.w,
    },
  };
}
