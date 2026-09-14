import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

import { prepareImportPayload } from '../importPreparation';
import { withArchiveImportSession } from '../archiveImport';
import {
  collectImportPayloadFromArchiveSession,
  hydrateDeferredImportAssetsFromArchiveSession,
} from './archiveCollector';
import { collectImportPayloadFromLooseFiles } from './looseFileCollector';

const USD_CONTENT = '#usda 1.0\ndef Xform "Root" {}\n';
const MODULE_CONTENT = new TextEncoder().encode('mdl 1.7;\r\nexport material Surface() = material();\r\n');
const MODULE_PATH = 'demo/materials/Surface.mdl';
const TEMPLATE_PATH = 'demo/materials/Templates/GlassWithVolume.MDL';

async function createUsdArchive(): Promise<File> {
  const zip = new JSZip();
  zip.file('demo/model.usda', USD_CONTENT);
  zip.file(MODULE_PATH, MODULE_CONTENT);
  zip.file(TEMPLATE_PATH, MODULE_CONTENT);
  return new File([await zip.generateAsync({ type: 'uint8array' })], 'demo.zip');
}

test('actual ZIP collection retains MDL dependencies and extracts their original bytes', async () => {
  const archive = await createUsdArchive();
  await withArchiveImportSession(archive, async (session) => {
    const payload = await collectImportPayloadFromArchiveSession(session);
    assert.deepEqual(payload.deferredAssetFiles.map((file) => file.name).sort(), [MODULE_PATH, TEMPLATE_PATH]);
    assert.equal(payload.robotFiles.some((file) => /\.mdl$/i.test(file.name)), false);
    const extracted = await hydrateDeferredImportAssetsFromArchiveSession(session, payload.deferredAssetFiles);
    assert.equal(extracted.length, 2);
    for (const asset of extracted) {
      assert.deepEqual(new Uint8Array(await asset.blob.arrayBuffer()), MODULE_CONTENT);
    }
  });
});

test('USD ZIP preparation makes MDL bytes available before loading the preferred source', async () => {
  const payload = await prepareImportPayload({ files: [await createUsdArchive()], existingPaths: [] });
  const modules = payload.assetFiles.filter((file) => /\.mdl$/i.test(file.name));
  assert.equal(modules.length, 2);
  assert.equal(payload.deferredAssetFiles.some((file) => /\.mdl$/i.test(file.name)), false);
  assert.match(payload.preferredFileName ?? '', /model\.usda$/);
  for (const asset of modules) {
    assert.deepEqual(new Uint8Array(await asset.blob.arrayBuffer()), MODULE_CONTENT);
  }
});

test('loose file and directory imports retain MDL support bytes without adding a model entry', async () => {
  const source = new File([USD_CONTENT], 'model.usda');
  const module = new File([MODULE_CONTENT], 'Surface.mdl');
  const inputs = [
    [source, module],
    [{ file: source, relativePath: 'demo/model.usda' }, { file: module, relativePath: MODULE_PATH }],
  ];
  for (const files of inputs) {
    const payload = await collectImportPayloadFromLooseFiles(files);
    assert.equal(payload.assetFiles.length, 1);
    assert.deepEqual(new Uint8Array(await payload.assetFiles[0].blob.arrayBuffer()), MODULE_CONTENT);
    assert.deepEqual(payload.robotFiles.map((file) => file.format), ['usd']);
  }
});
