import test from 'node:test';
import assert from 'node:assert/strict';

import type {
  UsdStageOpenPreparationWorkerResponse,
} from './usdStageOpenPreparationWorker.ts';
import { createUsdStageOpenPreparationWorkerClient } from './usdStageOpenPreparationWorkerBridge.ts';
import { serializePreparedUsdStageOpenDataForWorker } from './usdStageOpenPreparationTransfer.ts';

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

  emitMessage(message: UsdStageOpenPreparationWorkerResponse): void {
    this.listeners.get('message')?.forEach((handler) => {
      handler({ data: message });
    });
  }

  emitMessageError(error: Error): void {
    this.listeners.get('messageerror')?.forEach((handler) => {
      handler({ error, message: error.message });
    });
  }
}

test('USD stage open preparation worker client resolves successful worker responses', async () => {
  const fakeWorker = new FakeWorker();
  const client = createUsdStageOpenPreparationWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorker as unknown as Worker,
  });

  const resultPromise = client.prepare(
    {
      name: 'robots/go2/usd/go2.usd',
      content: '#usda 1.0',
      blobUrl: undefined,
    },
    [],
    {},
  );

  assert.equal(fakeWorker.postedMessages.length, 1);
  const postedRequest = fakeWorker.postedMessages[0] as { requestId: number };

  const serialized = await serializePreparedUsdStageOpenDataForWorker({
    stageSourcePath: '/robots/go2/usd/go2.usd',
    criticalDependencyPaths: [],
    preloadFiles: [{
      path: '/robots/go2/usd/go2.usd',
      blob: new Blob(['go2-root'], { type: 'application/octet-stream' }),
      error: null,
    }],
  });

  fakeWorker.emitMessage({
    type: 'prepare-usd-stage-open-result',
    requestId: postedRequest.requestId,
    result: serialized.payload,
  });

  const result = await resultPromise;
  assert.equal(result.stageSourcePath, '/robots/go2/usd/go2.usd');
  assert.equal(result.preloadFiles[0]?.bytes, null);
  assert.equal(result.preloadFiles[0]?.blob instanceof Blob, true);
  assert.deepEqual(
    Array.from(new Uint8Array(await result.preloadFiles[0]!.blob!.arrayBuffer())),
    Array.from(new TextEncoder().encode('go2-root')),
  );
});

test('USD stage open preparation worker client rejects pending work when message transfer fails', async () => {
  const fakeWorker = new FakeWorker();
  const client = createUsdStageOpenPreparationWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorker as unknown as Worker,
    requestTimeoutMs: 0,
  });

  const resultPromise = client.prepare(
    {
      name: 'robots/go2/usd/go2.usd',
      content: '#usda 1.0',
      blobUrl: undefined,
    },
    [],
    {},
  );

  assert.equal(fakeWorker.postedMessages.length, 1);
  fakeWorker.emitMessageError(new Error('structured clone failed'));

  await assert.rejects(resultPromise, /message transfer failed/i);
  assert.equal(fakeWorker.terminated, true);
});

test('USD stage open preparation worker client syncs pruned context once and reuses the context id', async () => {
  const fakeWorker = new FakeWorker();
  const client = createUsdStageOpenPreparationWorkerClient({
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
    {
      name: 'robots/alien/usd/alien.usd',
      content: '#usda 1.0',
      blobUrl: undefined,
      format: 'usd' as const,
    },
  ];
  const assets = {
    'robots/go2/textures/body.png': 'blob:go2-texture',
    'robots/alien/textures/alien.png': 'blob:alien-texture',
  };

  const firstPromise = client.prepare(sourceFile, availableFiles, assets);

  assert.equal(fakeWorker.postedMessages.length, 2);
  const syncContextRequest = fakeWorker.postedMessages[0] as {
    type: string;
    context: {
      availableFiles?: Array<{ name: string; format: string; content?: string; blobUrl?: string }>;
      assets?: Record<string, string>;
    };
  };
  const firstPrepareRequest = fakeWorker.postedMessages[1] as {
    requestId: number;
    contextId?: string;
    availableFiles?: unknown;
    assets?: unknown;
  };

  assert.equal(syncContextRequest.type, 'sync-context');
  assert.deepEqual(
    (syncContextRequest.context.availableFiles ?? []).map((file) => ({
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
  // Textures are siblings of the usd/ directory and cannot be discovered by
  // tracing layer text, so the whole bundle's textures ride along; assets from
  // another bundle must still be pruned.
  assert.deepEqual(syncContextRequest.context.assets, {
    'robots/go2/textures/body.png': 'blob:go2-texture',
  });
  assert.equal(typeof firstPrepareRequest.contextId, 'string');
  assert.equal(firstPrepareRequest.availableFiles, undefined);
  assert.equal(firstPrepareRequest.assets, undefined);

  const secondPromise = client.prepare(sourceFile, availableFiles, assets);

  assert.equal(fakeWorker.postedMessages.length, 3);
  const secondPrepareRequest = fakeWorker.postedMessages[2] as {
    requestId: number;
    contextId?: string;
  };
  assert.equal(secondPrepareRequest.contextId, firstPrepareRequest.contextId);

  fakeWorker.emitMessage({
    type: 'prepare-usd-stage-open-result',
    requestId: firstPrepareRequest.requestId,
    result: {
      stageSourcePath: '/robots/go2/usd/go2.usd',
      criticalDependencyPaths: [],
      preloadFiles: [],
    },
  });
  fakeWorker.emitMessage({
    type: 'prepare-usd-stage-open-result',
    requestId: secondPrepareRequest.requestId,
    result: {
      stageSourcePath: '/robots/go2/usd/go2.usd',
      criticalDependencyPaths: [],
      preloadFiles: [],
    },
  });

  const firstResult = await firstPromise;
  const secondResult = await secondPromise;
  assert.equal(firstResult.stageSourcePath, '/robots/go2/usd/go2.usd');
  assert.equal(secondResult.stageSourcePath, '/robots/go2/usd/go2.usd');
});

test('USD stage open preparation worker client strips blob-backed large USDA text payloads before syncing worker context', async () => {
  const fakeWorker = new FakeWorker();
  const client = createUsdStageOpenPreparationWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorker as unknown as Worker,
  });

  const hugeText = 'x'.repeat(1024 * 1024 + 32);
  const resultPromise = client.prepare(
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

  assert.equal(fakeWorker.postedMessages.length, 2);
  const syncContextRequest = fakeWorker.postedMessages[0] as {
    type: string;
    context: {
      availableFiles?: Array<{ name: string; content: string; blobUrl?: string }>;
    };
  };
  const prepareRequest = fakeWorker.postedMessages[1] as {
    requestId: number;
    sourceFile: { name: string; content: string; blobUrl?: string };
  };

  assert.equal(syncContextRequest.type, 'sync-context');
  assert.equal(syncContextRequest.context.availableFiles?.[0]?.content, '');
  assert.equal(syncContextRequest.context.availableFiles?.[0]?.blobUrl, 'blob:go2-base');
  assert.equal(
    prepareRequest.sourceFile.content,
    '#usda 1.0\n(\n  subLayers = [@./configuration/go2_description_base.usda@]\n)\n',
  );
  assert.equal(prepareRequest.sourceFile.blobUrl, 'blob:go2-root');

  fakeWorker.emitMessage({
    type: 'prepare-usd-stage-open-result',
    requestId: prepareRequest.requestId,
    result: {
      stageSourcePath: '/robots/go2/usd/go2_description.usda',
      criticalDependencyPaths: [],
      preloadFiles: [],
    },
  });

  const result = await resultPromise;
  assert.equal(result.stageSourcePath, '/robots/go2/usd/go2_description.usda');
});

test('USD stage open preparation worker client times out silent workers and recovers with a fresh worker', async () => {
  const createdWorkers: FakeWorker[] = [];
  const client = createUsdStageOpenPreparationWorkerClient({
    canUseWorker: () => true,
    createWorker: () => {
      const worker = new FakeWorker();
      createdWorkers.push(worker);
      return worker as unknown as Worker;
    },
    requestTimeoutMs: 10,
  });

  await assert.rejects(
    client.prepare(
      {
        name: 'robots/go2/usd/go2.usd',
        content: '#usda 1.0',
        blobUrl: undefined,
      },
      [],
      {},
    ),
    /did not respond within the timeout/i,
  );

  assert.equal(createdWorkers.length, 1);
  assert.equal(createdWorkers[0].terminated, true);

  const recoveredPromise = client.prepare(
    {
      name: 'robots/go2/usd/go2.usd',
      content: '#usda 1.0',
      blobUrl: undefined,
    },
    [],
    {},
  );

  assert.equal(createdWorkers.length, 2);
  assert.notEqual(createdWorkers[1], createdWorkers[0]);

  const postedRequest = createdWorkers[1].postedMessages[0] as { requestId: number };
  createdWorkers[1].emitMessage({
    type: 'prepare-usd-stage-open-result',
    requestId: postedRequest.requestId,
    result: {
      stageSourcePath: '/robots/go2/usd/go2.usd',
      criticalDependencyPaths: [],
      preloadFiles: [],
    },
  });

  const result = await recoveredPromise;
  assert.equal(result.stageSourcePath, '/robots/go2/usd/go2.usd');
});
