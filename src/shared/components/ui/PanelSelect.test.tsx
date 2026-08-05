import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { PanelSelect } from './PanelSelect';

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });

  (globalThis as { window?: Window }).window = dom.window as unknown as Window;
  (globalThis as { document?: Document }).document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });

  (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement;
  (globalThis as { HTMLButtonElement?: typeof HTMLButtonElement }).HTMLButtonElement =
    dom.window.HTMLButtonElement;
  (globalThis as { HTMLSelectElement?: typeof HTMLSelectElement }).HTMLSelectElement =
    dom.window.HTMLSelectElement;
  (globalThis as { Node?: typeof Node }).Node = dom.window.Node;
  (globalThis as { Event?: typeof Event }).Event = dom.window.Event;
  (globalThis as { MouseEvent?: typeof MouseEvent }).MouseEvent = dom.window.MouseEvent;
  (globalThis as { KeyboardEvent?: typeof KeyboardEvent }).KeyboardEvent = dom.window.KeyboardEvent;
  (globalThis as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle =
    dom.window.getComputedStyle.bind(dom.window);
  (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame =
    dom.window.requestAnimationFrame.bind(dom.window);
  (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame =
    dom.window.cancelAnimationFrame.bind(dom.window);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  return dom;
}

test('PanelSelect exposes the shared panel select surface and keeps Select change semantics', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  let lastChangedValue = 'alpha';

  try {
    await act(async () => {
      root.render(
        React.createElement(PanelSelect, {
          'aria-label': 'Preset',
          options: [
            { value: 'alpha', label: 'Alpha' },
            { value: 'beta', label: 'Beta' },
          ],
          value: 'alpha',
          onChange: (event) => {
            lastChangedValue = event.currentTarget.value;
          },
        }),
      );
    });

    const trigger = container.querySelector('button[role="combobox"]');
    assert.ok(trigger instanceof dom.window.HTMLButtonElement);
    assert.match(trigger.className, /\bbg-panel-bg\b/);
    assert.match(trigger.className, /\bborder-border-black\b/);
    assert.match(trigger.className, /\btext-ui-label\b/);

    await act(async () => {
      trigger.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const betaOption = Array.from(
      dom.window.document.querySelectorAll('button[role="option"]'),
    ).find((node) => node.textContent?.includes('Beta'));
    assert.ok(betaOption instanceof dom.window.HTMLButtonElement);
    assert.match(betaOption.className, /\btext-ui-label\b/);

    await act(async () => {
      betaOption.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(lastChangedValue, 'beta');
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('PanelSelect property variant keeps dropdown option typography aligned with the trigger', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(PanelSelect, {
          'aria-label': 'Geometry type',
          variant: 'property',
          options: [
            { value: 'box', label: 'Box' },
            { value: 'mesh', label: 'Mesh' },
          ],
          value: 'box',
          onChange: () => {},
        }),
      );
    });

    const trigger = container.querySelector('button[role="combobox"]');
    assert.ok(trigger instanceof dom.window.HTMLButtonElement);
    assert.match(trigger.className, /\btext-ui-caption\b/);

    await act(async () => {
      trigger.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const listbox = dom.window.document.querySelector('[role="listbox"]');
    assert.ok(listbox, 'property variant should render a listbox portal');
    const menuSurface = listbox.parentElement;
    assert.ok(menuSurface, 'property variant listbox should stay inside a menu surface');
    assert.match(
      menuSurface.className,
      /z-\[340\]/,
      'property variant menu surface should render above high-z overlays',
    );
    assert.match(menuSurface.className, /\brounded-md\b/);
    assert.match(menuSurface.className, /\bborder-border-strong\b/);

    const meshOption = Array.from(
      dom.window.document.querySelectorAll('button[role="option"]'),
    ).find((node) => node.textContent?.includes('Mesh'));
    assert.ok(meshOption instanceof dom.window.HTMLButtonElement);
    assert.match(meshOption.className, /\btext-ui-caption\b/);
    assert.match(meshOption.className, /px-1\.5/);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('PanelSelect compact variant keeps dense dialog selectors aligned with dropdown options', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(PanelSelect, {
          'aria-label': 'Export format',
          variant: 'compact',
          options: [
            { value: 'png', label: 'PNG' },
            { value: 'jpeg', label: 'JPEG' },
          ],
          value: 'png',
          onChange: () => {},
        }),
      );
    });

    const trigger = container.querySelector('button[role="combobox"]');
    assert.ok(trigger instanceof dom.window.HTMLButtonElement);
    assert.match(trigger.className, /h-\[25px\]/);
    assert.match(trigger.className, /\btext-ui-label\b/);

    await act(async () => {
      trigger.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const jpegOption = Array.from(
      dom.window.document.querySelectorAll('button[role="option"]'),
    ).find((node) => node.textContent?.includes('JPEG'));
    assert.ok(jpegOption instanceof dom.window.HTMLButtonElement);
    assert.match(jpegOption.className, /\btext-ui-label\b/);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});
