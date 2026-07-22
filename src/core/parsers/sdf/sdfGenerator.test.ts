import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  GeometryType,
  JointType,
  type RobotClosedLoopConstraint,
  type RobotState,
} from '@/types';
import { parseMJCF } from '@/core/parsers/mjcf/mjcfParser.ts';
import { generateSDF, generateSdfModelConfig } from './sdfGenerator.ts';
import { parseSDF } from './sdfParser.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;

const CLOSED_LOOP_ROUNDTRIP_FIXTURES = [
  {
    name: 'agility_cassie',
    path: 'test/mujoco_menagerie-main/agility_cassie/cassie.xml',
    expectedClosedLoopCount: 4,
    expectUnsupportedFloatingRoot: false,
  },
  {
    name: 'robotiq_2f85',
    path: 'test/mujoco_menagerie-main/robotiq_2f85/2f85.xml',
    expectedClosedLoopCount: 2,
    expectUnsupportedFloatingRoot: false,
  },
] as const;

function assertVectorAlmostEqual(
  actual: { x: number; y: number; z: number },
  expected: { x: number; y: number; z: number },
  message: string,
): void {
  assert.ok(Math.abs(actual.x - expected.x) <= 1e-6, `${message} (x)`);
  assert.ok(Math.abs(actual.y - expected.y) <= 1e-6, `${message} (y)`);
  assert.ok(Math.abs(actual.z - expected.z) <= 1e-6, `${message} (z)`);
}

function assertClosedLoopConstraintsMatch(
  actualConstraints: RobotClosedLoopConstraint[] | undefined,
  expectedConstraints: RobotClosedLoopConstraint[] | undefined,
  fixtureName: string,
): void {
  const actualEntries = [...(actualConstraints || [])].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const expectedEntries = [...(expectedConstraints || [])].sort((left, right) =>
    left.id.localeCompare(right.id),
  );

  assert.equal(
    actualEntries.length,
    expectedEntries.length,
    `expected ${fixtureName} to preserve closed-loop constraint count`,
  );

  const actualById = new Map(actualEntries.map((constraint) => [constraint.id, constraint]));
  for (const expectedConstraint of expectedEntries) {
    const actualConstraint = actualById.get(expectedConstraint.id);
    assert.ok(
      actualConstraint,
      `expected ${fixtureName} to preserve closed-loop id ${expectedConstraint.id}`,
    );
    if (!actualConstraint) {
      continue;
    }

    assert.equal(actualConstraint.type, expectedConstraint.type);
    assert.equal(actualConstraint.linkAId, expectedConstraint.linkAId);
    assert.equal(actualConstraint.linkBId, expectedConstraint.linkBId);
    assertVectorAlmostEqual(
      actualConstraint.anchorLocalA,
      expectedConstraint.anchorLocalA,
      `${fixtureName} ${expectedConstraint.id} anchorLocalA`,
    );
    assertVectorAlmostEqual(
      actualConstraint.anchorLocalB,
      expectedConstraint.anchorLocalB,
      `${fixtureName} ${expectedConstraint.id} anchorLocalB`,
    );
    assertVectorAlmostEqual(
      actualConstraint.anchorWorld,
      expectedConstraint.anchorWorld,
      `${fixtureName} ${expectedConstraint.id} anchorWorld`,
    );
  }
}

test('generateSDF produces a roundtrippable model package for RobotState data', () => {
  const robot: RobotState = {
    name: 'roundtrip_demo',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 2, z: 3 },
          color: '#336699',
        },
        visualBodies: [
          {
            ...DEFAULT_LINK.visual,
            type: GeometryType.MESH,
            dimensions: { x: 0.5, y: 0.5, z: 0.5 },
            meshPath: 'package://demo_pkg/meshes/sign.dae',
            color: '#ffffff',
            origin: {
              xyz: { x: 0.5, y: 0, z: 0 },
              rpy: { r: 0, p: 0, y: 0 },
            },
          },
        ],
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 2, z: 3 },
        },
        collisionBodies: [
          {
            ...DEFAULT_LINK.collision,
            type: GeometryType.SPHERE,
            dimensions: { x: 0.25, y: 0.25, z: 0.25 },
            origin: {
              xyz: { x: 0, y: 1, z: 0 },
              rpy: { r: 0, p: 0, y: 0 },
            },
          },
        ],
        inertial: {
          mass: 2.5,
          origin: {
            xyz: { x: 0.05, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
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
      },
      tip_link: {
        ...DEFAULT_LINK,
        id: 'tip_link',
        name: 'tip_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.CYLINDER,
          dimensions: { x: 0.1, y: 0.4, z: 0.1 },
          color: '#ff8800',
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.CYLINDER,
          dimensions: { x: 0.1, y: 0.4, z: 0.1 },
        },
      },
    },
    joints: {
      tip_joint: {
        ...DEFAULT_JOINT,
        id: 'tip_joint',
        name: 'tip_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'tip_link',
        origin: {
          xyz: { x: 0.1, y: 0.2, z: 0.3 },
          rpy: { r: 0.1, p: -0.2, y: 0.3 },
        },
        axis: { x: 0, y: 0, z: 1 },
        limit: {
          lower: -1.57,
          upper: 1.57,
          effort: 10,
          velocity: 2,
        },
        dynamics: {
          damping: 0.2,
          friction: 0.05,
        },
      },
    },
    selection: { type: null, id: null },
  };

  const xml = generateSDF(robot, { packageName: 'roundtrip_pkg' });
  const reparsed = parseSDF(xml, { sourcePath: 'roundtrip_pkg/model.sdf' });

  assert.match(xml, /<model name="roundtrip_demo">/);
  assert.match(xml, /model:\/\/roundtrip_pkg\/meshes\/sign\.dae/);
  assert.ok(reparsed);
  assert.equal(reparsed?.name, 'roundtrip_demo');
  assert.equal(reparsed?.links.base_link.visual.type, GeometryType.BOX);
  assert.equal(reparsed?.links.base_link.visualBodies?.[0]?.type, GeometryType.MESH);
  assert.equal(
    reparsed?.links.base_link.visualBodies?.[0]?.meshPath,
    'model://roundtrip_pkg/meshes/sign.dae',
  );
  assert.equal(reparsed?.links.base_link.collisionBodies?.[0]?.type, GeometryType.SPHERE);
  assert.deepEqual(reparsed?.joints.tip_joint.origin.xyz, { x: 0.1, y: 0.2, z: 0.3 });
  assert.ok(Math.abs((reparsed?.joints.tip_joint.origin.rpy.r ?? 0) - 0.1) < 1e-6);
  assert.ok(Math.abs((reparsed?.joints.tip_joint.origin.rpy.p ?? 0) + 0.2) < 1e-6);
  assert.ok(Math.abs((reparsed?.joints.tip_joint.origin.rpy.y ?? 0) - 0.3) < 1e-6);
});

test('generateSDF omits absent joint bounds without synthesizing infinities', () => {
  const robot: RobotState = {
    name: 'unbounded_joint_export',
    rootLinkId: 'base',
    links: {
      base: { ...DEFAULT_LINK, id: 'base', name: 'base' },
      wheel: { ...DEFAULT_LINK, id: 'wheel', name: 'wheel' },
    },
    joints: {
      spin: {
        ...DEFAULT_JOINT,
        id: 'spin',
        name: 'spin',
        type: JointType.CONTINUOUS,
        parentLinkId: 'base',
        childLinkId: 'wheel',
        limit: { effort: 12, velocity: 8 },
      },
    },
    selection: { type: null, id: null },
  };

  const xml = generateSDF(robot);
  assert.match(xml, /<effort>12<\/effort>/);
  assert.match(xml, /<velocity>8<\/velocity>/);
  assert.doesNotMatch(xml, /<(?:lower|upper)>/);
  assert.doesNotMatch(xml, /Infinity|NaN/);
});

test('generateSDF preserves SDF-native plane and heightmap collision geometry', () => {
  const robot: RobotState = {
    name: 'terrain_collision_demo',
    rootLinkId: 'terrain_link',
    links: {
      terrain_link: {
        ...DEFAULT_LINK,
        id: 'terrain_link',
        name: 'terrain_link',
        collision: {
          ...DEFAULT_LINK.collision,
          name: 'ground_plane',
          type: GeometryType.PLANE,
          dimensions: { x: 6, y: 4, z: 0 },
        },
        collisionBodies: [
          {
            ...DEFAULT_LINK.collision,
            name: 'terrain_heightmap',
            type: GeometryType.HFIELD,
            dimensions: { x: 10, y: 8, z: 2 },
            meshPath: 'heightmaps/terrain.png',
            sdfHeightmap: {
              uri: 'heightmaps/terrain.png',
              size: { x: 10, y: 8, z: 2 },
              pos: { x: 0, y: 0, z: -0.2 },
              textures: [
                {
                  diffuse: 'textures/terrain_diffuse.png',
                  normal: 'textures/terrain_normal.png',
                  size: 5,
                },
              ],
              blends: [{ minHeight: 0.1, fadeDist: 0.2 }],
            },
          },
        ],
      },
    },
    joints: {},
    selection: { type: null, id: null },
  };

  const xml = generateSDF(robot, { packageName: 'terrain_pkg' });
  const reparsed = parseSDF(xml, { sourcePath: 'terrain_pkg/model.sdf' });

  assert.match(xml, /<plane>/);
  assert.match(xml, /<heightmap>/);
  assert.doesNotMatch(xml, /<empty\/>/);
  assert.equal(reparsed?.links.terrain_link.collision.type, GeometryType.PLANE);
  assert.equal(reparsed?.links.terrain_link.collisionBodies?.[0]?.type, GeometryType.HFIELD);
  assert.equal(
    reparsed?.links.terrain_link.collisionBodies?.[0]?.meshPath,
    'heightmaps/terrain.png',
  );
});

test('generateSDF renames a payload-bearing world link because sdformat reserves world', () => {
  const robot: RobotState = {
    name: 'world_root_scene',
    rootLinkId: 'world',
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
    selection: { type: null, id: null },
  };

  const xml = generateSDF(robot, { packageName: 'world_root_scene' });
  const reparsed = parseSDF(xml, { sourcePath: 'world_root_scene/model.sdf' });

  assert.doesNotMatch(xml, /<link name="world">/);
  assert.match(xml, /<link name="world_link">/);
  assert.match(xml, /<parent>world_link<\/parent>/);
  assert.ok(reparsed?.links.world_link);
  assert.equal(reparsed?.joints.world_to_base.parentLinkId, 'world_link');
});

test('generateSDF downgrades unsupported ellipsoid collisions to boxes instead of empty geometry', () => {
  const robot: RobotState = {
    name: 'ellipsoid_collision_demo',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.ELLIPSOID,
          dimensions: { x: 0.5, y: 0.3, z: 0.2 },
        },
      },
    },
    joints: {},
    selection: { type: null, id: null },
  };

  const xml = generateSDF(robot, { packageName: 'ellipsoid_pkg' });
  const reparsed = parseSDF(xml, { sourcePath: 'ellipsoid_pkg/model.sdf' });

  assert.match(xml, /<box>/);
  assert.match(xml, /<size>0\.5 0\.3 0\.2<\/size>/);
  assert.doesNotMatch(xml, /<empty\/>/);
  assert.equal(reparsed?.links.base_link.collision.type, GeometryType.BOX);
});

test('generateSDF preserves mimic joints across roundtrip export', () => {
  const robot: RobotState = {
    name: 'mimic_roundtrip_demo',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
      left_finger: {
        ...DEFAULT_LINK,
        id: 'left_finger',
        name: 'left_finger',
      },
      right_finger: {
        ...DEFAULT_LINK,
        id: 'right_finger',
        name: 'right_finger',
      },
    },
    joints: {
      joint_driver: {
        ...DEFAULT_JOINT,
        id: 'joint_driver',
        name: 'finger_master',
        type: JointType.PRISMATIC,
        parentLinkId: 'base_link',
        childLinkId: 'left_finger',
        axis: { x: 0, y: 0, z: 1 },
        limit: {
          lower: 0,
          upper: 0.04,
          effort: 5,
          velocity: 1,
        },
      },
      joint_follower: {
        ...DEFAULT_JOINT,
        id: 'joint_follower',
        name: 'finger_slave',
        type: JointType.PRISMATIC,
        parentLinkId: 'base_link',
        childLinkId: 'right_finger',
        axis: { x: 0, y: 0, z: -1 },
        limit: {
          lower: -0.04,
          upper: 0,
          effort: 5,
          velocity: 1,
        },
        mimic: {
          joint: 'joint_driver',
          multiplier: -1.5,
          offset: 0.2,
        },
      },
    },
    selection: { type: null, id: null },
  };

  const xml = generateSDF(robot, { packageName: 'mimic_roundtrip_pkg' });
  const reparsed = parseSDF(xml, { sourcePath: 'mimic_roundtrip_pkg/model.sdf' });

  assert.match(
    xml,
    /<mimic joint="finger_master">\s*<multiplier>-1\.5<\/multiplier>\s*<offset>0\.2<\/offset>\s*<reference>0<\/reference>\s*<\/mimic>/,
  );
  assert.deepEqual(reparsed?.joints.finger_slave?.mimic, {
    joint: 'finger_master',
    multiplier: -1.5,
    offset: 0.2,
  });
});

test('generateSdfModelConfig points Gazebo-style packages at model.sdf', () => {
  const config = generateSdfModelConfig('roundtrip_demo');

  assert.match(config, /<name>roundtrip_demo<\/name>/);
  assert.match(config, /<sdf version="1\.7">model\.sdf<\/sdf>/);
});

test('generateSDF emits a single albedo_map for textured visuals', () => {
  const robot: RobotState = {
    name: 'textured_box',
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
          dimensions: { x: 0.5, y: 0.4, z: 0.3 },
          authoredMaterials: [{ texture: 'textures/front.png' }],
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.NONE,
        },
      },
    },
    joints: {},
  };

  const xml = generateSDF(robot, { packageName: 'textured_box_pkg' });

  assert.match(xml, /<albedo_map>model:\/\/textured_box_pkg\/textures\/front\.png<\/albedo_map>/);
});

test('generateSDF emits visual material colors from authored colorRgba values', () => {
  const robot: RobotState = {
    name: 'rgba_material_box',
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
          dimensions: { x: 0.5, y: 0.4, z: 0.3 },
          authoredMaterials: [{ color: '#19334c', colorRgba: [0.1, 0.2, 0.3, 0.4] }],
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.NONE,
        },
      },
    },
    joints: {},
  };

  const xml = generateSDF(robot, { packageName: 'rgba_material_box_pkg' });

  assert.match(xml, /<ambient>0\.10000000 0\.20000000 0\.30000000 0\.40000000<\/ambient>/);
  assert.match(xml, /<diffuse>0\.10000000 0\.20000000 0\.30000000 0\.40000000<\/diffuse>/);
});

test('generateSDF writes rest-pose link transforms instead of current joint angles', () => {
  const robot: RobotState = {
    name: 'sdf_rest_pose_demo',
    rootLinkId: 'base',
    selection: { type: null, id: null },
    links: {
      base: {
        ...DEFAULT_LINK,
        id: 'base',
        name: 'base',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
        },
      },
      tip: {
        ...DEFAULT_LINK,
        id: 'tip',
        name: 'tip',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
          dimensions: { x: 0.1, y: 0.1, z: 0.1 },
          color: '#336699',
        },
      },
    },
    joints: {
      shoulder: {
        ...DEFAULT_JOINT,
        id: 'shoulder',
        name: 'shoulder',
        type: JointType.REVOLUTE,
        parentLinkId: 'base',
        childLinkId: 'tip',
        origin: {
          xyz: { x: 0, y: 0, z: 1 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        axis: { x: 0, y: 0, z: 1 },
        angle: Math.PI / 2,
      },
    },
  };

  const xml = generateSDF(robot, { packageName: 'sdf_rest_pose_demo' });
  assert.match(xml, /<link name="tip">[\s\S]*<pose>0 0 1 0 0 0<\/pose>/);
  assert.doesNotMatch(xml, /<link name="tip">[\s\S]*<pose>0 0 1 0 0 1\.5707963<\/pose>/);

  const reparsed = parseSDF(xml, { sourcePath: 'sdf_rest_pose_demo/model.sdf' });
  assert.equal(reparsed?.joints.shoulder.origin.rpy.y, 0);
});

for (const fixture of CLOSED_LOOP_ROUNDTRIP_FIXTURES) {
  test(`generateSDF handles closed-loop fixture ${fixture.name} according to SDF joint support`, () => {
    const xml = fs.readFileSync(fixture.path, 'utf8');
    const robot = parseMJCF(xml);

    assert.ok(robot, `expected ${fixture.name} MJCF fixture to parse`);
    assert.equal(
      robot?.closedLoopConstraints?.length,
      fixture.expectedClosedLoopCount,
      `expected ${fixture.name} MJCF fixture to expose closed loops before SDF export`,
    );

    if (!robot) {
      return;
    }

    if (fixture.expectUnsupportedFloatingRoot) {
      assert.throws(
        () => generateSDF(robot, { packageName: fixture.name }),
        /\[SDF export\] Joint ".*" uses unsupported floating type\./,
      );
      return;
    }

    const sdf = generateSDF(robot, { packageName: fixture.name });
    const reparsed = parseSDF(sdf, { sourcePath: `${fixture.name}/model.sdf` });

    assert.ok(reparsed, `expected ${fixture.name} SDF roundtrip to parse`);
    assert.equal(
      reparsed?.closedLoopConstraints?.length,
      fixture.expectedClosedLoopCount,
      `expected ${fixture.name} SDF roundtrip to preserve closed-loop count`,
    );
    assertClosedLoopConstraintsMatch(
      reparsed?.closedLoopConstraints,
      robot.closedLoopConstraints,
      fixture.name,
    );
  });
}

test('generateSDF fails fast for unsupported floating joints instead of silently exporting them', () => {
  const robot: RobotState = {
    name: 'floating_root_demo',
    rootLinkId: 'base_link',
    links: {
      world: {
        ...DEFAULT_LINK,
        id: 'world',
        name: 'world',
      },
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
    },
    joints: {
      floating_base_joint: {
        ...DEFAULT_JOINT,
        id: 'floating_base_joint',
        name: 'floating_base_joint',
        type: JointType.FLOATING,
        parentLinkId: 'world',
        childLinkId: 'base_link',
        origin: {
          xyz: { x: 0, y: 0, z: 0.5 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        axis: undefined,
        limit: undefined,
      },
    },
    selection: { type: null, id: null },
  };

  assert.throws(
    () => generateSDF(robot, { packageName: 'floating_root_demo' }),
    /\[SDF export\] Joint "floating_base_joint" uses unsupported floating type\./,
  );
});

test('generateSDF omits a synthetic empty world root when the root joint is floating', () => {
  const robot: RobotState = {
    name: 'floating_root_promoted',
    rootLinkId: 'world',
    links: {
      world: {
        ...DEFAULT_LINK,
        id: 'world',
        name: 'world',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
        },
        inertial: {
          mass: 0,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
        },
      },
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
          dimensions: { x: 0.4, y: 0.2, z: 0.1 },
          color: '#336699',
        },
      },
    },
    joints: {
      floating_base_joint: {
        ...DEFAULT_JOINT,
        id: 'floating_base_joint',
        name: 'floating_base_joint',
        type: JointType.FLOATING,
        parentLinkId: 'world',
        childLinkId: 'base_link',
        origin: {
          xyz: { x: 0, y: 0, z: 0.5 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        axis: undefined,
        limit: undefined,
      },
    },
    selection: { type: null, id: null },
  };

  const sdf = generateSDF(robot, { packageName: 'floating_root_promoted' });
  assert.doesNotMatch(sdf, /<link name="world">/);
  assert.doesNotMatch(sdf, /floating_base_joint/);
  assert.match(sdf, /<link name="base_link">[\s\S]*<pose>0 0 0\.5 0 0 0<\/pose>/);
});

test('generateSDF omits a synthetic empty world root when the root joint is fixed', () => {
  const robot: RobotState = {
    name: 'fixed_root_promoted',
    rootLinkId: 'world',
    links: {
      world: {
        ...DEFAULT_LINK,
        id: 'world',
        name: 'world',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
        },
        inertial: {
          mass: 0,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
        },
      },
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
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
        childLinkId: 'base_link',
        origin: {
          xyz: { x: 0.1, y: -0.2, z: 0.3 },
          rpy: { r: 0, p: 0, y: 0 },
        },
      },
    },
    selection: { type: null, id: null },
  };

  const sdf = generateSDF(robot, { packageName: 'fixed_root_promoted' });
  assert.doesNotMatch(sdf, /<link name="world">/);
  assert.doesNotMatch(sdf, /world_to_base/);
  assert.match(sdf, /<link name="base_link">[\s\S]*<pose>0\.1 -0\.2 0\.3 0 0 0<\/pose>/);
});

test('generateSDF renames joints that collide with link names', () => {
  const robot: RobotState = {
    name: 'name_collision_demo',
    rootLinkId: 'root_link',
    links: {
      root_link: {
        ...DEFAULT_LINK,
        id: 'root_link',
        name: 'root_link',
      },
      elbow: {
        ...DEFAULT_LINK,
        id: 'elbow',
        name: 'elbow',
      },
    },
    joints: {
      elbow_joint: {
        ...DEFAULT_JOINT,
        id: 'elbow_joint',
        name: 'elbow',
        type: JointType.REVOLUTE,
        parentLinkId: 'root_link',
        childLinkId: 'elbow',
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: -1, upper: 1, effort: 1, velocity: 1 },
      },
    },
    selection: { type: null, id: null },
  };

  const sdf = generateSDF(robot, { packageName: 'name_collision_demo' });
  assert.match(sdf, /<link name="elbow">/);
  assert.match(sdf, /<joint name="elbow_joint" type="revolute">/);
  assert.doesNotMatch(sdf, /<joint name="elbow" type="revolute">/);
});
