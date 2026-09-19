import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';

import { DEFAULT_JOINT, DEFAULT_LINK, JointType, type RobotState } from '@/types';
import { computeLinkWorldMatrices } from '@/core/robot/kinematics';
import { generateMujocoXML } from './mjcfGenerator';
import { parseMJCF } from './mjcfParser';
import { parseMJCFModel } from './mjcfModel';

const dom = new JSDOM();
globalThis.DOMParser = dom.window.DOMParser;

function model(): RobotState {
  const a = { x: 1, y: 2, z: 3 };
  const b = { x: 0.2, y: -0.1, z: 0.4 };
  const rpy = { r: 0.2, p: -0.3, y: 0.4 };
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(rpy.r, rpy.p, rpy.y, 'ZYX'));
  const position = new THREE.Vector3().copy(a).sub(new THREE.Vector3().copy(b).applyQuaternion(quaternion));
  return {
    name: 'weld_test', rootLinkId: 'base', selection: { type: null, id: null },
    links: Object.fromEntries(['base', 'tip'].map(id => [id, { ...structuredClone(DEFAULT_LINK), id, name: id }])),
    joints: { driver: { ...structuredClone(DEFAULT_JOINT), id: 'driver', name: 'driver',
      type: JointType.BALL, parentLinkId: 'base', childLinkId: 'tip',
      origin: { xyz: { x: position.x, y: position.y, z: position.z }, rpy } } },
    closedLoopConstraints: [{ id: 'closure', type: 'joint', jointType: JointType.FIXED,
      linkAId: 'base', linkBId: 'tip', anchorLocalA: a, anchorLocalB: b, anchorWorld: a,
      origin: { xyz: a, rpy, quatXyzw: { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w } } }],
  };
}

function assertNear(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`);
}

test('fixed loop exports a native weld and round-trips both anchors and authored rotation', () => {
  const robot = model();
  const original = robot.closedLoopConstraints![0];
  assert.equal(original.type, 'joint');
  if (original.type !== 'joint') return;
  const xml = generateMujocoXML(robot, { preserveNumericPrecision: true, includeActuators: false });
  assert.match(xml, /<weld name="closure"/);
  assert.doesNotMatch(xml, /<connect\b/);
  const parsedModel = parseMJCFModel(xml);
  assert.ok(parsedModel);
  assert.deepEqual(parsedModel.weldConstraints[0].anchor, [0.2, -0.1, 0.4]);
  assert.deepEqual(parsedModel.weldConstraints[0].relpose?.slice(0, 3), [1, 2, 3]);
  const parsed = parseMJCF(xml);
  assert.ok(parsed);
  const actual = parsed.closedLoopConstraints?.find(c => c.id === 'closure');
  assert.ok(actual && actual.type === 'joint');
  assert.equal(actual.jointType, JointType.FIXED);
  assert.deepEqual(actual.anchorLocalA, original.anchorLocalA);
  assert.deepEqual(actual.anchorLocalB, original.anchorLocalB);
  const q = actual.origin?.quatXyzw;
  assert.ok(q);
  const expected = original.origin!.quatXyzw!;
  assertNear(Math.abs(new THREE.Quaternion(q.x, q.y, q.z, q.w)
    .dot(new THREE.Quaternion(expected.x, expected.y, expected.z, expected.w))), 1);
  const matrices = computeLinkWorldMatrices(parsed);
  const anchorA = new THREE.Vector3().copy(actual.anchorLocalA).applyMatrix4(matrices[actual.linkAId]);
  const anchorB = new THREE.Vector3().copy(actual.anchorLocalB).applyMatrix4(matrices[actual.linkBId]);
  assertNear(anchorA.distanceTo(anchorB), 0);
});

test('weld with default relpose infers the reference anchors and relative orientation', () => {
  const parsed = parseMJCF(`<mujoco><worldbody>
    <body name="a"><geom type="sphere" size="0.1"/></body>
    <body name="b" pos="1 2 3" quat="0.9689124217106447 0 0 0.24740395925452294"><geom type="sphere" size="0.1"/></body>
    </worldbody><equality><weld name="reference" body1="a" body2="b" anchor="0.2 0 0"/></equality></mujoco>`);
  assert.ok(parsed);
  const closure = parsed.closedLoopConstraints?.[0];
  assert.ok(closure && closure.type === 'joint');
  assertNear(closure.anchorLocalA.x, 1 + Math.cos(0.5) * 0.2);
  assertNear(closure.anchorLocalA.y, 2 + Math.sin(0.5) * 0.2);
  assertNear(closure.origin!.rpy.y, 0.5);
});

test('weld import rebases each anchor when a body joint has a nonzero pivot', () => {
  const parsed = parseMJCF(`<mujoco><worldbody>
    <body name="a"><joint name="ja" pos="0.1 0 0"/><geom type="sphere" size="0.1"/></body>
    <body name="b"><joint name="jb" pos="0 0.2 0"/><geom type="sphere" size="0.1"/></body>
    </worldbody><equality><weld name="offset" body1="a" body2="b" anchor="0.3 0.4 0" relpose="0.3 0.4 0 1 0 0 0"/></equality></mujoco>`);
  assert.ok(parsed);
  const closure = parsed.closedLoopConstraints?.[0];
  assert.ok(closure);
  assertNear(closure.anchorLocalA.x, 0.2);
  assertNear(closure.anchorLocalA.y, 0.4);
  assertNear(closure.anchorLocalB.x, 0.3);
  assertNear(closure.anchorLocalB.y, 0.2);
});

test('weld without body2 preserves its attachment to the world', () => {
  const parsed = parseMJCF(`<mujoco><worldbody><body name="a" pos="1 0 0"><geom type="sphere" size="0.1"/></body></worldbody>
    <equality><weld name="world_weld" body1="a"/></equality></mujoco>`);
  assert.ok(parsed);
  const closure = parsed.closedLoopConstraints?.[0];
  assert.ok(closure);
  assert.ok(parsed.links[closure.linkBId]);
  assertNear(closure.anchorLocalA.x, -1);
});

for (const type of [JointType.REVOLUTE, JointType.CONTINUOUS, JointType.PRISMATIC, JointType.PLANAR]) {
  test(`MJCF export rejects ${type} loop edges instead of silently changing their degrees of freedom`, () => {
    const data = model();
    const closure = data.closedLoopConstraints![0];
    assert.ok(closure.type === 'joint');
    closure.jointType = type;
    assert.throws(() => generateMujocoXML(data), new RegExp(`unsupported ${type} semantics.*SDF or USD`));
  });
}

test('ball loops keep their native connect representation', () => {
  const data = model();
  const closure = data.closedLoopConstraints![0];
  assert.ok(closure.type === 'joint');
  closure.jointType = JointType.BALL;
  assert.match(generateMujocoXML(data), /<connect name="closure"/);
});
