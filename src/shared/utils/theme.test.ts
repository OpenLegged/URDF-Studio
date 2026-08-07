import test from 'node:test';
import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';

import { applyDocumentTheme, resolveTheme } from './theme.ts';

function installDom(options: { systemDark?: boolean } = {}) {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const dom = new JSDOM('<!doctype html><html><body></body></html>');

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: dom.window,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: dom.window.document,
  });
  Object.defineProperty(dom.window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches:
        query === '(prefers-color-scheme: dark)' && options.systemDark === true,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });

  return {
    root: dom.window.document.documentElement,
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
    },
  };
}

test('applyDocumentTheme updates dark class and resolved theme attribute', () => {
  const dom = installDom();

  try {
    const resolved = applyDocumentTheme('dark');

    assert.equal(resolved, 'dark');
    assert.equal(dom.root.classList.contains('dark'), true);
    assert.equal(dom.root.dataset.theme, 'dark');

    applyDocumentTheme('light');
    assert.equal(dom.root.classList.contains('dark'), false);
    assert.equal(dom.root.dataset.theme, 'light');
  } finally {
    dom.restore();
  }
});

test('resolveTheme uses current system preference for system theme', () => {
  const dom = installDom({ systemDark: true });

  try {
    assert.equal(resolveTheme('system'), 'dark');
  } finally {
    dom.restore();
  }
});

test('applyDocumentTheme changes themes without forcing document layout or global transitions', () => {
  const dom = installDom();

  try {
    dom.root.classList.add('dark');
    Object.defineProperty(dom.root, 'offsetWidth', {
      configurable: true,
      get() {
        throw new Error('theme changes must not force synchronous document layout');
      },
    });

    applyDocumentTheme('light');

    assert.equal(dom.root.classList.contains('dark'), false);
    assert.equal(dom.root.classList.contains('theme-switching'), false);
  } finally {
    dom.restore();
  }
});
