import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareUsdStageOpenDataCore } from './usdStageOpenPreparationCore.ts';
import { readUsdPreloadBytes } from './usdPreloadBytes.ts';

test('prepared binary USD bundles retain root, dependent layers and texture bytes for the parser', async () => {
  const payloads = new Map([
    ['cabinet beige/model.usd', new Uint8Array([80, 88, 82, 45, 85, 83, 68, 67, 0, 255, 128])],
    ['cabinet beige/resource/material.usd', new Uint8Array([80, 88, 82, 45, 85, 83, 68, 67, 1, 254])],
    ['cabinet beige/resource/link.usd', new Uint8Array([80, 88, 82, 45, 85, 83, 68, 67, 2, 253])],
    ['cabinet beige/resource/texture.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
  ]);
  const assets = Object.fromEntries(
    [...payloads].map(([path, bytes]) => [path, URL.createObjectURL(new Blob([bytes]))]),
  );
  try {
    const files = [...payloads.keys()].filter((name) => name.endsWith('.usd')).map((name) => ({
      name, content: '', format: 'usd' as const, blobUrl: assets[name],
    }));
    const prepared = await prepareUsdStageOpenDataCore(files[0]!, files, assets);
    assert.equal(prepared.stageSourcePath, '/cabinet beige/model.usd');
    assert.equal(prepared.preloadFiles.length, payloads.size);
    for (const entry of prepared.preloadFiles) {
      assert.equal(entry.error, null);
      assert.deepEqual(await readUsdPreloadBytes(entry), payloads.get(entry.path.slice(1)));
    }
  } finally {
    Object.values(assets).forEach((url) => URL.revokeObjectURL(url));
  }
});

test('inline USDA preparation still supplies its full text bytes', async () => {
  const source = { name: 'cube.usda', content: '#usda 1.0\ndef Cube "cube" {}\n' };
  const prepared = await prepareUsdStageOpenDataCore(source, [], {});
  const bytes = await readUsdPreloadBytes(prepared.preloadFiles[0]!);
  assert.equal(new TextDecoder().decode(bytes!), source.content);
});

test('transferred buffers retain byte offsets and missing payloads stay missing', async () => {
  const bytes = new Uint8Array([0, 80, 88, 255]);
  assert.deepEqual(await readUsdPreloadBytes({ path: '/model.usd', blob: null, bytes: bytes.subarray(1, 3) }), new Uint8Array([80, 88]));
  assert.deepEqual(await readUsdPreloadBytes({ path: '/model.usd', blob: null, bytes: bytes.buffer }), bytes);
  assert.equal(await readUsdPreloadBytes({ path: '/missing.usd', blob: null }), null);
});
