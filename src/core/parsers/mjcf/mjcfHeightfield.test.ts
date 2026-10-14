import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { MJCFHfield } from './mjcfUtils';
import { loadMJCFHeightfieldGeometry } from './mjcfHeightfield';
import { MJCFLoadAbortedError } from './mjcfLoadLifecycle';

const definition = (overrides: Partial<MJCFHfield> = {}): MJCFHfield => ({
  name: 'terrain', nrow: 2, ncol: 3, size: [2, 3, 4, 0.25],
  elevation: [10, 12, 14, 16, 18, 20], ...overrides,
});

function binaryAsset(rows: number, columns: number, heights: number[]): string {
  const buffer = new ArrayBuffer(8 + heights.length * 4);
  const view = new DataView(buffer);
  view.setInt32(0, rows, true);
  view.setInt32(4, columns, true);
  heights.forEach((height, index) => view.setFloat32(8 + index * 4, height, true));
  return `data:application/octet-stream;base64,${Buffer.from(buffer).toString('base64')}`;
}

test('inline XML rows flip into Z-up geometry, normalize heights and retain asset dimensions', async () => {
  const geometry = await loadMJCFHeightfieldGeometry(definition());
  const position = geometry.getAttribute('position');
  assert.deepEqual([position.getX(0), position.getY(0)], [-2, -3]);
  assert.ok(Math.abs(position.getZ(0) - 2.4) < 1e-6);
  assert.equal(position.getZ(2), 4);
  assert.equal(position.getZ(3), 0);
  assert.deepEqual([position.getX(5), position.getY(5)], [2, 3]);
  assert.deepEqual(geometry.boundingBox?.min.toArray(), [-2, -3, -0.25]);
  assert.deepEqual(geometry.boundingBox?.max.toArray(), [2, 3, 4]);
  assert.equal(geometry.getAttribute('color'), undefined);
  geometry.dispose();
});

test('custom binary rows remain -Y to +Y and use little-endian header and samples', async () => {
  const geometry = await loadMJCFHeightfieldGeometry(
    definition({ file: 'terrain/non-square.bin', nrow: undefined, ncol: undefined, elevation: undefined }),
    binaryAsset(2, 3, [10, 12, 14, 16, 18, 20]),
  );
  const position = geometry.getAttribute('position');
  assert.equal(position.getZ(0), 0);
  assert.ok(Math.abs(position.getZ(1) - 0.8) < 1e-6);
  assert.equal(position.getZ(5), 4);
  geometry.dispose();
});

test('surface diagonal follows MuJoCo triangle strips and top/wall/bottom winding faces outwards', async () => {
  const geometry = await loadMJCFHeightfieldGeometry(definition({ elevation: [5, 5, 5, 5, 5, 5] }));
  const index = geometry.getIndex()!;
  const position = geometry.getAttribute('position');
  assert.deepEqual(Array.from(index.array).slice(0, 12), [0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4]);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let offset = 0; offset < index.count; offset += 3) {
    a.fromBufferAttribute(position, index.getX(offset));
    b.fromBufferAttribute(position, index.getX(offset + 1));
    c.fromBufferAttribute(position, index.getX(offset + 2));
    const center = a.clone().add(b).add(c).multiplyScalar(1 / 3);
    const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    if (offset < 12) assert.equal(normal.z, 1);
    else if (offset >= index.count - 6) assert.equal(normal.z, -1);
    else assert.ok(normal.x * center.x + normal.y * center.y > 0, 'wall faces outward');
  }
  const normal = geometry.getAttribute('normal');
  assert.deepEqual([normal.getX(0), normal.getY(0), normal.getZ(0)], [0, 0, 1]);
  geometry.dispose();
});

test('unset elevation allocates a flat surface and bottom remains exactly -base depth', async () => {
  const geometry = await loadMJCFHeightfieldGeometry(definition({ elevation: undefined }));
  assert.equal(geometry.boundingBox?.max.z, 0);
  assert.equal(geometry.boundingBox?.min.z, -0.25);
  geometry.dispose();
});

test('geom transforms own negative world height; normalized surface never reuses sample minimum', async () => {
  const geometry = await loadMJCFHeightfieldGeometry(definition({ elevation: [-20, -18, -16, -14, -12, -10] }));
  const mesh = new THREE.Mesh(geometry);
  mesh.position.z = -8;
  mesh.updateMatrixWorld();
  const bounds = new THREE.Box3().setFromObject(mesh);
  assert.deepEqual([bounds.min.z, bounds.max.z], [-8.25, -4]);
  geometry.dispose();
});

test('malformed size, dimensions, elevations and budget fail before creating geometry', async () => {
  for (const bad of [
    { size: undefined }, { size: [1, 1, 1, 0] }, { size: [1, 1, -1, 1] },
    { size: [1, Infinity, 1, 1] }, { size: [1, 1e-100, 1, 1] }, { nrow: 1 }, { ncol: 2.5 },
    { nrow: 1025, ncol: 1025 }, { elevation: [1] },
    { nrow: 2, ncol: 524288, elevation: undefined },
    { elevation: [0, 1, NaN, 0, 1, 0] }, { elevation: [0, 1, Infinity, 0, 1, 0] },
  ] satisfies Partial<MJCFHfield>[]) {
    await assert.rejects(loadMJCFHeightfieldGeometry(definition(bad)), /\[MJCFLoader\] Height field "terrain"/);
  }
});

test('binary truncation, extra bytes, invalid header and missing assets surface real errors', async () => {
  const hfield = definition({ file: 'terrain.bin', nrow: undefined, ncol: undefined, elevation: undefined });
  await assert.rejects(loadMJCFHeightfieldGeometry(hfield), /asset could not be resolved/);
  await assert.rejects(loadMJCFHeightfieldGeometry(hfield, 'data:application/octet-stream;base64,AA=='), /missing.*header/);
  await assert.rejects(loadMJCFHeightfieldGeometry(hfield, binaryAsset(2, 3, [1, 2])), /byte length/);
  await assert.rejects(loadMJCFHeightfieldGeometry(hfield, binaryAsset(2, 2, [0, 1, 2, 3, 4])), /byte length/);
  await assert.rejects(loadMJCFHeightfieldGeometry(hfield, binaryAsset(-1, 3, [])), /at least 2/);
  await assert.rejects(loadMJCFHeightfieldGeometry(hfield, binaryAsset(2000, 2000, [])), /sample budget/);
  await assert.rejects(loadMJCFHeightfieldGeometry(hfield, binaryAsset(2, 2, [0, 1, NaN, 3])), /non-finite/);
});

test('file dimensions and inline samples cannot be mixed; content type overrides extension', async () => {
  await assert.rejects(loadMJCFHeightfieldGeometry(definition({ file: 'terrain.bin' })), /cannot be combined/);
  const hfield = definition({ file: 'terrain.png', contentType: 'image/vnd.mujoco.hfield',
    nrow: undefined, ncol: undefined, elevation: undefined });
  const geometry = await loadMJCFHeightfieldGeometry(hfield, binaryAsset(2, 2, [0, 1, 2, 3]));
  geometry.dispose();
  await assert.rejects(loadMJCFHeightfieldGeometry({ ...hfield, contentType: 'image/jpeg' }, 'data:,'), /unsupported content type/);
});

test('cancellation before loading and during fetch remains MJCFLoadAbortedError', async () => {
  await assert.rejects(loadMJCFHeightfieldGeometry(definition(), null, { aborted: true }), MJCFLoadAbortedError);
  const signal = { aborted: false };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    signal.aborted = true;
    return new Response(new Uint8Array(8));
  };
  try {
    await assert.rejects(loadMJCFHeightfieldGeometry(
      definition({ file: 'terrain.bin', nrow: undefined, ncol: undefined, elevation: undefined }),
      'local-asset', signal,
    ), MJCFLoadAbortedError);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('asset HTTP errors and excessive response sizes reject instead of silently hiding terrain', async () => {
  const originalFetch = globalThis.fetch;
  const hfield = definition({ file: 'terrain.bin', nrow: undefined, ncol: undefined, elevation: undefined });
  try {
    globalThis.fetch = async () => new Response(null, { status: 404 });
    await assert.rejects(loadMJCFHeightfieldGeometry(hfield, 'local-asset'), /request failed \(404\)/);
    globalThis.fetch = async () => new Response(null, { headers: { 'content-length': '100000000' } });
    await assert.rejects(loadMJCFHeightfieldGeometry(hfield, 'local-asset'), /byte budget/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('PNG dimensions are budget checked before decode and grayscale image rows flip like XML', async () => {
  const hfield = definition({ file: 'terrain.PNG', nrow: undefined, ncol: undefined, elevation: undefined });
  const pngHeader = new ArrayBuffer(24);
  const view = new DataView(pngHeader);
  view.setUint32(0, 0x89504e47);
  view.setUint32(4, 0x0d0a1a0a);
  view.setUint32(12, 0x49484452);
  view.setUint32(16, 3);
  view.setUint32(20, 2);
  const pngUrl = () => `data:image/png;base64,${Buffer.from(pngHeader).toString('base64')}`;
  const bitmapDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let closed = 0;
  let decoded = 0;
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async () => {
    decoded += 1;
    return { width: 3, height: 2, close: () => { closed += 1; } };
  } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => ({ getContext: () => ({
      drawImage: () => undefined,
      getImageData: () => ({ data: Uint8ClampedArray.from([0, 50, 100, 150, 200, 250]
        .flatMap((value) => [value, value, value, 255])) }),
    }) }),
  } });
  try {
    const geometry = await loadMJCFHeightfieldGeometry(hfield, pngUrl());
    assert.ok(Math.abs(geometry.getAttribute('position').getZ(0) - 2.4) < 1e-6);
    assert.equal(geometry.getAttribute('position').getZ(3), 0);
    assert.equal(closed, 1);
    geometry.dispose();
    view.setUint32(16, 2000);
    view.setUint32(20, 2000);
    await assert.rejects(loadMJCFHeightfieldGeometry(hfield, pngUrl()), /sample budget/);
    assert.equal(decoded, 1, 'oversize PNG rejected before allocating image bitmap');
  } finally {
    if (bitmapDescriptor) Object.defineProperty(globalThis, 'createImageBitmap', bitmapDescriptor);
    else Reflect.deleteProperty(globalThis, 'createImageBitmap');
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

test('chunked assets exceeding byte budget cancel their stream without accumulating full data', async () => {
  const originalFetch = globalThis.fetch;
  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
    start: (controller) => controller.enqueue(new Uint8Array(8 + 1_048_577 * 4)),
    cancel: () => { cancelled = true; },
  }));
  try {
    await assert.rejects(loadMJCFHeightfieldGeometry(
      definition({ file: 'terrain.bin', nrow: undefined, ncol: undefined, elevation: undefined }),
      'local-asset',
    ), /byte budget/);
    assert.equal(cancelled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
