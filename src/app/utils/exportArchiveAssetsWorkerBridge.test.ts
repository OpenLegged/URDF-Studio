import test from 'node:test';
import assert from 'node:assert/strict';

import type { RobotState } from '@/types';

import {
  createExportArchiveAssetsWorkerClient,
} from './exportArchiveAssetsWorkerBridge.ts';
import type {
  ExportArchiveAssetsWorkerResponse,
  PrepareExportArchiveAssetsWorkerRequest,
} from './exportArchiveAssetsWorker.ts';

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

  postMessage(message: unknown, _transfer?: Transferable[]): void {
    this.postedMessages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emitMessage(message: ExportArchiveAssetsWorkerResponse): void {
    this.listeners.get('message')?.forEach((handler) => {
      handler({ data: message });
    });
  }

  emitMessageError(): void {
    this.listeners.get('messageerror')?.forEach((handler) => {
      handler({});
    });
  }
}

const TEST_ROBOT: RobotState = {
  name: 'worker_bot',
  links: {},
  joints: {},
  rootLinkId: '',
  selection: { type: null, id: null },
};

test('exportArchiveAssets worker client resolves successful worker responses and forwards progress', async () => {
  const fakeWorker = new FakeWorker();
  const client = createExportArchiveAssetsWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorker as unknown as Worker,
  });

  const progressEvents: string[] = [];
  const resultPromise = client.prepare({
    robot: TEST_ROBOT,
    targetFormat: 'mjcf',
    assets: { 'meshes/base.stl': 'blob:base' },
    extraMeshFiles: new Map([
      ['textures/coat.png', new Blob(['png'], { type: 'image/png' })],
    ]),
    skipMeshPaths: new Set(['meshes/replaced.stl']),
    onProgress: ({ currentFile }) => progressEvents.push(currentFile),
  });

  for (let attempt = 0; attempt < 10 && fakeWorker.postedMessages.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(fakeWorker.postedMessages.length, 1);

  const postedRequest = fakeWorker.postedMessages[0] as PrepareExportArchiveAssetsWorkerRequest;
  assert.equal(postedRequest.type, 'prepare-export-archive-assets');
  assert.equal(postedRequest.payload.targetFormat, 'mjcf');
  assert.equal(postedRequest.payload.extraMeshFiles[0]?.path, 'textures/coat.png');
  assert.deepEqual(postedRequest.payload.skipMeshPaths, ['meshes/replaced.stl']);

  fakeWorker.emitMessage({
    type: 'prepare-export-archive-assets-progress',
    requestId: postedRequest.requestId,
    progress: {
      completed: 1,
      total: 1,
      currentFile: 'base.stl',
      assetType: 'mesh',
      stage: 'complete',
    },
  });
  fakeWorker.emitMessage({
    type: 'prepare-export-archive-assets-result',
    requestId: postedRequest.requestId,
    result: {
      totalTasks: 1,
      completedTasks: 1,
      failedAssets: [],
      files: [
        {
          assetType: 'mesh',
          folder: 'meshes',
          sourcePath: 'meshes/base.stl',
          exportPath: 'base.stl',
          bytes: new TextEncoder().encode('solid base').buffer,
        },
      ],
    },
  });

  const result = await resultPromise;
  assert.deepEqual(progressEvents, ['base.stl']);
  assert.equal(result.files[0]?.exportPath, 'base.stl');
  assert.equal(new TextDecoder().decode(result.files[0]!.bytes), 'solid base');
});

test('exportArchiveAssets worker client rejects immediately when Worker is unavailable', async () => {
  const originalWorker = globalThis.Worker;

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: undefined,
  });

  try {
    const client = createExportArchiveAssetsWorkerClient();
    await assert.rejects(
      client.prepare({
        robot: TEST_ROBOT,
        assets: {},
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

test('exportArchiveAssets worker client rejects pending requests on message transfer errors', async () => {
  const fakeWorker = new FakeWorker();
  const client = createExportArchiveAssetsWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorker as unknown as Worker,
  });

  const resultPromise = client.prepare({
    robot: TEST_ROBOT,
    assets: {},
  });

  for (let attempt = 0; attempt < 10 && fakeWorker.postedMessages.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  fakeWorker.emitMessageError();

  await assert.rejects(resultPromise, /message transfer failed/i);
  assert.equal(fakeWorker.terminated, true);
});

test('exportArchiveAssets worker client times out silent workers and recovers with a fresh worker', async () => {
  const createdWorkers: FakeWorker[] = [];
  const client = createExportArchiveAssetsWorkerClient({
    canUseWorker: () => true,
    createWorker: () => {
      const worker = new FakeWorker();
      createdWorkers.push(worker);
      return worker as unknown as Worker;
    },
    requestTimeoutMs: 10,
  });

  await assert.rejects(
    client.prepare({
      robot: TEST_ROBOT,
      assets: {},
    }),
    /did not respond within the timeout/i,
  );

  assert.equal(createdWorkers.length, 1);
  assert.equal(createdWorkers[0].terminated, true);

  const recoveredPromise = client.prepare({
    robot: TEST_ROBOT,
    assets: {},
  });

  assert.equal(createdWorkers.length, 2);
  assert.notEqual(createdWorkers[1], createdWorkers[0]);

  const postedRequest = createdWorkers[1].postedMessages[0] as PrepareExportArchiveAssetsWorkerRequest;
  createdWorkers[1].emitMessage({
    type: 'prepare-export-archive-assets-result',
    requestId: postedRequest.requestId,
    result: {
      totalTasks: 0,
      completedTasks: 0,
      failedAssets: [],
      files: [],
    },
  });

  const result = await recoveredPromise;
  assert.equal(result.files.length, 0);
});
