import type { RobotFile } from '@/types';
import type {
  PreparedUsdPreloadFile,
  PreparedUsdStageOpenData,
} from './usdStageOpenPreparation.ts';
import {
  buildUsdBundlePreloadEntries,
  isTextualUsdLayerCandidatePath,
  toVirtualUsdPath,
  type UsdPreloadEntry,
} from './usdPreloadSources.ts';
import { buildCriticalUsdDependencyPaths } from './usdCriticalDependencyPaths.ts';
import {
  blobNeedsUsdInstanceableVisualScopeNormalization,
  normalizeUsdInstanceableVisualScopeVisibility,
} from './usdStageOpenTextNormalization.ts';

export { buildCriticalUsdDependencyPaths } from './usdCriticalDependencyPaths.ts';

const NORMALIZED_USD_BLOB_CACHE_LIMIT = 64;
type PreparedUsdPreloadPayload = {
  blob: Blob | null;
  bytes: Uint8Array | null;
};

const normalizedUsdBlobCache = new Map<string, Promise<PreparedUsdPreloadPayload>>();
const cacheAccessTimestamps = new Map<string, number>();

let globalCacheAccessCounter = 0;

export function resolveUsdStageOpenPreparationConcurrency(preferredConcurrency?: number): number {
  const fallbackConcurrency = Number(globalThis.navigator?.hardwareConcurrency || 4);
  const resolvedConcurrency = preferredConcurrency ?? fallbackConcurrency;
  return Math.max(2, Math.min(10, Math.floor(resolvedConcurrency) || 2));
}

async function runWithConcurrency<T>(
  items: readonly T[],
  maxConcurrency: number,
  handler: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (!Array.isArray(items) || items.length === 0) {
    return;
  }

  const concurrency = Math.max(1, Math.min(Math.floor(maxConcurrency) || 1, items.length));
  let cursor = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      await handler(items[currentIndex]!, currentIndex);
    }
  });

  await Promise.all(workers);
}

function normalizePreparedUsdError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Failed to prepare USD preload file';
}

function shouldNormalizePreparedUsdText(path: string): boolean {
  return isTextualUsdLayerCandidatePath(path);
}

function isAlwaysTextualUsdLayerPath(path: string): boolean {
  const normalizedPath = String(path || '')
    .trim()
    .toLowerCase();
  return normalizedPath.endsWith('.usda');
}

function cacheNormalizedUsdBlob(
  cacheKey: string,
  payloadPromise: Promise<PreparedUsdPreloadPayload>,
): Promise<PreparedUsdPreloadPayload> {
  globalCacheAccessCounter += 1;
  cacheAccessTimestamps.set(cacheKey, globalCacheAccessCounter);
  normalizedUsdBlobCache.set(cacheKey, payloadPromise);
  if (normalizedUsdBlobCache.size > NORMALIZED_USD_BLOB_CACHE_LIMIT) {
    evictLeastRecentlyUsedEntry();
  }
  return payloadPromise;
}

function evictLeastRecentlyUsedEntry(): void {
  let lruKey: string | null = null;
  let lruTimestamp = Infinity;

  for (const [key, timestamp] of cacheAccessTimestamps) {
    if (timestamp < lruTimestamp) {
      lruTimestamp = timestamp;
      lruKey = key;
    }
  }

  if (lruKey !== null) {
    normalizedUsdBlobCache.delete(lruKey);
    cacheAccessTimestamps.delete(lruKey);
  }
}

export function clearNormalizedUsdBlobCache(): void {
  normalizedUsdBlobCache.clear();
  cacheAccessTimestamps.clear();
}

async function loadPreparedUsdBlob(entry: UsdPreloadEntry): Promise<PreparedUsdPreloadPayload> {
  if (!shouldNormalizePreparedUsdText(entry.path)) {
    return {
      blob: await entry.loadBlob(),
      bytes: null,
    };
  }

  const cacheKey = entry.normalizationCacheKey;
  if (cacheKey) {
    const cachedBlob = normalizedUsdBlobCache.get(cacheKey);
    if (cachedBlob) {
      globalCacheAccessCounter += 1;
      cacheAccessTimestamps.set(cacheKey, globalCacheAccessCounter);
      return await cachedBlob;
    }
  }

  const normalizedBlobPromise = (async () => {
    if (typeof entry.loadText === 'function' && isAlwaysTextualUsdLayerPath(entry.path)) {
      const sourceText = await entry.loadText();
      const normalizedText = normalizeUsdInstanceableVisualScopeVisibility(sourceText);
      return {
        blob: null,
        bytes: new TextEncoder().encode(normalizedText),
      };
    }

    const blob = await entry.loadBlob();
    const needsNormalization = await blobNeedsUsdInstanceableVisualScopeNormalization(blob);

    if (!needsNormalization) {
      if (!isAlwaysTextualUsdLayerPath(entry.path)) {
        return {
          blob,
          bytes: null,
        };
      }

      return {
        blob: null,
        bytes: new Uint8Array(await blob.arrayBuffer()),
      };
    }

    const sourceText = await blob.text();
    const normalizedText = normalizeUsdInstanceableVisualScopeVisibility(sourceText);
    return {
      blob: null,
      bytes: new TextEncoder().encode(normalizedText),
    };
  })();

  if (!cacheKey) {
    return await normalizedBlobPromise;
  }

  return await cacheNormalizedUsdBlob(
    cacheKey,
    normalizedBlobPromise.catch((error) => {
      normalizedUsdBlobCache.delete(cacheKey);
      cacheAccessTimestamps.delete(cacheKey);
      throw error;
    }),
  );
}

export async function prepareUsdStageOpenDataCore(
  sourceFile: Pick<RobotFile, 'name' | 'content' | 'blobUrl'>,
  availableFiles: Array<Pick<RobotFile, 'name' | 'content' | 'blobUrl' | 'format'>>,
  assets: Record<string, string>,
): Promise<PreparedUsdStageOpenData> {
  const stageSourcePath = toVirtualUsdPath(sourceFile.name);
  const preloadEntries = buildUsdBundlePreloadEntries(sourceFile, availableFiles, assets);
  const preloadFiles = new Array<PreparedUsdPreloadFile>(preloadEntries.length);

  await runWithConcurrency(
    preloadEntries,
    resolveUsdStageOpenPreparationConcurrency(),
    async (entry, index): Promise<void> => {
      try {
        const preparedPayload = await loadPreparedUsdBlob(entry);
        preloadFiles[index] = {
          path: entry.path,
          blob: preparedPayload.blob,
          bytes: preparedPayload.bytes,
          error: null,
        };
      } catch (error) {
        preloadFiles[index] = {
          path: entry.path,
          blob: null,
          error: normalizePreparedUsdError(error),
        };
      }
    },
  );

  return {
    stageSourcePath,
    criticalDependencyPaths: buildCriticalUsdDependencyPaths(stageSourcePath),
    preloadFiles,
  };
}
