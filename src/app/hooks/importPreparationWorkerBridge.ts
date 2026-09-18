import {
  type PrepareImportPayloadArgs,
  type ImportPreparationFileDescriptor,
  type PreparedDeferredImportAssetFile,
  type PreparedImportBlobFile,
  type PreparedImportPayload,
  type PrepareImportProgress,
  type ImportPreparationWorkerRequest,
  type ImportPreparationWorkerResponse,
} from '@/app/utils/importPreparation';

interface PendingWorkerRequest {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  onProgress?: (progress: PrepareImportProgress) => void;
  idleTimeoutId?: ReturnType<typeof setTimeout>;
  hardDeadlineId?: ReturnType<typeof setTimeout>;
  resetIdleTimeout?: () => void;
}

const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
// A worker hard-killed by the browser (memory pressure, device sleep, or an
// extension) fires no `error`/`messageerror` event, so a one-shot 5-minute
// timeout used to be the only signal. Worker heartbeats and other responses
// prove per-request liveness, so only a fully silent request trips this window.
const WORKER_IDLE_TIMEOUT_MS = 90 * 1000;
const pendingWorkerRequests = new Map<number, PendingWorkerRequest>();
let requestIdCounter = 0;
let sharedWorker: Worker | null = null;
let workerUnavailable = false;
let requestHardTimeoutMs = REQUEST_TIMEOUT_MS;
let workerIdleTimeoutMs = WORKER_IDLE_TIMEOUT_MS;

/** Overrides watchdog windows; pass 0 to disable. Test-only hook. */
export function configureImportPreparationWorkerTimeouts({
  idleTimeoutMs,
  hardTimeoutMs,
}: {
  idleTimeoutMs?: number;
  hardTimeoutMs?: number;
}): void {
  if (idleTimeoutMs !== undefined) {
    workerIdleTimeoutMs = idleTimeoutMs;
  }
  if (hardTimeoutMs !== undefined) {
    requestHardTimeoutMs = hardTimeoutMs;
  }
}

function resolveWorkerIdleTimeoutMs(): number {
  return workerIdleTimeoutMs > 0 ? workerIdleTimeoutMs : Number.POSITIVE_INFINITY;
}

function resolveRequestHardTimeoutMs(): number {
  return requestHardTimeoutMs > 0 ? requestHardTimeoutMs : Number.POSITIVE_INFINITY;
}

function clearPendingWorkerRequest(requestId: number): PendingWorkerRequest | null {
  const pendingRequest = pendingWorkerRequests.get(requestId) ?? null;
  if (!pendingRequest) {
    return null;
  }

  pendingWorkerRequests.delete(requestId);
  if (pendingRequest.idleTimeoutId !== undefined) {
    clearTimeout(pendingRequest.idleTimeoutId);
    pendingRequest.idleTimeoutId = undefined;
  }
  if (pendingRequest.hardDeadlineId !== undefined) {
    clearTimeout(pendingRequest.hardDeadlineId);
    pendingRequest.hardDeadlineId = undefined;
  }
  return pendingRequest;
}

function disposeSharedWorker(rejectPendingWith?: unknown): void {
  const rejectionReason = rejectPendingWith ?? new Error('Import preparation worker disposed');

  if (sharedWorker) {
    sharedWorker.removeEventListener('message', handleSharedWorkerMessage);
    sharedWorker.removeEventListener('error', handleSharedWorkerError);
    sharedWorker.removeEventListener('messageerror', handleSharedWorkerMessageError);
    sharedWorker.terminate();
    sharedWorker = null;
  }

  if (pendingWorkerRequests.size > 0) {
    Array.from(pendingWorkerRequests.entries()).forEach(([requestId, request]) => {
      clearPendingWorkerRequest(requestId);
      request.reject(rejectionReason);
    });
  }
}

function createWorkerIdleTimeoutError(requestId: number, timeoutMs: number): Error {
  return new Error(
    'Import preparation worker did not respond before the idle timeout '
      + `(likely a worker crash). Request id: ${requestId}. Idle timeout: ${timeoutMs} ms.`,
  );
}

function createRequestHardTimeoutError(requestId: number, timeoutMs: number): Error {
  return new Error(
    'Import preparation worker request exceeded the hard timeout. '
      + `Request id: ${requestId}. Hard timeout: ${timeoutMs} ms.`,
  );
}

function registerRequestTimeout(requestId: number, request: PendingWorkerRequest): void {
  const idleTimeoutMs = resolveWorkerIdleTimeoutMs();
  const resetIdleTimeout = () => {
    if (!Number.isFinite(idleTimeoutMs)) {
      return;
    }
    if (request.idleTimeoutId !== undefined) {
      clearTimeout(request.idleTimeoutId);
    }
    request.idleTimeoutId = setTimeout(() => {
      if (pendingWorkerRequests.has(requestId)) {
        disposeSharedWorker(createWorkerIdleTimeoutError(requestId, idleTimeoutMs));
      }
    }, idleTimeoutMs);
  };

  resetIdleTimeout();
  // Cap the total wait at the hard deadline even if progress keeps arriving.
  const hardTimeoutMs = resolveRequestHardTimeoutMs();
  if (Number.isFinite(hardTimeoutMs)) {
    request.hardDeadlineId = setTimeout(() => {
      if (pendingWorkerRequests.has(requestId)) {
        disposeSharedWorker(createRequestHardTimeoutError(requestId, hardTimeoutMs));
      }
    }, hardTimeoutMs);
  }
  request.resetIdleTimeout = resetIdleTimeout;
}

function resetRequestTimeoutOnActivity(requestId: number): void {
  pendingWorkerRequests.get(requestId)?.resetIdleTimeout?.();
}

function handleSharedWorkerMessage(event: MessageEvent<ImportPreparationWorkerResponse>): void {
  const message = event.data;
  if (!message) {
    return;
  }

  // Heartbeats are independent of business progress. Reset only the matching
  // request so concurrent work cannot accidentally mask a stuck request.
  resetRequestTimeoutOnActivity(message.requestId);

  const pendingRequest = pendingWorkerRequests.get(message.requestId) ?? null;
  if (!pendingRequest) {
    return;
  }

  if (message.type === 'import-preparation-heartbeat') {
    return;
  }

  if (
    message.type === 'prepare-import-progress' ||
    message.type === 'hydrate-deferred-import-assets-progress'
  ) {
    if (message.progress) {
      pendingRequest.onProgress?.(message.progress);
    }
    return;
  }

  clearPendingWorkerRequest(message.requestId);

  if (
    message.type === 'prepare-import-error' ||
    message.type === 'hydrate-deferred-import-assets-error'
  ) {
    pendingRequest.reject(new Error(message.error || 'Import preparation worker failed'));
    return;
  }

  if (message.type === 'prepare-import-result') {
    if (!message.payload) {
      pendingRequest.reject(new Error('Import preparation worker returned no payload'));
      return;
    }

    pendingRequest.resolve(message.payload);
    return;
  }

  if (message.type === 'hydrate-deferred-import-assets-result') {
    pendingRequest.resolve(message.assetFiles ?? []);
    return;
  }

  pendingRequest.reject(new Error('Import preparation worker returned an unexpected response'));
}

function handleSharedWorkerError(event: ErrorEvent): void {
  workerUnavailable = true;
  const error = event.error ?? new Error(event.message || 'Import preparation worker failed');
  disposeSharedWorker(error);
}

function handleSharedWorkerMessageError(): void {
  workerUnavailable = true;
  disposeSharedWorker(new Error('Import preparation worker message transfer failed'));
}

function ensureSharedWorker(): Worker {
  if (!sharedWorker) {
    workerUnavailable = false;
    sharedWorker = new Worker(new URL('../workers/importPreparation.worker.ts', import.meta.url), {
      type: 'module',
    });
    sharedWorker.addEventListener('message', handleSharedWorkerMessage);
    sharedWorker.addEventListener('error', handleSharedWorkerError);
    sharedWorker.addEventListener('messageerror', handleSharedWorkerMessageError);
  }

  return sharedWorker;
}

export async function prepareImportPayloadWithWorker(
  args: PrepareImportPayloadArgs,
): Promise<PreparedImportPayload> {
  if (workerUnavailable && sharedWorker) {
    throw new Error('Import preparation worker is unavailable');
  }

  if (typeof Worker === 'undefined') {
    throw new Error('Web Worker is not available in this environment');
  }

  return new Promise<PreparedImportPayload>((resolve, reject) => {
    const requestId = ++requestIdCounter;
    let worker: Worker;

    try {
      worker = ensureSharedWorker();
    } catch (error) {
      workerUnavailable = true;
      reject(error);
      return;
    }

    const files: ImportPreparationFileDescriptor[] = [...args.files].map((input) => {
      if (input instanceof File) {
        return {
          file: input,
          relativePath: input.webkitRelativePath || input.name,
        };
      }

      return {
        file: input.file,
        relativePath: input.relativePath || input.file.webkitRelativePath || input.file.name,
      };
    });
    const request: ImportPreparationWorkerRequest = {
      type: 'prepare-import',
      requestId,
      files,
      existingPaths: [...args.existingPaths],
      preResolvePreferredImport: args.preResolvePreferredImport,
    };

    const pendingRequest: PendingWorkerRequest = {
      resolve: (value) => resolve(value as PreparedImportPayload),
      reject,
      onProgress: args.onProgress,
    };
    pendingWorkerRequests.set(requestId, pendingRequest);
    registerRequestTimeout(requestId, pendingRequest);

    try {
      worker.postMessage(request);
    } catch (error) {
      workerUnavailable = true;
      clearPendingWorkerRequest(requestId);
      disposeSharedWorker(error);
      reject(error);
    }
  });
}

interface HydrateDeferredImportAssetsWithWorkerArgs {
  archiveFile: File;
  assetFiles: readonly PreparedDeferredImportAssetFile[];
  onProgress?: (progress: PrepareImportProgress) => void;
}

export async function hydrateDeferredImportAssetsWithWorker({
  archiveFile,
  assetFiles,
  onProgress,
}: HydrateDeferredImportAssetsWithWorkerArgs): Promise<PreparedImportBlobFile[]> {
  if (workerUnavailable && sharedWorker) {
    throw new Error('Import preparation worker is unavailable');
  }

  if (typeof Worker === 'undefined') {
    throw new Error('Web Worker is not available in this environment');
  }

  return new Promise<PreparedImportBlobFile[]>((resolve, reject) => {
    const requestId = ++requestIdCounter;
    let worker: Worker;

    try {
      worker = ensureSharedWorker();
    } catch (error) {
      workerUnavailable = true;
      reject(error);
      return;
    }

    const request: ImportPreparationWorkerRequest = {
      type: 'hydrate-deferred-import-assets',
      requestId,
      archiveFile,
      assetFiles: [...assetFiles],
    };

    const pendingRequest: PendingWorkerRequest = {
      resolve: (value) => resolve(value as PreparedImportBlobFile[]),
      reject,
      onProgress,
    };
    pendingWorkerRequests.set(requestId, pendingRequest);
    registerRequestTimeout(requestId, pendingRequest);

    try {
      worker.postMessage(request);
    } catch (error) {
      workerUnavailable = true;
      clearPendingWorkerRequest(requestId);
      disposeSharedWorker(error);
      reject(error);
    }
  });
}

export function disposeImportPreparationWorker(): void {
  workerUnavailable = false;
  requestIdCounter = 0;
  requestHardTimeoutMs = REQUEST_TIMEOUT_MS;
  workerIdleTimeoutMs = WORKER_IDLE_TIMEOUT_MS;
  disposeSharedWorker();
}
