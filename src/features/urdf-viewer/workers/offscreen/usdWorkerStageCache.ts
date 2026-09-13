import type { RobotFile } from '@/types';
import { prepareUsdStageOpenDataCore } from '@/lib/robot-parser/usd/usdStageOpenPreparationCore';
import type { UsdOffscreenViewerInitRequest } from '../../utils/usdOffscreenViewerProtocol.ts';
import {
  buildPreparedUsdStageOpenCacheKey,
  clearPreparedUsdStageOpenCache,
  loadPreparedUsdStageOpenDataInline,
} from '../../utils/preparedUsdStageOpenCache.ts';

type StageOpenRequest = Pick<
  UsdOffscreenViewerInitRequest,
  | 'sourceFile'
  | 'stageOpenContext'
  | 'stageOpenContextKey'
  | 'stageOpenContextCacheHit'
  | 'projectionMode'
  | 'includeAllAvailableFiles'
>;

interface StageCacheDependencies {
  loadPrepared?: typeof loadPreparedUsdStageOpenDataInline;
  clearPrepared?: () => void;
}

/** Worker-lifetime cache: disposing a viewer stage deliberately does not evict it. */
export function createUsdWorkerStageCache({
  loadPrepared = loadPreparedUsdStageOpenDataInline,
  clearPrepared = clearPreparedUsdStageOpenCache,
}: StageCacheDependencies = {}) {
  const stageOpenContextSnapshots = new Map<
    string,
    NonNullable<UsdOffscreenViewerInitRequest['stageOpenContext']>
  >();
  const stageOpenContextOrder: string[] = [];
  const STAGE_OPEN_CONTEXT_CACHE_LIMIT = 24;
  const preparedStageOpenCacheKeys = new Set<string>();
  const preparedStageOpenCacheKeyOrder: string[] = [];
  const PREPARED_STAGE_OPEN_CACHE_LIMIT = 8;

  function cacheStageOpenContext(
    contextKey: string | undefined,
    context: UsdOffscreenViewerInitRequest['stageOpenContext'],
  ): void {
    if (!contextKey || !context) {
      return;
    }

    stageOpenContextSnapshots.set(contextKey, context);
    const existingIndex = stageOpenContextOrder.indexOf(contextKey);
    if (existingIndex >= 0) {
      stageOpenContextOrder.splice(existingIndex, 1);
    }
    stageOpenContextOrder.push(contextKey);

    while (stageOpenContextOrder.length > STAGE_OPEN_CONTEXT_CACHE_LIMIT) {
      const oldestContextKey = stageOpenContextOrder.shift();
      if (oldestContextKey) {
        stageOpenContextSnapshots.delete(oldestContextKey);
      }
    }
  }

  function recordPreparedStageOpenCacheKey(cacheKey: string): void {
    if (preparedStageOpenCacheKeys.has(cacheKey)) {
      return;
    }

    preparedStageOpenCacheKeys.add(cacheKey);
    preparedStageOpenCacheKeyOrder.push(cacheKey);

    while (preparedStageOpenCacheKeyOrder.length > PREPARED_STAGE_OPEN_CACHE_LIMIT) {
      const oldestCacheKey = preparedStageOpenCacheKeyOrder.shift();
      if (oldestCacheKey) {
        preparedStageOpenCacheKeys.delete(oldestCacheKey);
      }
    }
  }

  function resolveStageOpenContext(message: StageOpenRequest): {
    availableFiles: Array<Pick<RobotFile, 'name' | 'content' | 'blobUrl' | 'format'>>;
    assets: Record<string, string>;
    source: 'init-context' | 'worker-cache';
    cacheHit: boolean;
  } {
    if (message.stageOpenContext) {
      cacheStageOpenContext(message.stageOpenContextKey, message.stageOpenContext);
      return {
        availableFiles: message.stageOpenContext.availableFiles ?? [],
        assets: message.stageOpenContext.assets ?? {},
        source: 'init-context',
        cacheHit: Boolean(message.stageOpenContextCacheHit),
      };
    }

    if (message.stageOpenContextKey) {
      const cachedContext = stageOpenContextSnapshots.get(message.stageOpenContextKey);
      if (!cachedContext) {
        throw new Error(
          `USD offscreen worker is missing cached stage-open context "${message.stageOpenContextKey}" ` +
            `for "${message.sourceFile.name}".`,
        );
      }

      return {
        availableFiles: cachedContext.availableFiles ?? [],
        assets: cachedContext.assets ?? {},
        source: 'worker-cache',
        cacheHit: true,
      };
    }

    return {
      availableFiles: [],
      assets: {},
      source: 'init-context',
      cacheHit: false,
    };
  }

  return {
    prepare(message: StageOpenRequest) {
      const context = resolveStageOpenContext(message);
      const cacheKey = buildPreparedUsdStageOpenCacheKey(
        message.sourceFile,
        context.availableFiles,
        context.assets,
      );
      return {
        context,
        cacheHit: preparedStageOpenCacheKeys.has(cacheKey),
        async load() {
          const data = await loadPrepared(
            message.sourceFile,
            context.availableFiles,
            context.assets,
            message.projectionMode === 'scene' || message.includeAllAvailableFiles
              ? (sourceFile, availableFiles, assets) =>
                  prepareUsdStageOpenDataCore(sourceFile, availableFiles, assets, {
                    includeAllAvailableFiles: true,
                  })
              : undefined,
          );
          recordPreparedStageOpenCacheKey(cacheKey);
          return data;
        },
      };
    },
    dispose() {
      clearPrepared();
      preparedStageOpenCacheKeys.clear();
      preparedStageOpenCacheKeyOrder.length = 0;
      stageOpenContextSnapshots.clear();
      stageOpenContextOrder.length = 0;
    },
  };
}
