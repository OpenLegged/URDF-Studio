import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

import { GeometryType, JointType } from '@/types';
import { computeLinkWorldMatrices } from '@/core/robot';
import { resolveSdfIncludeSource } from './sdfIncludeResolution.ts';
import { parseSDF } from './sdfParser.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;

test('parseSDF converts gazebo jointed models into RobotState data', () => {
  const source = fs.readFileSync('test/gazebo_models/demo_joint_damping/model.sdf', 'utf8');
  const robot = parseSDF(source);

  assert.ok(robot);
  assert.equal(robot?.name, 'demo_joint_damping');
  assert.ok(robot?.links.link_base);
  assert.ok(robot?.links.link_over_damping);
  assert.ok(robot?.joints.joint_over_damping);
  assert.equal(robot?.joints.joint_over_damping.type, JointType.CONTINUOUS);
  assert.deepEqual(robot?.joints.joint_over_damping.axis, { x: 1, y: 0, z: 0 });
  assert.equal(robot?.joints.joint_over_damping.dynamics.damping, 5);
  assert.equal(robot?.links.link_over_damping.visual.type, GeometryType.MESH);
  assert.equal(
    robot?.links.link_over_damping.visual.meshPath,
    'model://demo_joint_damping/meshes/arm.stl',
  );
  assert.deepEqual(robot?.joints.joint_over_damping.origin.xyz, { x: 0.12, y: 0, z: 0.15 });
});

test('parseSDF resolves joint axis xyz expressed_in frames into the joint frame', () => {
  const robot = parseSDF(`<?xml version="1.0"?>
<sdf version="1.12">
  <model name="axis_frame_demo">
    <frame name="axis_frame">
      <pose>0 0 0 0 0 1.5707963267948966</pose>
    </frame>
    <link name="base" />
    <link name="tip" />
    <joint name="axis_joint" type="revolute">
      <parent>base</parent>
      <child>tip</child>
      <axis>
        <xyz expressed_in="axis_frame">1 0 0</xyz>
        <limit>
          <lower>-1</lower>
          <upper>1</upper>
        </limit>
      </axis>
    </joint>
  </model>
</sdf>`);

  assert.ok(robot);
  const axis = robot.joints.axis_joint?.axis;
  assert.ok(axis);
  assert.ok(Math.abs(axis.x) < 1e-9);
  assert.ok(Math.abs(axis.y - 1) < 1e-9);
  assert.ok(Math.abs(axis.z) < 1e-9);
});

test('parseSDF preserves tuple positions when an authored token is malformed', () => {
  const robot = parseSDF(`<?xml version="1.0"?>
<sdf version="1.12">
  <model name="malformed_tuple_demo">
    <link name="base">
      <pose>1 broken 3 0 0 0</pose>
      <visual name="visual">
        <geometry><box><size>2 broken 4</size></box></geometry>
      </visual>
    </link>
  </model>
</sdf>`);

  assert.ok(robot);
  assert.deepEqual(robot.links.base.visual.dimensions, { x: 2, y: 0, z: 4 });
  assert.deepEqual(robot.links.base.visual.origin.xyz, { x: 0, y: 0, z: 0 });
});

test('parseSDF omits unbounded and malformed joint limit values', () => {
  const robot = parseSDF(`<?xml version="1.0"?>
<sdf version="1.12">
  <model name="unbounded_joint_demo">
    <link name="base" />
    <link name="tip" />
    <joint name="spin" type="revolute">
      <parent>base</parent>
      <child>tip</child>
      <axis>
        <xyz>0 0 1</xyz>
        <limit>
          <lower>-inf</lower>
          <upper>inf</upper>
          <effort>broken</effort>
          <velocity>4</velocity>
        </limit>
      </axis>
    </joint>
  </model>
</sdf>`);

  assert.ok(robot);
  assert.deepEqual(robot.joints.spin.limit, { velocity: 4 });
});

test('parseSDF preserves additional visuals and collisions on the same link', () => {
  const robot = parseSDF(`<?xml version="1.0"?>
<sdf version="1.7">
  <model name="multi_visual_fixture">
    <link name="base">
      <visual name="visual_box">
        <geometry>
          <box>
            <size>1 2 3</size>
          </box>
        </geometry>
      </visual>
      <visual name="visual_mesh">
        <pose>0.5 0 0 0 0 0</pose>
        <geometry>
          <mesh>
            <uri>model://fixture/meshes/part.dae</uri>
            <scale>0.5 0.5 0.5</scale>
          </mesh>
        </geometry>
      </visual>
      <collision name="collision_box">
        <geometry>
          <box>
            <size>0.2 0.3 0.4</size>
          </box>
        </geometry>
      </collision>
      <collision name="collision_sphere">
        <pose>0 1 0 0 0 0</pose>
        <geometry>
          <sphere>
            <radius>0.25</radius>
          </sphere>
        </geometry>
      </collision>
    </link>
  </model>
</sdf>`);

  assert.ok(robot);
  assert.ok(robot?.links.base);
  assert.equal(robot?.links.base.visual.type, GeometryType.BOX);
  assert.equal(robot?.links.base.collision.type, GeometryType.BOX);
  assert.equal(robot?.links.base.visualBodies?.length, 1);
  assert.equal(robot?.links.base.visualBodies?.[0]?.type, GeometryType.MESH);
  assert.equal(robot?.links.base.visualBodies?.[0]?.meshPath, 'model://fixture/meshes/part.dae');
  assert.deepEqual(robot?.links.base.visualBodies?.[0]?.dimensions, { x: 0.5, y: 0.5, z: 0.5 });
  assert.deepEqual(robot?.links.base.visualBodies?.[0]?.origin.xyz, { x: 0.5, y: 0, z: 0 });
  assert.equal(robot?.links.base.collisionBodies?.length, 1);
  assert.equal(robot?.links.base.collisionBodies?.[0]?.type, GeometryType.SPHERE);
  assert.deepEqual(robot?.links.base.collisionBodies?.[0]?.origin.xyz, { x: 0, y: 1, z: 0 });
  assert.ok(!robot?.links.base__visual_1);
  assert.ok(!robot?.joints.base__visual_1_fixed);
});

test('parseSDF keeps mesh visuals without explicit material colors uncolored so Collada materials can survive', () => {
  const robot = parseSDF(`<?xml version="1.0"?>
<sdf version="1.7">
  <model name="dae_color_fixture">
    <link name="body">
      <visual name="body_visual">
        <geometry>
          <mesh>
            <uri>model://fixture/meshes/body.dae</uri>
          </mesh>
        </geometry>
      </visual>
    </link>
  </model>
</sdf>`);

  assert.ok(robot);
  assert.equal(robot?.links.body.visual.type, GeometryType.MESH);
  assert.equal(robot?.links.body.visual.color, '');
});

test('parseSDF preserves inline material alpha from diffuse RGBA values', () => {
  const robot = parseSDF(`<?xml version="1.0"?>
<sdf version="1.7">
  <model name="transparent_demo">
    <link name="base_link">
      <visual name="body">
        <geometry>
          <box>
            <size>1 2 3</size>
          </box>
        </geometry>
        <material>
          <diffuse>0.1 0.2 0.3 0.4</diffuse>
        </material>
      </visual>
    </link>
  </model>
</sdf>`);

  assert.ok(robot);
  assert.equal(robot?.links.base_link.visual.color, '#1a334d');
  assert.deepEqual(
    robot?.links.base_link.visual.authoredMaterials?.[0]?.colorRgba,
    [0.1, 0.2, 0.3, 0.4],
  );
  assert.deepEqual(robot?.materials?.base_link?.colorRgba, [0.1, 0.2, 0.3, 0.4]);
});

test('parseSDF resolves gazebo material scripts into texture-backed material metadata', () => {
  const robot = parseSDF(
    `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="demo">
    <link name="base_link">
      <visual name="body">
        <geometry>
          <box>
            <size>1 2 3</size>
          </box>
        </geometry>
        <material>
          <script>
            <uri>model://demo/materials/scripts</uri>
            <uri>model://demo/materials/textures</uri>
            <name>Demo/Diffuse</name>
          </script>
        </material>
      </visual>
    </link>
  </model>
</sdf>`,
    {
      sourcePath: 'demo/model.sdf',
      allFileContents: {
        'demo/materials/scripts/demo.material': `material Demo/Diffuse
{
  technique
  {
    pass
    {
      diffuse 1 0.5 0 0.4
      texture_unit
      {
        texture demo.png
      }
    }
  }
}`,
      },
    },
  );

  assert.ok(robot);
  assert.equal(robot?.links.base_link.visual.color, '#ff8000');
  assert.equal(robot?.links.base_link.visual.materialSource, 'gazebo');
  assert.equal(robot?.links.base_link.visual.authoredMaterials?.[0]?.name, 'Demo/Diffuse');
  assert.deepEqual(
    robot?.links.base_link.visual.authoredMaterials?.[0]?.colorRgba,
    [1, 0.5, 0, 0.4],
  );
  assert.equal(
    robot?.links.base_link.visual.authoredMaterials?.[0]?.texture,
    'demo/materials/textures/demo.png',
  );
  assert.deepEqual(robot?.materials?.base_link?.colorRgba, [1, 0.5, 0, 0.4]);
  assert.equal(robot?.materials?.base_link?.texture, 'demo/materials/textures/demo.png');
});

test('parseSDF preserves gazebo script materials on secondary visual bodies', () => {
  const robot = parseSDF(
    `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="demo">
    <link name="base_link">
      <visual name="primary">
        <geometry>
          <box>
            <size>1 1 1</size>
          </box>
        </geometry>
      </visual>
      <visual name="sign">
        <geometry>
          <box>
            <size>2 1 0.1</size>
          </box>
        </geometry>
        <material>
          <script>
            <uri>model://demo/materials/scripts</uri>
            <uri>model://demo/materials/textures</uri>
            <name>Demo/Poster</name>
          </script>
        </material>
      </visual>
    </link>
  </model>
</sdf>`,
    {
      sourcePath: 'demo/model.sdf',
      allFileContents: {
        'demo/materials/scripts/demo.material': `material Demo/Poster
{
  technique
  {
    pass
    {
      texture_unit
      {
        texture poster.png
      }
    }
  }
}`,
      },
    },
  );

  assert.ok(robot);
  assert.equal(robot?.links.base_link.visualBodies?.[0]?.materialSource, 'gazebo');
  assert.equal(
    robot?.links.base_link.visualBodies?.[0]?.authoredMaterials?.[0]?.texture,
    'demo/materials/textures/poster.png',
  );
});

test('parseSDF syncs OBJ sidecar textures into authored materials when SDF omits inline material tags', () => {
  const robot = parseSDF(
    `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="ambulance_fixture">
    <link name="base_link">
      <visual name="body">
        <geometry>
          <mesh>
            <uri>model://ambulance/meshes/ambulance.obj</uri>
          </mesh>
        </geometry>
      </visual>
    </link>
  </model>
</sdf>`,
    {
      sourcePath: 'ambulance/model.sdf',
      allFileContents: {
        'ambulance/meshes/ambulance.obj': `mtllib ambulance.mtl
usemtl Ambulance
o AmbulanceBody`,
        'ambulance/meshes/ambulance.mtl': `newmtl Ambulance
map_Kd ambulance.png`,
      },
      availableFiles: [
        { name: 'ambulance/model.sdf' },
        { name: 'ambulance/meshes/ambulance.obj' },
        { name: 'ambulance/meshes/ambulance.mtl' },
        { name: 'ambulance/materials/textures/ambulance.png' },
      ],
    },
  );

  assert.ok(robot);
  assert.equal(robot?.links.base_link.visual.authoredMaterials?.length, 1);
  assert.equal(robot?.links.base_link.visual.authoredMaterials?.[0]?.name, 'Ambulance');
  assert.equal(
    robot?.links.base_link.visual.authoredMaterials?.[0]?.texture,
    'ambulance/materials/textures/ambulance.png',
  );
  assert.equal(robot?.materials?.base_link?.texture, 'ambulance/materials/textures/ambulance.png');
});

test('parseSDF preserves OBJ multi-material texture palettes and cross-model texture references', () => {
  const robot = parseSDF(
    `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="bus_fixture">
    <link name="base_link">
      <visual name="body">
        <geometry>
          <mesh>
            <uri>model://bus/meshes/bus.obj</uri>
          </mesh>
        </geometry>
      </visual>
    </link>
  </model>
</sdf>`,
    {
      sourcePath: 'bus/model.sdf',
      allFileContents: {
        'bus/meshes/bus.obj': `mtllib bus.mtl
usemtl Bus
usemtl Wheels_01
o BusBody`,
        'bus/meshes/bus.mtl': `newmtl Bus
map_Kd bus.png

newmtl Wheels_01
map_Kd model://suv/materials/textures/wheels_01.png`,
      },
      availableFiles: [
        { name: 'bus/model.sdf' },
        { name: 'bus/meshes/bus.obj' },
        { name: 'bus/meshes/bus.mtl' },
        { name: 'bus/materials/textures/bus.png' },
        { name: 'suv/materials/textures/wheels_01.png' },
      ],
    },
  );

  assert.ok(robot);
  assert.deepEqual(robot?.links.base_link.visual.authoredMaterials, [
    { name: 'Bus', texture: 'bus/materials/textures/bus.png' },
    { name: 'Wheels_01', texture: 'suv/materials/textures/wheels_01.png' },
  ]);
  assert.equal(robot?.materials?.base_link?.texture, 'bus/materials/textures/bus.png');
});

test('parseSDF expands included models with namespaced links and include poses', () => {
  const robot = parseSDF(
    `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="parent">
    <include>
      <name>child_box</name>
      <pose>1 2 3 0 0 0</pose>
      <uri>model://child_box</uri>
    </include>
  </model>
</sdf>`,
    {
      sourcePath: 'parent/model.sdf',
      allFileContents: {
        'child_box/model.sdf': `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="child_box">
    <link name="box">
      <visual name="body">
        <geometry>
          <box>
            <size>1 1 1</size>
          </box>
        </geometry>
      </visual>
    </link>
  </model>
</sdf>`,
      },
    },
  );

  assert.ok(robot);
  assert.ok(robot?.links['child_box::box']);
  assert.ok(robot?.links['child_box::box__root']);
  assert.equal(robot?.joints['child_box::box__root_fixed']?.childLinkId, 'child_box::box');
  assert.deepEqual(robot?.joints['child_box::box__root_fixed']?.origin.xyz, { x: 1, y: 2, z: 3 });
});

test('parseSDF overrides an included model own pose with the include pose per SDFormat semantics', () => {
  // SDFormat <include><pose> overrides the included model's top-level <pose>
  // (it does NOT compose with it). The gimbal pattern: a model file authored
  // with a standalone spawn pose (here z=0.18) that must be replaced by the
  // mount pose (here x=2) when included. Composing would put the base link at
  // z=0.18; overriding puts it at z=0.
  const robot = parseSDF(
    `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="parent">
    <include>
      <pose>2 0 0 0 0 0</pose>
      <uri>model://child</uri>
    </include>
  </model>
</sdf>`,
    {
      sourcePath: 'parent/model.sdf',
      allFileContents: {
        'child/model.sdf': `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="child">
    <pose>0 0 0.18 0 0 0</pose>
    <link name="base">
      <visual name="body">
        <geometry>
          <box>
            <size>1 1 1</size>
          </box>
        </geometry>
      </visual>
    </link>
  </model>
</sdf>`,
      },
    },
  );

  assert.ok(robot);
  assert.deepEqual(robot?.joints['child::base__root_fixed']?.origin.xyz, { x: 2, y: 0, z: 0 });
});

test('parseSDF lets parent joints target included model links without injecting duplicate root anchors', () => {
  const robot = parseSDF(
    `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="assembly">
    <include>
      <name>arm</name>
      <uri>model://arm</uri>
    </include>
    <include>
      <name>gripper</name>
      <pose>2 0 0 0 0 0</pose>
      <uri>model://gripper</uri>
    </include>
    <joint name="mount" type="fixed">
      <parent>arm::tip</parent>
      <child>gripper::base</child>
    </joint>
  </model>
</sdf>`,
    {
      sourcePath: 'assembly/model.sdf',
      allFileContents: {
        'arm/model.sdf': `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="arm">
    <link name="base">
      <visual name="body">
        <geometry>
          <box>
            <size>1 1 1</size>
          </box>
        </geometry>
      </visual>
    </link>
    <link name="tip">
      <pose>1 0 0 0 0 0</pose>
      <visual name="body">
        <geometry>
          <box>
            <size>0.5 0.5 0.5</size>
          </box>
        </geometry>
      </visual>
    </link>
    <joint name="arm_joint" type="fixed">
      <parent>base</parent>
      <child>tip</child>
    </joint>
  </model>
</sdf>`,
        'gripper/model.sdf': `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="gripper">
    <link name="base">
      <visual name="body">
        <geometry>
          <box>
            <size>0.25 0.25 0.25</size>
          </box>
        </geometry>
      </visual>
    </link>
  </model>
</sdf>`,
      },
    },
  );

  assert.ok(robot);
  assert.equal(robot?.joints.mount?.parentLinkId, 'arm::tip');
  assert.equal(robot?.joints.mount?.childLinkId, 'gripper::base');
  assert.deepEqual(robot?.joints.mount?.origin.xyz, { x: 1, y: 0, z: 0 });
  assert.equal(robot?.links['gripper::base__root'], undefined);
  assert.equal(robot?.joints['gripper::base__root_fixed'], undefined);
});

test('parseSDF resolves included sibling models from availableFiles when allFileContents omits them', () => {
  // Simulates the real import pipeline: nested `.sdf` files are robot files in
  // `availableFiles` (not text files in `allFileContents`), so the include
  // resolver must consult availableFiles to find `model://child_box`.
  const robot = parseSDF(
    `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="parent">
    <include>
      <name>child_box</name>
      <pose>1 2 3 0 0 0</pose>
      <uri>model://child_box</uri>
    </include>
  </model>
</sdf>`,
    {
      sourcePath: 'parent/model.sdf',
      allFileContents: {},
      availableFiles: [
        {
          name: 'parent/model.sdf',
          format: 'sdf',
          content: '<?xml version="1.0"?><sdf version="1.7"><model name="parent"></model></sdf>',
        },
        {
          name: 'child_box/model.sdf',
          format: 'sdf',
          content: `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="child_box">
    <link name="box">
      <visual name="body">
        <geometry>
          <box>
            <size>1 1 1</size>
          </box>
        </geometry>
      </visual>
    </link>
  </model>
</sdf>`,
        },
      ],
    },
  );

  assert.ok(robot, 'parseSDF returned null — sibling include was not resolved from availableFiles');
  assert.ok(robot?.links['child_box::box']);
  assert.deepEqual(robot?.joints['child_box::box__root_fixed']?.origin.xyz, { x: 1, y: 2, z: 3 });
});

test('parseSDF reuses one SDF include index while resolving multiple includes', () => {
  const allFileContents = {
    'arm/model.sdf': `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="arm">
    <link name="base">
      <visual name="body">
        <geometry>
          <box>
            <size>1 1 1</size>
          </box>
        </geometry>
      </visual>
    </link>
  </model>
</sdf>`,
    'gripper/model.sdf': `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="gripper">
    <link name="base">
      <visual name="body">
        <geometry>
          <box>
            <size>0.25 0.25 0.25</size>
          </box>
        </geometry>
      </visual>
    </link>
  </model>
</sdf>`,
  };
  const originalEntries = Object.entries;
  let includeFileContentScans = 0;
  Object.entries = ((value: object) => {
    if (value === allFileContents) {
      includeFileContentScans += 1;
    }
    return originalEntries(value);
  }) as typeof Object.entries;

  try {
    const robot = parseSDF(
      `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="assembly">
    <include>
      <name>arm</name>
      <uri>model://arm</uri>
    </include>
    <include>
      <name>gripper</name>
      <uri>model://gripper</uri>
    </include>
  </model>
</sdf>`,
      {
        sourcePath: 'assembly/model.sdf',
        allFileContents,
      },
    );

    assert.ok(robot);
    assert.ok(robot?.links['arm::base']);
    assert.ok(robot?.links['gripper::base']);
    assert.equal(includeFileContentScans, 1);
  } finally {
    Object.entries = originalEntries;
  }
});

test('resolveSdfIncludeSource keeps the legacy allFileContents API', () => {
  const resolved = resolveSdfIncludeSource('model://sensor', {
    'sensor/model.sdf': '<sdf version="1.7"><model name="sensor" /></sdf>',
  });

  assert.deepEqual(resolved, {
    path: 'sensor/model.sdf',
    content: '<sdf version="1.7"><model name="sensor" /></sdf>',
  });
});

test('parseSDF resolves URDF-style link poses relative to joint frames', () => {
  const robot = parseSDF(`<?xml version="1.0"?>
<sdf version="1.7">
  <model name="relative_joint_fixture">
    <link name="base">
      <visual name="body">
        <geometry>
          <box>
            <size>1 1 1</size>
          </box>
        </geometry>
      </visual>
    </link>
    <link name="tool">
      <pose relative_to="tool_joint">0 0 0 0 0 0</pose>
      <visual name="body">
        <geometry>
          <box>
            <size>0.1 0.1 0.1</size>
          </box>
        </geometry>
      </visual>
    </link>
    <joint name="tool_joint" type="fixed">
      <pose relative_to="base">0.1 0.2 0.3 0 1.5708 0</pose>
      <parent>base</parent>
      <child>tool</child>
    </joint>
  </model>
</sdf>`);

  assert.ok(robot);
  assert.deepEqual(robot?.joints.tool_joint.origin.xyz, { x: 0.1, y: 0.2, z: 0.3 });
  assert.ok(Math.abs((robot?.joints.tool_joint.origin.rpy.p ?? 0) - 1.5708) < 1e-5);
});

test('parseSDF preserves non-zero child link offsets relative to incoming joint frames via a synthetic stage link', () => {
  const robot = parseSDF(`<?xml version="1.0"?>
<sdf version="1.7">
  <model name="joint_stage_fixture">
    <link name="base">
      <visual name="body">
        <geometry>
          <box>
            <size>1 1 1</size>
          </box>
        </geometry>
      </visual>
    </link>
    <link name="finger">
      <pose relative_to="finger_joint">0 0 0.0005 0 0 0</pose>
      <visual name="body">
        <geometry>
          <box>
            <size>0.1 0.1 0.1</size>
          </box>
        </geometry>
      </visual>
    </link>
    <joint name="finger_joint" type="fixed">
      <pose relative_to="base">0.1 0.2 0.3 0 0 0</pose>
      <parent>base</parent>
      <child>finger</child>
    </joint>
  </model>
</sdf>`);

  assert.ok(robot);
  assert.equal(robot?.joints.finger_joint.childLinkId, 'finger__joint_stage_0');
  assert.ok(robot?.links['finger__joint_stage_0']);
  assert.deepEqual(robot?.joints['finger__joint_stage_0_fixed']?.origin.xyz, {
    x: 0,
    y: 0,
    z: 0.0005,
  });

  const worldMatrices = computeLinkWorldMatrices(robot!);
  const fingerPose = worldMatrices.finger;
  assert.ok(fingerPose);
  const position = {
    x: fingerPose.elements[12],
    y: fingerPose.elements[13],
    z: fingerPose.elements[14],
  };
  assert.deepEqual(position, { x: 0.1, y: 0.2, z: 0.3005 });
});

test('parseSDF keeps the Gazebo PR2 gripper closed-loop links inside one rooted tree', () => {
  const source = fs.readFileSync('test/gazebo_models/pr2/model.sdf', 'utf8');
  const robot = parseSDF(source, {
    sourcePath: 'pr2/model.sdf',
  });

  assert.ok(robot);
  assert.equal(robot?.joints.r_gripper_r_finger_joint?.parentLinkId, 'r_wrist_roll_link');
  assert.equal(robot?.joints.r_gripper_r_finger_joint?.childLinkId, 'r_gripper_r_finger_link');

  const childLinkIds = new Set(
    Object.values(robot?.joints ?? {}).map((joint) => joint.childLinkId),
  );
  const rootLinkIds = Object.keys(robot?.links ?? {}).filter((linkId) => !childLinkIds.has(linkId));

  assert.deepEqual(rootLinkIds, ['base_footprint']);
});

test('parseSDF honors joint poses specified in the child link frame by default', () => {
  const robot = parseSDF(`<?xml version="1.0"?>
<sdf version="1.7">
  <model name="joint_child_frame_fixture">
    <link name="base">
      <visual name="body">
        <geometry>
          <box>
            <size>1 1 1</size>
          </box>
        </geometry>
      </visual>
    </link>
    <link name="child">
      <pose relative_to="base">1 0 0 0 0 0</pose>
      <visual name="body">
        <geometry>
          <box>
            <size>0.1 0.1 0.1</size>
          </box>
        </geometry>
      </visual>
    </link>
    <joint name="joint" type="fixed">
      <pose>0.2 0 0 0 0 0</pose>
      <parent>base</parent>
      <child>child</child>
    </joint>
  </model>
</sdf>`);

  assert.ok(robot);
  assert.deepEqual(robot?.joints.joint.origin.xyz, { x: 1.2, y: 0, z: 0 });
});

test('parseSDF resolves explicit model frames referenced by link poses', () => {
  const robot = parseSDF(`<?xml version="1.0"?>
<sdf version="1.7">
  <model name="frame_fixture">
    <link name="base">
      <visual name="body">
        <geometry>
          <box>
            <size>1 1 1</size>
          </box>
        </geometry>
      </visual>
    </link>
    <frame name="mount" attached_to="base">
      <pose>0 0 0.5 0 0 0</pose>
    </frame>
    <link name="sensor">
      <pose relative_to="mount">0.1 0 0 0 0 0</pose>
      <visual name="body">
        <geometry>
          <box>
            <size>0.1 0.1 0.1</size>
          </box>
        </geometry>
      </visual>
    </link>
    <joint name="sensor_joint" type="fixed">
      <parent>base</parent>
      <child>sensor</child>
    </joint>
  </model>
</sdf>`);

  assert.ok(robot);
  assert.deepEqual(robot?.joints.sensor_joint.origin.xyz, { x: 0.1, y: 0, z: 0.5 });
});

test('parseSDF tolerates Gazebo fixture XML quirks that browsers reject by default', () => {
  const fixtures = [
    'mpl_right_arm',
    'mpl_right_forearm',
    'src_doorway',
    'submarine',
    'submarine_buoyant',
    'submarine_sinking',
  ] as const;

  fixtures.forEach((fixtureName) => {
    const source = fs.readFileSync(`test/gazebo_models/${fixtureName}/model.sdf`, 'utf8');
    const robot = parseSDF(source, {
      sourcePath: `${fixtureName}/model.sdf`,
    });

    assert.ok(robot, `expected ${fixtureName} Gazebo fixture to parse`);
    assert.equal(robot?.name, fixtureName);
  });
});

test('parseSDF imports standalone Gazebo light definitions as empty placeholder models', () => {
  const source = fs.readFileSync('test/gazebo_models/sun/model.sdf', 'utf8');
  const robot = parseSDF(source, {
    sourcePath: 'sun/model.sdf',
  });

  assert.ok(robot);
  assert.equal(robot?.name, 'sun');
  assert.ok(robot?.links.sun__light_anchor);
  assert.equal(robot?.links.sun__light_anchor.visual.type, GeometryType.NONE);
  assert.equal(Object.keys(robot?.joints ?? {}).length, 0);
});

test('parseSDF converts revolute joints without <limit> into continuous joints', () => {
  const robot = parseSDF(`<?xml version="1.0"?>
<sdf version="1.6">
  <model name="unlimited_revolute_fixture">
    <link name="base" />
    <link name="spin" />
    <joint name="spin_joint" type="revolute">
      <parent>base</parent>
      <child>spin</child>
      <axis>
        <xyz>0 0 1</xyz>
      </axis>
    </joint>
    <link name="hinge" />
    <joint name="hinge_joint" type="revolute">
      <parent>base</parent>
      <child>hinge</child>
      <axis>
        <xyz>0 1 0</xyz>
        <limit>
          <lower>-1.5</lower>
          <upper>1.5</upper>
        </limit>
      </axis>
    </joint>
  </model>
</sdf>`);

  assert.ok(robot);

  // Revolute without <limit> -> continuous with no limit object.
  assert.equal(robot?.joints.spin_joint.type, JointType.CONTINUOUS);
  assert.equal(robot?.joints.spin_joint.limit, undefined);
  assert.deepEqual(robot?.joints.spin_joint.axis, { x: 0, y: 0, z: 1 });

  // Revolute with explicit <limit> stays revolute with finite bounds.
  assert.equal(robot?.joints.hinge_joint.type, JointType.REVOLUTE);
  assert.equal(robot?.joints.hinge_joint.limit?.lower, -1.5);
  assert.equal(robot?.joints.hinge_joint.limit?.upper, 1.5);
});

test('parseSDF converts revolute joints with an effort-only <limit> into continuous joints', () => {
  // youbot wheels/casters declare <limit><effort>1.0</effort></limit> with no
  // angle bounds, which Gazebo reads as unlimited rotation. The parser must
  // convert the joint to continuous (so no -Infinity/+Infinity angle bounds
  // are emitted) while preserving the finite effort the author declared —
  // otherwise the missing <lower>/<upper> fall back to -Infinity/+Infinity and
  // the canonical workspace validator rejects them ("must be a finite number").
  const robot = parseSDF(`<?xml version="1.0"?>
<sdf version="1.6">
  <model name="effort_only_limit_fixture">
    <link name="base" />
    <link name="wheel" />
    <joint name="wheel_joint" type="revolute">
      <parent>base</parent>
      <child>wheel</child>
      <axis>
        <xyz>0 1 0</xyz>
        <limit>
          <effort>1.0</effort>
        </limit>
      </axis>
    </joint>
  </model>
</sdf>`);

  assert.ok(robot);
  assert.equal(robot?.joints.wheel_joint.type, JointType.CONTINUOUS);
  assert.deepEqual(robot?.joints.wheel_joint.limit, { effort: 1.0 });
});
