import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  alignTransformPivotToBoundsCenter,
  applyTransformPivotDrag,
  captureTransformPivotDrag,
  decomposeJointPivotMatrixToOrigin,
} from './assemblyTransformControlsShared.ts';

function assertVectorClose(actual: THREE.Vector3, expected: THREE.Vector3, epsilon = 1e-9): void {
  assert.ok(actual.distanceTo(expected) < epsilon, `${actual.toArray()} != ${expected.toArray()}`);
}

test('decomposeJointPivotMatrixToOrigin preserves translation and ZYX rotation', () => {
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.3, 0.4, 'ZYX'));
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(1, 2, 3),
    quaternion,
    new THREE.Vector3(1, 1, 1),
  );

  const origin = decomposeJointPivotMatrixToOrigin(matrix);

  assert.deepEqual(origin.xyz, { x: 1, y: 2, z: 3 });
  assert.ok(Math.abs(origin.rpy.r - 0.2) < 1e-9);
  assert.ok(Math.abs(origin.rpy.p + 0.3) < 1e-9);
  assert.ok(Math.abs(origin.rpy.y - 0.4) < 1e-9);
  assert.ok(Math.abs(origin.quatXyzw!.x - quaternion.x) < 1e-9);
  assert.ok(Math.abs(origin.quatXyzw!.y - quaternion.y) < 1e-9);
  assert.ok(Math.abs(origin.quatXyzw!.z - quaternion.z) < 1e-9);
  assert.ok(Math.abs(origin.quatXyzw!.w - quaternion.w) < 1e-9);
});

test('alignTransformPivotToBoundsCenter uses visible world bounds instead of the target origin', () => {
  const scene = new THREE.Scene();
  const parent = new THREE.Group();
  const target = new THREE.Group();
  const pivot = new THREE.Group();
  parent.position.set(3, -2, 1);
  parent.rotation.set(0.1, -0.2, 0.3);
  target.position.set(0.4, 0.5, -0.6);
  target.rotation.set(-0.2, 0.1, 0.4);
  scene.add(parent, pivot);
  parent.add(target);

  const bounds = new THREE.Box3(new THREE.Vector3(-2, 4, 1), new THREE.Vector3(6, 10, 9));
  assert.equal(alignTransformPivotToBoundsCenter(pivot, target, bounds), true);

  assertVectorClose(pivot.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(2, 7, 5));
  const pivotWorldQuaternion = pivot.getWorldQuaternion(new THREE.Quaternion());
  const targetWorldQuaternion = target.getWorldQuaternion(new THREE.Quaternion());
  assert.ok(1 - Math.abs(pivotWorldQuaternion.dot(targetWorldQuaternion)) < 1e-9);
});

test('applyTransformPivotDrag translates a nested target by the proxy world delta', () => {
  const scene = new THREE.Scene();
  const parent = new THREE.Group();
  const target = new THREE.Group();
  const pivot = new THREE.Group();
  parent.position.set(1, 2, 3);
  parent.rotation.z = Math.PI / 5;
  target.position.set(0.5, -0.25, 0.75);
  scene.add(parent, pivot);
  parent.add(target);

  const bounds = new THREE.Box3(new THREE.Vector3(-1, -2, -3), new THREE.Vector3(5, 4, 3));
  assert.equal(alignTransformPivotToBoundsCenter(pivot, target, bounds), true);
  const snapshot = captureTransformPivotDrag(pivot, target);
  assert.ok(snapshot);
  const targetStart = target.getWorldPosition(new THREE.Vector3());
  const worldDelta = new THREE.Vector3(2, -1, 0.5);

  pivot.position.add(worldDelta);
  pivot.updateMatrixWorld(true);
  assert.equal(applyTransformPivotDrag(pivot, target, snapshot), true);

  assertVectorClose(target.getWorldPosition(new THREE.Vector3()), targetStart.add(worldDelta));
});

test('applyTransformPivotDrag rotates the target around the visible-bounds center', () => {
  const scene = new THREE.Scene();
  const target = new THREE.Group();
  const pivot = new THREE.Group();
  scene.add(target, pivot);
  const bounds = new THREE.Box3(new THREE.Vector3(0, -1, -1), new THREE.Vector3(2, 1, 1));

  assert.equal(alignTransformPivotToBoundsCenter(pivot, target, bounds), true);
  const snapshot = captureTransformPivotDrag(pivot, target);
  assert.ok(snapshot);
  pivot.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  pivot.updateMatrixWorld(true);

  assert.equal(applyTransformPivotDrag(pivot, target, snapshot), true);
  assertVectorClose(target.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(1, -1, 0));
  const rotatedXAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(
    target.getWorldQuaternion(new THREE.Quaternion()),
  );
  assertVectorClose(rotatedXAxis, new THREE.Vector3(0, 1, 0));
});
