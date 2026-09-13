import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { JSDOM } from 'jsdom';

import {
  buildColladaRootNormalizationHints,
  createMeshLoader,
  findAssetByPath,
  markMaterialAsCoplanarOffset,
  postProcessColladaScene,
} from '@/core/loaders';
import { collectExplicitlyScaledMeshPaths } from '@/core/loaders/meshScaleHints';
import {
  createSceneFromSerializedColladaData,
  parseColladaSceneData,
} from '@/core/loaders/colladaWorkerSceneData';
import { normalizeMeshPathForExport } from '@/core/parsers/meshPathUtils';
import { resolveRuntimeMeshMaterialGroupKey } from '@/core/utils/meshMaterialGroups';
import { DEFAULT_LINK, GeometryType, type RobotState } from '@/types';
import { disposeObject3D } from '@/shared/utils/three/dispose';

import { __mjcfMeshExportInternals, prepareMjcfMeshExportAssets } from './mjcfMeshExport';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;
globalThis.ProgressEvent = dom.window.ProgressEvent as typeof ProgressEvent;

function getWorldBox(object: THREE.Object3D): THREE.Box3 {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object);
}

function expectBoxEquals(actual: THREE.Box3, expected: THREE.Box3, epsilon = 1e-5): void {
  const actualMin = actual.min.toArray();
  const expectedMin = expected.min.toArray();
  const actualMax = actual.max.toArray();
  const expectedMax = expected.max.toArray();

  actualMin.forEach((value, index) => {
    assert.ok(Math.abs(value - expectedMin[index]) < epsilon);
  });
  actualMax.forEach((value, index) => {
    assert.ok(Math.abs(value - expectedMax[index]) < epsilon);
  });
}

function parseObjObject(content: string): THREE.Group {
  const object = new OBJLoader().parse(content);
  object.updateMatrixWorld(true);
  return object;
}

function countObjFaces(content: string): number {
  return content.split(/\r?\n/).filter((line) => line.startsWith('f ')).length;
}

function createLegacyMshBuffer({
  positions,
  normals,
  uvs,
  indices,
}: {
  positions: number[];
  normals?: number[];
  uvs?: number[];
  indices?: number[];
}): ArrayBuffer {
  assert.equal(positions.length % 3, 0, 'positions must contain xyz triplets');
  const nvertex = positions.length / 3;
  const nnormal = normals ? normals.length / 3 : 0;
  const ntexcoord = uvs ? uvs.length / 2 : 0;
  const nface = indices ? indices.length / 3 : 0;

  if (normals) {
    assert.equal(normals.length % 3, 0, 'normals must contain xyz triplets');
    assert.equal(nnormal, nvertex, 'legacy msh normals must match vertex count');
  }

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
    (normals?.length ?? 0) * Float32Array.BYTES_PER_ELEMENT +
    (uvs?.length ?? 0) * Float32Array.BYTES_PER_ELEMENT +
    (indices?.length ?? 0) * Int32Array.BYTES_PER_ELEMENT;
  const buffer = new ArrayBuffer(byteLength);
  const view = new DataView(buffer);
  view.setInt32(0, nvertex, true);
  view.setInt32(4, nnormal, true);
  view.setInt32(8, ntexcoord, true);
  view.setInt32(12, nface, true);

  let byteOffset = 16;
  new Float32Array(buffer, byteOffset, positions.length).set(positions);
  byteOffset += positions.length * Float32Array.BYTES_PER_ELEMENT;

  if (normals) {
    new Float32Array(buffer, byteOffset, normals.length).set(normals);
    byteOffset += normals.length * Float32Array.BYTES_PER_ELEMENT;
  }

  if (uvs) {
    new Float32Array(buffer, byteOffset, uvs.length).set(uvs);
    byteOffset += uvs.length * Float32Array.BYTES_PER_ELEMENT;
  }

  if (indices) {
    new Int32Array(buffer, byteOffset, indices.length).set(indices);
  }

  return buffer;
}

test('mjcf mesh export internals accept BufferGeometry-like objects from foreign Three runtimes', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1], 3),
  );
  geometry.clearGroups();
  geometry.addGroup(0, 3, 0);
  geometry.addGroup(3, 3, 1);

  const foreignGeometry = {
    isBufferGeometry: true,
    attributes: geometry.attributes,
    groups: geometry.groups,
    morphAttributes: geometry.morphAttributes,
    morphTargetsRelative: geometry.morphTargetsRelative,
    clone: () => geometry.clone(),
    getAttribute: geometry.getAttribute.bind(geometry),
    getIndex: geometry.getIndex.bind(geometry),
  } as unknown as THREE.BufferGeometry;

  const mesh = new THREE.Mesh(foreignGeometry, [
    new THREE.MeshStandardMaterial({ color: '#112233' }),
    new THREE.MeshStandardMaterial({ color: '#445566' }),
  ]);
  mesh.updateMatrixWorld(true);

  const bakedMesh = __mjcfMeshExportInternals.createBakedVariantMesh(
    mesh,
    (mesh.material as THREE.Material[])[1]!,
    1,
  );

  assert.ok(bakedMesh, 'expected variant extraction to work for BufferGeometry-like meshes');
  assert.equal((bakedMesh!.geometry as THREE.BufferGeometry).getAttribute('position')?.count, 3);
});

test('mjcf mesh export internals bake duplicate coplanar anchor subsets in world space', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  geometry.clearGroups();
  geometry.addGroup(0, 3, 0);
  geometry.addGroup(0, 3, 1);

  const anchorMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff' });
  anchorMaterial.name = 'logo.001';
  const shellMaterial = markMaterialAsCoplanarOffset(
    new THREE.MeshStandardMaterial({ color: '#666666' }),
  );
  shellMaterial.name = 'shell';

  const mesh = new THREE.Mesh(geometry, [anchorMaterial, shellMaterial]);
  mesh.scale.setScalar(10);
  mesh.updateMatrixWorld(true);

  const bakedAnchorMesh = __mjcfMeshExportInternals.createBakedVariantMesh(mesh, anchorMaterial, 0);
  assert.ok(bakedAnchorMesh, 'expected anchor material subset to remain exportable');

  const bakedOffsetMesh = __mjcfMeshExportInternals.createBakedVariantMesh(mesh, shellMaterial, 1);
  assert.equal(
    bakedOffsetMesh,
    null,
    'expected exact duplicate shell subset to yield to the anchor subset',
  );

  const position = (bakedAnchorMesh!.geometry as THREE.BufferGeometry).getAttribute('position');
  assert.ok(position, 'expected baked anchor mesh to retain positions');
  assert.equal(position.count, 3);
  assert.ok(Math.abs(position.getX(1) - 10) < 1e-6);
  assert.ok(Math.abs(position.getY(2) - 10) < 1e-6);
  for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
    assert.ok(
      Math.abs(position.getZ(vertexIndex) - 1e-4) < 1e-7,
      'expected anchor subset to be lifted by a stable world-space offset',
    );
  }

  (bakedAnchorMesh!.geometry as THREE.BufferGeometry).dispose();
  (bakedAnchorMesh!.material as THREE.Material).dispose();
});

test('MJCF mesh export retains nearby but distinct material surfaces', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    0, 0, 1e-8, 1, 0, 1e-8, 0, 1, 1e-8,
  ], 3));
  geometry.addGroup(0, 3, 0);
  geometry.addGroup(3, 3, 1);
  const firstMaterial = new THREE.MeshStandardMaterial();
  const secondMaterial = markMaterialAsCoplanarOffset(new THREE.MeshStandardMaterial());
  const mesh = new THREE.Mesh(geometry, [firstMaterial, secondMaterial]);
  mesh.updateMatrixWorld(true);
  const baked = __mjcfMeshExportInternals.createBakedVariantMesh(mesh, secondMaterial, 1);
  try {
    assert.ok(baked, 'a distinct surface must not be dropped as a duplicate');
    assert.equal(baked.geometry.getAttribute('position').count, 3);
    assert.ok(baked.geometry.getAttribute('position').getZ(0) > 0);
  } finally {
    baked?.geometry.dispose();
    if (baked) (baked.material as THREE.Material).dispose();
    geometry.dispose();
    firstMaterial.dispose();
    secondMaterial.dispose();
  }
});

test('mjcf mesh export internals accept Color-like material values from foreign Three runtimes', () => {
  const color = new THREE.Color('#aabbcc');
  const foreignMaterial = {
    color: {
      isColor: true,
      r: color.r,
      g: color.g,
      b: color.b,
      getHexString: color.getHexString.bind(color),
    },
  } as unknown as THREE.Material;

  const resolvedColor = __mjcfMeshExportInternals.getMaterialColor(foreignMaterial);
  assert.ok(resolvedColor, 'expected color-like values to be preserved');
  assert.equal(resolvedColor!.getHexString(), color.getHexString());
});

test('mjcf mesh export internals write linear Three material colors back as sRGB hex', () => {
  const sourceHex = '#abb1c5';
  const material = new THREE.MeshStandardMaterial();
  material.color.setRGB(0.6705882353, 0.6941176471, 0.7725490196, THREE.SRGBColorSpace);

  assert.equal(__mjcfMeshExportInternals.colorToHex(material.color), sourceHex);
});

async function loadReferenceMeshObject(
  meshPath: string,
  assets: Record<string, string>,
  robot: RobotState,
): Promise<THREE.Object3D> {
  if (/\.dae$/i.test(meshPath)) {
    const assetUrl = findAssetByPath(meshPath, assets, '');
    assert.ok(assetUrl, `expected Collada asset URL for ${meshPath}`);

    const response = await fetch(assetUrl!);
    assert.ok(response.ok, `expected fetchable Collada asset for ${meshPath}`);

    const colladaText = await response.text();
    const scene = createSceneFromSerializedColladaData(
      parseColladaSceneData(colladaText, assetUrl!),
      {
        manager: new THREE.LoadingManager(),
      },
    );
    const maxDimension = postProcessColladaScene(scene);
    const explicitScaleMeshPaths = collectExplicitlyScaledMeshPaths(robot);
    const normalizedMeshPath = normalizeMeshPathForExport(meshPath);
    const hasExplicitScale =
      explicitScaleMeshPaths.has(meshPath) ||
      Boolean(normalizedMeshPath && explicitScaleMeshPaths.has(normalizedMeshPath));

    if (!hasExplicitScale && maxDimension > 10) {
      scene.scale.setScalar(0.001);
    }

    scene.updateMatrixWorld(true);
    return scene;
  }

  const referenceManager = new THREE.LoadingManager();
  const referenceLoader = createMeshLoader(assets, referenceManager, '', {
    colladaRootNormalizationHints: buildColladaRootNormalizationHints(robot.links),
  });

  return new Promise<THREE.Object3D>((resolve, reject) => {
    referenceLoader(meshPath, referenceManager, (result, err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(result!);
    });
  });
}

function createSingleMeshRobot(meshPath: string): RobotState {
  return {
    name: 'single-mesh-export',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          meshPath,
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
      },
    },
    joints: {},
    materials: {},
  };
}

test('prepareMjcfMeshExportAssets converts go2 Collada meshes into baked OBJ files', async () => {
  const sourcePath = 'package://go2_description/dae/hip.dae';
  const meshFilePath = 'test/unitree_ros/robots/go2_description/dae/hip.dae';
  const meshDataUrl = `data:text/xml;base64,${Buffer.from(fs.readFileSync(meshFilePath, 'utf8')).toString('base64')}`;
  const robot: RobotState = {
    name: 'go2-convert',
    rootLinkId: 'hip_link',
    selection: { type: null, id: null },
    links: {
      hip_link: {
        ...DEFAULT_LINK,
        id: 'hip_link',
        name: 'hip_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#808080',
          meshPath: sourcePath,
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: Math.PI, p: 0, y: 0 },
          },
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
        collisionBodies: [],
      },
    },
    joints: {},
    materials: {},
  };
  const assets = {
    [meshFilePath]: meshDataUrl,
    [sourcePath]: meshDataUrl,
    'hip.dae': meshDataUrl,
  };
  const referenceObject = await loadReferenceMeshObject(sourcePath, assets, robot);

  const prepared = await prepareMjcfMeshExportAssets({
    robot,
    assets,
  });

  const overridePath = prepared.meshPathOverrides.get(sourcePath);
  assert.equal(overridePath, 'dae/hip.obj');

  const convertedBlob = overridePath ? prepared.archiveFiles.get(overridePath) : null;
  assert.ok(convertedBlob);

  const convertedObject = parseObjObject(await convertedBlob!.text());
  assert.ok(Math.abs(convertedObject.rotation.x) < 1e-6);
  assert.ok(Math.abs(convertedObject.rotation.y) < 1e-6);
  assert.ok(Math.abs(convertedObject.rotation.z) < 1e-6);
  expectBoxEquals(getWorldBox(convertedObject), getWorldBox(referenceObject));
});

test('prepareMjcfMeshExportAssets skips redundant full-mesh OBJ exports for visual-only go2 Collada variants', async () => {
  const sourcePath = 'package://go2_description/dae/base.dae';
  const meshFilePath = 'test/unitree_ros/robots/go2_description/dae/base.dae';
  const meshDataUrl = `data:text/xml;base64,${Buffer.from(fs.readFileSync(meshFilePath, 'utf8')).toString('base64')}`;
  const robot: RobotState = {
    name: 'go2-visual-variants',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          meshPath: sourcePath,
          authoredMaterials: [
            { name: 'dark_rubber', color: '#abb0c5' },
            { name: 'logo', color: '#ffffff' },
            { name: 'sticker', color: '#020202' },
            { name: 'metal', color: '#030303' },
            { name: 'plastic', color: '#050505' },
          ],
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: Math.PI, p: 0, y: 0 },
          },
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
        collisionBodies: [],
      },
    },
    joints: {},
    materials: {},
  };
  const assets = {
    [meshFilePath]: meshDataUrl,
    [sourcePath]: meshDataUrl,
    'base.dae': meshDataUrl,
  };
  const referenceObject = await loadReferenceMeshObject(sourcePath, assets, robot);
  const fullFaceCount = countObjFaces(new OBJExporter().parse(referenceObject));

  const prepared = await prepareMjcfMeshExportAssets({
    robot,
    assets,
  });

  const overridePath = prepared.meshPathOverrides.get(sourcePath);
  assert.equal(overridePath, undefined);
  assert.equal(prepared.archiveFiles.has('dae/base.obj'), false);

  const variants = prepared.visualMeshVariants.get(sourcePath);
  assert.ok(variants, 'expected multi-material visual variants for go2 base mesh');
  assert.ok(variants.length >= 4, 'expected at least four split visual mesh variants');

  const namedVariants = new Set(
    variants.map((variant) => variant.sourceMaterialName).filter(Boolean),
  );
  assert.ok(
    namedVariants.size >= 4,
    'expected multiple named material variants from the Collada asset',
  );

  const variantFaceCounts = await Promise.all(
    variants.map(async (variant) => {
      assert.match(variant.meshPath, /\.obj$/);
      const blob = prepared.archiveFiles.get(variant.meshPath);
      assert.ok(blob, `expected archive blob for ${variant.meshPath}`);
      return countObjFaces(await blob!.text());
    }),
  );

  variantFaceCounts.forEach((faceCount) => {
    assert.ok(faceCount > 0, 'expected each variant OBJ to contain faces');
  });
  assert.equal(
    variantFaceCounts.reduce((sum, faceCount) => sum + faceCount, 0),
    fullFaceCount,
    'expected extracted variants to partition the original mesh faces instead of duplicating them',
  );
});

test('prepareMjcfMeshExportAssets splits go2w base visual mesh into authored material variants', async () => {
  const sourcePath = 'package://go2w_description/dae/base.dae';
  const meshFilePath = 'test/unitree_ros/robots/go2w_description/dae/base.dae';
  const meshDataUrl = `data:text/xml;base64,${Buffer.from(fs.readFileSync(meshFilePath, 'utf8')).toString('base64')}`;
  const robot: RobotState = {
    name: 'go2w-base-visual-variants',
    rootLinkId: 'base',
    selection: { type: null, id: null },
    links: {
      base: {
        ...DEFAULT_LINK,
        id: 'base',
        name: 'base',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          meshPath: sourcePath,
          authoredMaterials: [
            { name: '深色橡胶_001-effect', color: '#abb0c5' },
            { name: '白色logo_001-effect', color: '#ffffff' },
            { name: '黑色贴纸_007-effect', color: '#020202' },
            { name: '黑色金属_007-effect', color: '#030303' },
            { name: '黑色塑料_003-effect', color: '#050505' },
          ],
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
        collisionBodies: [],
      },
    },
    joints: {},
    materials: {},
  };
  const assets = {
    [meshFilePath]: meshDataUrl,
    [sourcePath]: meshDataUrl,
    'base.dae': meshDataUrl,
  };

  const prepared = await prepareMjcfMeshExportAssets({
    robot,
    assets,
  });

  assert.equal(prepared.meshPathOverrides.get(sourcePath), undefined);
  assert.equal(prepared.archiveFiles.has('dae/base.obj'), false);

  const variants = prepared.visualMeshVariants.get(sourcePath);
  assert.ok(variants);
  assert.equal(variants.length, 5);
  assert.deepEqual(
    variants.map((variant) => variant.sourceMaterialName),
    ['深色橡胶.001', '白色logo.001', '黑色贴纸.007', '黑色金属.007', '黑色塑料.003'],
  );
});

test('prepareMjcfMeshExportAssets keeps the full converted OBJ when a multi-material mesh is reused for collision', async () => {
  const sourcePath = 'package://go2_description/dae/base.dae';
  const meshFilePath = 'test/unitree_ros/robots/go2_description/dae/base.dae';
  const meshDataUrl = `data:text/xml;base64,${Buffer.from(fs.readFileSync(meshFilePath, 'utf8')).toString('base64')}`;
  const robot: RobotState = {
    name: 'go2-visual-and-collision',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          meshPath: sourcePath,
          authoredMaterials: [
            { name: 'dark_rubber', color: '#abb0c5' },
            { name: 'logo', color: '#ffffff' },
            { name: 'sticker', color: '#020202' },
            { name: 'metal', color: '#030303' },
            { name: 'plastic', color: '#050505' },
          ],
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: Math.PI, p: 0, y: 0 },
          },
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          meshPath: sourcePath,
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
        collisionBodies: [],
      },
    },
    joints: {},
    materials: {},
  };
  const assets = {
    [meshFilePath]: meshDataUrl,
    [sourcePath]: meshDataUrl,
    'base.dae': meshDataUrl,
  };

  const prepared = await prepareMjcfMeshExportAssets({
    robot,
    assets,
  });

  assert.equal(prepared.meshPathOverrides.get(sourcePath), 'dae/base.obj');
  assert.ok(prepared.archiveFiles.has('dae/base.obj'));
  assert.ok(prepared.visualMeshVariants.get(sourcePath)?.length);
});

test('prepareMjcfMeshExportAssets keeps the b2 base logo as a split visual variant', async () => {
  const sourcePath = 'package://b2_description/meshes/base_link.dae';
  const meshFilePath = 'test/unitree_ros/robots/b2_description/meshes/base_link.dae';
  const meshDataUrl = `data:text/xml;base64,${Buffer.from(fs.readFileSync(meshFilePath, 'utf8')).toString('base64')}`;
  const robot: RobotState = {
    name: 'b2-base-visual-variants',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          meshPath: sourcePath,
          authoredMaterials: [
            { name: '磨砂铝合金_011-effect', color: '#bfbfbf' },
            { name: 'logo_001-effect', color: '#ffffff' },
            { name: '材质_023-effect', color: '#000000' },
            { name: '材质_024-effect', color: '#010101' },
          ],
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.BOX,
          dimensions: { x: 0.5, y: 0.28, z: 0.15 },
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
        collisionBodies: [],
      },
    },
    joints: {},
    materials: {},
  };
  const assets = {
    [meshFilePath]: meshDataUrl,
    [sourcePath]: meshDataUrl,
    'base_link.dae': meshDataUrl,
  };

  const prepared = await prepareMjcfMeshExportAssets({
    robot,
    assets,
  });

  assert.equal(prepared.meshPathOverrides.get(sourcePath), undefined);
  const variants = prepared.visualMeshVariants.get(sourcePath);
  assert.ok(variants, 'expected split visual mesh variants for b2 base_link');
  assert.equal(variants.length, 4);

  const logoVariant = variants.find(
    (variant) => /logo/i.test(variant.sourceMaterialName ?? '') || /logo/i.test(variant.meshPath),
  );
  assert.ok(logoVariant, 'expected b2 base export to keep a dedicated logo mesh variant');

  const logoBlob = prepared.archiveFiles.get(logoVariant!.meshPath);
  assert.ok(logoBlob, `expected archive blob for ${logoVariant!.meshPath}`);
  assert.ok(
    countObjFaces(await logoBlob!.text()) > 0,
    'expected exported b2 logo OBJ to retain visible triangle faces',
  );
});

test('prepareMjcfMeshExportAssets preserves go2w mirrored thigh geometry when splitting visual material variants', async () => {
  const leftPath = 'package://go2w_description/dae/thigh.dae';
  const rightPath = 'package://go2w_description/dae/thigh_mirror.dae';
  const leftMeshFilePath = 'test/unitree_ros/robots/go2w_description/dae/thigh.dae';
  const rightMeshFilePath = 'test/unitree_ros/robots/go2w_description/dae/thigh_mirror.dae';
  const leftMeshDataUrl = `data:text/xml;base64,${Buffer.from(fs.readFileSync(leftMeshFilePath, 'utf8')).toString('base64')}`;
  const rightMeshDataUrl = `data:text/xml;base64,${Buffer.from(fs.readFileSync(rightMeshFilePath, 'utf8')).toString('base64')}`;
  const robot: RobotState = {
    name: 'go2w-thigh-mirror-variants',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
      FL_thigh: {
        ...DEFAULT_LINK,
        id: 'FL_thigh',
        name: 'FL_thigh',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          meshPath: leftPath,
          authoredMaterials: [
            { name: '深色橡胶_003-effect', color: '#abb1c5' },
            { name: 'Material_009-effect', color: '#e6f2f2' },
          ],
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
        collisionBodies: [],
      },
      FR_thigh: {
        ...DEFAULT_LINK,
        id: 'FR_thigh',
        name: 'FR_thigh',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          meshPath: rightPath,
          authoredMaterials: [
            { name: '深色橡胶_012-effect', color: '#abb1c5' },
            { name: 'Material_011-effect', color: '#e6f2f2' },
          ],
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
        collisionBodies: [],
      },
    },
    joints: {},
    materials: {},
  };
  const assets = {
    [leftMeshFilePath]: leftMeshDataUrl,
    [rightMeshFilePath]: rightMeshDataUrl,
    [leftPath]: leftMeshDataUrl,
    [rightPath]: rightMeshDataUrl,
    'thigh.dae': leftMeshDataUrl,
    'thigh_mirror.dae': rightMeshDataUrl,
  };

  const leftReference = await loadReferenceMeshObject(leftPath, assets, robot);
  const rightReference = await loadReferenceMeshObject(rightPath, assets, robot);
  const leftCenter = getWorldBox(leftReference).getCenter(new THREE.Vector3());
  const rightCenter = getWorldBox(rightReference).getCenter(new THREE.Vector3());

  assert.ok(
    leftCenter.y < 0,
    `expected left thigh center to stay on negative Y, got ${leftCenter.y}`,
  );
  assert.ok(
    rightCenter.y > 0,
    `expected mirrored right thigh center to stay on positive Y, got ${rightCenter.y}`,
  );

  const prepared = await prepareMjcfMeshExportAssets({
    robot,
    assets,
  });

  assert.equal(prepared.meshPathOverrides.get(rightPath), undefined);

  const rightVariants = prepared.visualMeshVariants.get(rightPath);
  assert.equal(rightVariants?.length, 2);

  const exportedRightGroup = new THREE.Group();
  for (const variant of rightVariants || []) {
    const blob = prepared.archiveFiles.get(variant.meshPath);
    assert.ok(blob, `expected archive blob for ${variant.meshPath}`);
    exportedRightGroup.add(parseObjObject(await blob!.text()));
  }

  const exportedRightBox = getWorldBox(exportedRightGroup);
  const rightReferenceBox = getWorldBox(rightReference);
  expectBoxEquals(exportedRightBox, rightReferenceBox, 2e-4);

  const exportedRightCenter = exportedRightBox.getCenter(new THREE.Vector3());
  assert.ok(
    exportedRightCenter.y > 0,
    `expected exported mirrored thigh center to stay on positive Y, got ${exportedRightCenter.y}`,
  );
});

test('prepareMjcfMeshExportAssets reuses identical native STL meshes from extracted USD exports by default', async () => {
  const leftPath = 'usd-extracted/FL_thigh_visual_0.stl';
  const rearPath = 'usd-extracted/RL_thigh_visual_0.stl';
  const sharedStl = 'solid shared\nendsolid shared\n';

  const robot: RobotState = {
    name: 'shared-native-obj-reuse',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
      FL_thigh: {
        ...DEFAULT_LINK,
        id: 'FL_thigh',
        name: 'FL_thigh',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          meshPath: leftPath,
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
      },
      RL_thigh: {
        ...DEFAULT_LINK,
        id: 'RL_thigh',
        name: 'RL_thigh',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          meshPath: rearPath,
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const prepared = await prepareMjcfMeshExportAssets({
    robot,
    assets: {},
    extraMeshFiles: new Map([
      [leftPath, new Blob([sharedStl], { type: 'model/stl' })],
      [rearPath, new Blob([sharedStl], { type: 'model/stl' })],
    ]),
  });

  assert.equal(prepared.meshPathOverrides.get(leftPath), undefined);
  assert.equal(prepared.meshPathOverrides.get(rearPath), leftPath);
  assert.equal(prepared.convertedSourceMeshPaths.has(leftPath), false);
  assert.equal(prepared.convertedSourceMeshPaths.has(rearPath), true);
  assert.equal(prepared.archiveFiles.size, 0);
});

test('prepareMjcfMeshExportAssets normalizes package native STL paths without forcing reconversion', async () => {
  const meshPath = 'package://demo_description/meshes/base_link.STL';
  const robot = createSingleMeshRobot(meshPath);

  const prepared = await prepareMjcfMeshExportAssets({
    robot,
    assets: {},
    extraMeshFiles: new Map([
      [meshPath, new Blob(['solid base\nendsolid base\n'], { type: 'model/stl' })],
    ]),
  });

  assert.equal(prepared.meshPathOverrides.get(meshPath), 'base_link.STL');
  assert.equal(prepared.convertedSourceMeshPaths.size, 0);
  assert.equal(prepared.archiveFiles.size, 0);
});

test('prepareMjcfMeshExportAssets normalizes package native OBJ paths without forcing reconversion', async () => {
  const meshPath = 'package://demo_description/meshes/base_link.obj';
  const robot = createSingleMeshRobot(meshPath);

  const prepared = await prepareMjcfMeshExportAssets({
    robot,
    assets: {},
    extraMeshFiles: new Map([
      [
        meshPath,
        new Blob([['o base', 'v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 3', ''].join('\n')], {
          type: 'text/plain',
        }),
      ],
    ]),
  });

  assert.equal(prepared.meshPathOverrides.get(meshPath), 'base_link.obj');
  assert.equal(prepared.convertedSourceMeshPaths.size, 0);
  assert.equal(prepared.archiveFiles.size, 0);
});

test('prepareMjcfMeshExportAssets normalizes package native MSH paths without forcing reconversion', async () => {
  const meshPath = 'package://demo_description/meshes/base_link.msh';
  const robot = createSingleMeshRobot(meshPath);
  const mshBuffer = createLegacyMshBuffer({
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
    uvs: [0, 0, 1, 0, 0, 1, 1, 1],
    indices: [0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3],
  });

  const prepared = await prepareMjcfMeshExportAssets({
    robot,
    assets: {},
    extraMeshFiles: new Map([
      [meshPath, new Blob([mshBuffer], { type: 'application/octet-stream' })],
    ]),
  });

  assert.equal(prepared.meshPathOverrides.get(meshPath), 'base_link.msh');
  assert.equal(prepared.convertedSourceMeshPaths.size, 0);
  assert.equal(prepared.archiveFiles.size, 0);
});

test('prepareMjcfMeshExportAssets fails fast when a required non-native mesh cannot be converted', async () => {
  await assert.rejects(
    () =>
      prepareMjcfMeshExportAssets({
        robot: createSingleMeshRobot('meshes/empty.dae'),
        assets: {
          'meshes/empty.dae': `data:text/xml;base64,${Buffer.from('not collada').toString('base64')}`,
        },
      }),
    /Failed to convert mesh "meshes\/empty\.dae" to OBJ/,
  );
});

test('prepareMjcfMeshExportAssets exports visual variants for native OBJ face-material groups', async () => {
  const meshPath = 'paint/native-square.obj';
  const objContent = [
    'o native_square',
    'v 0 0 0',
    'v 1 0 0',
    'v 1 1 0',
    'v 0 1 0',
    'f 1 2 3',
    'f 1 3 4',
    '',
  ].join('\n');
  const assets = {
    [meshPath]: `data:text/plain;base64,${Buffer.from(objContent).toString('base64')}`,
  };
  const robot: RobotState = {
    name: 'native-obj-face-groups',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          meshPath,
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const referenceObject = await loadReferenceMeshObject(meshPath, assets, robot);
  let referenceMesh: THREE.Mesh | null = null as THREE.Mesh | null;
  referenceObject.traverse((child) => {
    if (!referenceMesh && (child as THREE.Mesh).isMesh) {
      referenceMesh = child as THREE.Mesh;
    }
  });
  assert.ok(referenceMesh, 'expected native OBJ fixture to load a mesh');
  const meshKey = resolveRuntimeMeshMaterialGroupKey(referenceMesh!, referenceObject);
  disposeObject3D(referenceObject, true);

  robot.links.base_link.visual = {
    ...robot.links.base_link.visual,
    authoredMaterials: [
      { name: 'base', color: '#808080' },
      { name: 'paint_slot_1', color: '#ff5500' },
    ],
    meshMaterialGroups: [
      { meshKey, start: 0, count: 3, materialIndex: 1 },
      { meshKey, start: 3, count: 3, materialIndex: 0 },
    ],
  };

  const prepared = await prepareMjcfMeshExportAssets({
    robot,
    assets,
  });
  const variants = prepared.visualMeshVariants.get(meshPath);

  assert.ok(variants, 'expected face-material groups to create visual mesh variants');
  assert.equal(variants?.length, 2);
  assert.equal(prepared.archiveFiles.size, 2);
  assert.equal(prepared.convertedSourceMeshPaths.has(meshPath), true);
});

test('prepareMjcfMeshExportAssets can disable native STL sharing when requested', async () => {
  const leftPath = 'usd-extracted/FL_thigh_visual_0.stl';
  const rearPath = 'usd-extracted/RL_thigh_visual_0.stl';
  const sharedStl = 'solid shared\nendsolid shared\n';

  const robot: RobotState = {
    name: 'shared-native-obj-opt-out',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
      FL_thigh: {
        ...DEFAULT_LINK,
        id: 'FL_thigh',
        name: 'FL_thigh',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          meshPath: leftPath,
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
      },
      RL_thigh: {
        ...DEFAULT_LINK,
        id: 'RL_thigh',
        name: 'RL_thigh',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          meshPath: rearPath,
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const prepared = await prepareMjcfMeshExportAssets({
    robot,
    assets: {},
    extraMeshFiles: new Map([
      [leftPath, new Blob([sharedStl], { type: 'model/stl' })],
      [rearPath, new Blob([sharedStl], { type: 'model/stl' })],
    ]),
    preferSharedMeshReuse: false,
  });

  assert.equal(prepared.meshPathOverrides.get(rearPath), undefined);
  assert.equal(prepared.convertedSourceMeshPaths.has(rearPath), false);
});
