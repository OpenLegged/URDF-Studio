import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Mesh } from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { createObjectFromSerializedObjData } from '@/core/loaders/objModelData';
import {
  parseObjModelDataFromTextBytes,
  resetObjWasmParserForTests,
  setObjWasmParserModuleUrlForTests,
} from '@/core/loaders/objWasmParser';

import type { ExportDescriptor } from './internalTypes';
import { buildObjBlobFromDescriptor } from './objGeometrySerializer';

function createDescriptor(primType: string, positionCount: number): ExportDescriptor {
  return {
    descriptor: {
      meshId: `/World/${primType}`,
      primType,
      ranges: { positions: { offset: 0, count: positionCount, stride: 3 } },
    },
    meshId: `/World/${primType}`,
    linkPath: '/World',
    linkId: 'World',
    role: 'visual',
    exportPath: `${primType}.obj`,
    ordinal: 0,
  };
}

test('serializes UsdGeomPoints as OBJ point elements', async () => {
  const result = buildObjBlobFromDescriptor(createDescriptor('points', 6), {
    positions: new Float32Array([0, 0, 0, 1, 2, 3]),
  });

  assert.ok(result);
  assert.match(await result.blob.text(), /\np 1 2\n$/);
});

test('serializes tessellated BasisCurves as OBJ line segments', async () => {
  const result = buildObjBlobFromDescriptor(createDescriptor('basiscurves', 12), {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0]),
  });

  assert.ok(result);
  const text = await result.blob.text();
  assert.match(text, /\nl 1 2\n/);
  assert.match(text, /\nl 3 4\n$/);
  assert.doesNotMatch(text, /\nf /);
});

for (const { scale, positions } of [
  { scale: 1000, positions: [0.0014183982, -0.0005084403, 0.0014302284, 0.0012345678, 0.0015678901, -0.0012345678, 0.0001000001, 0.0002000002, 0.0003000003] },
  { scale: 1e9, positions: [1.4183982e-10, -5.084403e-10, 1.4302284e-10, 1.2345678e-10, 1.5678901e-10, -1.2345678e-10, 1.000001e-10, 2.000002e-10, 3.000003e-10] },
]) {
  test(`preserves USD Float32 vertices through OBJ parsers before ${scale}x scene scaling`, async () => {
    const source = new Float32Array(positions);
    const descriptor = createDescriptor('mesh', source.length);
    descriptor.bakeTransformIntoMesh = false;
    const result = buildObjBlobFromDescriptor(descriptor, { positions: source });
    assert.ok(result);
    const text = await result.blob.text();
    setObjWasmParserModuleUrlForTests(pathToFileURL(path.resolve('public/wasm/obj-parser/objParser.js')).href);
    const objects = [];
    try {
      objects.push(new OBJLoader().parse(text));
      objects.push(createObjectFromSerializedObjData(await parseObjModelDataFromTextBytes(text)));
      for (const object of objects) {
        const mesh = object.children.find((child): child is Mesh => child instanceof Mesh);
        assert.ok(mesh);
        const actual = mesh.geometry.getAttribute('position').array;
        assert.equal(actual.length, source.length);
        for (let index = 0; index < source.length; index += 1) {
          const worldError = Math.abs((actual[index] - source[index]) * scale);
          assert.ok(worldError < 1e-7, `coordinate ${index} lost ${worldError} meters through OBJ`);
          assert.equal(actual[index], source[index], 'source Float32 values must round-trip exactly');
        }
      }
    } finally {
      for (const object of objects) {
        object.traverse((child) => {
          if (!(child instanceof Mesh)) return;
          child.geometry.dispose();
          (Array.isArray(child.material) ? child.material : [child.material]).forEach((material) => material.dispose());
        });
      }
      resetObjWasmParserForTests();
    }
  });
}

// Full product round-trip for vertex COLORS: the real serializer output (with
// subsetDisplayColors carrying authored linear values) feeds the compiled OBJ
// WASM parser, not a hand-rolled re-encoding. The serializer writes v-line
// colors in the sRGB domain; both readers (OBJLoader and the WASM parser)
// linearize them on parse, so the buffer must return the authored linear
// value. Regression guard for the pre-fix double-linearization: writing raw
// linear floats instead would come back as srgbToLinear(linear) ≈ 0.323 for
// an authored 0.604 — an error of 0.28 that this test fails loudly.
test('round-trips authored linear vertex colors through the real serializer and compiled WASM parser', async () => {
  const authoredLinear = 0.60382736; // linear #cccccc (stirring_rod mat_4732465)
  // positionCount is the SCALAR count: 18 scalars = 6 vertices, enough for
  // two indexed triangles whose indices reference 0..5.
  const descriptor = createDescriptor('mesh', 18);
  // The mesh serializer emits faces only when triangle indices exist; supply
  // them so the v-line vertex colors are serialized for real geometry.
  descriptor.descriptor.ranges!.indices = { offset: 0, count: 9, stride: 1 };
  descriptor.subsetDisplayColors = [{ start: 0, length: 9, color: [authoredLinear, authoredLinear, authoredLinear] }];
  const result = buildObjBlobFromDescriptor(descriptor, {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 3, 4, 5, 0, 2, 5]),
  });
  assert.ok(result);
  const text = await result.blob.text();
  const vertexLine = text.split('\n').find((line) => line.startsWith('v '));
  assert.ok(vertexLine, 'serializer must emit v lines');
  const channels = vertexLine.split(/\s+/).slice(4).map(Number);
  // The v line itself must be sRGB-encoded (≈0.8 for #cccccc linear 0.604),
  // not the raw linear value — this is what both parsers linearize back.
  for (const channel of channels) {
    assert.ok(Math.abs(channel - 0.800002888) < 1e-6,
      `v-line color must be sRGB-encoded, got ${channel}`);
  }

  setObjWasmParserModuleUrlForTests(pathToFileURL(path.resolve('public/wasm/obj-parser/objParser.js')).href);
  const objects = [];
  try {
    objects.push(new OBJLoader().parse(text));
    objects.push(createObjectFromSerializedObjData(await parseObjModelDataFromTextBytes(text)));
    for (const object of objects) {
      const mesh = object.children.find((child): child is Mesh => child instanceof Mesh);
      assert.ok(mesh);
      const colors = mesh.geometry.getAttribute('color');
      assert.ok(colors, 'parser must retain the v-line colors');
      // Measured round-trip error 4.9e-6: three's LinearToSRGB exponent
      // truncation (^0.41666) dominates; the 9-digit text and the WASM
      // float32 pow add <6e-8 each. Bound at 1e-4 so the pre-fix
      // double-linearization (error 0.28) fails loudly.
      for (let index = 0; index < colors.array.length; index += 1) {
        const error = Math.abs(Number(colors.array[index]) - authoredLinear);
        assert.ok(error < 1e-4, `color channel ${index} round-trip error ${error} exceeds 1e-4`);
      }
    }
  } finally {
    for (const object of objects) {
      object.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        child.geometry.dispose();
        (Array.isArray(child.material) ? child.material : [child.material]).forEach((material) => material.dispose());
      });
    }
    resetObjWasmParserForTests();
  }
});
