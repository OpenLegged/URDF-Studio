import type { PrepareImportProgress } from '@/app/utils/importPreparation';
import type { translations } from '@/shared/i18n';

export interface ImportPreparationOverlayState {
  label: string;
  detail?: string;
  progress?: number | null;
  statusLabel?: string | null;
  stageLabel?: string | null;
}

function formatImportPreparationBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Math.max(0, bytes);
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const fractionDigits = unitIndex === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

function resolveImportPreparationStageLabel(
  t: (typeof translations)[keyof typeof translations],
  progress: PrepareImportProgress,
): string {
  switch (progress.phase) {
    case 'reading-archive':
      return t.importPreparationReadingArchive;
    case 'extracting-files':
      return t.importPreparationExtractingFiles;
    case 'finalizing-import':
      return t.importPreparationFinalizingImport;
    default:
      return t.importPreparationLoadingTitle;
  }
}

export function createInitialImportPreparationOverlayState(
  t: (typeof translations)[keyof typeof translations],
): ImportPreparationOverlayState {
  return {
    label: t.importPreparationLoadingTitle,
    detail: t.importPreparationLoadingDetail,
    progress: null,
    statusLabel: null,
    stageLabel: t.importPreparationReadingArchive,
  };
}

export function createImportPreparationOverlayStateFromProgress(
  t: (typeof translations)[keyof typeof translations],
  progress: PrepareImportProgress,
): ImportPreparationOverlayState {
  const stageLabel = resolveImportPreparationStageLabel(t, progress);
  const normalizedProgress = progress.progressPercent == null
    ? null
    : Math.max(0, Math.min(1, progress.progressPercent / 100));
  const detail = progress.totalBytes > 0
    ? `${formatImportPreparationBytes(progress.processedBytes)} / ${formatImportPreparationBytes(progress.totalBytes)}`
    : progress.totalEntries > 0
      ? `${progress.processedEntries} / ${progress.totalEntries}`
      : stageLabel;
  const statusLabel = progress.totalEntries > 0
    ? `${progress.processedEntries} / ${progress.totalEntries}`
    : progress.progressPercent != null
      ? `${Math.round(progress.progressPercent)}%`
      : null;

  return {
    label: t.importPreparationLoadingTitle,
    detail,
    progress: normalizedProgress,
    statusLabel,
    stageLabel,
  };
}
