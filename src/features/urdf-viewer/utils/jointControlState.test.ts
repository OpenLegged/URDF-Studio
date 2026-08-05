import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveInitialJointControlState } from './jointControlState.ts';

type MockJoint = {
  id: string;
  name?: string;
  jointType: string;
  angle?: number;
  setJointValue?: (angle: number) => void;
};

function createMockJoint(id: string, angle = 0): MockJoint {
  return {
    id,
    name: id,
    jointType: 'revolute',
    angle,
  };
}

test('resolveInitialJointControlState does not carry retained joint angles across isolated robot scopes', () => {
  const appliedAngles: number[] = [];
  const joints = {
    shoulder_joint: {
      ...createMockJoint('shoulder_joint', 0.4),
      setJointValue: (angle: number) => {
        appliedAngles.push(angle);
      },
    },
  };

  const result = resolveInitialJointControlState({
    joints,
    previousAngles: { shoulder_joint: 1.25 },
    preservePreviousAngles: false,
    isControllableJoint: () => true,
  });

  assert.deepEqual(result.currentAngles, { shoulder_joint: 0.4 });
  assert.deepEqual(appliedAngles, [0.4]);
});

test('resolveInitialJointControlState preserves retained joint angles when the viewer scope is unchanged', () => {
  const appliedAngles: number[] = [];
  const joints = {
    shoulder_joint: {
      ...createMockJoint('shoulder_joint', 0),
      setJointValue: (angle: number) => {
        appliedAngles.push(angle);
      },
    },
  };

  const result = resolveInitialJointControlState({
    joints,
    previousAngles: { shoulder_joint: 1.25 },
    preservePreviousAngles: true,
    isControllableJoint: () => true,
  });

  assert.deepEqual(result.currentAngles, { shoulder_joint: 1.25 });
  assert.deepEqual(appliedAngles, [1.25]);
});
