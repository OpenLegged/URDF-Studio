import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { useMeshPreviewVisibility } from './useMeshPreviewVisibility';

class TestIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds = [0];
  target: Element | null = null;
  disconnected = false;

  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe(target: Element) { this.target = target; }
  unobserve() { this.target = null; }
  disconnect() { this.disconnected = true; }
  takeRecords(): IntersectionObserverEntry[] { return []; }

  emit(isIntersecting: boolean, intersectionRatio: number) {
    assert.ok(this.target);
    const bounds = this.target.getBoundingClientRect();
    this.callback([{
      target: this.target,
      isIntersecting,
      intersectionRatio,
      time: 0,
      boundingClientRect: bounds,
      intersectionRect: bounds,
      rootBounds: null,
    }], this);
  }
}

async function createHarness(observerAvailable = true) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const originalDescriptors = new Map<string, PropertyDescriptor | undefined>();
  const observers: TestIntersectionObserver[] = [];
  class TrackedIntersectionObserver extends TestIntersectionObserver {
    constructor(callback: IntersectionObserverCallback) {
      super(callback);
      observers.push(this);
    }
  }

  const replacements = {
    window: dom.window,
    document: dom.window.document,
    IntersectionObserver: observerAvailable ? TrackedIntersectionObserver : undefined,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [key, value] of Object.entries(replacements)) {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }

  const container = dom.window.document.getElementById('root');
  assert.ok(container);
  const root = createRoot(container);
  function Probe({ mounted, nodeKey }: { mounted: boolean; nodeKey: string }) {
    const { previewRef, isVisible } = useMeshPreviewVisibility();
    return <>
      <output>{String(isVisible)}</output>
      {mounted ? <div key={nodeKey} ref={previewRef} data-preview /> : null}
    </>;
  }

  return {
    observers,
    get visible() { return container.querySelector('output')?.textContent === 'true'; },
    async render(mounted: boolean, nodeKey = 'preview') {
      await act(async () => root.render(<Probe mounted={mounted} nodeKey={nodeKey} />));
    },
    async cleanup() {
      await act(async () => root.unmount());
      dom.window.close();
      for (const [key, descriptor] of originalDescriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test('mesh preview is visible only while its observer reports a positive intersection', async () => {
  const harness = await createHarness();
  try {
    await harness.render(true);
    assert.equal(harness.visible, false);
    const observer = harness.observers[0];
    await act(async () => observer.emit(true, 0.4));
    assert.equal(harness.visible, true);
    await act(async () => observer.emit(true, 0));
    assert.equal(harness.visible, false, 'touching the viewport edge is not visible');
    await act(async () => observer.emit(false, 0));
    assert.equal(harness.visible, false);
    await act(async () => observer.emit(true, 1));
    assert.equal(harness.visible, true);
  } finally {
    await harness.cleanup();
  }
  assert.equal(harness.observers[0].disconnected, true);
});

test('mesh preview re-observes a late asset or replacement node and ignores stale callbacks', async () => {
  const harness = await createHarness();
  try {
    await harness.render(false);
    assert.equal(harness.observers.length, 0);
    await harness.render(true);
    const first = harness.observers[0];
    await act(async () => first.emit(true, 1));
    assert.equal(harness.visible, true);

    await harness.render(false);
    assert.equal(first.disconnected, true);
    assert.equal(harness.visible, false);
    await act(async () => first.emit(true, 1));
    assert.equal(harness.visible, false);

    await harness.render(true, 'replacement');
    const second = harness.observers[1];
    assert.notEqual(second.target, first.target);
    assert.equal(harness.visible, false);
    await act(async () => second.emit(true, 1));
    assert.equal(harness.visible, true);
    await act(async () => first.emit(false, 0));
    assert.equal(harness.visible, true);
  } finally {
    await harness.cleanup();
  }
});

test('mesh preview remains usable when IntersectionObserver is unavailable', async () => {
  const harness = await createHarness(false);
  try {
    await harness.render(true);
    assert.equal(harness.visible, true);
    await harness.render(false);
    assert.equal(harness.visible, false);
  } finally {
    await harness.cleanup();
  }
});
