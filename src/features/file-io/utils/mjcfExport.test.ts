import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LINK, DEFAULT_JOINT, GeometryType, JointType, type RobotState } from '@/types';
import { generateMujocoXML } from '@/core/parsers/mjcf/mjcfGenerator';
import { prepareMjcfMeshExportAssets } from './mjcfMeshExport';
import { collectMjcfExportFiles, prepareMjcfExport } from './mjcfExport';

function cabinet(): RobotState {
  const base = structuredClone({ ...DEFAULT_LINK, id: 'cabinet', name: 'cabinet' });
  const drawer = structuredClone({ ...DEFAULT_LINK, id: 'drawer', name: 'drawer' });
  for (const link of [base, drawer]) {
    link.visual.type = GeometryType.BOX;
    link.visual.dimensions = { x: 0.8, y: 0.4, z: 0.2 };
    link.collision = structuredClone(link.visual);
  }
  return {
    name: 'cabinet', rootLinkId: 'cabinet', links: { cabinet: base, drawer },
    joints: {
      slide: {
        ...structuredClone(DEFAULT_JOINT), id: 'slide', name: 'slide', type: JointType.PRISMATIC,
        parentLinkId: 'cabinet', childLinkId: 'drawer', axis: { x: 0, y: 1, z: 0 },
        limit: { lower: -0.3, upper: 0, effort: 20, velocity: 1 },
      },
    },
    selection: { type: null, id: null },
  };
}

test('shared conversion preserves the original model exporter output and options', async () => {
  const robot = cabinet();
  const before = structuredClone(robot);
  const meshes = await prepareMjcfMeshExportAssets({ robot, assets: {} });
  for (const addFloatBase of [false, true]) {
    const mujoco = { addFloatBase, includeActuators: true, actuatorType: 'position' as const };
    const prepared = await prepareMjcfExport({ robot, assets: {}, mujoco });
    assert.equal(prepared.xml, generateMujocoXML(robot, {
      ...mujoco, meshPathOverrides: meshes.meshPathOverrides, visualMeshVariants: meshes.visualMeshVariants,
    }));
    assert.match(prepared.xml, /type="slide"/);
    assert.match(prepared.xml, /range="-0.3 0"/);
  }
  assert.deepEqual(robot, before);
});

test('scene packaging preserves nested mesh and texture bytes under generated paths', async () => {
  const robot = cabinet();
  robot.links.drawer.visual.type = GeometryType.MESH;
  robot.links.drawer.visual.meshPath = 'parts/drawer.obj';
  robot.links.drawer.visual.authoredMaterials = [{ texture: 'materials/textures/wood.png' }];
  const mesh = new Blob(['v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n']);
  const texture = new Blob(['texture']);
  const sourceFiles = new Map([['parts/drawer.obj', mesh], ['materials/textures/wood.png', texture]]);
  const prepared = await prepareMjcfExport({
    robot, assets: {}, extraMeshFiles: sourceFiles, preferSharedMeshReuse: false,
    mujoco: { meshdir: 'meshes/', texturedir: 'textures/', includeActuators: false, includeSceneHelpers: false },
  });
  const files = await collectMjcfExportFiles(prepared, { robot, sourceFiles });
  assert.equal(files.get('model.xml'), prepared.xml);
  assert.equal(files.get('meshes/parts/drawer.obj'), mesh);
  assert.equal(files.get('textures/wood.png'), texture);
  assert.match(prepared.xml, /file="parts\/drawer.obj"/);
  assert.match(prepared.xml, /file="wood.png"/);
  assert.doesNotMatch(prepared.xml, /<actuator>|name="floor"/);
});

test('missing original geometry or texture blocks packaging', async () => {
  const robot = cabinet();
  robot.links.drawer.visual.type = GeometryType.MESH;
  robot.links.drawer.visual.meshPath = 'drawer.obj';
  const prepared = await prepareMjcfExport({ robot, assets: {} });
  await assert.rejects(collectMjcfExportFiles(prepared, { robot, sourceFiles: new Map() }), /drawer.obj/);
  robot.links.drawer.visual.authoredMaterials = [{ texture: 'wood.png' }];
  await assert.rejects(collectMjcfExportFiles(prepared, {
    robot, sourceFiles: new Map([['drawer.obj', new Blob(['mesh'])]]),
  }), /wood.png/);
});
