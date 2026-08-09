import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { usePressAndHoldRepeat } from './usePressAndHoldRepeat';

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
  (globalThis as { Node?: typeof Node }).Node = dom.window.Node;
  (globalThis as { Event?: typeof Event }).Event = dom.window.Event;
  (globalThis as { MouseEvent?: typeof MouseEvent }).MouseEvent = dom.window.MouseEvent;
  (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent =
    dom.window.PointerEvent ?? dom.window.MouseEvent;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  Object.defineProperty(dom.window.HTMLElement.prototype, 'setPointerCapture', {
    value: () => {},
    configurable: true,
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'releasePointerCapture', {
    value: () => {},
    configurable: true,
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'hasPointerCapture', {
    value: () => true,
    configurable: true,
  });

  return dom;
}

function createComponentRoot() {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container);
  return { dom, container, root: createRoot(container) };
}

async function destroyComponentRoot(dom: JSDOM, root: Root) {
  await act(async () => {
    root.unmount();
  });
  dom.window.close();
}

function RepeatButton({ onRepeat }: { onRepeat: (direction: 1 | -1) => void }) {
  const { repeatButtonProps } = usePressAndHoldRepeat(onRepeat, {
    repeatDelayMs: 5,
    repeatIntervalMs: 5,
  });

  return React.createElement(
    'button',
    repeatButtonProps(1, 'Increase value'),
    'Increase',
  );
}

async function waitForRepeatCount(repeats: number[], expectedCount: number) {
  const deadline = Date.now() + 500;
  while (repeats.length < expectedCount && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('usePressAndHoldRepeat invokes once on click and repeats only while pressed', async () => {
  const { dom, container, root } = createComponentRoot();
  const repeats: number[] = [];

  try {
    await act(async () => {
      root.render(React.createElement(RepeatButton, { onRepeat: (direction) => repeats.push(direction) }));
    });

    const button = container.querySelector('button');
    assert.ok(button);

    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    assert.deepEqual(repeats, [1]);

    await act(async () => {
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
      await waitForRepeatCount(repeats, 3);
    });
    assert.ok(repeats.length >= 3, 'expected pointer hold to repeat');

    await act(async () => {
      button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    });
    const stoppedAt = repeats.length;

    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(repeats.length, stoppedAt);
  } finally {
    await destroyComponentRoot(dom, root);
  }
});
