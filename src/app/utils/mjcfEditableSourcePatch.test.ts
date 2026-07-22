import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { GeometryType, JointType, type RobotState } from '@/types';
import { parseMJCF as parseNullableMJCF } from '@/core/parsers/mjcf/mjcfParser';
import {
  appendMJCFChildBodyToSource,
  appendMJCFBodyCollisionGeomToSource,
  removeMJCFBodyCollisionGeomFromSource,
  updateMJCFBodyCollisionGeomInSource,
  removeMJCFBodyFromSource,
  patchMJCFBodyInertialInSource,
  patchMJCFJointLimitInSource,
  patchMJCFRootModelNameInSource,
  renameMJCFEntitiesInSource,
  renameMJCFBodyInSource,
  renameMJCFJointInSource,
} from './mjcfEditableSourcePatch';

const dom = new JSDOM('');
if (!globalThis.DOMParser) {
  globalThis.DOMParser = dom.window.DOMParser;
}
if (!globalThis.XMLSerializer) {
  globalThis.XMLSerializer = dom.window.XMLSerializer;
}

function parseMJCF(source: string): RobotState {
  const parsed = parseNullableMJCF(source);
  assert.ok(parsed, 'expected MJCF source to parse');
  return parsed;
}

test('appendMJCFChildBodyToSource inserts a nested child body without rewriting the full document', () => {
  const source = `<mujoco model="demo">
  <worldbody>
    <body name="base_link" pos="0 0 0">
      <geom type="box" size="0.1 0.1 0.1"/>
    </body>
  </worldbody>
</mujoco>
`;

  const patched = appendMJCFChildBodyToSource({
    sourceContent: source,
    parentBodyName: 'base_link',
    childBodyName: 'link_2',
    joint: {
      name: 'joint_1',
      type: JointType.REVOLUTE,
      origin: {
        xyz: { x: 0, y: 0, z: 0.5 },
        rpy: { r: 0, p: 0, y: 0 },
      },
      axis: { x: 0, y: 0, z: 1 },
      limit: { lower: -1.57, upper: 1.57, effort: 100, velocity: 10 },
    },
  });

  assert.match(patched, /<body name="link_2" pos="0 0 0\.5">/);
  assert.match(patched, /<joint name="joint_1" type="hinge" axis="0 0 1" range="-1\.57 1\.57" \/>/);
  assert.ok(
    patched.indexOf('<body name="link_2"') > patched.indexOf('<body name="base_link"'),
    'expected child body to be inserted inside the parent body',
  );

  const parsed = parseMJCF(patched);
  assert.ok(Object.values(parsed.links).some((link) => link.name === 'link_2'));
  assert.ok(Object.values(parsed.joints).some((joint) => joint.name === 'joint_1'));
});

test('appendMJCFChildBodyToSource preserves existing indentation for nested bodies', () => {
  const source = `<mujoco model="demo">
  <worldbody>
    <body name="base_link">
      <body name="arm">
        <geom type="sphere" size="0.1"/>
      </body>
    </body>
  </worldbody>
</mujoco>
`;

  const patched = appendMJCFChildBodyToSource({
    sourceContent: source,
    parentBodyName: 'arm',
    childBodyName: 'wrist',
    joint: {
      name: 'joint_2',
      type: JointType.PRISMATIC,
      origin: {
        xyz: { x: 0, y: 0.5, z: 0.5 },
        rpy: { r: 0, p: 0, y: 0 },
      },
      axis: { x: 1, y: 0, z: 0 },
      limit: { lower: 0, upper: 0.25, effort: 100, velocity: 10 },
    },
  });

  assert.match(
    patched,
    /\n        <body name="wrist" pos="0 0\.5 0\.5">\n          <joint name="joint_2" type="slide" axis="1 0 0" range="0 0\.25" \/>\n        <\/body>\n      <\/body>/,
  );
});

test('appendMJCFChildBodyToSource throws when the target body is not present in the editable source', () => {
  assert.throws(
    () => appendMJCFChildBodyToSource({
      sourceContent: '<mujoco><worldbody/></mujoco>',
      parentBodyName: 'missing_link',
      childBodyName: 'link_2',
      joint: {
        name: 'joint_1',
        type: JointType.REVOLUTE,
        origin: {
          xyz: { x: 0, y: 0, z: 0.5 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: -1.57, upper: 1.57, effort: 100, velocity: 10 },
      },
    }),
    /Failed to locate MJCF <body name="missing_link">/,
  );
});

test('patchMJCFRootModelNameInSource updates only the root model attribute', () => {
  const source = `<mujoco model="demo" custom="keep">
  <option impratio="100"/>
  <worldbody>
    <body name="base_link"/>
  </worldbody>
</mujoco>
`;

  const patched = patchMJCFRootModelNameInSource(source, 'demo_renamed');

  assert.match(patched, /<mujoco model="demo_renamed" custom="keep">/);
  assert.match(patched, /<option impratio="100"\/>/);
  assert.ok(parseMJCF(patched));
});

test('patchMJCFBodyInertialInSource updates only the targeted body inertial tag', () => {
  const source = `<mujoco model="demo">
  <compiler angle="radian"/>
  <worldbody>
    <body name="Trunk">
      <inertial pos="0.0551365 -1.42058e-06 0.105062" quat="0.99996 1.40561e-05 -0.00899532 -1.39249e-05" mass="11.7"
        diaginertia="0.0915404 0.0767787 0.0556055"/>
      <body name="Child">
        <inertial pos="0 0 0" mass="0.5" diaginertia="1 2 3"/>
      </body>
    </body>
  </worldbody>
</mujoco>
`;

  const patched = patchMJCFBodyInertialInSource({
    sourceContent: source,
    bodyName: 'Trunk',
    inertial: {
      mass: 12.34,
      origin: {
        xyz: { x: 0.123456, y: -0.000001, z: 0.105062 },
        rpy: { r: 0, p: 0, y: 0 },
      },
      inertia: {
        ixx: 0.1,
        ixy: 0,
        ixz: 0,
        iyy: 0.2,
        iyz: 0,
        izz: 0.3,
      },
    },
  });

  const trunkTag = patched.match(/<inertial[^>]*mass="12\.34"[^>]*\/>/)?.[0] ?? '';
  assert.match(trunkTag, /pos="0\.123456 -0\.000001 0\.105062"/);
  assert.match(trunkTag, /quat="1 0 0 0"/);
  assert.match(trunkTag, /diaginertia="0\.1 0\.2 0\.3"/);
  assert.match(patched, /<body name="Child">\s*<inertial pos="0 0 0" mass="0\.5" diaginertia="1 2 3"\/>/);

  const parsed = parseMJCF(patched);
  assert.equal(parsed.links.Trunk.inertial?.mass, 12.34);
  assert.equal(parsed.links.Trunk.inertial?.origin?.xyz.x, 0.123456);
});

test('patchMJCFBodyInertialInSource inserts missing inertial on self-closing bodies', () => {
  const source = `<mujoco model="demo">
  <worldbody>
    <body name="base_link"/>
  </worldbody>
</mujoco>
`;

  const patched = patchMJCFBodyInertialInSource({
    sourceContent: source,
    bodyName: 'base_link',
    inertial: {
      mass: 2,
      origin: {
        xyz: { x: 0, y: 0, z: 0 },
        rpy: { r: 0, p: 0, y: Math.PI / 2 },
      },
      inertia: {
        ixx: 1,
        ixy: 0,
        ixz: 0,
        iyy: 2,
        iyz: 0,
        izz: 3,
      },
    },
  });

  assert.match(patched, /<body name="base_link">\s*<inertial mass="2" pos="0 0 0" quat="0\.707107 0 0 0\.707107" diaginertia="1 2 3" \/>\s*<\/body>/);
  assert.equal(parseMJCF(patched).links.base_link.inertial?.mass, 2);
});

test('patchMJCFJointLimitInSource updates only the targeted joint range', () => {
  const source = `<mujoco model="demo">
  <compiler angle="radian"/>
  <worldbody>
    <body name="base_link">
      <joint name="hip_joint" type="hinge" axis="0 0 1" range="-1 1" damping="0"/>
      <joint name="knee_joint" type="hinge" axis="0 1 0" range="-2 2" damping="0"/>
    </body>
  </worldbody>
</mujoco>
`;

  const patched = patchMJCFJointLimitInSource({
    sourceContent: source,
    jointName: 'hip_joint',
    jointType: JointType.REVOLUTE,
    limit: { lower: -0.5, upper: 0.8, effort: 25, velocity: 10 },
  });

  const hipTag = patched.match(/<joint name="hip_joint"[^>]*\/>/)?.[0] ?? '';
  assert.match(hipTag, /range="-0\.5 0\.8"/);
  assert.match(hipTag, /limited="true"/);
  assert.match(hipTag, /damping="0"/);
  assert.match(
    patched,
    /<joint name="knee_joint" type="hinge" axis="0 1 0" range="-2 2" damping="0"\/>/,
  );

  const parsed = parseMJCF(patched);
  assert.equal(parsed.joints.hip_joint.limit?.lower, -0.5);
  assert.equal(parsed.joints.hip_joint.limit?.upper, 0.8);
});

test('patchMJCFJointLimitInSource writes angular ranges in the source compiler unit', () => {
  const source = `<mujoco model="demo">
  <worldbody>
    <body name="base_link">
      <joint name="hip_joint" type="hinge" axis="0 0 1" range="-90 90"/>
    </body>
  </worldbody>
</mujoco>
`;

  const patched = patchMJCFJointLimitInSource({
    sourceContent: source,
    jointName: 'hip_joint',
    jointType: JointType.REVOLUTE,
    limit: { lower: -Math.PI / 2, upper: Math.PI / 2, effort: 25, velocity: 10 },
  });

  assert.match(patched, /<joint name="hip_joint"[^>]*range="-90 90"/);
  assert.equal(parseMJCF(patched).joints.hip_joint.limit?.lower, -Math.PI / 2);
});

test('patchMJCFJointLimitInSource preserves official non-range joint limit attributes', () => {
  const source = `<mujoco model="demo">
  <compiler angle="radian" autolimits="false"/>
  <worldbody>
    <body name="base_link">
      <joint name="hip_joint" type="hinge" axis="0 0 1" range="-1 1" limited="auto" ref="0.1" margin="0.02" solreflimit="0.01 1" solimplimit="0.9 0.95 0.001" actuatorfrcrange="-5 5" actuatorfrclimited="true" stiffness="12"/>
    </body>
  </worldbody>
</mujoco>
`;

  const patched = patchMJCFJointLimitInSource({
    sourceContent: source,
    jointName: 'hip_joint',
    jointType: JointType.REVOLUTE,
    limit: { lower: -0.5, upper: 0.8, effort: 25, velocity: 10 },
  });

  const hipTag = patched.match(/<joint name="hip_joint"[^>]*\/>/)?.[0] ?? '';
  assert.match(hipTag, /range="-0\.5 0\.8"/);
  assert.match(hipTag, /limited="true"/);
  assert.match(hipTag, /ref="0\.1"/);
  assert.match(hipTag, /margin="0\.02"/);
  assert.match(hipTag, /solreflimit="0\.01 1"/);
  assert.match(hipTag, /solimplimit="0\.9 0\.95 0\.001"/);
  assert.match(hipTag, /actuatorfrcrange="-5 5"/);
  assert.match(hipTag, /actuatorfrclimited="true"/);
  assert.match(hipTag, /stiffness="12"/);
});

test('patchMJCFJointLimitInSource ignores commented compiler and joint tags', () => {
  const source = `<mujoco model="demo">
  <!-- <compiler angle="degree"/> -->
  <compiler angle="radian"/>
  <worldbody>
    <!-- <joint name="hip_joint" type="hinge" axis="0 0 1" range="-90 90"/> -->
    <body name="base_link">
      <joint name="hip_joint" type="hinge" axis="0 0 1" range="-1 1"/>
    </body>
  </worldbody>
</mujoco>
`;

  const patched = patchMJCFJointLimitInSource({
    sourceContent: source,
    jointName: 'hip_joint',
    jointType: JointType.REVOLUTE,
    limit: { lower: -Math.PI / 2, upper: Math.PI / 2, effort: 25, velocity: 10 },
  });

  assert.match(
    patched,
    /<!-- <joint name="hip_joint" type="hinge" axis="0 0 1" range="-90 90"\/> -->/,
  );
  const hipTag = patched.match(/\n      (<joint name="hip_joint"[^>]*\/>)/)?.[1] ?? '';
  assert.match(hipTag, /range="-1\.570796 1\.570796"/);
});

test('patchMJCFJointLimitInSource inserts a missing range and removes limits for continuous joints', () => {
  const source = `<mujoco model="demo">
  <worldbody>
    <body name="base_link">
      <joint name="slider_joint" type="slide" axis="1 0 0"/>
      <joint name="wheel_joint" type="hinge" axis="0 0 1" limited="true" range="-1 1"/>
    </body>
  </worldbody>
</mujoco>
`;

  const withSliderRange = patchMJCFJointLimitInSource({
    sourceContent: source,
    jointName: 'slider_joint',
    jointType: JointType.PRISMATIC,
    limit: { lower: 0, upper: 0.25, effort: 10, velocity: 1 },
  });
  const sliderTag = withSliderRange.match(/<joint name="slider_joint"[^>]*\/>/)?.[0] ?? '';
  assert.match(sliderTag, /limited="true"/);
  assert.match(sliderTag, /range="0 0\.25"/);

  const continuous = patchMJCFJointLimitInSource({
    sourceContent: withSliderRange,
    jointName: 'wheel_joint',
    jointType: JointType.CONTINUOUS,
    limit: { lower: -1, upper: 1, effort: 10, velocity: 1 },
  });
  assert.match(continuous, /<joint name="wheel_joint" type="hinge" axis="0 0 1"\/>/);
  assert.doesNotMatch(continuous, /wheel_joint"[^>]*(?:range|limited)=/);
});

test('patchMJCFJointLimitInSource omits a range when optional bounds are missing', () => {
  const source = `<mujoco model="demo">
  <worldbody>
    <body name="base_link">
      <joint name="hip_joint" type="hinge" axis="0 0 1" limited="true" range="-1 1"/>
    </body>
  </worldbody>
</mujoco>
`;

  const patched = patchMJCFJointLimitInSource({
    sourceContent: source,
    jointName: 'hip_joint',
    jointType: JointType.REVOLUTE,
    limit: { effort: 25 },
  });

  assert.match(patched, /<joint name="hip_joint" type="hinge" axis="0 0 1"\/>/);
  assert.doesNotMatch(patched, /hip_joint"[^>]*(?:range|limited)=/);
  assert.doesNotMatch(patched, /(?:undefined|NaN|Infinity)/);
});

test('removeMJCFBodyFromSource removes only the target nested body without rewriting surrounding paths or assets', () => {
  const source = `<mujoco model="demo">
  <asset>
    <mesh name="arm_mesh" file="assets/arm.stl"/>
    <mesh name="wrist_mesh" file="assets/wrist.stl"/>
  </asset>
  <worldbody>
    <body name="base_link">
      <body name="arm">
        <geom type="mesh" mesh="arm_mesh"/>
        <body name="wrist">
          <joint name="joint_2" type="hinge" axis="0 0 1"/>
          <geom type="mesh" mesh="wrist_mesh"/>
        </body>
      </body>
    </body>
  </worldbody>
</mujoco>
`;

  const patched = removeMJCFBodyFromSource(source, 'wrist');

  assert.doesNotMatch(patched, /<body name="wrist"/);
  assert.match(patched, /file="assets\/arm\.stl"/);
  assert.match(patched, /file="assets\/wrist\.stl"/);

  const parsed = parseMJCF(patched);
  assert.ok(!Object.values(parsed.links).some((link) => link.name === 'wrist'));
  assert.ok(!Object.values(parsed.joints).some((joint) => joint.name === 'joint_2'));
});

test('removeMJCFBodyFromSource throws when the target body is not present in the editable source', () => {
  assert.throws(
    () => removeMJCFBodyFromSource('<mujoco><worldbody/></mujoco>', 'missing_link'),
    /Failed to locate MJCF <body name="missing_link">/,
  );
});

test('appendMJCFBodyCollisionGeomToSource inserts a collision-only geom without touching mesh paths', () => {
  const source = `<mujoco model="demo">
  <asset>
    <mesh name="visual_mesh" file="assets/base_visual.stl"/>
  </asset>
  <worldbody>
    <body name="base_link">
      <geom type="mesh" mesh="visual_mesh" group="1" contype="0" conaffinity="0"/>
    </body>
  </worldbody>
</mujoco>
`;

  const patched = appendMJCFBodyCollisionGeomToSource({
    sourceContent: source,
    bodyName: 'base_link',
    geometry: {
      type: GeometryType.BOX,
      dimensions: { x: 0.08, y: 0.12, z: 0.08 },
      color: '#ef4444',
      origin: {
        xyz: { x: 0, y: 0.08, z: 0 },
        rpy: { r: 0, p: 0, y: 0 },
      },
    },
  });

  assert.match(patched, /<geom pos="0 0\.08 0" rgba="0\.937255 0\.266667 0\.266667 1" group="3" contype="1" conaffinity="1" type="box" size="0\.04 0\.06 0\.04" \/>/);
  assert.match(patched, /file="assets\/base_visual\.stl"/);

  const parsed = parseMJCF(patched);
  assert.equal(parsed.links.base_link.collision.type, GeometryType.BOX);
});

test('removeMJCFBodyCollisionGeomFromSource removes only the targeted collision-only geom', () => {
  const source = `<mujoco model="demo">
  <asset>
    <mesh name="visual_mesh" file="assets/base_visual.stl"/>
  </asset>
  <worldbody>
    <body name="base_link">
      <geom type="mesh" mesh="visual_mesh" group="1" contype="0" conaffinity="0"/>
      <geom name="primary_collision" type="box" size="0.04 0.06 0.04" group="3" contype="1" conaffinity="1"/>
      <geom name="extra_collision" type="sphere" size="0.02" group="3" contype="1" conaffinity="1"/>
    </body>
  </worldbody>
</mujoco>
`;

  const patched = removeMJCFBodyCollisionGeomFromSource(source, 'base_link', 1);

  assert.match(patched, /name="primary_collision"/);
  assert.doesNotMatch(patched, /name="extra_collision"/);
  assert.match(patched, /file="assets\/base_visual\.stl"/);

  const parsed = parseMJCF(patched);
  assert.equal(parsed.links.base_link.collision.type, GeometryType.BOX);
  assert.equal(parsed.links.base_link.collisionBodies?.length ?? 0, 0);
});

test('removeMJCFBodyCollisionGeomFromSource rejects deleting a shared visual-collision geom from source', () => {
  const source = `<mujoco model="demo">
  <worldbody>
    <body name="base_link">
      <geom name="shared_geom" type="box" size="0.04 0.06 0.04"/>
    </body>
  </worldbody>
</mujoco>
`;

  assert.throws(
    () => removeMJCFBodyCollisionGeomFromSource(source, 'base_link', 0),
    /Cannot safely remove shared visual\/collision MJCF geom/,
  );
});

test('updateMJCFBodyCollisionGeomInSource updates only the targeted collision-only geom without touching mesh paths', () => {
  const source = `<mujoco model="demo">
  <asset>
    <mesh name="visual_mesh" file="assets/base_visual.stl"/>
  </asset>
  <worldbody>
    <body name="base_link">
      <geom type="mesh" mesh="visual_mesh" group="1" contype="0" conaffinity="0"/>
      <geom
        name="primary_collision"
        class="collision"
        type="box"
        size="0.04 0.06 0.04"
        pos="0 0.08 0"
        group="3"
        contype="1"
        conaffinity="1"
        friction="0.8 0.1 0.1"/>
    </body>
  </worldbody>
</mujoco>
`;

  const patched = updateMJCFBodyCollisionGeomInSource(source, 'base_link', 0, {
    type: GeometryType.CAPSULE,
    dimensions: { x: 0.03, y: 0.2, z: 0 },
    color: '#22c55e',
    origin: {
      xyz: { x: 0, y: 0.12, z: 0 },
      rpy: { r: 0, p: 0.5, y: 0 },
    },
  });

  assert.match(patched, /file="assets\/base_visual\.stl"/);
  assert.match(patched, /name="primary_collision"/);
  assert.match(patched, /class="collision"/);
  assert.match(patched, /friction="0\.8 0\.1 0\.1"/);
  assert.match(patched, /type="capsule"/);
  assert.match(patched, /size="0\.03 0\.1"/);
  assert.match(patched, /pos="0 0\.12 0"/);
  assert.match(patched, /euler="0 0\.5 0"/);
  assert.doesNotMatch(patched, /size="0\.04 0\.06 0\.04"/);

  const parsed = parseMJCF(patched);
  assert.equal(parsed.links.base_link.collision.type, GeometryType.CAPSULE);
  assert.deepEqual(parsed.links.base_link.collision.origin.xyz, { x: 0, y: 0.12, z: 0 });
});

test('updateMJCFBodyCollisionGeomInSource rejects updating a shared visual-collision geom from source', () => {
  const source = `<mujoco model="demo">
  <worldbody>
    <body name="base_link">
      <geom name="shared_geom" type="box" size="0.04 0.06 0.04"/>
    </body>
  </worldbody>
</mujoco>
`;

  assert.throws(
    () => updateMJCFBodyCollisionGeomInSource(source, 'base_link', 0, {
      type: GeometryType.SPHERE,
      dimensions: { x: 0.03, y: 0, z: 0 },
      color: '#ef4444',
      origin: {
        xyz: { x: 0, y: 0, z: 0 },
        rpy: { r: 0, p: 0, y: 0 },
      },
    }),
    /Cannot safely update shared visual\/collision MJCF geom/,
  );
});

test('renameMJCFBodyInSource renames the target body name and body references without touching asset paths', () => {
  const source = `<mujoco model="demo">
  <asset>
    <mesh name="arm_mesh" file="assets/arm.stl"/>
  </asset>
  <equality>
    <weld body1="arm" body2="tool"/>
  </equality>
  <worldbody>
    <body name="arm">
      <geom type="mesh" mesh="arm_mesh"/>
    </body>
    <body name="tool"/>
  </worldbody>
</mujoco>
`;

  const patched = renameMJCFBodyInSource(source, 'arm', 'forearm');
  assert.match(patched, /<body name="forearm">/);
  assert.match(patched, /body1="forearm"/);
  assert.doesNotMatch(patched, /body1="arm"/);
  assert.match(patched, /file="assets\/arm\.stl"/);
  assert.ok(parseMJCF(patched));
});

test('renameMJCFJointInSource renames the target joint name and joint references', () => {
  const source = `<mujoco model="demo">
  <actuator>
    <motor name="drive" joint="joint_1"/>
  </actuator>
  <equality>
    <joint joint1="joint_1" joint2="joint_2"/>
  </equality>
  <worldbody>
    <body name="arm">
      <joint name="joint_1" type="hinge" axis="0 0 1"/>
      <joint name="joint_2" type="hinge" axis="0 1 0"/>
    </body>
  </worldbody>
</mujoco>
`;

  const patched = renameMJCFJointInSource(source, 'joint_1', 'elbow_joint');
  assert.match(patched, /<joint name="elbow_joint" type="hinge" axis="0 0 1"\/>/);
  assert.match(patched, /joint="elbow_joint"/);
  assert.match(patched, /joint1="elbow_joint"/);
  assert.doesNotMatch(patched, /name="joint_1"/);
});

test('renameMJCFJointInSource leaves commented joint tags and references untouched', () => {
  const source = `<mujoco model="demo">
  <!-- <joint name="joint_1" type="hinge" axis="0 0 1"/> -->
  <!-- <joint joint1="joint_1" joint2="joint_2"/> -->
  <equality>
    <joint joint1="joint_1" joint2="joint_2"/>
  </equality>
  <worldbody>
    <body name="base_link">
      <joint name="joint_1" type="hinge" axis="0 0 1"/>
      <joint name="joint_2" type="hinge" axis="0 1 0"/>
    </body>
  </worldbody>
</mujoco>
`;

  const patched = renameMJCFJointInSource(source, 'joint_1', 'elbow_joint');

  assert.match(patched, /<!-- <joint name="joint_1" type="hinge" axis="0 0 1"\/> -->/);
  assert.match(patched, /<!-- <joint joint1="joint_1" joint2="joint_2"\/> -->/);
  assert.match(patched, /<joint name="elbow_joint" type="hinge" axis="0 0 1"\/>/);
  assert.match(patched, /<joint joint1="elbow_joint" joint2="joint_2"\/>/);
});

test('renameMJCFEntitiesInSource applies collision-safe batch rename without touching mesh paths', () => {
  const source = `<mujoco model="demo">
  <asset>
    <mesh name="base_mesh" file="assets/base_arm.stl"/>
  </asset>
  <equality>
    <weld body1="base" body2="base_arm"/>
    <joint joint1="base_joint" joint2="base_arm_joint"/>
  </equality>
  <actuator>
    <motor name="root_drive" joint="base_joint"/>
    <motor name="child_drive" joint="base_arm_joint"/>
  </actuator>
  <worldbody>
    <body name="base">
      <joint name="base_joint" type="hinge" axis="0 0 1"/>
      <body name="base_arm">
        <joint name="base_arm_joint" type="hinge" axis="0 1 0"/>
      </body>
    </body>
  </worldbody>
</mujoco>
`;

  const patched = renameMJCFEntitiesInSource(source, [
    { kind: 'link', currentName: 'base', nextName: 'base_arm' },
    { kind: 'link', currentName: 'base_arm', nextName: 'base_arm_arm' },
    { kind: 'joint', currentName: 'base_joint', nextName: 'base_arm_joint' },
    { kind: 'joint', currentName: 'base_arm_joint', nextName: 'base_arm_arm_joint' },
  ]);

  assert.match(patched, /<body name="base_arm">/);
  assert.match(patched, /<body name="base_arm_arm">/);
  assert.match(patched, /body1="base_arm"/);
  assert.match(patched, /body2="base_arm_arm"/);
  assert.match(patched, /<joint name="base_arm_joint" type="hinge" axis="0 0 1"\/>/);
  assert.match(patched, /<joint name="base_arm_arm_joint" type="hinge" axis="0 1 0"\/>/);
  assert.match(patched, /joint1="base_arm_joint"/);
  assert.match(patched, /joint2="base_arm_arm_joint"/);
  assert.match(patched, /joint="base_arm_joint"/);
  assert.match(patched, /joint="base_arm_arm_joint"/);
  assert.match(patched, /file="assets\/base_arm\.stl"/);
});
