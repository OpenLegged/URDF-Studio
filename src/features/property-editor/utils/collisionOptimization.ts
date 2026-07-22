import {
  removeCollisionGeometryByObjectIndex,
  replaceCollisionGeometriesByObjectIndex,
  updateCollisionGeometryByObjectIndex,
} from '@/core/robot';
import type { GeometryType as GeometryTypeValue, RobotData, UrdfLink, UrdfVisual } from '@/types';
import { GeometryType } from '@/types';
import {
  convertGeometryType,
  computeMeshAnalysisFromAssets,
  type MeshAnalysis,
  type MeshClearanceObstacle,
} from './geometryConversion';
import { analyzeMeshBatchWithWorker } from './meshAnalysisWorkerBridge';
import {
  buildCollisionOptimizationClearanceWorld,
  buildNearbyCollisionClearanceContext,
  computeBroadPhaseCenter,
  computeBroadPhaseRadius,
  type CollisionClearanceContext,
  type CollisionOptimizationClearanceWorld,
} from './collision-optimization/clearanceContext';
import {
  buildCoaxialMergeCandidates,
  buildManualMergeCandidates,
} from './collision-optimization/coaxialMergeCandidates';
import { buildCollisionOptimizationMeshAnalysisOptions } from './collision-optimization/meshAnalysisOptions';
import { buildApproximateMeshCapsuleGeometries } from './collision-optimization/meshCapsuleGeometries';
import type {
  CollisionOptimizationBaseAnalysis,
  CollisionOptimizationCandidate,
  CollisionOptimizationMutation,
  CollisionOptimizationReason,
  CollisionOptimizationSettings,
  MeshOptimizationStrategy,
} from './collision-optimization/contracts';
import {
  cloneCollisionGeometry as cloneGeometry,
  collectCollisionTargets,
  filterCollisionTargets as filterTargets,
  getCollisionTargetLinkGroupKey as getLinkGroupKey,
  normalizeCollisionGeometry as normalizeGeometry,
  type CollisionOptimizationSource,
  type CollisionTargetRef,
} from './collision-optimization/collisionTargets';

export {
  buildCollisionOptimizationSkeletonProjection,
  type CollisionOptimizationSkeletonProjection,
  type CollisionOptimizationSkeletonProjectionEdge,
  type CollisionOptimizationSkeletonProjectionNode,
  type CollisionOptimizationSkeletonProjectionOptions,
  type CollisionOptimizationSkeletonProjectionPlane,
  type CollisionOptimizationSkeletonProjectionViewMode,
} from './collision-optimization/skeletonProjection';
export { collectCollisionTargets } from './collision-optimization/collisionTargets';
export type {
  CollisionOptimizationScope,
  CollisionOptimizationSource,
  CollisionTargetRef,
} from './collision-optimization/collisionTargets';
export type {
  CoaxialJointMergeStrategy,
  CollisionOptimizationBaseAnalysis,
  CollisionOptimizationCandidate,
  CollisionOptimizationManualMergePair,
  CollisionOptimizationManualMergeStrategy,
  CollisionOptimizationMutation,
  CollisionOptimizationReason,
  CollisionOptimizationSettings,
  CollisionOptimizationStatus,
  CylinderOptimizationStrategy,
  MeshOptimizationStrategy,
  RodBoxOptimizationStrategy,
} from './collision-optimization/contracts';

export function createCollisionOptimizationCandidateKey(
  candidate: Pick<CollisionOptimizationCandidate, 'target' | 'secondaryTarget'>,
): string {
  return candidate.secondaryTarget
    ? `${candidate.target.id}::${candidate.secondaryTarget.id}`
    : `${candidate.target.id}::single`;
}

export function createCollisionOptimizationCandidateKeyFromTargets(
  primaryTargetId: string,
  secondaryTargetId?: string | null,
): string {
  return secondaryTargetId
    ? `${primaryTargetId}::${secondaryTargetId}`
    : `${primaryTargetId}::single`;
}

export interface CollisionOptimizationOperation {
  id: string;
  componentId?: string;
  linkId: string;
  objectIndex: number;
  nextGeometry: UrdfVisual;
  reason: CollisionOptimizationReason;
  fromTypes: GeometryTypeValue[];
  toType: GeometryTypeValue;
  mutations: CollisionOptimizationMutation[];
  affectedTargetIds: string[];
}

export interface CollisionOptimizationAnalysis {
  targets: CollisionTargetRef[];
  filteredTargets: CollisionTargetRef[];
  candidates: CollisionOptimizationCandidate[];
  meshAnalysisByTargetId: Record<string, MeshAnalysis | null>;
}

const DEFAULT_CANDIDATE_ANALYSIS_YIELD_EVERY = 8;

export interface CollisionOptimizationAsyncOptions {
  signal?: AbortSignal;
  yieldEvery?: number;
  includeClearanceData?: boolean;
  includeMeshClearanceObstacles?: boolean;
  includePrimitiveFits?: boolean;
  pointCollectionLimit?: number;
  surfacePointLimit?: number;
  sourceFilePath?: string;
}

type AnalyzeMeshBatch = typeof analyzeMeshBatchWithWorker;

function createAbortError(): DOMException {
  return new DOMException('Collision optimization analysis aborted', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

async function yieldToMainThread(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve());
      return;
    }

    setTimeout(resolve, 0);
  });
}

async function maybeYieldAfterBatch(
  index: number,
  yieldEvery: number,
  signal?: AbortSignal,
): Promise<void> {
  if (yieldEvery > 0 && (index + 1) % yieldEvery === 0) {
    throwIfAborted(signal);
    await yieldToMainThread();
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

function pickSmartMeshStrategy(analysis: MeshAnalysis): MeshOptimizationStrategy {
  const dims = [analysis.bounds.x, analysis.bounds.y, analysis.bounds.z]
    .map((value) => Math.max(value, 1e-6))
    .sort((left, right) => left - right);
  const [smallest, middle, largest] = dims;

  const nearSphere = largest / smallest <= 1.12;
  if (nearSphere) {
    return 'sphere';
  }

  const rodLike =
    largest / Math.max(middle, smallest) >= 1.75 &&
    Math.abs(middle - smallest) / Math.max(middle, smallest) <= 0.28;
  if (rodLike) {
    return analysis.primitiveFits?.capsule ? 'capsule' : 'cylinder';
  }

  return 'box';
}

function toGeometryType(strategy: MeshOptimizationStrategy): GeometryTypeValue {
  switch (strategy) {
    case 'box':
      return GeometryType.BOX;
    case 'sphere':
      return GeometryType.SPHERE;
    case 'cylinder':
      return GeometryType.CYLINDER;
    case 'capsule':
      return GeometryType.CAPSULE;
    case 'keep':
    case 'smart':
    default:
      return GeometryType.BOX;
  }
}

function buildMeshCandidate(
  target: CollisionTargetRef,
  settings: CollisionOptimizationSettings,
  analysis: MeshAnalysis | null | undefined,
  clearanceContext: CollisionClearanceContext,
): CollisionOptimizationCandidate {
  if (settings.meshStrategy === 'keep') {
    return {
      target,
      eligible: false,
      currentType: target.geometry.type,
      suggestedType: null,
      status: 'disabled',
    };
  }

  if (!target.geometry.meshPath) {
    return {
      target,
      eligible: false,
      currentType: target.geometry.type,
      suggestedType: null,
      status: 'missing-mesh-path',
    };
  }

  if (!analysis) {
    return {
      target,
      eligible: false,
      currentType: target.geometry.type,
      suggestedType: null,
      status: 'mesh-analysis-failed',
    };
  }

  const resolvedStrategy =
    settings.meshStrategy === 'smart' ? pickSmartMeshStrategy(analysis) : settings.meshStrategy;
  const suggestedType = toGeometryType(resolvedStrategy);
  if (suggestedType === GeometryType.CAPSULE) {
    const nextGeometries = buildApproximateMeshCapsuleGeometries(
      target.geometry,
      analysis,
      settings.avoidSiblingOverlap ? clearanceContext : undefined,
    );
    const nextGeometry = nextGeometries[0]!;

    return {
      target,
      eligible: true,
      currentType: target.geometry.type,
      suggestedType,
      status: 'ready',
      reason: settings.meshStrategy === 'smart' ? 'mesh-smart-fit' : 'mesh-manual-fit',
      nextGeometry,
      mutations: [
        {
          componentId: target.componentId,
          linkId: target.linkId,
          objectIndex: target.objectIndex,
          type: 'replace-many',
          nextGeometries,
        },
      ],
    };
  }

  const converted = convertGeometryType(
    target.geometry,
    suggestedType,
    analysis,
    settings.avoidSiblingOverlap ? clearanceContext : undefined,
  );

  const nextGeometry: UrdfVisual = {
    ...normalizeGeometry(target.geometry),
    type: converted.type,
    dimensions: { ...converted.dimensions },
    origin: {
      xyz: { ...converted.origin.xyz },
      rpy: { ...converted.origin.rpy },
    },
    meshPath: undefined,
  };

  return {
    target,
    eligible: true,
    currentType: target.geometry.type,
    suggestedType,
    status: 'ready',
    reason: settings.meshStrategy === 'smart' ? 'mesh-smart-fit' : 'mesh-manual-fit',
    nextGeometry,
  };
}

function buildPrimitiveCandidate(
  target: CollisionTargetRef,
  settings: CollisionOptimizationSettings,
  clearanceContext: CollisionClearanceContext,
): CollisionOptimizationCandidate {
  if (target.geometry.type === GeometryType.CYLINDER) {
    if (settings.cylinderStrategy === 'keep') {
      return {
        target,
        eligible: false,
        currentType: target.geometry.type,
        suggestedType: null,
        status: 'disabled',
      };
    }

    const converted = convertGeometryType(
      target.geometry,
      GeometryType.CAPSULE,
      undefined,
      settings.avoidSiblingOverlap ? clearanceContext : undefined,
    );

    return {
      target,
      eligible: true,
      currentType: target.geometry.type,
      suggestedType: GeometryType.CAPSULE,
      status: 'ready',
      reason: 'cylinder-to-capsule',
      nextGeometry: {
        ...normalizeGeometry(target.geometry),
        type: GeometryType.CAPSULE,
        dimensions: { ...converted.dimensions },
        origin: {
          xyz: { ...converted.origin.xyz },
          rpy: { ...converted.origin.rpy },
        },
      },
    };
  }

  if (target.geometry.type === GeometryType.BOX && settings.rodBoxStrategy !== 'keep') {
    const suggestedType =
      settings.rodBoxStrategy === 'capsule' ? GeometryType.CAPSULE : GeometryType.CYLINDER;
    const converted = convertGeometryType(
      target.geometry,
      suggestedType,
      undefined,
      settings.avoidSiblingOverlap ? clearanceContext : undefined,
    );

    return {
      target,
      eligible: true,
      currentType: target.geometry.type,
      suggestedType,
      status: 'ready',
      reason: settings.rodBoxStrategy === 'capsule' ? 'rod-box-to-capsule' : 'rod-box-to-cylinder',
      nextGeometry: {
        ...normalizeGeometry(target.geometry),
        type: suggestedType,
        dimensions: { ...converted.dimensions },
        origin: {
          xyz: { ...converted.origin.xyz },
          rpy: { ...converted.origin.rpy },
        },
      },
    };
  }

  return {
    target,
    eligible: false,
    currentType: target.geometry.type,
    suggestedType: null,
    status: 'no-rule-match',
  };
}

function buildCandidate(
  target: CollisionTargetRef,
  targets: CollisionTargetRef[],
  settings: CollisionOptimizationSettings,
  meshAnalysisByTargetId: Record<string, MeshAnalysis | null>,
  clearanceWorld: CollisionOptimizationClearanceWorld | null,
): CollisionOptimizationCandidate {
  const clearanceContext = buildNearbyCollisionClearanceContext(
    targets,
    target,
    meshAnalysisByTargetId,
    clearanceWorld,
  );

  if (target.geometry.type === GeometryType.MESH) {
    return buildMeshCandidate(
      target,
      settings,
      meshAnalysisByTargetId[target.id],
      clearanceContext,
    );
  }

  return buildPrimitiveCandidate(target, settings, clearanceContext);
}

export function buildCollisionOptimizationAnalysis(
  baseAnalysis: CollisionOptimizationBaseAnalysis,
  settings: CollisionOptimizationSettings,
): CollisionOptimizationAnalysis {
  const filteredTargets = filterTargets(baseAnalysis.targets, settings);
  const candidates = filteredTargets.map((target) =>
    buildCandidate(
      target,
      baseAnalysis.targets,
      settings,
      baseAnalysis.meshAnalysisByTargetId,
      baseAnalysis.clearanceWorld,
    ),
  );
  candidates.push(...buildManualMergeCandidates(baseAnalysis, settings));
  candidates.push(...buildCoaxialMergeCandidates(baseAnalysis, settings));

  return {
    targets: baseAnalysis.targets,
    filteredTargets,
    candidates,
    meshAnalysisByTargetId: baseAnalysis.meshAnalysisByTargetId,
  };
}

export async function prepareCollisionOptimizationBaseAnalysisWithAnalyzer(
  source: CollisionOptimizationSource,
  assets: Record<string, string>,
  options: CollisionOptimizationAsyncOptions = {},
  analyzeMeshBatch: AnalyzeMeshBatch = analyzeMeshBatchWithWorker,
): Promise<CollisionOptimizationBaseAnalysis> {
  const targets = collectCollisionTargets(source);
  const meshTargets = targets.filter(
    (target) => target.geometry.type === GeometryType.MESH && Boolean(target.geometry.meshPath),
  );
  const meshAnalysisByTargetId: Record<string, MeshAnalysis | null> = {};
  const includeClearanceData = options.includeClearanceData ?? false;
  const includeMeshClearanceObstacles =
    options.includeMeshClearanceObstacles ?? includeClearanceData;
  const includePrimitiveFits = options.includePrimitiveFits ?? false;
  const meshAnalysisOptions = buildCollisionOptimizationMeshAnalysisOptions({
    includeMeshClearanceObstacles,
    includePrimitiveFits,
    pointCollectionLimit: options.pointCollectionLimit,
    surfacePointLimit: options.surfacePointLimit,
  });
  const workerResults = await analyzeMeshBatch({
    assets,
    tasks: meshTargets.map((target) => {
      const targetSourceFilePath = resolveCollisionTargetSourceFilePath(
        source,
        target,
        options.sourceFilePath,
      );

      return {
        targetId: target.id,
        cacheKey: createMeshAnalysisCacheKey(target.geometry, targetSourceFilePath),
        meshPath: target.geometry.meshPath!,
        dimensions: target.geometry.dimensions,
        sourceFilePath: targetSourceFilePath,
      };
    }),
    options: meshAnalysisOptions,
    signal: options.signal,
  });

  meshTargets.forEach((target) => {
    throwIfAborted(options.signal);
    meshAnalysisByTargetId[target.id] = workerResults[target.id] ?? null;
  });

  throwIfAborted(options.signal);
  const clearanceWorld = includeClearanceData
    ? buildCollisionOptimizationClearanceWorld(source, targets, meshAnalysisByTargetId)
    : null;

  return {
    source,
    targets,
    meshAnalysisByTargetId,
    clearanceWorld,
  };
}

export async function prepareCollisionOptimizationBaseAnalysis(
  source: CollisionOptimizationSource,
  assets: Record<string, string>,
  options: CollisionOptimizationAsyncOptions = {},
): Promise<CollisionOptimizationBaseAnalysis> {
  return await prepareCollisionOptimizationBaseAnalysisWithAnalyzer(source, assets, options);
}

export const analyzeMeshBatchInline: AnalyzeMeshBatch = async ({ assets, tasks, options }) => {
  const localCache = new Map<string, MeshAnalysis | null>();
  const results: Record<string, MeshAnalysis | null> = {};

  for (const task of tasks) {
    let analysis = localCache.get(task.cacheKey);
    if (!localCache.has(task.cacheKey)) {
      analysis = await computeMeshAnalysisFromAssets(
        task.meshPath,
        assets,
        task.dimensions,
        options,
        task.sourceFilePath,
      );
      localCache.set(task.cacheKey, analysis ?? null);
    }
    results[task.targetId] = analysis ?? null;
  }

  return results;
};

export async function buildCollisionClearanceContextForTarget(
  robot: RobotData,
  assets: Record<string, string>,
  linkId: string,
  objectIndex: number,
  options: Pick<
    CollisionOptimizationAsyncOptions,
    | 'includeMeshClearanceObstacles'
    | 'pointCollectionLimit'
    | 'surfacePointLimit'
    | 'sourceFilePath'
  > = {},
): Promise<{
  siblingGeometries?: UrdfVisual[];
  meshClearanceObstacles?: MeshClearanceObstacle[];
}> {
  const baseAnalysis = await prepareCollisionOptimizationBaseAnalysis(
    { kind: 'robot', robot },
    assets,
    {
      includeClearanceData: true,
      includeMeshClearanceObstacles: options.includeMeshClearanceObstacles,
      pointCollectionLimit: options.pointCollectionLimit,
      surfacePointLimit: options.surfacePointLimit,
      sourceFilePath: options.sourceFilePath,
    },
  );

  const target = baseAnalysis.targets.find(
    (entry) => entry.linkId === linkId && entry.objectIndex === objectIndex,
  );

  if (!target) {
    return {};
  }

  return buildNearbyCollisionClearanceContext(
    baseAnalysis.targets,
    target,
    baseAnalysis.meshAnalysisByTargetId,
    baseAnalysis.clearanceWorld,
    options.includeMeshClearanceObstacles ?? true,
  );
}

export async function buildCollisionOptimizationAnalysisAsync(
  baseAnalysis: CollisionOptimizationBaseAnalysis,
  settings: CollisionOptimizationSettings,
  options: CollisionOptimizationAsyncOptions = {},
): Promise<CollisionOptimizationAnalysis> {
  const filteredTargets = filterTargets(baseAnalysis.targets, settings);
  const candidates: CollisionOptimizationCandidate[] = [];
  const yieldEvery = Math.max(options.yieldEvery ?? DEFAULT_CANDIDATE_ANALYSIS_YIELD_EVERY, 1);

  for (let index = 0; index < filteredTargets.length; index += 1) {
    throwIfAborted(options.signal);

    const target = filteredTargets[index];
    candidates.push(
      buildCandidate(
        target,
        baseAnalysis.targets,
        settings,
        baseAnalysis.meshAnalysisByTargetId,
        baseAnalysis.clearanceWorld,
      ),
    );

    await maybeYieldAfterBatch(index, yieldEvery, options.signal);
  }

  candidates.push(...buildManualMergeCandidates(baseAnalysis, settings));
  candidates.push(...buildCoaxialMergeCandidates(baseAnalysis, settings));

  return {
    targets: baseAnalysis.targets,
    filteredTargets,
    candidates,
    meshAnalysisByTargetId: baseAnalysis.meshAnalysisByTargetId,
  };
}

export async function analyzeCollisionOptimization(
  source: CollisionOptimizationSource,
  assets: Record<string, string>,
  settings: CollisionOptimizationSettings,
): Promise<CollisionOptimizationAnalysis> {
  const baseAnalysis = await prepareCollisionOptimizationBaseAnalysis(source, assets, {
    includePrimitiveFits:
      settings.meshStrategy !== 'keep' ||
      settings.coaxialJointMergeStrategy !== 'keep' ||
      Boolean(settings.manualMergePairs?.length),
  });
  return buildCollisionOptimizationAnalysisAsync(baseAnalysis, settings);
}

export function countSameLinkOverlapWarnings(
  targets: CollisionTargetRef[],
  meshAnalysisByTargetId: Record<string, MeshAnalysis | null>,
  overridesByTargetId: Record<string, UrdfVisual | undefined> = {},
): number {
  const grouped = new Map<string, CollisionTargetRef[]>();
  targets.forEach((target) => {
    const key = getLinkGroupKey(target);
    const group = grouped.get(key) ?? [];
    group.push(target);
    grouped.set(key, group);
  });

  let overlapPairs = 0;

  grouped.forEach((groupTargets) => {
    for (let index = 0; index < groupTargets.length; index += 1) {
      const leftTarget = groupTargets[index];
      const leftGeometry = overridesByTargetId[leftTarget.id] ?? leftTarget.geometry;
      const leftRadius = computeBroadPhaseRadius(
        leftGeometry,
        meshAnalysisByTargetId[leftTarget.id],
      );
      if (!leftRadius || leftRadius <= 1e-8) continue;

      for (let innerIndex = index + 1; innerIndex < groupTargets.length; innerIndex += 1) {
        const rightTarget = groupTargets[innerIndex];
        const rightGeometry = overridesByTargetId[rightTarget.id] ?? rightTarget.geometry;
        const rightRadius = computeBroadPhaseRadius(
          rightGeometry,
          meshAnalysisByTargetId[rightTarget.id],
        );
        if (!rightRadius || rightRadius <= 1e-8) continue;

        const leftCenter = computeBroadPhaseCenter(
          leftGeometry,
          meshAnalysisByTargetId[leftTarget.id],
        );
        const rightCenter = computeBroadPhaseCenter(
          rightGeometry,
          meshAnalysisByTargetId[rightTarget.id],
        );
        const dx = leftCenter.x - rightCenter.x;
        const dy = leftCenter.y - rightCenter.y;
        const dz = leftCenter.z - rightCenter.z;
        const distance = Math.hypot(dx, dy, dz);

        if (distance + 1e-6 < leftRadius + rightRadius) {
          overlapPairs += 1;
        }
      }
    }
  });

  return overlapPairs;
}

export function buildCollisionOptimizationOperations(
  candidates: CollisionOptimizationCandidate[],
  checkedIds: Set<string>,
): CollisionOptimizationOperation[] {
  const consumedTargetIds = new Set<string>();

  return candidates
    .filter(
      (candidate) =>
        candidate.eligible &&
        candidate.nextGeometry &&
        checkedIds.has(candidate.target.id) &&
        candidate.reason,
    )
    .sort(
      (left, right) =>
        (right.conflictPriority ?? 0) - (left.conflictPriority ?? 0) ||
        (right.affectedTargetIds?.length ?? 1) - (left.affectedTargetIds?.length ?? 1),
    )
    .flatMap((candidate) => {
      const affectedTargetIds = candidate.affectedTargetIds ?? [candidate.target.id];
      if (affectedTargetIds.some((targetId) => consumedTargetIds.has(targetId))) {
        return [];
      }

      affectedTargetIds.forEach((targetId) => consumedTargetIds.add(targetId));
      const mutations = candidate.mutations?.length
        ? candidate.mutations.map((mutation) => {
            if (mutation.type === 'replace-many') {
              return {
                ...mutation,
                nextGeometries: mutation.nextGeometries.map(cloneGeometry),
              };
            }
            if (mutation.type === 'update') {
              return {
                ...mutation,
                nextGeometry: cloneGeometry(mutation.nextGeometry),
              };
            }
            return { ...mutation };
          })
        : [
            {
              componentId: candidate.target.componentId,
              linkId: candidate.target.linkId,
              objectIndex: candidate.target.objectIndex,
              type: 'update' as const,
              nextGeometry: cloneGeometry(candidate.nextGeometry!),
            },
          ];

      return [
        {
          id: candidate.target.id,
          componentId: candidate.target.componentId,
          linkId: candidate.target.linkId,
          objectIndex: candidate.target.objectIndex,
          nextGeometry: cloneGeometry(candidate.nextGeometry!),
          reason: candidate.reason!,
          fromTypes: [
            candidate.currentType,
            ...(candidate.secondaryTarget ? [candidate.secondaryTarget.geometry.type] : []),
          ],
          toType: candidate.suggestedType!,
          mutations,
          affectedTargetIds,
        },
      ];
    });
}

export function applyCollisionOptimizationOperationsToLinks(
  links: Record<string, UrdfLink>,
  operations: CollisionOptimizationOperation[],
): Record<string, UrdfLink> {
  const nextLinks: Record<string, UrdfLink> = { ...links };

  const mutations = operations.flatMap((operation) => operation.mutations);
  const mutationKeys = new Set<string>();
  mutations.forEach((mutation) => {
    const key = `${mutation.linkId}::${mutation.objectIndex}`;
    if (mutationKeys.has(key)) {
      throw new Error(`Duplicate collision optimization mutation target: ${key}`);
    }
    mutationKeys.add(key);
  });

  mutations
    .sort(
      (left, right) =>
        left.linkId.localeCompare(right.linkId) || right.objectIndex - left.objectIndex,
    )
    .forEach((mutation) => {
      const link = nextLinks[mutation.linkId];
      if (!link) return;

      if (mutation.type === 'remove') {
        nextLinks[mutation.linkId] = removeCollisionGeometryByObjectIndex(
          link,
          mutation.objectIndex,
        ).link;
        return;
      }

      if (mutation.type === 'replace-many') {
        if (mutation.nextGeometries.length < 1 || mutation.nextGeometries.length > 3) {
          throw new Error('Mesh capsule replacement must contain between 1 and 3 geometries');
        }
        nextLinks[mutation.linkId] = replaceCollisionGeometriesByObjectIndex(
          link,
          mutation.objectIndex,
          mutation.nextGeometries,
        ).link;
        return;
      }

      nextLinks[mutation.linkId] = updateCollisionGeometryByObjectIndex(
        link,
        mutation.objectIndex,
        mutation.nextGeometry,
      );
    });

  return nextLinks;
}
