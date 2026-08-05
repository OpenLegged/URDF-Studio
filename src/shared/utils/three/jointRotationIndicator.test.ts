import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  jointRotationArrowHeadPosition,
  jointRotationArrowHeadQuaternion,
} from './jointRotationIndicator';

const REVOLUTE_ARC = Math.PI * 1.5;
const CONTINUOUS_ARC = Math.PI * 2;
const RADIUS = 0.15;

function assertVectorNear(actual: THREE.Vector3, expected: THREE.Vector3, message: string): void {
  assert.ok(
    actual.distanceTo(expected) < 1e-6,
    `${message}: expected ${expected.toArray()} but got ${actual.toArray()}`,
  );
}

/** Cone geometry points along +Y before the returned orientation is applied. */
function headDirection(arc: number): THREE.Vector3 {
  return new THREE.Vector3(0, 1, 0).applyQuaternion(jointRotationArrowHeadQuaternion(arc));
}

test('rotation arrow head marks the end of the counter-clockwise sweep', () => {
  // A revolute ring sweeps 0 -> 270 degrees, so the head belongs at -Y, not at
  // the +X start. Sitting at the start reads as a clockwise (negative) sweep.
  assertVectorNear(
    jointRotationArrowHeadPosition(REVOLUTE_ARC, RADIUS),
    new THREE.Vector3(0, -RADIUS, 0),
    'revolute head position',
  );

  // A continuous ring closes on itself, so its end coincides with +X.
  assertVectorNear(
    jointRotationArrowHeadPosition(CONTINUOUS_ARC, RADIUS),
    new THREE.Vector3(RADIUS, 0, 0),
    'continuous head position',
  );
});

test('rotation arrow head points along the right-hand-rule tangent', () => {
  assertVectorNear(headDirection(REVOLUTE_ARC), new THREE.Vector3(1, 0, 0), 'revolute head tangent');
  assertVectorNear(
    headDirection(CONTINUOUS_ARC),
    new THREE.Vector3(0, 1, 0),
    'continuous head tangent',
  );
});

test('rotation arrow head turns positively about the axis it decorates', () => {
  // The helper maps the joint axis onto local +Z. Advancing the head position by
  // a small positive rotation about +Z must move it along the head's own
  // direction; if the head pointed the other way the ring would tell the user
  // that positive motion runs backwards.
  for (const arc of [REVOLUTE_ARC, CONTINUOUS_ARC]) {
    const position = jointRotationArrowHeadPosition(arc, RADIUS);
    const advanced = position
      .clone()
      .applyAxisAngle(new THREE.Vector3(0, 0, 1), 0.05)
      .sub(position)
      .normalize();
    assert.ok(
      advanced.dot(headDirection(arc)) > 0.99,
      `arc ${arc}: head direction must follow positive rotation about +Z`,
    );
  }
});
