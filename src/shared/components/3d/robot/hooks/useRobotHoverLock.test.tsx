import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { useRobotHoverLock } from './useRobotHoverLock';

test('renderer hover locks isolate instances, honor the host, and release only their owner', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const oldAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
  const root = createRoot(dom.window.document.getElementById('root')!);
  type Lock = ReturnType<typeof useRobotHoverLock>;
  const locks = new Map<string, Lock>();
  const owners = new Set<string>();
  const hostPorts = {
    a: (frozen: boolean) => frozen ? owners.add('a') : owners.delete('a'),
    b: (frozen: boolean) => frozen ? owners.add('b') : owners.delete('b'),
  };
  function Probe({ id, enabled = true, externalFrozen = false }: {
    id: 'a' | 'b'; enabled?: boolean; externalFrozen?: boolean;
  }) {
    locks.set(id, useRobotHoverLock({ enabled, externalFrozen, onFrozenChange: hostPorts[id] }));
    return null;
  }
  function lock(id: string) {
    const result = locks.get(id);
    assert.ok(result);
    return result;
  }
  try {
    await act(async () => root.render(<><Probe key="a" id="a" /><Probe key="b" id="b" /></>));
    await act(async () => lock('a').setFrozen(true));
    assert.equal(lock('a').frozen, true);
    assert.equal(lock('b').frozen, false, 'unrelated canvas stays interactive');
    await act(async () => lock('b').setFrozen(true));
    await act(async () => root.render(<><Probe key="b" id="b" /></>));
    assert.deepEqual([...owners], ['b'], 'unmount releases only the departing host port');
    assert.equal(lock('b').frozen, true);
    await act(async () => root.render(<><Probe key="b" id="b" enabled={false} /></>));
    assert.equal(lock('b').frozen, false);
    assert.equal(owners.size, 0, 'disabling interaction releases the local lock');
    await act(async () => root.render(<><Probe key="b" id="b" externalFrozen /></>));
    assert.equal(lock('b').frozen, true, 'the application may explicitly coordinate locks');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of [
      ['window', oldWindow], ['document', oldDocument], ['IS_REACT_ACT_ENVIRONMENT', oldAct],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
