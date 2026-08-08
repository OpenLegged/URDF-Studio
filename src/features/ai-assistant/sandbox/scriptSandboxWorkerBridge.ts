/**
 * Agent script-sandbox worker bridge.
 *
 * Creates a dedicated worker that runs agent-authored JS in isolation (see
 * `scriptSandboxWorker.ts`), with a request timeout that terminates a hung
 * worker instead of letting a `while(true)` block the page. Unlike the
 * worker-pool client used by heavy export pipelines, this bridge is deliberately
 * single-worker and has NO inline fallback: running agent code on the main
 * thread would defeat the isolation boundary, so when workers are unavailable
 * the caller gets a clear error instead of a degraded-but-unsafe path.
 *
 * Boundary: feature layer. Imports the worker via `new URL(..., import.meta.url)`
 * (Vite bundles it) and `@/core/workers/workerPoolClient` (WorkerLike type only).
 */

import type { WorkerLike } from '@/core/workers/workerPoolClient';

export interface RunAgentScriptArgs {
  code: string;
  draft: unknown;
  signal?: AbortSignal;
}

export interface RunAgentScriptResult {
  ok: true;
  result: unknown;
}

export interface RunAgentScriptError {
  ok: false;
  error: string;
}

export type RunAgentScriptOutcome = RunAgentScriptResult | RunAgentScriptError;

interface ScriptSandboxWorkerResponse {
  type: 'result' | 'error';
  requestId: number;
  result?: unknown;
  error?: string;
}

const DEFAULT_SCRIPT_TIMEOUT_MS = 10_000;

function createWorkerTimeoutError(millis: number): Error {
  return new Error(`Agent script did not finish within ${millis} ms and was terminated.`);
}

export interface CreateScriptSandboxWorkerClientOptions {
  createWorker?: () => WorkerLike;
  canUseWorker?: () => boolean;
  requestTimeoutMs?: number;
}

export interface ScriptSandboxWorkerClient {
  run: (args: RunAgentScriptArgs) => Promise<RunAgentScriptOutcome>;
  dispose: () => void;
}

export function createScriptSandboxWorkerClient({
  createWorker = () =>
    new Worker(new URL('./scriptSandbox.worker.ts', import.meta.url), { type: 'module' }),
  canUseWorker = () => typeof Worker !== 'undefined',
  requestTimeoutMs = DEFAULT_SCRIPT_TIMEOUT_MS,
}: CreateScriptSandboxWorkerClientOptions = {}): ScriptSandboxWorkerClient {
  let worker: WorkerLike | null = null;
  let requestIdCounter = 0;
  let disposed = false;

  const dispose = (): void => {
    disposed = true;
    if (worker) {
      worker.removeEventListener('message', handleWorkerMessage as EventListener);
      worker.removeEventListener('error', handleWorkerError as EventListener);
      worker.terminate();
      worker = null;
    }
  };

  const failAll = (error: unknown): void => {
    console.error('[ScriptSandboxWorker] worker failed', error);
    dispose();
  };

  function handleWorkerError(event: ErrorEvent | { error?: unknown; message?: string }): void {
    failAll(
      event.error instanceof Error
        ? event.error
        : new Error(event.message || 'Agent script worker failed'),
    );
  }

  function handleWorkerMessage(event: MessageEvent<ScriptSandboxWorkerResponse>): void {
    const message = event.data;
    if (!message) {
      return;
    }
    const pending = pendingRequests.get(message.requestId);
    if (!pending) {
      return;
    }
    clearPendingRequest(message.requestId);
    if (message.type === 'result') {
      pending.resolve({ ok: true, result: message.result });
      return;
    }
    pending.resolve({ ok: false, error: message.error || 'Agent script failed.' });
  }

  const clearPendingRequest = (requestId: number): PendingRequest | undefined => {
    const pending = pendingRequests.get(requestId);
    if (pending) {
      pendingRequests.delete(requestId);
      if (pending.timeoutId !== undefined) {
        clearTimeout(pending.timeoutId);
        pending.timeoutId = undefined;
      }
    }
    return pending;
  };

  interface PendingRequest {
    resolve: (outcome: RunAgentScriptOutcome) => void;
    timeoutId?: ReturnType<typeof setTimeout>;
  }

  const pendingRequests = new Map<number, PendingRequest>();

  const ensureWorker = (): WorkerLike => {
    if (!worker) {
      const created = createWorker();
      created.addEventListener('message', handleWorkerMessage as EventListener);
      created.addEventListener('error', handleWorkerError as EventListener);
      worker = created;
    }
    return worker;
  };

  const run = async (args: RunAgentScriptArgs): Promise<RunAgentScriptOutcome> => {
    if (disposed) {
      return { ok: false, error: 'Agent script sandbox is disposed.' };
    }
    if (!canUseWorker()) {
      return {
        ok: false,
        error: 'Agent script sandbox requires Web Worker support, which is unavailable here.',
      };
    }
    if (!args.code.trim()) {
      return { ok: false, error: 'Script code is empty.' };
    }
    if (args.signal?.aborted) {
      return { ok: false, error: 'Agent script aborted.' };
    }

    const requestId = ++requestIdCounter;
    let workerToUse: WorkerLike;
    try {
      workerToUse = ensureWorker();
    } catch (error) {
      disposed = true;
      return { ok: false, error: `Failed to start agent script worker: ${describeError(error)}` };
    }

    return await new Promise<RunAgentScriptOutcome>((resolve) => {
      const pending: PendingRequest = { resolve };
      pendingRequests.set(requestId, pending);

      if (requestTimeoutMs > 0) {
        pending.timeoutId = setTimeout(() => {
          clearPendingRequest(requestId);
          resolve({ ok: false, error: createWorkerTimeoutError(requestTimeoutMs).message });
          // A hung worker is useless; tear it down so the next run builds fresh.
          workerToUse.terminate();
          worker = null;
        }, requestTimeoutMs);
      }

      const abortHandler = () => {
        clearPendingRequest(requestId);
        resolve({ ok: false, error: 'Agent script aborted.' });
      };
      args.signal?.addEventListener('abort', abortHandler, { once: true });

      try {
        workerToUse.postMessage({
          requestId,
          code: args.code,
          draft: structuredClone(args.draft),
        });
      } catch (error) {
        clearPendingRequest(requestId);
        args.signal?.removeEventListener('abort', abortHandler);
        resolve({ ok: false, error: `Failed to dispatch script: ${describeError(error)}` });
      }
    });
  };

  return { run, dispose };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const sharedScriptSandboxClient = createScriptSandboxWorkerClient();

export function runAgentScript(args: RunAgentScriptArgs): Promise<RunAgentScriptOutcome> {
  return sharedScriptSandboxClient.run(args);
}

export function disposeScriptSandboxWorker(): void {
  sharedScriptSandboxClient.dispose();
}