import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createDefaultWorkspace } from '@/core/robot';
import { useWorkspaceStore } from '@/store/workspaceStore';
import type { RobotFile } from '@/types';

import { useWorkspaceOverlayActions } from './useWorkspaceOverlayActions.ts';

function renderHook(
  onLoadRobot: Parameters<typeof useWorkspaceOverlayActions>[0]['onLoadRobot'],
  events: string[],
) {
  let hook: ReturnType<typeof useWorkspaceOverlayActions> | null = null;
  function Probe() {
    hook = useWorkspaceOverlayActions({
      onLoadRobot,
      showAssemblyComponentPreparationOverlay: () => events.push('overlay:show'),
      clearAssemblyComponentPreparationOverlay: () => events.push('overlay:clear'),
      showToast: (message, type) => events.push(`toast:${type}:${message}`),
      t: {
        addedComponent: 'Added {name}',
        addedComponentRecovered: 'Added {name} with {count} recovery item(s)',
        loadingRobot: 'loading',
        preparingAssemblyComponent: 'preparing',
        addingAssemblyComponentToWorkspace: 'adding',
        groundingAssemblyComponent: 'grounding',
      },
      setBridgePreview: () => {},
      setShouldRenderBridgeModal: () => {},
      setIsBridgeModalOpen: () => {},
      addBridge: () => null,
      setIsCollisionOptimizerOpen: () => {},
    });
    return null;
  }
  renderToStaticMarkup(React.createElement(Probe));
  assert.ok(hook);
  return hook as unknown as ReturnType<typeof useWorkspaceOverlayActions>;
}

test('failed Add clears preparation without success toast or workspace mutation', async () => {
  const workspace = createDefaultWorkspace('before');
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  const before = structuredClone(useWorkspaceStore.getState().workspace);
  const events: string[] = [];
  const hook = renderHook(async () => null, events);
  const file: RobotFile = { name: 'broken.urdf', format: 'urdf', content: '<broken>' };

  hook.handleAddComponent(file);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(events, ['overlay:show', 'overlay:clear']);
  assert.deepEqual(useWorkspaceStore.getState().workspace, before);
});

test('failed Add preserves the underlying error detail', async () => {
  const events: string[] = [];
  const hook = renderHook(async () => {
    throw new Error('duplicate parent joint for child_link');
  }, events);
  const file: RobotFile = { name: 'broken.urdf', format: 'urdf', content: '<broken>' };

  hook.handleAddComponent(file);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(events, [
    'overlay:show',
    'overlay:clear',
    'toast:info:Failed to add assembly component: broken.urdf. duplicate parent joint for child_link',
  ]);
});

test('successful recovered Add reports the ignored source item count', async () => {
  const workspace = createDefaultWorkspace('recovered');
  const component = structuredClone(Object.values(workspace.components)[0]!);
  component.robot.inspectionContext = {
    sourceFormat: 'urdf',
    recovery: {
      diagnostics: [
        {
          code: 'nonfinite_joint_limit_omitted',
          severity: 'warning',
          category: 'joint',
          message: 'Omitted one non-finite bound.',
          action: 'omitted',
        },
      ],
      diagnosticCounts: { error: 0, warning: 1, info: 0 },
      recoveredItemCount: 1,
    },
  };
  const events: string[] = [];
  const hook = renderHook(async () => ({ status: 'committed', component }), events);
  const file: RobotFile = { name: 'recovered.urdf', format: 'urdf', content: '<robot />' };

  hook.handleAddComponent(file);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(events, [
    'overlay:show',
    'overlay:clear',
    `toast:success:Added ${component.name} with 1 recovery item(s)`,
  ]);
});
