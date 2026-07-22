import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { Object3D } from 'three';

import { useUnifiedViewerSceneLifecycle } from './useUnifiedViewerSceneLifecycle.ts';

interface HookProps {
  viewerVisible: boolean;
  viewerMounted: boolean;
  sourceFilePath: string;
  onInactiveViewerTimeout: () => void;
}

function installDomEnvironment() {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalNode = globalThis.Node;
  const originalActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
  });
  let nextTimerId = 1;
  const timers = new Map<number, () => void>();

  Object.defineProperty(dom.window, 'setTimeout', {
    configurable: true,
    value: (callback: () => void) => {
      const timerId = nextTimerId;
      nextTimerId += 1;
      timers.set(timerId, callback);
      return timerId;
    },
  });
  Object.defineProperty(dom.window, 'clearTimeout', {
    configurable: true,
    value: (timerId: number) => {
      timers.delete(timerId);
    },
  });
  const setGlobal = (key: string, value: unknown) => {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  };
  setGlobal('window', dom.window);
  setGlobal('document', dom.window.document);
  setGlobal('navigator', dom.window.navigator);
  setGlobal('HTMLElement', dom.window.HTMLElement);
  setGlobal('Node', dom.window.Node);
  setGlobal('IS_REACT_ACT_ENVIRONMENT', true);

  return {
    get pendingTimerCount() {
      return timers.size;
    },
    async runTimers() {
      const callbacks = [...timers.values()];
      timers.clear();
      await act(async () => {
        callbacks.forEach((callback) => callback());
      });
    },
    restore() {
      dom.window.close();
      setGlobal('window', originalWindow);
      setGlobal('document', originalDocument);
      setGlobal('navigator', originalNavigator);
      setGlobal('HTMLElement', originalHTMLElement);
      setGlobal('Node', originalNode);
      if (originalActEnvironment === undefined) {
        delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
      } else {
        Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
          configurable: true,
          writable: true,
          value: originalActEnvironment,
        });
      }
    },
  };
}

async function renderHook(initialProps: HookProps) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let currentProps = initialProps;
  let currentHook: ReturnType<typeof useUnifiedViewerSceneLifecycle> | null = null;

  function Probe(props: HookProps) {
    currentHook = useUnifiedViewerSceneLifecycle({
      viewerVisible: props.viewerVisible,
      viewerMounted: props.viewerMounted,
      sourceFile: null,
      sourceFilePath: props.sourceFilePath,
      sourceFormat: 'urdf',
      onInactiveViewerTimeout: props.onInactiveViewerTimeout,
    });
    return null;
  }

  const render = async () => {
    await act(async () => {
      root.render(React.createElement(Probe, currentProps));
    });
  };
  await render();

  return {
    get hook() {
      assert.ok(currentHook);
      return currentHook;
    },
    async rerender(nextProps: Partial<HookProps> = {}) {
      currentProps = { ...currentProps, ...nextProps };
      await render();
    },
    async cleanup() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

test('retains only a robot loaded for the current document scope', async () => {
  const dom = installDomEnvironment();
  try {
    const rendered = await renderHook({
      viewerVisible: true,
      viewerMounted: true,
      sourceFilePath: 'robots/first.urdf',
      onInactiveViewerTimeout: () => undefined,
    });
    const robot = new Object3D();

    rendered.hook.onRuntimeRobotLoaded(robot);
    await rendered.rerender();
    assert.equal(rendered.hook.retainedRobot, robot);

    await rendered.rerender({ sourceFilePath: 'robots/second.urdf' });
    assert.equal(rendered.hook.retainedRobot, null);
    await rendered.cleanup();
  } finally {
    dom.restore();
  }
});

test('owns inactive scene timers and releases the retained graph after unmount', async () => {
  const dom = installDomEnvironment();
  let inactiveTimeouts = 0;
  try {
    const rendered = await renderHook({
      viewerVisible: true,
      viewerMounted: true,
      sourceFilePath: 'robots/first.urdf',
      onInactiveViewerTimeout: () => {
        inactiveTimeouts += 1;
      },
    });
    rendered.hook.onRuntimeRobotLoaded(new Object3D());

    await rendered.rerender({ viewerVisible: false });
    assert.equal(dom.pendingTimerCount, 1);
    await dom.runTimers();
    assert.equal(inactiveTimeouts, 1);

    await rendered.rerender({ viewerMounted: false });
    assert.equal(dom.pendingTimerCount, 1);
    await dom.runTimers();
    await rendered.rerender();
    assert.equal(rendered.hook.retainedRobot, null);
    await rendered.cleanup();
    assert.equal(dom.pendingTimerCount, 0);
  } finally {
    dom.restore();
  }
});

test('cleanup cancels every timer owned by the scene lifecycle', async () => {
  const dom = installDomEnvironment();
  try {
    const rendered = await renderHook({
      viewerVisible: false,
      viewerMounted: true,
      sourceFilePath: 'robots/first.urdf',
      onInactiveViewerTimeout: () => undefined,
    });
    assert.equal(dom.pendingTimerCount, 1);

    await rendered.cleanup();
    assert.equal(dom.pendingTimerCount, 0);
  } finally {
    dom.restore();
  }
});
