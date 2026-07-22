import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { SettingsModal } from './SettingsModal';
import { DEFAULT_MANAGED_WINDOW_ORDER, useUIStore } from '@/store';

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
  Object.defineProperty(globalThis, 'innerWidth', {
    value: dom.window.innerWidth,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'innerHeight', {
    value: dom.window.innerHeight,
    configurable: true,
  });

  (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement;
  (globalThis as { HTMLButtonElement?: typeof HTMLButtonElement }).HTMLButtonElement =
    dom.window.HTMLButtonElement;
  (globalThis as { HTMLDivElement?: typeof HTMLDivElement }).HTMLDivElement =
    dom.window.HTMLDivElement;
  (globalThis as { HTMLInputElement?: typeof HTMLInputElement }).HTMLInputElement =
    dom.window.HTMLInputElement;
  (globalThis as { HTMLSelectElement?: typeof HTMLSelectElement }).HTMLSelectElement =
    dom.window.HTMLSelectElement;
  (globalThis as { Node?: typeof Node }).Node = dom.window.Node;
  (globalThis as { Event?: typeof Event }).Event = dom.window.Event;
  (globalThis as { MouseEvent?: typeof MouseEvent }).MouseEvent = dom.window.MouseEvent;
  (globalThis as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle =
    dom.window.getComputedStyle.bind(dom.window);
  (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame =
    dom.window.requestAnimationFrame.bind(dom.window);
  (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame =
    dom.window.cancelAnimationFrame.bind(dom.window);
  (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = undefined;
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

test('SettingsModal removes drag listeners when unmounted mid-drag', async () => {
  const { dom, container, root } = createComponentRoot();
  const initialState = useUIStore.getState();

  const addedDocumentListeners = new Map<string, EventListenerOrEventListenerObject[]>();
  const removedDocumentListeners = new Map<string, EventListenerOrEventListenerObject[]>();
  const addedWindowListeners = new Map<string, EventListenerOrEventListenerObject[]>();
  const removedWindowListeners = new Map<string, EventListenerOrEventListenerObject[]>();

  const originalDocumentAdd = document.addEventListener.bind(document);
  const originalDocumentRemove = document.removeEventListener.bind(document);
  const originalWindowAdd = window.addEventListener.bind(window);
  const originalWindowRemove = window.removeEventListener.bind(window);

  document.addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ) => {
    const listeners = addedDocumentListeners.get(type) ?? [];
    listeners.push(listener);
    addedDocumentListeners.set(type, listeners);
    originalDocumentAdd(type, listener, options);
  }) as typeof document.addEventListener;

  document.removeEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: EventListenerOptions | boolean,
  ) => {
    const listeners = removedDocumentListeners.get(type) ?? [];
    listeners.push(listener);
    removedDocumentListeners.set(type, listeners);
    originalDocumentRemove(type, listener, options);
  }) as typeof document.removeEventListener;

  window.addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ) => {
    const listeners = addedWindowListeners.get(type) ?? [];
    listeners.push(listener);
    addedWindowListeners.set(type, listeners);
    originalWindowAdd(type, listener, options);
  }) as typeof window.addEventListener;

  window.removeEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: EventListenerOptions | boolean,
  ) => {
    const listeners = removedWindowListeners.get(type) ?? [];
    listeners.push(listener);
    removedWindowListeners.set(type, listeners);
    originalWindowRemove(type, listener, options);
  }) as typeof window.removeEventListener;

  try {
    useUIStore.setState({
      isSettingsOpen: true,
      settingsPos: { x: 48, y: 64 },
    });

    await act(async () => {
      root.render(React.createElement(SettingsModal));
    });

    const dragHandle = container.querySelector('[data-testid="settings-drag-handle"]');
    assert.ok(dragHandle, 'settings modal should render a draggable header');
    assert.match(dragHandle.className, /\bh-10\b/);
    const settingsFrame = dragHandle.parentElement?.parentElement;
    assert.ok(settingsFrame, 'settings modal should render a window frame');
    assert.match(settingsFrame.className, /\brounded-lg\b/);
    const settingsTitle = dragHandle.querySelector('h2');
    assert.ok(settingsTitle, 'settings modal should render its title');
    assert.equal(settingsTitle.className.includes('text-[13px]'), true);
    assert.equal(
      dragHandle.querySelector('h2 + p'),
      null,
      'settings modal header should omit the active page subtitle',
    );

    await act(async () => {
      dragHandle.dispatchEvent(
        new dom.window.MouseEvent('mousedown', {
          bubbles: true,
          clientX: 180,
          clientY: 160,
        }),
      );
    });

    const addedMoveHandler = addedDocumentListeners.get('mousemove')?.at(-1);
    const addedUpHandler = addedDocumentListeners.get('mouseup')?.at(-1);
    const addedBlurHandler = addedWindowListeners.get('blur')?.at(-1);

    assert.ok(addedMoveHandler, 'drag start should register a document mousemove listener');
    assert.ok(addedUpHandler, 'drag start should register a document mouseup listener');
    assert.ok(addedBlurHandler, 'drag start should register a window blur listener');

    await act(async () => {
      root.unmount();
    });

    assert.equal(
      removedDocumentListeners.get('mousemove')?.includes(addedMoveHandler) ?? false,
      true,
      'mousemove listener should be removed during unmount cleanup',
    );
    assert.equal(
      removedDocumentListeners.get('mouseup')?.includes(addedUpHandler) ?? false,
      true,
      'mouseup listener should be removed during unmount cleanup',
    );
    assert.equal(
      removedWindowListeners.get('blur')?.includes(addedBlurHandler) ?? false,
      true,
      'blur listener should be removed during unmount cleanup',
    );
  } finally {
    document.addEventListener = originalDocumentAdd;
    document.removeEventListener = originalDocumentRemove;
    window.addEventListener = originalWindowAdd;
    window.removeEventListener = originalWindowRemove;
    useUIStore.setState(initialState);
    dom.window.close();
  }
});

test('SettingsModal opens at the front and stays there when activated', async () => {
  const { dom, container, root } = createComponentRoot();
  const initialState = useUIStore.getState();

  try {
    useUIStore.setState({
      isSettingsOpen: true,
      settingsPos: { x: 48, y: 64 },
      managedWindowOrder: [...DEFAULT_MANAGED_WINDOW_ORDER],
    });

    await act(async () => {
      root.render(React.createElement(SettingsModal));
    });

    const panel = container.firstElementChild as HTMLDivElement | null;
    assert.ok(panel, 'settings modal should render');
    assert.equal(panel.className.includes('z-[100]'), false);
    assert.ok(
      useUIStore.getState().getManagedWindowZIndex('settings') >
        useUIStore.getState().getManagedWindowZIndex('sourceCode'),
      'an opened settings window should immediately move above source code',
    );

    await act(async () => {
      panel.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }));
    });

    assert.ok(
      useUIStore.getState().getManagedWindowZIndex('settings') >
        useUIStore.getState().getManagedWindowZIndex('sourceCode'),
      'activated settings modal should move above source code',
    );
    assert.equal(
      panel.style.zIndex,
      String(useUIStore.getState().getManagedWindowZIndex('settings')),
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    useUIStore.setState(initialState);
    dom.window.close();
  }
});

test('SettingsModal updates source code editor typography preferences', async () => {
  const { dom, container, root } = createComponentRoot();
  const initialState = useUIStore.getState();

  try {
    useUIStore.setState({
      isSettingsOpen: true,
      settingsPos: { x: 48, y: 64 },
      codeEditorFontFamily: 'jetbrains-mono',
      codeEditorFontSize: 13,
      codeEditorOpacity: 0.6,
    });

    await act(async () => {
      root.render(React.createElement(SettingsModal));
    });

    const sourceCodeButton = container.querySelector(
      '[data-settings-page="sourceCode"]',
    ) as HTMLButtonElement | null;
    assert.ok(sourceCodeButton, 'settings navigation should expose a source code page');

    await act(async () => {
      sourceCodeButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const fontFamilySelect = container.querySelector(
      '[data-testid="settings-code-editor-font-family"]',
    ) as HTMLSelectElement | null;
    assert.ok(fontFamilySelect, 'source code settings should render a font family select');

    await act(async () => {
      fontFamilySelect.value = 'fira-code';
      fontFamilySelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });

    const fontSizeInput = container.querySelector(
      '[data-testid="settings-code-editor-font-size"]',
    ) as HTMLInputElement | null;
    assert.ok(fontSizeInput, 'source code settings should render a font size input');
    const increaseButton = container.querySelector(
      '[data-testid="settings-code-editor-font-size-increase"]',
    ) as HTMLButtonElement | null;
    assert.ok(increaseButton, 'source code settings should render a font size increment button');

    await act(async () => {
      increaseButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      increaseButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const opacityInput = container.querySelector(
      '[data-testid="settings-code-editor-opacity"] [data-testid="ui-slider-input"]',
    ) as HTMLInputElement | null;
    assert.ok(opacityInput, 'source code settings should render an opacity slider');

    await act(async () => {
      opacityInput.value = '0.85';
      opacityInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });

    assert.equal(useUIStore.getState().codeEditorFontFamily, 'fira-code');
    assert.equal(useUIStore.getState().codeEditorFontSize, 14);
    assert.equal(useUIStore.getState().codeEditorOpacity, 0.85);
  } finally {
    await act(async () => {
      root.unmount();
    });
    useUIStore.setState(initialState);
    dom.window.close();
  }
});

test('SettingsModal keeps import warning on the original switch control and keeps segmented surfaces consistent', async () => {
  const { dom, container, root } = createComponentRoot();
  const initialState = useUIStore.getState();

  try {
    useUIStore.setState({
      isSettingsOpen: true,
      settingsPos: { x: 48, y: 64 },
      lang: 'en',
      theme: 'dark',
    });

    await act(async () => {
      root.render(React.createElement(SettingsModal));
    });

    const importWarningSwitch = container.querySelector(
      '[role="switch"]',
    ) as HTMLButtonElement | null;
    assert.ok(importWarningSwitch, 'general settings should render the original switch control');
    assert.equal(importWarningSwitch.getAttribute('aria-checked'), 'true');

    await act(async () => {
      importWarningSwitch.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(useUIStore.getState().showImportWarning, false);
    assert.equal(importWarningSwitch.getAttribute('aria-checked'), 'false');

    const englishButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'English',
    ) as HTMLButtonElement | undefined;
    assert.ok(englishButton, 'language segmented control should render the English option');
    assert.match(
      englishButton.className,
      /\bbg-segmented-active\b/,
      'selected language button should use the segmented active surface token',
    );

    const darkButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Dark',
    ) as HTMLButtonElement | undefined;
    assert.ok(darkButton, 'theme segmented control should render the dark option');
    assert.match(
      darkButton.className,
      /\bbg-segmented-active\b/,
      'selected theme button should use the segmented active surface token',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    useUIStore.setState(initialState);
    dom.window.close();
  }
});

test('SettingsModal keeps the detail pane scrollable within a bounded container', async () => {
  const { dom, container, root } = createComponentRoot();
  const initialState = useUIStore.getState();

  try {
    useUIStore.setState({
      isSettingsOpen: true,
      settingsPos: { x: 48, y: 64 },
    });

    await act(async () => {
      root.render(React.createElement(SettingsModal));
    });

    const detailPane = container.querySelector(
      '[data-testid="settings-detail-pane"]',
    ) as HTMLElement | null;
    assert.ok(detailPane, 'settings modal should render a bounded detail pane');
    assert.match(
      detailPane.className,
      /\bflex\b/,
      'detail pane should participate in flex layout so scrolling can be constrained',
    );
    assert.match(
      detailPane.className,
      /\bmin-h-0\b/,
      'detail pane should allow its scroll region to shrink within the modal height',
    );

    const scrollRegion = container.querySelector(
      '[data-testid="settings-detail-scroll"]',
    ) as HTMLElement | null;
    assert.ok(scrollRegion, 'settings modal should render a dedicated scroll region');
    assert.match(
      scrollRegion.className,
      /\bcustom-scrollbar\b/,
      'detail scroll region should opt into the shared custom scrollbar styling',
    );
    assert.match(
      scrollRegion.className,
      /\boverflow-y-auto\b/,
      'detail scroll region should expose vertical scrolling when content exceeds the modal height',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    useUIStore.setState(initialState);
    dom.window.close();
  }
});

test('SettingsModal toggles the MJCF world visibility preference from the view page', async () => {
  const { dom, container, root } = createComponentRoot();
  const initialState = useUIStore.getState();

  try {
    useUIStore.setState({
      isSettingsOpen: true,
      settingsPos: { x: 48, y: 64 },
      viewOptions: {
        ...initialState.viewOptions,
        showMjcfWorldLink: false,
      },
    });

    await act(async () => {
      root.render(React.createElement(SettingsModal));
    });

    const viewButton = container.querySelector(
      '[data-settings-page="view"]',
    ) as HTMLButtonElement | null;
    assert.ok(viewButton, 'settings navigation should expose a view page');

    await act(async () => {
      viewButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const switches = Array.from(container.querySelectorAll('[role="switch"]'));
    assert.ok(switches.length >= 3, 'view settings should render the expected toggle controls');

    const mjcfWorldSwitch = switches[1] as HTMLButtonElement;
    assert.equal(mjcfWorldSwitch.getAttribute('aria-checked'), 'false');

    await act(async () => {
      mjcfWorldSwitch.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.equal(useUIStore.getState().viewOptions.showMjcfWorldLink, true);
    assert.equal(mjcfWorldSwitch.getAttribute('aria-checked'), 'true');
  } finally {
    await act(async () => {
      root.unmount();
    });
    useUIStore.setState(initialState);
    dom.window.close();
  }
});
