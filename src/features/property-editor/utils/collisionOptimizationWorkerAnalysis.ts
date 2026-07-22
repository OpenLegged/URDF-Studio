import { GeometryType } from '@/types';
import type { UrdfVisual } from '@/types';
import {
  buildCollisionOptimizationAnalysisAsync,
  type CollisionOptimizationAnalysis,
  type CollisionOptimizationBaseAnalysis,
} from './collisionOptimization';
import { buildCollisionOptimizationClearanceWorld } from './collision-optimization/clearanceContext';
import { buildCollisionOptimizationMeshAnalysisOptions } from './collision-optimization/meshAnalysisOptions';
import {
  collectCollisionTargets,
  filterCollisionTargets,
  type CollisionOptimizationSource,
  type CollisionTargetRef,
} from './collision-optimization/collisionTargets';
import { computeMeshAnalysisFromAssets, type MeshAnalysis } from './geometryConversion';
import type {
  CollisionOptimizationInlineAnalyzeArgs,
  CollisionOptimizationWorkerProgress,
  CollisionOptimizationWorkerStage,
  CollisionOptimizationWorkerProgressStatus,
} from './collisionOptimizationWorkerTypes';

function createAbortError(): DOMException {
  return new DOMException('Collision optimization analysis aborted', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function createMeshAnalysisCacheKey(
  geometry: Pick<UrdfVisual, 'meshPath' | 'dimensions'>,
  sourceFilePath?: string,
): string {
  return [
    geometry.meshPath ?? '',
    geometry.dimensions?.x ?? 1,
    geometry.dimensions?.y ?? 1,
    geometry.dimensions?.z ?? 1,
    sourceFilePath ?? '',
  ].join('::');
}

function resolveCollisionTargetSourceFilePath(
  source: CollisionOptimizationSource,
  target: Pick<CollisionTargetRef, 'componentId'>,
  fallbackSourceFilePath?: string,
): string | undefined {
  if (source.kind === 'assembly' && target.componentId) {
    return source.assembly.components[target.componentId]?.sourceFile ?? fallbackSourceFilePath;
  }

  return fallbackSourceFilePath;
}

function emitProgress(
  args: CollisionOptimizationInlineAnalyzeArgs,
  stage: CollisionOptimizationWorkerStage,
  status: CollisionOptimizationWorkerProgressStatus,
  counts: Pick<CollisionOptimizationWorkerProgress, 'completed' | 'total'> = {},
): void {
  args.onProgress?.({
    requestId: args.requestId,
    stage,
    status,
    ...counts,
  });
}

function shouldIncludePrimitiveFits(args: CollisionOptimizationInlineAnalyzeArgs): boolean {
  return (
    args.options?.includePrimitiveFits ??
    (args.settings.meshStrategy !== 'keep' ||
      args.settings.coaxialJointMergeStrategy !== 'keep' ||
      Boolean(args.settings.manualMergePairs?.length))
  );
}

function buildMeshAnalysisOptions(args: CollisionOptimizationInlineAnalyzeArgs) {
  const includeClearanceData =
    args.options?.includeClearanceData ?? args.settings.avoidSiblingOverlap;
  const includeMeshClearanceObstacles =
    args.options?.includeMeshClearanceObstacles ?? includeClearanceData;

  return buildCollisionOptimizationMeshAnalysisOptions({
    includeMeshClearanceObstacles,
    includePrimitiveFits: shouldIncludePrimitiveFits(args),
    pointCollectionLimit: args.options?.pointCollectionLimit,
    surfacePointLimit: args.options?.surfacePointLimit,
  });
}

export async function prepareCollisionOptimizationBaseAnalysisInline(
  args: CollisionOptimizationInlineAnalyzeArgs,
): Promise<CollisionOptimizationBaseAnalysis> {
  throwIfAborted(args.signal);
  emitProgress(args, 'prepare-base', 'started');

  const targets = collectCollisionTargets(args.source);
  const meshTargets = targets.filter(
    (target) => target.geometry.type === GeometryType.MESH && Boolean(target.geometry.meshPath),
  );
  const meshAnalysisByTargetId: Record<string, MeshAnalysis | null> = {};
  const meshAnalysisCache = new Map<string, MeshAnalysis | null>();
  const meshOptions = buildMeshAnalysisOptions(args);

  emitProgress(args, 'prepare-base', 'completed', {
    completed: targets.length,
    total: targets.length,
  });
  emitProgress(args, 'mesh-analysis', 'started', {
    completed: 0,
    total: meshTargets.length,
  });

  for (let index = 0; index < meshTargets.length; index += 1) {
    throwIfAborted(args.signal);

    const target = meshTargets[index]!;
    const targetSourceFilePath = resolveCollisionTargetSourceFilePath(
      args.source,
      target,
      args.options?.sourceFilePath,
    );
    const cacheKey = createMeshAnalysisCacheKey(target.geometry, targetSourceFilePath);
    let analysis: MeshAnalysis | null;

    if (meshAnalysisCache.has(cacheKey)) {
      analysis = meshAnalysisCache.get(cacheKey) ?? null;
    } else {
      analysis = await computeMeshAnalysisFromAssets(
        target.geometry.meshPath!,
        args.assets,
        target.geometry.dimensions,
        meshOptions,
        targetSourceFilePath,
      );
      meshAnalysisCache.set(cacheKey, analysis ?? null);
    }

    meshAnalysisByTargetId[target.id] = analysis ?? null;
    emitProgress(args, 'mesh-analysis', 'progress', {
      completed: index + 1,
      total: meshTargets.length,
    });
  }

  emitProgress(args, 'mesh-analysis', 'completed', {
    completed: meshTargets.length,
    total: meshTargets.length,
  });

  throwIfAborted(args.signal);
  const includeClearanceData =
    args.options?.includeClearanceData ?? args.settings.avoidSiblingOverlap;
  emitProgress(args, 'clearance', 'started', {
    completed: 0,
    total: includeClearanceData ? 1 : 0,
  });
  const clearanceWorld = includeClearanceData
    ? buildCollisionOptimizationClearanceWorld(args.source, targets, meshAnalysisByTargetId)
    : null;
  emitProgress(args, 'clearance', 'completed', {
    completed: includeClearanceData ? 1 : 0,
    total: includeClearanceData ? 1 : 0,
  });

  return {
    source: args.source,
    targets,
    meshAnalysisByTargetId,
    clearanceWorld,
  };
}

export async function analyzeCollisionOptimizationInline(
  args: CollisionOptimizationInlineAnalyzeArgs,
): Promise<CollisionOptimizationAnalysis> {
  const baseAnalysis = await prepareCollisionOptimizationBaseAnalysisInline(args);
  const filteredTargetCount = filterCollisionTargets(baseAnalysis.targets, args.settings).length;

  throwIfAborted(args.signal);
  emitProgress(args, 'candidates', 'started', {
    completed: 0,
    total: filteredTargetCount,
  });
  const analysis = await buildCollisionOptimizationAnalysisAsync(baseAnalysis, args.settings, {
    ...args.options,
    signal: args.signal,
  });
  emitProgress(args, 'candidates', 'completed', {
    completed: analysis.candidates.length,
    total: analysis.candidates.length,
  });

  throwIfAborted(args.signal);
  emitProgress(args, 'finalizing', 'started', {
    completed: 0,
    total: 1,
  });
  emitProgress(args, 'finalizing', 'completed', {
    completed: 1,
    total: 1,
  });

  return analysis;
}
