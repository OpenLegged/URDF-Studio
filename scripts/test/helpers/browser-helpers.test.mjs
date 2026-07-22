import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { resolveBrowserTestViteCacheDir } from './browser-helpers.mjs';

test('browser test servers use a stable cache isolated by site endpoint', () => {
  const defaultCacheDir = resolveBrowserTestViteCacheDir('http://127.0.0.1:4173');

  assert.equal(
    defaultCacheDir,
    path.resolve('tmp/vite-cache/browser/127.0.0.1-4173'),
  );
  assert.equal(
    resolveBrowserTestViteCacheDir('http://127.0.0.1:4174'),
    path.resolve('tmp/vite-cache/browser/127.0.0.1-4174'),
  );
});
