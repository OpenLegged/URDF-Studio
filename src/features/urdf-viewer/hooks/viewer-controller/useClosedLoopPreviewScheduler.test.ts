import test from 'node:test';
import assert from 'node:assert/strict';

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import type {
  AsyncClosedLoopMotionPreviewSession,
  ClosedLoopMotionPreviewResult,
} from '@/shared/utils/robot/closedLoopMotionPreview';
import type { RobotState } from '@/types';
import {
  type ClosedLoopPreviewScheduleRequest,
  useClosedLoopPreviewScheduler,
} from './useClosedLoopPreviewScheduler.ts';

type ClosedLoopRobot = Pick<
  RobotState,
  'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'
>;
type HookValue = ReturnType<typeof useClosedLoopPreviewScheduler>;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createSessionHarness() {
  const pendingSolves: Array<ReturnType<typeof createDeferred<ClosedLoopMotionPreviewResult>>> = [];
  let resetCount = 0;

  const session: AsyncClosedLoopMotionPreviewSession = {
    setBaseRobot() {},
    solve() {
      const deferred = createDeferred<ClosedLoopMotionPreviewResult>();
      pendingSolves.push(deferred);
      return deferred.promise;
    },
    reset() {
      resetCount += 1;
    },
  };

  return {
    session,
    pendingSolves,
    getResetCount: () => resetCount,
  };
}

function installDom() {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousReactActEnvironment = Object.getOwnPropertyDescriptor(
    globalThis,
    'IS_REACT_ACT_ENVIRONMENT',
  );
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextFrameHandle = 1;

  Object.defineProperty(dom.window, 'requestAnimationFrame', {
    value: (callback: FrameRequestCallback) => {
      const handle = nextFrameHandle++;
      callbacks.set(handle, callback);
      return handle;
    },
    configurable: true,
  });
  Object.defineProperty(dom.window, 'cancelAnimationFrame', {
    value: (handle: number) => callbacks.delete(handle),
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: dom.window,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'document', {
    value: dom.window.document,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });

  return {
    dom,
    scheduledFrameCount: () => callbacks.size,
    flushNextFrame: () => {
      const entry = callbacks.entries().next();
      if (entry.done) {
        return false;
      }
      const [handle, callback] = entry.value;
      callbacks.delete(handle);
      callback(0);
      return true;
    },
    restoreGlobals: () => {
      restoreGlobalProperty('window', previousWindow);
      restoreGlobalProperty('document', previousDocument);
      restoreGlobalProperty('IS_REACT_ACT_ENVIRONMENT', previousReactActEnvironment);
    },
  };
}

function restoreGlobalProperty(
  key: 'window' | 'document' | 'IS_REACT_ACT_ENVIRONMENT',
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(globalThis, key, descriptor);
    return;
  }
  Reflect.deleteProperty(globalThis, key);
}

const baseRobot = {
  links: {},
  joints: {},
  rootLinkId: 'root',
  closedLoopConstraints: [],
} satisfies ClosedLoopRobot;

async function renderScheduler() {
  const env = installDom();
  const sessionHarness = createSessionHarness();
  const resolvedRequests: ClosedLoopPreviewScheduleRequest[] = [];
  const container = env.dom.window.document.getElementById('root');
  assert.ok(container);
  const root = createRoot(container);
  let hookValue: HookValue | null = null as HookValue | null;

  function Probe() {
    hookValue = useClosedLoopPreviewScheduler(
      {
        baseRobot,
        onResolved: ({ request }) => resolvedRequests.push(request),
        onRejected() {},
      },
      () => sessionHarness.session,
    );
    return null;
  }

  await act(async () => {
    root.render(React.createElement(Probe));
  });

  return {
    ...env,
    root,
    sessionHarness,
    resolvedRequests,
    getHook: () => {
      assert.ok(hookValue);
      return hookValue;
    },
  };
}

async function cleanup(root: Root, dom: JSDOM, restoreGlobals: () => void) {
  await act(async () => root.unmount());
  dom.window.close();
  restoreGlobals();
}

function request(selectedJointId: string, resolvedAngle: number): ClosedLoopPreviewScheduleRequest {
  return {
    selectedJointId,
    resolvedAngle,
    diagnosticLabel: 'test preview',
    preserveActiveJointRuntime: true,
  };
}

test('useClosedLoopPreviewScheduler coalesces pending work to the latest request', async () => {
  const harness = await renderScheduler();

  try {
    harness.getHook().schedule(request('joint-a', 0.1));
    harness.getHook().schedule(request('joint-a', 0.2));
    assert.equal(harness.scheduledFrameCount(), 1);

    harness.flushNextFrame();
    assert.equal(harness.sessionHarness.pendingSolves.length, 1);
    harness.sessionHarness.pendingSolves[0]!.resolve({
      angles: { 'joint-a': 0.2 },
      quaternions: {},
      appliedAngle: 0.2,
      constrained: false,
    });
    await act(async () => {});

    assert.deepEqual(harness.resolvedRequests, [request('joint-a', 0.2)]);
  } finally {
    await cleanup(harness.root, harness.dom, harness.restoreGlobals);
  }
});

test('useClosedLoopPreviewScheduler reset invalidates in-flight work', async () => {
  const harness = await renderScheduler();

  try {
    harness.getHook().schedule(request('joint-a', 0.1));
    harness.flushNextFrame();
    assert.equal(harness.sessionHarness.pendingSolves.length, 1);

    harness.getHook().reset();
    harness.sessionHarness.pendingSolves[0]!.resolve({
      angles: { 'joint-a': 0.1 },
      quaternions: {},
      appliedAngle: 0.1,
      constrained: false,
    });
    await act(async () => {});

    assert.deepEqual(harness.resolvedRequests, []);
  } finally {
    await cleanup(harness.root, harness.dom, harness.restoreGlobals);
  }
});

test('useClosedLoopPreviewScheduler owns frame cleanup on unmount', async () => {
  const harness = await renderScheduler();
  harness.getHook().schedule(request('joint-a', 0.1));
  assert.equal(harness.scheduledFrameCount(), 1);
  const resetCountBeforeUnmount = harness.sessionHarness.getResetCount();

  await cleanup(harness.root, harness.dom, harness.restoreGlobals);

  assert.equal(harness.scheduledFrameCount(), 0);
  assert.ok(harness.sessionHarness.getResetCount() > resetCountBeforeUnmount);
});
