import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createComponentSourceDraft, createSingleComponentWorkspace } from '@/core/robot';
import type { CollisionOptimizationOperation } from '@/features/property-editor';
import { useAssetsStore } from '@/store/assetsStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { DEFAULT_LINK, GeometryType, type RobotData } from '@/types';
import { registerPendingHistoryFlusher } from '@/app/utils/pendingHistory';
import { useCollisionOptimizationWorkflow } from './useCollisionOptimizationWorkflow';

function robot(name: string): RobotData {
  return {
    name,
    rootLinkId: 'base',
    links: { base: { ...structuredClone(DEFAULT_LINK), id: 'base', name: 'base' } },
    joints: {},
  };
}

function operation(componentId: string): CollisionOptimizationOperation {
  return {
    id: `${componentId}-operation`,
    componentId,
    linkId: 'base',
    objectIndex: 0,
    nextGeometry: {
      ...structuredClone(DEFAULT_LINK.collision),
      type: GeometryType.SPHERE,
    },
    reason: 'cylinder-to-capsule',
    fromTypes: [GeometryType.CYLINDER],
    toType: GeometryType.SPHERE,
    mutations: [{
      componentId,
      linkId: 'base',
      objectIndex: 0,
      type: 'update',
      nextGeometry: {
        ...structuredClone(DEFAULT_LINK.collision),
        type: GeometryType.SPHERE,
      },
    }],
    affectedTargetIds: [`${componentId}:base:0`],
  };
}

function renderWorkflow(): ReturnType<typeof useCollisionOptimizationWorkflow> {
  let workflow: ReturnType<typeof useCollisionOptimizationWorkflow> | null = null;
  function Probe() {
    workflow = useCollisionOptimizationWorkflow({
      assemblyState: useWorkspaceStore.getState().workspace,
      focusOn: () => {},
      pulseSelection: () => {},
      setSelection: () => {},
    });
    return null;
  }
  renderToStaticMarkup(React.createElement(Probe));
  assert.ok(workflow);
  return workflow as unknown as ReturnType<typeof useCollisionOptimizationWorkflow>;
}

test('multi-component collision optimization commits one history entry and invalidates drafts', async () => {
  const workspace = createSingleComponentWorkspace(robot('left'), { componentId: 'left' });
  workspace.components.right = createSingleComponentWorkspace(robot('right'), {
    componentId: 'right',
  }).components.right;
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  useWorkspaceStore.setState({ history: { past: [], future: [], activity: [] } });
  useAssetsStore.setState({
    componentSourceDrafts: Object.fromEntries(
      Object.values(workspace.components).map((component) => [
        component.id,
        createComponentSourceDraft({
          componentId: component.id,
          format: 'urdf',
          content: `<robot name="${component.id}" />`,
          robot: component.robot,
        }),
      ]),
    ),
  });

  const renderedWorkflow = renderWorkflow();
  const operations = ['left', 'right'].map(operation);
  await renderedWorkflow.handleApplyCollisionOptimization(operations);

  const state = useWorkspaceStore.getState();
  assert.equal(state.workspace.components.left?.robot.links.base?.collision.type, GeometryType.SPHERE);
  assert.equal(state.workspace.components.right?.robot.links.base?.collision.type, GeometryType.SPHERE);
  assert.equal(state.history.past.length, 1);
  assert.deepEqual(useAssetsStore.getState().componentSourceDrafts, {});
});

test('collision optimization flushes pending property history before batching replacements', async () => {
  const workspace = createSingleComponentWorkspace(robot('left'), { componentId: 'left' });
  const store = useWorkspaceStore.getState();
  store.replaceWorkspace(workspace, { resetHistory: true });
  useWorkspaceStore.setState({ history: { past: [], future: [], activity: [] } });
  const pendingId = store.beginWorkspaceTransaction('Pending property edit');
  store.renameWorkspace('renamed before optimization', { operationId: pendingId });
  const unregister = registerPendingHistoryFlusher(() => {
    useWorkspaceStore.getState().commitWorkspaceTransaction(pendingId);
  });

  try {
    await renderWorkflow().handleApplyCollisionOptimization([operation('left')]);
  } finally {
    unregister();
  }

  assert.equal(useWorkspaceStore.getState().workspace.name, 'renamed before optimization');
  assert.equal(useWorkspaceStore.getState().history.past.length, 2);
  assert.equal(
    useWorkspaceStore.getState().workspace.components.left?.robot.links.base?.collision.type,
    GeometryType.SPHERE,
  );
});

test('exclusive workspace work rejects collision optimization before workspace or drafts change', async () => {
  const workspace = createSingleComponentWorkspace(robot('left'), { componentId: 'left' });
  const store = useWorkspaceStore.getState();
  store.replaceWorkspace(workspace, { resetHistory: true });
  const draft = createComponentSourceDraft({
    componentId: 'left',
    format: 'urdf',
    content: '<robot name="left" />',
    robot: workspace.components.left.robot,
  });
  useAssetsStore.setState({ componentSourceDrafts: { left: draft } });
  const exclusiveId = store.beginWorkspaceTransaction('USD hydration', { exclusive: true });

  await assert.rejects(
    renderWorkflow().handleApplyCollisionOptimization([operation('left')]),
    /busy with an exclusive operation/i,
  );
  assert.equal(useWorkspaceStore.getState().transaction?.id, exclusiveId);
  assert.notEqual(
    useWorkspaceStore.getState().workspace.components.left?.robot.links.base?.collision.type,
    GeometryType.SPHERE,
  );
  assert.deepEqual(useAssetsStore.getState().componentSourceDrafts, { left: draft });
  useWorkspaceStore.getState().cancelWorkspaceTransaction(exclusiveId);
});
