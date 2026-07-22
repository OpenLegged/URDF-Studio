import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { useUIStore } from '@/store/uiStore';
import { InlineInputGroup, NumberInput, ReadonlyVectorStatRow } from './FormControls.tsx';
import { TransformFields } from './TransformFields.tsx';
import type { EulerRadiansValue } from '../utils/rotationFormat.ts';

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
  (globalThis as { InputEvent?: typeof InputEvent }).InputEvent = dom.window.InputEvent;
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
  if (!('setPointerCapture' in dom.window.HTMLElement.prototype)) {
    Object.defineProperty(dom.window.HTMLElement.prototype, 'setPointerCapture', {
      value: () => {},
      configurable: true,
    });
  }
  if (!('releasePointerCapture' in dom.window.HTMLElement.prototype)) {
    Object.defineProperty(dom.window.HTMLElement.prototype, 'releasePointerCapture', {
      value: () => {},
      configurable: true,
    });
  }
  if (!('hasPointerCapture' in dom.window.HTMLElement.prototype)) {
    Object.defineProperty(dom.window.HTMLElement.prototype, 'hasPointerCapture', {
      value: () => false,
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

function NumberInputHarness({
  initialValue,
  label,
  min,
  step = 0.1,
  commitOnBlurOnly = false,
}: {
  initialValue: number;
  label: string;
  min?: number;
  step?: number;
  commitOnBlurOnly?: boolean;
}) {
  const [value, setValue] = React.useState(initialValue);

  return React.createElement(
    'div',
    null,
    React.createElement(NumberInput, {
      value,
      onChange: setValue,
      label,
      min,
      step,
      commitOnBlurOnly,
    }),
    React.createElement('output', { 'data-testid': 'committed-value' }, String(value)),
  );
}

function DeferredCommitNumberInputHarness() {
  const [value, setValue] = React.useState(0.001);
  const [pendingValue, setPendingValue] = React.useState<number | null>(null);
  const [, forceStaleRender] = React.useState(0);

  return React.createElement(
    'div',
    null,
    React.createElement(NumberInput, {
      value,
      onChange: (nextValue: number) => {
        setPendingValue(nextValue);
        forceStaleRender((renderCount) => renderCount + 1);
      },
      label: 'Scale X',
      commitOnBlurOnly: true,
      precision: 6,
    }),
    React.createElement('output', { 'data-testid': 'committed-value' }, String(value)),
    React.createElement(
      'output',
      { 'data-testid': 'pending-value' },
      pendingValue === null ? '' : String(pendingValue),
    ),
    React.createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'apply-pending',
        onClick: () => {
          if (pendingValue !== null) {
            setValue(pendingValue);
            setPendingValue(null);
          }
        },
      },
      'Apply pending',
    ),
  );
}

function TransformFieldsHarness({
  initialRotationValue,
}: {
  initialRotationValue: EulerRadiansValue;
}) {
  const [rotationValue, setRotationValue] = React.useState(initialRotationValue);

  return React.createElement(
    'div',
    null,
    React.createElement(TransformFields, {
      lang: 'en',
      positionValue: { x: 1, y: 2, z: 3 },
      rotationValue,
      onPositionChange: () => {},
      onRotationChange: setRotationValue,
    }),
    React.createElement(
      'output',
      { 'data-testid': 'rotation-value' },
      JSON.stringify(rotationValue),
    ),
  );
}

async function renderHarness(
  root: Root,
  props: {
    initialValue: number;
    label: string;
    min?: number;
    step?: number;
  },
) {
  await act(async () => {
    root.render(React.createElement(NumberInputHarness, props));
  });
}

function getCommittedValue(container: Element): string {
  const output = container.querySelector('[data-testid="committed-value"]');
  assert.ok(output, 'committed value output should exist');
  return output.textContent ?? '';
}

function getTextInput(container: Element): HTMLInputElement {
  const input = container.querySelector('input[type="text"]');
  assert.ok(input, 'text input should exist');
  return input as HTMLInputElement;
}

function getTextInputByLabel(container: Element, label: string): HTMLInputElement {
  const input = container.querySelector(`input[aria-label="${label}"]`);
  assert.ok(input, `text input "${label}" should exist`);
  return input as HTMLInputElement;
}

function getRotationValue(container: Element): EulerRadiansValue {
  const output = container.querySelector('[data-testid="rotation-value"]');
  assert.ok(output, 'rotation value output should exist');
  return JSON.parse(output.textContent ?? '{}') as EulerRadiansValue;
}

function getStepperButton(container: Element, label: string): HTMLButtonElement {
  const button = container.querySelector(`button[aria-label="${label}"]`);
  assert.ok(button, `button "${label}" should exist`);
  return button as HTMLButtonElement;
}

function setInputValue(input: HTMLInputElement, value: string) {
  const prototype = input.ownerDocument.defaultView?.HTMLInputElement.prototype;
  const valueSetter = prototype
    ? Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    : undefined;

  assert.ok(valueSetter, 'HTMLInputElement value setter should exist');
  valueSetter.call(input, value);
}

function getReactProps(node: Element): Record<string, unknown> {
  const reactPropsKey = Object.keys(node).find((key) => key.startsWith('__reactProps$'));
  assert.ok(reactPropsKey, 'React props key should exist on rendered element');
  return (node as unknown as Record<string, unknown>)[reactPropsKey] as Record<string, unknown>;
}

function dispatchReactChange(input: HTMLInputElement, value: string) {
  setInputValue(input, value);
  const reactProps = getReactProps(input);
  const onChange = reactProps.onChange;
  assert.equal(typeof onChange, 'function', 'React onChange handler should exist');

  (onChange as (event: { target: HTMLInputElement; currentTarget: HTMLInputElement }) => void)({
    target: input,
    currentTarget: input,
  });
}

function dispatchReactFocus(input: HTMLInputElement) {
  input.focus();
  const reactProps = getReactProps(input);
  const onFocus = reactProps.onFocus;
  assert.equal(typeof onFocus, 'function', 'React onFocus handler should exist');

  (onFocus as (event: { target: HTMLInputElement; currentTarget: HTMLInputElement }) => void)({
    target: input,
    currentTarget: input,
  });
}

function dispatchReactBlur(input: HTMLInputElement) {
  const reactProps = getReactProps(input);
  const onBlur = reactProps.onBlur;
  assert.equal(typeof onBlur, 'function', 'React onBlur handler should exist');

  (onBlur as (event: { target: HTMLInputElement; currentTarget: HTMLInputElement }) => void)({
    target: input,
    currentTarget: input,
  });
}

function dispatchReactKeyDown(input: HTMLInputElement, key: string) {
  const reactProps = getReactProps(input);
  const onKeyDown = reactProps.onKeyDown;
  assert.equal(typeof onKeyDown, 'function', 'React onKeyDown handler should exist');

  (onKeyDown as (event: {
    key: string;
    target: HTMLInputElement;
    currentTarget: HTMLInputElement;
    preventDefault: () => void;
  }) => void)({
    key,
    target: input,
    currentTarget: input,
    preventDefault: () => {},
  });
}

test('pointer down applies the first step immediately before pointer up', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    await renderHarness(root, {
      initialValue: 1,
      label: 'Radius',
      step: 0.1,
    });

    const increaseButton = getStepperButton(container, 'Increase Radius');

    await act(async () => {
      increaseButton.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerId: 1,
        }),
      );
    });

    assert.equal(getCommittedValue(container), '1.1');
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('dragging a number input horizontally applies its configured step in both directions', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    await renderHarness(root, {
      initialValue: 1,
      label: 'Radius',
      step: 0.1,
    });

    const input = getTextInput(container);

    await act(async () => {
      input.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          button: 0,
          clientX: 100,
          pointerId: 7,
        }),
      );
      input.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          clientX: 124,
          pointerId: 7,
        }),
      );
    });

    assert.equal(getCommittedValue(container), '1.6');
    assert.equal(dom.window.document.body.style.userSelect, 'none');

    await act(async () => {
      input.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          clientX: 108,
          pointerId: 7,
        }),
      );
      input.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          clientX: 108,
          pointerId: 7,
        }),
      );
    });

    assert.equal(getCommittedValue(container), '1.2');
    assert.equal(dom.window.document.body.style.userSelect, '');
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('typing a parseable value updates the committed value before blur', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    await renderHarness(root, {
      initialValue: 1,
      label: 'Radius',
    });

    const input = getTextInput(container);

    await act(async () => {
      input.focus();
      dispatchReactChange(input, '2.5');
    });

    assert.equal(getCommittedValue(container), '2.5');
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('commit-on-blur inputs keep the entered value while a parent prop update catches up', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    await act(async () => {
      root.render(React.createElement(DeferredCommitNumberInputHarness));
    });

    const input = getTextInput(container);

    await act(async () => {
      dispatchReactFocus(input);
      dispatchReactChange(input, '0.0001');
    });

    assert.equal(input.value, '0.0001');
    assert.equal(getCommittedValue(container), '0.001');

    await act(async () => {
      dispatchReactKeyDown(input, 'Enter');
      dispatchReactBlur(input);
    });

    assert.equal(
      input.value,
      '0.0001',
      'the input should not flash back to the previous prop value after Enter commits',
    );
    assert.equal(getCommittedValue(container), '0.001');

    const pendingOutput = container.querySelector('[data-testid="pending-value"]');
    assert.equal(pendingOutput?.textContent, '0.0001');

    const applyButton = container.querySelector(
      '[data-testid="apply-pending"]',
    ) as HTMLButtonElement | null;
    assert.ok(applyButton, 'apply pending button should exist');

    await act(async () => {
      applyButton.click();
    });

    assert.equal(getCommittedValue(container), '0.0001');
    assert.equal(input.value, '0.0001');
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('min clamps positive-only values during stepper and typed edits', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    await renderHarness(root, {
      initialValue: 0.05,
      label: 'Radius',
      min: 0,
      step: 0.1,
    });

    const decreaseButton = getStepperButton(container, 'Decrease Radius');

    await act(async () => {
      decreaseButton.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerId: 2,
        }),
      );
    });

    assert.equal(getCommittedValue(container), '0');

    const input = getTextInput(container);
    await act(async () => {
      input.focus();
      dispatchReactChange(input, '-3');
    });

    assert.equal(getCommittedValue(container), '0');
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('TransformFields defaults to inline axis labels for position and rotation rows', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    await act(async () => {
      useUIStore.setState({ rotationDisplayMode: 'euler_deg' });
      root.render(
        React.createElement(TransformFields, {
          lang: 'en',
          positionValue: { x: 1, y: 2, z: 3 },
          rotationValue: { r: 0.1, p: 0.2, y: 0.3 },
          onPositionChange: () => {},
          onRotationChange: () => {},
        }),
      );
    });

    const xLabel = Array.from(container.querySelectorAll('span')).find(
      (node) => node.textContent === 'X',
    );
    assert.ok(xLabel, 'position X label should render');
    assert.match(
      xLabel.className,
      /\btruncate\b/,
      'position axis labels should truncate instead of forcing the inline row wider',
    );
    assert.match(
      xLabel.parentElement?.className ?? '',
      /\bmin-w-0\b/,
      'position axis rows should remain shrinkable inside the transform grid',
    );

    const rollLabel = Array.from(container.querySelectorAll('span')).find(
      (node) => node.textContent === 'Roll',
    );
    assert.ok(rollLabel, 'rotation roll label should render');
    assert.match(
      rollLabel.className,
      /\btruncate\b/,
      'rotation axis labels should truncate instead of forcing the inline row wider',
    );
    assert.match(
      rollLabel.parentElement?.className ?? '',
      /\bmin-w-0\b/,
      'rotation axis rows should remain shrinkable inside the transform grid',
    );
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('InlineInputGroup keeps labels content-sized while preserving a single-line input row', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    await act(async () => {
      root.render(
        React.createElement(
          InlineInputGroup,
          {
            label: 'Direction',
            labelWidthClassName: 'w-16 whitespace-nowrap',
          },
          React.createElement('input', {
            type: 'text',
            value: '1 (Normal)',
            readOnly: true,
          }),
        ),
      );
    });

    const label = container.querySelector('label');
    assert.ok(label, 'inline input label should render');
    assert.equal(label.style.width, 'fit-content');

    const row = label.parentElement;
    assert.ok(row, 'inline input row should render');
    assert.match(row.className, /\bflex-nowrap\b/);
    assert.match(row.className, /\bmin-w-0\b/);

    const content = row.querySelector('div.min-w-0.flex-1');
    assert.ok(content, 'inline input content slot should keep flex growth');
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('TransformFields renders per-axis rotation rows with compact +/-90 shortcuts when enabled', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    await act(async () => {
      useUIStore.setState({ rotationDisplayMode: 'euler_deg' });
      root.render(
        React.createElement(TransformFields, {
          lang: 'en',
          positionValue: { x: 1, y: 2, z: 3 },
          rotationValue: { r: 0.1, p: 0.2, y: 0.3 },
          onPositionChange: () => {},
          onRotationChange: () => {},
          rotationQuickStepDegrees: 90,
        }),
      );
    });

    assert.equal(container.querySelectorAll('button[aria-label$="increase 90°"]').length, 3);
    assert.equal(container.querySelectorAll('button[aria-label$="decrease 90°"]').length, 3);
    assert.equal(container.querySelector('button[aria-label="Roll increase 180°"]'), null);
    assert.equal(container.querySelector('button[aria-label="Roll reset 0°"]'), null);
    const rollInput = container.querySelector(
      'input[aria-label="Roll"]',
    ) as HTMLInputElement | null;
    const pitchInput = container.querySelector(
      'input[aria-label="Pitch"]',
    ) as HTMLInputElement | null;
    const yawInput = container.querySelector('input[aria-label="Yaw"]') as HTMLInputElement | null;
    assert.ok(rollInput);
    assert.ok(pitchInput);
    assert.ok(yawInput);
    assert.equal(rollInput.value, '5.729578');
    assert.equal(pitchInput.value, '11.459156');
    assert.equal(yawInput.value, '17.188734');
    assert.equal(container.textContent?.includes('-90'), true);
    assert.equal(container.textContent?.includes('+90'), true);
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('TransformFields keeps quick rotation shortcuts on a single shrinkable row', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    await act(async () => {
      useUIStore.setState({ rotationDisplayMode: 'euler_deg' });
      root.render(
        React.createElement(TransformFields, {
          lang: 'en',
          positionValue: { x: 1, y: 2, z: 3 },
          rotationValue: { r: 0.1, p: 0.2, y: 0.3 },
          onPositionChange: () => {},
          onRotationChange: () => {},
          rotationQuickStepDegrees: 90,
        }),
      );
    });

    const rollInput = getTextInputByLabel(container, 'Roll');
    const rollDecreaseButton = container.querySelector(
      'button[aria-label="Roll decrease 90°"]',
    ) as HTMLButtonElement | null;
    assert.ok(rollDecreaseButton, 'roll decrease shortcut should exist');

    const inputSlot = rollInput.parentElement?.parentElement?.parentElement;
    assert.ok(inputSlot, 'roll input grow slot should exist');
    assert.match(
      inputSlot.className,
      /\bbasis-0\b/,
      'rotation input slot should be allowed to shrink instead of forcing the shortcut group to wrap',
    );
    assert.doesNotMatch(
      inputSlot.className,
      /\bmin-w-\[7\.5rem\]\b/,
      'rotation input slot should not keep a hard minimum width that ejects quick-step buttons',
    );

    const row = inputSlot.parentElement;
    assert.ok(row, 'roll rotation row should exist');
    assert.match(
      row.className,
      /\bflex-nowrap\b/,
      'rotation quick-step rows should stay on a single line when space is available',
    );
    assert.doesNotMatch(
      row.className,
      /\bflex-wrap\b/,
      'rotation quick-step rows should not allow the shortcut group to wrap to a second line',
    );
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('TransformFields renders radian values with symbolic pi formatting', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    await act(async () => {
      useUIStore.setState({ rotationDisplayMode: 'euler_rad' });
      root.render(
        React.createElement(TransformFieldsHarness, {
          initialRotationValue: {
            r: -Math.PI / 2,
            p: Math.PI / 4,
            y: Math.PI,
          },
        }),
      );
    });

    assert.equal(getTextInputByLabel(container, 'Roll').value, '-π/2');
    assert.equal(getTextInputByLabel(container, 'Pitch').value, 'π/4');
    assert.equal(getTextInputByLabel(container, 'Yaw').value, 'π');
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('TransformFields accepts pai-style radian edits and normalizes them into symbolic pi values', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    await act(async () => {
      useUIStore.setState({ rotationDisplayMode: 'euler_rad' });
      root.render(
        React.createElement(TransformFieldsHarness, {
          initialRotationValue: { r: 0, p: 0, y: 0 },
        }),
      );
    });

    const rollInput = getTextInputByLabel(container, 'Roll');
    await act(async () => {
      rollInput.focus();
      dispatchReactChange(rollInput, '-pai/2');
    });

    const nextRotationValue = getRotationValue(container);
    assert.ok(Math.abs(nextRotationValue.r + Math.PI / 2) < 1e-7);
    assert.equal(nextRotationValue.p, 0);
    assert.equal(nextRotationValue.y, 0);
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('TransformFields renders quaternion inputs in a compact two-column grid', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    await act(async () => {
      useUIStore.setState({ rotationDisplayMode: 'quaternion' });
      root.render(
        React.createElement(TransformFieldsHarness, {
          initialRotationValue: { r: 0, p: 0, y: 0 },
        }),
      );
    });

    assert.equal(container.querySelectorAll('input[aria-label^="Quaternion "]').length, 4);
    assert.ok(container.textContent?.includes('X'));
    assert.ok(container.textContent?.includes('Y'));
    assert.ok(container.textContent?.includes('Z'));
    assert.ok(container.textContent?.includes('W'));
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('TransformFields renders per-axis radian rotation rows with compact +/-π/2 shortcuts when enabled', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    await act(async () => {
      useUIStore.setState({ rotationDisplayMode: 'euler_rad' });
      root.render(
        React.createElement(TransformFields, {
          lang: 'en',
          positionValue: { x: 1, y: 2, z: 3 },
          rotationValue: { r: 0, p: Math.PI / 4, y: -Math.PI / 2 },
          onPositionChange: () => {},
          onRotationChange: () => {},
          rotationQuickStepDegrees: 90,
        }),
      );
    });

    assert.equal(container.querySelectorAll('button[aria-label$="increase π/2"]').length, 3);
    assert.equal(container.querySelectorAll('button[aria-label$="decrease π/2"]').length, 3);
    assert.equal(container.textContent?.includes('-π/2'), true);
    assert.equal(container.textContent?.includes('+π/2'), true);

    const rollInput = container.querySelector(
      'input[aria-label="Roll"]',
    ) as HTMLInputElement | null;
    const pitchInput = container.querySelector(
      'input[aria-label="Pitch"]',
    ) as HTMLInputElement | null;
    const yawInput = container.querySelector('input[aria-label="Yaw"]') as HTMLInputElement | null;
    assert.ok(rollInput);
    assert.ok(pitchInput);
    assert.ok(yawInput);
    assert.equal(rollInput.value, '0');
    assert.equal(pitchInput.value, 'π/4');
    assert.equal(yawInput.value, '-π/2');
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('ReadonlyVectorStatRow renders aligned value cells without repeated axis subtitles', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    await act(async () => {
      root.render(
        React.createElement(ReadonlyVectorStatRow, {
          label: 'A1',
          values: ['1.0', '0.0', '0.0'],
        }),
      );
    });

    assert.equal(container.textContent?.includes('A1'), true);
    assert.equal(container.textContent?.includes('X'), false);
    assert.equal(container.textContent?.includes('Y'), false);
    assert.equal(container.textContent?.includes('Z'), false);
  } finally {
    await destroyComponentRoot(dom, root);
  }
});
