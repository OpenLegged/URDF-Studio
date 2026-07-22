import assert from 'node:assert/strict';
import test from 'node:test';

import { GeometryType, type RobotData, type UrdfVisual } from '@/types';

import {
  applyCollisionOptimizationOperationsToLinks,
  buildCollisionOptimizationAnalysis,
  buildCollisionOptimizationOperations,
  collectCollisionTargets,
  type CollisionOptimizationBaseAnalysis,
  type CollisionOptimizationSettings,
} from './collisionOptimization.ts';

const BOX_DIMENSIONS = {
  elongated: { x: 0.2, y: 0.2, z: 2 },
  nearSquare: { x: 1, y: 0.9, z: 1 },
  flat: { x: 2, y: 2, z: 0.1 },
} as const;

function createBox(dimensions: UrdfVisual['dimensions']): UrdfVisual {
  return {
    type: GeometryType.BOX,
    dimensions,
    color: '#ef4444',
    origin: {
      xyz: { x: 0.1, y: 0.2, z: 0.3 },
      rpy: { r: 0.4, p: 0.5, y: 0.6 },
    },
  };
}

function createBoxRobot(): RobotData {
  return {
    name: 'box-collision-candidates',
    rootLinkId: 'elongated',
    links: Object.fromEntries(
      Object.entries(BOX_DIMENSIONS).map(([id, dimensions]) => [
        id,
        {
          id,
          name: id,
          visual: createBox(dimensions),
          collision: createBox(dimensions),
        },
      ]),
    ),
    joints: {},
  };
}

function createSettings(
  rodBoxStrategy: CollisionOptimizationSettings['rodBoxStrategy'],
): CollisionOptimizationSettings {
  return {
    scope: 'all',
    meshStrategy: 'keep',
    cylinderStrategy: 'keep',
    rodBoxStrategy,
    coaxialJointMergeStrategy: 'keep',
    avoidSiblingOverlap: false,
  };
}

function createBaseAnalysis(): CollisionOptimizationBaseAnalysis {
  const robot = createBoxRobot();
  const source = { kind: 'robot' as const, robot };
  return {
    source,
    targets: collectCollisionTargets(source),
    meshAnalysisByTargetId: {},
    clearanceWorld: null,
  };
}

test('all box proportions are eligible capsule candidates by default', () => {
  const analysis = buildCollisionOptimizationAnalysis(
    createBaseAnalysis(),
    createSettings('capsule'),
  );

  assert.equal(analysis.candidates.length, 3);
  analysis.candidates.forEach((candidate) => {
    assert.equal(candidate.currentType, GeometryType.BOX, candidate.target.linkId);
    assert.equal(candidate.eligible, true, candidate.target.linkId);
    assert.equal(candidate.status, 'ready', candidate.target.linkId);
    assert.equal(candidate.suggestedType, GeometryType.CAPSULE, candidate.target.linkId);
    assert.equal(candidate.nextGeometry?.type, GeometryType.CAPSULE, candidate.target.linkId);
    assert.equal(candidate.reason, 'rod-box-to-capsule', candidate.target.linkId);
    assert.deepEqual(candidate.nextGeometry?.origin.xyz, candidate.target.geometry.origin.xyz);
  });
});

test('keep strategy disables box conversion for every proportion', () => {
  const analysis = buildCollisionOptimizationAnalysis(createBaseAnalysis(), createSettings('keep'));

  assert.equal(analysis.candidates.length, 3);
  analysis.candidates.forEach((candidate) => {
    assert.equal(candidate.currentType, GeometryType.BOX, candidate.target.linkId);
    assert.equal(candidate.eligible, false, candidate.target.linkId);
    assert.equal(candidate.suggestedType, null, candidate.target.linkId);
    assert.equal(candidate.nextGeometry, undefined, candidate.target.linkId);
  });
});

test('mesh capsule optimization writes multiple segments without drifting same-link indices', () => {
  const meshGeometry = (name: string): UrdfVisual => ({
    name,
    type: GeometryType.MESH,
    dimensions: { x: 1, y: 1, z: 1 },
    color: '#22c55e',
    meshPath: `meshes/${name}.stl`,
    origin: {
      xyz: { x: 0, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: 0 },
    },
  });
  const primary = meshGeometry('primary');
  const body = meshGeometry('body');
  const robot: RobotData = {
    name: 'segmented-capsules',
    rootLinkId: 'base',
    links: {
      base: {
        id: 'base',
        name: 'base',
        visual: createBox({ x: 1, y: 1, z: 1 }),
        collision: primary,
        collisionBodies: [body],
      },
    },
    joints: {},
  };
  const source = { kind: 'robot' as const, robot };
  const targets = collectCollisionTargets(source);
  const segment = (centerZ: number) => ({
    axis: { x: 0, y: 0, z: 1 },
    center: { x: 0, y: 0, z: centerZ },
    radius: 0.1,
    length: 0.4,
    volume: 0.01,
  });
  const meshAnalysisByTargetId = Object.fromEntries(
    targets.map((target) => [
      target.id,
      {
        bounds: { x: 0.2, y: 0.2, z: 0.8, cx: 0, cy: 0, cz: 0 },
        approximateCapsules: {
          normalizedError: 0.04,
          segments: [segment(-0.2), segment(0.2)],
        },
      },
    ]),
  );
  const settings: CollisionOptimizationSettings = {
    scope: 'all',
    meshStrategy: 'capsule',
    cylinderStrategy: 'keep',
    rodBoxStrategy: 'keep',
    coaxialJointMergeStrategy: 'keep',
    avoidSiblingOverlap: false,
  };
  const analysis = buildCollisionOptimizationAnalysis(
    {
      source,
      targets,
      meshAnalysisByTargetId,
      clearanceWorld: null,
    },
    settings,
  );
  const operations = buildCollisionOptimizationOperations(
    analysis.candidates,
    new Set(targets.map((target) => target.id)),
  );
  const links = applyCollisionOptimizationOperationsToLinks(robot.links, operations);

  assert.equal(operations.length, 2);
  assert.equal(links.base.collision.type, GeometryType.CAPSULE);
  assert.deepEqual(
    [links.base.collision, ...(links.base.collisionBodies ?? [])].map((geometry) => geometry.name),
    ['primary', undefined, 'body', undefined],
  );
  assert.equal(links.base.collisionBodies?.length, 3);
});
