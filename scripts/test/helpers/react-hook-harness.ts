import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

/** A per-test DOM and React root; cleanup restores the previous process globals. */
export function renderHook<T>(context: TestContext, useHook: () => T) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
  });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const originalDescriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(globals)) {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const container = dom.window.document.getElementById('root');
  assert.ok(container);
  const root = createRoot(container);
  let value: T | undefined;
  let mounted = true;
  function Probe() {
    value = useHook();
    return null;
  }
  const rerender = () => act(() => root.render(createElement(Probe)));
  const unmount = () => {
    if (!mounted) return;
    act(() => root.unmount());
    mounted = false;
  };
  context.after(() => {
    unmount();
    dom.window.close();
    for (const [key, descriptor] of originalDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  rerender();
  return {
    get current(): T {
      assert.notEqual(value, undefined);
      return value as T;
    },
    rerender,
    unmount,
  };
}
