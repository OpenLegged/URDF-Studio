import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { useAssetImportFromUrl } from './useAssetImportFromUrl';

test('an isolated workspace neither imports URL assets nor joins the editor channel', async () => {
  const dom = new JSDOM('<div id="root"></div>', {
    url: 'http://localhost/?import=robot&from=http://localhost:5001',
  });
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalChannel = globalThis.BroadcastChannel;
  let channels = 0;
  let imports = 0;
  class TestChannel {
    constructor() { channels++; }
    postMessage() {}
    close() {}
  }
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, BroadcastChannel: TestChannel });
  const root = createRoot(document.getElementById('root')!);
  function Harness() {
    useAssetImportFromUrl({ enabled: false, handleImport: async () => { imports++; return { status: 'completed' }; } });
    return null;
  }
  try {
    flushSync(() => root.render(React.createElement(Harness)));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(channels, 0);
    assert.equal(imports, 0);
    assert.ok(window.location.search.includes('import=robot'));
  } finally {
    flushSync(() => root.unmount());
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    Object.assign(globalThis, { window: originalWindow, document: originalDocument, BroadcastChannel: originalChannel });
    dom.window.close();
  }
});
