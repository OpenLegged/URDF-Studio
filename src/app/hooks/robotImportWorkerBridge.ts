import {
  type ResolveRobotFileDataOptions,
  type RobotImportProgress,
  type RobotImportResult,
} from '@/core/parsers/importRobotFile';
import type { RobotFile } from '@/types';
import type {
  ApplyEditableSourceChangeWorkerRequest,
  GenerateEditableRobotSourceWorkerRequest,
  GenerateEditableRobotSourceWorkerResponse,
  PrepareAssemblyComponentWorkerOptions,
  ParseEditableRobotSourceWorkerRequest,
  ParseEditableRobotSourceWorkerResponse,
  PreparedAssemblyComponentResult,
  PrepareAssemblyComponentWorkerRequest,
  RobotImportWorkerResponse,
  RobotImportWorkerContextSnapshot,
  ResolveRobotImportWorkerRequest,
  SyncRobotImportWorkerContextRequest,
  RobotImportWorkerRequest,
} from '@/app/utils/robotImportWorker';
import type { GenerateEditableRobotSourceOptions } from '@/app/utils/generateEditableRobotSource';
import type {
  ApplyEditableSourceChangeOptions,
  ApplyEditableSourceChangeResult,
} from '@/app/utils/applyEditableSourceChange';
import type { ParseEditableRobotSourceOptions } from '@/app/utils/parseEditableRobotSource';
import {
  buildEditableSourceChangeWorkerDispatch,
  buildEditableRobotSourceWorkerDispatch,
  buildPrepareAssemblyComponentWorkerDispatch,
  buildResolveRobotImportWorkerDispatch,
  type PreparedRobotImportWorkerDispatch,
} from '@/app/utils/robotImportWorkerPayload';
import { consumePreResolvedRobotImport } from '@/app/utils/preResolvedRobotImportCache';
import type { RobotState } from '@/types';

interface WorkerLike {
  addEventListener: (
    type: 'message' | 'error' | 'messageerror',
    listener: EventListenerOrEventListenerObject,
  ) => void;
  removeEventListener: (
    type: 'message' | 'error' | 'messageerror',
    listener: EventListenerOrEventListenerObject,
  ) => void;
  postMessage: (message: RobotImportWorkerRequest) => void;
  terminate: () => void;
}

interface PendingRobotImportWorkerRequest {
  onProgress?: (progress: RobotImportProgress) => void;
  resolve: (value: RobotImportResult) => void;
  reject: (error: unknown) => void;
  workerEntry: WorkerPoolEntry;
  timeoutId?: ReturnType<typeof setTimeout>;
}

interface PendingEditableParseWorkerRequest {
  resolve: (value: RobotState | null) => void;
  reject: (error: unknown) => void;
  workerEntry: WorkerPoolEntry;
  timeoutId?: ReturnType<typeof setTimeout>;
}

interface PendingEditableSourceChangeWorkerRequest {
  resolve: (value: ApplyEditableSourceChangeResult) => void;
  reject: (error: unknown) => void;
  workerEntry: WorkerPoolEntry;
  timeoutId?: ReturnType<typeof setTimeout>;
}

interface PendingEditableSourceGenerationWorkerRequest {
  resolve: (value: string) => void;
  reject: (error: unknown) => void;
  workerEntry: WorkerPoolEntry;
  timeoutId?: ReturnType<typeof setTimeout>;
}

interface PendingPreparedAssemblyComponentWorkerRequest {
  resolve: (value: PreparedAssemblyComponentResult) => void;
  reject: (error: unknown) => void;
  workerEntry: WorkerPoolEntry;
  timeoutId?: ReturnType<typeof setTimeout>;
}

interface WorkerPoolEntry {
  pendingCount: number;
  syncedContextIdsByCacheKey: Map<string, string>;
  worker: WorkerLike;
}

interface CreateRobotImportWorkerClientOptions {
  canUseWorker?: () => boolean;
  createWorker?: () => WorkerLike;
  getWorkerCount?: () => number;
  requestTimeoutMs?: number;
}

export interface RobotImportWorkerClient {
  dispose: (rejectPendingWith?: unknown) => void;
  generateEditableSource: (options: GenerateEditableRobotSourceOptions) => Promise<string>;
  resolve: (
    file: RobotFile,
    options?: ResolveRobotFileDataOptions,
    callbacks?: { onProgress?: (progress: RobotImportProgress) => void },
  ) => Promise<RobotImportResult>;
  prepareAssemblyComponent: (
    file: RobotFile,
    options: PrepareAssemblyComponentWorkerOptions & {
      componentId: string;
      rootName: string;
    },
  ) => Promise<PreparedAssemblyComponentResult>;
  applyEditableSourceChange: (
    options: ApplyEditableSourceChangeOptions,
  ) => Promise<ApplyEditableSourceChangeResult>;
  parseEditableSource: (options: ParseEditableRobotSourceOptions) => Promise<RobotState | null>;
}

function createWorkerError(event: ErrorEvent | { error?: unknown; message?: string }): Error {
  if (event.error instanceof Error) {
    return event.error;
  }

  return new Error(event.message || 'Robot import worker failed');
}

function resolveDefaultWorkerCount(): number {
  if (typeof navigator === 'undefined') {
    return 1;
  }

  const hardwareConcurrency = Number(navigator.hardwareConcurrency || 2);
  return Math.max(1, Math.min(10, hardwareConcurrency - 1));
}

const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

function createWorkerTimeoutError(requestId: number, timeoutMs: number): Error {
  return new Error(
    'Robot import worker did not respond within the timeout '
      + `(likely a worker crash). Request id: ${requestId}. Timeout: ${timeoutMs} ms.`,
  );
}

function decrementWorkerPendingCount(workerEntry: WorkerPoolEntry): void {
  workerEntry.pendingCount = Math.max(0, workerEntry.pendingCount - 1);
}

export function createRobotImportWorkerClient({
  canUseWorker = () => typeof Worker !== 'undefined',
  createWorker = () =>
    new Worker(new URL('../workers/robotImport.worker.ts', import.meta.url), { type: 'module' }),
  getWorkerCount = resolveDefaultWorkerCount,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
}: CreateRobotImportWorkerClientOptions = {}): RobotImportWorkerClient {
  const pendingRobotImportRequests = new Map<number, PendingRobotImportWorkerRequest>();
  const pendingEditableParseRequests = new Map<number, PendingEditableParseWorkerRequest>();
  const pendingEditableSourceChangeRequests = new Map<
    number,
    PendingEditableSourceChangeWorkerRequest
  >();
  const pendingEditableSourceGenerationRequests = new Map<
    number,
    PendingEditableSourceGenerationWorkerRequest
  >();
  const pendingPreparedAssemblyComponentRequests = new Map<
    number,
    PendingPreparedAssemblyComponentWorkerRequest
  >();
  const workerPool: WorkerPoolEntry[] = [];
  let requestIdCounter = 0;
  let contextIdCounter = 0;
  let workerUnavailable = false;
  let maxWorkerCount: number | null = null;

  const clearRequestTimeout = (pendingRequest: { timeoutId?: ReturnType<typeof setTimeout> }): void => {
    if (pendingRequest.timeoutId !== undefined) {
      clearTimeout(pendingRequest.timeoutId);
      pendingRequest.timeoutId = undefined;
    }
  };

  const clearPendingRobotImportRequest = (
    requestId: number,
  ): PendingRobotImportWorkerRequest | null => {
    const pendingRequest = pendingRobotImportRequests.get(requestId) ?? null;
    if (!pendingRequest) {
      return null;
    }

    pendingRobotImportRequests.delete(requestId);
    clearRequestTimeout(pendingRequest);
    decrementWorkerPendingCount(pendingRequest.workerEntry);
    return pendingRequest;
  };

  const clearPendingEditableParseRequest = (
    requestId: number,
  ): PendingEditableParseWorkerRequest | null => {
    const pendingRequest = pendingEditableParseRequests.get(requestId) ?? null;
    if (!pendingRequest) {
      return null;
    }

    pendingEditableParseRequests.delete(requestId);
    clearRequestTimeout(pendingRequest);
    decrementWorkerPendingCount(pendingRequest.workerEntry);
    return pendingRequest;
  };

  const clearPendingEditableSourceChangeRequest = (
    requestId: number,
  ): PendingEditableSourceChangeWorkerRequest | null => {
    const pendingRequest = pendingEditableSourceChangeRequests.get(requestId) ?? null;
    if (!pendingRequest) {
      return null;
    }

    pendingEditableSourceChangeRequests.delete(requestId);
    clearRequestTimeout(pendingRequest);
    decrementWorkerPendingCount(pendingRequest.workerEntry);
    return pendingRequest;
  };

  const clearPendingEditableSourceGenerationRequest = (
    requestId: number,
  ): PendingEditableSourceGenerationWorkerRequest | null => {
    const pendingRequest = pendingEditableSourceGenerationRequests.get(requestId) ?? null;
    if (!pendingRequest) {
      return null;
    }

    pendingEditableSourceGenerationRequests.delete(requestId);
    clearRequestTimeout(pendingRequest);
    decrementWorkerPendingCount(pendingRequest.workerEntry);
    return pendingRequest;
  };

  const clearPendingPreparedAssemblyComponentRequest = (
    requestId: number,
  ): PendingPreparedAssemblyComponentWorkerRequest | null => {
    const pendingRequest = pendingPreparedAssemblyComponentRequests.get(requestId) ?? null;
    if (!pendingRequest) {
      return null;
    }

    pendingPreparedAssemblyComponentRequests.delete(requestId);
    clearRequestTimeout(pendingRequest);
    decrementWorkerPendingCount(pendingRequest.workerEntry);
    return pendingRequest;
  };

  const handleSharedWorkerMessage = (event: MessageEvent<RobotImportWorkerResponse>): void => {
    const message = event.data;
    if (!message) {
      return;
    }

    if (message.type === 'resolve-robot-file-progress') {
      const pendingRequest = pendingRobotImportRequests.get(message.requestId) ?? null;
      if (!pendingRequest?.onProgress) {
        return;
      }

      try {
        pendingRequest.onProgress(message.progress);
      } catch (error) {
        console.error('[robotImportWorkerBridge] Failed to handle worker progress event.', error);
      }
      return;
    }

    if (
      message.type === 'resolve-robot-file-result' ||
      message.type === 'resolve-robot-file-error'
    ) {
      const pendingRequest = clearPendingRobotImportRequest(message.requestId);
      if (!pendingRequest) {
        return;
      }

      if (message.type === 'resolve-robot-file-error') {
        pendingRequest.reject(new Error(message.error || 'Robot import worker failed'));
        return;
      }

      if (!message.result) {
        pendingRequest.reject(new Error('Robot import worker returned no result'));
        return;
      }

      pendingRequest.resolve(message.result);
      return;
    }

    if (
      message.type === 'prepare-assembly-component-result' ||
      message.type === 'prepare-assembly-component-error'
    ) {
      const pendingRequest = clearPendingPreparedAssemblyComponentRequest(message.requestId);
      if (!pendingRequest) {
        return;
      }

      if (message.type === 'prepare-assembly-component-error') {
        pendingRequest.reject(new Error(message.error || 'Assembly component worker failed'));
        return;
      }

      if (!message.result) {
        pendingRequest.reject(new Error('Assembly component worker returned no result'));
        return;
      }

      pendingRequest.resolve(message.result);
      return;
    }

    if (
      message.type === 'generate-editable-robot-source-result' ||
      message.type === 'generate-editable-robot-source-error'
    ) {
      const pendingRequest = clearPendingEditableSourceGenerationRequest(message.requestId);
      if (!pendingRequest) {
        return;
      }

      if (message.type === 'generate-editable-robot-source-error') {
        pendingRequest.reject(
          new Error(message.error || 'Editable source generation worker failed'),
        );
        return;
      }

      if (typeof message.result !== 'string') {
        pendingRequest.reject(new Error('Editable source generation worker returned no source'));
        return;
      }

      pendingRequest.resolve(message.result);
      return;
    }

    if (
      message.type === 'apply-editable-source-change-result' ||
      message.type === 'apply-editable-source-change-error'
    ) {
      const pendingRequest = clearPendingEditableSourceChangeRequest(message.requestId);
      if (!pendingRequest) {
        return;
      }

      if (message.type === 'apply-editable-source-change-error') {
        pendingRequest.reject(new Error(message.error || 'Editable source apply worker failed'));
        return;
      }

      if (!message.result) {
        pendingRequest.reject(new Error('Editable source apply worker returned no result'));
        return;
      }

      pendingRequest.resolve(message.result);
      return;
    }

    const pendingRequest = clearPendingEditableParseRequest(message.requestId);
    if (!pendingRequest) {
      return;
    }

    if (message.type === 'parse-editable-robot-source-error') {
      pendingRequest.reject(new Error(message.error || 'Editable source parse worker failed'));
      return;
    }

    if (message.type !== 'parse-editable-robot-source-result') {
      pendingRequest.reject(
        new Error('Editable source parse worker returned an unexpected response'),
      );
      return;
    }

    pendingRequest.resolve(message.result ?? null);
  };

  const handleSharedWorkerError = (event: ErrorEvent): void => {
    workerUnavailable = true;
    disposeWorkerPool(createWorkerError(event));
  };

  const handleSharedWorkerMessageError = (): void => {
    workerUnavailable = true;
    disposeWorkerPool(new Error('Robot import worker message transfer failed'));
  };

  const rejectPendingRequests = <T extends { reject: (error: unknown) => void }>(
    requests: Map<number, T>,
    clearRequest: (requestId: number) => T | null,
    rejectionReason: unknown,
  ): void => {
    Array.from(requests.entries()).forEach(([requestId, request]) => {
      clearRequest(requestId);
      request.reject(rejectionReason);
    });
  };

  const disposeWorkerPool = (rejectPendingWith?: unknown): void => {
    const rejectionReason = rejectPendingWith ?? new Error('Robot import worker disposed');

    workerPool.forEach((entry) => {
      entry.worker.removeEventListener('message', handleSharedWorkerMessage as EventListener);
      entry.worker.removeEventListener('error', handleSharedWorkerError as EventListener);
      entry.worker.removeEventListener(
        'messageerror',
        handleSharedWorkerMessageError as EventListener,
      );
      entry.worker.terminate();
      entry.syncedContextIdsByCacheKey.clear();
      entry.pendingCount = 0;
    });
    workerPool.length = 0;

    rejectPendingRequests(
      pendingRobotImportRequests,
      clearPendingRobotImportRequest,
      rejectionReason,
    );
    rejectPendingRequests(
      pendingEditableParseRequests,
      clearPendingEditableParseRequest,
      rejectionReason,
    );
    rejectPendingRequests(
      pendingEditableSourceChangeRequests,
      clearPendingEditableSourceChangeRequest,
      rejectionReason,
    );
    rejectPendingRequests(
      pendingEditableSourceGenerationRequests,
      clearPendingEditableSourceGenerationRequest,
      rejectionReason,
    );
    rejectPendingRequests(
      pendingPreparedAssemblyComponentRequests,
      clearPendingPreparedAssemblyComponentRequest,
      rejectionReason,
    );
  };

  const registerRequestTimeout = (
    requestId: number,
    request:
      | PendingRobotImportWorkerRequest
      | PendingEditableParseWorkerRequest
      | PendingEditableSourceChangeWorkerRequest
      | PendingEditableSourceGenerationWorkerRequest
      | PendingPreparedAssemblyComponentWorkerRequest,
  ): void => {
    if (!requestTimeoutMs || !Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
      return;
    }

    request.timeoutId = setTimeout(() => {
      disposeWorkerPool(createWorkerTimeoutError(requestId, requestTimeoutMs));
    }, requestTimeoutMs);
  };

  const resolveMaxWorkerCount = (): number => {
    if (maxWorkerCount === null) {
      maxWorkerCount = Math.max(1, getWorkerCount());
    }
    return maxWorkerCount;
  };

  const createWorkerPoolEntry = (): WorkerPoolEntry => {
    workerUnavailable = false;
    const worker = createWorker();
    worker.addEventListener('message', handleSharedWorkerMessage as EventListener);
    worker.addEventListener('error', handleSharedWorkerError as EventListener);
    worker.addEventListener('messageerror', handleSharedWorkerMessageError as EventListener);
    const entry: WorkerPoolEntry = {
      worker,
      pendingCount: 0,
      syncedContextIdsByCacheKey: new Map<string, string>(),
    };
    workerPool.push(entry);
    return entry;
  };

  const ensureWorkerPool = (minimumWorkerCount = 1): WorkerPoolEntry[] => {
    const targetWorkerCount = Math.max(1, Math.min(resolveMaxWorkerCount(), minimumWorkerCount));
    while (workerPool.length < targetWorkerCount) {
      createWorkerPoolEntry();
    }

    return workerPool;
  };

  const pickWorkerEntry = (): WorkerPoolEntry => {
    const pool = ensureWorkerPool();
    const bestEntry = pool.reduce(
      (best, candidate) => (candidate.pendingCount < best.pendingCount ? candidate : best),
      pool[0]!,
    );

    if (bestEntry.pendingCount > 0 && workerPool.length < resolveMaxWorkerCount()) {
      return createWorkerPoolEntry();
    }

    return bestEntry;
  };

  const ensureWorkerContext = (
    workerEntry: WorkerPoolEntry,
    preparedDispatch: PreparedRobotImportWorkerDispatch<unknown>,
  ): string | undefined => {
    if (!preparedDispatch.contextCacheKey || !preparedDispatch.contextSnapshot) {
      return undefined;
    }

    const cachedContextId = workerEntry.syncedContextIdsByCacheKey.get(
      preparedDispatch.contextCacheKey,
    );
    if (cachedContextId) {
      return cachedContextId;
    }

    const contextId = `robot-import-context-${++contextIdCounter}`;
    const syncContextRequest: SyncRobotImportWorkerContextRequest = {
      type: 'sync-context',
      contextId,
      context: preparedDispatch.contextSnapshot as RobotImportWorkerContextSnapshot,
    };

    workerEntry.worker.postMessage(syncContextRequest);
    workerEntry.syncedContextIdsByCacheKey.set(preparedDispatch.contextCacheKey, contextId);

    if (workerEntry.syncedContextIdsByCacheKey.size > 24) {
      const oldestEntry = workerEntry.syncedContextIdsByCacheKey.keys().next();
      if (!oldestEntry.done) {
        workerEntry.syncedContextIdsByCacheKey.delete(oldestEntry.value);
      }
    }

    return contextId;
  };

  const resolve = async (
    file: RobotFile,
    options: ResolveRobotFileDataOptions = {},
    callbacks?: { onProgress?: (progress: RobotImportProgress) => void },
  ): Promise<RobotImportResult> => {
    if (workerUnavailable && workerPool.length > 0) {
      throw new Error('Robot import worker is unavailable');
    }

    if (!canUseWorker()) {
      throw new Error('Web Worker is not available in this environment');
    }

    return new Promise<RobotImportResult>((resolveRequest, rejectRequest) => {
      const requestId = ++requestIdCounter;
      let workerEntry: WorkerPoolEntry;

      try {
        workerEntry = pickWorkerEntry();
      } catch (error) {
        workerUnavailable = true;
        rejectRequest(error);
        return;
      }

      const preparedDispatch = buildResolveRobotImportWorkerDispatch(file, options);
      let contextId: string | undefined;

      try {
        contextId = ensureWorkerContext(workerEntry, preparedDispatch);
      } catch (error) {
        workerUnavailable = true;
        rejectRequest(error);
        disposeWorkerPool(error);
        return;
      }

      const request: ResolveRobotImportWorkerRequest = {
        type: 'resolve-robot-file',
        requestId,
        file,
        options: preparedDispatch.options,
        contextId,
      };

      const pendingRequest: PendingRobotImportWorkerRequest = {
        onProgress: callbacks?.onProgress,
        resolve: resolveRequest,
        reject: rejectRequest,
        workerEntry,
      };
      pendingRobotImportRequests.set(requestId, pendingRequest);
      workerEntry.pendingCount += 1;
      registerRequestTimeout(requestId, pendingRequest);

      try {
        workerEntry.worker.postMessage(request);
      } catch (error) {
        workerUnavailable = true;
        clearPendingRobotImportRequest(requestId);
        disposeWorkerPool(error);
        rejectRequest(error);
      }
    });
  };

  const parseEditableSource = async (
    options: ParseEditableRobotSourceOptions,
  ): Promise<RobotState | null> => {
    if (workerUnavailable && workerPool.length > 0) {
      throw new Error('Robot import worker is unavailable');
    }

    if (!canUseWorker()) {
      throw new Error('Web Worker is not available in this environment');
    }

    return new Promise<RobotState | null>((resolveRequest, rejectRequest) => {
      const requestId = ++requestIdCounter;
      let workerEntry: WorkerPoolEntry;

      try {
        workerEntry = pickWorkerEntry();
      } catch (error) {
        workerUnavailable = true;
        rejectRequest(error);
        return;
      }

      const preparedDispatch = buildEditableRobotSourceWorkerDispatch(options);
      let contextId: string | undefined;

      try {
        contextId = ensureWorkerContext(workerEntry, preparedDispatch);
      } catch (error) {
        workerUnavailable = true;
        rejectRequest(error);
        disposeWorkerPool(error);
        return;
      }

      const request: ParseEditableRobotSourceWorkerRequest = {
        type: 'parse-editable-robot-source',
        requestId,
        options: preparedDispatch.options,
        contextId,
      };

      const pendingRequest: PendingEditableParseWorkerRequest = {
        resolve: resolveRequest,
        reject: rejectRequest,
        workerEntry,
      };
      pendingEditableParseRequests.set(requestId, pendingRequest);
      workerEntry.pendingCount += 1;
      registerRequestTimeout(requestId, pendingRequest);

      try {
        workerEntry.worker.postMessage(request);
      } catch (error) {
        workerUnavailable = true;
        clearPendingEditableParseRequest(requestId);
        disposeWorkerPool(error);
        rejectRequest(error);
      }
    });
  };

  const applyEditableSourceChange = async (
    options: ApplyEditableSourceChangeOptions,
  ): Promise<ApplyEditableSourceChangeResult> => {
    if (workerUnavailable && workerPool.length > 0) {
      throw new Error('Robot import worker is unavailable');
    }

    if (!canUseWorker()) {
      throw new Error('Web Worker is not available in this environment');
    }

    return new Promise<ApplyEditableSourceChangeResult>((resolveRequest, rejectRequest) => {
      const requestId = ++requestIdCounter;
      let workerEntry: WorkerPoolEntry;

      try {
        workerEntry = pickWorkerEntry();
      } catch (error) {
        workerUnavailable = true;
        rejectRequest(error);
        return;
      }

      const preparedDispatch = buildEditableSourceChangeWorkerDispatch(options);
      let contextId: string | undefined;

      try {
        contextId = ensureWorkerContext(workerEntry, preparedDispatch);
      } catch (error) {
        workerUnavailable = true;
        rejectRequest(error);
        disposeWorkerPool(error);
        return;
      }

      const request: ApplyEditableSourceChangeWorkerRequest = {
        type: 'apply-editable-source-change',
        requestId,
        options: preparedDispatch.options,
        contextId,
      };

      const pendingRequest: PendingEditableSourceChangeWorkerRequest = {
        resolve: resolveRequest,
        reject: rejectRequest,
        workerEntry,
      };
      pendingEditableSourceChangeRequests.set(requestId, pendingRequest);
      workerEntry.pendingCount += 1;
      registerRequestTimeout(requestId, pendingRequest);

      try {
        workerEntry.worker.postMessage(request);
      } catch (error) {
        workerUnavailable = true;
        clearPendingEditableSourceChangeRequest(requestId);
        disposeWorkerPool(error);
        rejectRequest(error);
      }
    });
  };

  const generateEditableSource = async (
    options: GenerateEditableRobotSourceOptions,
  ): Promise<string> => {
    if (workerUnavailable && workerPool.length > 0) {
      throw new Error('Robot import worker is unavailable');
    }

    if (!canUseWorker()) {
      throw new Error('Web Worker is not available in this environment');
    }

    return new Promise<string>((resolveRequest, rejectRequest) => {
      const requestId = ++requestIdCounter;
      let workerEntry: WorkerPoolEntry;

      try {
        workerEntry = pickWorkerEntry();
      } catch (error) {
        workerUnavailable = true;
        rejectRequest(error);
        return;
      }

      const request: GenerateEditableRobotSourceWorkerRequest = {
        type: 'generate-editable-robot-source',
        requestId,
        options,
      };

      const pendingRequest: PendingEditableSourceGenerationWorkerRequest = {
        resolve: resolveRequest,
        reject: rejectRequest,
        workerEntry,
      };
      pendingEditableSourceGenerationRequests.set(requestId, pendingRequest);
      workerEntry.pendingCount += 1;
      registerRequestTimeout(requestId, pendingRequest);

      try {
        workerEntry.worker.postMessage(request);
      } catch (error) {
        workerUnavailable = true;
        clearPendingEditableSourceGenerationRequest(requestId);
        disposeWorkerPool(error);
        rejectRequest(error);
      }
    });
  };

  const prepareAssemblyComponent = async (
    file: RobotFile,
    options: PrepareAssemblyComponentWorkerOptions & {
      componentId: string;
      rootName: string;
    },
  ): Promise<PreparedAssemblyComponentResult> => {
    if (workerUnavailable && workerPool.length > 0) {
      throw new Error('Robot import worker is unavailable');
    }

    if (!canUseWorker()) {
      throw new Error('Web Worker is not available in this environment');
    }

    return new Promise<PreparedAssemblyComponentResult>((resolveRequest, rejectRequest) => {
      const requestId = ++requestIdCounter;
      let workerEntry: WorkerPoolEntry;

      try {
        workerEntry = pickWorkerEntry();
      } catch (error) {
        workerUnavailable = true;
        rejectRequest(error);
        return;
      }

      const preparedDispatch = buildPrepareAssemblyComponentWorkerDispatch(file, options);
      let contextId: string | undefined;

      try {
        contextId = ensureWorkerContext(workerEntry, preparedDispatch);
      } catch (error) {
        workerUnavailable = true;
        rejectRequest(error);
        disposeWorkerPool(error);
        return;
      }

      const request: PrepareAssemblyComponentWorkerRequest = {
        type: 'prepare-assembly-component',
        requestId,
        file,
        options: preparedDispatch.options,
        componentId: options.componentId,
        rootName: options.rootName,
        contextId,
      };

      const pendingRequest: PendingPreparedAssemblyComponentWorkerRequest = {
        resolve: resolveRequest,
        reject: rejectRequest,
        workerEntry,
      };
      pendingPreparedAssemblyComponentRequests.set(requestId, pendingRequest);
      workerEntry.pendingCount += 1;
      registerRequestTimeout(requestId, pendingRequest);

      try {
        workerEntry.worker.postMessage(request);
      } catch (error) {
        workerUnavailable = true;
        clearPendingPreparedAssemblyComponentRequest(requestId);
        disposeWorkerPool(error);
        rejectRequest(error);
      }
    });
  };

  return {
    applyEditableSourceChange,
    dispose: disposeWorkerPool,
    generateEditableSource,
    prepareAssemblyComponent,
    parseEditableSource,
    resolve,
  };
}

const sharedRobotImportWorkerClient = createRobotImportWorkerClient();

export function resolveRobotFileDataWithWorker(
  file: RobotFile,
  options: ResolveRobotFileDataOptions = {},
  callbacks?: { onProgress?: (progress: RobotImportProgress) => void },
): Promise<RobotImportResult> {
  const preResolvedImportResult = consumePreResolvedRobotImport(file);
  // MJCF pre-resolution is synchronous and cannot fit asset-backed physical
  // primitives. Always route MJCF through the async canonical worker boundary.
  if (preResolvedImportResult && file.format !== 'mjcf') {
    callbacks?.onProgress?.({
      progressPercent: 100,
      message: 'Using cached robot document',
      progressMode: 'percent',
      phase: 'finalizing-import',
    });
    return Promise.resolve(preResolvedImportResult);
  }

  return sharedRobotImportWorkerClient.resolve(file, options, callbacks);
}

export function parseEditableRobotSourceWithWorker(
  options: ParseEditableRobotSourceOptions,
): Promise<RobotState | null> {
  return sharedRobotImportWorkerClient.parseEditableSource(options);
}

export function applyEditableSourceChangeWithWorker(
  options: ApplyEditableSourceChangeOptions,
): Promise<ApplyEditableSourceChangeResult> {
  return sharedRobotImportWorkerClient.applyEditableSourceChange(options);
}

export function generateEditableRobotSourceWithWorker(
  options: GenerateEditableRobotSourceOptions,
): Promise<string> {
  return sharedRobotImportWorkerClient.generateEditableSource(options);
}

export function prepareAssemblyComponentWithWorker(
  file: RobotFile,
  options: PrepareAssemblyComponentWorkerOptions & {
    componentId: string;
    rootName: string;
  },
): Promise<PreparedAssemblyComponentResult> {
  return sharedRobotImportWorkerClient.prepareAssemblyComponent(file, options);
}

export function disposeRobotImportWorker(rejectPendingWith?: unknown): void {
  sharedRobotImportWorkerClient.dispose(rejectPendingWith);
}
