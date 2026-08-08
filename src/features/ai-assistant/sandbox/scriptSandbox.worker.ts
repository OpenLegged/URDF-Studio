/// <reference lib="webworker" />

/**
 * Agent script-sandbox worker.
 *
 * ISOLATION BOUNDARY for `run_script`: agent-authored JS runs here, with no DOM,
 * no page globals, and no store access. It only receives the robot draft (a
 * deep clone from the main thread) plus a small whitelist API, and returns a
 * result that the main thread validates before it can affect the workspace.
 *
 * A hung script (infinite loop) is handled by the worker bridge's request
 * timeout, which terminates this worker.
 */

import { buildAgentScriptApi, executeAgentScript } from './scriptSandbox';

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;

interface ScriptSandboxRunRequest {
  requestId: number;
  code: string;
  draft: unknown;
}

workerScope.addEventListener('message', (event: MessageEvent<ScriptSandboxRunRequest>) => {
  const message = event.data;
  if (!message || typeof message.requestId !== 'number' || typeof message.code !== 'string') {
    return;
  }

  const result = executeAgentScript(message.code, message.draft, buildAgentScriptApi());
  if (result.ok) {
    workerScope.postMessage({
      type: 'result',
      requestId: message.requestId,
      result: result.result,
    });
    return;
  }

  workerScope.postMessage({
    type: 'error',
    requestId: message.requestId,
    error: result.error,
  });
});