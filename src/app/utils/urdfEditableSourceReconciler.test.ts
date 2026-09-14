import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { parseURDF } from '@/core/parsers';
import { GeometryType, JointType, type RobotData, type RobotState } from '@/types';
import {
  reconcileUrdfEditableSource,
  type ReconcileUrdfEditableSourceResult,
} from './urdfEditableSourceReconciler.ts';

const { window } = new JSDOM();
globalThis.DOMParser = window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = window.XMLSerializer as typeof XMLSerializer;

const SOURCE = `<?xml version="1.0"?>
<robot xmlns:vendor="https://example.test/vendor" name="demo" version="1.1">
  <!-- keep authored header -->
  <material name="legacy">
    <color rgba="1 0 0 1" />
  </material>
  <material name="declaration_only">
    <!-- parser-unmodeled vendor material declaration -->
  </material>
  <link name="base_link">
    <visual>
      <geometry><box size="1 2 3" /></geometry>
      <material name="inline"><color rgba="0 1 0 1" /></material>
    </visual>
    <collision>
      <geometry><box size="1 2 3" /></geometry>
    </collision>
    <inertial>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <mass value="1" />
      <inertia ixx="1" ixy="0" ixz="0" iyy="1" iyz="0" izz="1" />
    </inertial>
    <vendor:link-note importance="high" />
  </link>
  <link name="old_tip" />
  <joint name="old_joint" type="revolute">
    <parent link="base_link" />
    <child link="old_tip" />
    <axis xyz="0 0 1" />
    <limit lower="-1" upper="1" effort="2" velocity="3" acceleration="9" />
    <vendor:joint-note>keep inside fine patch</vendor:joint-note>
  </joint>
  <transmission name="authored_transmission">
    <type>vendor/CustomTransmission</type>
    <joint name="old_joint" />
  </transmission>
  <ros2_control name="AuthoredSystem" type="system">
    <hardware><plugin>vendor/Hardware</plugin></hardware>
    <joint name="old_joint">
      <command_interface name="position" />
    </joint>
  </ros2_control>
  <gazebo reference="old_tip">
    <sensor name="tip_sensor" type="contact" />
  </gazebo>
  <gazebo reference="old_joint">
    <provideFeedback>true</provideFeedback>
  </gazebo>
  <gazebo>
    <plugin name="authored_plugin" filename="libauthored.so" />
  </gazebo>
  <vendor:metadata key="retain-me" />
</robot>
`;

function parseRobot(source = SOURCE): RobotState {
  const parsed = parseURDF(source);
  assert.ok(parsed, 'expected URDF fixture to parse');
  return parsed;
}

function requirePatched(result: ReconcileUrdfEditableSourceResult): string {
  assert.equal(result.status, 'patched', result.status === 'unsafe' ? result.reason : undefined);
  return result.content;
}

test('URDF reconciliation keeps ball edits canonical without exposing export errors', () => {
  const beforeRobot = parseRobot();
  const afterRobot = structuredClone(beforeRobot);
  afterRobot.joints.old_joint.type = JointType.BALL;
  const snapshot = structuredClone(afterRobot);
  const result = reconcileUrdfEditableSource({
    sourceContent: SOURCE, beforeRobot, afterRobot, sourceFileName: 'robots/demo.urdf',
  });
  assert.equal(result.status, 'unsafe');
  assert.doesNotMatch(result.reason, /\[URDF export\]/);
  assert.deepEqual(afterRobot, snapshot);
});

test('reconcileUrdfEditableSource uses fine patches and retains authored XML extensions', () => {
  const beforeRobot = parseRobot();
  const afterRobot = structuredClone(beforeRobot);
  afterRobot.name = 'demo_renamed';
  afterRobot.joints.old_joint.limit = {
    ...afterRobot.joints.old_joint.limit,
    upper: 2.5,
  };
  afterRobot.links.base_link.inertial = {
    ...afterRobot.links.base_link.inertial!,
    mass: 4.25,
  };

  const content = requirePatched(reconcileUrdfEditableSource({
    sourceContent: SOURCE,
    beforeRobot,
    afterRobot,
    sourceFileName: 'robots/demo.urdf',
  }));

  assert.match(content, /<robot xmlns:vendor="https:\/\/example\.test\/vendor" name="demo_renamed" version="1\.1">/);
  assert.match(content, /<mass value="4\.25" \/>/);
  assert.match(
    content,
    /<limit lower="-1" upper="2\.5" effort="2" velocity="3" acceleration="9" \/>/,
  );
  assert.match(content, /<vendor:link-note importance="high" \/>/);
  assert.match(content, /<vendor:joint-note>keep inside fine patch<\/vendor:joint-note>/);
  assert.match(
    content,
    /<material name="declaration_only">\s*<!-- parser-unmodeled vendor material declaration -->\s*<\/material>/,
  );
  assert.match(content, /<transmission name="authored_transmission">/);
  assert.match(content, /<ros2_control name="AuthoredSystem" type="system">/);
  assert.match(content, /<plugin name="authored_plugin" filename="libauthored\.so" \/>/);
  assert.match(content, /<vendor:metadata key="retain-me" \/>/);
});

test('reconcileUrdfEditableSource replaces only affected link, joint, and material fragments', () => {
  const beforeRobot = parseRobot();
  const afterRobot = structuredClone(beforeRobot);
  afterRobot.links.base_link.visual.dimensions = { x: 4, y: 5, z: 6 };
  afterRobot.links.base_link.visual.color = '#0000ff';
  afterRobot.links.base_link.visual.authoredMaterials = [
    { name: 'inline', color: '#0000ff', colorRgba: [0, 0, 1, 1] },
  ];
  afterRobot.links.base_link.collision.dimensions = { x: 0.5, y: 0.6, z: 0.7 };
  delete afterRobot.links.old_tip;
  delete afterRobot.joints.old_joint;
  afterRobot.links.new_tip = {
    ...structuredClone(beforeRobot.links.old_tip),
    id: 'new_tip',
    name: 'new_tip',
  };
  afterRobot.joints.new_joint = {
    ...structuredClone(beforeRobot.joints.old_joint),
    id: 'new_joint',
    name: 'new_joint',
    childLinkId: 'new_tip',
  };
  afterRobot.materials = {
    base_link: { color: '#0000ff', colorRgba: [0, 0, 1, 1] },
  };

  const content = requirePatched(reconcileUrdfEditableSource({
    sourceContent: SOURCE,
    beforeRobot,
    afterRobot,
    sourceFileName: 'robots/demo.xml',
  }));

  assert.match(content, /<box size="4 5 6" \/>/);
  assert.match(content, /<box size="0\.5 0\.6 0\.7" \/>/);
  assert.match(content, /<vendor:link-note importance="high" \/>/);
  assert.doesNotMatch(content, /<link name="old_tip"/);
  assert.doesNotMatch(content, /<joint name="old_joint" type=/);
  assert.match(content, /<link name="new_tip">/);
  assert.match(content, /<joint name="new_joint" type="revolute">/);
  assert.match(content, /<material name="legacy">/);
  assert.match(
    content,
    /<material name="inline">\s*<color rgba="0 0 1 1"\/>/,
  );

  // Standard extensions with deleted entity references are cleaned up, while
  // unrelated authored extensions remain untouched.
  assert.doesNotMatch(content, /<transmission name="authored_transmission">/);
  assert.match(content, /<ros2_control name="AuthoredSystem" type="system">/);
  assert.doesNotMatch(content, /<ros2_control[\s\S]*?<joint name="old_joint">/);
  assert.doesNotMatch(content, /<gazebo reference="old_tip">/);
  assert.doesNotMatch(content, /<gazebo reference="old_joint">/);
  assert.match(content, /<plugin name="authored_plugin" filename="libauthored\.so" \/>/);
  assert.match(content, /<vendor:metadata key="retain-me" \/>/);

  const parsed = parseRobot(content);
  assert.equal(parsed.links.base_link.visual.dimensions.x, 4);
  assert.ok(parsed.links.new_tip);
  assert.ok(parsed.joints.new_joint);
  assert.deepEqual(parsed.materials?.base_link?.colorRgba, [0, 0, 1, 1]);
});

test('reconcileUrdfEditableSource renames stable entities and their standard references in place', () => {
  const renameSource = SOURCE.replace(
    '  <transmission name="authored_transmission">',
    `  <link name="follower_tip" />
  <joint name="follower_joint" type="revolute">
    <parent link="base_link" />
    <child link="follower_tip" />
    <mimic joint="old_joint" multiplier="1" />
  </joint>
  <transmission name="authored_transmission">`,
  );
  const beforeRobot = parseRobot(renameSource);
  const afterRobot = structuredClone(beforeRobot);
  afterRobot.links.old_tip.name = 'renamed_tip';
  afterRobot.joints.old_joint.name = 'renamed_joint';

  const content = requirePatched(reconcileUrdfEditableSource({
    sourceContent: renameSource,
    beforeRobot,
    afterRobot,
    sourceFileName: 'robots/demo.xml',
  }));

  assert.match(content, /<link name="renamed_tip" \/>/);
  assert.match(content, /<joint name="renamed_joint" type="revolute">/);
  assert.match(content, /<child link="renamed_tip" \/>/);
  assert.match(content, /<mimic joint="renamed_joint" multiplier="1" \/>/);
  assert.match(content, /<transmission name="authored_transmission">[\s\S]*?<joint name="renamed_joint" \/>/);
  assert.match(content, /<ros2_control name="AuthoredSystem"[\s\S]*?<joint name="renamed_joint">/);
  assert.match(content, /<gazebo reference="renamed_tip">/);
  assert.match(content, /<gazebo reference="renamed_joint">/);
  assert.match(content, /<vendor:joint-note>keep inside fine patch<\/vendor:joint-note>/);
  assert.doesNotMatch(content, /(?:name|link|joint|reference)="old_(?:tip|joint)"/);
});

test('reconcileUrdfEditableSource accepts concrete URDF stored with an XML filename', () => {
  const beforeRobot = parseRobot();
  const afterRobot = { ...beforeRobot, name: 'xml_robot', version: '1.2' };

  const content = requirePatched(reconcileUrdfEditableSource({
    sourceContent: SOURCE,
    beforeRobot,
    afterRobot,
    sourceFileName: 'robots/model.xml',
  }));

  assert.match(content, /<robot [^>]*name="xml_robot" version="1\.2"/);
});

test('reconcileUrdfEditableSource keeps a source-owned root version omitted by the workspace', () => {
  const sourceWithNamedMaterial = SOURCE.replace(
    '<material name="inline"><color rgba="0 1 0 1" /></material>',
    '<material name="legacy" />',
  );
  const parsedSource = parseRobot(sourceWithNamedMaterial);
  const { version: _sourceVersion, ...beforeWithoutVersion } = parsedSource;
  const beforeRobot = beforeWithoutVersion as RobotData;
  const afterRobot = structuredClone(beforeRobot);
  afterRobot.joints.old_joint.origin = {
    ...afterRobot.joints.old_joint.origin,
    xyz: { x: 0, y: 0, z: 0.5 },
  };
  afterRobot.joints.old_joint.hardware = {
    ...afterRobot.joints.old_joint.hardware,
    motorId: 'motor-9',
  };

  const content = requirePatched(reconcileUrdfEditableSource({
    sourceContent: sourceWithNamedMaterial,
    beforeRobot,
    afterRobot,
    sourceFileName: 'robots/imported.urdf',
  }));

  assert.match(content, /<robot xmlns:vendor="https:\/\/example\.test\/vendor" name="demo" version="1\.1">/);
  assert.match(content, /<origin xyz="0 0 0\.5" rpy="0 0 0"\s*\/>/);
  assert.match(content, /<motorId>motor-9<\/motorId>/);
  assert.match(content, /<material name="legacy" \/>/);
  assert.match(content, /acceleration="9"/);
  assert.match(content, /<vendor:joint-note>keep inside fine patch<\/vendor:joint-note>/);
  assert.match(content, /<vendor:metadata key="retain-me" \/>/);
});

test('reconcileUrdfEditableSource serializes authored joint hardware in auto mode', () => {
  const beforeRobot = parseRobot();
  const afterRobot = structuredClone(beforeRobot);
  afterRobot.joints.old_joint.hardware = {
    ...afterRobot.joints.old_joint.hardware,
    brand: 'Acme Robotics',
    motorType: 'Servo-X',
    motorId: 'motor-42',
    armature: 0.25,
    hardwareInterface: 'position',
  };

  const content = requirePatched(reconcileUrdfEditableSource({
    sourceContent: SOURCE,
    beforeRobot,
    afterRobot,
    sourceFileName: 'robots/demo.xml',
  }));

  assert.match(content, /<hardware>\s*<brand>Acme Robotics<\/brand>/);
  assert.match(content, /<motorType>Servo-X<\/motorType>/);
  assert.match(content, /<hardwareInterface>position<\/hardwareInterface>/);
  assert.match(content, /<transmission name="authored_transmission">/);
});

test('reconcileUrdfEditableSource rejects stale and invalid sources', () => {
  const beforeRobot = parseRobot();
  const staleBefore: RobotData = { ...beforeRobot, name: 'not_the_source_robot' };

  const stale = reconcileUrdfEditableSource({
    sourceContent: SOURCE,
    beforeRobot: staleBefore,
    afterRobot: beforeRobot,
    sourceFileName: 'robots/demo.urdf',
  });
  assert.equal(stale.status, 'unsafe');

  const invalid = reconcileUrdfEditableSource({
    sourceContent: '<robot name="broken"><link name="base"></robot>',
    beforeRobot,
    afterRobot: beforeRobot,
    sourceFileName: 'robots/broken.xml',
  });
  assert.equal(invalid.status, 'unsafe');
});

test('successive joint XYZ and degree-derived RPY edits preserve exact values and authored XML', () => {
  let content = SOURCE;
  let beforeRobot = parseRobot();
  const origins = [
    { xyz: { x: 0.1234567890123456, y: -0.9876543210987654, z: 1e-9 }, rpy: { r: 0, p: 0, y: 0 } },
    { xyz: { x: 0.1234567890123456, y: -0.9876543210987654, z: 1e-9 }, rpy: { r: Math.PI / 6, p: Math.PI / 2, y: -Math.PI / 4 } },
    { xyz: { x: 0.5, y: 0.2, z: 0.3 }, rpy: { r: Math.PI / 2, p: Math.PI / 6, y: Math.PI / 3 } },
  ];

  for (const origin of origins) {
    const afterRobot = structuredClone(beforeRobot);
    afterRobot.joints.old_joint.origin = origin;
    content = requirePatched(reconcileUrdfEditableSource({
      sourceContent: content, beforeRobot, afterRobot, sourceFileName: 'demo.urdf',
    }));
    assert.deepEqual(parseRobot(content).joints.old_joint.origin, origin);
    assert.match(content, /<!-- keep authored header -->/);
    assert.match(content, /<vendor:joint-note>keep inside fine patch<\/vendor:joint-note>/);
    assert.match(content, /<transmission name="authored_transmission">/);
    // Keep the unrounded workspace model for the next edit, as the UI does.
    beforeRobot = afterRobot;
  }
});

test('joint edits retain unrelated high-precision geometry, mass, and material source verbatim', () => {
  const source = SOURCE
    .replace('size="1 2 3"', 'size="0.1234567890123456 2 3"')
    .replace('mass value="1"', 'mass value="3.141592653589793"')
    .replace('rgba="0 1 0 1"', 'rgba="0.1234567890123456 1 0 0.9876543210987654"');
  const beforeRobot = parseRobot(source);
  const afterRobot = structuredClone(beforeRobot);
  afterRobot.joints.old_joint.origin.rpy.r = Math.PI / 6;

  const content = requirePatched(reconcileUrdfEditableSource({
    sourceContent: source, beforeRobot, afterRobot, sourceFileName: 'demo.urdf',
  }));
  assert.equal(
    content.match(/<link name="base_link">[\s\S]*?<\/link>/)?.[0],
    source.match(/<link name="base_link">[\s\S]*?<\/link>/)?.[0],
  );
  assert.equal(parseRobot(content).joints.old_joint.origin.rpy.r, Math.PI / 6);
});

test('high-precision limit and inertial patches retain vendor children and comments', () => {
  const source = SOURCE.replace('<inertial>', '<inertial>\n      <!-- retain inertia note -->');
  const beforeRobot = parseRobot(source);
  const afterRobot = structuredClone(beforeRobot);
  afterRobot.joints.old_joint.limit!.upper = Math.PI / 2;
  const inertial = afterRobot.links.base_link.inertial;
  assert.ok(inertial?.origin);
  inertial.mass = 1.2345678901234567;
  inertial.origin.rpy.r = Math.PI / 6;

  const content = requirePatched(reconcileUrdfEditableSource({
    sourceContent: source, beforeRobot, afterRobot, sourceFileName: 'demo.urdf',
  }));
  const parsed = parseRobot(content);
  assert.equal(parsed.joints.old_joint.limit!.upper, Math.PI / 2);
  assert.deepEqual(parsed.links.base_link.inertial, afterRobot.links.base_link.inertial);
  assert.match(content, /<!-- retain inertia note -->/);
  assert.match(content, /acceleration="9"/);
  assert.match(content, /<vendor:joint-note>keep inside fine patch<\/vendor:joint-note>/);
});

test('sub-rounding numeric differences still reject a stale source', () => {
  const beforeRobot = parseRobot();
  beforeRobot.joints.old_joint.origin.xyz.x = 1e-9;
  const result = reconcileUrdfEditableSource({
    sourceContent: SOURCE, beforeRobot, afterRobot: beforeRobot, sourceFileName: 'demo.urdf',
  });
  assert.equal(result.status, 'unsafe');
  assert.match(result.reason, /no longer matches/);
});

test('reconcileUrdfEditableSource rejects Xacro and lossy URDF generation', () => {
  const beforeRobot = parseRobot();
  const xacro = reconcileUrdfEditableSource({
    sourceContent: SOURCE.replace(
      '<!-- keep authored header -->',
      '<xacro:property name="scale" value="1" />',
    ),
    beforeRobot,
    afterRobot: beforeRobot,
    sourceFileName: 'robots/demo.urdf.xacro',
  });
  assert.equal(xacro.status, 'unsafe');

  const lossyRobot = structuredClone(beforeRobot);
  lossyRobot.links.base_link.visual.type = GeometryType.PLANE;
  lossyRobot.links.base_link.visual.dimensions = { x: 2, y: 3, z: 0 };
  const lossy = reconcileUrdfEditableSource({
    sourceContent: SOURCE,
    beforeRobot,
    afterRobot: lossyRobot,
    sourceFileName: 'robots/demo.urdf',
  });
  assert.equal(lossy.status, 'unsafe');
  assert.match(lossy.reason, /lossless/i);
});
