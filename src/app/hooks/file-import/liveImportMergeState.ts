import type { RobotFile } from '@/types';

interface BuildLiveImportMergeStateParams {
  allFileContents: Record<string, string>;
  assets: Record<string, string>;
  availableFiles: RobotFile[];
  deferredAssetResolutionAssets: Record<string, string>;
  importedFiles: RobotFile[];
  importedTextFiles: Array<{ path: string; content: string }>;
  selectedFile: RobotFile | null;
  sourceAssets: Record<string, string>;
}

/** Pure live-state merge; callers re-read the store before each commit attempt. */
export function buildLiveImportMergeState({
  allFileContents,
  assets,
  availableFiles,
  deferredAssetResolutionAssets,
  importedFiles,
  importedTextFiles,
  selectedFile,
  sourceAssets,
}: BuildLiveImportMergeStateParams) {
  const existingNames = new Set(availableFiles.map((file) => file.name));
  const uniqueNewFiles = importedFiles.filter((file) => !existingNames.has(file.name));
  const mergedAssets = { ...assets, ...sourceAssets };
  const mergedFiles = [...availableFiles, ...uniqueNewFiles];
  const mergedAllFileContents = {
    ...allFileContents,
    ...Object.fromEntries(importedTextFiles.map((file) => [file.path, file.content])),
  };

  return {
    hadExistingAvailableFiles: availableFiles.length > 0,
    hadSelectedFile: selectedFile !== null,
    mergedAllFileContents,
    mergedAssets,
    mergedFiles,
    mergedResolutionAssets: {
      ...mergedAssets,
      ...deferredAssetResolutionAssets,
    },
    uniqueNewFiles,
  };
}
