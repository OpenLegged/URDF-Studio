import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { PickTargetBoundsCache } from './pickTargetBounds';

function expectedBounds(mesh: THREE.Mesh): THREE.Box3 {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  assert.ok(mesh.geometry.boundingBox);
  return mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
}

test('unchanged meshes reuse world bounds without repeating their corner transforms', (context) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3));
  mesh.position.set(4, 5, 6);
  mesh.rotation.set(0.1, 0.2, 0.3);
  mesh.scale.set(2, 3, 4);
  mesh.updateMatrixWorld();
  const expected = expectedBounds(mesh);
  const cache = new PickTargetBoundsCache();
  const transform = context.mock.method(THREE.Box3.prototype, 'applyMatrix4');

  const first = cache.getWorldBounds(mesh);
  assert.ok(first?.equals(expected));
  for (let index = 0; index < 20; index += 1) {
    assert.equal(cache.getWorldBounds(mesh), first);
  }
  assert.equal(transform.mock.callCount(), 1);
});

test('joint and component transforms refresh bounds immediately on the next pick', () => {
  const component = new THREE.Group();
  const joint = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3));
  mesh.position.x = 3;
  component.add(joint);
  joint.add(mesh);
  component.updateMatrixWorld();
  const cache = new PickTargetBoundsCache();
  const initial = cache.getWorldBounds(mesh)?.clone();

  joint.rotation.z = Math.PI / 2;
  component.updateMatrixWorld(false);
  assert.ok(cache.getWorldBounds(mesh)?.equals(expectedBounds(mesh)));
  assert.equal(cache.getWorldBounds(mesh)?.equals(initial!), false);

  component.position.set(10, -2, 1);
  component.scale.set(2, 1, 3);
  component.updateMatrixWorld(false);
  assert.ok(cache.getWorldBounds(mesh)?.equals(expectedBounds(mesh)));
});

test('geometry replacement and in-place bounds changes invalidate cached world bounds', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry());
  mesh.updateMatrixWorld();
  const cache = new PickTargetBoundsCache();
  cache.getWorldBounds(mesh);

  mesh.geometry = new THREE.BoxGeometry(10, 20, 30);
  assert.ok(cache.getWorldBounds(mesh)?.equals(expectedBounds(mesh)));

  mesh.geometry.translate(1, 2, 3);
  assert.ok(cache.getWorldBounds(mesh)?.equals(expectedBounds(mesh)));

  mesh.geometry.boundingBox = null;
  mesh.geometry.getAttribute('position').setXYZ(0, 100, 100, 100);
  assert.ok(cache.getWorldBounds(mesh)?.equals(expectedBounds(mesh)));
});

test('reappearing targets use current bounds and new targets have independent entries', () => {
  const cache = new PickTargetBoundsCache();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry());
  mesh.updateMatrixWorld();
  cache.getWorldBounds(mesh);
  mesh.visible = false;
  mesh.position.set(10, 20, 30);
  mesh.updateMatrixWorld();
  mesh.visible = true;
  assert.ok(cache.getWorldBounds(mesh)?.equals(expectedBounds(mesh)));

  const newMesh = new THREE.Mesh(mesh.geometry);
  newMesh.updateMatrixWorld();
  assert.ok(cache.getWorldBounds(newMesh)?.equals(expectedBounds(newMesh)));
  assert.equal(cache.getWorldBounds(new THREE.Group()), null);
});
