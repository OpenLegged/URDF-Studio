import test from 'node:test';
import assert from 'node:assert/strict';

import { GeometryType, type UrdfInertial } from '@/types';
import {
  DEFAULT_COLLISION_RGBA,
  formatScalar,
  formatVec3,
  normalizeHexColor,
  formatColorRgba,
  formatCollisionGeomSize,
  formatEuler,
  formatEulerForAngleUnit,
  formatQuaternionWxyzFromRpy,
  formatMJCFInertiaDiagonal,
  formatMJCFFullInertia,
} from './mjcfSourceFormatters.ts';

test('formatScalar returns null for non-finite and rounds to 6 decimals otherwise', () => {
  assert.equal(formatScalar(undefined), null);
  assert.equal(formatScalar(NaN), null);
  assert.equal(formatScalar(Infinity), null);
  assert.equal(formatScalar(-Infinity), null);
  assert.equal(formatScalar(0), '0');
  assert.equal(formatScalar(1.5), '1.5');
  assert.equal(formatScalar(1.23456789), '1.234568', 'rounds to 6 decimals');
  assert.equal(formatScalar(1e-10), '0', 'tiny magnitude collapses to 0');
  assert.equal(formatScalar(-1.5), '-1.5');
});

test('formatVec3 joins scalar-formatted components with spaces', () => {
  assert.equal(formatVec3({ x: 1, y: 2, z: 3 }), '1 2 3');
  assert.equal(formatVec3({ x: 1.5, y: 0, z: 3 }), '1.5 0 3');
});

test('normalizeHexColor accepts 3/4/6/8 digit hex with optional leading #', () => {
  assert.equal(normalizeHexColor(undefined), null);
  assert.equal(normalizeHexColor(''), null);
  assert.equal(normalizeHexColor('invalid'), null);
  assert.equal(normalizeHexColor('#ff0000'), 'ff0000');
  assert.equal(normalizeHexColor('ff0000'), 'ff0000');
  assert.equal(normalizeHexColor('#f00'), 'ff0000', '3-digit expands');
  assert.equal(normalizeHexColor('ff0000ff'), 'ff0000ff', '8-digit keeps alpha');
});

test('formatColorRgba converts hex to normalized rgba and falls back on invalid', () => {
  assert.equal(formatColorRgba(undefined), DEFAULT_COLLISION_RGBA);
  assert.equal(formatColorRgba('invalid'), DEFAULT_COLLISION_RGBA);
  assert.equal(formatColorRgba('#ff0000'), '1 0 0 1');
  assert.equal(formatColorRgba('#ff0000ff'), '1 0 0 1', 'explicit alpha 255 normalizes to 1');
  assert.equal(formatColorRgba('#00000000'), '0 0 0 0', 'transparent black');
});

test('formatCollisionGeomSize halves box extents and emits radius for sphere', () => {
  const box = { type: GeometryType.BOX, dimensions: { x: 2, y: 4, z: 6 } };
  assert.equal(formatCollisionGeomSize(box), '1 2 3');
  const sphere = { type: GeometryType.SPHERE, dimensions: { x: 5, y: 0, z: 0 } };
  assert.equal(formatCollisionGeomSize(sphere), '5');
});

test('formatEuler and formatEulerForAngleUnit respect angle unit', () => {
  assert.equal(formatEuler({ r: 1, p: 2, y: 3 }), '1 2 3');
  assert.equal(formatEulerForAngleUnit({ r: 0, p: 0, y: 0 }, 'degree'), '0 0 0');
  assert.equal(formatEulerForAngleUnit({ r: Math.PI, p: 0, y: 0 }, 'radian'), '3.141593 0 0');
  assert.equal(formatEulerForAngleUnit({ r: Math.PI, p: 0, y: 0 }, 'degree'), '180 0 0');
});

test('formatQuaternionWxyzFromRpy identity rpy yields w-first identity quaternion', () => {
  assert.equal(formatQuaternionWxyzFromRpy({ r: 0, p: 0, y: 0 }), '1 0 0 0');
});

test('formatMJCFInertiaDiagonal and formatMJCFFullInertia serialize inertia components', () => {
  const inertial = {
    inertia: { ixx: 1, iyy: 2, izz: 3, ixy: 4, ixz: 5, iyz: 6 },
  } as unknown as UrdfInertial;
  assert.equal(formatMJCFInertiaDiagonal(inertial), '1 2 3');
  assert.equal(formatMJCFFullInertia(inertial), '1 2 3 4 5 6');
});
