import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { DEFAULT_LINK, GeometryType, type RobotState } from '@/types';
import { generateMujocoXML } from './mjcfGenerator';
import { parseMJCF } from './mjcfParser';
import { generateSkeletonXML } from './skeletonGenerator';

const { window } = new JSDOM();
globalThis.DOMParser = window.DOMParser as typeof DOMParser;

const PRECISE_ASSETS = `<mujoco model="precision"><compiler angle="radian" />
  <asset>
    <mesh name="part" vertex="0 0 0 0.123456789123456 0 0 0 0.234567891234567 0 0 0 0.345678912345678"
      scale="1.123456789123456 1 1" refpos="0.123456789123456 0 0" />
    <hfield name="terrain" nrow="2" ncol="2" size="1.123456789123456 1 0.234567891234567 0.01"
      elevation="0 0.123456789123456 0.234567891234567 1" />
    <material name="paint" rgba="0.123456789123456 0.234567891234567 0.345678912345678 0.456789123456789"
      />
  </asset>
  <worldbody><body name="base">
    <geom type="mesh" mesh="part" material="paint" group="1" contype="0" conaffinity="0" />
    <geom type="hfield" hfield="terrain" group="3" />
    <site name="tip" pos="0.123456789123456 0 0" size="0.123456789123456"
      rgba="0.123456789123456 0.234567891234567 0.345678912345678 0.456789123456789" />
  </body></worldbody>
</mujoco>`;

function parse(source: string): RobotState {
  const robot = parseMJCF(source);
  assert.ok(robot);
  return robot;
}

function attr(document: Document, selector: string, name: string): string | null {
  const element = document.querySelector(selector);
  assert.ok(element, selector);
  return element.getAttribute(name);
}

test('precision-preserving MJCF retains mesh, hfield, site and material numeric attributes', () => {
  const robot = parse(PRECISE_ASSETS);
  const roughness = 0.123456789123456;
  robot.materials = { ...robot.materials, base: {
    ...robot.materials?.base,
    color: robot.links.base.visual.color,
    usdMaterial: { roughness, metalness: 0.234567891234567, emissiveIntensity: 1e-20 },
  } };
  const xml = generateMujocoXML(robot, { preserveNumericPrecision: true });
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  assert.equal(attr(document, 'mesh', 'scale'), '1.123456789123456 1 1');
  assert.equal(attr(document, 'mesh', 'refpos'), '0.123456789123456 0 0');
  assert.match(attr(document, 'mesh', 'vertex')!, /0\.345678912345678$/);
  assert.equal(attr(document, 'hfield', 'size'), '1.123456789123456 1 0.234567891234567 0.01');
  assert.equal(attr(document, 'hfield', 'elevation'), '0 0.123456789123456 0.234567891234567 1');
  assert.equal(attr(document, 'site[name="tip"]', 'size'), '0.123456789123456');
  const rgba = '0.123456789123456 0.234567891234567 0.345678912345678 0.456789123456789';
  assert.equal(attr(document, 'site[name="tip"]', 'rgba'), rgba);
  assert.equal(attr(document, 'material[specular]', 'rgba'), rgba);
  assert.equal(attr(document, 'material[specular]', 'shininess'), String(1 - roughness));
  assert.equal(attr(document, 'material[specular]', 'reflectance'), '0.234567891234567');
  assert.equal(attr(document, 'material[specular]', 'emission'), '1e-20');
});

test('precision policy is isolated per generation and legacy export rounding stays unchanged', () => {
  const robot = parse(PRECISE_ASSETS);
  const legacy = generateMujocoXML(robot);
  assert.match(legacy, /scale="1\.123457 1 1"/);
  assert.notEqual(generateMujocoXML(robot, { preserveNumericPrecision: true }), legacy);
  assert.equal(generateMujocoXML(robot), legacy);
});

test('precise MJCF retains tiny imported mesh scales and nonzero off-diagonal inertias', () => {
  const robot = parse('<mujoco><worldbody><body name="base" /></worldbody></mujoco>');
  const link = robot.links.base;
  link.visual = { ...structuredClone(DEFAULT_LINK.visual), type: GeometryType.MESH,
    meshPath: 'tiny.stl', dimensions: { x: 1e-20, y: 1, z: 1 } };
  link.inertial = { mass: 1e-20,
    inertia: { ixx: 1e-20, iyy: 1e-20, izz: 1e-20, ixy: 1e-25, ixz: 0, iyz: 0 } };
  const xml = generateMujocoXML(robot, { preserveNumericPrecision: true });
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  assert.equal(attr(document, 'mesh', 'scale'), '1e-20 1 1');
  assert.ok(attr(document, 'geom', 'mesh'));
  assert.equal(attr(document, 'inertial', 'mass'), '1e-20');
  assert.equal(attr(document, 'inertial', 'fullinertia'), '1e-20 1e-20 1e-20 1e-25 0 0');
});

test('MJCF skeleton minimum inertias remain nonzero instead of rounding into a singular tensor', () => {
  const link = structuredClone(DEFAULT_LINK);
  link.id = 'base';
  link.name = 'base';
  link.inertial!.inertia = { ixx: 0, iyy: 0, izz: 0, ixy: 0, ixz: 0, iyz: 0 };
  const robot: RobotState = {
    name: 'skeleton', rootLinkId: 'base', links: { base: link }, joints: {},
    selection: { type: null, id: null },
  };
  for (const preserveNumericPrecision of [false, true]) {
    const xml = generateSkeletonXML(robot, { preserveNumericPrecision });
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    assert.deepEqual(attr(document, 'inertial', 'diaginertia')!.split(' ').map(Number), [1e-8, 1e-8, 1e-8]);
  }
});
