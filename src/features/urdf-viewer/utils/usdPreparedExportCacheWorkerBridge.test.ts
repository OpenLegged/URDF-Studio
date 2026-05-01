import test from 'node:test';
import assert from 'node:assert/strict';

import { GeometryType } from '@/types';
import type { RobotData, UsdSceneSnapshot } from '@/types';
import type { UsdPreparedExportCacheWorkerResponse } from './usdPreparedExportCacheWorker.ts';
import type { ViewerRobotDataResolution } from './viewerRobotData';
import { serializePreparedUsdExportCacheForWorker } from './usdPreparedExportCacheWorkerTransfer.ts';
import { createUsdPreparedExportCacheWorkerClient } from './usdPreparedExportCacheWorkerBridge.ts';

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
