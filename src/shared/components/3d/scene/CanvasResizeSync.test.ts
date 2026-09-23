import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { context as r3fContext, type RootState } from '@react-three/fiber';
import { createWithEqualityFn } from 'zustand/traditional';

import {
  CanvasResizeSync,
  shouldStartCanvasResizeFrameloop,
} from './CanvasResizeSync';

function createResizeHarness(context: TestContext) {
  const dom = new JSDOM('<div id="root"></div><div id="surface"><canvas></canvas></div>');
  const timers = new Map<number, () => void>();
  const frames = new Map<number, FrameRequestCallback>();
  const modes: string[] = [];
  let nextId = 0;
  let invalidations = 0;
  let disconnected = false;
  let resize = () => { throw new Error('ResizeObserver is not mounted'); };
  class Observer implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      resize = () => callback([], this);
    }
    observe() {}
    unobserve() {}
    disconnect() { disconnected = true; }
  }
  const clearTimer = (id: number) => { timers.delete(id); };
  Object.defineProperty(dom.window, 'setTimeout', {
    value: (callback: () => void) => {
      const id = ++nextId;
      timers.set(id, callback);
      return id;
    },
  });
  Object.defineProperty(dom.window, 'clearTimeout', { value: clearTimer });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    ResizeObserver: Observer,
    IS_REACT_ACT_ENVIRONMENT: true,
    clearTimeout: clearTimer,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      const id = ++nextId;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id: number) => { frames.delete(id); },
  };
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(globals)) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const container = dom.window.document.getElementById('root');
  const canvas = dom.window.document.querySelector('canvas');
  assert.ok(container && canvas);
  const root = createRoot(container);
  // Only the hook's R3F dependencies are needed; actual canvas sizing and
  // rendering are covered by the browser regression.
  const store = createWithEqualityFn<RootState>(() => ({
    gl: { domElement: canvas },
    size: { width: 640, height: 480, top: 0, left: 0 },
    invalidate: () => { invalidations += 1; },
    setFrameloop: (mode: string) => { modes.push(mode); },
  } as RootState));
  let mounted = true;
  const unmount = () => {
    if (mounted) act(() => root.unmount());
    mounted = false;
  };
  context.after(() => {
    unmount();
    dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const render = (targetFrameloop: 'always' | 'demand' = 'demand') => act(() => {
    root.render(React.createElement(r3fContext.Provider, { value: store },
      React.createElement(CanvasResizeSync, { targetFrameloop }),
    ));
  });
  render();
  modes.length = 0;
  invalidations = 0;
  return {
    dom, timers, frames, modes, render, unmount,
    resize: () => resize(),
    get invalidations() { return invalidations; },
    get disconnected() { return disconnected; },
  };
}

test('unrelated width transitions do not wake the canvas', (context) => {
  const harness = createResizeHarness(context);
  for (const type of ['transitionrun', 'transitionstart']) {
    const event = new harness.dom.window.Event(type, { bubbles: true });
    Object.defineProperty(event, 'propertyName', { value: 'width' });
    harness.dom.window.document.body.dispatchEvent(event);
  }
  assert.equal(harness.invalidations, 0);
  assert.deepEqual(harness.modes, []);
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.frames.size, 0);
});

test('actual container resize stays smooth and restores the latest frame policy', (context) => {
  const harness = createResizeHarness(context);
  harness.resize();
  harness.resize();
  assert.deepEqual(harness.modes, ['always']);
  assert.equal(harness.invalidations, 2);
  assert.equal(harness.timers.size, 1);
  assert.equal(harness.frames.size, 1);
  harness.render('always');
  for (const callback of harness.timers.values()) callback();
  assert.deepEqual(harness.modes, ['always', 'always']);
});

test('window resize still refreshes and unmount cancels scheduled resize work', (context) => {
  const harness = createResizeHarness(context);
  harness.dom.window.dispatchEvent(new harness.dom.window.Event('resize'));
  assert.deepEqual(harness.modes, ['always']);
  assert.equal(harness.invalidations, 1);
  harness.unmount();
  assert.equal(harness.disconnected, true);
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.frames.size, 0);
  assert.deepEqual(harness.modes, ['always', 'demand']);
  harness.dom.window.dispatchEvent(new harness.dom.window.Event('resize'));
  assert.equal(harness.invalidations, 1);
});

test('shouldStartCanvasResizeFrameloop avoids restarting an active resize loop', () => {
  assert.equal(shouldStartCanvasResizeFrameloop(false), true);
  assert.equal(shouldStartCanvasResizeFrameloop(true), false);
});
