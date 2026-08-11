import type { RobotFile } from '@/types';
import type { PreparedUsdStageOpenData } from '@/lib/robot-parser/usd/usdStageOpenPreparation';
import { collectUsdStageOpenRelevantVirtualPaths, toVirtualUsdPath } from '@/lib/robot-parser/usd/usdPreloadSources';
import {
  clearNormalizedUsdBlobCache,
  prepareUsdStageOpenDataCore,
} from '@/lib/robot-parser/usd/usdStageOpenPreparationCore';
import {
  buildBlobBackedLargeTextUsdSignature,
  isBlobBackedLargeTextUsd,
} from '@/lib/robot-parser/usd/usdStageOpenLargeText';
import { prepareUsdStageOpenWithWorker } from './usdStageOpenPreparationWorkerBridge.ts';

type StageOpenSourceFile = Pick<RobotFile, 'name' | 'content' | 'blobUrl'>;
type StageOpenAvailableFile = Pick<RobotFile, 'name' | 'content' | 'blobUrl' | 'format'>;
type PreparedUsdStageOpenWorkerLoader = (
  sourceFile: StageOpenSourceFile,
  availableFiles: StageOpenAvailableFile[],
  assets: Record<string, string>,
) => Promise<PreparedUsdStageOpenData>;
type PreparedUsdStageOpenInlineLoader = PreparedUsdStageOpenWorkerLoader;
type PreparedUsdStageOpenCacheNamespace = 'shared' | 'worker' | 'inline';

const PREPARED_USD_STAGE_OPEN_CACHE_LIMIT = 8;
const preparedUsdStageOpenCache = new Map<string, Promise<PreparedUsdStageOpenData>>();

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function buildSourceFileSignature(sourceFile: StageOpenSourceFile): string {
  const contentSignature = isBlobBackedLargeTextUsd(sourceFile)
    ? buildBlobBackedLargeTextUsdSignature(sourceFile, hashString)
    : hashString(sourceFile.content);

  return [
    sourceFile.name,
    sourceFile.blobUrl ?? '',
    contentSignature,
    String(sourceFile.content.length),
  ].join('\u0000');
}

function buildScopedAvailableFilesSignature(
  sourceFile: StageOpenSourceFile,
  availableFiles: StageOpenAvailableFile[],
): string {
  const relevantPathSet = new Set(
    collectUsdStageOpenRelevantVirtualPaths(sourceFile, availableFiles),
  );
  return availableFiles
    .filter((file) => file.format !== 'mesh' && relevantPathSet.has(toVirtualUsdPath(file.name)))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((file) =>
      [
        file.name,
        file.format,
        file.blobUrl ?? '',
        isBlobBackedLargeTextUsd(file)
          ? buildBlobBackedLargeTextUsdSignature(file, hashString)
          : hashString(file.content),
        String(file.content.length),
      ].join('\u0000'),
    )
    .join('\n');
}

function buildScopedAssetsSignature(
  sourceFile: StageOpenSourceFile,
  availableFiles: StageOpenAvailableFile[],
  assets: Record<string, string>,
): string {
  const relevantPathSet = new Set(
    collectUsdStageOpenRelevantVirtualPaths(sourceFile, availableFiles),
  );
  return Object.entries(assets)
    .filter(([path]) => relevantPathSet.has(toVirtualUsdPath(path)))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, url]) => `${path}\u0000${url}`)
    .join('\n');
}

export function buildPreparedUsdStageOpenCacheKey(
  sourceFile: StageOpenSourceFile,
  availableFiles: StageOpenAvailableFile[],
  assets: Record<string, string>,
): string {
  return [
    buildSourceFileSignature(sourceFile),
    buildScopedAvailableFilesSignature(sourceFile, availableFiles),
    buildScopedAssetsSignature(sourceFile, availableFiles, assets),
  ].join('\n---\n');
}

function buildPreparedUsdStageOpenScopedCacheKey(
  namespace: PreparedUsdStageOpenCacheNamespace,
  sourceFile: StageOpenSourceFile,
  availableFiles: StageOpenAvailableFile[],
  assets: Record<string, string>,
): string {
  return `${namespace}\n===\n${buildPreparedUsdStageOpenCacheKey(sourceFile, availableFiles, assets)}`;
}

function hasPreparedRootStagePayload(result: PreparedUsdStageOpenData): boolean {
  return result.preloadFiles.some(
    (entry) =>
      entry.path === result.stageSourcePath &&
      (!!entry.blob ||
        ((entry.bytes instanceof ArrayBuffer || ArrayBuffer.isView(entry.bytes)) &&
          entry.bytes.byteLength > 0)),
  );
}

export async function loadPreparedUsdStageOpenDataCached(
  sourceFile: StageOpenSourceFile,
  availableFiles: StageOpenAvailableFile[],
  assets: Record<string, string>,
  loader: () => Promise<PreparedUsdStageOpenData>,
  cacheNamespace: PreparedUsdStageOpenCacheNamespace = 'shared',
): Promise<PreparedUsdStageOpenData> {
  const cacheKey = buildPreparedUsdStageOpenScopedCacheKey(
    cacheNamespace,
    sourceFile,
    availableFiles,
    assets,
  );
  const cachedPromise = preparedUsdStageOpenCache.get(cacheKey);
  if (cachedPromise) {
    return cachedPromise;
  }

  const pendingPromise = loader()
    .then((result) => {
      if (!hasPreparedRootStagePayload(result)) {
        preparedUsdStageOpenCache.delete(cacheKey);
      }
      return result;
    })
    .catch((error) => {
      preparedUsdStageOpenCache.delete(cacheKey);
      throw error;
    });

  preparedUsdStageOpenCache.set(cacheKey, pendingPromise);
  if (preparedUsdStageOpenCache.size > PREPARED_USD_STAGE_OPEN_CACHE_LIMIT) {
    const oldestEntry = preparedUsdStageOpenCache.keys().next();
    if (!oldestEntry.done) {
      preparedUsdStageOpenCache.delete(oldestEntry.value);
    }
  }

  return pendingPromise;
}

export async function loadPreparedUsdStageOpenDataFromWorker(
  sourceFile: StageOpenSourceFile,
  availableFiles: StageOpenAvailableFile[],
  assets: Record<string, string>,
  prepareWithWorker: PreparedUsdStageOpenWorkerLoader = prepareUsdStageOpenWithWorker,
): Promise<PreparedUsdStageOpenData> {
  return await loadPreparedUsdStageOpenDataCached(
    sourceFile,
    availableFiles,
    assets,
    async () => {
      const result = await prepareWithWorker(sourceFile, availableFiles, assets);
      if (!hasPreparedRootStagePayload(result)) {
        throw new Error(
          `USD stage worker returned no root stage payload for "${sourceFile.name}".`,
        );
      }
      return result;
    },
    'worker',
  );
}

// Intentionally named "inline" instead of "main-thread": the same preparation
// path is reused both on the interactive stage host and inside the offscreen
// worker when worker-prepared payloads are not the chosen path.
export async function loadPreparedUsdStageOpenDataInline(
  sourceFile: StageOpenSourceFile,
  availableFiles: StageOpenAvailableFile[],
  assets: Record<string, string>,
  prepareInline: PreparedUsdStageOpenInlineLoader = prepareUsdStageOpenDataCore,
): Promise<PreparedUsdStageOpenData> {
  return await loadPreparedUsdStageOpenDataCached(
    sourceFile,
    availableFiles,
    assets,
    async () => {
      const result = await prepareInline(sourceFile, availableFiles, assets);
      if (!hasPreparedRootStagePayload(result)) {
        throw new Error(
          `USD stage preparation returned no root stage payload for "${sourceFile.name}".`,
        );
      }
      return result;
    },
    'inline',
  );
}

export function clearPreparedUsdStageOpenCache(): void {
  preparedUsdStageOpenCache.clear();
  clearNormalizedUsdBlobCache();
}

export function prewarmPreparedUsdStageOpenDataInBackground(
  sourceFile: StageOpenSourceFile,
  availableFiles: StageOpenAvailableFile[],
  assets: Record<string, string>,
): void {
  void loadPreparedUsdStageOpenDataFromWorker(sourceFile, availableFiles, assets).catch((e) => {
    console.error('[preparedUsdStageOpenCache] Background preload failed:', e);
  });
}
