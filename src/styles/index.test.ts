import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const css = readFileSync(path.join(process.cwd(), 'src/styles/index.css'), 'utf8');
const libraryCss = readFileSync(path.join(process.cwd(), 'src/lib/styles.css'), 'utf8');

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readThemeBlock(source: string, selector: string) {
  const match = source.match(
    new RegExp(`^\\s*${escapeRegExp(selector)} \\{([\\s\\S]*?)^\\s*\\}`, 'm'),
  );
  assert.ok(match, `expected ${selector} theme block to exist`);
  return match[1];
}

function readToken(block: string, token: string) {
  const match = block.match(new RegExp(`--ui-${token}:\\s*([^;]+);`));
  assert.ok(match, `expected --ui-${token} to be defined`);
  return match[1].trim();
}

test('global style theme exposes warning color tokens used by inspection notices', () => {
  for (const token of ['warning', 'warning-hover', 'warning-active', 'warning-soft', 'warning-border']) {
    assert.match(css, new RegExp(`--ui-${token}:`), `expected --ui-${token} to be defined`);
    assert.match(
      css,
      new RegExp(`--color-${token}: var\\(--ui-${token}\\);`),
      `expected --color-${token} to be exported through @theme`,
    );
  }
});

test('light and dark interaction surfaces keep hover and active states visible', () => {
  const stylesheets = [
    { name: 'app', source: css, selectors: [':root', '.dark'] },
    {
      name: 'library',
      source: libraryCss,
      selectors: ['.urdf-studio-canvas', '.urdf-studio-canvas.dark'],
    },
  ];

  for (const { name, source, selectors } of stylesheets) {
    for (const selector of selectors) {
      const block = readThemeBlock(source, selector);
      const panel = readToken(block, 'panel-bg');
      const element = readToken(block, 'surface');
      const hover = readToken(block, 'element-hover');
      const active = readToken(block, 'element-active');

      assert.notEqual(hover, panel, `${name} ${selector} hover must remain visible on panels`);
      assert.notEqual(hover, element, `${name} ${selector} hover must differ from resting elements`);
      assert.notEqual(active, hover, `${name} ${selector} active must be stronger than hover`);
    }

    const highContrastIndex = source.indexOf('@media (prefers-contrast: more)');
    assert.notEqual(highContrastIndex, -1, `${name} must define high-contrast interaction colors`);
    const highContrastCss = source.slice(highContrastIndex);
    for (const selector of selectors) {
      const block = readThemeBlock(highContrastCss, selector);
      assert.notEqual(
        readToken(block, 'element-hover'),
        readToken(block, 'element-active'),
        `${name} ${selector} high-contrast active must differ from hover`,
      );
    }

    assert.match(source, /--color-element-hover: var\(--ui-element-hover\);/);
    assert.match(source, /--color-element-active: var\(--ui-element-active\);/);
  }
});

test('Tailwind scans production sources without registering tests as CSS dependencies', () => {
  for (const [name, source] of [
    ['app', css],
    ['library', libraryCss],
  ] as const) {
    assert.match(source, /^@import 'tailwindcss' source\(none\);/m, `${name} disables root scanning`);
    assert.match(source, /^@source '\.\.\/\*\*\/\*\.\{ts,tsx\}';/m, `${name} scans src`);
    assert.match(
      source,
      /^@source not '\.\.\/\*\*\/\*\.\{test,spec\}\.\{ts,tsx\}';/m,
      `${name} excludes source-adjacent tests`,
    );
  }

  assert.match(css, /^@source '\.\.\/\.\.\/index\.html';/m);
});
