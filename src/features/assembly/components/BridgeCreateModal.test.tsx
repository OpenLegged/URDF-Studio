import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { GeometryType, JointType, type AssemblyState } from '@/types';
import { useJointPickSessionStore, type PickedSnapFrame } from '@/store/jointPickSessionStore';
import { useSelectionStore } from '@/store/selectionStore';
import { useWorkspaceStore } from '@/store/workspaceStore';

import { BridgeCreateModal } from './BridgeCreateModal.tsx';
import type { BridgeCreateModalProps } from './BridgeCreateModal.tsx';

function assertNearlyEqual(actual: number, expected: number, message?: string) {
  assert.ok(Math.abs(actual - expected) < 1e-6, message ?? `${actual} !== ${expected}`);
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
  (globalThis as { HTMLInputElement?: typeof HTMLInputElement }).HTMLInputElement =
    dom.window.HTMLInputElement;
  (globalThis as { HTMLSelectElement?: typeof HTMLSelectElement }).HTMLSelectElement =
    dom.window.HTMLSelectElement;
  (globalThis as { Node?: typeof Node }).Node = dom.window.Node;
  (globalThis as { Event?: typeof Event }).Event = dom.window.Event;
  (globalThis as { MouseEvent?: typeof MouseEvent }).MouseEvent = dom.window.MouseEvent;
  (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent =
    dom.window.PointerEvent ?? dom.window.MouseEvent;
  (globalThis as { KeyboardEvent?: typeof KeyboardEvent }).KeyboardEvent = dom.window.KeyboardEvent;
  (globalThis as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle =
    dom.window.getComputedStyle.bind(dom.window);
  (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame =
    dom.window.requestAnimationFrame.bind(dom.window);
  (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame =
    dom.window.cancelAnimationFrame.bind(dom.window);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  if (!('attachEvent' in dom.window.HTMLElement.prototype)) {
    Object.defineProperty(dom.window.HTMLElement.prototype, 'attachEvent', {
      value: () => {},
      configurable: true,
    });
  }
  if (!('detachEvent' in dom.window.HTMLElement.prototype)) {
    Object.defineProperty(dom.window.HTMLElement.prototype, 'detachEvent', {
      value: () => {},
      configurable: true,
    });
  }

  return dom;
}

function createComponentRoot() {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  return { dom, container, root };
}

async function destroyComponentRoot(dom: JSDOM, root: Root) {
  await act(async () => {
    root.unmount();
  });
  dom.window.close();
}

function createBridgeModalElement({
  workspace,
  ...props
}: BridgeCreateModalProps & { workspace: AssemblyState }) {
  useWorkspaceStore.setState({
    workspace,
    activeComponentId: Object.keys(workspace.components)[0]!,
  });
  return React.createElement(BridgeCreateModal, props);
}

function selectLink(componentId: string, entityId: string) {
  useSelectionStore.getState().setSelection({
    entity: { type: 'link', componentId, entityId },
  });
}

function createAssemblyState(): AssemblyState {
  return {
    name: 'test-assembly',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    components: {
      component_a: {
        id: 'component_a',
        name: 'Component A',
        sourceFile: 'component_a.urdf',
        visible: true,
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { r: 0, p: 0, y: 0 },
        },
        robot: {
          name: 'robot_a',
          rootLinkId: 'base_link',
          links: {
            base_link: {
              id: 'base_link',
              name: 'base_link',
              visual: {
                type: GeometryType.BOX,
                dimensions: { x: 1, y: 1, z: 1 },
                color: '#ffffff',
                origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
              },
              collision: {
                type: GeometryType.BOX,
                dimensions: { x: 1, y: 1, z: 1 },
                color: '#ffffff',
                origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
              },
            },
            tool_link: {
              id: 'tool_link',
              name: 'tool_link',
              visual: {
                type: GeometryType.BOX,
                dimensions: { x: 1, y: 1, z: 1 },
                color: '#ffffff',
                origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
              },
              collision: {
                type: GeometryType.BOX,
                dimensions: { x: 1, y: 1, z: 1 },
                color: '#ffffff',
                origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
              },
            },
          },
          joints: {
            tool_joint: {
              id: 'tool_joint',
              name: 'tool_joint',
              type: JointType.FIXED,
              parentLinkId: 'base_link',
              childLinkId: 'tool_link',
              origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
              dynamics: { damping: 0, friction: 0 },
              hardware: { armature: 0, motorType: '', motorId: '', motorDirection: 1 },
            },
          },
        },
      },
      component_b: {
        id: 'component_b',
        name: 'Component B',
        sourceFile: 'component_b.urdf',
        visible: true,
        transform: {
          position: { x: 4, y: 0, z: 0 },
          rotation: { r: 0, p: 0, y: 0 },
        },
        robot: {
          name: 'robot_b',
          rootLinkId: 'base_link',
          links: {
            base_link: {
              id: 'base_link',
              name: 'base_link',
              visual: {
                type: GeometryType.BOX,
                dimensions: { x: 1, y: 1, z: 1 },
                color: '#ffffff',
                origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
              },
              collision: {
                type: GeometryType.BOX,
                dimensions: { x: 1, y: 1, z: 1 },
                color: '#ffffff',
                origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
              },
            },
          },
          joints: {},
        },
      },
    },
    bridges: {},
  };
}

function createPickedSnapFrame(
  side: 'parent' | 'child',
  componentId: string,
  linkId: string,
  x = 0,
): PickedSnapFrame {
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];

  return {
    side,
    componentId,
    linkId,
    kind: 'faceCenter',
    pointWorld: { x, y: 0, z: 0 },
    poseWorldMatrix: matrix,
    linkWorldMatrix: matrix,
  };
}

function findButtonByText(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === text,
  ) as HTMLButtonElement | null;
}

function findTextInput(container: HTMLElement) {
  return container.querySelector('input[type="text"]') as HTMLInputElement | null;
}

function findInputByAriaLabel(container: HTMLElement, label: string) {
  return container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement | null;
}

function findJointTypeSelect(container: HTMLElement) {
  return container.querySelector(
    '[data-bridge-inline-field="type"] select',
  ) as HTMLSelectElement | null;
}

function findHardwareInterfaceSelect(container: HTMLElement) {
  return container.querySelector(
    '[data-bridge-inline-field="hardware-interface"] select',
  ) as HTMLSelectElement | null;
}

async function waitForWindowTimers(dom: JSDOM, ms: number) {
  await new Promise<void>((resolve) => {
    dom.window.setTimeout(resolve, ms);
  });
}

async function pressAndHoldButton(dom: JSDOM, button: HTMLButtonElement, ms: number) {
  const PointerEventCtor = dom.window.PointerEvent ?? dom.window.MouseEvent;
  button.dispatchEvent(new PointerEventCtor('pointerdown', { bubbles: true, pointerId: 1 }));
  await Promise.resolve();
  await waitForWindowTimers(dom, ms);
  button.dispatchEvent(new PointerEventCtor('pointerup', { bubbles: true, pointerId: 1 }));
  button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

function getReactProps(node: Element): Record<string, unknown> {
  const reactPropsKey = Object.keys(node).find((key) => key.startsWith('__reactProps$'));
  assert.ok(reactPropsKey, 'React props key should exist on rendered element');
  return (node as unknown as Record<string, unknown>)[reactPropsKey] as Record<string, unknown>;
}

function setFormControlValue(
  dom: JSDOM,
  element: HTMLInputElement | HTMLSelectElement,
  value: string,
) {
  const prototype =
    element instanceof dom.window.HTMLSelectElement
      ? dom.window.HTMLSelectElement.prototype
      : dom.window.HTMLInputElement.prototype;
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

  assert.ok(valueSetter, 'form control value setter should exist');
  valueSetter.call(element, value);

  const reactProps = getReactProps(element);
  const onChange = reactProps.onChange;
  assert.equal(typeof onChange, 'function', 'React onChange handler should exist');

  (
    onChange as (event: {
      target: HTMLInputElement | HTMLSelectElement;
      currentTarget: HTMLInputElement | HTMLSelectElement;
    }) => void
  )({
    target: element,
    currentTarget: element,
  });

  element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  element.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}

function expectInlineFieldRow(
  container: ParentNode,
  fieldKey: string,
  controlTag: 'input' | 'select',
) {
  const row = container.querySelector<HTMLElement>(`[data-bridge-inline-field="${fieldKey}"]`);
  assert.ok(row, `expected inline field row "${fieldKey}" to exist`);
  assert.ok(
    row.querySelector('label'),
    `expected inline field row "${fieldKey}" to keep its label`,
  );
  assert.ok(
    row.querySelector(controlTag),
    `expected inline field row "${fieldKey}" to contain a ${controlTag}`,
  );
}

async function expandAdvancedSettings(container: HTMLElement) {
  const advancedToggle = container.querySelector<HTMLButtonElement>(
    '[data-bridge-advanced="collapsed"] > button',
  );
  if (!advancedToggle) {
    return;
  }

  await act(async () => {
    advancedToggle.click();
    await Promise.resolve();
  });
}

async function switchEndpointInputMode(container: HTMLElement, ariaLabel: string) {
  const modeButton = container.querySelector<HTMLButtonElement>(
    `[data-bridge-input-mode] [role="radio"][aria-label="${ariaLabel}"]`,
  );
  assert.ok(modeButton, `endpoint input mode "${ariaLabel}" should render`);
  await act(async () => {
    modeButton.click();
    await Promise.resolve();
  });
}

async function selectFlatEndpoint(
  dom: JSDOM,
  container: HTMLElement,
  side: 'parent' | 'child',
  label: string,
) {
  const select = container.querySelector<HTMLSelectElement>(
    `[data-bridge-link-endpoint="${side}"] select`,
  );
  assert.ok(select, `${side} flattened link selector should render`);
  const option = Array.from(select.options).find((candidate) => candidate.textContent === label);
  assert.ok(option, `flattened link option "${label}" should render`);
  await act(async () => {
    setFormControlValue(dom, select, option.value);
    await Promise.resolve();
  });
}

test('bridge create modal defaults to a compact geometry-pick workflow with advanced settings expanded', async () => {
  const { dom, container, root } = createComponentRoot();
  useJointPickSessionStore.getState().reset();
  useSelectionStore.setState({ selection: null, interactionGuard: null });

  try {
    await act(async () => {
      root.render(
        createBridgeModalElement({
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          workspace: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    const dialogRoot = container.firstElementChild as HTMLElement | null;
    assert.ok(dialogRoot, 'bridge dialog should render');
    assert.equal(dialogRoot.style.width, '420px');
    assert.equal(dialogRoot.style.height, '480px');

    const modeControl = container.querySelector<HTMLElement>('[data-bridge-input-mode]');
    assert.ok(modeControl, 'endpoint input mode control should render');
    assert.equal(modeControl.dataset.bridgeInputMode, 'geometry');
    assert.equal(
      modeControl
        .querySelector('[role="radio"][aria-label="几何吸附"]')
        ?.getAttribute('aria-checked'),
      'true',
    );
    assert.equal(
      container.querySelectorAll('[data-bridge-endpoint-rail]').length,
      2,
      'geometry mode should expose two endpoint rails',
    );
    assert.equal(
      container.querySelector('[data-bridge-link-endpoint]'),
      null,
      'geometry mode should not render link dropdowns',
    );
    assert.ok(
      container.querySelector('[data-bridge-row="origin"]'),
      'manual transforms should be visible by default',
    );
    assert.ok(container.querySelector('[data-bridge-advanced="expanded"]'));
    assert.equal(
      container
        .querySelector('[data-bridge-advanced="expanded"] button')
        ?.getAttribute('aria-expanded'),
      'true',
    );
    const liveStatus = container.querySelector('[role="status"][aria-live="polite"]');
    assert.ok(liveStatus, 'geometry endpoint progress should be announced');
    assert.match(liveStatus.textContent ?? '', /父侧/);
    assert.ok(container.querySelector('[data-bridge-footer]'));
    assert.equal(useJointPickSessionStore.getState().active, true);
    assert.equal(typeof useSelectionStore.getState().interactionGuard, 'function');
  } finally {
    await destroyComponentRoot(dom, root);
    useJointPickSessionStore.getState().reset();
    useSelectionStore.setState({ selection: null, interactionGuard: null });
  }
});

test('bridge create modal link-list mode uses one flattened selector per endpoint and ignores scene picks', async () => {
  const { dom, container, root } = createComponentRoot();
  useJointPickSessionStore.getState().reset();
  useSelectionStore.setState({ selection: null, interactionGuard: null });

  try {
    await act(async () => {
      root.render(
        createBridgeModalElement({
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          workspace: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    const linkModeButton = container.querySelector<HTMLButtonElement>(
      '[role="radio"][aria-label="Link 列表"]',
    );
    assert.ok(linkModeButton, 'link-list mode should be available');
    await act(async () => {
      linkModeButton.click();
      await Promise.resolve();
    });

    assert.equal(
      container.querySelector<HTMLElement>('[data-bridge-input-mode]')?.dataset.bridgeInputMode,
      'link',
    );
    const endpointSelects = Array.from(
      container.querySelectorAll<HTMLSelectElement>('[data-bridge-link-endpoint] select'),
    );
    assert.equal(endpointSelects.length, 2);
    assert.equal(container.querySelector('[data-bridge-endpoint-rail]'), null);
    assert.deepEqual(
      Array.from(endpointSelects[0]!.options).map((option) => option.textContent),
      ['--', 'Component A › base_link', 'Component A › tool_link', 'Component B › base_link'],
    );
    assert.equal(useJointPickSessionStore.getState().active, false);
    assert.equal(useSelectionStore.getState().interactionGuard, null);

    const parentOption = Array.from(endpointSelects[0]!.options).find(
      (option) => option.textContent === 'Component A › tool_link',
    );
    const childOption = Array.from(endpointSelects[1]!.options).find(
      (option) => option.textContent === 'Component B › base_link',
    );
    assert.ok(parentOption && childOption);
    await act(async () => {
      setFormControlValue(dom, endpointSelects[0]!, parentOption.value);
      setFormControlValue(dom, endpointSelects[1]!, childOption.value);
      await Promise.resolve();
    });
    const selectedValues = endpointSelects.map((select) => select.value);

    await act(async () => {
      selectLink('component_a', 'base_link');
      await Promise.resolve();
    });
    assert.deepEqual(
      endpointSelects.map((select) => select.value),
      selectedValues,
      'canonical scene selection must not rewrite link-list endpoints',
    );
  } finally {
    await destroyComponentRoot(dom, root);
    useJointPickSessionStore.getState().reset();
    useSelectionStore.setState({ selection: null, interactionGuard: null });
  }
});

test('bridge create modal advances geometry endpoints and clears snap frames across mode switches', async () => {
  const { dom, container, root } = createComponentRoot();
  useJointPickSessionStore.getState().reset();
  useSelectionStore.setState({ selection: null, interactionGuard: null });

  try {
    await act(async () => {
      root.render(
        createBridgeModalElement({
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          workspace: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      useJointPickSessionStore
        .getState()
        .commitSnap(createPickedSnapFrame('parent', 'component_a', 'tool_link'));
      await Promise.resolve();
    });
    assert.equal(useJointPickSessionStore.getState().side, 'child');
    assert.equal(
      container.querySelector<HTMLElement>('[data-bridge-endpoint-rail="child"]')?.dataset
        .bridgeEndpointActive,
      'true',
      'the second endpoint should become active after the first snap',
    );
    assert.match(
      container.querySelector('[role="status"][aria-live="polite"]')?.textContent ?? '',
      /子侧/,
    );

    await act(async () => {
      useJointPickSessionStore
        .getState()
        .commitSnap(createPickedSnapFrame('child', 'component_b', 'base_link', 4));
      await Promise.resolve();
    });
    const confirmButton = findButtonByText(container, '确认');
    assert.ok(confirmButton);
    assert.equal(confirmButton.disabled, false);

    const linkModeButton = container.querySelector<HTMLButtonElement>(
      '[role="radio"][aria-label="Link 列表"]',
    );
    assert.ok(linkModeButton);
    await act(async () => {
      linkModeButton.click();
      await Promise.resolve();
    });
    assert.equal(useJointPickSessionStore.getState().parentSnap, null);
    assert.equal(useJointPickSessionStore.getState().childSnap, null);
    assert.equal(useJointPickSessionStore.getState().active, false);
    assert.match(
      container.querySelector<HTMLSelectElement>('[data-bridge-link-endpoint="parent"] select')
        ?.selectedOptions[0]?.textContent ?? '',
      /Component A › tool_link/,
    );
    assert.match(
      container.querySelector<HTMLSelectElement>('[data-bridge-link-endpoint="child"] select')
        ?.selectedOptions[0]?.textContent ?? '',
      /Component B › base_link/,
    );

    const geometryModeButton = container.querySelector<HTMLButtonElement>(
      '[role="radio"][aria-label="几何吸附"]',
    );
    assert.ok(geometryModeButton);
    await act(async () => {
      geometryModeButton.click();
      await Promise.resolve();
    });
    assert.equal(useJointPickSessionStore.getState().active, true);
    assert.equal(confirmButton.disabled, true, 'geometry mode requires two fresh snap frames');
    assert.equal(
      container.querySelector<HTMLElement>('[data-bridge-endpoint-rail="parent"]')?.dataset
        .bridgeEndpointComponentId,
      'component_a',
    );
    assert.equal(
      container.querySelector<HTMLElement>('[data-bridge-endpoint-rail="child"]')?.dataset
        .bridgeEndpointComponentId,
      'component_b',
    );
  } finally {
    await destroyComponentRoot(dom, root);
    useJointPickSessionStore.getState().reset();
    useSelectionStore.setState({ selection: null, interactionGuard: null });
  }
});

test('bridge create modal auto-fills parent and child from direct link picks', async () => {
  const { dom, container, root } = createComponentRoot();
  const originalConsoleError = console.error;

  useSelectionStore.setState({
    selection: null,
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        createBridgeModalElement({
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: () => {},
          workspace: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      selectLink('component_a', 'tool_link');
      await Promise.resolve();
    });

    await act(async () => {
      selectLink('component_b', 'base_link');
      await Promise.resolve();
    });

    const parentCard = container.querySelector<HTMLElement>('[data-bridge-side="parent"]');
    const childCard = container.querySelector<HTMLElement>('[data-bridge-side="child"]');
    assert.ok(parentCard, 'parent side card should render');
    assert.ok(childCard, 'child side card should render');
    assert.equal(parentCard.dataset.bridgeComponentSummary, 'Component A');
    assert.equal(parentCard.dataset.bridgeLinkSummary, 'tool_link');
    assert.equal(childCard.dataset.bridgeComponentSummary, 'Component B');
    assert.equal(childCard.dataset.bridgeLinkSummary, 'base_link');
  } finally {
    useSelectionStore.setState({
      selection: null,
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal opens as a compact single-page editor with stacked XYZ controls', async () => {
  const { dom, container, root } = createComponentRoot();

  try {
    await act(async () => {
      root.render(
        createBridgeModalElement({
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: () => {},
          workspace: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    const dialogRoot = container.firstElementChild as HTMLElement | null;
    assert.ok(dialogRoot, 'bridge dialog should render');
    assert.equal(dialogRoot.style.width, '420px');

    assert.equal(
      container.querySelector('[data-bridge-tabs]'),
      null,
      'bridge dialog should not split sections into tabs',
    );
    assert.ok(
      container.querySelector('[data-bridge-section-panel="relation"]'),
      'relation section should be visible by default',
    );
    assert.ok(container.querySelector('[data-bridge-advanced="expanded"]'));
    assert.ok(container.querySelector('[data-bridge-row="origin"]'));

    const jointTypeSelect = findJointTypeSelect(container);
    assert.ok(jointTypeSelect, 'joint type select should render');
    await act(async () => {
      setFormControlValue(dom, jointTypeSelect, JointType.REVOLUTE);
      await Promise.resolve();
    });
    await expandAdvancedSettings(container);

    const originRow = container.querySelector<HTMLElement>('[data-bridge-row="origin"]');
    assert.ok(originRow, 'origin row should render');
    assert.match(originRow.className, /space-y-1/);
    assert.doesNotMatch(originRow.className, /grid-cols-3/);
    assert.ok(originRow.querySelector('[data-bridge-inline-field="origin-x"]'));
    assert.ok(originRow.querySelector('[data-bridge-inline-field="origin-y"]'));
    assert.ok(originRow.querySelector('[data-bridge-inline-field="origin-z"]'));

    const axisRow = container.querySelector<HTMLElement>('[data-bridge-row="axis"]');
    assert.ok(axisRow, 'joint axis controls should be visible for non-fixed joints');
    assert.match(axisRow.className, /space-y-1/);
    assert.doesNotMatch(axisRow.className, /grid-cols-3/);
    expectInlineFieldRow(axisRow, 'axis-x', 'input');
    expectInlineFieldRow(axisRow, 'axis-y', 'input');
    expectInlineFieldRow(axisRow, 'axis-z', 'input');
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('bridge create modal keeps the compact grouped layout and removes legacy hint copy', async () => {
  const { dom, container, root } = createComponentRoot();
  const originalConsoleError = console.error;
  useSelectionStore.setState({
    selection: null,
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        createBridgeModalElement({
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: () => {},
          workspace: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    const dialogRoot = container.firstElementChild as HTMLElement | null;
    assert.ok(dialogRoot, 'bridge dialog should render');
    assert.equal(dialogRoot.style.width, '420px');

    assert.doesNotMatch(container.textContent ?? '', /桥接关节/);
    assert.doesNotMatch(container.textContent ?? '', /保持窗口打开时/);

    const identityRow = container.querySelector<HTMLElement>('[data-bridge-row="identity"]');
    assert.ok(identityRow, 'identity row should render');
    assert.match(identityRow.className, /grid/);
    assert.match(identityRow.className, /items-center/);
    expectInlineFieldRow(identityRow, 'name', 'input');
    expectInlineFieldRow(identityRow, 'type', 'select');
    assert.equal(container.querySelector('[data-bridge-link-endpoint]'), null);
    assert.equal(container.querySelectorAll('[data-bridge-endpoint-rail]').length, 2);

    await act(async () => {
      selectLink('component_a', 'tool_link');
      await Promise.resolve();
    });

    const parentCard = container.querySelector<HTMLElement>('[data-bridge-side="parent"]');
    assert.ok(parentCard, 'parent side card should render');
    assert.equal(parentCard.dataset.bridgeComponentSummary, 'Component A');
    assert.equal(parentCard.dataset.bridgeLinkSummary, 'tool_link');
    assert.doesNotMatch(parentCard.textContent ?? '', /--\s*\/\s*--/);
    assert.match(parentCard.textContent ?? '', /基准 Link/);
    assert.match(parentCard.textContent ?? '', /Component A › tool_link/);

    await act(async () => {
      selectLink('component_b', 'base_link');
      await Promise.resolve();
    });

    const childCard = container.querySelector<HTMLElement>('[data-bridge-side="child"]');
    assert.ok(childCard, 'child side card should render');
    assert.equal(childCard.dataset.bridgeComponentSummary, 'Component B');
    assert.equal(childCard.dataset.bridgeLinkSummary, 'base_link');
    assert.doesNotMatch(childCard.textContent ?? '', /--\s*\/\s*--/);
    assert.match(childCard.textContent ?? '', /连接 Link/);
    assert.match(childCard.textContent ?? '', /Component B › base_link/);
  } finally {
    useSelectionStore.setState({
      selection: null,
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal uses friendly MJCF link labels in summaries and selectors', async () => {
  const { dom, container, root } = createComponentRoot();
  const originalConsoleError = console.error;
  const assemblyState = createAssemblyState();
  const mjcfRootLink = assemblyState.components.component_a.robot.links['base_link'];

  mjcfRootLink.name = 'world_body_0';
  mjcfRootLink.visual = {
    ...mjcfRootLink.visual,
    mjcfMesh: { name: 'bin' },
  };
  mjcfRootLink.collision = {
    ...mjcfRootLink.collision,
    mjcfMesh: { name: 'bin' },
  };
  assemblyState.components.component_a.robot.inspectionContext = {
    sourceFormat: 'mjcf',
    mjcf: {
      siteCount: 0,
      tendonCount: 0,
      tendonActuatorCount: 0,
      bodiesWithSites: [],
      tendons: [],
    },
  };

  useSelectionStore.setState({
    selection: null,
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        createBridgeModalElement({
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: () => {},
          workspace: assemblyState,
          lang: 'en',
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      selectLink('component_a', 'base_link');
      await Promise.resolve();
    });

    const parentCard = container.querySelector<HTMLElement>('[data-bridge-side="parent"]');
    assert.ok(parentCard, 'parent side card should render');
    assert.equal(parentCard.dataset.bridgeLinkSummary, 'Bin');

    await switchEndpointInputMode(container, 'Link List');

    const parentLinkSelect = container.querySelector<HTMLSelectElement>(
      '[data-bridge-link-endpoint="parent"] select',
    );
    assert.ok(parentLinkSelect, 'parent link select should render');

    const optionLabels = Array.from(parentLinkSelect.options).map((option) => option.text.trim());
    assert.ok(
      optionLabels.includes('Component A › Bin'),
      'friendly MJCF link label should be listed',
    );
    assert.ok(
      !optionLabels.includes('world_body_0'),
      'raw anonymous MJCF body name should stay hidden from the selector',
    );
  } finally {
    useSelectionStore.setState({
      selection: null,
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal keeps joint type compact and omits extra explanation copy', async () => {
  const { dom, container, root } = createComponentRoot();
  const originalConsoleError = console.error;

  useSelectionStore.setState({
    selection: null,
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        createBridgeModalElement({
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: () => {},
          workspace: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    await switchEndpointInputMode(container, 'Link 列表');
    await selectFlatEndpoint(dom, container, 'parent', 'Component A › tool_link');
    await selectFlatEndpoint(dom, container, 'child', 'Component B › base_link');

    const jointTypeSelect = findJointTypeSelect(container);
    assert.ok(jointTypeSelect, 'joint type select should render');

    await act(async () => {
      setFormControlValue(dom, jointTypeSelect, JointType.REVOLUTE);
      await Promise.resolve();
    });

    const helperRow = container.querySelector<HTMLElement>('[data-bridge-row="joint-behavior"]');
    assert.equal(helperRow, null, 'joint type helper copy should not render');

    await expandAdvancedSettings(container);
    const hardwareInterfaceSelect = findHardwareInterfaceSelect(container);
    assert.ok(hardwareInterfaceSelect, 'hardware interface select should still render');
    assert.doesNotMatch(container.textContent ?? '', /绕单一轴线旋转/);
    assert.doesNotMatch(container.textContent ?? '', /无位置上下限/);
  } finally {
    useSelectionStore.setState({
      selection: null,
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal keeps zh hardware interface labels Chinese-only and prevents the field label from wrapping', async () => {
  const { dom, container, root } = createComponentRoot();
  const originalConsoleError = console.error;

  useSelectionStore.setState({
    selection: null,
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        createBridgeModalElement({
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: () => {},
          workspace: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      selectLink('component_a', 'tool_link');
      await Promise.resolve();
    });
    await act(async () => {
      selectLink('component_b', 'base_link');
      await Promise.resolve();
    });

    const jointTypeSelect = findJointTypeSelect(container);
    assert.ok(jointTypeSelect, 'joint type select should render');

    await act(async () => {
      setFormControlValue(dom, jointTypeSelect, JointType.REVOLUTE);
      await Promise.resolve();
    });

    await expandAdvancedSettings(container);

    const fieldLabel = container.querySelector(
      '[data-bridge-inline-field="hardware-interface"] label',
    ) as HTMLLabelElement | null;
    assert.ok(fieldLabel, 'hardware interface field label should render');
    assert.equal(fieldLabel.textContent?.trim(), '控制接口');
    assert.match(fieldLabel.className, /\bwhitespace-nowrap\b/);
    assert.match(fieldLabel.className, /\bw-auto\b/);

    const trigger = container.querySelector(
      'button[role="combobox"][aria-label="控制接口"]',
    ) as HTMLButtonElement | null;
    assert.ok(trigger, 'hardware interface combobox trigger should render');
    assert.equal(trigger.textContent?.includes('位置'), true);
    assert.equal(trigger.textContent?.includes('position'), false);

    await act(async () => {
      trigger.click();
      await Promise.resolve();
    });

    const optionLabels = Array.from(
      dom.window.document.querySelectorAll('button[role="option"] span'),
    ).map((node) => node.textContent?.trim());
    assert.deepEqual(optionLabels, ['位置', '力矩', '速度']);
  } finally {
    useSelectionStore.setState({
      selection: null,
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal lets users switch back to the parent side and repick it', async () => {
  const { dom, container, root } = createComponentRoot();
  const originalConsoleError = console.error;

  useSelectionStore.setState({
    selection: null,
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        createBridgeModalElement({
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: () => {},
          workspace: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      selectLink('component_a', 'tool_link');
      await Promise.resolve();
    });
    await act(async () => {
      selectLink('component_b', 'base_link');
      await Promise.resolve();
    });
    await act(async () => {
      selectLink('component_a', 'base_link');
      await Promise.resolve();
    });

    const parentCard = container.querySelector<HTMLElement>('[data-bridge-side="parent"]');
    assert.ok(parentCard, 'parent side card should render');
    assert.equal(parentCard.dataset.bridgeComponentSummary, 'Component A');
    assert.equal(parentCard.dataset.bridgeLinkSummary, 'base_link');
  } finally {
    useSelectionStore.setState({
      selection: null,
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal adds compact +/-90 degree rotation shortcuts for each Euler axis', async () => {
  const { dom, container, root } = createComponentRoot();
  const previewUpdates: Array<number | undefined> = [];
  const originalConsoleError = console.error;

  useSelectionStore.setState({
    selection: null,
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        createBridgeModalElement({
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: (bridge) => {
            previewUpdates.push(bridge?.joint.origin?.rpy.r);
          },
          workspace: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      selectLink('component_a', 'tool_link');
      await Promise.resolve();
    });
    await act(async () => {
      selectLink('component_b', 'base_link');
      await Promise.resolve();
    });

    await expandAdvancedSettings(container);

    const rollDecreaseButton = container.querySelector('button[aria-label="横滚 减少 90°"]');
    const rollIncreaseButton = container.querySelector('button[aria-label="横滚 增加 90°"]');
    assert.ok(rollDecreaseButton, 'roll decrease shortcut button should exist');
    assert.ok(rollIncreaseButton, 'roll increase shortcut button should exist');
    assert.equal(container.textContent?.includes('-90'), true);
    assert.equal(container.textContent?.includes('+90'), true);

    await act(async () => {
      rollIncreaseButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    assert.equal(previewUpdates.at(-1), Math.PI / 2);

    await act(async () => {
      rollDecreaseButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    assert.equal(previewUpdates.at(-1), 0);
  } finally {
    useSelectionStore.setState({
      selection: null,
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal maps X/Y/Z keyboard shortcuts to Euler flip steps', async () => {
  const { dom, container, root } = createComponentRoot();
  const previewUpdates: Array<{
    r: number;
    p: number;
    y: number;
  } | null> = [];
  const originalConsoleError = console.error;

  useSelectionStore.setState({
    selection: null,
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        createBridgeModalElement({
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: (bridge) => {
            previewUpdates.push(bridge ? bridge.joint.origin.rpy : null);
          },
          workspace: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      selectLink('component_a', 'tool_link');
      await Promise.resolve();
    });
    await act(async () => {
      selectLink('component_b', 'base_link');
      await Promise.resolve();
    });

    await act(async () => {
      dom.window.document.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key: 'x', bubbles: true }),
      );
      await Promise.resolve();
    });
    assertNearlyEqual(previewUpdates.at(-1)?.r ?? 0, Math.PI / 2);

    await act(async () => {
      dom.window.document.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key: 'Y', bubbles: true }),
      );
      await Promise.resolve();
    });
    assertNearlyEqual(previewUpdates.at(-1)?.p ?? 0, Math.PI / 2);

    await act(async () => {
      dom.window.document.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key: 'z', shiftKey: true, bubbles: true }),
      );
      await Promise.resolve();
    });
    assertNearlyEqual(previewUpdates.at(-1)?.y ?? 0, -Math.PI / 2);

    const nameInput = findTextInput(container);
    assert.ok(nameInput, 'name input should render');
    await act(async () => {
      nameInput.focus();
      nameInput.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'x', bubbles: true }));
      await Promise.resolve();
    });
    assertNearlyEqual(
      previewUpdates.at(-1)?.r ?? 0,
      Math.PI / 2,
      'typing inside an input should not trigger bridge rotation shortcuts',
    );
  } finally {
    useSelectionStore.setState({
      selection: null,
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal clears stale state but accepts the first click on that same link', async () => {
  const { dom, container, root } = createComponentRoot();
  const originalConsoleError = console.error;

  useSelectionStore.setState({
    selection: {
      entity: { type: 'link', componentId: 'component_a', entityId: 'tool_link' },
    },
    hoveredSelection: {
      entity: { type: 'link', componentId: 'component_a', entityId: 'tool_link' },
    },
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        createBridgeModalElement({
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: () => {},
          workspace: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    const parentCard = container.querySelector<HTMLElement>('[data-bridge-side="parent"]');
    assert.ok(parentCard, 'parent side card should render');
    assert.equal(parentCard.dataset.bridgeComponentSummary, '--');
    assert.equal(parentCard.dataset.bridgeLinkSummary, '--');
    assert.equal(useSelectionStore.getState().selection, null);
    assert.equal(useSelectionStore.getState().hoveredSelection, null);

    await act(async () => {
      selectLink('component_a', 'tool_link');
      await Promise.resolve();
    });

    assert.equal(parentCard.dataset.bridgeComponentSummary, 'Component A');
    assert.equal(parentCard.dataset.bridgeLinkSummary, 'tool_link');
  } finally {
    useSelectionStore.setState({
      selection: null,
      hoveredSelection: null,
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal link-list endpoints emit an immediate visual-contact preview', async () => {
  const { dom, container, root } = createComponentRoot();
  const previewUpdates: Array<{
    parentLinkId: string;
    childLinkId: string;
    originX: number | undefined;
  } | null> = [];
  const originalConsoleError = console.error;

  useSelectionStore.setState({
    selection: null,
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        createBridgeModalElement({
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: (bridge) => {
            previewUpdates.push(
              bridge
                ? {
                    parentLinkId: bridge.parentLinkId,
                    childLinkId: bridge.childLinkId,
                    originX: bridge.joint.origin?.xyz.x,
                  }
                : null,
            );
          },
          workspace: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    await switchEndpointInputMode(container, 'Link 列表');
    await selectFlatEndpoint(dom, container, 'parent', 'Component A › base_link');
    await selectFlatEndpoint(dom, container, 'child', 'Component B › base_link');

    const lastPreview = previewUpdates.at(-1);
    assert.ok(lastPreview, 'bridge preview should be emitted once both sides are selected');
    assert.equal(lastPreview.parentLinkId, 'base_link');
    assert.equal(lastPreview.childLinkId, 'base_link');
    assertNearlyEqual(
      lastPreview.originX ?? 0,
      1.002,
      'root-link auto preview should suggest a visual contact offset instead of center overlap',
    );
  } finally {
    useSelectionStore.setState({
      selection: null,
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal keeps the joint-pick origin instead of overwriting it with visual contact', async () => {
  const { dom, root } = createComponentRoot();
  const previewOriginXs: number[] = [];
  const originalConsoleError = console.error;
  const identityMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const childWorldMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 0, 0, 1];
  const parentSnap: PickedSnapFrame = {
    side: 'parent',
    componentId: 'component_a',
    linkId: 'base_link',
    kind: 'surface',
    pointWorld: { x: 0, y: 0, z: 0 },
    poseWorldMatrix: identityMatrix,
    linkWorldMatrix: identityMatrix,
  };
  const childSnap: PickedSnapFrame = {
    side: 'child',
    componentId: 'component_b',
    linkId: 'base_link',
    kind: 'surface',
    pointWorld: { x: 4, y: 0, z: 0 },
    poseWorldMatrix: childWorldMatrix,
    linkWorldMatrix: childWorldMatrix,
  };

  useSelectionStore.setState({ selection: null, interactionGuard: null });
  useJointPickSessionStore.getState().reset();
  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }
    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        createBridgeModalElement({
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: (bridge) => {
            if (bridge) previewOriginXs.push(bridge.joint.origin.xyz.x);
          },
          workspace: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });
    await act(async () => {
      useJointPickSessionStore.getState().commitSnap(parentSnap);
      await Promise.resolve();
    });
    await act(async () => {
      useJointPickSessionStore.getState().commitSnap(childSnap);
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.ok(previewOriginXs.length > 0, 'joint picks should emit a bridge preview');
    assertNearlyEqual(
      previewOriginXs.at(-1) ?? Number.NaN,
      0,
      'the picked link origins coincide at x=0 and must not be replaced by the 1.002 visual-contact suggestion',
    );
  } finally {
    useJointPickSessionStore.getState().reset();
    useSelectionStore.setState({ selection: null, interactionGuard: null });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal suggests a default bridge name and auto-uses it on confirm', async () => {
  const { dom, container, root } = createComponentRoot();
  const createdNames: string[] = [];
  const createdOriginXs: number[] = [];
  const originalConsoleError = console.error;

  useSelectionStore.setState({
    selection: null,
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        createBridgeModalElement({
          isOpen: true,
          onClose: () => {},
          onCreate: (params) => {
            createdNames.push(params.name);
            createdOriginXs.push(params.joint.origin.xyz.x);
          },
          onPreviewChange: () => {},
          workspace: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    await switchEndpointInputMode(container, 'Link 列表');
    await selectFlatEndpoint(dom, container, 'parent', 'Component A › tool_link');
    await selectFlatEndpoint(dom, container, 'child', 'Component B › base_link');

    const nameInput = findTextInput(container);
    assert.ok(nameInput, 'name input should render');
    assert.equal(nameInput.value, 'Component_A-Component_B');

    const confirmButton = findButtonByText(container, '确认');
    assert.ok(confirmButton, 'confirm button should render');
    assert.equal(
      confirmButton.disabled,
      false,
      'generated bridge name should keep confirm enabled',
    );

    await act(async () => {
      confirmButton.click();
      await Promise.resolve();
    });

    await act(async () => {
      await new Promise<void>((resolve) => dom.window.requestAnimationFrame(() => resolve()));
    });

    assert.deepEqual(createdNames, ['Component_A-Component_B']);
    assertNearlyEqual(
      createdOriginXs[0] ?? 0,
      1.002,
      'bridge creation should commit the auto-suggested contact offset by default',
    );
  } finally {
    useSelectionStore.setState({
      selection: null,
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal keeps the editable default name in sync until customized', async () => {
  const { dom, container, root } = createComponentRoot();
  const workspace = createAssemblyState();
  const componentC = structuredClone(workspace.components.component_b!);
  componentC.id = 'component_c';
  componentC.name = 'Component C';
  componentC.sourceFile = 'component_c.urdf';
  workspace.components.component_c = componentC;

  useSelectionStore.setState({ selection: null, interactionGuard: null });

  try {
    await act(async () => {
      root.render(
        createBridgeModalElement({
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: () => {},
          workspace,
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    await switchEndpointInputMode(container, 'Link 列表');
    await selectFlatEndpoint(dom, container, 'parent', 'Component A › tool_link');
    await selectFlatEndpoint(dom, container, 'child', 'Component B › base_link');

    const nameInput = findTextInput(container);
    assert.ok(nameInput, 'name input should render');
    assert.equal(nameInput.value, 'Component_A-Component_B');

    await selectFlatEndpoint(dom, container, 'child', 'Component C › base_link');
    assert.equal(
      nameInput.value,
      'Component_A-Component_C',
      'the generated value should follow endpoint changes before manual editing',
    );

    await act(async () => {
      setFormControlValue(dom, nameInput, 'custom_bridge');
      await Promise.resolve();
    });
    await selectFlatEndpoint(dom, container, 'child', 'Component B › base_link');
    assert.equal(
      nameInput.value,
      'custom_bridge',
      'endpoint changes should not overwrite a customized name',
    );

    await act(async () => {
      setFormControlValue(dom, nameInput, '');
      const onBlur = getReactProps(nameInput).onBlur;
      assert.equal(typeof onBlur, 'function', 'name input should restore auto naming on blur');
      (onBlur as () => void)();
      await Promise.resolve();
    });
    assert.equal(
      nameInput.value,
      'Component_A-Component_B',
      'clearing and blurring should restore the current generated name',
    );

    await selectFlatEndpoint(dom, container, 'child', 'Component C › base_link');
    assert.equal(
      nameInput.value,
      'Component_A-Component_C',
      'clearing and blurring should resume automatic endpoint synchronization',
    );
  } finally {
    useSelectionStore.setState({ selection: null, interactionGuard: null });
    await destroyComponentRoot(dom, root);
  }
});

test('bridge create modal closes before committing a bridge so heavy assemblies do not block click feedback', async () => {
  const { dom, container, root } = createComponentRoot();
  const events: string[] = [];
  const originalConsoleError = console.error;
  const originalRequestAnimationFrame = dom.window.requestAnimationFrame;
  const pendingAnimationFrames: FrameRequestCallback[] = [];

  useSelectionStore.setState({
    selection: null,
    interactionGuard: null,
  });
  dom.window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    pendingAnimationFrames.push(callback);
    return pendingAnimationFrames.length;
  }) as typeof dom.window.requestAnimationFrame;

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        createBridgeModalElement({
          isOpen: true,
          onClose: () => {
            events.push('close');
          },
          onCreate: () => {
            events.push('create');
          },
          onPreviewChange: (preview) => {
            if (preview === null) {
              events.push('preview-clear');
            }
          },
          workspace: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    await switchEndpointInputMode(container, 'Link 列表');
    await selectFlatEndpoint(dom, container, 'parent', 'Component A › tool_link');
    await selectFlatEndpoint(dom, container, 'child', 'Component B › base_link');

    const confirmButton = findButtonByText(container, '确认');
    assert.ok(confirmButton, 'confirm button should render');

    await act(async () => {
      confirmButton.click();
      await Promise.resolve();
    });

    assert.equal(events.includes('create'), false, 'bridge creation should wait until after close');
    assert.equal(events.includes('close'), true, 'modal should close immediately after confirm');
    assert.equal(pendingAnimationFrames.length, 1, 'bridge creation should be queued for a frame');

    await act(async () => {
      const frameCallback = pendingAnimationFrames.shift();
      assert.ok(frameCallback, 'expected a queued bridge creation frame');
      frameCallback(0);
      await Promise.resolve();
    });

    assert.ok(events.includes('create'), 'bridge creation should run on the deferred tick');
    assert.ok(
      events.indexOf('close') < events.indexOf('create'),
      'modal close should be observed before bridge creation starts',
    );
  } finally {
    useSelectionStore.setState({
      selection: null,
      interactionGuard: null,
    });
    dom.window.requestAnimationFrame = originalRequestAnimationFrame;
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal increments the generated bridge name when the default name already exists', async () => {
  const { dom, container, root } = createComponentRoot();
  const originalConsoleError = console.error;
  const assemblyState = createAssemblyState();
  assemblyState.bridges.existing_bridge = {
    id: 'existing_bridge',
    name: 'Component_A-Component_B',
    parentComponentId: 'component_a',
    parentLinkId: 'tool_link',
    childComponentId: 'component_b',
    childLinkId: 'base_link',
    joint: {
      id: 'existing_bridge',
      name: 'existing_bridge',
      type: JointType.FIXED,
      parentLinkId: 'tool_link',
      childLinkId: 'base_link',
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      dynamics: { damping: 0, friction: 0 },
      hardware: { armature: 0, motorType: '', motorId: '', motorDirection: 1 },
    },
  };

  useSelectionStore.setState({
    selection: null,
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        createBridgeModalElement({
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: () => {},
          workspace: assemblyState,
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      selectLink('component_a', 'tool_link');
      await Promise.resolve();
    });
    await act(async () => {
      selectLink('component_b', 'base_link');
      await Promise.resolve();
    });

    const nameInput = findTextInput(container);
    assert.ok(nameInput, 'name input should render');
    assert.equal(nameInput.value, 'Component_A-Component_B-1');
  } finally {
    useSelectionStore.setState({
      selection: null,
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal updates the preview immediately when origin steppers change xyz values', async () => {
  const { dom, container, root } = createComponentRoot();
  const previewUpdates: Array<number | undefined> = [];
  const originalConsoleError = console.error;

  useSelectionStore.setState({
    selection: null,
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        createBridgeModalElement({
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: (bridge) => {
            previewUpdates.push(bridge?.joint.origin?.xyz.x);
          },
          workspace: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      selectLink('component_a', 'tool_link');
      await Promise.resolve();
    });
    await act(async () => {
      selectLink('component_b', 'base_link');
      await Promise.resolve();
    });

    await expandAdvancedSettings(container);
    const increaseXButton = container.querySelector(
      'button[aria-label="Increase X"]',
    ) as HTMLButtonElement | null;
    assert.ok(increaseXButton, 'origin X increase button should render');
    const autoSuggestedOriginX = previewUpdates.at(-1) ?? 0;

    await act(async () => {
      increaseXButton.click();
      await Promise.resolve();
    });

    assertNearlyEqual(previewUpdates.at(-1) ?? 0, autoSuggestedOriginX + 0.01);
  } finally {
    useSelectionStore.setState({
      selection: null,
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal keeps incrementing origin steppers while the + button is held', async () => {
  const { dom, container, root } = createComponentRoot();
  const previewUpdates: Array<number | undefined> = [];
  const originalConsoleError = console.error;

  useSelectionStore.setState({
    selection: null,
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        createBridgeModalElement({
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: (bridge) => {
            previewUpdates.push(bridge?.joint.origin?.xyz.x);
          },
          workspace: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      selectLink('component_a', 'tool_link');
      await Promise.resolve();
    });
    await act(async () => {
      selectLink('component_b', 'base_link');
      await Promise.resolve();
    });

    await expandAdvancedSettings(container);
    const increaseXButton = container.querySelector(
      'button[aria-label="Increase X"]',
    ) as HTMLButtonElement | null;
    assert.ok(increaseXButton, 'origin X increase button should render');
    const autoSuggestedOriginX = previewUpdates.at(-1) ?? 0;

    await act(async () => {
      await pressAndHoldButton(dom, increaseXButton, 520);
      await Promise.resolve();
    });

    const distinctPositiveUpdates = Array.from(
      new Set(
        previewUpdates
          .filter(
            (value): value is number => typeof value === 'number' && value > autoSuggestedOriginX,
          )
          .map((value) => (value - autoSuggestedOriginX).toFixed(2)),
      ),
    );
    assert.equal(distinctPositiveUpdates[0], '0.01');
    assert.equal(distinctPositiveUpdates.length >= 2, true);
  } finally {
    useSelectionStore.setState({
      selection: null,
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal wires press-and-hold handlers onto the quick +90 rotation button', async () => {
  const { dom, container, root } = createComponentRoot();
  const originalConsoleError = console.error;

  useSelectionStore.setState({
    selection: null,
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        createBridgeModalElement({
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: () => {},
          workspace: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      selectLink('component_a', 'tool_link');
      await Promise.resolve();
    });
    await act(async () => {
      selectLink('component_b', 'base_link');
      await Promise.resolve();
    });

    await expandAdvancedSettings(container);
    const rollIncreaseButton = container.querySelector(
      'button[aria-label="横滚 增加 90°"]',
    ) as HTMLButtonElement | null;
    assert.ok(rollIncreaseButton, 'roll increase shortcut button should exist');
    const reactProps = getReactProps(rollIncreaseButton);
    assert.equal(typeof reactProps.onPointerDown, 'function');
    assert.equal(typeof reactProps.onPointerUp, 'function');
    assert.equal(typeof reactProps.onPointerCancel, 'function');
    assert.equal(typeof reactProps.onLostPointerCapture, 'function');
  } finally {
    useSelectionStore.setState({
      selection: null,
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal submits configurable limits for non-fixed joints', async () => {
  const { dom, container, root } = createComponentRoot();
  const createdJoints: Array<{
    type: JointType;
    limit?: { lower?: number; upper?: number; effort?: number; velocity?: number };
    hardwareInterface?: 'effort' | 'position' | 'velocity';
  }> = [];
  const originalConsoleError = console.error;

  useSelectionStore.setState({
    selection: null,
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        createBridgeModalElement({
          isOpen: true,
          onClose: () => {},
          onCreate: (params) => {
            createdJoints.push({
              type: params.joint.type,
              limit: params.joint.limit,
              hardwareInterface: params.joint.hardware?.hardwareInterface,
            });
          },
          onPreviewChange: () => {},
          workspace: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    await switchEndpointInputMode(container, 'Link 列表');
    await selectFlatEndpoint(dom, container, 'parent', 'Component A › tool_link');
    await selectFlatEndpoint(dom, container, 'child', 'Component B › base_link');

    const jointTypeSelect = findJointTypeSelect(container);
    assert.ok(jointTypeSelect, 'joint type select should render');

    await act(async () => {
      setFormControlValue(dom, jointTypeSelect, JointType.REVOLUTE);
      await Promise.resolve();
    });

    await expandAdvancedSettings(container);

    const hardwareInterfaceSelect = findHardwareInterfaceSelect(container);
    assert.ok(hardwareInterfaceSelect, 'hardware interface select should render for motion joints');

    const lowerInput = findInputByAriaLabel(container, '位置下限');
    const upperInput = findInputByAriaLabel(container, '位置上限');
    const effortInput = findInputByAriaLabel(container, '力矩');
    const velocityInput = findInputByAriaLabel(container, '速度');
    assert.ok(lowerInput, 'lower limit input should render');
    assert.ok(upperInput, 'upper limit input should render');
    assert.ok(effortInput, 'effort input should render');
    assert.ok(velocityInput, 'velocity input should render');

    await act(async () => {
      setFormControlValue(dom, hardwareInterfaceSelect, 'effort');
      setFormControlValue(dom, lowerInput, '-0.5');
      setFormControlValue(dom, upperInput, '1.25');
      setFormControlValue(dom, effortInput, '42');
      setFormControlValue(dom, velocityInput, '3.5');
      await Promise.resolve();
    });

    const confirmButton = findButtonByText(container, '确认');
    assert.ok(confirmButton, 'confirm button should render');
    assert.equal(confirmButton.disabled, false);

    await act(async () => {
      confirmButton.click();
      await Promise.resolve();
    });

    await act(async () => {
      await new Promise<void>((resolve) => dom.window.requestAnimationFrame(() => resolve()));
    });

    assert.deepEqual(createdJoints.at(-1), {
      type: JointType.REVOLUTE,
      limit: {
        lower: -0.5,
        upper: 1.25,
        effort: 42,
        velocity: 3.5,
      },
      hardwareInterface: 'effort',
    });
  } finally {
    useSelectionStore.setState({
      selection: null,
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal disables confirm when the lower limit exceeds the upper limit', async () => {
  const { dom, container, root } = createComponentRoot();
  const originalConsoleError = console.error;

  useSelectionStore.setState({
    selection: null,
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        createBridgeModalElement({
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: () => {},
          workspace: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      selectLink('component_a', 'tool_link');
      await Promise.resolve();
    });
    await act(async () => {
      selectLink('component_b', 'base_link');
      await Promise.resolve();
    });

    const jointTypeSelect = findJointTypeSelect(container);
    assert.ok(jointTypeSelect, 'joint type select should render');

    await act(async () => {
      setFormControlValue(dom, jointTypeSelect, JointType.REVOLUTE);
      await Promise.resolve();
    });

    await expandAdvancedSettings(container);

    const lowerInput = findInputByAriaLabel(container, '位置下限');
    const upperInput = findInputByAriaLabel(container, '位置上限');
    assert.ok(lowerInput, 'lower limit input should render');
    assert.ok(upperInput, 'upper limit input should render');

    await act(async () => {
      setFormControlValue(dom, lowerInput, '2');
      setFormControlValue(dom, upperInput, '1');
      await Promise.resolve();
    });

    const confirmButton = findButtonByText(container, '确认');
    assert.ok(confirmButton, 'confirm button should render');
    assert.equal(confirmButton.disabled, true);
    assert.match(container.textContent ?? '', /下限必须小于或等于上限/);
  } finally {
    useSelectionStore.setState({
      selection: null,
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal disables confirm for a non-fixed bridge that would close an assembly cycle', async () => {
  const { dom, container, root } = createComponentRoot();
  const originalConsoleError = console.error;
  const assemblyState = createAssemblyState();
  assemblyState.bridges.bridge_component_a_component_b = {
    id: 'bridge_component_a_component_b',
    name: 'Component_A-Component_B',
    parentComponentId: 'component_a',
    parentLinkId: 'tool_link',
    childComponentId: 'component_b',
    childLinkId: 'base_link',
    joint: {
      id: 'bridge_component_a_component_b',
      name: 'bridge_component_a_component_b',
      type: JointType.FIXED,
      parentLinkId: 'tool_link',
      childLinkId: 'base_link',
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      dynamics: { damping: 0, friction: 0 },
      hardware: { armature: 0, motorType: '', motorId: '', motorDirection: 1 },
    },
  };

  useSelectionStore.setState({
    selection: null,
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        createBridgeModalElement({
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: () => {},
          workspace: assemblyState,
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    await switchEndpointInputMode(container, 'Link 列表');
    await selectFlatEndpoint(dom, container, 'parent', 'Component B › base_link');
    await selectFlatEndpoint(dom, container, 'child', 'Component A › base_link');

    const jointTypeSelect = findJointTypeSelect(container);
    assert.ok(jointTypeSelect, 'joint type select should render');

    const confirmButton = findButtonByText(container, '确认');
    assert.ok(confirmButton, 'confirm button should render');
    assert.equal(confirmButton.disabled, false, 'fixed cyclic bridges should remain allowed');

    await act(async () => {
      setFormControlValue(dom, jointTypeSelect, JointType.REVOLUTE);
      await Promise.resolve();
    });

    assert.equal(confirmButton.disabled, true);
    assert.match(container.textContent ?? '', /成环桥接仅支持 fixed 关节/);
  } finally {
    useSelectionStore.setState({
      selection: null,
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});
