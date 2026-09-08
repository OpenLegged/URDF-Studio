import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { parseURDF } from '@/core/parsers';
import { DEFAULT_LINK, GeometryType, type RobotFile, type RobotState } from '@/types';

import { parseEditableRobotSource } from './parseEditableRobotSource.ts';
import { generateEditableRobotSource } from './generateEditableRobotSource.ts';

const { window } = new JSDOM();

if (!globalThis.DOMParser) {
  globalThis.DOMParser = window.DOMParser;
}

if (!globalThis.XMLSerializer) {
  globalThis.XMLSerializer = window.XMLSerializer;
}

const demoUrdfSource = `<?xml version="1.0"?>
<robot name="demo">
  <link name="base_link">
    <visual>
      <origin xyz="0 0 0.1" rpy="0 0 0" />
      <geometry>
        <box size="1 2 3" />
      </geometry>
    </visual>
    <collision>
      <geometry>
        <box size="1 2 3" />
      </geometry>
    </collision>
    <inertial>
      <origin xyz="0 0 0" rpy="0 0 0" />
      <mass value="1" />
      <inertia ixx="1" ixy="0" ixz="0" iyy="1" iyz="0" izz="1" />
    </inertial>
  </link>
  <link name="tool_link" />
  <joint name="tool_joint" type="revolute">
    <parent link="base_link" />
    <child link="tool_link" />
    <origin xyz="0 0 1" rpy="0 0 0" />
    <axis xyz="0 0 1" />
    <limit lower="-1" upper="1" effort="2" velocity="3" />
  </joint>
</robot>`;

function createRobotState(): RobotState {
  const parsed = parseURDF(demoUrdfSource);
  assert.ok(parsed, 'expected demo URDF to parse');

  return {
    ...parsed,
    selection: { type: null, id: null },
  };
}

function assertRoundTrip(
  format: RobotFile['format'],
  content: string,
  expectedRootPattern: RegExp,
): void {
  assert.match(content, expectedRootPattern);

  const parsed = parseEditableRobotSource({
    file: {
      name: `robots/demo/model.${format === 'xacro' ? 'urdf.xacro' : format}`,
      format,
    },
    content,
    availableFiles: [],
    allFileContents: {},
  });

  assert.ok(parsed);
  assert.equal(parsed?.name, 'demo');
  assert.ok(parsed?.links.base_link);
  assert.ok(parsed?.links.tool_link);
  assert.ok(parsed?.joints.tool_joint);
  const toolJoint = parsed.joints.tool_joint;
  assert.ok(toolJoint.axis);
  assert.equal(toolJoint.axis.z, 1);
}

test('generateEditableRobotSource round-trips URDF output', () => {
  const content = generateEditableRobotSource({
    format: 'urdf',
    robotState: createRobotState(),
  });

  assertRoundTrip('urdf', content, /<robot\b/i);
});

test('generateEditableRobotSource preserves URDF mesh paths by default', () => {
  const robotState: RobotState = {
    name: 'pr2',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          meshPath: 'pr2_description/meshes/base_v0/base.stl',
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.MESH,
          meshPath: 'pr2_description/meshes/base_v0/base_L.stl',
        },
      },
    },
    joints: {},
    selection: { type: null, id: null },
  };

  const content = generateEditableRobotSource({
    format: 'urdf',
    robotState,
  });

  assert.match(content, /filename="pr2_description\/meshes\/base_v0\/base\.stl"/);
  assert.match(content, /filename="pr2_description\/meshes\/base_v0\/base_L\.stl"/);
  assert.doesNotMatch(content, /package:\/\/pr2\/meshes\/pr2_description\//);
});

test('generateEditableRobotSource emits paint material colors for mesh material groups', () => {
  const robotState: RobotState = {
    name: 'paint_demo',
    rootLinkId: 'link1',
    links: {
      link1: {
        ...DEFAULT_LINK,
        id: 'link1',
        name: 'link1',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          meshPath: 'meshes/cube.obj',
          color: '#808080',
          authoredMaterials: [
            { name: 'base', color: '#808080' },
            { name: 'paint_link1_0_1', color: '#007aff' },
          ],
          meshMaterialGroups: [{ meshKey: '0', start: 0, count: 6, materialIndex: 1 }],
        },
      },
    },
    joints: {},
    selection: { type: null, id: null },
  };

  const content = generateEditableRobotSource({
    format: 'urdf',
    robotState,
  });

  assert.match(content, /<material name="paint_link1_0_1">/);
  assert.match(content, /<color rgba="0\.00000392 0\.47843529 1\.00000000 1\.00000000"\/>/);
});

test('generateEditableRobotSource round-trips SDF output', () => {
  const content = generateEditableRobotSource({
    format: 'sdf',
    robotState: createRobotState(),
  });

  assertRoundTrip('sdf', content, /<sdf\b/i);
});

test('generateEditableRobotSource round-trips MJCF output', () => {
  const content = generateEditableRobotSource({
    format: 'mjcf',
    robotState: createRobotState(),
  });

  assertRoundTrip('mjcf', content, /<mujoco\b/i);
});

test('MJCF source editing retains incomplete authored inertia without loading collision meshes', () => {
  const robotState = createRobotState();
  const link = robotState.links.base_link;
  link.inertial!.mass = 7;
  link.inertial!.inertia = { ixx: 0, iyy: 0, izz: 0, ixy: 0, ixz: 0, iyz: 0 };
  link.collision.type = GeometryType.MESH;
  link.collision.meshPath = 'collision.stl';
  const before = structuredClone(robotState);
  const content = generateEditableRobotSource({ format: 'mjcf', robotState });
  const document = new DOMParser().parseFromString(content, 'text/xml');
  const inertial = document.querySelector('body[name="base_link"] > inertial');
  assert.equal(inertial?.getAttribute('mass'), '7');
  assert.equal(inertial?.getAttribute('diaginertia'), '0 0 0');
  assert.deepEqual(robotState, before);
});

test('generateEditableRobotSource normalizes Xacro edits to editable robot XML', () => {
  const content = generateEditableRobotSource({
    format: 'xacro',
    robotState: createRobotState(),
  });

  assert.doesNotMatch(content, /xacro:/i);
  assertRoundTrip('xacro', content, /<robot\b/i);
});
