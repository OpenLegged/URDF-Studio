import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { translations } from '@/shared/i18n';
import { UnifiedVisualizerOptionsPanel } from './UnifiedVisualizerOptionsPanel';

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
  Object.defineProperty(globalThis, 'localStorage', {
    value: dom.window.localStorage,
    configurable: true,
  });

  (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement;
  (globalThis as { HTMLInputElement?: typeof HTMLInputElement }).HTMLInputElement =
    dom.window.HTMLInputElement;
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
  Object.defineProperty(dom.window.HTMLElement.prototype, 'attachEvent', {
    value: () => {},
    configurable: true,
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'detachEvent', {
    value: () => {},
    configurable: true,
  });

  return dom;
}

function createComponentRoot() {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  return { dom, container, root };
}

function renderPanel(
  root: Root,
  overrides: Partial<React.ComponentProps<typeof UnifiedVisualizerOptionsPanel>> = {},
) {
  return act(async () => {
    root.render(
      React.createElement(UnifiedVisualizerOptionsPanel, {
        lang: 'zh',
        showVisual: true,
        setShowVisual: () => {},
        showOrigin: false,
        setShowOrigin: () => {},
        frameSize: 0.07,
        setFrameSize: () => {},
        showLabels: false,
        setShowLabels: () => {},
        labelScale: 1,
        setLabelScale: () => {},
        showJointAxes: false,
        setShowJointAxes: () => {},
        jointAxisSize: 0.35,
        setJointAxisSize: () => {},
        showCollision: false,
        setShowCollision: () => {},
        showCollisionAlwaysOnTop: false,
        setShowCollisionAlwaysOnTop: () => {},
        showInertia: false,
        setShowInertia: () => {},
        showCenterOfMass: false,
        setShowCenterOfMass: () => {},
        modelOpacity: 0.42,
        setModelOpacity: () => {},
        isCollapsed: false,
        toggleCollapsed: () => {},
        onMouseDown: () => {},
        onResetPosition: () => {},
        optionsPanelPos: null,
        groundPlaneOffset: 0,
        setGroundPlaneOffset: () => {},
        ...overrides,
      }),
    );
  });
}

test('visualizer options panel hides model opacity and ground alignment controls', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root);

  assert.equal(container.textContent?.includes('模型不透明度'), false);
  assert.equal(container.textContent?.includes('高度偏移'), false);
  assert.equal(container.textContent?.includes('自动适配'), false);
  assert.equal(container.textContent?.includes('重置'), false);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('visualizer options panel binds the top toggle to visual visibility', async () => {
  const { dom, container, root } = createComponentRoot();
  const visualVisibilityUpdates: boolean[] = [];
  const geometryToggleCalls = 0;

  await renderPanel(root, {
    setShowVisual: (nextValue) => {
      visualVisibilityUpdates.push(nextValue);
    },
  } as Partial<React.ComponentProps<typeof UnifiedVisualizerOptionsPanel>>);

  assert.match(container.textContent ?? '', /显示可视化/);

  const firstCheckbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
  assert.ok(firstCheckbox, 'top visual visibility checkbox should render');

  await act(async () => {
    firstCheckbox.click();
  });

  assert.deepEqual(visualVisibilityUpdates, [false]);
  assert.equal(geometryToggleCalls, 0);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('visualizer options panel shows geometry and collision icons for the top toggles', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root);

  assert.ok(
    container.querySelector('svg.lucide-shapes'),
    'show visual toggle should render a geometry icon',
  );
  assert.ok(
    container.querySelector('svg.lucide-shield'),
    'show collision toggle should render a collision icon',
  );

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('visualizer options panel only shows collision overlay toggle when collision display is enabled', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root, {
    showCollision: false,
  });

  assert.equal(container.querySelector(`[aria-label="${translations.zh.alwaysOnTop}"]`), null);

  await renderPanel(root, {
    showCollision: true,
  });

  assert.ok(container.querySelector(`[aria-label="${translations.zh.alwaysOnTop}"]`));

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('visualizer options panel toggles collision always-on-top state from the trailing control', async () => {
  const { dom, container, root } = createComponentRoot();
  const collisionOverlayUpdates: boolean[] = [];

  await renderPanel(root, {
    showCollision: true,
    setShowCollisionAlwaysOnTop: (nextValue) => {
      collisionOverlayUpdates.push(nextValue);
    },
  });

  const overlayToggle = container.querySelector<HTMLButtonElement>(
    `[aria-label="${translations.zh.alwaysOnTop}"]`,
  );
  assert.ok(overlayToggle, 'collision overlay toggle should render when collision display is on');

  await act(async () => {
    overlayToggle.click();
  });

  assert.deepEqual(collisionOverlayUpdates, [true]);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('visualizer options panel exposes always-on-top controls for enabled helper visualization rows', async () => {
  const { dom, container, root } = createComponentRoot();
  const overlayUpdates: Array<[string, boolean]> = [];

  await renderPanel(root, {
    showOrigin: true,
    setShowOriginOverlay: (nextValue) => {
      overlayUpdates.push(['origin', nextValue]);
    },
    showJointAxes: true,
    setShowJointAxesOverlay: (nextValue) => {
      overlayUpdates.push(['joint-axis', nextValue]);
    },
    showInertia: true,
    setShowInertiaOverlay: (nextValue) => {
      overlayUpdates.push(['inertia', nextValue]);
    },
    showCenterOfMass: true,
    setShowCoMOverlay: (nextValue) => {
      overlayUpdates.push(['center-of-mass', nextValue]);
    },
  });

  const overlayToggles = Array.from(
    container.querySelectorAll<HTMLButtonElement>(`[aria-label="${translations.zh.alwaysOnTop}"]`),
  );
  assert.equal(overlayToggles.length, 4);

  for (const toggle of overlayToggles) {
    await act(async () => {
      toggle.click();
    });
  }

  assert.deepEqual(overlayUpdates, [
    ['origin', true],
    ['joint-axis', true],
    ['inertia', true],
    ['center-of-mass', true],
  ]);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('visualizer options panel keeps only the enabled size sliders in the detail section', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root, {
    showOrigin: true,
    showJointAxes: true,
  });

  const sliderTracks = Array.from(
    container.querySelectorAll<HTMLDivElement>('[data-testid="ui-slider-track"]'),
  );
  assert.ok(sliderTracks.length >= 2, 'visualizer panel should render the enabled size sliders');

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('visualizer size sliders keep the same horizontal width without indentation', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root, {
    showOrigin: true,
    showJointAxes: true,
  });

  const sliderTracks = Array.from(
    container.querySelectorAll<HTMLDivElement>('[data-testid="ui-slider-track"]'),
  );
  assert.ok(sliderTracks.length >= 2, 'panel should render the enabled size sliders');

  const coordinateFrameWrapper = sliderTracks[0].parentElement?.parentElement
    ?.parentElement as HTMLDivElement | null;
  const jointAxisWrapper = sliderTracks[1].parentElement?.parentElement
    ?.parentElement as HTMLDivElement | null;

  assert.ok(coordinateFrameWrapper, 'coordinate frame size slider wrapper should render');
  assert.ok(jointAxisWrapper, 'joint axis size slider wrapper should render');
  assert.equal(/\bpl-(2\.5|4)\b/.test(coordinateFrameWrapper.className), false);
  assert.equal(/\bpl-(2\.5|4)\b/.test(jointAxisWrapper.className), false);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('visualizer options panel uses a narrower default width', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root);

  const panelContainer = container.querySelector<HTMLElement>(':scope > div > div');
  assert.ok(panelContainer, 'visualizer options panel container should render');
  assert.equal(panelContainer.style.width, '10rem');

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('visualizer options panel uses the shared floating window header bar', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root);

  const header = container.querySelector<HTMLElement>(':scope > div > div > div:first-child');
  assert.ok(header, 'visualizer options panel header should render');
  assert.match(header.className, /\bh-10\b/);
  assert.match(header.className, /\bpx-2\b/);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('visualizer view options keep the same right-edge resize affordance as the joints panel', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root);

  assert.ok(
    container.querySelector('[data-testid="ui-options-panel-resize-right"]'),
    'visualizer view options should render a right-edge resize handle',
  );
  assert.ok(
    container.querySelector('[data-testid="ui-options-panel-resize-bottom"]'),
    'visualizer view options should keep the bottom resize handle',
  );
  const cornerHandle = container.querySelector('[data-testid="ui-options-panel-resize-corner"]');
  assert.ok(cornerHandle, 'visualizer view options should keep the bottom-right resize handle');
  assert.ok(
    cornerHandle.querySelector('[data-testid="resize-corner-indicator"]'),
    'visualizer view options should reuse the shared corner resize indicator',
  );

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('visualizer options panel no longer renders IK handle toggle', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root);

  assert.equal(container.textContent?.includes(translations.zh.showIkHandles), false);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});
