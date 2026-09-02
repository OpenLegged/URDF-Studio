import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_JOINT, JointType, type UrdfJoint } from '@/types';

import { applyWorkspaceJointPropertyPatch } from './propertyPatches';

function createJoint(overrides: Partial<UrdfJoint> = {}): UrdfJoint {
  return {
    ...structuredClone(DEFAULT_JOINT),
    id: 'joint',
    name: 'joint',
    type: JointType.REVOLUTE,
    parentLinkId: 'base',
    childLinkId: 'tip',
    limit: { lower: -1, upper: 1, effort: 1, velocity: 1 },
    ...overrides,
  };
}

test('tightening a joint upper limit clamps the canonical angle in the same patch', () => {
  const next = applyWorkspaceJointPropertyPatch(
    createJoint({ angle: 0.8 }),
    { limit: { upper: 0.2 } },
  );

  assert.deepEqual(next.limit, { lower: -1, upper: 0.2, effort: 1, velocity: 1 });
  assert.equal(next.angle, 0.2);
});

test('tightening a joint lower limit clamps the canonical angle', () => {
  const next = applyWorkspaceJointPropertyPatch(
    createJoint({ angle: -0.8 }),
    { limit: { lower: -0.2 } },
  );

  assert.equal(next.angle, -0.2);
});

test('a missing canonical angle is only materialized when zero falls outside new limits', () => {
  const clamped = applyWorkspaceJointPropertyPatch(
    createJoint({ angle: undefined }),
    { limit: { lower: 0.3, upper: 1 } },
  );
  const unchanged = applyWorkspaceJointPropertyPatch(
    createJoint({ angle: undefined }),
    { limit: { lower: -0.3, upper: 1 } },
  );

  assert.equal(clamped.angle, 0.3);
  assert.equal(unchanged.angle, undefined);
});

test('crossed bounds are ordered before clamping the canonical angle', () => {
  const next = applyWorkspaceJointPropertyPatch(
    createJoint({ angle: 0 }),
    { limit: { lower: 2, upper: 1 } },
  );

  assert.equal(next.limit?.lower, 1);
  assert.equal(next.limit?.upper, 2);
  assert.equal(next.angle, 1);
});

test('non-position or incomplete limits do not clamp canonical motion', () => {
  const continuous = applyWorkspaceJointPropertyPatch(
    createJoint({ type: JointType.CONTINUOUS, angle: 3 }),
    { limit: { lower: -0.2, upper: 0.2 } },
  );
  const incomplete = applyWorkspaceJointPropertyPatch(
    createJoint({ angle: 0.8, limit: { effort: 1, velocity: 1 } }),
    { limit: { effort: 2 } },
  );

  assert.equal(continuous.angle, 3);
  assert.equal(incomplete.angle, 0.8);
});
