import assert from 'node:assert/strict';
import test from 'node:test';

import { GeometryType, type UrdfLink, type UrdfVisual } from '@/types';

import {
  replaceCollisionGeometriesByObjectIndex,
  updateCollisionGeometryByObjectIndex,
} from './collisionBodies';

function geometry(name: string, type = GeometryType.BOX): UrdfVisual {
  return {
    name,
    type,
    dimensions: { x: 0.1, y: 0.2, z: 0.3 },
    color: '#ef4444',
    origin: {
      xyz: { x: 0, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: 0 },
    },
  };
}

function link(): UrdfLink {
  return {
    id: 'base',
    name: 'base',
    visual: geometry('visual'),
    collision: geometry('primary'),
    collisionBodies: [geometry('body-a'), geometry('body-b')],
  };
}

test('replacing a primary collision with multiple geometries keeps later bodies ordered', () => {
  const original = link();
  const result = replaceCollisionGeometriesByObjectIndex(original, 0, [
    geometry('segment-a', GeometryType.CAPSULE),
    geometry('segment-b', GeometryType.CAPSULE),
  ]);

  assert.equal(result.replaced, true);
  assert.equal(result.link.collision.name, 'segment-a');
  assert.deepEqual(
    result.link.collisionBodies?.map((body) => body.name),
    ['segment-b', 'body-a', 'body-b'],
  );
  assert.equal(original.collision.name, 'primary');
});

test('replacing an additional collision splices at the exact original object index', () => {
  const result = replaceCollisionGeometriesByObjectIndex(link(), 1, [
    geometry('segment-a', GeometryType.CAPSULE),
    geometry('segment-b', GeometryType.CAPSULE),
  ]);

  assert.equal(result.replaced, true);
  assert.deepEqual(
    result.link.collisionBodies?.map((body) => body.name),
    ['segment-a', 'segment-b', 'body-b'],
  );
});

test('invalid object indices never fall back to the primary collision', () => {
  const original = link();
  const replacement = replaceCollisionGeometriesByObjectIndex(original, 99, [
    geometry('unexpected'),
  ]);
  const update = updateCollisionGeometryByObjectIndex(original, 99, {
    name: 'unexpected',
  });

  assert.equal(replacement.replaced, false);
  assert.equal(replacement.link, original);
  assert.equal(update, original);
  assert.equal(original.collision.name, 'primary');
});
