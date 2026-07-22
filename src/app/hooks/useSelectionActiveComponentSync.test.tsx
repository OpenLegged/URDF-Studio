import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { createDefaultWorkspace } from '@/core/robot';
import { useSelectionStore } from '@/store/selectionStore';
import { useWorkspaceStore } from '@/store/workspaceStore';

import { useSelectionActiveComponentSync } from './useSelectionActiveComponentSync.ts';

test('app composition synchronizes selection ownership to the active component', async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: dom.window.navigator,
  });

  const workspace = createDefaultWorkspace('selection sync');
  const firstComponent = workspace.components.component_1!;
  workspace.components.component_2 = {
    ...firstComponent,
    id: 'component_2',
    name: 'component 2',
  };
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  useWorkspaceStore.getState().setActiveComponent('component_1');
  useSelectionStore.getState().clearSelection();

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let mounted = true;
  function Probe() {
    useSelectionActiveComponentSync();
    return null;
  }

  try {
    flushSync(() => root.render(React.createElement(Probe)));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    useSelectionStore.getState().selectLink({
      type: 'link',
      componentId: 'component_2',
      entityId: firstComponent.robot.rootLinkId,
    });
    assert.equal(useWorkspaceStore.getState().activeComponentId, 'component_2');

    flushSync(() => root.unmount());
    mounted = false;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    useWorkspaceStore.getState().setActiveComponent('component_2');
    useSelectionStore.getState().selectComponent('component_1');
    assert.equal(useWorkspaceStore.getState().activeComponentId, 'component_2');
  } finally {
    if (mounted) {
      flushSync(() => root.unmount());
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    dom.window.close();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    });
  }
});
