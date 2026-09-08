import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { DEFAULT_LINK, GeometryType, type RobotState } from '@/types';
import { generateMujocoXML } from './mjcfGenerator';

function model(): RobotState {
  const link = structuredClone({ ...DEFAULT_LINK, id: 'body', name: 'body' });
  link.inertial = {
    ...link.inertial!, mass: 0,
    inertia: { ixx: 0, iyy: 0, izz: 0, ixy: 0, ixz: 0, iyz: 0 },
  };
  link.visual.type = GeometryType.BOX;
  link.visual.dimensions = { x: 0.2, y: 0.3, z: 0.4 };
  link.collision = structuredClone(link.visual);
  return { name: 'inference', rootLinkId: 'body', links: { body: link }, joints: {},
    selection: { type: null, id: null } };
}

function withXml(robot: RobotState, check: (document: Document) => void): void {
  const dom = new JSDOM(generateMujocoXML(robot, { addFloatBase: true }), { contentType: 'text/xml' });
  try { check(dom.window.document); } finally { dom.window.close(); }
}

test('missing and zero placeholder inertia enable native inference without changing the source', () => {
  for (const missing of [false, true]) {
    const robot = model();
    if (missing) robot.links.body.inertial = undefined;
    const before = structuredClone(robot);
    withXml(robot, (doc) => {
      assert.equal(doc.querySelector('inertial'), null);
      assert.equal(doc.querySelector('compiler')?.getAttribute('inertiafromgeom'), 'auto');
      assert.equal(doc.querySelector('compiler')?.getAttribute('inertiagrouprange'), '3 3');
      assert.ok(doc.querySelector('freejoint'));
      assert.equal(doc.querySelector('geom[group="1"]')?.getAttribute('mass'), '0');
      assert.equal(doc.querySelector('geom[group="3"]')?.getAttribute('mass'), null);
    });
    assert.deepEqual(robot, before);
  }
});

test('additional collision bodies also exclude visual copies from mass inference', () => {
  const robot = model();
  robot.links.body.collisionBodies = [structuredClone(robot.links.body.collision)];
  robot.links.body.collision.type = GeometryType.NONE;
  withXml(robot, (doc) => {
    assert.equal(doc.querySelector('geom[group="1"]')?.getAttribute('mass'), '0');
    assert.equal(doc.querySelectorAll('geom[group="3"]').length, 1);
  });
});

test('moving visual-only models report the missing collision geometry', () => {
  const robot = model();
  robot.links.body.collision.type = GeometryType.NONE;
  assert.throws(() => generateMujocoXML(robot, { addFloatBase: true }), /missing collision geometry/);
});

test('authored mass and inertia are retained, including nonzero invalid or partial input', () => {
  const robot = model();
  for (const mass of [-1]) {
    robot.links.body.inertial!.mass = mass;
    withXml(robot, (doc) => {
      assert.equal(doc.querySelector('inertial')?.getAttribute('mass'), String(mass));
      assert.equal(doc.querySelector('inertial')?.getAttribute('diaginertia'), '0 0 0');
    });
  }
  robot.links.body.inertial!.mass = 2;
  robot.links.body.inertial!.inertia = {
    ixx: 0.01, iyy: 0.02, izz: 0.025, ixy: 0.001, ixz: 0, iyz: 0,
  };
  withXml(robot, (doc) => {
    assert.equal(doc.querySelector('inertial')?.getAttribute('mass'), '2');
    assert.equal(doc.querySelector('inertial')?.getAttribute('fullinertia'), '0.01 0.02 0.025 0.001 0 0');
  });
});


test('known mass is distributed by collision volume while MuJoCo infers the inertia', () => {
  const robot = model();
  robot.links.body.inertial!.mass = 9;
  const second = structuredClone(robot.links.body.collision);
  second.dimensions.x *= 2;
  robot.links.body.collisionBodies = [second];
  const before = structuredClone(robot);
  withXml(robot, (doc) => {
    assert.equal(doc.querySelector('inertial'), null);
    assert.deepEqual(Array.from(doc.querySelectorAll('geom[group="3"]')).map((geom) => Number(geom.getAttribute('mass'))), [3, 6]);
  });
  assert.deepEqual(robot, before);
});

test('force re-estimation replaces existing inertia and uses the selected density', () => {
  const robot = model();
  robot.links.body.inertial!.mass = 2;
  robot.links.body.inertial!.inertia = { ixx: 1, iyy: 1, izz: 1, ixy: 0, ixz: 0, iyz: 0 };
  const xml = generateMujocoXML(robot, { massMode: 'recompute', densityKgM3: 500 });
  assert.doesNotMatch(xml, /<inertial/);
  assert.match(xml, /density="500"/);
  assert.throws(() => generateMujocoXML(robot, { densityKgM3: -1 }), /density/);
  robot.links.body.collision.type = GeometryType.NONE;
  assert.throws(() => generateMujocoXML(robot, { addFloatBase: true, massMode: 'recompute' }), /missing collision geometry/);
});
