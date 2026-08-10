import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { ViewerJointsPanel } from './ViewerJointsPanel';
import { createJointPanelStore } from '@/shared/utils/jointPanelStore';

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
  (globalThis as { Node?: typeof Node }).Node = dom.window.Node;
  (globalThis as { Event?: typeof Event }).Event = dom.window.Event;
  (globalThis as { MouseEvent?: typeof MouseEvent }).MouseEvent = dom.window.MouseEvent;
  (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent =
    dom.window.PointerEvent ?? dom.window.MouseEvent;
  (globalThis as { FocusEvent?: typeof FocusEvent }).FocusEvent = dom.window.FocusEvent;
  (globalThis as { KeyboardEvent?: typeof KeyboardEvent }).KeyboardEvent = dom.window.KeyboardEvent;
  (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = undefined;
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

function createViewerJointsPanelProps() {
  return {
    layout: {
      containerRef: createRef<HTMLDivElement>(),
      optionsPanelRef: createRef<HTMLDivElement>(),
      jointPanelRef: createRef<HTMLDivElement>(),
      jointPanelPos: null,
      handleMouseDown: () => {},
    },
    jointsPanel: {
      robot: {
        joints: {
          R_thigh_joint: {
            id: 'R_thigh_joint',
            name: 'R_thigh_joint',
            jointType: 'revolute',
            limit: { lower: -1.57, upper: 3.49, effort: 1, velocity: 1 },
          },
        },
      },
      jointPanelRobot: {
        joints: {
          R_thigh_joint: {
            id: 'R_thigh_joint',
            name: 'R_thigh_joint',
            jointType: 'revolute',
            limit: { lower: -1.57, upper: 3.49, effort: 1, velocity: 1 },
          },
        },
      },
      handleResetJoints: () => {},
      angleUnit: 'rad' as const,
      setAngleUnit: () => {},
      isJointsCollapsed: false,
      toggleJointsCollapsed: () => {},
      jointPanelStore: createJointPanelStore({
        jointAngles: { R_thigh_joint: 0 },
      }),
      setActiveJoint: () => {},
      handleJointAngleChange: () => {},
      handleJointChangeCommit: () => {},
      handleSelectWrapper: () => {},
      handleHoverWrapper: () => {},
    },
  };
}

function renderViewerJointsPanel(
  root: Root,
  onUpdate: (type: 'link' | 'joint', id: string, data: unknown) => void,
) {
  return act(async () => {
    root.render(
      React.createElement(ViewerJointsPanel as unknown as React.FC<any>, {
        ...createViewerJointsPanelProps(),
        showJointPanel: true,
        setShowJointPanel: () => {},
        lang: 'en',
        onUpdate,
      }),
    );
  });
}

test('viewer joints panel forwards advanced joint limit edits through onUpdate', async () => {
  const { dom, container, root } = createComponentRoot();
  const updates: Array<{
    type: 'link' | 'joint';
    id: string;
    data: { limit?: { lower?: number } };
  }> = [];

  await renderViewerJointsPanel(root, (type, id, data) => {
    updates.push({
      type,
      id,
      data: data as { limit?: { lower?: number } },
    });
  });

  const advancedButton = Array.from(container.querySelectorAll('button')).find(
    (node) => node.textContent?.trim() === 'Advanced',
  );
  assert.ok(advancedButton, 'advanced toggle should render');

  await act(async () => {
    advancedButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  const lowerLimitDisplay = Array.from(container.querySelectorAll('div')).find(
    (node) => node.textContent === '-1.57',
  );
  assert.ok(lowerLimitDisplay, 'lower limit display should render');

  await act(async () => {
    lowerLimitDisplay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  const lowerInput = Array.from(
    container.querySelectorAll<HTMLInputElement>('input[type="text"]'),
  ).find((node) => node.value === '-1.57');
  assert.ok(lowerInput, 'lower limit editor should open');

  const nameLabel = container.querySelector('span[title="R_thigh_joint"]');
  assert.ok(nameLabel, 'joint name label should render');

  await act(async () => {
    lowerInput.value = '-0.50';
    lowerInput.dispatchEvent(new Event('input', { bubbles: true }));
    nameLabel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });

  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.type, 'joint');
  assert.equal(updates[0]?.id, 'R_thigh_joint');
  assert.equal(updates[0]?.data.limit?.lower, -0.5);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});
