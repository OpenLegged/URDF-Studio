import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import type { UrdfJoint } from '@/types';

import {
  computeLinkWorldMatrices,
  createJointMotionMatrix,
  extractJointActualAngleFromQuaternion,
  getJointMotionAngleFromActualAngle,
} from './kinematics';

function createJointFixture(
  referencePosition = Math.PI / 4,
): Pick<UrdfJoint, 'axis' | 'referencePosition'> {
  return {
    axis: { x: 0, y: 0, z: 1 },
    referencePosition,
  };
}

test('extractJointActualAngleFromQuaternion restores actual hinge angle from zero effective motion', () => {
  const joint = createJointFixture();
  const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0);

  assert.ok(
    Math.abs(extractJointActualAngleFromQuaternion(joint, quaternion) - Math.PI / 4) < 1e-9,
  );
});

test('extractJointActualAngleFromQuaternion restores actual hinge angle from effective motion delta', () => {
  const joint = createJointFixture();
  const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.2);

  assert.ok(
    Math.abs(extractJointActualAngleFromQuaternion(joint, quaternion) - (Math.PI / 4 - 0.2)) < 1e-9,
  );
});

test('getJointMotionAngleFromActualAngle keeps gizmo display in effective-motion space', () => {
  const joint = createJointFixture();

  assert.ok(Math.abs(getJointMotionAngleFromActualAngle(joint, Math.PI / 4)) < 1e-9);
  assert.ok(Math.abs(getJointMotionAngleFromActualAngle(joint, Math.PI / 4 - 0.2) + 0.2) < 1e-9);
});

test('USD revolute motion rotates around the authored child-body pivot', () => {
  const angle = Math.PI / 3;
  const pivot = new THREE.Vector3(-0.01463734, -0.28014922, -0.38335115);
  const joint = {
    id: 'door_joint',
    name: 'door_joint',
    type: 'revolute',
    parentLinkId: 'stove',
    childLinkId: 'door',
    origin: {
      xyz: { x: 0, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: 0 },
    },
    axis: { x: 1, y: 0, z: 0 },
    dynamics: {},
    hardware: {},
    angle,
    usdPhysics: {
      axisToken: 'X',
      localPos1: { x: pivot.x, y: pivot.y, z: pivot.z },
    },
  } as UrdfJoint;

  const expected = new THREE.Matrix4()
    .makeTranslation(pivot.x, pivot.y, pivot.z)
    .multiply(new THREE.Matrix4().makeRotationX(angle))
    .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));

  assert.deepEqual(
    createJointMotionMatrix(joint).elements.map((value) => Number(value.toFixed(10))),
    expected.elements.map((value) => Number(value.toFixed(10))),
  );

  const linkWorld = computeLinkWorldMatrices({
    rootLinkId: 'stove',
    links: {
      stove: { id: 'stove', name: 'stove' },
      door: { id: 'door', name: 'door' },
    },
    joints: { door_joint: joint },
  } as never);
  assert.deepEqual(
    linkWorld.door.elements.map((value) => Number(value.toFixed(10))),
    expected.elements.map((value) => Number(value.toFixed(10))),
  );
});
