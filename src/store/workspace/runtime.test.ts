import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { Quaternion, Vector3 } from 'three';

import { createSingleComponentWorkspace } from '@/core/robot/canonicalWorkspace';
import { DEFAULT_JOINT, DEFAULT_LINK, JointType, type AssemblyState } from '@/types';
import { useWorkspaceStore } from '../workspaceStore';
import { createWorkspaceRuntime } from './runtime';

const linkRef = { type: 'link' as const, componentId: 'robot', entityId: 'base' };
const jointRef = { type: 'joint' as const, componentId: 'robot', entityId: 'hinge' };

function createWorkspace(): AssemblyState {
  return createSingleComponentWorkspace({
    name: 'robot',
    rootLinkId: 'base',
    links: {
      base: { ...structuredClone(DEFAULT_LINK), id: 'base', name: 'base' },
      tip: { ...structuredClone(DEFAULT_LINK), id: 'tip', name: 'tip' },
    },
    joints: {
      hinge: {
        ...structuredClone(DEFAULT_JOINT),
        id: 'hinge',
        name: 'hinge',
        type: JointType.REVOLUTE,
        parentLinkId: 'base',
        childLinkId: 'tip',
        angle: 0,
      },
    },
  }, { componentId: 'robot' });
}

function originX(workspace: AssemblyState): number {
  return workspace.components.robot!.robot.links.base!.visual.origin.xyz.x;
}

function jointAngle(workspace: AssemblyState): number | undefined {
  return workspace.components.robot!.robot.joints.hinge!.angle;
}

beforeEach(() => {
  const store = useWorkspaceStore.getState();
  if (store.transaction) store.cancelWorkspaceTransaction(store.transaction.id);
  store.replaceWorkspace(createWorkspace(), { resetHistory: true });
  store.clearHistory();
});

test('successive nested edits keep prior state and history isolated through undo and redo', () => {
  const store = useWorkspaceStore.getState();
  const initial = store.workspace;
  assert.equal(store.updateLink(linkRef, { visual: { origin: { xyz: { x: 1 } } } }), true);
  const first = useWorkspaceStore.getState().workspace;
  assert.equal(store.updateLink(linkRef, { visual: { origin: { xyz: { x: 2 } } } }), true);

  assert.equal(originX(initial), 0);
  assert.equal(originX(first), 1);
  assert.deepEqual(useWorkspaceStore.getState().history.past.map(originX), [0, 1]);
  assert.ok(Object.isFrozen(initial.components.robot!.robot.links.base!.visual.origin.xyz));

  assert.equal(store.undo(), true);
  assert.equal(originX(useWorkspaceStore.getState().workspace), 1);
  assert.equal(store.redo(), true);
  assert.equal(originX(useWorkspaceStore.getState().workspace), 2);
  store.updateLink(linkRef, { visual: { origin: { xyz: { x: 3 } } } });
  assert.deepEqual(useWorkspaceStore.getState().history.past.map(originX), [0, 1, 2]);
  assert.equal(originX(first), 1);
});

test('Immer joint motion and its deferred flush preserve ordinary edit snapshots', () => {
  const store = useWorkspaceStore.getState();
  store.renameWorkspace('edited');
  const beforeMotion = useWorkspaceStore.getState().workspace;
  const initialHistory = useWorkspaceStore.getState().history.past[0]!;

  assert.equal(store.setJointMotion(jointRef, 0.25), true);
  assert.equal(store.setJointMotion(jointRef, 0.5), true);
  assert.equal(jointAngle(beforeMotion), 0);
  assert.equal(jointAngle(initialHistory), 0);
  assert.equal(store.flushPendingJointMotion(), true);
  assert.equal(useWorkspaceStore.getState().history.past.length, 2);
  assert.equal(store.undo(), true);
  assert.equal(jointAngle(useWorkspaceStore.getState().workspace), 0);
  assert.equal(store.redo(), true);
  assert.equal(jointAngle(useWorkspaceStore.getState().workspace), 0.5);
  assert.equal(jointAngle(initialHistory), 0);
});

test('transaction commit and cancel retain independent nested snapshots', () => {
  const store = useWorkspaceStore.getState();
  store.updateLink(linkRef, { visual: { origin: { xyz: { x: 1 } } } });
  const existingHistory = useWorkspaceStore.getState().history.past[0]!;
  const operationId = store.beginWorkspaceTransaction('two nested edits');
  store.updateLink(linkRef, { visual: { origin: { xyz: { x: 2 } } } }, { operationId });
  store.updateLink(linkRef, { visual: { origin: { xyz: { x: 3 } } } }, { operationId });
  assert.equal(store.commitWorkspaceTransaction(operationId), true);
  assert.deepEqual(useWorkspaceStore.getState().history.past.map(originX), [0, 1]);

  const cancelledId = store.beginWorkspaceTransaction('cancelled nested edit');
  store.updateLink(linkRef, { visual: { origin: { xyz: { x: 4 } } } }, {
    operationId: cancelledId,
  });
  store.setJointMotion(jointRef, 0.75, { operationId: cancelledId });
  assert.equal(store.cancelWorkspaceTransaction(cancelledId), true);
  assert.equal(originX(useWorkspaceStore.getState().workspace), 3);
  assert.equal(jointAngle(useWorkspaceStore.getState().workspace), 0);
  assert.equal(originX(existingHistory), 0);
  assert.equal(store.undo(), true);
  assert.equal(originX(useWorkspaceStore.getState().workspace), 1);
  assert.equal(store.redo(), true);
  assert.equal(originX(useWorkspaceStore.getState().workspace), 3);
});

test('equivalent nested values and invalid recipes preserve state, history and return values', () => {
  const store = useWorkspaceStore.getState();
  const before = store.workspace;
  const history = store.history;
  const revision = store.revision;
  assert.equal(store.updateComponentTransform(
    'robot',
    structuredClone(before.components.robot!.transform),
  ), false);
  assert.equal(store.replaceWorkspace(structuredClone(before)), false);
  const runtime = createWorkspaceRuntime(useWorkspaceStore.setState, useWorkspaceStore.getState);
  assert.throws(() => runtime.applyMutation('invalid recipe', (draft) => {
    draft.components.robot!.robot.links.base!.visual.origin.xyz.x = 5;
    delete draft.components.robot;
  }), /Invalid canonical/);
  assert.throws(() => runtime.applyMutation('throwing recipe', (draft) => {
    draft.name = 'discarded';
    throw new Error('recipe failed');
  }), /recipe failed/);

  const after = useWorkspaceStore.getState();
  assert.equal(after.workspace, before);
  assert.equal(after.history, history);
  assert.equal(after.revision, revision);
  assert.equal(originX(before), 0);
});

test('recipe replacements still override draft writes and last-component removal stays canonical', () => {
  const runtime = createWorkspaceRuntime(useWorkspaceStore.setState, useWorkspaceStore.getState);
  const before = useWorkspaceStore.getState().workspace;
  const replacement = createWorkspace();
  replacement.name = 'replacement';
  assert.equal(runtime.applyMutation('replacement', (draft) => {
    draft.components.robot!.robot.links.base!.visual.origin.xyz.x = 5;
    return replacement;
  }), true);
  assert.equal(useWorkspaceStore.getState().workspace.name, 'replacement');
  assert.equal(originX(useWorkspaceStore.getState().workspace), 0);
  assert.equal(originX(before), 0);
  assert.equal(runtime.applyMutation('explicit draft', (draft) => {
    draft.name = 'explicit';
    return draft;
  }), true);
  assert.equal(useWorkspaceStore.getState().removeComponent('robot'), true);
  assert.equal(Object.keys(useWorkspaceStore.getState().workspace.components).length, 1);
  assert.equal(useWorkspaceStore.getState().undo(), true);
  assert.equal(useWorkspaceStore.getState().workspace.name, 'explicit');
});

test('external replacement and restored history inputs cannot mutate store snapshots', () => {
  const store = useWorkspaceStore.getState();
  const replacement = createWorkspace();
  replacement.name = 'external';
  assert.equal(store.replaceWorkspace(replacement), true);
  replacement.components.robot!.robot.links.base!.visual.origin.xyz.x = 9;
  assert.equal(originX(useWorkspaceStore.getState().workspace), 0);

  const restored = createWorkspace();
  const past = createWorkspace();
  const future = createWorkspace();
  past.name = 'past';
  future.name = 'future';
  assert.equal(store.restoreWorkspace(restored, { past: [past], future: [future], activity: [] }), true);
  restored.components.robot!.robot.links.base!.visual.origin.xyz.x = 6;
  past.components.robot!.robot.links.base!.visual.origin.xyz.x = 7;
  future.components.robot!.robot.links.base!.visual.origin.xyz.x = 8;
  assert.equal(originX(useWorkspaceStore.getState().workspace), 0);
  assert.equal(originX(useWorkspaceStore.getState().history.past[0]!), 0);
  assert.equal(originX(useWorkspaceStore.getState().history.future[0]!), 0);
  store.renameWorkspace('after restore');
  assert.equal(store.undo(), true);
  assert.equal(originX(useWorkspaceStore.getState().workspace), 0);
});

test('component source robots and property inputs remain detached from history', () => {
  const store = useWorkspaceStore.getState();
  const sourceRobot = createWorkspace().components.robot!.robot;
  sourceRobot.name = 'external source';
  assert.equal(store.replaceComponentRobot('robot', sourceRobot), true);
  const sourceSnapshot = useWorkspaceStore.getState().workspace;
  const origin = { xyz: { x: 1 } };
  assert.equal(store.updateLink(linkRef, { visual: { origin } }), true);
  const propertySnapshot = useWorkspaceStore.getState().workspace;

  sourceRobot.links.base!.visual.origin.xyz.x = 6;
  origin.xyz.x = 7;
  assert.equal(originX(sourceSnapshot), 0);
  assert.equal(originX(propertySnapshot), 1);
  store.updateLink(linkRef, { visual: { origin: { xyz: { x: 2 } } } });
  assert.equal(originX(sourceSnapshot), 0);
  assert.equal(originX(propertySnapshot), 1);
  assert.deepEqual(useWorkspaceStore.getState().history.past.map(originX), [0, 0, 1]);
});

test('workspace joint driving preserves limits, temporary overrides and deferred history', () => {
  const workspace = createWorkspace();
  workspace.components.robot!.robot.joints.hinge!.limit = {
    lower: -0.5, upper: 0.5, effort: 1, velocity: 1,
  };
  const store = useWorkspaceStore.getState();
  store.replaceWorkspace(workspace, { resetHistory: true });

  assert.equal(store.driveWorkspaceJoint(jointRef, 1), true);
  assert.equal(jointAngle(useWorkspaceStore.getState().workspace), 0.5);
  assert.equal(store.driveWorkspaceJoint(jointRef, 1, { ignoreLimits: true }), true);
  assert.equal(jointAngle(useWorkspaceStore.getState().workspace), 1);
  assert.equal(useWorkspaceStore.getState().history.past.length, 0);
  assert.equal(store.flushPendingJointMotion(), true);
  assert.equal(useWorkspaceStore.getState().history.past.length, 1);
  assert.equal(store.undo(), true);
  assert.equal(jointAngle(useWorkspaceStore.getState().workspace), 0);
  assert.equal(store.redo(), true);
  assert.equal(jointAngle(useWorkspaceStore.getState().workspace), 1);
});

test('workspace joint driving maps closed-loop passive quaternion solutions back to their component', () => {
  const workspace = createWorkspace();
  const robot = workspace.components.robot!.robot;
  robot.joints.hinge!.axis = { x: 0, y: 0, z: 1 };
  robot.links.passive = { ...structuredClone(DEFAULT_LINK), id: 'passive', name: 'passive' };
  robot.joints.passive = {
    ...structuredClone(DEFAULT_JOINT), id: 'passive', name: 'passive',
    type: JointType.BALL, parentLinkId: 'base', childLinkId: 'passive',
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
  };
  robot.closedLoopConstraints = [{
    id: 'closure', type: 'joint', jointType: JointType.FIXED,
    linkAId: 'tip', linkBId: 'passive',
    anchorLocalA: { x: 0, y: 0, z: 0 }, anchorLocalB: { x: 0, y: 0, z: 0 },
    anchorWorld: { x: 0, y: 0, z: 0 },
    origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    axis: { x: 0, y: 0, z: 1 },
  }];
  const store = useWorkspaceStore.getState();
  store.replaceWorkspace(workspace, { resetHistory: true });

  assert.equal(store.driveWorkspaceJoint(jointRef, 0.4), true);
  const driven = useWorkspaceStore.getState().workspace.components.robot!.robot;
  assert.ok(Math.abs(driven.joints.hinge!.angle! - 0.4) < 2e-5);
  const passive = driven.joints.passive!.quaternion!;
  const expected = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.4);
  assert.ok(new Quaternion(passive.x, passive.y, passive.z, passive.w).angleTo(expected) < 2e-5);
  assert.equal(store.flushPendingJointMotion(), true);
  assert.equal(store.undo(), true);
  assert.deepEqual(useWorkspaceStore.getState().workspace.components.robot!.robot.joints.passive!.quaternion,
    { x: 0, y: 0, z: 0, w: 1 });
});
