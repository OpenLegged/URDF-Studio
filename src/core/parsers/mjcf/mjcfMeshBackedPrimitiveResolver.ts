import * as THREE from 'three';
import { loadMJCFMeshObject, type MJCFMeshCache } from './mjcfMeshAssetLoader';
import {
  applyMeshAssetTransform,
  createInlineMJCFMeshObject,
  resolveMJCFAssetUrl,
} from './mjcfGeometry';
import type { MJCFModelBody, MJCFModelGeom, ParsedMJCFModel } from './mjcfModel';
import type { MJCFMesh, MJCFMeshInertiaMode } from './mjcfUtils';
import { createMainThreadYieldController } from '@/core/utils/yieldToMainThread';
import {
  disposeTransientObject3D,
  type MJCFLoadAbortSignal,
  throwIfMJCFLoadAborted,
} from './mjcfLoadLifecycle';
import {
  type MJCFFittedPrimitive,
  type MeshPrimitiveFitStrategy,
  computeProcessedMeshFrame,
  fitPrimitiveFromProcessedMeshFrame,
  collectMeshPrimitiveFitPoints,
  fitPrimitiveFromPoints,
} from './mjcfPrimitiveGeometry';

// Re-export for backward compatibility (tests import from this module)
export { collectMeshPrimitiveFitPoints, fitPrimitiveFromPoints, type MJCFFittedPrimitive };

interface FitPrimitiveFromMeshAssetParams {
  geomType: 'capsule' | 'cylinder';
  fitStrategy: MeshPrimitiveFitStrategy;
  meshDef: MJCFMesh;
}

interface ResolveMJCFMeshBackedPrimitiveOptions {
  assets: Record<string, string>;
  abortSignal?: MJCFLoadAbortSignal;
  meshCache?: MJCFMeshCache;
  sourceFileDir?: string;
  yieldIfNeeded?: () => Promise<void>;
  fitPrimitiveFromMeshAsset?: (
    params: FitPrimitiveFromMeshAssetParams,
  ) => Promise<MJCFFittedPrimitive | null>;
  onUnresolvedPrimitive?: (
    geom: MJCFModelGeom,
    reason: 'missing-mesh-asset' | 'fit-produced-no-primitive' | 'fit-error',
    error?: unknown,
  ) => void;
}

async function fitPrimitiveFromMeshAssetViaUrl(
  geomType: 'capsule' | 'cylinder',
  fitStrategy: MeshPrimitiveFitStrategy,
  meshDef: MJCFMesh,
  assets: Record<string, string>,
  sourceFileDir: string,
  meshCache: MJCFMeshCache,
  abortSignal?: MJCFLoadAbortSignal,
): Promise<MJCFFittedPrimitive | null> {
  throwIfMJCFLoadAborted(abortSignal);
  if (meshDef.vertices?.length) {
    const inlineObject = createInlineMJCFMeshObject(meshDef);
    if (!inlineObject) {
      return null;
    }

    const transformed = applyMeshAssetTransform(inlineObject, meshDef);
    try {
      throwIfMJCFLoadAborted(abortSignal);
      const fit = fitPrimitiveFromObject3D(transformed, geomType, {
        fitaabb: fitStrategy === 'aabb',
        inertia: meshDef.inertia,
      });
      throwIfMJCFLoadAborted(abortSignal);
      return fit;
    } finally {
      disposeTransientObject3D(transformed);
    }
  }

  if (!meshDef.file) {
    return null;
  }

  const assetUrl = resolveMJCFAssetUrl(meshDef.file, assets, sourceFileDir);
  if (!assetUrl) {
    return null;
  }

  const loadedObject = await loadMJCFMeshObject(assetUrl, meshDef.file, meshCache, abortSignal);
  if (!loadedObject) {
    return null;
  }

  if (abortSignal?.aborted) {
    disposeTransientObject3D(loadedObject);
    throwIfMJCFLoadAborted(abortSignal);
  }

  const transformed = applyMeshAssetTransform(loadedObject, meshDef);
  try {
    throwIfMJCFLoadAborted(abortSignal);
    const fit = fitPrimitiveFromObject3D(transformed, geomType, {
      fitaabb: fitStrategy === 'aabb',
      inertia: meshDef.inertia,
    });
    throwIfMJCFLoadAborted(abortSignal);
    return fit;
  } finally {
    disposeTransientObject3D(transformed);
  }
}

export function fitPrimitiveFromObject3D(
  object: THREE.Object3D,
  geomType: 'capsule' | 'cylinder',
  options?: { fitaabb?: boolean; inertia?: MJCFMeshInertiaMode },
): MJCFFittedPrimitive | null {
  object.updateMatrixWorld(true);
  const processedMesh = computeProcessedMeshFrame(object, options?.inertia ?? 'legacy');
  if (!processedMesh) {
    return null;
  }

  return fitPrimitiveFromProcessedMeshFrame(
    processedMesh,
    geomType,
    options?.fitaabb ? 'aabb' : 'inertia-box',
  );
}

function shouldResolveMeshBackedPrimitive(geom: MJCFModelGeom): geom is MJCFModelGeom & {
  mesh: string;
  type: 'capsule' | 'cylinder';
} {
  return Boolean(
    geom.mesh &&
    !geom.fromto &&
    (!geom.size || geom.size.length === 0) &&
    (geom.type === 'capsule' || geom.type === 'cylinder'),
  );
}

function transformFittedPrimitiveIntoBodySpace(
  fit: MJCFFittedPrimitive,
  geom: MJCFModelGeom,
): MJCFFittedPrimitive {
  const quaternion = geom.quat
    ? new THREE.Quaternion(geom.quat[1], geom.quat[2], geom.quat[3], geom.quat[0])
    : new THREE.Quaternion();
  const position = new THREE.Vector3(geom.pos?.[0] ?? 0, geom.pos?.[1] ?? 0, geom.pos?.[2] ?? 0);
  const center = new THREE.Vector3(fit.center[0], fit.center[1], fit.center[2])
    .applyQuaternion(quaternion)
    .add(position);
  const axis = new THREE.Vector3(fit.axis[0], fit.axis[1], fit.axis[2])
    .applyQuaternion(quaternion)
    .normalize();

  return {
    axis: [axis.x, axis.y, axis.z],
    center: [center.x, center.y, center.z],
    radius: fit.radius,
    segmentLength: fit.segmentLength,
  };
}

function applyFittedPrimitiveToGeom(geom: MJCFModelGeom, fit: MJCFFittedPrimitive): void {
  const center = new THREE.Vector3(fit.center[0], fit.center[1], fit.center[2]);
  const axis = new THREE.Vector3(fit.axis[0], fit.axis[1], fit.axis[2]).normalize();
  const halfSegment = fit.segmentLength / 2;
  const from = center.clone().addScaledVector(axis, -halfSegment);
  const to = center.clone().addScaledVector(axis, halfSegment);

  geom.size = [fit.radius];
  geom.fromto = [from.x, from.y, from.z, to.x, to.y, to.z];
  geom.fittedFromMesh = geom.mesh;
  geom.mesh = undefined;
  geom.pos = undefined;
  geom.quat = undefined;
}

function createDefaultMeshPrimitiveFitter(
  assets: Record<string, string>,
  sourceFileDir: string,
  meshCache: MJCFMeshCache,
  abortSignal?: MJCFLoadAbortSignal,
) {
  const meshSpaceFitCache = new Map<string, Promise<MJCFFittedPrimitive | null>>();

  return async ({
    geomType,
    fitStrategy,
    meshDef,
  }: FitPrimitiveFromMeshAssetParams): Promise<MJCFFittedPrimitive | null> => {
    const cacheKey = [
      fitStrategy,
      geomType,
      meshDef.name,
      meshDef.file || '',
      meshDef.vertices?.join(',') || '',
      meshDef.scale?.join(',') || '',
      meshDef.refpos?.join(',') || '',
      meshDef.refquat?.join(',') || '',
    ].join('|');

    if (!meshSpaceFitCache.has(cacheKey)) {
      meshSpaceFitCache.set(
        cacheKey,
        fitPrimitiveFromMeshAssetViaUrl(
          geomType,
          fitStrategy,
          meshDef,
          assets,
          sourceFileDir,
          meshCache,
          abortSignal,
        ),
      );
    }

    return meshSpaceFitCache.get(cacheKey)!;
  };
}

async function resolveBodyMeshBackedPrimitives(
  body: MJCFModelBody,
  parsedModel: ParsedMJCFModel,
  yieldIfNeeded: () => Promise<void>,
  abortSignal: MJCFLoadAbortSignal | undefined,
  fitPrimitiveFromMeshAsset: (
    params: FitPrimitiveFromMeshAssetParams,
  ) => Promise<MJCFFittedPrimitive | null>,
  onUnresolvedPrimitive?: ResolveMJCFMeshBackedPrimitiveOptions['onUnresolvedPrimitive'],
): Promise<number> {
  let resolvedCount = 0;

  throwIfMJCFLoadAborted(abortSignal);

  for (const geom of body.geoms) {
    throwIfMJCFLoadAborted(abortSignal);
    if (!shouldResolveMeshBackedPrimitive(geom)) {
      continue;
    }

    const meshDef = parsedModel.meshMap.get(geom.mesh);
    if (!meshDef) {
      onUnresolvedPrimitive?.(geom, 'missing-mesh-asset');
      continue;
    }

    let fit: MJCFFittedPrimitive | null;
    try {
      fit = await fitPrimitiveFromMeshAsset({
        geomType: geom.type,
        fitStrategy: parsedModel.compilerSettings.fitaabb ? 'aabb' : 'inertia-box',
        meshDef,
      });
    } catch (error) {
      throwIfMJCFLoadAborted(abortSignal);
      if (!onUnresolvedPrimitive) {
        throw error;
      }
      onUnresolvedPrimitive(geom, 'fit-error', error);
      await yieldIfNeeded();
      continue;
    }

    if (!fit) {
      onUnresolvedPrimitive?.(geom, 'fit-produced-no-primitive');
      await yieldIfNeeded();
      continue;
    }

    applyFittedPrimitiveToGeom(geom, transformFittedPrimitiveIntoBodySpace(fit, geom));
    resolvedCount += 1;
    await yieldIfNeeded();
  }

  for (const child of body.children) {
    throwIfMJCFLoadAborted(abortSignal);
    resolvedCount += await resolveBodyMeshBackedPrimitives(
      child,
      parsedModel,
      yieldIfNeeded,
      abortSignal,
      fitPrimitiveFromMeshAsset,
      onUnresolvedPrimitive,
    );
    await yieldIfNeeded();
  }

  return resolvedCount;
}

export async function resolveMJCFMeshBackedPrimitiveGeoms(
  parsedModel: ParsedMJCFModel,
  {
    assets,
    abortSignal,
    meshCache = new Map(),
    sourceFileDir = '',
    yieldIfNeeded = createMainThreadYieldController(),
    fitPrimitiveFromMeshAsset = createDefaultMeshPrimitiveFitter(
      assets,
      sourceFileDir,
      meshCache,
      abortSignal,
    ),
    onUnresolvedPrimitive,
  }: ResolveMJCFMeshBackedPrimitiveOptions,
): Promise<number> {
  return await resolveBodyMeshBackedPrimitives(
    parsedModel.worldBody,
    parsedModel,
    yieldIfNeeded,
    abortSignal,
    fitPrimitiveFromMeshAsset,
    onUnresolvedPrimitive,
  );
}
