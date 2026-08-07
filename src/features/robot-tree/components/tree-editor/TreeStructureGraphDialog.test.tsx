import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { translations } from '@/shared/i18n';
import { APP_HEADER_HEIGHT_PX } from '@/shared/hooks/useDraggableWindow';
import { useSelectionStore } from '@/store/selectionStore';
import type { AssemblyState, RobotData } from '@/types';
import { GeometryType, JointType } from '@/types';
import { TreeStructureGraphDialog } from './TreeStructureGraphDialog';

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
  (globalThis as { SVGElement?: typeof SVGElement }).SVGElement = dom.window.SVGElement;
  (globalThis as { HTMLButtonElement?: typeof HTMLButtonElement }).HTMLButtonElement =
    dom.window.HTMLButtonElement;
  (globalThis as { Node?: typeof Node }).Node = dom.window.Node;
  (globalThis as { Event?: typeof Event }).Event = dom.window.Event;
  (globalThis as { MouseEvent?: typeof MouseEvent }).MouseEvent = dom.window.MouseEvent;
  (globalThis as { WheelEvent?: typeof WheelEvent }).WheelEvent = dom.window.WheelEvent;
  (globalThis as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle =
    dom.window.getComputedStyle.bind(dom.window);
  (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame =
    dom.window.requestAnimationFrame.bind(dom.window);
  (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame =
    dom.window.cancelAnimationFrame.bind(dom.window);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  const ResizeObserverMock = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  Object.defineProperty(dom.window, 'ResizeObserver', {
    value: ResizeObserverMock,
    configurable: true,
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'getBoundingClientRect', {
    value() {
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 780,
        bottom: 520,
        width: 780,
        height: 520,
        toJSON: () => ({}),
      };
    },
    configurable: true,
  });

  return dom;
}

function createRobotData(): RobotData {
  const origin = { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } };
  const baseVisual = {
    type: GeometryType.BOX,
    dimensions: { x: 0.4, y: 0.3, z: 0.2 },
    color: '#ff0000',
    origin,
  };
  const childVisual = {
    type: GeometryType.BOX,
    dimensions: { x: 0.2, y: 0.2, z: 0.2 },
    color: '#00ff00',
    origin,
  };

  return {
    name: 'demo',
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: baseVisual,
        visualBodies: [],
        collision: baseVisual,
        collisionBodies: [],
      },
      child_link: {
        id: 'child_link',
        name: 'child_link',
        visible: true,
        visual: childVisual,
        visualBodies: [],
        collision: childVisual,
        collisionBodies: [],
      },
    },
    joints: {
      joint_1: {
        id: 'joint_1',
        name: 'joint_1',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'child_link',
        origin,
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: -1, upper: 1, effort: 10, velocity: 5 },
        dynamics: { damping: 0, friction: 0 },
        hardware: {
          armature: 0,
          motorType: '',
          motorId: '',
          motorDirection: 1,
        },
      },
    },
    rootLinkId: 'base_link',
  };
}

function createWorkspace(): AssemblyState {
  const robot = createRobotData();
  return {
    name: 'demo_workspace',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    components: {
      demo_component: {
        id: 'demo_component',
        name: 'demo',
        sourceFile: null,
        robot,
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { r: 0, p: 0, y: 0 },
        },
        visible: true,
      },
    },
    bridges: {},
  };
}

function resetSelectionStore() {
  const state = useSelectionStore.getState();
  state.setInteractionGuard(null);
  state.clearSelection();
  state.clearHover();
  while (useSelectionStore.getState().hoverBlockCount > 0) {
    useSelectionStore.getState().endHoverBlock();
  }
}

function TestStructureGraphHarness() {
  const workspace = useMemo(() => createWorkspace(), []);
  const [, forceParentRender] = useState(0);

  return (
    <TreeStructureGraphDialog
      isOpen
      workspace={workspace}
      activeComponentId="demo_component"
      t={translations.en}
      onClose={() => {}}
      onSelect={() => {
        forceParentRender((value) => value + 1);
      }}
    />
  );
}

async function renderStructureGraph(root: Root) {
  await act(async () => {
    root.render(<TestStructureGraphHarness />);
  });
}

function getRequiredElement<T extends Element>(container: Element | Document, selector: string): T {
  const element = container.querySelector<T>(selector);
  assert.ok(element, `${selector} should exist`);
  return element;
}

function getLayerTransform(container: Element | Document): string {
  return getRequiredElement<SVGGElement>(
    container,
    '[data-testid="structure-graph-layer"]',
  ).getAttribute('transform') ?? '';
}

function getScale(transform: string): number {
  const scaleMatch = /scale\(([^)]+)\)/.exec(transform);
  assert.ok(scaleMatch, `transform should include scale(): ${transform}`);
  return Number(scaleMatch[1]);
}

function getTranslate(transform: string): { x: number; y: number } {
  const translateMatch = /translate\(([^ ]+) ([^)]+)\)/.exec(transform);
  assert.ok(translateMatch, `transform should include translate(): ${transform}`);
  return {
    x: Number(translateMatch[1]),
    y: Number(translateMatch[2]),
  };
}

test('TreeStructureGraphDialog keeps zoom after selecting a node', async () => {
  resetSelectionStore();
  const dom = installDom();
  const container = getRequiredElement<HTMLDivElement>(dom.window.document, '#root');
  const root = createRoot(container);

  try {
    await renderStructureGraph(root);

    const surface = getRequiredElement<HTMLDivElement>(
      dom.window.document,
      '[data-testid="structure-graph-surface"]',
    );

    await act(async () => {
      surface.dispatchEvent(
        new dom.window.WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: 390,
          clientY: 260,
          deltaY: -120,
        }),
      );
    });

    const zoomedTransform = getLayerTransform(dom.window.document);
    assert.ok(getScale(zoomedTransform) > 1.45, 'mouse wheel zoom should be responsive');

    const graphNode = getRequiredElement<SVGGElement>(
      dom.window.document,
      '[data-structure-graph-node]',
    );
    await act(async () => {
      graphNode.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });

    assert.equal(getLayerTransform(dom.window.document), zoomedTransform);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
    resetSelectionStore();
  }
});

test('TreeStructureGraphDialog clears selection on blank click without clearing during pan', async () => {
  resetSelectionStore();
  const dom = installDom();
  const container = getRequiredElement<HTMLDivElement>(dom.window.document, '#root');
  const root = createRoot(container);

  try {
    await renderStructureGraph(root);

    const graphNode = getRequiredElement<SVGGElement>(
      dom.window.document,
      '[data-structure-graph-node]',
    );
    const surface = getRequiredElement<HTMLDivElement>(
      dom.window.document,
      '[data-testid="structure-graph-surface"]',
    );

    await act(async () => {
      graphNode.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });

    const selectedGraphEntity = useSelectionStore.getState().selection?.entity;
    assert.equal(selectedGraphEntity?.type, 'link');
    assert.equal(
      selectedGraphEntity?.type === 'link'
        ? selectedGraphEntity.componentId
        : null,
      'demo_component',
    );

    await act(async () => {
      surface.dispatchEvent(
        new dom.window.MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 20,
          clientY: 20,
        }),
      );
    });
    await act(async () => {
      dom.window.document.dispatchEvent(
        new dom.window.MouseEvent('mousemove', {
          bubbles: true,
          cancelable: true,
          clientX: 80,
          clientY: 72,
        }),
      );
      dom.window.document.dispatchEvent(
        new dom.window.MouseEvent('mouseup', { bubbles: true, cancelable: true }),
      );
    });

    assert.equal(useSelectionStore.getState().selection?.entity.type, 'link');

    await act(async () => {
      surface.dispatchEvent(
        new dom.window.MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 24,
          clientY: 24,
        }),
      );
    });
    await act(async () => {
      dom.window.document.dispatchEvent(
        new dom.window.MouseEvent('mouseup', { bubbles: true, cancelable: true }),
      );
    });

    assert.equal(useSelectionStore.getState().selection, null);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
    resetSelectionStore();
  }
});

test('TreeStructureGraphDialog pans on trackpad scroll and zooms on trackpad pinch', async () => {
  resetSelectionStore();
  const dom = installDom();
  const container = getRequiredElement<HTMLDivElement>(dom.window.document, '#root');
  const root = createRoot(container);

  try {
    await renderStructureGraph(root);

    const surface = getRequiredElement<HTMLDivElement>(
      dom.window.document,
      '[data-testid="structure-graph-surface"]',
    );
    const initialTransform = getLayerTransform(dom.window.document);
    const initialScale = getScale(initialTransform);
    const initialTranslate = getTranslate(initialTransform);

    await act(async () => {
      surface.dispatchEvent(
        new dom.window.WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: 390,
          clientY: 260,
          deltaX: 18,
          deltaY: 24,
        }),
      );
    });

    const pannedTransform = getLayerTransform(dom.window.document);
    const pannedTranslate = getTranslate(pannedTransform);
    assert.equal(getScale(pannedTransform), initialScale);
    assert.equal(pannedTranslate.x, initialTranslate.x - 18);
    assert.equal(pannedTranslate.y, initialTranslate.y - 24);

    await act(async () => {
      surface.dispatchEvent(
        new dom.window.WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: 390,
          clientY: 260,
          ctrlKey: true,
          deltaY: -24,
        }),
      );
    });

    assert.ok(getScale(getLayerTransform(dom.window.document)) > initialScale * 1.05);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
    resetSelectionStore();
  }
});

test('TreeStructureGraphDialog exposes maximize and only uses grab cursor while panning', async () => {
  resetSelectionStore();
  const dom = installDom();
  const container = getRequiredElement<HTMLDivElement>(dom.window.document, '#root');
  const root = createRoot(container);

  try {
    await renderStructureGraph(root);

    const maximizeButton = getRequiredElement<HTMLButtonElement>(
      dom.window.document,
      `button[aria-label="${translations.en.maximize}"]`,
    );

    await act(async () => {
      maximizeButton.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });

    const dialog = getRequiredElement<HTMLDivElement>(
      dom.window.document,
      `[role="dialog"][aria-label="${translations.en.structureGraphTitle}"]`,
    );
    assert.equal(dialog.parentElement, dom.window.document.body);
    assert.equal(dialog.className.includes('z-[240]'), false);
    assert.notEqual(dialog.style.zIndex, '');
    assert.equal(dialog.style.width, '100%');
    assert.equal(dialog.style.height, `calc(100% - ${APP_HEADER_HEIGHT_PX}px)`);

    const surface = getRequiredElement<HTMLDivElement>(
      dom.window.document,
      '[data-testid="structure-graph-surface"]',
    );
    assert.match(surface.className, /cursor-default/);

    await act(async () => {
      surface.dispatchEvent(
        new dom.window.MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 20,
          clientY: 20,
        }),
      );
    });

    assert.match(surface.className, /cursor-grabbing/);
    assert.equal(dom.window.document.body.style.cursor, 'grabbing');

    await act(async () => {
      dom.window.document.dispatchEvent(
        new dom.window.MouseEvent('mouseup', { bubbles: true, cancelable: true }),
      );
    });

    assert.match(surface.className, /cursor-default/);
    assert.equal(dom.window.document.body.style.cursor, '');
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
    resetSelectionStore();
  }
});
