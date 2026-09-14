import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { Euler, Quaternion } from 'three';

import { parseMJCF } from '@/core/parsers';
import type { RobotState } from '@/types';
import { reconcileMJCFEditableSource } from './mjcfEditableSourceReconciler';

const { window } = new JSDOM();
globalThis.DOMParser = window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = window.XMLSerializer as typeof XMLSerializer;

const SOURCE = `<mujoco model="precision">
  <compiler angle="radian" />
  <worldbody>
    <body name="base">
      <body name="arm" pos="0 0 0.2">
        <!-- preserve authored precision comment -->
        <joint name="hinge" type="hinge" range="-1 1" />
        <inertial pos="0 0 0.1" mass="2" diaginertia="0.2 0.3 0.4" />
        <geom name="visual" type="box" size="0.1 0.2 0.3" group="1" contype="0" conaffinity="0" />
        <geom name="collision" type="sphere" size="0.08" group="3" />
      </body>
    </body>
  </worldbody>
  <tendon><fixed name="cable"><joint joint="hinge" coef="1" /></fixed></tendon>
  <custom><numeric name="vendor" data="1 2 3" /></custom>
</mujoco>`;

function parse(source: string): RobotState {
  const robot = parseMJCF(source);
  assert.ok(robot);
  return robot;
}

const edits: Array<[string, (robot: RobotState) => void, (robot: RobotState) => unknown]> = [
  ['joint translation', robot => { robot.joints.hinge.origin.xyz.x = 0.123456789123456; },
    robot => robot.joints.hinge.origin.xyz],
  ['joint limits', robot => { robot.joints.hinge.limit!.upper = 0.987654321987654; },
    robot => robot.joints.hinge.limit],
  ['joint dynamics', robot => { robot.joints.hinge.dynamics.damping = 0.123456789123456; },
    robot => robot.joints.hinge.dynamics],
  ['tiny dynamics', robot => { robot.joints.hinge.dynamics.damping = 1e-20; },
    robot => robot.joints.hinge.dynamics],
  ['inertial mass and diagonal', robot => {
    robot.links.arm.inertial!.mass = 1.23456789123456;
    robot.links.arm.inertial!.inertia.ixx = 0.23456789123456;
  }, robot => ({ mass: robot.links.arm.inertial!.mass, inertia: robot.links.arm.inertial!.inertia })],
  ['tiny inertial mass and tensor', robot => {
    robot.links.arm.inertial!.mass = 1e-20;
    robot.links.arm.inertial!.inertia = { ixx: 1e-20, iyy: 1e-20, izz: 1e-20, ixy: 0, ixz: 0, iyz: 0 };
  }, robot => ({ mass: robot.links.arm.inertial!.mass, inertia: robot.links.arm.inertial!.inertia })],
  ['tiny tendon width', robot => { robot.inspectionContext!.mjcf!.tendons[0]!.width = 1e-20; },
    robot => robot.inspectionContext!.mjcf!.tendons],
  ['visual size', robot => { robot.links.arm.visual.dimensions.x = 0.123456789123456; },
    robot => robot.links.arm.visual.dimensions],
  ['collision size', robot => { robot.links.arm.collision.dimensions.x = 0.123456789123456; },
    robot => robot.links.arm.collision.dimensions],
  ['tiny collision size', robot => { robot.links.arm.collision.dimensions.x = 1e-20; },
    robot => robot.links.arm.collision.dimensions],
  ['tendon width and coefficient', robot => {
    const tendon = robot.inspectionContext!.mjcf!.tendons[0]!;
    tendon.width = 0.123456789123456;
    tendon.attachments[0]!.coef = 0.987654321987654;
  }, robot => robot.inspectionContext!.mjcf!.tendons],
];

for (const [label, edit, read] of edits) {
  test(`MJCF reconciliation preserves full precision for ${label}`, () => {
    const beforeRobot = parse(SOURCE);
    const afterRobot = structuredClone(beforeRobot);
    edit(afterRobot);
    const result = reconcileMJCFEditableSource({
      sourceContent: SOURCE, beforeRobot, afterRobot, sourceFileName: 'precision.xml',
    });
    assert.equal(result.status, 'patched', result.status === 'unsafe' ? result.reason : undefined);
    if (result.status !== 'patched') return;
    assert.deepEqual(read(parse(result.content)), read(afterRobot));
    assert.match(result.content, /<numeric name="vendor" data="1 2 3" \/>/);
  });
}

test('MJCF consecutive RPY edits tolerate only quaternion conversion roundoff', () => {
  let beforeRobot = parse(SOURCE);
  let content = SOURCE;
  for (const rotation of [0.123456789123456, 0.76543219876543, 1e-18]) {
    const afterRobot = structuredClone(beforeRobot);
    const rpy = { r: rotation, p: -rotation / 2, y: rotation / 3 };
    afterRobot.joints.hinge.origin.rpy = rpy;
    const result = reconcileMJCFEditableSource({
      sourceContent: content, beforeRobot, afterRobot, sourceFileName: 'precision.xml',
    });
    assert.equal(result.status, 'patched', result.status === 'unsafe' ? result.reason : undefined);
    if (result.status !== 'patched') return;
    const actual = parse(result.content).joints.hinge.origin.rpy;
    const toQuat = (value: typeof rpy) => new Quaternion()
      .setFromEuler(new Euler(value.r, value.p, value.y, 'ZYX'));
    const actualQuat = toQuat(actual);
    const expectedQuat = toQuat(rpy);
    for (const key of ['x', 'y', 'z'] as const) {
      assert.ok(Math.abs(actualQuat[key] - expectedQuat[key]) < Math.abs(rotation) * 1e-14);
    }
    content = result.content;
    beforeRobot = afterRobot;
  }
});

test('MJCF stale detection rejects small scalar edits and actual rotation changes', () => {
  for (const edit of [
    (robot: RobotState) => { robot.joints.hinge.origin.xyz.x = 1e-20; },
    (robot: RobotState) => { robot.joints.hinge.origin.rpy.r = 1e-18; },
    (robot: RobotState) => { robot.joints.hinge.origin.rpy.r = 1e-12; },
  ]) {
    const beforeRobot = parse(SOURCE);
    edit(beforeRobot);
    const afterRobot = structuredClone(beforeRobot);
    afterRobot.name = 'changed';
    const result = reconcileMJCFEditableSource({
      sourceContent: SOURCE, beforeRobot, afterRobot, sourceFileName: 'precision.xml',
    });
    assert.equal(result.status, 'unsafe');
    if (result.status === 'unsafe') assert.match(result.reason, /no longer matches/);
  }
});

test('MJCF degree-based sources retain tiny joint limits through consecutive edits', () => {
  let content = SOURCE.replace('angle="radian"', 'angle="degree"');
  let beforeRobot = parse(content);
  for (const upper of [1e-20, 0.123456789123456]) {
    const afterRobot = structuredClone(beforeRobot);
    afterRobot.joints.hinge.limit!.upper = upper;
    const result = reconcileMJCFEditableSource({
      sourceContent: content, beforeRobot, afterRobot, sourceFileName: 'degrees.xml',
    });
    assert.equal(result.status, 'patched', result.status === 'unsafe' ? result.reason : undefined);
    if (result.status !== 'patched') return;
    const parsed = parse(result.content);
    assert.ok(Math.abs(parsed.joints.hinge.limit!.upper! - upper) <= 4 * Number.EPSILON * Math.abs(upper));
    content = result.content;
    beforeRobot = afterRobot;
  }
});

test('MJCF stale detection rejects a tiny pitch change beside an ordinary roll', () => {
  const sourceContent = SOURCE.replace('name="arm" pos=', 'name="arm" euler="0.5 0 0" pos=');
  const beforeRobot = parse(sourceContent);
  beforeRobot.joints.hinge.origin.rpy.p = 1e-18;
  const afterRobot = structuredClone(beforeRobot);
  afterRobot.joints.hinge.origin.xyz.x = 0.125;
  const result = reconcileMJCFEditableSource({
    sourceContent, beforeRobot, afterRobot, sourceFileName: 'precision.xml',
  });
  assert.equal(result.status, 'unsafe');
  if (result.status === 'unsafe') assert.match(result.reason, /no longer matches/);
});

test('MJCF retains tiny pitch changes beside an ordinary roll through subsequent edits', () => {
  let content = SOURCE.replace('name="arm" pos=', 'name="arm" euler="0.5 0 0" pos=');
  let beforeRobot = parse(content);
  for (const pitch of [1e-18, -1e-18, 0]) {
    const afterRobot = structuredClone(beforeRobot);
    afterRobot.joints.hinge.origin.rpy.p = pitch;
    const result = reconcileMJCFEditableSource({
      sourceContent: content, beforeRobot, afterRobot, sourceFileName: 'precision.xml',
    });
    assert.equal(result.status, 'patched', result.status === 'unsafe' ? result.reason : undefined);
    if (result.status !== 'patched') return;
    assert.equal(result.level, 'attribute');
    const actualPitch = parse(result.content).joints.hinge.origin.rpy.p;
    assert.ok(Math.abs(actualPitch - pitch) <= Math.abs(pitch) * 2 * Number.EPSILON);
    content = result.content;
    beforeRobot = afterRobot;
  }
});

test('MJCF limit conversion tolerance never accepts stale zero or linear limits', () => {
  for (const jointType of ['hinge', 'slide']) {
    const sourceContent = SOURCE.replace('angle="radian"', 'angle="degree"')
      .replace('type="hinge" range="-1 1"', `type="${jointType}" range="-1 0"`);
    const beforeRobot = parse(sourceContent);
    beforeRobot.joints.hinge.limit!.upper = 1e-20;
    const afterRobot = structuredClone(beforeRobot);
    afterRobot.name = 'renamed';
    const result = reconcileMJCFEditableSource({
      sourceContent, beforeRobot, afterRobot, sourceFileName: 'degrees.xml',
    });
    assert.equal(result.status, 'unsafe');
    if (result.status === 'unsafe') assert.match(result.reason, /no longer matches/);
  }
});

test('MJCF degree limits reject a neighboring representable stale value', () => {
  const sourceContent = SOURCE.replace('angle="radian"', 'angle="degree"');
  const beforeRobot = parse(sourceContent);
  beforeRobot.joints.hinge.limit!.upper = 0.0174532925199433;
  const afterRobot = structuredClone(beforeRobot);
  afterRobot.name = 'changed';
  const result = reconcileMJCFEditableSource({
    sourceContent, beforeRobot, afterRobot, sourceFileName: 'degrees.xml',
  });
  assert.equal(result.status, 'unsafe');
  if (result.status === 'unsafe') assert.match(result.reason, /no longer matches/);
});
