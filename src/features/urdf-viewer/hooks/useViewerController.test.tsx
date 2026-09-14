import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { Vector3 } from 'three';
import { regressionDebugState } from '@/shared/debug/regressionState';

import { useUIStore } from '@/store';
import { useViewerController } from './useViewerController.ts';

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });

  (globalThis as { window?: Window }).window = dom.window as unknown as Window;
  (globalThis as { document?: Document }).document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: dom.window.localStorage,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    value: dom.window.HTMLElement,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });

  return dom;
}

function resetUiStore() {
  const store = useUIStore.getState();
  store.setViewOption('showCollision', false);
}

test('collision selection updates highlight mode without auto-enabling collision visibility', async () => {
  const dom = installDom();
  resetUiStore();

  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);

  let controller: ReturnType<typeof useViewerController> | null = null as ReturnType<typeof useViewerController> | null;

  function Probe() {
    controller = useViewerController({
      active: false,
      selection: {
        type: 'link',
        id: 'base_link',
        subType: 'collision',
        objectIndex: 1,
      },
    });
    return null;
  }

  await act(async () => {
    root.render(React.createElement(Probe));
  });

  assert.ok(controller, 'viewer controller should mount');
  assert.equal(controller.optionsPanel.showCollision, false);
  assert.equal(controller.optionsPanel.highlightMode, 'collision');

  await act(async () => {
    root.unmount();
  });
});


test('UI and debug tool commands clear the same transient measurement and paint state', async () => {
  const dom = installDom();
  dom.reconfigure({ url: 'http://localhost/?regressionDebug=1' });
  const container = dom.window.document.createElement('div');
  const root = createRoot(container);
  let current: ReturnType<typeof useViewerController> | undefined;
  let scope = 'first';
  function Probe() {
    current = useViewerController({ active: true, toolModeScopeKey: scope });
    return null;
  }
  const controller = () => {
    assert.ok(current);
    return current;
  };
  const enterMeasureWithHover = async () => {
    await act(async () => {
      controller().toolbar.handleToolModeChange('measure');
      controller().measureTool.setMeasureState((previous) => ({
        ...previous,
        hoverTarget: {
          key: 'link:base', label: 'base', linkName: 'base', objectType: 'visual',
          objectIndex: 0, point: new Vector3(), poseWorldMatrix: null,
        },
      }));
    });
  };
  try {
    await act(async () => { root.render(React.createElement(Probe)); });
    for (const entry of ['ui', 'debug'] as const) {
      await enterMeasureWithHover();
      assert.ok(controller().measureTool.measureState.hoverTarget);
      await act(async () => {
        if (entry === 'ui') controller().toolbar.handleToolModeChange('paint');
        else {
          assert.ok(regressionDebugState.viewerHandlers);
          regressionDebugState.viewerHandlers.setToolMode('paint');
        }
        controller().paintTool.setPaintStatus({ tone: 'success', message: 'painted' });
      });
      assert.equal(controller().measureTool.measureState.hoverTarget, null);
      assert.equal(controller().toolbar.toolMode, 'paint');
      await act(async () => {
        if (entry === 'ui') controller().toolbar.handleToolModeChange('select');
        else regressionDebugState.viewerHandlers?.setToolMode('select');
      });
      assert.equal(controller().paintTool.paintStatus, null);
      assert.equal(controller().toolbar.toolMode, 'select');
    }
    await enterMeasureWithHover();
    await act(async () => { controller().measureTool.handleCloseMeasureTool(); });
    assert.equal(controller().measureTool.measureState.hoverTarget, null);
    assert.equal(controller().toolbar.toolMode, 'select');
    await act(async () => { controller().toolbar.handleToolModeChange('paint'); });
    scope = 'second';
    await act(async () => { root.render(React.createElement(Probe)); });
    assert.equal(controller().toolbar.toolMode, 'select', 'a new scope restores its default tool');
  } finally {
    await act(async () => { root.unmount(); });
    dom.window.close();
  }
});
