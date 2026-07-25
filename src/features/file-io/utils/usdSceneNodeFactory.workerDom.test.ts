import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { GeometryType, type UrdfVisual } from '@/types';

import { collectUsdExportAssetFiles } from './usdAssetCollection.ts';
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

const createTexturedTriangleGltfBlob = () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const uv = new Float32Array([0, 0, 1, 0, 0, 1]);
  const indices = new Uint16Array([0, 1, 2]);
  const positionBytes = new Uint8Array(positions.buffer);
  const uvBytes = new Uint8Array(uv.buffer);
  const indexBytes = new Uint8Array(indices.buffer);
  const combined = new Uint8Array(
    positionBytes.byteLength + uvBytes.byteLength + indexBytes.byteLength,
  );

  combined.set(positionBytes, 0);
  combined.set(uvBytes, positionBytes.byteLength);
  combined.set(indexBytes, positionBytes.byteLength + uvBytes.byteLength);

  const textureDataUrl =
    'data:image/png;base64,' +
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5Wm0cAAAAASUVORK5CYII=';
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
        ],
      },
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
        },
      },
    ],
    textures: [{ source: 0 }],
    images: [{ uri: textureDataUrl }],
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
        byteLength: uvBytes.byteLength,
        target: 34962,
      },
      {
        buffer: 0,
        byteOffset: positionBytes.byteLength + uvBytes.byteLength,
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
    ],
  };

  return new Blob([JSON.stringify(gltf)], { type: 'model/gltf+json' });
};

type WorkerImageGlobalSnapshot = {
  Image: typeof globalThis.Image;
  HTMLImageElement: typeof globalThis.HTMLImageElement;
  createImageBitmap: typeof globalThis.createImageBitmap;
  document: typeof globalThis.document;
  self: (typeof globalThis & { self?: typeof globalThis })['self'];
};

function captureWorkerImageGlobals(): WorkerImageGlobalSnapshot {
  return {
    Image: globalThis.Image,
    HTMLImageElement: globalThis.HTMLImageElement,
    createImageBitmap: globalThis.createImageBitmap,
    document: globalThis.document,
    self: (globalThis as typeof globalThis & { self?: typeof globalThis }).self,
  };
}

function restoreWorkerImageGlobals(snapshot: WorkerImageGlobalSnapshot): void {
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
}

test('buildUsdVisualSceneNode loads textured GLTF meshes in worker-like environments without DOM image globals', async () => {
  const meshPath = 'meshes/textured_triangle.gltf';
  const { registry, tempObjectUrls } = createUsdAssetRegistry(
    {},
    new Map([[meshPath, createTexturedTriangleGltfBlob()]]),
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
    });
    assert.ok(node);

    const mesh = node.getObjectByProperty('isMesh', true);
    assert.ok(mesh instanceof THREE.Mesh);

    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    assert.ok(material instanceof THREE.MeshStandardMaterial);
    assert.ok(material.map, 'expected textured GLTF scene to restore material.map');
    assert.equal(typeof globalThis.HTMLImageElement, 'function');
    assert.ok(
      material.map.source.data instanceof globalThis.HTMLImageElement,
      'expected textured GLTF worker load to install an image polyfill source',
    );
    assert.match(String(material.map.source.data.src), /^data:image\/png;base64,/);
    assert.match(String(material.map.userData.usdSourcePath), /^data:image\/png;base64,/);

    material.map.source.data = { width: 1, height: 1 };

    const context = await collectUsdSerializationContext(node);
    const textureRecord = context.materialByObject.get(mesh)?.appearance.texture;
    assert.match(textureRecord?.sourcePath ?? '', /^data:image\/png;base64,/);
    assert.match(textureRecord?.exportPath ?? '', /^external_[a-f0-9]{8}\.png$/);

    const archiveFiles = await collectUsdExportAssetFiles({
      sceneRoot: node,
      context,
      registry,
    });
    assert.deepEqual(
      Array.from(archiveFiles.keys()).map((assetPath) =>
        assetPath.replace(/[a-f0-9]{8}/, '<hash>'),
      ),
      ['assets/external_<hash>.png'],
    );
  } finally {
    restoreWorkerImageGlobals(snapshot);
    tempObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  }
});
