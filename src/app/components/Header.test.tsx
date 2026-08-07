import test from 'node:test';
import assert from 'node:assert/strict';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Box } from 'lucide-react';

import { MANAGED_WINDOW_Z_INDEX_BASE } from '@/store/uiStore';
import { Header } from './Header.tsx';

const noopToolboxItems: import('./header/types').ToolboxItem[] = [];

function renderHeader() {
  return renderToStaticMarkup(
    React.createElement(Header, {
      onImportFile: () => {},
      onImportFolder: () => {},
      onOpenExport: () => {},
      onPrefetchExport: () => {},
      onExportProject: () => {},
      toolboxItems: noopToolboxItems,
      onOpenCodeViewer: () => {},
      onPrefetchCodeViewer: () => {},
      onOpenSettings: () => {},
      onPrefetchSettings: () => {},
      onSnapshot: () => {},
      onPrefetchSnapshot: () => {},
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

test('Header renders below managed floating windows', () => {
  const markup = renderHeader();

  // Managed floating windows intentionally cover the application header when
  // their bounds overlap it. Keep the header in an explicit lower stacking
  // context so every dynamically ordered window (220+) remains above it.
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
    zIndex < MANAGED_WINDOW_Z_INDEX_BASE,
    `header z-index (${zIndex}) must remain below the managed-window floor (${MANAGED_WINDOW_Z_INDEX_BASE})`,
  );
});

test('Header uses a slimmer top bar height', () => {
  const markup = renderHeader();

  assert.match(markup, /h-10/, 'header should keep a compact top bar height');
  assert.doesNotMatch(markup, /h-11/, 'header should no longer use the taller top bar height');
  assert.doesNotMatch(markup, /h-12/, 'header should no longer use the tallest top bar height');
});

test('Header links to the feedback form in a new tab', () => {
  const markup = renderHeader();

  const feedbackLink = markup.match(
    /<a[^>]*href="https:\/\/enkeebot\.feishu\.cn\/share\/base\/form\/shrcnok1dXPePgAxuu2qnXiVxYf"[^>]*>/,
  )?.[0];
  assert.ok(feedbackLink, 'header should render the feedback link');
  assert.match(feedbackLink, /target="_blank"/, 'feedback should open in a new tab');
  assert.match(
    feedbackLink,
    /rel="noopener noreferrer"/,
    'feedback link should isolate the opened tab',
  );
  assert.match(feedbackLink, /aria-label="Feedback"/);

  const feedbackLinkContent = markup.match(
    /<a[^>]*aria-label="Feedback"[^>]*>(.*?)<\/a>/,
  )?.[1];
  assert.ok(feedbackLinkContent, 'feedback link should render an icon and label');
  assert.match(
    feedbackLinkContent,
    />Feedback</,
    'feedback button should include a visible text label so its purpose is clear',
  );
});
