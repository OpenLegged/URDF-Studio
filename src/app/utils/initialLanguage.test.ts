import test from 'node:test';
import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';

import { getLanguageFromPath, hideSeoLanguagePathFromUserUrl } from './initialLanguage.ts';

test('getLanguageFromPath recognizes explicit English and Chinese path prefixes', () => {
  assert.equal(getLanguageFromPath('/zh/'), 'zh');
  assert.equal(getLanguageFromPath('/zh'), 'zh');
  assert.equal(getLanguageFromPath('/zh/?from=search'), 'zh');
  assert.equal(getLanguageFromPath('/en/'), 'en');
  assert.equal(getLanguageFromPath('/en'), 'en');
  assert.equal(getLanguageFromPath('/en/?from=search'), 'en');
  assert.equal(getLanguageFromPath('/'), null);
  assert.equal(getLanguageFromPath('/robots/zh/model'), null);
  assert.equal(getLanguageFromPath('/robots/en/model'), null);
});

test('hideSeoLanguagePathFromUserUrl normalizes direct Chinese SEO-page visits for the app', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://urdf.enkeebot.com/zh/?asset=go2#viewer',
  });
  const previousWindow = globalThis.window;

  (globalThis as { window?: Window }).window = dom.window as unknown as Window;

  try {
    hideSeoLanguagePathFromUserUrl();

    assert.equal(dom.window.location.pathname, '/');
    assert.equal(dom.window.location.search, '?asset=go2');
    assert.equal(dom.window.location.hash, '#viewer');
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: Window }).window;
    } else {
      (globalThis as { window?: Window }).window = previousWindow;
    }
    dom.window.close();
  }
});

test('hideSeoLanguagePathFromUserUrl normalizes direct English SEO-page visits for the app', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://urdf.enkeebot.com/en/?asset=go2#viewer',
  });
  const previousWindow = globalThis.window;

  (globalThis as { window?: Window }).window = dom.window as unknown as Window;

  try {
    hideSeoLanguagePathFromUserUrl();

    assert.equal(dom.window.location.pathname, '/');
    assert.equal(dom.window.location.search, '?asset=go2');
    assert.equal(dom.window.location.hash, '#viewer');
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: Window }).window;
    } else {
      (globalThis as { window?: Window }).window = previousWindow;
    }
    dom.window.close();
  }
});
