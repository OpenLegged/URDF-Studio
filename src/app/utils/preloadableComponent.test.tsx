import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act, Suspense, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';

import { createPreloadableComponent } from './preloadableComponent.tsx';

interface TestViewProps {
  label: string;
}

interface TestModule {
  View: ComponentType<TestViewProps>;
}

function TestView({ label }: TestViewProps) {
  return <div data-testid="loaded-view">{label}</div>;
}

function createDeferred<Value>() {
  let resolve: (value: Value) => void = () => {
    throw new Error('deferred promise was not initialized');
  };
  let reject: (reason: unknown) => void = () => {
    throw new Error('deferred promise was not initialized');
  };
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
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
  container: HTMLDivElement;
  restore: () => void;
  root: Root;
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

  const container = dom.window.document.querySelector<HTMLDivElement>('#root');
  assert.ok(container);

  return {
    container,
    root: createRoot(container),
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

test('preload and a suspended render share one loader promise', async () => {
  const deferred = createDeferred<TestModule>();
  let loaderCalls = 0;
  const resource = createPreloadableComponent(
    () => {
      loaderCalls += 1;
      return deferred.promise;
    },
    (module) => module.View,
  );
  const firstPreload = resource.preload();
  const secondPreload = resource.preload();
  const dom = installDomEnvironment();

  try {
    assert.strictEqual(secondPreload, firstPreload);

    await act(async () => {
      dom.root.render(
        <Suspense fallback={<div data-testid="fallback">Loading</div>}>
          <resource.Component label="Ready" />
        </Suspense>,
      );
    });

    assert.equal(loaderCalls, 1);
    assert.ok(dom.container.querySelector('[data-testid="fallback"]'));

    await act(async () => {
      deferred.resolve({ View: TestView });
      await firstPreload;
    });

    assert.equal(dom.container.textContent, 'Ready');
    assert.equal(dom.container.querySelector('[data-testid="fallback"]'), null);
  } finally {
    await act(async () => {
      dom.root.unmount();
    });
    dom.restore();
  }
});

test('a completed preload makes the first render synchronous', async () => {
  const resource = createPreloadableComponent(
    async (): Promise<TestModule> => ({ View: TestView }),
    (module) => module.View,
  );

  await resource.preload();

  const markup = renderToStaticMarkup(
    <Suspense fallback={<div>Loading</div>}>
      <resource.Component label="Already loaded" />
    </Suspense>,
  );

  assert.match(markup, /Already loaded/);
  assert.doesNotMatch(markup, /Loading/);
});

test('a failed preload is cleared so a later call can retry', async () => {
  let loaderCalls = 0;
  const resource = createPreloadableComponent(
    (): Promise<TestModule> => {
      loaderCalls += 1;
      if (loaderCalls === 1) {
        return Promise.reject(new Error('first load failed'));
      }
      return Promise.resolve({ View: TestView });
    },
    (module) => module.View,
  );

  await assert.rejects(resource.preload(), /first load failed/);
  await resource.preload();

  assert.equal(loaderCalls, 2);
  const markup = renderToStaticMarkup(<resource.Component label="Retried" />);
  assert.match(markup, /Retried/);
});
