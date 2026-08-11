/// <reference lib="webworker" />

import type { RobotFile } from '@/types';
import { prepareUsdStageOpenDataCore } from '@/lib/robot-parser/usd/usdStageOpenPreparationCore';
import type {
  PrepareUsdStageOpenWorkerResponse,
  UsdStageOpenPreparationWorkerRequest,
} from '../utils/usdStageOpenPreparationWorker.ts';
import type { UsdStageOpenPreparationWorkerContextSnapshot } from '../utils/usdStageOpenPreparationWorkerPayload.ts';
import { serializePreparedUsdStageOpenDataForWorker } from '../utils/usdStageOpenPreparationTransfer.ts';

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;
const workerContextSnapshots = new Map<string, UsdStageOpenPreparationWorkerContextSnapshot>();
const workerContextOrder: string[] = [];
const WORKER_CONTEXT_CACHE_LIMIT = 24;

function syncWorkerContextSnapshot(
  contextId: string,
  context: UsdStageOpenPreparationWorkerContextSnapshot,
): void {
  if (!contextId) {
    return;
  }

  workerContextSnapshots.set(contextId, context);
  const existingIndex = workerContextOrder.indexOf(contextId);
  if (existingIndex >= 0) {
    workerContextOrder.splice(existingIndex, 1);
  }
  workerContextOrder.push(contextId);

  while (workerContextOrder.length > WORKER_CONTEXT_CACHE_LIMIT) {
    const oldestContextId = workerContextOrder.shift();
    if (oldestContextId) {
      workerContextSnapshots.delete(oldestContextId);
    }
  }
}

function resolveWorkerContext(message: Extract<UsdStageOpenPreparationWorkerRequest, { type: 'prepare-usd-stage-open' }>): {
  availableFiles: Array<Pick<RobotFile, 'name' | 'content' | 'blobUrl' | 'format'>>;
  assets: Record<string, string>;
} {
  const context = message.contextId
    ? workerContextSnapshots.get(message.contextId)
    : undefined;

  return {
    availableFiles: message.availableFiles ?? context?.availableFiles ?? [],
    assets: message.assets ?? context?.assets ?? {},
  };
}

workerScope.addEventListener('message', (event: MessageEvent<UsdStageOpenPreparationWorkerRequest>) => {
  const message = event.data;
  if (!message) {
    return;
  }

  void (async () => {
    try {
      if (message.type === 'sync-context') {
        syncWorkerContextSnapshot(message.contextId, message.context);
        return;
      }

      const workerContext = resolveWorkerContext(message);
      const result = await prepareUsdStageOpenDataCore(
        message.sourceFile,
        workerContext.availableFiles,
        workerContext.assets,
      );
      const serialized = await serializePreparedUsdStageOpenDataForWorker(result);
      const response: PrepareUsdStageOpenWorkerResponse = {
        type: 'prepare-usd-stage-open-result',
        requestId: message.requestId,
        result: serialized.payload,
      };
      workerScope.postMessage(response, serialized.transferables);
    } catch (error) {
      if (message.type === 'sync-context') {
        return;
      }

      const response: PrepareUsdStageOpenWorkerResponse = {
        type: 'prepare-usd-stage-open-error',
        requestId: message.requestId,
        error: error instanceof Error ? error.message : 'USD stage preparation worker failed',
      };
      workerScope.postMessage(response);
    }
  })();
});

export {};
