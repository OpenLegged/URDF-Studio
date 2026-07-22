import type { MeshAnalysisOptions } from '../geometryConversion';

const DEFAULT_POINT_COLLECTION_LIMIT = 1024;
const DEFAULT_SURFACE_POINT_LIMIT = 512;

interface CollisionOptimizationMeshAnalysisOptionsInput {
  includeMeshClearanceObstacles: boolean;
  includePrimitiveFits: boolean;
  pointCollectionLimit?: number;
  surfacePointLimit?: number;
}

export function buildCollisionOptimizationMeshAnalysisOptions({
  includeMeshClearanceObstacles,
  includePrimitiveFits,
  pointCollectionLimit,
  surfacePointLimit,
}: CollisionOptimizationMeshAnalysisOptionsInput): MeshAnalysisOptions {
  const resolvedPointCollectionLimit = Math.max(
    pointCollectionLimit ?? DEFAULT_POINT_COLLECTION_LIMIT,
    1,
  );
  const resolvedSurfacePointLimit = Math.max(surfacePointLimit ?? DEFAULT_SURFACE_POINT_LIMIT, 1);

  return {
    includePrimitiveFits,
    includeSurfacePoints: includeMeshClearanceObstacles,
    // Primitive fitting consumes the collected mesh vertices independently of
    // whether clearance surface points are requested. One vertex degenerates
    // every fitted primitive to the numerical epsilon.
    pointCollectionLimit:
      includePrimitiveFits || includeMeshClearanceObstacles ? resolvedPointCollectionLimit : 1,
    surfacePointLimit: includeMeshClearanceObstacles ? resolvedSurfacePointLimit : 1,
  };
}
