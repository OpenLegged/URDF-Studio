import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_LINK } from '../../../../types';
import {
  createDescriptorExportMap,
  resolveUsdSnapshotMeshDimensions,
} from './usdExportDescriptorMapping';

test('preserves USD mesh transform scale in RobotData dimensions without applying translation', () => {
  const descriptor = {
    primType: 'mesh',
    ranges: { transform: { offset: 0, count: 16, stride: 16 } },
  };
  const snapshot = {
    buffers: {
      transforms: [
        200, 0, 0, 0,
        0, 15, 0, 0,
        0, 0, 100, 0,
        20, 30, 40, 1,
      ],
    },
  };

  assert.deepEqual(
    resolveUsdSnapshotMeshDimensions({ x: 1, y: 1, z: 1 }, descriptor, snapshot),
    { x: 200, y: 15, z: 100 },
  );
});

test('keeps an edited non-identity RobotData mesh scale instead of multiplying it twice', () => {
  assert.deepEqual(
    resolveUsdSnapshotMeshDimensions(
      { x: 2, y: 3, z: 4 },
      { primType: 'mesh' },
      { buffers: {} },
    ),
    { x: 2, y: 3, z: 4 },
  );
});

test('keeps GeomSubset palettes on a synthetic attachment created for a later descriptor', () => {
  const robotData = {
    name: 'subset_scene',
    rootLinkId: 'Geometry',
    links: {
      Geometry: {
        ...structuredClone(DEFAULT_LINK),
        id: 'Geometry',
        name: 'Geometry',
      },
    },
    joints: {},
    materials: {},
  };
  const snapshot = {
    stageSourcePath: '/scene.usda',
    render: {
      meshDescriptors: [
        {
          meshId: '/World/Geometry/visuals.proto_mesh_id0',
          linkPath: '/World/Geometry',
          sectionName: 'visuals',
          primType: 'mesh',
        },
        {
          meshId: '/World/Geometry/visuals.proto_mesh_id1',
          linkPath: '/World/Geometry',
          sectionName: 'visuals',
          primType: 'mesh',
          geometry: {
            geomSubsetSections: [
              { start: 0, length: 3, materialId: '/Looks/Red' },
              { start: 3, length: 3, materialId: '/Looks/Green' },
              { start: 6, length: 3, materialId: '/Looks/Red' },
            ],
          },
        },
      ],
      materials: [
        { materialId: '/Looks/Red', name: 'Red', color: [1, 0, 0, 1] },
        { materialId: '/Looks/Green', name: 'Green', color: [0, 1, 0, 1] },
      ],
    },
  };

  const result = createDescriptorExportMap(snapshot, {
    robotData,
    stageSourcePath: '/scene.usda',
    linkIdByPath: { '/World/Geometry': 'Geometry' },
    linkPathById: { Geometry: '/World/Geometry' },
    jointPathById: {},
    childLinkPathByJointId: {},
    parentLinkPathByJointId: {},
  });
  const syntheticLink = Object.values(result.robot.links).find(
    (link) => link.id !== 'Geometry' && link.visual.meshPath?.endsWith('_1.obj'),
  );

  assert.ok(syntheticLink);
  assert.deepEqual(
    syntheticLink.visual.authoredMaterials?.map((material) => material.color),
    ['#ff0000', '#00ff00'],
  );
  assert.deepEqual(syntheticLink.visual.meshMaterialGroups, [
    { meshKey: '0', start: 0, count: 3, materialIndex: 0 },
    { meshKey: '0', start: 3, count: 3, materialIndex: 1 },
    { meshKey: '0', start: 6, count: 3, materialIndex: 0 },
  ]);
});
