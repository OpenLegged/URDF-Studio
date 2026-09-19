import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import {
  createAssemblySceneProjection,
  createSingleComponentWorkspace,
  type AssemblySceneProjection,
} from '@/core/robot';
import { projectWorkspaceJointMotionToRenderer } from '@/features/editor';
import {
  useJointInteractionPreviewStore,
  type JointInteractionPreviewSnapshot,
} from '@/store/jointInteractionPreviewStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { useUIStore } from '@/store/uiStore';
import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  JointType,
  entityRefKey,
  type AssemblyState,
  type JointEntityRef,
  type RobotData,
} from '@/types';
import { useTreePanelJointPreview } from './useTreePanelJointPreview';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost',
});
Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true });
Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

function createRobot(): RobotData {
  return {
    name: 'door',
    rootLinkId: 'base',
    links: Object.fromEntries(
      ['base', 'door', 'handle'].map((id) => [
        id,
        { ...structuredClone(DEFAULT_LINK), id, name: id },
      ]),
    ),
    joints: {
      hinge: {
        ...structuredClone(DEFAULT_JOINT),
        id: 'hinge',
        name: 'hinge',
        parentLinkId: 'base',
        childLinkId: 'door',
        type: JointType.REVOLUTE,
        angle: 0,
        limit: { lower: -2, upper: 2, effort: 1, velocity: 1 },
      },
      follower: {
        ...structuredClone(DEFAULT_JOINT),
        id: 'follower',
        name: 'follower',
        parentLinkId: 'base',
        childLinkId: 'handle',
        type: JointType.REVOLUTE,
        angle: 0.2,
        limit: { lower: -2, upper: 2, effort: 1, velocity: 1 },
        mimic: { joint: 'hinge', multiplier: 0.5, offset: 0.2 },
      },
    },
  };
}

function createWorkspace(): AssemblyState {
  const workspace = createSingleComponentWorkspace(createRobot(), { componentId: 'left' });
  workspace.components.right = createSingleComponentWorkspace(createRobot(), {
    componentId: 'right',
  }).components.right;
  workspace.bridges.bridge = {
    id: 'bridge',
    name: 'bridge',
    parentComponentId: 'left',
    parentLinkId: 'base',
    childComponentId: 'right',
    childLinkId: 'base',
    joint: {
      ...structuredClone(DEFAULT_JOINT),
      id: 'bridge',
      name: 'bridge',
      parentLinkId: 'base',
      childLinkId: 'base',
      type: JointType.REVOLUTE,
      angle: 0,
      limit: { lower: -2, upper: 2, effort: 1, velocity: 1 },
    },
  };
  return workspace;
}

const leftHinge: JointEntityRef = { type: 'joint', componentId: 'left', entityId: 'hinge' };

async function mountPreview(workspace = createWorkspace()) {
  useJointInteractionPreviewStore.getState().clearPreview();
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  useUIStore.getState().setIgnoreJointLimits(false);
  const projection = createAssemblySceneProjection(workspace);
  const root = createRoot(document.createElement('div'));
  let result: ReturnType<typeof useTreePanelJointPreview> | undefined;
  const counts = { renders: 0, commits: 0, flushes: 0 };
  function Probe({ sceneProjection }: { sceneProjection: AssemblySceneProjection }) {
    counts.renders += 1;
    const currentWorkspace = useWorkspaceStore((state) => state.workspace);
    const motion = projectWorkspaceJointMotionToRenderer(currentWorkspace, sceneProjection);
    result = useTreePanelJointPreview({
      sceneProjection,
      jointAngleState: motion.jointAngles,
      jointMotionState: motion.jointMotion,
      handleCommittedJointChange: (ref, angle) => {
        counts.commits += 1;
        useWorkspaceStore.getState().driveWorkspaceJoint(ref, angle, {
          ignoreLimits: useUIStore.getState().ignoreJointLimits,
        });
      },
      flushJointMotion: () => {
        counts.flushes += 1;
        useWorkspaceStore.getState().flushPendingJointMotion();
      },
    });
    return null;
  }
  await act(async () => root.render(<Probe sceneProjection={projection} />));
  return {
    projection,
    counts,
    hook: () => {
      assert.ok(result);
      return result;
    },
    unmount: async () => {
      await act(async () => root.unmount());
    },
    changeProjection: async (next: AssemblySceneProjection) => {
      await act(async () => root.render(<Probe sceneProjection={next} />));
    },
  };
}

function previewState() {
  return useJointInteractionPreviewStore.getState().preview;
}

test('slider frames preview scoped component and mimic poses without workspace renders or history', async () => {
  const mounted = await mountPreview();
  try {
    const before = useWorkspaceStore.getState();
    const initialRenders = mounted.counts.renders;
    await act(async () => {
      for (let index = 1; index <= 60; index += 1) {
        mounted.hook().handleJointPreview(leftHinge, index / 100);
      }
    });
    const hingeId = mounted.projection.entityRefKeyToGlobal.get(entityRefKey(leftHinge))!;
    const followerRef: JointEntityRef = { ...leftHinge, entityId: 'follower' };
    const followerId = mounted.projection.entityRefKeyToGlobal.get(entityRefKey(followerRef))!;
    assert.equal(previewState().jointAngles[hingeId], 0.6);
    assert.equal(previewState().jointAngles[followerId], 0.5);
    assert.deepEqual(
      previewState().workspaceTargets?.map((target) => target.ref),
      [leftHinge, followerRef],
    );
    assert.equal(useWorkspaceStore.getState().workspace, before.workspace);
    assert.equal(useWorkspaceStore.getState().history, before.history);
    assert.equal(mounted.counts.renders, initialRenders);
    assert.equal(mounted.counts.commits, 0);

    await act(async () => mounted.hook().handleJointChange(leftHinge, 0.6));
    assert.equal(mounted.counts.commits, 1);
    assert.equal(mounted.counts.flushes, 1);
    assert.equal(useWorkspaceStore.getState().history.past.length, 1);
    assert.equal(
      useWorkspaceStore.getState().workspace.components.left.robot.joints.hinge.angle,
      0.6,
    );
    assert.equal(
      useWorkspaceStore.getState().workspace.components.right.robot.joints.hinge.angle,
      0,
    );
    assert.equal(previewState().source, null);
  } finally {
    await mounted.unmount();
  }
});

test('bridge previews use canonical refs and honor the joint limit override', async () => {
  const mounted = await mountPreview();
  try {
    const ref = { type: 'bridge' as const, bridgeId: 'bridge' };
    await act(async () => mounted.hook().handleJointPreview(ref, 3));
    assert.equal(previewState().jointAngles.bridge, 2);
    assert.deepEqual(previewState().workspaceTargets?.[0].ref, ref);
    useUIStore.getState().setIgnoreJointLimits(true);
    await act(async () => mounted.hook().handleJointPreview(ref, 3));
    assert.equal(previewState().jointAngles.bridge, 3);
    await act(async () => mounted.hook().handleJointChange(ref, 3));
    assert.equal(useWorkspaceStore.getState().workspace.bridges.bridge.joint.angle, 3);
    assert.equal(mounted.counts.commits, 1);
    assert.equal(previewState().source, null);
  } finally {
    await mounted.unmount();
  }
});

test('closed-loop preview solves the follower without committing either joint', async () => {
  const robot = createRobot();
  for (const joint of Object.values(robot.joints)) {
    joint.type = JointType.PRISMATIC;
    joint.axis = { x: 1, y: 0, z: 0 };
    joint.angle = 0;
    delete joint.mimic;
  }
  robot.joints.follower.origin.xyz.x = 1.2;
  robot.closedLoopConstraints = [
    {
      id: 'distance',
      type: 'distance',
      linkAId: 'door',
      linkBId: 'handle',
      restDistance: 1.2,
      anchorWorld: { x: 0, y: 0, z: 0 },
      anchorLocalA: { x: 0, y: 0, z: 0 },
      anchorLocalB: { x: 0, y: 0, z: 0 },
      source: { format: 'mjcf', body1Name: 'door', body2Name: 'handle' },
    },
  ];
  const mounted = await mountPreview(
    createSingleComponentWorkspace(robot, { componentId: 'left' }),
  );
  try {
    await act(async () => mounted.hook().handleJointPreview(leftHinge, 0.25));
    assert.ok(Math.abs(previewState().jointAngles.hinge - 0.25) < 1e-6);
    assert.ok(Math.abs(previewState().jointAngles.follower - 0.25) < 1e-5);
    assert.equal(
      useWorkspaceStore.getState().workspace.components.left.robot.joints.follower.angle,
      0,
    );
  } finally {
    await mounted.unmount();
  }
});

test('cancellation and projection changes restore canonical poses then clear only their own preview', async () => {
  const mounted = await mountPreview();
  const snapshots: JointInteractionPreviewSnapshot[] = [];
  const unsubscribe = useJointInteractionPreviewStore.subscribe((state) =>
    snapshots.push(state.preview),
  );
  try {
    await act(async () => mounted.hook().handleJointPreview(leftHinge, 0.8));
    await act(async () => mounted.hook().cancelJointPreview());
    const restored = snapshots.at(-2)!;
    assert.equal(
      restored.workspaceTargets?.find(
        (target) => target.ref.type === 'joint' && target.ref.entityId === 'hinge',
      )?.angle,
      0,
    );
    assert.equal(previewState().source, null);
    assert.equal(mounted.counts.commits, 0);
    await act(async () => mounted.hook().handleJointPreview(leftHinge, 0.9));
    await mounted.changeProjection(
      createAssemblySceneProjection(useWorkspaceStore.getState().workspace),
    );
    assert.equal(previewState().source, null);

    await act(async () => mounted.hook().handleJointPreview(leftHinge, 1));
    const foreign: JointInteractionPreviewSnapshot = {
      ...previewState(),
      ownerId: 'other-viewer',
      source: 'viewer',
      dragSessionId: 'other',
    };
    useJointInteractionPreviewStore.getState().publishPreview(foreign);
    await mounted.unmount();
    assert.equal(previewState(), foreign);
  } finally {
    unsubscribe();
    useJointInteractionPreviewStore.getState().clearPreview();
  }
});

test('stale refs and editor-locked components cannot publish transient joint motion', async () => {
  const workspace = createWorkspace();
  workspace.components.left.editorLocked = true;
  const mounted = await mountPreview(workspace);
  try {
    await act(async () => {
      mounted.hook().handleJointPreview(leftHinge, 0.7);
      mounted.hook().handleJointPreview({ ...leftHinge, componentId: 'missing' }, 0.7);
    });
    assert.equal(previewState().source, null);
    assert.equal(mounted.counts.commits, 0);
  } finally {
    await mounted.unmount();
  }
});

test('a rejected coupled-joint commit restores the canonical pose and leaves no pending preview', async () => {
  const workspace = createWorkspace();
  workspace.components.left.robot.links.handle.editorLocked = true;
  const mounted = await mountPreview(workspace);
  try {
    await act(async () => mounted.hook().handleJointPreview(leftHinge, 0.5));
    assert.equal(previewState().source, 'tree-panel');
    await act(async () => mounted.hook().handleJointChange(leftHinge, 0.5));
    assert.equal(previewState().source, null);
    assert.equal(
      useWorkspaceStore.getState().workspace.components.left.robot.joints.hinge.angle,
      0,
    );
    assert.equal(useWorkspaceStore.getState().history.past.length, 0);
  } finally {
    await mounted.unmount();
  }
});
