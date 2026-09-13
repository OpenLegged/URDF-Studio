import test from 'node:test';
import assert from 'node:assert/strict';

import { JointType, type UrdfJoint } from '../../../../../types/index';
import { isPassiveSpringJointDragTarget } from './passiveSpringJointDragTarget';

function createJoint(overrides: Partial<UrdfJoint> = {}): UrdfJoint {
  return {
    id: 'joint_a',
    name: 'joint_a',
    type: JointType.REVOLUTE,
    parentLinkId: 'parent',
    childLinkId: 'child',
    origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    axis: { x: 0, y: 0, z: 1 },
    limit: { lower: -1, upper: 1, effort: 0, velocity: 0 },
    dynamics: { damping: 0, friction: 0 },
    hardware: { armature: 0, motorType: '', motorId: '', motorDirection: 1 },
    ...overrides,
  };
}

test('isPassiveSpringJointDragTarget identifies unactuated MJCF spring hinges', () => {
  const joints = {
    joint_a: createJoint({
      dynamics: { damping: 0.1, friction: 0, stiffness: 1500 },
      limit: { lower: -0.35, upper: 0.35, effort: 0, velocity: 0 },
    }),
  };

  assert.equal(isPassiveSpringJointDragTarget('joint_a', joints), true);
});

test('isPassiveSpringJointDragTarget keeps actuated spring joints directly draggable', () => {
  const joints = {
    joint_a: createJoint({
      dynamics: { damping: 0.1, friction: 0, stiffness: 1500 },
      limit: { lower: -0.35, upper: 0.35, effort: 12, velocity: 0 },
    }),
  };

  assert.equal(isPassiveSpringJointDragTarget('joint_a', joints), false);
});

test('isPassiveSpringJointDragTarget ignores ordinary unactuated joints without stiffness', () => {
  const joints = {
    joint_a: createJoint({
      dynamics: { damping: 0.1, friction: 0 },
      limit: { lower: -0.35, upper: 0.35, effort: 0, velocity: 0 },
    }),
  };

  assert.equal(isPassiveSpringJointDragTarget('joint_a', joints), false);
});

test('isPassiveSpringJointDragTarget keeps low-stiffness compliant joints draggable', () => {
  const joints = {
    joint_a: createJoint({
      dynamics: { damping: 0.1, friction: 0, stiffness: 0.05 },
      limit: { lower: -0.35, upper: 0.35, effort: 0, velocity: 0 },
    }),
  };

  assert.equal(isPassiveSpringJointDragTarget('joint_a', joints), false);
});

test('isPassiveSpringJointDragTarget falls back to runtime MJCF spring metadata', () => {
  assert.equal(
    isPassiveSpringJointDragTarget('left-shin', {}, {
      userData: { mjcfHardPassiveSpringJoint: true },
    }),
    true,
  );
});

test('isPassiveSpringJointDragTarget trusts runtime metadata when RobotState is incomplete', () => {
  const joints = {
    joint_a: createJoint({
      dynamics: { damping: 0.1, friction: 0 },
      limit: { lower: -0.35, upper: 0.35, effort: 0, velocity: 0 },
    }),
  };

  assert.equal(
    isPassiveSpringJointDragTarget('joint_a', joints, {
      userData: { mjcfHardPassiveSpringJoint: true },
    }),
    true,
  );
});
