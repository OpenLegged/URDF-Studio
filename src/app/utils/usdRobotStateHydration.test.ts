import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_LINK, GeometryType, type RobotData, type RobotFile, type UsdSceneSnapshot } from '@/types';
import type { PreparedUsdExportCacheResult } from '@/features/urdf-viewer/utils/usdExportBundle.ts';
import type { UsdOffscreenViewerWorkerRequest, UsdOffscreenViewerWorkerResponse } from '@/features/urdf-viewer/utils/usdOffscreenViewerProtocol.ts';
import { serializePreparedUsdExportCacheForWorker } from '@/features/urdf-viewer/utils/usdPreparedExportCacheWorkerTransfer.ts';
import type { ViewerRobotDataResolution } from '@/features/urdf-viewer/utils/viewerRobotData.ts';

import {
  startUsdRobotStateHydration,
  type UsdRobotStateHydrationWorkerClient,
} from './usdRobotStateHydration.ts';

type WorkerEventHandler = (event: { data?: UsdOffscreenViewerWorkerResponse; error?: unknown; message?: string }) => void;

class FakeHydrationWorker {
  private readonly listeners = new Map<string, Set<WorkerEventHandler>>();

  public readonly postedMessages: Array<{
    message: UsdOffscreenViewerWorkerRequest;
    transfer?: Transferable[];
  }> = [];

  addEventListener(type: string, handler: WorkerEventHandler): void {
    const handlers = this.listeners.get(type) ?? new Set<WorkerEventHandler>();
    handlers.add(handler);
    this.listeners.set(type, handlers);
  }

  removeEventListener(type: string, handler: WorkerEventHandler): void {
    this.listeners.get(type)?.delete(handler);
  }

  postMessage(message: UsdOffscreenViewerWorkerRequest, transfer?: Transferable[]): void {
    this.postedMessages.push({ message, transfer });
  }

  emitMessage(message: UsdOffscreenViewerWorkerResponse): void {
    for (const handler of this.listeners.get('message') ?? []) {
      handler({ data: message });
    }
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

interface FakeHydrationClient extends UsdRobotStateHydrationWorkerClient {
  readonly commitCalls: number;
  readonly shutdownCalls: number;
}

function createFakeHydrationClient(worker: FakeHydrationWorker): FakeHydrationClient {
  let commitCalls = 0;
  let shutdownCalls = 0;
  return {
    get commitCalls() {
      return commitCalls;
    },
    get shutdownCalls() {
      return shutdownCalls;
    },
    prepareStageOpenDispatch: (sourceFile) => ({
      worker: worker as unknown as ReturnType<
        UsdRobotStateHydrationWorkerClient['prepareStageOpenDispatch']
      >['worker'],
      sourceFile,
      stageOpenContextKey: 'ctx-demo',
      stageOpenContext: {
        availableFiles: [],
        assets: {},
      },
      stageOpenContextCacheHit: false,
      commitStageOpenContext: () => {
        commitCalls += 1;
      },
    }),
    shutdown: () => {
      shutdownCalls += 1;
    },
  };
}

const sourceFile: RobotFile = {
  name: 'robots/demo/demo.usda',
  content: '#usda 1.0',
  format: 'usd',
};

const availableFiles: RobotFile[] = [
  sourceFile,
  {
    name: 'robots/demo/meshes/base.obj',
    content: 'o base',
    format: 'mesh',
  },
];

const workerRobotData: RobotData = {
  name: 'worker_demo',
  rootLinkId: 'base_link',
  links: {
    base_link: {
      ...DEFAULT_LINK,
      id: 'base_link',
      name: 'base_link',
    },
  },
  joints: {},
  materials: {},
  closedLoopConstraints: [],
};

const preparedRobotData: RobotData = {
  ...workerRobotData,
  name: 'prepared_demo',
  links: {
    base_link: {
      ...workerRobotData.links.base_link,
      visual: {
        ...workerRobotData.links.base_link.visual,
        type: GeometryType.MESH,
        meshPath: 'base_link_visual_0.obj',
      },
    },
  },
};

const workerResolution: ViewerRobotDataResolution = {
  robotData: workerRobotData,
  stageSourcePath: '/robots/demo/demo.usda',
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

const sceneSnapshot: UsdSceneSnapshot = {
  stageSourcePath: '/robots/demo/demo.usda',
  stage: {
    defaultPrimPath: '/Robot',
  },
  robotTree: {
    linkParentPairs: [['/Robot/base_link', null]],
    rootLinkPaths: ['/Robot/base_link'],
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

const preparedCache: PreparedUsdExportCacheResult = {
  stageSourcePath: '/robots/demo/demo.usda',
  robotData: preparedRobotData,
  meshFiles: {
    'base_link_visual_0.obj': new Blob(['o base_link_visual_0\n'], { type: 'text/plain' }),
  },
  resolution: {
    ...workerResolution,
    robotData: preparedRobotData,
    usdSceneSnapshot: sceneSnapshot,
  },
};

function fakeCanvas(): OffscreenCanvas {
  return { width: 1, height: 1 } as OffscreenCanvas;
}

test('startUsdRobotStateHydration sends a 1x1 offscreen init request and forwards load events', async () => {
  const worker = new FakeHydrationWorker();
  const client = createFakeHydrationClient(worker);
  const canvas = fakeCanvas();
  const forwardedEvents: string[] = [];

  const hydration = startUsdRobotStateHydration({
    sourceFile,
    availableFiles,
    assets: {},
    createCanvas: () => canvas,
    workerClient: client,
    prepareExportCache: async () => preparedCache,
    onEvent: (event) => {
      forwardedEvents.push(event.type);
    },
  });

  assert.equal(worker.postedMessages.length, 1);
  const posted = worker.postedMessages[0];
  assert.equal(posted.message.type, 'init');
  assert.equal(posted.message.width, 1);
  assert.equal(posted.message.height, 1);
  assert.equal(posted.message.devicePixelRatio, 1);
  assert.equal(posted.message.active, false);
  assert.equal(posted.message.canvas, canvas);
  assert.deepEqual(posted.transfer, [canvas]);
  assert.equal(posted.message.stageOpenContextKey, 'ctx-demo');
  assert.equal(client.commitCalls, 1);

  worker.emitMessage({
    type: 'progress',
    progress: {
      message: 'Loading USD',
      phase: 'checking-path',
      progressPercent: 50,
    },
  });
  worker.emitMessage({
    type: 'document-load',
    event: {
      status: 'loading',
      phase: 'checking-path',
      message: null,
      progressMode: 'indeterminate',
      progressPercent: null,
      loadedCount: null,
      totalCount: null,
    },
  });

  assert.deepEqual(forwardedEvents, ['progress', 'document-load']);

  hydration.cleanup();
  await assert.rejects(hydration.promise, /cancelled/i);
});

test('startUsdRobotStateHydration resolves a prepared cache after robot-data and scene-snapshot arrive', async () => {
  const worker = new FakeHydrationWorker();
  const client = createFakeHydrationClient(worker);
  const prepareCalls: Array<{
    snapshot: UsdSceneSnapshot;
    resolution: ViewerRobotDataResolution;
  }> = [];

  const hydration = startUsdRobotStateHydration({
    sourceFile,
    availableFiles,
    assets: {},
    createCanvas: fakeCanvas,
    workerClient: client,
    prepareExportCache: async (snapshot, resolution) => {
      prepareCalls.push({ snapshot, resolution });
      return preparedCache;
    },
  });

  worker.emitMessage({
    type: 'robot-data',
    resolution: workerResolution,
  });
  worker.emitMessage({
    type: 'scene-snapshot',
    stageSourcePath: '/robots/demo/demo.usda',
    snapshot: sceneSnapshot,
  });

  const result = await hydration.promise;

  assert.equal(prepareCalls.length, 1);
  assert.equal(prepareCalls[0].snapshot, sceneSnapshot);
  assert.equal(prepareCalls[0].resolution, workerResolution);
  assert.equal(result.preparedCache, preparedCache);
  assert.equal(result.robotData.links.base_link.visual.meshPath, 'base_link_visual_0.obj');
  assert.equal(Object.keys(result.preparedCache.meshFiles).length, 1);
  assert.equal(worker.listenerCount('message'), 0);
  assert.equal(client.shutdownCalls, 1);
});

test('startUsdRobotStateHydration resolves from worker-prepared cache without waiting for full scene snapshot', async () => {
  const worker = new FakeHydrationWorker();
  const client = createFakeHydrationClient(worker);
  let fallbackPrepareCallCount = 0;
  const deferredSnapshots: UsdSceneSnapshot[] = [];
  const serializedPreparedCache = await serializePreparedUsdExportCacheForWorker(preparedCache);

  const hydration = startUsdRobotStateHydration({
    sourceFile,
    availableFiles,
    assets: {},
    createCanvas: fakeCanvas,
    workerClient: client,
    prepareExportCache: async () => {
      fallbackPrepareCallCount += 1;
      return preparedCache;
    },
    onDeferredSceneSnapshot: (snapshot) => {
      deferredSnapshots.push(snapshot);
    },
  });

  worker.emitMessage({
    type: 'robot-data',
    resolution: {
      ...workerResolution,
      usdSceneSnapshot: sceneSnapshot,
    },
    preparedCache: serializedPreparedCache.payload,
  } as UsdOffscreenViewerWorkerResponse);

  const result = await Promise.race([
    hydration.promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 0)),
  ]);

  assert.ok(result, 'expected hydration to resolve without a scene-snapshot message');
  assert.equal(fallbackPrepareCallCount, 0);
  assert.equal(result.preparedCache.stageSourcePath, preparedCache.stageSourcePath);
  assert.equal(result.robotData.links.base_link.visual.meshPath, 'base_link_visual_0.obj');
  assert.equal(result.sceneSnapshot, sceneSnapshot);
  assert.equal(client.shutdownCalls, 0);

  worker.emitMessage({
    type: 'scene-snapshot',
    stageSourcePath: '/robots/demo/demo.usda',
    snapshot: sceneSnapshot,
  });

  assert.deepEqual(deferredSnapshots, [sceneSnapshot]);
  assert.equal(client.shutdownCalls, 1);
});

test('startUsdRobotStateHydration abort removes listeners and ignores later worker messages', async () => {
  const worker = new FakeHydrationWorker();
  const client = createFakeHydrationClient(worker);
  const controller = new AbortController();
  let resolved = false;
  let prepareCallCount = 0;

  const hydration = startUsdRobotStateHydration({
    sourceFile,
    availableFiles,
    assets: {},
    signal: controller.signal,
    createCanvas: fakeCanvas,
    workerClient: client,
    prepareExportCache: async () => {
      prepareCallCount += 1;
      return preparedCache;
    },
  });
  hydration.promise.then(
    () => {
      resolved = true;
    },
    () => {},
  );

  assert.equal(worker.listenerCount('message'), 1);
  controller.abort(new Error('stale USD hydration'));

  await assert.rejects(hydration.promise, /stale USD hydration/);
  assert.equal(worker.listenerCount('message'), 0);
  assert.equal(client.shutdownCalls, 1);

  worker.emitMessage({
    type: 'robot-data',
    resolution: workerResolution,
  });
  worker.emitMessage({
    type: 'scene-snapshot',
    stageSourcePath: '/robots/demo/demo.usda',
    snapshot: sceneSnapshot,
  });
  await Promise.resolve();

  assert.equal(prepareCallCount, 0);
  assert.equal(resolved, false);
});

test('startUsdRobotStateHydration cleanup shuts down a resolved hydration that is waiting for deferred scene snapshot', async () => {
  const worker = new FakeHydrationWorker();
  const client = createFakeHydrationClient(worker);
  const serializedPreparedCache = await serializePreparedUsdExportCacheForWorker(preparedCache);

  const hydration = startUsdRobotStateHydration({
    sourceFile,
    availableFiles,
    assets: {},
    createCanvas: fakeCanvas,
    workerClient: client,
    prepareExportCache: async () => preparedCache,
    onDeferredSceneSnapshot: () => {},
  });

  worker.emitMessage({
    type: 'robot-data',
    resolution: {
      ...workerResolution,
      usdSceneSnapshot: sceneSnapshot,
    },
    preparedCache: serializedPreparedCache.payload,
  } as UsdOffscreenViewerWorkerResponse);

  await hydration.promise;
  assert.equal(client.shutdownCalls, 0);

  hydration.cleanup();

  assert.equal(client.shutdownCalls, 1);
  assert.equal(worker.listenerCount('message'), 0);
});
