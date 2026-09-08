import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
  ensureXacroNamespace,
  generateMujocoXML,
  generateSDF,
  generateURDF,
  injectGazeboTags,
  parseMJCF as parseNullableMJCF,
  parseSDF as parseNullableSDF,
  parseURDF as parseNullableURDF,
  parseXacro as parseNullableXacro,
} from '@/core/parsers';
import { processMJCFIncludes } from '@/core/parsers/mjcf/mjcfSourceResolver';
import { GeometryType, type RobotState } from '@/types';
import { resolveSourcePreservingExportContent } from './sourcePreservingExportUtils.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;

function requireParsed<T>(value: T | null, label: string): T {
  assert.ok(value, label);
  return value;
}

function parseMJCF(source: string): RobotState {
  return requireParsed(parseNullableMJCF(source), 'expected MJCF source to parse');
}

function parseSDF(...args: Parameters<typeof parseNullableSDF>): RobotState {
  return requireParsed(parseNullableSDF(...args), 'expected SDF source to parse');
}

function parseURDF(source: string): RobotState {
  return requireParsed(parseNullableURDF(source), 'expected URDF source to parse');
}

function parseXacro(...args: Parameters<typeof parseNullableXacro>): RobotState {
  return requireParsed(parseNullableXacro(...args), 'expected Xacro source to parse');
}

const URDF_SOURCE = `<?xml version="1.0"?>
<robot name="demo">
  <!-- keep base link comment -->
  <link name="base_link">
    <visual>
      <geometry>
        <box size="1 1 1" />
      </geometry>
    </visual>
  </link>
  <link name="tool_link" />
  <joint name="tool_joint" type="revolute">
    <parent link="base_link" />
    <child link="tool_link" />
    <axis xyz="0 0 1" />
    <limit lower="-1" upper="1" effort="2" velocity="3" />
  </joint>
</robot>`;

test('resolveSourcePreservingExportContent patches URDF from RobotState while preserving untouched source text', () => {
  const robot = parseURDF(URDF_SOURCE);
  assert.ok(robot.joints.tool_joint.limit);
  robot.joints.tool_joint.limit = {
    ...robot.joints.tool_joint.limit,
    upper: 2,
  };

  const result = resolveSourcePreservingExportContent({
    format: 'urdf',
    currentRobot: robot,
    sourceFile: {
      name: 'robots/demo.urdf',
      format: 'urdf',
      content: URDF_SOURCE,
    },
    generatedContent: generateURDF(robot, { preserveMeshPaths: true }),
  });

  assert.equal(result.strategy, 'source-preserved');
  assert.match(result.content, /keep base link comment/);
  assert.match(result.content, /<limit lower="-1" upper="2" effort="2" velocity="3" \/>/);
  assert.equal(parseURDF(result.content).joints.tool_joint.limit?.upper, 2);
});

test('resolveSourcePreservingExportContent patches MJCF model-owned sections and keeps top-level solver settings', () => {
  const robot = parseURDF(URDF_SOURCE);
  const source = generateMujocoXML(robot, { includeSceneHelpers: false }).replace(
    '<worldbody>',
    '<option timestep="0.002" />\n  <!-- keep mjcf option area -->\n  <worldbody>',
  );
  const nextRobot = {
    ...robot,
    name: 'demo_updated',
  };

  const result = resolveSourcePreservingExportContent({
    format: 'mjcf',
    currentRobot: nextRobot,
    sourceFile: {
      name: 'robots/demo.xml',
      format: 'mjcf',
      content: source,
    },
    generatedContent: generateMujocoXML(nextRobot, { includeSceneHelpers: false }),
  });

  assert.equal(result.strategy, 'source-preserved');
  assert.equal(result.content, source.replace('model="demo"', 'model="demo_updated"'));
  assert.match(result.content, /<mujoco model="demo_updated">/);
  assert.match(result.content, /<option timestep="0\.002" \/>/);
  assert.match(result.content, /keep mjcf option area/);
  assert.equal(parseMJCF(result.content)?.name, 'demo_updated');
});

test('resolveSourcePreservingExportContent drops stale MJCF keyframes that override generated root pose', () => {
  const source = `<?xml version="1.0"?>
<mujoco model="floating_demo">
  <option timestep="0.002" />
  <worldbody>
    <body name="base" pos="0 0 0.1">
      <freejoint name="root_free" />
      <geom type="box" size="0.1 0.1 0.1" />
    </body>
  </worldbody>
  <keyframe>
    <key name="home" qpos="0 0 0.2 1 0 0 0" />
  </keyframe>
</mujoco>`;
  const robot = parseMJCF(source);
  assert.ok(robot);
  robot.joints.root_free.origin = {
    ...robot.joints.root_free.origin,
    xyz: { x: 0, y: 0, z: 0.5 },
  };

  const result = resolveSourcePreservingExportContent({
    format: 'mjcf',
    currentRobot: robot,
    sourceFile: {
      name: 'robots/floating.xml',
      format: 'mjcf',
      content: source,
    },
    generatedContent: generateMujocoXML(robot, { includeSceneHelpers: false }),
  });

  assert.equal(result.strategy, 'source-preserved');
  assert.match(result.content, /<option timestep="0\.002" \/>/);
  assert.doesNotMatch(result.content, /<keyframe>/);
  assert.deepEqual(parseMJCF(result.content)?.joints.root_free.origin.xyz, { x: 0, y: 0, z: 0.5 });
});

test('resolveSourcePreservingExportContent patches MJCF compiler settings with generated mesh paths', () => {
  const source = `<?xml version="1.0"?>
<mujoco model="meshdir_demo">
  <compiler angle="radian" meshdir="assets" />
  <worldbody>
    <body name="base">
      <geom type="mesh" mesh="base_mesh" />
    </body>
  </worldbody>
  <asset>
    <mesh name="base_mesh" file="base.stl" />
  </asset>
</mujoco>`;
  const robot = parseMJCF(source);
  assert.ok(robot);

  const result = resolveSourcePreservingExportContent({
    format: 'mjcf',
    currentRobot: robot,
    sourceFile: {
      name: 'robots/meshdir.xml',
      format: 'mjcf',
      content: source,
    },
    generatedContent: generateMujocoXML(robot, { meshdir: 'meshes/' }),
  });

  assert.equal(result.strategy, 'source-preserved');
  assert.match(result.content, /<compiler angle="radian" meshdir="meshes\/" \/>/);
  assert.equal(parseMJCF(result.content)?.links.base.visual.meshPath, 'meshes/assets/base.stl');
});

test('resolveSourcePreservingExportContent drops stale MJCF defaults that alter generated freejoints', () => {
  const source = `<?xml version="1.0"?>
<mujoco model="default_freejoint_demo">
  <compiler angle="radian" />
  <default>
    <joint damping="0.0239" frictionloss="0.1334" armature="0.01090125" />
  </default>
  <worldbody>
    <body name="base">
      <freejoint name="root_free" />
      <geom type="box" size="0.1 0.1 0.1" />
    </body>
  </worldbody>
</mujoco>`;
  const robot = parseMJCF(source);
  assert.ok(robot);

  const result = resolveSourcePreservingExportContent({
    format: 'mjcf',
    currentRobot: robot,
    sourceFile: {
      name: 'robots/default-freejoint.xml',
      format: 'mjcf',
      content: source,
    },
    generatedContent: generateMujocoXML(robot, { meshdir: 'meshes/' }),
  });

  assert.equal(result.strategy, 'source-preserved');
  assert.doesNotMatch(result.content, /<default>/);
  assert.equal(parseMJCF(result.content)?.joints.root_free.dynamics?.damping, 0);
});

test('resolveSourcePreservingExportContent falls back to generated MJCF for root includes', () => {
  const source = `<?xml version="1.0"?>
<mujoco model="scene">
  <include file="included.xml" />
</mujoco>`;
  const included = `<?xml version="1.0"?>
<mujoco model="included">
  <worldbody>
    <body name="base">
      <geom type="box" size="0.1 0.1 0.1" />
    </body>
  </worldbody>
</mujoco>`;
  const availableFiles = [
    { name: 'robots/scene.xml', format: 'mjcf' as const, content: source },
    { name: 'robots/included.xml', format: 'mjcf' as const, content: included },
  ];
  const robot = parseMJCF(processMJCFIncludes(source, availableFiles, 'robots'));
  assert.ok(robot);
  const generatedContent = generateMujocoXML(robot, { meshdir: 'meshes/' });

  const result = resolveSourcePreservingExportContent({
    format: 'mjcf',
    currentRobot: robot,
    sourceFile: {
      name: 'robots/scene.xml',
      format: 'mjcf',
      content: source,
    },
    availableFiles,
    allFileContents: Object.fromEntries(availableFiles.map((file) => [file.name, file.content])),
    generatedContent,
  });

  assert.equal(result.strategy, 'generated-from-robot-state');
  assert.equal(result.content, generatedContent);
});

test('resolveSourcePreservingExportContent patches SDF model inside an authored world and keeps world plugins', () => {
  const robot = parseURDF(URDF_SOURCE);
  const source = generateSDF(robot).replace(
    '<sdf version="1.7">\n  <model name="demo">',
    '<sdf version="1.7">\n  <world name="default">\n    <plugin name="keep_me" filename="libkeep.so" />\n    <model name="demo">',
  ).replace('</model>\n</sdf>', '</model>\n  </world>\n</sdf>');
  const nextRobot = {
    ...robot,
    name: 'demo_sdf_updated',
  };

  const result = resolveSourcePreservingExportContent({
    format: 'sdf',
    currentRobot: nextRobot,
    sourceFile: {
      name: 'robots/model.sdf',
      format: 'sdf',
      content: source,
    },
    generatedContent: generateSDF(nextRobot),
  });

  assert.equal(result.strategy, 'source-preserved');
  assert.equal(result.content, source.replace('name="demo"', 'name="demo_sdf_updated"'));
  assert.match(result.content, /<world name="default">/);
  assert.match(result.content, /<plugin name="keep_me" filename="libkeep\.so" \/>/);
  assert.match(result.content, /<model name="demo_sdf_updated">/);
  assert.equal(parseSDF(result.content, { sourcePath: 'robots/model.sdf' })?.name, 'demo_sdf_updated');
});

test('resolveSourcePreservingExportContent patches concrete Xacro elements and keeps Xacro declarations', () => {
  const source = URDF_SOURCE.replace(
    '<robot name="demo">',
    '<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="demo">\n  <xacro:property name="prefix" value="" />',
  );
  const robot = parseXacro(source, {}, { 'robots/demo.urdf.xacro': source }, 'robots');
  assert.ok(robot.joints.tool_joint.limit);
  robot.joints.tool_joint.limit = {
    ...robot.joints.tool_joint.limit,
    upper: 4,
  };

  const result = resolveSourcePreservingExportContent({
    format: 'xacro',
    currentRobot: robot,
    sourceFile: {
      name: 'robots/demo.urdf.xacro',
      format: 'xacro',
      content: source,
    },
    availableFiles: [],
    allFileContents: { 'robots/demo.urdf.xacro': source },
    generatedContent: injectGazeboTags(
      generateURDF(robot, { preserveMeshPaths: true }),
      robot,
      'ros2',
      'effort',
    ),
  });

  assert.equal(result.strategy, 'source-preserved');
  assert.match(result.content, /<xacro:property name="prefix" value="" \/>/);
  assert.match(result.content, /<limit lower="-1" upper="4" effort="2" velocity="3" \/>/);
  assert.equal(
    parseXacro(result.content, {}, { 'robots/demo.urdf.xacro': result.content }, 'robots')
      ?.joints.tool_joint.limit?.upper,
    4,
  );
});

test('resolveSourcePreservingExportContent refreshes selected xacro Gazebo controls', () => {
  const source = URDF_SOURCE.replace(
    '<robot name="demo">',
    `<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="demo">
  <gazebo reference="base_link">
    <material>Gazebo/Orange</material>
  </gazebo>
  <transmission name="tool_joint_trans">
    <type>transmission_interface/SimpleTransmission</type>
    <joint name="tool_joint">
      <hardwareInterface>hardware_interface/EffortJointInterface</hardwareInterface>
    </joint>
    <actuator name="tool_joint_motor">
      <hardwareInterface>hardware_interface/EffortJointInterface</hardwareInterface>
      <mechanicalReduction>1</mechanicalReduction>
    </actuator>
  </transmission>
  <gazebo>
    <plugin name="gazebo_ros_control" filename="libgazebo_ros_control.so">
      <robotNamespace>/demo_gazebo</robotNamespace>
      <robotSimType>gazebo_ros_control/DefaultRobotHWSim</robotSimType>
    </plugin>
  </gazebo>`,
  );
  const robot = parseXacro(source, {}, { 'robots/demo.urdf.xacro': source }, 'robots');
  const generatedContent = injectGazeboTags(
    generateURDF(robot, { preserveMeshPaths: true }),
    robot,
    'ros2',
    'velocity',
    { outputMode: 'selected' },
  );

  const result = resolveSourcePreservingExportContent({
    format: 'xacro',
    currentRobot: robot,
    sourceFile: {
      name: 'robots/demo.urdf.xacro',
      format: 'xacro',
      content: source,
    },
    availableFiles: [],
    allFileContents: { 'robots/demo.urdf.xacro': source },
    generatedContent,
  });

  assert.equal(result.strategy, 'source-preserved');
  assert.match(result.content, /<gazebo reference="base_link">/);
  assert.match(result.content, /<material>Gazebo\/Orange<\/material>/);
  assert.match(result.content, /<ros2_control name="demo" type="system">/);
  assert.match(result.content, /<command_interface name="velocity"\/>/);
  assert.match(
    result.content,
    /<plugin name="gazebo_ros2_control" filename="libgazebo_ros2_control\.so">/,
  );
  assert.doesNotMatch(result.content, /<transmission name="tool_joint_trans">/);
  assert.doesNotMatch(result.content, /gazebo_ros_control/);
  assert.equal(
    parseXacro(result.content, {}, { 'robots/demo.urdf.xacro': result.content }, 'robots')
      ?.joints.tool_joint.name,
    'tool_joint',
  );
});

test('resolveSourcePreservingExportContent refreshes selected xacro to modern Gazebo ROS2 controls', () => {
  const source = URDF_SOURCE.replace(
    '<robot name="demo">',
    `<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="demo">
  <gazebo reference="base_link">
    <material>Gazebo/Orange</material>
  </gazebo>
  <ros2_control name="demo" type="system">
    <hardware>
      <plugin>gazebo_ros2_control/GazeboSystem</plugin>
    </hardware>
    <joint name="tool_joint">
      <command_interface name="effort"/>
      <state_interface name="position"/>
      <state_interface name="velocity"/>
      <state_interface name="effort"/>
    </joint>
  </ros2_control>
  <gazebo>
    <plugin name="gazebo_ros2_control" filename="libgazebo_ros2_control.so">
      <robot_param>robot_description</robot_param>
      <robot_param_node>robot_state_publisher</robot_param_node>
    </plugin>
  </gazebo>`,
  );
  const robot = parseXacro(source, {}, { 'robots/demo.urdf.xacro': source }, 'robots');
  const generatedContent = injectGazeboTags(
    generateURDF(robot, { preserveMeshPaths: true }),
    robot,
    'ros2_gz',
    'position',
    { outputMode: 'selected' },
  );

  const result = resolveSourcePreservingExportContent({
    format: 'xacro',
    currentRobot: robot,
    sourceFile: {
      name: 'robots/demo.urdf.xacro',
      format: 'xacro',
      content: source,
    },
    availableFiles: [],
    allFileContents: { 'robots/demo.urdf.xacro': source },
    generatedContent,
  });

  assert.equal(result.strategy, 'source-preserved');
  assert.match(result.content, /<gazebo reference="base_link">/);
  assert.match(result.content, /<material>Gazebo\/Orange<\/material>/);
  assert.match(result.content, /<ros2_control name="demo" type="system">/);
  assert.match(result.content, /<plugin>gz_ros2_control\/GazeboSimSystem<\/plugin>/);
  assert.match(result.content, /<command_interface name="position"\/>/);
  assert.match(
    result.content,
    /<plugin filename="libgz_ros2_control-system\.so" name="gz_ros2_control::GazeboSimROS2ControlPlugin">/,
  );
  assert.doesNotMatch(result.content, /gazebo_ros2_control/);
  assert.doesNotMatch(result.content, /gazebo_ros_control/);
  assert.equal(
    parseXacro(result.content, {}, { 'robots/demo.urdf.xacro': result.content }, 'robots')
      ?.joints.tool_joint.name,
    'tool_joint',
  );
});

test('resolveSourcePreservingExportContent removes managed xacro Gazebo controls when disabled', () => {
  const source = URDF_SOURCE.replace(
    '<robot name="demo">',
    `<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="demo">
  <gazebo reference="base_link">
    <material>Gazebo/Orange</material>
  </gazebo>
  <transmission name="tool_joint_trans">
    <type>transmission_interface/SimpleTransmission</type>
    <joint name="tool_joint">
      <hardwareInterface>hardware_interface/EffortJointInterface</hardwareInterface>
    </joint>
    <actuator name="tool_joint_motor">
      <hardwareInterface>hardware_interface/EffortJointInterface</hardwareInterface>
      <mechanicalReduction>1</mechanicalReduction>
    </actuator>
  </transmission>
  <gazebo>
    <plugin name="gazebo_ros_control" filename="libgazebo_ros_control.so">
      <robotNamespace>/demo_gazebo</robotNamespace>
    </plugin>
  </gazebo>`,
  );
  const robot = parseXacro(source, {}, { 'robots/demo.urdf.xacro': source }, 'robots');
  const generatedContent = ensureXacroNamespace(generateURDF(robot, { preserveMeshPaths: true }));

  const result = resolveSourcePreservingExportContent({
    format: 'xacro',
    currentRobot: robot,
    sourceFile: {
      name: 'robots/demo.urdf.xacro',
      format: 'xacro',
      content: source,
    },
    availableFiles: [],
    allFileContents: { 'robots/demo.urdf.xacro': source },
    generatedContent,
  });

  assert.equal(result.strategy, 'source-preserved');
  assert.match(result.content, /<gazebo reference="base_link">/);
  assert.match(result.content, /<material>Gazebo\/Orange<\/material>/);
  assert.doesNotMatch(result.content, /<transmission\b/);
  assert.doesNotMatch(result.content, /<ros2_control\b/);
  assert.doesNotMatch(result.content, /gazebo_ros_control/);
  assert.doesNotMatch(result.content, /gazebo_ros2_control/);
  assert.doesNotMatch(result.content, /gz_ros2_control/);
  assert.equal(
    parseXacro(result.content, {}, { 'robots/demo.urdf.xacro': result.content }, 'robots')
      ?.joints.tool_joint.name,
    'tool_joint',
  );
});

test('resolveSourcePreservingExportContent fails instead of regenerating when Xacro macros own model structure', () => {
  const source = `<?xml version="1.0"?>
<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="macro_demo">
  <xacro:macro name="make_link" params="name">
    <link name="\${name}" />
  </xacro:macro>
  <xacro:make_link name="base_link" />
</robot>`;
  const robot = parseXacro(source, {}, { 'robots/macro.urdf.xacro': source }, 'robots');
  assert.ok(robot);
  robot.links.base_link.visual = {
    ...robot.links.base_link.visual,
    type: GeometryType.BOX,
    dimensions: { x: 0.2, y: 0.2, z: 0.2 },
  };

  assert.throws(
    () =>
      resolveSourcePreservingExportContent({
        format: 'xacro',
        currentRobot: robot,
        sourceFile: {
          name: 'robots/macro.urdf.xacro',
          format: 'xacro',
          content: source,
        },
        availableFiles: [],
        allFileContents: { 'robots/macro.urdf.xacro': source },
        generatedContent: generateURDF(robot, { preserveMeshPaths: true }),
      }),
    /Cannot preserve Xacro text structure/,
  );
});
