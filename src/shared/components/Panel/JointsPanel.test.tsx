import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { JointsPanel } from './JointsPanel';
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

function waitForAnimationFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function buildRobotWithJointCount(jointCount: number) {
  return {
    joints: Object.fromEntries(
      Array.from({ length: jointCount }, (_, index) => {
        const jointName = `joint_${index + 1}`;
        return [
          jointName,
          {
            id: jointName,
            name: jointName,
            jointType: 'revolute',
            limit: { lower: -1.57, upper: 3.49, effort: 1, velocity: 1 },
          },
        ];
      }),
    ),
  };
}

function renderJointsPanel(
  root: Root,
  onHover?: (type: 'link' | 'joint' | null, id: string | null) => void,
  overrides: Partial<React.ComponentProps<typeof JointsPanel>> = {},
) {
  const jointPanelStore = createJointPanelStore({
    jointAngles: { R_thigh_joint: 0, joint_1: 0 },
  });

  return act(async () => {
    root.render(
      React.createElement(JointsPanel, {
        showJointPanel: true,
        robot: buildRobotWithJointCount(1),
        jointPanelRef: createRef<HTMLDivElement>(),
        jointPanelPos: null,
        defaultPosition: { top: '0px', left: '0px' },
        maxHeight: 320,
        onMouseDown: () => {},
        t: {
          joints: 'Joints',
          resize: 'Resize',
          resetJoints: 'Reset joints',
          advanced: 'Advanced',
          switchUnit: 'Switch unit',
          reset: 'Reset',
        },
        handleResetJoints: () => {},
        angleUnit: 'rad',
        setAngleUnit: () => {},
        isJointsCollapsed: false,
        toggleJointsCollapsed: () => {},
        setShowJointPanel: () => {},
        jointPanelStore,
        setActiveJoint: () => {},
        handleJointAngleChange: () => {},
        handleJointChangeCommit: () => {},
        onSelect: () => {},
        onHover,
        onUpdate: () => {},
        ...overrides,
      }),
    );
  });
}

test('entering the joints panel clears global hover and joint row hover stays local', async () => {
  const { dom, container, root } = createComponentRoot();
  const hoverCalls: Array<{ type: 'link' | 'joint' | null; id: string | null }> = [];

  await renderJointsPanel(root, (type, id) => {
    hoverCalls.push({ type, id });
  });

  const panelRoot = container.querySelector('.urdf-joint-panel') as HTMLDivElement | null;
  assert.ok(panelRoot, 'joint panel root should render');

  await act(async () => {
    panelRoot.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });

  assert.deepEqual(hoverCalls, [{ type: null, id: null }]);

  hoverCalls.length = 0;

  const jointCard = container.querySelector('[data-panel-hovered]') as HTMLDivElement | null;
  assert.ok(jointCard, 'joint card should render');

  await act(async () => {
    jointCard.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });

  assert.equal(jointCard.getAttribute('data-panel-hovered'), 'true');
  assert.ok(
    hoverCalls.every((call) => call.type === null && call.id === null),
    'joint row hover should not write a joint hover back into global selection state',
  );

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('fixed-only robots keep the joints panel hidden even when the preference stays enabled', async () => {
  const { dom, container, root } = createComponentRoot();
  const jointPanelStore = createJointPanelStore({
    jointAngles: {},
  });

  await act(async () => {
    root.render(
      React.createElement(JointsPanel, {
        showJointPanel: true,
        robot: {
          joints: {
            fixed_joint: {
              id: 'fixed_joint',
              name: 'fixed_joint',
              jointType: 'fixed',
            },
          },
        },
        jointPanelRef: createRef<HTMLDivElement>(),
        jointPanelPos: null,
        defaultPosition: { top: '0px', left: '0px' },
        onMouseDown: () => {},
        t: {
          joints: 'Joints',
          resize: 'Resize',
          resetJoints: 'Reset joints',
          advanced: 'Advanced',
          switchUnit: 'Switch unit',
          reset: 'Reset',
        },
        handleResetJoints: () => {},
        angleUnit: 'rad',
        setAngleUnit: () => {},
        isJointsCollapsed: false,
        toggleJointsCollapsed: () => {},
        setShowJointPanel: () => {},
        jointPanelStore,
        setActiveJoint: () => {},
        handleJointAngleChange: () => {},
        handleJointChangeCommit: () => {},
      }),
    );
  });

  assert.equal(
    container.querySelector('.urdf-joint-panel'),
    null,
    'fixed-only robots should not render the joints panel shell',
  );

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('joints panel keeps the resizable side handle and respects the provided max height', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderJointsPanel(root);

  const panelContainer = container.querySelector<HTMLElement>('.urdf-joint-panel > div');
  assert.ok(panelContainer, 'joint panel container should render');
  assert.equal(panelContainer.style.maxHeight, '320px');
  assert.ok(
    container.querySelector('[data-testid="ui-options-panel-resize-right"]'),
    'joint panel should keep the right-edge resize handle',
  );

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('joints panel gives the list area a constrained scroll viewport', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderJointsPanel(root);

  const panelContent = container.querySelector<HTMLElement>('.urdf-joint-panel .custom-scrollbar')
    ?.parentElement as HTMLDivElement | null;
  assert.ok(panelContent, 'joint panel content wrapper should render');
  assert.match(panelContent.className, /\bflex-1\b/);
  assert.match(panelContent.className, /\bmin-h-0\b/);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('joints panel forwards frame-aligned slider drag preview without waiting for release', async () => {
  const { dom, container, root } = createComponentRoot();
  const previewAngles: number[] = [];
  const committedAngles: number[] = [];

  await renderJointsPanel(root, undefined, {
    handleJointAngleChange: (_jointName, angle) => {
      previewAngles.push(angle);
    },
    handleJointChangeCommit: (_jointName, angle) => {
      committedAngles.push(angle);
    },
  });

  const rangeInput = container.querySelector('input[type="range"]') as HTMLInputElement | null;
  assert.ok(rangeInput, 'joint slider input should render');
  const sliderFill = container.querySelector(
    '[data-testid="joint-slider-fill"]',
  ) as HTMLDivElement | null;
  const sliderTrack = sliderFill?.parentElement as HTMLDivElement | null;
  const sliderThumb = container.querySelector(
    '[data-testid="joint-slider-thumb"]',
  ) as HTMLDivElement | null;
  assert.ok(sliderTrack, 'joint slider track should render');
  assert.ok(sliderThumb, 'joint slider thumb should render');
  assert.match(sliderTrack.className, /\bh-1\b/);
  assert.match(sliderThumb.className, /\bh-4\b/);
  assert.match(sliderThumb.className, /\bw-4\b/);

  await act(async () => {
    rangeInput.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    for (const nextValue of ['0.2', '0.4', '0.6']) {
      rangeInput.value = nextValue;
      rangeInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  assert.deepEqual(committedAngles, []);

  await act(async () => {
    await waitForAnimationFrame();
  });

  assert.deepEqual(previewAngles, [0.6]);
  assert.deepEqual(committedAngles, []);

  await act(async () => {
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });

  assert.deepEqual(committedAngles, [0.6]);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('joints panel uses an explicit capped height when the joint list is long', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderJointsPanel(root, undefined, {
    robot: buildRobotWithJointCount(12),
    maxHeight: 320,
  });

  const panelContainer = container.querySelector<HTMLElement>('.urdf-joint-panel > div');
  assert.ok(panelContainer, 'joint panel container should render');
  assert.equal(panelContainer.style.height, '320px');

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('joints panel updates its explicit height when a longer robot is rendered into the same panel', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderJointsPanel(root, undefined, {
    robot: buildRobotWithJointCount(1),
    maxHeight: 320,
  });

  await renderJointsPanel(root, undefined, {
    robot: buildRobotWithJointCount(12),
    maxHeight: 320,
  });

  const panelContainer = container.querySelector<HTMLElement>('.urdf-joint-panel > div');
  assert.ok(panelContainer, 'joint panel container should render');
  assert.equal(panelContainer.style.height, '320px');

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('pose export stays in the toolbar and captures live values independently of degree display', async () => {
  const { dom, container, root } = createComponentRoot();
  const store = createJointPanelStore({ jointAngles: { joint_1: 0.1 } });
  const blobs: Blob[] = [];
  const names: string[] = [];
  const originalCreateUrl = URL.createObjectURL;
  const originalRevokeUrl = URL.revokeObjectURL;
  URL.createObjectURL = (blob) => {
    blobs.push(blob);
    return 'blob:pose-test';
  };
  URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = function () {
    names.push(this.download);
  };
  try {
    await renderJointsPanel(root, undefined, { angleUnit: 'deg', jointPanelStore: store });
    const exportButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Export current pose"]',
    );
    assert.ok(exportButton);
    const controls = exportButton.closest('div.mr-1');
    assert.ok(controls);
    assert.ok(controls.querySelector('[title="Advanced"]'));
    assert.ok(controls.querySelector('[title="Switch unit"]'));
    await act(async () => {
      store.patchJointAngles({ joint_1: 0.8765432109876543 });
    });
    await act(async () => {
      exportButton.click();
    });
    const dialog = dom.window.document.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Export current pose"]',
    );
    assert.ok(dialog);
    assert.match(dialog.textContent ?? '', /0\.8765/);
    const jsonExport = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('Export JSON'),
    );
    assert.ok(jsonExport);
    await act(async () => {
      jsonExport.click();
    });
    assert.deepEqual(names, ['robot_pose.json']);
    const payload: unknown = JSON.parse(await blobs[0].text());
    assert.deepEqual(payload, {
      version: 1,
      robot: 'robot',
      joints: [
        {
          id: 'joint_1',
          name: 'joint_1',
          type: 'revolute',
          position: 0.8765432109876543,
          unit: 'rad',
        },
      ],
    });
  } finally {
    URL.createObjectURL = originalCreateUrl;
    URL.revokeObjectURL = originalRevokeUrl;
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});
