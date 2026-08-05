import type { UsdSceneSnapshot } from '@/types/usd';

export interface UsdSceneSnapshotRenderInterface {
  getCachedRobotSceneSnapshot?: (stageSourcePath?: string | null) => unknown;
  warmupRobotSceneSnapshotFromDriver?: (
    driver: unknown,
    options?: Record<string, unknown>,
  ) => unknown;
}

export interface ResolvedUsdSceneSnapshot {
  snapshot: UsdSceneSnapshot | null;
  usedWarmup: boolean;
}

function asSceneSnapshot(value: unknown): UsdSceneSnapshot | null {
  return value && typeof value === 'object' ? value as UsdSceneSnapshot : null;
}

/**
 * Resolves the composed Stage render snapshot without adapting it to robot
 * links or joints. Runtime method names retain their upstream compatibility
 * names, but this boundary exposes only scene semantics.
 */
export function resolveUsdSceneSnapshot({
  renderInterface,
  driver,
  stageSourcePath,
}: {
  renderInterface: UsdSceneSnapshotRenderInterface;
  driver: unknown;
  stageSourcePath: string | null;
}): ResolvedUsdSceneSnapshot {
  let usedWarmup = false;
  let snapshot = asSceneSnapshot(
    renderInterface.getCachedRobotSceneSnapshot?.(stageSourcePath),
  );

  for (const force of [false, true]) {
    if (snapshot || typeof renderInterface.warmupRobotSceneSnapshotFromDriver !== 'function') {
      break;
    }
    renderInterface.warmupRobotSceneSnapshotFromDriver(driver, {
      stageSourcePath,
      force,
      emitRobotMetadataEvent: false,
    });
    usedWarmup = true;
    snapshot = asSceneSnapshot(
      renderInterface.getCachedRobotSceneSnapshot?.(stageSourcePath),
    );
  }

  return { snapshot, usedWarmup };
}
