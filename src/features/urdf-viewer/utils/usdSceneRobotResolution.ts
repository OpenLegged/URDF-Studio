import type { UsdSceneSnapshot } from '@/types';
import { createSyntheticUsdViewerRobotResolution } from './usdRuntimeMeshMapping';
import {
  adaptUsdViewerSnapshotToRobotData,
  type UsdViewerRobotSceneSnapshot,
} from './usdViewerRobotAdapter';
import type { ViewerRobotDataResolution } from './viewerRobotData';
import { normalizeUsdSceneSnapshotToMeters } from './usdStageUnits';

type UsdSceneSnapshotLike = UsdSceneSnapshot | null;

export type UsdSceneRobotResolutionRenderInterface = {
  getCachedRobotSceneSnapshot?: (stageSourcePath?: string | null) => unknown;
  warmupRobotSceneSnapshotFromDriver?: (driver: unknown, options?: Record<string, unknown>) => unknown;
  meshes?: Record<string, unknown>;
};

export interface ResolvedUsdSceneRobotResolution {
  snapshot: UsdSceneSnapshotLike;
  resolution: ViewerRobotDataResolution;
  usedWarmup: boolean;
}

function toUsdSceneSnapshot(snapshot: unknown): UsdSceneSnapshotLike {
  return snapshot && typeof snapshot === 'object'
    ? normalizeUsdSceneSnapshotToMeters(snapshot as UsdSceneSnapshot)
    : null;
}

function adaptSnapshotToRobotResolution(
  snapshot: UsdSceneSnapshotLike,
  fileName: string,
): ViewerRobotDataResolution | null {
  return adaptUsdViewerSnapshotToRobotData(
    snapshot as UsdViewerRobotSceneSnapshot,
    { fileName },
  );
}

function warmupUsdSceneSnapshotFromDriver({
  renderInterface,
  driver,
  stageSourcePath,
  force,
}: {
  renderInterface: UsdSceneRobotResolutionRenderInterface;
  driver: unknown;
  stageSourcePath: string | null;
  force: boolean;
}): UsdSceneSnapshotLike {
  if (typeof renderInterface.warmupRobotSceneSnapshotFromDriver !== 'function') {
    return null;
  }

  renderInterface.warmupRobotSceneSnapshotFromDriver(driver, {
    stageSourcePath,
    force,
    emitRobotMetadataEvent: true,
  });

  return toUsdSceneSnapshot(
    renderInterface.getCachedRobotSceneSnapshot?.(stageSourcePath),
  );
}

export function resolveUsdSceneRobotResolution({
  renderInterface,
  driver,
  stageSourcePath,
  fileName,
  allowWarmup = true,
}: {
  renderInterface: UsdSceneRobotResolutionRenderInterface;
  driver: unknown;
  stageSourcePath: string | null;
  fileName: string;
  allowWarmup?: boolean;
}): ResolvedUsdSceneRobotResolution {
  let usedWarmup = false;
  let snapshot = toUsdSceneSnapshot(
    renderInterface.getCachedRobotSceneSnapshot?.(stageSourcePath),
  );

  if (!snapshot && allowWarmup) {
    const warmedSnapshot = warmupUsdSceneSnapshotFromDriver({
      renderInterface,
      driver,
      stageSourcePath,
      force: false,
    });
    if (warmedSnapshot) {
      snapshot = warmedSnapshot;
      usedWarmup = true;
    }
  }

  let resolution = adaptSnapshotToRobotResolution(snapshot, fileName);

  if (!resolution && snapshot && allowWarmup) {
    const warmedSnapshot = warmupUsdSceneSnapshotFromDriver({
      renderInterface,
      driver,
      stageSourcePath,
      force: true,
    });
    if (warmedSnapshot) {
      snapshot = warmedSnapshot;
      usedWarmup = true;
      resolution = adaptSnapshotToRobotResolution(snapshot, fileName);
    }
  }

  return {
    snapshot,
    resolution: resolution || createSyntheticUsdViewerRobotResolution({
      fileName,
      stageSourcePath,
      snapshot,
      meshIds: Object.keys(renderInterface.meshes || {}),
    }),
    usedWarmup,
  };
}
