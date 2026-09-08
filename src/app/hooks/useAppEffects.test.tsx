import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import {
  createComponentSourceDraft,
  createDefaultWorkspace,
} from '@/core/robot';
import { useAssetsStore } from '@/store/assetsStore';
import { useSelectionStore } from '@/store/selectionStore';
import { useWorkspaceStore } from '@/store/workspaceStore';

import {
  useComponentSourceDraftCleanup,
  useSelectionCleanup,
} from './useAppEffects.ts';

test('selection cleanup repairs committed selection and clears every invalid transient target', async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });

  const workspace = createDefaultWorkspace('selection repair');
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  useSelectionStore.setState({
    selection: {
      entity: { type: 'link', componentId: 'component_1', entityId: 'missing_link' },
    },
    hoveredSelection: { entity: { type: 'bridge', bridgeId: 'missing_bridge' } },
    deferredHoveredSelection: {
      entity: { type: 'joint', componentId: 'component_1', entityId: 'missing_joint' },
    },
    attentionSelection: {
      entity: { type: 'component', componentId: 'missing_component' },
    },
    focusTarget: { type: 'component', componentId: 'missing_component' },
  });

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  function Probe() {
    useSelectionCleanup();
    return null;
  }

  try {
    flushSync(() => root.render(React.createElement(Probe)));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const selection = useSelectionStore.getState();
    assert.deepEqual(selection.selection, {
      entity: { type: 'component', componentId: 'component_1' },
    });
    assert.equal(selection.hoveredSelection, null);
    assert.equal(selection.deferredHoveredSelection, null);
    assert.equal(selection.attentionSelection, null);
    assert.equal(selection.focusTarget, null);
  } finally {
    flushSync(() => root.unmount());
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    dom.window.close();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    });
  }
});

test('source draft synchronization updates owned stale drafts and removes foreign drafts', async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });

  const workspace = createDefaultWorkspace('draft cleanup');
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  const component = workspace.components.component_1!;
  useAssetsStore.getState().replaceComponentSourceDrafts({
    component_1: createComponentSourceDraft({
      componentId: 'component_1',
      format: 'urdf',
      content: '<robot name="draft cleanup"/>',
      robot: component.robot,
    }),
    removed: createComponentSourceDraft({
      componentId: 'removed',
      format: 'urdf',
      content: '<robot name="removed"/>',
      robot: component.robot,
    }),
  });

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  function Probe() {
    useComponentSourceDraftCleanup();
    return null;
  }

  try {
    flushSync(() => root.render(React.createElement(Probe)));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(Object.keys(useAssetsStore.getState().componentSourceDrafts), [
      'component_1',
    ]);
    const currentRobot = useWorkspaceStore.getState().workspace.components.component_1!.robot;
    useWorkspaceStore.getState().replaceComponentRobot('component_1', {
      ...currentRobot,
      name: 'mutated source robot',
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(Object.keys(useAssetsStore.getState().componentSourceDrafts), [
      'component_1',
    ]);
    assert.match(
      useAssetsStore.getState().componentSourceDrafts.component_1.content,
      /mutated source robot/,
    );

    assert.equal(useWorkspaceStore.getState().undo(), true);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.doesNotMatch(
      useAssetsStore.getState().componentSourceDrafts.component_1.content,
      /mutated source robot/,
    );
  } finally {
    flushSync(() => root.unmount());
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    dom.window.close();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    });
  }
});
