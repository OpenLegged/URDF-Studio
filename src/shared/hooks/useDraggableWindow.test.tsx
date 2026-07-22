import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import {
  useDraggableWindow,
  type DraggableWindowOptions,
  type DraggableWindowReturn,
} from './useDraggableWindow';

function installDom(width: number, height: number) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });

  Object.defineProperty(dom.window, 'innerWidth', { value: width, writable: true });
  Object.defineProperty(dom.window, 'innerHeight', { value: height, writable: true });
  (globalThis as { window?: Window }).window = dom.window as unknown as Window;
  (globalThis as { document?: Document }).document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });
  (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement;
  (globalThis as { Node?: typeof Node }).Node = dom.window.Node;
  (globalThis as { Event?: typeof Event }).Event = dom.window.Event;
  (globalThis as { MouseEvent?: typeof MouseEvent }).MouseEvent = dom.window.MouseEvent;
  (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame =
    dom.window.requestAnimationFrame.bind(dom.window);
  (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame =
    dom.window.cancelAnimationFrame.bind(dom.window);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  return dom;
}

class MockVisualViewport {
  width: number;
  height: number;
  offsetLeft: number;
  offsetTop: number;
  readonly listenerAdds = new Map<string, number>();
  readonly listenerRemoves = new Map<string, number>();
  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  constructor(width: number, height: number, offsetLeft: number, offsetTop: number) {
    this.width = width;
    this.height = height;
    this.offsetLeft = offsetLeft;
    this.offsetTop = offsetTop;
  }

  addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
  ) {
    if (!callback) return;
    this.listenerAdds.set(type, (this.listenerAdds.get(type) ?? 0) + 1);
    const listeners = this.listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
    listeners.add(callback);
    this.listeners.set(type, listeners);
  }

  removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
  ) {
    if (!callback) return;
    this.listenerRemoves.set(type, (this.listenerRemoves.get(type) ?? 0) + 1);
    this.listeners.get(type)?.delete(callback);
  }

  dispatchEvent(event: Event) {
    for (const listener of this.listeners.get(event.type) ?? []) {
      if (typeof listener === 'function') {
        listener(event);
      } else {
        listener.handleEvent(event);
      }
    }
    return true;
  }

  listenerCount(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

function renderHook(options: DraggableWindowOptions) {
  const container = document.getElementById('root');
  assert.ok(container);
  const root = createRoot(container);
  let current: DraggableWindowReturn | null = null;

  function Harness() {
    current = useDraggableWindow(options);
    return React.createElement('div', {
      ref: current.containerRef,
      style: current.windowStyle,
    });
  }

  return {
    root,
    render: async () => {
      await act(async () => {
        root.render(React.createElement(Harness));
      });
    },
    getCurrent: () => {
      assert.ok(current, 'hook should have rendered');
      return current;
    },
  };
}

test('window resize keeps a containable draggable window fully inside the viewport', async () => {
  const dom = installDom(1000, 800);
  const hook = renderHook({
    defaultPosition: { x: 800, y: 700 },
    defaultSize: { width: 300, height: 200 },
    minSize: { width: 200, height: 120 },
    centerOnMount: false,
    clampResizeToViewport: true,
    dragBounds: { allowNegativeX: true, minVisibleWidth: 100 },
  });

  try {
    await hook.render();
    assert.deepEqual(hook.getCurrent().position, { x: 700, y: 600 });

    Object.defineProperty(dom.window, 'innerWidth', { value: 600, writable: true });
    Object.defineProperty(dom.window, 'innerHeight', { value: 450, writable: true });
    await act(async () => {
      dom.window.dispatchEvent(new dom.window.Event('resize'));
    });

    assert.deepEqual(hook.getCurrent().size, { width: 300, height: 200 });
    assert.deepEqual(hook.getCurrent().position, { x: 300, y: 250 });
  } finally {
    await act(async () => hook.root.unmount());
    dom.window.close();
  }
});

test('visual viewport resize, pan, and external size changes re-constrain the window', async () => {
  const dom = installDom(1200, 900);
  const visualViewport = new MockVisualViewport(800, 600, 40, 60);
  Object.defineProperty(dom.window, 'visualViewport', {
    value: visualViewport,
    configurable: true,
  });
  const hook = renderHook({
    defaultPosition: { x: 690, y: 520 },
    defaultSize: { width: 300, height: 200 },
    minSize: { width: 200, height: 120 },
    viewportMinSize: { width: 360, height: 320 },
    centerOnMount: false,
    clampResizeToViewport: true,
    dragBounds: { allowNegativeX: true, minVisibleWidth: 100, topMargin: 12 },
  });

  try {
    await hook.render();
    assert.deepEqual(hook.getCurrent().position, { x: 540, y: 460 });

    await act(async () => {
      hook.getCurrent().setSize({ width: 500, height: 400 });
    });
    assert.deepEqual(hook.getCurrent().size, { width: 500, height: 400 });
    assert.deepEqual(hook.getCurrent().position, { x: 340, y: 260 });

    visualViewport.width = 320;
    visualViewport.height = 240;
    visualViewport.offsetLeft = 100;
    visualViewport.offsetTop = 120;
    await act(async () => {
      visualViewport.dispatchEvent(new Event('resize'));
    });
    assert.deepEqual(hook.getCurrent().size, { width: 320, height: 240 });
    assert.deepEqual(hook.getCurrent().position, { x: 100, y: 120 });

    visualViewport.offsetLeft = 220;
    visualViewport.offsetTop = 260;
    await act(async () => {
      visualViewport.dispatchEvent(new Event('scroll'));
    });
    assert.deepEqual(hook.getCurrent().position, { x: 220, y: 260 });

    assert.equal(visualViewport.listenerAdds.get('resize'), 1);
    assert.equal(visualViewport.listenerAdds.get('scroll'), 1);
  } finally {
    await act(async () => hook.root.unmount());
    assert.equal(visualViewport.listenerRemoves.get('resize'), 1);
    assert.equal(visualViewport.listenerRemoves.get('scroll'), 1);
    assert.equal(visualViewport.listenerCount('resize'), 0);
    assert.equal(visualViewport.listenerCount('scroll'), 0);
    dom.window.close();
  }
});

test('external oversized setSize is capped before re-positioning inside the visual viewport', async () => {
  const dom = installDom(1200, 900);
  const visualViewport = new MockVisualViewport(700, 500, 25, 35);
  Object.defineProperty(dom.window, 'visualViewport', {
    value: visualViewport,
    configurable: true,
  });
  const hook = renderHook({
    defaultPosition: { x: 600, y: 430 },
    defaultSize: { width: 260, height: 180 },
    minSize: { width: 200, height: 120 },
    centerOnMount: false,
    clampResizeToViewport: true,
  });

  try {
    await hook.render();
    await act(async () => {
      hook.getCurrent().setSize(() => ({ width: 2000, height: 1600 }));
    });

    assert.deepEqual(hook.getCurrent().size, { width: 676, height: 476 });
    assert.deepEqual(hook.getCurrent().position, { x: 49, y: 59 });
  } finally {
    await act(async () => hook.root.unmount());
    dom.window.close();
  }
});
