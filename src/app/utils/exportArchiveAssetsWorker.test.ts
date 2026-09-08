import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_LINK, GeometryType, type RobotState } from '@/types';

import {
  collectPreparedExportArchiveAssetTransferables,
  prepareExportArchiveAssets,
  type PrepareExportArchiveAssetsResult,
} from './exportArchiveAssetsWorker.ts';

function createDataUrl(content: string, mimeType = 'text/plain'): string {
  return `data:${mimeType};base64,${Buffer.from(content).toString('base64')}`;
}

function decodeBuffer(buffer: ArrayBuffer): string {
  return new TextDecoder().decode(buffer);
}

function createAssetRobot(): RobotState {
  return {
    name: 'worker_asset_zip',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          meshPath: 'package://demo/meshes/base.stl',
          dimensions: { x: 1, y: 1, z: 1 },
        },
      },
    },
    joints: {},
    materials: {
      base_link: {
        texture: 'package://demo/textures/body/coat.png',
      },
    },
  };
}

test('prepareExportArchiveAssets prepares mesh and texture ArrayBuffers', async () => {
  const progressEvents: string[] = [];

  const result = await prepareExportArchiveAssets({
    robot: createAssetRobot(),
    assets: {
      'package://demo/meshes/base.stl': createDataUrl('solid base\nendsolid base', 'model/stl'),
      'package://demo/textures/body/coat.png': createDataUrl('png-texture', 'image/png'),
    },
    onProgress: ({ completed, currentFile }) => {
      progressEvents.push(`${completed}:${currentFile}`);
    },
  });

  assert.equal(result.failedAssets.length, 0);
  assert.equal(result.totalTasks, 2);
  assert.equal(result.completedTasks, 2);

  const meshFile = result.files.find((file) => file.assetType === 'mesh');
  const textureFile = result.files.find((file) => file.assetType === 'texture');

  assert.equal(meshFile?.folder, 'meshes');
  assert.equal(meshFile?.exportPath, 'base.stl');
  assert.match(decodeBuffer(meshFile!.bytes), /solid base/);

  assert.equal(textureFile?.folder, 'textures');
  assert.equal(textureFile?.exportPath, 'body/coat.png');
  assert.equal(decodeBuffer(textureFile!.bytes), 'png-texture');
  assert.equal(progressEvents[0], '0:');
  assert.ok(progressEvents.includes('2:body/coat.png') || progressEvents.includes('2:base.stl'));
});

test('prepareExportArchiveAssets uses inline blobs and skipMeshPaths before asset lookup', async () => {
  const result = await prepareExportArchiveAssets({
    robot: createAssetRobot(),
    assets: {},
    extraMeshFiles: new Map([
      ['package://demo/meshes/base.stl', new Blob(['inline-mesh'], { type: 'model/stl' })],
      [
        'package://demo/textures/body/coat.png',
        new Blob(['inline-texture'], { type: 'image/png' }),
      ],
    ]),
    skipMeshPaths: new Set(['package://demo/meshes/base.stl']),
  });

  assert.equal(result.failedAssets.length, 0);
  assert.equal(result.totalTasks, 1);
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0]?.assetType, 'texture');
  assert.equal(decodeBuffer(result.files[0]!.bytes), 'inline-texture');
});

test('collectPreparedExportArchiveAssetTransferables exposes result buffers for transfer', () => {
  const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
  const result: PrepareExportArchiveAssetsResult = {
    totalTasks: 1,
    completedTasks: 1,
    failedAssets: [],
    files: [
      {
        assetType: 'mesh',
        folder: 'meshes',
        sourcePath: 'meshes/base.stl',
        exportPath: 'base.stl',
        bytes,
      },
    ],
  };

  const transferables = collectPreparedExportArchiveAssetTransferables(result);
  assert.deepEqual(transferables, [bytes]);

  const cloned = structuredClone(result, { transfer: transferables });
  assert.equal(bytes.byteLength, 0);
  assert.deepEqual(Array.from(new Uint8Array(cloned.files[0]!.bytes)), [1, 2, 3, 4]);
});

test('model and scene MJCF packages share texture lookup and JPEG-to-PNG conversion through worker transfer', async (t) => {
  const { collectMjcfExportFiles, prepareMjcfExport } = await import('@/features/file-io');
  const { serializePrepareExportArchiveAssetsArgsForWorker, hydratePrepareExportArchiveAssetsArgsFromWorker } = await import('./exportArchiveAssetsWorker.ts');
  const source = new Blob([new Uint8Array([255, 216, 255, 224])], { type: 'image/png' });
  const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  let released = 0;
  const mocks = {
    createImageBitmap: async (blob: Blob) => {
      assert.equal(blob.type, 'image/jpeg');
      assert.deepEqual(await blob.arrayBuffer(), await source.arrayBuffer());
      return { width: 2, height: 1, close: () => { released += 1; } };
    },
    OffscreenCanvas: class {
      constructor(width: number, height: number) { assert.deepEqual([width, height], [2, 1]); }
      getContext() { return { drawImage() {} }; }
      async convertToBlob() { return new Blob([pngBytes], { type: 'image/png' }); }
    },
  };
  for (const [key, value] of Object.entries(mocks)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  const robot = createAssetRobot();
  robot.links.base_link.visual.type = GeometryType.BOX;
  robot.links.base_link.visual.meshPath = undefined;
  robot.materials!.base_link.texture = 'img/coat.png';
  const sourceFiles = new Map([['resource/img/coat.png', source]]);
  const transferred = hydratePrepareExportArchiveAssetsArgsFromWorker(
    structuredClone(serializePrepareExportArchiveAssetsArgsForWorker({
      robot, assets: {}, extraMeshFiles: sourceFiles, targetFormat: 'mjcf',
    })),
  );
  const modelPackage = await prepareExportArchiveAssets(transferred);
  assert.deepEqual(modelPackage.failedAssets, []);
  const modelTexture = modelPackage.files.find((file) => file.assetType === 'texture');
  assert.equal(modelTexture?.exportPath, 'img/coat.png');
  assert.equal(modelTexture?.mimeType, 'image/png');
  assert.deepEqual(new Uint8Array(modelTexture!.bytes), pngBytes);
  const prepared = await prepareMjcfExport({ robot, assets: {} });
  const scenePackage = await collectMjcfExportFiles(prepared, { robot, sourceFiles });
  const sceneTexture = scenePackage.get('textures/img/coat.png');
  assert.ok(sceneTexture instanceof Blob);
  assert.deepEqual(modelTexture!.bytes, await sceneTexture.arrayBuffer());
  assert.equal(released, 2);
  const originalPackage = await prepareExportArchiveAssets({
    robot, assets: {}, extraMeshFiles: new Map([['img/coat.png', source]]),
  });
  assert.deepEqual(originalPackage.files[0].bytes, await source.arrayBuffer(), 'other formats preserve the original image');
  assert.deepEqual(new Uint8Array(await source.arrayBuffer()), new Uint8Array([255, 216, 255, 224]));
});

test('MJCF model packaging reports ambiguous dependencies and gives exact paths precedence', async () => {
  const robot = createAssetRobot();
  robot.materials!.base_link.texture = 'img/coat.png';
  const files = new Map([
    ['left/img/coat.png', new Blob(['left'])],
    ['right/img/coat.png', new Blob(['right'])],
  ]);
  const args = { robot, assets: {}, extraMeshFiles: files, targetFormat: 'mjcf' as const,
    skipMeshPaths: new Set([robot.links.base_link.visual.meshPath!]) };
  const ambiguous = await prepareExportArchiveAssets(args);
  assert.equal(ambiguous.failedAssets.length, 1);
  assert.match(ambiguous.failedAssets[0].message, /asset is ambiguous: img\/coat.png/);
  assert.equal(ambiguous.files.length, 0);
  files.set('img/coat.png', new Blob(['exact']));
  const exact = await prepareExportArchiveAssets(args);
  assert.deepEqual(exact.failedAssets, []);
  assert.equal(decodeBuffer(exact.files[0].bytes), 'exact');
});
