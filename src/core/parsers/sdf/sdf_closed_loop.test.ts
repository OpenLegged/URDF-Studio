import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';

import { computeLinkWorldMatrices } from '@/core/robot/kinematics';
import {
  DEFAULT_JOINT, DEFAULT_LINK, JointType,
  type RobotClosedLoopJointConstraint, type RobotState, type Vector3,
} from '@/types';
import { generateSDF } from './sdfGenerator';
import { parseSDF } from './sdfParser';

const dom = new JSDOM('<html></html>');
globalThis.DOMParser = dom.window.DOMParser;

function assertVector(actual: Vector3, expected: Vector3): void {
  for (const key of ['x', 'y', 'z'] as const) {
    assert.ok(Math.abs(actual[key] - expected[key]) < 1e-7, `${key}: ${actual[key]} != ${expected[key]}`);
  }
}

function createLoopRobot(jointType: JointType, coordinate = 0): RobotState {
  const parentPosition = new THREE.Vector3(0.4, -0.5, 0.7);
  const parentRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.3, 0.4, 'ZYX'));
  const zeroRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.4, 0.3, -0.2, 'ZYX'));
  const axis = new THREE.Vector3(1, 2, -1).normalize();
  const anchorLocalA = { x: 0.6, y: 0.2, z: -0.1 };
  const anchorLocalB = { x: -0.2, y: 0.1, z: 0.3 };
  const jointRotation = parentRotation.clone().multiply(zeroRotation);
  const childRotation = jointRotation.clone();
  if (jointType === JointType.REVOLUTE || jointType === JointType.CONTINUOUS) {
    childRotation.multiply(new THREE.Quaternion().setFromAxisAngle(axis, coordinate));
  }
  const anchorWorld = new THREE.Vector3().copy(anchorLocalA).applyQuaternion(parentRotation).add(parentPosition);
  const childPosition = anchorWorld.clone().sub(new THREE.Vector3().copy(anchorLocalB).applyQuaternion(childRotation));
  if (jointType === JointType.PRISMATIC) childPosition.addScaledVector(axis.clone().applyQuaternion(jointRotation), coordinate);
  const parentRpy = new THREE.Euler().setFromQuaternion(parentRotation, 'ZYX');
  const childRpy = new THREE.Euler().setFromQuaternion(childRotation, 'ZYX');
  const constraint: RobotClosedLoopJointConstraint = {
    id: 'loop', type: 'joint', jointType,
    linkAId: 'left', linkBId: 'right',
    anchorLocalA, anchorLocalB,
    anchorWorld: { x: anchorWorld.x, y: anchorWorld.y, z: anchorWorld.z },
    origin: {
      xyz: { x: 8, y: 7, z: 6 },
      rpy: { r: -0.4, p: 0.3, y: -0.2 },
      quatXyzw: { x: zeroRotation.x, y: zeroRotation.y, z: zeroRotation.z, w: zeroRotation.w },
    },
    ...(jointType !== JointType.FIXED && jointType !== JointType.BALL ? {
      axis: { x: axis.x, y: axis.y, z: axis.z },
      limit: { lower: -0.6, upper: 0.9, effort: 12, velocity: 3 },
    } : {}),
  };
  return {
    name: 'loop_robot', rootLinkId: 'base', selection: { type: null, id: null },
    links: Object.fromEntries(['base', 'left', 'right'].map((id) => [id, {
      ...structuredClone(DEFAULT_LINK), id, name: id,
    }])),
    joints: {
      left_joint: {
        ...structuredClone(DEFAULT_JOINT), id: 'left_joint', name: 'left_joint',
        type: JointType.FIXED, parentLinkId: 'base', childLinkId: 'left',
        origin: { xyz: { x: parentPosition.x, y: parentPosition.y, z: parentPosition.z },
          rpy: { r: parentRpy.x, p: parentRpy.y, y: parentRpy.z } },
      },
      right_joint: {
        ...structuredClone(DEFAULT_JOINT), id: 'right_joint', name: 'right_joint',
        type: JointType.FIXED, parentLinkId: 'base', childLinkId: 'right',
        origin: { xyz: { x: childPosition.x, y: childPosition.y, z: childPosition.z },
          rpy: { r: childRpy.x, p: childRpy.y, y: childRpy.z } },
      },
    },
    closedLoopConstraints: [constraint],
  };
}

for (const type of [JointType.FIXED, JointType.REVOLUTE, JointType.CONTINUOUS, JointType.PRISMATIC, JointType.BALL]) {
  test(`SDF preserves ${type} closure, both anchors and zero orientation at a nonzero pose`, () => {
    const robot = createLoopRobot(type, 0.35);
    const expected = robot.closedLoopConstraints![0];
    assert.equal(expected.type, 'joint');
    const xml = generateSDF(robot, { preserveNumericPrecision: true });
    assert.match(xml, new RegExp(`<joint name="loop" type="${type}">`));
    const result = parseSDF(xml);
    assert.ok(result);
    const actual = result.closedLoopConstraints?.[0];
    assert.equal(actual?.type, 'joint');
    assert.equal(actual.jointType, type);
    assertVector(actual.anchorLocalA, expected.anchorLocalA);
    assertVector(actual.anchorLocalB, expected.anchorLocalB);
    assertVector(actual.anchorWorld, expected.anchorWorld);
    assert.deepEqual(actual.origin, expected.origin);
    assert.deepEqual(result.links.right.visual.origin, robot.links.right.visual.origin);
    assert.deepEqual(result.links.right.collision.origin, robot.links.right.collision.origin);
    if (expected.axis) {
      assert.ok(actual.axis);
      assertVector(actual.axis, expected.axis);
      assert.equal(actual.limit?.effort, 12);
      assert.equal(actual.limit?.velocity, 3);
      if (type === JointType.CONTINUOUS) {
        assert.equal(actual.limit?.lower, undefined);
        assert.equal(actual.limit?.upper, undefined);
      } else {
        assert.ok(Math.abs(actual.limit!.lower! + 0.6) < 1e-10);
        assert.ok(Math.abs(actual.limit!.upper! - 0.9) < 1e-10);
      }
    }
    const before = computeLinkWorldMatrices(robot);
    const after = computeLinkWorldMatrices(result);
    for (const id of ['left', 'right']) {
      before[id].elements.forEach((value, index) => assert.ok(Math.abs(value - after[id].elements[index]) < 1e-10));
    }
  });
}

for (const type of [JointType.REVOLUTE, JointType.PRISMATIC]) {
  test(`SDF native ${type} closure shifts limits to its exported coordinate and keeps the world axis`, () => {
    const robot = createLoopRobot(type, 0.35);
    const xml = generateSDF(robot, { preserveNumericPrecision: true });
    const nativeXml = xml.replace(/\s*<urdf_studio:closed_loop[^>]*\/>/, '');
    const native = parseSDF(nativeXml);
    const closure = native?.closedLoopConstraints?.[0];
    assert.ok(native);
    assert.equal(closure?.type, 'joint');
    assert.equal(closure.jointType, type);
    assert.ok(Math.abs(closure.limit!.lower! + 0.95) < 1e-10);
    assert.ok(Math.abs(closure.limit!.upper! - 0.55) < 1e-10);
    const expected = robot.closedLoopConstraints![0];
    assert.equal(expected.type, 'joint');
    const matrices = computeLinkWorldMatrices(robot);
    const expectedAxis = new THREE.Vector3().copy(expected.axis!).applyQuaternion(
      new THREE.Quaternion().setFromRotationMatrix(matrices.left).multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.4, 0.3, -0.2, 'ZYX')),
      ),
    );
    const nativeAxis = new THREE.Vector3().copy(closure.axis!).transformDirection(matrices.right);
    assertVector(nativeAxis, expectedAxis);
  });
}

test('SDF closure metadata preserves the spanning tree when XML joint order changes', () => {
  const xml = generateSDF(createLoopRobot(JointType.REVOLUTE, 0.2));
  const match = xml.match(/    <joint name="loop"[\s\S]*?<\/joint>/);
  assert.ok(match);
  const reordered = xml.replace(match[0], '').replace('    <joint name="left_joint"', `${match[0]}\n    <joint name="left_joint"`);
  const result = parseSDF(reordered);
  assert.deepEqual(Object.keys(result!.joints), ['left_joint', 'right_joint']);
  assert.equal(result!.closedLoopConstraints?.[0].id, 'loop');
});

test('SDF retains a one-sided revolute closure limit', () => {
  const robot = createLoopRobot(JointType.REVOLUTE);
  const constraint = robot.closedLoopConstraints![0];
  assert.equal(constraint.type, 'joint');
  constraint.limit = { upper: 0.4 };
  const xml = generateSDF(robot).replace(/\s*<urdf_studio:closed_loop[^>]*\/>/, '');
  const constraintAfter = parseSDF(xml)?.closedLoopConstraints?.[0];
  assert.equal(constraintAfter?.type, 'joint');
  assert.equal(constraintAfter.jointType, JointType.REVOLUTE);
  assert.equal(constraintAfter.limit?.lower, undefined);
  assert.ok(Math.abs(constraintAfter.limit!.upper! - 0.4) < 1e-6);
});

test('SDF native closure limits use the angle branch inside the authored interval', () => {
  const robot = createLoopRobot(JointType.REVOLUTE, 6);
  const constraint = robot.closedLoopConstraints![0];
  assert.equal(constraint.type, 'joint');
  constraint.limit = { lower: 5, upper: 7 };
  const xml = generateSDF(robot, { preserveNumericPrecision: true })
    .replace(/\s*<urdf_studio:closed_loop[^>]*\/>/, '');
  const result = parseSDF(xml)?.closedLoopConstraints?.[0];
  assert.equal(result?.type, 'joint');
  assert.ok(Math.abs(result.limit!.lower! + 1) < 1e-10);
  assert.ok(Math.abs(result.limit!.upper! - 1) < 1e-10);
});

test('SDF closure anchors use the selected tree joint frames, without rebasing geometry a second time', () => {
  const robot = parseSDF(`<sdf version="1.7"><model name="frames">
    <link name="base"/>
    <link name="left"><pose>1 0 0 0 0 0</pose></link>
    <link name="right"><pose>0 1 0 0 0 0</pose>
      <visual name="shape"><geometry><box><size>1 1 1</size></box></geometry></visual>
    </link>
    <joint name="left_tree" type="fixed"><parent>base</parent><child>left</child><pose>0.2 0 0 0 0 0</pose></joint>
    <joint name="right_tree" type="fixed"><parent>base</parent><child>right</child><pose>0 0.3 0 0 0 0</pose></joint>
    <joint name="loop" type="fixed"><parent>left</parent><child>right</child><pose>0.5 0.4 0 0 0 0</pose></joint>
  </model></sdf>`);
  assert.ok(robot);
  const constraint = robot.closedLoopConstraints?.[0];
  assert.equal(constraint?.type, 'joint');
  assertVector(constraint.anchorLocalA, { x: -0.7, y: 1.4, z: 0 });
  assertVector(constraint.anchorLocalB, { x: 0.5, y: 0.1, z: 0 });
  assertVector(robot.links.right.visual.origin.xyz, { x: 0, y: -0.3, z: 0 });
});
