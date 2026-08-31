import test from 'node:test';
import assert from 'node:assert/strict';
import { GeometryType, type UrdfLink } from '@/types';
import {
  findAddedCollisionGeometryPatch,
  findRemovedCollisionGeometryObjectIndex,
  findUpdatedCollisionGeometryPatch,
} from './collisionGeometryDiff';

const baseVisual = {
  name: 'base',
  type: GeometryType.BOX,
  dimensions: { x: 1, y: 1, z: 1 },
  color: '#111',
  origin: {
    xyz: { x: 0, y: 0, z: 0 },
    rpy: { r: 0, p: 0, y: 0 },
  },
};

const secondVisual = {
  ...baseVisual,
  name: 'extra',
  dimensions: { x: 0.5, y: 0.5, z: 0.5 },
};

const createLink = (collisionBodies?: UrdfLink['collision'][]): UrdfLink => ({
  id: 'link',
  name: 'link',
  visual: baseVisual,
  collision: baseVisual,
  collisionBodies,
});

test('findRemovedCollisionGeometryObjectIndex returns the dropped object index', () => {
  const current = createLink([secondVisual]);
  const next = createLink();
  const removedIndex = findRemovedCollisionGeometryObjectIndex(current, next);
  assert.strictEqual(removedIndex, 1);
});

test('findAddedCollisionGeometryPatch detects the inserted collision', () => {
  const current = createLink();
  const next = createLink([secondVisual]);
  const added = findAddedCollisionGeometryPatch(current, next);
  assert.deepStrictEqual(added?.geometry, secondVisual);
  assert.strictEqual(added?.objectIndex, 1);
});

test('findUpdatedCollisionGeometryPatch detects single geometry changes only', () => {
  const current = createLink();
  const updatedCollision = { ...baseVisual, dimensions: { x: 2, y: 2, z: 2 } };
  const next: UrdfLink = { ...current, collision: updatedCollision };
  const updated = findUpdatedCollisionGeometryPatch(current, next);
  assert.strictEqual(updated?.objectIndex, 0);
  assert.strictEqual(updated?.geometry.dimensions.x, 2);
});

test('findUpdatedCollisionGeometryPatch detects collision name changes', () => {
  const current = createLink();
  const next: UrdfLink = {
    ...current,
    collision: { ...baseVisual, name: 'renamed-collision' },
  };

  const updated = findUpdatedCollisionGeometryPatch(current, next);

  assert.strictEqual(updated?.objectIndex, 0);
  assert.strictEqual(updated?.geometry.name, 'renamed-collision');
});
