import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { createRobotMeshLoader, resolveRobotAsset } from './index';

const ASCII_STL = `solid triangle
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 1 0 0
      vertex 0 1 0
    endloop
  endfacet
endsolid triangle`;

const ASCII_OBJ = `o triangle
v 0 0 0
v 1 0 0
v 0 1 0
f 1 2 3`;

test('resolveRobotAsset uses the package path index for relative, package, and basename lookups', () => {
  const assets = {
    'demo/meshes/Body.STL': 'blob:body',
    'demo/textures/body.png': 'blob:texture',
  };
  assert.equal(
    resolveRobotAsset('../meshes/body.stl', assets, 'demo/urdf/robot.urdf'),
    'blob:body',
  );
  assert.equal(
    resolveRobotAsset('package://demo/textures/body.png', assets, 'demo/urdf/robot.urdf'),
    'blob:texture',
  );
  assert.equal(resolveRobotAsset('Body.STL', assets, 'demo/urdf/robot.urdf'), 'blob:body');
  assert.equal(
    resolveRobotAsset('https://cdn.example/mesh.glb', assets),
    'https://cdn.example/mesh.glb',
  );
});

test('createRobotMeshLoader returns an owned Object3D and disposes the session idempotently', async () => {
  const loader = createRobotMeshLoader({
    assets: {
      'meshes/triangle.stl': `data:model/stl;charset=utf-8,${encodeURIComponent(ASCII_STL)}`,
      'meshes/triangle.obj': `data:text/plain;charset=utf-8,${encodeURIComponent(ASCII_OBJ)}`,
    },
    sourceFilePath: 'robots/demo/model.urdf',
    yieldIfNeeded: async () => {},
  });

  const object = await loader.load('meshes/triangle.stl');
  assert.ok(object instanceof THREE.Object3D);

  let mesh: THREE.Mesh | null = null;
  object.traverse((child) => {
    if (!mesh && (child as THREE.Mesh).isMesh) mesh = child as THREE.Mesh;
  });
  assert.ok(mesh);
  assert.equal(mesh.geometry.getAttribute('position').count, 3);

  const obj = await loader.load('meshes/triangle.obj');
  let objMeshCount = 0;
  obj.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) objMeshCount += 1;
  });
  assert.equal(objMeshCount, 1);

  let geometryDisposeCount = 0;
  mesh.geometry.addEventListener('dispose', () => {
    geometryDisposeCount += 1;
  });

  loader.dispose();
  loader.dispose();
  assert.equal(geometryDisposeCount, 1);
  await assert.rejects(loader.load('meshes/triangle.stl'), { name: 'AbortError' });
});
