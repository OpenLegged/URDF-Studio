import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { JointType } from '@/types';

import {
  patchUrdfLinkInertialInSource,
  patchSdfJointLimitInSource,
  patchSdfModelNameInSource,
  patchUrdfJointLimitInSource,
  patchUrdfRobotNameInSource,
} from './jointEditableSourcePatch.ts';

const dom = new JSDOM('');

if (!globalThis.DOMParser) {
  globalThis.DOMParser = dom.window.DOMParser;
}

test('patchUrdfRobotNameInSource updates only the robot root name', () => {
  const source = `<robot name="go2" version="1.0">
  <link name="base_link" />
</robot>
`;

  const patched = patchUrdfRobotNameInSource(source, 'go2_renamed');

  assert.match(patched, /<robot name="go2_renamed" version="1\.0">/);
  assert.match(patched, /<link name="base_link" \/>/);
});

test('patchUrdfRobotNameInSource updates Xacro robot root names without touching namespace declarations', () => {
  const source = `<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="demo">
  <xacro:property name="prefix" value="demo" />
</robot>
`;

  const patched = patchUrdfRobotNameInSource(source, 'demo_renamed');

  assert.match(
    patched,
    /<robot xmlns:xacro="http:\/\/www\.ros\.org\/wiki\/xacro" name="demo_renamed">/,
  );
  assert.match(patched, /<xacro:property name="prefix" value="demo" \/>/);
});

test('patchUrdfRobotNameInSource supports xacro-prefixed robot roots', () => {
  const source = `<xacro:robot name="demo">
  <xacro:property name="prefix" value="demo" />
</xacro:robot>
`;

  const patched = patchUrdfRobotNameInSource(source, 'demo_renamed');

  assert.match(patched, /<xacro:robot name="demo_renamed">/);
  assert.match(patched, /<\/xacro:robot>/);
});

test('patchUrdfJointLimitInSource updates only the targeted joint limit attributes', () => {
  const source = `<robot name="go2">
  <joint name="FL_hip_joint" type="revolute">
    <parent link="base" />
    <child link="fl_hip" />
    <limit lower="-1.0472" upper="1.0472" effort="23.7" velocity="30.1" />
  </joint>
  <joint name="FR_hip_joint" type="revolute">
    <parent link="base" />
    <child link="fr_hip" />
    <limit lower="-1.0472" upper="1.0472" effort="23.7" velocity="30.1" />
  </joint>
</robot>
`;

  const patched = patchUrdfJointLimitInSource({
    sourceContent: source,
    jointName: 'FL_hip_joint',
    jointType: JointType.REVOLUTE,
    limit: {
      lower: -0.5,
      upper: 0.8,
      effort: 25,
      velocity: 12,
    },
  });

  assert.match(
    patched,
    /<joint name="FL_hip_joint"[\s\S]*?<limit lower="-0\.5" upper="0\.8" effort="25" velocity="12" \/>/,
  );
  assert.match(
    patched,
    /<joint name="FR_hip_joint"[\s\S]*?<limit lower="-1\.0472" upper="1\.0472" effort="23\.7" velocity="30\.1" \/>/,
  );
});

test('patchUrdfJointLimitInSource patches literal Xacro joint tags without rewriting properties', () => {
  const source = `<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="demo">
  <xacro:property name="hip_lower" value="-1.0472" />
  <joint name="hip_joint" type="revolute">
    <limit lower="${'${hip_lower}'}" upper="1.0472" effort="23.7" velocity="30.1" />
  </joint>
</robot>
`;

  const patched = patchUrdfJointLimitInSource({
    sourceContent: source,
    jointName: 'hip_joint',
    jointType: JointType.REVOLUTE,
    limit: {
      lower: -0.5,
      upper: 0.8,
      effort: 25,
      velocity: 12,
    },
  });

  assert.match(patched, /<xacro:property name="hip_lower" value="-1\.0472" \/>/);
  assert.match(
    patched,
    /<limit lower="-0\.5" upper="0\.8" effort="25" velocity="12" \/>/,
  );
});

test('patchUrdfJointLimitInSource preserves URDF 1.2 extended joint limit attributes', () => {
  const source = `<robot name="extended_limits" version="1.2">
  <joint name="arm_joint" type="revolute">
    <limit lower="-1" upper="1" effort="10" velocity="5" acceleration="20" deceleration="15" jerk="200" />
  </joint>
</robot>
`;

  const patched = patchUrdfJointLimitInSource({
    sourceContent: source,
    jointName: 'arm_joint',
    jointType: JointType.REVOLUTE,
    limit: {
      lower: -0.5,
      upper: 0.8,
      effort: 25,
      velocity: 12,
    },
  });

  assert.match(
    patched,
    /<limit lower="-0\.5" upper="0\.8" effort="25" velocity="12" acceleration="20" deceleration="15" jerk="200" \/>/,
  );
});

test('patchUrdfJointLimitInSource writes only finite optional limit fields', () => {
  const source = `<robot name="continuous_limits">
  <joint name="wheel_joint" type="continuous">
    <limit lower="-3.14" upper="3.14" effort="10" velocity="2" />
  </joint>
</robot>
`;

  const patched = patchUrdfJointLimitInSource({
    sourceContent: source,
    jointName: 'wheel_joint',
    jointType: JointType.CONTINUOUS,
    limit: { effort: 12 },
  });

  assert.match(patched, /<limit effort="12" \/>/);
  assert.doesNotMatch(patched, /\b(?:lower|upper|velocity)=/);
  assert.doesNotMatch(patched, /(?:undefined|NaN|Infinity)/);
});

test('patchUrdfJointLimitInSource does not add an empty limit element', () => {
  const source = `<robot name="continuous_limits">
  <joint name="wheel_joint" type="continuous" />
</robot>
`;

  const patched = patchUrdfJointLimitInSource({
    sourceContent: source,
    jointName: 'wheel_joint',
    jointType: JointType.CONTINUOUS,
    limit: {},
  });

  assert.equal(patched, source);
});

test('patchUrdfJointLimitInSource ignores commented limit elements', () => {
  const source = `<robot name="commented_limits">
  <joint name="arm_joint" type="revolute">
    <!-- <limit lower="-9" upper="9" effort="1" velocity="1" /> -->
    <limit lower="-1" upper="1" effort="10" velocity="5" />
  </joint>
</robot>
`;

  const patched = patchUrdfJointLimitInSource({
    sourceContent: source,
    jointName: 'arm_joint',
    jointType: JointType.REVOLUTE,
    limit: {
      lower: -0.5,
      upper: 0.8,
      effort: 25,
      velocity: 12,
    },
  });

  assert.match(patched, /<!-- <limit lower="-9" upper="9" effort="1" velocity="1" \/> -->/);
  assert.match(patched, /<limit lower="-0\.5" upper="0\.8" effort="25" velocity="12" \/>/);
});

test('patchUrdfLinkInertialInSource updates only the targeted link inertial block', () => {
  const source = `<robot name="demo">
  <link name="base_link">
    <inertial>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <mass value="1" />
      <inertia ixx="1" ixy="0" ixz="0" iyy="1" iyz="0" izz="1" />
    </inertial>
  </link>
  <link name="tool_link">
    <inertial>
      <origin xyz="9 9 9" rpy="0 0 0" />
      <mass value="9" />
      <inertia ixx="9" ixy="0" ixz="0" iyy="9" iyz="0" izz="9" />
    </inertial>
  </link>
</robot>
`;

  const patched = patchUrdfLinkInertialInSource({
    sourceContent: source,
    linkName: 'base_link',
    inertial: {
      mass: 12.34,
      origin: { xyz: { x: 0.1, y: -0.2, z: 0.3 }, rpy: { r: 0.4, p: -0.5, y: 0.6 } },
      inertia: { ixx: 1.1, ixy: 0.01, ixz: 0.02, iyy: 2.2, iyz: 0.03, izz: 3.3 },
    },
  });

  assert.match(
    patched,
    /<link name="base_link">[\s\S]*?<origin xyz="0\.1 -0\.2 0\.3" rpy="0\.4 -0\.5 0\.6" \/>/,
  );
  assert.match(patched, /<link name="base_link">[\s\S]*?<mass value="12\.34" \/>/);
  assert.match(
    patched,
    /<link name="base_link">[\s\S]*?<inertia ixx="1\.1" ixy="0\.01" ixz="0\.02" iyy="2\.2" iyz="0\.03" izz="3\.3" \/>/,
  );
  assert.match(patched, /<link name="tool_link">[\s\S]*?<mass value="9" \/>/);
});

test('patchUrdfLinkInertialInSource expands self-closing links and patches Xacro text', () => {
  const source = `<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="demo">
  <xacro:property name="mass_scale" value="1" />
  <link name="base_link" />
</robot>
`;

  const patched = patchUrdfLinkInertialInSource({
    sourceContent: source,
    linkName: 'base_link',
    inertial: {
      mass: 2.5,
      origin: { xyz: { x: 0, y: 0, z: 0.12 }, rpy: { r: 0, p: 0, y: 0 } },
      inertia: { ixx: 0.1, ixy: 0, ixz: 0, iyy: 0.2, iyz: 0, izz: 0.3 },
    },
  });

  assert.match(patched, /<xacro:property name="mass_scale" value="1" \/>/);
  assert.match(
    patched,
    /<link name="base_link">\s*<inertial>\s*<origin xyz="0 0 0\.12" rpy="0 0 0" \/>/,
  );
  assert.match(patched, /<mass value="2\.5" \/>/);
  assert.match(patched, /<inertia ixx="0\.1" ixy="0" ixz="0" iyy="0\.2" iyz="0" izz="0\.3" \/>/);
  assert.match(patched, /<\/inertial>\s*<\/link>/);
});

test('patchSdfModelNameInSource updates only the first model name', () => {
  const source = `<sdf version="1.7">
  <world name="default">
    <plugin name="keep_me" filename="libkeep.so" />
    <model name="demo">
      <link name="base_link" />
    </model>
  </world>
</sdf>
`;

  const patched = patchSdfModelNameInSource(source, 'demo_renamed');

  assert.match(patched, /<model name="demo_renamed">/);
  assert.match(patched, /<plugin name="keep_me" filename="libkeep\.so" \/>/);
  assert.match(patched, /<link name="base_link" \/>/);
});

test('patchSdfJointLimitInSource patches only managed fields in the targeted joint axis limit block', () => {
  const source = `<sdf version="1.7">
  <model name="demo">
    <joint name="hip_joint" type="revolute">
      <axis>
        <xyz>0 0 1</xyz>
        <limit>
          <!-- <lower>commented_out</lower> -->
          <lower>-1.0472</lower>
          <upper>1.0472</upper>
          <effort>23.7</effort>
          <velocity>30.1</velocity>
          <stiffness>123</stiffness>
          <dissipation>4</dissipation>
          <!-- keep vendor extension -->
          <vendor:limit_policy>soft</vendor:limit_policy>
        </limit>
      </axis>
      <axis2>
        <limit>
          <lower>-9</lower>
          <upper>9</upper>
        </limit>
      </axis2>
    </joint>
    <joint name="knee_joint" type="revolute">
      <axis>
        <limit>
          <lower>-2</lower>
          <upper>2</upper>
        </limit>
      </axis>
    </joint>
  </model>
</sdf>
`;

  const patched = patchSdfJointLimitInSource({
    sourceContent: source,
    jointName: 'hip_joint',
    jointType: JointType.REVOLUTE,
    limit: {
      lower: -0.5,
      upper: 0.8,
      effort: 25,
      velocity: 12,
    },
  });

  assert.match(
    patched,
    /<joint name="hip_joint"[\s\S]*?<limit>[\s\S]*?<lower>-0\.5<\/lower>[\s\S]*?<upper>0\.8<\/upper>[\s\S]*?<effort>25<\/effort>[\s\S]*?<velocity>12<\/velocity>[\s\S]*?<stiffness>123<\/stiffness>[\s\S]*?<dissipation>4<\/dissipation>[\s\S]*?<vendor:limit_policy>soft<\/vendor:limit_policy>[\s\S]*?<\/limit>/,
  );
  assert.match(patched, /<!-- <lower>commented_out<\/lower> -->/);
  assert.match(
    patched,
    /<joint name="knee_joint"[\s\S]*?<lower>-2<\/lower>\s*<upper>2<\/upper>/,
  );
  assert.match(patched, /<xyz>0 0 1<\/xyz>/);
  assert.match(
    patched,
    /<axis2>\s*<limit>\s*<lower>-9<\/lower>\s*<upper>9<\/upper>\s*<\/limit>\s*<\/axis2>/,
  );
});

test('patchSdfJointLimitInSource removes continuous position limits while preserving extra stop fields', () => {
  const source = `<sdf version="1.7">
  <model name="demo">
    <joint name="yaw_joint" type="continuous">
      <axis>
        <limit>
          <lower>-3.14</lower>
          <upper>3.14</upper>
          <effort>10</effort>
          <velocity>1</velocity>
          <stiffness>999</stiffness>
          <dissipation>8</dissipation>
        </limit>
      </axis>
    </joint>
  </model>
</sdf>
`;

  const patched = patchSdfJointLimitInSource({
    sourceContent: source,
    jointName: 'yaw_joint',
    jointType: JointType.CONTINUOUS,
    limit: {
      lower: -1,
      upper: 1,
      effort: 25,
      velocity: 12,
    },
  });

  assert.doesNotMatch(patched, /<lower>-3\.14<\/lower>/);
  assert.doesNotMatch(patched, /<upper>3\.14<\/upper>/);
  assert.match(patched, /<effort>25<\/effort>/);
  assert.match(patched, /<velocity>12<\/velocity>/);
  assert.match(patched, /<stiffness>999<\/stiffness>/);
  assert.match(patched, /<dissipation>8<\/dissipation>/);
});

test('patchSdfJointLimitInSource removes non-finite optional fields from an existing block', () => {
  const source = `<sdf version="1.7">
  <model name="demo">
    <joint name="yaw_joint" type="continuous">
      <axis>
        <limit>
          <lower>-3.14</lower>
          <upper>3.14</upper>
          <effort>10</effort>
          <velocity>1</velocity>
        </limit>
      </axis>
    </joint>
  </model>
</sdf>
`;

  const patched = patchSdfJointLimitInSource({
    sourceContent: source,
    jointName: 'yaw_joint',
    jointType: JointType.CONTINUOUS,
    limit: { effort: 20 },
  });

  assert.match(patched, /<effort>20<\/effort>/);
  assert.doesNotMatch(patched, /<(?:lower|upper|velocity)>/);
  assert.doesNotMatch(patched, /(?:undefined|NaN|Infinity)/);
});

test('patchSdfJointLimitInSource inserts a missing axis limit block', () => {
  const source = `<sdf version="1.7">
  <model name="demo">
    <joint name="slider_joint" type="prismatic">
      <axis>
        <xyz>1 0 0</xyz>
      </axis>
    </joint>
  </model>
</sdf>
`;

  const patched = patchSdfJointLimitInSource({
    sourceContent: source,
    jointName: 'slider_joint',
    jointType: JointType.PRISMATIC,
    limit: {
      lower: -0.1,
      upper: 0.2,
      effort: 30,
      velocity: 2,
    },
  });

  assert.match(
    patched,
    /<axis>\s*<xyz>1 0 0<\/xyz>\s*<limit>\s*<lower>-0\.1<\/lower>\s*<upper>0\.2<\/upper>\s*<effort>30<\/effort>\s*<velocity>2<\/velocity>\s*<\/limit>\s*<\/axis>/,
  );
});

test('patchSdfJointLimitInSource ignores commented axis and limit elements', () => {
  const source = `<sdf version="1.12">
  <model name="demo">
    <joint name="hip_joint" type="revolute">
      <!-- <axis><limit><lower>-9</lower><upper>9</upper></limit></axis> -->
      <axis>
        <!-- <limit><lower>-8</lower><upper>8</upper></limit> -->
        <xyz>0 0 1</xyz>
        <limit>
          <lower>-1</lower>
          <upper>1</upper>
        </limit>
      </axis>
    </joint>
  </model>
</sdf>
`;

  const patched = patchSdfJointLimitInSource({
    sourceContent: source,
    jointName: 'hip_joint',
    jointType: JointType.REVOLUTE,
    limit: {
      lower: -0.5,
      upper: 0.8,
      effort: 25,
      velocity: 12,
    },
  });

  assert.match(
    patched,
    /<!-- <axis><limit><lower>-9<\/lower><upper>9<\/upper><\/limit><\/axis> -->/,
  );
  assert.match(patched, /<!-- <limit><lower>-8<\/lower><upper>8<\/upper><\/limit> -->/);
  assert.match(
    patched,
    /<axis>[\s\S]*?<limit>\s*<lower>-0\.5<\/lower>\s*<upper>0\.8<\/upper>\s*<effort>25<\/effort>\s*<velocity>12<\/velocity>\s*<\/limit>/,
  );
});
