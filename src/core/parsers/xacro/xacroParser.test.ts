import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

import { parseURDF } from '@/core/parsers/urdf';
import { parseXacro, processXacro, type XacroFileMap } from './xacroParser';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;

const UNITREE_ROBOTS_ROOT = 'test/unitree_ros/robots';

function normalizeRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function buildFileMap(rootDir: string): XacroFileMap {
  const fileMap: XacroFileMap = {};

  const visit = (currentDir: string) => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const relativePath = normalizeRelativePath(path.relative(process.cwd(), fullPath));
      fileMap[relativePath] = fs.readFileSync(fullPath, 'utf8');
    }
  };

  visit(rootDir);
  return fileMap;
}

const unitreeRobotsFileMap = buildFileMap(UNITREE_ROBOTS_ROOT);

function loadRobotFixture(packageName: string) {
  const xacroPath = `${UNITREE_ROBOTS_ROOT}/${packageName}/xacro/robot.xacro`;
  return {
    xacroPath,
    xacroContent: fs.readFileSync(xacroPath, 'utf8'),
    basePath: normalizeRelativePath(path.dirname(xacroPath)),
  };
}

test('processXacro keeps non-robot tags when stripping included robot wrappers', () => {
  const fileMap: XacroFileMap = {
    'fixtures/outer.xacro': `
      <robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="outer">
        <xacro:include filename="fixtures/inner.xacro" />
      </robot>
    `,
    'fixtures/inner.xacro': `
      <robot name="inner">
        <gazebo>
          <plugin filename="libgazebo_ros_control.so" name="gazebo_ros_control">
            <robotNamespace>/fixture</robotNamespace>
            <robotSimType>gazebo_ros_control/DefaultRobotHWSim</robotSimType>
          </plugin>
        </gazebo>
        <link name="base" />
      </robot>
    `,
  };

  const processed = processXacro(fileMap['fixtures/outer.xacro'], {}, fileMap, 'fixtures');

  assert.match(processed, /<robotNamespace>\/fixture<\/robotNamespace>/);
  assert.match(processed, /<robotSimType>gazebo_ros_control\/DefaultRobotHWSim<\/robotSimType>/);
  assert.match(processed, /<link name="base"/);
});

test('processXacro reuses include lookup keys while preserving relative package and fuzzy includes', () => {
  const rawFileMap: XacroFileMap = {
    'workspace/pkg/root/parts/arm.xacro': `
      <robot name="arm">
        <xacro:include filename="../common/joint.xacro" />
        <link name="arm" />
      </robot>
    `,
    'workspace/pkg/root/common/joint.xacro': `
      <robot name="joint">
        <link name="nested_relative_joint" />
      </robot>
    `,
    'workspace/pkg/root/common/package_part.xacro': `
      <robot name="package_part">
        <link name="package_part" />
      </robot>
    `,
    'workspace/other/shared/sensor.xacro': `
      <robot name="sensor">
        <link name="fuzzy_sensor" />
      </robot>
    `,
  };
  let ownKeysCalls = 0;
  const fileMap: XacroFileMap = new Proxy(rawFileMap, {
    ownKeys(target) {
      ownKeysCalls += 1;
      return Reflect.ownKeys(target);
    },
  });

  const processed = processXacro(
    `
      <robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="outer">
        <xacro:include filename="parts/arm.xacro" />
        <xacro:include filename="$(find pkg)/root/common/package_part.xacro" />
        <xacro:include filename="sensor.xacro" />
      </robot>
    `,
    {},
    fileMap,
    'workspace/pkg/root',
  );

  assert.match(processed, /<link name="arm"/);
  assert.match(processed, /<link name="nested_relative_joint"/);
  assert.match(processed, /<link name="package_part"/);
  assert.match(processed, /<link name="fuzzy_sensor"/);
  assert.equal(ownKeysCalls, 1);
});

test('processXacro evaluates boolean expressions and quoted string comparisons in conditionals', () => {
  const processed = processXacro(`
    <robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="conditional_fixture">
      <xacro:property name="mirror_dae" value="False" />
      <xacro:property name="rolloverProtection" value="true" />

      <xacro:if value="\${(mirror_dae == False) and (rolloverProtection == 'true')}">
        <link name="enabled_link" />
      </xacro:if>

      <xacro:unless value="\${(mirror_dae == False) and (rolloverProtection == 'true')}">
        <link name="disabled_link" />
      </xacro:unless>
    </robot>
  `);

  assert.match(processed, /<link name="enabled_link"/);
  assert.doesNotMatch(processed, /<link name="disabled_link"/);
});

test('processXacro does not eagerly evaluate conditionals inside macro definitions before expansion', () => {
  const processed = processXacro(`
    <robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="macro_conditional_fixture">
      <xacro:macro name="leg" params="mirror_dae front_hind_dae">
        <xacro:if value="\${(mirror_dae == False) and (front_hind_dae == True)}">
          <link name="mirrored_leg" />
        </xacro:if>
      </xacro:macro>

      <xacro:leg mirror_dae="False" front_hind_dae="True" />
    </robot>
  `);

  assert.match(processed, /<link name="mirrored_leg"/);
});

test('processXacro expands xacro macros whose params attribute is omitted', () => {
  const processed = processXacro(`
    <robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="parameterless_macro_fixture">
      <xacro:macro name="chassis">
        <link name="base_link" />
      </xacro:macro>

      <xacro:chassis />
    </robot>
  `);

  assert.match(processed, /<link name="base_link"/);
  assert.doesNotMatch(processed, /<xacro:chassis/);
});

test('processXacro treats unresolved debug arg conditionals as disabled instead of aborting parse', () => {
  const processed = processXacro(`
    <robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="missing_debug_arg_fixture">
      <xacro:if value="$(arg DEBUG)">
        <link name="debug_world" />
      </xacro:if>
      <link name="base" />
    </robot>
  `);

  assert.match(processed, /<link name="base"/);
  assert.doesNotMatch(processed, /debug_world/);
});

test('processXacro fails fast when unresolved substitution arguments remain in emitted output', () => {
  assert.throws(
    () =>
      processXacro(`
        <robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="missing_arg_fixture">
          <link name="base" />
          <gazebo>
            <robotNamespace>$(arg robot_namespace)</robotNamespace>
          </gazebo>
        </robot>
      `),
    /\[Xacro\] Unresolved substitution arguments remain after expansion/,
  );
});

test('parseXacro expands insert_block block parameters like upstream xacro macros', () => {
  const robot = parseXacro(`
    <robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="block_macro_fixture">
      <xacro:macro name="leg" params="name *origin">
        <link name="\${name}" />
        <joint name="\${name}_joint" type="fixed">
          <xacro:insert_block name="origin" />
          <parent link="base" />
          <child link="\${name}" />
        </joint>
      </xacro:macro>

      <link name="base" />
      <xacro:leg name="FR">
        <origin xyz="1 2 3" rpy="0 0 0" />
      </xacro:leg>
    </robot>
  `);

  assert.ok(robot);
  assert.equal(robot.joints.FR_joint.origin.xyz.x, 1);
  assert.equal(robot.joints.FR_joint.origin.xyz.y, 2);
  assert.equal(robot.joints.FR_joint.origin.xyz.z, 3);
});

test('processXacro preserves gazebo plugin metadata in the real a1 fixture output', () => {
  const fixture = loadRobotFixture('a1_description');
  const processed = processXacro(fixture.xacroContent, {}, unitreeRobotsFileMap, fixture.basePath);
  const generatedUrdf = fs.readFileSync(
    `${UNITREE_ROBOTS_ROOT}/a1_description/urdf/a1.urdf`,
    'utf8',
  );

  assert.match(generatedUrdf, /<robotNamespace>\/a1_gazebo<\/robotNamespace>/);
  assert.match(processed, /<robotNamespace>\/a1_gazebo<\/robotNamespace>/);
  assert.match(processed, /<robotSimType>gazebo_ros_control\/DefaultRobotHWSim<\/robotSimType>/);
});

test('parseXacro resolves go2 mirrored leg semantics to the same joint truth as the generated URDF', () => {
  const fixture = loadRobotFixture('go2_description');
  const xacroRobot = parseXacro(fixture.xacroContent, {}, unitreeRobotsFileMap, fixture.basePath);
  const urdfRobot = parseURDF(
    fs.readFileSync(`${UNITREE_ROBOTS_ROOT}/go2_description/urdf/go2_description.urdf`, 'utf8'),
  );

  assert.ok(xacroRobot);
  assert.ok(urdfRobot);

  assert.equal(
    xacroRobot.joints.FL_hip_joint.origin.xyz.y,
    urdfRobot.joints.FL_hip_joint.origin.xyz.y,
  );
  assert.equal(
    xacroRobot.joints.FR_hip_joint.origin.xyz.y,
    urdfRobot.joints.FR_hip_joint.origin.xyz.y,
  );
  assert.equal(
    xacroRobot.joints.FL_calf_joint.limit?.lower,
    urdfRobot.joints.FL_calf_joint.limit?.lower,
  );
  assert.equal(
    xacroRobot.joints.FR_calf_joint.limit?.upper,
    urdfRobot.joints.FR_calf_joint.limit?.upper,
  );
  assert.match(xacroRobot.links.FL_thigh.visual.meshPath ?? '', /thigh\.dae$/);
  assert.match(xacroRobot.links.FR_thigh.visual.meshPath ?? '', /thigh_mirror\.dae$/);
});

test('parseXacro can load the main Unitree robot.xacro fixtures without modifying source files', () => {
  const fixturePackages = [
    'a1_description',
    'aliengo_description',
    'aliengoZ1_description',
    'b1_description',
    'b2_description',
    'b2w_description',
    'go1_description',
    'go2_description',
    'laikago_description',
    'z1_description',
  ];

  for (const packageName of fixturePackages) {
    const fixture = loadRobotFixture(packageName);
    const robot = parseXacro(fixture.xacroContent, {}, unitreeRobotsFileMap, fixture.basePath);

    assert.ok(robot, `${packageName} should parse`);
    assert.ok(robot.rootLinkId, `${packageName} should resolve a root link`);
    assert.ok(Object.keys(robot.links).length > 0, `${packageName} should expose parsed links`);
  }
});
