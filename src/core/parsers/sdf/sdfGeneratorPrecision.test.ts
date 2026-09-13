import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { GeometryType, JointType } from '@/types';
import { generateSDF } from './sdfGenerator';
import { parseSDF } from './sdfParser';

const { window } = new JSDOM();
globalThis.DOMParser = window.DOMParser;

const PRECISE = 0.12345678901234568;
const TINY = 1e-17;
const RPY = { r: Math.PI / 6, p: 0.23456789012345678, y: 1.3456789012345678 };
const SOURCE = `<sdf version="1.7"><model name="precise">
  <link name="base"><visual name="base_visual"><geometry><box><size>1 1 1</size></box></geometry></visual></link>
  <link name="arm">
    <pose relative_to="base">${PRECISE} ${TINY} 1.0000000000000002 ${RPY.r} ${RPY.p} ${RPY.y}</pose>
    <inertial>
      <pose>${PRECISE} ${TINY} 0 ${RPY.r} ${RPY.p} ${RPY.y}</pose>
      <mass>${PRECISE}</mass>
      <inertia><ixx>${PRECISE}</ixx><iyy>${PRECISE}</iyy><izz>${PRECISE}</izz><ixy>${TINY}</ixy><ixz>0</ixz><iyz>0</iyz></inertia>
    </inertial>
    <visual name="arm_visual">
      <pose>${PRECISE} ${TINY} 0 ${RPY.r} ${RPY.p} ${RPY.y}</pose>
      <geometry><sphere><radius>${PRECISE}</radius></sphere></geometry>
      <material><diffuse>${PRECISE} 0.23456789012345678 0.3456789012345679 0.4567890123456789</diffuse></material>
    </visual>
    <collision name="arm_collision">
      <pose>${TINY} 0 0 0 0 0</pose>
      <geometry><mesh><uri>model://precise/meshes/part.stl</uri><scale>1.0000000000000002 1 1</scale></mesh></geometry>
    </collision>
  </link>
  <link name="tip"><pose relative_to="arm">${PRECISE} ${TINY} 0 ${RPY.r} ${RPY.p} ${RPY.y}</pose></link>
  <joint name="shoulder" type="revolute"><parent>base</parent><child>arm</child><axis>
    <xyz>${PRECISE} 0 1</xyz>
    <limit><lower>-${PRECISE}</lower><upper>${PRECISE}</upper><effort>${PRECISE}</effort><velocity>${PRECISE}</velocity></limit>
    <dynamics><damping>${PRECISE}</damping><friction>${TINY}</friction></dynamics>
  </axis></joint>
  <joint name="wrist" type="continuous"><parent>arm</parent><child>tip</child><axis>
    <xyz>0 0 1</xyz><mimic joint="shoulder"><multiplier>${PRECISE}</multiplier><offset>${TINY}</offset><reference>0</reference></mimic>
  </axis></joint>
</model></sdf>`;

function parseRobot(content = SOURCE) {
  const robot = parseSDF(content);
  assert.ok(robot, 'expected SDF fixture to parse');
  return robot;
}

test('SDF parsing preserves authored local poses without matrix round-trip drift', () => {
  const robot = parseRobot();

  assert.deepEqual(robot.joints.shoulder.origin.rpy, RPY);
  assert.deepEqual(robot.joints.wrist.origin.rpy, RPY);
  assert.deepEqual(robot.links.arm.visual.origin.rpy, RPY);
  assert.ok(robot.links.arm.inertial?.origin, 'expected the authored inertial pose');
  assert.deepEqual(robot.links.arm.inertial.origin.rpy, RPY);
  assert.equal(robot.links.arm.collision.origin.xyz.x, TINY);
});

test('editable SDF generation preserves joint, inertia, geometry, scale and color precision', () => {
  const robot = parseRobot();
  const content = generateSDF(robot, { preserveNumericPrecision: true });
  const parsed = parseRobot(content);

  for (const jointId of ['shoulder', 'wrist']) {
    assert.deepEqual(parsed.joints[jointId].origin, robot.joints[jointId].origin);
    assert.deepEqual(parsed.joints[jointId].axis, robot.joints[jointId].axis);
    assert.deepEqual(parsed.joints[jointId].limit, robot.joints[jointId].limit);
    assert.deepEqual(parsed.joints[jointId].dynamics, robot.joints[jointId].dynamics);
    assert.deepEqual(parsed.joints[jointId].mimic, robot.joints[jointId].mimic);
  }
  assert.deepEqual(parsed.links.arm.inertial, robot.links.arm.inertial);
  assert.deepEqual(parsed.links.arm.visual.origin, robot.links.arm.visual.origin);
  assert.deepEqual(parsed.links.arm.visual.dimensions, robot.links.arm.visual.dimensions);
  assert.deepEqual(parsed.links.arm.collision.origin, robot.links.arm.collision.origin);
  assert.deepEqual(parsed.links.arm.collision.dimensions, robot.links.arm.collision.dimensions);
  assert.deepEqual(
    parsed.links.arm.visual.authoredMaterials?.[0]?.colorRgba,
    robot.links.arm.visual.authoredMaterials?.[0]?.colorRgba,
  );
});

test('ordinary SDF exports retain their existing compact numeric formatting', () => {
  const robot = parseRobot();
  const content = generateSDF(robot);

  assert.equal(content, generateSDF(robot, { preserveNumericPrecision: false }));
  assert.match(content, /<mass>0\.1234568<\/mass>/);
  assert.match(content, /<radius>0\.123457<\/radius>/);
  assert.match(content, /<diffuse>0\.12345679 0\.23456789 0\.34567890 0\.45678901<\/diffuse>/);
  assert.doesNotMatch(content, /<friction>|<scale>/);
});

test('precise SDF serialization retains a root whose only payload is tiny inertia', () => {
  const robot = parseRobot();
  robot.links.base.visual.type = GeometryType.NONE;
  assert.ok(robot.links.base.inertial, 'expected the parsed base to have default inertia');
  robot.links.base.inertial.mass = 1e-10;
  robot.links.base.inertial.inertia.ixx = 1e-10;
  robot.joints.shoulder.type = JointType.FIXED;

  const content = generateSDF(robot, { preserveNumericPrecision: true });
  const parsed = parseRobot(content);

  assert.equal(parsed.rootLinkId, 'base');
  assert.ok(parsed.joints.shoulder);
  assert.ok(parsed.links.base.inertial, 'expected the generated base to retain its inertia');
  assert.equal(parsed.links.base.inertial.mass, 1e-10);
  assert.equal(parsed.links.base.inertial.inertia.ixx, 1e-10);
});

test('SDF parsing retains a tiny model placement and uniformly tiny mesh scales', () => {
  const source = `<sdf version="1.7"><model name="tiny"><pose>1e-12 0 0 0 0 0</pose>
    <link name="base"><visual name="mesh"><geometry><mesh>
      <uri>part.stl</uri><scale>1e-12 2e-12 3e-12</scale>
    </mesh></geometry></visual></link>
  </model></sdf>`;
  const robot = parseRobot(source);
  assert.equal(robot.joints.base__root_fixed.origin.xyz.x, 1e-12);
  assert.deepEqual(robot.links.base.visual.dimensions, { x: 1e-12, y: 2e-12, z: 3e-12 });

  const parsed = parseRobot(generateSDF(robot, { preserveNumericPrecision: true }));
  assert.deepEqual(parsed.joints.base__root_fixed.origin.xyz, robot.joints.base__root_fixed.origin.xyz);
  assert.deepEqual(parsed.joints.base__root_fixed.origin.rpy, { r: 0, p: 0, y: 0 });
  assert.deepEqual(parsed.links.base.visual.dimensions, robot.links.base.visual.dimensions);
});

test('precise SDF 1.6 export uses valid world poses while retaining scalar precision', () => {
  const robot = parseRobot();
  const content = generateSDF(robot, { preserveNumericPrecision: true, version: '1.6' });
  const parsed = parseRobot(content);

  assert.match(content, /<sdf version="1\.6">/);
  assert.doesNotMatch(content, /relative_to=/);
  assert.deepEqual(parsed.links.arm.inertial, robot.links.arm.inertial);
  assert.deepEqual(parsed.joints.shoulder.limit, robot.joints.shoulder.limit);
  assert.deepEqual(parsed.links.arm.collision.dimensions, robot.links.arm.collision.dimensions);
});
