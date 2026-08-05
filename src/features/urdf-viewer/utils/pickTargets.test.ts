import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  collectPickTargets,
  collectSelectableHelperTargets,
  findPickIntersections,
} from './pickTargets.ts';

function createBoxMesh(material?: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    material ?? new THREE.MeshStandardMaterial({ color: 0xffffff }),
  );
}

function createPickOnlyMesh(renderOrder = 0): THREE.Mesh {
  const mesh = createBoxMesh(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  mesh.renderOrder = renderOrder;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) {
    material.colorWrite = false;
    material.depthTest = false;
    material.depthWrite = false;
  }
  return mesh;
}

test('collectPickTargets skips internal helper meshes and fully transparent meshes', () => {
  const pickableMesh = createBoxMesh();

  const helperGroup = new THREE.Group();
  helperGroup.name = '__origin_axes__';
  const helperMesh = createBoxMesh();
  helperGroup.add(helperMesh);

  const gizmoMesh = createBoxMesh();
  gizmoMesh.userData.isGizmo = true;

  const transparentMesh = createBoxMesh(
    new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0 }),
  );

  const linkMeshMap = new Map<string, THREE.Mesh[]>([
    ['base_link:visual', [pickableMesh, helperMesh, gizmoMesh, transparentMesh]],
  ]);

  const targets = collectPickTargets(linkMeshMap, 'visual');

  assert.deepEqual(targets, [pickableMesh]);
});

test('collectPickTargets keeps meshes under synthetic URDF roots whose names start with double underscores', () => {
  const workspaceRoot = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  workspaceRoot.name = '__workspace_world__';
  workspaceRoot.isURDFLink = true;

  const torsoLink = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  torsoLink.name = 'comp_simple_humanoid_torso';
  torsoLink.isURDFLink = true;
  workspaceRoot.add(torsoLink);

  const torsoMesh = createBoxMesh();
  torsoMesh.userData.parentLinkName = 'comp_simple_humanoid_torso';
  torsoMesh.userData.isVisualMesh = true;
  torsoLink.add(torsoMesh);

  const linkMeshMap = new Map<string, THREE.Mesh[]>([
    ['comp_simple_humanoid_torso:visual', [torsoMesh]],
  ]);

  const targets = collectPickTargets(linkMeshMap, 'visual');

  assert.deepEqual(targets, [torsoMesh]);
});

test('collectPickTargets includes mjcf tendon meshes that live outside the link mesh map', () => {
  const robot = new THREE.Group();
  const tendonMesh = createBoxMesh(new THREE.MeshStandardMaterial({ color: 0xff5533 }));
  tendonMesh.userData.isMjcfTendon = true;
  tendonMesh.userData.parentLinkName = 'finger_link';
  robot.add(tendonMesh);

  const visualTargets = collectPickTargets(new Map(), 'visual', robot);
  const collisionTargets = collectPickTargets(new Map(), 'collision', robot);

  assert.deepEqual(visualTargets, [tendonMesh]);
  assert.deepEqual(collisionTargets, []);
});

test('collectSelectableHelperTargets keeps selectable helper overlays even when they sit outside link geometry', () => {
  const robot = new THREE.Group();

  const linkMesh = createBoxMesh();
  linkMesh.position.set(0, 0, -1);
  linkMesh.userData.parentLinkName = 'base_link';
  linkMesh.userData.isVisualMesh = true;
  robot.add(linkMesh);

  const helperGroup = new THREE.Group();
  helperGroup.name = '__inertia_box__';
  helperGroup.userData = { isGizmo: true, isSelectableHelper: true };

  const helperMesh = createBoxMesh(
    new THREE.MeshBasicMaterial({ color: 0x00d4ff, transparent: true, opacity: 0.25 }),
  );
  helperMesh.position.set(3, 0, -1);
  helperMesh.userData = { isGizmo: true, isSelectableHelper: true };
  helperGroup.add(helperMesh);
  robot.add(helperGroup);

  const transparentHelperMesh = createBoxMesh(
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }),
  );
  transparentHelperMesh.userData = { isGizmo: true, isSelectableHelper: true };
  helperGroup.add(transparentHelperMesh);

  const targets = collectSelectableHelperTargets(robot);

  assert.equal(targets.includes(helperMesh), true);
  assert.equal(targets.includes(linkMesh), false);
  assert.equal(targets.includes(transparentHelperMesh), false);
});

test('findPickIntersections keeps nearest hit first even when pick target order is unsorted', () => {
  const robot = new THREE.Group();

  const nearMesh = createBoxMesh();
  nearMesh.position.set(0, 0, -2);
  nearMesh.userData.parentLinkName = 'near_link';
  nearMesh.userData.isVisualMesh = true;
  robot.add(nearMesh);

  const farMesh = createBoxMesh();
  farMesh.position.set(0, 0, -5);
  farMesh.userData.parentLinkName = 'far_link';
  farMesh.userData.isVisualMesh = true;
  robot.add(farMesh);

  robot.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));

  const hits = findPickIntersections(robot, raycaster, [farMesh, nearMesh], 'visual', false);

  assert.equal(hits.length >= 2, true);
  assert.equal(hits[0]?.object, nearMesh);
  assert.ok((hits[0]?.distance ?? Infinity) <= (hits[1]?.distance ?? Infinity));
});

test('findPickIntersections falls back to robot traversal when the pick target cache is empty', () => {
  const robot = new THREE.Group();

  const linkMesh = createBoxMesh();
  linkMesh.position.set(0, 0, -1);
  linkMesh.userData.parentLinkName = 'base_link';
  linkMesh.userData.isVisualMesh = true;
  robot.add(linkMesh);
  robot.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));

  const hits = findPickIntersections(robot, raycaster, [], 'visual', false);

  assert.equal(hits.length > 0, true);
  assert.equal(hits[0]?.object, linkMesh);
});

test('findPickIntersections includes selectable helpers that are not in pickTargets', () => {
  const robot = new THREE.Group();

  const linkMesh = createBoxMesh();
  linkMesh.position.set(0, 0, -1.5);
  linkMesh.userData.parentLinkName = 'base_link';
  linkMesh.userData.isVisualMesh = true;
  robot.add(linkMesh);

  const helperGroup = new THREE.Group();
  helperGroup.name = '__origin_axes__';
  helperGroup.userData = { isGizmo: true, isSelectableHelper: true };

  const helperMesh = createBoxMesh(
    new THREE.MeshBasicMaterial({ color: 0xff0000, depthTest: false }),
  );
  helperMesh.position.set(0, 0, -1);
  helperMesh.userData = { isGizmo: true, isSelectableHelper: true };
  helperGroup.add(helperMesh);
  robot.add(helperGroup);

  robot.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));

  const hits = findPickIntersections(robot, raycaster, [linkMesh], 'visual', false);

  assert.equal(hits.length > 0, true);
  assert.equal(hits[0]?.object, helperMesh);
  assert.ok(hits.some((hit) => hit.object === linkMesh));
});

test('findPickIntersections can skip the recursive helper scan for cached-helper callers', () => {
  const robot = new THREE.Group();

  const linkMesh = createBoxMesh();
  linkMesh.position.set(0, 0, -1.5);
  linkMesh.userData.parentLinkName = 'base_link';
  linkMesh.userData.isVisualMesh = true;
  robot.add(linkMesh);

  const helperGroup = new THREE.Group();
  helperGroup.name = '__origin_axes__';
  helperGroup.userData = { isGizmo: true, isSelectableHelper: true };
  const helperMesh = createBoxMesh();
  helperMesh.position.set(0, 0, -1);
  helperMesh.userData = { isGizmo: true, isSelectableHelper: true };
  helperGroup.add(helperMesh);
  robot.add(helperGroup);

  robot.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));
  const hits = findPickIntersections(
    robot,
    raycaster,
    [linkMesh],
    'all',
    false,
    undefined,
    false,
  );

  assert.ok(hits.length > 0);
  assert.equal(hits.every((hit) => hit.object === linkMesh), true);
});

test('findPickIntersections prefers selectable helper overlays over nearer collision meshes', () => {
  const robot = new THREE.Group();

  const collisionMesh = createBoxMesh(new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
  collisionMesh.position.set(0, 0, -1);
  collisionMesh.userData.parentLinkName = 'base_link';
  collisionMesh.userData.isCollisionMesh = true;
  collisionMesh.renderOrder = 999;
  robot.add(collisionMesh);

  const helperGroup = new THREE.Group();
  helperGroup.name = '__joint_axis__';
  helperGroup.userData = { isGizmo: true, isSelectableHelper: true };

  const helperMesh = createBoxMesh(
    new THREE.MeshBasicMaterial({ color: 0xff0000, depthTest: false }),
  );
  helperMesh.position.set(0, 0, -2);
  helperMesh.userData = { isGizmo: true, isSelectableHelper: true };
  helperMesh.renderOrder = 10020;
  helperGroup.add(helperMesh);
  robot.add(helperGroup);

  robot.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));

  const hits = findPickIntersections(robot, raycaster, [collisionMesh], 'all', false);

  assert.equal(hits.length >= 2, true);
  assert.equal(hits[0]?.object, helperMesh);
  assert.ok(hits.some((hit) => hit.object === collisionMesh));
});

test('findPickIntersections keeps the visually topmost surface first when collision is not an overlay', () => {
  const robot = new THREE.Group();

  const visualMesh = createBoxMesh(new THREE.MeshBasicMaterial({ color: 0x3366ff }));
  visualMesh.position.set(0, 0, -1);
  visualMesh.userData.parentLinkName = 'visual_link';
  visualMesh.userData.isVisualMesh = true;
  robot.add(visualMesh);

  const collisionMesh = createBoxMesh(new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
  collisionMesh.position.set(0, 0, -2);
  collisionMesh.userData.parentLinkName = 'collision_link';
  collisionMesh.userData.isCollisionMesh = true;
  robot.add(collisionMesh);

  robot.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));

  const hits = findPickIntersections(robot, raycaster, [visualMesh, collisionMesh], 'all', false);

  assert.equal(hits.length >= 2, true);
  assert.equal(hits[0]?.object, visualMesh);
  assert.ok(hits.some((hit) => hit.object === collisionMesh));
});

test('findPickIntersections filters out hidden collision hits', () => {
  const robot = new THREE.Group();

  const collisionGroup = new THREE.Group();
  collisionGroup.visible = false;
  const collisionMesh = createBoxMesh(new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
  collisionMesh.userData.parentLinkName = 'collision_link';
  collisionMesh.userData.isCollisionMesh = true;
  collisionGroup.add(collisionMesh);
  robot.add(collisionGroup);

  const visualMesh = createBoxMesh(new THREE.MeshBasicMaterial({ color: 0x3366ff }));
  visualMesh.position.set(0, 0, -2);
  visualMesh.userData.parentLinkName = 'visual_link';
  visualMesh.userData.isVisualMesh = true;
  robot.add(visualMesh);

  robot.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));

  const hits = findPickIntersections(robot, raycaster, [collisionMesh, visualMesh], 'all', false);

  assert.equal(hits.length > 0, true);
  assert.equal(hits[0]?.object, visualMesh);
  assert.equal(
    hits.some((hit) => hit.object === collisionMesh),
    false,
  );
});

test('findPickIntersections keeps nearer geometry ahead of a non-overlay helper that sits behind it', () => {
  const robot = new THREE.Group();

  const visualMesh = createBoxMesh(new THREE.MeshBasicMaterial({ color: 0x3366ff }));
  visualMesh.position.set(0, 0, -1);
  visualMesh.userData.parentLinkName = 'visual_link';
  visualMesh.userData.isVisualMesh = true;
  robot.add(visualMesh);

  const helperGroup = new THREE.Group();
  helperGroup.name = '__origin_axes__';
  helperGroup.userData = { isGizmo: true, isSelectableHelper: true };

  const helperMesh = createPickOnlyMesh(10020);
  helperMesh.position.set(0, 0, -1.5);
  helperMesh.userData = { isGizmo: true, isSelectableHelper: true };
  helperGroup.add(helperMesh);
  robot.add(helperGroup);

  robot.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));

  const hits = findPickIntersections(robot, raycaster, [visualMesh], 'all', false, [
    'visual',
    'origin-axes',
  ]);

  assert.equal(hits.length >= 2, true);
  assert.equal(hits[0]?.object, visualMesh);
  assert.ok(hits.some((hit) => hit.object === helperMesh));
  assert.ok(hits.some((hit) => hit.object === visualMesh));
});

test('findPickIntersections keeps foreground geometry ahead of non-overlay inertia helpers', () => {
  const robot = new THREE.Group();

  const visualMesh = createBoxMesh(new THREE.MeshBasicMaterial({ color: 0x3366ff }));
  visualMesh.position.set(0, 0, -1);
  visualMesh.userData.parentLinkName = 'visual_link';
  visualMesh.userData.isVisualMesh = true;
  robot.add(visualMesh);

  const helperGroup = new THREE.Group();
  helperGroup.name = '__inertia_box__';
  helperGroup.userData = { isGizmo: true, isSelectableHelper: true };

  const helperMesh = createBoxMesh(
    new THREE.MeshBasicMaterial({
      color: 0x00d4ff,
      transparent: true,
      opacity: 0.25,
      depthTest: true,
      depthWrite: false,
    }),
  );
  helperMesh.position.set(0, 0, -1.5);
  helperMesh.renderOrder = 10001;
  helperMesh.userData = { isGizmo: true, isSelectableHelper: true };
  helperGroup.add(helperMesh);
  robot.add(helperGroup);

  robot.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));

  const hits = findPickIntersections(robot, raycaster, [visualMesh], 'all', false, [
    'inertia',
    'visual',
  ]);

  assert.equal(hits.length >= 2, true);
  assert.equal(hits[0]?.object, visualMesh);
  assert.ok(hits.some((hit) => hit.object === helperMesh));
});

test('findPickIntersections lets overlay inertia helpers beat geometry behind them', () => {
  const robot = new THREE.Group();

  const visualMesh = createBoxMesh(new THREE.MeshBasicMaterial({ color: 0x3366ff }));
  visualMesh.position.set(0, 0, -1);
  visualMesh.userData.parentLinkName = 'visual_link';
  visualMesh.userData.isVisualMesh = true;
  robot.add(visualMesh);

  const helperGroup = new THREE.Group();
  helperGroup.name = '__inertia_box__';
  helperGroup.userData = { isGizmo: true, isSelectableHelper: true };

  const helperMesh = createBoxMesh(
    new THREE.MeshBasicMaterial({
      color: 0x00d4ff,
      transparent: true,
      opacity: 0.25,
      depthTest: false,
      depthWrite: false,
    }),
  );
  helperMesh.position.set(0, 0, -1.5);
  helperMesh.renderOrder = 10001;
  helperMesh.userData = { isGizmo: true, isSelectableHelper: true };
  helperGroup.add(helperMesh);
  robot.add(helperGroup);

  robot.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));

  const hits = findPickIntersections(robot, raycaster, [visualMesh], 'all', false, [
    'inertia',
    'visual',
  ]);

  assert.equal(hits.length >= 2, true);
  assert.equal(hits[0]?.object, helperMesh);
  assert.ok(hits.some((hit) => hit.object === visualMesh));
});

test('findPickIntersections honors explicit layer priority over legacy collision ordering', () => {
  const robot = new THREE.Group();

  const visualMesh = createBoxMesh(new THREE.MeshBasicMaterial({ color: 0x3366ff }));
  visualMesh.position.set(0, 0, -1);
  visualMesh.userData.parentLinkName = 'shared_link';
  visualMesh.userData.isVisualMesh = true;
  robot.add(visualMesh);

  const collisionMesh = createBoxMesh(new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
  collisionMesh.position.set(0, 0, -1.01);
  collisionMesh.userData.parentLinkName = 'shared_link';
  collisionMesh.userData.isCollisionMesh = true;
  robot.add(collisionMesh);

  robot.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));

  const hits = findPickIntersections(robot, raycaster, [visualMesh, collisionMesh], 'all', false, [
    'visual',
    'collision',
  ]);

  assert.equal(hits.length >= 2, true);
  assert.equal(hits[0]?.object, visualMesh);
  assert.ok(hits.some((hit) => hit.object === collisionMesh));
});

test('findPickIntersections keeps the nearest geometry hit first even when collision layer is explicitly preferred', () => {
  const robot = new THREE.Group();

  const visualMesh = createBoxMesh(new THREE.MeshBasicMaterial({ color: 0x3366ff }));
  visualMesh.position.set(0, 0, -1);
  visualMesh.userData.parentLinkName = 'shared_link';
  visualMesh.userData.isVisualMesh = true;
  robot.add(visualMesh);

  const collisionMesh = createBoxMesh(new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
  collisionMesh.position.set(0, 0, -1.05);
  collisionMesh.userData.parentLinkName = 'shared_link';
  collisionMesh.userData.isCollisionMesh = true;
  robot.add(collisionMesh);

  robot.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));

  const hits = findPickIntersections(robot, raycaster, [visualMesh, collisionMesh], 'all', false, [
    'collision',
    'visual',
  ]);
  const firstVisualHit = hits.find((hit) => hit.object === visualMesh) ?? null;
  const firstCollisionHit = hits.find((hit) => hit.object === collisionMesh) ?? null;

  assert.equal(hits.length >= 2, true);
  assert.equal(hits[0]?.object, visualMesh);
  assert.ok((firstVisualHit?.distance ?? Infinity) < (firstCollisionHit?.distance ?? Infinity));
});
