import type { UsdWasmRuntime } from '@/lib/robot-parser/usd/usdWasmRuntime';
import {
  createEmbeddedUsdViewerLoadParams,
  shouldForceHydraFullDrawForStandaloneAsset,
} from '@/lib/robot-parser/usd/usdViewerRenderParams';
import type { UsdLoadingProgress } from '../../types.ts';

interface UsdWorkerStageOpenOptions {
  runtime: UsdWasmRuntime;
  sourceFileName: string;
  stageSourcePath: string;
  forceHydraFullDraw?: boolean;
  isActive: () => boolean;
  onStageResourcesCreated?: () => void;
  onResolvedFilename: (path: string) => void;
  onProgress: (progress: UsdLoadingProgress) => void;
  applyVisibility: () => void;
  renderFrame: () => void;
}

/** Opens a preloaded stage. The session owner must adopt or discard the returned handles. */
export async function openUsdWorkerStage({
  runtime,
  sourceFileName,
  stageSourcePath,
  forceHydraFullDraw,
  isActive,
  onStageResourcesCreated,
  onResolvedFilename,
  onProgress,
  applyVisibility,
  renderFrame,
}: UsdWorkerStageOpenOptions) {
  const params = createEmbeddedUsdViewerLoadParams(runtime.threadCount, {
    preferWorkerResolvedRobotData: true,
    dependenciesPreloadedToVirtualFs: true,
    // Vendor USDs can be fully renderable while lacking complete robot
    // joint/dynamics metadata. Keep the one-shot render drain strict, but do
    // not fail the worker after the scene is visually complete.
    allowIncompleteWorkerRobotMetadata: true,
    forceHydraFullDraw:
      forceHydraFullDraw === true || shouldForceHydraFullDrawForStandaloneAsset(sourceFileName),
  });

  return await runtime.loadUsdStage({
    USD: runtime.USD,
    usdFsHelper: runtime.usdFsHelper,
    messageLog: null,
    progressBar: null,
    progressLabel: null,
    showLoadUi: false,
    readStageMetadata: true,
    loadCollisionPrims: true,
    loadVisualPrims: true,
    loadPassLabel: 'offscreen-worker',
    params,
    displayName: sourceFileName,
    pathToLoad: stageSourcePath,
    isLoadActive: isActive,
    onStageResourcesCreated,
    onResolvedFilename: (normalizedPath: string) => {
      if (isActive()) {
        onResolvedFilename(normalizedPath);
      }
    },
    applyMeshFilters: () => {
      applyVisibility();
    },
    rebuildLinkAxes: () => {},
    renderFrame: () => {
      renderFrame();
    },
    onProgress: (progress) => {
      if (!isActive()) {
        return;
      }
      onProgress(progress);
    },
  });
}
