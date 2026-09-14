import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { getRobotVisualMeshIndex } from './robotVisualMeshIndex';

test('getRobotVisualMeshIndex collects only opacity-eligible visual meshes', () => {
  const robot = new THREE.Group();

  const visualMesh = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial(),
  );

  const visualGroup = new THREE.Group();
  const nestedVisualMesh = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial(),
  );
  visualGroup.add(nestedVisualMesh);

  const collisionGroup = new THREE.Group() as THREE.Group & { isURDFCollider?: boolean };
  collisionGroup.isURDFCollider = true;
  const collisionMesh = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial(),
  );
  collisionGroup.add(collisionMesh);

  const gizmoGroup = new THREE.Group();
  gizmoGroup.userData.isGizmo = true;
  const gizmoMesh = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial(),
  );
  gizmoGroup.add(gizmoMesh);

  const inertiaGroup = new THREE.Group();
  inertiaGroup.name = '__inertia_visual__';
  const inertiaMesh = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial(),
  );
  inertiaGroup.add(inertiaMesh);

  const flaggedCollisionMesh = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial(),
  );
  flaggedCollisionMesh.userData.isCollisionMesh = true;

  robot.add(visualMesh);
  robot.add(visualGroup);
  robot.add(collisionGroup);
  robot.add(gizmoGroup);
  robot.add(inertiaGroup);
  robot.add(flaggedCollisionMesh);

  const meshes = getRobotVisualMeshIndex(robot, 1);

  assert.deepEqual(meshes, [visualMesh, nestedVisualMesh]);
});

test('getRobotVisualMeshIndex caches traversal results until the cache version changes', () => {
  const robot = new THREE.Group();
  const meshA = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial(),
  );
  robot.add(meshA);

  const originalTraverse = robot.traverse.bind(robot);
  let traverseCalls = 0;
  robot.traverse = ((callback: (object: THREE.Object3D) => void) => {
    traverseCalls += 1;
    return originalTraverse(callback);
  }) as typeof robot.traverse;

  const firstIndex = getRobotVisualMeshIndex(robot, 1);
  const secondIndex = getRobotVisualMeshIndex(robot, 1);

  assert.equal(firstIndex, secondIndex);
  assert.equal(traverseCalls, 1);

  const meshB = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial(),
  );
  robot.add(meshB);

  const refreshedIndex = getRobotVisualMeshIndex(robot, 2);

  assert.deepEqual(refreshedIndex, [meshA, meshB]);
  assert.equal(traverseCalls, 2);
});
