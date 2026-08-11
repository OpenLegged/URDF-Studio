import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { GeometryType, type UrdfLink } from '@/types';
import {
  useMassInertiaDecision,
  type UseMassInertiaDecisionParams,
} from './useMassInertiaDecision';

function createLink(id: string, mass = 1): UrdfLink {
  return {
    id,
    name: id,
    visible: true,
    visual: {
      type: GeometryType.BOX,
      dimensions: { x: 1, y: 1, z: 1 },
      color: '#ffffff',
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    },
    collision: {
      type: GeometryType.BOX,
      dimensions: { x: 1, y: 1, z: 1 },
      color: '#ffffff',
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    },
    inertial: {
      mass,
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
    },
  };
}

function installDom() {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
  });

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: dom.window,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: dom.window.document,
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: dom.window.navigator,
  });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    writable: true,
    value: true,
  });

  return {
    restore() {
      dom.window.close();
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        writable: true,
        value: originalWindow,
      });
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        writable: true,
        value: originalDocument,
      });
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        writable: true,
        value: originalNavigator,
      });
      delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    },
  };
}

async function renderHook(initialParams: UseMassInertiaDecisionParams) {
  let params = initialParams;
  let hookValue: ReturnType<typeof useMassInertiaDecision> | null = null;
  const container = document.createElement('div');
  document.body.appendChild(container);

  function Probe() {
    hookValue = useMassInertiaDecision(params);
    return null;
  }

  const root = createRoot(container);
  const render = async () => {
    await act(async () => root.render(React.createElement(Probe)));
  };
  await render();

  return {
    get value() {
      assert.ok(hookValue);
      return hookValue;
    },
    async rerender(nextParams: UseMassInertiaDecisionParams) {
      params = nextParams;
      await render();
    },
    async cleanup() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

function createParams(
  link: UrdfLink,
  overrides: Partial<UseMassInertiaDecisionParams> = {},
): UseMassInertiaDecisionParams {
  return {
    linkSnapshot: link,
    currentMass: link.inertial?.mass ?? 0,
    inertial: link.inertial!,
    preferredBehavior: 'ask',
    persistPreferredBehavior: () => {},
    applyInertialUpdate: () => {},
    buildNotice: (linkName) => ({ message: linkName, tone: 'info' }),
    ...overrides,
  };
}

test('useMassInertiaDecision resets transient decisions when the selected link changes', async () => {
  const dom = installDom();
  const linkA = createLink('link_a');
  const linkB = createLink('link_b', 3);
  const rendered = await renderHook(createParams(linkA));

  try {
    await act(async () => rendered.value.handleMassChange(2));
    assert.equal(rendered.value.pendingMassInertiaDecision?.linkSnapshot.id, 'link_a');

    await act(async () => {
      rendered.value.setSelectedMassInertiaBehavior('preserve');
      rendered.value.setRememberMassInertiaBehavior(true);
    });
    assert.equal(rendered.value.rememberMassInertiaBehavior, true);

    await rendered.rerender(createParams(linkB));

    assert.equal(rendered.value.pendingMassInertiaDecision, null);
    assert.equal(rendered.value.selectedMassInertiaBehavior, 'reestimate');
    assert.equal(rendered.value.rememberMassInertiaBehavior, false);
  } finally {
    await rendered.cleanup();
    dom.restore();
  }
});

test('useMassInertiaDecision clears its notice timer on unmount', async () => {
  const dom = installDom();
  const link = createLink('link_a');
  const rendered = await renderHook(
    createParams(link, {
      preferredBehavior: 'preserve',
    }),
  );
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timerHandle = { id: 'mass-inertia-notice' } as unknown as NodeJS.Timeout;
  const clearedHandles: Array<NodeJS.Timeout | undefined> = [];

  globalThis.setTimeout = ((() => timerHandle) as unknown) as typeof setTimeout;
  globalThis.clearTimeout = ((handle: NodeJS.Timeout | undefined) => {
    clearedHandles.push(handle);
  }) as unknown as typeof clearTimeout;

  try {
    await act(async () => rendered.value.handleMassChange(2));
    assert.equal(rendered.value.floatingMassInertiaNotice?.message, 'link_a');

    await rendered.cleanup();
    assert.deepEqual(clearedHandles, [timerHandle]);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    dom.restore();
  }
});
