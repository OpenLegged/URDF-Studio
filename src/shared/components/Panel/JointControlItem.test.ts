import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { JointControlItem } from './JointControlItem';

type RenderOverrides = Partial<React.ComponentProps<typeof JointControlItem>>;

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

  // React's old input-event polyfill expects these IE-only methods to exist.
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

function renderJointControlItem(root: Root, overrides: RenderOverrides = {}) {
  return act(async () => {
    root.render(
      React.createElement(JointControlItem, {
        name: 'R_thigh_joint',
        joint: {
          id: 'R_thigh_joint',
          jointType: 'revolute',
          limit: { lower: -1.57, upper: 3.49, effort: 1, velocity: 1 },
        },
        value: 0,
        angleUnit: 'rad',
        isActive: false,
        setActiveJoint: () => {},
        handleJointAngleChange: () => {},
        handleJointChangeCommit: () => {},
        onUpdate: () => {},
        ...overrides,
      }),
    );
  });
}

async function openJointValueEditor(container: HTMLElement, displayValue: number) {
  const button = Array.from(container.querySelectorAll('button')).find(
    (node) => node.textContent === displayValue.toFixed(2),
  );
  assert.ok(button, 'current joint value should be visible');
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  const input = container.querySelector<HTMLInputElement>('input[type="text"]');
  assert.ok(input, 'joint value editor should open');
  return input;
}

for (const angleUnit of ['rad', 'deg'] as const) {
  test(`opening and leaving the ${angleUnit} value editor retains the exact joint pose`, async () => {
    const { dom, container, root } = createComponentRoot();
    const value = 0.12345678912345678;
    const displayValue = angleUnit === 'deg' ? value * 180 / Math.PI : value;
    const committedAngles: number[] = [];
    await renderJointControlItem(root, {
      value,
      angleUnit,
      handleJointChangeCommit: (_name, angle) => committedAngles.push(angle),
    });

    for (const exitMode of ['blur', 'Enter', 'pointerdown'] as const) {
      const input = await openJointValueEditor(container, displayValue);
      assert.equal(Number(input.value), displayValue, 'the editable draft retains full precision');
      await act(async () => {
        if (exitMode === 'blur') {
          input.blur();
        } else if (exitMode === 'Enter') {
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        } else {
          container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        }
      });
      assert.equal(container.querySelector('input[type="text"]'), null);
    }
    assert.deepEqual(committedAngles, [], 'viewing the value must not create a pose change');
    await act(async () => root.unmount());
    dom.window.close();
  });
}

test('an unchanged value draft does not overwrite an external joint pose update', async () => {
  const { dom, container, root } = createComponentRoot();
  const committedAngles: number[] = [];
  const handleJointChangeCommit = (_name: string, angle: number) => committedAngles.push(angle);
  await renderJointControlItem(root, { value: 0.123456789, handleJointChangeCommit });
  const input = await openJointValueEditor(container, 0.123456789);
  await renderJointControlItem(root, { value: 0.7654321, handleJointChangeCommit });
  await act(async () => input.blur());

  assert.deepEqual(committedAngles, []);
  assert.ok(container.textContent?.includes('0.77'), 'the new external value remains visible');
  const reopened = await openJointValueEditor(container, 0.7654321);
  assert.equal(reopened.value, '0.7654321');
  await act(async () => root.unmount());
  dom.window.close();
});

test('numeric value edits commit once on Enter or blur and Escape cancels', async () => {
  const { dom, container, root } = createComponentRoot();
  const committedAngles: number[] = [];
  await renderJointControlItem(root, {
    value: 0.123456789,
    handleJointChangeCommit: (_name, angle) => committedAngles.push(angle),
  });

  const enterInput = await openJointValueEditor(container, 0.123456789);
  await act(async () => {
    enterInput.value = '0.9876543219876543';
    enterInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  assert.deepEqual(committedAngles, [0.9876543219876543]);

  const blurInput = await openJointValueEditor(container, 0.123456789);
  await act(async () => {
    blurInput.value = '-0.456789123456789';
    blurInput.blur();
  });
  assert.deepEqual(committedAngles, [0.9876543219876543, -0.456789123456789]);

  const cancelInput = await openJointValueEditor(container, 0.123456789);
  await act(async () => {
    cancelInput.value = '2.5';
    cancelInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  assert.equal(container.querySelector('input[type="text"]'), null);
  assert.deepEqual(committedAngles, [0.9876543219876543, -0.456789123456789]);
  await act(async () => root.unmount());
  dom.window.close();
});

test('empty, non-finite and numerically unchanged value drafts do not commit', async () => {
  const { dom, container, root } = createComponentRoot();
  const committedAngles: number[] = [];
  await renderJointControlItem(root, {
    value: 0.25,
    handleJointChangeCommit: (_name, angle) => committedAngles.push(angle),
  });
  for (const draft of ['', 'Infinity', '0.5garbage', '0.2500']) {
    const input = await openJointValueEditor(container, 0.25);
    await act(async () => {
      input.value = draft;
      input.blur();
    });
  }
  assert.deepEqual(committedAngles, []);
  await act(async () => root.unmount());
  dom.window.close();
});

test('switching directly from a numeric edit to a continuous slider uses the accepted pose', async () => {
  const { dom, container, root } = createComponentRoot();
  const committedAngles: number[] = [];
  function ControlledJoint() {
    const [value, setValue] = React.useState(0.123456789);
    const handleJointChangeCommit = React.useCallback((_name: string, angle: number) => {
      committedAngles.push(angle);
      setValue(angle);
    }, []);
    return React.createElement(JointControlItem, {
      name: 'continuous_joint',
      joint: { id: 'continuous_joint', jointType: 'continuous' },
      value,
      angleUnit: 'rad',
      isActive: true,
      setActiveJoint: () => {},
      handleJointAngleChange: () => {},
      handleJointChangeCommit,
    });
  }
  await act(async () => root.render(React.createElement(ControlledJoint)));
  const input = await openJointValueEditor(container, 0.123456789);
  const range = container.querySelector<HTMLInputElement>('input[type="range"]');
  assert.ok(range);

  await act(async () => {
    input.value = '2.3456789';
    range.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });
  assert.deepEqual(committedAngles, [2.3456789]);
  await act(async () => {
    range.value = '0.25';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  assert.equal(committedAngles.length, 2);
  assert.ok(Math.abs(committedAngles[1] - 2.5956789) < 1e-12);
  await act(async () => root.unmount());
  dom.window.close();
});

test('slider release reconciles a constrained pose already accepted during the drag', async () => {
  const { dom, container, root } = createComponentRoot();
  const committedAngles: number[] = [];
  function ConstrainedJoint() {
    const [value, setValue] = React.useState(0);
    const acceptAngle = React.useCallback((_name: string, angle: number) => {
      setValue(Math.min(angle, 0.25));
    }, []);
    const commitAngle = React.useCallback((_name: string, angle: number) => {
      committedAngles.push(angle);
      setValue(Math.min(angle, 0.25));
    }, []);
    return React.createElement(JointControlItem, {
      name: 'constrained_joint',
      joint: {
        id: 'constrained_joint',
        jointType: 'revolute',
        limit: { lower: -1, upper: 1, effort: 1, velocity: 1 },
      },
      value,
      angleUnit: 'rad',
      isActive: true,
      setActiveJoint: () => {},
      handleJointAngleChange: acceptAngle,
      handleJointChangeCommit: commitAngle,
      throttleDragSync: false,
    });
  }
  await act(async () => root.render(React.createElement(ConstrainedJoint)));
  const range = container.querySelector<HTMLInputElement>('input[type="range"]');
  assert.ok(range);
  await act(async () => {
    range.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    range.value = '0.75';
    range.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(Number(range.value), 0.75, 'dragging keeps immediate pointer feedback');
  await act(async () => {
    range.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  assert.deepEqual(committedAngles, [0.75], 'the requested pose reaches the constraint owner');
  assert.equal(Number(range.value), 0.25, 'release shows the already accepted constrained pose');
  const input = await openJointValueEditor(container, 0.25);
  assert.equal(input.value, '0.25');
  await act(async () => root.unmount());
  dom.window.close();
});

for (const jointType of ['revolute', 'continuous']) {
  test(`pressing the ${jointType} slider thumb without moving preserves the exact pose`, async () => {
    const { dom, container, root } = createComponentRoot();
    const value = 0.2345678912345;
    const previewAngles: number[] = [];
    const committedAngles: number[] = [];
    await renderJointControlItem(root, {
      value,
      joint: {
        id: 'R_thigh_joint',
        jointType,
        limit: { lower: -Math.PI, upper: Math.PI, effort: 1, velocity: 1 },
      },
      handleJointAngleChange: (_name, angle) => previewAngles.push(angle),
      handleJointChangeCommit: (_name, angle) => committedAngles.push(angle),
    });
    const shell = container.querySelector<HTMLElement>('[data-testid="joint-slider-shell"]');
    const thumb = container.querySelector<HTMLElement>('[data-testid="joint-slider-thumb"]');
    assert.ok(shell && thumb);
    Object.defineProperty(shell, 'getBoundingClientRect', {
      value: () => new dom.window.DOMRect(0, 0, 120, 16),
      configurable: true,
    });
    const clientX = jointType === 'continuous' ? 60 : (value + Math.PI) / (2 * Math.PI) * 120;
    await act(async () => {
      thumb.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX }));
    });
    await act(async () => {
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX }));
    });
    assert.deepEqual(previewAngles, [], 'pressing the thumb must not quantize its current value');
    assert.deepEqual(committedAngles, [value]);
    await act(async () => root.unmount());
    dom.window.close();
  });
}

test('clicking elsewhere in the joint card exits the upper limit edit mode', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderJointControlItem(root);

  const upperLimitDisplay = Array.from(container.querySelectorAll('div')).find(
    (node) => node.textContent === '3.49',
  );
  assert.ok(upperLimitDisplay, 'upper limit display should render');

  await act(async () => {
    upperLimitDisplay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  assert.equal(container.querySelectorAll('input[type="text"]').length, 1);

  const nameLabel = container.querySelector('span[title="R_thigh_joint"]');
  assert.ok(nameLabel, 'joint name label should render');

  await act(async () => {
    nameLabel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    nameLabel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    nameLabel.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    nameLabel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  assert.equal(container.querySelectorAll('input[type="text"]').length, 0);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('JointControlItem prefers an explicit display name over the raw joint name', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderJointControlItem(root, {
    displayName: 'World to Bin',
    joint: {
      id: 'world_to_world_body_0',
      name: 'world_to_world_body_0',
      jointType: 'fixed',
      limit: { lower: 0, upper: 0, effort: 1, velocity: 1 },
    },
  });

  const nameLabel = container.querySelector('span[title="World to Bin"]');
  assert.ok(nameLabel, 'friendly joint name label should render');
  assert.equal(nameLabel.textContent?.trim(), 'World to Bin');

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('joint card prefers the authored joint name for display when the internal key differs', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderJointControlItem(root, {
    name: 'joint_1743499999999',
    joint: {
      id: 'joint_1743499999999',
      name: 'joint_1',
      jointType: 'revolute',
      limit: { lower: -1.57, upper: 3.49, effort: 1, velocity: 1 },
    },
  });

  const nameLabel = Array.from(container.querySelectorAll('span')).find(
    (node) => node.textContent === 'joint_1',
  );
  assert.ok(nameLabel, 'joint card should display the authored joint name');
  assert.equal(nameLabel.getAttribute('title'), 'joint_1');

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('the main joint value editor uses the compact width and font sizing', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderJointControlItem(root);

  const currentValueDisplay = Array.from(container.querySelectorAll('div')).find(
    (node) => node.textContent === '0.00',
  );
  assert.ok(currentValueDisplay, 'current value display should render');

  const valueWrapper = currentValueDisplay.closest('div.w-\\[2\\.35rem\\]');
  assert.ok(valueWrapper, 'value display wrapper should use the compact width');

  await act(async () => {
    currentValueDisplay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  const editorInput = container.querySelector('input[type="text"]');
  assert.ok(editorInput, 'value editor should open');
  assert.match(editorInput.className, /text-\[9px\]/);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('limit editors reserve column width while editing so the slider cannot overlap them', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderJointControlItem(root);

  const lowerLimitDisplay = Array.from(container.querySelectorAll('div')).find(
    (node) => node.textContent === '-1.57',
  );
  assert.ok(lowerLimitDisplay, 'lower limit display should render');

  await act(async () => {
    lowerLimitDisplay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  const lowerInput = container.querySelector('input[type="text"]');
  assert.ok(lowerInput, 'lower limit editor should open');
  assert.match(lowerInput.parentElement?.className ?? '', /min-w-\[2\.35rem\]/);

  await act(async () => {
    lowerInput.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  });

  const upperLimitDisplay = Array.from(container.querySelectorAll('div')).find(
    (node) => node.textContent === '3.49',
  );
  assert.ok(upperLimitDisplay, 'upper limit display should render');

  await act(async () => {
    upperLimitDisplay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  const editors = Array.from(container.querySelectorAll('input[type="text"]'));
  const upperInput = editors.at(-1) ?? null;
  assert.ok(upperInput, 'upper limit editor should open');
  assert.match(upperInput.parentElement?.className ?? '', /min-w-\[2\.35rem\]/);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('advanced limit commit uses the current input value when clicking outside the editor', async () => {
  const { dom, container, root } = createComponentRoot();
  const updates: Array<{
    type: 'link' | 'joint';
    id: string;
    data: { limit?: { lower?: number } };
  }> = [];

  await renderJointControlItem(root, {
    isAdvanced: true,
    onUpdate: (type, id, data) => {
      updates.push({
        type,
        id,
        data: data as { limit?: { lower?: number } },
      });
    },
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

test('advanced limit commit targets the panel joint key when the runtime joint id differs', async () => {
  const { dom, container, root } = createComponentRoot();
  const updates: Array<{
    type: 'link' | 'joint';
    id: string;
    data: { limit?: { lower?: number } };
  }> = [];

  await renderJointControlItem(root, {
    isAdvanced: true,
    name: 'FL_hip_joint',
    joint: {
      id: 'runtime_fl_hip_joint',
      name: 'FL_hip_joint',
      jointType: 'revolute',
      limit: { lower: -1.57, upper: 3.49, effort: 1, velocity: 1 },
    },
    onUpdate: (type, id, data) => {
      updates.push({
        type,
        id,
        data: data as { limit?: { lower?: number } },
      });
    },
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

  const nameLabel = container.querySelector('span[title="FL_hip_joint"]');
  assert.ok(nameLabel, 'joint name label should render');

  await act(async () => {
    lowerInput.value = '-0.50';
    lowerInput.dispatchEvent(new Event('input', { bubbles: true }));
    nameLabel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });

  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.type, 'joint');
  assert.equal(updates[0]?.id, 'FL_hip_joint');
  assert.equal(updates[0]?.data.limit?.lower, -0.5);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('advanced limit commit does not leak non-serializable runtime joint fields into onUpdate', async () => {
  const { dom, container, root } = createComponentRoot();
  const updates: Array<{
    type: 'link' | 'joint';
    id: string;
    data: Record<string, unknown>;
  }> = [];

  const runtimeJoint = {
    id: 'runtime_fl_hip_joint',
    name: 'FL_hip_joint',
    jointType: 'revolute',
    limit: { lower: -1.57, upper: 3.49, effort: 1, velocity: 1 },
    runtimeOnly: dom.window,
    onRotationChange: () => {},
  };

  await renderJointControlItem(root, {
    isAdvanced: true,
    name: 'FL_hip_joint',
    joint: runtimeJoint,
    onUpdate: (type, id, data) => {
      updates.push({
        type,
        id,
        data: data as Record<string, unknown>,
      });
    },
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

  const nameLabel = container.querySelector('span[title="FL_hip_joint"]');
  assert.ok(nameLabel, 'joint name label should render');

  await act(async () => {
    lowerInput.value = '-0.50';
    lowerInput.dispatchEvent(new Event('input', { bubbles: true }));
    nameLabel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });

  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.id, 'FL_hip_joint');
  assert.equal((updates[0]?.data.limit as { lower?: number } | undefined)?.lower, -0.5);
  assert.equal('runtimeOnly' in (updates[0]?.data ?? {}), false);
  assert.equal('onRotationChange' in (updates[0]?.data ?? {}), false);
  assert.doesNotThrow(() => structuredClone(updates[0]?.data));

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('advanced limit editing does not persist display defaults for missing fields', async () => {
  const { dom, container, root } = createComponentRoot();
  const updates: Array<{
    limit?: { lower?: number; upper?: number; effort?: number; velocity?: number };
  }> = [];

  await renderJointControlItem(root, {
    isAdvanced: true,
    joint: {
      id: 'wheel_joint',
      name: 'wheel_joint',
      jointType: 'continuous',
      limit: {},
    },
    onUpdate: (_type, _id, data) => {
      updates.push(data as { limit?: { effort?: number } });
    },
  });

  const effortSymbol = Array.from(container.querySelectorAll('span')).find(
    (node) => node.textContent === 'τ',
  );
  const effortButton = effortSymbol?.closest('button');
  assert.ok(effortButton, 'missing effort should still have an editable display');

  await act(async () => {
    effortButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  const effortInput = container.querySelector<HTMLInputElement>('input[type="text"]');
  const nameLabel = container.querySelector('span[title="wheel_joint"]');
  assert.ok(effortInput, 'effort editor should open');
  assert.ok(nameLabel, 'joint name label should render');

  await act(async () => {
    effortInput.value = '5';
    effortInput.dispatchEvent(new Event('input', { bubbles: true }));
    nameLabel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });

  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0]?.limit, { effort: 5 });

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('limit edits keep crossed lower and upper bounds ordered before updating the joint', async () => {
  const { dom, container, root } = createComponentRoot();
  const updates: Array<{
    type: 'link' | 'joint';
    id: string;
    data: { limit?: { lower?: number; upper?: number } };
  }> = [];
  const committedAngles: number[] = [];

  await renderJointControlItem(root, {
    name: 'elbow_joint',
    joint: {
      id: 'elbow_joint',
      name: 'elbow_joint',
      jointType: 'revolute',
      limit: { lower: -1, upper: 1, effort: 1, velocity: 1 },
    },
    value: 0,
    onUpdate: (type, id, data) => {
      updates.push({
        type,
        id,
        data: data as { limit?: { lower?: number; upper?: number } },
      });
    },
    handleJointChangeCommit: (_name, angle) => {
      committedAngles.push(angle);
    },
  });

  const lowerLimitDisplay = Array.from(container.querySelectorAll('div')).find(
    (node) => node.textContent === '-1.00',
  );
  assert.ok(lowerLimitDisplay, 'lower limit display should render');

  await act(async () => {
    lowerLimitDisplay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  const lowerInput = Array.from(
    container.querySelectorAll<HTMLInputElement>('input[type="text"]'),
  ).find((node) => node.value === '-1.00');
  assert.ok(lowerInput, 'lower limit editor should open');

  const nameLabel = container.querySelector('span[title="elbow_joint"]');
  assert.ok(nameLabel, 'joint name label should render');

  await act(async () => {
    lowerInput.value = '2.00';
    lowerInput.dispatchEvent(new Event('input', { bubbles: true }));
    nameLabel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });

  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.type, 'joint');
  assert.equal(updates[0]?.id, 'elbow_joint');
  assert.deepEqual(updates[0]?.data.limit, {
    lower: 1,
    upper: 2,
    effort: 1,
    velocity: 1,
  });
  assert.deepEqual(committedAngles, [1]);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('finite-limit sliders keep imported out-of-range poses visible instead of clamping them', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderJointControlItem(root, {
    name: 'FL_calf_joint',
    joint: {
      id: 'FL_calf_joint',
      jointType: 'revolute',
      limit: { lower: -2.82, upper: -0.43, effort: 1, velocity: 1 },
    },
    value: 0,
  });

  const rangeInput = container.querySelector('input[type="range"]') as HTMLInputElement | null;
  assert.ok(rangeInput, 'slider input should render');
  assert.equal(parseFloat(rangeInput.min), -2.82);
  assert.equal(parseFloat(rangeInput.max), 0);
  assert.equal(parseFloat(rangeInput.value), 0);

  const upperLimitDisplay = Array.from(container.querySelectorAll('div')).find(
    (node) => node.textContent === '-0.43',
  );
  assert.ok(upperLimitDisplay, 'joint limit label should still show the authored upper bound');

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('pseudo-infinite authored bounds fall back to the unbounded slider window', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderJointControlItem(root, {
    name: 'MHS_TopBlades_v16',
    joint: {
      id: 'MHS_TopBlades_v16',
      jointType: 'revolute',
      limit: { lower: -1.79769e308, upper: 1.79769e308, effort: 1, velocity: 1 },
    },
    value: 0,
  });

  const rangeInput = container.querySelector('input[type="range"]') as HTMLInputElement | null;
  assert.ok(rangeInput, 'slider input should render');
  assert.equal(parseFloat(rangeInput.min), -Math.PI);
  assert.equal(parseFloat(rangeInput.max), Math.PI);

  const limitDisplays = Array.from(container.querySelectorAll('div')).map(
    (node) => node.textContent,
  );
  assert.ok(
    limitDisplays.includes('−∞'),
    'lower pseudo-infinite limit should render as negative infinity',
  );
  assert.ok(limitDisplays.includes('∞'), 'upper pseudo-infinite limit should render as infinity');

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('joint slider keeps a visible track shell around the native range input', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderJointControlItem(root);

  const rangeInput = container.querySelector('input[type="range"]') as HTMLInputElement | null;
  assert.ok(rangeInput, 'slider input should render');

  const sliderShell = container.querySelector('[data-testid="joint-slider-shell"]');
  const sliderFill = container.querySelector(
    '[data-testid="joint-slider-fill"]',
  ) as HTMLDivElement | null;
  const sliderThumb = container.querySelector(
    '[data-testid="joint-slider-thumb"]',
  ) as HTMLDivElement | null;

  assert.ok(sliderShell, 'joint slider should keep the visible shell');
  assert.ok(sliderFill, 'joint slider should render the filled track');
  assert.ok(sliderThumb, 'joint slider should render the thumb');
  assert.match(sliderFill.getAttribute('style') ?? '', /width:/);
  assert.match(sliderThumb.getAttribute('style') ?? '', /left:/);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('joint slider thumb surfaces a visible hover state when the pointer nears the handle', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderJointControlItem(root);

  const sliderShell = container.querySelector(
    '[data-testid="joint-slider-shell"]',
  ) as HTMLDivElement | null;
  const sliderThumb = container.querySelector(
    '[data-testid="joint-slider-thumb"]',
  ) as HTMLDivElement | null;
  const rangeInput = container.querySelector('input[type="range"]') as HTMLInputElement | null;

  assert.ok(sliderShell, 'joint slider shell should render');
  assert.ok(sliderThumb, 'joint slider thumb should render');
  assert.ok(rangeInput, 'joint slider input should render');

  Object.defineProperty(sliderShell, 'getBoundingClientRect', {
    value: () => ({
      bottom: 24,
      height: 20,
      left: 0,
      right: 100,
      toJSON: () => ({}),
      top: 4,
      width: 100,
      x: 0,
      y: 4,
    }),
    configurable: true,
  });

  const sliderMin = Number.parseFloat(rangeInput.min);
  const sliderMax = Number.parseFloat(rangeInput.max);
  const sliderValue = Number.parseFloat(rangeInput.value);
  const sliderPercentage = ((sliderValue - sliderMin) / (sliderMax - sliderMin)) * 100;

  await act(async () => {
    sliderShell.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        clientX: sliderPercentage,
        clientY: 14,
      }),
    );
  });

  assert.equal(sliderThumb.getAttribute('data-hovered'), 'true');

  await act(async () => {
    sliderShell.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        clientX: 90,
        clientY: 14,
      }),
    );
  });

  assert.equal(sliderThumb.getAttribute('data-hovered'), 'false');

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('joint card hover stays local to the panel item', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderJointControlItem(root);

  const jointCard = container.querySelector('[data-panel-hovered]') as HTMLDivElement | null;
  assert.ok(jointCard, 'joint card should render a local hover marker');
  assert.equal(jointCard.getAttribute('data-panel-hovered'), 'false');

  await act(async () => {
    jointCard.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });

  assert.equal(jointCard.getAttribute('data-panel-hovered'), 'true');

  await act(async () => {
    jointCard.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
  });

  assert.equal(jointCard.getAttribute('data-panel-hovered'), 'false');

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('slider drag previews locally and only commits on pointer release', async () => {
  const { dom, container, root } = createComponentRoot();
  const previewAngles: number[] = [];
  const committedAngles: number[] = [];

  await renderJointControlItem(root, {
    handleJointAngleChange: (_name, angle) => {
      previewAngles.push(angle);
    },
    handleJointChangeCommit: (_name, angle) => {
      committedAngles.push(angle);
    },
  });

  const rangeInput = container.querySelector('input[type="range"]') as HTMLInputElement | null;
  assert.ok(rangeInput, 'slider input should render');

  await act(async () => {
    assert.ok(rangeInput);
    rangeInput.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    rangeInput.value = '0.5';
    rangeInput.dispatchEvent(new Event('input', { bubbles: true }));
  });

  assert.deepEqual(committedAngles, []);
  assert.deepEqual(previewAngles, [0.5]);

  await act(async () => {
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });

  assert.deepEqual(committedAngles, [0.5]);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('native range drags ignore window pointermove echoes and stay single-sourced', async () => {
  const { dom, container, root } = createComponentRoot();
  const previewAngles: number[] = [];
  const committedAngles: number[] = [];

  await renderJointControlItem(root, {
    handleJointAngleChange: (_name, angle) => {
      previewAngles.push(angle);
    },
    handleJointChangeCommit: (_name, angle) => {
      committedAngles.push(angle);
    },
  });

  const sliderShell = container.querySelector(
    '[data-testid="joint-slider-shell"]',
  ) as HTMLDivElement | null;
  const rangeInput = container.querySelector('input[type="range"]') as HTMLInputElement | null;
  assert.ok(sliderShell, 'slider shell should render');
  assert.ok(rangeInput, 'slider input should render');

  Object.defineProperty(sliderShell, 'getBoundingClientRect', {
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 120,
      bottom: 16,
      width: 120,
      height: 16,
      toJSON: () => ({}),
    }),
    configurable: true,
  });

  await act(async () => {
    rangeInput.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 12, clientY: 8 }),
    );
  });

  await act(async () => {
    window.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: 90, clientY: 8 }),
    );
  });

  await act(async () => {
    rangeInput.value = '0.5';
    rangeInput.dispatchEvent(new Event('input', { bubbles: true }));
  });

  assert.deepEqual(previewAngles, [0.5]);

  await act(async () => {
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });

  assert.deepEqual(committedAngles, [0.5]);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('starting a slider drag activates and selects the current joint', async () => {
  const { dom, container, root } = createComponentRoot();
  const activeJointNames: Array<string | null> = [];
  const selectedJoints: Array<{ type: 'link' | 'joint'; id: string }> = [];

  await renderJointControlItem(root, {
    setActiveJoint: (jointName) => {
      activeJointNames.push(jointName);
    },
    onSelect: (type, id) => {
      selectedJoints.push({ type, id });
    },
  });

  const rangeInput = container.querySelector('input[type="range"]') as HTMLInputElement | null;
  assert.ok(rangeInput, 'slider input should render');

  await act(async () => {
    rangeInput.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 12, clientY: 6 }),
    );
  });

  assert.deepEqual(activeJointNames, ['R_thigh_joint']);
  assert.deepEqual(selectedJoints, [{ type: 'joint', id: 'R_thigh_joint' }]);

  await act(async () => {
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    root.unmount();
  });
  dom.window.close();
});

test('slider drag activation does not auto-scroll the joint panel item into view', async () => {
  const { dom, container, root } = createComponentRoot();
  const scrollCalls: unknown[] = [];

  function ManagedJointControlItem() {
    const [activeJoint, setActiveJoint] = React.useState<string | null>(null);

    return React.createElement(
      'div',
      { className: 'overflow-y-auto' },
      React.createElement(JointControlItem, {
        name: 'R_thigh_joint',
        joint: {
          id: 'R_thigh_joint',
          jointType: 'revolute',
          limit: { lower: -1.57, upper: 3.49, effort: 1, velocity: 1 },
        },
        value: 0,
        angleUnit: 'rad',
        isActive: activeJoint === 'R_thigh_joint',
        setActiveJoint: (jointName) => setActiveJoint(jointName),
        handleJointAngleChange: () => {},
        handleJointChangeCommit: () => {},
        onUpdate: () => {},
      }),
    );
  }

  await act(async () => {
    root.render(React.createElement(ManagedJointControlItem));
  });

  const scrollContainer = container.querySelector('.overflow-y-auto') as HTMLDivElement | null;
  assert.ok(scrollContainer, 'scroll container should render');

  Object.defineProperty(scrollContainer, 'scrollTo', {
    value: (options: unknown) => {
      scrollCalls.push(options);
    },
    configurable: true,
  });

  const rangeInput = container.querySelector('input[type="range"]') as HTMLInputElement | null;
  assert.ok(rangeInput, 'slider input should render');

  await act(async () => {
    rangeInput.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 12, clientY: 6 }),
    );
  });

  assert.deepEqual(scrollCalls, []);

  await act(async () => {
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    root.unmount();
  });
  dom.window.close();
});

test('dragging from the visible slider shell previews and commits without targeting the hidden range input', async () => {
  const { dom, container, root } = createComponentRoot();
  const previewAngles: number[] = [];
  const committedAngles: number[] = [];
  const activeJointNames: Array<string | null> = [];
  const draggingStates: boolean[] = [];

  await renderJointControlItem(root, {
    handleJointAngleChange: (_name, angle) => {
      previewAngles.push(angle);
    },
    handleJointChangeCommit: (_name, angle) => {
      committedAngles.push(angle);
    },
    setActiveJoint: (jointName) => {
      activeJointNames.push(jointName);
    },
    setIsDragging: (dragging) => {
      draggingStates.push(dragging);
    },
  });

  const sliderShell = container.querySelector(
    '[data-testid="joint-slider-shell"]',
  ) as HTMLDivElement | null;
  assert.ok(sliderShell, 'slider shell should render');

  Object.defineProperty(sliderShell, 'getBoundingClientRect', {
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 120,
      bottom: 16,
      width: 120,
      height: 16,
      toJSON: () => ({}),
    }),
    configurable: true,
  });

  await act(async () => {
    sliderShell.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 84, clientY: 8 }),
    );
  });

  assert.deepEqual(activeJointNames, ['R_thigh_joint']);
  assert.deepEqual(draggingStates, [true]);
  assert.equal(previewAngles.length, 1);
  assert.equal(committedAngles.length, 0);

  await act(async () => {
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });

  assert.equal(committedAngles.length, 1);
  assert.deepEqual(draggingStates, [true, false]);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('dragging from a maxed-out thumb overhang still pulls the joint back from the edge', async () => {
  const { dom, container, root } = createComponentRoot();
  const previewAngles: number[] = [];
  const committedAngles: number[] = [];

  await renderJointControlItem(root, {
    value: 3.49,
    handleJointAngleChange: (_name, angle) => {
      previewAngles.push(angle);
    },
    handleJointChangeCommit: (_name, angle) => {
      committedAngles.push(angle);
    },
  });

  const sliderShell = container.querySelector(
    '[data-testid="joint-slider-shell"]',
  ) as HTMLDivElement | null;
  const sliderThumb = container.querySelector(
    '[data-testid="joint-slider-thumb"]',
  ) as HTMLDivElement | null;
  assert.ok(sliderShell, 'slider shell should render');
  assert.ok(sliderThumb, 'slider thumb should render');

  Object.defineProperty(sliderShell, 'getBoundingClientRect', {
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 120,
      bottom: 16,
      width: 120,
      height: 16,
      toJSON: () => ({}),
    }),
    configurable: true,
  });

  await act(async () => {
    sliderThumb.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 120, clientY: 8 }),
    );
  });

  await act(async () => {
    window.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: 60, clientY: 8 }),
    );
  });

  assert.equal(
    previewAngles.length,
    1,
    'thumb drag should emit a preview update after leaving the end stop',
  );
  assert.ok(Math.abs(previewAngles[0] - 0.96) < 1e-12);

  await act(async () => {
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });

  assert.equal(committedAngles.length, 1);
  assert.ok(Math.abs(committedAngles[0] - 0.96) < 1e-12);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('dragging from a minimum thumb overhang still pulls the joint away from the left edge', async () => {
  const { dom, container, root } = createComponentRoot();
  const previewAngles: number[] = [];
  const committedAngles: number[] = [];

  await renderJointControlItem(root, {
    value: -1.57,
    handleJointAngleChange: (_name, angle) => {
      previewAngles.push(angle);
    },
    handleJointChangeCommit: (_name, angle) => {
      committedAngles.push(angle);
    },
  });

  const sliderShell = container.querySelector(
    '[data-testid="joint-slider-shell"]',
  ) as HTMLDivElement | null;
  const sliderThumb = container.querySelector(
    '[data-testid="joint-slider-thumb"]',
  ) as HTMLDivElement | null;
  assert.ok(sliderShell, 'slider shell should render');
  assert.ok(sliderThumb, 'slider thumb should render');

  Object.defineProperty(sliderShell, 'getBoundingClientRect', {
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 120,
      bottom: 16,
      width: 120,
      height: 16,
      toJSON: () => ({}),
    }),
    configurable: true,
  });

  await act(async () => {
    sliderThumb.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 8 }),
    );
  });

  await act(async () => {
    window.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: 60, clientY: 8 }),
    );
  });

  assert.equal(
    previewAngles.length,
    1,
    'left thumb drag should emit a preview update after leaving the end stop',
  );
  assert.ok(Math.abs(previewAngles[0] - 0.96) < 1e-12);

  await act(async () => {
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });

  assert.equal(committedAngles.length, 1);
  assert.ok(Math.abs(committedAngles[0] - 0.96) < 1e-12);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('slider drag ignores transient external echoes until the drag finishes', async () => {
  const { dom, container, root } = createComponentRoot();
  const previewAngles: number[] = [];
  const committedAngles: number[] = [];

  const handleJointAngleChange = (_name: string, angle: number) => {
    previewAngles.push(angle);
  };
  const handleJointChangeCommit = (_name: string, angle: number) => {
    committedAngles.push(angle);
  };

  await renderJointControlItem(root, {
    value: 0,
    handleJointAngleChange,
    handleJointChangeCommit,
  });

  let rangeInput = container.querySelector('input[type="range"]') as HTMLInputElement | null;
  assert.ok(rangeInput, 'slider input should render');
  const sliderInput = rangeInput;

  await act(async () => {
    sliderInput.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    sliderInput.value = '0.5';
    sliderInput.dispatchEvent(new Event('input', { bubbles: true }));
  });

  await renderJointControlItem(root, {
    value: 12,
    handleJointAngleChange,
    handleJointChangeCommit,
  });

  rangeInput = container.querySelector('input[type="range"]') as HTMLInputElement | null;
  assert.ok(rangeInput, 'slider input should stay mounted after rerender');
  assert.equal(parseFloat(rangeInput.max), 3.49);
  assert.ok(
    container.textContent?.includes('0.50'),
    'value display should keep the local drag preview',
  );

  await act(async () => {
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });

  assert.deepEqual(previewAngles, [0.5]);
  assert.deepEqual(committedAngles, [0.5]);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});
