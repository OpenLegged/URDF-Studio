import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { GeometryType, JointType, type RobotState } from '@/types';
import { computeUsdInertiaProperties } from '@/shared/utils/inertiaUsd.ts';
import { exportRobotToUsd } from './usdExport.ts';

const BASE_COLOR_TEXTURE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==';

if (typeof globalThis.ProgressEvent === 'undefined') {
  class ProgressEventPolyfill extends Event {
    loaded: number;
    total: number;
    lengthComputable: boolean;

    constructor(
      type: string,
      init: { loaded?: number; total?: number; lengthComputable?: boolean } = {},
    ) {
      super(type);
      this.loaded = init.loaded ?? 0;
      this.total = init.total ?? 0;
      this.lengthComputable = init.lengthComputable ?? false;
    }
  }

  globalThis.ProgressEvent = ProgressEventPolyfill as typeof ProgressEvent;
}

function createTwoLinkAssets(): Record<string, string> {
  return {
    'textures/base_color.png': BASE_COLOR_TEXTURE_DATA_URL,
  };
}

function createTwoLinkRobot(): RobotState {
  return {
    name: 'two_link_robot',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    joints: {
      joint_link1: {
        id: 'joint_link1',
        name: 'joint_link1',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'link1',
        origin: { xyz: { x: 1, y: 2, z: 3 }, rpy: { r: 0, p: 0, y: Math.PI / 2 } },
        axis: { x: 0, y: 0, z: 1 },
        angle: 0,
        limit: { lower: -Math.PI / 2, upper: Math.PI / 3, effort: 12, velocity: 4 },
        dynamics: { damping: 0.1, friction: 0.2 },
        hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
      },
    },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 0.4, y: 0.2, z: 0.1 },
          color: '#4f46e5',
          origin: { xyz: { x: 0.25, y: 0.5, z: 0.75 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.BOX,
          dimensions: { x: 0.5, y: 0.3, z: 0.2 },
          color: '#ef4444',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 2,
          origin: { xyz: { x: 0.01, y: 0.02, z: 0.03 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 0.1, ixy: 0, ixz: 0, iyy: 0.2, iyz: 0, izz: 0.3 },
        },
      },
      link1: {
        id: 'link1',
        name: 'link1',
        visible: true,
        visual: {
          type: GeometryType.CYLINDER,
          dimensions: { x: 0.08, y: 0.6, z: 0 },
          color: '#22c55e',
          origin: { xyz: { x: 0, y: 0, z: 0.3 }, rpy: { r: 0, p: Math.PI / 2, y: 0 } },
        },
        collision: {
          type: GeometryType.SPHERE,
          dimensions: { x: 0.12, y: 0, z: 0 },
          color: '#f59e0b',
          origin: { xyz: { x: 0, y: 0, z: 0.6 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1.25,
          origin: { xyz: { x: 0.1, y: 0.2, z: 0.3 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 2, iyz: 0, izz: 3 },
        },
      },
    },
    materials: {
      base_link: {
        color: '#12ab34',
        texture: 'textures/base_color.png',
      },
    },
  };
}

function createMjcfSyntheticAttachmentRobot(): RobotState {
  return {
    name: 'mjcf_attachment_robot',
    rootLinkId: 'world',
    selection: { type: null, id: null },
    joints: {
      world_to_base: {
        id: 'world_to_base',
        name: 'world_to_base',
        type: JointType.FIXED,
        parentLinkId: 'world',
        childLinkId: 'base',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        axis: { x: 1, y: 0, z: 0 },
        angle: 0,
        limit: { lower: 0, upper: 0, effort: 0, velocity: 0 },
        dynamics: { damping: 0, friction: 0 },
        hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
      },
      base_to_base_geom_1: {
        id: 'base_to_base_geom_1',
        name: 'base_to_base_geom_1',
        type: JointType.FIXED,
        parentLinkId: 'base',
        childLinkId: 'base_geom_1',
        origin: { xyz: { x: 0.1, y: 0.2, z: 0.3 }, rpy: { r: 0, p: 0, y: Math.PI / 2 } },
        axis: { x: 1, y: 0, z: 0 },
        angle: 0,
        limit: { lower: 0, upper: 0, effort: 0, velocity: 0 },
        dynamics: { damping: 0, friction: 0 },
        hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
      },
    },
    links: {
      world: {
        id: 'world',
        name: 'world',
        visible: true,
        visual: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 0,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
        },
      },
      base: {
        id: 'base',
        name: 'base',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 0.4, y: 0.2, z: 0.1 },
          color: '#4f46e5',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.BOX,
          dimensions: { x: 0.4, y: 0.2, z: 0.1 },
          color: '#ef4444',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 2,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 0.1, ixy: 0, ixz: 0, iyy: 0.2, iyz: 0, izz: 0.3 },
        },
      },
      base_geom_1: {
        id: 'base_geom_1',
        name: 'base_geom_1',
        visible: true,
        visual: {
          type: GeometryType.CYLINDER,
          dimensions: { x: 0.06, y: 0.3, z: 0 },
          color: '#22c55e',
          origin: { xyz: { x: 0.3, y: 0, z: 0 }, rpy: { r: 0, p: Math.PI / 2, y: 0 } },
        },
        collision: {
          type: GeometryType.SPHERE,
          dimensions: { x: 0.08, y: 0, z: 0 },
          color: '#f59e0b',
          origin: { xyz: { x: 0.3, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 0,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
        },
      },
    },
    materials: {},
    inspectionContext: {
      sourceFormat: 'mjcf',
      mjcf: {
        siteCount: 0,
        tendonCount: 0,
        tendonActuatorCount: 0,
        bodiesWithSites: [],
        tendons: [],
      },
    },
  };
}

async function readArchiveText(
  payload: Awaited<ReturnType<typeof exportRobotToUsd>>,
  path: string,
) {
  const entry = payload.archiveFiles.get(path);
  assert.ok(entry, `missing archive entry: ${path}`);
  return entry.text();
}

function createGridStlBlob(cellCount = 8) {
  const lines = ['solid grid'];

  for (let y = 0; y < cellCount; y += 1) {
    for (let x = 0; x < cellCount; x += 1) {
      const x0 = x;
      const x1 = x + 1;
      const y0 = y;
      const y1 = y + 1;

      lines.push('facet normal 0 0 1');
      lines.push('outer loop');
      lines.push(`vertex ${x0} ${y0} 0`);
      lines.push(`vertex ${x1} ${y0} 0`);
      lines.push(`vertex ${x1} ${y1} 0`);
      lines.push('endloop');
      lines.push('endfacet');

      lines.push('facet normal 0 0 1');
      lines.push('outer loop');
      lines.push(`vertex ${x0} ${y0} 0`);
      lines.push(`vertex ${x1} ${y1} 0`);
      lines.push(`vertex ${x0} ${y1} 0`);
      lines.push('endloop');
      lines.push('endfacet');
    }
  }

  lines.push('endsolid grid');
  return new Blob([lines.join('\n')], { type: 'model/stl' });
}

function createUvObjBlob() {
  return new Blob(
    [
      [
        'o textured_triangle',
        'v 0 0 0',
        'v 1 0 0',
        'v 0 1 0',
        'vt 0 0',
        'vt 1 0',
        'vt 0 1',
        'f 1/1 2/2 3/3',
      ].join('\n'),
    ],
    { type: 'text/plain;charset=utf-8' },
  );
}

function createNormalObjBlob() {
  return new Blob(
    [
      [
        'o shaded_triangle',
        'v 0 0 0',
        'v 1 0 0',
        'v 0 1 0',
        'vn 0 0 1',
        'vn 0 0 1',
        'vn 0 0 1',
        'f 1//1 2//2 3//3',
      ].join('\n'),
    ],
    { type: 'text/plain;charset=utf-8' },
  );
}

function createMeshRobot(meshPath: string): RobotState {
  return {
    name: 'mesh_robot',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    joints: {},
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          meshPath,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#6699ff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#000000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
      },
    },
    materials: {},
  };
}

function createSharedMeshRobot(meshPath: string): RobotState {
  return {
    name: 'shared_mesh_robot',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    joints: {
      child_joint: {
        id: 'child_joint',
        name: 'child_joint',
        type: JointType.FIXED,
        parentLinkId: 'base_link',
        childLinkId: 'child_link',
        origin: { xyz: { x: 0.5, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        axis: { x: 1, y: 0, z: 0 },
        angle: 0,
        dynamics: { damping: 0, friction: 0 },
        hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
      },
    },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          meshPath,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#ffffff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#000000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
      },
      child_link: {
        id: 'child_link',
        name: 'child_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          meshPath,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#ffffff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#000000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
      },
    },
    materials: {},
  };
}

function createTexturedMeshRobot(meshPath: string, texturePath: string): RobotState {
  const robot = createMeshRobot(meshPath);
  robot.links.base_link.visual.color = '#ffffff';
  robot.materials = {
    base_link: {
      color: '#ffffff',
      texture: texturePath,
    },
  };
  return robot;
}

function createBoxFaceTextureRobot(): RobotState {
  return {
    name: 'box_face_robot',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    joints: {},
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 0.4, y: 0.3, z: 0.2 },
          color: '#ffffff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          authoredMaterials: [
            { texture: 'textures/right.png', opacity: 0.25 },
            { texture: 'textures/left.png' },
            { texture: 'textures/up.png' },
            { texture: 'textures/down.png' },
            { texture: 'textures/front.png' },
            { texture: 'textures/back.png' },
          ],
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#000000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
      },
    },
    materials: {},
  };
}

function extractTriangleCount(baseLayer: string) {
  const match = baseLayer.match(/int\[] faceVertexCounts = \[([^\]]*)\]/);
  assert.ok(match, 'expected serialized mesh faceVertexCounts');
  return match[1]
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0).length;
}

function extractTuples(text: string, attributeName: string): number[][] {
  const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Array.from(text.matchAll(new RegExp(`${escapedName} = \\(([^)]+)\\)`, 'g'))).map((match) =>
    match[1].split(',').map((value) => Number(value.trim())),
  );
}

function assertQuaternionClose(
  actualWxyz: number[],
  expected: THREE.Quaternion,
  epsilon = 1e-5,
): void {
  const actual = new THREE.Quaternion(
    actualWxyz[1] ?? 0,
    actualWxyz[2] ?? 0,
    actualWxyz[3] ?? 0,
    actualWxyz[0] ?? 1,
  ).normalize();
  const target = expected.clone().normalize();
  const negatedTarget = new THREE.Quaternion(-target.x, -target.y, -target.z, -target.w);
  const delta = Math.min(actual.angleTo(target), actual.angleTo(negatedTarget));
  assert.ok(delta <= epsilon, `expected quaternions to match within ${epsilon}, got ${delta}`);
}

function includesQuaternionClose(
  actualWxyzTuples: number[][],
  expected: THREE.Quaternion,
  epsilon = 1e-5,
): boolean {
  return actualWxyzTuples.some((tuple) => {
    try {
      assertQuaternionClose(tuple, expected, epsilon);
      return true;
    } catch {
      return false;
    }
  });
}

test('exports robot state into a layered USD package', async () => {
  const payload = await exportRobotToUsd({
    robot: createTwoLinkRobot(),
    exportName: 'two_link_robot',
    assets: createTwoLinkAssets(),
  });

  assert.equal(payload.downloadFileName, 'two_link_robot.usd');
  assert.equal(payload.archiveFileName, 'two_link_robot_usd.zip');
  assert.equal(payload.rootLayerPath, 'two_link_robot/usd/two_link_robot.usd');
  assert.deepEqual(Array.from(payload.archiveFiles.keys()).sort(), [
    'two_link_robot/usd/assets/base_color.png',
    'two_link_robot/usd/configuration/two_link_robot_description_base.usd',
    'two_link_robot/usd/configuration/two_link_robot_description_physics.usd',
    'two_link_robot/usd/configuration/two_link_robot_description_sensor.usd',
    'two_link_robot/usd/two_link_robot.usd',
  ]);

  assert.match(payload.content, /^#usda 1.0/);
  assert.match(payload.content, /defaultPrim = "two_link_robot_description"/);
  assert.match(payload.content, /prepend variantSets = \["Physics", "Sensor"\]/);
  assert.match(
    payload.content,
    /prepend references = @configuration\/two_link_robot_description_base\.usd@/,
  );
  assert.match(
    payload.content,
    /prepend payload = @configuration\/two_link_robot_description_physics\.usd@/,
  );
  assert.match(
    payload.content,
    /prepend payload = @configuration\/two_link_robot_description_sensor\.usd@/,
  );
});

test('isaacsim USDA export keeps root stem without forcing _description sidecar names', async () => {
  const payload = await exportRobotToUsd({
    robot: createTwoLinkRobot(),
    exportName: 'go1',
    assets: createTwoLinkAssets(),
    fileFormat: 'usda',
    layoutProfile: 'isaacsim',
  });

  assert.equal(payload.downloadFileName, 'go1.usda');
  assert.equal(payload.archiveFileName, 'go1_usda.zip');
  assert.equal(payload.rootLayerPath, 'go1/go1.usda');
  assert.deepEqual(Array.from(payload.archiveFiles.keys()).sort(), [
    'go1/assets/base_color.png',
    'go1/configuration/go1_base.usda',
    'go1/configuration/go1_physics.usda',
    'go1/configuration/go1_robot.usda',
    'go1/configuration/go1_sensor.usda',
    'go1/go1.usda',
  ]);

  assert.match(payload.content, /defaultPrim = "go1"/);
  assert.match(payload.content, /prepend variantSets = \["Physics", "Sensor", "Robot"\]/);
  assert.match(payload.content, /prepend references = @configuration\/go1_base\.usda@/);
  assert.match(payload.content, /prepend payload = @configuration\/go1_physics\.usda@/);
  assert.match(payload.content, /prepend payload = @configuration\/go1_sensor\.usda@/);
  assert.match(payload.content, /prepend payload = @configuration\/go1_robot\.usda@/);
});

test('isaacsim USDA export writes OmniPBR material outputs for IsaacSim viewport colors', async () => {
  const payload = await exportRobotToUsd({
    robot: createTwoLinkRobot(),
    exportName: 'go1',
    assets: createTwoLinkAssets(),
    fileFormat: 'usda',
    layoutProfile: 'isaacsim',
  });

  const baseLayer = await readArchiveText(payload, 'go1/configuration/go1_base.usda');

  assert.match(
    baseLayer,
    /token outputs:surface\.connect = <\/go1\/Looks\/Material_0\/PreviewSurface\.outputs:surface>/,
  );
  assert.match(
    baseLayer,
    /token outputs:mdl:surface\.connect = <\/go1\/Looks\/Material_0\/OmniPBR\.outputs:out>/,
  );
  assert.match(baseLayer, /uniform asset info:mdl:sourceAsset = @OmniPBR\.mdl@/);
  assert.match(baseLayer, /uniform token info:mdl:sourceAsset:subIdentifier = "OmniPBR"/);
  assert.match(
    baseLayer,
    /color3f inputs:diffuse_color_constant = \(0\.006049, 0\.40724, 0\.03434\)/,
  );
});

test('isaacsim USDA export flattens link prim hierarchy for external articulation consumers', async () => {
  const payload = await exportRobotToUsd({
    robot: createTwoLinkRobot(),
    exportName: 'go1',
    assets: createTwoLinkAssets(),
    fileFormat: 'usda',
    layoutProfile: 'isaacsim',
  });

  const baseLayer = await readArchiveText(payload, 'go1/configuration/go1_base.usda');
  const physicsLayer = await readArchiveText(payload, 'go1/configuration/go1_physics.usda');
  const robotLayer = await readArchiveText(payload, 'go1/configuration/go1_robot.usda');
  const rootLayer = await readArchiveText(payload, 'go1/go1.usda');

  assert.match(baseLayer, /def Xform "base_link"/);
  assert.match(baseLayer, /def Xform "link1"/);
  assert.match(baseLayer, /def Scope "joints"/);
  assert.doesNotMatch(baseLayer, /\n        def Xform "link1"/);
  assert.match(baseLayer, /def Xform "link1"\n\s+\{\n\s+double3 xformOp:translate = \(1, 2, 3\)/);

  assert.match(physicsLayer, /rel physics:body0 = <\/go1\/base_link>/);
  assert.match(physicsLayer, /rel physics:body1 = <\/go1\/link1>/);
  assert.doesNotMatch(physicsLayer, /rel physics:body1 = <\/go1\/base_link\/link1>/);
  assert.match(
    rootLayer,
    /def PhysicsScene "physicsScene" \(\n\s+prepend apiSchemas = \["PhysxSceneAPI"\]\n\s*\)\n\{/,
  );
  assert.match(rootLayer, /uniform token physxScene:broadphaseType = "MBP"/);
  assert.match(rootLayer, /bool physxScene:enableCCD = true/);
  assert.match(rootLayer, /bool physxScene:enableGPUDynamics = false/);
  assert.match(rootLayer, /bool physxScene:enableStabilization = true/);
  assert.match(rootLayer, /uniform token physxScene:solverType = "TGS"/);
  assert.doesNotMatch(physicsLayer, /def PhysicsScene/);
  assert.match(
    physicsLayer,
    /over "base_link" \(\n\s+prepend apiSchemas = \["PhysicsRigidBodyAPI", "PhysicsMassAPI", "PhysicsArticulationRootAPI", "PhysxArticulationAPI"\]/,
  );
  assert.match(physicsLayer, /bool physxArticulation:enabledSelfCollisions = true/);
  assert.match(physicsLayer, /int physxArticulation:solverPositionIterationCount = 32/);
  assert.match(physicsLayer, /int physxArticulation:solverVelocityIterationCount = 1/);
  assert.match(
    physicsLayer,
    /prepend apiSchemas = \["PhysicsJointStateAPI:angular", "PhysxJointAPI", "PhysicsDriveAPI:angular", "IsaacJointAPI"\]/,
  );
  assert.match(physicsLayer, /float drive:angular:physics:stiffness = 625/);
  assert.match(physicsLayer, /float drive:angular:physics:damping = 0\.25/);
  assert.match(physicsLayer, /float drive:angular:physics:targetPosition = 0/);
  assert.match(physicsLayer, /float physxJoint:maxJointVelocity = 229\.183/);
  assert.match(baseLayer, /bool physics:collisionEnabled = true/);

  assert.match(robotLayer, /<\/go1\/base_link>/);
  assert.match(robotLayer, /<\/go1\/link1>/);
  assert.doesNotMatch(robotLayer, /<\/go1\/base_link\/link1>/);
});

test('isaacsim USDA export collapses synthetic MJCF geom attachment links back into one rigid body tree', async () => {
  const payload = await exportRobotToUsd({
    robot: createMjcfSyntheticAttachmentRobot(),
    exportName: 'mjcf_go1',
    assets: {},
    fileFormat: 'usda',
    layoutProfile: 'isaacsim',
  });

  const baseLayer = await readArchiveText(payload, 'mjcf_go1/configuration/mjcf_go1_base.usda');
  const physicsLayer = await readArchiveText(
    payload,
    'mjcf_go1/configuration/mjcf_go1_physics.usda',
  );

  assert.match(baseLayer, /def Xform "base"/);
  assert.doesNotMatch(baseLayer, /def Xform "world"/);
  assert.doesNotMatch(baseLayer, /def Xform "base_geom_1"/);
  assert.match(baseLayer, /def Xform "visuals"[\s\S]*def Cylinder "cylinder"/);
  assert.match(
    baseLayer,
    /def Xform "collisions"[\s\S]*def Xform "collision_1"[\s\S]*def Sphere "sphere"/,
  );
  assert.ok(
    extractTuples(baseLayer, 'xformOp:translate').some(
      (tuple) =>
        Math.abs((tuple[0] ?? 0) - 0.1) <= 1e-6 &&
        Math.abs((tuple[1] ?? 0) - 0.5) <= 1e-6 &&
        Math.abs((tuple[2] ?? 0) - 0.3) <= 1e-6,
    ),
    'expected collapsed synthetic geometry to inherit the fixed-joint translation',
  );
  assert.ok(
    includesQuaternionClose(
      extractTuples(baseLayer, 'xformOp:orient'),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, Math.PI / 2, 'ZYX')),
    ),
    'expected collapsed synthetic geometry to inherit the fixed-joint rotation',
  );

  assert.doesNotMatch(physicsLayer, /def PhysicsFixedJoint "world_to_base"/);
  assert.doesNotMatch(physicsLayer, /def PhysicsFixedJoint "base_to_base_geom_1"/);
  assert.doesNotMatch(physicsLayer, /rel physics:body1 = <\/mjcf_go1\/base_geom_1>/);
});

test('MJCF USD export collapses synthetic geom attachment links before legacy serialization', async () => {
  const payload = await exportRobotToUsd({
    robot: createMjcfSyntheticAttachmentRobot(),
    exportName: 'mjcf_legacy',
    assets: {},
    fileFormat: 'usda',
  });

  const baseLayer = await readArchiveText(
    payload,
    'mjcf_legacy/usd/configuration/mjcf_legacy_description_base.usda',
  );
  const physicsLayer = await readArchiveText(
    payload,
    'mjcf_legacy/usd/configuration/mjcf_legacy_description_physics.usda',
  );

  assert.match(baseLayer, /def Xform "base"/);
  assert.doesNotMatch(baseLayer, /def Xform "world"/);
  assert.doesNotMatch(baseLayer, /def Xform "base_geom_1"/);
  assert.match(baseLayer, /def Xform "visuals"[\s\S]*def Cylinder "cylinder"/);
  assert.doesNotMatch(physicsLayer, /def PhysicsFixedJoint "world_to_base"/);
  assert.doesNotMatch(physicsLayer, /def PhysicsFixedJoint "base_to_base_geom_1"/);
  assert.doesNotMatch(physicsLayer, /rel physics:body1 = <\/mjcf_legacy_description\/base_geom_1>/);
});

test('isaacsim USDA export hides mesh library prototypes and collision guide scopes from renderers', async () => {
  const meshPayload = await exportRobotToUsd({
    robot: createSharedMeshRobot('meshes/shared_triangle.obj'),
    exportName: 'go1',
    assets: {},
    extraMeshFiles: new Map([['meshes/shared_triangle.obj', createUvObjBlob()]]),
    fileFormat: 'usda',
    layoutProfile: 'isaacsim',
  });
  const collisionPayload = await exportRobotToUsd({
    robot: createTwoLinkRobot(),
    exportName: 'go1_collisions',
    assets: createTwoLinkAssets(),
    fileFormat: 'usda',
    layoutProfile: 'isaacsim',
  });

  const meshBaseLayer = await readArchiveText(meshPayload, 'go1/configuration/go1_base.usda');
  const collisionBaseLayer = await readArchiveText(
    collisionPayload,
    'go1_collisions/configuration/go1_collisions_base.usda',
  );

  assert.match(meshBaseLayer, /class Scope "__MeshLibrary"\n\s+\{\n\s+class Mesh "Geometry_0"/);
  assert.match(
    collisionBaseLayer,
    /def Xform "collisions"\n\s+\{\n\s+token visibility = "invisible"/,
  );
});

test('USDA export downgrades unsupported collision primitives instead of dropping them', async () => {
  const robot = createTwoLinkRobot();
  robot.links.base_link.collision = {
    ...robot.links.base_link.collision,
    type: GeometryType.PLANE,
    dimensions: { x: 6, y: 4, z: 0 },
  };

  const payload = await exportRobotToUsd({
    robot,
    exportName: 'plane_collision',
    assets: createTwoLinkAssets(),
    fileFormat: 'usda',
    layoutProfile: 'isaacsim',
  });

  const baseLayer = await readArchiveText(
    payload,
    'plane_collision/configuration/plane_collision_base.usda',
  );

  assert.match(
    baseLayer,
    /def Xform "collision_0"[\s\S]*double3 xformOp:scale = \(6, 4, 0\.001\)[\s\S]*def Cube "plane_as_box"/,
  );
});

test('USDA export preserves primitive and multi-body visual/collision classification', async () => {
  const robot = createTwoLinkRobot();
  const createPrimitive = (
    type: GeometryType,
    dimensions: { x: number; y: number; z: number },
    color: string,
  ) => ({
    type,
    dimensions,
    color,
    origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
  });

  robot.joints = {};
  robot.links = {
    base_link: {
      ...robot.links.base_link,
      visualBodies: [
        createPrimitive(GeometryType.SPHERE, { x: 0.1, y: 0, z: 0 }, '#ff0000'),
        createPrimitive(GeometryType.CYLINDER, { x: 0.1, y: 0.4, z: 0 }, '#00ff00'),
        createPrimitive(GeometryType.CAPSULE, { x: 0.1, y: 0.5, z: 0 }, '#0000ff'),
      ],
      collisionBodies: [
        createPrimitive(GeometryType.SPHERE, { x: 0.11, y: 0, z: 0 }, '#ffffff'),
        createPrimitive(GeometryType.CYLINDER, { x: 0.11, y: 0.4, z: 0 }, '#ffffff'),
        createPrimitive(GeometryType.CAPSULE, { x: 0.11, y: 0.5, z: 0 }, '#ffffff'),
      ],
    },
  };
  robot.materials = {};

  const payload = await exportRobotToUsd({
    robot,
    exportName: 'primitive_matrix_robot',
    assets: {},
    fileFormat: 'usda',
    layoutProfile: 'isaacsim',
  });
  const baseLayer = await readArchiveText(
    payload,
    'primitive_matrix_robot/configuration/primitive_matrix_robot_base.usda',
  );

  assert.match(baseLayer, /def Xform "visuals"[\s\S]*def Cube "box"/);
  assert.match(baseLayer, /def Xform "visuals"[\s\S]*def Sphere "sphere"/);
  assert.match(baseLayer, /def Xform "visuals"[\s\S]*def Cylinder "cylinder"/);
  assert.match(baseLayer, /def Xform "visuals"[\s\S]*def Capsule "capsule"/);
  assert.match(baseLayer, /def Xform "collisions"\n\s+\{\n\s+token visibility = "invisible"/);
  assert.equal(
    (baseLayer.match(/prepend apiSchemas = \["PhysicsCollisionAPI"\]/g) ?? []).length,
    4,
  );
  assert.match(baseLayer, /uniform token purpose = "guide"/);
  assert.doesNotMatch(baseLayer, /physics:approximation/);
});

test('genesis USDA export aliases to the isaacsim-compatible layered layout', async () => {
  const payload = await exportRobotToUsd({
    robot: createTwoLinkRobot(),
    exportName: 'go1',
    assets: createTwoLinkAssets(),
    fileFormat: 'usda',
    layoutProfile: 'genesis',
  });

  assert.equal(payload.rootLayerPath, 'go1/go1.usda');

  const physicsLayer = await readArchiveText(payload, 'go1/configuration/go1_physics.usda');
  assert.match(physicsLayer, /rel physics:body0 = <\/go1\/base_link>/);
  assert.match(physicsLayer, /rel physics:body1 = <\/go1\/link1>/);
  assert.doesNotMatch(physicsLayer, /rel physics:body1 = <\/go1\/base_link\/link1>/);
});

test('preserves link transforms and writes physics joints into separate USD layers', async () => {
  const payload = await exportRobotToUsd({
    robot: createTwoLinkRobot(),
    exportName: 'two_link_robot',
    assets: createTwoLinkAssets(),
  });

  const baseLayer = await readArchiveText(
    payload,
    'two_link_robot/usd/configuration/two_link_robot_description_base.usd',
  );
  const physicsLayer = await readArchiveText(
    payload,
    'two_link_robot/usd/configuration/two_link_robot_description_physics.usd',
  );
  const sensorLayer = await readArchiveText(
    payload,
    'two_link_robot/usd/configuration/two_link_robot_description_sensor.usd',
  );
  const rootLayer = await readArchiveText(payload, payload.rootLayerPath);

  assert.match(baseLayer, /def Xform "two_link_robot_description"/);
  assert.match(baseLayer, /def Xform "base_link"/);
  assert.match(baseLayer, /def Xform "link1"/);
  assert.match(baseLayer, /double3 xformOp:translate = \(1, 2, 3\)/);
  assert.match(baseLayer, /quatf xformOp:orient = \(0\.707107, 0, 0, 0\.707107\)/);
  assert.match(baseLayer, /double3 xformOp:translate = \(0\.25, 0\.5, 0\.75\)/);
  assert.match(baseLayer, /double3 xformOp:scale = \(0\.4, 0\.2, 0\.1\)/);
  assert.match(baseLayer, /def Cube "box"/);
  assert.match(baseLayer, /def Cylinder "cylinder"/);
  assert.match(baseLayer, /def Sphere "sphere"/);
  assert.match(baseLayer, /def Xform "collisions"/);
  assert.doesNotMatch(baseLayer, /def Xform "colliders"/);
  assert.match(
    baseLayer,
    /def Xform "collisions"[\s\S]*def Cube "box" \(\n\s+prepend apiSchemas = \["PhysicsCollisionAPI"\]\n\s*\)/,
  );
  assert.match(
    baseLayer,
    /def Cube "box" \(\n\s+prepend apiSchemas = \["PhysicsCollisionAPI"\]\n\s*\)\n\s+\{[\s\S]*bool physics:collisionEnabled = true/,
  );

  assert.match(physicsLayer, /over "two_link_robot_description"/);
  assert.match(physicsLayer, /subLayers = \[\n\s+@two_link_robot_description_base\.usd@\n\s+\]/);
  assert.match(rootLayer, /def PhysicsScene "physicsScene"/);
  assert.doesNotMatch(physicsLayer, /def PhysicsScene/);
  assert.match(physicsLayer, /prepend apiSchemas = \["PhysicsArticulationRootAPI"\]/);
  assert.match(physicsLayer, /prepend apiSchemas = \["PhysicsRigidBodyAPI", "PhysicsMassAPI"\]/);
  assert.match(
    physicsLayer,
    /over "two_link_robot_description" \(\n\s+prepend apiSchemas = \["PhysicsArticulationRootAPI"\]\n\s*\)\n\{/,
  );
  assert.match(
    physicsLayer,
    /over "base_link" \(\n\s+prepend apiSchemas = \["PhysicsRigidBodyAPI", "PhysicsMassAPI"\]\n\s*\)\n\s+\{/,
  );
  assert.doesNotMatch(physicsLayer, /PhysicsCollisionAPI/);
  assert.doesNotMatch(physicsLayer, /over "collisions"/);
  assert.match(physicsLayer, /float physics:mass = 1\.25/);
  assert.match(physicsLayer, /float3 physics:centerOfMass = \(0\.1, 0\.2, 0\.3\)/);
  assert.match(physicsLayer, /over "joints"/);
  assert.match(physicsLayer, /def PhysicsRevoluteJoint "joint_link1"/);
  assert.match(physicsLayer, /rel physics:body0 = <\/two_link_robot_description\/base_link>/);
  assert.match(
    physicsLayer,
    /rel physics:body1 = <\/two_link_robot_description\/base_link\/link1>/,
  );
  assert.match(physicsLayer, /uniform token physics:axis = "Z"/);
  assert.match(physicsLayer, /float physics:lowerLimit = -90/);
  assert.match(physicsLayer, /float physics:upperLimit = 60/);
  assert.match(physicsLayer, /prepend apiSchemas = \["PhysicsDriveAPI:angular"\]/);
  assert.match(physicsLayer, /uniform token drive:angular:physics:type = "force"/);
  assert.match(physicsLayer, /float drive:angular:physics:damping = 0\.1/);
  assert.match(physicsLayer, /float drive:angular:physics:maxForce = 12/);
  assert.match(physicsLayer, /point3f physics:localPos0 = \(1, 2, 3\)/);
  assert.match(physicsLayer, /custom point3f urdf:originXyz = \(1, 2, 3\)/);
  assert.match(physicsLayer, /custom float3 urdf:axisLocal = \(0, 0, 1\)/);

  assert.match(sensorLayer, /def Xform "two_link_robot_description"/);
});

test('serializes joint origin quaternions using URDF ZYX rpy semantics', async () => {
  const robot = createTwoLinkRobot();
  robot.joints.joint_link1.origin.rpy = {
    r: 0.31,
    p: -0.47,
    y: 0.83,
  };
  robot.joints.joint_link1.axis = { x: 0, y: 0, z: -1 };

  const payload = await exportRobotToUsd({
    robot,
    exportName: 'two_link_robot',
    assets: createTwoLinkAssets(),
  });

  const physicsLayer = await readArchiveText(
    payload,
    'two_link_robot/usd/configuration/two_link_robot_description_physics.usd',
  );

  const exportedOriginQuat = extractTuples(physicsLayer, 'urdf:originQuatWxyz').at(0);
  assert.ok(exportedOriginQuat, 'expected joint origin quaternion metadata');
  assertQuaternionClose(
    exportedOriginQuat,
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.31, -0.47, 0.83, 'ZYX')),
  );

  const exportedPhysicsQuat = extractTuples(physicsLayer, 'physics:localRot0').at(0);
  assert.ok(exportedPhysicsQuat, 'expected physics:localRot0 on the exported joint');
  const axisAlignment = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, -1),
  );
  assertQuaternionClose(
    exportedPhysicsQuat,
    new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(0.31, -0.47, 0.83, 'ZYX'))
      .multiply(axisAlignment),
  );
  const exportedChildFrameQuat = extractTuples(physicsLayer, 'physics:localRot1').at(0);
  assert.ok(exportedChildFrameQuat, 'expected physics:localRot1 on the exported joint');
  assertQuaternionClose(exportedChildFrameQuat, axisAlignment);
  assert.match(physicsLayer, /custom float3 urdf:axisLocal = \(0, 0, -1\)/);
});

test('serializes preserved USD physics child joint frames for IsaacSim parity', async () => {
  const robot = createTwoLinkRobot();
  const childFrame = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    Math.PI / 2,
  );
  robot.joints.joint_link1.type = JointType.FIXED;
  robot.joints.joint_link1.origin.rpy = { r: 0, p: 0.05, y: 0 };
  (
    robot.joints.joint_link1 as typeof robot.joints.joint_link1 & {
      usdPhysics: {
        localRot1Wxyz: [number, number, number, number];
      };
    }
  ).usdPhysics = {
    localRot1Wxyz: [childFrame.w, childFrame.x, childFrame.y, childFrame.z],
  };

  const payload = await exportRobotToUsd({
    robot,
    exportName: 'two_link_robot',
    assets: createTwoLinkAssets(),
  });

  const physicsLayer = await readArchiveText(
    payload,
    'two_link_robot/usd/configuration/two_link_robot_description_physics.usd',
  );
  const exportedLocalRot0 = extractTuples(physicsLayer, 'physics:localRot0').at(0);
  const exportedLocalRot1 = extractTuples(physicsLayer, 'physics:localRot1').at(0);
  assert.ok(exportedLocalRot0, 'expected physics:localRot0 on the exported joint');
  assert.ok(exportedLocalRot1, 'expected physics:localRot1 on the exported joint');

  const originQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.05, 0, 'ZYX'));
  assertQuaternionClose(exportedLocalRot1, childFrame);
  assertQuaternionClose(exportedLocalRot0, originQuaternion.multiply(childFrame));
});

test('serializes visual and collision origins using URDF ZYX rpy semantics', async () => {
  const robot = createTwoLinkRobot();
  robot.links.base_link.visual.origin = {
    xyz: { x: 0.12, y: -0.34, z: 0.56 },
    rpy: { r: 0.37, p: -0.52, y: 0.91 },
  };
  robot.links.base_link.collision = {
    ...robot.links.base_link.collision,
    origin: {
      xyz: { x: -0.22, y: 0.18, z: -0.14 },
      rpy: { r: -0.41, p: 0.63, y: -0.27 },
    },
  };

  const payload = await exportRobotToUsd({
    robot,
    exportName: 'two_link_robot',
    assets: createTwoLinkAssets(),
  });

  const baseLayer = await readArchiveText(
    payload,
    'two_link_robot/usd/configuration/two_link_robot_description_base.usd',
  );
  const exportedOrientations = extractTuples(baseLayer, 'quatf xformOp:orient');

  const expectedVisualQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(0.37, -0.52, 0.91, 'ZYX'),
  );
  const expectedCollisionQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(-0.41, 0.63, -0.27, 'ZYX'),
  );

  assert.ok(
    includesQuaternionClose(exportedOrientations, expectedVisualQuaternion),
    'expected exported visual origin quaternion to use URDF ZYX rpy semantics',
  );
  assert.ok(
    includesQuaternionClose(exportedOrientations, expectedCollisionQuaternion),
    'expected exported collision origin quaternion to use URDF ZYX rpy semantics',
  );
});

test('exports USD links in the authored rest pose instead of the current manipulated joint pose', async () => {
  const robot = createTwoLinkRobot();
  robot.joints.joint_link1.referencePosition = Math.PI / 4;
  robot.joints.joint_link1.angle = robot.joints.joint_link1.referencePosition + Math.PI / 6;

  const payload = await exportRobotToUsd({
    robot,
    exportName: 'two_link_robot_rest_pose',
    assets: createTwoLinkAssets(),
  });

  const baseLayer = await readArchiveText(
    payload,
    'two_link_robot_rest_pose/usd/configuration/two_link_robot_rest_pose_description_base.usd',
  );
  const link1OrientMatch = baseLayer.match(
    /def Xform "link1"[\s\S]*?quatf xformOp:orient = \(([^)]+)\)/,
  );
  assert.ok(link1OrientMatch, 'expected link1 orient op in the exported base layer');

  const exportedLinkQuat = link1OrientMatch[1].split(',').map((value) => Number(value.trim()));
  assertQuaternionClose(
    exportedLinkQuat,
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2, 'ZYX')),
  );
});

test('serializes internal material metadata and display colors into the base layer', async () => {
  const payload = await exportRobotToUsd({
    robot: createTwoLinkRobot(),
    exportName: 'two_link_robot',
    assets: createTwoLinkAssets(),
  });

  const baseLayer = await readArchiveText(
    payload,
    'two_link_robot/usd/configuration/two_link_robot_description_base.usd',
  );

  assert.match(baseLayer, /custom string urdf:materialColor = "#12ab34"/);
  assert.match(baseLayer, /custom string urdf:materialTexture = "textures\/base_color\.png"/);
  assert.match(baseLayer, /primvars:displayColor = \[\(0\.006049, 0\.40724, 0\.03434\)\]/);
  assert.match(baseLayer, /def Scope "Looks"/);
  assert.match(baseLayer, /def Material "Material_0"/);
  assert.match(baseLayer, /uniform token info:id = "UsdPreviewSurface"/);
  assert.match(baseLayer, /color3f inputs:diffuseColor = \(0\.006049, 0\.40724, 0\.03434\)/);
  assert.match(
    baseLayer,
    /rel material:binding = <\/two_link_robot_description\/Looks\/Material_0>/,
  );
});

test('exports explicit mesh material colors into USD preview materials instead of loader defaults', async () => {
  const meshPath = 'meshes/colored_triangle.obj';
  const robot = createMeshRobot(meshPath);
  robot.links.base_link.visual.color = '#ffffff';
  robot.materials = {
    base_link: {
      color: '#12ab34',
    },
  };

  const payload = await exportRobotToUsd({
    robot,
    exportName: 'mesh_robot_colored',
    assets: {},
    extraMeshFiles: new Map([[meshPath, createUvObjBlob()]]),
  });

  const baseLayer = await readArchiveText(
    payload,
    'mesh_robot_colored/usd/configuration/mesh_robot_colored_description_base.usd',
  );

  assert.match(baseLayer, /custom string urdf:materialColor = "#12ab34"/);
  assert.match(baseLayer, /primvars:displayColor = \[\(0\.006049, 0\.40724, 0\.03434\)\]/);
  assert.match(baseLayer, /color3f inputs:diffuseColor = \(0\.006049, 0\.40724, 0\.03434\)/);
  assert.doesNotMatch(baseLayer, /color3f inputs:diffuseColor = \(1, 1, 1\)/);
});

test('MJCF USD export merges same-link visual meshes while preserving material subsets', async () => {
  const firstMeshPath = 'meshes/first_triangle.obj';
  const secondMeshPath = 'meshes/second_triangle.obj';
  const robot = createMeshRobot(firstMeshPath);
  robot.links.base_link.visual.color = '#ff0000';
  robot.links.base_link.visualBodies = [
    {
      type: GeometryType.MESH,
      meshPath: secondMeshPath,
      dimensions: { x: 1, y: 1, z: 1 },
      color: '#00ff00',
      origin: { xyz: { x: 2, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    },
  ];
  robot.inspectionContext = {
    sourceFormat: 'mjcf',
    mjcf: {
      siteCount: 0,
      tendonCount: 0,
      tendonActuatorCount: 0,
      bodiesWithSites: [],
      tendons: [],
    },
  };

  const payload = await exportRobotToUsd({
    robot,
    exportName: 'mjcf_merged_visuals',
    assets: {},
    extraMeshFiles: new Map([
      [firstMeshPath, createUvObjBlob()],
      [secondMeshPath, createUvObjBlob()],
    ]),
  });

  const baseLayer = await readArchiveText(
    payload,
    'mjcf_merged_visuals/usd/configuration/mjcf_merged_visuals_description_base.usd',
  );

  assert.match(baseLayer, /def Mesh "visual_merged"/);
  assert.doesNotMatch(baseLayer, /def Xform "visual_0"/);
  assert.doesNotMatch(baseLayer, /def Xform "visual_1"/);
  assert.equal(Array.from(baseLayer.matchAll(/def GeomSubset "subset_/g)).length, 2);
  assert.match(baseLayer, /color3f inputs:diffuseColor = \(1, 0, 0\)/);
  assert.match(baseLayer, /color3f inputs:diffuseColor = \(0, 1, 0\)/);
});

test('isaacsim MJCF USD export merges same-link visual meshes to keep prim counts compact', async () => {
  const firstMeshPath = 'meshes/first_triangle.obj';
  const secondMeshPath = 'meshes/second_triangle.obj';
  const robot = createMeshRobot(firstMeshPath);
  robot.links.base_link.visual.color = '#ff0000';
  robot.links.base_link.visualBodies = [
    {
      type: GeometryType.MESH,
      meshPath: secondMeshPath,
      dimensions: { x: 1, y: 1, z: 1 },
      color: '#00ff0066',
      origin: { xyz: { x: 2, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    },
  ];
  robot.inspectionContext = {
    sourceFormat: 'mjcf',
    mjcf: {
      siteCount: 0,
      tendonCount: 0,
      tendonActuatorCount: 0,
      bodiesWithSites: [],
      tendons: [],
    },
  };

  const payload = await exportRobotToUsd({
    robot,
    exportName: 'mjcf_isaacsim_merged',
    assets: {},
    extraMeshFiles: new Map([
      [firstMeshPath, createUvObjBlob()],
      [secondMeshPath, createUvObjBlob()],
    ]),
    layoutProfile: 'isaacsim',
  });

  const baseLayer = await readArchiveText(
    payload,
    'mjcf_isaacsim_merged/configuration/mjcf_isaacsim_merged_base.usd',
  );

  assert.match(baseLayer, /def Mesh "visual_merged"/);
  assert.doesNotMatch(baseLayer, /def Xform "visual_0"/);
  assert.doesNotMatch(baseLayer, /def Xform "visual_1"/);
  assert.equal(Array.from(baseLayer.matchAll(/def GeomSubset "subset_/g)).length, 2);
  assert.match(baseLayer, /color3f inputs:diffuseColor = \(1, 0, 0\)/);
  assert.match(baseLayer, /color3f inputs:diffuseColor = \(0, 1, 0\)/);
  assert.match(baseLayer, /float inputs:opacity = 0\.4/);
  assert.match(baseLayer, /float inputs:opacity_constant = 0\.4/);
  assert.match(baseLayer, /bool inputs:enable_opacity = true/);
});

test('deduplicates repeated mesh geometry into a shared USD mesh library', async () => {
  const meshPath = 'meshes/shared_triangle.obj';
  const payload = await exportRobotToUsd({
    robot: createSharedMeshRobot(meshPath),
    exportName: 'shared_mesh_robot',
    assets: {},
    extraMeshFiles: new Map([[meshPath, createUvObjBlob()]]),
  });

  const baseLayer = await readArchiveText(
    payload,
    'shared_mesh_robot/usd/configuration/shared_mesh_robot_description_base.usd',
  );

  assert.match(baseLayer, /class Scope "__MeshLibrary"/);
  assert.equal(
    Array.from(baseLayer.matchAll(/point3f\[] points = \[/g)).length,
    1,
    'expected shared mesh geometry to be serialized once',
  );
  assert.match(
    baseLayer,
    /prepend references = <\/shared_mesh_robot_description\/__MeshLibrary\/Geometry_0>/,
  );
  assert.equal(
    Array.from(
      baseLayer.matchAll(
        /prepend references = <\/shared_mesh_robot_description\/__MeshLibrary\/Geometry_0>/g,
      ),
    ).length,
    2,
    'expected both mesh instances to reference the shared geometry prototype',
  );
});

test('diagonalizes off-diagonal inertial tensors before writing USD mass properties', async () => {
  const robot = createTwoLinkRobot();
  robot.links.link1.inertial = {
    mass: 1.25,
    origin: { xyz: { x: 0.1, y: 0.2, z: 0.3 }, rpy: { r: 0.15, p: -0.25, y: 0.35 } },
    inertia: {
      ixx: 1.1,
      ixy: 0.12,
      ixz: -0.18,
      iyy: 2.3,
      iyz: 0.09,
      izz: 3.4,
    },
  };

  const payload = await exportRobotToUsd({
    robot,
    exportName: 'two_link_robot',
    assets: createTwoLinkAssets(),
  });

  const physicsLayer = await readArchiveText(
    payload,
    'two_link_robot/usd/configuration/two_link_robot_description_physics.usd',
  );
  const expected = computeUsdInertiaProperties(robot.links.link1.inertial);
  assert.ok(expected, 'expected diagonalized inertia values');

  const diagonalInertia = extractTuples(physicsLayer, 'physics:diagonalInertia').at(-1);
  assert.ok(diagonalInertia, 'expected link1 diagonal inertia');
  expected.diagonalInertia.forEach((value, index) => {
    assert.ok(
      Math.abs(diagonalInertia[index]! - value) <= 1e-5,
      `expected inertia[${index}] to match`,
    );
  });

  const principalAxes = extractTuples(physicsLayer, 'physics:principalAxes').at(-1);
  assert.ok(principalAxes, 'expected link1 principal axes');
  assertQuaternionClose(principalAxes, expected.principalAxesLocal);

  assert.notDeepEqual(
    diagonalInertia.map((value) => Number(value.toFixed(6))),
    [1.1, 2.3, 3.4],
    'expected exported inertia to differ from the raw diagonal entries when off-diagonal terms exist',
  );
});

test('preserves tiny explicit inertial values when writing USD mass properties', async () => {
  const robot = createTwoLinkRobot();
  robot.links.link1.inertial = {
    mass: 4.19e-15,
    origin: { xyz: { x: 1e-27, y: -2e-27, z: -1.3078606502004276e-11 }, rpy: { r: 0, p: 0, y: 0 } },
    inertia: {
      ixx: 1.1e-28,
      ixy: 1.2e-29,
      ixz: -1.8e-29,
      iyy: 2.3e-28,
      iyz: 0.9e-29,
      izz: 3.4e-28,
    },
  };

  const payload = await exportRobotToUsd({
    robot,
    exportName: 'two_link_robot_tiny_inertia',
    assets: createTwoLinkAssets(),
  });

  const physicsLayer = await readArchiveText(
    payload,
    'two_link_robot_tiny_inertia/usd/configuration/two_link_robot_tiny_inertia_description_physics.usd',
  );
  const expected = computeUsdInertiaProperties(robot.links.link1.inertial);
  assert.ok(expected, 'expected tiny inertia to remain representable');

  const masses = Array.from(physicsLayer.matchAll(/float physics:mass = ([^\n]+)/g)).map((match) =>
    Number(match[1].trim()),
  );
  assert.equal(masses.at(-1), 4.19e-15);

  const centerOfMass = extractTuples(physicsLayer, 'physics:centerOfMass').at(-1);
  assert.ok(centerOfMass, 'expected link1 center of mass');
  [1e-27, -2e-27, -1.3078606502004276e-11].forEach((value, index) => {
    assert.ok(
      Math.abs(centerOfMass[index]! - value) <= Math.max(Math.abs(value) * 1e-6, 1e-33),
      `expected centerOfMass[${index}] to preserve tiny authored values`,
    );
  });

  const diagonalInertia = extractTuples(physicsLayer, 'physics:diagonalInertia').at(-1);
  assert.ok(diagonalInertia, 'expected link1 diagonal inertia');
  expected.diagonalInertia.forEach((value, index) => {
    assert.ok(
      Math.abs(diagonalInertia[index]! - value) <= Math.max(Math.abs(value) * 1e-6, 1e-33),
      `expected tiny inertia[${index}] to survive USD export`,
    );
  });

  const principalAxes = extractTuples(physicsLayer, 'physics:principalAxes').at(-1);
  assert.ok(principalAxes, 'expected link1 principal axes');
  assertQuaternionClose(principalAxes, expected.principalAxesLocal, 2e-6);
});

test('can simplify mesh geometry before serializing USD mesh prims', async () => {
  const meshPath = 'meshes/grid.stl';
  const extraMeshFiles = new Map([[meshPath, createGridStlBlob()]]);

  const originalPayload = await exportRobotToUsd({
    robot: createMeshRobot(meshPath),
    exportName: 'mesh_robot_original',
    assets: {},
    extraMeshFiles,
  });

  const compressedPayload = await exportRobotToUsd({
    robot: createMeshRobot(meshPath),
    exportName: 'mesh_robot_compressed',
    assets: {},
    extraMeshFiles,
    meshCompression: {
      enabled: true,
      quality: 25,
    },
  });

  const originalBaseLayer = await readArchiveText(
    originalPayload,
    'mesh_robot_original/usd/configuration/mesh_robot_original_description_base.usd',
  );
  const compressedBaseLayer = await readArchiveText(
    compressedPayload,
    'mesh_robot_compressed/usd/configuration/mesh_robot_compressed_description_base.usd',
  );

  const originalTriangles = extractTriangleCount(originalBaseLayer);
  const compressedTriangles = extractTriangleCount(compressedBaseLayer);

  assert.ok(
    compressedTriangles < originalTriangles,
    `expected compressed mesh triangle count to decrease: ${compressedTriangles} < ${originalTriangles}`,
  );
});

test('exports textured mesh materials with UV primvars and archived texture assets', async () => {
  const meshPath = 'meshes/textured_triangle.obj';
  const texturePath = 'textures/checker.png';
  const textureDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==';

  const payload = await exportRobotToUsd({
    robot: createTexturedMeshRobot(meshPath, texturePath),
    exportName: 'mesh_robot_textured',
    assets: {
      [texturePath]: textureDataUrl,
    },
    extraMeshFiles: new Map([[meshPath, createUvObjBlob()]]),
  });

  const baseLayer = await readArchiveText(
    payload,
    'mesh_robot_textured/usd/configuration/mesh_robot_textured_description_base.usd',
  );

  assert.ok(
    payload.archiveFiles.has('mesh_robot_textured/usd/assets/checker.png'),
    'expected exported USD archive to include the referenced texture asset',
  );
  assert.match(baseLayer, /def Material "Material_0"/);
  assert.match(baseLayer, /def Shader "PrimvarReader_st"/);
  assert.match(baseLayer, /uniform token info:id = "UsdPrimvarReader_float2"/);
  assert.match(baseLayer, /token inputs:varname = "st"/);
  assert.match(baseLayer, /def Shader "DiffuseTexture"/);
  assert.match(baseLayer, /uniform token info:id = "UsdUVTexture"/);
  assert.match(baseLayer, /asset inputs:file = @\.\.\/assets\/checker\.png@/);
  assert.match(
    baseLayer,
    /float2 inputs:st\.connect = <\/mesh_robot_textured_description\/Looks\/Material_0\/PrimvarReader_st\.outputs:result>/,
  );
  assert.match(
    baseLayer,
    /color3f inputs:diffuseColor\.connect = <\/mesh_robot_textured_description\/Looks\/Material_0\/DiffuseTexture\.outputs:rgb>/,
  );
  assert.match(baseLayer, /texCoord2f\[] primvars:st = \[/);
  assert.match(baseLayer, /uniform token primvars:st:interpolation = "faceVarying"/);
});

test('exports mesh normals into USD mesh prims so shaded surfaces keep their authored smoothing', async () => {
  const meshPath = 'meshes/shaded_triangle.obj';

  const payload = await exportRobotToUsd({
    robot: createMeshRobot(meshPath),
    exportName: 'mesh_robot_normals',
    assets: {},
    extraMeshFiles: new Map([[meshPath, createNormalObjBlob()]]),
  });

  const baseLayer = await readArchiveText(
    payload,
    'mesh_robot_normals/usd/configuration/mesh_robot_normals_description_base.usd',
  );

  assert.match(baseLayer, /normal3f\[] normals = \[/);
  assert.match(baseLayer, /\(0, 0, 1\)/);
  assert.match(baseLayer, /interpolation = "vertex"/);
});

test('exports texture-only mesh materials with a neutral white USD preview color instead of the default visual blue', async () => {
  const meshPath = 'meshes/textured_triangle.obj';
  const texturePath = 'textures/checker.png';
  const textureDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==';
  const robot = createMeshRobot(meshPath);
  robot.materials = {
    base_link: {
      texture: texturePath,
    },
  };

  const payload = await exportRobotToUsd({
    robot,
    exportName: 'mesh_robot_texture_only',
    assets: {
      [texturePath]: textureDataUrl,
    },
    extraMeshFiles: new Map([[meshPath, createUvObjBlob()]]),
  });

  const baseLayer = await readArchiveText(
    payload,
    'mesh_robot_texture_only/usd/configuration/mesh_robot_texture_only_description_base.usd',
  );

  assert.match(baseLayer, /custom string urdf:materialColor = "#ffffff"/);
  assert.match(baseLayer, /custom string urdf:materialTexture = "textures\/checker\.png"/);
  assert.match(baseLayer, /asset inputs:file = @\.\.\/assets\/checker\.png@/);
  assert.doesNotMatch(baseLayer, /custom string urdf:materialColor = "#6699ff"/);
  assert.doesNotMatch(baseLayer, /color3f inputs:diffuseColor = \(0\.133209, 0\.318547, 1\)/);
});

test('exports six-face box textures into separate USDA mesh prims and packaged assets', async () => {
  const textureDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==';
  const payload = await exportRobotToUsd({
    robot: createBoxFaceTextureRobot(),
    exportName: 'box_face_robot',
    assets: {
      'textures/right.png': textureDataUrl,
      'textures/left.png': textureDataUrl,
      'textures/up.png': textureDataUrl,
      'textures/down.png': textureDataUrl,
      'textures/front.png': textureDataUrl,
      'textures/back.png': textureDataUrl,
    },
    fileFormat: 'usda',
  });

  const baseLayer = await readArchiveText(
    payload,
    'box_face_robot/usd/configuration/box_face_robot_description_base.usda',
  );

  assert.equal(payload.downloadFileName, 'box_face_robot.usda');
  assert.equal((baseLayer.match(/class Mesh "Geometry_/g) ?? []).length, 6);
  assert.match(baseLayer, /def Mesh "box_right"/);
  assert.doesNotMatch(baseLayer, /def Cube "box_right"/);
  assert.match(baseLayer, /custom string urdf:materialTexture = "textures\/right\.png"/);
  assert.match(baseLayer, /custom string urdf:materialTexture = "textures\/left\.png"/);
  assert.match(baseLayer, /custom string urdf:materialTexture = "textures\/up\.png"/);
  assert.match(baseLayer, /custom string urdf:materialTexture = "textures\/down\.png"/);
  assert.match(baseLayer, /custom string urdf:materialTexture = "textures\/front\.png"/);
  assert.match(baseLayer, /custom string urdf:materialTexture = "textures\/back\.png"/);
  assert.ok(payload.archiveFiles.has('box_face_robot/usd/assets/right.png'));
  assert.ok(payload.archiveFiles.has('box_face_robot/usd/assets/left.png'));
  assert.ok(payload.archiveFiles.has('box_face_robot/usd/assets/up.png'));
  assert.ok(payload.archiveFiles.has('box_face_robot/usd/assets/down.png'));
  assert.ok(payload.archiveFiles.has('box_face_robot/usd/assets/front.png'));
  assert.ok(payload.archiveFiles.has('box_face_robot/usd/assets/back.png'));
  assert.match(baseLayer, /float inputs:opacity = 0\.25/);
});

test('archives texture assets for mesh metadata even when the mesh has no UV coordinates', async () => {
  const meshPath = 'meshes/grid.stl';
  const texturePath = 'textures/checker.png';
  const textureDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==';
  const robot = createTexturedMeshRobot(meshPath, texturePath);

  const payload = await exportRobotToUsd({
    robot,
    exportName: 'mesh_robot_textured_stl',
    assets: {
      [texturePath]: textureDataUrl,
    },
    extraMeshFiles: new Map([[meshPath, createGridStlBlob()]]),
  });

  const baseLayer = await readArchiveText(
    payload,
    'mesh_robot_textured_stl/usd/configuration/mesh_robot_textured_stl_description_base.usd',
  );

  assert.match(baseLayer, /custom string urdf:materialColor = "#ffffff"/);
  assert.match(baseLayer, /custom string urdf:materialTexture = "textures\/checker\.png"/);
  assert.ok(
    payload.archiveFiles.has('mesh_robot_textured_stl/usd/assets/checker.png'),
    'expected exported USD archive to include texture assets referenced by material metadata even without UVs',
  );
});

test('exports 8-digit hex display colors without emitting Three.js invalid color warnings', async () => {
  const robot = createTwoLinkRobot();
  robot.links.base_link.visual.color = '#00000000';
  robot.materials = {};

  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((value) => String(value)).join(' '));
  };

  try {
    const payload = await exportRobotToUsd({
      robot,
      exportName: 'two_link_robot_alpha_color',
      assets: createTwoLinkAssets(),
    });

    const baseLayer = await readArchiveText(
      payload,
      'two_link_robot_alpha_color/usd/configuration/two_link_robot_alpha_color_description_base.usd',
    );

    assert.match(baseLayer, /custom string urdf:materialColor = "#00000000"/);
    assert.match(baseLayer, /float inputs:opacity = 0/);
    assert.equal(
      warnings.some((warning) => warning.includes('Invalid hex color')),
      false,
      `expected no invalid color warnings, got: ${warnings.join(' | ')}`,
    );
  } finally {
    console.warn = originalWarn;
  }
});

test('exports primitive authored material opacity when it is separate from the color', async () => {
  const robot = createTwoLinkRobot();
  robot.links.base_link.visual.authoredMaterials = [
    {
      name: 'translucent_shell',
      color: '#336699',
      opacity: 0.35,
    },
  ];
  robot.materials = {};

  const payload = await exportRobotToUsd({
    robot,
    exportName: 'primitive_opacity_robot',
    assets: {},
    fileFormat: 'usda',
    layoutProfile: 'isaacsim',
  });
  const baseLayer = await readArchiveText(
    payload,
    'primitive_opacity_robot/configuration/primitive_opacity_robot_base.usda',
  );

  assert.match(baseLayer, /custom string urdf:materialColor = "#336699"/);
  assert.match(baseLayer, /float inputs:opacity = 0\.35/);
  assert.match(baseLayer, /float inputs:opacity_constant = 0\.35/);
  assert.match(baseLayer, /bool inputs:enable_opacity = true/);
});

test('reports phased USD export progress for links, geometry, scene serialization, and assets', async () => {
  const progressUpdates: Array<{
    phase: string;
    completed: number;
    total: number;
    label?: string;
  }> = [];

  await exportRobotToUsd({
    robot: createTwoLinkRobot(),
    exportName: 'two_link_robot_progress',
    assets: createTwoLinkAssets(),
    onProgress: (progress) => {
      progressUpdates.push({ ...progress });
    },
  });

  const phaseOrder = ['links', 'geometry', 'scene', 'assets'];
  let previousPhaseIndex = -1;

  phaseOrder.forEach((phase) => {
    const firstIndex = progressUpdates.findIndex((progress) => progress.phase === phase);
    assert.ok(firstIndex >= 0, `expected progress updates for phase ${phase}`);
    assert.ok(
      firstIndex > previousPhaseIndex,
      `expected phase ${phase} to start after the previous phase`,
    );
    previousPhaseIndex = firstIndex;

    const phaseUpdates = progressUpdates.filter((progress) => progress.phase === phase);
    const finalUpdate = phaseUpdates.at(-1);
    assert.ok(finalUpdate, `expected final progress update for phase ${phase}`);
    assert.equal(
      finalUpdate.completed,
      finalUpdate.total,
      `expected phase ${phase} to finish at total progress`,
    );
  });

  assert.ok(
    progressUpdates.some(
      (progress) => progress.phase === 'links' && progress.label === 'base_link',
    ),
    'expected link progress labels to include the current link name',
  );
});
