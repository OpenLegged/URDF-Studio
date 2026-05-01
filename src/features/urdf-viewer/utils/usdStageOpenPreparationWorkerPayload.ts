import type { RobotFile } from '@/types';
import { compactBlobBackedLargeTextUsdForWorker } from './usdStageOpenLargeText.ts';

type StageOpenSourceFile = Pick<RobotFile, 'name' | 'content' | 'blobUrl'>;
type StageOpenAvailableFile = Pick<RobotFile, 'name' | 'content' | 'blobUrl' | 'format'>;

export interface UsdStageOpenPreparationWorkerContextSnapshot {
  availableFiles?: StageOpenAvailableFile[];
  assets?: Record<string, string>;
}

export interface PreparedUsdStageOpenWorkerDispatch {
  sourceFile: StageOpenSourceFile;
  availableFiles?: StageOpenAvailableFile[];
  assets?: Record<string, string>;
  contextCacheKey: string | null;
  contextSnapshot: UsdStageOpenPreparationWorkerContextSnapshot | null;
}

const objectIdentityTokens = new WeakMap<object, number>();
let nextObjectIdentityToken = 1;

function getObjectIdentityToken(value: unknown): number {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    return 0;
  }

  const objectValue = value as object;
  const cachedToken = objectIdentityTokens.get(objectValue);
  if (cachedToken) {
    return cachedToken;
  }

  const nextToken = nextObjectIdentityToken++;
  objectIdentityTokens.set(objectValue, nextToken);
  return nextToken;
}

function hasContextSnapshotContent(snapshot: UsdStageOpenPreparationWorkerContextSnapshot): boolean {
  return (snapshot.availableFiles?.length ?? 0) > 0
    || Object.keys(snapshot.assets ?? {}).length > 0;
}

function buildContextCacheKey(
  sourceFile: StageOpenSourceFile,
  availableFiles: StageOpenAvailableFile[],
  assets: Record<string, string>,
): string {
  return [
    sourceFile.name,
    `files:${getObjectIdentityToken(availableFiles)}`,
    `assets:${getObjectIdentityToken(assets)}`,
  ].join('|');
}

function isUsdStageOpenLayerPath(path: string): boolean {
  return /\.usd(?:a|c|z)?$/i.test(String(path || '').trim().split('?')[0]);
}

function filterStageOpenAvailableFiles(
  sourceFile: StageOpenSourceFile,
  availableFiles: StageOpenAvailableFile[],
): StageOpenAvailableFile[] {
  return availableFiles.filter((file) => {
    if (file.format === 'mesh') {
      return false;
    }
    if (file.name === sourceFile.name) {
      return false;
    }
    return isUsdStageOpenLayerPath(file.name);
  }).map((file) => compactBlobBackedLargeTextUsdForWorker(file));
}

function filterStageOpenAssets(
  assets: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(assets).filter(([path]) => isUsdStageOpenLayerPath(path)),
  );
}

export function buildUsdStageOpenPreparationWorkerDispatch(
  sourceFile: StageOpenSourceFile,
  availableFiles: StageOpenAvailableFile[],
  assets: Record<string, string>,
): PreparedUsdStageOpenWorkerDispatch {
  const compactSourceFile = compactBlobBackedLargeTextUsdForWorker(sourceFile);
  const filteredAvailableFiles = filterStageOpenAvailableFiles(sourceFile, availableFiles);
  const filteredAssets = filterStageOpenAssets(assets);
  const contextSnapshot: UsdStageOpenPreparationWorkerContextSnapshot = {
    availableFiles: filteredAvailableFiles,
    assets: filteredAssets,
  };

  if (!hasContextSnapshotContent(contextSnapshot)) {
    return {
      sourceFile: compactSourceFile,
      availableFiles: filteredAvailableFiles,
      assets: filteredAssets,
      contextCacheKey: null,
      contextSnapshot: null,
    };
  }

  return {
    sourceFile: compactSourceFile,
    availableFiles: undefined,
    assets: undefined,
    contextCacheKey: buildContextCacheKey(sourceFile, availableFiles, assets),
    contextSnapshot,
  };
}
