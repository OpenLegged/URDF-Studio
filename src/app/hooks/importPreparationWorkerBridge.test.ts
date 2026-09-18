import test from 'node:test';
import assert from 'node:assert/strict';

import {
  configureImportPreparationWorkerTimeouts,
  disposeImportPreparationWorker,
  hydrateDeferredImportAssetsWithWorker,
  prepareImportPayloadWithWorker,
} from './importPreparationWorkerBridge.ts';

type WorkerEventHandler = (event: { data?: unknown; error?: unknown; message?: string }) => void;

class FakeWorker {
  private readonly listeners = new Map<string, Set<WorkerEventHandler>>();

  public readonly postedMessages: unknown[] = [];

  public terminated = false;

  addEventListener(type: string, handler: WorkerEventHandler): void {
    const handlers = this.listeners.get(type) ?? new Set<WorkerEventHandler>();
    handlers.add(handler);
    this.listeners.set(type, handlers);
  }

  removeEventListener(type: string, handler: WorkerEventHandler): void {
    this.listeners.get(type)?.delete(handler);
  }

  postMessage(message: unknown): void {
    this.postedMessages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emitMessageError(error: Error): void {
    this.listeners.get('messageerror')?.forEach((handler) => {
      handler({ error, message: error.message });
    });
  }

  emitMessage(data: unknown): void {
    this.listeners.get('message')?.forEach((handler) => {
      handler({ data });
    });
  }
}

test('import preparation worker bridge rejects immediately when Worker is unavailable', async () => {
  const originalWorker = globalThis.Worker;

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: undefined,
  });

  try {
    await assert.rejects(
      prepareImportPayloadWithWorker({
        files: [],
        existingPaths: [],
      }),
      /Web Worker is not available in this environment/i,
    );
  } finally {
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      writable: true,
      value: originalWorker,
    });
  }
});

test('import preparation worker bridge rejects pending work when message transfer fails', async () => {
  const originalWorker = globalThis.Worker;
  const fakeWorkers: FakeWorker[] = [];
  const createFakeWorker = function ImportPreparationWorkerMock() {
    const worker = new FakeWorker();
    fakeWorkers.push(worker);
    return worker;
  };

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: createFakeWorker as unknown as typeof Worker,
  });

  try {
    const resultPromise = prepareImportPayloadWithWorker({
      files: [],
      existingPaths: [],
    });

    const fakeWorker = fakeWorkers[0];
    assert.ok(fakeWorker);
    assert.equal(fakeWorker.postedMessages.length, 1);
    fakeWorker.emitMessageError(new Error('structured clone failed'));

    await assert.rejects(resultPromise, /message transfer failed/i);
    assert.equal(fakeWorker.terminated, true);
  } finally {
    disposeImportPreparationWorker();
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      writable: true,
      value: originalWorker,
    });
  }
});

test('idle watchdog fails a pending request after the worker goes silent', async () => {
  const originalWorker = globalThis.Worker;
  const fakeWorkers: FakeWorker[] = [];
  const createFakeWorker = function ImportPreparationWorkerMock() {
    const worker = new FakeWorker();
    fakeWorkers.push(worker);
    return worker;
  };

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: createFakeWorker as unknown as typeof Worker,
  });
  configureImportPreparationWorkerTimeouts({
    idleTimeoutMs: 50,
    hardTimeoutMs: 5 * 60 * 1000,
  });

  try {
    const resultPromise = prepareImportPayloadWithWorker({
      files: [],
      existingPaths: [],
    });

    const fakeWorker = fakeWorkers[0];
    assert.ok(fakeWorker);
    assert.equal(fakeWorker.postedMessages.length, 1);
    // Worker accepts the request but never responds: simulate a hard kill.

    await assert.rejects(resultPromise, /idle timeout.*50 ms/i);
    assert.equal(fakeWorker.terminated, true);
  } finally {
    disposeImportPreparationWorker();
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      writable: true,
      value: originalWorker,
    });
  }
});

test('idle watchdog resets when the worker keeps posting heartbeats', async () => {
  const originalWorker = globalThis.Worker;
  const fakeWorkers: FakeWorker[] = [];
  const createFakeWorker = function ImportPreparationWorkerMock() {
    const worker = new FakeWorker();
    fakeWorkers.push(worker);
    return worker;
  };

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: createFakeWorker as unknown as typeof Worker,
  });
  configureImportPreparationWorkerTimeouts({
    idleTimeoutMs: 60,
    hardTimeoutMs: 5 * 60 * 1000,
  });

  try {
    const resultPromise = prepareImportPayloadWithWorker({
      files: [],
      existingPaths: [],
    });

    const fakeWorker = fakeWorkers[0];
    assert.ok(fakeWorker);
    const requestId = (fakeWorker.postedMessages[0] as { requestId: number }).requestId;

    // Heartbeats are independent of import progress, which can legitimately
    // pause during a large archive extraction.
    for (let tick = 0; tick < 3; tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      fakeWorkers[0].emitMessage({
        type: 'import-preparation-heartbeat',
        requestId,
      });
    }

    // Still pending: the watchdog was reset by heartbeat activity.
    const stillPending = await Promise.race([
      resultPromise.then(
        () => 'settled',
        () => 'settled',
      ),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 10)),
    ]);
    assert.equal(stillPending, 'pending');

    // Stop responding: the idle watchdog now fires.
    await assert.rejects(resultPromise, /idle timeout/i);
  } finally {
    disposeImportPreparationWorker();
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      writable: true,
      value: originalWorker,
    });
  }
});

test('hard timeout is not extended by worker heartbeats', async () => {
  const originalWorker = globalThis.Worker;
  const fakeWorkers: FakeWorker[] = [];
  const createFakeWorker = function ImportPreparationWorkerMock() {
    const worker = new FakeWorker();
    fakeWorkers.push(worker);
    return worker;
  };

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: createFakeWorker as unknown as typeof Worker,
  });
  configureImportPreparationWorkerTimeouts({
    idleTimeoutMs: 60,
    hardTimeoutMs: 100,
  });

  try {
    const resultPromise = prepareImportPayloadWithWorker({
      files: [],
      existingPaths: [],
    });
    const fakeWorker = fakeWorkers[0];
    assert.ok(fakeWorker);
    const requestId = (fakeWorker.postedMessages[0] as { requestId: number }).requestId;

    for (let tick = 0; tick < 3; tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      fakeWorker.emitMessage({
        type: 'import-preparation-heartbeat',
        requestId,
      });
    }

    await assert.rejects(resultPromise, /hard timeout.*100 ms/i);
    assert.equal(fakeWorker.terminated, true);
  } finally {
    disposeImportPreparationWorker();
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      writable: true,
      value: originalWorker,
    });
  }
});

test('idle timeout rebuilds the worker for the next request', async () => {
  const originalWorker = globalThis.Worker;
  const fakeWorkers: FakeWorker[] = [];
  const createFakeWorker = function ImportPreparationWorkerMock() {
    const worker = new FakeWorker();
    fakeWorkers.push(worker);
    return worker;
  };

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: createFakeWorker as unknown as typeof Worker,
  });
  configureImportPreparationWorkerTimeouts({
    idleTimeoutMs: 40,
    hardTimeoutMs: 500,
  });

  try {
    const firstResultPromise = prepareImportPayloadWithWorker({
      files: [],
      existingPaths: [],
    });
    await assert.rejects(firstResultPromise, /idle timeout/i);
    assert.equal(fakeWorkers[0]?.terminated, true);

    const secondResultPromise = prepareImportPayloadWithWorker({
      files: [],
      existingPaths: [],
    });
    assert.equal(fakeWorkers.length, 2);
    const secondWorker = fakeWorkers[1];
    assert.ok(secondWorker);
    const requestId = (secondWorker.postedMessages[0] as { requestId: number }).requestId;
    secondWorker.emitMessage({
      type: 'prepare-import-result',
      requestId,
      payload: {
        robotFiles: [],
        assetFiles: [],
        deferredAssetFiles: [],
        usdSourceFiles: [],
        libraryFiles: [],
        textFiles: [],
        preferredFileName: null,
        preResolvedImports: [],
      },
    });

    const payload = await secondResultPromise;
    assert.equal(payload.preferredFileName, null);
    assert.equal(secondWorker.terminated, false);
  } finally {
    disposeImportPreparationWorker();
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      writable: true,
      value: originalWorker,
    });
  }
});

test('hydrate request stays alive on heartbeats while business progress is silent', async () => {
  const originalWorker = globalThis.Worker;
  const fakeWorkers: FakeWorker[] = [];
  const createFakeWorker = function ImportPreparationWorkerMock() {
    const worker = new FakeWorker();
    fakeWorkers.push(worker);
    return worker;
  };

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: createFakeWorker as unknown as typeof Worker,
  });
  configureImportPreparationWorkerTimeouts({
    idleTimeoutMs: 50,
    hardTimeoutMs: 500,
  });

  try {
    const resultPromise = hydrateDeferredImportAssetsWithWorker({
      archiveFile: new File([], 'robot.zip'),
      assetFiles: [],
    });
    const fakeWorker = fakeWorkers[0];
    assert.ok(fakeWorker);
    const requestId = (fakeWorker.postedMessages[0] as { requestId: number }).requestId;

    for (let tick = 0; tick < 3; tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      fakeWorker.emitMessage({
        type: 'import-preparation-heartbeat',
        requestId,
      });
    }
    fakeWorker.emitMessage({
      type: 'hydrate-deferred-import-assets-result',
      requestId,
      assetFiles: [],
    });

    assert.deepEqual(await resultPromise, []);
  } finally {
    disposeImportPreparationWorker();
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      writable: true,
      value: originalWorker,
    });
  }
});

test('activity for one concurrent request does not mask another silent request', async () => {
  const originalWorker = globalThis.Worker;
  const fakeWorkers: FakeWorker[] = [];
  const createFakeWorker = function ImportPreparationWorkerMock() {
    const worker = new FakeWorker();
    fakeWorkers.push(worker);
    return worker;
  };

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: createFakeWorker as unknown as typeof Worker,
  });
  configureImportPreparationWorkerTimeouts({
    idleTimeoutMs: 70,
    hardTimeoutMs: 500,
  });

  try {
    const firstResultPromise = prepareImportPayloadWithWorker({ files: [], existingPaths: [] });
    const secondResultPromise = prepareImportPayloadWithWorker({ files: [], existingPaths: [] });
    const fakeWorker = fakeWorkers[0];
    assert.ok(fakeWorker);
    const secondRequestId = (fakeWorker.postedMessages[1] as { requestId: number }).requestId;

    await new Promise((resolve) => setTimeout(resolve, 40));
    fakeWorker.emitMessage({
      type: 'import-preparation-heartbeat',
      requestId: secondRequestId,
    });

    const results = await Promise.allSettled([firstResultPromise, secondResultPromise]);
    assert.equal(results[0].status, 'rejected');
    assert.equal(results[1].status, 'rejected');
    assert.match(String(results[0].status === 'rejected' && results[0].reason), /idle timeout/i);
    assert.equal(fakeWorker.terminated, true);
  } finally {
    disposeImportPreparationWorker();
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      writable: true,
      value: originalWorker,
    });
  }
});
