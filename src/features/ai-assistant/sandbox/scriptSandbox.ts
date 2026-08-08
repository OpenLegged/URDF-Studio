/**
 * Script-sandbox execution core.
 *
 * Runs agent-authored JS against a *whitelist* of helpers and a data draft, and
 * returns the result for downstream validation. The function is deliberately
 * pure (no Worker, no DOM, no store imports) so it can be unit-tested in Node
 * and reused as the body of the worker in `scriptSandbox.worker.ts`.
 *
 * Security model:
 *  - The code is compiled with `new Function` (not `eval`) under `'use strict'`,
 *    so assignments to undeclared globals throw instead of leaking.
 *  - The only values the code can see are `draft` and the `api` whitelist it is
 *    passed here — it has no reference to the page, any store, or host globals.
 *  - The result must be a plain object (agent returns the edited draft), so a
 *    script that returns a scalar/array/`null` is rejected.
 *
 * The real isolation boundary is the worker (`scriptSandbox.worker.ts`): it runs
 * this without DOM access and its result is validated before it can touch the
 * workspace. This file is the shared, testable core.
 */

export type AgentScriptApi = Record<string, unknown>;

export type ExecuteAgentScriptResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

/**
 * Execute `code` as a function body running `(draft, api) => <code>`. The code
 * must return a serializable object (the edited draft). Throwing is caught and
 * surfaced as `{ ok: false, error }`.
 */
export function executeAgentScript(
  code: string,
  draft: unknown,
  api: AgentScriptApi,
): ExecuteAgentScriptResult {
  const source = `"use strict";\n${code}`;
  let run: (draft: unknown, api: AgentScriptApi) => unknown;
  try {
    // eslint-disable-next-line no-new-func
    run = new Function('draft', 'api', source) as (
      draft: unknown,
      api: AgentScriptApi,
    ) => unknown;
  } catch (error) {
    return { ok: false, error: `Script syntax error: ${describeError(error)}` };
  }

  let result: unknown;
  try {
    result = run(draft, api);
  } catch (error) {
    return { ok: false, error: `Script threw: ${describeError(error)}` };
  }

  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    return {
      ok: false,
      error: 'Script must return a plain object (the edited robot draft).',
    };
  }

  return { ok: true, result };
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** Build a small, safe helper API for agent scripts (no I/O, no globals). */
export function buildAgentScriptApi(): AgentScriptApi {
  return {
    json: JSON,
    math: Math,
    clone: (value: unknown) => structuredClone(value),
    keys: (value: unknown) =>
      value && typeof value === 'object' ? Object.keys(value as Record<string, unknown>) : [],
    has: (value: unknown, key: string) =>
      value != null && typeof value === 'object' && key in (value as Record<string, unknown>),
  };
}