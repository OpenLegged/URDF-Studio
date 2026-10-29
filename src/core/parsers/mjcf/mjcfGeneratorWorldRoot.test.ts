import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { computeLinkWorldMatrices } from '@/core/robot/kinematics';
import { generateMujocoXML } from './mjcfGenerator';
import { parseMJCF } from './mjcfParser';

const { window } = new JSDOM();
globalThis.DOMParser = window.DOMParser as typeof DOMParser;

const FURNITURE = ['bed', 'nightstand_left', 'nightstand_right', 'wardrobe'];
const SCENE = `<mujoco model="room"><compiler angle="radian" />
  <worldbody>
    <geom name="floor" type="plane" size="4 3 0.1" pos="0 0 -0.1" />
    <site name="world_marker" pos="0.5 1 0.25" />
    <body name="room" pos="1 2 0" euler="0 0 0.5">
      <geom name="room_wall" type="box" size="0.1 2 1" />
      <body name="fixed_detail" pos="0.1 0.2 0.3"><geom type="box" size="0.1 0.1 0.1" /></body>
    </body>
    ${FURNITURE.map((name, index) => `<body name="${name}" pos="${index} 1.25 0.6" euler="0 0 ${index / 4}">
      <freejoint name="${name}_free" /><geom type="box" size="0.3 0.2 0.4" />
    </body>`).join('\n')}
  </worldbody>
</mujoco>`;

function parse(source: string) {
  const robot = parseMJCF(source);
  assert.ok(robot);
  return robot;
}

test('world geometry does not wrap multiple free-jointed scene bodies in an extra body', () => {
  const robot = parse(SCENE);
  const source = generateMujocoXML(robot);
  const document = new DOMParser().parseFromString(source, 'application/xml');
  assert.equal(document.querySelector('parsererror'), null);
  assert.equal(document.querySelector('body[name="world_link"]'), null);
  assert.equal(document.querySelectorAll('worldbody > body > freejoint').length, 4);
  assert.equal(document.querySelectorAll('body body freejoint').length, 0);
  assert.ok(document.querySelector('worldbody > geom[name="floor"]'));
  assert.equal(document.querySelector('worldbody > geom[name="floor"]')?.getAttribute('pos'), '0 0 -0.1');
  assert.equal(document.querySelectorAll('site[name="world_marker"]').length, 1);
  assert.ok(document.querySelector('worldbody > site[name="world_marker"]'));
  assert.ok(document.querySelector('worldbody > body[name="room"] > body[name="fixed_detail"]'));
  assert.equal(document.querySelector('worldbody > inertial'), null);
  const beforeMatrices = computeLinkWorldMatrices(robot);
  const afterMatrices = computeLinkWorldMatrices(parse(source));
  for (const name of ['room', 'fixed_detail', ...FURNITURE]) {
    beforeMatrices[name].elements.forEach((value, index) => {
      assert.ok(Math.abs(value - afterMatrices[name].elements[index]!) < 1e-6, `${name} matrix ${index}`);
    });
  }
});

test('world flattening preserves collision and visual geometries in editable source too', () => {
  const source = generateMujocoXML(parse(SCENE), {
    preserveInertialData: true, preserveNumericPrecision: true,
  });
  const document = new DOMParser().parseFromString(source, 'application/xml');
  assert.equal(document.querySelectorAll('worldbody > geom').length, 2);
  assert.equal(document.querySelectorAll('worldbody > body > freejoint').length, 4);
  assert.equal(document.querySelector('worldbody > inertial'), null);
});

test('authored root inertia remains on a real body even when its name is world', () => {
  const robot = parse('<mujoco><worldbody><geom type="plane" size="2 2 0.1" /></worldbody></mujoco>');
  const root = robot.links[robot.rootLinkId];
  root.inertial = {
    mass: 2,
    origin: { xyz: { x: 0.1, y: 0.2, z: 0.3 }, rpy: { r: 0, p: 0, y: 0 } },
    inertia: { ixx: 1, iyy: 1, izz: 1, ixy: 0, ixz: 0, iyz: 0 },
  };
  for (const mass of [2, 0, -1]) {
    root.inertial.mass = mass;
    const source = generateMujocoXML(robot, { preserveInertialData: true });
    const document = new DOMParser().parseFromString(source, 'application/xml');
    const inertia = document.querySelector('worldbody > body[name="world_link"] > inertial');
    assert.ok(inertia);
    assert.equal(inertia.getAttribute('mass'), String(mass));
    assert.equal(inertia.getAttribute('pos'), '0.1 0.2 0.3');
    assert.equal(inertia.getAttribute('diaginertia'), '1 1 1');
  }
});

test('adding a floating base after world geometry inserts the joint inside a top-level body', () => {
  const robot = parse(`<mujoco><worldbody>
    <geom name="floor" type="plane" size="2 2 0.1" />
    <body name="base"><geom type="box" size="0.2 0.2 0.2" /></body>
    </worldbody></mujoco>`);
  const source = generateMujocoXML(robot, { addFloatBase: true });
  const document = new DOMParser().parseFromString(source, 'application/xml');
  assert.equal(document.querySelectorAll('freejoint').length, 1);
  assert.ok(document.querySelector('worldbody > body[name="base"] > freejoint'));
  assert.equal(document.querySelector('worldbody > freejoint'), null);
  assert.ok(document.querySelector('worldbody > geom[name="floor"]'));
});
