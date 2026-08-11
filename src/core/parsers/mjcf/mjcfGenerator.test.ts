import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { JSDOM } from 'jsdom';

import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  GeometryType,
  JointType,
  type RobotState,
} from '../../../types';
import { computeLinkWorldMatrices } from '@/core/robot/kinematics';

import { generateMujocoXML } from './mjcfGenerator.ts';
import { classifyMJCFGeom } from './mjcfGeomClassification.ts';
import { parseMJCFModel as parseNullableMJCFModel } from './mjcfModel.ts';
import { parseMJCF as parseNullableMJCF } from './mjcfParser.ts';
import { parseURDF as parseNullableURDF } from '../urdf/parser/index.ts';

const GO2_MJCF_PATH = path.resolve('test/mujoco_menagerie-main/unitree_go2/go2.xml');

function installDomParser(): void {
  if (typeof DOMParser !== 'undefined') {
    return;
  }

  const dom = new JSDOM('<!doctype html><html><body></body></html>', { contentType: 'text/html' });
  globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
}

function findBodyByName(body: { name: string; children: any[] }, name: string): any | null {
  if (body.name === name) {
    return body;
  }

  for (const child of body.children) {
    const match = findBodyByName(child, name);
    if (match) {
      return match;
    }
  }

  return null;
}

function requireParsed<T>(value: T | null, label: string): T {
  assert.ok(value, label);
  return value;
}

function parseMJCFModel(
  xmlContent: string,
): NonNullable<ReturnType<typeof parseNullableMJCFModel>> {
  return requireParsed(parseNullableMJCFModel(xmlContent), 'expected MJCF model to parse');
}

function parseMJCF(xmlContent: string): RobotState {
  return requireParsed(parseNullableMJCF(xmlContent), 'expected MJCF robot to parse');
}

function parseURDF(xmlContent: string): RobotState {
  return requireParsed(parseNullableURDF(xmlContent), 'expected URDF robot to parse');
}

function assertMatricesClose(
  source: RobotState,
  roundtrip: RobotState,
  linkIds: string[],
  tolerance = 1e-6,
): void {
  const sourceMatrices = computeLinkWorldMatrices(source);
  const roundtripMatrices = computeLinkWorldMatrices(roundtrip);

  linkIds.forEach((linkId) => {
    const sourceMatrix = sourceMatrices[linkId];
    const roundtripMatrix = roundtripMatrices[linkId];

    assert.ok(sourceMatrix, `expected source world matrix for ${linkId}`);
    assert.ok(roundtripMatrix, `expected roundtrip world matrix for ${linkId}`);

    sourceMatrix.elements.forEach((value, index) => {
      const delta = Math.abs(value - roundtripMatrix.elements[index]!);
      assert.ok(
        delta <= tolerance,
        `expected ${linkId} world matrix element ${index} to roundtrip (delta=${delta})`,
      );
    });
  });
}

function createClosedLoopExportRobot(): RobotState {
  const zeroOrigin = { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } };

  return {
    name: 'closed-loop-export',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
          dimensions: { x: 0.25, y: 0.25, z: 0.25 },
          origin: zeroOrigin,
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.BOX,
          dimensions: { x: 0.25, y: 0.25, z: 0.25 },
          origin: zeroOrigin,
        },
      },
      left_link: {
        ...DEFAULT_LINK,
        id: 'left_link',
        name: 'left_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
          dimensions: { x: 0.1, y: 0.1, z: 0.1 },
          origin: zeroOrigin,
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.BOX,
          dimensions: { x: 0.1, y: 0.1, z: 0.1 },
          origin: zeroOrigin,
        },
      },
      right_link: {
        ...DEFAULT_LINK,
        id: 'right_link',
        name: 'right_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
          dimensions: { x: 0.1, y: 0.1, z: 0.1 },
          origin: zeroOrigin,
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.BOX,
          dimensions: { x: 0.1, y: 0.1, z: 0.1 },
          origin: zeroOrigin,
        },
      },
    },
    joints: {
      left_joint: {
        ...DEFAULT_JOINT,
        id: 'left_joint',
        name: 'left_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'left_link',
        origin: { xyz: { x: 1, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        axis: { x: 0, y: 0, z: 1 },
      },
      right_joint: {
        ...DEFAULT_JOINT,
        id: 'right_joint',
        name: 'right_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'right_link',
        origin: { xyz: { x: 1, y: 2, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        axis: { x: 0, y: 0, z: 1 },
      },
    },
    materials: {},
  };
}

test('generated MJCF marks collision meshes as collision-only geoms', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'aloha-like',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#262626',
          meshPath: 'assets/base.stl',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#ff0000',
          meshPath: 'assets/base.stl',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateMujocoXML(robot, { meshdir: 'meshes/' });
  const parsed = parseMJCFModel(generated);
  const baseLinkBody = findBodyByName(parsed.worldBody as any, 'base_link');
  const geoms = baseLinkBody?.geoms ?? [];
  const collisionGeom = geoms[1];

  assert.ok(collisionGeom);
  assert.equal(collisionGeom.group, 3);
  assert.equal(collisionGeom.contype, 1);
  assert.equal(collisionGeom.conaffinity, 1);
  assert.deepEqual(classifyMJCFGeom(collisionGeom), { isVisual: false, isCollision: true });
});

test('generated MJCF omits preview scene helpers by default', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'plain-export',
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
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateMujocoXML(robot);

  assert.doesNotMatch(generated, /<light pos="0 0 10" dir="0 0 -1" diffuse="1 1 1"\/>/);
  assert.doesNotMatch(generated, /<geom type="plane" size="5 5 0\.1" rgba="\.9 \.9 \.9 1"\/>/);
});

test('generated MJCF keeps visual meshes in the visual-only group', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'single-visual',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 2, z: 3 },
          color: '#262626',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {} as Record<string, never>,
    materials: {},
  };

  const generated = generateMujocoXML(robot);
  const parsed = parseMJCFModel(generated);
  const baseLinkBody = findBodyByName(parsed.worldBody as any, 'base_link');
  const visualGeom = baseLinkBody?.geoms?.[0];

  assert.ok(visualGeom);
  assert.equal(visualGeom.group, 1);
  assert.deepEqual(classifyMJCFGeom(visualGeom), { isVisual: true, isCollision: false });
});

test('generated MJCF carries USD snapshot material PBR fields into material assets', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'pbr-export',
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
          color: '#d6d9e4',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#000000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {
      base_link: {
        color: '#d6d9e4',
        texture: 'textures/body_basecolor.png',
        usdMaterial: {
          roughness: 0.25,
          metalness: 0.6,
          emissive: [0.4, 0.1, 0],
          emissiveIntensity: 0.5,
        },
      },
    },
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
    texturedir: 'textures/',
  });

  assert.match(generated, /<material name="base_link_mat"[^>]*texture="base_link_tex"/);
  assert.match(generated, /specular="0"/);
  assert.match(generated, /shininess="0\.75"/);
  assert.match(generated, /reflectance="0\.6"/);
  assert.match(generated, /emission="0\.2"/);
});

test('generated MJCF skips emission when USD snapshot material disables emissive output', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'disabled-emissive-export',
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
          color: '#bfc4d2',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#000000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {
      base_link: {
        color: '#bfc4d2',
        usdMaterial: {
          roughness: 0.4,
          emissive: [1, 1, 1],
          emissiveEnabled: false,
          emissiveIntensity: 10000,
        },
      },
    },
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
  });

  assert.match(generated, /<material name="base_link_mat"/);
  assert.match(generated, /specular="0"/);
  assert.match(generated, /shininess="0\.6"/);
  assert.doesNotMatch(generated, /emission="/);
});

test('generated MJCF keeps the root body at the world origin', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'root-origin',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.SPHERE,
          dimensions: { x: 0.2, y: 0, z: 0 },
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
  });
  const parsed = parseMJCFModel(generated);
  const baseLinkBody = findBodyByName(parsed.worldBody as any, 'base_link');

  assert.ok(baseLinkBody);
  assert.deepEqual(baseLinkBody.pos, [0, 0, 0]);
  assert.doesNotMatch(generated, /<light /);
  assert.doesNotMatch(generated, /type="plane"/);
});

test('generated MJCF exports plane geoms as first-class plane types', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'plane-export',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.PLANE,
          dimensions: { x: 6, y: 4, z: 0 },
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateMujocoXML(robot, { includeSceneHelpers: false });
  assert.match(generated, /type="plane" size="3 2 0\.1"/);
});

test('generated MJCF exports signed distance field geoms without collapsing them into mesh types', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'sdf-export',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.SDF,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#808080',
          meshPath: 'assets/distance_field.obj',
          assetRef: 'distance_field_source',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateMujocoXML(robot, { includeSceneHelpers: false, meshdir: 'meshes/' });
  assert.match(
    generated,
    /<mesh name="distance_field_source" file="assets\/distance_field\.obj"\s*\/>/,
  );
  assert.match(generated, /type="sdf" mesh="distance_field_source"/);
  assert.doesNotMatch(generated, /type="mesh" mesh="assets_distance_field"/);
});

test('generated MJCF exports hfield geoms with dedicated asset definitions', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'hfield-export',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.HFIELD,
          dimensions: { x: 4, y: 6, z: 0.5 },
          color: '#808080',
          assetRef: 'terrain_patch',
          mjcfHfield: {
            name: 'terrain_patch',
            file: 'terrain.png',
            contentType: 'image/png',
            size: {
              radiusX: 2,
              radiusY: 3,
              elevationZ: 0.4,
              baseZ: 0.1,
            },
          },
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateMujocoXML(robot, { includeSceneHelpers: false, meshdir: 'meshes/' });
  assert.match(
    generated,
    /<hfield name="terrain_patch" file="terrain\.png" content_type="image\/png" size="2 3 0\.4 0\.1" \/>/,
  );
  assert.match(generated, /type="hfield" hfield="terrain_patch"/);
});

test('generated MJCF preserves collision-only hfield metadata after MJCF import', () => {
  installDomParser();

  const robot = parseMJCF(`
        <mujoco model="collision-hfield-roundtrip">
          <asset>
            <hfield name="terrain_patch" file="terrain.png" size="2 3 0.4 0.1" />
          </asset>
          <worldbody>
            <body name="base_link">
              <geom
                name="terrain_collision"
                type="hfield"
                hfield="terrain_patch"
                group="3"
                contype="1"
                conaffinity="1"
                rgba="0.3 0.5 0.3 1"
              />
            </body>
          </worldbody>
        </mujoco>
    `);

  assert.ok(robot);
  assert.equal(robot.links.base_link.visual.type, GeometryType.NONE);
  assert.equal(robot.links.base_link.collision.type, GeometryType.HFIELD);
  assert.equal(robot.links.base_link.collision.assetRef, 'terrain_patch');
  assert.deepEqual(robot.links.base_link.collision.mjcfHfield, {
    name: 'terrain_patch',
    file: 'terrain.png',
    contentType: undefined,
    nrow: undefined,
    ncol: undefined,
    size: {
      radiusX: 2,
      radiusY: 3,
      elevationZ: 0.4,
      baseZ: 0.1,
    },
    elevation: undefined,
  });

  const generated = generateMujocoXML(robot, { includeSceneHelpers: false, meshdir: 'meshes/' });
  assert.match(
    generated,
    /<hfield name="terrain_patch" file="terrain\.png" size="2 3 0\.4 0\.1" \/>/,
  );
  assert.match(generated, /type="hfield" hfield="terrain_patch"/);
});

test('generated MJCF preserves inline-only mesh assets that have vertex data', () => {
  installDomParser();

  const robot = parseMJCF(`
        <mujoco model="inline-mesh-export">
          <asset>
            <mesh
              name="pyramid"
              vertex="0 6 0  0 -6 0  0.5 6 0  0.5 -6 0  0.5 6 0.5  0.5 -6 0.5"
            />
          </asset>
          <worldbody>
            <body name="base_link">
              <geom type="mesh" mesh="pyramid" />
            </body>
          </worldbody>
        </mujoco>
    `);

  const generated = generateMujocoXML(robot, { includeSceneHelpers: false, meshdir: 'meshes/' });

  assert.match(
    generated,
    /<mesh name="pyramid" vertex="0 6 0 0 -6 0 0\.5 6 0 0\.5 -6 0 0\.5 6 0\.5 0\.5 -6 0\.5" \/>/,
  );
  assert.match(generated, /<material name="base_link_mat" rgba="[^"]+" specular="0" \/>/);
  assert.match(
    generated,
    /<geom pos="0 0 0" group="1" contype="0" conaffinity="0" material="base_link_mat" type="mesh" mesh="pyramid" \/>/,
  );
  assert.match(
    generated,
    /<geom(?=[^>]*rgba="[^"]+")(?=[^>]*group="3")(?=[^>]*contype="1")(?=[^>]*conaffinity="1")(?=[^>]*type="mesh")(?=[^>]*mesh="pyramid")[^>]*>/,
  );
});

test('generated MJCF exports floating root joints as freejoints while preserving root pose', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'floating-root-export',
    rootLinkId: 'world',
    selection: { type: null, id: null },
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
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 0,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
        },
      },
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {
      floating_base_joint: {
        id: 'floating_base_joint',
        name: 'floating_base_joint',
        type: 'floating',
        parentLinkId: 'world',
        childLinkId: 'base_link',
        origin: {
          xyz: { x: 0, y: 0, z: 0.5 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        axis: { x: 0, y: 0, z: 1 },
        dynamics: { damping: 0, friction: 0 },
      } as RobotState['joints'][string],
    },
    materials: {},
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
  });
  const parsed = parseMJCFModel(generated);
  const baseLinkBody = findBodyByName(parsed.worldBody as any, 'base_link');
  const roundtrip = parseMJCF(generated);

  assert.match(
    generated,
    /<body name="base_link" pos="0 0 0\.5">[\s\S]*?<freejoint name="floating_base_joint"\/>/,
  );
  assert.doesNotMatch(generated, /<joint name="floating_base_joint" type="hinge"/);
  assert.ok(baseLinkBody);
  assert.deepEqual(baseLinkBody.pos, [0, 0, 0.5]);
  assert.ok(roundtrip);
  assert.equal(roundtrip?.joints.floating_base_joint?.type, 'floating');
  assert.deepEqual(roundtrip?.joints.floating_base_joint?.origin?.xyz, { x: 0, y: 0, z: 0.5 });
});

test('generated MJCF preserves fixed synthetic world root transforms through parser roundtrip', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'fixed-world-root-roundtrip',
    rootLinkId: 'world',
    selection: { type: null, id: null },
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
          color: '#ff0000',
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
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
      FR_thigh: {
        id: 'FR_thigh',
        name: 'FR_thigh',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 0.1, y: 0.3, z: 0.08 },
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: Math.PI / 2, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {
      world_to_base: {
        id: 'world_to_base',
        name: 'world_to_base',
        type: JointType.FIXED,
        parentLinkId: 'world',
        childLinkId: 'base',
        origin: {
          xyz: { x: 0.12, y: -0.08, z: 0.445 },
          rpy: { r: 0.25, p: -0.1, y: 0.4 },
        },
        axis: { x: 0, y: 0, z: 1 },
        dynamics: { damping: 0, friction: 0 },
        hardware: { armature: 0, motorType: '', motorId: '', motorDirection: 1 },
      },
      FR_thigh_joint: {
        id: 'FR_thigh_joint',
        name: 'FR_thigh_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'base',
        childLinkId: 'FR_thigh',
        origin: {
          xyz: { x: 0.1934, y: -0.0465, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        axis: { x: 0, y: 1, z: 0 },
        limit: { lower: -1, upper: 1, effort: 10, velocity: 10 },
        dynamics: { damping: 0, friction: 0 },
        hardware: { armature: 0, motorType: '', motorId: '', motorDirection: 1 },
      },
    },
    materials: {},
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
  });
  const roundtrip = parseMJCF(generated);

  assert.ok(roundtrip, 'expected generated MJCF to parse');
  assert.equal(roundtrip?.rootLinkId, 'world');
  assert.deepEqual(roundtrip?.joints.world_to_base?.origin?.xyz, { x: 0.12, y: -0.08, z: 0.445 });
  assertMatricesClose(robot, roundtrip!, ['world', 'base', 'FR_thigh']);
});

test('generated MJCF preserves sites on an otherwise synthetic world root', () => {
  installDomParser();

  const robot = parseMJCF(`
    <mujoco model="world-sites-only">
      <worldbody>
        <site name="actuation_center" pos="0 0 0.25" group="5" />
      </worldbody>
    </mujoco>
  `);
  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
  });
  const parsed = parseMJCFModel(generated);

  assert.doesNotMatch(generated, /<body name="world_link"/);
  assert.match(generated, /<site name="actuation_center"/);
  assert.deepEqual(parsed.worldBody.sites.map((site) => site.name), [
    'actuation_center',
  ]);
});

test('generated MJCF avoids reserved world body names for payload-bearing scene roots', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'world-scene-root',
    rootLinkId: 'world',
    selection: { type: null, id: null },
    links: {
      world: {
        ...DEFAULT_LINK,
        id: 'world',
        name: 'world',
        collision: {
          ...DEFAULT_LINK.collision,
          name: 'floor',
          type: GeometryType.PLANE,
          dimensions: { x: 5, y: 5, z: 0 },
        },
      },
      base: {
        ...DEFAULT_LINK,
        id: 'base',
        name: 'base',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
          dimensions: { x: 0.2, y: 0.2, z: 0.2 },
        },
      },
    },
    joints: {
      world_to_base: {
        ...DEFAULT_JOINT,
        id: 'world_to_base',
        name: 'world_to_base',
        type: JointType.FIXED,
        parentLinkId: 'world',
        childLinkId: 'base',
      },
    },
    materials: {},
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
  });
  const parsed = parseMJCFModel(generated);

  assert.doesNotMatch(generated, /<body name="world"/);
  assert.match(generated, /<body name="world_link"/);
  assert.ok(findBodyByName(parsed.worldBody as any, 'world_link'));
});

test('generated MJCF does not inject a duplicate freejoint when the root is already floating', () => {
  installDomParser();

  const robot = parseMJCF(`
        <mujoco model="floating-root">
          <worldbody>
            <body name="base_link" pos="0 0 0.5">
              <joint name="floating_base_joint" type="free" limited="false" />
            </body>
          </worldbody>
        </mujoco>
    `);

  assert.ok(robot);

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
    addFloatBase: true,
  });

  const freejointMatches = generated.match(/<freejoint\b/g) || [];
  assert.equal(freejointMatches.length, 1);
  assert.doesNotMatch(generated, /__joint_stage_0/);
});

test('generated MJCF preserves collision geom names through export and reparse', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'named-collisions',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 0.4, y: 0.3, z: 0.2 },
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.BOX,
          name: 'base_collision',
          dimensions: { x: 0.38, y: 0.28, z: 0.18 },
          color: '#00ff00',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [
          {
            type: GeometryType.SPHERE,
            name: 'motor_guard',
            dimensions: { x: 0.12, y: 0.12, z: 0.12 },
            color: '#ffaa00',
            origin: { xyz: { x: 0.1, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
        ],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateMujocoXML(robot, { includeSceneHelpers: false, meshdir: 'meshes/' });
  assert.match(generated, /<geom(?=[^>]*name="base_collision")(?=[^>]*group="3")[^>]*>/);
  assert.match(generated, /<geom(?=[^>]*name="motor_guard")(?=[^>]*group="3")[^>]*>/);

  const reparsed = parseMJCF(generated);
  assert.equal(reparsed.links.base_link.collision.name, 'base_collision');
  assert.equal(reparsed.links.base_link.collisionBodies?.[0]?.name, 'motor_guard');
});

test('unitree_go2 MJCF roundtrip preserves the floating root joint and home keyframe pose', () => {
  installDomParser();

  const source = fs.readFileSync(GO2_MJCF_PATH, 'utf8');
  const imported = parseMJCF(source);
  assert.ok(imported, 'expected unitree_go2 MJCF to parse');

  const importedRootJoint = imported?.joints.joint_0;
  assert.ok(importedRootJoint, 'expected unitree_go2 to expose joint_0 as the floating root');
  assert.equal(importedRootJoint?.type, 'floating');
  assert.deepEqual(importedRootJoint?.origin?.xyz, { x: 0, y: 0, z: 0.27 });

  const exported = generateMujocoXML(imported!, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
  });
  const reparsed = parseMJCF(exported);

  assert.ok(reparsed, 'expected exported unitree_go2 MJCF to parse');
  assert.equal(reparsed?.joints.joint_0?.type, 'floating');
  assert.deepEqual(reparsed?.joints.joint_0?.origin?.xyz, { x: 0, y: 0, z: 0.27 });
  assert.match(exported, /<body name="base" pos="0 0 0\.27">[\s\S]*?<freejoint name="joint_0"\/>/);
});

test('generated MJCF preserves missing URDF inertial without crashing', () => {
  installDomParser();

  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="missing_inertial">
  <link name="base_link">
    <visual>
      <geometry>
        <box size="1 1 1" />
      </geometry>
    </visual>
  </link>
</robot>`);

  assert.ok(robot);
  assert.equal(robot.links.base_link?.inertial, undefined);

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
  });

  assert.match(generated, /<body name="base_link"/);
  assert.doesNotMatch(generated, /<inertial\b/);
});

test('generated MJCF enables balanceinertia when a link inertia is invalid for MuJoCo', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'invalid-inertia-export',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 0.5, y: 0.3, z: 0.15 },
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 33.86,
          origin: { xyz: { x: -0.05, y: -0.007, z: -0.00984 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: {
            ixx: 0.21092,
            ixy: -0.000622,
            ixz: 0.12531,
            iyy: 0.7639,
            iyz: -0.00139,
            izz: 0.9483,
          },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
  });

  assert.match(
    generated,
    /<compiler(?=[^>]*meshdir="meshes\/")(?=[^>]*balanceinertia="true")[^>]*>/,
  );
  assert.match(
    generated,
    /<inertial pos="-0\.05 -0\.007 -0\.00984" mass="33\.86" fullinertia="0\.21092 0\.7639 0\.9483 -0\.000622 0\.12531 -0\.00139"\/>/,
  );
});

test('generated MJCF preserves tiny inertia terms instead of rounding them into singular tensors', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'tiny-inertia-export',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
          dimensions: { x: 0.02, y: 0.02, z: 0.02 },
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        inertial: {
          mass: 0.003344,
          origin: {
            xyz: { x: 0.0092888, y: -0.004953, z: -0.0060033 },
            rpy: { r: 0, p: 0, y: 0 },
          },
          inertia: {
            ixx: 1.3632e-7,
            ixy: 5.6787e-8,
            ixz: -9.1939e-11,
            iyy: 1.4052e-7,
            iyz: 1.2145e-10,
            izz: 2.0026e-7,
          },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
  });

  assert.match(
    generated,
    /fullinertia="0\.0000001363 0\.0000001405 0\.0000002003 0\.0000000568 -0\.0000000001 0\.0000000001"/,
  );
  assert.doesNotMatch(generated, /fullinertia="0\.0000001 0\.0000001 0\.0000002 0\.0000001 0 0"/);
});

test('generated MJCF keeps imported MJCF mesh geoms bound to mesh asset names instead of file paths', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'imported-mjcf-mesh-ref',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#808080',
          meshPath: '/tmp/demo/assets/base_0.obj',
          assetRef: 'base_0',
          mjcfMesh: {
            file: 'assets/base_0.obj',
          },
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
  });

  assert.match(generated, /<mesh name="base_0" file="assets\/base_0\.obj" \/>/);
  assert.match(generated, /<geom[^>]*type="mesh" mesh="base_0" \/>/);
  assert.doesNotMatch(generated, /mesh="\/tmp\/demo\/assets\/base_0\.obj"/);
});

test('generated MJCF writes visual materials from robot state and binds them on geoms', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'material-export',
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
          color: '#262626',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {
      base_link: {
        color: '#123456',
      },
    },
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
  });
  const parsed = parseMJCFModel(generated);
  const baseLinkBody = findBodyByName(parsed.worldBody as any, 'base_link');
  const visualGeom = baseLinkBody?.geoms?.[0];
  const visualMaterial = parsed.materialMap.get('base_link_mat');

  assert.ok(visualGeom);
  assert.equal(visualGeom.material, 'base_link_mat');
  assert.doesNotMatch(generated, /<default>\s*<geom\s+rgba=/s);
  assert.ok(visualMaterial);
  assert.deepEqual(
    visualMaterial?.rgba?.map((value) => Number(value.toFixed(4))),
    [0.0706, 0.2039, 0.3373, 1],
  );
});

test('generated MJCF prefers exact colorRgba values over quantized hex colors', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'rgba-material-export',
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
          color: '#262626',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {
      base_link: {
        color: '#19334c',
        colorRgba: [0.1, 0.2, 0.3, 0.4],
      },
    },
  };

  const generated = generateMujocoXML(robot, { includeSceneHelpers: false });
  const parsed = parseMJCFModel(generated);
  const visualMaterial = parsed.materialMap.get('base_link_mat');

  assert.deepEqual(visualMaterial?.rgba, [0.1, 0.2, 0.3, 0.4]);
});

test('generated MJCF exports texture assets and binds them through material definitions', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'texture-export',
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
          color: '#262626',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {
      base_link: {
        color: '#123456',
        texture: 'textures/coat.png',
      },
    },
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
  });
  const parsed = parseMJCFModel(generated);
  const baseLinkBody = findBodyByName(parsed.worldBody as any, 'base_link');
  const visualGeom = baseLinkBody?.geoms?.[0];
  const visualMaterial = parsed.materialMap.get('base_link_mat');
  const visualTexture = parsed.textureMap.get('base_link_tex');

  assert.ok(visualGeom);
  assert.equal(parsed.compilerSettings.texturedir, 'textures/');
  assert.equal(visualGeom.material, 'base_link_mat');
  assert.equal(visualMaterial?.texture, 'base_link_tex');
  assert.equal(visualTexture?.file, 'textures/coat.png');
  assert.match(generated, /<texture name="base_link_tex" type="2d" file="coat\.png" \/>/);
});

test('generated MJCF uses a neutral white rgba for texture-only materials', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'texture-only-export',
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
          color: '#3b82f6',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {
      base_link: {
        texture: 'textures/coat.png',
      },
    },
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
  });

  assert.match(
    generated,
    /<material name="base_link_mat" rgba="1 1 1 1" texture="base_link_tex" specular="0" \/>/,
  );
  assert.doesNotMatch(
    generated,
    /<material name="base_link_mat" rgba="0\.2314 0\.5098 0\.9647 1" texture="base_link_tex" specular="0" \/>/,
  );
});

test('generated MJCF exports six-face box textures as a cube texture asset', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'cube-texture-export',
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
          color: '#ffffff',
          authoredMaterials: [
            { texture: 'textures/right.png' },
            { texture: 'textures/left.png' },
            { texture: 'textures/up.png' },
            { texture: 'textures/down.png' },
            { texture: 'textures/front.png' },
            { texture: 'textures/back.png' },
          ],
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
  });
  const parsed = parseMJCFModel(generated);
  const baseLinkBody = findBodyByName(parsed.worldBody as any, 'base_link');
  const visualGeom = baseLinkBody?.geoms?.[0];
  const visualMaterial = parsed.materialMap.get('base_link_mat');
  const visualTexture = parsed.textureMap.get('base_link_cube_tex');

  assert.ok(visualGeom);
  assert.equal(visualGeom.material, 'base_link_mat');
  assert.equal(visualMaterial?.texture, 'base_link_cube_tex');
  assert.equal(visualMaterial?.rgba?.join(' '), '1 1 1 1');
  assert.equal(visualTexture?.type, 'cube');
  assert.equal(visualTexture?.fileright, 'right.png');
  assert.equal(visualTexture?.fileleft, 'left.png');
  assert.equal(visualTexture?.fileup, 'up.png');
  assert.equal(visualTexture?.filedown, 'down.png');
  assert.equal(visualTexture?.filefront, 'front.png');
  assert.equal(visualTexture?.fileback, 'back.png');
  assert.match(
    generated,
    /<texture name="base_link_cube_tex" type="cube" fileright="right\.png" fileleft="left\.png" fileup="up\.png" filedown="down\.png" filefront="front\.png" fileback="back\.png" \/>/,
  );
});

test('generated MJCF scopes texture-backed materials per visual object', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'per-visual-texture-export',
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
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {
      base_link: {
        texture: 'textures/legacy.png',
      },
    },
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
  });
  const parsed = parseMJCFModel(generated);
  const baseLinkBody = findBodyByName(parsed.worldBody as any, 'base_link');
  const primaryGeom = baseLinkBody?.geoms?.[0];
  const secondaryGeom = baseLinkBody?.geoms?.[1];

  assert.ok(primaryGeom);
  assert.ok(secondaryGeom);
  assert.equal(primaryGeom.material, 'base_link_mat');
  assert.equal(secondaryGeom.material, 'base_link_mat_2');
  assert.equal(parsed.materialMap.get('base_link_mat')?.texture, 'base_link_tex');
  assert.equal(parsed.materialMap.get('base_link_mat_2')?.texture, 'base_link_tex_2');
  assert.equal(parsed.textureMap.get('base_link_tex')?.file, 'textures/primary.png');
  assert.equal(parsed.textureMap.get('base_link_tex_2')?.file, 'textures/secondary.png');
  assert.doesNotMatch(generated, /legacy\.png/);
});

test('generated MJCF keeps Gazebo package texture exports distinct when filenames collide', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'gazebo_texture_collision',
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
          color: '#ffffff',
          authoredMaterials: [{ texture: 'model_a/materials/textures/bus.png' }],
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        visualBodies: [
          {
            type: GeometryType.BOX,
            dimensions: { x: 0.5, y: 0.5, z: 0.5 },
            color: '#ffffff',
            authoredMaterials: [{ texture: 'model_b/materials/textures/bus.png' }],
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
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
  });
  const parsed = parseMJCFModel(generated);

  assert.match(generated, /<texture name="base_link_tex" type="2d" file="model_a\/bus\.png" \/>/);
  assert.match(generated, /<texture name="base_link_tex_2" type="2d" file="model_b\/bus\.png" \/>/);
  assert.equal(parsed.textureMap.get('base_link_tex')?.file, 'textures/model_a/bus.png');
  assert.equal(parsed.textureMap.get('base_link_tex_2')?.file, 'textures/model_b/bus.png');
  assert.equal(parsed.materialMap.get('base_link_mat')?.texture, 'base_link_tex');
  assert.equal(parsed.materialMap.get('base_link_mat_2')?.texture, 'base_link_tex_2');
});

test('generated MJCF honors mesh export path overrides for converted assets', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'mesh-override',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#808080',
          meshPath: 'package://go2_description/dae/hip.dae',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
    meshPathOverrides: new Map([['package://go2_description/dae/hip.dae', 'dae/hip.obj']]),
  });

  assert.match(generated, /<mesh name="dae_hip" file="dae\/hip\.obj"/);
  assert.doesNotMatch(generated, /file="dae\/hip\.dae"/);
});

test('generated MJCF preserves nested meshPathOverrides without stripping inner mesh directories', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'nested-mesh-override',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#808080',
          meshPath: 'b2_z1_description/meshes/arm_meshes/meshes/visual/z1_Link00.dae',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
    meshPathOverrides: new Map([
      [
        'b2_z1_description/meshes/arm_meshes/meshes/visual/z1_Link00.dae',
        'arm_meshes/meshes/visual/z1_Link00.obj',
      ],
    ]),
  });

  assert.match(
    generated,
    /<mesh name="arm_meshes_meshes_visual_z1_Link00" file="arm_meshes\/meshes\/visual\/z1_Link00\.obj"/,
  );
  assert.doesNotMatch(generated, /file="visual\/z1_Link00\.obj"/);
});

test('generated MJCF emits separate visual geoms for extracted mesh material variants', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'mesh-visual-variants',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#808080',
          meshPath: 'package://go2_description/dae/base.dae',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
    meshPathOverrides: new Map([['package://go2_description/dae/base.dae', 'dae/base.obj']]),
    visualMeshVariants: new Map([
      [
        'package://go2_description/dae/base.dae',
        [
          { meshPath: 'dae/base_black.obj', color: '#000000' },
          { meshPath: 'dae/base_white.obj', color: '#ffffff' },
          { meshPath: 'dae/base_gray.obj', color: '#abb1c5' },
        ],
      ],
    ]),
  });

  const parsed = parseMJCFModel(generated);
  const baseLinkBody = findBodyByName(parsed.worldBody as any, 'base_link');
  const visualGeoms = (baseLinkBody?.geoms || []).filter((geom: any) => geom.group === 1);

  assert.equal(visualGeoms.length, 3);
  assert.deepEqual(
    visualGeoms.map((geom: any) => geom.material),
    ['base_link_mat_1', 'base_link_mat_2', 'base_link_mat_3'],
  );
  assert.deepEqual(
    parsed.materialMap.get('base_link_mat_1')?.rgba?.map((value) => Number(value.toFixed(4))),
    [0, 0, 0, 1],
  );
  assert.equal(parsed.materialMap.get('base_link_mat_1')?.specular, 0);
  assert.deepEqual(
    parsed.materialMap.get('base_link_mat_2')?.rgba?.map((value) => Number(value.toFixed(4))),
    [1, 1, 1, 1],
  );
  assert.equal(parsed.materialMap.get('base_link_mat_2')?.specular, 0);
  assert.match(generated, /<mesh name="dae_base_black" file="dae\/base_black\.obj" \/>/);
  assert.match(generated, /<mesh name="dae_base_white" file="dae\/base_white\.obj" \/>/);
  assert.match(generated, /<mesh name="dae_base_gray" file="dae\/base_gray\.obj" \/>/);
});

test('generated MJCF binds texture-backed mesh material variants through per-variant materials', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'mesh-visual-variant-textures',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#808080',
          meshPath: 'package://go2_description/dae/base.dae',
          authoredMaterials: [
            { name: 'painted_shell', texture: 'textures/shell.png' },
            { name: 'logo', texture: 'textures/logo.png' },
          ],
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
    visualMeshVariants: new Map([
      [
        'package://go2_description/dae/base.dae',
        [
          { meshPath: 'dae/base_painted_shell.obj', sourceMaterialName: 'painted_shell' },
          { meshPath: 'dae/base_logo.obj', sourceMaterialName: 'logo' },
        ],
      ],
    ]),
  });

  const parsed = parseMJCFModel(generated);
  const baseLinkBody = findBodyByName(parsed.worldBody as any, 'base_link');
  const visualGeoms = (baseLinkBody?.geoms || []).filter((geom: any) => geom.group === 1);

  assert.equal(visualGeoms.length, 2);
  assert.deepEqual(
    visualGeoms.map((geom: any) => geom.material),
    ['base_link_mat_1', 'base_link_mat_2'],
  );
  assert.equal(parsed.materialMap.get('base_link_mat_1')?.texture, 'base_link_tex');
  assert.equal(parsed.materialMap.get('base_link_mat_2')?.texture, 'base_link_tex_2');
  assert.equal(parsed.textureMap.get('base_link_tex')?.file, 'textures/shell.png');
  assert.equal(parsed.textureMap.get('base_link_tex_2')?.file, 'textures/logo.png');
  assert.match(
    generated,
    /<mesh name="dae_base_painted_shell" file="dae\/base_painted_shell\.obj" \/>/,
  );
  assert.match(generated, /<mesh name="dae_base_logo" file="dae\/base_logo\.obj" \/>/);
});

test('generated MJCF preserves extracted variant colors when a single URDF override material cannot be matched back to DAE submaterials', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'mesh-visual-variant-color-fallback',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#ff6c0a',
          meshPath: 'package://aliengo_description/meshes/calf.dae',
          authoredMaterials: [{ name: 'orange', color: '#ff6c0a' }],
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
    visualMeshVariants: new Map([
      [
        'package://aliengo_description/meshes/calf.dae',
        [
          {
            meshPath: 'meshes/calf_materialfbxasc032fbxasc03528.obj',
            color: '#404040',
            sourceMaterialName: 'MaterialFBXASC032FBXASC03528',
          },
          {
            meshPath: 'meshes/calf_materialfbxasc032fbxasc03529.obj',
            color: '#ffffff',
            sourceMaterialName: 'MaterialFBXASC032FBXASC03529',
          },
        ],
      ],
    ]),
  });

  const parsed = parseMJCFModel(generated);
  const baseLinkBody = findBodyByName(parsed.worldBody as any, 'base_link');
  const visualGeoms = (baseLinkBody?.geoms || []).filter((geom: any) => geom.group === 1);

  assert.equal(visualGeoms.length, 2);
  assert.deepEqual(
    parsed.materialMap.get('base_link_mat_1')?.rgba?.map((value) => Number(value.toFixed(4))),
    [0.251, 0.251, 0.251, 1],
  );
  assert.deepEqual(
    parsed.materialMap.get('base_link_mat_2')?.rgba?.map((value) => Number(value.toFixed(4))),
    [1, 1, 1, 1],
  );
  assert.notDeepEqual(
    parsed.materialMap.get('base_link_mat_1')?.rgba?.map((value) => Number(value.toFixed(4))),
    [1, 0.4235, 0.0392, 1],
  );
});

test('generated MJCF prefers extracted variant colors over matched authored material colors while keeping variant material binding', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'mesh-visual-variant-color-match',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#abb0c5',
          meshPath: 'package://go2_description/dae/base.dae',
          authoredMaterials: [
            { name: 'dark_rubber.001', color: '#abb0c5' },
            { name: 'logo.001', color: '#ffffff' },
          ],
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
    visualMeshVariants: new Map([
      [
        'package://go2_description/dae/base.dae',
        [
          {
            meshPath: 'dae/base_001.obj',
            color: '#abb1c5',
            sourceMaterialName: 'dark_rubber.001',
          },
          {
            meshPath: 'dae/base_logo_001.obj',
            color: '#ffffff',
            sourceMaterialName: 'logo.001',
          },
        ],
      ],
    ]),
  });

  const parsed = parseMJCFModel(generated);
  assert.deepEqual(
    parsed.materialMap.get('base_link_mat_1')?.rgba?.map((value) => Number(value.toFixed(4))),
    [0.6706, 0.6941, 0.7725, 1],
  );
  assert.notDeepEqual(
    parsed.materialMap.get('base_link_mat_1')?.rgba?.map((value) => Number(value.toFixed(4))),
    [0.6706, 0.6902, 0.7725, 1],
  );
});

test('generated MJCF preserves collision colors and alpha through parser roundtrip', async () => {
  installDomParser();

  const { parseMJCF } = await import('./mjcfParser.ts');

  const robot: RobotState = {
    name: 'collision-color-roundtrip',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#262626',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 2, z: 3 },
          color: '#12345680',
          origin: { xyz: { x: 0.4, y: 0.5, z: 0.6 }, rpy: { r: 0.1, p: 0.2, y: 0.3 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateMujocoXML(robot, { includeSceneHelpers: false });
  assert.match(generated, /rgba="0\.0706 0\.2039 0\.3373 0\.502"/);

  const parsed = parseMJCF(generated);
  assert.ok(parsed);
  assert.equal(parsed.links.base_link.collision.color, '#12345680');
});

test('generated MJCF exports joint armature when the source joint provides it', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'joint-armature-export',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
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
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
      child_link: {
        id: 'child_link',
        name: 'child_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {
      arm_joint: {
        id: 'arm_joint',
        name: 'arm_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'child_link',
        origin: {
          xyz: { x: 0, y: 0, z: 0.3 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: -1, upper: 1, effort: 3, velocity: 4 },
        dynamics: { damping: 0.2, friction: 0.1 },
        hardware: {
          armature: 0.42,
          motorType: 'None',
          motorId: '',
          motorDirection: 1,
        },
      },
    },
    materials: {},
  };

  const generated = generateMujocoXML(robot, { includeSceneHelpers: false });
  const parsed = parseMJCFModel(generated);
  const childBody = findBodyByName(parsed.worldBody as any, 'child_link');

  assert.match(generated, /<joint name="arm_joint"[^>]* armature="0\.42"[^>]*\/>/);
  assert.equal(childBody?.joints[0]?.armature, 0.42);
});

test('generated MJCF exports joint reference position and effort limits through official scalar joint attrs', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'joint-ref-and-effort-export',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
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
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
      child_link: {
        id: 'child_link',
        name: 'child_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {
      arm_joint: {
        id: 'arm_joint',
        name: 'arm_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'child_link',
        origin: {
          xyz: { x: 0, y: 0, z: 0.3 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: -1, upper: 1, effort: 3, velocity: 4 },
        dynamics: { damping: 0.2, friction: 0.1 },
        hardware: {
          armature: 0,
          motorType: 'None',
          motorId: '',
          motorDirection: 1,
        },
        referencePosition: -0.25,
        angle: 0.4,
      },
    },
    materials: {},
  };

  const generated = generateMujocoXML(robot, { includeSceneHelpers: false });
  const parsedModel = parseMJCFModel(generated);
  const reparsed = parseMJCF(generated);
  const childBody = findBodyByName(parsedModel.worldBody as any, 'child_link');
  const exportedJoint = childBody?.joints[0];
  const exportedActuator = parsedModel.actuatorMap.get('arm_joint')?.[0];

  assert.match(
    generated,
    /<joint name="arm_joint"[^>]* limited="true"[^>]* range="-1 1"[^>]* ref="-0\.25"[^>]*\/>/,
  );
  assert.match(
    generated,
    /<position name="arm_joint_servo"[^>]* joint="arm_joint"[^>]* kp="1\.5"[^>]* forcelimited="true" forcerange="-3 3"[^>]*\/>/,
  );
  assert.doesNotMatch(generated, /actuatorfrclimited|actuatorfrcrange/);
  assert.equal(exportedJoint?.limited, true);
  assert.equal(exportedJoint?.ref, -0.25);
  assert.equal(exportedJoint?.actuatorForceRange, undefined);
  assert.equal(exportedJoint?.actuatorForceLimited, undefined);
  assert.deepEqual(exportedActuator?.forcerange, [-3, 3]);
  assert.equal(exportedActuator?.forcelimited, true);
  assert.equal(reparsed.joints.arm_joint?.referencePosition, -0.25);
  assert.equal(reparsed.joints.arm_joint?.angle, -0.25);
  assert.equal(reparsed.joints.arm_joint?.limit?.effort, 3);
});

test('generated MJCF widens zero-span revolute joint limits into a MuJoCo-safe locked range', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'locked-joint-export',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
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
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
      child_link: {
        id: 'child_link',
        name: 'child_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {
      locked_joint: {
        ...DEFAULT_JOINT,
        id: 'locked_joint',
        name: 'locked_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'child_link',
        origin: {
          xyz: { x: 0, y: 0, z: 0.3 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: 0, upper: 0, effort: 0, velocity: 0 },
        dynamics: { damping: 0, friction: 0 },
      },
    },
    materials: {},
  };

  const generated = generateMujocoXML(robot, { includeSceneHelpers: false });
  const reparsed = parseMJCF(generated);
  const exportedLimit = reparsed.joints.locked_joint?.limit;

  assert.match(
    generated,
    /<joint name="locked_joint"[^>]* limited="true"[^>]* range="-0\.0000005 0\.0000005"[^>]*\/>/,
  );
  assert.ok(exportedLimit, 'expected reparsed locked joint limit');
  assert.equal(exportedLimit?.lower, -5e-7);
  assert.equal(exportedLimit?.upper, 5e-7);
});

test('generated MJCF degrades unsupported planar joints to freejoint instead of throwing', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'planar-joint-export',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
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
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
      child_link: {
        id: 'child_link',
        name: 'child_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {
      planar_joint: {
        id: 'planar_joint',
        name: 'planar_joint',
        type: JointType.PLANAR,
        parentLinkId: 'base_link',
        childLinkId: 'child_link',
        origin: {
          xyz: { x: 0, y: 0, z: 0.3 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        axis: { x: 0, y: 0, z: 1 },
        dynamics: { damping: 0.2, friction: 0.1 },
        hardware: {
          armature: 0,
          motorType: 'None',
          motorId: '',
          motorDirection: 1,
        },
      } as RobotState['joints'][string],
    },
    materials: {},
  };

  // Planar joints should now degrade to freejoint instead of throwing
  const generated = generateMujocoXML(robot, { includeSceneHelpers: false });
  assert.ok(
    generated.includes('<freejoint name="planar_joint"'),
    'expected planar joint to degrade to freejoint',
  );
});

test('generated MJCF exports connect closed loops as equality connect constraints', () => {
  installDomParser();

  const robot = createClosedLoopExportRobot();
  robot.closedLoopConstraints = [
    {
      id: 'four_bar_connect',
      type: 'connect',
      linkAId: 'left_link',
      linkBId: 'right_link',
      anchorLocalA: { x: 0, y: 1, z: 0 },
      anchorLocalB: { x: 0, y: -1, z: 0 },
      anchorWorld: { x: 1, y: 1, z: 0 },
    },
  ];

  const generated = generateMujocoXML(robot, { includeSceneHelpers: false });
  const parsed = parseMJCFModel(generated);

  assert.deepEqual(parsed.connectConstraints, [
    {
      name: 'four_bar_connect',
      body1: 'left_link',
      body2: 'right_link',
      anchor: [0, 1, 0],
    },
  ]);

  const roundtrip = parseMJCF(generated);
  assert.ok(roundtrip.closedLoopConstraints);
  assert.equal(roundtrip.closedLoopConstraints?.length, 1);

  const [constraint] = roundtrip.closedLoopConstraints ?? [];
  assert.ok(constraint);
  assert.equal(constraint.type, 'connect');
  assert.equal(constraint.linkAId, 'left_link');
  assert.equal(constraint.linkBId, 'right_link');
  assert.deepEqual(constraint.anchorLocalA, { x: 0, y: 1, z: 0 });
  assert.deepEqual(constraint.anchorLocalB, { x: 0, y: -1, z: 0 });
  assert.deepEqual(constraint.anchorWorld, { x: 1, y: 1, z: 0 });
  assertMatricesClose(robot, roundtrip, ['left_link', 'right_link']);
});

test('generated MJCF exports distance closed loops as fixed-range spatial tendons', () => {
  installDomParser();

  const robot = createClosedLoopExportRobot();
  robot.joints.right_joint.origin = {
    xyz: { x: 1.4, y: 0, z: 0 },
    rpy: { r: 0, p: 0, y: 0 },
  };
  robot.closedLoopConstraints = [
    {
      id: 'closing_bar',
      type: 'distance',
      linkAId: 'left_link',
      linkBId: 'right_link',
      anchorLocalA: { x: 0, y: 0, z: 0 },
      anchorLocalB: { x: 0, y: 0, z: 0 },
      anchorWorld: { x: 1, y: 0, z: 0 },
      restDistance: 0.4,
    },
  ];

  const generated = generateMujocoXML(robot, { includeSceneHelpers: false });
  const parsed = parseMJCFModel(generated);
  const leftBody = findBodyByName(parsed.worldBody as any, 'left_link');
  const rightBody = findBodyByName(parsed.worldBody as any, 'right_link');
  const tendon = parsed.tendonMap.get('closing_bar');

  assert.ok(leftBody);
  assert.ok(rightBody);
  assert.equal(leftBody?.sites.length, 1);
  assert.equal(rightBody?.sites.length, 1);
  assert.ok(tendon);
  assert.equal(tendon?.type, 'spatial');
  assert.equal(tendon?.limited, true);
  assert.deepEqual(tendon?.range, [0.4, 0.400001]);
  assert.deepEqual(
    tendon?.attachments.map((attachment) => attachment.type),
    ['site', 'site'],
  );
  assert.equal(tendon?.attachments[0]?.ref, leftBody?.sites[0]?.name);
  assert.equal(tendon?.attachments[1]?.ref, rightBody?.sites[0]?.name);
  assert.match(generated, /<spatial name="closing_bar" limited="true" range="0\.4 0\.400001">/);

  const roundtrip = parseMJCF(generated);
  assert.ok(roundtrip.closedLoopConstraints);
  assert.equal(roundtrip.closedLoopConstraints?.length, 1);

  const [constraint] = roundtrip.closedLoopConstraints ?? [];
  assert.ok(constraint);
  assert.equal(constraint.type, 'distance');
  assert.equal(constraint.linkAId, 'left_link');
  assert.equal(constraint.linkBId, 'right_link');
  assert.deepEqual(constraint.anchorLocalA, { x: 0, y: 0, z: 0 });
  assert.deepEqual(constraint.anchorLocalB, { x: 0, y: 0, z: 0 });
  assert.equal(constraint.restDistance, 0.4);
});

test('generated MJCF exports mimic joints as equality joint constraints', () => {
  installDomParser();

  const robot = createClosedLoopExportRobot();
  robot.joints.right_joint.mimic = {
    joint: 'left_joint',
    multiplier: -1.5,
    offset: 0.25,
  };

  const generated = generateMujocoXML(robot, { includeSceneHelpers: false });
  const parsed = parseMJCFModel(generated);

  assert.deepEqual(parsed.jointEqualityConstraints, [
    {
      name: 'right_joint_mimic',
      joint1: 'right_joint',
      joint2: 'left_joint',
      polycoef: [0.25, -1.5, 0, 0, 0],
    },
  ]);

  const roundtrip = parseMJCF(generated);
  assert.deepEqual(roundtrip.joints.right_joint?.mimic, {
    joint: 'left_joint',
    multiplier: -1.5,
    offset: 0.25,
  });
});

test('generated MJCF fails fast on malformed closed-loop constraints', () => {
  installDomParser();

  const robotWithMissingLink = createClosedLoopExportRobot();
  robotWithMissingLink.closedLoopConstraints = [
    {
      id: 'missing_link_connect',
      type: 'connect',
      linkAId: 'missing_link',
      linkBId: 'right_link',
      anchorLocalA: { x: 0, y: 0, z: 0 },
      anchorLocalB: { x: 0, y: 0, z: 0 },
      anchorWorld: { x: 0, y: 0, z: 0 },
    },
  ];

  assert.throws(
    () => generateMujocoXML(robotWithMissingLink, { includeSceneHelpers: false }),
    /\[MJCF export\] Closed-loop constraint "missing_link_connect" references missing link/,
  );

  const robotWithInvalidDistance = createClosedLoopExportRobot();
  robotWithInvalidDistance.closedLoopConstraints = [
    {
      id: 'invalid_distance',
      type: 'distance',
      linkAId: 'left_link',
      linkBId: 'right_link',
      anchorLocalA: { x: 0, y: 0, z: 0 },
      anchorLocalB: { x: 0, y: 0, z: 0 },
      anchorWorld: { x: 1, y: 0, z: 0 },
      restDistance: Number.NaN,
    },
  ];

  assert.throws(
    () => generateMujocoXML(robotWithInvalidDistance, { includeSceneHelpers: false }),
    /\[MJCF export\] Distance closed-loop constraint "invalid_distance" has a non-finite rest distance\./,
  );
});

test('mimic joints are excluded from actuator generation', () => {
  installDomParser();

  const robot = createClosedLoopExportRobot();
  // Add a separate link for the mimic joint to drive
  robot.links.mimic_finger = {
    ...DEFAULT_LINK,
    id: 'mimic_finger',
    name: 'mimic_finger',
    visual: {
      ...DEFAULT_LINK.visual,
      type: GeometryType.BOX,
      dimensions: { x: 0.05, y: 0.05, z: 0.05 },
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    },
    collision: {
      ...DEFAULT_LINK.collision,
      type: GeometryType.BOX,
      dimensions: { x: 0.05, y: 0.05, z: 0.05 },
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    },
  };
  // Add a prismatic mimic joint that mimics left_joint
  robot.joints.mimic_slide = {
    ...DEFAULT_JOINT,
    id: 'mimic_slide',
    name: 'mimic_slide',
    type: JointType.PRISMATIC,
    parentLinkId: 'base_link',
    childLinkId: 'mimic_finger',
    origin: { xyz: { x: 0, y: 1, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    axis: { x: 0, y: 1, z: 0 },
    limit: { lower: 0, upper: 0.05, effort: 100, velocity: 1 },
    mimic: { joint: 'left_joint', multiplier: 1, offset: 0 },
  };

  const generated = generateMujocoXML(robot, { includeSceneHelpers: false, includeActuators: true, actuatorType: 'position' });

  // Verify no actuator was generated for the mimic joint
  assert.ok(
    !generated.includes('mimic_slide_servo'),
    'expected mimic joint to not have a position actuator',
  );
  assert.ok(
    !generated.includes('mimic_slide_motor'),
    'expected mimic joint to not have a motor actuator',
  );

  // Verify the driver joint (left_joint) still has an actuator
  assert.ok(
    generated.includes('left_joint_servo'),
    'expected driver joint to still have an actuator',
  );
});

test('mimic joints do not export joint limits', () => {
  installDomParser();

  const robot = createClosedLoopExportRobot();
  // Add a separate link for the mimic joint to drive
  robot.links.mimic_finger = {
    ...DEFAULT_LINK,
    id: 'mimic_finger',
    name: 'mimic_finger',
    visual: {
      ...DEFAULT_LINK.visual,
      type: GeometryType.BOX,
      dimensions: { x: 0.05, y: 0.05, z: 0.05 },
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    },
    collision: {
      ...DEFAULT_LINK.collision,
      type: GeometryType.BOX,
      dimensions: { x: 0.05, y: 0.05, z: 0.05 },
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    },
  };
  // Add a prismatic mimic joint with a limit
  robot.joints.mimic_joint = {
    ...DEFAULT_JOINT,
    id: 'mimic_joint',
    name: 'mimic_joint',
    type: JointType.PRISMATIC,
    parentLinkId: 'base_link',
    childLinkId: 'mimic_finger',
    origin: { xyz: { x: 0, y: 1, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    axis: { x: 0, y: 1, z: 0 },
    limit: { lower: 0, upper: 0.044, effort: 333, velocity: 10 },
    mimic: { joint: 'left_joint' },
  };

  const generated = generateMujocoXML(robot, { includeSceneHelpers: false });

  // The mimic joint should appear in the generated XML (as a joint element)
  assert.ok(
    generated.includes('mimic_joint'),
    'expected mimic joint to appear in the generated MJCF',
  );

  // The mimic joint should NOT have limited="true" or a range attribute
  const mimicJointLine = generated
    .split('\n')
    .find((line) => line.includes('name="mimic_joint"'));
  assert.ok(mimicJointLine, 'expected to find mimic joint element in generated MJCF');
  assert.ok(
    !mimicJointLine.includes('limited'),
    'expected mimic joint to not have limited attribute',
  );
  assert.ok(
    !mimicJointLine.includes('range'),
    'expected mimic joint to not have range attribute',
  );

  // The equality constraint should still be present
  assert.ok(
    generated.includes('mimic_joint_mimic'),
    'expected mimic equality constraint to be present',
  );
});
