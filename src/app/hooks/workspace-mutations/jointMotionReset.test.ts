import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  JointType,
  type JointQuaternion,
  type AssemblyState,
} from '@/types';

import {
  commitComponentJointMotionReset,
  resolveResettableJointAngles,
} from './jointMotionReset';

function createWorkspace(
  options: { lockedLinkId?: string } = {},
): AssemblyState {
  return {
    name: 'reset-test',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    bridges: {},
    components: {
      comp: {
        id: 'comp',
        name: 'robot',
        sourceFile: 'robots/quadruped.urdf',
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { r: 0, p: 0, y: 0 },
        },
        visible: true,
        robot: {
          name: 'quadruped',
          rootLinkId: 'base',
          links: {
            base: { ...DEFAULT_LINK, id: 'base', name: 'base' },
            thigh: {
              ...DEFAULT_LINK,
              id: 'thigh',
              name: 'thigh',
              editorLocked: options.lockedLinkId === 'thigh' ? true : undefined,
            },
            calf: { ...DEFAULT_LINK, id: 'calf', name: 'calf' },
          },
          joints: {
            hip_joint: {
              ...DEFAULT_JOINT,
              id: 'hip_joint',
              name: 'hip_joint',
              type: JointType.REVOLUTE,
              parentLinkId: 'base',
              childLinkId: 'thigh',
              angle: 0.55,
              limit: { lower: -0.863, upper: 0.863, effort: 23.7, velocity: 30.1 },
            },
            calf_joint: {
              ...DEFAULT_JOINT,
              id: 'calf_joint',
              name: 'calf_joint',
              type: JointType.REVOLUTE,
              parentLinkId: 'thigh',
              childLinkId: 'calf',
              angle: -1.5,
              // Load-time angle 0 sits outside this range, as it does for real
              // quadruped URDFs.
              limit: { lower: -2.818, upper: -0.888, effort: 35.55, velocity: 20.06 },
            },
          },
        },
      },
    },
  };
}

function createRecordingStore() {
  const events: string[] = [];
  const committedAngles: Record<string, number>[] = [];
  return {
    events,
    committedAngles,
    store: {
      beginWorkspaceTransaction: (label: string) => {
        events.push(`begin:${label}`);
        return 'operation-1';
      },
      cancelWorkspaceTransaction: (operationId: string) => {
        events.push(`cancel:${operationId}`);
        return false;
      },
      commitWorkspaceTransaction: (operationId: string) => {
        events.push(`commit:${operationId}`);
        return true;
      },
      flushPendingJointMotion: ({ operationId }: { operationId?: string } = {}) => {
        events.push(`flush-motion:${operationId}`);
        return true;
      },
      setComponentJointMotion: (
        componentId: string,
        angles: Record<string, number>,
        _quaternions?: Record<string, JointQuaternion>,
        options?: { operationId?: string },
      ) => {
        events.push(`set:${componentId}:${options?.operationId}`);
        committedAngles.push({ ...angles });
        return true;
      },
    },
  };
}

test('resets every joint in a single transaction, keeping angles outside their limit', () => {
  const workspace = createWorkspace();
  const { events, committedAngles, store } = createRecordingStore();

  const applied = commitComponentJointMotionReset({
    componentId: 'comp',
    jointAngles: { hip_joint: 0, calf_joint: 0 },
    flushPendingHistory: () => events.push('flush-history'),
    store,
    workspace,
  });

  // A single transaction means one undo step for the whole reset.
  assert.deepEqual(events, [
    'flush-history',
    'begin:Reset joint angles',
    'set:comp:operation-1',
    'flush-motion:operation-1',
    'commit:operation-1',
  ]);
  // calf_joint keeps its load-time 0 instead of being clamped to upper -0.888.
  assert.deepEqual(committedAngles, [{ hip_joint: 0, calf_joint: 0 }]);
  assert.deepEqual(applied, { hip_joint: 0, calf_joint: 0 });
});

test('skips locked joints instead of failing the whole reset', () => {
  const workspace = createWorkspace({ lockedLinkId: 'thigh' });

  const resettable = resolveResettableJointAngles(workspace, 'comp', {
    hip_joint: 0,
    calf_joint: 0,
  });

  // Both joints touch the locked `thigh` link, so neither may be written.
  assert.deepEqual(resettable, {});

  const { events, store } = createRecordingStore();
  const applied = commitComponentJointMotionReset({
    componentId: 'comp',
    jointAngles: { hip_joint: 0, calf_joint: 0 },
    flushPendingHistory: () => events.push('flush-history'),
    store,
    workspace,
  });

  assert.deepEqual(applied, {});
  assert.deepEqual(events, []);
});

test('drops unknown and non-finite joint angles', () => {
  const workspace = createWorkspace();

  assert.deepEqual(
    resolveResettableJointAngles(workspace, 'comp', {
      hip_joint: 0.25,
      missing_joint: 0.5,
      calf_joint: Number.NaN,
    }),
    { hip_joint: 0.25 },
  );
});

test('cancels the transaction when the reset write throws', () => {
  const workspace = createWorkspace();
  const events: string[] = [];

  assert.throws(() => {
    commitComponentJointMotionReset({
      componentId: 'comp',
      jointAngles: { hip_joint: 0 },
      flushPendingHistory: () => {},
      store: {
        beginWorkspaceTransaction: () => 'operation-1',
        cancelWorkspaceTransaction: (operationId: string) => {
          events.push(`cancel:${operationId}`);
          return true;
        },
        commitWorkspaceTransaction: () => true,
        flushPendingJointMotion: () => true,
        setComponentJointMotion: () => {
          throw new Error('write failed');
        },
      },
      workspace,
    });
  }, /write failed/);

  assert.deepEqual(events, ['cancel:operation-1']);
});
