import assert from 'node:assert/strict';
import test from 'node:test';

import { disposeParseUsdWorker, parseUsdScene } from './parseUsd';

type WorkerListener = EventListenerOrEventListenerObject;

class FailingParseUsdWorker {
  static readonly instances: FailingParseUsdWorker[] = [];
  static behavior: 'error' | 'messageerror' | 'pending' = 'error';
  static failNextConstructor = false;

  private readonly listeners = new Map<string, Set<WorkerListener>>();

  terminated = false;

  constructor() {
    if (FailingParseUsdWorker.failNextConstructor) {
      FailingParseUsdWorker.failNextConstructor = false;
      throw new Error('USD worker constructor failed');
    }
    FailingParseUsdWorker.instances.push(this);
  }

  addEventListener(type: string, listener: WorkerListener): void {
    const listeners = this.listeners.get(type) ?? new Set<WorkerListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: WorkerListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(): void {
    if (FailingParseUsdWorker.behavior === 'pending') return;
    queueMicrotask(() => {
      this.emitFailure(FailingParseUsdWorker.behavior);
    });
  }

  emitFailure(type: 'error' | 'messageerror'): void {
    const event = new Event(type);
    if (type === 'error') {
      Object.defineProperties(event, {
        error: { value: new Error('USD worker crashed') },
        message: { value: 'USD worker crashed' },
      });
    }
    this.emit(type, event);
  }

  terminate(): void {
    this.terminated = true;
  }

  private emit(type: string, event: Event): void {
    this.listeners.get(type)?.forEach((listener) => {
      if (typeof listener === 'function') listener(event);
      else listener.handleEvent(event);
    });
  }
}

function installFakeWorker(): () => void {
  const originalWorker = globalThis.Worker;
  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    value: FailingParseUsdWorker,
  });
  return () => {
    disposeParseUsdWorker();
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: originalWorker,
    });
  };
}

test('parseUsdScene rejects all pending calls on a crash and recreates the worker', async () => {
  const restoreWorker = installFakeWorker();
  FailingParseUsdWorker.behavior = 'pending';

  try {
    const first = parseUsdScene('#usda 1.0', 'first.usda');
    const second = parseUsdScene('#usda 1.0', 'second.usda');
    const firstRejection = assert.rejects(first, /USD worker crashed/);
    const secondRejection = assert.rejects(second, /USD worker crashed/);
    const crashedWorker = FailingParseUsdWorker.instances.at(-1);
    assert.ok(crashedWorker);
    crashedWorker.emitFailure('error');
    await Promise.all([firstRejection, secondRejection]);

    FailingParseUsdWorker.behavior = 'error';
    await assert.rejects(parseUsdScene('#usda 1.0', 'second.usda'), /USD worker crashed/);

    assert.equal(FailingParseUsdWorker.instances.at(-2)?.terminated, true);
    assert.equal(FailingParseUsdWorker.instances.at(-1)?.terminated, true);
  } finally {
    restoreWorker();
  }
});

test('parseUsdScene rejects message deserialization failures', async () => {
  const restoreWorker = installFakeWorker();
  FailingParseUsdWorker.behavior = 'messageerror';
  try {
    await assert.rejects(
      parseUsdScene('#usda 1.0', 'message-error.usda'),
      /message deserialization failed/,
    );
  } finally {
    restoreWorker();
  }
});

test('dispose rejects pending USD parses and a constructor failure can be retried', async () => {
  const restoreWorker = installFakeWorker();
  try {
    FailingParseUsdWorker.failNextConstructor = true;
    await assert.rejects(
      parseUsdScene('#usda 1.0', 'constructor.usda'),
      /constructor failed/,
    );

    FailingParseUsdWorker.behavior = 'pending';
    const pending = parseUsdScene('#usda 1.0', 'pending.usda');
    const rejection = assert.rejects(pending, /worker disposed/);
    disposeParseUsdWorker();
    await rejection;
    assert.equal(FailingParseUsdWorker.instances.at(-1)?.terminated, true);
  } finally {
    restoreWorker();
  }
});
