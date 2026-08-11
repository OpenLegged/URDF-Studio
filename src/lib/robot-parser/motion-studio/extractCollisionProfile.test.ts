import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { parseURDF, toRobotData, extractCollisionProfile } from '@/lib/robot-parser';
import { GeometryType } from '@/types/geometry';

function installDomGlobals(): void {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { contentType: 'text/html' });
  globalThis.DOMParser = dom.window.DOMParser as unknown as typeof DOMParser;
}

test('extractCollisionProfile remaps dimensions per geometry type and preserves origin', () => {
  installDomGlobals();
  const urdf = `<robot name="t">
    <link name="b"><collision><origin xyz="1 2 3" rpy="0.1 0.2 0.3"/><geometry><box size="2 4 6"/></geometry></collision></link>
    <link name="s"><collision><geometry><sphere radius="0.5"/></geometry></collision></link>
    <link name="c"><collision><geometry><cylinder radius="0.3" length="1.2"/></geometry></collision></link>
    <link name="cap"><collision><geometry><capsule radius="0.4" length="2"/></geometry></collision></link>
    <link name="m"><collision><geometry><mesh filename="part.stl" scale="0.5 0.5 0.5"/></geometry></collision></link>
  </robot>`;
  const robot = parseURDF(urdf);
  assert.ok(robot);
  const profile = extractCollisionProfile(toRobotData(robot!), 't');

  assert.equal(profile.robotId, 't');

  // box: dimensions used directly; origin preserved.
  assert.deepEqual(profile.links.b[0].type, 'box');
  assert.deepEqual(profile.links.b[0].dimensions, { x: 2, y: 4, z: 6 });
  assert.deepEqual(profile.links.b[0].origin, {
    xyz: { x: 1, y: 2, z: 3 },
    rpy: { r: 0.1, p: 0.2, y: 0.3 },
  });
  assert.equal(profile.links.b[0].source, 'definition');
  assert.equal(profile.links.b[0].enabled, true);
  assert.equal(profile.links.b[0].id, 'b:collision:0');
  assert.equal(profile.links.b[0].runtimeKey, 'b::collision::0');

  // sphere: {r,0,0} -> {r,r,r}
  assert.deepEqual(profile.links.s[0].type, 'sphere');
  assert.deepEqual(profile.links.s[0].dimensions, { x: 0.5, y: 0.5, z: 0.5 });

  // cylinder: {r,length,0} -> {r,length,r}
  assert.deepEqual(profile.links.c[0].type, 'cylinder');
  assert.deepEqual(profile.links.c[0].dimensions, { x: 0.3, y: 1.2, z: 0.3 });

  // Native capsule length is the end-to-end extent; canonical RobotData stores
  // the straight body length (2 - 2 * 0.4 = 1.2) before this remapping.
  assert.deepEqual(profile.links.cap[0].type, 'capsule');
  assert.deepEqual(profile.links.cap[0].dimensions, { x: 0.4, y: 1.2, z: 0.4 });

  // mesh: meshPath -> meshFilename; scale from dimensions
  assert.deepEqual(profile.links.m[0].type, 'mesh');
  assert.equal(profile.links.m[0].meshFilename, 'part.stl');
  assert.deepEqual(profile.links.m[0].scale, { x: 0.5, y: 0.5, z: 0.5 });
});

test('extractCollisionProfile preserves every canonical runtime collision geometry kind', () => {
  installDomGlobals();
  const robot = parseURDF(
    '<robot name="extended"><link name="base"><collision><geometry><box size="1 2 3"/></geometry></collision></link></robot>',
  );
  assert.ok(robot);
  const robotData = toRobotData(robot!);
  const baseCollision = robotData.links.base.collision;
  robotData.links.base.collisionBodies = [
    { ...baseCollision, type: GeometryType.PLANE },
    { ...baseCollision, type: GeometryType.ELLIPSOID },
    { ...baseCollision, type: GeometryType.HFIELD },
    { ...baseCollision, type: GeometryType.POLYLINE },
  ];

  const profile = extractCollisionProfile(robotData, 'extended');
  assert.deepEqual(
    profile.links.base.map((body) => [body.type, body.runtimeKey]),
    [
      ['box', 'base::collision::0'],
      ['plane', 'base::collision::1'],
      ['ellipsoid', 'base::collision::2'],
      ['hfield', 'base::collision::3'],
      ['polyline', 'base::collision::4'],
    ],
  );
});

test('extractCollisionProfile skips links without collision geometry', () => {
  installDomGlobals();
  const urdf = `<robot name="t"><link name="empty"/></robot>`;
  const robot = parseURDF(urdf);
  const profile = extractCollisionProfile(toRobotData(robot!), 't');
  assert.deepEqual(profile.links, {});
});
