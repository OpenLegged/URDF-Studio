import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { URDFLink } from '../../../../../core/parsers/urdf/loader/URDFClasses';
import { DEFAULT_LINK } from '../../../../../types/index';

import {
  COLLISION_OVERLAY_RENDER_ORDER,
  COLLISION_STANDARD_RENDER_ORDER,
  collisionBaseMaterial,
} from './materials';
import { syncCollisionGroupVisibility } from './collisionVisibilitySync';

test('syncCollisionGroupVisibility skips collider subtree traversal while collisions are hidden', () => {
  const link = new URDFLink();
  link.name = 'base_link';

  const collider = new THREE.Group();
  (collider as any).isURDFCollider = true;
  const meshMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), meshMaterial);
  collider.add(mesh);
  link.add(collider);

  const originalTraverse = collider.traverse.bind(collider);
  let traverseCalls = 0;
  collider.traverse = ((callback: (object: THREE.Object3D) => void) => {
    traverseCalls += 1;
    return originalTraverse(callback);
  }) as typeof collider.traverse;

  const changed = syncCollisionGroupVisibility({
    collider,
    showCollision: false,
  });

  assert.equal(changed, true);
  assert.equal(collider.visible, false);
  assert.equal(traverseCalls, 0);
  assert.equal(mesh.material, meshMaterial);
  assert.equal(mesh.userData.isCollisionMesh, undefined);
});

test('syncCollisionGroupVisibility restores collision overlay state when collisions are visible', () => {
  const link = new URDFLink();
  link.name = 'base_link';

  const collider = new THREE.Group();
  (collider as any).isURDFCollider = true;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  collider.add(mesh);
  link.add(collider);

  const changed = syncCollisionGroupVisibility({
    collider,
    showCollision: true,
  });

  assert.equal(changed, true);
  assert.equal(collider.visible, true);
  assert.equal(mesh.visible, true);
  assert.equal(mesh.userData.isCollisionMesh, true);
  assert.equal(mesh.material, collisionBaseMaterial);
  assert.equal(mesh.renderOrder, COLLISION_OVERLAY_RENDER_ORDER);
  assert.equal(mesh.raycast, THREE.Mesh.prototype.raycast);
});

test('syncCollisionGroupVisibility can ignore semantic link visibility for MJCF collision overlays', () => {
  const link = new URDFLink();
  link.name = 'base_link';

  const collider = new THREE.Group();
  (collider as any).isURDFCollider = true;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  collider.add(mesh);
  link.add(collider);

  const changed = syncCollisionGroupVisibility({
    collider,
    linkData: {
      ...DEFAULT_LINK,
      id: 'base_link',
      name: 'base_link',
      visible: false,
    },
    showCollision: true,
    respectLinkVisibility: false,
  });

  assert.equal(changed, true);
  assert.equal(collider.visible, true);
  assert.equal(mesh.visible, true);
  assert.equal(mesh.userData.isCollisionMesh, true);
});

test('syncCollisionGroupVisibility preserves highlighted collision materials', () => {
  const link = new URDFLink();
  link.name = 'base_link';

  const collider = new THREE.Group();
  (collider as any).isURDFCollider = true;
  const meshMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), meshMaterial);
  collider.add(mesh);
  link.add(collider);

  const highlightedMeshes = new Map<THREE.Mesh, unknown>([[mesh, { highlighted: true }]]);

  const changed = syncCollisionGroupVisibility({
    collider,
    showCollision: true,
    highlightedMeshes,
  });

  assert.equal(changed, true);
  assert.equal(mesh.material, meshMaterial);
  assert.equal(mesh.userData.isCollisionMesh, true);
  assert.equal(mesh.visible, true);
});

test('syncCollisionGroupVisibility reuses cached collider mesh lists across visible sync passes', () => {
  const link = new URDFLink();
  link.name = 'base_link';

  const collider = new THREE.Group();
  (collider as any).isURDFCollider = true;

  const nestedGroup = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  nestedGroup.add(mesh);
  collider.add(nestedGroup);
  link.add(collider);

  const originalTraverse = collider.traverse.bind(collider);
  let traverseCalls = 0;
  collider.traverse = ((callback: (object: THREE.Object3D) => void) => {
    traverseCalls += 1;
    return originalTraverse(callback);
  }) as typeof collider.traverse;

  const changedFirstPass = syncCollisionGroupVisibility({
    collider,
    showCollision: true,
  });
  const changedSecondPass = syncCollisionGroupVisibility({
    collider,
    showCollision: true,
  });

  assert.equal(changedFirstPass, true);
  assert.equal(changedSecondPass, false);
  assert.equal(traverseCalls, 1);
  assert.equal(mesh.material, collisionBaseMaterial);
});

test('syncCollisionGroupVisibility supports non-topmost collision rendering when requested', () => {
  const link = new URDFLink();
  link.name = 'base_link';

  const collider = new THREE.Group();
  (collider as any).isURDFCollider = true;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  collider.add(mesh);
  link.add(collider);

  const changed = syncCollisionGroupVisibility({
    collider,
    showCollision: true,
    showCollisionAlwaysOnTop: false,
  });

  assert.equal(changed, true);
  assert.equal(mesh.material, collisionBaseMaterial);
  assert.equal(mesh.renderOrder, COLLISION_STANDARD_RENDER_ORDER);
  assert.equal(collisionBaseMaterial.depthTest, true);
  assert.equal(collisionBaseMaterial.depthWrite, false);

  syncCollisionGroupVisibility({
    collider,
    showCollision: true,
    showCollisionAlwaysOnTop: true,
  });
  assert.equal(mesh.renderOrder, COLLISION_OVERLAY_RENDER_ORDER);
  assert.equal(collisionBaseMaterial.depthTest, false);
});

test('syncCollisionGroupVisibility disposes replaced collider materials without clobbering original references', () => {
  const link = new URDFLink();
  link.name = 'base_link';

  const collider = new THREE.Group();
  (collider as any).isURDFCollider = true;

  let materialDisposeCalls = 0;
  let textureDisposeCalls = 0;

  const previousTexture = new THREE.Texture();
  previousTexture.dispose = () => {
    textureDisposeCalls += 1;
  };

  const previousMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, map: previousTexture });
  previousMaterial.dispose = () => {
    materialDisposeCalls += 1;
  };

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), previousMaterial);
  const meshWithOriginalMaterial = mesh as THREE.Mesh & {
    __origMaterial?: THREE.Material | THREE.Material[];
  };
  meshWithOriginalMaterial.__origMaterial = previousMaterial;
  collider.add(mesh);
  link.add(collider);

  const changed = syncCollisionGroupVisibility({
    collider,
    showCollision: true,
  });

  assert.equal(changed, true);
  assert.equal(mesh.material, collisionBaseMaterial);
  assert.equal(meshWithOriginalMaterial.__origMaterial, previousMaterial);
  assert.equal(materialDisposeCalls, 1);
  assert.equal(textureDisposeCalls, 1);
});
