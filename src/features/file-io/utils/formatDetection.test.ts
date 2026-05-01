import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectFormat,
  isAssetFile,
  isMeshFile,
  isMotorLibraryFile,
  isRobotDefinitionFile,
} from './formatDetection.ts';

test('detectFormat classifies sdf documents by extension and content', () => {
  const content = `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="demo">
    <link name="base" />
  </model>
</sdf>`;

  assert.equal(detectFormat(content, 'model.sdf'), 'sdf');
  assert.equal(detectFormat(content, 'model.xml'), 'sdf');
  assert.equal(isRobotDefinitionFile('model.sdf'), true);
});

test('detectFormat treats the full USD file family as usd robot definitions', () => {
  assert.equal(detectFormat('', 'robot/scene.usd'), 'usd');
  assert.equal(detectFormat('', 'robot/scene.usda'), 'usd');
  assert.equal(detectFormat('', 'robot/scene.usdc'), 'usd');
  assert.equal(detectFormat('', 'robot/scene.usdz'), 'usd');

  assert.equal(isRobotDefinitionFile('robot/scene.usd'), true);
  assert.equal(isRobotDefinitionFile('robot/scene.usda'), true);
  assert.equal(isRobotDefinitionFile('robot/scene.usdc'), true);
  assert.equal(isRobotDefinitionFile('robot/scene.usdz'), true);
});

test('detectFormat classifies MuJoCo include fragments as mjcf', () => {
  const content = `<?xml version="1.0"?>
<mujocoinclude>
  <asset>
    <mesh name="bin_mesh" file="bin.stl" />
  </asset>
</mujocoinclude>`;

  assert.equal(detectFormat(content, 'bin_asset.xml'), 'mjcf');
  assert.equal(isRobotDefinitionFile('bin_asset.xml'), true);
});

test('asset and mesh classification includes legacy msh files and gltf bundles used by folder imports', () => {
  assert.equal(isAssetFile('robot/meshes/base.msh'), true);
  assert.equal(isAssetFile('robot/meshes/base.gltf'), true);
  assert.equal(isAssetFile('robot/meshes/base.glb'), true);
  assert.equal(isAssetFile('robot/meshes/base.vtk'), true);
  assert.equal(isAssetFile('robot/meshes/base.bin'), true);
  assert.equal(isMeshFile('robot/meshes/base.msh'), true);
  assert.equal(isMeshFile('robot/meshes/base.gltf'), true);
  assert.equal(isMeshFile('robot/meshes/base.glb'), true);
  assert.equal(isMeshFile('robot/meshes/base.vtk'), true);
  assert.equal(isMeshFile('robot/meshes/base.bin'), false);
});

test('motor library classification accepts legacy folders and single catalog json files', () => {
  assert.equal(isMotorLibraryFile('robot/motor library/Acme/M1.txt'), true);
  assert.equal(isMotorLibraryFile('robot/motor library/Acme/M1.json'), true);
  assert.equal(isMotorLibraryFile('robot/motor-library.json'), true);
  assert.equal(isMotorLibraryFile('robot/assets/motor.txt'), false);
});
