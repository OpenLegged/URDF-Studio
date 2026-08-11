/// <reference lib="webworker" />

import {
  describeRobotImportFailure,
  resolveRobotFileDataAsync,
} from '@/core/parsers/importRobotFile';
import { prepareAssemblyRobotData } from '@/core/robot/assemblyComponentPreparation';
import { parseEditableRobotSourceAsync } from '@/app/utils/parseEditableRobotSource';
import { generateEditableRobotSource } from '@/app/utils/generateEditableRobotSource';
import { applyEditableSourceChangeAsync } from '@/app/utils/applyEditableSourceChange';
import { computeRobotRenderableBoundsFromAssets } from '@/app/utils/assemblyRenderableBounds';
import type {
  ApplyEditableSourceChangeWorkerResponse,
  GenerateEditableRobotSourceWorkerResponse,
  PrepareAssemblyComponentWorkerResponse,
  RobotImportWorkerContextSnapshot,
  ResolveRobotImportProgressWorkerResponse,
  ResolveRobotImportWorkerResponse,
  ParseEditableRobotSourceWorkerResponse,
  RobotImportWorkerRequest,
} from '@/app/utils/robotImportWorker';
import { ensureWorkerXmlDomApis } from '@/core/utils/ensureWorkerXmlDomApis';

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;
const workerContextSnapshots = new Map<string, RobotImportWorkerContextSnapshot>();
const workerContextOrder: string[] = [];
const WORKER_CONTEXT_CACHE_LIMIT = 24;

ensureWorkerXmlDomApis(workerScope as unknown as typeof globalThis);

function syncWorkerContextSnapshot(
  contextId: string,
  context: RobotImportWorkerContextSnapshot,
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

function applyWorkerContextSnapshot<T extends object>(options: T, contextId?: string): T {
  if (!contextId) {
    return options;
  }

  const context = workerContextSnapshots.get(contextId);
  if (!context) {
    return options;
  }

  const optionsWithContext = options as T & {
    availableFiles?: RobotImportWorkerContextSnapshot['availableFiles'];
    assets?: RobotImportWorkerContextSnapshot['assets'];
    allFileContents?: RobotImportWorkerContextSnapshot['allFileContents'];
  };

  return {
    ...context,
    ...optionsWithContext,
    availableFiles: optionsWithContext.availableFiles ?? context.availableFiles,
    assets: optionsWithContext.assets ?? context.assets,
    allFileContents: optionsWithContext.allFileContents ?? context.allFileContents,
  } as T;
}

async function handleWorkerMessage(event: MessageEvent<RobotImportWorkerRequest>): Promise<void> {
  const message = event.data;
  if (!message) {
    return;
  }

  try {
    if (message.type === 'sync-context') {
      syncWorkerContextSnapshot(message.contextId, message.context);
      return;
    }

    if (message.type === 'resolve-robot-file') {
      const result = await resolveRobotFileDataAsync(
        message.file,
        applyWorkerContextSnapshot(message.options, message.contextId),
        (progress) => {
          const response: ResolveRobotImportProgressWorkerResponse = {
            type: 'resolve-robot-file-progress',
            requestId: message.requestId,
            progress,
          };
          workerScope.postMessage(response);
        },
      );
      const response: ResolveRobotImportWorkerResponse = {
        type: 'resolve-robot-file-result',
        requestId: message.requestId,
        result,
      };
      workerScope.postMessage(response);
      return;
    }

    if (message.type === 'prepare-assembly-component') {
      const resolvedOptions = applyWorkerContextSnapshot(message.options, message.contextId);
      const resolvedImportResult = await resolveRobotFileDataAsync(message.file, resolvedOptions);

      if (resolvedImportResult.status !== 'ready') {
        const response: PrepareAssemblyComponentWorkerResponse = {
          type: 'prepare-assembly-component-error',
          requestId: message.requestId,
          error: `Failed to prepare assembly component from "${message.file.name}". ${describeRobotImportFailure(
            resolvedImportResult,
          )}`,
        };
        workerScope.postMessage(response);
        return;
      }

      const robotData = prepareAssemblyRobotData(resolvedImportResult.robotData, {
        sourceFilePath: message.file.name,
        sourceFormat: message.file.format,
      });
      const renderableBounds = await computeRobotRenderableBoundsFromAssets(
        robotData,
        resolvedOptions.assets,
        resolvedOptions.allFileContents,
      );

      const response: PrepareAssemblyComponentWorkerResponse = {
        type: 'prepare-assembly-component-result',
        requestId: message.requestId,
        result: {
          componentId: message.componentId,
          displayName: message.rootName,
          robotData,
          renderableBounds,
          resolvedUrdfContent: resolvedImportResult.resolvedUrdfContent,
          resolvedUrdfSourceFilePath: resolvedImportResult.resolvedUrdfSourceFilePath,
        },
      };
      workerScope.postMessage(response);
      return;
    }

    if (message.type === 'parse-editable-robot-source') {
      const result = await parseEditableRobotSourceAsync(
        applyWorkerContextSnapshot(message.options, message.contextId),
      );
      const response: ParseEditableRobotSourceWorkerResponse = {
        type: 'parse-editable-robot-source-result',
        requestId: message.requestId,
        result,
      };
      workerScope.postMessage(response);
      return;
    }

    if (message.type === 'apply-editable-source-change') {
      const result = await applyEditableSourceChangeAsync(
        applyWorkerContextSnapshot(message.options, message.contextId),
      );
      const response: ApplyEditableSourceChangeWorkerResponse = {
        type: 'apply-editable-source-change-result',
        requestId: message.requestId,
        result,
      };
      workerScope.postMessage(response);
      return;
    }

    if (message.type === 'generate-editable-robot-source') {
      const response: GenerateEditableRobotSourceWorkerResponse = {
        type: 'generate-editable-robot-source-result',
        requestId: message.requestId,
        result: generateEditableRobotSource(message.options),
      };
      workerScope.postMessage(response);
    }
  } catch (error) {
    if (message.type === 'sync-context') {
      return;
    }

    const response:
      | ResolveRobotImportWorkerResponse
      | ParseEditableRobotSourceWorkerResponse
      | ApplyEditableSourceChangeWorkerResponse
      | GenerateEditableRobotSourceWorkerResponse
      | PrepareAssemblyComponentWorkerResponse =
      message.type === 'parse-editable-robot-source'
        ? {
            type: 'parse-editable-robot-source-error',
            requestId: message.requestId,
            error: error instanceof Error ? error.message : 'Editable source parse worker failed',
          }
        : message.type === 'apply-editable-source-change'
          ? {
              type: 'apply-editable-source-change-error',
              requestId: message.requestId,
              error: error instanceof Error ? error.message : 'Editable source apply worker failed',
            }
          : message.type === 'generate-editable-robot-source'
            ? {
                type: 'generate-editable-robot-source-error',
                requestId: message.requestId,
                error:
                  error instanceof Error
                    ? error.message
                    : 'Editable source generation worker failed',
              }
            : message.type === 'prepare-assembly-component'
              ? {
                  type: 'prepare-assembly-component-error',
                  requestId: message.requestId,
                  error:
                    error instanceof Error ? error.message : 'Assembly component worker failed',
                }
              : {
                  type: 'resolve-robot-file-error',
                  requestId: message.requestId,
                  error: error instanceof Error ? error.message : 'Robot import worker failed',
                };
    workerScope.postMessage(response);
  }
}

workerScope.addEventListener('message', (event: MessageEvent<RobotImportWorkerRequest>) => {
  void handleWorkerMessage(event);
});

export {};
