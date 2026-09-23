import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createDefaultWorkspace } from '@/core/robot';
import { useWorkspaceStore } from '@/store/workspaceStore';
import type { RobotFile } from '@/types';
import { translations, type Language } from '@/shared/i18n';

import { useWorkspaceOverlayActions } from './useWorkspaceOverlayActions.ts';

function renderHook(
  onLoadRobot: Parameters<typeof useWorkspaceOverlayActions>[0]['onLoadRobot'],
  events: string[],
  language: Language = 'zh',
) {
  let hook: ReturnType<typeof useWorkspaceOverlayActions> | null = null;
  function Probe() {
    hook = useWorkspaceOverlayActions({
      addComponentFailed: translations[language].addComponentFailed,
      onLoadRobot,
      showAssemblyComponentPreparationOverlay: () => events.push('overlay:show'),
      clearAssemblyComponentPreparationOverlay: () => events.push('overlay:clear'),
      showToast: (message, type) => events.push(`toast:${type}:${message}`),
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

for (const language of ['zh', 'en'] as const) {
  test(`failed Add localizes feedback in ${language} and preserves the original diagnostic`, async (context) => {
    const events: string[] = [];
    const error = new Error('duplicate parent joint for child_link');
    const log = context.mock.method(console, 'error', () => {});
    const hook = renderHook(async () => {
      throw error;
    }, events, language);
    const file: RobotFile = { name: 'broken.urdf', format: 'urdf', content: '<broken>' };

    hook.handleAddComponent(file);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(events, [
      'overlay:show',
      'overlay:clear',
      `toast:error:${translations[language].addComponentFailed.replace('{name}', file.name)}`,
    ]);
    assert.equal(log.mock.calls[0].arguments[1], error);
  });
}

test('successful recovered Add clears preparation without a toast', async () => {
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

  assert.deepEqual(events, ['overlay:show', 'overlay:clear']);
});


test('synchronous component failures use the same localized feedback and cleanup', async (context) => {
  const error = new Error('synchronous load failure');
  const log = context.mock.method(console, 'error', () => {});
  const events: string[] = [];
  const hook = renderHook(() => { throw error; }, events);
  hook.handleAddComponent({ name: 'broken.urdf', format: 'urdf', content: '<broken>' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(events, [
    'overlay:show', 'overlay:clear',
    `toast:error:${translations.zh.addComponentFailed.replace('{name}', 'broken.urdf')}`,
  ]);
  assert.equal(log.mock.calls[0].arguments[1], error);
});
