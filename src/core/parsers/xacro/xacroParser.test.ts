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

test('processXacro accepts xacro-prefixed robot root tags', () => {
  const processed = processXacro(`
    <xacro:robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="prefixed_root">
      <link name="base" />
    </xacro:robot>
  `);

  assert.match(processed, /<robot name="prefixed_root">/);
  assert.match(processed, /<link name="base"/);
  assert.doesNotMatch(processed, /<xacro:robot/);

  const robot = parseXacro(processed);
  assert.ok(robot);
  assert.equal(robot.name, 'prefixed_root');
  assert.ok(robot.links.base);
});

test('processXacro strips xacro-prefixed robot wrappers from included files', () => {
  const fileMap: XacroFileMap = {
    'fixtures/outer.xacro': `
      <robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="outer">
        <xacro:include filename="fixtures/inner_prefixed.xacro" />
      </robot>
    `,
    'fixtures/inner_prefixed.xacro': `
      <xacro:robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="inner">
        <link name="included_base" />
      </xacro:robot>
    `,
  };

  const processed = processXacro(fileMap['fixtures/outer.xacro'], {}, fileMap, 'fixtures');

  assert.match(processed, /<link name="included_base"/);
  assert.doesNotMatch(processed, /xacro:robot/);
  assert.equal((processed.match(/<robot\b/g) ?? []).length, 1);
});

test('processXacro supports namespaced include macros and simple properties', () => {
  const fileMap: XacroFileMap = {
    'fixtures/outer_ns.xacro': `
      <robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="outer">
        <xacro:include filename="fixtures/inner_ns.xacro" ns="arm" />
        <xacro:arm.make_link suffix="left" />
        <link name="\${arm.prefix}_anchor" />
      </robot>
    `,
    'fixtures/inner_ns.xacro': `
      <robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="inner">
        <xacro:property name="prefix" value="fixture" />
        <xacro:macro name="make_link" params="suffix">
          <link name="\${prefix}_\${suffix}" />
        </xacro:macro>
      </robot>
    `,
  };

  const processed = processXacro(fileMap['fixtures/outer_ns.xacro'], {}, fileMap, 'fixtures');

  assert.match(processed, /<link name="fixture_left"/);
  assert.match(processed, /<link name="fixture_anchor"/);
  assert.doesNotMatch(processed, /xacro:arm\.make_link/);
});

test('processXacro expands self-closing macro calls with slash characters in attributes', () => {
  const processed = processXacro(`
    <robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="slash_attrs">
      <xacro:macro name="mesh_link" params="name mesh_path">
        <link name="\${name}">
          <visual>
            <geometry>
              <mesh filename="\${mesh_path}" />
            </geometry>
          </visual>
        </link>
      </xacro:macro>
      <xacro:mesh_link name="base" mesh_path="package://demo_pkg/meshes/base.stl" />
    </robot>
  `);

  assert.match(processed, /<link name="base"/);
  assert.match(processed, /<mesh filename="meshes\/base\.stl"/);
  assert.doesNotMatch(processed, /xacro:mesh_link/);
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

test('processXacro evaluates unary operators around signed numeric properties', () => {
  const processed = processXacro(`
    <robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="signed_expression_fixture">
      <xacro:property name="lower" value="-1.25" />
      <link name="base" data-mirrored="\${-lower}" data-half-turn="\${-pi/2}" />
    </robot>
  `);

  assert.match(processed, /data-mirrored="1\.25"/);
  assert.match(processed, /data-half-turn="-1\.5707963267948966"/);
  assert.doesNotMatch(processed, /\$\{/);
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

test('parseXacro omits an unresolved conditional block and preserves healthy siblings', () => {
  const robot = parseXacro(`
    <robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="missing_debug_arg_fixture">
      <xacro:if value="$(arg DEBUG)">
        <link name="debug_world" />
      </xacro:if>
      <link name="base" />
    </robot>
  `);

  assert.ok(robot);
  assert.ok(robot.links.base);
  assert.equal(robot.links.debug_world, undefined);
  assert.equal(robot.inspectionContext?.sourceFormat, 'xacro');
  assert.equal(
    robot.inspectionContext?.recovery?.diagnostics.some(
      (diagnostic) => diagnostic.code === 'xacro_unresolved_condition_omitted',
    ),
    true,
  );
});

test('processXacro omits unresolved substitution text and preserves emitted XML', () => {
  const processed = processXacro(`
    <robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="missing_arg_fixture">
      <link name="base" />
      <gazebo>
        <robotNamespace>$(arg robot_namespace)</robotNamespace>
      </gazebo>
    </robot>
  `);

  assert.match(processed, /<link name="base"/);
  assert.doesNotMatch(processed, /\$\(arg robot_namespace\)/);
});

test('parseXacro omits a construct with an unresolved identity and keeps a healthy link', () => {
  const robot = parseXacro(`
    <robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="missing_expression_fixture">
      <link name="\${missing_prefix}_broken" />
      <link name="base" />
    </robot>
  `);

  assert.ok(robot);
  assert.deepEqual(Object.keys(robot.links), ['base']);
  const recoveryCodes = new Set(
    robot.inspectionContext?.recovery?.diagnostics.map((diagnostic) => diagnostic.code),
  );
  assert.equal(recoveryCodes.has('xacro_unresolved_substitution_omitted'), true);
  assert.equal(recoveryCodes.has('urdf_unnamed_link_omitted'), true);
});

test('parseXacro omits an unknown macro call and preserves healthy siblings', () => {
  const robot = parseXacro(`
    <robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="unknown_element_fixture">
      <link name="base" />
      <xacro:not_supported />
    </robot>
  `);

  assert.ok(robot);
  assert.ok(robot.links.base);
  assert.equal(
    robot.inspectionContext?.recovery?.diagnostics.some(
      (diagnostic) => diagnostic.code === 'xacro_unresolved_macro_omitted',
    ),
    true,
  );
});

test('parseXacro omits a missing include and reports recovery', () => {
  const robot = parseXacro(`
    <robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="missing_include_fixture">
      <xacro:include filename="missing.xacro" />
      <link name="base" />
    </robot>
  `);

  assert.ok(robot);
  assert.ok(robot.links.base);
  assert.equal(
    robot.inspectionContext?.recovery?.diagnostics.some(
      (diagnostic) => diagnostic.code === 'xacro_missing_include_omitted',
    ),
    true,
  );
});

test('parseXacro cuts a circular include edge and keeps non-circular included content', () => {
  const fileMap: XacroFileMap = {
    'fixtures/loop.xacro': `
      <robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="loop">
        <link name="included_link" />
        <xacro:include filename="loop.xacro" />
      </robot>
    `,
  };
  const robot = parseXacro(
    `
      <robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="circular_include_fixture">
        <link name="base" />
        <xacro:include filename="loop.xacro" />
      </robot>
    `,
    {},
    fileMap,
    'fixtures',
  );

  assert.ok(robot);
  assert.ok(robot.links.base);
  assert.ok(robot.links.included_link);
  assert.equal(
    robot.inspectionContext?.recovery?.diagnostics.some(
      (diagnostic) => diagnostic.code === 'xacro_circular_include_omitted',
    ),
    true,
  );
});

test('parseXacro keeps malformed top-level XML and missing roots fatal', () => {
  assert.throws(
    () => parseXacro('<robot name="broken"><link name="base"></robot>'),
    /\[Xacro\] Malformed top-level XML:/,
  );
  assert.throws(
    () => parseXacro('<link name="base" />'),
    /\[Xacro\] No <robot> root element found\./,
  );
});

test('parseXacro remains fatal when recovery leaves no usable links', () => {
  assert.throws(
    () =>
      parseXacro(`
        <robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="empty_after_recovery">
          <xacro:include filename="missing.xacro" />
        </robot>
      `),
    /\[Xacro\] Processed output is not valid URDF\./,
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

test('parseXacro preserves URDF material alpha after macro expansion', () => {
  const robot = parseXacro(`
    <robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="transparent_xacro_fixture">
      <xacro:property name="paint_alpha" value="0.4" />
      <link name="base">
        <visual>
          <geometry>
            <box size="1 1 1" />
          </geometry>
          <material name="clear_paint">
            <color rgba="0.1 0.2 0.3 \${paint_alpha}" />
          </material>
        </visual>
      </link>
    </robot>
  `);

  assert.ok(robot);
  assert.deepEqual(robot.links.base.visual.authoredMaterials?.[0]?.colorRgba, [0.1, 0.2, 0.3, 0.4]);
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
    const robot = parseXacro(
      fixture.xacroContent,
      { DEBUG: 'false' },
      unitreeRobotsFileMap,
      fixture.basePath,
    );

    assert.ok(robot, `${packageName} should parse`);
    assert.ok(robot.rootLinkId, `${packageName} should resolve a root link`);
    assert.ok(Object.keys(robot.links).length > 0, `${packageName} should expose parsed links`);
  }
});
