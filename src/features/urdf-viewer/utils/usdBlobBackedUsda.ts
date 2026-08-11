import type { RobotFile } from '@/types';
import { collectUsdStageOpenRelevantVirtualPaths, toVirtualUsdPath } from '@/lib/robot-parser/usd/usdPreloadSources';

type BlobBackedUsdaFileLike = Pick<RobotFile, 'name' | 'content' | 'blobUrl' | 'format'>;

const LARGE_BLOB_BACKED_USDA_PATTERN = /\.usda$/i;

function isUsdFileLike(
  file: BlobBackedUsdaFileLike | null | undefined,
): file is BlobBackedUsdaFileLike {
  return Boolean(file && (file.format === 'usd' || /\.usd[a-z]?$/i.test(file.name)));
}

export function isBlobBackedLargeUsdaPlaceholder(
  file: BlobBackedUsdaFileLike | null | undefined,
): boolean {
  if (!file) {
    return false;
  }

  return (
    LARGE_BLOB_BACKED_USDA_PATTERN.test(file.name) &&
    typeof file.blobUrl === 'string' &&
    file.blobUrl.length > 0 &&
    typeof file.content === 'string' &&
    file.content.length === 0
  );
}

export function hasBlobBackedLargeUsdaInStageScope(
  sourceFile: BlobBackedUsdaFileLike | null | undefined,
  availableFiles: BlobBackedUsdaFileLike[] | null | undefined,
): boolean {
  if (!isUsdFileLike(sourceFile)) {
    return false;
  }

  if (isBlobBackedLargeUsdaPlaceholder(sourceFile)) {
    return true;
  }

  const scopedAvailableFiles = availableFiles ?? [];
  const relevantPathSet = new Set(
    collectUsdStageOpenRelevantVirtualPaths(sourceFile, scopedAvailableFiles),
  );
  return scopedAvailableFiles.some(
    (file) =>
      isUsdFileLike(file) &&
      file.name !== sourceFile.name &&
      relevantPathSet.has(toVirtualUsdPath(file.name)) &&
      isBlobBackedLargeUsdaPlaceholder(file),
  );
}
