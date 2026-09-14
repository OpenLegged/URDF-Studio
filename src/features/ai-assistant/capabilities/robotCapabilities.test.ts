import assert from 'node:assert/strict';
import test from 'node:test';

import { createJoint, createLink } from '@/core/robot';
import { JointType, type RobotData } from '@/types';
import { validateRobotDraft } from './robotCapabilities';

function createRobot(type: JointType): RobotData {
  return {
    name: 'multi-format-draft',
    rootLinkId: 'base',
    links: {
      base: createLink({ id: 'base' }),
      child: createLink({ id: 'child' }),
    },
    joints: {
      joint: createJoint({ id: 'joint', parentLinkId: 'base', childLinkId: 'child', type }),
    },
  };
}

for (const type of [JointType.BALL, JointType.FLOATING]) {
  test(`AI validation retains ${type} joints without an export round-trip`, () => {
    const robot = createRobot(type);
    const before = structuredClone(robot);

    assert.equal(validateRobotDraft(robot).ok, true);
    assert.deepEqual(robot, before);
  });
}

test('AI validation still rejects missing joint endpoints and invalid numeric fields', () => {
  const robot = createRobot(JointType.BALL);
  robot.joints.joint.childLinkId = 'missing';
  robot.links.base.visual.dimensions.x = Number.NaN;

  const result = validateRobotDraft(robot);

  assert.equal(result.ok, false);
  assert.match(result.message, /missing source-local link/);
  assert.match(result.message, /dimensions.x/);
});

test('AI validation still rejects cycles and multiple parent joints', () => {
  const robot = createRobot(JointType.BALL);
  robot.joints.back = createJoint({ id: 'back', parentLinkId: 'child', childLinkId: 'base' });
  robot.joints.duplicate = createJoint({ id: 'duplicate', parentLinkId: 'base', childLinkId: 'child' });

  const result = validateRobotDraft(robot);

  assert.equal(result.ok, false);
  assert.match(result.message, /cyclic joint graph/);
  assert.match(result.message, /duplicates parent joint/);
});
