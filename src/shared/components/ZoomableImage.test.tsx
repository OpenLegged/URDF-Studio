import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { ZoomableImage } from './ZoomableImage';

const LABELS = {
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  resetZoom: 'Reset zoom',
};

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
  (globalThis as { Event?: typeof Event }).Event = dom.window.Event;
  (globalThis as { MouseEvent?: typeof MouseEvent }).MouseEvent = dom.window.MouseEvent;
  (globalThis as { WheelEvent?: typeof WheelEvent }).WheelEvent = dom.window.WheelEvent;
  (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent = dom.window.PointerEvent;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  return dom;
}

function parseTransform(transform: string): { scale: number; x: number; y: number } {
  const match = transform.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/);
  assert.ok(match, `unexpected transform string: ${transform}`);
  return { x: Number(match[1]), y: Number(match[2]), scale: Number(match[3]) };
}

function queryImageTransform(dom: JSDOM): string {
  const image = dom.window.document.querySelector('img');
  assert.ok(image, 'expected the zoomable image to render');
  return image.style.transform;
}

function querySurface(dom: JSDOM): HTMLElement {
  const surface = dom.window.document.querySelector('[data-zoom-image-surface]');
  assert.ok(surface instanceof dom.window.HTMLElement, 'expected the zoom surface to render');
  return surface;
}

function pointerEvent(
  dom: JSDOM,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  options: { pointerId: number; clientX: number; clientY: number },
) {
  return new dom.window.PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerType: 'touch',
    ...options,
  });
}

async function renderZoomableImage(dom: JSDOM) {
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <ZoomableImage src="blob:poster" alt="poster" labels={LABELS} />,
    );
  });

  return {
    root,
    surface: querySurface(dom),
    getTransform: () => parseTransform(queryImageTransform(dom)),
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      dom.window.close();
    },
  };
}

test('ZoomableImage renders the image with zoom controls', async () => {
  const dom = installDom();

  try {
    const view = await renderZoomableImage(dom);

    const image = dom.window.document.querySelector('img');
    assert.ok(image, 'expected an image element');
    assert.equal(image.getAttribute('src'), 'blob:poster');
    assert.equal(image.getAttribute('alt'), 'poster');
    assert.equal(view.getTransform().scale, 1);

    const buttons = dom.window.document.querySelectorAll('button[aria-label]');
    assert.deepEqual(
      [...buttons].map((button) => button.getAttribute('aria-label')),
      [LABELS.zoomOut, LABELS.zoomIn, LABELS.resetZoom],
    );

    await view.cleanup();
  } catch (error) {
    dom.window.close();
    throw error;
  }
});

test('ZoomableImage zooms at the pointer with the wheel and resets at the minimum scale', async () => {
  const dom = installDom();

  try {
    const view = await renderZoomableImage(dom);

    await act(async () => {
      view.surface.dispatchEvent(
        new dom.window.WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 100,
          deltaY: -200,
        }),
      );
    });

    const zoomed = parseTransform(queryImageTransform(dom));
    assert.ok(zoomed.scale > 1.5, `wheel zoom should enlarge the image, got ${zoomed.scale}`);

    await act(async () => {
      view.surface.dispatchEvent(
        new dom.window.WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 100,
          deltaY: 10000,
        }),
      );
    });

    const clamped = parseTransform(queryImageTransform(dom));
    assert.equal(clamped.scale, 1);
    assert.equal(clamped.x, 0);
    assert.equal(clamped.y, 0);

    await view.cleanup();
  } catch (error) {
    dom.window.close();
    throw error;
  }
});

test('ZoomableImage normalizes Firefox line-mode wheel deltas to the same zoom step', async () => {
  const dom = installDom();

  try {
    const view = await renderZoomableImage(dom);

    // Firefox 每格滚轮报 3 行；Chrome/Windows 每格报 120 像素。
    await act(async () => {
      view.surface.dispatchEvent(
        new dom.window.WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 100,
          deltaY: -3,
          deltaMode: 1,
        }),
      );
    });
    const lineMode = parseTransform(queryImageTransform(dom));

    view.surface.dispatchEvent(
      new dom.window.WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 100,
        deltaY: 10000,
      }),
    );
    await act(async () => {
      view.surface.dispatchEvent(
        new dom.window.WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 100,
          deltaY: -120,
          deltaMode: 0,
        }),
      );
    });
    const pixelMode = parseTransform(queryImageTransform(dom));

    assert.ok(lineMode.scale > 1.2, `line-mode notch should zoom, got ${lineMode.scale}`);
    assert.ok(
      Math.abs(lineMode.scale - pixelMode.scale) < 1e-6,
      `3 lines and 120 pixels should zoom identically, got ${lineMode.scale} vs ${pixelMode.scale}`,
    );

    await view.cleanup();
  } catch (error) {
    dom.window.close();
    throw error;
  }
});

test('ZoomableImage amplifies ctrl+wheel trackpad pinch events', async () => {
  const dom = installDom();

  try {
    const view = await renderZoomableImage(dom);

    // Chrome/Edge 触控板捏合每帧 delta 很小且带 ctrlKey。
    await act(async () => {
      view.surface.dispatchEvent(
        new dom.window.WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 100,
          deltaY: -10,
          ctrlKey: true,
        }),
      );
    });
    const pinchWheel = parseTransform(queryImageTransform(dom));

    view.surface.dispatchEvent(
      new dom.window.WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 100,
        deltaY: 10000,
      }),
    );
    await act(async () => {
      view.surface.dispatchEvent(
        new dom.window.WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 100,
          deltaY: -10,
        }),
      );
    });
    const plainWheel = parseTransform(queryImageTransform(dom));

    assert.ok(pinchWheel.scale > 1.03, `ctrl+wheel should zoom noticeably, got ${pinchWheel.scale}`);
    assert.ok(
      pinchWheel.scale > plainWheel.scale,
      `ctrl+wheel should amplify small deltas, got ${pinchWheel.scale} vs ${plainWheel.scale}`,
    );

    await view.cleanup();
  } catch (error) {
    dom.window.close();
    throw error;
  }
});

test('ZoomableImage zooms with a two-finger pinch and follows the pinch anchor', async () => {
  const dom = installDom();

  try {
    const view = await renderZoomableImage(dom);

    await act(async () => {
      view.surface.dispatchEvent(
        pointerEvent(dom, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 }),
      );
      view.surface.dispatchEvent(
        pointerEvent(dom, 'pointerdown', { pointerId: 2, clientX: 200, clientY: 100 }),
      );
    });

    await act(async () => {
      view.surface.dispatchEvent(
        pointerEvent(dom, 'pointermove', { pointerId: 2, clientX: 400, clientY: 100 }),
      );
    });

    // 双指从相距 100px 张开到 300px，起始中点 (150,100)，终点中点 (250,100)
    const zoomed = parseTransform(queryImageTransform(dom));
    assert.ok(Math.abs(zoomed.scale - 3) < 1e-3, `pinch should scale to 3x, got ${zoomed.scale}`);
    assert.ok(Math.abs(zoomed.x - -200) < 1e-3, `pinch translate x should be -200, got ${zoomed.x}`);
    assert.ok(Math.abs(zoomed.y - -200) < 1e-3, `pinch translate y should be -200, got ${zoomed.y}`);

    await act(async () => {
      view.surface.dispatchEvent(
        pointerEvent(dom, 'pointermove', { pointerId: 2, clientX: 50, clientY: 100 }),
      );
    });

    const pinchedIn = parseTransform(queryImageTransform(dom));
    assert.equal(pinchedIn.scale, 1, 'pinching below the minimum scale should reset the viewport');
    assert.equal(pinchedIn.x, 0);
    assert.equal(pinchedIn.y, 0);

    await view.cleanup();
  } catch (error) {
    dom.window.close();
    throw error;
  }
});

test('ZoomableImage pans with a single pointer while zoomed in', async () => {
  const dom = installDom();

  try {
    const view = await renderZoomableImage(dom);

    await act(async () => {
      view.surface.dispatchEvent(
        new dom.window.MouseEvent('dblclick', {
          bubbles: true,
          cancelable: true,
          clientX: 0,
          clientY: 0,
        }),
      );
    });

    const zoomed = parseTransform(queryImageTransform(dom));
    assert.ok(zoomed.scale > 1, 'double click should zoom in');

    await act(async () => {
      view.surface.dispatchEvent(
        pointerEvent(dom, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 }),
      );
      view.surface.dispatchEvent(
        pointerEvent(dom, 'pointermove', { pointerId: 1, clientX: 140, clientY: 120 }),
      );
    });

    const panned = parseTransform(queryImageTransform(dom));
    assert.equal(panned.scale, zoomed.scale, 'pan should keep the zoom level');
    assert.ok(Math.abs(panned.x - (zoomed.x + 40)) < 1e-3, `pan x should shift by 40, got ${panned.x}`);
    assert.ok(Math.abs(panned.y - (zoomed.y + 20)) < 1e-3, `pan y should shift by 20, got ${panned.y}`);

    await view.cleanup();
  } catch (error) {
    dom.window.close();
    throw error;
  }
});

test('ZoomableImage toggles zoom with double click and restores the reset control', async () => {
  const dom = installDom();

  try {
    const view = await renderZoomableImage(dom);

    await act(async () => {
      view.surface.dispatchEvent(
        new dom.window.MouseEvent('dblclick', {
          bubbles: true,
          cancelable: true,
          clientX: 50,
          clientY: 50,
        }),
      );
    });

    const zoomed = parseTransform(queryImageTransform(dom));
    assert.ok(Math.abs(zoomed.scale - 2.5) < 1e-3, `double click should zoom to 2.5x, got ${zoomed.scale}`);

    const resetButton = dom.window.document.querySelector('button[aria-label="Reset zoom"]');
    assert.ok(resetButton, 'expected a reset zoom control');
    await act(async () => {
      resetButton.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });

    const reset = parseTransform(queryImageTransform(dom));
    assert.equal(reset.scale, 1);
    assert.equal(reset.x, 0);
    assert.equal(reset.y, 0);

    await view.cleanup();
  } catch (error) {
    dom.window.close();
    throw error;
  }
});
