import { type RobotState, type UsdPreparedExportCache } from '../../../types/index.ts';
import { assertCanonicalRobotData } from '@/core/robot/canonicalWorkspace';
import { adaptUsdViewerSnapshotToRobotData } from '@/lib/robot-parser/usd/usdViewerRobotAdapter';
import { resolveUsdPrimitiveGeometryFromDescriptor as resolvePrimitiveGeometryFromDescriptor } from '@/lib/robot-parser/usd/usdPrimitiveGeometry';
import { hydrateUsdViewerRobotResolutionFromRuntime } from './usdRuntimeRobotHydration.ts';
import type { ViewerRobotDataResolution } from '@/lib/robot-parser/usd/viewerRobotData';

import type {
  PreparedUsdExportCacheTransferBytesCarrier,
  RobotLike,
  SnapshotHost,
  UsdExportSnapshot,
} from './usd-export/internalTypes.ts';
import { buildUsdSnapshotLookupPaths } from './usd-export/usdExportPaths.ts';
import {
  getDescriptorRanges,
  hasSnapshotBufferValues,
  readRangeValues,
} from './usd-export/objBufferReaders.ts';
import { enrichSnapshotWithLivePreferredMaterials } from './usd-export/usdExportMaterials.ts';
import {
  buildObjBlobFromDescriptor,
  repairObjFaceVaryingNormalsForExport,
} from './usd-export/objGeometrySerializer.ts';
import {
  cloneRobotState,
  collectReferencedMeshPaths,
  createDescriptorExportMap,
  mergeCurrentRobotWithPreparedCacheGeometry,
  stripSyntheticWorldRootForExport,
} from './usd-export/usdExportDescriptorMapping.ts';

export { repairObjFaceVaryingNormalsForExport };

export interface UsdExportBundle {
  robot: RobotState;
  meshFiles: Map<string, Blob>;
  resolution: ViewerRobotDataResolution;
}

export type PreparedUsdExportCacheResult = UsdPreparedExportCache & {
  resolution: ViewerRobotDataResolution;
};

export function resolveUsdExportResolution(
  snapshot: UsdExportSnapshot,
  options: {
    fileName?: string;
    resolution?: ViewerRobotDataResolution | null;
    targetWindow?: SnapshotHost;
  } = {},
): ViewerRobotDataResolution | null {
  if (options.resolution) {
    return options.resolution;
  }

  const initialResolution = adaptUsdViewerSnapshotToRobotData(snapshot, {
    fileName: options.fileName,
  });
  if (!initialResolution) {
    return null;
  }

  const host =
    options.targetWindow ?? (typeof window !== 'undefined' ? (window as SnapshotHost) : null);
  const hydratedResolution = hydrateUsdViewerRobotResolutionFromRuntime(
    initialResolution,
    snapshot,
    host?.renderInterface,
  );

  return hydratedResolution || initialResolution;
}

export function canPrepareUsdExportCacheFromSnapshot(
  snapshot: UsdExportSnapshot | null | undefined,
): boolean {
  if (!snapshot || typeof snapshot !== 'object') {
    return false;
  }

  const descriptors = Array.from(snapshot.render?.meshDescriptors || []);
  if (descriptors.length === 0) {
    return true;
  }

  const bufferBackedDescriptors = descriptors.filter(
    (descriptor) => !resolvePrimitiveGeometryFromDescriptor(descriptor, null, snapshot),
  );
  if (bufferBackedDescriptors.length === 0) {
    return true;
  }

  if (!hasSnapshotBufferValues(snapshot.buffers?.positions)) {
    return false;
  }

  return bufferBackedDescriptors.some((descriptor) =>
    Boolean(getDescriptorRanges(descriptor, snapshot.buffers || null)?.positions),
  );
}

export function getCurrentUsdViewerSceneSnapshot(
  options: { stageSourcePath?: string | null; targetWindow?: SnapshotHost } = {},
): UsdExportSnapshot | null {
  const host =
    options.targetWindow ?? (typeof window !== 'undefined' ? (window as SnapshotHost) : null);
  for (const stageSourcePath of buildUsdSnapshotLookupPaths(options.stageSourcePath)) {
    const snapshot = host?.renderInterface?.getCachedRobotSceneSnapshot?.(stageSourcePath);
    if (snapshot && typeof snapshot === 'object') {
      return enrichSnapshotWithLivePreferredMaterials(snapshot as UsdExportSnapshot, host);
    }
  }

  return null;
}

export function resolveUsdExportSceneSnapshot(
  options: {
    stageSourcePath?: string | null;
    cachedSnapshot?: UsdExportSnapshot | null;
    targetWindow?: SnapshotHost;
  } = {},
): UsdExportSnapshot | null {
  const host =
    options.targetWindow ?? (typeof window !== 'undefined' ? (window as SnapshotHost) : null);
  if (options.cachedSnapshot && typeof options.cachedSnapshot === 'object') {
    return enrichSnapshotWithLivePreferredMaterials(options.cachedSnapshot, host);
  }

  return getCurrentUsdViewerSceneSnapshot({
    stageSourcePath: options.stageSourcePath,
    targetWindow: host,
  });
}

export function prepareUsdExportCacheFromResolvedSnapshot(
  snapshot: UsdExportSnapshot,
  resolution: ViewerRobotDataResolution,
  options: {
    includeTransferBytes?: boolean;
  } = {},
): PreparedUsdExportCacheResult {
  const { robot: snapshotRobot, descriptorByPath } = createDescriptorExportMap(
    snapshot,
    resolution,
  );
  const meshFiles: Record<string, Blob> = {};
  const meshFileBytes: Record<string, Uint8Array> = {};

  collectReferencedMeshPaths(snapshotRobot).forEach((meshPath) => {
    const descriptor = descriptorByPath.get(meshPath);
    if (!descriptor) return;

    // Prepared caches are rendered under the hydrated RobotState link hierarchy.
    // Snapshot descriptor matrices are scene transforms, so baking them into the
    // OBJ vertices would apply the same link pose a second time in the viewer.
    descriptor.bakeTransformIntoMesh = false;
    const asset = buildObjBlobFromDescriptor(descriptor, snapshot.buffers || null);
    if (!asset) return;

    meshFiles[meshPath] = asset.blob;
    if (options.includeTransferBytes) {
      meshFileBytes[meshPath] = asset.bytes;
    }
  });

  const result: PreparedUsdExportCacheResult & PreparedUsdExportCacheTransferBytesCarrier = {
    stageSourcePath: snapshot.stageSourcePath || resolution.stageSourcePath || null,
    robotData: {
      name: snapshotRobot.name,
      links: snapshotRobot.links,
      joints: snapshotRobot.joints,
      rootLinkId: snapshotRobot.rootLinkId,
      materials: snapshotRobot.materials,
      closedLoopConstraints: snapshotRobot.closedLoopConstraints,
    },
    meshFiles,
    resolution,
  };

  if (options.includeTransferBytes && Object.keys(meshFileBytes).length > 0) {
    Object.defineProperty(result, '__meshFileBytes', {
      value: meshFileBytes,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }

  return result;
}

export function prepareUsdExportCacheFromSnapshot(
  snapshot: UsdExportSnapshot,
  options: {
    fileName?: string;
    resolution?: ViewerRobotDataResolution | null;
    targetWindow?: SnapshotHost;
  } = {},
): PreparedUsdExportCacheResult | null {
  const resolution = resolveUsdExportResolution(snapshot, options);

  if (!resolution) {
    return null;
  }

  return prepareUsdExportCacheFromResolvedSnapshot(snapshot, resolution);
}

export function buildUsdExportBundleFromPreparedCache(
  preparedCache: UsdPreparedExportCache,
  options: {
    currentRobot?: RobotLike | null;
  } = {},
): UsdExportBundle | null {
  if (!preparedCache?.robotData || typeof preparedCache.robotData !== 'object') {
    return null;
  }
  assertCanonicalRobotData(preparedCache.robotData, 'USD prepared cache.robotData');

  const snapshotRobot = cloneRobotState({
    ...preparedCache.robotData,
    selection: { type: null, id: null },
  });
  const robot = stripSyntheticWorldRootForExport(
    options.currentRobot
      ? mergeCurrentRobotWithPreparedCacheGeometry(options.currentRobot, snapshotRobot)
      : snapshotRobot,
  );

  return {
    robot,
    meshFiles: new Map(Object.entries(preparedCache.meshFiles || {})),
    resolution: {
      robotData: preparedCache.robotData,
      stageSourcePath: preparedCache.stageSourcePath || null,
      linkIdByPath: {},
      linkPathById: {},
      jointPathById: {},
      childLinkPathByJointId: {},
      parentLinkPathByJointId: {},
    },
  };
}

export function buildUsdExportBundleFromSnapshot(
  snapshot: UsdExportSnapshot,
  options: {
    fileName?: string;
    currentRobot?: RobotLike | null;
    resolution?: ViewerRobotDataResolution | null;
    targetWindow?: SnapshotHost;
  } = {},
): UsdExportBundle | null {
  const resolution = resolveUsdExportResolution(snapshot, options);
  if (!resolution) {
    return null;
  }

  const { robot, descriptorByPath } = createDescriptorExportMap(
    snapshot,
    resolution,
    options.currentRobot,
  );
  const meshFiles = new Map<string, Blob>();

  collectReferencedMeshPaths(robot).forEach((meshPath) => {
    const descriptor = descriptorByPath.get(meshPath);
    if (!descriptor) return;

    const asset = buildObjBlobFromDescriptor(descriptor, snapshot.buffers || null);
    if (!asset) return;

    meshFiles.set(meshPath, asset.blob);
  });

  return {
    robot,
    meshFiles,
    resolution,
  };
}

export const __private__ = {
  readRangeValues,
};
