import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_LINK, GeometryType, type RenderableBounds, type RobotData } from '@/types';

import { buildDefaultAssemblyComponentPlacementTransform } from './assemblyPlacement.ts';

function robot(name: string): RobotData {
  return {
    name,
    rootLinkId: 'base',
    links: {
      base: {
        ...structuredClone(DEFAULT_LINK),
        id: 'base',
        name: 'base',
      },
    },
    joints: {},
  };
}

function bounds(minZ: number, minX = -0.5, maxX = 0.5): RenderableBounds {
  return {
    min: { x: minX, y: -0.5, z: minZ },
    max: { x: maxX, y: 0.5, z: minZ + 1 },
  };
}

test('default placement aligns heterogeneous authored origins to one scene floor', () => {
  const lowOriginRobot = robot('low-origin');
  const highOriginRobot = robot('high-origin');

  const transform = buildDefaultAssemblyComponentPlacementTransform({
    robot: highOriginRobot,
    renderableBounds: bounds(-1.2, -0.25, 0.25),
    existingComponents: [
      {
        robot: lowOriginRobot,
        renderableBounds: bounds(-0.4),
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { r: 0, p: 0, y: 0 },
        },
      },
    ],
  });

  assert.ok(Math.abs(transform.position.z - 0.8) < 1e-12);
  assert.ok(Math.abs(transform.position.x - 0.87) < 1e-12);
});

test('default placement preserves the current lowest transformed component as reference', () => {
  const sourceRobot = robot('source');
  const nextRobot = robot('next');

  const transform = buildDefaultAssemblyComponentPlacementTransform({
    robot: nextRobot,
    renderableBounds: bounds(0.5),
    existingComponents: [
      {
        robot: sourceRobot,
        renderableBounds: bounds(-0.4),
        transform: {
          position: { x: 0, y: 0, z: 0.3 },
          rotation: { r: 0, p: 0, y: 0 },
        },
      },
      {
        robot: sourceRobot,
        renderableBounds: bounds(-0.4),
        transform: {
          position: { x: 2, y: 0, z: 1.3 },
          rotation: { r: 0, p: 0, y: 0 },
        },
      },
    ],
  });

  assert.ok(Math.abs(transform.position.z + 0.6) < 1e-12);
});

test('repeated instances with the same bounds keep the same raw floor height', () => {
  const repeatedRobot = robot('repeated');
  const repeatedBounds = bounds(-0.75);

  const transform = buildDefaultAssemblyComponentPlacementTransform({
    robot: repeatedRobot,
    renderableBounds: repeatedBounds,
    existingComponents: [
      {
        robot: repeatedRobot,
        renderableBounds: repeatedBounds,
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { r: 0, p: 0, y: 0 },
        },
      },
    ],
  });

  assert.equal(transform.position.z, 0);
});

test('a horizontal MJCF world surface places a new model on its top near the room', () => {
  const scene = robot('room');
  scene.inspectionContext = { sourceFormat: 'mjcf' };
  const world = scene.links.base!;
  world.name = 'world';
  assert.ok(world.inertial);
  world.inertial.mass = 0;
  world.visual.type = GeometryType.BOX;
  world.visual.dimensions = { x: 1000, y: 1000, z: 0.1 };
  world.visual.origin = { xyz: { x: 0, y: 0, z: -0.05 }, rpy: { r: 0, p: 0, y: 0 } };
  const inputs = {
    robot: robot('quadruped'), renderableBounds: bounds(-0.7),
    existingComponents: [{
      robot: scene,
      transform: { position: { x: 3, y: -2, z: 1 }, rotation: { r: 0, p: 0, y: 0.5 } },
    }],
  };
  assert.deepEqual(buildDefaultAssemblyComponentPlacementTransform(inputs).position, { x: 3, y: -2, z: 1.7 });
  const visual = world.visual;
  world.collision = structuredClone(visual);
  world.visual = {...visual, type: GeometryType.NONE};
  assert.deepEqual(buildDefaultAssemblyComponentPlacementTransform(inputs).position, { x: 3, y: -2, z: 1.7 });
  world.visual = visual;
  world.collision.type = GeometryType.NONE;
  // A second environment must not be stacked on the existing floor.
  const secondScene = buildDefaultAssemblyComponentPlacementTransform({
    robot: scene, existingComponents: inputs.existingComponents,
  });
  assert.ok(secondScene.position.x > 1000);
  world.visual.origin.rpy.r = Math.PI / 4;
  assert.ok(buildDefaultAssemblyComponentPlacementTransform(inputs).position.x > 100);
  world.visual.origin.rpy.r = 0;
  scene.inspectionContext.sourceFormat = 'urdf';
  assert.ok(buildDefaultAssemblyComponentPlacementTransform(inputs).position.x > 100);
});
