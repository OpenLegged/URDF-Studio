import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { shouldSyncDirectLinkChildVisibility } from './runtimeVisibility';
import { URDFCollider, URDFVisual } from '../../../../../core/parsers/urdf/loader/URDFClasses';

test('does not treat MJCF body offset groups as visual content controlled by showVisual', () => {
  const link = new THREE.Group();
  (link as any).isURDFLink = true;

  const bodyOffset = new THREE.Group();
  bodyOffset.name = 'body_offset_child';
  link.add(bodyOffset);

  assert.equal(shouldSyncDirectLinkChildVisibility(bodyOffset), false);
});

test('still treats visual groups under a link as visual content', () => {
  const link = new THREE.Group();
  (link as any).isURDFLink = true;

  const visual = new URDFVisual();
  link.add(visual);

  assert.equal(shouldSyncDirectLinkChildVisibility(visual), true);
});

test('does not treat collision groups under a link as visual content', () => {
  const link = new THREE.Group();
  (link as any).isURDFLink = true;

  const collider = new URDFCollider();
  link.add(collider);

  assert.equal(shouldSyncDirectLinkChildVisibility(collider), false);
});
