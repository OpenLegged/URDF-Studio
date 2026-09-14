import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUsdStageOpenPreparationWorkerDispatch } from '../../utils/usdStageOpenPreparationWorkerPayload.ts';
import { prepareUsdStageOpenDataCore } from '@/lib/robot-parser/usd/usdStageOpenPreparationCore';
import { isUsdRuntimeTexturePath } from '@/core/parsers/usd/usdAssetPaths';
import { preloadUsdDependencies, ensureCriticalUsdDependenciesLoaded } from './usdWorkerPreload.ts';

function filesystem() {
  const written: string[] = [];
  const runtime = {
    USD: {
      FS_createPath: () => {},
      FS_writeFile: (path: string) => {
        written.push(path);
      },
    },
    usdFsHelper: {
      canOperateOnUsdFilesystem: () => true,
      clearStageFiles: () => {
        throw new Error('preload must not dispose the stage filesystem');
      },
      hasVirtualFilePath: (path: string) => written.includes(path),
    },
  };
  return { runtime, written };
}

test('cancelled blob preload cannot write into the next stage filesystem', async () => {
  const { runtime, written } = filesystem();
  let active = true;
  let resolveBytes: (bytes: ArrayBuffer) => void = () => {};
  const bytes = new Promise<ArrayBuffer>((resolve) => {
    resolveBytes = resolve;
  });
  class DelayedBlob extends Blob {
    override arrayBuffer() {
      return bytes;
    }
  }
  const pending = preloadUsdDependencies(
    runtime,
    '/robot.usda',
    [{ path: '/robot.usda', blob: new DelayedBlob(['#usda 1.0']) }],
    () => active,
  );
  active = false;
  resolveBytes(new Uint8Array([1, 2, 3]).buffer);
  await pending;
  assert.deepEqual(written, []);
});

test('shared configuration fallback fills both virtual paths without resetting other stage files', async (context) => {
  const { runtime, written } = filesystem();
  written.push('/robot.usda');
  const fetchMock = context.mock.method(
    globalThis,
    'fetch',
    async () => new Response(new Uint8Array([1, 2, 3])),
  );
  await ensureCriticalUsdDependenciesLoaded({
    runtime,
    stagePath: '/robot.usda',
    requiredPaths: ['/Robot/configuration/joints.usda'],
    entries: [],
    isActive: () => true,
  });
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.deepEqual(written, [
    '/robot.usda',
    '/configuration/joints.usda',
    '/Robot/configuration/joints.usda',
  ]);
});

test('MDL dependencies survive worker dispatch and reach the filesystem before the root opens', async (context) => {
  const mdlSource = 'mdl 1.7;\n// Keep original module bytes.\nexport material Surface() = material();\n';
  const mdlPath = 'robot/Materials/Surface.MDL';
  const root = {
    name: 'robot/scene.usda',
    content: '#usda 1.0\ndef Shader "Surface" { uniform asset info:mdl:sourceAsset = @./Materials/Surface.MDL@ }',
  };
  const fetchMock = context.mock.method(globalThis, 'fetch', async (input: unknown) => {
    assert.equal(input, 'blob:mdl-module');
    return new Response(mdlSource);
  });
  const dispatch = buildUsdStageOpenPreparationWorkerDispatch(root, [], {
    [mdlPath]: 'blob:mdl-module',
    'other/Materials/Surface.MDL': 'blob:outside-bundle',
    'robot/README.md': 'blob:documentation',
  });
  const prepared = await prepareUsdStageOpenDataCore(
    dispatch.sourceFile,
    dispatch.contextSnapshot?.availableFiles ?? dispatch.availableFiles ?? [],
    dispatch.contextSnapshot?.assets ?? dispatch.assets ?? {},
  );
  assert.equal(isUsdRuntimeTexturePath(mdlPath), false);
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.deepEqual(prepared.preloadFiles.map(({ path }) => path), [
    `/${mdlPath}`, '/robot/scene.usda',
  ]);
  const { runtime, written } = filesystem();
  const bytesByPath = new Map<string, Uint8Array>();
  const capturedRuntime = {
    ...runtime,
    USD: {
      ...runtime.USD,
      FS_writeFile: (path: string, bytes: unknown) => {
        assert.ok(bytes instanceof Uint8Array);
        runtime.USD.FS_writeFile(path);
        bytesByPath.set(path, bytes.slice());
      },
    },
  };
  await preloadUsdDependencies(capturedRuntime, prepared.stageSourcePath, prepared.preloadFiles, () => true);
  assert.deepEqual(written, [`/${mdlPath}`, '/robot/scene.usda']);
  assert.equal(new TextDecoder().decode(bytesByPath.get(`/${mdlPath}`)), mdlSource);
});
