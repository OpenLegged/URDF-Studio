import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { GeometryType, type UrdfVisual } from '@/types';

import { createUsdAssetRegistry } from './usdAssetRegistry.ts';
import { buildUsdVisualSceneNode } from './usdSceneNodeFactory.ts';
import { collectUsdSerializationContext } from './usdSerializationContext.ts';

if (typeof globalThis.ProgressEvent === 'undefined') {
  class ProgressEventPolyfill extends Event {
    loaded: number;
    total: number;
    lengthComputable: boolean;

    constructor(
      type: string,
      init: { loaded?: number; total?: number; lengthComputable?: boolean } = {},
    ) {
      super(type);
      this.loaded = init.loaded ?? 0;
      this.total = init.total ?? 0;
      this.lengthComputable = init.lengthComputable ?? false;
    }
  }

  globalThis.ProgressEvent = ProgressEventPolyfill as typeof ProgressEvent;
}

const createUvObjBlob = () => {
  return new Blob(
    [
      [
        'o textured_triangle',
        'v 0 0 0',
        'v 1 0 0',
        'v 0 1 0',
        'vt 0 0',
        'vt 1 0',
        'vt 0 1',
        'f 1/1 2/2 3/3',
      ].join('\n'),
    ],
    { type: 'text/plain;charset=utf-8' },
  );
};

const createTriangleStlBlob = () => {
  return new Blob(
    [
      [
        'solid triangle',
        'facet normal 0 0 1',
        'outer loop',
        'vertex 0 0 0',
        'vertex 1 0 0',
        'vertex 0 1 0',
        'endloop',
        'endfacet',
        'endsolid triangle',
      ].join('\n'),
    ],
    { type: 'model/stl' },
  );
};

const createTriangleGltfBlob = () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint16Array([0, 1, 2]);
  const positionBytes = new Uint8Array(positions.buffer);
  const indexBytes = new Uint8Array(indices.buffer);
  const combined = new Uint8Array(positionBytes.byteLength + indexBytes.byteLength);

  combined.set(positionBytes, 0);
  combined.set(indexBytes, positionBytes.byteLength);

  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [
      {
        uri: `data:application/octet-stream;base64,${Buffer.from(combined).toString('base64')}`,
        byteLength: combined.byteLength,
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.byteLength, target: 34962 },
      {
        buffer: 0,
        byteOffset: positionBytes.byteLength,
        byteLength: indexBytes.byteLength,
        target: 34963,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
      {
        bufferView: 1,
        componentType: 5123,
        count: 3,
        type: 'SCALAR',
      },
    ],
  };

  return new Blob([JSON.stringify(gltf)], { type: 'model/gltf+json' });
};

const createTriangleGlbBlob = () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint16Array([0, 1, 2]);
  const positionBytes = new Uint8Array(positions.buffer);
  const indexBytes = new Uint8Array(indices.buffer);
  const binaryBytes = new Uint8Array(positionBytes.byteLength + indexBytes.byteLength);
  binaryBytes.set(positionBytes, 0);
  binaryBytes.set(indexBytes, positionBytes.byteLength);

  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: binaryBytes.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.byteLength, target: 34962 },
      {
        buffer: 0,
        byteOffset: positionBytes.byteLength,
        byteLength: indexBytes.byteLength,
        target: 34963,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
      {
        bufferView: 1,
        componentType: 5123,
        count: 3,
        type: 'SCALAR',
      },
    ],
  };
  const encodedJson = new TextEncoder().encode(JSON.stringify(gltf));
  const paddedJsonLength = Math.ceil(encodedJson.byteLength / 4) * 4;
  const paddedBinaryLength = Math.ceil(binaryBytes.byteLength / 4) * 4;
  const totalLength = 12 + 8 + paddedJsonLength + 8 + paddedBinaryLength;
  const glb = new Uint8Array(totalLength);
  const view = new DataView(glb.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, paddedJsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  glb.fill(0x20, 20, 20 + paddedJsonLength);
  glb.set(encodedJson, 20);
  const binaryChunkOffset = 20 + paddedJsonLength;
  view.setUint32(binaryChunkOffset, paddedBinaryLength, true);
  view.setUint32(binaryChunkOffset + 4, 0x004e4942, true);
  glb.set(binaryBytes, binaryChunkOffset + 8);

  return new Blob([glb], { type: 'model/gltf-binary' });
};

const RED_TEXTURE_DATA_URL =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8AABQMBgK8NtwAAAABJRU5ErkJggg==';

const BLUE_TEXTURE_DATA_URL =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAS0jz1cAAAAASUVORK5CYII=';

const createDualTexturedMultiPrimitiveGltfBlob = () => {
  const firstPositions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const secondPositions = new Float32Array([1, 0, 0, 2, 0, 0, 1, 1, 0]);
  const firstUv = new Float32Array([0, 0, 1, 0, 0, 1]);
  const secondUv = new Float32Array([0, 0, 1, 0, 0, 1]);
  const firstIndices = new Uint16Array([0, 1, 2]);
  const secondIndices = new Uint16Array([0, 1, 2]);
  const sections = [
    new Uint8Array(firstPositions.buffer),
    new Uint8Array(firstUv.buffer),
    new Uint8Array(firstIndices.buffer),
    new Uint8Array(secondPositions.buffer),
    new Uint8Array(secondUv.buffer),
    new Uint8Array(secondIndices.buffer),
  ];
  const totalBytes = sections.reduce((sum, section) => sum + section.byteLength, 0);
  const combined = new Uint8Array(totalBytes);
  let offset = 0;

  sections.forEach((section) => {
    combined.set(section, offset);
    offset += section.byteLength;
  });

  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, TEXCOORD_0: 1 },
            indices: 2,
            material: 0,
          },
          {
            attributes: { POSITION: 3, TEXCOORD_0: 4 },
            indices: 5,
            material: 1,
          },
        ],
      },
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
        },
      },
      {
        pbrMetallicRoughness: {
          baseColorTexture: { index: 1 },
        },
      },
    ],
    textures: [{ source: 0 }, { source: 1 }],
    images: [{ uri: RED_TEXTURE_DATA_URL }, { uri: BLUE_TEXTURE_DATA_URL }],
    buffers: [
      {
        uri: `data:application/octet-stream;base64,${Buffer.from(combined).toString('base64')}`,
        byteLength: combined.byteLength,
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: sections[0].byteLength, target: 34962 },
      {
        buffer: 0,
        byteOffset: sections[0].byteLength,
        byteLength: sections[1].byteLength,
        target: 34962,
      },
      {
        buffer: 0,
        byteOffset: sections[0].byteLength + sections[1].byteLength,
        byteLength: sections[2].byteLength,
        target: 34963,
      },
      {
        buffer: 0,
        byteOffset: sections[0].byteLength + sections[1].byteLength + sections[2].byteLength,
        byteLength: sections[3].byteLength,
        target: 34962,
      },
      {
        buffer: 0,
        byteOffset:
          sections[0].byteLength +
          sections[1].byteLength +
          sections[2].byteLength +
          sections[3].byteLength,
        byteLength: sections[4].byteLength,
        target: 34962,
      },
      {
        buffer: 0,
        byteOffset:
          sections[0].byteLength +
          sections[1].byteLength +
          sections[2].byteLength +
          sections[3].byteLength +
          sections[4].byteLength,
        byteLength: sections[5].byteLength,
        target: 34963,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
      {
        bufferView: 1,
        componentType: 5126,
        count: 3,
        type: 'VEC2',
      },
      {
        bufferView: 2,
        componentType: 5123,
        count: 3,
        type: 'SCALAR',
      },
      {
        bufferView: 3,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [1, 0, 0],
        max: [2, 1, 0],
      },
      {
        bufferView: 4,
        componentType: 5126,
        count: 3,
        type: 'VEC2',
      },
      {
        bufferView: 5,
        componentType: 5123,
        count: 3,
        type: 'SCALAR',
      },
    ],
  };

  return new Blob([JSON.stringify(gltf)], { type: 'model/gltf+json' });
};

const createMeshVisual = (meshPath: string): UrdfVisual => {
  return {
    type: GeometryType.MESH,
    meshPath,
    dimensions: { x: 2, y: 3, z: 4 },
    color: '#6699ff',
    origin: {
      xyz: { x: 1, y: 2, z: 3 },
      rpy: { r: 0, p: Math.PI / 2, y: 0 },
    },
  };
};

type WorkerImageGlobalSnapshot = {
  Image: typeof globalThis.Image;
  HTMLImageElement: typeof globalThis.HTMLImageElement;
  createImageBitmap: typeof globalThis.createImageBitmap;
  document: typeof globalThis.document;
  self: (typeof globalThis & { self?: typeof globalThis })['self'];
};

const captureWorkerImageGlobals = (): WorkerImageGlobalSnapshot => {
  return {
    Image: globalThis.Image,
    HTMLImageElement: globalThis.HTMLImageElement,
    createImageBitmap: globalThis.createImageBitmap,
    document: globalThis.document,
    self: (globalThis as typeof globalThis & { self?: typeof globalThis }).self,
  };
};

const restoreWorkerImageGlobals = (snapshot: WorkerImageGlobalSnapshot): void => {
  if (snapshot.document) {
    globalThis.document = snapshot.document;
  } else {
    Reflect.deleteProperty(globalThis, 'document');
  }

  if (snapshot.HTMLImageElement) {
    globalThis.HTMLImageElement = snapshot.HTMLImageElement;
  } else {
    Reflect.deleteProperty(globalThis, 'HTMLImageElement');
  }

  if (snapshot.Image) {
    globalThis.Image = snapshot.Image;
  } else {
    Reflect.deleteProperty(globalThis, 'Image');
  }

  if (snapshot.createImageBitmap) {
    globalThis.createImageBitmap = snapshot.createImageBitmap;
  } else {
    Reflect.deleteProperty(globalThis, 'createImageBitmap');
  }

  if (snapshot.self) {
    (globalThis as typeof globalThis & { self?: typeof globalThis }).self = snapshot.self;
  } else {
    Reflect.deleteProperty(globalThis, 'self');
  }
};

test('buildUsdVisualSceneNode creates primitive anchors with serialized USD geometry metadata', async () => {
  const visual: UrdfVisual = {
    type: GeometryType.BOX,
    dimensions: { x: 0.4, y: 0.2, z: 0.1 },
    color: '#4f46e5',
    origin: {
      xyz: { x: 0.25, y: 0.5, z: 0.75 },
      rpy: { r: 0, p: 0, y: 0 },
    },
  };

  const node = await buildUsdVisualSceneNode({
    visual,
    role: 'visual',
    registry: createUsdAssetRegistry({}).registry,
    materialState: { color: '#12ab34' },
  });

  assert.ok(node instanceof THREE.Group);
  assert.equal(node.name, 'visual');
  assert.deepEqual(node.position.toArray(), [0.25, 0.5, 0.75]);
  assert.deepEqual(node.scale.toArray(), [0.4, 0.2, 0.1]);
  assert.equal(node.children.length, 1);

  const primitive = node.children[0];
  assert.equal(primitive.name, 'box');
  assert.equal(primitive.userData.usdGeomType, 'Cube');
  assert.equal(primitive.userData.usdDisplayColor, '#12ab34');
});

test('buildUsdVisualSceneNode downgrades unsupported collision primitives to USD cube fallbacks', async () => {
  const planeCollision: UrdfVisual = {
    type: GeometryType.PLANE,
    dimensions: { x: 6, y: 4, z: 0 },
    color: '#ef4444',
    origin: {
      xyz: { x: 0, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: 0 },
    },
  };

  const node = await buildUsdVisualSceneNode({
    visual: planeCollision,
    role: 'collision',
    registry: createUsdAssetRegistry({}).registry,
  });

  assert.ok(node instanceof THREE.Group);
  assert.deepEqual(node.scale.toArray(), [6, 4, 0.001]);
  assert.equal(node.userData.usdPurpose, 'guide');
  assert.equal(node.userData.usdCollision, true);
  assert.equal(node.children.length, 1);

  const primitive = node.children[0];
  assert.equal(primitive.name, 'plane_as_box');
  assert.equal(primitive.userData.usdGeomType, 'Cube');
  assert.equal(primitive.userData.usdFallbackSourceType, GeometryType.PLANE);
  assert.equal(primitive.userData.usdPurpose, 'guide');
  assert.equal(primitive.userData.usdCollision, true);
});

test('buildUsdVisualSceneNode splits six-face box palettes into per-face meshes for USD export', async () => {
  const visual: UrdfVisual = {
    type: GeometryType.BOX,
    dimensions: { x: 0.6, y: 0.4, z: 0.2 },
    color: '#ffffff',
    origin: {
      xyz: { x: 0.1, y: 0.2, z: 0.3 },
      rpy: { r: 0, p: 0, y: 0 },
    },
    authoredMaterials: [
      { texture: 'textures/right.png', opacity: 0.25 },
      { texture: 'textures/left.png' },
      { texture: 'textures/up.png' },
      { texture: 'textures/down.png' },
      { texture: 'textures/front.png' },
      { texture: 'textures/back.png' },
    ],
  };

  const node = await buildUsdVisualSceneNode({
    visual,
    role: 'visual',
    registry: createUsdAssetRegistry({}).registry,
  });

  assert.ok(node instanceof THREE.Group);
  assert.equal(node.children.length, 6);
  assert.deepEqual(node.scale.toArray(), [0.6, 0.4, 0.2]);

  const texturesByMeshName = new Map(
    node.children.map((child) => [
      child.name,
      (child as THREE.Mesh).userData?.usdMaterial?.texture,
    ]),
  );

  assert.equal(texturesByMeshName.get('box_right'), 'textures/right.png');
  assert.equal(texturesByMeshName.get('box_left'), 'textures/left.png');
  assert.equal(texturesByMeshName.get('box_up'), 'textures/up.png');
  assert.equal(texturesByMeshName.get('box_down'), 'textures/down.png');
  assert.equal(texturesByMeshName.get('box_front'), 'textures/front.png');
  assert.equal(texturesByMeshName.get('box_back'), 'textures/back.png');
  assert.equal(node.getObjectByName('box_right')?.userData.usdOpacity, 0.25);
  node.children.forEach((child) => {
    assert.ok(child instanceof THREE.Mesh);
    assert.equal(child.userData.usdGeomType, undefined);
  });
});

test('buildUsdVisualSceneNode loads mesh visuals with anchor transforms and explicit display colors', async () => {
  const meshPath = 'meshes/textured_triangle.obj';
  const { registry, tempObjectUrls } = createUsdAssetRegistry(
    {},
    new Map([[meshPath, createUvObjBlob()]]),
  );

  try {
    const node = await buildUsdVisualSceneNode({
      visual: createMeshVisual(meshPath),
      role: 'visual',
      registry,
      materialState: { color: '#12ab34' },
    });

    assert.ok(node instanceof THREE.Group);
    assert.equal(node.name, 'visual');
    assert.deepEqual(node.position.toArray(), [1, 2, 3]);
    assert.deepEqual(node.scale.toArray(), [2, 3, 4]);

    const mesh = node.getObjectByProperty('isMesh', true);
    assert.ok(mesh instanceof THREE.Mesh);
    assert.equal(mesh.userData.usdDisplayColor, '#12ab34');
    assert.ok(mesh.material instanceof THREE.MeshStandardMaterial);
    assert.equal(mesh.material.side, THREE.FrontSide);
  } finally {
    tempObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  }
});

test('buildUsdVisualSceneNode parses STL meshes inline when browser Worker support is unavailable', async () => {
  const meshPath = 'meshes/triangle.stl';
  const { registry, tempObjectUrls } = createUsdAssetRegistry(
    {},
    new Map([[meshPath, createTriangleStlBlob()]]),
  );
  const workerSnapshot = (globalThis as typeof globalThis & { Worker?: typeof Worker }).Worker;

  Reflect.deleteProperty(globalThis, 'Worker');

  try {
    const node = await buildUsdVisualSceneNode({
      visual: createMeshVisual(meshPath),
      role: 'visual',
      registry,
      materialState: { color: '#12ab34' },
    });

    const mesh = node?.getObjectByProperty('isMesh', true);
    assert.ok(mesh instanceof THREE.Mesh);
    assert.equal(mesh.geometry.getAttribute('position')?.count, 3);
    assert.equal(mesh.userData.usdDisplayColor, '#12ab34');
  } finally {
    if (workerSnapshot) {
      (globalThis as typeof globalThis & { Worker?: typeof Worker }).Worker = workerSnapshot;
    } else {
      Reflect.deleteProperty(globalThis, 'Worker');
    }
    tempObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  }
});

test('buildUsdVisualSceneNode reuses processed STL geometry per registry while keeping mesh materials isolated', async () => {
  const meshPath = 'meshes/reused_triangle.stl';
  const { registry, tempObjectUrls } = createUsdAssetRegistry(
    {},
    new Map([[meshPath, createTriangleStlBlob()]]),
  );

  try {
    const firstNode = await buildUsdVisualSceneNode({
      visual: createMeshVisual(meshPath),
      role: 'visual',
      registry,
      materialState: { color: '#12ab34' },
      meshCompression: { enabled: true, quality: 50 },
    });
    const secondNode = await buildUsdVisualSceneNode({
      visual: createMeshVisual(meshPath),
      role: 'visual',
      registry,
      materialState: { color: '#ef4444' },
      meshCompression: { enabled: true, quality: 50 },
    });

    const firstMesh = firstNode?.getObjectByProperty('isMesh', true);
    const secondMesh = secondNode?.getObjectByProperty('isMesh', true);

    assert.ok(firstMesh instanceof THREE.Mesh);
    assert.ok(secondMesh instanceof THREE.Mesh);
    assert.equal(firstMesh.geometry, secondMesh.geometry);

    const firstMaterial = Array.isArray(firstMesh.material)
      ? firstMesh.material[0]
      : firstMesh.material;
    const secondMaterial = Array.isArray(secondMesh.material)
      ? secondMesh.material[0]
      : secondMesh.material;
    assert.notEqual(firstMaterial, secondMaterial);
    assert.equal(firstMesh.userData.usdDisplayColor, '#12ab34');
    assert.equal(secondMesh.userData.usdDisplayColor, '#ef4444');
  } finally {
    tempObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  }
});

test('buildUsdVisualSceneNode marks collision mesh anchors and descendants for USD collision serialization', async () => {
  const meshPath = 'meshes/collision_triangle.obj';
  const { registry, tempObjectUrls } = createUsdAssetRegistry(
    {},
    new Map([[meshPath, createUvObjBlob()]]),
  );

  try {
    const node = await buildUsdVisualSceneNode({
      visual: createMeshVisual(meshPath),
      role: 'collision',
      registry,
    });

    assert.ok(node instanceof THREE.Group);
    assert.equal(node.userData.usdPurpose, 'guide');
    assert.equal(node.userData.usdCollision, true);
    assert.equal(node.userData.usdMeshCollision, true);

    const mesh = node.getObjectByProperty('isMesh', true);
    assert.ok(mesh instanceof THREE.Mesh);
    assert.equal(mesh.userData.usdPurpose, 'guide');
    assert.equal(mesh.userData.usdCollision, true);
    assert.equal(mesh.userData.usdMeshCollision, true);
  } finally {
    tempObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  }
});

test('buildUsdVisualSceneNode skips authored material palette work for collision meshes', async () => {
  const meshPath = 'meshes/collision_palette.obj';
  const { registry, tempObjectUrls } = createUsdAssetRegistry(
    {},
    new Map([[meshPath, createUvObjBlob()]]),
  );

  try {
    const node = await buildUsdVisualSceneNode({
      visual: {
        ...createMeshVisual(meshPath),
        authoredMaterials: [
          { name: 'painted_collision', color: '#12ab34' },
          { name: 'painted_collision_alt', color: '#ef4444' },
        ],
      },
      role: 'collision',
      registry,
    });

    assert.ok(node instanceof THREE.Group);

    const mesh = node.getObjectByProperty('isMesh', true);
    assert.ok(mesh instanceof THREE.Mesh);
    assert.equal(mesh.userData.usdMaterial, undefined);
    assert.equal(mesh.userData.usdMaterialPalette, undefined);
    assert.equal(mesh.userData.usdAuthoredColor, undefined);
  } finally {
    tempObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  }
});

test('buildUsdVisualSceneNode reuses parsed GLTF assets per registry while returning isolated meshes', async () => {
  const meshPath = 'meshes/reused_triangle.gltf';
  const { registry, tempObjectUrls } = createUsdAssetRegistry(
    {},
    new Map([[meshPath, createTriangleGltfBlob()]]),
  );
  const originalFetch = globalThis.fetch;
  let rootFetchCount = 0;

  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    const request = args[0];
    const requestUrl =
      typeof request === 'string'
        ? request
        : request instanceof URL
          ? request.toString()
          : request.url;

    if (requestUrl === tempObjectUrls[0]) {
      rootFetchCount += 1;
    }

    return await originalFetch(...args);
  }) as typeof fetch;

  try {
    const firstNode = await buildUsdVisualSceneNode({
      visual: createMeshVisual(meshPath),
      role: 'visual',
      registry,
      materialState: { color: '#12ab34' },
    });
    const secondNode = await buildUsdVisualSceneNode({
      visual: createMeshVisual(meshPath),
      role: 'visual',
      registry,
      materialState: { color: '#12ab34' },
    });

    const firstMesh = firstNode?.getObjectByProperty('isMesh', true);
    const secondMesh = secondNode?.getObjectByProperty('isMesh', true);

    assert.ok(firstMesh instanceof THREE.Mesh);
    assert.ok(secondMesh instanceof THREE.Mesh);
    assert.equal(rootFetchCount, 1);
    assert.notEqual(firstMesh.geometry, secondMesh.geometry);

    const firstMaterial = Array.isArray(firstMesh.material)
      ? firstMesh.material[0]
      : firstMesh.material;
    const secondMaterial = Array.isArray(secondMesh.material)
      ? secondMesh.material[0]
      : secondMesh.material;
    assert.notEqual(firstMaterial, secondMaterial);
  } finally {
    globalThis.fetch = originalFetch;
    tempObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  }
});

test('buildUsdVisualSceneNode loads binary GLB mesh geometry', async () => {
  const meshPath = 'meshes/triangle.glb';
  const { registry, tempObjectUrls } = createUsdAssetRegistry(
    {},
    new Map([[meshPath, createTriangleGlbBlob()]]),
  );

  try {
    const node = await buildUsdVisualSceneNode({
      visual: createMeshVisual(meshPath),
      role: 'visual',
      registry,
      materialState: { color: '#12ab34' },
    });
    const mesh = node?.getObjectByProperty('isMesh', true);

    assert.ok(mesh instanceof THREE.Mesh);
    assert.equal(mesh.geometry.getAttribute('position')?.count, 3);
    assert.equal(mesh.userData.usdDisplayColor, '#12ab34');
  } finally {
    tempObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  }
});

test('buildUsdVisualSceneNode collapses multi-appearance mesh imports to a single USD appearance when forceUniformOverride is enabled', async () => {
  const meshPath = 'meshes/dual_textured_triangles.gltf';
  const { registry, tempObjectUrls } = createUsdAssetRegistry(
    {},
    new Map([[meshPath, createDualTexturedMultiPrimitiveGltfBlob()]]),
  );
  const snapshot = captureWorkerImageGlobals();

  Reflect.deleteProperty(globalThis, 'document');
  Reflect.deleteProperty(globalThis, 'HTMLImageElement');
  Reflect.deleteProperty(globalThis, 'Image');
  Reflect.deleteProperty(globalThis, 'createImageBitmap');
  (globalThis as typeof globalThis & { self?: Window & typeof globalThis }).self =
    globalThis as unknown as Window & typeof globalThis;

  try {
    const node = await buildUsdVisualSceneNode({
      visual: createMeshVisual(meshPath),
      role: 'visual',
      registry,
      materialState: {
        color: '#12ab34',
        forceUniformOverride: true,
      },
    });

    assert.ok(node instanceof THREE.Group);

    const meshes: THREE.Mesh[] = [];
    node.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        meshes.push(child as THREE.Mesh);
      }
    });

    assert.ok(
      meshes.length >= 2,
      'expected multi-appearance source asset to yield multiple meshes',
    );

    const sceneRoot = new THREE.Group();
    sceneRoot.name = 'demo_robot';
    sceneRoot.add(node);

    const context = await collectUsdSerializationContext(sceneRoot, {
      rootPrimName: 'demo_robot',
    });

    assert.equal(context.materialRecords.length, 1);
    assert.equal(context.materialRecords[0]?.appearance.texture, null);
    assert.equal(context.materialRecords[0]?.appearance.color.getHexString(), '12ab34');

    const uniqueRecords = new Set(meshes.map((mesh) => context.materialByObject.get(mesh)));
    assert.equal(uniqueRecords.size, 1);
    assert.equal(uniqueRecords.has(context.materialRecords[0]), true);
  } finally {
    restoreWorkerImageGlobals(snapshot);
    tempObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  }
});
