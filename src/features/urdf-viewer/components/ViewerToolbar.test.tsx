import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { translations } from '@/shared/i18n';
import { ViewerToolbar } from './ViewerToolbar';

type TestRoot = {
  dom: JSDOM;
  container: HTMLDivElement;
  dockSlot: HTMLDivElement;
  bottomDockSlot: HTMLDivElement;
  root: Root;
};

function installDom() {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="app-root"></div><div id="viewer-toolbar-dock-slot"></div><div id="viewer-toolbar-bottom-dock"></div></body></html>',
    {
      url: 'http://localhost/',
      pretendToBeVisual: true,
    },
  );

  (globalThis as { window?: Window }).window = dom.window as unknown as Window;
  (globalThis as { document?: Document }).document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });

  (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement;
  (globalThis as { HTMLDivElement?: typeof HTMLDivElement }).HTMLDivElement =
    dom.window.HTMLDivElement;
  (globalThis as { Node?: typeof Node }).Node = dom.window.Node;
  (globalThis as { Event?: typeof Event }).Event = dom.window.Event;
  (globalThis as { MouseEvent?: typeof MouseEvent }).MouseEvent = dom.window.MouseEvent;
  (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame =
    dom.window.requestAnimationFrame.bind(dom.window);
  (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame =
    dom.window.cancelAnimationFrame.bind(dom.window);
  (globalThis as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle =
    dom.window.getComputedStyle.bind(dom.window);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  return dom;
}

function createComponentRoot(): TestRoot {
  const dom = installDom();
  const container = dom.window.document.getElementById('app-root') as HTMLDivElement | null;
  const dockSlot = dom.window.document.getElementById(
    'viewer-toolbar-dock-slot',
  ) as HTMLDivElement | null;
  const bottomDockSlot = dom.window.document.getElementById(
    'viewer-toolbar-bottom-dock',
  ) as HTMLDivElement | null;
  assert.ok(container, 'app root should exist');
  assert.ok(dockSlot, 'header dock slot should exist');
  assert.ok(bottomDockSlot, 'bottom dock slot should exist');
  const root = createRoot(container);
  return { dom, container, dockSlot, bottomDockSlot, root };
}

test('viewer toolbar stays fixed in the header slot without close or drag affordances', async () => {
  const { dom, dockSlot, root } = createComponentRoot();

  await act(async () => {
    root.render(<ViewerToolbar activeMode="select" setMode={() => {}} lang="en" />);
  });

  const toolbar = dockSlot.querySelector('.urdf-toolbar');
  assert.ok(toolbar, 'toolbar should render directly inside the header dock slot');
  assert.equal(toolbar?.querySelector('.drag-handle'), null);
  assert.match(toolbar.className, /\bpointer-events-auto\b/);
  assert.match(toolbar.className, /\bborder-x\b/);
  assert.doesNotMatch(toolbar.className, /\bborder-border-black\/70\b/);
  assert.doesNotMatch(toolbar.className, /\bbg-panel-bg\/85\b/);
  assert.doesNotMatch(toolbar.className, /\bshadow-sm\b/);
  assert.doesNotMatch(toolbar.className, /\bbackdrop-blur-sm\b/);
  assert.equal(
    toolbar?.querySelector(`button[aria-label="${translations.en.closeToolbar}"]`),
    null,
  );

  const activeButton = toolbar?.querySelector(
    `button[aria-label="${translations.en.selectMode}"]`,
  ) as HTMLButtonElement | null;
  assert.ok(activeButton, 'current mode button should render');
  assert.match(activeButton.className, /\bring-1\b/);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('viewer toolbar uses a horizontal touch lane for narrow-screen tools', async () => {
  const { dom, bottomDockSlot, root } = createComponentRoot();

  await act(async () => {
    root.render(<ViewerToolbar activeMode="select" setMode={() => {}} lang="en" />);
  });

  const scrollLane = bottomDockSlot.querySelector('.urdf-toolbar-scroll');
  assert.ok(scrollLane, 'bottom toolbar should render a scroll lane');
  assert.equal(scrollLane?.getAttribute('role'), 'toolbar');
  assert.match(scrollLane?.className ?? '', /\boverflow-x-auto\b/);
  assert.match(scrollLane?.className ?? '', /\boverscroll-x-contain\b/);
  assert.match(
    bottomDockSlot.querySelector('.urdf-toolbar-track')?.className ?? '',
    /\brounded-full\b/,
    'bottom tools should sit inside a rounded slider track',
  );
  assert.match(
    bottomDockSlot.querySelector('.urdf-toolbar-track')?.className ?? '',
    /\bw-max\b/,
    'bottom slider track should stay close to the tool content width',
  );
  assert.match(
    bottomDockSlot.querySelector('.urdf-toolbar-track')?.className ?? '',
    /\bbg-panel-bg\/25\b/,
    'bottom slider track should keep the viewer visibly transparent through the surface',
  );
  assert.match(
    bottomDockSlot.querySelector('.urdf-toolbar-track')?.className ?? '',
    /backdrop-blur-\[2px\]/,
    'bottom slider track should use only a light blur so the canvas remains legible',
  );

  const buttons = bottomDockSlot.querySelectorAll('[data-viewer-tool]');
  assert.equal(buttons.length, 6);
  assert.ok(
    Array.from(buttons).every((button) => button.className.includes('min-w-12')),
    'bottom tools should keep a fixed touch target width',
  );
  assert.match(
    bottomDockSlot.querySelector('[data-viewer-tool="select"]')?.className ?? '',
    /\brounded-full\b/,
    'active tool should use a pill-shaped selection state',
  );

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});
