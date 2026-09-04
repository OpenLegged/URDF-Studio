import test from 'node:test';
import assert from 'node:assert/strict';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Box } from 'lucide-react';

import { MANAGED_WINDOW_Z_INDEX_BASE } from '@/store/uiStore';
import { Header, type HeaderProps } from './Header.tsx';

const noopToolboxItems: import('./header/types').ToolboxItem[] = [];

const surfaceModeSelector: import('./header/types').HeaderSurfaceModeSelectorConfig = {
  current: 'primary',
  onChange: () => {},
  translations: {
    en: {
      ariaLabel: 'Workspace mode',
      primary: { label: 'Primary', description: 'Use the primary workspace' },
      alternate: { label: 'Alternate', description: 'Use the host workspace' },
    },
    zh: {
      ariaLabel: '工作模式',
      primary: { label: '默认', description: '使用默认工作区' },
      alternate: { label: '扩展', description: '使用宿主工作区' },
    },
  },
};

function renderHeader(withSurfaceModeSelector = false, overrides: Partial<HeaderProps> = {}) {
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
      surfaceModeSelector: withSurfaceModeSelector ? surfaceModeSelector : undefined,
      viewConfig: {
        showOptionsPanel: true,
        showJointPanel: true,
        showStructureGraph: false,
      },
      setViewConfig: () => {},
      ...overrides,
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
  assert.match(markup, /id="alternate-workspace-toolbar-dock-slot"/);
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

test('Header places the optional surface mode selector after the logo and before File', () => {
  const markup = renderHeader(true);
  const logoIndex = markup.indexOf('src="/logos/logo.png"');
  const selectorIndex = markup.indexOf('aria-label="Workspace mode"');
  const fileIndex = markup.indexOf('aria-label="File"');

  assert.ok(logoIndex >= 0, 'expected the header logo');
  assert.ok(selectorIndex > logoIndex, 'surface mode selector should follow the logo');
  assert.ok(fileIndex > selectorIndex, 'File should follow the surface mode selector');
});

test('Header renders host-owned file actions for the alternate surface', () => {
  const markup = renderToStaticMarkup(
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
      surfaceModeSelector: {
        ...surfaceModeSelector,
        current: 'alternate',
      },
      contextFileMenu: {
        label: 'Host file',
        items: [{
          key: 'open-host-project',
          label: 'Open host project',
          onSelect: () => {},
        }],
      },
      viewConfig: {
        showOptionsPanel: true,
        showJointPanel: true,
        showStructureGraph: false,
      },
      setViewConfig: () => {},
    }),
  );

  assert.match(markup, /aria-label="Host file"/);
  assert.doesNotMatch(markup, /aria-label="File"/);
});

test('Header keeps the host quick action before the snapshot on alternate desktop surfaces', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

  try {
    for (const width of [1600, 1024, 640]) {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { innerWidth: width },
      });
      const markup = renderHeader(true, {
        surfaceModeSelector: {
          ...surfaceModeSelector,
          current: 'alternate',
          alternateControls: { snapshot: { onSnapshot: () => {} } },
        },
      });
      const quickAction = markup.match(
        /<button[^>]*aria-label="Quick action"[^>]*>(.*?)<\/button>/,
      )?.[1];
      assert.ok(quickAction, `host quick action should remain inline at ${width}px`);
      const secondaryAction = markup.match(
        /<button[^>]*aria-label="Secondary action"[^>]*>(.*?)<\/button>/,
      )?.[1];
      assert.ok(secondaryAction, `host secondary action should remain inline at ${width}px`);
      assert.ok(
        markup.indexOf('aria-label="Quick action"') < markup.indexOf('aria-label="Snapshot"'),
        'host quick action should occupy the same leading position in the right actions group',
      );
      if (width === 1600) {
        assert.match(quickAction, />Quick action</, 'roomy headers should display the action label');
        assert.match(secondaryAction, />Secondary action</, 'roomy headers should display the secondary label');
      } else {
        assert.doesNotMatch(secondaryAction, />Secondary action</, 'compact headers should hide the secondary label');
        assert.doesNotMatch(
          quickAction,
          />Quick action</,
          'compact headers should retain the icon without the label',
        );
      }
    }
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
});

test('Header renders host-owned view options and snapshot controls for the alternate surface', () => {
  const markup = renderToStaticMarkup(
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
      surfaceModeSelector: {
        ...surfaceModeSelector,
        current: 'alternate',
        alternateControls: {
          snapshot: { onSnapshot: () => {} },
          viewOptions: {
            visible: true,
            onVisibilityChange: () => {},
          },
        },
      },
      viewConfig: {
        showOptionsPanel: true,
        showJointPanel: true,
        showStructureGraph: false,
      },
      setViewConfig: () => {},
    }),
  );

  assert.match(markup, /aria-label="View"/);
  assert.match(markup, /aria-label="Snapshot"/);
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
