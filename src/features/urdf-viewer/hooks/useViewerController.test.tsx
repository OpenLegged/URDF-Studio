import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

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
