import type { RobotModelProps, ViewerDocumentLoadEvent } from '../types';
import { shouldUseIndeterminateStreamingMeshProgress } from '@/shared/components/3d';
import { ViewerLoadingHudOverlay } from './ViewerLoadingHudOverlay';
import { buildViewerLoadingHudState } from '../utils/viewerLoadingHud';

interface RobotModelLoadingHudProps {
  visible: boolean;
  loadingProgress: ViewerDocumentLoadEvent | null;
  t: RobotModelProps['t'];
}

/** Presents backend loading progress without owning the backend lifecycle. */
export function RobotModelLoadingHud({
  visible,
  loadingProgress,
  t,
}: RobotModelLoadingHudProps) {
  if (!visible) {
    return null;
  }

  const useIndeterminateStreamingProgress = shouldUseIndeterminateStreamingMeshProgress({
    phase: loadingProgress?.phase,
    loadedCount: loadingProgress?.loadedCount,
    totalCount: loadingProgress?.totalCount,
  });
  const loadingHudState = buildViewerLoadingHudState({
    phase: loadingProgress?.phase,
    progressMode: useIndeterminateStreamingProgress
      ? 'indeterminate'
      : loadingProgress?.progressMode,
    loadedCount: useIndeterminateStreamingProgress ? null : loadingProgress?.loadedCount,
    totalCount: useIndeterminateStreamingProgress ? null : loadingProgress?.totalCount,
    progressPercent: loadingProgress?.progressPercent,
    fallbackDetail: useIndeterminateStreamingProgress
      ? t.loadingRobotParsingInitialMeshes
      : t.loadingRobotPreparing,
  });
  const loadingStageLabel =
    loadingProgress?.phase === 'preparing-scene'
      ? t.loadingRobotPreparing
      : loadingProgress?.phase === 'streaming-meshes'
        ? t.loadingRobotStreamingMeshes
        : loadingProgress?.phase === 'finalizing-scene'
          ? t.loadingRobotFinalizingScene
          : null;
  const loadingDetail = loadingHudState.detail === loadingStageLabel ? '' : loadingHudState.detail;

  return (
    <ViewerLoadingHudOverlay
      title={t.loadingRobot}
      detail={loadingDetail}
      progress={loadingHudState.progress}
      progressMode={loadingHudState.progressMode}
      statusLabel={loadingHudState.statusLabel}
      stageLabel={loadingStageLabel}
      delayMs={0}
    />
  );
}
