import assert from 'node:assert/strict';
import test from 'node:test';

import { commitProjectedJointMotionGroups } from './projectedJointMotionCommit';

test('commits projected joint groups in one workspace transaction', () => {
  const events: string[] = [];

  const changed = commitProjectedJointMotionGroups({
    flushPendingHistory: () => events.push('flush-history'),
    groups: [
      {
        componentId: 'component-a',
        jointAngles: { hip: 0.5 },
        jointQuaternions: {},
      },
      {
        componentId: 'component-b',
        jointAngles: {},
        jointQuaternions: { free: { x: 0, y: 0, z: 0, w: 1 } },
      },
    ],
    store: {
      beginWorkspaceTransaction: (label) => {
        events.push(`begin:${label}`);
        return 'operation-1';
      },
      cancelWorkspaceTransaction: () => false,
      commitWorkspaceTransaction: (operationId) => {
        events.push(`commit:${operationId}`);
        return true;
      },
      flushPendingJointMotion: ({ operationId } = {}) => {
        events.push(`flush-motion:${operationId}`);
        return true;
      },
      setComponentJointMotion: (componentId, _angles, _quaternions, options) => {
        events.push(`set:${componentId}:${options?.operationId}`);
        return true;
      },
    },
  });

  assert.equal(changed, true);
  assert.deepEqual(events, [
    'flush-history',
    'begin:Commit viewer joint motion',
    'set:component-a:operation-1',
    'set:component-b:operation-1',
    'flush-motion:operation-1',
    'commit:operation-1',
  ]);
});

test('cancels the transaction when a projected joint commit throws', () => {
  const events: string[] = [];

  assert.throws(() => {
    commitProjectedJointMotionGroups({
      flushPendingHistory: () => {},
      groups: [
        {
          componentId: 'component-a',
          jointAngles: { hip: 0.5 },
          jointQuaternions: {},
        },
      ],
      store: {
        beginWorkspaceTransaction: () => 'operation-1',
        cancelWorkspaceTransaction: (operationId) => {
          events.push(`cancel:${operationId}`);
          return true;
        },
        commitWorkspaceTransaction: () => false,
        flushPendingJointMotion: () => false,
        setComponentJointMotion: () => {
          throw new Error('motion failed');
        },
      },
    });
  }, /motion failed/);

  assert.deepEqual(events, ['cancel:operation-1']);
});

test('does not open a transaction for an empty projection', () => {
  let began = false;
  const changed = commitProjectedJointMotionGroups({
    flushPendingHistory: () => {},
    groups: [],
    store: {
      beginWorkspaceTransaction: () => {
        began = true;
        return 'unexpected';
      },
      cancelWorkspaceTransaction: () => false,
      commitWorkspaceTransaction: () => false,
      flushPendingJointMotion: () => false,
      setComponentJointMotion: () => false,
    },
  });

  assert.equal(changed, false);
  assert.equal(began, false);
});
