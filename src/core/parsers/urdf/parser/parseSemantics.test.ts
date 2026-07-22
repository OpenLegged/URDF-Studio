import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

import {
  getTreeDisplayRootLinkIds,
  getTreeRenderRootLinkIds,
  isSyntheticWorldRoot,
  isTransparentDisplayLink,
} from '@/core/robot';
import { GeometryType, IMPORTED_EXTERNAL_FRAME_LINK_TYPE } from '@/types';
import { parseURDF } from './index.ts';
import { generateURDF } from '../urdfGenerator.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;

const FLOATING_ROOT_URDF = `<?xml version="1.0"?>
<robot name="hi_25dof">
  <link name="world"></link>
  <joint name="floating_base_joint" type="floating">
    <parent link="world" />
    <child link="base_link" />
  </joint>
  <link name="base_link">
    <inertial>
      <mass value="1" />
      <inertia ixx="1" ixy="0" ixz="0" iyy="1" iyz="0" izz="1" />
    </inertial>
  </link>
</robot>`;

test('parseURDF preserves missing inertial and floating joint optional fields', () => {
  const robot = parseURDF(FLOATING_ROOT_URDF);

  assert.ok(robot);
  assert.equal(isSyntheticWorldRoot(robot, robot.rootLinkId), true);
  assert.equal(robot.links.world?.inertial, undefined);
  assert.equal(robot.joints.floating_base_joint?.axis, undefined);
  assert.equal(robot.joints.floating_base_joint?.limit, undefined);
});

test('parseURDF uses the URDF default axis for movable joints with omitted axis tags', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="default_axis">
  <link name="base_link" />
  <link name="wheel_link" />
  <joint name="wheel_joint" type="continuous">
    <parent link="base_link" />
    <child link="wheel_link" />
  </joint>
</robot>`);

  assert.ok(robot);
  assert.deepEqual(robot.joints.wheel_joint?.axis, { x: 1, y: 0, z: 0 });
});

test('parseURDF synthesizes undeclared external world parents as transparent roots', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="undeclared_world_parent">
  <joint name="world_joint" type="fixed">
    <parent link="world" />
    <child link="base_link" />
    <origin xyz="1 2 3" rpy="0.1 0.2 0.3" />
  </joint>
  <link name="base_link" />
</robot>`);

  assert.ok(robot);
  assert.equal(robot.rootLinkId, 'world');
  assert.equal(robot.links.world?.type, IMPORTED_EXTERNAL_FRAME_LINK_TYPE);
  assert.equal(isSyntheticWorldRoot(robot, robot.rootLinkId), true);
  assert.deepEqual(getTreeRenderRootLinkIds(robot), ['world']);
  assert.deepEqual(getTreeDisplayRootLinkIds(robot), ['base_link']);
  assert.deepEqual(robot.joints.world_joint?.origin.xyz, { x: 1, y: 2, z: 3 });
  assert.deepEqual(robot.joints.world_joint?.origin.rpy, { r: 0.1, p: 0.2, y: 0.3 });
});

test('parseURDF treats any undeclared external parent as a generic transparent frame root', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="undeclared_map_parent">
  <link name="orphan_marker" />
  <joint name="map_to_base" type="fixed">
    <parent link="map" />
    <child link="base_link" />
  </joint>
  <link name="base_link" />
  <joint name="tool_joint" type="fixed">
    <parent link="base_link" />
    <child link="tool_link" />
  </joint>
  <link name="tool_link" />
</robot>`);

  assert.ok(robot);
  assert.equal(robot.rootLinkId, 'map');
  assert.equal(robot.links.map?.type, IMPORTED_EXTERNAL_FRAME_LINK_TYPE);
  assert.equal(isSyntheticWorldRoot(robot, robot.rootLinkId), false);
  assert.equal(isTransparentDisplayLink(robot, robot.rootLinkId), true);
  assert.deepEqual(getTreeRenderRootLinkIds(robot), ['map']);
  assert.deepEqual(getTreeDisplayRootLinkIds(robot), ['base_link']);
});

test('parseURDF tolerates undeclared namespace-prefixed extension tags and attributes', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="gazebo_sensor_namespace">
  <link name="base_link" />
  <gazebo reference="base_link">
    <sensor:camera custom:enabled="true" name="rgb">
      <imageFormat>R8G8B8</imageFormat>
    </sensor:camera>
  </gazebo>
</robot>`);

  assert.ok(robot);
  assert.equal(robot.rootLinkId, 'base_link');
});

test('parseURDF records URDF diagnostics for later AI inspection without blocking import', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="diagnostic_fixture">
  <link name="base_link">
    <inertial>
      <origin xyz="0 bad 0" />
      <mass value="0" />
      <inertia ixx="0" ixy="0" ixz="0" iyy="1" iyz="0" izz="1" />
    </inertial>
    <visual>
      <origin xyz="1 bad 1" />
      <geometry><box size="1 0 1" /></geometry>
    </visual>
    <collision>
      <origin rpy="0 nope 0" />
      <geometry><mesh /></geometry>
    </collision>
  </link>
  <link name="tip_link" />
  <joint name="elbow_joint" type="revolute">
    <parent link="base_link" />
    <child link="tip_link" />
    <origin rpy="0 broken 0" />
    <axis xyz="0 0 0" />
  </joint>
</robot>`);

  assert.ok(robot);
  assert.equal(robot.inspectionContext?.sourceFormat, 'urdf');
  assert.equal(robot.inspectionContext?.urdf?.facts.linkCount, 2);
  assert.equal(robot.inspectionContext?.urdf?.facts.jointCount, 1);
  assert.equal(robot.inspectionContext?.urdf?.facts.visualCount, 1);
  assert.equal(robot.inspectionContext?.urdf?.facts.collisionCount, 1);
  assert.equal(robot.inspectionContext?.urdf?.facts.inertialCount, 1);

  const diagnosticCodes = new Set(
    robot.inspectionContext?.urdf?.diagnostics.map((diagnostic) => diagnostic.code),
  );
  assert.equal(diagnosticCodes.has('inertial_mass_nonpositive'), true);
  assert.equal(diagnosticCodes.has('inertial_origin_xyz_invalid'), true);
  assert.equal(diagnosticCodes.has('inertia_diagonal_nonpositive'), true);
  assert.equal(diagnosticCodes.has('visual_origin_xyz_invalid'), true);
  assert.equal(diagnosticCodes.has('visual_box_size_invalid'), true);
  assert.equal(diagnosticCodes.has('collision_origin_rpy_invalid'), true);
  assert.equal(diagnosticCodes.has('collision_mesh_filename_missing'), true);
  assert.equal(diagnosticCodes.has('joint_origin_rpy_invalid'), true);
  assert.equal(diagnosticCodes.has('movable_joint_missing_limit'), true);
  assert.equal(diagnosticCodes.has('joint_axis_invalid'), true);
});

test('generateURDF does not synthesize inertial or limit tags for absent source fields', () => {
  const robot = parseURDF(FLOATING_ROOT_URDF);
  assert.ok(robot);

  const urdf = generateURDF({
    ...robot,
    selection: { type: null, id: null },
  });

  assert.match(urdf, /<link name="world">\s*<\/link>/);
  assert.doesNotMatch(urdf, /<joint name="floating_base_joint" type="floating">[\s\S]*?<limit\b/);
  assert.doesNotMatch(urdf, /<joint name="floating_base_joint" type="floating">[\s\S]*?<axis\b/);
});

test('generateURDF falls back to robot materials when exporting visual colors', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="material_fallback">
  <link name="base_link">
    <visual>
      <geometry>
        <box size="1 1 1" />
      </geometry>
    </visual>
  </link>
</robot>`);

  assert.ok(robot);

  const urdf = generateURDF({
    ...robot,
    materials: {
      base_link: {
        color: '#123456',
      },
    },
    selection: { type: null, id: null },
  });

  assert.match(
    urdf,
    /<material name="base_link_mat">[\s\S]*?<color rgba="0\.07059216 0\.20392549 0\.33725882 1\.00000000"/,
  );
});

test('parseURDF and generateURDF preserve visual material alpha values', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="transparent_material_demo">
  <link name="base_link">
    <visual>
      <geometry>
        <box size="1 1 1" />
      </geometry>
      <material name="transparent_paint">
        <color rgba="0.1 0.2 0.3 0.4" />
      </material>
    </visual>
  </link>
</robot>`);

  assert.ok(robot);
  assert.equal(robot.links.base_link.visual.color, '#19334c');
  assert.deepEqual(robot.links.base_link.visual.authoredMaterials?.[0]?.colorRgba, [
    0.1,
    0.2,
    0.3,
    0.4,
  ]);
  assert.deepEqual(robot.materials?.base_link?.colorRgba, [0.1, 0.2, 0.3, 0.4]);

  const exported = generateURDF({
    ...robot,
    selection: { type: null, id: null },
  });

  assert.match(exported, /<color rgba="0\.10000000 0\.20000000 0\.30000000 0\.40000000"\/>/);
});

test('generateURDF serializes additional visualBodies as extra visual tags', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="multi_visual_export">
  <link name="base_link">
    <visual>
      <geometry>
        <box size="1 1 1" />
      </geometry>
    </visual>
  </link>
</robot>`);

  assert.ok(robot);

  robot.links.base_link.visualBodies = [
    {
      type: GeometryType.MESH,
      dimensions: { x: 0.5, y: 0.5, z: 0.5 },
      color: '#abcdef',
      meshPath: 'meshes/extra_part.dae',
      origin: {
        xyz: { x: 0.1, y: 0.2, z: 0.3 },
        rpy: { r: 0, p: 0, y: 0.4 },
      },
    },
  ];

  const urdf = generateURDF({
    ...robot,
    selection: { type: null, id: null },
  });

  assert.equal((urdf.match(/<visual>/g) || []).length, 2);
  assert.match(urdf, /<origin xyz="0\.1 0\.2 0\.3" rpy="0 0 0\.4" \/>/);
  assert.match(
    urdf,
    /<mesh filename="package:\/\/multi_visual_export\/meshes\/extra_part\.dae" scale="0\.5 0\.5 0\.5" \/>/,
  );
  assert.match(
    urdf,
    /<material name="base_link_mat_1">[\s\S]*?<color rgba="0\.67059216 0\.80392549 0\.93725882 1\.00000000"/,
  );
});

test('parseURDF preserves additional visuals on the same link as visualBodies', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="multi_visual_parse">
  <link name="base_link">
    <visual>
      <geometry>
        <box size="1 2 3" />
      </geometry>
    </visual>
    <visual>
      <origin xyz="0.5 0 0" rpy="0 0 0.25" />
      <geometry>
        <mesh filename="meshes/extra_part.stl" />
      </geometry>
      <material name="painted">
        <color rgba="0.2 0.4 0.6 1" />
      </material>
    </visual>
    <collision>
      <geometry>
        <box size="1 2 3" />
      </geometry>
    </collision>
  </link>
</robot>`);

  assert.ok(robot);
  assert.equal(robot.links.base_link.visual.type, GeometryType.BOX);
  assert.equal(robot.links.base_link.visualBodies?.length, 1);
  assert.equal(robot.links.base_link.visualBodies?.[0]?.type, GeometryType.MESH);
  assert.equal(robot.links.base_link.visualBodies?.[0]?.meshPath, 'meshes/extra_part.stl');
  assert.deepEqual(robot.links.base_link.visualBodies?.[0]?.origin.xyz, { x: 0.5, y: 0, z: 0 });
  assert.deepEqual(robot.links.base_link.visualBodies?.[0]?.origin.rpy, { r: 0, p: 0, y: 0.25 });
  assert.equal(robot.links.base_link.visualBodies?.[0]?.color, '#336699');
  assert.equal(robot.links.base_link.visualBodies?.[0]?.materialSource, 'inline');
});

test('parseURDF preserves SO101 multi-part link visuals from source files', () => {
  const source = fs.readFileSync(
    'test/awesome_robot_descriptions_repos/SO-ARM100/Simulation/SO101/so101_new_calib.urdf',
    'utf8',
  );
  const robot = parseURDF(source);

  assert.ok(robot);
  assert.equal(robot.links.base_link.visual.meshPath, 'assets/base_motor_holder_so101_v1.stl');
  assert.equal(robot.links.base_link.visualBodies?.length, 3);
  assert.deepEqual(
    robot.links.base_link.visualBodies?.map((body) => body.meshPath),
    [
      'assets/base_so101_v2.stl',
      'assets/sts3215_03a_v1.stl',
      'assets/waveshare_mounting_plate_so101_v2.stl',
    ],
  );
  assert.equal(robot.links.shoulder_link.visualBodies?.length, 2);
  assert.deepEqual(
    robot.links.shoulder_link.visualBodies?.map((body) => body.meshPath),
    ['assets/motor_holder_so101_base_v1.stl', 'assets/rotation_pitch_so101_v1.stl'],
  );
  assert.equal(robot.links.lower_arm_link.visualBodies?.length, 2);
});

test('parseURDF preserves SO101 old calib yellow/black visual colors from ROS source files', () => {
  const source = fs.readFileSync(
    'test/awesome_robot_descriptions_repos/SO-ARM100/Simulation/SO101/so101_old_calib.urdf',
    'utf8',
  );
  const robot = parseURDF(source);

  assert.ok(robot);
  const baseColors = new Map(
    [robot.links.base.visual, ...(robot.links.base.visualBodies ?? [])].map((body) => [
      body.meshPath,
      body.color,
    ]),
  );
  const shoulderColors = new Map(
    [robot.links.shoulder.visual, ...(robot.links.shoulder.visualBodies ?? [])].map((body) => [
      body.meshPath,
      body.color,
    ]),
  );
  const wristColors = new Map(
    [robot.links.wrist.visual, ...(robot.links.wrist.visualBodies ?? [])].map((body) => [
      body.meshPath,
      body.color,
    ]),
  );

  assert.equal(baseColors.get('assets/base_motor_holder_so101_v1.stl'), '#ffd11e');
  assert.equal(baseColors.get('assets/base_so101_v2.stl'), '#ffd11e');
  assert.equal(baseColors.get('assets/sts3215_03a_v1.stl'), '#191919');
  assert.equal(baseColors.get('assets/waveshare_mounting_plate_so101_v2.stl'), '#ffd11e');
  assert.equal(shoulderColors.get('assets/sts3215_03a_v1.stl'), '#191919');
  assert.equal(shoulderColors.get('assets/motor_holder_so101_base_v1.stl'), '#ffd11e');
  assert.equal(shoulderColors.get('assets/rotation_pitch_so101_v1.stl'), '#ffd11e');
  assert.equal(wristColors.get('assets/sts3215_03a_no_horn_v1.stl'), '#191919');
  assert.equal(wristColors.get('assets/wrist_roll_pitch_so101_v2.stl'), '#ffd11e');
  assert.equal(robot.links.jaw.visual.color, '#ffd11e');
});

test('generateURDF omits inline mesh colors when the mesh export already carries baked colors', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="vertex_color_export">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="meshes/base_link_visual_0.obj" />
      </geometry>
    </visual>
  </link>
</robot>`);

  assert.ok(robot);

  const urdf = generateURDF(
    {
      ...robot,
      materials: {
        base_link: {
          color: '#123456',
        },
      },
      selection: { type: null, id: null },
    },
    {
      omitMeshMaterialPaths: ['meshes/base_link_visual_0.obj'],
    },
  );

  assert.match(
    urdf,
    /<mesh filename="package:\/\/vertex_color_export\/meshes\/base_link_visual_0\.obj" \/>/,
  );
  assert.doesNotMatch(urdf, /<material name="base_link_mat">/);
});

test('generateURDF preserves hex material colors across parse roundtrips', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="material_roundtrip">
  <link name="base_link">
    <visual>
      <geometry>
        <box size="1 1 1" />
      </geometry>
    </visual>
  </link>
</robot>`);

  assert.ok(robot);

  const exported = generateURDF({
    ...robot,
    materials: {
      base_link: {
        color: '#123456',
      },
    },
    selection: { type: null, id: null },
  });

  const reparsed = parseURDF(exported);
  assert.ok(reparsed);
  assert.equal(reparsed?.links.base_link.visual.color, '#123456');
  assert.equal(reparsed?.materials?.base_link?.color, '#123456');
});

test('parseURDF syncs visual colors into robot materials state', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="material_parse">
  <link name="base_link">
    <visual>
      <geometry>
        <box size="1 1 1" />
      </geometry>
      <material name="base_link_mat">
        <color rgba="0.1 0.2 0.3 1" />
      </material>
    </visual>
  </link>
</robot>`);

  assert.ok(robot);
  assert.equal(robot.links.base_link.visual.color, '#19334c');
  assert.equal(robot.materials?.base_link?.color, '#19334c');
});

test('parseURDF prefers global named materials over conflicting local color definitions', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="global_material_priority">
  <material name="dark">
    <color rgba="0.2 0.2 0.2 1" />
  </material>
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="base.stl" />
      </geometry>
      <material name="dark">
        <color rgba="1 1 1 1" />
      </material>
    </visual>
  </link>
</robot>`);

  assert.ok(robot);
  assert.equal(robot.links.base_link.visual.color, '#333333');
  assert.equal(robot.links.base_link.visual.materialSource, 'named');
  assert.equal(robot.materials?.base_link?.color, '#333333');
});

test('parseURDF preserves continuous joint effort and velocity without synthesizing position bounds', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="continuous_limits">
  <link name="base_link" />
  <link name="tip_link" />
  <joint name="spin_joint" type="continuous">
    <parent link="base_link" />
    <child link="tip_link" />
    <axis xyz="0 0 1" />
    <limit effort="35.278" velocity="20" />
  </joint>
</robot>`);

  assert.ok(robot);
  assert.ok(robot.joints.spin_joint?.limit);
  assert.equal(robot.joints.spin_joint.limit?.lower, undefined);
  assert.equal(robot.joints.spin_joint.limit?.upper, undefined);
  assert.equal(robot.joints.spin_joint.limit?.effort, 35.278);
  assert.equal(robot.joints.spin_joint.limit?.velocity, 20);

  const urdf = generateURDF({
    ...robot,
    selection: { type: null, id: null },
  });

  assert.match(urdf, /<limit effort="35\.278" velocity="20" \/>/);
  assert.doesNotMatch(urdf, /<limit[^>]*lower=/);
  assert.doesNotMatch(urdf, /<limit[^>]*upper=/);
});

test('parseURDF omits malformed joint metadata and preserves invalid geometry for import recovery', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="malformed_optional_numbers">
  <link name="base_link">
    <inertial>
      <mass value="not-a-number" />
      <inertia ixx="1" ixy="0" ixz="0" iyy="1" iyz="0" izz="1" />
    </inertial>
    <visual>
      <geometry><cylinder radius="infinity" length="0.5" /></geometry>
    </visual>
  </link>
  <link name="tip_link" />
  <joint name="bad_metadata_joint" type="revolute">
    <parent link="base_link" />
    <child link="tip_link" />
    <origin xyz="Infinity 2 broken" rpy="broken 0 0" />
    <limit lower="broken" upper="1" effort="Infinity" velocity="2" />
    <calibration rising="broken" falling="0.25" />
    <safety_controller soft_lower_limit="broken" soft_upper_limit="0.8" k_position="Infinity" k_velocity="4" />
    <hardware>
      <motorDirection>broken</motorDirection>
      <armature>Infinity</armature>
    </hardware>
  </joint>
</robot>`);

  assert.ok(robot);
  assert.equal(Number.isFinite(robot.links.base_link.inertial?.mass), false);
  assert.equal(Number.isFinite(robot.links.base_link.visual.dimensions.x), false);
  assert.deepEqual(
    { y: robot.links.base_link.visual.dimensions.y, z: robot.links.base_link.visual.dimensions.z },
    { y: 0.5, z: 0 },
  );
  assert.deepEqual(robot.joints.bad_metadata_joint.origin.xyz, { x: 0, y: 2, z: 0 });
  assert.deepEqual(robot.joints.bad_metadata_joint.origin.rpy, { r: 0, p: 0, y: 0 });
  assert.deepEqual(robot.joints.bad_metadata_joint.limit, { upper: 1, velocity: 2 });
  assert.deepEqual(robot.joints.bad_metadata_joint.calibration, { falling: 0.25 });
  assert.deepEqual(robot.joints.bad_metadata_joint.safetyController, {
    softUpperLimit: 0.8,
    kVelocity: 4,
  });
  assert.equal(robot.joints.bad_metadata_joint.hardware.motorDirection, 1);
  assert.equal(robot.joints.bad_metadata_joint.hardware.armature, 0);
});

test('parseURDF and generateURDF preserve joint calibration reference_position', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="joint_calibration_parse">
  <link name="base_link" />
  <link name="tip_link" />
  <joint name="hip_joint" type="revolute">
    <parent link="base_link" />
    <child link="tip_link" />
    <origin xyz="0 0 0" rpy="0 0 0" />
    <axis xyz="0 0 1" />
    <calibration reference_position="-0.35" />
    <limit lower="-1" upper="1" effort="5" velocity="2" />
  </joint>
</robot>`);

  assert.ok(robot);
  assert.equal(robot.joints.hip_joint.referencePosition, -0.35);

  const urdf = generateURDF({
    ...robot,
    selection: { type: null, id: null },
  });

  assert.match(urdf, /<calibration reference_position="-0\.35" \/>/);

  const reparsed = parseURDF(urdf);
  assert.ok(reparsed);
  assert.equal(reparsed.joints.hip_joint.referencePosition, -0.35);
});

test('parseURDF and generateURDF preserve joint calibration rising and falling metadata', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="joint_calibration_edges">
  <link name="base_link" />
  <link name="tip_link" />
  <joint name="hip_joint" type="revolute">
    <parent link="base_link" />
    <child link="tip_link" />
    <origin xyz="0 0 0" rpy="0 0 0" />
    <axis xyz="0 0 1" />
    <calibration reference_position="-0.35" rising="0.12" falling="-0.18" />
    <limit lower="-1" upper="1" effort="5" velocity="2" />
  </joint>
</robot>`);

  assert.ok(robot);
  assert.deepEqual(robot.joints.hip_joint.calibration, {
    referencePosition: -0.35,
    rising: 0.12,
    falling: -0.18,
  });

  const urdf = generateURDF({
    ...robot,
    selection: { type: null, id: null },
  });

  assert.match(
    urdf,
    /<calibration reference_position="-0\.35" rising="0\.12" falling="-0\.18" \/>/,
  );

  const reparsed = parseURDF(urdf);
  assert.ok(reparsed);
  assert.deepEqual(reparsed.joints.hip_joint.calibration, {
    referencePosition: -0.35,
    rising: 0.12,
    falling: -0.18,
  });
});

test('parseURDF and generateURDF preserve joint safety_controller metadata', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="joint_safety_controller_parse">
  <link name="base_link" />
  <link name="tip_link" />
  <joint name="hip_joint" type="revolute">
    <parent link="base_link" />
    <child link="tip_link" />
    <origin xyz="0 0 0" rpy="0 0 0" />
    <axis xyz="0 0 1" />
    <limit lower="-1" upper="1" effort="5" velocity="2" />
    <safety_controller soft_lower_limit="-0.8" soft_upper_limit="0.9" k_position="12" k_velocity="3.5" />
  </joint>
</robot>`);

  assert.ok(robot);
  assert.deepEqual(robot.joints.hip_joint.safetyController, {
    softLowerLimit: -0.8,
    softUpperLimit: 0.9,
    kPosition: 12,
    kVelocity: 3.5,
  });

  const urdf = generateURDF({
    ...robot,
    selection: { type: null, id: null },
  });

  assert.match(
    urdf,
    /<safety_controller soft_lower_limit="-0\.8" soft_upper_limit="0\.9" k_position="12" k_velocity="3\.5" \/>/,
  );

  const reparsed = parseURDF(urdf);
  assert.ok(reparsed);
  assert.deepEqual(reparsed.joints.hip_joint.safetyController, {
    softLowerLimit: -0.8,
    softUpperLimit: 0.9,
    kPosition: 12,
    kVelocity: 3.5,
  });
});

test('parseURDF and generateURDF preserve robot version and link type metadata', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="metadata_root" version="1.1">
  <link name="base_link" type="rigid" />
</robot>`);

  assert.ok(robot);
  assert.equal(robot.version, '1.1');
  assert.equal(robot.links.base_link.type, 'rigid');

  const urdf = generateURDF({
    ...robot,
    selection: { type: null, id: null },
  });

  assert.match(urdf, /<robot name="metadata_root" version="1\.1">/);
  assert.match(urdf, /<link name="base_link" type="rigid">\s*<\/link>/);

  const reparsed = parseURDF(urdf);
  assert.ok(reparsed);
  assert.equal(reparsed.version, '1.1');
  assert.equal(reparsed.links.base_link.type, 'rigid');
});

test('parseURDF and generateURDF preserve visual and collision metadata names', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="metadata_geometry">
  <link name="base_link">
    <visual name="base_visual">
      <geometry>
        <box size="1 2 3" />
      </geometry>
    </visual>
    <collision name="base_collision">
      <geometry>
        <box size="1 2 3" />
      </geometry>
      <verbose value="mesh-simplified" />
    </collision>
  </link>
</robot>`);

  assert.ok(robot);
  assert.equal(robot.links.base_link.visual.name, 'base_visual');
  assert.equal(robot.links.base_link.collision.name, 'base_collision');
  assert.equal(robot.links.base_link.collision.verbose, 'mesh-simplified');

  const urdf = generateURDF({
    ...robot,
    selection: { type: null, id: null },
  });

  assert.match(urdf, /<visual name="base_visual">/);
  assert.match(
    urdf,
    /<collision name="base_collision">[\s\S]*?<verbose value="mesh-simplified" \/>[\s\S]*?<\/collision>/,
  );

  const reparsed = parseURDF(urdf);
  assert.ok(reparsed);
  assert.equal(reparsed.links.base_link.visual.name, 'base_visual');
  assert.equal(reparsed.links.base_link.collision.name, 'base_collision');
  assert.equal(reparsed.links.base_link.collision.verbose, 'mesh-simplified');
});

test('parseURDF derives joint origin rpy from quat_xyzw and preserves quaternion metadata on roundtrip', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="joint_quat_origin">
  <link name="base_link" />
  <link name="tip_link" />
  <joint name="yaw_joint" type="fixed">
    <parent link="base_link" />
    <child link="tip_link" />
    <origin xyz="0 0 0" quat_xyzw="0 0 0.70710678 0.70710678" />
  </joint>
</robot>`);

  assert.ok(robot);
  assert.deepEqual(robot.joints.yaw_joint.origin.quatXyzw, {
    x: 0,
    y: 0,
    z: 0.70710678,
    w: 0.70710678,
  });
  assert.ok(Math.abs(robot.joints.yaw_joint.origin.rpy.r) < 1e-6);
  assert.ok(Math.abs(robot.joints.yaw_joint.origin.rpy.p) < 1e-6);
  assert.ok(Math.abs(robot.joints.yaw_joint.origin.rpy.y - Math.PI / 2) < 1e-6);

  const urdf = generateURDF({
    ...robot,
    selection: { type: null, id: null },
  });

  assert.match(urdf, /<origin xyz="0 0 0" rpy="[^"]+" quat_xyzw="0 0 0\.70710678 0\.70710678" \/>/);

  const reparsed = parseURDF(urdf);
  assert.ok(reparsed);
  assert.deepEqual(reparsed.joints.yaw_joint.origin.quatXyzw, {
    x: 0,
    y: 0,
    z: 0.70710678,
    w: 0.70710678,
  });
});

test('parseURDF derives link visual collision and inertial rpy from quat_xyzw', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="link_quat_origin">
  <link name="base_link">
    <inertial>
      <origin xyz="0 0 0" quat_xyzw="0.70710678 0 0 0.70710678" />
      <mass value="1" />
      <inertia ixx="1" ixy="0" ixz="0" iyy="1" iyz="0" izz="1" />
    </inertial>
    <visual>
      <origin xyz="0 0 0" quat_xyzw="0 0 0.70710678 0.70710678" />
      <geometry>
        <box size="1 1 1" />
      </geometry>
    </visual>
    <collision>
      <origin xyz="0 0 0" quat_xyzw="0 0.70710678 0 0.70710678" />
      <geometry>
        <box size="1 1 1" />
      </geometry>
    </collision>
  </link>
</robot>`);

  assert.ok(robot);
  assert.deepEqual(robot.links.base_link.inertial?.origin?.quatXyzw, {
    x: 0.70710678,
    y: 0,
    z: 0,
    w: 0.70710678,
  });
  assert.deepEqual(robot.links.base_link.visual.origin.quatXyzw, {
    x: 0,
    y: 0,
    z: 0.70710678,
    w: 0.70710678,
  });
  assert.deepEqual(robot.links.base_link.collision.origin.quatXyzw, {
    x: 0,
    y: 0.70710678,
    z: 0,
    w: 0.70710678,
  });
  assert.ok(Math.abs((robot.links.base_link.inertial?.origin?.rpy.r ?? 0) - Math.PI / 2) < 1e-6);
  assert.ok(Math.abs(robot.links.base_link.visual.origin.rpy.y - Math.PI / 2) < 1e-6);
  assert.ok(Math.abs(robot.links.base_link.collision.origin.rpy.p - Math.PI / 2) < 1e-6);
});

test('parseURDF preserves named material textures in robot materials state and export output', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="material_texture_parse">
  <material name="painted">
    <texture filename="textures/paint.png" />
  </material>
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="base.stl" />
      </geometry>
      <material name="painted" />
    </visual>
  </link>
</robot>`);

  assert.ok(robot);
  assert.equal(robot.materials?.base_link?.texture, 'textures/paint.png');

  const urdf = generateURDF({
    ...robot,
    selection: { type: null, id: null },
  });

  assert.match(
    urdf,
    /<texture filename="package:\/\/material_texture_parse\/textures\/paint\.png" \/>/,
  );
});

test('generateURDF does not fall back to the default visual blue when a texture-only material is present', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="material_texture_only_export">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="base.stl" />
      </geometry>
    </visual>
  </link>
</robot>`);

  assert.ok(robot);

  const urdf = generateURDF({
    ...robot,
    materials: {
      base_link: {
        texture: 'textures/paint.png',
      },
    },
    selection: { type: null, id: null },
  });

  assert.match(
    urdf,
    /<texture filename="package:\/\/material_texture_only_export\/textures\/paint\.png" \/>/,
  );
  assert.doesNotMatch(urdf, /<color rgba="0\.23137647 0\.50980784 0\.96470980 1\.00000000"\/>/);
});

test('generateURDF exports per-visual texture overrides without leaking the link fallback to secondary visuals', () => {
  const urdf = generateURDF({
    name: 'per_visual_texture_export',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#123456',
          authoredMaterials: [{ texture: 'textures/primary.png' }],
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        visualBodies: [
          {
            type: GeometryType.BOX,
            dimensions: { x: 0.5, y: 0.5, z: 0.5 },
            color: '#abcdef',
            authoredMaterials: [{ texture: 'textures/secondary.png' }],
            origin: { xyz: { x: 1, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
        ],
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
      },
    },
    joints: {},
    materials: {
      base_link: {
        texture: 'textures/legacy.png',
      },
    },
  });

  assert.match(
    urdf,
    /<texture filename="package:\/\/per_visual_texture_export\/textures\/primary\.png" \/>/,
  );
  assert.match(
    urdf,
    /<texture filename="package:\/\/per_visual_texture_export\/textures\/secondary\.png" \/>/,
  );
  assert.doesNotMatch(urdf, /legacy\.png/);
});

test('generateURDF keeps go2 Collada exports package-relative while preserving authored mesh materials', () => {
  const source = fs.readFileSync(
    'test/unitree_ros/robots/go2_description/urdf/go2_description.urdf',
    'utf8',
  );
  const robot = parseURDF(source);

  assert.ok(robot);
  assert.equal(robot.materials?.base, undefined);
  assert.equal(robot.links.base.visual.authoredMaterials?.length, 5);

  const urdf = generateURDF({
    ...robot,
    selection: { type: null, id: null },
  });

  assert.match(urdf, /<mesh filename="package:\/\/go2_description\/meshes\/dae\/base\.dae" \/>/);
  assert.doesNotMatch(urdf, /package:\/\/go2_description\/meshes\/go2_description\/dae\/base\.dae/);

  const baseVisual = urdf.match(/<link name="base">[\s\S]*?<visual>([\s\S]*?)<\/visual>/);
  assert.ok(baseVisual);
  assert.equal((baseVisual[1].match(/<material\b/g) || []).length, 5);
});

test('parseURDF and generateURDF preserve go2w multi-material mesh palettes for base and thigh links', () => {
  const source = fs.readFileSync(
    'test/unitree_ros/robots/go2w_description/urdf/go2w_description.urdf',
    'utf8',
  );
  const robot = parseURDF(source);

  assert.ok(robot);
  assert.equal(robot.links.base.visual.authoredMaterials?.length, 5);
  assert.equal(robot.links.FR_thigh.visual.authoredMaterials?.length, 2);
  assert.equal(
    robot.links.FR_thigh.visual.meshPath,
    'package://go2w_description/dae/thigh_mirror.dae',
  );
  assert.equal(robot.links.FL_thigh.visual.meshPath, 'package://go2w_description/dae/thigh.dae');
  assert.equal(robot.joints.FR_thigh_joint.origin?.xyz.y, -0.0955);
  assert.equal(robot.joints.FL_thigh_joint.origin?.xyz.y, 0.0955);

  const exported = generateURDF({
    ...robot,
    selection: { type: null, id: null },
  });

  const baseVisual = exported.match(/<link name="base">[\s\S]*?<visual>([\s\S]*?)<\/visual>/);
  assert.ok(baseVisual);
  assert.equal((baseVisual[1].match(/<material\b/g) || []).length, 5);

  const frontRightThighVisual = exported.match(
    /<link name="FR_thigh">[\s\S]*?<visual>([\s\S]*?)<\/visual>/,
  );
  assert.ok(frontRightThighVisual);
  assert.equal((frontRightThighVisual[1].match(/<material\b/g) || []).length, 2);
  assert.match(
    frontRightThighVisual[1],
    /<mesh filename="package:\/\/go2w_description\/meshes\/dae\/thigh_mirror\.dae" \/>/,
  );
  assert.match(
    exported,
    /<joint name="FR_thigh_joint"[\s\S]*?<origin xyz="0 -0\.0955 0" rpy="0 0 0" \/>/,
  );

  const reparsed = parseURDF(exported);
  assert.ok(reparsed);
  assert.equal(reparsed.links.base.visual.authoredMaterials?.length, 5);
  assert.equal(reparsed.links.FR_thigh.visual.authoredMaterials?.length, 2);
  assert.equal(
    reparsed.links.FR_thigh.visual.meshPath,
    'package://go2w_description/meshes/dae/thigh_mirror.dae',
  );
  assert.equal(reparsed.joints.FR_thigh_joint.origin?.xyz.y, -0.0955);
});

test('parseURDF does not infer materials for visuals that omit authored material tags', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="missing_materials_stay_missing">
  <material name="black">
    <color rgba="0 0 0 1" />
  </material>
  <link name="front_thigh">
    <visual>
      <geometry>
        <mesh filename="thigh.dae" />
      </geometry>
      <material name="black" />
    </visual>
  </link>
  <link name="rear_thigh">
    <visual>
      <geometry>
        <mesh filename="thigh.dae" />
      </geometry>
    </visual>
  </link>
</robot>`);

  assert.ok(robot);
  assert.equal(robot.links.front_thigh.visual.color, '#000000');
  assert.equal(robot.links.front_thigh.visual.materialSource, 'named');
  assert.equal(robot.materials?.front_thigh?.color, '#000000');

  assert.equal(robot.links.rear_thigh.visual.color, undefined);
  assert.equal(robot.links.rear_thigh.visual.materialSource, undefined);
  assert.equal(robot.materials?.rear_thigh, undefined);
});

test('parseURDF preserves mimic joint metadata through export', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="mimic_parse">
  <link name="base_link" />
  <link name="master_link" />
  <link name="slave_link" />
  <joint name="master_joint" type="revolute">
    <parent link="base_link" />
    <child link="master_link" />
    <limit lower="-1" upper="1" effort="5" velocity="2" />
  </joint>
  <joint name="slave_joint" type="revolute">
    <parent link="master_link" />
    <child link="slave_link" />
    <mimic joint="master_joint" multiplier="1.5" offset="0.25" />
    <limit lower="-1" upper="1" effort="5" velocity="2" />
  </joint>
</robot>`);

  assert.ok(robot);
  assert.deepEqual(robot.joints.slave_joint.mimic, {
    joint: 'master_joint',
    multiplier: 1.5,
    offset: 0.25,
  });

  const urdf = generateURDF({
    ...robot,
    selection: { type: null, id: null },
  });

  assert.match(urdf, /<mimic joint="master_joint" multiplier="1\.5" offset="0\.25" \/>/);
});

test('generateURDF only writes hardware brand in extended exports and parseURDF restores it', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="hardware_brand">
  <link name="base_link" />
  <link name="tip_link" />
  <joint name="hip_joint" type="revolute">
    <parent link="base_link" />
    <child link="tip_link" />
    <origin xyz="0 0 0" rpy="0 0 0" />
    <axis xyz="0 0 1" />
    <limit lower="-1" upper="1" effort="10" velocity="5" />
  </joint>
</robot>`);

  assert.ok(robot);

  robot.joints.hip_joint.hardware = {
    armature: 0.000111842,
    brand: 'Unitree',
    motorType: 'Go1-M8010-6',
    motorId: 'hip-0',
    motorDirection: 1,
    hardwareInterface: 'position',
  };

  const standardUrdf = generateURDF({
    ...robot,
    selection: { type: null, id: null },
  });
  assert.doesNotMatch(standardUrdf, /<hardware>[\s\S]*?<brand>Unitree<\/brand>/);

  const extendedUrdf = generateURDF(
    {
      ...robot,
      selection: { type: null, id: null },
    },
    { extended: true },
  );

  assert.match(extendedUrdf, /<hardware>[\s\S]*?<brand>Unitree<\/brand>/);
  assert.match(extendedUrdf, /<hardware>[\s\S]*?<hardwareInterface>position<\/hardwareInterface>/);

  const reparsed = parseURDF(extendedUrdf);
  assert.ok(reparsed);
  assert.equal(reparsed.joints.hip_joint.hardware.brand, 'Unitree');
  assert.equal(reparsed.joints.hip_joint.hardware.motorType, 'Go1-M8010-6');
  assert.equal(reparsed.joints.hip_joint.hardware.hardwareInterface, 'position');
});

test('parseURDF rejects robot documents without any links', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="empty_robot">
  <joint name="orphan" type="fixed">
    <parent link="world" />
    <child link="ghost" />
  </joint>
</robot>`);

  assert.equal(robot, null);
});

test('parseURDF keeps named URDF material colors ahead of gazebo overrides', () => {
  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="gazebo_material_priority">
  <material name="base_paint">
    <color rgba="0.2 0.4 0.6 1" />
  </material>
  <link name="base_link">
    <visual>
      <geometry>
        <box size="1 1 1" />
      </geometry>
      <material name="base_paint" />
    </visual>
  </link>
  <gazebo reference="base_link">
    <material>Gazebo/Red</material>
  </gazebo>
</robot>`);

  assert.ok(robot);
  assert.equal(robot.links.base_link.visual.color, '#336699');
  assert.equal(robot.links.base_link.visual.materialSource, 'named');
  assert.equal(robot.materials?.base_link?.color, '#336699');
});
