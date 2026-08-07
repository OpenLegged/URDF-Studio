import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  JointType,
  type AssemblyComponent,
  type AssemblyState,
  type RobotData,
} from '@/types';

import { useWorkspaceStore } from './workspaceStore.ts';

const IDENTITY_TRANSFORM = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { r: 0, p: 0, y: 0 },
};

function createRobot(name: string, includeTendon = false): RobotData {
  return {
    name,
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...structuredClone(DEFAULT_LINK),
        id: 'base_link',
        name: 'base_link',
      },
      tool_link: {
        ...structuredClone(DEFAULT_LINK),
        id: 'tool_link',
        name: 'tool_link',
      },
    },
    joints: {
      wrist: {
        ...structuredClone(DEFAULT_JOINT),
        id: 'wrist',
        name: 'wrist',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'tool_link',
      },
    },
    ...(includeTendon
      ? {
          inspectionContext: {
            sourceFormat: 'mjcf' as const,
            mjcf: {
              siteCount: 0,
              tendonCount: 1,
              tendonActuatorCount: 0,
              bodiesWithSites: [],
              tendons: [
                {
                  name: 'cable',
                  type: 'fixed' as const,
                  width: 0.01,
                  attachmentRefs: ['wrist'],
                  attachments: [{ type: 'joint' as const, ref: 'wrist' }],
                  actuatorNames: [],
                },
              ],
            },
          },
        }
      : {}),
  };
}

function createComponent(
  id: string,
  options: { sourceFile?: string | null; tendon?: boolean } = {},
): AssemblyComponent {
  return {
    id,
    name: `${id} display`,
    sourceFile: options.sourceFile === undefined ? `${id}.urdf` : options.sourceFile,
    robot: createRobot(`${id} source robot`, options.tendon),
    transform: structuredClone(IDENTITY_TRANSFORM),
    visible: true,
  };
}

function createRobotWithDependentReferences(name: string): RobotData {
  const robot = createRobot(name, true);
  robot.links.follower_link = {
    ...structuredClone(DEFAULT_LINK),
    id: 'follower_link',
    name: 'follower_link',
  };
  robot.joints.follower = {
    ...structuredClone(DEFAULT_JOINT),
    id: 'follower',
    name: 'follower',
    type: JointType.FIXED,
    parentLinkId: 'tool_link',
    childLinkId: 'follower_link',
    mimic: { joint: 'wrist' },
  };
  robot.closedLoopConstraints = [
    {
      id: 'loop',
      type: 'connect',
      linkAId: 'base_link',
      linkBId: 'tool_link',
      anchorWorld: { x: 0, y: 0, z: 0 },
      anchorLocalA: { x: 0, y: 0, z: 0 },
      anchorLocalB: { x: 0, y: 0, z: 0 },
    },
  ];
  const inspection = robot.inspectionContext?.mjcf;
  if (inspection) {
    robot.links.tool_link!.mjcfSites = [{
      name: 'tip_site',
      type: 'sphere',
      size: [0.01],
    }];
    inspection.siteCount = 1;
    inspection.bodiesWithSites = [
      { bodyId: 'tool_link', siteCount: 1, siteNames: ['tip_site'] },
    ];
  }
  return robot;
}

function createWorkspace(componentIds: string[] = ['left', 'right']): AssemblyState {
  return {
    name: 'test workspace',
    transform: structuredClone(IDENTITY_TRANSFORM),
    components: Object.fromEntries(
      componentIds.map((componentId) => [componentId, createComponent(componentId)]),
    ),
    bridges: {},
  };
}

function installWorkspace(workspace = createWorkspace()): void {
  const current = useWorkspaceStore.getState();
  if (current.transaction) {
    current.cancelWorkspaceTransaction(current.transaction.id);
  }
  current.flushPendingJointMotion({ skipHistory: true });
  current.replaceWorkspace(workspace, { resetHistory: true, label: 'Test setup' });
  useWorkspaceStore.setState({
    history: { past: [], future: [], activity: [] },
    revision: 0,
    jointMotionRevision: 0,
    pendingAutoGroundComponentIds: [],
  });
}

beforeEach(() => {
  installWorkspace();
});

test('store exposes only canonical workspace domain state and starts non-empty', () => {
  useWorkspaceStore.getState().resetWorkspace('blank');
  const state = useWorkspaceStore.getState();
  const component = state.workspace.components.component_1;

  assert.ok(component);
  assert.equal(state.activeComponentId, 'component_1');
  assert.equal(component.sourceFile, null);
  assert.equal(component.visible, true);
  assert.deepEqual(component.transform, IDENTITY_TRANSFORM);
  assert.deepEqual(state.workspace.bridges, {});
  for (const forbiddenKey of [
    'name',
    'links',
    'joints',
    'components',
    'bridges',
    'assemblyState',
    'workspaceTransform',
  ]) {
    assert.equal(forbiddenKey in state, false, `unexpected top-level ${forbiddenKey}`);
  }
});

test('explicit refs isolate same-local-ID component mutations and component rename', () => {
  const store = useWorkspaceStore.getState();
  const rightBefore = structuredClone(store.workspace.components.right!.robot);
  const leftRobotName = store.workspace.components.left!.robot.name;

  assert.equal(
    store.updateLink(
      { type: 'link', componentId: 'left', entityId: 'tool_link' },
      { name: 'left tool renamed' },
    ),
    true,
  );
  assert.equal(
    useWorkspaceStore.getState().workspace.components.left!.robot.links.tool_link!.name,
    'left tool renamed',
  );
  assert.deepEqual(
    useWorkspaceStore.getState().workspace.components.right!.robot,
    rightBefore,
  );

  assert.equal(store.renameComponent('left', 'Operator label'), true);
  const left = useWorkspaceStore.getState().workspace.components.left!;
  assert.equal(left.name, 'Operator label');
  assert.equal(left.robot.name, leftRobotName);
  assert.equal(useWorkspaceStore.getState().workspace.name, 'test workspace');
});

test('editor locks are canonical undoable workspace mutations', () => {
  const store = useWorkspaceStore.getState();

  assert.equal(store.setComponentEditorLocked('left', true), true);
  assert.equal(
    useWorkspaceStore.getState().workspace.components.left?.editorLocked,
    true,
  );
  assert.equal(store.setComponentEditorLocked('left', false), true);
  assert.equal(
    store.setLinkEditorLocked(
      { type: 'link', componentId: 'left', entityId: 'tool_link' },
      true,
    ),
    true,
  );
  assert.equal(
    useWorkspaceStore.getState().workspace.components.left?.robot.links.tool_link
      ?.editorLocked,
    true,
  );

  assert.equal(
    store.updateLink(
      { type: 'link', componentId: 'left', entityId: 'tool_link' },
      { name: 'blocked rename' },
    ),
    false,
  );
  assert.equal(
    store.setJointMotion(
      { type: 'joint', componentId: 'left', entityId: 'wrist' },
      0.5,
    ),
    false,
  );
  assert.equal(
    store.setLinkVisibility(
      { type: 'link', componentId: 'left', entityId: 'tool_link' },
      false,
    ),
    true,
  );

  assert.equal(useWorkspaceStore.getState().undo(), true);
  assert.equal(
    useWorkspaceStore.getState().workspace.components.left?.robot.links.tool_link
      ?.visible,
    true,
  );
});

test('component editor locks block transforms and authored subtree mutations', () => {
  const store = useWorkspaceStore.getState();
  const component = structuredClone(store.workspace.components.left!);

  assert.equal(store.setComponentEditorLocked('left', true), true);
  assert.equal(store.renameComponent('left', 'blocked'), false);
  assert.equal(store.updateComponentTransform('left', {
    ...component.transform,
    position: { ...component.transform.position, x: 3 },
  }), false);
  assert.equal(store.updateLink(
    { type: 'link', componentId: 'left', entityId: 'tool_link' },
    { name: 'blocked tool' },
  ), false);
  assert.equal(store.removeComponent('left'), false);
  assert.equal(store.setComponentVisibility('left', false), true);
  assert.equal(store.setComponentEditorLocked('left', false), true);
  assert.equal(store.renameComponent('left', 'unlocked'), true);
});

test('deep property patches preserve nested sibling fields at the store boundary', () => {
  const store = useWorkspaceStore.getState();
  const linkBefore = structuredClone(
    store.workspace.components.left!.robot.links.tool_link!,
  );
  const jointBefore = structuredClone(
    store.workspace.components.left!.robot.joints.wrist!,
  );

  assert.equal(store.updateLink(
    { type: 'link', componentId: 'left', entityId: 'tool_link' },
    {
      visual: {
        dimensions: { x: 9 },
        origin: { xyz: { z: 3 } },
      },
      collision: { origin: { rpy: { y: 0.75 } } },
      inertial: { inertia: { ixx: 42 } },
    },
  ), true);
  const link = useWorkspaceStore.getState().workspace.components.left!
    .robot.links.tool_link!;
  assert.equal(link.visual.dimensions.x, 9);
  assert.equal(link.visual.dimensions.y, linkBefore.visual.dimensions.y);
  assert.equal(link.visual.origin.xyz.z, 3);
  assert.equal(link.visual.origin.xyz.x, linkBefore.visual.origin.xyz.x);
  assert.equal(link.collision.origin.rpy.y, 0.75);
  assert.equal(link.collision.origin.rpy.r, linkBefore.collision.origin.rpy.r);
  assert.equal(link.inertial?.inertia.ixx, 42);
  assert.equal(link.inertial?.inertia.iyy, linkBefore.inertial?.inertia.iyy);

  assert.equal(store.updateJoint(
    { type: 'joint', componentId: 'left', entityId: 'wrist' },
    {
      origin: { xyz: { x: 5 } },
      axis: { x: 0.25 },
      limit: { lower: -0.25 },
      dynamics: { damping: 2 },
      hardware: { motorId: 'updated' },
    },
  ), true);
  const joint = useWorkspaceStore.getState().workspace.components.left!
    .robot.joints.wrist!;
  assert.equal(joint.origin.xyz.x, 5);
  assert.equal(joint.origin.xyz.z, jointBefore.origin.xyz.z);
  assert.equal(joint.axis?.x, 0.25);
  assert.equal(joint.axis?.z, jointBefore.axis?.z);
  assert.equal(joint.limit?.lower, -0.25);
  assert.equal(joint.limit?.upper, jointBefore.limit?.upper);
  assert.equal(joint.dynamics.damping, 2);
  assert.equal(joint.dynamics.friction, jointBefore.dynamics.friction);
  assert.equal(joint.hardware.motorId, 'updated');
  assert.equal(joint.hardware.motorType, jointBefore.hardware.motorType);
});

test('discrete no-ops do not write history and undo/redo restore only workspace', () => {
  const store = useWorkspaceStore.getState();
  store.setActiveComponent('right');
  assert.equal(store.renameComponent('left', 'left display'), false);
  assert.equal(useWorkspaceStore.getState().history.past.length, 0);
  assert.equal(useWorkspaceStore.getState().history.activity.length, 0);

  assert.equal(store.renameComponent('left', 'Left renamed'), true);
  assert.equal(useWorkspaceStore.getState().history.past.length, 1);
  assert.equal(store.undo(), true);
  assert.equal(
    useWorkspaceStore.getState().workspace.components.left!.name,
    'left display',
  );
  assert.equal(useWorkspaceStore.getState().activeComponentId, 'right');
  assert.equal(store.redo(), true);
  assert.equal(
    useWorkspaceStore.getState().workspace.components.left!.name,
    'Left renamed',
  );
  assert.equal(useWorkspaceStore.getState().activeComponentId, 'right');
});

test('transaction batches mutations once, cancel restores, and exclusive tokens drop stale writes', () => {
  const store = useWorkspaceStore.getState();
  const noOpId = store.beginWorkspaceTransaction('No-op edit');
  assert.equal(store.commitWorkspaceTransaction('wrong_no_op'), false);
  assert.equal(useWorkspaceStore.getState().transaction?.id, noOpId);
  assert.equal(store.commitWorkspaceTransaction(noOpId), true);
  assert.equal(useWorkspaceStore.getState().history.past.length, 0);
  assert.equal(useWorkspaceStore.getState().history.activity.length, 0);

  const noOpCancelId = store.beginWorkspaceTransaction('No-op cancel');
  assert.equal(store.cancelWorkspaceTransaction(noOpCancelId), true);
  assert.equal(useWorkspaceStore.getState().history.past.length, 0);

  const operationId = store.beginWorkspaceTransaction('Batch edit');
  assert.equal(store.renameWorkspace('untagged edit'), false);
  assert.equal(
    store.renameWorkspace('batched workspace', { operationId }),
    true,
  );
  assert.equal(
    store.renameComponent('left', 'Batched left', { operationId }),
    true,
  );
  assert.equal(useWorkspaceStore.getState().history.past.length, 0);
  assert.equal(store.commitWorkspaceTransaction(operationId), true);
  assert.equal(useWorkspaceStore.getState().history.past.length, 1);
  assert.equal(useWorkspaceStore.getState().history.activity.at(-1)?.label, 'Batch edit');
  assert.equal(store.undo(), true);
  assert.equal(useWorkspaceStore.getState().workspace.name, 'test workspace');
  assert.equal(useWorkspaceStore.getState().workspace.components.left!.name, 'left display');

  const cancelId = store.beginWorkspaceTransaction('Cancelled edit');
  store.renameWorkspace('temporary', { operationId: cancelId });
  assert.equal(store.cancelWorkspaceTransaction(cancelId), true);
  assert.equal(useWorkspaceStore.getState().workspace.name, 'test workspace');

  const exclusiveId = store.beginWorkspaceTransaction('USD hydration', {
    operationId: 'usd_operation_1',
    componentId: 'left',
    exclusive: true,
  });
  assert.equal(exclusiveId, 'usd_operation_1');
  assert.equal(
    (store.commitWorkspaceTransaction as (operationId?: string) => boolean)(),
    false,
  );
  assert.equal(
    (store.cancelWorkspaceTransaction as (operationId?: string) => boolean)(),
    false,
  );
  assert.equal(store.cancelWorkspaceTransaction('stale_operation'), false);
  assert.equal(useWorkspaceStore.getState().transaction?.id, exclusiveId);
  const beforeRejectedHistoryAction = structuredClone(
    useWorkspaceStore.getState().workspace,
  );
  assert.equal(store.canUndo(), false);
  assert.equal(store.canRedo(), false);
  assert.equal(store.undo(), false);
  assert.equal(store.redo(), false);
  assert.deepEqual(useWorkspaceStore.getState().workspace, beforeRejectedHistoryAction);
  assert.equal(useWorkspaceStore.getState().transaction?.id, exclusiveId);
  assert.equal(store.renameComponent('left', 'blocked'), false);
  assert.equal(
    store.updateLink(
      { type: 'link', componentId: 'left', entityId: 'tool_link' },
      { name: 'hydrated tool' },
      { operationId: exclusiveId },
    ),
    true,
  );
  assert.equal(store.commitWorkspaceTransaction('stale_operation'), false);
  assert.equal(store.commitWorkspaceTransaction(exclusiveId), true);
  assert.equal(
    store.updateLink(
      { type: 'link', componentId: 'left', entityId: 'tool_link' },
      { name: 'late tool' },
      { operationId: exclusiveId },
    ),
    false,
  );
  assert.equal(
    useWorkspaceStore.getState().workspace.components.left!.robot.links.tool_link!.name,
    'hydrated tool',
  );
});

test('skip-history transactions update canonical workspace without creating an undo mismatch', () => {
  const store = useWorkspaceStore.getState();
  store.renameWorkspace('redo target');
  assert.equal(store.undo(), true);
  assert.equal(useWorkspaceStore.getState().history.future.length, 1);

  const operationId = store.beginWorkspaceTransaction('External asset path rename', {
    skipHistory: true,
  });
  assert.equal(
    store.updateComponentSourceFile('left', 'renamed/left.urdf', { operationId }),
    true,
  );
  assert.equal(store.commitWorkspaceTransaction(operationId), true);

  const state = useWorkspaceStore.getState();
  assert.equal(state.workspace.components.left?.sourceFile, 'renamed/left.urdf');
  assert.equal(state.history.past.length, 0);
  assert.equal(state.history.future.length, 0);
  assert.equal(store.canUndo(), false);
});

test('dirty pending transactions are immediately undoable and suppress stale redo', () => {
  const store = useWorkspaceStore.getState();
  store.renameWorkspace('first edit');
  assert.equal(store.undo(), true);
  assert.equal(store.canRedo(), true);

  const operationId = store.beginWorkspaceTransaction('Pending property edit');
  assert.equal(
    store.renameWorkspace('pending edit', { operationId }),
    true,
  );
  assert.equal(store.canUndo(), true);
  assert.equal(store.canRedo(), false);

  assert.equal(store.undo(), true);
  assert.equal(useWorkspaceStore.getState().workspace.name, 'test workspace');
  assert.equal(useWorkspaceStore.getState().transaction, null);
  assert.equal(useWorkspaceStore.getState().history.future.length, 1);
});

test('a transaction returned to its before snapshot does not mask existing redo', () => {
  const store = useWorkspaceStore.getState();
  store.renameWorkspace('first edit');
  assert.equal(store.undo(), true);

  const operationId = store.beginWorkspaceTransaction('No net property edit');
  store.renameWorkspace('temporary', { operationId });
  store.renameWorkspace('test workspace', { operationId });

  assert.equal(store.canRedo(), true);
  assert.equal(store.redo(), true);
  assert.equal(useWorkspaceStore.getState().workspace.name, 'first edit');
});

test('restoreWorkspace atomically restores canonical workspace history and rejects corruption', () => {
  const store = useWorkspaceStore.getState();
  const archived = createWorkspace(['archived']);
  archived.name = 'archived workspace';
  const archivedPast = createWorkspace(['past']);
  const archivedFuture = createWorkspace(['future']);
  const history = {
    past: [archivedPast],
    future: [archivedFuture],
    activity: [
      {
        id: 'activity_1',
        timestamp: '2026-07-09T12:00:00.000Z',
        label: 'Archived edit',
      },
    ],
  };

  assert.equal(store.restoreWorkspace(archived, history), true);
  assert.equal(useWorkspaceStore.getState().workspace.name, 'archived workspace');
  assert.deepEqual(useWorkspaceStore.getState().history, history);
  assert.equal(useWorkspaceStore.getState().activeComponentId, 'archived');

  const before = structuredClone(useWorkspaceStore.getState().workspace);
  const beforeHistory = structuredClone(useWorkspaceStore.getState().history);
  const corruptFuture = structuredClone(archivedFuture);
  corruptFuture.components = {};
  assert.throws(
    () =>
      store.restoreWorkspace(archived, {
        ...history,
        future: [corruptFuture],
      }),
    /Invalid canonical workspace/,
  );
  assert.deepEqual(useWorkspaceStore.getState().workspace, before);
  assert.deepEqual(useWorkspaceStore.getState().history, beforeHistory);
});

test('removing the last component atomically creates a valid default component', () => {
  const workspace = createWorkspace(['only']);
  workspace.name = 'placed workspace';
  workspace.transform = {
    position: { x: 4, y: -2, z: 8 },
    rotation: { r: 0.1, p: 0.2, y: 0.3 },
  };
  installWorkspace(workspace);
  const store = useWorkspaceStore.getState();
  store.setActiveComponent('only');

  assert.equal(store.removeComponent('only'), true);
  const state = useWorkspaceStore.getState();
  assert.deepEqual(Object.keys(state.workspace.components), ['component_1']);
  assert.equal(state.workspace.components.component_1!.sourceFile, null);
  assert.equal(state.workspace.name, 'placed workspace');
  assert.deepEqual(state.workspace.transform, workspace.transform);
  assert.deepEqual(state.workspace.bridges, {});
  assert.equal(state.activeComponentId, 'component_1');
  assert.equal(state.history.past.length, 1);
  assert.equal(store.undo(), true);
  assert.ok(useWorkspaceStore.getState().workspace.components.only);
  assert.equal(useWorkspaceStore.getState().activeComponentId, 'only');
});

test('append accepts parsed RobotData, preserves local IDs, and supports same-source instances', () => {
  installWorkspace(createWorkspace(['arm']));
  const store = useWorkspaceStore.getState();
  const seed = {
    id: 'arm',
    name: 'Arm',
    sourceFile: 'shared/arm.urdf',
    robot: createRobot('authored_arm'),
  };
  const second = store.appendComponent(seed);
  const third = store.appendComponent(seed);
  const state = useWorkspaceStore.getState();

  assert.notEqual(second.id, third.id);
  assert.equal(second.sourceFile, third.sourceFile);
  assert.deepEqual(Object.keys(second.robot.links), ['base_link', 'tool_link']);
  assert.deepEqual(Object.keys(third.robot.links), ['base_link', 'tool_link']);
  assert.notDeepEqual(second.transform, third.transform);
  assert.deepEqual(state.pendingAutoGroundComponentIds, [second.id, third.id]);
  state.consumePendingAutoGroundComponentIds([second.id]);
  assert.deepEqual(useWorkspaceStore.getState().pendingAutoGroundComponentIds, [third.id]);
});

test('link/joint/tree/tendon actions target one component and maintain material state', () => {
  const withTendon = createWorkspace();
  withTendon.components.left = createComponent('left', { tendon: true });
  installWorkspace(withTendon);
  const store = useWorkspaceStore.getState();
  const leftTool = store.workspace.components.left!.robot.links.tool_link!;

  assert.equal(
    store.updateLink(
      { type: 'link', componentId: 'left', entityId: 'tool_link' },
      { visual: { ...leftTool.visual, color: '#123456' } },
    ),
    true,
  );
  assert.equal(
    useWorkspaceStore.getState().workspace.components.left!.robot.materials?.tool_link
      ?.color,
    '#123456',
  );
  assert.equal(
    store.updateJoint(
      { type: 'joint', componentId: 'left', entityId: 'wrist' },
      { dynamics: { damping: 2, friction: 3 } },
    ),
    true,
  );
  assert.equal(
    useWorkspaceStore.getState().workspace.components.right!.robot.joints.wrist!.dynamics
      .damping,
    DEFAULT_JOINT.dynamics.damping,
  );
  assert.equal(
    store.updateTendon(
      { type: 'tendon', componentId: 'left', entityId: 'cable' },
      { width: 0.2, rgba: [1, 0, 0, 1] },
    ),
    true,
  );
  assert.equal(
    useWorkspaceStore.getState().workspace.components.left!.robot.inspectionContext?.mjcf
      ?.tendons[0]?.width,
    0.2,
  );

  const child = store.addChild({ componentId: 'left', parentLinkId: 'tool_link' });
  assert.ok(child);
  assert.ok(
    useWorkspaceStore.getState().workspace.components.left!.robot.links[child.linkId],
  );
  assert.equal(
    Object.keys(useWorkspaceStore.getState().workspace.components.right!.robot.links)
      .length,
    2,
  );
  assert.equal(
    store.deleteSubtree({
      type: 'link',
      componentId: 'left',
      entityId: child.linkId,
    }),
    true,
  );
});

test('deleteLink and replaceComponentRobot cascade invalid bridges in one history entry', () => {
  const store = useWorkspaceStore.getState();
  store.addBridge({
    id: 'mount',
    name: 'mount',
    parentComponentId: 'left',
    parentLinkId: 'tool_link',
    childComponentId: 'right',
    childLinkId: 'base_link',
    joint: { type: JointType.FIXED },
  });
  store.clearHistory();

  assert.equal(
    store.deleteLink({ type: 'link', componentId: 'left', entityId: 'tool_link' }),
    true,
  );
  assert.equal(useWorkspaceStore.getState().workspace.bridges.mount, undefined);
  assert.equal(useWorkspaceStore.getState().history.past.length, 1);
  assert.equal(store.undo(), true);
  assert.ok(useWorkspaceStore.getState().workspace.bridges.mount);

  const replacement = createRobot('replacement');
  delete replacement.links.tool_link;
  delete replacement.joints.wrist;
  replacement.rootLinkId = 'base_link';
  assert.equal(store.replaceComponentRobot('left', replacement), true);
  assert.equal(useWorkspaceStore.getState().workspace.bridges.mount, undefined);
});

test('deleteJoint repairs mimic and tendon references in the same transaction', () => {
  const workspace = createWorkspace(['left']);
  workspace.components.left!.robot = createRobotWithDependentReferences('dependent');
  installWorkspace(workspace);
  const store = useWorkspaceStore.getState();

  assert.equal(
    store.deleteJoint({ type: 'joint', componentId: 'left', entityId: 'wrist' }),
    true,
  );
  const robot = useWorkspaceStore.getState().workspace.components.left!.robot;
  assert.equal(robot.joints.follower!.mimic, undefined);
  assert.deepEqual(robot.inspectionContext?.mjcf?.tendons, []);
  assert.equal(robot.inspectionContext?.mjcf?.tendonCount, 0);
  assert.equal(useWorkspaceStore.getState().history.past.length, 1);
});

test('deleting an MJCF link removes owned tendon references and refreshes counts', () => {
  const store = useWorkspaceStore.getState();
  const component = structuredClone(store.workspace.components.left!);
  component.id = 'mjcf';
  component.name = 'mjcf';
  component.robot.links.tool_link!.mjcfSites = [{
    name: 'tool_site',
    sourceName: 'authored_tool_site',
    type: 'sphere',
    size: [0.01],
  }];
  component.robot.links.tool_link!.collision.name = 'tool_geom';
  component.robot.inspectionContext = {
    sourceFormat: 'mjcf',
    mjcf: {
      siteCount: 1,
      tendonCount: 2,
      tendonActuatorCount: 2,
      bodiesWithSites: [{
        bodyId: 'tool_link',
        siteCount: 1,
        siteNames: ['tool_site'],
      }],
      tendons: [
        {
          name: 'tool_tendon',
          type: 'spatial',
          attachmentRefs: ['authored_tool_site', 'tool_geom'],
          attachments: [
            { type: 'site', ref: 'authored_tool_site' },
            { type: 'geom', ref: 'tool_geom' },
          ],
          actuatorNames: ['tool_motor'],
        },
        {
          name: 'wrist_tendon',
          type: 'fixed',
          attachmentRefs: ['wrist'],
          attachments: [{ type: 'joint', ref: 'wrist', coef: 1 }],
          actuatorNames: ['wrist_motor'],
        },
      ],
    },
  };
  store.insertComponent(component, { queueAutoGround: false });

  assert.equal(
    store.deleteLink({ type: 'link', componentId: component.id, entityId: 'tool_link' }),
    true,
  );
  const inspection = useWorkspaceStore.getState().workspace.components[
    component.id
  ]!.robot.inspectionContext!.mjcf!;
  assert.equal(inspection.siteCount, 0);
  assert.equal(inspection.tendonCount, 0);
  assert.equal(inspection.tendonActuatorCount, 0);
  assert.deepEqual(inspection.tendons, []);
});

test('deleteSubtree repairs closed loops, inspection bodies, and deleted joint refs', () => {
  const workspace = createWorkspace(['left']);
  workspace.components.left!.robot = createRobotWithDependentReferences('dependent');
  installWorkspace(workspace);
  const store = useWorkspaceStore.getState();

  assert.equal(
    store.deleteSubtree({
      type: 'link',
      componentId: 'left',
      entityId: 'tool_link',
    }),
    true,
  );
  const robot = useWorkspaceStore.getState().workspace.components.left!.robot;
  assert.equal(robot.links.tool_link, undefined);
  assert.deepEqual(robot.joints, {});
  assert.equal(robot.closedLoopConstraints, undefined);
  assert.deepEqual(robot.inspectionContext?.mjcf?.bodiesWithSites, []);
  assert.equal(robot.inspectionContext?.mjcf?.siteCount, 0);
  assert.deepEqual(robot.inspectionContext?.mjcf?.tendons, []);
  assert.equal(robot.inspectionContext?.mjcf?.tendonCount, 0);
});

test('bridge actions require exact local endpoints, align the child, and project read-only', () => {
  const store = useWorkspaceStore.getState();
  assert.throws(
    () =>
      store.addBridge({
        id: 'invalid',
        name: 'invalid',
        parentComponentId: 'left',
        parentLinkId: 'left_tool_link',
        childComponentId: 'right',
        childLinkId: 'right_base_link',
        joint: { type: JointType.FIXED },
      }),
    /source-local link/,
  );
  assert.equal(useWorkspaceStore.getState().history.past.length, 0);

  const beforeTransform = structuredClone(
    useWorkspaceStore.getState().workspace.components.right!.transform,
  );
  const bridge = store.addBridge({
    id: 'mount',
    name: 'mount',
    parentComponentId: 'left',
    parentLinkId: 'tool_link',
    childComponentId: 'right',
    childLinkId: 'base_link',
    joint: { type: JointType.FIXED },
  });
  assert.equal(bridge.id, 'mount');
  assert.notDeepEqual(
    useWorkspaceStore.getState().workspace.components.right!.transform,
    beforeTransform,
  );
  const projection = store.getSceneProjection();
  assert.equal(projection.renderStrategy, 'assembled-scene');
  assert.deepEqual(projection.globalToEntityRef.get('mount'), {
    type: 'bridge',
    bridgeId: 'mount',
  });
  assert.equal('robotData' in useWorkspaceStore.getState(), false);
});

test('bridge mutations reject duplicate incoming targets and retarget conflicts atomically', () => {
  installWorkspace(createWorkspace(['a', 'b', 'c']));
  const store = useWorkspaceStore.getState();
  store.addBridge({
    id: 'a_to_b',
    name: 'a to b',
    parentComponentId: 'a',
    parentLinkId: 'tool_link',
    childComponentId: 'b',
    childLinkId: 'base_link',
    joint: { type: JointType.FIXED },
  });
  store.addBridge({
    id: 'a_to_c',
    name: 'a to c',
    parentComponentId: 'a',
    parentLinkId: 'base_link',
    childComponentId: 'c',
    childLinkId: 'base_link',
    joint: { type: JointType.FIXED },
  });
  store.clearHistory();
  const before = structuredClone(useWorkspaceStore.getState().workspace);

  assert.throws(
    () =>
      store.addBridge({
        id: 'c_to_b',
        name: 'c to b',
        parentComponentId: 'c',
        parentLinkId: 'tool_link',
        childComponentId: 'b',
        childLinkId: 'tool_link',
        joint: { type: JointType.FIXED },
      }),
    /already has incoming bridge/,
  );
  assert.throws(
    () =>
      store.updateBridge('a_to_c', {
        childComponentId: 'b',
        childLinkId: 'tool_link',
      }),
    /already has incoming bridge/,
  );
  assert.deepEqual(useWorkspaceStore.getState().workspace, before);
  assert.equal(useWorkspaceStore.getState().history.past.length, 0);
});

test('partial bridge origin patches preserve untouched fields and trigger re-alignment', () => {
  installWorkspace(createWorkspace(['a', 'b']));
  const store = useWorkspaceStore.getState();
  store.addBridge({
    id: 'a_to_b_partial_origin',
    name: 'a to b partial origin',
    parentComponentId: 'a',
    parentLinkId: 'tool_link',
    childComponentId: 'b',
    childLinkId: 'base_link',
    joint: {
      type: JointType.FIXED,
      origin: {
        xyz: { x: 0.1, y: 0.2, z: 0.3 },
        rpy: { r: 0.4, p: 0.5, y: 0.6 },
      },
    },
  });
  const transformBefore = structuredClone(
    useWorkspaceStore.getState().workspace.components.b!.transform,
  );

  assert.equal(
    store.updateBridge('a_to_b_partial_origin', {
      joint: { origin: { xyz: { x: 1.25 } } },
    }),
    true,
  );

  const state = useWorkspaceStore.getState();
  const bridgeOrigin = state.workspace.bridges.a_to_b_partial_origin!.joint.origin;
  assert.deepEqual(bridgeOrigin, {
    xyz: { x: 1.25, y: 0.2, z: 0.3 },
    rpy: { r: 0.4, p: 0.5, y: 0.6 },
  });
  assert.notDeepEqual(state.workspace.components.b!.transform, transformBefore);
});

test('bridge topology rejects non-fixed cycles and fixed-cycle type changes atomically', () => {
  installWorkspace(createWorkspace(['a', 'b']));
  const store = useWorkspaceStore.getState();
  store.addBridge({
    id: 'a_to_b',
    name: 'a to b',
    parentComponentId: 'a',
    parentLinkId: 'tool_link',
    childComponentId: 'b',
    childLinkId: 'base_link',
    joint: { type: JointType.FIXED },
  });
  store.clearHistory();
  assert.throws(
    () =>
      store.addBridge({
        id: 'b_to_a_revolute',
        name: 'b to a',
        parentComponentId: 'b',
        parentLinkId: 'tool_link',
        childComponentId: 'a',
        childLinkId: 'base_link',
        joint: { type: JointType.REVOLUTE },
      }),
    /unsupported non-fixed component cycle/,
  );
  assert.equal(useWorkspaceStore.getState().history.past.length, 0);

  store.addBridge({
    id: 'b_to_a_fixed',
    name: 'b to a fixed',
    parentComponentId: 'b',
    parentLinkId: 'tool_link',
    childComponentId: 'a',
    childLinkId: 'base_link',
    joint: { type: JointType.FIXED },
  });
  store.clearHistory();
  const before = structuredClone(useWorkspaceStore.getState().workspace);
  assert.throws(
    () => store.updateBridge('b_to_a_fixed', { joint: { type: JointType.PRISMATIC } }),
    /unsupported non-fixed component cycle/,
  );
  assert.deepEqual(useWorkspaceStore.getState().workspace, before);
  assert.equal(useWorkspaceStore.getState().history.past.length, 0);
});

test('assembly and component transform history round-trips through undo and redo', () => {
  const store = useWorkspaceStore.getState();
  const assemblyTransform = {
    position: { x: 1, y: 2, z: 3 },
    rotation: { r: 0.1, p: 0.2, y: 0.3 },
  };
  const componentTransform = {
    position: { x: -2, y: 0, z: 1 },
    rotation: { r: 0, p: 0.4, y: 0 },
  };

  assert.equal(store.updateAssemblyTransform(assemblyTransform), true);
  assert.equal(store.updateComponentTransform('left', componentTransform), true);
  assert.equal(useWorkspaceStore.getState().history.past.length, 2);
  assert.equal(store.undo(), true);
  assert.deepEqual(
    useWorkspaceStore.getState().workspace.components.left!.transform,
    IDENTITY_TRANSFORM,
  );
  assert.equal(store.undo(), true);
  assert.deepEqual(useWorkspaceStore.getState().workspace.transform, IDENTITY_TRANSFORM);
  assert.equal(store.redo(), true);
  assert.deepEqual(useWorkspaceStore.getState().workspace.transform, assemblyTransform);
  assert.equal(store.redo(), true);
  assert.deepEqual(
    useWorkspaceStore.getState().workspace.components.left!.transform,
    componentTransform,
  );
});

test('replaceComponentRobot preserves USD inspection and applies material colors', () => {
  const store = useWorkspaceStore.getState();
  useWorkspaceStore.setState((state) => ({
    workspace: {
      ...state.workspace,
      components: {
        ...state.workspace.components,
        left: {
          ...state.workspace.components.left!,
          renderableBounds: {
            min: { x: -1, y: -1, z: -1 },
            max: { x: 1, y: 1, z: 1 },
          },
        },
      },
    },
  }));
  const componentName = store.workspace.components.left!.name;
  const sourceFile = store.workspace.components.left!.sourceFile;
  const replacement = createRobot('usd_source');
  replacement.inspectionContext = { sourceFormat: 'usd' };
  replacement.materials = { tool_link: { color: '#abcdef' } };

  assert.equal(store.replaceComponentRobot('left', replacement), true);
  const component = useWorkspaceStore.getState().workspace.components.left!;
  assert.equal(component.renderableBounds, undefined);
  assert.equal(component.name, componentName);
  assert.equal(component.sourceFile, sourceFile);
  assert.equal(component.robot.name, 'usd_source');
  assert.equal(component.robot.inspectionContext?.sourceFormat, 'usd');
  assert.equal(component.robot.links.tool_link!.visual.color, '#abcdef');
  assert.equal(component.robot.materials?.tool_link?.color, '#abcdef');
  assert.equal(useWorkspaceStore.getState().history.past.length, 1);
  assert.equal(store.undo(), true);
  assert.equal(
    useWorkspaceStore.getState().workspace.components.left!.robot.name,
    'left source robot',
  );
});

test('append, insert, and replace share component robot material normalization', () => {
  const store = useWorkspaceStore.getState();
  const createUnnormalizedRobot = (name: string) => {
    const next = createRobot(name);
    next.links.tool_link!.visual.color = '#ffffff';
    next.materials = { tool_link: { color: '#13579b' } };
    return next;
  };

  const appended = store.appendComponent({
    id: 'appended',
    name: 'Appended',
    sourceFile: 'shared.urdf',
    robot: createUnnormalizedRobot('appended'),
    queueAutoGround: false,
  });
  const inserted = createComponent('inserted');
  inserted.robot = createUnnormalizedRobot('inserted');
  assert.equal(store.insertComponent(inserted, { queueAutoGround: false }), true);
  assert.equal(store.replaceComponentRobot('right', createUnnormalizedRobot('replaced')), true);

  const components = useWorkspaceStore.getState().workspace.components;
  assert.equal(components[appended.id]?.robot.links.tool_link?.visual.color, '#13579b');
  assert.equal(components.inserted?.robot.links.tool_link?.visual.color, '#13579b');
  assert.equal(components.right?.robot.links.tool_link?.visual.color, '#13579b');
});

test('high-frequency joint motion writes one history entry only on flush', () => {
  const store = useWorkspaceStore.getState();
  const ref = { type: 'joint' as const, componentId: 'left', entityId: 'wrist' };

  assert.equal(store.setJointMotion(ref, 0.25), true);
  assert.equal(store.setJointMotion(ref, 0.5), true);
  assert.equal(useWorkspaceStore.getState().history.past.length, 0);
  assert.equal(
    useWorkspaceStore.getState().workspace.components.left!.robot.joints.wrist!.angle,
    0.5,
  );
  assert.equal(useWorkspaceStore.getState().jointMotionRevision, 2);
  assert.equal(store.flushPendingJointMotion(), true);
  assert.equal(store.flushPendingJointMotion(), false);
  assert.equal(useWorkspaceStore.getState().history.past.length, 1);
  assert.equal(useWorkspaceStore.getState().history.activity.length, 1);
  assert.equal(store.undo(), true);
  assert.equal(
    useWorkspaceStore.getState().workspace.components.left!.robot.joints.wrist!.angle,
    undefined,
  );
});

test('joint motion inside a workspace transaction commits with the other edits once', () => {
  const store = useWorkspaceStore.getState();
  const operationId = store.beginWorkspaceTransaction('Pose and rename');
  store.setJointMotion(
    { type: 'joint', componentId: 'left', entityId: 'wrist' },
    0.4,
    { operationId },
  );
  assert.equal(store.flushPendingJointMotion({ operationId }), true);
  store.renameComponent('left', 'Posed arm', { operationId });
  assert.equal(useWorkspaceStore.getState().history.past.length, 0);
  assert.equal(store.commitWorkspaceTransaction(operationId), true);
  assert.equal(useWorkspaceStore.getState().history.past.length, 1);
  assert.equal(useWorkspaceStore.getState().history.activity[0]?.label, 'Pose and rename');
});

test('invalid identity/reference patches fail atomically without history', () => {
  const store = useWorkspaceStore.getState();
  assert.throws(
    () =>
      store.updateLink(
        { type: 'link', componentId: 'left', entityId: 'tool_link' },
        { id: 'different' },
      ),
    /IDs are stable/,
  );
  assert.throws(
    () =>
      store.updateJoint(
        { type: 'joint', componentId: 'left', entityId: 'wrist' },
        { childLinkId: 'missing_link' },
      ),
    /Invalid canonical workspace/,
  );
  assert.equal(useWorkspaceStore.getState().history.past.length, 0);
  assert.equal(
    useWorkspaceStore.getState().workspace.components.left!.robot.joints.wrist!
      .childLinkId,
    'tool_link',
  );
});
