import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';

import { createSingleComponentWorkspace } from '@/core/robot';
import { translations } from '@/shared/i18n';
import { useSelectionStore } from '@/store/selectionStore';
import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  JointType,
  type RobotData,
  type WorkspaceSelection,
} from '@/types';
import { TreeEditorStructureSection } from './TreeEditorStructureSection';

function createWorkspace() {
  const robot: RobotData = {
    name: 'demo',
    rootLinkId: 'base',
    links: { base: { ...structuredClone(DEFAULT_LINK), id: 'base', name: 'base' } },
    joints: {},
  };
  return createSingleComponentWorkspace(robot, {
    componentId: 'demo-component',
    componentName: 'demo',
    sourceFile: 'robots/demo.urdf',
  });
}

function createMultiWorkspace() {
  const workspace = createWorkspace();
  workspace.components.second = {
    ...structuredClone(workspace.components['demo-component']!),
    id: 'second',
    name: 'second',
  };
  workspace.bridges.mount = {
    id: 'mount',
    name: 'Mount bridge',
    parentComponentId: 'demo-component',
    parentLinkId: 'base',
    childComponentId: 'second',
    childLinkId: 'base',
    joint: {
      ...DEFAULT_JOINT,
      id: 'mount',
      name: 'mount_joint',
      type: JointType.FIXED,
      parentLinkId: 'base',
      childLinkId: 'base',
    },
  };
  return workspace;
}

function installDom(scrolledRows: string[]) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    Node: { configurable: true, value: dom.window.Node },
    Event: { configurable: true, value: dom.window.Event },
    MouseEvent: { configurable: true, value: dom.window.MouseEvent },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value(this: HTMLElement) {
      const testId = this.getAttribute('data-testid');
      if (testId) scrolledRows.push(testId);
    },
  });
  return dom;
}

test('structure header preserves legacy file-path and stateful action styling', () => {
  const markup = renderToStaticMarkup(
    <TreeEditorStructureSection
      workspace={createWorkspace()}
      activeComponentId="demo-component"
      isOpen
      structureTreeShowGeometryDetails
      showVisual
      showStructureFilePath
      currentFileName="robots/demo.urdf"
      mode="editor"
      t={translations.en}
      onToggleOpen={() => {}}
      onToggleGeometryDetails={() => {}}
      onAddChildFromSelection={() => {}}
      onToggleVisuals={() => {}}
      onAddChild={() => {}}
      onAddCollisionBody={() => {}}
      onDelete={() => {}}
      onUpdate={() => {}}
      onRobotNameChange={() => {}}
    />,
  );

  assert.match(markup, /lucide-file-code/);
  assert.match(markup, /value="robots\/demo\.urdf"/);
  assert.match(markup, /ring-border-black\/60/);
  assert.match(markup, /bg-system-blue-solid/);
  assert.match(markup, /title="Open Structure Graph"/);
  assert.match(markup, /title="Hide Geometry Details"/);
  assert.ok(markup.includes(`title="${translations.en.addChildLink}"`));
  assert.match(markup, /title="Hide All Visuals"/);
});

test('multi-component header keeps robot-wide add and visibility actions hidden', () => {
  const markup = renderToStaticMarkup(
    <TreeEditorStructureSection
      workspace={createMultiWorkspace()}
      activeComponentId="demo-component"
      isOpen
      structureTreeShowGeometryDetails={false}
      showVisual
      mode="editor"
      t={translations.en}
      onToggleOpen={() => {}}
      onToggleGeometryDetails={() => {}}
      onAddChildFromSelection={() => {}}
      onToggleVisuals={() => {}}
      onAddChild={() => {}}
      onAddCollisionBody={() => {}}
      onDelete={() => {}}
      onUpdate={() => {}}
      onRobotNameChange={() => {}}
    />,
  );

  assert.equal(markup.includes(`title="${translations.en.addChildLink}"`), false);
  assert.equal(markup.includes(`title="${translations.en.hideAllVisuals}"`), false);
  assert.match(markup, new RegExp(`title="${translations.en.openStructureGraph}"`));
});

test('bridge attention scrolls the canonical bridge row into view', async () => {
  const scrolledRows: string[] = [];
  const dom = installDom(scrolledRows);
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const bridgeSelection: WorkspaceSelection = {
    entity: { type: 'bridge', bridgeId: 'mount' },
  };
  useSelectionStore.getState().clearSelection();
  useSelectionStore.getState().clearAttentionSelection();

  try {
    await act(async () => {
      root.render(
        <TreeEditorStructureSection
          workspace={createMultiWorkspace()}
          activeComponentId="demo-component"
          isOpen
          structureTreeShowGeometryDetails={false}
          showVisual
          mode="editor"
          t={translations.en}
          onToggleOpen={() => {}}
          onToggleGeometryDetails={() => {}}
          onAddChildFromSelection={() => {}}
          onToggleVisuals={() => {}}
          onAddChild={() => {}}
          onAddCollisionBody={() => {}}
          onDelete={() => {}}
          onUpdate={() => {}}
          onRobotNameChange={() => {}}
        />,
      );
    });
    await act(async () => {
      useSelectionStore.getState().setSelection(bridgeSelection);
      useSelectionStore.getState().setAttentionSelection(bridgeSelection);
      await new Promise((resolve) => dom.window.requestAnimationFrame(resolve));
    });

    assert.deepEqual(scrolledRows, ['tree-bridge-mount']);
  } finally {
    await act(async () => {
      useSelectionStore.getState().clearAttentionSelection();
      useSelectionStore.getState().clearSelection();
      root.unmount();
    });
    dom.window.close();
  }
});
