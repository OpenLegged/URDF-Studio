import test from 'node:test';
import assert from 'node:assert/strict';

import { GeometryType, type RobotState } from '@/types';
import { generateURDF } from '@/core/parsers/urdf/urdfGenerator';
import { buildGeneratedUrdfOptions, __private__ } from './generatedUrdfOptions';

const BASE_MESH_PATH = 'meshes/base_link_visual_0.obj';

function createRoundtripRobot(): RobotState {
  return {
    name: 'vertex_color_export',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    joints: {},
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          meshPath: BASE_MESH_PATH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#ffffff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#000000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
      },
    },
    materials: {
      base_link: {
        color: '#123456',
      },
    },
  };
}

test('objTextHasEmbeddedVertexColors detects OBJ vertex color payloads', () => {
  assert.equal(
    __private__.objTextHasEmbeddedVertexColors('v 0 0 0 1 0 0\nf 1 1 1\n'),
    true,
  );
  assert.equal(
    __private__.objTextHasEmbeddedVertexColors('v 0 0 0\nf 1 1 1\n'),
    false,
  );
});

test('application export preserves precise transforms and sub-micrometer mesh scales', async () => {
  const robot = createRoundtripRobot();
  robot.links.base_link.visual.origin!.rpy.r = Math.PI / 6;
  robot.links.base_link.visual.dimensions = { x: 1e-9, y: 0.1234567890123456, z: 1 };
  const urdf = generateURDF(robot, await buildGeneratedUrdfOptions());
  assert.match(urdf, /rpy="0\.5235987755982988 0 0"/);
  assert.match(urdf, /scale="1e-9 0\.1234567890123456 1"/);
});

test('buildGeneratedUrdfOptions keeps URDF materials when generated OBJ has no baked vertex colors', async () => {
  const robot = createRoundtripRobot();

  const options = await buildGeneratedUrdfOptions(new Map([
    [BASE_MESH_PATH, new Blob(['o mesh\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'], { type: 'text/plain' })],
  ]));
  const urdf = generateURDF(robot, options);

  assert.match(urdf, /<material name="base_link_mat">/);
});

test('buildGeneratedUrdfOptions omits URDF materials only when generated OBJ already carries baked vertex colors', async () => {
  const robot = createRoundtripRobot();

  const options = await buildGeneratedUrdfOptions(new Map([
    [BASE_MESH_PATH, new Blob(['o mesh\nv 0 0 0 1 0 0\nv 1 0 0 1 0 0\nv 0 1 0 1 0 0\nf 1 2 3\n'], { type: 'text/plain' })],
  ]));
  const urdf = generateURDF(robot, options);

  assert.doesNotMatch(urdf, /<material name="base_link_mat">/);
});
