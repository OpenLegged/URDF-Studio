import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import type { PickedSnapFrame } from '@/store/jointPickSessionStore';

import { derivePickedSnapLinkLocalDisplay } from './jointPickOverlayFrame.ts';

const EPSILON = 1e-9;

function assertVectorClose(actual: THREE.Vector3, expected: THREE.Vector3): void {
  assert.ok(
    actual.distanceTo(expected) < EPSILON,
    `expected ${actual.toArray().join(', ')} to equal ${expected.toArray().join(', ')}`,
  );
}

test('committed joint-pick marker preserves its link-local pose when the child link moves', () => {
  const capturedLinkWorld = new THREE.Matrix4().compose(
    new THREE.Vector3(2, -1, 0.5),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.3, 0.4)),
    new THREE.Vector3(1, 1, 1),
  );
  const pickedPoseLocal = new THREE.Matrix4().compose(
    new THREE.Vector3(0.35, -0.15, 0.2),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.1, 0.25, 0.5)),
    new THREE.Vector3(1, 1, 1),
  );
  const pickedPoseWorld = capturedLinkWorld.clone().multiply(pickedPoseLocal);
  const pickedPointLocal = new THREE.Vector3(0.4, -0.2, 0.1);
  const pickedPointWorld = pickedPointLocal.clone().applyMatrix4(capturedLinkWorld);
  const frame: PickedSnapFrame = {
    side: 'child',
    componentId: 'vehicle_child',
    linkId: 'base_link',
    kind: 'surface',
    pointWorld: {
      x: pickedPointWorld.x,
      y: pickedPointWorld.y,
      z: pickedPointWorld.z,
    },
    poseWorldMatrix: pickedPoseWorld.toArray(),
    linkWorldMatrix: capturedLinkWorld.toArray(),
  };

  const display = derivePickedSnapLinkLocalDisplay(frame);
  assertVectorClose(display.point, pickedPointLocal);

  const movedLinkWorld = new THREE.Matrix4().compose(
    new THREE.Vector3(-3, 4, 1.25),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.6, 0.1, -0.45)),
    new THREE.Vector3(1, 1, 1),
  );
  const expectedMovedPoint = pickedPointLocal.clone().applyMatrix4(movedLinkWorld);
  const actualMovedPoint = display.point.clone().applyMatrix4(movedLinkWorld);
  assertVectorClose(actualMovedPoint, expectedMovedPoint);

  const expectedMovedPose = movedLinkWorld.clone().multiply(pickedPoseLocal);
  const actualMovedPose = movedLinkWorld.clone().multiply(display.pose);
  assertVectorClose(
    new THREE.Vector3().setFromMatrixPosition(actualMovedPose),
    new THREE.Vector3().setFromMatrixPosition(expectedMovedPose),
  );

  const expectedQuaternion = new THREE.Quaternion().setFromRotationMatrix(expectedMovedPose);
  const actualQuaternion = new THREE.Quaternion().setFromRotationMatrix(actualMovedPose);
  assert.ok(
    1 - Math.abs(actualQuaternion.dot(expectedQuaternion)) < EPSILON,
    'marker orientation should preserve the picked link-local frame after link motion',
  );
});
