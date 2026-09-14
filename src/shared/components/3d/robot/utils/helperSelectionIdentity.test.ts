import test from 'node:test';
import assert from 'node:assert/strict';

import { GeometryType, JointType } from '../../../../../types/index';

import { resolveHelperSelectionIdentity } from './helperSelectionIdentity';

test('resolveHelperSelectionIdentity maps helper joint names back to source joint ids', () => {
  const result = resolveHelperSelectionIdentity({ type: 'joint', id: 'joint_1' }, undefined, {
    joint_internal: {
      id: 'joint_internal',
      name: 'joint_1',
      type: JointType.REVOLUTE,
      parentLinkId: 'base_link',
      childLinkId: 'link_2',
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      axis: { x: 0, y: 0, z: 1 },
      limit: { lower: -1, upper: 1, effort: 1, velocity: 1 },
      dynamics: { damping: 0, friction: 0 },
      hardware: {
        armature: 0,
        motorType: 'servo',
        motorId: 'motor-1',
        motorDirection: 1,
      },
    },
  });

  assert.deepEqual(result, { type: 'joint', id: 'joint_internal' });
});

test('resolveHelperSelectionIdentity maps helper link names back to source link ids', () => {
  const result = resolveHelperSelectionIdentity(
    { type: 'link', id: 'link_2' },
    {
      link_internal: {
        id: 'link_internal',
        name: 'link_2',
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#ffffff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          visible: true,
        },
        collision: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#ffffff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          visible: true,
        },
        collisionBodies: [],
      },
    },
    undefined,
  );

  assert.deepEqual(result, { type: 'link', id: 'link_internal' });
});

test('resolveHelperSelectionIdentity keeps unknown helper identities unchanged', () => {
  assert.deepEqual(resolveHelperSelectionIdentity({ type: 'joint', id: 'joint_1' }), {
    type: 'joint',
    id: 'joint_1',
  });
});
