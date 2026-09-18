import assert from 'node:assert/strict';
import test from 'node:test';

import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { useControllableState } from './useControllableState';

function installDom() {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');

  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: dom.window.document,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    value: dom.window.HTMLElement,
  });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    value: true,
  });

  return {
    rootElement: dom.window.document.getElementById('root') as HTMLElement,
    restore() {
      dom.window.close();
      Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: originalDocument,
      });
      Object.defineProperty(globalThis, 'HTMLElement', {
        configurable: true,
        value: originalHTMLElement,
      });
      Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
        configurable: true,
        value: originalActEnvironment,
      });
    },
  };
}

type NumberSetter = (nextValue: number | ((previousValue: number) => number)) => void;

function requireSetter(setter: NumberSetter | null): NumberSetter {
  assert.ok(setter);
  return setter;
}

test('uncontrolled setter stays stable and queues functional updates against the latest value', async () => {
  const dom = installDom();
  const root = createRoot(dom.rootElement);
  const firstChanges: number[] = [];
  const secondChanges: number[] = [];
  let setter: NumberSetter | null = null;

  function Harness({ onChange }: { onChange: (value: number) => void }) {
    const [value, setValue] = useControllableState({ defaultValue: 0, onChange });
    setter = setValue;
    return <span>{value}</span>;
  }

  try {
    await act(async () => {
      root.render(<Harness onChange={(value) => firstChanges.push(value)} />);
    });
    const initialSetter = requireSetter(setter);

    await act(async () => {
      initialSetter((previousValue) => previousValue + 1);
      initialSetter((previousValue) => previousValue + 1);
    });

    assert.equal(dom.rootElement.textContent, '2');
    assert.deepEqual(firstChanges, [1, 2]);
    assert.equal(setter, initialSetter);

    await act(async () => {
      root.render(<Harness onChange={(value) => secondChanges.push(value)} />);
    });
    assert.equal(setter, initialSetter);

    await act(async () => {
      initialSetter(3);
    });
    assert.deepEqual(firstChanges, [1, 2]);
    assert.deepEqual(secondChanges, [3]);
  } finally {
    await act(async () => root.unmount());
    dom.restore();
  }
});

test('controlled setter keeps its identity while reading the latest prop value', async () => {
  const dom = installDom();
  const root = createRoot(dom.rootElement);
  const changes: number[] = [];
  let setter: NumberSetter | null = null;

  function Harness({ value }: { value: number }) {
    const [resolvedValue, setValue] = useControllableState({
      value,
      defaultValue: 0,
      onChange: (nextValue) => changes.push(nextValue),
    });
    setter = setValue;
    return <span>{resolvedValue}</span>;
  }

  try {
    await act(async () => {
      root.render(<Harness value={10} />);
    });
    const initialSetter = requireSetter(setter);

    await act(async () => {
      root.render(<Harness value={20} />);
    });
    assert.equal(setter, initialSetter);

    await act(async () => {
      initialSetter((previousValue) => previousValue + 1);
    });
    assert.deepEqual(changes, [21]);
    assert.equal(dom.rootElement.textContent, '20', 'the prop remains the controlled source of truth');
  } finally {
    await act(async () => root.unmount());
    dom.restore();
  }
});
