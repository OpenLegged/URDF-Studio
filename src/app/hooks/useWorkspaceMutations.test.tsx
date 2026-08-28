import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  createComponentSourceDraft,
  isComponentSourceDraftMatchingComponent,
} from '@/core/robot';
import { useAssetsStore } from '@/store/assetsStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { useSelectionStore } from '@/store/selectionStore';
import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  JointType,
  type AssemblyComponent,
  type AssemblyState,
  type RobotData,
  type UrdfInertial,
  type UrdfJoint,
  type UrdfLink,
} from '@/types';

import { useWorkspaceMutations } from './useWorkspaceMutations';
import type { UseWorkspaceMutationsParams } from './useWorkspaceMutationsTypes';

const IDENTITY_TRANSFORM = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { r: 0, p: 0, y: 0 },
};

function createInertial(mass: number): UrdfInertial {
  return {
    mass,
    origin: {
      xyz: { x: 0, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: 0 },
    },
    inertia: {
      ixx: mass,
      ixy: 0,
      ixz: 0,
      iyy: mass,
      iyz: 0,
      izz: mass,
    },
  };
}

function createLink(id: string, mass = 1): UrdfLink {
  return {
    ...structuredClone(DEFAULT_LINK),
    id,
    name: id,
    inertial: createInertial(mass),
  };
}

function createJoint(id: string): UrdfJoint {
  return {
    ...structuredClone(DEFAULT_JOINT),
    id,
    name: id,
    type: JointType.REVOLUTE,
    parentLinkId: 'base_link',
    childLinkId: 'shared_link',
  };
}

function createRobot(name: string, mass: number): RobotData {
  return {
    name,
    rootLinkId: 'base_link',
    links: {
      base_link: createLink('base_link'),
      shared_link: createLink('shared_link', mass),
    },
    joints: { shared_joint: createJoint('shared_joint') },
  };
}

function createComponent(
  id: string,
  mass: number,
  sourceFile: string | null,
): AssemblyComponent {
  return {
    id,
    name: `${id} display`,
    sourceFile,
    robot: createRobot(`${id} source robot`, mass),
    transform: structuredClone(IDENTITY_TRANSFORM),
    visible: true,
  };
}

function createWorkspace(includeRight = true): AssemblyState {
  return {
    name: 'workspace',
    transform: structuredClone(IDENTITY_TRANSFORM),
    components: {
      left: createComponent('left', 1, 'shared/robot.urdf'),
      ...(includeRight
        ? { right: createComponent('right', 2, 'shared/robot.urdf') }
        : {}),
    },
    bridges: {},
  };
}

function installWorkspace(workspace = createWorkspace()): void {
  const current = useWorkspaceStore.getState();
  if (current.transaction) {
    current.cancelWorkspaceTransaction(current.transaction.id);
  }
  current.flushPendingJointMotion({ skipHistory: true });
  current.replaceWorkspace(workspace, { resetHistory: true });
  useWorkspaceStore.setState({
    history: { past: [], future: [], activity: [] },
    revision: 0,
    jointMotionRevision: 0,
  });
  useAssetsStore.setState({
    availableFiles: [],
    allFileContents: {},
    componentSourceDrafts: {},
  });
  useSelectionStore.setState({ selection: null });
}

function renderMutations(
  overrides: Partial<UseWorkspaceMutationsParams> = {},
): ReturnType<typeof useWorkspaceMutations> {
  let hookValue: ReturnType<typeof useWorkspaceMutations> | null = null;
  const params: UseWorkspaceMutationsParams = {
    focusOn: () => {},
    setSelection: () => {},
    setPendingCollisionTransform: () => {},
    clearPendingCollisionTransform: () => {},
    handleTransformPendingChange: () => {},
    ...overrides,
  };

  function Probe() {
    hookValue = useWorkspaceMutations(params);
    return null;
  }

  renderToStaticMarkup(React.createElement(Probe));
  assert.ok(hookValue);
  return hookValue;
}

beforeEach(() => installWorkspace());

test('explicit refs isolate same-local-ID mutations and source patch targets', () => {
  const inertialPatches: Array<{
    componentId: string;
    expectedRobotSnapshotHash: string;
    linkName: string;
    inertial: UrdfInertial;
  }> = [];
  const mutations = renderMutations({
    patchEditableSourceUpdateLinkInertial: (args) => inertialPatches.push(args),
  });

  mutations.handleUpdate(
    { type: 'link', componentId: 'left', entityId: 'shared_link' },
    { inertial: createInertial(12.34) },
    { commitMode: 'immediate' },
  );

  const state = useWorkspaceStore.getState();
  assert.equal(
    state.workspace.components.left!.robot.links.shared_link!.inertial?.mass,
    12.34,
  );
  assert.equal(
    state.workspace.components.right!.robot.links.shared_link!.inertial?.mass,
    2,
  );
  assert.equal(state.history.past.length, 1);
  assert.equal(inertialPatches.length, 1);
  assert.equal(inertialPatches[0]?.componentId, 'left');
  assert.match(inertialPatches[0]?.expectedRobotSnapshotHash ?? '', /^robot-semantic-v1:/);
  assert.equal(inertialPatches[0]?.linkName, 'shared_link');
  assert.deepEqual(inertialPatches[0]?.inertial, createInertial(12.34));
});

test('debounced property edits share one workspace transaction and one history entry', () => {
  const mutations = renderMutations();
  const ref = { type: 'link', componentId: 'left', entityId: 'shared_link' } as const;

  mutations.handleUpdate(ref, { inertial: createInertial(3) });
  assert.ok(useWorkspaceStore.getState().transaction);
  assert.equal(useWorkspaceStore.getState().history.past.length, 0);
  mutations.handleUpdate(
    ref,
    { inertial: createInertial(4) },
    { commitMode: 'immediate' },
  );

  const state = useWorkspaceStore.getState();
  assert.equal(state.transaction, null);
  assert.equal(state.history.past.length, 1);
  assert.equal(
    state.workspace.components.left!.robot.links.shared_link!.inertial?.mass,
    4,
  );
});

test('unhandled visual and joint properties stay synchronized to editable source', () => {
  installWorkspace(createWorkspace(false));
  const mutations = renderMutations();

  mutations.handleUpdate(
    { type: 'link', componentId: 'left', entityId: 'shared_link' },
    { visual: { dimensions: { x: 0.125 } } },
    { commitMode: 'immediate' },
  );
  mutations.handleUpdate(
    { type: 'joint', componentId: 'left', entityId: 'shared_joint' },
    { origin: { xyz: { x: 0.33 } } },
    { commitMode: 'immediate' },
  );

  const component = useWorkspaceStore.getState().workspace.components.left;
  const draft = useAssetsStore.getState().componentSourceDrafts.left;
  assert.match(draft.content, /radius="0\.125"/);
  assert.match(draft.content, /<origin xyz="0\.33 0 0\.5"/);
  assert.equal(isComponentSourceDraftMatchingComponent(draft, component), true);
});

test('a failed transactional mutation cancels its exact token and restores partial writes', () => {
  const mutations = renderMutations();
  const originalUpdateLink = useWorkspaceStore.getState().updateLink;
  useWorkspaceStore.setState({
    updateLink: (ref, patch, options) => {
      originalUpdateLink(ref, patch, options);
      throw new Error('simulated follow-up failure');
    },
  });

  try {
    assert.throws(
      () => mutations.handleUpdate(
        { type: 'link', componentId: 'left', entityId: 'shared_link' },
        { name: 'partial name' },
        { commitMode: 'immediate' },
      ),
      /simulated follow-up failure/,
    );
  } finally {
    useWorkspaceStore.setState({ updateLink: originalUpdateLink });
  }

  const state = useWorkspaceStore.getState();
  assert.equal(state.transaction, null);
  assert.equal(state.workspace.components.left!.robot.links.shared_link!.name, 'shared_link');
  assert.equal(state.history.past.length, 0);
  assert.equal(state.history.activity.length, 0);
});

test('source-less components carry null to source patch callbacks without fallback routing', () => {
  const workspace = createWorkspace(false);
  workspace.components.left!.sourceFile = null;
  installWorkspace(workspace);
  const patches: Array<{ componentId: string; expectedRobotSnapshotHash: string }> = [];
  const mutations = renderMutations({
    patchEditableSourceUpdateLinkInertial: (args) => patches.push({
      componentId: args.componentId,
      expectedRobotSnapshotHash: args.expectedRobotSnapshotHash,
    }),
  });

  mutations.handleUpdate(
    { type: 'link', componentId: 'left', entityId: 'shared_link' },
    { inertial: createInertial(8) },
    { commitMode: 'immediate' },
  );

  assert.equal(patches.length, 1);
  assert.equal(patches[0]?.componentId, 'left');
  assert.match(patches[0]?.expectedRobotSnapshotHash ?? '', /^robot-semantic-v1:/);
});

test('renderer strategy changes never alter explicit mutation routing', () => {
  installWorkspace(createWorkspace(false));
  assert.equal(
    useWorkspaceStore.getState().getSceneProjection().renderStrategy,
    'direct-component',
  );
  const mutations = renderMutations();
  const ref = { type: 'link', componentId: 'left', entityId: 'shared_link' } as const;
  mutations.handleUpdate(ref, { inertial: createInertial(5) }, { commitMode: 'immediate' });

  useWorkspaceStore.getState().appendComponent({
    id: 'right',
    sourceFile: 'right.urdf',
    robot: createRobot('right source robot', 2),
  });
  assert.equal(
    useWorkspaceStore.getState().getSceneProjection().renderStrategy,
    'assembled-scene',
  );
  mutations.handleUpdate(ref, { inertial: createInertial(6) }, { commitMode: 'immediate' });

  assert.equal(
    useWorkspaceStore.getState().workspace.components.left!.robot.links.shared_link!
      .inertial?.mass,
    6,
  );
  assert.equal(
    useWorkspaceStore.getState().workspace.components.right!.robot.links.shared_link!
      .inertial?.mass,
    2,
  );
});

test('joint motion remains component-local and flushes to history once', () => {
  const mutations = renderMutations();
  const ref = { type: 'joint', componentId: 'left', entityId: 'shared_joint' } as const;

  mutations.handleJointChange(ref, 0.25);
  mutations.handleJointChange(ref, 0.75);
  assert.equal(useWorkspaceStore.getState().history.past.length, 0);
  mutations.flushJointMotion();

  const state = useWorkspaceStore.getState();
  assert.equal(state.history.past.length, 1);
  assert.equal(state.workspace.components.left!.robot.joints.shared_joint!.angle, 0.75);
  assert.equal(state.workspace.components.right!.robot.joints.shared_joint!.angle, undefined);
});

test('component display name, robot name, and workspace name stay independent', () => {
  const mutations = renderMutations();
  const ref = { type: 'component', componentId: 'left' } as const;

  mutations.handleComponentNameChange(ref, 'Operator label');
  assert.equal(useWorkspaceStore.getState().workspace.components.left!.name, 'Operator label');
  assert.equal(
    useWorkspaceStore.getState().workspace.components.left!.robot.name,
    'left source robot',
  );
  assert.equal(useWorkspaceStore.getState().workspace.name, 'workspace');

  mutations.handleRobotNameChange(ref, 'Source robot renamed');
  assert.equal(useWorkspaceStore.getState().workspace.components.left!.name, 'Operator label');
  assert.equal(
    useWorkspaceStore.getState().workspace.components.left!.robot.name,
    'Source robot renamed',
  );
  assert.equal(useWorkspaceStore.getState().workspace.name, 'workspace');
});

test('bridged child placement rejects component transform writes and commits bridge origin once', () => {
  const workspace = createWorkspace();
  workspace.bridges.mount = {
    id: 'mount',
    name: 'Mount bridge',
    parentComponentId: 'left',
    parentLinkId: 'base_link',
    childComponentId: 'right',
    childLinkId: 'base_link',
    joint: {
      ...structuredClone(DEFAULT_JOINT),
      id: 'mount',
      name: 'Mount bridge',
      type: JointType.FIXED,
      parentLinkId: 'base_link',
      childLinkId: 'base_link',
      origin: {
        xyz: { x: 0, y: 0, z: 0 },
        rpy: { r: 0, p: 0, y: 0 },
        quatXyzw: { x: 0, y: 0, z: 0, w: 1 },
      },
    },
  };
  installWorkspace(workspace);
  const mutations = renderMutations();
  const componentTransformBefore = structuredClone(
    useWorkspaceStore.getState().workspace.components.right!.transform,
  );

  mutations.handleComponentTransform(
    { type: 'component', componentId: 'right' },
    {
      position: { x: 99, y: 98, z: 97 },
      rotation: { r: 0.9, p: 0.8, y: 0.7 },
    },
    { commitMode: 'immediate' },
  );
  assert.deepEqual(
    useWorkspaceStore.getState().workspace.components.right!.transform,
    componentTransformBefore,
  );
  assert.equal(useWorkspaceStore.getState().history.past.length, 0);

  mutations.handleUpdate(
    { type: 'bridge', bridgeId: 'mount' },
    {
      joint: {
        origin: structuredClone(
          useWorkspaceStore.getState().workspace.bridges.mount!.joint.origin,
        ),
      },
    },
    { commitMode: 'immediate' },
  );
  assert.equal(useWorkspaceStore.getState().history.past.length, 0);

  const origin = {
    xyz: { x: 4, y: 5, z: 6 },
    rpy: { r: -0.1, p: 0.2, y: -0.3 },
    quatXyzw: undefined,
  };
  mutations.handleUpdate(
    { type: 'bridge', bridgeId: 'mount' },
    { joint: { origin } },
    { commitMode: 'immediate' },
  );
  assert.deepEqual(
    useWorkspaceStore.getState().workspace.bridges.mount!.joint.origin,
    origin,
  );
  assert.equal(useWorkspaceStore.getState().history.past.length, 1);

  mutations.handleUpdate(
    { type: 'bridge', bridgeId: 'mount' },
    { joint: { origin } },
    { commitMode: 'immediate' },
  );
  assert.equal(useWorkspaceStore.getState().history.past.length, 1);
});

test('delete and visibility handlers route canonical entity kinds without ID scanning', () => {
  const initialWorkspace = useWorkspaceStore.getState().workspace;
  useAssetsStore.getState().replaceComponentSourceDrafts(Object.fromEntries(
    ['left', 'right'].map((componentId) => [
      componentId,
      createComponentSourceDraft({
        componentId,
        format: 'urdf',
        content: `<robot name="${componentId}" />`,
        robot: initialWorkspace.components[componentId]!.robot,
      }),
    ]),
  ));
  useSelectionStore.getState().setSelection({
    entity: { type: 'joint', componentId: 'left', entityId: 'shared_joint' },
  });
  const mutations = renderMutations({
    setSelection: useSelectionStore.getState().setSelection,
  });

  mutations.handleDelete({
    type: 'joint',
    componentId: 'left',
    entityId: 'shared_joint',
  });
  let state = useWorkspaceStore.getState();
  assert.equal(state.workspace.components.left!.robot.joints.shared_joint, undefined);
  assert.ok(state.workspace.components.right!.robot.joints.shared_joint);
  assert.deepEqual(useSelectionStore.getState().selection, {
    entity: { type: 'component', componentId: 'left' },
  });
  const leftAfterJointDelete = useWorkspaceStore.getState().workspace.components.left!;
  useAssetsStore.getState().setComponentSourceDraft(createComponentSourceDraft({
    componentId: 'left',
    format: 'urdf',
    content: '<robot name="left-current" />',
    robot: leftAfterJointDelete.robot,
  }));

  mutations.handleSetComponentVisibility(
    { type: 'component', componentId: 'right' },
    false,
  );
  state = useWorkspaceStore.getState();
  assert.equal(state.workspace.components.right!.visible, false);
  assert.equal(state.workspace.components.left!.visible, true);

  mutations.handleDelete({ type: 'component', componentId: 'right' });
  assert.equal(useWorkspaceStore.getState().workspace.components.right, undefined);
  assert.ok(useWorkspaceStore.getState().workspace.components.left);
  assert.equal(useAssetsStore.getState().componentSourceDrafts.right, undefined);
  assert.ok(useAssetsStore.getState().componentSourceDrafts.left);
});

test('workspace visual toggle updates every component in one history entry', () => {
  const mutations = renderMutations();

  mutations.handleSetShowVisual(false);

  let state = useWorkspaceStore.getState();
  Object.values(state.workspace.components).forEach((component) => {
    Object.values(component.robot.links).forEach((link) => {
      assert.equal(link.visible, false);
    });
  });
  assert.equal(state.history.past.length, 1);

  assert.equal(state.undo(), true);
  state = useWorkspaceStore.getState();
  Object.values(state.workspace.components).forEach((component) => {
    Object.values(component.robot.links).forEach((link) => {
      assert.notEqual(link.visible, false);
    });
  });
});

test('generic component visibility flushes an active property transaction first', () => {
  const mutations = renderMutations();
  mutations.handleUpdate(
    { type: 'link', componentId: 'left', entityId: 'shared_link' },
    { inertial: createInertial(7) },
  );
  assert.ok(useWorkspaceStore.getState().transaction);

  mutations.handleUpdate(
    { type: 'component', componentId: 'right' },
    { visible: false },
  );
  const state = useWorkspaceStore.getState();
  assert.equal(state.transaction, null);
  assert.equal(state.workspace.components.left?.robot.links.shared_link?.inertial?.mass, 7);
  assert.equal(state.workspace.components.right?.visible, false);
  assert.equal(state.history.past.length, 2);
});
