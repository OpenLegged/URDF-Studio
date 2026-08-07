import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

import {
  ENKEEBOT_RELATED_PRODUCTS,
  renderContent,
  renderHead,
} from '../generate/seo_prerender.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXPECTED_HREFS = ENKEEBOT_RELATED_PRODUCTS.map((product) => product.url);

test('SEO prerender keeps EnkeeBot product links crawlable but outside the visible app UI', () => {
  for (const lang of ['en', 'zh']) {
    const contentDocument = new JSDOM(renderContent(lang)).window.document;
    const seoContainer = contentDocument.querySelector('.boot-seo');
    const anchors = [...contentDocument.querySelectorAll('.boot-seo nav a')];

    assert.equal(seoContainer?.getAttribute('aria-hidden'), 'true');
    assert.deepEqual(
      anchors.map((anchor) => anchor.getAttribute('href')),
      EXPECTED_HREFS,
    );
    assert.ok(anchors.every((anchor) => anchor.getAttribute('rel') === 'related'));
    assert.ok(anchors.every((anchor) => anchor.getAttribute('tabindex') === '-1'));

    const headDocument = new JSDOM(`<head>${renderHead(lang)}</head>`).window.document;
    const jsonLd = JSON.parse(
      headDocument.querySelector('script[type="application/ld+json"]')?.textContent ?? '{}',
    );
    assert.deepEqual(
      jsonLd.mentions.map((product) => product.url),
      EXPECTED_HREFS,
    );
  }

  const sourceTemplate = readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
  for (const href of EXPECTED_HREFS) {
    assert.ok(sourceTemplate.includes(`href="${href}"`));
  }
});
