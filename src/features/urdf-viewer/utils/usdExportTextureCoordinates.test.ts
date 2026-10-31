import assert from 'node:assert/strict';
import test from 'node:test';

import type { UsdSceneMeshDescriptor, UsdSceneSnapshot } from '../../../types/index.ts';
import { prepareUsdExportCacheFromResolvedSnapshot, resolveUsdExportResolution } from './usdExportBundle.ts';

const atlas = '/Looks/Atlas';
const unscaled = '/Looks/Unscaled';

function texturedQuad(uvs: number[], geometry?: UsdSceneMeshDescriptor['geometry']): UsdSceneSnapshot {
  return {
    stage: { defaultPrimPath: '/Quad' },
    robotTree: { rootLinkPaths: ['/Quad'], linkParentPairs: [['/Quad', null]] },
    render: {
      materials: [
        {
          materialId: atlas, mapPath: 'atlas.png',
          textureInputs: { mapPath: { uvTransform: [0, 2, 0, -4, 0, 0, 0.5, 0.25, 1] } },
        },
        {
          materialId: unscaled, mapPath: 'atlas.png',
          textureInputs: { mapPath: { uvTransform: [1, 0, 0, 0, 1, 0, 0, 0, 1] } },
        },
      ],
      meshDescriptors: [{
        meshId: '/Quad/visuals.proto_mesh_id0', resolvedPrimPath: '/Quad/surface',
        primType: 'Mesh', sectionName: 'visuals', materialId: atlas, geometry,
        ranges: {
          positions: { offset: 0, count: 12, stride: 3 },
          indices: { offset: 0, count: 6, stride: 1 },
          uvs: { offset: 0, count: uvs.length, stride: 2 },
        },
      }],
    },
    buffers: {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]), uvs: new Float32Array(uvs),
    },
  };
}

async function preparedObj(snapshot: UsdSceneSnapshot, bakeBaseColorUvTransform?: boolean): Promise<string> {
  const resolution = resolveUsdExportResolution(snapshot);
  assert.ok(resolution);
  const cache = prepareUsdExportCacheFromResolvedSnapshot(snapshot, resolution, { bakeBaseColorUvTransform });
  const meshes = Object.values(cache.meshFiles);
  assert.equal(meshes.length, 1);
  return meshes[0]!.text();
}

test('MuJoCo export bakes an affine base-color transform once per face corner and leaves viewer UVs intact', async () => {
  const rawUvs = [0, 0, 0.25, 0, 0.25, 0.25, 0.5, 0, 0.5, 0.25, 0, 0.25];
  const snapshot = texturedQuad(rawUvs);
  const viewer = await preparedObj(snapshot);
  assert.deepEqual(viewer.match(/^vt .+$/gm), [
    'vt 0 0', 'vt 0.25 0', 'vt 0.25 0.25', 'vt 0.5 0', 'vt 0.5 0.25', 'vt 0 0.25',
  ]);
  const exported = await preparedObj(snapshot, true);
  assert.deepEqual(exported.match(/^vt .+$/gm), [
    'vt 0.5 0.25', 'vt 0.5 0.75', 'vt -0.5 0.75', 'vt 0.5 1.25', 'vt -0.5 1.25', 'vt -0.5 0.25',
  ]);
  assert.deepEqual(exported.match(/^f .+$/gm), ['f 1/1 2/2 3/3', 'f 1/4 3/5 4/6']);
  assert.deepEqual(snapshot.buffers?.uvs, new Float32Array(rawUvs));
  assert.equal(await preparedObj(snapshot, true), exported);
  assert.equal(await preparedObj(snapshot), viewer);
});

test('MuJoCo export gives a shared vertex distinct texture indices across USD material subsets', async () => {
  const snapshot = texturedQuad([0, 0, 1, 0, 1, 1, 0, 1], {
    geomSubsetSections: [
      { start: 0, length: 3, materialId: atlas },
      { start: 3, length: 3, materialId: unscaled },
    ],
  });
  const viewer = await preparedObj(snapshot);
  assert.deepEqual(viewer.match(/^vt .+$/gm), ['vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1']);
  assert.deepEqual(viewer.match(/^f .+$/gm), ['f 1/1 2/2 3/3', 'f 1/1 3/3 4/4']);
  const exported = await preparedObj(snapshot, true);
  assert.deepEqual(exported.match(/^vt .+$/gm), [
    'vt 0.5 0.25', 'vt 0.5 2.25', 'vt -3.5 2.25', 'vt 0 0', 'vt 1 1', 'vt 0 1',
  ]);
  assert.deepEqual(exported.match(/^f .+$/gm), ['f 1/1 2/2 3/3', 'f 1/4 3/5 4/6']);
});
