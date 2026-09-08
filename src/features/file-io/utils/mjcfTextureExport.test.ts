import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareMjcfTextureBlob } from './mjcfTextureExport';

test('native PNG and non-PNG texture files retain their exact source bytes', async () => {
  const png = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])]);
  assert.equal(await prepareMjcfTextureBlob('wood.png', png), png);
  const ktx = new Blob(['ktx']);
  assert.equal(await prepareMjcfTextureBlob('wood.ktx', ktx), ktx);
});

test('JPEG mislabeled as PNG is decoded with its real type, keeps dimensions and releases the bitmap', async (t) => {
  for (const name of ['createImageBitmap', 'OffscreenCanvas'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: function () {} });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  const source = new Blob([new Uint8Array([255, 216, 255, 224])], { type: 'image/png' });
  const png = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });
  let closes = 0;
  const bitmap = { width: 128, height: 64, close: () => { closes += 1; } };
  let rejectEncode = false;
  globalThis.createImageBitmap = (async (blob: Blob, options: ImageBitmapOptions) => {
    assert.equal(blob.type, 'image/jpeg');
    assert.deepEqual(await blob.arrayBuffer(), await source.arrayBuffer());
    assert.equal(options.imageOrientation, 'none');
    return bitmap;
  }) as typeof createImageBitmap;
  globalThis.OffscreenCanvas = class {
    constructor(width: number, height: number) { assert.deepEqual([width, height], [128, 64]); }
    getContext(kind: string) {
      assert.equal(kind, '2d');
      return { drawImage(image: unknown, x: number, y: number) { assert.deepEqual([image, x, y], [bitmap, 0, 0]); } };
    }
    async convertToBlob(options: ImageEncodeOptions) {
      assert.equal(options.type, 'image/png');
      if (rejectEncode) throw new Error('encode failed');
      return png;
    }
  } as unknown as typeof OffscreenCanvas;
  assert.equal(await prepareMjcfTextureBlob('wood.PNG', source), png);
  assert.equal(closes, 1);
  rejectEncode = true;
  await assert.rejects(prepareMjcfTextureBlob('wood.png', source), /wood.png.*could not be converted to PNG/);
  assert.equal(closes, 2);
});
