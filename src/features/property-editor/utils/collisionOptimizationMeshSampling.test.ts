import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_LINK, GeometryType, type RobotData } from '@/types';
import { prepareCollisionOptimizationBaseAnalysisWithAnalyzer } from './collisionOptimization.ts';
import type { MeshAnalysis, MeshAnalysisOptions } from './geometryConversion.ts';

function createMeshRobot(): RobotData {
  const link = structuredClone(DEFAULT_LINK);
  link.id = 'mesh-link';
  link.name = 'mesh-link';
  link.collision = {
    ...link.collision,
    type: GeometryType.MESH,
    meshPath: 'meshes/part.stl',
    dimensions: { x: 1, y: 1, z: 1 },
  };

  return {
    name: 'mesh-sampling-test',
    rootLinkId: link.id,
    links: { [link.id]: link },
    joints: {},
  };
}

const MESH_ANALYSIS: MeshAnalysis = {
  bounds: { x: 1, y: 1, z: 2, cx: 0, cy: 0, cz: 0 },
};

test('primitive fitting retains a representative mesh point budget without clearance sampling', async () => {
  let receivedOptions: MeshAnalysisOptions | undefined;

  await prepareCollisionOptimizationBaseAnalysisWithAnalyzer(
    { kind: 'robot', robot: createMeshRobot() },
    {},
    {
      includePrimitiveFits: true,
      includeMeshClearanceObstacles: false,
    },
    async ({ options, tasks }) => {
      receivedOptions = options;
      return Object.fromEntries(tasks.map((task) => [task.targetId, MESH_ANALYSIS]));
    },
  );

  assert.equal(receivedOptions?.includePrimitiveFits, true);
  assert.equal(receivedOptions?.includeSurfacePoints, false);
  assert.equal(receivedOptions?.pointCollectionLimit, 1024);
  assert.equal(receivedOptions?.surfacePointLimit, 1);
});
