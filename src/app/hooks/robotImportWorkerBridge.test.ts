import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { resolveRobotFileData, type RobotImportProgress } from '@/core/parsers/importRobotFile';
import { GeometryType, type RobotFile } from '@/types';
import type { RobotState } from '@/types';
import type { RobotImportWorkerResponse } from '@/app/utils/robotImportWorker';
import {
  applyEditableSourceChangeWithWorker,
  createRobotImportWorkerClient,
  disposeRobotImportWorker,
  generateEditableRobotSourceWithWorker,
  resolveRobotFileDataWithWorker,
} from './robotImportWorkerBridge.ts';
import { generateEditableRobotSource } from '@/app/utils/generateEditableRobotSource';
import { buildPreResolvedImportContentSignature } from '@/app/utils/preResolvedImportSignature.ts';
import {
  clearPreResolvedRobotImportCache,
  primePreResolvedRobotImports,
} from '@/app/utils/preResolvedRobotImportCache.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;

const demoUrdfFile: RobotFile = {
  name: 'robots/demo/urdf/demo.urdf',
  format: 'urdf',
  content: '<robot name="demo"><link name="base_link" /></robot>',
};

function createDemoRobotState(): RobotState {
  const resolved = resolveRobotFileData(demoUrdfFile);
  if (resolved.status !== 'ready') assert.fail('Expected demo robot to load');
  return { ...resolved.robotData, selection: { type: null, id: null } };
}

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

  emitMessage(message: RobotImportWorkerResponse): void {
    this.listeners.get('message')?.forEach((handler) => {
      handler({ data: message });
    });
  }

  emitError(error: Error): void {
    this.listeners.get('error')?.forEach((handler) => {
      handler({ error, message: error.message });
    });
  }

  emitMessageError(error: Error): void {
    this.listeners.get('messageerror')?.forEach((handler) => {
      handler({ error, message: error.message });
    });
  }
}

test('robot import worker client resolves successful worker responses', async () => {
  const fakeWorker = new FakeWorker();

  const client = createRobotImportWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorker as unknown as Worker,
    getWorkerCount: () => 1,
    requestTimeoutMs: 0,
  });

  const resultPromise = client.resolve(demoUrdfFile);

  assert.equal(fakeWorker.postedMessages.length, 1);
  const postedRequest = fakeWorker.postedMessages[0] as { requestId: number };

  fakeWorker.emitMessage({
    type: 'resolve-robot-file-result',
    requestId: postedRequest.requestId,
    result: resolveRobotFileData(demoUrdfFile),
  });

  const result = await resultPromise;

  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') {
    assert.fail('Expected worker result to be ready');
  }
  assert.equal(result.robotData.name, 'demo');
});

test('robot import worker client forwards resolve progress events before completion', async () => {
  const fakeWorker = new FakeWorker();
  const client = createRobotImportWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorker as unknown as Worker,
    getWorkerCount: () => 1,
    requestTimeoutMs: 0,
  });
  const progressEvents: RobotImportProgress[] = [];

  const resultPromise = client.resolve(
    demoUrdfFile,
    {},
    {
      onProgress: (progress) => {
        progressEvents.push(progress);
      },
    },
  );

  assert.equal(fakeWorker.postedMessages.length, 1);
  const postedRequest = fakeWorker.postedMessages[0] as { requestId: number };

  fakeWorker.emitMessage({
    type: 'resolve-robot-file-progress',
    requestId: postedRequest.requestId,
    progress: {
      progressPercent: 35,
      message: 'Resolving URDF source',
      progressMode: 'percent',
      phase: 'resolving-source',
    },
  });

  fakeWorker.emitMessage({
    type: 'resolve-robot-file-result',
    requestId: postedRequest.requestId,
    result: resolveRobotFileData(demoUrdfFile),
  });

  const result = await resultPromise;

  assert.equal(result.status, 'ready');
  assert.deepEqual(progressEvents, [
    {
      progressPercent: 35,
      message: 'Resolving URDF source',
      progressMode: 'percent',
      phase: 'resolving-source',
    },
  ]);
});

test('resolveRobotFileDataWithWorker reports pre-resolved imports as finalizing percent progress', async () => {
  clearPreResolvedRobotImportCache();
  const cachedResult = resolveRobotFileData(demoUrdfFile);
  primePreResolvedRobotImports([
    {
      fileName: demoUrdfFile.name,
      format: demoUrdfFile.format,
      contentSignature: buildPreResolvedImportContentSignature(demoUrdfFile.content),
      result: cachedResult,
    },
  ]);
  const progressEvents: RobotImportProgress[] = [];

  try {
    const result = await resolveRobotFileDataWithWorker(
      demoUrdfFile,
      {},
      {
        onProgress: (progress) => {
          progressEvents.push(progress);
        },
      },
    );

    assert.equal(result.status, 'ready');
    assert.deepEqual(progressEvents, [
      {
        progressPercent: 100,
        message: 'Using cached robot document',
        progressMode: 'percent',
        phase: 'finalizing-import',
      },
    ]);
  } finally {
    clearPreResolvedRobotImportCache();
  }
});

test('robot import worker client rejects after worker errors and recovers with a fresh worker', async () => {
  const createdWorkers: FakeWorker[] = [];
  const client = createRobotImportWorkerClient({
    canUseWorker: () => true,
    createWorker: () => {
      const worker = new FakeWorker();
      createdWorkers.push(worker);
      return worker as unknown as Worker;
    },
    getWorkerCount: () => 1,
  });

  const firstResultPromise = client.resolve(demoUrdfFile);
  assert.equal(createdWorkers.length, 1);
  assert.equal(createdWorkers[0].postedMessages.length, 1);

  createdWorkers[0].emitError(new Error('worker exploded'));

  await assert.rejects(firstResultPromise, /worker exploded/i);
  assert.equal(createdWorkers[0].terminated, true);

  const secondResultPromise = client.resolve(demoUrdfFile);
  assert.equal(createdWorkers.length, 2);
  assert.notEqual(createdWorkers[1], createdWorkers[0]);

  createdWorkers[1].emitMessage({
    type: 'resolve-robot-file-result',
    requestId: (createdWorkers[1].postedMessages[0] as { requestId: number }).requestId,
    result: resolveRobotFileData(demoUrdfFile),
  });

  const secondResult = await secondResultPromise;
  assert.equal(secondResult.status, 'ready');
});

test('robot import worker client rejects timed-out requests and recovers with a fresh worker', async () => {
  const createdWorkers: FakeWorker[] = [];
  const client = createRobotImportWorkerClient({
    canUseWorker: () => true,
    createWorker: () => {
      const worker = new FakeWorker();
      createdWorkers.push(worker);
      return worker as unknown as Worker;
    },
    getWorkerCount: () => 1,
    requestTimeoutMs: 10,
  });

  const firstResultPromise = client.resolve(demoUrdfFile);
  assert.equal(createdWorkers.length, 1);
  assert.equal(createdWorkers[0].postedMessages.length, 1);

  await assert.rejects(firstResultPromise, /did not respond within the timeout/i);
  assert.equal(createdWorkers[0].terminated, true);

  const secondResultPromise = client.resolve(demoUrdfFile);
  assert.equal(createdWorkers.length, 2);
  assert.notEqual(createdWorkers[1], createdWorkers[0]);
  assert.equal(createdWorkers[1].postedMessages.length, 1);

  createdWorkers[1].emitMessage({
    type: 'resolve-robot-file-result',
    requestId: (createdWorkers[1].postedMessages[0] as { requestId: number }).requestId,
    result: resolveRobotFileData(demoUrdfFile),
  });

  const secondResult = await secondResultPromise;
  assert.equal(secondResult.status, 'ready');
});

test('robot import worker client rejects after worker message transfer failures', async () => {
  const fakeWorker = new FakeWorker();
  const client = createRobotImportWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorker as unknown as Worker,
    getWorkerCount: () => 1,
    requestTimeoutMs: 0,
  });

  const resultPromise = client.resolve(demoUrdfFile);
  assert.equal(fakeWorker.postedMessages.length, 1);

  fakeWorker.emitMessageError(new Error('structured clone failed'));

  await assert.rejects(resultPromise, /message transfer failed/i);
  assert.equal(fakeWorker.terminated, true);
});

test('robot import worker client keeps the pool alive after request-level resolve failures', async () => {
  const fakeWorker = new FakeWorker();
  const client = createRobotImportWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorker as unknown as Worker,
    getWorkerCount: () => 1,
    requestTimeoutMs: 0,
  });

  const firstResultPromise = client.resolve(demoUrdfFile);
  assert.equal(fakeWorker.postedMessages.length, 1);

  fakeWorker.emitMessage({
    type: 'resolve-robot-file-error',
    requestId: (fakeWorker.postedMessages[0] as { requestId: number }).requestId,
    error: 'bad import payload',
  });

  await assert.rejects(firstResultPromise, /bad import payload/i);
  assert.equal(fakeWorker.terminated, false);

  const secondResultPromise = client.resolve(demoUrdfFile);
  assert.equal(fakeWorker.postedMessages.length, 2);

  fakeWorker.emitMessage({
    type: 'resolve-robot-file-result',
    requestId: (fakeWorker.postedMessages[1] as { requestId: number }).requestId,
    result: resolveRobotFileData(demoUrdfFile),
  });

  const secondResult = await secondResultPromise;
  assert.equal(secondResult.status, 'ready');
});

test('robot import worker client resolves editable source parse responses', async () => {
  const fakeWorker = new FakeWorker();
  const client = createRobotImportWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorker as unknown as Worker,
    getWorkerCount: () => 1,
    requestTimeoutMs: 0,
  });

  const resultPromise = client.parseEditableSource({
    file: {
      name: demoUrdfFile.name,
      format: demoUrdfFile.format,
    },
    content: demoUrdfFile.content,
    availableFiles: [demoUrdfFile],
  });

  assert.equal(fakeWorker.postedMessages.length, 1);
  const postedRequest = fakeWorker.postedMessages[0] as { requestId: number };
  const resolvedRobot = resolveRobotFileData(demoUrdfFile);
  assert.equal(resolvedRobot.status, 'ready');
  if (resolvedRobot.status !== 'ready') {
    assert.fail('Expected resolved robot to be ready');
  }
  const parsedRobot: RobotState = {
    ...resolvedRobot.robotData,
    selection: { type: null, id: null },
  };

  fakeWorker.emitMessage({
    type: 'parse-editable-robot-source-result',
    requestId: postedRequest.requestId,
    result: parsedRobot,
  });

  const result = await resultPromise;

  assert.deepEqual(result, parsedRobot);
});

test('robot import worker client resolves editable source change patch responses', async () => {
  const fakeWorker = new FakeWorker();
  const client = createRobotImportWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorker as unknown as Worker,
    getWorkerCount: () => 1,
    requestTimeoutMs: 0,
  });

  const nextContent = demoUrdfFile.content.replace('base_link', 'base_link');
  const resultPromise = client.applyEditableSourceChange({
    file: {
      name: demoUrdfFile.name,
      format: demoUrdfFile.format,
    },
    content: nextContent,
    previousContent: demoUrdfFile.content,
    dirtyRanges: [{ startOffset: 27, endOffset: 36 }],
    attemptIncrementalPatch: true,
    availableFiles: [demoUrdfFile],
  });

  assert.equal(fakeWorker.postedMessages.length, 1);
  const postedRequest = fakeWorker.postedMessages[0] as {
    type: string;
    requestId: number;
    options: {
      previousContent?: string;
      dirtyRanges?: unknown[];
      attemptIncrementalPatch?: boolean;
    };
  };
  assert.equal(postedRequest.type, 'apply-editable-source-change');
  assert.equal(postedRequest.options.previousContent, demoUrdfFile.content);
  assert.deepEqual(postedRequest.options.dirtyRanges, [{ startOffset: 27, endOffset: 36 }]);
  assert.equal(postedRequest.options.attemptIncrementalPatch, true);

  const resolvedRobot = resolveRobotFileData(demoUrdfFile);
  assert.equal(resolvedRobot.status, 'ready');
  if (resolvedRobot.status !== 'ready') {
    assert.fail('Expected resolved robot to be ready');
  }
  const nextLink = resolvedRobot.robotData.links.base_link;
  assert.ok(nextLink);

  fakeWorker.emitMessage({
    type: 'apply-editable-source-change-result',
    requestId: postedRequest.requestId,
    result: {
      mode: 'incremental-patch',
      patch: {
        kind: 'urdf-link-fragment-update',
        previousLinkId: 'base_link',
        previousLinkName: 'base_link',
        nextLink,
      },
      diagnostics: {
        attempted: true,
        dirtyRangeCount: 1,
        dirtySpanBytes: 9,
        dirtySpanLimitBytes: 32,
        patchKind: 'urdf-link-fragment-update',
        skipReason: null,
      },
    },
  });

  const result = await resultPromise;

  assert.equal(result.mode, 'incremental-patch');
});

test('robot import worker client resolves editable source generation responses', async () => {
  const fakeWorker = new FakeWorker();
  const client = createRobotImportWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorker as unknown as Worker,
    getWorkerCount: () => 1,
    requestTimeoutMs: 0,
  });

  const resolvedRobot = resolveRobotFileData(demoUrdfFile);
  assert.equal(resolvedRobot.status, 'ready');
  if (resolvedRobot.status !== 'ready') {
    assert.fail('Expected resolved robot to be ready');
  }

  const robotState: RobotState = {
    ...resolvedRobot.robotData,
    selection: { type: null, id: null },
  };
  const resultPromise = client.generateEditableSource({
    format: 'urdf',
    robotState,
  });

  assert.equal(fakeWorker.postedMessages.length, 1);
  const postedRequest = fakeWorker.postedMessages[0] as { requestId: number };

  fakeWorker.emitMessage({
    type: 'generate-editable-robot-source-result',
    requestId: postedRequest.requestId,
    result: generateEditableRobotSource({
      format: 'urdf',
      robotState,
    }),
  });

  const result = await resultPromise;

  assert.ok(result);
  assert.match(result, /<robot\b/i);
});

test('robot import worker client accepts unavailable source and remains usable', async (t) => {
  const fakeWorker = new FakeWorker();
  const client = createRobotImportWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorker as unknown as Worker,
    getWorkerCount: () => 1,
    requestTimeoutMs: 0,
  });
  t.after(() => client.dispose());
  const options = { format: 'urdf' as const, robotState: createDemoRobotState() };

  for (const source of [null, '<robot name="demo"><link name="base_link" /></robot>']) {
    const resultPromise = client.generateEditableSource(options);
    const postedRequest = fakeWorker.postedMessages.at(-1) as { requestId: number };
    fakeWorker.emitMessage({
      type: 'generate-editable-robot-source-result',
      requestId: postedRequest.requestId,
      result: source,
    });
    assert.equal(await resultPromise, source);
    assert.equal(fakeWorker.terminated, false);
  }
});

for (const { failure, expectedError } of [
  { failure: 'worker-error', expectedError: /source worker transport failed/ },
  { failure: 'messageerror', expectedError: /worker message transfer failed/ },
  { failure: 'generation-error', expectedError: /source worker transport failed/ },
  { failure: 'missing-result', expectedError: /worker returned no source/ },
]) {
  test(`robot import worker client rejects source generation ${failure}`, async (t) => {
    const fakeWorker = new FakeWorker();
    const client = createRobotImportWorkerClient({
      canUseWorker: () => true,
      createWorker: () => fakeWorker as unknown as Worker,
      getWorkerCount: () => 1,
      requestTimeoutMs: 0,
    });
    t.after(() => client.dispose());
    const resultPromise = client.generateEditableSource({
      format: 'urdf',
      robotState: createDemoRobotState(),
    });
    const postedRequest = fakeWorker.postedMessages[0] as { requestId: number };
    const error = new Error('source worker transport failed');

    if (failure === 'worker-error') fakeWorker.emitError(error);
    else if (failure === 'messageerror') fakeWorker.emitMessageError(error);
    else {
      fakeWorker.emitMessage({
        type: failure === 'generation-error'
          ? 'generate-editable-robot-source-error'
          : 'generate-editable-robot-source-result',
        requestId: postedRequest.requestId,
        error: error.message,
      });
    }

    await assert.rejects(resultPromise, expectedError);
  });
}

test('generateEditableRobotSourceWithWorker preserves unavailable source results', async (t) => {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const fakeWorker = new FakeWorker();
  disposeRobotImportWorker();
  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    value: class { constructor() { return fakeWorker; } },
  });
  t.after(() => {
    disposeRobotImportWorker();
    if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
    else Reflect.deleteProperty(globalThis, 'Worker');
  });

  const resultPromise = generateEditableRobotSourceWithWorker({
    format: 'mjcf',
    robotState: createDemoRobotState(),
  });
  const postedRequest = fakeWorker.postedMessages[0] as { requestId: number };
  fakeWorker.emitMessage({
    type: 'generate-editable-robot-source-result',
    requestId: postedRequest.requestId,
    result: null,
  });
  assert.equal(await resultPromise, null);
});

test('robot import worker client resolves prepared assembly component responses', async () => {
  const fakeWorker = new FakeWorker();
  const client = createRobotImportWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorker as unknown as Worker,
    getWorkerCount: () => 1,
    requestTimeoutMs: 0,
  });

  const resultPromise = client.prepareAssemblyComponent(demoUrdfFile, {
    componentId: 'comp_demo',
    rootName: 'demo',
  });

  assert.equal(fakeWorker.postedMessages.length, 1);
  const postedRequest = fakeWorker.postedMessages[0] as { requestId: number };

  fakeWorker.emitMessage({
    type: 'prepare-assembly-component-result',
    requestId: postedRequest.requestId,
    result: {
      componentId: 'comp_demo',
      displayName: 'demo',
      robotData: {
        name: 'demo',
        rootLinkId: 'comp_demo_base_link',
        links: {
          comp_demo_base_link: {
            id: 'comp_demo_base_link',
            name: 'demo',
            visible: true,
            visual: {
              type: GeometryType.NONE,
              dimensions: { x: 0, y: 0, z: 0 },
              color: '#808080',
              origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
            },
            visualBodies: [],
            collision: {
              type: GeometryType.NONE,
              dimensions: { x: 0, y: 0, z: 0 },
              color: '#ef4444',
              origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
            },
            collisionBodies: [],
            inertial: {
              mass: 0,
              origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
              inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
            },
          },
        },
        joints: {},
      },
      resolvedUrdfContent: demoUrdfFile.content,
      resolvedUrdfSourceFilePath: demoUrdfFile.name,
    },
  });

  const result = await resultPromise;
  assert.equal(result.componentId, 'comp_demo');
  assert.equal(result.displayName, 'demo');
  assert.equal(result.robotData.rootLinkId, 'comp_demo_base_link');
  assert.equal(result.resolvedUrdfContent, demoUrdfFile.content);
  assert.equal(result.resolvedUrdfSourceFilePath, demoUrdfFile.name);
});

test('robot import worker client syncs mesh assets for prepared assembly components', async () => {
  const fakeWorker = new FakeWorker();
  const client = createRobotImportWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorker as unknown as Worker,
    getWorkerCount: () => 1,
    requestTimeoutMs: 0,
  });

  void client
    .prepareAssemblyComponent(demoUrdfFile, {
      componentId: 'comp_demo',
      rootName: 'demo',
      assets: {
        'robots/demo/meshes/base.stl': 'solid demo',
      },
    })
    .catch(() => {});

  assert.equal(fakeWorker.postedMessages.length, 2);
  const syncContextRequest = fakeWorker.postedMessages[0] as {
    type: string;
    context: {
      assets?: Record<string, string>;
    };
  };
  const postedRequest = fakeWorker.postedMessages[1] as {
    type: string;
    contextId?: string;
    options: {
      assets?: Record<string, string>;
    };
  };

  assert.equal(syncContextRequest.type, 'sync-context');
  assert.deepEqual(syncContextRequest.context.assets, {
    'robots/demo/meshes/base.stl': 'solid demo',
  });
  assert.equal(postedRequest.type, 'prepare-assembly-component');
  assert.equal(typeof postedRequest.contextId, 'string');
  assert.deepEqual(postedRequest.options.assets, {
    'robots/demo/meshes/base.stl': 'solid demo',
  });
});

test('robot import worker client keeps MJCF text context on prepare assembly requests', async () => {
  const fakeWorker = new FakeWorker();
  const client = createRobotImportWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorker as unknown as Worker,
    getWorkerCount: () => 1,
    requestTimeoutMs: 0,
  });

  void client
    .prepareAssemblyComponent(
      {
        name: 'mujoco_menagerie-main/agilex_piper/piper.xml',
        format: 'mjcf',
        content: '<mujoco><compiler meshdir="assets" /></mujoco>',
      },
      {
        componentId: 'comp_piper',
        rootName: 'piper',
        availableFiles: [
          {
            name: 'mujoco_menagerie-main/agilex_piper/piper.xml',
            format: 'mjcf',
            content: '<mujoco><compiler meshdir="assets" /></mujoco>',
          },
        ],
        assets: {
          'mujoco_menagerie-main/agilex_piper/assets/link3_12.obj': 'blob:obj',
        },
        allFileContents: {
          'mujoco_menagerie-main/agilex_piper/assets/link3_12.obj': 'mtllib material.mtl',
          'mujoco_menagerie-main/agilex_piper/assets/material.mtl': 'newmtl demo\nKd 1 0 0',
        },
      },
    )
    .catch(() => {});

  assert.equal(fakeWorker.postedMessages.length, 2);
  const postedRequest = fakeWorker.postedMessages[1] as {
    type: string;
    options: {
      availableFiles?: unknown;
      assets?: Record<string, string>;
      allFileContents?: Record<string, string>;
    };
  };

  assert.equal(postedRequest.type, 'prepare-assembly-component');
  assert.deepEqual(postedRequest.options.assets, {
    'mujoco_menagerie-main/agilex_piper/assets/link3_12.obj': 'blob:obj',
  });
  assert.deepEqual(postedRequest.options.allFileContents, {
    'mujoco_menagerie-main/agilex_piper/assets/link3_12.obj': 'mtllib material.mtl',
    'mujoco_menagerie-main/agilex_piper/assets/material.mtl': 'newmtl demo\nKd 1 0 0',
  });
});

test('robot import worker client rejects editable source parse errors', async () => {
  const fakeWorker = new FakeWorker();
  const client = createRobotImportWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorker as unknown as Worker,
    getWorkerCount: () => 1,
    requestTimeoutMs: 0,
  });

  const resultPromise = client.parseEditableSource({
    file: {
      name: demoUrdfFile.name,
      format: demoUrdfFile.format,
    },
    content: '<robot name="broken">',
    availableFiles: [demoUrdfFile],
  });

  assert.equal(fakeWorker.postedMessages.length, 1);
  const postedRequest = fakeWorker.postedMessages[0] as { requestId: number };

  fakeWorker.emitMessage({
    type: 'parse-editable-robot-source-error',
    requestId: postedRequest.requestId,
    error: 'broken editable source',
  });

  await assert.rejects(resultPromise, /broken editable source/i);
});

test('robot import worker client rejects resolve requests immediately when Worker is unavailable', async () => {
  const originalWorker = globalThis.Worker;

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: undefined,
  });

  try {
    const client = createRobotImportWorkerClient();
    await assert.rejects(
      client.resolve(demoUrdfFile),
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

test('resolveRobotFileDataWithWorker rejects immediately when Worker is unavailable', async () => {
  const originalWorker = globalThis.Worker;

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: undefined,
  });

  try {
    await assert.rejects(
      resolveRobotFileDataWithWorker(demoUrdfFile),
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

test('robot import worker client rejects editable source parsing immediately when Worker is unavailable', async () => {
  const originalWorker = globalThis.Worker;

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: undefined,
  });

  try {
    const client = createRobotImportWorkerClient();
    await assert.rejects(
      client.parseEditableSource({
        file: {
          name: demoUrdfFile.name,
          format: demoUrdfFile.format,
        },
        content: demoUrdfFile.content,
        availableFiles: [demoUrdfFile],
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

test('applyEditableSourceChangeWithWorker rejects immediately when Worker is unavailable', async () => {
  const originalWorker = globalThis.Worker;

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: undefined,
  });

  try {
    await assert.rejects(
      applyEditableSourceChangeWithWorker({
        file: {
          name: demoUrdfFile.name,
          format: demoUrdfFile.format,
        },
        content: demoUrdfFile.content,
        previousContent: demoUrdfFile.content,
        dirtyRanges: [],
        attemptIncrementalPatch: false,
        availableFiles: [demoUrdfFile],
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


test('generateEditableRobotSourceWithWorker rejects immediately when Worker is unavailable', async () => {
  const originalWorker = globalThis.Worker;

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: undefined,
  });

  try {
    const resolvedRobot = resolveRobotFileData(demoUrdfFile);
    assert.equal(resolvedRobot.status, 'ready');
    if (resolvedRobot.status !== 'ready') {
      assert.fail('Expected resolved robot to be ready');
    }

    await assert.rejects(
      generateEditableRobotSourceWithWorker({
        format: 'urdf',
        robotState: {
          ...resolvedRobot.robotData,
          selection: { type: null, id: null },
        },
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

test('robot import worker client prunes unused resolve payload fields before posting to the worker', async () => {
  const fakeWorker = new FakeWorker();
  const client = createRobotImportWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorker as unknown as Worker,
    getWorkerCount: () => 1,
    requestTimeoutMs: 0,
  });

  const usdRobotData = {
    name: 'cached-usd',
    links: {},
    joints: {},
    rootLinkId: '',
  };

  void client
    .resolve(
      {
        name: 'robots/demo/usd/demo.usd',
        format: 'usd',
        content: '#usda 1.0',
      },
      {
        availableFiles: [
          demoUrdfFile,
          {
            name: 'robots/demo/xacro/demo.xacro',
            format: 'xacro',
            content: '<robot />',
          },
        ],
        assets: {
          'robots/demo/meshes/base.stl': 'blob:mesh',
        },
        allFileContents: {
          'robots/demo/materials/demo.material': 'material Demo {}',
        },
        usdRobotData,
      },
    )
    .catch(() => {});

  assert.equal(fakeWorker.postedMessages.length, 1);
  const postedRequest = fakeWorker.postedMessages[0] as {
    options: {
      availableFiles?: RobotFile[];
      assets?: Record<string, string>;
      allFileContents?: Record<string, string>;
      usdRobotData?: unknown;
    };
  };

  assert.deepEqual(postedRequest.options, {
    usdRobotData,
  });
});

test('robot import worker client prunes editable parse payload to source-relevant files', async () => {
  const fakeWorker = new FakeWorker();
  const client = createRobotImportWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorker as unknown as Worker,
    getWorkerCount: () => 1,
    requestTimeoutMs: 0,
  });

  void client
    .parseEditableSource({
      file: {
        name: 'robots/demo/xacro/demo.xacro',
        format: 'xacro',
      },
      content: '<robot />',
      availableFiles: [
        demoUrdfFile,
        {
          name: 'robots/demo/xacro/demo.xacro',
          format: 'xacro',
          content: '<robot />',
        },
        {
          name: 'robots/demo/usd/demo.usd',
          format: 'usd',
          content: '#usda 1.0',
        },
        {
          name: 'robots/demo/meshes/base.stl',
          format: 'mesh',
          content: 'solid demo',
        },
      ],
      allFileContents: {
        'robots/demo/xacro/macros/common.xacro': '<robot />',
        'robots/demo/materials/demo.material': 'material Demo {}',
      },
    })
    .catch(() => {});

  assert.equal(fakeWorker.postedMessages.length, 2);
  const syncContextRequest = fakeWorker.postedMessages[0] as {
    type: string;
    context: {
      availableFiles: RobotFile[];
      allFileContents?: Record<string, string>;
    };
  };
  const postedRequest = fakeWorker.postedMessages[1] as {
    contextId?: string;
    options: {
      availableFiles?: RobotFile[];
      allFileContents?: Record<string, string>;
    };
  };

  assert.equal(syncContextRequest.type, 'sync-context');
  assert.deepEqual(
    syncContextRequest.context.availableFiles.map((file) => ({
      name: file.name,
      format: file.format,
    })),
    [
      { name: demoUrdfFile.name, format: demoUrdfFile.format },
      { name: 'robots/demo/xacro/demo.xacro', format: 'xacro' },
    ],
  );
  assert.deepEqual(syncContextRequest.context.allFileContents, {
    'robots/demo/xacro/macros/common.xacro': '<robot />',
    'robots/demo/materials/demo.material': 'material Demo {}',
  });
  assert.equal(typeof postedRequest.contextId, 'string');
  assert.equal(postedRequest.options.availableFiles, undefined);
  assert.equal(postedRequest.options.allFileContents, undefined);
});

test('robot import worker client reuses synced worker context for repeated xacro parse requests', async () => {
  const fakeWorker = new FakeWorker();
  const client = createRobotImportWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorker as unknown as Worker,
    getWorkerCount: () => 1,
    requestTimeoutMs: 0,
  });

  const requestOptions = {
    file: {
      name: 'robots/demo/xacro/demo.xacro',
      format: 'xacro' as const,
    },
    content: '<robot />',
    availableFiles: [
      demoUrdfFile,
      {
        name: 'robots/demo/xacro/demo.xacro',
        format: 'xacro' as const,
        content: '<robot />',
      },
    ],
    allFileContents: {
      'robots/demo/xacro/macros/common.xacro': '<robot />',
    },
  };

  void client.parseEditableSource(requestOptions).catch(() => {});
  void client.parseEditableSource(requestOptions).catch(() => {});

  assert.equal(fakeWorker.postedMessages.length, 3);
  assert.equal((fakeWorker.postedMessages[0] as { type: string }).type, 'sync-context');
  assert.equal(
    (fakeWorker.postedMessages[1] as { type: string }).type,
    'parse-editable-robot-source',
  );
  assert.equal(
    (fakeWorker.postedMessages[2] as { type: string }).type,
    'parse-editable-robot-source',
  );
});

test('robot import worker client distributes concurrent resolve requests across the worker pool', async () => {
  const fakeWorkers = [new FakeWorker(), new FakeWorker()];
  let createdWorkerCount = 0;

  const client = createRobotImportWorkerClient({
    canUseWorker: () => true,
    createWorker: () => fakeWorkers[createdWorkerCount++] as unknown as Worker,
    getWorkerCount: () => 2,
  });

  const firstResultPromise = client.resolve(demoUrdfFile);
  const secondResultPromise = client.resolve(demoUrdfFile);

  assert.equal(fakeWorkers[0].postedMessages.length, 1);
  assert.equal(fakeWorkers[1].postedMessages.length, 1);

  const firstRequest = fakeWorkers[0].postedMessages[0] as { requestId: number };
  const secondRequest = fakeWorkers[1].postedMessages[0] as { requestId: number };

  fakeWorkers[0].emitMessage({
    type: 'resolve-robot-file-result',
    requestId: firstRequest.requestId,
    result: resolveRobotFileData(demoUrdfFile),
  });
  fakeWorkers[1].emitMessage({
    type: 'resolve-robot-file-result',
    requestId: secondRequest.requestId,
    result: resolveRobotFileData(demoUrdfFile),
  });

  const [firstResult, secondResult] = await Promise.all([firstResultPromise, secondResultPromise]);

  assert.equal(firstResult.status, 'ready');
  assert.equal(secondResult.status, 'ready');
});

test('robot import worker client scales workers on demand up to the hardware-derived limit', async () => {
  const previousNavigator = globalThis.navigator;
  const fakeWorkers = Array.from({ length: 10 }, () => new FakeWorker());
  let createdWorkerCount = 0;

  Object.defineProperty(globalThis, 'navigator', {
    value: { hardwareConcurrency: 16 },
    configurable: true,
    writable: true,
  });

  try {
    const client = createRobotImportWorkerClient({
      canUseWorker: () => true,
      createWorker: () => fakeWorkers[createdWorkerCount++] as unknown as Worker,
    });

    const firstResultPromise = client.resolve(demoUrdfFile);
    assert.equal(createdWorkerCount, 1);

    const secondResultPromise = client.resolve(demoUrdfFile);
    assert.equal(createdWorkerCount, 2);

    const extraResultPromises = Array.from({ length: 8 }, () => client.resolve(demoUrdfFile));
    assert.equal(createdWorkerCount, 10);

    const overflowResultPromise = client.resolve(demoUrdfFile);
    assert.equal(createdWorkerCount, 10);

    fakeWorkers.forEach((worker) => {
      worker.postedMessages.forEach((message) => {
        const request = message as { requestId?: number };
        if (typeof request.requestId !== 'number') {
          return;
        }

        worker.emitMessage({
          type: 'resolve-robot-file-result',
          requestId: request.requestId,
          result: resolveRobotFileData(demoUrdfFile),
        });
      });
    });

    const results = await Promise.all([
      firstResultPromise,
      secondResultPromise,
      ...extraResultPromises,
      overflowResultPromise,
    ]);

    assert.equal(
      results.every((result) => result.status === 'ready'),
      true,
    );
  } finally {
    if (previousNavigator === undefined) {
      delete (globalThis as { navigator?: Navigator }).navigator;
    } else {
      Object.defineProperty(globalThis, 'navigator', {
        value: previousNavigator,
        configurable: true,
        writable: true,
      });
    }
  }
});
