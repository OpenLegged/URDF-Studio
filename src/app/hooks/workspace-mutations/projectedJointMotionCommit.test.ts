import assert from 'node:assert/strict';
import test from 'node:test';

import { commitProjectedJointMotionTargets } from './projectedJointMotionCommit';

test('commits projected component and bridge joints in one workspace transaction', () => {
  const events: string[] = [];

  const changed = commitProjectedJointMotionTargets({
    flushPendingHistory: () => events.push('flush-history'),
    targets: [
      {
        ref: { type: 'joint', componentId: 'component-a', entityId: 'hip' },
        angle: 0.5,
      },
      {
        ref: { type: 'bridge', bridgeId: 'bridge-a-b' },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
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
      setWorkspaceJointMotion: (targets, options) => {
        events.push(`set:${targets.length}:${options?.operationId}`);
        return true;
      },
    },
  });

  assert.equal(changed, true);
  assert.deepEqual(events, [
    'flush-history',
    'begin:Commit viewer joint motion',
    'set:2:operation-1',
    'flush-motion:operation-1',
    'commit:operation-1',
  ]);
});

test('cancels the transaction when a projected joint commit throws', () => {
  const events: string[] = [];

  assert.throws(() => {
    commitProjectedJointMotionTargets({
      flushPendingHistory: () => {},
      targets: [
        {
          ref: { type: 'joint', componentId: 'component-a', entityId: 'hip' },
          angle: 0.5,
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
        setWorkspaceJointMotion: () => {
          throw new Error('motion failed');
        },
      },
    });
  }, /motion failed/);

  assert.deepEqual(events, ['cancel:operation-1']);
});

test('does not open a transaction for an empty projection', () => {
  let began = false;
  const changed = commitProjectedJointMotionTargets({
    flushPendingHistory: () => {},
    targets: [],
    store: {
      beginWorkspaceTransaction: () => {
        began = true;
        return 'unexpected';
      },
      cancelWorkspaceTransaction: () => false,
      commitWorkspaceTransaction: () => false,
      flushPendingJointMotion: () => false,
      setWorkspaceJointMotion: () => false,
    },
  });

  assert.equal(changed, false);
  assert.equal(began, false);
});
