import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { createStableJsonSnapshot } from '@/core/robot';
import {
  GeometryType,
  JointType,
  type RobotData,
  type RobotState,
} from '@/types';
import { parseEditableRobotSource } from './parseEditableRobotSource.ts';
import {
  reconcileXacroEditableSource,
  type ReconcileXacroEditableSourceResult,
} from './xacroEditableSourceReconciler.ts';

const { window } = new JSDOM();
globalThis.DOMParser = window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = window.XMLSerializer as typeof XMLSerializer;

const SOURCE_FILE = 'robots/demo/robot.urdf.xacro';
const INCLUDE_FILE = 'robots/demo/parts/common.xacro';
const INCLUDE_CONTENT = `<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="included">
  <link name="included_link" />
</robot>`;
const ALL_FILE_CONTENTS = {
  [INCLUDE_FILE]: INCLUDE_CONTENT,
};

const SOURCE = `<?xml version="1.0"?>
<robot xmlns:xacro="http://www.ros.org/wiki/xacro" xmlns:vendor="https://example.test/vendor" name="demo">
  <xacro:arg name="prefix" default="demo" />
  <xacro:property name="unused_scale" value="1.0" />
  <xacro:include filename="parts/common.xacro" />
  <xacro:macro name="unused_macro" params="name">
    <link name="\${name}_macro" />
  </xacro:macro>
  <link name="base_link">
    <visual name="body">
      <geometry><box size="1 2 3" /></geometry>
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
  <link name="tip_link" />
  <joint name="hinge" type="revolute">
    <parent link="base_link" />
    <child link="tip_link" />
    <axis xyz="0 0 1" />
    <limit lower="-1" upper="1" effort="2" velocity="3" />
    <vendor:joint-note>keep me</vendor:joint-note>
  </joint>
  <gazebo reference="hinge">
    <provideFeedback>true</provideFeedback>
  </gazebo>
  <vendor:metadata key="retain-me" />
</robot>`;

function parseXacro(source = SOURCE): RobotState {
  const parsed = parseEditableRobotSource({
    file: { name: SOURCE_FILE, format: 'xacro' },
    content: source,
    allFileContents: ALL_FILE_CONTENTS,
  });
  assert.ok(parsed, 'expected xacro fixture to parse');
  return parsed;
}

function requirePatched(result: ReconcileXacroEditableSourceResult): string {
  assert.equal(result.status, 'patched', result.status === 'unsafe' ? result.reason : undefined);
  return result.content;
}

function reconcile(
  beforeRobot: RobotData,
  afterRobot: RobotData,
  sourceContent = SOURCE,
): ReconcileXacroEditableSourceResult {
  return reconcileXacroEditableSource({
    sourceContent,
    beforeRobot,
    afterRobot,
    sourceFileName: SOURCE_FILE,
    allFileContents: ALL_FILE_CONTENTS,
  });
}

function assertXacroControlsPreserved(content: string): void {
  assert.match(content, /<xacro:arg name="prefix" default="demo" \/>/);
  assert.match(content, /<xacro:property name="unused_scale" value="1\.0" \/>/);
  assert.match(content, /<xacro:include filename="parts\/common\.xacro" \/>/);
  assert.match(content, /<xacro:macro name="unused_macro" params="name">/);
  assert.match(content, /<vendor:metadata key="retain-me" \/>/);
}

test('attribute stage patches the root robot name without touching xacro controls', () => {
  const beforeRobot = parseXacro();
  const afterRobot = { ...beforeRobot, name: 'renamed_demo' };

  const content = requirePatched(reconcile(beforeRobot, afterRobot));

  assert.match(content, /<robot [^>]*name="renamed_demo">/);
  assertXacroControlsPreserved(content);
  assert.equal(parseXacro(content).name, 'renamed_demo');
});

test('node stage patches direct URDF children while retaining comments and unknown XML', () => {
  const beforeRobot = parseXacro();
  const afterRobot = structuredClone(beforeRobot);
  afterRobot.joints.hinge.limit = {
    ...afterRobot.joints.hinge.limit,
    upper: 2.5,
  };
  afterRobot.links.base_link.inertial = {
    ...afterRobot.links.base_link.inertial!,
    mass: 4.25,
  };

  const content = requirePatched(reconcile(beforeRobot, afterRobot));

  assert.match(content, /<limit lower="-1" upper="2\.5" effort="2" velocity="3" \/>/);
  assert.match(content, /<mass value="4\.25" \/>/);
  assert.match(content, /<vendor:joint-note>keep me<\/vendor:joint-note>/);
  assert.match(content, /<vendor:link-note importance="high" \/>/);
  assertXacroControlsPreserved(content);
});

test('link and joint entity stage inserts concrete direct URDF entities only', () => {
  const beforeRobot = parseXacro();
  const afterRobot = structuredClone(beforeRobot);
  afterRobot.links.gripper = {
    ...structuredClone(beforeRobot.links.tip_link),
    id: 'gripper',
    name: 'gripper',
  };
  afterRobot.joints.gripper_joint = {
    ...structuredClone(beforeRobot.joints.hinge),
    id: 'gripper_joint',
    name: 'gripper_joint',
    type: JointType.FIXED,
    parentLinkId: 'tip_link',
    childLinkId: 'gripper',
    axis: undefined,
    limit: undefined,
    hardware: {
      armature: 0,
      brand: '',
      motorType: 'None',
      motorId: '',
      motorDirection: 1,
    },
  };

  const content = requirePatched(reconcile(beforeRobot, afterRobot));

  assert.match(content, /<link name="gripper">/);
  assert.match(content, /<joint name="gripper_joint" type="fixed">/);
  assert.doesNotMatch(content, /<link name="included_link"/);
  assert.match(content, /<xacro:include filename="parts\/common\.xacro" \/>/);
  assert.ok(parseXacro(content).links.gripper);
  assert.ok(parseXacro(content).joints.gripper_joint);
});

test('section stage removes only URDF-owned extension sections for deleted direct entities', () => {
  const sourceWithSections = SOURCE.replace(
    '  <gazebo reference="hinge">',
    `  <transmission name="hinge_trans">
    <type>transmission_interface/SimpleTransmission</type>
    <joint name="hinge" />
  </transmission>
  <ros2_control name="DemoSystem" type="system">
    <hardware><plugin>demo/Hardware</plugin></hardware>
    <joint name="hinge">
      <command_interface name="position" />
    </joint>
  </ros2_control>
  <gazebo reference="hinge">`,
  );
  const beforeRobot = parseXacro(sourceWithSections);
  const afterRobot = structuredClone(beforeRobot);
  delete afterRobot.joints.hinge;
  afterRobot.rootLinkId = 'included_link';

  const content = requirePatched(reconcile(beforeRobot, afterRobot, sourceWithSections));

  assert.doesNotMatch(content, /<joint name="hinge" type=/);
  assert.doesNotMatch(content, /<transmission name="hinge_trans">/);
  assert.doesNotMatch(content, /<ros2_control[\s\S]*?<joint name="hinge">/);
  assert.doesNotMatch(content, /<gazebo reference="hinge">/);
  assertXacroControlsPreserved(content);
});

test('standard reference patching updates concrete gazebo joint references on rename', () => {
  const beforeRobot = parseXacro();
  const afterRobot = structuredClone(beforeRobot);
  afterRobot.joints.hinge.name = 'renamed_hinge';

  const content = requirePatched(reconcile(beforeRobot, afterRobot));

  assert.match(content, /<joint name="renamed_hinge" type="revolute">/);
  assert.match(content, /<gazebo reference="renamed_hinge">/);
  assert.doesNotMatch(content, /(?:name|reference)="hinge"/);
});

test('macro-generated or expression-owned changed entities are unsafe', () => {
  const macroSource = `<?xml version="1.0"?>
<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="macro_demo">
  <xacro:macro name="make_link" params="name">
    <link name="\${name}" />
  </xacro:macro>
  <xacro:make_link name="base_link" />
</robot>`;
  const macroBefore = parseXacro(macroSource);
  const macroAfter = structuredClone(macroBefore);
  macroAfter.links.base_link.visual = {
    ...macroAfter.links.base_link.visual,
    type: GeometryType.BOX,
    dimensions: { x: 0.3, y: 0.3, z: 0.3 },
  };

  const macroResult = reconcile(macroBefore, macroAfter, macroSource);
  assert.equal(macroResult.status, 'unsafe');
  assert.match(macroResult.reason, /generated by Xacro/i);

  const expressionSource = SOURCE.replace(
    '<geometry><box size="1 2 3" /></geometry>',
    '<geometry><box size="${unused_scale} ${unused_scale} ${unused_scale}" /></geometry>',
  );
  const expressionBefore = parseXacro(expressionSource);
  const expressionAfter = structuredClone(expressionBefore);
  expressionAfter.links.base_link.visual.dimensions = { x: 2, y: 2, z: 2 };

  const expressionResult = reconcile(expressionBefore, expressionAfter, expressionSource);
  assert.equal(expressionResult.status, 'unsafe');
  assert.match(expressionResult.reason, /contains Xacro expressions/i);
});

test('patched candidates round trip to the requested robot semantics', () => {
  const beforeRobot = parseXacro();
  const afterRobot = structuredClone(beforeRobot);
  afterRobot.links.base_link.visual.dimensions = { x: 2, y: 3, z: 4 };
  afterRobot.joints.hinge.dynamics = { damping: 0.5, friction: 0.25 };

  const content = requirePatched(reconcile(beforeRobot, afterRobot));
  const parsed = parseXacro(content);

  assert.equal(
    createStableJsonSnapshot(parsed.links.base_link.visual.dimensions),
    createStableJsonSnapshot(afterRobot.links.base_link.visual.dimensions),
  );
  assert.equal(
    createStableJsonSnapshot(parsed.joints.hinge.dynamics),
    createStableJsonSnapshot(afterRobot.joints.hinge.dynamics),
  );
});
