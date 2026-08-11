import { WORKSPACE_DEFAULT_CAMERA_POSITION } from '../../../shared/components/3d/scene/constants.ts';

const EMBEDDED_USD_VIEWER_SAFE_LOAD_FLAGS = {
  fastLoad: '1',
  nonBlockingLoad: '0',
  aggressiveInitialDraw: '1',
  strictOneShot: '1',
  yieldDuringLoad: '0',
  // Keep the viewer blocked until the runtime has authored joint/dynamics
  // metadata for the stage. Large quadrupeds such as Unitree B2 collapse into
  // a zero-pose fallback if interactive mode begins before this data is ready.
  resolveRobotMetadataBeforeReady: '1',
  requireCompleteRobotMetadata: '1',
  // Full-load mode must compose every referenced payload before ready. The old
  // Unitree sensor-skip shortcut can make some vendor root layers appear empty.
  skipSensorPayloadsOnOpen: '0',
  includeSensorDependency: '1',
  warmupRuntimeBridge: '1',
} as const;

export interface CreateEmbeddedUsdViewerLoadParamsOptions {
  preferWorkerResolvedRobotData?: boolean;
  preferSlicedMainThreadLoadForLargePureUsd?: boolean;
  dependenciesPreloadedToVirtualFs?: boolean;
  allowIncompleteWorkerRobotMetadata?: boolean;
}

export type EmbeddedUsdViewerLoadProfile =
  | 'default-embedded'
  | 'worker-bootstrap'
  | 'large-pure-usd-sliced';

export function resolveEmbeddedUsdViewerLoadProfile(
  options: CreateEmbeddedUsdViewerLoadParamsOptions = {},
): EmbeddedUsdViewerLoadProfile {
  if (options.preferWorkerResolvedRobotData) {
    return 'worker-bootstrap';
  }

  if (options.preferSlicedMainThreadLoadForLargePureUsd) {
    return 'large-pure-usd-sliced';
  }

  return 'default-embedded';
}

export function shouldPreferSlicedEmbeddedUsdLoad({
  sourceFileName,
  preloadFileCount,
  criticalDependencyCount,
}: {
  sourceFileName: string;
  preloadFileCount: number;
  criticalDependencyCount: number;
}): boolean {
  const normalizedSourceFileName = String(sourceFileName || '')
    .trim()
    .toLowerCase();
  const isUsdLayerRoot = /\.usda?$/i.test(normalizedSourceFileName);

  return isUsdLayerRoot && preloadFileCount > 1 && criticalDependencyCount > 0;
}

export function createEmbeddedUsdViewerLoadParams(
  threadCount: number,
  options: CreateEmbeddedUsdViewerLoadParamsOptions = {},
): URLSearchParams {
  const params = new URLSearchParams();
  const safeLoadFlags: Record<string, string> = {
    ...EMBEDDED_USD_VIEWER_SAFE_LOAD_FLAGS,
  };

  const loadProfile = resolveEmbeddedUsdViewerLoadProfile(options);

  if (loadProfile === 'worker-bootstrap') {
    // Worker bootstrap resolves USD into RobotState, so it can use the native
    // stage snapshot and skip the Hydra full-draw path while still requiring a
    // complete snapshot before ready.
    safeLoadFlags.nonBlockingLoad = '0';
    safeLoadFlags.aggressiveInitialDraw = '0';
    safeLoadFlags.strictOneShot = '1';
    safeLoadFlags.yieldDuringLoad = '0';
    safeLoadFlags.resolveRobotMetadataBeforeReady =
      options.allowIncompleteWorkerRobotMetadata ? '0' : '1';
    safeLoadFlags.requireCompleteRobotMetadata =
      options.allowIncompleteWorkerRobotMetadata ? '0' : '1';
    safeLoadFlags.robotSceneSnapshotBeforeDraw = '1';
    safeLoadFlags.skipHydraFullDrawForRobotSceneSnapshot = '1';
    safeLoadFlags.skipHydraPopulateForRobotSceneSnapshot = '1';
    safeLoadFlags.disableStageLayerTextFallbacks = '1';
  }

  if (loadProfile === 'large-pure-usd-sliced') {
    // Folder-imported pure `.usd` roots such as `unitree_model/*/usd/*.usd`
    // still use the strict embedded contract: ready is emitted only after
    // geometry, transforms, materials, textures, and robot metadata are drained.
    safeLoadFlags.nonBlockingLoad = '0';
    safeLoadFlags.aggressiveInitialDraw = '1';
    safeLoadFlags.strictOneShot = '1';
    safeLoadFlags.yieldDuringLoad = '0';
    safeLoadFlags.resolveRobotMetadataBeforeReady = '1';
    safeLoadFlags.requireCompleteRobotMetadata = '1';
  }

  if (options.dependenciesPreloadedToVirtualFs) {
    safeLoadFlags.dependenciesPreloadedToVirtualFs = '1';
    safeLoadFlags.autoLoadDependencies = '0';
  }

  const enableRegressionLoadProfile = (() => {
    if (typeof window === 'undefined') {
      return false;
    }
    try {
      const searchParams = new URLSearchParams(window.location?.search ?? '');
      return (
        searchParams.get('regressionDebug') === '1' ||
        searchParams.get('profileUsdLoad') === '1'
      );
    } catch {
      return false;
    }
  })();
  if (enableRegressionLoadProfile) {
    safeLoadFlags.profileLoad = '1';
    safeLoadFlags.profileHydraPhases = '1';
  }

  params.set('threads', String(threadCount));
  // Preserve the viewer's proven embedded-load defaults while optionally
  // relaxing robot metadata readiness when a parallel worker bootstrap is active.
  Object.entries(safeLoadFlags).forEach(([key, value]) => {
    params.set(key, value);
  });

  // Keep embedded USD framing aligned with the URDF/MJCF workspace viewer.
  params.set('cameraX', String(WORKSPACE_DEFAULT_CAMERA_POSITION[0]));
  params.set('cameraY', String(WORKSPACE_DEFAULT_CAMERA_POSITION[1]));
  params.set('cameraZ', String(WORKSPACE_DEFAULT_CAMERA_POSITION[2]));

  return params;
}
