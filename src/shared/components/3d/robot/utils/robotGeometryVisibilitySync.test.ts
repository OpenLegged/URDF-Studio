import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { URDFLink, URDFVisual } from '../../../../../core/parsers/urdf/loader/URDFClasses';
import { DEFAULT_LINK } from '../../../../../types/index';

import {
  COLLISION_OVERLAY_RENDER_ORDER,
  COLLISION_STANDARD_RENDER_ORDER,
  collisionBaseMaterial,
} from './materials';
import { syncRobotGeometryVisibility } from './robotGeometryVisibilitySync';

test('syncRobotGeometryVisibility skips hidden collider subtrees while still syncing visual descendants', () => {
  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const collisionGroup = new THREE.Group();
  (collisionGroup as any).isURDFCollider = true;

  const collisionMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const collisionMesh = new THREE.Mesh(new THREE.SphereGeometry(0.1), collisionMaterial);
  collisionGroup.add(collisionMesh);

  const visualGroup = new URDFVisual();
  visualGroup.userData.isVisualGroup = true;

  const visualMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x999999 }),
  );
  visualMesh.userData.isVisual = true;
  visualMesh.visible = false;
  visualGroup.add(visualMesh);

  link.add(collisionGroup);
  link.add(visualGroup);
  robot.add(link);

  const changed = syncRobotGeometryVisibility({
    robot,
    sourceFormat: 'urdf',
    showCollision: false,
    showVisual: true,
  });

  assert.equal(changed, true);
  assert.equal(collisionGroup.visible, false);
  assert.equal(collisionMesh.userData.isCollisionMesh, undefined);
  assert.equal(collisionMesh.material, collisionMaterial);
  assert.equal(visualGroup.visible, true);
  assert.equal(visualMesh.visible, true);
});

test('syncRobotGeometryVisibility applies collision overlays without re-enabling hidden visuals', () => {
  const previousOpacity = collisionBaseMaterial.opacity;
  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const collisionGroup = new THREE.Group();
  (collisionGroup as any).isURDFCollider = true;

  const collisionMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  collisionGroup.add(collisionMesh);

  const visualGroup = new URDFVisual();
  visualGroup.userData.isVisualGroup = true;

  const visualMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x999999 }),
  );
  visualMesh.userData.isVisual = true;
  visualGroup.add(visualMesh);

  link.add(collisionGroup);
  link.add(visualGroup);
  robot.add(link);

  const changedFirstPass = syncRobotGeometryVisibility({
    robot,
    sourceFormat: 'urdf',
    showCollision: true,
    showVisual: false,
  });
  const changedSecondPass = syncRobotGeometryVisibility({
    robot,
    sourceFormat: 'urdf',
    showCollision: true,
    showVisual: false,
  });

  assert.equal(changedFirstPass, true);
  assert.equal(changedSecondPass, false);
  assert.equal(collisionGroup.visible, true);
  assert.equal(collisionMesh.userData.isCollisionMesh, true);
  assert.equal(collisionMesh.material, collisionBaseMaterial);
  assert.equal(collisionBaseMaterial.opacity, 0.72);
  assert.equal(collisionMesh.renderOrder, COLLISION_OVERLAY_RENDER_ORDER);
  assert.equal(visualGroup.visible, false);
  assert.equal(visualMesh.visible, false);

  collisionBaseMaterial.opacity = previousOpacity;
  collisionBaseMaterial.needsUpdate = true;
});

test('syncRobotGeometryVisibility hides collisions when the parent link is hidden', () => {
  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const collisionGroup = new THREE.Group();
  (collisionGroup as any).isURDFCollider = true;

  const collisionMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  collisionGroup.add(collisionMesh);

  link.add(collisionGroup);
  robot.add(link);

  const changed = syncRobotGeometryVisibility({
    robot,
    robotLinks: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visible: false,
      },
    },
    sourceFormat: 'urdf',
    showCollision: true,
    showVisual: true,
  });

  assert.equal(changed, true);
  assert.equal(collisionGroup.visible, false);
  assert.equal(collisionMesh.userData.isCollisionMesh, undefined);
});

test('syncRobotGeometryVisibility keeps collisions visible in collision-only mode when link visibility is off', () => {
  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const collisionGroup = new THREE.Group();
  (collisionGroup as any).isURDFCollider = true;

  const collisionMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  collisionGroup.add(collisionMesh);

  link.add(collisionGroup);
  robot.add(link);

  const changed = syncRobotGeometryVisibility({
    robot,
    robotLinks: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visible: false,
      },
    },
    sourceFormat: 'urdf',
    showCollision: true,
    showVisual: false,
  });

  assert.equal(changed, true);
  assert.equal(collisionGroup.visible, true);
  assert.equal(collisionMesh.userData.isCollisionMesh, true);
});

test('syncRobotGeometryVisibility respects non-topmost collision rendering mode', () => {
  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const collisionGroup = new THREE.Group();
  (collisionGroup as any).isURDFCollider = true;

  const collisionMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  collisionGroup.add(collisionMesh);

  link.add(collisionGroup);
  robot.add(link);

  const changed = syncRobotGeometryVisibility({
    robot,
    sourceFormat: 'urdf',
    showCollision: true,
    showVisual: false,
    showCollisionAlwaysOnTop: false,
  });

  assert.equal(changed, true);
  assert.equal(collisionGroup.visible, true);
  assert.equal(collisionMesh.material, collisionBaseMaterial);
  assert.equal(collisionMesh.renderOrder, COLLISION_STANDARD_RENDER_ORDER);
  assert.equal(collisionBaseMaterial.depthTest, true);
});

test('syncRobotGeometryVisibility treats MJCF collision groups as collider roots', () => {
  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const collisionGroup = new THREE.Group();
  collisionGroup.userData.isCollisionGroup = true;
  collisionGroup.visible = false;

  const collisionMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  collisionMesh.userData.isCollisionMesh = true;
  collisionGroup.add(collisionMesh);

  link.add(collisionGroup);
  robot.add(link);

  const changed = syncRobotGeometryVisibility({
    robot,
    sourceFormat: 'mjcf',
    showCollision: true,
    showVisual: false,
  });

  assert.equal(changed, true);
  assert.equal(collisionGroup.visible, true);
  assert.equal(collisionMesh.visible, true);
  assert.equal(collisionMesh.material, collisionBaseMaterial);
});

test('syncRobotGeometryVisibility keeps MJCF collision overlays visible for folded semantic links', () => {
  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const collisionGroup = new THREE.Group();
  collisionGroup.userData.isCollisionGroup = true;
  collisionGroup.visible = false;

  const collisionMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  collisionMesh.userData.isCollisionMesh = true;
  collisionGroup.add(collisionMesh);

  link.add(collisionGroup);
  robot.add(link);

  const changed = syncRobotGeometryVisibility({
    robot,
    robotLinks: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visible: false,
      },
    },
    sourceFormat: 'mjcf',
    showCollision: true,
    showVisual: false,
  });

  assert.equal(changed, true);
  assert.equal(collisionGroup.visible, true);
  assert.equal(collisionMesh.visible, true);
  assert.equal(collisionMesh.material, collisionBaseMaterial);
});

test('syncRobotGeometryVisibility hides MJCF world visuals and collisions even without semantic robot link data', () => {
  const robot = new THREE.Group();
  const worldLink = new URDFLink();
  worldLink.name = 'world';

  const visualGroup = new URDFVisual();
  visualGroup.userData.isVisualGroup = true;
  const visualMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x999999 }),
  );
  visualMesh.userData.isVisual = true;
  visualGroup.add(visualMesh);

  const collisionGroup = new THREE.Group();
  (collisionGroup as any).isURDFCollider = true;
  const collisionMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  collisionGroup.add(collisionMesh);

  worldLink.add(visualGroup);
  worldLink.add(collisionGroup);
  robot.add(worldLink);

  const changed = syncRobotGeometryVisibility({
    robot,
    sourceFormat: 'mjcf',
    showCollision: true,
    showVisual: true,
    showMjcfWorldLink: false,
  });

  assert.equal(changed, true);
  assert.equal(visualGroup.visible, false);
  assert.equal(visualMesh.visible, false);
  assert.equal(collisionGroup.visible, false);
});
