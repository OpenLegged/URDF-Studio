import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import {
  CheckboxOption,
  CollapsibleSection,
  OptionsPanel,
  OptionsPanelContainer,
  PanelOverlayToggleButton,
  ToggleSliderOption,
} from './OptionsPanel';

interface ListenerCall {
  type: string;
  listener: EventListenerOrEventListenerObject | null;
}

function trackEventListeners(target: EventTarget, trackedTypes: ReadonlySet<string>) {
  const added: ListenerCall[] = [];
  const removed: ListenerCall[] = [];
  const originalAddEventListener = target.addEventListener.bind(target);
  const originalRemoveEventListener = target.removeEventListener.bind(target);

  target.addEventListener = (type, listener, options) => {
    if (trackedTypes.has(type)) {
      added.push({ type, listener });
    }
    originalAddEventListener(type, listener, options);
  };
  target.removeEventListener = (type, listener, options) => {
    if (trackedTypes.has(type)) {
      removed.push({ type, listener });
    }
    originalRemoveEventListener(type, listener, options);
  };

  return {
    added,
    removed,
    restore() {
      target.addEventListener = originalAddEventListener;
      target.removeEventListener = originalRemoveEventListener;
    },
  };
}

function assertMatchingListenerRemoved(
  added: ListenerCall[],
  removed: ListenerCall[],
  type: string,
) {
  const addedCall = added.find((call) => call.type === type);
  assert.ok(addedCall, `${type} listener should be added`);
  assert.ok(
    removed.some((call) => call.type === type && call.listener === addedCall.listener),
    `${type} listener should be removed with the same callback`,
  );
}

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

test('OptionsPanel can transition from hidden to visible without changing hook order', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  const panelRef = createRef<HTMLDivElement>();

  try {
    await act(async () => {
      root.render(
        React.createElement(OptionsPanel, {
          title: 'Options',
          show: false,
          isCollapsed: false,
          onToggleCollapse: () => {},
          panelRef,
          children: React.createElement('div', null, 'content'),
        }),
      );
    });

    await act(async () => {
      root.render(
        React.createElement(OptionsPanel, {
          title: 'Options',
          show: true,
          isCollapsed: false,
          onToggleCollapse: () => {},
          panelRef,
          children: React.createElement('div', null, 'content'),
        }),
      );
    });

    assert.equal(container.textContent?.includes('content'), true);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('CollapsibleSection restores and persists its uncontrolled open state', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  dom.window.localStorage.setItem('collapse_state_rendering', 'false');

  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(CollapsibleSection, {
          title: 'Rendering',
          storageKey: 'rendering',
          children: React.createElement(
            'div',
            { 'data-testid': 'section-content' },
            'section content',
          ),
        }),
      );
    });

    const button = container.querySelector('button');
    assert.ok(button instanceof dom.window.HTMLButtonElement);
    const content = container.querySelector('[data-testid="section-content"]')?.parentElement
      ?.parentElement;
    assert.ok(content, 'collapsible content container should render');
    assert.ok(content.className.split(/\s+/).includes('max-h-0'));

    await act(async () => {
      button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    assert.ok(content.className.split(/\s+/).includes('max-h-[300px]'));
    assert.equal(dom.window.localStorage.getItem('collapse_state_rendering'), 'true');
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('OptionsPanelContainer removes active resize listeners when unmounted', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  const documentListeners = trackEventListeners(
    dom.window.document as unknown as EventTarget,
    new Set(['pointermove', 'pointerup', 'pointercancel']),
  );
  const windowListeners = trackEventListeners(
    dom.window as unknown as EventTarget,
    new Set(['blur']),
  );
  let rootUnmounted = false;

  try {
    await act(async () => {
      root.render(
        React.createElement(OptionsPanelContainer, {
          resizable: true,
          children: React.createElement('div', null, 'content'),
        }),
      );
    });

    const resizeHandle = container.querySelector<HTMLButtonElement>(
      '[data-testid="ui-options-panel-resize-corner"]',
    );
    assert.ok(resizeHandle, 'corner resize handle should render');
    const pointerDown = new dom.window.MouseEvent('pointerdown', {
      bubbles: true,
      clientX: 40,
      clientY: 50,
    });
    Object.defineProperty(pointerDown, 'pointerId', { value: 7 });

    await act(async () => {
      resizeHandle.dispatchEvent(pointerDown);
    });

    await act(async () => {
      root.unmount();
    });
    rootUnmounted = true;

    for (const type of ['pointermove', 'pointerup', 'pointercancel']) {
      assertMatchingListenerRemoved(documentListeners.added, documentListeners.removed, type);
    }
    assertMatchingListenerRemoved(windowListeners.added, windowListeners.removed, 'blur');
  } finally {
    documentListeners.restore();
    windowListeners.restore();
    if (!rootUnmounted) {
      await act(async () => {
        root.unmount();
      });
    }
    dom.window.close();
  }
});

test('OptionsPanel uses the shared floating window header dimensions', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  const panelRef = createRef<HTMLDivElement>();

  try {
    await act(async () => {
      root.render(
        React.createElement(OptionsPanel, {
          title: 'Options',
          show: true,
          isCollapsed: false,
          onToggleCollapse: () => {},
          panelRef,
          children: React.createElement('div', null, 'content'),
        }),
      );
    });

    const titleNode = Array.from(container.querySelectorAll<HTMLElement>('span')).find(
      (element) => element.textContent?.trim() === 'Options',
    );
    const header = titleNode?.closest<HTMLElement>('div.group');
    assert.ok(header, 'options panel header should render');
    assert.match(header.className, /\bh-10\b/);
    assert.match(header.className, /\bpx-2\b/);
    const titleClasses = titleNode?.className.split(/\s+/) ?? [];
    assert.ok(titleClasses.includes('text-ui-control'));
    assert.ok(titleClasses.includes('leading-4'));
    assert.equal(titleClasses.includes('leading-none'), false);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('OptionsPanel uses a slightly smaller shared corner radius by default', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  const panelRef = createRef<HTMLDivElement>();

  try {
    await act(async () => {
      root.render(
        React.createElement(OptionsPanel, {
          title: 'Options',
          show: true,
          isCollapsed: false,
          onToggleCollapse: () => {},
          panelRef,
          children: React.createElement('div', null, 'content'),
        }),
      );
    });

    const panelContainer = container.querySelector<HTMLElement>('.bg-panel-bg');
    assert.ok(panelContainer, 'options panel container should render');
    assert.match(panelContainer.className, /\brounded-lg\b/);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('OptionsPanel applies dynamic z-index and activates on pointer or keyboard focus', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  const panelRef = createRef<HTMLDivElement>();
  let activateCount = 0;

  try {
    await act(async () => {
      root.render(
        React.createElement(OptionsPanel, {
          title: 'Options',
          show: true,
          isCollapsed: false,
          onToggleCollapse: () => {},
          panelRef,
          zIndex: 231,
          onActivate: () => {
            activateCount += 1;
          },
          children: React.createElement('button', { type: 'button' }, 'Focusable'),
        }),
      );
    });

    const panelRoot = container.firstElementChild as HTMLDivElement | null;
    assert.ok(panelRoot, 'options panel should render');
    assert.equal(panelRoot.style.zIndex, '231');
    assert.equal(panelRoot.className.includes('z-231'), false);

    await act(async () => {
      panelRoot.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }));
    });
    assert.equal(activateCount, 1);

    const button = container.querySelector('button[type="button"]');
    assert.ok(button, 'focusable child should render');
    await act(async () => {
      button.dispatchEvent(new dom.window.Event('focusin', { bubbles: true }));
    });
    assert.equal(activateCount, 2);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('PanelOverlayToggleButton exposes a shared toolbar toggle contract', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  let clickCount = 0;

  try {
    await act(async () => {
      root.render(
        React.createElement(PanelOverlayToggleButton, {
          active: true,
          label: 'Always on top',
          onClick: () => {
            clickCount += 1;
          },
        }),
      );
    });

    const button = container.querySelector('button[aria-label="Always on top"]');
    assert.ok(button instanceof dom.window.HTMLButtonElement);
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.match(button.className, /\bbg-system-blue\/10\b/);
    assert.doesNotMatch(button.className, /slate/);

    await act(async () => {
      button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    assert.equal(clickCount, 1);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('CheckboxOption keeps panel option text vertically readable', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(CheckboxOption, {
          checked: true,
          label: 'Show visual',
          onChange: () => {},
        }),
      );
    });

    const labelText = Array.from(container.querySelectorAll<HTMLElement>('span')).find(
      (element) => element.textContent?.trim() === 'Show visual',
    );
    assert.ok(labelText, 'checkbox option text should render');
    const textClasses = labelText.className.split(/\s+/);
    assert.ok(textClasses.includes('leading-4'));
    assert.equal(textClasses.includes('leading-tight'), false);

    const contentRow = labelText.parentElement;
    assert.ok(contentRow instanceof dom.window.HTMLDivElement);
    const contentRowClasses = contentRow.className.split(/\s+/);
    assert.ok(contentRowClasses.includes('min-h-5'));
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('ToggleSliderOption centers the trailing overlay control in the option row', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(ToggleSliderOption, {
          checked: true,
          label: 'Show origin',
          onChange: () => {},
          trailingControl: React.createElement(PanelOverlayToggleButton, {
            active: false,
            label: 'Always on top',
            onClick: () => {},
          }),
        }),
      );
    });

    const button = container.querySelector('button[aria-label="Always on top"]');
    assert.ok(button instanceof dom.window.HTMLButtonElement);
    const row = button.closest('.flex.items-center.justify-between');
    assert.ok(row instanceof dom.window.HTMLDivElement);
    const checkboxWrapper = row.firstElementChild;
    assert.ok(checkboxWrapper instanceof dom.window.HTMLDivElement);
    assert.match(checkboxWrapper.className, /\bflex\b/);
    assert.match(checkboxWrapper.className, /\bitems-center\b/);
    const trailingWrapper = button.parentElement?.parentElement;
    assert.ok(trailingWrapper instanceof dom.window.HTMLDivElement);
    assert.match(trailingWrapper.className, /\bflex\b/);
    assert.match(trailingWrapper.className, /\bitems-center\b/);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});
