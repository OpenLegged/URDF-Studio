import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  resolveHitLinkTarget,
  resolveInteractionSelectionHit,
  resolveSelectionHit,
} from './selectionTargets';

function createRobotWithLinks(
  ...links: THREE.Object3D[]
): THREE.Group & { links?: Record<string, THREE.Object3D> } {
  const robot = new THREE.Group() as THREE.Group & { links?: Record<string, THREE.Object3D> };
  robot.links = Object.fromEntries(links.map((link) => [link.name, link]));
  return robot;
}

function createUrdfLink(name: string): THREE.Group {
  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean; type?: string };
  link.name = name;
  link.isURDFLink = true;
  link.type = 'URDFLink';
  return link;
}

function createUrdfVisual(name: string): THREE.Group {
  const visual = new THREE.Group() as THREE.Group & { isURDFVisual?: boolean };
  visual.name = name;
  visual.isURDFVisual = true;
  return visual;
}

test('resolveHitLinkTarget prefers parentLinkName metadata for logical link ownership', () => {
  const outerLink = createUrdfLink('outer_link');
  const innerLink = createUrdfLink('inner_link');
  const robot = createRobotWithLinks(outerLink, innerLink);

  robot.add(outerLink);
  outerLink.add(innerLink);

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  mesh.userData.parentLinkName = 'outer_link';
  innerLink.add(mesh);

  const resolved = resolveHitLinkTarget(robot, mesh);

  assert.ok(resolved);
  assert.equal(resolved?.linkId, 'outer_link');
  assert.equal(resolved?.linkObject, outerLink);
});

test('resolveHitLinkTarget preserves semantic MJCF attachment ids even when the runtime link is folded into its parent', () => {
  const baseLink = createUrdfLink('base_link');
  const robot = createRobotWithLinks(baseLink);
  robot.add(baseLink);

  const visual = createUrdfVisual('visual_0');
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  mesh.userData.parentLinkName = 'base_link_geom_1';
  visual.add(mesh);
  baseLink.add(visual);

  const resolved = resolveHitLinkTarget(robot, mesh);

  assert.ok(resolved);
  assert.equal(resolved?.linkId, 'base_link_geom_1');
  assert.equal(resolved?.linkObject, baseLink);
});

test('resolveHitLinkTarget falls back to hierarchy when metadata is unavailable', () => {
  const link = createUrdfLink('base_link');
  const robot = createRobotWithLinks(link);
  robot.add(link);

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  link.add(mesh);

  const resolved = resolveHitLinkTarget(robot, mesh);

  assert.ok(resolved);
  assert.equal(resolved?.linkId, 'base_link');
  assert.equal(resolved?.linkObject, link);
});

test('resolveHitLinkTarget skips anonymous URDFLink wrappers and keeps walking to a named runtime link', () => {
  const link = createUrdfLink('workspace_link');
  const robot = createRobotWithLinks(link);
  robot.add(link);

  const anonymousWrapper = createUrdfLink('');
  link.add(anonymousWrapper);

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  anonymousWrapper.add(mesh);

  const resolved = resolveHitLinkTarget(robot, mesh);

  assert.ok(resolved);
  assert.equal(resolved?.linkId, 'workspace_link');
  assert.equal(resolved?.linkObject, link);
});

test('resolveInteractionSelectionHit does not emit empty link ids for geometry under anonymous URDFLink wrappers', () => {
  const link = createUrdfLink('workspace_link');
  const robot = createRobotWithLinks(link);
  robot.add(link);

  const anonymousWrapper = createUrdfLink('');
  link.add(anonymousWrapper);

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  anonymousWrapper.add(mesh);

  const resolved = resolveInteractionSelectionHit(robot, mesh);

  assert.ok(resolved);
  assert.equal(resolved?.type, 'link');
  assert.equal(resolved?.id, 'workspace_link');
  assert.equal(resolved?.linkId, 'workspace_link');
  assert.equal(resolved?.linkObject, link);
});

test('resolveSelectionHit keeps URDF visual indexing when metadata resolves the owning link', () => {
  const link = createUrdfLink('base_link');
  const robot = createRobotWithLinks(link);
  robot.add(link);

  const firstVisual = createUrdfVisual('visual_0');
  const firstMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  firstMesh.userData.parentLinkName = 'base_link';
  firstVisual.add(firstMesh);
  link.add(firstVisual);

  const secondVisual = createUrdfVisual('visual_1');
  const secondMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  secondMesh.userData.parentLinkName = 'base_link';
  secondVisual.add(secondMesh);
  link.add(secondVisual);

  const resolved = resolveSelectionHit(robot, secondMesh);

  assert.ok(resolved);
  assert.equal(resolved?.linkId, 'base_link');
  assert.equal(resolved?.objectIndex, 1);
  assert.equal(resolved?.highlightTarget, secondMesh);
});

test('resolveInteractionSelectionHit resolves MJCF tendon geometry to a tendon selection', () => {
  const link = createUrdfLink('base_link');
  const robot = createRobotWithLinks(link);
  robot.add(link);

  const tendonGroup = new THREE.Group();
  tendonGroup.userData.isMjcfTendon = true;
  tendonGroup.userData.mjcfTendonName = 'finger_tendon';
  tendonGroup.userData.parentLinkName = 'base_link';
  link.add(tendonGroup);

  const tendonMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  tendonGroup.add(tendonMesh);

  const resolved = resolveInteractionSelectionHit(robot, tendonMesh);

  assert.ok(resolved);
  assert.equal(resolved?.type, 'tendon');
  assert.equal(resolved?.id, 'finger_tendon');
  assert.equal(resolved?.linkId, 'base_link');
  assert.equal(resolved?.linkObject, link);
  assert.equal(resolved?.targetKind, 'geometry');
  assert.equal(resolved?.highlightTarget, tendonGroup);
});

test('resolveHitLinkTarget allows selectable helper gizmo meshes to resolve parent link', () => {
  const link = createUrdfLink('base_link');
  const robot = createRobotWithLinks(link);
  robot.add(link);

  const helperGroup = new THREE.Group();
  helperGroup.name = '__origin_axes__';
  helperGroup.userData = { isGizmo: true, isSelectableHelper: true };
  link.add(helperGroup);

  const helperMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  helperMesh.userData = { isGizmo: true, isSelectableHelper: true };
  helperGroup.add(helperMesh);

  const resolved = resolveHitLinkTarget(robot, helperMesh);

  assert.ok(resolved);
  assert.equal(resolved?.linkId, 'base_link');
  assert.equal(resolved?.linkObject, link);
});

test('resolveInteractionSelectionHit tags center-of-mass helpers with helper metadata', () => {
  const link = createUrdfLink('base_link');
  const robot = createRobotWithLinks(link);
  robot.add(link);

  const helperGroup = new THREE.Group();
  helperGroup.name = '__com_visual__';
  helperGroup.userData = { isGizmo: true, isSelectableHelper: true };
  link.add(helperGroup);

  const helperMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  helperMesh.userData = { isGizmo: true, isSelectableHelper: true };
  helperGroup.add(helperMesh);

  const resolved = resolveInteractionSelectionHit(robot, helperMesh);

  assert.ok(resolved);
  assert.equal(resolved?.type, 'link');
  assert.equal(resolved?.id, 'base_link');
  assert.equal(resolved?.targetKind, 'helper');
  assert.equal(resolved?.helperKind, 'center-of-mass');
});

test('resolveInteractionSelectionHit tags ik-handle helpers with helper metadata', () => {
  const link = createUrdfLink('base_link');
  const robot = createRobotWithLinks(link);
  robot.add(link);

  const helperGroup = new THREE.Group();
  helperGroup.name = '__ik_handle__';
  helperGroup.userData = {
    isGizmo: true,
    isSelectableHelper: true,
    viewerHelperKind: 'ik-handle',
  };
  link.add(helperGroup);

  const helperMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  helperMesh.userData = {
    isGizmo: true,
    isSelectableHelper: true,
    viewerHelperKind: 'ik-handle',
  };
  helperGroup.add(helperMesh);

  const resolved = resolveInteractionSelectionHit(robot, helperMesh);

  assert.ok(resolved);
  assert.equal(resolved?.type, 'link');
  assert.equal(resolved?.id, 'base_link');
  assert.equal(resolved?.targetKind, 'helper');
  assert.equal(resolved?.helperKind, 'ik-handle');
});

test('resolveInteractionSelectionHit maps selectable joint-axis helpers to the owning joint', () => {
  const robot = createRobotWithLinks();

  const parentLink = createUrdfLink('parent_link');
  const joint = new THREE.Group() as THREE.Group & {
    isURDFJoint?: boolean;
    type?: string;
  };
  joint.name = 'hip_joint';
  joint.isURDFJoint = true;
  joint.type = 'URDFJoint';
  const childLink = createUrdfLink('child_link');

  robot.links = {
    parent_link: parentLink,
    child_link: childLink,
  };

  robot.add(parentLink);
  parentLink.add(joint);
  joint.add(childLink);

  const helperGroup = new THREE.Group();
  helperGroup.name = '__joint_axis__';
  helperGroup.userData = { isGizmo: true, isSelectableHelper: true };
  joint.add(helperGroup);

  const helperMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  helperMesh.userData = { isGizmo: true, isSelectableHelper: true };
  helperGroup.add(helperMesh);

  const resolved = resolveInteractionSelectionHit(robot, helperMesh);

  assert.ok(resolved);
  assert.equal(resolved?.type, 'joint');
  assert.equal(resolved?.id, 'hip_joint');
  assert.equal(resolved?.targetKind, 'helper');
  assert.equal(resolved?.helperKind, 'joint-axis');
  assert.equal(resolved?.highlightTarget, helperMesh);
});

test('resolveInteractionSelectionHit preserves projected joint-axis helper roots for overlay-aware resolution', () => {
  const robot = createRobotWithLinks();

  const parentLink = createUrdfLink('parent_link');
  const joint = new THREE.Group() as THREE.Group & {
    isURDFJoint?: boolean;
    type?: string;
  };
  joint.name = 'knee_joint';
  joint.isURDFJoint = true;
  joint.type = 'URDFJoint';
  const childLink = createUrdfLink('child_link');

  robot.links = {
    parent_link: parentLink,
    child_link: childLink,
  };

  robot.add(parentLink);
  parentLink.add(joint);
  joint.add(childLink);

  const helperGroup = new THREE.Group();
  helperGroup.name = '__joint_axis__';
  helperGroup.userData = { isGizmo: true, isSelectableHelper: true };
  joint.add(helperGroup);

  const helperMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  helperMesh.userData = { isGizmo: true, isSelectableHelper: true };
  helperGroup.add(helperMesh);

  const resolved = resolveInteractionSelectionHit(robot, helperGroup);

  assert.ok(resolved);
  assert.equal(resolved?.type, 'joint');
  assert.equal(resolved?.id, 'knee_joint');
  assert.equal(resolved?.targetKind, 'helper');
  assert.equal(resolved?.helperKind, 'joint-axis');
  assert.equal(
    resolved?.highlightTarget,
    helperMesh,
    'projected joint-axis helpers should keep a renderable helper child for overlay resolution',
  );
});

test('resolveInteractionSelectionHit preserves collision subtype for tagged meshes without URDFCollider ancestors', () => {
  const link = createUrdfLink('base_link');
  const robot = createRobotWithLinks(link);
  robot.add(link);

  const firstCollisionRoot = new THREE.Group();
  const firstCollisionMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
  );
  firstCollisionMesh.userData.parentLinkName = 'base_link';
  firstCollisionMesh.userData.isCollisionMesh = true;
  firstCollisionRoot.add(firstCollisionMesh);
  link.add(firstCollisionRoot);

  const secondCollisionRoot = new THREE.Group();
  const secondCollisionMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
  );
  secondCollisionMesh.userData.parentLinkName = 'base_link';
  secondCollisionMesh.userData.isCollisionMesh = true;
  secondCollisionRoot.add(secondCollisionMesh);
  link.add(secondCollisionRoot);

  const resolved = resolveInteractionSelectionHit(robot, secondCollisionMesh);

  assert.ok(resolved);
  assert.equal(resolved?.type, 'link');
  assert.equal(resolved?.id, 'base_link');
  assert.equal(resolved?.targetKind, 'geometry');
  assert.equal(resolved?.subType, 'collision');
  assert.equal(resolved?.objectIndex, 1);
  assert.equal(resolved?.highlightTarget, secondCollisionMesh);
});

test('resolveInteractionSelectionHit preserves visual subtype for tagged meshes without URDFVisual ancestors', () => {
  const link = createUrdfLink('base_link');
  const robot = createRobotWithLinks(link);
  robot.add(link);

  const firstVisualRoot = new THREE.Group();
  const firstVisualMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
  );
  firstVisualMesh.userData.parentLinkName = 'base_link';
  firstVisualMesh.userData.isVisualMesh = true;
  firstVisualRoot.add(firstVisualMesh);
  link.add(firstVisualRoot);

  const secondVisualRoot = new THREE.Group();
  const secondVisualMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
  );
  secondVisualMesh.userData.parentLinkName = 'base_link';
  secondVisualMesh.userData.isVisualMesh = true;
  secondVisualRoot.add(secondVisualMesh);
  link.add(secondVisualRoot);

  const resolved = resolveInteractionSelectionHit(robot, secondVisualMesh);

  assert.ok(resolved);
  assert.equal(resolved?.type, 'link');
  assert.equal(resolved?.id, 'base_link');
  assert.equal(resolved?.targetKind, 'geometry');
  assert.equal(resolved?.subType, 'visual');
  assert.equal(resolved?.objectIndex, 1);
  assert.equal(resolved?.highlightTarget, secondVisualMesh);
});

test('resolveInteractionSelectionHit prefers semantic visualObjectIndex metadata for folded MJCF synthetic links', () => {
  const link = createUrdfLink('base_link');
  const robot = createRobotWithLinks(link);
  robot.add(link);

  const primaryVisual = createUrdfVisual('base_visual');
  primaryVisual.userData.parentLinkName = 'base_link';
  primaryVisual.userData.visualObjectIndex = 0;
  const primaryMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  primaryMesh.userData.parentLinkName = 'base_link';
  primaryMesh.userData.isVisualMesh = true;
  primaryMesh.userData.visualObjectIndex = 0;
  primaryVisual.add(primaryMesh);

  const attachmentVisual = createUrdfVisual('attachment_visual');
  attachmentVisual.userData.parentLinkName = 'base_link_geom_1';
  attachmentVisual.userData.runtimeParentLinkName = 'base_link';
  attachmentVisual.userData.visualObjectIndex = 0;
  const attachmentMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
  );
  attachmentMesh.userData.parentLinkName = 'base_link_geom_1';
  attachmentMesh.userData.runtimeParentLinkName = 'base_link';
  attachmentMesh.userData.isVisualMesh = true;
  attachmentMesh.userData.visualObjectIndex = 0;
  attachmentVisual.add(attachmentMesh);

  link.add(primaryVisual, attachmentVisual);

  const resolved = resolveInteractionSelectionHit(robot, attachmentMesh);

  assert.ok(resolved);
  assert.equal(resolved?.type, 'link');
  assert.equal(resolved?.id, 'base_link_geom_1');
  assert.equal(resolved?.subType, 'visual');
  assert.equal(resolved?.objectIndex, 0);
  assert.equal(resolved?.highlightTarget, attachmentMesh);
});
