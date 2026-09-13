import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { resolveDirectHelperInteraction } from './directHelperInteraction';
import { collectSelectableHelperTargets } from './pickTargets';
import { createInertiaBox } from './visualizationFactories';

function createBoxMesh(material?: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    material ?? new THREE.MeshStandardMaterial({ color: 0xffffff }),
  );
}

test('resolveDirectHelperInteraction returns the directly hit helper without screen-space fallback', () => {
  const robot = new THREE.Group();

  const jointObject = new THREE.Group() as THREE.Group & { isURDFJoint?: boolean; type?: string };
  jointObject.name = 'joint_1';
  jointObject.isURDFJoint = true;
  jointObject.type = 'URDFJoint';

  const helperGroup = new THREE.Group();
  helperGroup.name = '__joint_axis__';
  helperGroup.userData = {
    isGizmo: true,
    isSelectableHelper: true,
    viewerHelperKind: 'joint-axis',
  };

  const helperMesh = createBoxMesh(new THREE.MeshBasicMaterial({ color: 0xff00ff }));
  helperMesh.position.set(0, 0, -2);
  helperMesh.userData = {
    isGizmo: true,
    isSelectableHelper: true,
    viewerHelperKind: 'joint-axis',
  };
  helperGroup.add(helperMesh);
  jointObject.add(helperGroup);
  robot.add(jointObject);

  robot.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));

  const result = resolveDirectHelperInteraction({
    robot,
    raycaster,
    helperTargets: [helperMesh],
    interactionLayerPriority: ['joint-axis', 'collision', 'visual'],
  });

  assert.equal(result?.targetKind, 'helper');
  assert.equal(result?.type, 'joint');
  assert.equal(result?.id, 'joint_1');
  assert.equal(result?.helperKind, 'joint-axis');
  assert.equal(
    result?.highlightTarget,
    helperMesh,
    'joint-axis helper hits should preserve the helper object for overlay-aware resolution',
  );
});

test('resolveDirectHelperInteraction returns null when the ray does not hit a helper mesh', () => {
  const robot = new THREE.Group();

  const helperMesh = createBoxMesh(new THREE.MeshBasicMaterial({ color: 0xff00ff }));
  helperMesh.position.set(4, 0, -2);
  helperMesh.userData = {
    isGizmo: true,
    isSelectableHelper: true,
    viewerHelperKind: 'origin-axes',
    parentLinkName: 'base_link',
  };
  robot.add(helperMesh);

  robot.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));

  const result = resolveDirectHelperInteraction({
    robot,
    raycaster,
    helperTargets: [helperMesh],
    interactionLayerPriority: ['origin-axes', 'collision', 'visual'],
  });

  assert.equal(result, null);
});

test('resolveDirectHelperInteraction keeps inertia hover stable across the filled box surface', () => {
  const robot = new THREE.Group();

  const linkObject = new THREE.Group() as THREE.Group & { isURDFLink?: boolean; type?: string };
  linkObject.name = 'base_link';
  linkObject.isURDFLink = true;
  linkObject.type = 'URDFLink';

  const inertiaBox = createInertiaBox(1, 1, 1, new THREE.Quaternion());
  inertiaBox.position.set(0, 0, -2);
  linkObject.add(inertiaBox);
  robot.add(linkObject);

  robot.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));
  const result = resolveDirectHelperInteraction({
    robot,
    raycaster,
    helperTargets: collectSelectableHelperTargets(robot),
    interactionLayerPriority: ['inertia', 'collision', 'visual'],
  });

  assert.equal(result?.targetKind, 'helper');
  assert.equal(result?.type, 'link');
  assert.equal(result?.id, 'base_link');
  assert.equal(result?.helperKind, 'inertia');
});

test('resolveDirectHelperInteraction does not trigger inertia hover outside the box footprint', () => {
  const robot = new THREE.Group();

  const linkObject = new THREE.Group() as THREE.Group & { isURDFLink?: boolean; type?: string };
  linkObject.name = 'base_link';
  linkObject.isURDFLink = true;
  linkObject.type = 'URDFLink';

  const inertiaBox = createInertiaBox(1, 1, 1, new THREE.Quaternion());
  inertiaBox.position.set(0, 0, -2);
  linkObject.add(inertiaBox);
  robot.add(linkObject);

  robot.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(0.55, 0, 0),
    new THREE.Vector3(0, 0, -1),
  );
  const result = resolveDirectHelperInteraction({
    robot,
    raycaster,
    helperTargets: collectSelectableHelperTargets(robot),
    interactionLayerPriority: ['inertia', 'collision', 'visual'],
  });

  assert.equal(result, null);
});
