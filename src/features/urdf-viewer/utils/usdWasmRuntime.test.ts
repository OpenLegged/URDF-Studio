import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ensureUsdWasmRuntime,
  getUsdRuntimeEnvironmentError,
  prewarmUsdWasmRuntimeInBackground,
  resolvePreferredUsdThreadCount,
} from '@/lib/robot-parser/usd/usdWasmRuntime';

test('resolvePreferredUsdThreadCount caps browser USD runtime concurrency at 4 threads', () => {
  const previousNavigator = globalThis.navigator;

  Object.defineProperty(globalThis, 'navigator', {
    value: { hardwareConcurrency: 32 },
    configurable: true,
    writable: true,
  });

  try {
    assert.equal(resolvePreferredUsdThreadCount(), 4);
    assert.equal(resolvePreferredUsdThreadCount(6), 4);
    assert.equal(resolvePreferredUsdThreadCount(1), 1);
  } finally {
    if (previousNavigator === undefined) {
      delete (globalThis as { navigator?: Navigator }).navigator;
    } else {
      Object.defineProperty(globalThis, 'navigator', {
        value: previousNavigator,
        configurable: true,
        writable: true,
      });
    }
  }
});

test('ensureUsdWasmRuntime rejects early when the page is not cross-origin isolated', async () => {
  const previousWindow = globalThis.window;
  const previousCrossOriginIsolated = globalThis.crossOriginIsolated;
  const previousIsSecureContext = globalThis.isSecureContext;

  Object.defineProperty(globalThis, 'window', {
    value: {} as Window & typeof globalThis,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'isSecureContext', {
    value: true,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'crossOriginIsolated', {
    value: false,
    configurable: true,
    writable: true,
  });

  await assert.rejects(
    () => ensureUsdWasmRuntime(),
    /cross-origin isolated page|SharedArrayBuffer/,
  );

  if (previousWindow === undefined) {
    delete (globalThis as { window?: Window & typeof globalThis }).window;
  } else {
    Object.defineProperty(globalThis, 'window', {
      value: previousWindow,
      configurable: true,
      writable: true,
    });
  }

  Object.defineProperty(globalThis, 'isSecureContext', {
    value: previousIsSecureContext,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'crossOriginIsolated', {
    value: previousCrossOriginIsolated,
    configurable: true,
    writable: true,
  });
});

test('ensureUsdWasmRuntime rejects early when the page is not a secure context', async () => {
  const previousWindow = globalThis.window;
  const previousCrossOriginIsolated = globalThis.crossOriginIsolated;
  const previousIsSecureContext = globalThis.isSecureContext;

  Object.defineProperty(globalThis, 'window', {
    value: {} as Window & typeof globalThis,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'isSecureContext', {
    value: false,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'crossOriginIsolated', {
    value: false,
    configurable: true,
    writable: true,
  });

  await assert.rejects(
    () => ensureUsdWasmRuntime(),
    /secure context|localhost|127\.0\.0\.1/,
  );

  if (previousWindow === undefined) {
    delete (globalThis as { window?: Window & typeof globalThis }).window;
  } else {
    Object.defineProperty(globalThis, 'window', {
      value: previousWindow,
      configurable: true,
      writable: true,
    });
  }

  Object.defineProperty(globalThis, 'isSecureContext', {
    value: previousIsSecureContext,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'crossOriginIsolated', {
    value: previousCrossOriginIsolated,
    configurable: true,
    writable: true,
  });
});

test('ensureUsdWasmRuntime rejects early in worker-like non-secure contexts', async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousCrossOriginIsolated = globalThis.crossOriginIsolated;
  const previousIsSecureContext = globalThis.isSecureContext;

  delete (globalThis as { window?: Window & typeof globalThis }).window;
  delete (globalThis as { document?: Document }).document;
  Object.defineProperty(globalThis, 'isSecureContext', {
    value: false,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'crossOriginIsolated', {
    value: false,
    configurable: true,
    writable: true,
  });

  try {
    await assert.rejects(
      () => ensureUsdWasmRuntime(),
      /secure context|localhost|127\.0\.0\.1/,
    );
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: Window & typeof globalThis }).window;
    } else {
      Object.defineProperty(globalThis, 'window', {
        value: previousWindow,
        configurable: true,
        writable: true,
      });
    }

    if (previousDocument === undefined) {
      delete (globalThis as { document?: Document }).document;
    } else {
      Object.defineProperty(globalThis, 'document', {
        value: previousDocument,
        configurable: true,
        writable: true,
      });
    }

    Object.defineProperty(globalThis, 'isSecureContext', {
      value: previousIsSecureContext,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'crossOriginIsolated', {
      value: previousCrossOriginIsolated,
      configurable: true,
      writable: true,
    });
  }
});

test('getUsdRuntimeEnvironmentError accepts isolated worker-like contexts', () => {
  const error = getUsdRuntimeEnvironmentError({
    isSecureContext: true,
    crossOriginIsolated: true,
  } as typeof globalThis);

  assert.equal(error, null);
});

test('prewarmUsdWasmRuntimeInBackground logs rejected background loads', async () => {
  const originalConsoleWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    prewarmUsdWasmRuntimeInBackground(async () => {
      throw new Error('main thread runtime prewarm failed');
    });

    await Promise.resolve();

    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0]?.[0]), /prewarmUsdWasmRuntimeInBackground/);
    assert.match(String(warnings[0]?.[1]), /main thread runtime prewarm failed/);
  } finally {
    console.warn = originalConsoleWarn;
  }
});
