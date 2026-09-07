import test from 'node:test';
import assert from 'node:assert/strict';

import { GeometryType } from '@/types';
import type { RobotData, UsdSceneSnapshot } from '@/types';
import type { UsdPreparedExportCacheWorkerResponse } from './usdPreparedExportCacheWorker.ts';
import type { ViewerRobotDataResolution } from '@/lib/robot-parser/usd/viewerRobotData';
import { serializePreparedUsdExportCacheForWorker } from './usdPreparedExportCacheWorkerTransfer.ts';
import { createUsdPreparedExportCacheWorkerClient, prepareUsdSourceExportCacheWithWorker } from './usdPreparedExportCacheWorkerBridge.ts';

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

  emitMessage(message: UsdPreparedExportCacheWorkerResponse): void {
    this.listeners.get('message')?.forEach((handler) => {
      handler({ data: message });
    });
  }
}

const demoSnapshot: UsdSceneSnapshot = {
  stageSourcePath: '/robots/demo/demo.usd',
  stage: { defaultPrimPath: '/Robot' },
  robotTree: {
    linkParentPairs: [['/Robot/base_link', null]],
    rootLinkPaths: ['/Robot/base_link'],
  },
  robotMetadataSnapshot: {
    stageSourcePath: '/robots/demo/demo.usd',
    linkParentPairs: [['/Robot/base_link', null]],
    jointCatalogEntries: [],
    meshCountsByLinkPath: {
      '/Robot/base_link': {
        visualMeshCount: 0,
        collisionMeshCount: 0,
      },
    },
  },
  render: {
    meshDescriptors: [],
    materials: [],
  },
  buffers: {
    positions: new Float32Array(0),
    indices: new Uint32Array(0),
    normals: new Float32Array(0),
    uvs: new Float32Array(0),
    transforms: new Float32Array(0),
    rangesByMeshId: {},
  },
};

const demoRobotData: RobotData = {
  name: 'demo',
  rootLinkId: 'base_link',
  links: {
    base_link: {
      id: 'base_link',
      name: 'base_link',
      visible: true,
      visual: {
        type: GeometryType.NONE,
        dimensions: { x: 0, y: 0, z: 0 },
        color: '#ffffff',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      },
      collision: {
        type: GeometryType.NONE,
        dimensions: { x: 0, y: 0, z: 0 },
        color: '#ffffff',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      },
      inertial: {
        mass: 0,
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
      },
    },
  },
  joints: {},
  materials: {},
  closedLoopConstraints: [],
};

const demoResolution: ViewerRobotDataResolution = {
  robotData: demoRobotData,
  stageSourcePath: '/robots/demo/demo.usd',
  linkIdByPath: {
    '/Robot/base_link': 'base_link',
  },
  linkPathById: {
    base_link: '/Robot/base_link',
  },
  jointPathById: {},
  childLinkPathByJointId: {},
  parentLinkPathByJointId: {},
};

test('USD prepared export cache worker client resolves successful worker responses', async () => {
  const fakeWorker = new FakeWorker();
  const client = createUsdPreparedExportCacheWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorker as unknown as Worker,
  });

  const resultPromise = client.prepare(demoSnapshot, demoResolution);

  assert.equal(fakeWorker.postedMessages.length, 1);
  const postedRequest = fakeWorker.postedMessages[0] as { requestId: number };
  const serialized = await serializePreparedUsdExportCacheForWorker({
    stageSourcePath: '/robots/demo/demo.usd',
    robotData: demoResolution.robotData,
    meshFiles: {
      'base_link_visual_0.obj': new Blob(['o base_link_visual_0\n'], { type: 'text/plain' }),
    },
    resolution: demoResolution,
  });

  fakeWorker.emitMessage({
    type: 'prepare-usd-prepared-export-cache-result',
    requestId: postedRequest.requestId,
    result: serialized.payload,
  });

  const result = await resultPromise;
  assert.ok(result);
  assert.equal(result.stageSourcePath, '/robots/demo/demo.usd');
  assert.equal(await result.meshFiles['base_link_visual_0.obj']?.text(), 'o base_link_visual_0\n');
});

test('USD prepared export cache worker client rejects immediately when Worker is unavailable', async () => {
  const originalWorker = globalThis.Worker;

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: undefined,
  });

  try {
    const client = createUsdPreparedExportCacheWorkerClient();
    await assert.rejects(
      client.prepare(demoSnapshot, demoResolution),
      /USD prepared export cache worker is not available in this environment/i,
    );
  } finally {
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      writable: true,
      value: originalWorker,
    });
  }
});

test('source hydration preserves binary dependencies and disposes workers/URLs on all exits', async (t) => {
  const originalWorker = globalThis.Worker;
  const originalCanvas = globalThis.OffscreenCanvas;
  const workers: SourceWorker[] = [];
  class SourceWorker extends FakeWorker {
    constructor() { super(); workers.push(this); }
    emit(data: unknown) { this.emitMessage(data as UsdPreparedExportCacheWorkerResponse); }
  }
  const created: string[] = [];
  const revoked: string[] = [];
  t.mock.method(URL, 'createObjectURL', () => { const url = `blob:test-${created.length}`; created.push(url); return url; });
  t.mock.method(URL, 'revokeObjectURL', (url: string) => revoked.push(url));
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: SourceWorker });
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, writable: true, value: class {} });
  try {
    const files = new Map([['root.usdc', new Blob(['PXR-USDC'])], ['layers/nested.usdc', new Blob(['binary'])], ['textures/wood.png', new Blob(['texture'])]]);
    const success = prepareUsdSourceExportCacheWithWorker({ rootPath: 'root.usdc', files });
    const worker = workers[0]!;
    const request = worker.postedMessages[0] as any;
    assert.equal(request.projectionMode, 'robot');
    assert.equal(request.includeAllAvailableFiles, true);
    assert.deepEqual(request.stageOpenContext.availableFiles.map((file: any) => file.name), ['layers/nested.usdc', 'textures/wood.png']);
    const serialized = await serializePreparedUsdExportCacheForWorker({ robotData: demoRobotData, resolution: demoResolution, meshFiles: { 'mesh.obj': new Blob(['v 0 0 0']) } });
    worker.emit({ type: 'prepared-cache', preparedCache: serialized.payload });
    assert.equal(worker.terminated, false, 'wait for complete hydration');
    worker.emit({ type: 'document-load', event: { status: 'ready' } });
    assert.equal(await (await success).meshFiles['mesh.obj']!.text(), 'v 0 0 0');
    assert.equal(worker.terminated, true);
    assert.deepEqual(revoked, created);
    const controller = new AbortController();
    const abort = prepareUsdSourceExportCacheWithWorker({ rootPath: 'root.usdc', files, signal: controller.signal });
    controller.abort(new Error('test cancellation'));
    await assert.rejects(abort, /test cancellation/);
    assert.equal(workers[1]!.terminated, true);
    const failure = prepareUsdSourceExportCacheWithWorker({ rootPath: 'root.usdc', files });
    workers[2]!.emit({ type: 'fatal-error', error: 'unsupported stage' });
    await assert.rejects(failure, /unsupported stage/);
    assert.equal(workers[2]!.terminated, true);
    const missing = prepareUsdSourceExportCacheWithWorker({ rootPath: 'root.usdc', files });
    workers[3]!.emit({ type: 'document-load', event: { status: 'ready' } });
    await assert.rejects(missing, /no prepared geometry/);
    assert.equal(workers[3]!.terminated, true);
    await assert.rejects(prepareUsdSourceExportCacheWithWorker({ rootPath: 'root.usdc', files, timeoutMs: 1 }), /timed out/);
    assert.equal(workers[4]!.terminated, true);
    assert.deepEqual(revoked, created);
  } finally {
    Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: originalWorker });
    Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, writable: true, value: originalCanvas });
  }
});
