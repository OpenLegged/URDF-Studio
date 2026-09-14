import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { parseURDF } from './parser/index.ts';
import { generateURDF } from './urdfGenerator.ts';

const { window } = new JSDOM();
globalThis.DOMParser = window.DOMParser as typeof DOMParser;

const SOURCE = `<robot name="precise">
  <link name="base">
    <inertial>
      <origin xyz="0.12345678901234568 0 0" rpy="0.5235987755982988 0 0" />
      <mass value="0.12345678901234568" />
      <inertia ixx="0.12345678901234568" ixy="0" ixz="0" iyy="0.12345678901234568" iyz="0" izz="0.12345678901234568" />
    </inertial>
    <visual>
      <geometry><sphere radius="0.12345678901234568" /></geometry>
      <material name="precise_color"><color rgba="0.12345678901234568 0.23456789012345678 0.3456789012345679 0.4567890123456789" /></material>
    </visual>
    <collision>
      <geometry><mesh filename="part.stl" scale="0.12345678901234568 0.00000000000000001 1.0000000000000002" /></geometry>
    </collision>
  </link>
  <link name="tip" />
  <joint name="joint" type="revolute">
    <parent link="base" /><child link="tip" />
    <origin xyz="0.12345678901234568 0.00000000000000001 1.0000000000000002" rpy="0.5235987755982988 0 1.5707963267948966" quat_xyzw="0 0 0.7071067811865476 0.7071067811865476" />
    <axis xyz="0 0 1" />
    <limit lower="-0.12345678901234568" upper="0.12345678901234568" effort="1.0000000000000002" velocity="0.12345678901234568" />
    <dynamics damping="0.12345678901234568" friction="0.00000000000000001" />
  </joint>
</robot>`;

function parseRobot(content = SOURCE) {
  const robot = parseURDF(content);
  assert.ok(robot, 'expected a valid URDF robot');
  return robot;
}

test('source generation preserves joint, inertial, geometry and mesh scale numeric values', () => {
  const robot = parseRobot();
  const generated = generateURDF(robot, {
    preserveNumericPrecision: true,
    preserveMeshPaths: true,
  });
  const parsed = parseRobot(generated);

  assert.deepEqual(parsed.joints.joint.origin, robot.joints.joint.origin);
  assert.deepEqual(parsed.joints.joint.limit, robot.joints.joint.limit);
  assert.deepEqual(parsed.joints.joint.dynamics, robot.joints.joint.dynamics);
  assert.deepEqual(parsed.links.base.inertial, robot.links.base.inertial);
  assert.deepEqual(parsed.links.base.visual.dimensions, robot.links.base.visual.dimensions);
  assert.deepEqual(parsed.links.base.collision.dimensions, robot.links.base.collision.dimensions);
});

test('ordinary URDF exports keep their existing rounded numeric output', () => {
  const robot = parseRobot();
  const generated = generateURDF(robot);

  assert.equal(generated, generateURDF(robot, { preserveNumericPrecision: false }));
  assert.match(generated, /xyz="0\.1234568 0 1" rpy="0\.5235988 0 1\.5707963"/);
  assert.match(generated, /quat_xyzw="0 0 0\.70710678 0\.70710678"/);
  assert.match(generated, /<sphere radius="0\.123457"/);
  assert.match(generated, /scale="0\.123457 0 1"/);
  assert.match(generated, /rgba="0\.12345679 0\.23456789 0\.34567890 0\.45678901"/);
});

test('source generation preserves authored RGBA without quantizing its channels', () => {
  const robot = parseRobot();
  const parsed = parseRobot(generateURDF(robot, { preserveNumericPrecision: true }));

  assert.deepEqual(
    parsed.links.base.visual.authoredMaterials,
    robot.links.base.visual.authoredMaterials,
  );
});

test('source generation keeps an opacity override exact without changing authored RGB', () => {
  const robot = parseRobot();
  const material = robot.links.base.visual.authoredMaterials?.[0];
  assert.ok(material?.colorRgba);
  material.opacity = 0.567890123456789;

  const parsed = parseRobot(generateURDF(robot, { preserveNumericPrecision: true }));
  assert.deepEqual(parsed.links.base.visual.authoredMaterials?.[0]?.colorRgba, [
    ...material.colorRgba.slice(0, 3),
    material.opacity,
  ]);
});
