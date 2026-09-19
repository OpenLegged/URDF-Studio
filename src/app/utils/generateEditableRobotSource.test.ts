import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { parseURDF } from '@/core/parsers';
import { DEFAULT_LINK, GeometryType, JointType, type RobotClosedLoopJointConstraint, type RobotFile, type RobotState, type UrdfVisual } from '@/types';

import { parseEditableRobotSource } from './parseEditableRobotSource.ts';
import {
  generateEditableRobotSource,
  tryGenerateEditableRobotSource,
  type GenerateEditableRobotSourceFormat,
} from './generateEditableRobotSource.ts';

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

const unavailableGeometries: {
  format: GenerateEditableRobotSourceFormat;
  geometry: Partial<UrdfVisual>;
}[] = [
  { format: 'urdf', geometry: { type: GeometryType.PLANE } },
  { format: 'urdf', geometry: { type: GeometryType.ELLIPSOID } },
  { format: 'xacro', geometry: { type: GeometryType.HFIELD } },
  { format: 'urdf', geometry: { type: GeometryType.MESH, meshPath: '' } },
  { format: 'sdf', geometry: { type: GeometryType.ELLIPSOID } },
  { format: 'sdf', geometry: { type: GeometryType.SDF, meshPath: 'shape.obj' } },
  { format: 'sdf', geometry: { type: GeometryType.MESH, meshPath: '' } },
  { format: 'sdf', geometry: { type: GeometryType.HFIELD } },
  { format: 'sdf', geometry: { type: GeometryType.POLYLINE, polylinePoints: [] } },
  { format: 'mjcf', geometry: { type: GeometryType.POLYLINE } },
];

for (const { format, geometry } of unavailableGeometries) {
  test(`editable ${format} source cannot silently replace ${geometry.type} geometry`, (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const error = t.mock.method(console, 'error', () => {});

    for (const slot of ['visual', 'collision', 'visualBodies', 'collisionBodies'] as const) {
      const robotState = createRobotState();
      const link = robotState.links.base_link;
      const shape = { ...structuredClone(DEFAULT_LINK.visual), ...geometry };
      if (slot === 'visual' || slot === 'collision') link[slot] = shape;
      else link[slot] = [shape];
      const before = structuredClone(robotState);

      assert.equal(tryGenerateEditableRobotSource({ format, robotState }), null, slot);
      assert.deepEqual(robotState, before);
    }

    assert.equal(warn.mock.callCount(), 0);
    assert.equal(error.mock.callCount(), 0);
  });
}

test('editable MJCF source still preserves an inline mesh without an external file', () => {
  const robotState = createRobotState();
  robotState.links.base_link.visual = {
    ...structuredClone(DEFAULT_LINK.visual),
    type: GeometryType.MESH,
    dimensions: { x: 1, y: 1, z: 1 },
    assetRef: 'inline_mesh',
    mjcfMesh: { vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] },
  };

  const content = tryGenerateEditableRobotSource({ format: 'mjcf', robotState });
  assert.ok(content);
  assert.match(content, /vertex="0 0 0 1 0 0 0 1 0 0 0 1"/);
  assert.match(content, /type="mesh"/);
});

const preservedGeometries: {
  format: GenerateEditableRobotSourceFormat;
  geometry: Partial<UrdfVisual>;
}[] = [
  { format: 'urdf', geometry: { type: GeometryType.CAPSULE } },
  { format: 'xacro', geometry: { type: GeometryType.CAPSULE } },
  { format: 'mjcf', geometry: { type: GeometryType.ELLIPSOID } },
  {
    format: 'sdf',
    geometry: {
      type: GeometryType.POLYLINE,
      polylinePoints: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
      polylineHeight: 1,
    },
  },
];

for (const { format, geometry } of preservedGeometries) {
  test(`editable ${format} source preserves supported ${geometry.type} geometry`, () => {
    const robotState = createRobotState();
    robotState.links.base_link.visual = { ...structuredClone(DEFAULT_LINK.visual), ...geometry };
    const content = tryGenerateEditableRobotSource({ format, robotState });
    assert.ok(content);
    const parsed = parseEditableRobotSource({
      file: { name: `model.${format}`, format },
      content,
      availableFiles: [],
      allFileContents: {},
    });
    assert.ok(parsed);
    assert.equal(parsed.links.base_link.visual.type, geometry.type);
  });
}

test('explicit generation can still produce a supported export approximation', () => {
  const robotState = createRobotState();
  robotState.links.base_link.visual.type = GeometryType.ELLIPSOID;
  assert.match(generateEditableRobotSource({ format: 'sdf', robotState }), /<box>/);
  assert.equal(tryGenerateEditableRobotSource({ format: 'sdf', robotState }), null);
});

test('resolveEditableRobotSourceFormat degrades URDF source with closed loops to SDF', async () => {
  const { resolveEditableRobotSourceFormat } = await import('./generateEditableRobotSource.ts');
  const robotState = createRobotState();

  // Without closed loops the URDF source stays URDF.
  assert.equal(resolveEditableRobotSourceFormat(robotState), 'urdf');

  const loopedRobot = {
    ...robotState,
    closedLoopConstraints: [
      {
        id: 'loop_1',
        type: 'joint',
        jointType: JointType.REVOLUTE,
        linkAId: 'base_link',
        linkBId: 'tool_link',
        anchorLocalA: { x: 0, y: 0, z: 0 },
        anchorLocalB: { x: 0, y: 0, z: 0 },
        anchorWorld: { x: 0, y: 0, z: 0 },
        axis: { x: 0, y: 0, z: 1 },
      } satisfies RobotClosedLoopJointConstraint,
    ],
  };
  assert.equal(resolveEditableRobotSourceFormat(loopedRobot), 'sdf');
  assert.equal(resolveEditableRobotSourceFormat(loopedRobot, 'xacro'), 'sdf');
  // Hinge loop semantics require SDF, even when the original source was MJCF.
  assert.equal(resolveEditableRobotSourceFormat(loopedRobot, 'mjcf'), 'sdf');
  assert.equal(resolveEditableRobotSourceFormat(loopedRobot, 'sdf'), 'sdf');
  // A fallback preference must not select a lossy representation.
  assert.equal(
    resolveEditableRobotSourceFormat(loopedRobot, undefined, {
      closedLoopFallbackFormat: 'mjcf',
    }),
    'sdf',
  );
  assert.equal(
    resolveEditableRobotSourceFormat(loopedRobot, 'xacro', {
      closedLoopFallbackFormat: 'mjcf',
    }),
    'sdf',
  );

  // The degraded SDF source must actually generate and carry the loop joint.
  const sdfSource = tryGenerateEditableRobotSource({
    format: 'sdf',
    robotState: loopedRobot,
    preserveMeshPaths: true,
  });
  assert.ok(sdfSource, 'expected the looped robot to generate editable SDF source');
  assert.match(sdfSource, /<joint name="loop_1" type="revolute">/);
  assert.match(sdfSource, /<axis>/);
  assert.equal(tryGenerateEditableRobotSource({ format: 'mjcf', robotState: loopedRobot }), null);
  loopedRobot.joints.tool_joint.type = JointType.BALL;
  assert.equal(resolveEditableRobotSourceFormat(loopedRobot, 'urdf'), 'sdf');
});
