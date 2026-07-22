import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { LazyOverlayFallback } from './LazyOverlayFallback.tsx';

interface ScheduledTimer {
  callback: () => void;
  delay: number | undefined;
  id: number;
}

function restoreGlobalProperty<T extends keyof typeof globalThis>(
  key: T,
  originalValue: (typeof globalThis)[T] | undefined,
) {
  if (originalValue === undefined) {
    delete globalThis[key];
    return;
  }

  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: originalValue,
  });
}

function installDomEnvironment(): {
  clearedTimerIds: number[];
  container: HTMLDivElement;
  restore: () => void;
  root: Root;
  scheduledTimers: ScheduledTimer[];
} {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalNode = globalThis.Node;
  const originalActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
  });
  const scheduledTimers: ScheduledTimer[] = [];
  const clearedTimerIds: number[] = [];
  let nextTimerId = 1;

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
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    writable: true,
    value: dom.window.HTMLElement,
  });
  Object.defineProperty(globalThis, 'Node', {
    configurable: true,
    writable: true,
    value: dom.window.Node,
  });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  dom.window.setTimeout = ((handler: TimerHandler, delay?: number) => {
    assert.equal(typeof handler, 'function');
    const timer = {
      callback: handler as () => void,
      delay,
      id: nextTimerId,
    };
    nextTimerId += 1;
    scheduledTimers.push(timer);
    return timer.id;
  }) as typeof dom.window.setTimeout;
  dom.window.clearTimeout = ((timerId: number) => {
    clearedTimerIds.push(timerId);
  }) as typeof dom.window.clearTimeout;

  const container = dom.window.document.querySelector<HTMLDivElement>('#root');
  assert.ok(container);

  return {
    clearedTimerIds,
    container,
    root: createRoot(container),
    scheduledTimers,
    restore() {
      dom.window.close();
      restoreGlobalProperty('window', originalWindow);
      restoreGlobalProperty('document', originalDocument);
      restoreGlobalProperty('navigator', originalNavigator);
      restoreGlobalProperty('HTMLElement', originalHTMLElement);
      restoreGlobalProperty('Node', originalNode);

      if (originalActEnvironment === undefined) {
        delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
      } else {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
          originalActEnvironment;
      }
    },
  };
}

test('LazyOverlayFallback waits 150ms before showing a non-blocking status', async () => {
  const dom = installDomEnvironment();

  try {
    await act(async () => {
      dom.root.render(
        <LazyOverlayFallback label="Loading settings" detail="Preparing the editor" />,
      );
    });

    assert.equal(dom.container.firstElementChild, null);
    assert.equal(dom.scheduledTimers.length, 1);
    assert.equal(dom.scheduledTimers[0]?.delay, 150);

    await act(async () => {
      dom.scheduledTimers[0]?.callback();
    });

    const overlay = dom.container.firstElementChild as HTMLDivElement | null;
    assert.ok(overlay);
    assert.match(overlay.className, /pointer-events-none/);
    assert.match(overlay.className, /fixed/);
    assert.match(overlay.className, /items-center/);
    assert.match(overlay.className, /justify-center/);
    assert.doesNotMatch(overlay.className, /bg-black/);

    const status = overlay.querySelector('[role="status"]');
    assert.ok(status);
    assert.equal(status.getAttribute('aria-live'), 'polite');
    assert.match(status.className, /bg-panel-bg/);
    assert.equal(status.textContent?.includes('Loading settings'), true);
    assert.equal(status.textContent?.includes('Preparing the editor'), true);
  } finally {
    await act(async () => {
      dom.root.unmount();
    });
    dom.restore();
  }
});

test('LazyOverlayFallback clears its delay timer when a short load unmounts', async () => {
  const dom = installDomEnvironment();

  try {
    await act(async () => {
      dom.root.render(<LazyOverlayFallback label="Loading export" delayMs={400} />);
    });

    const timer = dom.scheduledTimers[0];
    assert.ok(timer);
    assert.equal(dom.container.firstElementChild, null);

    await act(async () => {
      dom.root.unmount();
    });

    assert.deepEqual(dom.clearedTimerIds, [timer.id]);
    assert.equal(dom.container.firstElementChild, null);
  } finally {
    dom.restore();
  }
});
