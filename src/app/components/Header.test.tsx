import test from 'node:test';
import assert from 'node:assert/strict';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Box } from 'lucide-react';

import { Header } from './Header.tsx';

const noopToolboxItems: import('./header/types').ToolboxItem[] = [];

const surfaceModeSelector: import('./header/types').HeaderSurfaceModeSelectorConfig = {
  current: 'model',
  onChange: () => {},
  translations: {
    en: {
      ariaLabel: 'Workspace mode',
      model: { label: 'Model', description: 'Edit individual assets' },
      scene: { label: 'Scene', description: 'Arrange environment assets' },
    },
    zh: {
      ariaLabel: '工作模式',
      model: { label: '模型', description: '编辑独立资产' },
      scene: { label: '场景', description: '布置环境资产' },
    },
  },
};

function renderHeader(withSurfaceModeSelector = false) {
  return renderToStaticMarkup(
    React.createElement(Header, {
      onImportFile: () => {},
      onImportFolder: () => {},
      onOpenExport: () => {},
      onExportProject: () => {},
      toolboxItems: noopToolboxItems,
      onOpenCodeViewer: () => {},
      onPrefetchCodeViewer: () => {},
      onOpenSettings: () => {},
      onSnapshot: () => {},
      quickAction: {
        label: 'Quick action',
        icon: Box,
        onClick: () => {},
      },
      secondaryAction: {
        label: 'Secondary action',
        icon: Box,
        onClick: () => {},
      },
      surfaceModeSelector: withSurfaceModeSelector ? surfaceModeSelector : undefined,
      viewConfig: {
        showOptionsPanel: true,
        showJointPanel: true,
        showStructureGraph: false,
      },
      setViewConfig: () => {},
    }),
  );
}

test('Header keeps the leading logo at a readable non-shrinking size', () => {
  const markup = renderHeader();

  const logoTag = markup.match(/<img[^>]*src="\/logos\/logo\.png"[^>]*>/)?.[0];
  assert.ok(logoTag, 'header should render the leading brand logo');
  assert.match(logoTag, /h-7/, 'logo should keep a compact readable height');
  assert.match(logoTag, /w-7/, 'logo should keep a compact readable width');
  assert.match(logoTag, /shrink-0/, 'logo should not shrink when header content gets dense');
});

test('Header does not reserve empty center dock width when no toolbar is mounted', () => {
  const markup = renderHeader();

  assert.match(markup, /id="viewer-toolbar-dock-slot"/);
  assert.match(markup, /min-w-0/);
  assert.doesNotMatch(markup, /min-w-\[240px\]/);
});

test('Header renders above managed windows so its dropdowns stay clickable', () => {
  const markup = renderHeader();

  // The header element itself must establish a stacking context above the
  // managed-window layer (220-235). Without `relative` + a z-index >= 235,
  // dropdown panels (z-50) are stacked at the document root and get buried
  // under source-code/AI/settings windows.
  const headerTag = markup.match(/<header[^>]*>/)?.[0];
  assert.ok(headerTag, 'expected a <header> element');
  assert.match(headerTag, /relative/, 'header must be positioned to establish a stacking context');
  assert.match(
    headerTag,
    /z-\[(\d+)\]/,
    'header must carry an explicit z-index utility to own its layer',
  );
  const zIndexMatch = headerTag.match(/z-\[(\d+)\]/);
  assert.ok(zIndexMatch, 'header z-index utility should include a numeric value');
  const zIndex = Number(zIndexMatch[1]);
  assert.ok(
    zIndex > 235,
    `header z-index (${zIndex}) must exceed the managed-window ceiling (235) so dropdowns render above windows`,
  );
});

test('Header uses a slimmer top bar height', () => {
  const markup = renderHeader();

  assert.match(markup, /h-10/, 'header should keep a compact top bar height');
  assert.doesNotMatch(markup, /h-11/, 'header should no longer use the taller top bar height');
  assert.doesNotMatch(markup, /h-12/, 'header should no longer use the tallest top bar height');
});

test('Header places the optional surface mode selector after the logo and before File', () => {
  const markup = renderHeader(true);
  const logoIndex = markup.indexOf('src="/logos/logo.png"');
  const selectorIndex = markup.indexOf('aria-label="Workspace mode"');
  const fileIndex = markup.indexOf('aria-label="File"');

  assert.ok(logoIndex >= 0, 'expected the header logo');
  assert.ok(selectorIndex > logoIndex, 'surface mode selector should follow the logo');
  assert.ok(fileIndex > selectorIndex, 'File should follow the surface mode selector');
});
