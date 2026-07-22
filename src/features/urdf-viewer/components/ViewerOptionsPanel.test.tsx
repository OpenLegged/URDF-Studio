import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { ViewerOptionsPanel } from './ViewerOptionsPanel';
import { useSelectionStore } from '@/store/selectionStore';
import { OverlayHoverBlockProvider } from '@/shared/hooks/useOverlayHoverBlock';

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

  return dom;
}

function createComponentRoot() {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  return { dom, container, root };
}

function resetSelectionStore() {
  const state = useSelectionStore.getState();
  state.setInteractionGuard(null);
  state.interactionHoverFreezeOwners.forEach((owner) => {
    useSelectionStore.getState().setHoverFrozen(owner, false);
  });
  while (useSelectionStore.getState().hoverBlockCount > 0) {
    useSelectionStore.getState().endHoverBlock();
  }
  state.clearHover();
  state.setHoveredSelection(null);
}

async function renderPanel(
  root: Root,
  readOnly: boolean,
  overrides: Partial<React.ComponentProps<typeof ViewerOptionsPanel>> = {},
) {
  const overlayHoverBlockActions = {
    beginHoverBlock: useSelectionStore.getState().beginHoverBlock,
    endHoverBlock: useSelectionStore.getState().endHoverBlock,
    clearHover: useSelectionStore.getState().clearHover,
  };

  await act(async () => {
    root.render(
      React.createElement(
        OverlayHoverBlockProvider,
        {
          value: overlayHoverBlockActions,
          children: React.createElement(ViewerOptionsPanel, {
            showOptionsPanel: true,
            optionsPanelRef: { current: null },
            optionsPanelPos: null,
            onMouseDown: () => {},
            t: {
              resize: 'Resize',
              viewOptions: 'View Options',
              showVisual: 'Show Visual',
              showCollision: 'Show Collision',
              showIkHandles: 'Show IK Handles',
              alwaysOnTop: 'Always on top',
              showOrigin: 'Show Origin',
              showMjcfSites: 'Show MJCF Sites',
              size: 'Size',
              showJointAxes: 'Show Joint Axes',
              showCenterOfMass: 'Show Center Of Mass',
              showInertia: 'Show Inertia',
              modelOpacity: 'Model Opacity',
              autoFitGround: 'Auto Fit Ground',
              groundPlaneOffset: 'Ground Offset',
              reset: 'Reset',
              expand: 'Expand',
              collapse: 'Collapse',
              close: 'Close',
            },
            isOptionsCollapsed: false,
            toggleOptionsCollapsed: () => {},
            showVisual: true,
            setShowVisual: () => {},
            showCollision: false,
            setShowCollision: () => {},
            showCollisionAlwaysOnTop: false,
            setShowCollisionAlwaysOnTop: () => {},
            modelOpacity: 0.5,
            setModelOpacity: () => {},
            showOrigins: false,
            setShowOrigins: () => {},
            showOriginsOverlay: false,
            setShowOriginsOverlay: () => {},
            originSize: 0.07,
            setOriginSize: () => {},
            showMjcfSiteToggle: false,
            showMjcfSites: false,
            setShowMjcfSites: () => {},
            showJointAxes: false,
            setShowJointAxes: () => {},
            showJointAxesOverlay: false,
            setShowJointAxesOverlay: () => {},
            jointAxisSize: 0.1,
            setJointAxisSize: () => {},
            showCenterOfMass: false,
            setShowCenterOfMass: () => {},
            showCoMOverlay: false,
            setShowCoMOverlay: () => {},
            centerOfMassSize: 0.01,
            setCenterOfMassSize: () => {},
            showInertia: false,
            setShowInertia: () => {},
            showInertiaOverlay: false,
            setShowInertiaOverlay: () => {},
            onAutoFitGround: () => {},
            groundPlaneOffset: 0.25,
            groundPlaneOffsetReadOnly: readOnly,
            setGroundPlaneOffset: () => {},
            ...overrides,
          }),
        },
      ),
    );
  });
}

function getOptionCheckbox(container: HTMLElement, labelText: string): HTMLInputElement {
  const label = Array.from(container.querySelectorAll('label')).find((candidate) =>
    candidate.textContent?.includes(labelText),
  );
  assert.ok(label, `${labelText} checkbox label should render`);

  const input = label.querySelector<HTMLInputElement>('input[type="checkbox"]');
  assert.ok(input, `${labelText} checkbox input should render`);
  return input;
}

function getOptionTrailingButton(
  container: HTMLElement,
  labelText: string,
  title: string,
): HTMLButtonElement {
  const input = getOptionCheckbox(container, labelText);
  const row = input.closest('label')?.parentElement?.parentElement;
  const button = row?.querySelector<HTMLButtonElement>(`button[aria-label="${title}"]`);
  assert.ok(button, `${labelText} trailing "${title}" button should render`);
  return button;
}

async function clickElement(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
}

async function clickSliderTrackAt(track: HTMLElement, clientX: number) {
  Object.defineProperty(track, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      bottom: 24,
      height: 24,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });

  await act(async () => {
    track.dispatchEvent(
      new MouseEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX,
      }),
    );
  });
}

test('ViewerOptionsPanel hides model opacity and ground plane detail controls', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root, true);

  assert.equal(container.textContent?.includes('Model Opacity'), false);
  assert.equal(container.textContent?.includes('Ground Offset'), false);
  assert.equal(container.textContent?.includes('Auto Fit Ground'), false);
  assert.equal(container.textContent?.includes('Reset'), false);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('ViewerOptionsPanel shows geometry and collision icons for the top toggles', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root, false);

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

test('viewer size sliders keep the full-width layout without indentation', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root, false, {
    showOrigins: true,
    showJointAxes: true,
  });

  const sliderTracks = Array.from(
    container.querySelectorAll<HTMLDivElement>('[data-testid="ui-slider-track"]'),
  );
  assert.ok(sliderTracks.length >= 2, 'viewer panel should render the enabled size sliders');

  const originWrapper = sliderTracks[0].parentElement?.parentElement
    ?.parentElement as HTMLDivElement | null;
  const jointAxisWrapper = sliderTracks[1].parentElement?.parentElement
    ?.parentElement as HTMLDivElement | null;

  assert.ok(originWrapper, 'origin size slider wrapper should render');
  assert.ok(jointAxisWrapper, 'joint axis size slider wrapper should render');
  assert.equal(/\bpl-(2\.5|4)\b/.test(originWrapper.className), false);
  assert.equal(/\bpl-(2\.5|4)\b/.test(jointAxisWrapper.className), false);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('ViewerOptionsPanel uses a slightly narrower default width', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root, false);

  const panelContainer = container.querySelector<HTMLElement>('.urdf-options-panel > div');
  assert.ok(panelContainer, 'viewer options panel container should render');
  assert.equal(panelContainer.style.width, '9.5rem');

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('ViewerOptionsPanel uses a slightly smaller corner radius', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root, false);

  const panelContainer = container.querySelector<HTMLElement>('.urdf-options-panel > div');
  assert.ok(panelContainer, 'viewer options panel container should render');
  assert.match(panelContainer.className, /\brounded-lg\b/);
  assert.doesNotMatch(panelContainer.className, /\brounded-xl\b/);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('ViewerOptionsPanel keeps its compact header bar', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root, false);

  const header = container.querySelector<HTMLElement>(
    '.urdf-options-panel > div > div:first-child',
  );
  assert.ok(header, 'viewer options panel header should render');
  assert.match(header.className, /!h-auto/);
  assert.match(header.className, /!px-1\.5/);
  assert.match(header.className, /!py-1/);
  const title = header.querySelector('span');
  assert.ok(title, 'viewer options panel title should render');
  assert.match(title.className, /!text-\[11px\]/);
  assert.match(title.className, /!text-text-secondary/);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('ViewerOptionsPanel keeps the same right-edge resize affordance as the joints panel', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root, false);

  const rightResizeHandle = container.querySelector<HTMLElement>(
    '[data-testid="ui-options-panel-resize-right"]',
  );
  assert.ok(rightResizeHandle, 'view options panel should render a right-edge resize handle');
  const rightResizeHandleClasses = rightResizeHandle.className.split(/\s+/);
  assert.equal(rightResizeHandle.className.includes('resize-edge-right'), true);
  assert.equal(rightResizeHandleClasses.includes('right-0'), false);
  assert.equal(rightResizeHandleClasses.includes('right-0.5'), false);
  assert.match(rightResizeHandle.className, /\bw-2\b/);
  assert.doesNotMatch(rightResizeHandle.className, /\bhover:bg-system-blue/);
  assert.match(
    rightResizeHandle.querySelector('span')?.className ?? '',
    /\bw-px\b/,
    'right-edge resize hover affordance should render as a thin inner line',
  );
  assert.equal(
    rightResizeHandle.querySelector('span')?.className.includes('resize-edge-line-right'),
    true,
  );

  const bottomResizeHandle = container.querySelector<HTMLElement>(
    '[data-testid="ui-options-panel-resize-bottom"]',
  );
  assert.ok(bottomResizeHandle, 'view options panel should keep the bottom resize handle');
  const bottomResizeHandleClasses = bottomResizeHandle.className.split(/\s+/);
  assert.equal(bottomResizeHandle.className.includes('resize-edge-bottom'), true);
  assert.equal(bottomResizeHandleClasses.includes('bottom-0'), false);
  assert.match(bottomResizeHandle.className, /\bh-1\.5\b/);
  assert.doesNotMatch(bottomResizeHandle.className, /\bhover:bg-system-blue/);
  assert.match(
    bottomResizeHandle.querySelector('span')?.className ?? '',
    /\bh-px\b/,
    'bottom resize hover affordance should render as a thin inner line',
  );
  assert.equal(
    bottomResizeHandle.querySelector('span')?.className.includes('resize-edge-line-bottom'),
    true,
  );
  assert.ok(
    container.querySelector('[data-testid="ui-options-panel-resize-corner"]'),
    'view options panel should keep the bottom-right resize handle',
  );

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('ViewerOptionsPanel wires every detail checkbox click to its setter', async () => {
  const { dom, container, root } = createComponentRoot();
  const calls: Array<[string, boolean]> = [];

  await renderPanel(root, false, {
    showMjcfSiteToggle: true,
    setShowVisual: (value) => calls.push(['visual', value]),
    setShowCollision: (value) => calls.push(['collision', value]),
    setShowMjcfSites: (value) => calls.push(['mjcfSites', value]),
    setShowOrigins: (value) => calls.push(['origin', value]),
    setShowJointAxes: (value) => calls.push(['jointAxes', value]),
    setShowCenterOfMass: (value) => calls.push(['centerOfMass', value]),
    setShowInertia: (value) => calls.push(['inertia', value]),
  });

  await clickElement(getOptionCheckbox(container, 'Show Visual'));
  await clickElement(getOptionCheckbox(container, 'Show Collision'));
  await clickElement(getOptionCheckbox(container, 'Show MJCF Sites'));
  await clickElement(getOptionCheckbox(container, 'Show Origin'));
  await clickElement(getOptionCheckbox(container, 'Show Joint Axes'));
  await clickElement(getOptionCheckbox(container, 'Show Center Of Mass'));
  await clickElement(getOptionCheckbox(container, 'Show Inertia'));

  assert.deepEqual(calls, [
    ['visual', false],
    ['collision', true],
    ['mjcfSites', true],
    ['origin', true],
    ['jointAxes', true],
    ['centerOfMass', true],
    ['inertia', true],
  ]);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('ViewerOptionsPanel wires every detail always-on-top click to its setter', async () => {
  const { dom, container, root } = createComponentRoot();
  const calls: Array<[string, boolean]> = [];

  await renderPanel(root, false, {
    showCollision: true,
    showOrigins: true,
    showJointAxes: true,
    showCenterOfMass: true,
    showInertia: true,
    setShowCollisionAlwaysOnTop: (value) => calls.push(['collisionOverlay', value]),
    setShowOriginsOverlay: (value) => calls.push(['originOverlay', value]),
    setShowJointAxesOverlay: (value) => calls.push(['jointAxesOverlay', value]),
    setShowCoMOverlay: (value) => calls.push(['centerOfMassOverlay', value]),
    setShowInertiaOverlay: (value) => calls.push(['inertiaOverlay', value]),
  });

  await clickElement(getOptionTrailingButton(container, 'Show Collision', 'Always on top'));
  await clickElement(getOptionTrailingButton(container, 'Show Origin', 'Always on top'));
  await clickElement(getOptionTrailingButton(container, 'Show Joint Axes', 'Always on top'));
  await clickElement(getOptionTrailingButton(container, 'Show Center Of Mass', 'Always on top'));
  await clickElement(getOptionTrailingButton(container, 'Show Inertia', 'Always on top'));

  assert.deepEqual(calls, [
    ['collisionOverlay', true],
    ['originOverlay', true],
    ['jointAxesOverlay', true],
    ['centerOfMassOverlay', true],
    ['inertiaOverlay', true],
  ]);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('ViewerOptionsPanel wires every detail size slider track click to its setter', async () => {
  const { dom, container, root } = createComponentRoot();
  const calls: Array<[string, number]> = [];

  await renderPanel(root, false, {
    showOrigins: true,
    showJointAxes: true,
    showCenterOfMass: true,
    setOriginSize: (value) => calls.push(['originSize', value]),
    setJointAxisSize: (value) => calls.push(['jointAxisSize', value]),
    setCenterOfMassSize: (value) => calls.push(['centerOfMassSize', value]),
  });

  const sliderTracks = Array.from(
    container.querySelectorAll<HTMLElement>('[data-testid="ui-slider-track"]'),
  );
  assert.equal(sliderTracks.length, 3, 'enabled detail size sliders should render');

  await clickSliderTrackAt(sliderTracks[0], 50);
  await clickSliderTrackAt(sliderTracks[1], 50);
  await clickSliderTrackAt(sliderTracks[2], 50);

  assert.deepEqual(calls, [
    ['originSize', 0.26],
    ['jointAxisSize', 1],
    ['centerOfMassSize', 0.055],
  ]);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('ViewerOptionsPanel header collapse and close controls remain clickable', async () => {
  const { dom, container, root } = createComponentRoot();
  const calls: Array<[string, boolean?]> = [];

  await renderPanel(root, false, {
    toggleOptionsCollapsed: () => calls.push(['collapse']),
    setShowOptionsPanel: (value) => calls.push(['visible', value]),
  });

  const collapseButton = container.querySelector<HTMLButtonElement>(
    '.urdf-options-panel button[aria-label="Collapse"]',
  );
  assert.ok(collapseButton, 'detail options collapse button should render');
  await clickElement(collapseButton);

  const closeButton = container.querySelector<HTMLButtonElement>(
    '.urdf-options-panel button[aria-label="Close"]',
  );
  assert.ok(closeButton, 'detail options close button should render');
  await clickElement(closeButton);

  assert.deepEqual(calls, [['collapse'], ['visible', false]]);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('ViewerOptionsPanel freezes shared hover while the pointer is over the panel surface', async () => {
  resetSelectionStore();

  const { dom, container, root } = createComponentRoot();
  useSelectionStore.getState().setHoveredSelection({
    entity: { type: 'link', componentId: 'component_1', entityId: 'base_link' },
  });

  await renderPanel(root, false);

  const panelRoot = container.querySelector('.urdf-options-panel') as HTMLDivElement | null;
  assert.ok(panelRoot, 'viewer options panel root should render');

  await act(async () => {
    panelRoot.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });

  let nextState = useSelectionStore.getState();
  assert.equal(nextState.hoverFrozen, true);
  assert.equal(nextState.hoveredSelection, null);

  await act(async () => {
    panelRoot.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
  });

  nextState = useSelectionStore.getState();
  assert.equal(nextState.hoverFrozen, false);
  assert.equal(nextState.hoveredSelection, null);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('ViewerOptionsPanel only shows the MJCF site toggle when the source is MJCF', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root, false, {
    showMjcfSiteToggle: false,
  });
  assert.equal(container.textContent?.includes('Show MJCF Sites'), false);

  await renderPanel(root, false, {
    showMjcfSiteToggle: true,
  });
  assert.equal(container.textContent?.includes('Show MJCF Sites'), true);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('ViewerOptionsPanel no longer renders the IK row', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root, false);

  assert.equal(container.textContent?.includes('Show IK Handles'), false);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});
