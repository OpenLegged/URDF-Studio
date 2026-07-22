import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { ContextMenuFrame, ContextMenuItem } from './ContextMenu';

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

  addEventListener(type: string, callback: EventListenerOrEventListenerObject | null) {
    if (!callback) return;
    this.listenerAdds.set(type, (this.listenerAdds.get(type) ?? 0) + 1);
    const listeners = this.listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
    listeners.add(callback);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null) {
    if (!callback) return;
    this.listenerRemoves.set(type, (this.listenerRemoves.get(type) ?? 0) + 1);
    this.listeners.get(type)?.delete(callback);
  }

  dispatchEvent(event: Event) {
    for (const listener of this.listeners.get(event.type) ?? []) {
      if (typeof listener === 'function') listener(event);
      else listener.handleEvent(event);
    }
    return true;
  }

  listenerCount(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });

  Object.defineProperty(dom.window, 'innerWidth', { value: 1000, writable: true });
  Object.defineProperty(dom.window, 'innerHeight', { value: 800, writable: true });
  (globalThis as { window?: Window }).window = dom.window as unknown as Window;
  (globalThis as { document?: Document }).document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });
  (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement;
  (globalThis as { HTMLButtonElement?: typeof HTMLButtonElement }).HTMLButtonElement =
    dom.window.HTMLButtonElement;
  (globalThis as { Node?: typeof Node }).Node = dom.window.Node;
  (globalThis as { Event?: typeof Event }).Event = dom.window.Event;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  const originalGetBoundingClientRect = dom.window.HTMLElement.prototype.getBoundingClientRect;
  dom.window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    if (this.getAttribute('role') === 'menu') {
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 170,
        bottom: 220,
        width: 170,
        height: 220,
        toJSON: () => ({}),
      };
    }
    return originalGetBoundingClientRect.call(this);
  };

  return dom;
}

test('ContextMenuFrame follows visual viewport resize and scroll with bounded dimensions', async () => {
  const dom = installDom();
  const visualViewport = new MockVisualViewport(500, 400, 300, 200);
  Object.defineProperty(dom.window, 'visualViewport', {
    value: visualViewport,
    configurable: true,
  });
  const container = dom.window.document.getElementById('root');
  assert.ok(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(ContextMenuFrame, {
          position: { x: 1000, y: 900 },
          children: React.createElement(ContextMenuItem, null, 'Rename'),
        }),
      );
    });

    const menu = dom.window.document.querySelector<HTMLElement>('[role="menu"]');
    assert.ok(menu);
    assert.equal(menu.style.left, '622px');
    assert.equal(menu.style.top, '372px');
    assert.equal(menu.style.maxWidth, '484px');
    assert.equal(menu.style.maxHeight, '384px');

    visualViewport.width = 360;
    visualViewport.height = 260;
    visualViewport.offsetLeft = 400;
    visualViewport.offsetTop = 300;
    await act(async () => {
      visualViewport.dispatchEvent(new Event('resize'));
    });
    assert.equal(menu.style.left, '582px');
    assert.equal(menu.style.top, '332px');
    assert.equal(menu.style.maxWidth, '344px');
    assert.equal(menu.style.maxHeight, '244px');

    visualViewport.offsetLeft = 500;
    visualViewport.offsetTop = 450;
    await act(async () => {
      visualViewport.dispatchEvent(new Event('scroll'));
    });
    assert.equal(menu.style.left, '682px');
    assert.equal(menu.style.top, '482px');
    assert.equal(visualViewport.listenerAdds.get('resize'), 1);
    assert.equal(visualViewport.listenerAdds.get('scroll'), 1);

    Object.defineProperty(dom.window, 'visualViewport', {
      value: new MockVisualViewport(1000, 800, 0, 0),
      configurable: true,
    });
  } finally {
    await act(async () => root.unmount());
    assert.equal(visualViewport.listenerRemoves.get('resize'), 1);
    assert.equal(visualViewport.listenerRemoves.get('scroll'), 1);
    assert.equal(visualViewport.listenerCount('resize'), 0);
    assert.equal(visualViewport.listenerCount('scroll'), 0);
    dom.window.close();
  }
});
