import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type {
  BufferAttribute,
  InterleavedBufferAttribute,
  LineSegments,
  Mesh,
  Object3D,
  Points,
} from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

import { createObjectFromSerializedObjData } from './objModelData.ts';
import {
  parseObjModelDataFromTextBytes,
  parseObjModelDataFromBytes,
  resetObjWasmParserForTests,
  setObjWasmParserModuleUrlForTests,
  setObjWasmParserModuleFactoryForTests,
} from './objWasmParser.ts';
import type { SerializedObjAttributeData } from './objModelData.ts';

function u8(values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function f32(values: number[]): Uint8Array {
  return new Uint8Array(new Float32Array(values).buffer);
}

function stringBytes(value: string): Uint8Array {
  const encoded = new TextEncoder().encode(value);
  return concatBytes([u32(encoded.byteLength), encoded]);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const byteLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(byteLength);
  let offset = 0;
  parts.forEach((part) => {
    result.set(part, offset);
    offset += part.byteLength;
  });
  return result;
}

function floatArrayFromAttribute(attribute: SerializedObjAttributeData): Float32Array {
  const byteOffset = attribute.byteOffset ?? 0;
  const byteLength = attribute.byteLength ?? attribute.array.byteLength - byteOffset;
  return new Float32Array(
    attribute.array,
    byteOffset,
    byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
}

function buildFakeWasmPayload(): Uint8Array {
  return concatBytes([
    u32(0x3157504f),
    u32(0),
    u32(1),
    u8([0]),
    stringBytes('triangle'),
    u32(1),
    stringBytes('red'),
    u32(0xff0000),
    u8([0]),
    u32(3),
    f32([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    u8([1]),
    f32([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    u8([0]),
    u8([0]),
    u32(1),
    u32(0),
    u32(3),
    u32(0),
  ]);
}

test('parseObjModelDataFromBytes decodes OBJ parser WASM payloads', async () => {
  const memory = new Uint8Array(1024 * 1024);
  const payload = buildFakeWasmPayload();
  let nextPtr = 64;
  let resultPtr = 0;
  let resultSize = 0;

  setObjWasmParserModuleFactoryForTests(async () => ({
    HEAPU8: memory,
    _malloc: (size: number) => {
      const ptr = nextPtr;
      nextPtr += size + 16;
      return ptr;
    },
    _free: () => undefined,
    _parse_obj: () => {
      resultPtr = nextPtr;
      memory.set(payload, resultPtr);
      resultSize = payload.byteLength;
      nextPtr += payload.byteLength + 16;
      return 1;
    },
    _obj_parser_get_result_ptr: () => resultPtr,
    _obj_parser_get_result_size: () => resultSize,
    _obj_parser_get_error_ptr: () => 0,
    _obj_parser_get_error_size: () => 0,
    _obj_parser_free_result: () => {
      resultPtr = 0;
      resultSize = 0;
    },
  }));

  try {
    const result = await parseObjModelDataFromTextBytes('ignored');
    assert.equal(result.materialLibraries.length, 0);
    assert.equal(result.children.length, 1);
    assert.equal(result.children[0]?.name, 'triangle');
    assert.equal(result.children[0]?.materials[0]?.name, 'red');
    assert.equal(result.children[0]?.geometry.position.itemSize, 3);
    assert.deepEqual(
      Array.from(floatArrayFromAttribute(result.children[0]!.geometry.position)),
      [0, 0, 0, 1, 0, 0, 0, 1, 0],
    );
    assert.deepEqual(result.children[0]?.geometry.groups, [
      {
        start: 0,
        count: 3,
        materialIndex: 0,
      },
    ]);
  } finally {
    resetObjWasmParserForTests();
  }
});

test('parseObjModelDataFromBytes rejects when WASM is unavailable', async () => {
  setObjWasmParserModuleFactoryForTests(async () => {
    throw new Error('missing wasm');
  });

  try {
    await assert.rejects(
      parseObjModelDataFromTextBytes(
        ['o no-fallback', 'v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 3'].join('\n'),
      ),
      /missing wasm/,
    );
  } finally {
    resetObjWasmParserForTests();
  }
});

test('compiled OBJ parser WASM parses line and point primitives without JS fallback', async () => {
  const modulePath = path.resolve('public/wasm/obj-parser/objParser.js');
  assert.equal(fs.existsSync(modulePath), true);
  setObjWasmParserModuleUrlForTests(pathToFileURL(modulePath).href);

  try {
    const result = await parseObjModelDataFromTextBytes(
      [
        'o wires',
        'v 0 0 0 1 0 0',
        'v 1 0 0 0 1 0',
        'v 1 1 0 0 0 1',
        'vt 0 0',
        'vt 1 0',
        'vt 1 1',
        'usemtl wire',
        'l 1/1 2/2 3/3',
        'o markers',
        'usemtl marker',
        'p 1 2 3',
      ].join('\n'),
    );

    assert.equal(result.children.length, 2);
    assert.equal(result.children[0]?.kind, 'line-segments');
    assert.equal(result.children[0]?.materials[0]?.kind, 'line-basic');
    assert.equal(result.children[0]?.materials[0]?.name, 'wire');
    assert.equal(floatArrayFromAttribute(result.children[0]!.geometry.position).length, 9);
    assert.ok(result.children[0]?.geometry.uv);
    assert.ok(result.children[0]?.geometry.color);
    assert.deepEqual(result.children[0]?.geometry.groups, [
      {
        start: 0,
        count: 3,
        materialIndex: 0,
      },
    ]);

    assert.equal(result.children[1]?.kind, 'points');
    assert.equal(result.children[1]?.materials[0]?.kind, 'points');
    assert.equal(result.children[1]?.materials[0]?.name, 'marker');
    assert.equal(floatArrayFromAttribute(result.children[1]!.geometry.position).length, 9);
    assert.ok(result.children[1]?.geometry.color);
    assert.deepEqual(result.children[1]?.geometry.groups, [
      {
        start: 0,
        count: 3,
        materialIndex: 0,
      },
    ]);
  } finally {
    resetObjWasmParserForTests();
  }
});

test('compiled OBJ parser WASM matches OBJLoader edge semantics without runtime fallback', async () => {
  const modulePath = path.resolve('public/wasm/obj-parser/objParser.js');
  assert.equal(fs.existsSync(modulePath), true);
  setObjWasmParserModuleUrlForTests(pathToFileURL(modulePath).href);

  type GeometryObject = Mesh | LineSegments | Points;

  const collectRenderableObjects = (root: Object3D): GeometryObject[] => {
    const objects: GeometryObject[] = [];
    root.traverse((child) => {
      if (
        (child as Mesh).isMesh ||
        (child as LineSegments).isLineSegments ||
        (child as Points).isPoints
      ) {
        objects.push(child as GeometryObject);
      }
    });
    return objects;
  };

  const assertAttributeEqual = (
    left: BufferAttribute | InterleavedBufferAttribute | undefined,
    right: BufferAttribute | InterleavedBufferAttribute | undefined,
    label: string,
  ) => {
    assert.equal(Boolean(right), Boolean(left), `${label}: attribute presence`);
    if (!left || !right) {
      return;
    }
    assert.equal(right.count, left.count, `${label}: count`);
    assert.equal(right.itemSize, left.itemSize, `${label}: itemSize`);
    assert.equal(right.array.length, left.array.length, `${label}: array length`);
    for (let index = 0; index < left.array.length; index += 1) {
      assert.ok(
        Math.abs(Number(right.array[index]) - Number(left.array[index])) < 1e-6,
        `${label}: value ${index}`,
      );
    }
  };

  const assertObjectParity = async (objText: string, label: string) => {
    const legacyMeshes = collectRenderableObjects(new OBJLoader().parse(objText));
    const wasmMeshes = collectRenderableObjects(
      createObjectFromSerializedObjData(await parseObjModelDataFromTextBytes(objText)),
    );
    assert.equal(wasmMeshes.length, legacyMeshes.length, `${label}: object count`);

    for (let meshIndex = 0; meshIndex < legacyMeshes.length; meshIndex += 1) {
      const legacy = legacyMeshes[meshIndex]!;
      const wasm = wasmMeshes[meshIndex]!;
      assert.equal(wasm.type, legacy.type, `${label}: object ${meshIndex} type`);
      assertAttributeEqual(
        legacy.geometry.getAttribute('position'),
        wasm.geometry.getAttribute('position'),
        `${label}: object ${meshIndex} position`,
      );
      assertAttributeEqual(
        legacy.geometry.getAttribute('normal'),
        wasm.geometry.getAttribute('normal'),
        `${label}: object ${meshIndex} normal`,
      );
      assertAttributeEqual(
        legacy.geometry.getAttribute('uv'),
        wasm.geometry.getAttribute('uv'),
        `${label}: object ${meshIndex} uv`,
      );
      assertAttributeEqual(
        legacy.geometry.getAttribute('color'),
        wasm.geometry.getAttribute('color'),
        `${label}: object ${meshIndex} color`,
      );
      assert.deepEqual(wasm.geometry.groups, legacy.geometry.groups, `${label}: groups`);

      const legacyMaterials = Array.isArray(legacy.material) ? legacy.material : [legacy.material];
      const wasmMaterials = Array.isArray(wasm.material) ? wasm.material : [wasm.material];
      assert.equal(wasmMaterials.length, legacyMaterials.length, `${label}: material count`);
      legacyMaterials.forEach((legacyMaterial, materialIndex) => {
        const wasmMaterial = wasmMaterials[materialIndex]!;
        assert.equal(wasmMaterial.name, legacyMaterial.name, `${label}: material name`);
        assert.equal(
          Boolean((wasmMaterial as { flatShading?: boolean }).flatShading),
          Boolean((legacyMaterial as { flatShading?: boolean }).flatShading),
          `${label}: flatShading`,
        );
      });
    }
  };

  try {
    await assertObjectParity(
      [
        'v 0 0 0 1 0 0',
        'v 1 0 0 0 1 0',
        'v 0 1 0 0 0 1',
      ].join('\n'),
      'vertex-only point cloud',
    );

    await assertObjectParity(
      [
        'o mixed-uv',
        'v 0 0 0',
        'v 1 0 0',
        'v 0 1 0',
        'v 1 1 0',
        'vt 0 0',
        'vt 0 1',
        'vt 1 1',
        'f 1 2 3',
        'f 1/1 3/2 4/3',
      ].join('\n'),
      'mixed uv faces',
    );

    await assertObjectParity(
      [
        'o material-runs',
        'v 0 0 0',
        'v 1 0 0',
        'v 0 1 0',
        'v 1 1 0',
        'v 2 0 0',
        'v 2 1 0',
        'usemtl A',
        's off',
        'f 1 2 3',
        'usemtl B',
        's 1',
        'f 2 4 3',
        'usemtl A',
        's off',
        'f 2 5 6',
      ].join('\n'),
      'smoothing and repeated material runs',
    );

    await assertObjectParity(
      ['o continued', 'v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 \\', '3'].join('\n'),
      'continued face line',
    );
  } finally {
    resetObjWasmParserForTests();
  }
});

test('compiled OBJ parser WASM parses mesh attributes and material libraries', async () => {
  const modulePath = path.resolve('public/wasm/obj-parser/objParser.js');
  assert.equal(fs.existsSync(modulePath), true);
  setObjWasmParserModuleUrlForTests(pathToFileURL(modulePath).href);

  try {
    const result = await parseObjModelDataFromTextBytes(
      [
        'mtllib paint.mtl',
        'o triangle',
        'v 0 0 0 1 0 0',
        'v 1 0 0 0 1 0',
        'v 0 1 0 0 0 1',
        'vt 0 0',
        'vt 1 0',
        'vt 0 1',
        'vn 0 0 1',
        'usemtl red',
        'f 1/1/1 2/2/1 3/3/1',
      ].join('\n'),
    );

    assert.deepEqual(result.materialLibraries, ['paint.mtl']);
    assert.equal(result.children.length, 1);
    assert.equal(result.children[0]?.name, 'triangle');
    assert.equal(result.children[0]?.materials[0]?.name, 'red');
    assert.ok(result.children[0]?.geometry.normal);
    assert.ok(result.children[0]?.geometry.uv);
    assert.ok(result.children[0]?.geometry.color);
    assert.equal(result.children[0]?.geometry.position.array.byteLength > result.children[0]!.geometry.position.byteLength!, true);
    assert.deepEqual(result.children[0]?.geometry.groups, [
      {
        start: 0,
        count: 3,
        materialIndex: 0,
      },
    ]);
  } finally {
    resetObjWasmParserForTests();
  }
});

test('compiled OBJ parser WASM generates OBJLoader-compatible normals and vertex colors', async () => {
  const modulePath = path.resolve('public/wasm/obj-parser/objParser.js');
  assert.equal(fs.existsSync(modulePath), true);
  setObjWasmParserModuleUrlForTests(pathToFileURL(modulePath).href);

  try {
    const result = await parseObjModelDataFromTextBytes(
      [
        'o colored',
        'v 0 0 0 0.545098 0.713726 0.6',
        'v 1 0 0 0.545098 0.713726 0.6',
        'v 0 1 0 0.545098 0.713726 0.6',
        'f 1 2 3',
      ].join('\n'),
    );
    const child = result.children[0];

    assert.ok(child?.geometry.normal, 'expected generated face normals when OBJ has no vn');
    assert.deepEqual(
      Array.from(floatArrayFromAttribute(child.geometry.normal!)),
      [0, 0, 1, 0, 0, 1, 0, 0, 1],
    );

    assert.ok(child.geometry.color, 'expected vertex colors to be retained');
    const colors = Array.from(floatArrayFromAttribute(child.geometry.color!));
    assert.ok(Math.abs(colors[0]! - 0.258183) < 1e-6);
    assert.ok(Math.abs(colors[1]! - 0.467785) < 1e-6);
    assert.ok(Math.abs(colors[2]! - 0.318547) < 1e-6);
  } finally {
    resetObjWasmParserForTests();
  }
});

// The full export -> parse round-trip for vertex colors (real serializer
// output fed to the compiled WASM parser, including the mutation proof that
// reverting the serializer's sRGB encoding fails the test) lives next to the
// serializer under usd-export/objGeometrySerializer.test.ts — keeping the
// core loader test free of a hand-rolled re-encoding of serializer logic.

test('compiled OBJ parser WASM matches OBJLoader geometry for Leap Hand assets', async () => {
  const modulePath = path.resolve('public/wasm/obj-parser/objParser.js');
  assert.equal(fs.existsSync(modulePath), true);
  setObjWasmParserModuleUrlForTests(pathToFileURL(modulePath).href);

  const assetDir = path.resolve('test/mujoco_menagerie-main/leap_hand/assets');
  const assetNames = fs.readdirSync(assetDir).filter((entry) => entry.endsWith('.obj')).sort();

  type GeometryObject = Mesh | LineSegments | Points;

  const collectMeshes = (root: Object3D): GeometryObject[] => {
    const meshes: GeometryObject[] = [];
    root.traverse((child) => {
      if (
        (child as Mesh).isMesh ||
        (child as LineSegments).isLineSegments ||
        (child as Points).isPoints
      ) {
        meshes.push(child as GeometryObject);
      }
    });
    return meshes;
  };

  const maxAttributeDelta = (
    left: BufferAttribute | InterleavedBufferAttribute | undefined,
    right: BufferAttribute | InterleavedBufferAttribute | undefined,
  ): number => {
    if (!left && !right) {
      return 0;
    }
    if (!left || !right || left.count !== right.count || left.itemSize !== right.itemSize) {
      return Number.POSITIVE_INFINITY;
    }

    let maxDelta = 0;
    for (let index = 0; index < left.array.length; index += 1) {
      maxDelta = Math.max(maxDelta, Math.abs(Number(left.array[index]) - Number(right.array[index])));
    }
    return maxDelta;
  };

  try {
    for (const assetName of assetNames) {
      const bytes = fs.readFileSync(path.join(assetDir, assetName));
      const legacyMeshes = collectMeshes(new OBJLoader().parse(bytes.toString('utf8')));
      const wasmMeshes = collectMeshes(
        createObjectFromSerializedObjData(await parseObjModelDataFromBytes(bytes)),
      );

      assert.equal(wasmMeshes.length, legacyMeshes.length, `${assetName}: mesh count`);
      for (let meshIndex = 0; meshIndex < legacyMeshes.length; meshIndex += 1) {
        const legacy = legacyMeshes[meshIndex]!;
        const wasm = wasmMeshes[meshIndex]!;
        assert.equal(wasm.type, legacy.type, `${assetName}: mesh ${meshIndex} type`);
        assert.equal(wasm.name, legacy.name, `${assetName}: mesh ${meshIndex} name`);

        assert.ok(
          maxAttributeDelta(
            legacy.geometry.getAttribute('position'),
            wasm.geometry.getAttribute('position'),
          ) < 1e-7,
          `${assetName}: mesh ${meshIndex} positions differ`,
        );
        assert.ok(
          maxAttributeDelta(
            legacy.geometry.getAttribute('normal'),
            wasm.geometry.getAttribute('normal'),
          ) < 1e-6,
          `${assetName}: mesh ${meshIndex} normals differ`,
        );
        assert.ok(
          maxAttributeDelta(
            legacy.geometry.getAttribute('uv'),
            wasm.geometry.getAttribute('uv'),
          ) < 1e-7,
          `${assetName}: mesh ${meshIndex} uvs differ`,
        );
        assert.ok(
          maxAttributeDelta(
            legacy.geometry.getAttribute('color'),
            wasm.geometry.getAttribute('color'),
          ) < 1e-6,
          `${assetName}: mesh ${meshIndex} colors differ`,
        );
      }
    }
  } finally {
    resetObjWasmParserForTests();
  }
});
