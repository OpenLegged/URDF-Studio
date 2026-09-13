import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ensureUsdWasmRuntime,
  getUsdRuntimeEnvironmentError,
  prewarmUsdWasmRuntimeInBackground,
  resolvePreferredUsdThreadCount,
} from '@/lib/robot-parser/usd/usdWasmRuntime';
import { warnUsdRuntimeEnvironment } from '@/lib/robot-parser/usd/usdWasmRuntime';

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

test('getUsdRuntimeEnvironmentError returns null for a secure isolated scope', () => {
  const error = getUsdRuntimeEnvironmentError({
    isSecureContext: true,
    crossOriginIsolated: true,
  } as typeof globalThis);

  assert.equal(error, null);
});

test('getUsdRuntimeEnvironmentError returns null for an insecure page-like scope', () => {
  const error = getUsdRuntimeEnvironmentError({
    window: {},
    document: {},
    isSecureContext: false,
    crossOriginIsolated: false,
  } as typeof globalThis);

  assert.equal(error, null);
});

test('getUsdRuntimeEnvironmentError returns null for a secure but non-isolated scope', () => {
  const error = getUsdRuntimeEnvironmentError({
    window: {},
    isSecureContext: true,
    crossOriginIsolated: false,
  } as typeof globalThis);

  assert.equal(error, null);
});

test('getUsdRuntimeEnvironmentError returns null for a worker-like non-secure scope', () => {
  const error = getUsdRuntimeEnvironmentError({
    isSecureContext: false,
    crossOriginIsolated: false,
  } as typeof globalThis);

  assert.equal(error, null);
});

test('warnUsdRuntimeEnvironment stays silent in an isolated scope', () => {
  const originalConsoleWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    warnUsdRuntimeEnvironment({
      isSecureContext: true,
      crossOriginIsolated: true,
    } as typeof globalThis);

    assert.equal(warnings.length, 0);
  } finally {
    console.warn = originalConsoleWarn;
  }
});

test('warnUsdRuntimeEnvironment stays silent in Node without capability signals', () => {
  const originalConsoleWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    warnUsdRuntimeEnvironment();

    assert.equal(warnings.length, 0);
  } finally {
    console.warn = originalConsoleWarn;
  }
});

test('warnUsdRuntimeEnvironment warns once with actionable text in a non-isolated scope', () => {
  const originalConsoleWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    warnUsdRuntimeEnvironment({
      isSecureContext: false,
      crossOriginIsolated: false,
    } as typeof globalThis);

    assert.equal(warnings.length, 1);
    const message = String(warnings[0]?.[0]);
    assert.match(message, /\[usd-wasm\]/);
    assert.match(message, /SharedArrayBuffer/);
    assert.match(message, /chrome:\/\/flags/);
    assert.match(message, /URDF_STUDIO_DEV_HTTPS=true/);

    warnUsdRuntimeEnvironment({
      isSecureContext: false,
      crossOriginIsolated: false,
    } as typeof globalThis);

    assert.equal(warnings.length, 1);
  } finally {
    console.warn = originalConsoleWarn;
  }
});

test('ensureUsdWasmRuntime no longer rejects on the removed secure-context gate', async () => {
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

  try {
    let rejection: unknown;
    try {
      await ensureUsdWasmRuntime();
    } catch (error) {
      rejection = error;
    }

    // The removed gate must never be the reason for failure. In Node there is no
    // document/fetch target for the WASM bindings, so boot fails downstream with a
    // script-loading / fetch error rather than the old secure-context message.
    assert.ok(rejection instanceof Error, 'expected a downstream boot error in Node');
    assert.doesNotMatch(
      String(rejection.message),
      /secure context|localhost|127\.0\.0\.1|cross-origin isolated|SharedArrayBuffer/,
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
