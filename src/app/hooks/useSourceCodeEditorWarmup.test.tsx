import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { useSourceCodeEditorWarmup } from './useSourceCodeEditorWarmup.ts';

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

function installDomEnvironment() {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalSVGElement = globalThis.SVGElement;
  const originalNode = globalThis.Node;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

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
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    writable: true,
    value: dom.window.HTMLElement,
  });
  Object.defineProperty(globalThis, 'SVGElement', {
    configurable: true,
    writable: true,
    value: dom.window.SVGElement,
  });
  Object.defineProperty(globalThis, 'Node', {
    configurable: true,
    writable: true,
    value: dom.window.Node,
  });
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    writable: true,
    value: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
  });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    writable: true,
    value: (handle: number) => clearTimeout(handle),
  });

  return {
    restore() {
      dom.window.close();
      restoreGlobalProperty('window', originalWindow);
      restoreGlobalProperty('document', originalDocument);
      restoreGlobalProperty('navigator', originalNavigator);
      restoreGlobalProperty('HTMLElement', originalHTMLElement);
      restoreGlobalProperty('SVGElement', originalSVGElement);
      restoreGlobalProperty('Node', originalNode);
      restoreGlobalProperty('requestAnimationFrame', originalRequestAnimationFrame);
      restoreGlobalProperty('cancelAnimationFrame', originalCancelAnimationFrame);
    },
  };
}

function renderHook(params: Parameters<typeof useSourceCodeEditorWarmup>[0]): {
  hook: ReturnType<typeof useSourceCodeEditorWarmup>;
  cleanup: () => Promise<void>;
} {
  let hookValue: ReturnType<typeof useSourceCodeEditorWarmup> | null = null as ReturnType<
    typeof useSourceCodeEditorWarmup
  > | null;
  const container = document.createElement('div');
  document.body.appendChild(container);

  function Probe() {
    hookValue = useSourceCodeEditorWarmup(params);
    return null;
  }

  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(Probe));
  });

  assert.ok(hookValue);
  return {
    hook: hookValue,
    async cleanup() {
      flushSync(() => {
        root.unmount();
      });
      container.remove();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

test('useSourceCodeEditorWarmup reuses a single preload promise while warming', async () => {
  const dom = installDomEnvironment();
  let preloadCalls = 0;

  try {
    const { hook, cleanup } = renderHook({
      isSelectedUsdHydrating: false,
      setIsCodeViewerOpen: () => {},
      showToast: () => {},
      usdLoadInProgressMessage: 'USD loading',
      preloadRuntime: async () => {
        preloadCalls += 1;
      },
    });

    const first = hook.warmSourceCodeEditorRuntime();
    const second = hook.warmSourceCodeEditorRuntime();
    await Promise.all([first, second]);

    assert.equal(preloadCalls, 1);
    await cleanup();
  } finally {
    dom.restore();
  }
});

test('useSourceCodeEditorWarmup blocks code viewer opening while USD is hydrating', async () => {
  const dom = installDomEnvironment();
  const toastCalls: Array<{ message: string; type?: 'info' | 'success' }> = [];
  const openCalls: boolean[] = [];

  try {
    const { hook, cleanup } = renderHook({
      isSelectedUsdHydrating: true,
      setIsCodeViewerOpen: (open) => {
        openCalls.push(open);
      },
      showToast: (message, type) => {
        toastCalls.push({ message, type });
      },
      usdLoadInProgressMessage: 'USD loading',
      preloadRuntime: async () => {},
    });

    hook.handleOpenCodeViewer();

    assert.deepEqual(openCalls, []);
    assert.deepEqual(toastCalls, [{ message: 'USD loading', type: 'info' }]);
    await cleanup();
  } finally {
    dom.restore();
  }
});

test('useSourceCodeEditorWarmup catches a failed warmup and allows a later retry', async () => {
  const dom = installDomEnvironment();
  const preloadErrors: unknown[] = [];
  let preloadCalls = 0;

  try {
    const { hook, cleanup } = renderHook({
      isSelectedUsdHydrating: false,
      setIsCodeViewerOpen: () => {},
      showToast: () => {},
      usdLoadInProgressMessage: 'USD loading',
      preloadRuntime: async () => {
        preloadCalls += 1;
        throw new Error(`warmup failure ${preloadCalls}`);
      },
      onPreloadError: (error) => {
        preloadErrors.push(error);
      },
    });

    await hook.warmSourceCodeEditorRuntime();
    await hook.warmSourceCodeEditorRuntime();

    assert.equal(preloadCalls, 2);
    assert.equal(preloadErrors.length, 2);
    await cleanup();
  } finally {
    dom.restore();
  }
});

test('useSourceCodeEditorWarmup opens immediately while runtime warmup is pending', async () => {
  const dom = installDomEnvironment();
  const openCalls: boolean[] = [];
  let resolvePreload: () => void = () => {
    throw new Error('runtime warmup did not start');
  };

  try {
    const { hook, cleanup } = renderHook({
      isSelectedUsdHydrating: false,
      setIsCodeViewerOpen: (open) => {
        openCalls.push(open);
      },
      showToast: () => {},
      usdLoadInProgressMessage: 'USD loading',
      preloadRuntime: () =>
        new Promise<void>((resolve) => {
          resolvePreload = resolve;
        }),
    });

    hook.handleOpenCodeViewer();
    assert.deepEqual(openCalls, [true]);

    resolvePreload();
    await hook.warmSourceCodeEditorRuntime();
    await cleanup();
  } finally {
    dom.restore();
  }
});
