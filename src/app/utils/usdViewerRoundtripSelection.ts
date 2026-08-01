import { isViewerRoundtripUsdRootPath } from '@/core/parsers/usd/usdFormatUtils';
import { normalizeLibraryPathKey } from '@/core/utils/pathKeys';
import type { RobotFile } from '@/types';

function normalizeUsdPath(path: string): string {
  return normalizeLibraryPathKey(path);
}

function buildViewerRoundtripCandidateName(fileName: string): string | null {
  const normalizedName = normalizeUsdPath(fileName);
  const lastSlashIndex = normalizedName.lastIndexOf('/');
  const directory = lastSlashIndex >= 0 ? normalizedName.slice(0, lastSlashIndex + 1) : '';
  const baseName = lastSlashIndex >= 0 ? normalizedName.slice(lastSlashIndex + 1) : normalizedName;
  const extensionMatch = baseName.match(/\.(usd[a-z]?)$/i);
  if (!extensionMatch || isViewerRoundtripUsdRootPath(baseName)) {
    return null;
  }

  const stem = baseName.slice(0, -extensionMatch[0].length);
  if (!stem) {
    return null;
  }

  return `${directory}${stem}.viewer_roundtrip.${extensionMatch[1].toLowerCase()}`;
}

export function resolveUsdViewerRoundtripSelection(
  file: RobotFile,
  availableFiles: readonly RobotFile[],
): RobotFile {
  if (file.format !== 'usd') {
    return file;
  }

  const candidateName = buildViewerRoundtripCandidateName(file.name);
  if (!candidateName) {
    return file;
  }

  const normalizedCandidateName = normalizeUsdPath(candidateName).toLowerCase();
  return (
    availableFiles.find(
      (availableFile) =>
        availableFile.format === 'usd' &&
        normalizeUsdPath(availableFile.name).toLowerCase() === normalizedCandidateName,
    ) ?? file
  );
}
