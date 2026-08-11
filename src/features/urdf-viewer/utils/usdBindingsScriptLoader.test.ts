import test from 'node:test';
import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';

import {
  buildUsdBindingsAssetPath,
  buildUsdBindingsScriptUrl,
  ensureClassicScriptLoaded,
  resetClassicScriptLoaderForTests,
} from '@/lib/robot-parser/usd/usdBindingsScriptLoader';

test('builds the USD bindings script URL with the cache key on the raw public path', () => {
  assert.equal(
    buildUsdBindingsScriptUrl('20260318a', { baseUrl: '/' }),
    '/usd/bindings/emHdBindings.js?v=20260318a',
  );
});

test('builds USD bindings asset URLs under a non-root public base path', () => {
  assert.equal(
    buildUsdBindingsAssetPath('emHdBindings.wasm', {
      baseUrl: '/urdf-studio/',
      cacheKey: '20260318a',
    }),
    '/urdf-studio/usd/bindings/emHdBindings.wasm?v=20260318a',
  );
});

test('injects the USD bindings as a classic script instead of a module import', async () => {
  resetClassicScriptLoaderForTests();

  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'http://localhost:3000/',
  });

  const loadPromise = ensureClassicScriptLoaded(
    '/usd/bindings/emHdBindings.js?v=20260318a',
    dom.window.document,
  );

  const injectedScripts = dom.window.document.head.querySelectorAll('script[src]');
  assert.equal(injectedScripts.length, 1);

  const injectedScript = injectedScripts[0] as HTMLScriptElement;
  assert.equal(injectedScript.getAttribute('type'), null);
  assert.match(injectedScript.src, /\/usd\/bindings\/emHdBindings\.js\?v=20260318a$/);

  injectedScript.dispatchEvent(new dom.window.Event('load'));
  await loadPromise;
});

test('deduplicates concurrent USD bindings script loads for the same document and src', async () => {
  resetClassicScriptLoaderForTests();

  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'http://localhost:3000/',
  });

  const firstPromise = ensureClassicScriptLoaded(
    '/usd/bindings/emHdBindings.js?v=20260318a',
    dom.window.document,
  );
  const secondPromise = ensureClassicScriptLoaded(
    '/usd/bindings/emHdBindings.js?v=20260318a',
    dom.window.document,
  );

  assert.strictEqual(firstPromise, secondPromise);
  assert.equal(dom.window.document.head.querySelectorAll('script[src]').length, 1);

  const injectedScript = dom.window.document.head.querySelector('script[src]');
  assert.ok(injectedScript);

  injectedScript.dispatchEvent(new dom.window.Event('load'));
  await Promise.all([firstPromise, secondPromise]);
});

test('loads USD bindings in a worker-like environment without document access', async () => {
  resetClassicScriptLoaderForTests();

  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const previousLocation = globalThis.location;

  delete (globalThis as { document?: Document }).document;
  Object.defineProperty(globalThis, 'location', {
    value: new URL('http://localhost:3000/viewer/'),
    configurable: true,
    writable: true,
  });

  let fetchCount = 0;
  (
    globalThis as typeof globalThis & {
      __usdWorkerBindingsLoadedCount?: number;
    }
  ).__usdWorkerBindingsLoadedCount = 0;

  Object.defineProperty(globalThis, 'fetch', {
    value: async () => {
      fetchCount += 1;
      return {
        ok: true,
        text: async () =>
          [
            'globalThis.__usdWorkerBindingsLoadedCount = (globalThis.__usdWorkerBindingsLoadedCount || 0) + 1;',
            'globalThis.USD_WASM_MODULE = () => Promise.resolve({});',
          ].join('\n'),
      } satisfies Pick<Response, 'ok' | 'text'>;
    },
    configurable: true,
    writable: true,
  });

  try {
    const firstPromise = ensureClassicScriptLoaded('/usd/bindings/emHdBindings.js?v=20260318a');
    const secondPromise = ensureClassicScriptLoaded('/usd/bindings/emHdBindings.js?v=20260318a');

    assert.strictEqual(firstPromise, secondPromise);
    await Promise.all([firstPromise, secondPromise]);

    assert.equal(fetchCount, 1);
    assert.equal((globalThis as { __usdWorkerBindingsLoadedCount?: number }).__usdWorkerBindingsLoadedCount, 1);
    assert.equal(typeof (globalThis as { USD_WASM_MODULE?: unknown }).USD_WASM_MODULE, 'function');
  } finally {
    delete (globalThis as { __usdWorkerBindingsLoadedCount?: number })
      .__usdWorkerBindingsLoadedCount;
    delete (globalThis as { USD_WASM_MODULE?: unknown }).USD_WASM_MODULE;

    if (previousDocument === undefined) {
      delete (globalThis as { document?: Document }).document;
    } else {
      Object.defineProperty(globalThis, 'document', {
        value: previousDocument,
        configurable: true,
        writable: true,
      });
    }

    if (previousFetch === undefined) {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    } else {
      Object.defineProperty(globalThis, 'fetch', {
        value: previousFetch,
        configurable: true,
        writable: true,
      });
    }

    Object.defineProperty(globalThis, 'location', {
      value: previousLocation,
      configurable: true,
      writable: true,
    });
  }
});
