import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { Tooltip } from './Tooltip';
import { Dialog } from './Dialog';

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

  (globalThis as { Element?: typeof Element }).Element = dom.window.Element;
  (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement;
  (globalThis as { Node?: typeof Node }).Node = dom.window.Node;
  (globalThis as { Event?: typeof Event }).Event = dom.window.Event;
  (globalThis as { MouseEvent?: typeof MouseEvent }).MouseEvent = dom.window.MouseEvent;
  (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent =
    dom.window.PointerEvent ?? dom.window.MouseEvent;
  (globalThis as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle =
    dom.window.getComputedStyle.bind(dom.window);
  (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame =
    dom.window.requestAnimationFrame.bind(dom.window);
  (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame =
    dom.window.cancelAnimationFrame.bind(dom.window);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  return dom;
}

function mockRect(element: Element, rect: Partial<DOMRect>) {
  element.getBoundingClientRect = () =>
    ({
      bottom: rect.bottom ?? 0,
      height: rect.height ?? 0,
      left: rect.left ?? 0,
      right: rect.right ?? 0,
      top: rect.top ?? 0,
      width: rect.width ?? 0,
      x: rect.left ?? 0,
      y: rect.top ?? 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

test('dialog tooltips stay in their owning layer and unmount with the dialog', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container);
  const root = createRoot(container);

  function renderDialogs(childOpen: boolean) {
    return (
      <Dialog isOpen onClose={() => {}} title="Parent" closeLabel="Close parent" zIndexClassName="z-[1200]">
        <Dialog
          isOpen={childOpen}
          onClose={() => {}}
          title="Child"
          closeLabel="Close child"
          zIndexClassName="z-[1300]"
        >
          Child content
        </Dialog>
      </Dialog>
    );
  }

  async function hoverClose(title: string, label: string) {
    const dialog = dom.window.document.querySelector(`[role="dialog"][aria-label="${title}"]`);
    assert.ok(dialog);
    const trigger = dialog.querySelector(`button[aria-label="${label}"]:not([tabindex="-1"])`)?.parentElement;
    assert.ok(trigger);
    await act(async () => {
      trigger.dispatchEvent(new dom.window.MouseEvent('mouseenter', { bubbles: false }));
    });
    const tooltip = dom.window.document.querySelector('[role="tooltip"]');
    assert.ok(tooltip);
    assert.equal(tooltip.textContent, label);
    assert.equal(tooltip.parentElement, dialog);
    assert.equal(tooltip.closest('.overflow-hidden'), null);
  }

  try {
    await act(async () => { root.render(renderDialogs(true)); });
    await hoverClose('Child', 'Close child');
    await act(async () => { root.render(renderDialogs(false)); });
    assert.equal(dom.window.document.querySelector('[role="tooltip"]'), null);
    await hoverClose('Parent', 'Close parent');
  } finally {
    await act(async () => { root.unmount(); });
    assert.equal(dom.window.document.querySelector('[role="tooltip"]'), null);
    dom.window.close();
  }
});

test('activating a tooltip trigger dismisses its hint without swallowing the action', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container);
  const root = createRoot(container);
  let activations = 0;

  try {
    await act(async () => {
      root.render(
        <Tooltip content="Open external page">
          <button onClick={() => { activations += 1; }}>Open</button>
        </Tooltip>,
      );
    });
    const button = container.querySelector('button');
    const trigger = button?.parentElement;
    assert.ok(button);
    assert.ok(trigger);
    await act(async () => {
      trigger.dispatchEvent(new dom.window.MouseEvent('mouseenter', { bubbles: false }));
    });
    assert.ok(dom.window.document.querySelector('[role="tooltip"]'));
    await act(async () => { button.click(); });
    assert.equal(activations, 1);
    assert.equal(dom.window.document.querySelector('[role="tooltip"]'), null);
  } finally {
    await act(async () => { root.unmount(); });
    dom.window.close();
  }
});

test('Tooltip portals floating content outside clipped ancestors', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <div className="overflow-hidden">
          <Tooltip content="Portal hint" side="bottom">
            <button type="button">Trigger</button>
          </Tooltip>
        </div>,
      );
    });

    const trigger = container.querySelector('button')?.parentElement;
    assert.ok(trigger, 'tooltip reference wrapper should render');
    mockRect(trigger, {
      bottom: 76,
      height: 24,
      left: 100,
      right: 124,
      top: 52,
      width: 24,
    });

    await act(async () => {
      trigger.dispatchEvent(
        new dom.window.MouseEvent('mouseenter', {
          bubbles: false,
          relatedTarget: dom.window.document.body,
        }),
      );
      await Promise.resolve();
    });

    const tooltip = dom.window.document.body.querySelector<HTMLElement>('[role="tooltip"]');
    assert.ok(tooltip, 'tooltip should render when the trigger is hovered');
    assert.equal(tooltip.textContent, 'Portal hint');
    assert.equal(container.contains(tooltip), false);
    assert.equal(dom.window.document.body.contains(tooltip), true);
    assert.equal(tooltip.style.position, 'fixed');
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});
