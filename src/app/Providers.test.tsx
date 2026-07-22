import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

function installDom() {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalLocalStorage = globalThis.localStorage;
  const originalActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
  const dom = new JSDOM(
    '<!doctype html><html><head>'
      + '<link rel="canonical" href="https://urdf.enkeebot.com/en/">'
      + '</head><body><div id="root"></div></body></html>',
    { url: 'https://urdf.enkeebot.com/en/' },
  );

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: dom.window,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: dom.window.document,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    value: dom.window.HTMLElement,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: dom.window.localStorage,
  });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    value: true,
  });

  return {
    document: dom.window.document,
    rootElement: dom.window.document.getElementById('root') as HTMLElement,
    restore() {
      dom.window.close();
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      });
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: originalDocument,
      });
      Object.defineProperty(globalThis, 'HTMLElement', {
        configurable: true,
        value: originalHTMLElement,
      });
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: originalLocalStorage,
      });
      Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
        configurable: true,
        value: originalActEnvironment,
      });
    },
  };
}

test('Providers preserves the canonical URL emitted by the static language page', async () => {
  const dom = installDom();
  const [{ useUIStore }, { Providers }] = await Promise.all([
    import('@/store'),
    import('./Providers.tsx'),
  ]);
  const root = createRoot(dom.rootElement);
  const previousState = useUIStore.getState();

  try {
    useUIStore.setState({ lang: 'en', theme: 'light' });
    await act(async () => {
      root.render(
        <Providers>
          <span>content</span>
        </Providers>,
      );
    });

    const canonical = dom.document.querySelector('link[rel="canonical"]');
    assert.equal(canonical?.getAttribute('href'), 'https://urdf.enkeebot.com/en/');

    await act(async () => {
      useUIStore.getState().setLang('zh');
    });
    assert.equal(canonical?.getAttribute('href'), 'https://urdf.enkeebot.com/en/');
  } finally {
    await act(async () => {
      root.unmount();
    });
    useUIStore.setState({ lang: previousState.lang, theme: previousState.theme });
    dom.restore();
  }
});
