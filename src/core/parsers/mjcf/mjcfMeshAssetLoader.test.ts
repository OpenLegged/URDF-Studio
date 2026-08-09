import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  finalizeLoadedMJCFColladaScene,
  loadMJCFMeshObject,
  type MJCFMeshCache,
} from './mjcfMeshAssetLoader';

const createLegacyMshBuffer = ({
  positions,
  uvs,
  indices,
}: {
  positions: number[];
  uvs?: number[];
  indices?: number[];
}): ArrayBuffer => {
  assert.equal(positions.length % 3, 0, 'positions must contain xyz triplets');
  const nvertex = positions.length / 3;
  const ntexcoord = uvs ? uvs.length / 2 : 0;
  const nface = indices ? indices.length / 3 : 0;

  if (uvs) {
    assert.equal(uvs.length % 2, 0, 'uvs must contain uv pairs');
    assert.equal(ntexcoord, nvertex, 'legacy msh uvs must match vertex count');
  }

  if (indices) {
    assert.equal(indices.length % 3, 0, 'indices must contain triangle triplets');
  }

  const byteLength =
    16 +
    positions.length * Float32Array.BYTES_PER_ELEMENT +
    (uvs?.length ?? 0) * Float32Array.BYTES_PER_ELEMENT +
    (indices?.length ?? 0) * Int32Array.BYTES_PER_ELEMENT;
  const buffer = new ArrayBuffer(byteLength);
  const view = new DataView(buffer);
  view.setInt32(0, nvertex, true);
  view.setInt32(4, 0, true);
  view.setInt32(8, ntexcoord, true);
  view.setInt32(12, nface, true);

  let byteOffset = 16;
  new Float32Array(buffer, byteOffset, positions.length).set(positions);
  byteOffset += positions.length * Float32Array.BYTES_PER_ELEMENT;

  if (uvs) {
    new Float32Array(buffer, byteOffset, uvs.length).set(uvs);
    byteOffset += uvs.length * Float32Array.BYTES_PER_ELEMENT;
  }

  if (indices) {
    new Int32Array(buffer, byteOffset, indices.length).set(indices);
  }

  return buffer;
};

const createGltfBlob = () => {
  const positionBuffer = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer).toString(
    'base64',
  );

  const document = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [
          {
            attributes: {
              POSITION: 0,
            },
          },
        ],
      },
    ],
    buffers: [
      {
        uri: `data:application/octet-stream;base64,${positionBuffer}`,
        byteLength: 36,
      },
    ],
    bufferViews: [
      {
        buffer: 0,
        byteOffset: 0,
        byteLength: 36,
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
    ],
  };

  return new Blob([JSON.stringify(document)], { type: 'model/gltf+json' });
};

test('loadMJCFMeshObject loads legacy msh assets through the MJCF runtime path', async () => {
  const mshBuffer = createLegacyMshBuffer({
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
    uvs: [0, 0, 1, 0, 0, 1, 1, 1],
    indices: [0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3],
  });
  const assetUrl = `data:application/octet-stream;base64,${Buffer.from(mshBuffer).toString('base64')}`;

  const mesh = await loadMJCFMeshObject(assetUrl, 'scene/myosuite_logo.msh', new Map());

  assert.ok(mesh instanceof THREE.Mesh);
  const geometry = mesh.geometry;
  const positions = geometry.getAttribute('position');
  const uvs = geometry.getAttribute('uv');
  const index = geometry.getIndex();

  assert.equal(positions.count, 4);
  assert.ok(uvs);
  assert.deepEqual(Array.from(uvs.array), [0, 0, 1, 0, 0, 1, 1, 1]);
  assert.ok(index);
  assert.deepEqual(Array.from(index.array), [0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3]);
});

test('loadMJCFMeshObject reuses cached GLTF assets within the same mesh cache', async () => {
  const assetUrl = URL.createObjectURL(createGltfBlob());
  const meshCache: MJCFMeshCache = new Map();
  const originalFetch = globalThis.fetch;
  const originalProgressEvent = globalThis.ProgressEvent;
  let fetchCount = 0;

  if (typeof globalThis.ProgressEvent === 'undefined') {
    class TestProgressEvent extends Event {
      loaded: number;
      total: number;

      constructor(type: string, init: { loaded?: number; total?: number } = {}) {
        super(type);
        this.loaded = init.loaded ?? 0;
        this.total = init.total ?? 0;
      }
    }

    globalThis.ProgressEvent = TestProgressEvent as unknown as typeof ProgressEvent;
  }

  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    const request = args[0];
    const requestUrl =
      typeof request === 'string'
        ? request
        : request instanceof URL
          ? request.toString()
          : request.url;

    if (requestUrl === assetUrl) {
      fetchCount += 1;
    }

    return await originalFetch(...args);
  }) as typeof fetch;

  try {
    const first = await loadMJCFMeshObject(assetUrl, 'meshes/reused.gltf', meshCache);
    const second = await loadMJCFMeshObject(assetUrl, 'meshes/reused.gltf', meshCache);

    assert.ok(first instanceof THREE.Object3D);
    assert.ok(second instanceof THREE.Object3D);
    assert.notEqual(first, second);
    assert.equal(fetchCount, 1);

    const firstMesh = first.getObjectByProperty('isMesh', true);
    const secondMesh = second.getObjectByProperty('isMesh', true);
    assert.ok(firstMesh instanceof THREE.Mesh);
    assert.ok(secondMesh instanceof THREE.Mesh);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.ProgressEvent = originalProgressEvent;
    URL.revokeObjectURL(assetUrl);
  }
});

test('finalizeLoadedMJCFColladaScene strips embedded Collada lights so MJCF DAE assets match URDF scene lighting', () => {
  const root = new THREE.Group();
  root.add(new THREE.PointLight(0xffffff, 1));
  root.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x999999 }),
    ),
  );

  const finalized = finalizeLoadedMJCFColladaScene(root);

  const lights: THREE.Light[] = [];
  const meshes: THREE.Mesh[] = [];
  finalized.traverse((child) => {
    if ((child as THREE.Light).isLight) {
      lights.push(child as THREE.Light);
    }
    if ((child as THREE.Mesh).isMesh) {
      meshes.push(child as THREE.Mesh);
    }
  });

  assert.equal(lights.length, 0);
  assert.ok(meshes.length > 0);
});

test('loadMJCFMeshObject warns and returns null for unsupported mesh formats instead of throwing', async () => {
  const result = await loadMJCFMeshObject('https://example.com/robot.ply', 'meshes/robot.ply', new Map());
  assert.equal(result, null);
});
