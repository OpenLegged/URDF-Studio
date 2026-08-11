import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';

import { SurfaceModeSelector } from './SurfaceModeSelector.tsx';
import type {
  HeaderSurfaceMode,
  HeaderSurfaceModeSelectorConfig,
  HeaderSurfaceModeSelectorCopy,
} from './types.ts';

const translations: HeaderSurfaceModeSelectorConfig['translations'] = {
  en: {
    ariaLabel: 'Workspace mode',
    primary: {
      label: 'Primary',
      description: 'Use the primary workspace',
    },
    alternate: {
      label: 'Alternate',
      description: 'Use the host workspace',
    },
  },
  zh: {
    ariaLabel: '工作模式',
    primary: {
      label: '默认',
      description: '使用默认工作区',
    },
    alternate: {
      label: '扩展',
      description: '使用宿主工作区',
    },
  },
};

function renderSelector(copy: HeaderSurfaceModeSelectorCopy) {
  return renderToStaticMarkup(
    <SurfaceModeSelector
      config={{ current: 'primary', onChange: () => {}, translations }}
      copy={copy}
      closeLabel="Close"
      isOpen
      onOpenChange={() => {}}
    />,
  );
}

function installDomEnvironment() {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalSVGElement = globalThis.SVGElement;
  const originalNode = globalThis.Node;
  const originalActEnvironment = (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT;
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
  });

  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    SVGElement: dom.window.SVGElement,
    Node: dom.window.Node,
  });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    writable: true,
    value: true,
  });

  return {
    dom,
    restore() {
      dom.window.close();
      Object.assign(globalThis, {
        window: originalWindow,
        document: originalDocument,
        HTMLElement: originalHTMLElement,
        SVGElement: originalSVGElement,
        Node: originalNode,
      });
      if (originalActEnvironment === undefined) {
        delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
      } else {
        Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
          configurable: true,
          writable: true,
          value: originalActEnvironment,
        });
      }
    },
  };
}

async function mountSelector(onModeChange: (mode: HeaderSurfaceMode) => void) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  function Harness() {
    const [current, setCurrent] = React.useState<HeaderSurfaceMode>('primary');
    const [isOpen, setIsOpen] = React.useState(false);
    const config: HeaderSurfaceModeSelectorConfig = {
      current,
      translations,
      onChange: (mode) => {
        onModeChange(mode);
        setCurrent(mode);
      },
    };

    return (
      <SurfaceModeSelector
        config={config}
        copy={translations.en}
        closeLabel="Close"
        isOpen={isOpen}
        onOpenChange={setIsOpen}
      />
    );
  }

  await act(async () => {
    root.render(<Harness />);
  });

  return {
    container,
    async cleanup() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

test('renders localized labels and exposes the current mode as a checked menu item', () => {
  const markup = renderSelector(translations.zh);
  const dom = new JSDOM(`<body>${markup}</body>`);
  const menuItems = Array.from(
    dom.window.document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
  );

  assert.match(markup, /工作模式/);
  assert.match(markup, /使用默认工作区/);
  assert.match(markup, /使用宿主工作区/);
  assert.equal(menuItems.length, 2);
  assert.equal(menuItems[0]?.getAttribute('aria-checked'), 'true');
  assert.equal(menuItems[1]?.getAttribute('aria-checked'), 'false');
});

test('supports focus movement, selection, Escape, and outside-click dismissal', async () => {
  const domEnvironment = installDomEnvironment();
  const changes: HeaderSurfaceMode[] = [];
  const mounted = await mountSelector((mode) => changes.push(mode));

  try {
    const trigger = mounted.container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
    assert.ok(trigger);

    await act(async () => trigger.click());
    let menuItems = Array.from(
      mounted.container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    );
    assert.equal(document.activeElement, menuItems[0]);

    await act(async () => {
      menuItems[0]?.dispatchEvent(
        new domEnvironment.dom.window.KeyboardEvent('keydown', {
          key: 'ArrowDown',
          bubbles: true,
        }),
      );
    });
    assert.equal(document.activeElement, menuItems[1]);

    await act(async () => menuItems[1]?.click());
    assert.deepEqual(changes, ['alternate']);
    assert.equal(mounted.container.querySelector('[role="menu"]'), null);
    assert.equal(document.activeElement, trigger);
    assert.match(trigger.textContent ?? '', /Alternate/);

    await act(async () => trigger.click());
    menuItems = Array.from(
      mounted.container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    );
    assert.equal(document.activeElement, menuItems[1]);
    await act(async () => {
      menuItems[1]?.dispatchEvent(
        new domEnvironment.dom.window.KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
        }),
      );
    });
    assert.equal(mounted.container.querySelector('[role="menu"]'), null);
    assert.equal(document.activeElement, trigger);

    await act(async () => trigger.click());
    const outsideOverlay = mounted.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Close"]',
    );
    assert.ok(outsideOverlay);
    await act(async () => outsideOverlay.click());
    assert.equal(mounted.container.querySelector('[role="menu"]'), null);
  } finally {
    await mounted.cleanup();
    domEnvironment.restore();
  }
});
