import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_JOINT, DEFAULT_LINK, JointType, type RobotState } from '@/types';
import { generateMujocoXML } from './mjcf/mjcfGenerator';
import { generateSDF } from './sdf/sdfGenerator';

function createJointRobot(type: JointType): RobotState {
  return {
    name: 'warning_robot',
    rootLinkId: 'base',
    selection: { type: null, id: null },
    links: {
      base: { ...structuredClone(DEFAULT_LINK), id: 'base', name: 'base' },
      tip: { ...structuredClone(DEFAULT_LINK), id: 'tip', name: 'tip' },
    },
    joints: {
      mount: {
        ...structuredClone(DEFAULT_JOINT),
        id: 'mount',
        name: 'mount',
        parentLinkId: 'base',
        childLinkId: 'tip',
        type,
      },
    },
  };
}

const formats = [
  {
    format: 'MJCF',
    jointType: JointType.PLANAR,
    generate: generateMujocoXML,
    expectedWarning: /\[MJCF export\] Joint "mount" uses unsupported planar type/,
    assertOutput: (content: string) => assert.match(content, /<freejoint name="mount"\s*\/>/),
  },
  {
    format: 'SDF',
    jointType: JointType.FLOATING,
    generate: generateSDF,
    expectedWarning: /\[SDF export\] Joint "mount" uses unsupported floating type/,
    assertOutput: (content: string) => {
      assert.match(content, /<link name="tip">/);
      assert.doesNotMatch(content, /<joint name="mount"/);
    },
  },
] as const;

for (const { format, jointType, generate, expectedWarning, assertOutput } of formats) {
  test(`${format} internal serialization does not emit compatibility diagnostics without a warning callback`, (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const error = t.mock.method(console, 'error', () => {});
    const robot = createJointRobot(jointType);

    assertOutput(generate(robot));

    assert.equal(warn.mock.callCount(), 0);
    assert.equal(error.mock.callCount(), 0);
    assert.equal(robot.joints.mount.type, jointType);
  });

  test(`${format} explicit exports collect compatibility warnings only through their own callback`, (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const error = t.mock.method(console, 'error', () => {});
    const robot = createJointRobot(jointType);
    const warnings: string[] = [];

    const exported = generate(robot, { onWarning: (message) => warnings.push(message) });
    assertOutput(exported);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], expectedWarning);
    assert.equal(generate(robot), exported);
    assert.equal(warnings.length, 1);
    assert.equal(warn.mock.callCount(), 0);
    assert.equal(error.mock.callCount(), 0);
    assert.equal(robot.joints.mount.type, jointType);
  });
}
