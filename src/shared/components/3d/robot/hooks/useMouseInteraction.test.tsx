import assert from 'node:assert/strict';
import test from 'node:test';

import { context as r3fContext } from '@react-three/fiber';
import { JSDOM } from 'jsdom';
import React, { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { create } from 'zustand';

import type { InteractionSelection } from '@/types/index';
import { useMouseInteraction } from './useMouseInteraction';

function installDom() {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true,
  });

  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: dom.window.document,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    value: dom.window.HTMLElement,
  });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    value: true,
  });

  return {
    rootElement: dom.window.document.getElementById('root') as HTMLElement,
    restore() {
      dom.window.close();
      Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: originalDocument,
      });
      Object.defineProperty(globalThis, 'HTMLElement', {
        configurable: true,
        value: originalHTMLElement,
      });
      Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
        configurable: true,
        value: originalActEnvironment,
      });
    },
  };
}

const rayIntersectsBoundingBox = () => true;
const highlightGeometry = () => {};

test('selection and unrelated rerenders do not reinstall the pointer interaction lifecycle', async () => {
  const dom = installDom();
  const root = createRoot(dom.rootElement);
  const canvas = dom.rootElement.ownerDocument.createElement('canvas');
  Object.defineProperties(canvas, {
    clientWidth: { configurable: true, value: 200 },
    clientHeight: { configurable: true, value: 200 },
  });

  let mouseDownAdds = 0;
  let mouseDownRemoves = 0;
  const originalAddEventListener = canvas.addEventListener.bind(canvas);
  const originalRemoveEventListener = canvas.removeEventListener.bind(canvas);
  Object.defineProperty(canvas, 'addEventListener', {
    configurable: true,
    value: ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (type === 'mousedown') mouseDownAdds += 1;
      originalAddEventListener(type, listener, options);
    }) satisfies typeof canvas.addEventListener,
  });
  Object.defineProperty(canvas, 'removeEventListener', {
    configurable: true,
    value: ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) => {
      if (type === 'mousedown') mouseDownRemoves += 1;
      originalRemoveEventListener(type, listener, options);
    }) satisfies typeof canvas.removeEventListener,
  });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const controls = { enabled: true };
  const r3fStore = create(() => ({
    camera,
    controls,
    gl: { domElement: canvas },
    invalidate: () => {},
    scene,
  }));

  function Harness({
    selection,
    renderToken,
  }: {
    selection: InteractionSelection;
    renderToken: number;
  }) {
    const linkMeshMapRef = useRef(new Map<string, THREE.Mesh[]>());
    void renderToken;
    useMouseInteraction({
      robot: null,
      robotVersion: 0,
      toolMode: 'select',
      mode: 'editor',
      showCollision: false,
      showVisual: true,
      showCollisionAlwaysOnTop: false,
      linkMeshMapRef,
      selection,
      rayIntersectsBoundingBox,
      highlightGeometry,
    });
    return null;
  }

  const render = async (selection: InteractionSelection, renderToken: number) => {
    await act(async () => {
      root.render(
        <r3fContext.Provider value={r3fStore as unknown as React.ContextType<typeof r3fContext>}>
          <Harness selection={selection} renderToken={renderToken} />
        </r3fContext.Provider>,
      );
    });
  };

  try {
    await render({ type: null, id: null }, 0);
    assert.equal(mouseDownAdds, 1);
    assert.equal(mouseDownRemoves, 0);

    await render({ type: 'link', id: 'arm' }, 1);
    await render({ type: 'link', id: 'arm' }, 2);

    assert.equal(mouseDownAdds, 1, 'the main interaction effect should remain mounted');
    assert.equal(mouseDownRemoves, 0, 'active drag state must not be disposed by rerenders');
  } finally {
    await act(async () => root.unmount());
    dom.restore();
  }
});
