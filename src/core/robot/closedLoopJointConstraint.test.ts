import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  JointType,
  type RobotClosedLoopConstraint,
  type RobotClosedLoopJointConstraint,
  type RobotData,
  type UrdfJoint,
} from '@/types';
import { computeLinkWorldMatrices } from './kinematics';
import {
  resolveClosedLoopDrivenJointMotion,
  resolveClosedLoopJointOriginCompensationDetailed,
  solveClosedLoopMotionCompensation,
} from './closedLoops';

const ZERO = { x: 0, y: 0, z: 0 };
const X = { x: 1, y: 0, z: 0 };
const Z = { x: 0, y: 0, z: 1 };
const IDENTITY_ORIGIN = { xyz: ZERO, rpy: { r: 0, p: 0, y: 0 } };

function joint(id: string, type: JointType, axis = Z): UrdfJoint {
  return {
    ...structuredClone(DEFAULT_JOINT), id, name: id, type, axis,
    parentLinkId: 'base', childLinkId: id,
    origin: structuredClone(IDENTITY_ORIGIN), angle: 0,
    limit: { lower: -4 * Math.PI, upper: 4 * Math.PI, effort: 1, velocity: 1 },
  };
}

function constraint(
  type: JointType,
  linkAId = 'base',
  linkBId = 'driver',
): RobotClosedLoopJointConstraint {
  return {
    id: `${linkAId}-${linkBId}`, type: 'joint', jointType: type,
    linkAId, linkBId, anchorLocalA: ZERO, anchorLocalB: ZERO, anchorWorld: ZERO,
    origin: IDENTITY_ORIGIN, axis: Z,
  };
}

function robot(joints: UrdfJoint[], constraints: RobotClosedLoopConstraint[]): RobotData {
  return {
    name: 'joint-closed-loop', rootLinkId: 'base',
    links: Object.fromEntries(['base', ...joints.map((entry) => entry.childLinkId)]
      .map((id) => [id, { ...structuredClone(DEFAULT_LINK), id, name: id }])),
    joints: Object.fromEntries(joints.map((entry) => [entry.id, entry])),
    closedLoopConstraints: constraints,
  };
}

function rotation(matrix: THREE.Matrix4): THREE.Quaternion {
  return new THREE.Quaternion().setFromRotationMatrix(matrix);
}

function assertNear(actual: number, expected: number, tolerance = 2e-5): void {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should be near ${expected}`);
}

for (const type of [JointType.FIXED, JointType.REVOLUTE, JointType.CONTINUOUS, JointType.PRISMATIC]) {
  test(`${type} closure prevents rotation outside its allowed axis`, () => {
    const data = robot([joint('driver', JointType.REVOLUTE, X)], [constraint(type)]);
    const result = resolveClosedLoopDrivenJointMotion(data, 'driver', 0.5);
    assert.ok(result.converged && result.constrained);
    assertNear(result.appliedAngle, 0);
  });
}

for (const type of [JointType.REVOLUTE, JointType.CONTINUOUS]) {
  test(`${type} closure permits a matching rotation without moving the opposite branch`, () => {
    const data = robot([joint('driver', JointType.REVOLUTE)], [constraint(type)]);
    const result = resolveClosedLoopDrivenJointMotion(data, 'driver', 0.7);
    assert.ok(result.converged && !result.constrained);
    assertNear(result.appliedAngle, 0.7);
  });
}

test('revolute closure enforces both rotational limits', () => {
  const closure = { ...constraint(JointType.REVOLUTE), limit: { lower: -0.1, upper: 0.2 } };
  const data = robot([joint('driver', JointType.REVOLUTE)], [closure]);
  assertNear(resolveClosedLoopDrivenJointMotion(data, 'driver', 0.5).appliedAngle, 0.2);
  assertNear(resolveClosedLoopDrivenJointMotion(data, 'driver', -0.5).appliedAngle, -0.1);
});

test('revolute limits accept equivalent angles in an interval beyond pi', () => {
  const driver = joint('driver', JointType.REVOLUTE);
  driver.angle = 3.1;
  const closure = { ...constraint(JointType.REVOLUTE), limit: { lower: 3, upper: 3.5 } };
  const result = resolveClosedLoopDrivenJointMotion(robot([driver], [closure]), 'driver', 3.3);
  assert.ok(result.converged && !result.constrained);
  assertNear(result.appliedAngle, 3.3);
});

test('continuous closure ignores rotational limits', () => {
  const closure = { ...constraint(JointType.CONTINUOUS), limit: { lower: -0.1, upper: 0.1 } };
  const result = resolveClosedLoopDrivenJointMotion(robot([joint('driver', JointType.REVOLUTE)], [closure]), 'driver', 0.7);
  assert.ok(result.converged && !result.constrained);
  assertNear(result.appliedAngle, 0.7);
});

test('prismatic closure permits axial translation and enforces one-sided bounds', () => {
  const closure = { ...constraint(JointType.PRISMATIC), axis: X, limit: { upper: 0.3 } };
  const data = robot([joint('driver', JointType.PRISMATIC, X)], [closure]);
  const free = resolveClosedLoopDrivenJointMotion(data, 'driver', 0.2);
  assert.ok(free.converged && !free.constrained);
  assertNear(free.appliedAngle, 0.2);
  assertNear(resolveClosedLoopDrivenJointMotion(data, 'driver', 0.8).appliedAngle, 0.3);
  assertNear(resolveClosedLoopDrivenJointMotion(data, 'driver', -0.8).appliedAngle, -0.8);
});

test('prismatic closure blocks transverse translation', () => {
  const closure = { ...constraint(JointType.PRISMATIC), axis: X };
  const result = resolveClosedLoopDrivenJointMotion(robot([joint('driver', JointType.PRISMATIC, Z)], [closure]), 'driver', 0.2);
  assert.ok(result.converged && result.constrained);
  assertNear(result.appliedAngle, 0);
});

test('joint closure uses the rotated origin frame and does not apply its translation twice', () => {
  const driver = joint('driver', JointType.PRISMATIC, X);
  driver.origin = { xyz: { x: 2, y: 3, z: 0 }, rpy: { r: 0, p: 0, y: Math.PI / 2 } };
  const closure = {
    ...constraint(JointType.PRISMATIC), axis: X,
    anchorLocalA: driver.origin.xyz, origin: driver.origin,
  };
  const data = robot([driver], [closure]);
  const result = resolveClosedLoopDrivenJointMotion(data, 'driver', 0.4);
  assert.ok(result.converged && !result.constrained);
  const position = new THREE.Vector3().setFromMatrixPosition(computeLinkWorldMatrices(data, result).driver);
  assertNear(position.x, 2);
  assertNear(position.y, 3.4);
});

test('fixed closure honors a quaternion zero orientation and a nonzero child anchor', () => {
  const driver = joint('driver', JointType.REVOLUTE);
  driver.origin = { xyz: { x: 1, y: -1, z: 0 }, rpy: { r: 0, p: 0, y: Math.PI / 2 } };
  const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  const closure = {
    ...constraint(JointType.FIXED), anchorLocalA: { x: 1, y: 0, z: 0 }, anchorLocalB: X,
    origin: { ...IDENTITY_ORIGIN, quatXyzw: { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w } },
  };
  const data = robot([driver], [closure]);
  assert.ok(solveClosedLoopMotionCompensation(data).converged);
  assertNear(resolveClosedLoopDrivenJointMotion(data, 'driver', 0.4).appliedAngle, 0);
});

test('fixed closure rotates a passive branch with the driver', () => {
  const data = robot([joint('driver', JointType.REVOLUTE), joint('passive', JointType.BALL)],
    [constraint(JointType.FIXED, 'driver', 'passive')]);
  const result = resolveClosedLoopDrivenJointMotion(data, 'driver', 0.5);
  assert.ok(result.converged && !result.constrained);
  const matrices = computeLinkWorldMatrices(data, result);
  assertNear(rotation(matrices.driver).angleTo(rotation(matrices.passive)), 0);
});

test('connected loops solve every affected passive branch and leave unrelated loops untouched', () => {
  const ids = ['a', 'b', 'c', 'd', 'unrelated_a', 'unrelated_b'];
  const closures = [constraint(JointType.BALL, 'c', 'd'), constraint(JointType.BALL, 'b', 'c'),
    constraint(JointType.BALL, 'a', 'b'), constraint(JointType.BALL, 'unrelated_a', 'unrelated_b')];
  const data = robot(ids.map((id) => joint(id, JointType.PRISMATIC, X)), closures);
  const result = resolveClosedLoopDrivenJointMotion(data, 'a', 0.2);
  assert.ok(result.converged);
  for (const id of ['a', 'b', 'c', 'd']) assertNear(result.angles[id], 0.2);
  assert.equal(result.angles.unrelated_a, undefined);
  assert.equal(result.angles.unrelated_b, undefined);
  assert.deepEqual(Object.keys(result.constraintErrors).sort(), ['a-b', 'b-c', 'c-d']);
});

test('duplicate joint closures remain stable', () => {
  const closure = constraint(JointType.FIXED, 'driver', 'passive');
  const data = robot([joint('driver', JointType.REVOLUTE), joint('passive', JointType.REVOLUTE)],
    [closure, { ...closure, id: 'duplicate' }]);
  const result = resolveClosedLoopDrivenJointMotion(data, 'driver', 0.4);
  assert.ok(result.converged);
  assertNear(result.angles.passive, 0.4);
});

test('a legacy connect cannot erase the orientation solved by a shared fixed closure', () => {
  const fixed = constraint(JointType.FIXED, 'driver', 'passive');
  const connect: RobotClosedLoopConstraint = {
    ...fixed, id: 'connect', type: 'connect', anchorLocalA: X, anchorLocalB: X,
  };
  const data = robot([joint('driver', JointType.REVOLUTE, X), joint('passive', JointType.BALL)],
    [fixed, connect]);
  const result = resolveClosedLoopDrivenJointMotion(data, 'driver', 0.4);
  assert.ok(result.converged && !result.constrained);
  assertNear(result.appliedAngle, 0.4);
  const matrices = computeLinkWorldMatrices(data, result);
  assertNear(rotation(matrices.driver).angleTo(rotation(matrices.passive)), 0);
});

test('origin editing preserves fixed orientation through connected closures', () => {
  const data = robot(['a', 'b', 'c'].map((id) => joint(id, JointType.FIXED)),
    [constraint(JointType.FIXED, 'b', 'c'), constraint(JointType.FIXED, 'a', 'b')]);
  const nextOrigin = { xyz: { x: 0.2, y: 0.4, z: 0 }, rpy: { r: 0.3, p: 0.1, y: 0.5 } };
  const result = resolveClosedLoopJointOriginCompensationDetailed(data, 'a', nextOrigin);
  const matrices = computeLinkWorldMatrices(data, { origins: { ...result.origins, a: nextOrigin } });
  for (const id of ['b', 'c']) {
    assertNear(rotation(matrices.a).angleTo(rotation(matrices[id])), 0);
    assertNear(new THREE.Vector3().setFromMatrixPosition(matrices.a)
      .distanceTo(new THREE.Vector3().setFromMatrixPosition(matrices[id])), 0);
  }
});

test('origin editing preserves the free displacement of a prismatic closure', () => {
  const a = joint('a', JointType.FIXED);
  const b = joint('b', JointType.PRISMATIC, X);
  b.angle = 0.4;
  const closure = { ...constraint(JointType.PRISMATIC, 'a', 'b'), axis: X };
  const data = robot([a, b], [closure]);
  const nextOrigin = { xyz: { x: 0, y: 0.3, z: 0 }, rpy: { r: 0, p: 0, y: 0 } };
  const result = resolveClosedLoopJointOriginCompensationDetailed(data, 'a', nextOrigin);
  const matrices = computeLinkWorldMatrices(data, { origins: { ...result.origins, a: nextOrigin } });
  const delta = new THREE.Vector3().setFromMatrixPosition(matrices.b)
    .sub(new THREE.Vector3().setFromMatrixPosition(matrices.a));
  assertNear(delta.x, 0.4);
  assertNear(delta.y, 0);
  assertNear(result.origins.b.xyz.x, 0);
});

test('origin editing on endpoint B preserves the authored fixed relative orientation', () => {
  const a = joint('a', JointType.FIXED);
  const b = joint('b', JointType.FIXED);
  b.origin.rpy.y = 0.3;
  const closure = { ...constraint(JointType.FIXED, 'a', 'b'), origin: structuredClone(b.origin) };
  const data = robot([a, b], [closure]);
  const nextOrigin = { xyz: { x: 0.2, y: 0.4, z: 0 }, rpy: { r: 0, p: 0, y: 0.8 } };
  const result = resolveClosedLoopJointOriginCompensationDetailed(data, 'b', nextOrigin);
  assertNear(result.origins.a.rpy.y, 0.5);
  assertNear(result.origins.a.xyz.x, 0.2);
});
