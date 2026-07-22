import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('import preparation stays on worker-safe file-io utility imports', async () => {
  const sourcePaths = [
    'src/app/utils/importPreparation.ts',
    'src/app/utils/import-preparation/archiveCollector.ts',
    'src/app/utils/import-preparation/looseFileCollector.ts',
    'src/app/utils/import-preparation/sidecarReferences.ts',
  ];

  await Promise.all(
    sourcePaths.map(async (sourcePath) => {
      const source = await readFile(path.resolve(sourcePath), 'utf8');
      assert.doesNotMatch(
        source,
        /from ['"]@\/features\/file-io['"]/,
        `${sourcePath} must not depend on the worker-unsafe feature barrel`,
      );
    }),
  );
});

test('archive import does not force the libarchive ?worker bundle path', async () => {
  const sourcePath = path.resolve('src/app/utils/archiveImport.ts');
  const source = await readFile(sourcePath, 'utf8');

  assert.doesNotMatch(
    source,
    /libarchive\.js\/dist\/worker-bundle\.js\?worker/,
    'archive import should rely on libarchive default worker resolution to avoid preview DataCloneError failures',
  );
});

test('libarchive wasm asset is vendored for browser worker resolution', async () => {
  const wasmPath = path.resolve('public/assets/libarchive.wasm');
  const wasmBytes = await readFile(wasmPath);

  assert.ok(
    wasmBytes.byteLength > 0,
    'public/assets/libarchive.wasm must exist so the packaged libarchive worker can fetch its wasm payload in preview/prod',
  );
});

test('libarchive worker bundle asset is vendored for browser worker resolution', async () => {
  const workerPath = path.resolve('public/assets/worker-bundle.js');
  const workerBytes = await readFile(workerPath);

  assert.ok(
    workerBytes.byteLength > 0,
    'public/assets/worker-bundle.js must exist so archive imports can initialize libarchive workers in dev/preview/prod',
  );
});
