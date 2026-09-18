/// <reference lib="webworker" />

import {
  prepareImportPayload,
  hydrateDeferredImportAssets,
  type ImportPreparationWorkerRequest,
  type ImportPreparationWorkerResponse,
} from '@/app/utils/importPreparation';
import { ensureWorkerXmlDomApis } from '@/core/utils/ensureWorkerXmlDomApis';

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;
const HEARTBEAT_INTERVAL_MS = 15 * 1000;
ensureWorkerXmlDomApis(workerScope as unknown as typeof globalThis);

workerScope.addEventListener(
  'message',
  async (event: MessageEvent<ImportPreparationWorkerRequest>) => {
    const message = event.data;
    if (!message) {
      return;
    }

    const postHeartbeat = () => {
      const response: ImportPreparationWorkerResponse = {
        type: 'import-preparation-heartbeat',
        requestId: message.requestId,
      };
      workerScope.postMessage(response);
    };
    // Progress reflects business work and can legitimately pause during a
    // large extraction. This independent signal only proves worker liveness.
    postHeartbeat();
    const heartbeatIntervalId = workerScope.setInterval(postHeartbeat, HEARTBEAT_INTERVAL_MS);

    try {
      if (message.type === 'prepare-import') {
        const payload = await prepareImportPayload({
          files: message.files,
          existingPaths: message.existingPaths,
          preResolvePreferredImport: message.preResolvePreferredImport,
          onProgress: (progress) => {
            const progressResponse: ImportPreparationWorkerResponse = {
              type: 'prepare-import-progress',
              requestId: message.requestId,
              progress,
            };
            workerScope.postMessage(progressResponse);
          },
        });
        const response: ImportPreparationWorkerResponse = {
          type: 'prepare-import-result',
          requestId: message.requestId,
          payload,
        };
        workerScope.postMessage(response);
        return;
      }

      if (message.type === 'hydrate-deferred-import-assets') {
        const assetFiles = await hydrateDeferredImportAssets(
          message.archiveFile,
          message.assetFiles,
          (progress) => {
            const progressResponse: ImportPreparationWorkerResponse = {
              type: 'hydrate-deferred-import-assets-progress',
              requestId: message.requestId,
              progress,
            };
            workerScope.postMessage(progressResponse);
          },
        );
        const response: ImportPreparationWorkerResponse = {
          type: 'hydrate-deferred-import-assets-result',
          requestId: message.requestId,
          assetFiles,
        };
        workerScope.postMessage(response);
      }
    } catch (error) {
      const response: ImportPreparationWorkerResponse = {
        type:
          message.type === 'hydrate-deferred-import-assets'
            ? 'hydrate-deferred-import-assets-error'
            : 'prepare-import-error',
        requestId: message.requestId,
        error: error instanceof Error ? error.message : 'Import preparation worker failed',
      };
      workerScope.postMessage(response);
    } finally {
      workerScope.clearInterval(heartbeatIntervalId);
    }
  },
);

export {};
