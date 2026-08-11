import test from 'node:test';
import assert from 'node:assert/strict';

import { createUsdOffscreenViewerWorkerClient } from './usdOffscreenViewerWorkerClient.ts';

type WorkerEventHandler = (event: { data?: unknown; error?: unknown; message?: string }) => void;

class FakeWorker {
  private readonly listeners = new Map<string, Set<WorkerEventHandler>>();

  public readonly postedMessages: unknown[] = [];

  public terminated = false;

  public postMessageError: Error | null = null;

  addEventListener(type: string, handler: WorkerEventHandler): void {
    const handlers = this.listeners.get(type) ?? new Set<WorkerEventHandler>();
    handlers.add(handler);
    this.listeners.set(type, handlers);
  }

  removeEventListener(type: string, handler: WorkerEventHandler): void {
    this.listeners.get(type)?.delete(handler);
  }

  postMessage(message: unknown): void {
    if (this.postMessageError) {
      throw this.postMessageError;
    }
    this.postedMessages.push(message);
  }

  dispatch(type: string, payload: { data?: unknown; error?: unknown; message?: string }): void {
    for (const handler of this.listeners.get(type) ?? []) {
      handler(payload);
    }
  }

  terminate(): void {
    this.terminated = true;
  }
}

test('USD offscreen viewer worker client prepares stage-open context for init payloads', () => {
  const fakeWorker = new FakeWorker();
  const client = createUsdOffscreenViewerWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorker as unknown as Worker,
  });

  const sourceFile = {
    name: 'robots/go2/usd/go2.usd',
    content: '#usda 1.0\n(\n  subLayers = [@./configuration/go2_description_base.usd@]\n)\n',
    blobUrl: undefined,
  };
  const availableFiles = [
    {
      name: 'robots/go2/usd/go2.usd',
      content: '#usda 1.0\n(\n  subLayers = [@./configuration/go2_description_base.usd@]\n)\n',
      blobUrl: undefined,
      format: 'usd' as const,
    },
    {
      name: 'robots/go2/usd/configuration/go2_description_base.usd',
      content: '#usda 1.0',
      blobUrl: undefined,
      format: 'usd' as const,
    },
    {
      name: 'robots/go2/meshes/base.stl',
      content: 'solid go2',
      blobUrl: undefined,
      format: 'mesh' as const,
    },
  ];
  const assets = {
    'robots/go2/textures/body.png': 'blob:go2-texture',
    'robots/alien/textures/alien.png': 'blob:alien-texture',
  };

  const firstDispatch = client.prepareStageOpenDispatch(sourceFile, availableFiles, assets);

  assert.equal(fakeWorker.postedMessages.length, 0);
  assert.deepEqual(
    (firstDispatch.stageOpenContext?.availableFiles ?? []).map((file) => ({
      name: file.name,
      format: file.format,
    })),
    [
      {
        name: 'robots/go2/usd/configuration/go2_description_base.usd',
        format: 'usd',
      },
    ],
  );
  // Bundle textures ride along because layer text never names them; assets
  // outside the bundle directory are still pruned.
  assert.deepEqual(firstDispatch.stageOpenContext?.assets, {
    'robots/go2/textures/body.png': 'blob:go2-texture',
  });
  assert.equal(firstDispatch.worker, fakeWorker);
  assert.equal(firstDispatch.sessionId, 1);
  assert.equal(firstDispatch.sourceFile.name, sourceFile.name);
  assert.ok(firstDispatch.stageOpenContextKey);
  assert.equal(firstDispatch.stageOpenContextCacheHit, false);

  firstDispatch.commitStageOpenContext();
  const secondDispatch = client.prepareStageOpenDispatch(sourceFile, availableFiles, assets);
  assert.equal(fakeWorker.postedMessages.length, 0);
  assert.equal(secondDispatch.sessionId, 2);
  assert.equal(secondDispatch.stageOpenContextKey, firstDispatch.stageOpenContextKey);
  assert.equal(secondDispatch.stageOpenContext, null);
  assert.equal(secondDispatch.stageOpenContextCacheHit, true);
});

test('USD offscreen viewer worker client strips blob-backed large USDA text before building init context', () => {
  const fakeWorker = new FakeWorker();
  const client = createUsdOffscreenViewerWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorker as unknown as Worker,
  });

  const hugeText = 'x'.repeat(1024 * 1024 + 32);
  const dispatch = client.prepareStageOpenDispatch(
    {
      name: 'robots/go2/usd/go2_description.usda',
      content: '#usda 1.0\n(\n  subLayers = [@./configuration/go2_description_base.usda@]\n)\n',
      blobUrl: 'blob:go2-root',
    },
    [
      {
        name: 'robots/go2/usd/configuration/go2_description_base.usda',
        content: hugeText,
        blobUrl: 'blob:go2-base',
        format: 'usd',
      },
    ],
    {},
  );

  assert.equal(fakeWorker.postedMessages.length, 0);
  assert.equal(dispatch.stageOpenContext?.availableFiles?.[0]?.content, '');
  assert.equal(dispatch.stageOpenContext?.availableFiles?.[0]?.blobUrl, 'blob:go2-base');
  assert.equal(
    dispatch.sourceFile.content,
    '#usda 1.0\n(\n  subLayers = [@./configuration/go2_description_base.usda@]\n)\n',
  );
  assert.equal(dispatch.sourceFile.blobUrl, 'blob:go2-root');
  assert.equal(dispatch.stageOpenContextCacheHit, false);
});

test('USD offscreen viewer worker client only disposes the active stage session', () => {
  const fakeWorker = new FakeWorker();
  const client = createUsdOffscreenViewerWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorker as unknown as Worker,
  });
  const sourceFile = {
    name: 'robots/demo/demo.usda',
    content: '#usda 1.0',
    blobUrl: undefined,
  };

  const firstDispatch = client.prepareStageOpenDispatch(sourceFile, [], {});
  const secondDispatch = client.prepareStageOpenDispatch(sourceFile, [], {});

  client.disposeStage(firstDispatch.sessionId);
  assert.equal(fakeWorker.postedMessages.length, 0);

  client.disposeStage(secondDispatch.sessionId);
  assert.deepEqual(fakeWorker.postedMessages, [
    { type: 'dispose-stage', sessionId: secondDispatch.sessionId },
  ]);

  client.disposeStage(secondDispatch.sessionId);
  assert.deepEqual(fakeWorker.postedMessages, [
    { type: 'dispose-stage', sessionId: secondDispatch.sessionId },
  ]);
});

test('USD offscreen viewer worker client keeps rejected prewarm load-debug events off the main thread console', () => {
  const fakeWorker = new FakeWorker();
  const client = createUsdOffscreenViewerWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorker as unknown as Worker,
  });
  const originalConsoleWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    client.prewarmRuntime();
    fakeWorker.dispatch('message', {
      data: {
        type: 'load-debug',
        entry: {
          sourceFileName: '',
          step: 'ensure-runtime',
          status: 'rejected',
          timestamp: Date.now(),
          detail: {
            prewarmOnly: true,
            error: 'runtime-prewarm-failed',
          },
        },
      },
    });
  } finally {
    console.warn = originalConsoleWarn;
    client.shutdown();
  }

  assert.deepEqual(fakeWorker.postedMessages[0], { type: 'prewarm-runtime' });
  assert.equal(warnings.length, 0);
});

test('USD offscreen viewer worker client surfaces worker error and messageerror events on the main thread', () => {
  const fakeWorker = new FakeWorker();
  const client = createUsdOffscreenViewerWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorker as unknown as Worker,
  });
  const originalConsoleWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    client.prewarmRuntime();
    fakeWorker.dispatch('error', {
      error: new Error('worker-crashed'),
    });
    fakeWorker.dispatch('messageerror', {
      message: 'message-deserialization-failed',
    });
  } finally {
    console.warn = originalConsoleWarn;
    client.shutdown();
  }

  assert.ok(
    warnings.some((entry) => String(entry[0] || '').includes('[usdOffscreenViewerWorker]')),
  );
});

test('USD offscreen viewer worker client tears down shared worker after fatal responses', () => {
  const workers: FakeWorker[] = [];
  const client = createUsdOffscreenViewerWorkerClient({
    canUseWorker: () => true,
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    },
  });
  const originalConsoleWarn = console.warn;
  console.warn = () => {};

  try {
    const firstWorker = client.getWorker();
    workers[0]!.dispatch('message', {
      data: {
        type: 'fatal-error',
        sessionId: 1,
        error: 'runtime crashed',
      },
    });

    assert.equal(firstWorker, workers[0]);
    assert.equal(workers[0]!.terminated, true);
    assert.deepEqual(workers[0]!.postedMessages.at(-1), { type: 'dispose' });

    const secondWorker = client.getWorker();
    assert.equal(workers.length, 2);
    assert.equal(secondWorker, workers[1]);
  } finally {
    console.warn = originalConsoleWarn;
    client.shutdown();
  }
});

test('USD offscreen viewer worker client logs dispose failures during shutdown instead of swallowing them', () => {
  const fakeWorker = new FakeWorker();
  const client = createUsdOffscreenViewerWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorker as unknown as Worker,
  });
  const originalConsoleWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  client.getWorker();
  fakeWorker.postMessageError = new Error('dispose-post-failed');

  try {
    client.shutdown();
  } finally {
    console.warn = originalConsoleWarn;
  }

  assert.equal(fakeWorker.terminated, true);
  assert.ok(
    warnings.some((entry) => String(entry[0] || '').includes('[disposeUsdOffscreenViewerWorker]')),
  );
});

test('USD offscreen viewer worker client logs prewarm dispatch failures instead of swallowing them', () => {
  const fakeWorker = new FakeWorker();
  const client = createUsdOffscreenViewerWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorker as unknown as Worker,
  });
  const originalConsoleWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  client.getWorker();
  fakeWorker.postMessageError = new Error('prewarm-post-failed');

  try {
    client.prewarmRuntime();
  } finally {
    client.shutdown();
    console.warn = originalConsoleWarn;
  }

  assert.ok(
    warnings.some((entry) => String(entry[0] || '').includes('[prewarmUsdOffscreenViewerRuntime]')),
  );
});

test('USD offscreen viewer worker client skips prewarm worker creation outside isolated pages', () => {
  const fakeWorker = new FakeWorker();
  let createWorkerCalls = 0;
  const client = createUsdOffscreenViewerWorkerClient({
    canUseWorker: () => true,
    createWorker: () => {
      createWorkerCalls += 1;
      return fakeWorker as unknown as Worker;
    },
    getRuntimeEnvironmentError: () =>
      new Error('USD loading requires a cross-origin isolated page.'),
  });
  const originalConsoleWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    client.prewarmRuntime();
  } finally {
    client.shutdown();
    console.warn = originalConsoleWarn;
  }

  assert.equal(createWorkerCalls, 0);
  assert.equal(fakeWorker.postedMessages.length, 0);
  assert.ok(
    warnings.some((entry) => String(entry[0] || '').includes('[prewarmUsdOffscreenViewerRuntime]')),
  );
});
