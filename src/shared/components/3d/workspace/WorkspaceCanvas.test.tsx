import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import {
  resolveWorkspaceCanvasResizeOptions,
  scheduleWorkspaceCanvasResizeEvent,
  WorkspaceCanvas,
} from './WorkspaceCanvas';

Object.defineProperty(import.meta, 'env', {
  value: {
    DEV: false,
  },
  configurable: true,
});

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
  (globalThis as { HTMLCanvasElement?: typeof HTMLCanvasElement }).HTMLCanvasElement =
    dom.window.HTMLCanvasElement;
  (globalThis as { HTMLDivElement?: typeof HTMLDivElement }).HTMLDivElement =
    dom.window.HTMLDivElement;
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

test('WorkspaceCanvas logs unsupported WebGL failures without rendering in-canvas error UI', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  const originalConsoleError = console.error;
  const consoleErrors: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    consoleErrors.push(args);
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(WorkspaceCanvas, {
          theme: 'light',
          lang: 'en',
          children: React.createElement('div', null, 'scene'),
        }),
      );
    });

    assert.equal(
      container.querySelector('[role="alert"]'),
      null,
      'unsupported WebGL should not render an in-canvas alert notice',
    );
    assert.equal(consoleErrors.length, 1, 'unsupported WebGL should still be reported to console');
    assert.match(
      String(consoleErrors[0]?.[0] ?? ''),
      /\[WorkspaceCanvas\] WebGL is unavailable; skipping 3D canvas rendering\./,
    );
    assert.match(String(consoleErrors[0]?.[1] ?? ''), /WebGL APIs are unavailable/);
  } finally {
    console.error = originalConsoleError;
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('WorkspaceCanvas keeps canvas resize responsive during sidebar drags', () => {
  const idleOptions = resolveWorkspaceCanvasResizeOptions(false);
  const dragOptions = resolveWorkspaceCanvasResizeOptions(true);

  assert.equal(idleOptions.debounce.resize, 120);
  assert.ok(
    dragOptions.debounce.resize <= idleOptions.debounce.resize,
    'active sidebar drag must not defer R3F resize long enough for WebGL to stretch',
  );
});

test('scheduleWorkspaceCanvasResizeEvent dispatches resize on the next animation frame', () => {
  let frameCallback: FrameRequestCallback | null = null as FrameRequestCallback | null;
  let dispatchedEventType: string | null = null as string | null;

  const frameId = scheduleWorkspaceCanvasResizeEvent({
    requestAnimationFrame: (callback) => {
      frameCallback = callback;
      return 12;
    },
    dispatchEvent: (event) => {
      dispatchedEventType = event.type;
      return true;
    },
  });

  assert.equal(frameId, 12);
  assert.equal(dispatchedEventType, null);
  assert.ok(frameCallback, 'resize should be scheduled after the current frame');

  frameCallback(100);

  assert.equal(dispatchedEventType, 'resize');
});

test('WorkspaceCanvas keeps a stationary press out of the interaction state until a real drag', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  const originalConsoleError = console.error;
  console.error = () => {
    // jsdom has no WebGL; the unsupported-WebGL report is expected and is
    // covered by the dedicated test above.
  };

  const dispatchPointer = (
    target: Element,
    type: string,
    init: { button?: number; buttons?: number; clientX?: number; clientY?: number } = {},
  ) => {
    target.dispatchEvent(
      new dom.window.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: init.button ?? 0,
        buttons: init.buttons ?? 0,
        clientX: init.clientX ?? 0,
        clientY: init.clientY ?? 0,
      }),
    );
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(WorkspaceCanvas, {
          theme: 'light',
          lang: 'en',
          children: React.createElement('div', null, 'scene'),
        }),
      );
    });

    const workspaceContainer = container.querySelector('[data-interacting]');
    assert.ok(workspaceContainer, 'workspace container should expose data-interacting');
    const readInteracting = () =>
      workspaceContainer instanceof dom.window.HTMLElement
        ? workspaceContainer.dataset.interacting
        : null;

    assert.equal(readInteracting(), 'false', 'workspace should start settled');

    await act(async () => {
      dispatchPointer(workspaceContainer, 'pointerdown', {
        button: 0,
        buttons: 1,
        clientX: 200,
        clientY: 200,
      });
    });
    assert.equal(
      readInteracting(),
      'false',
      'a stationary press must not engage the interaction render path',
    );

    await act(async () => {
      dispatchPointer(workspaceContainer, 'pointermove', {
        buttons: 1,
        clientX: 202,
        clientY: 200,
      });
    });
    assert.equal(
      readInteracting(),
      'false',
      'sub-threshold jitter while holding must not engage the interaction render path',
    );

    await act(async () => {
      dispatchPointer(workspaceContainer, 'pointermove', {
        buttons: 1,
        clientX: 210,
        clientY: 200,
      });
    });
    assert.equal(
      readInteracting(),
      'true',
      'dragging beyond the threshold should engage the interaction render path',
    );

    await act(async () => {
      dispatchPointer(workspaceContainer, 'pointerup', {
        button: 0,
        buttons: 0,
        clientX: 210,
        clientY: 200,
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    assert.equal(
      readInteracting(),
      'false',
      'releasing the pointer should settle the workspace after the recovery delay',
    );
  } finally {
    console.error = originalConsoleError;
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});
