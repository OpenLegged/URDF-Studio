/**
 * Generic AI edit-agent engine.
 *
 * Runs the tool-calling loop against a *capability registry* instead of a
 * hand-written `TOOL_SCHEMAS` + `dispatchTool` switch. The registry is the single
 * source of truth: tool schemas given to the model, JSON-arg dispatch, and the
 * mutating-vs-read classification all derive from it. Adding a capability in
 * `robotCapabilities.ts` requires no change here.
 *
 * The engine is deliberately provider-agnostic beyond the OpenAI SDK shapes used
 * by the app's BYOK transport. It owns the loop (message history, step cap,
 * abort handling) and the tool-result plumbing; each capability owns its schema
 * and mutation semantics.
 *
 * Boundary: feature layer. Imports `openai` (external), `@/types`, and the
 * capability registry. No app, no store.
 */

import OpenAI from 'openai';
import type { RobotData } from '@/types';
import type { AgentCapability, AgentToolResult } from '../capabilities/types';
import { buildRobotCapabilities } from '../capabilities/robotCapabilities';

/** Thrown when the BYOK endpoint rejects tool-calling (so the caller can fall back). */
export class AgentToolsUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentToolsUnsupportedError';
  }
}

export interface RobotEditAgentResult {
  explanation: string;
  /** The edited robot draft, or null when the model made no tool calls. */
  robot: RobotData | null;
}

export interface RunAgentEngineOptions {
  /** Capabilities to expose. Defaults to the full robot registry. */
  capabilities?: AgentCapability[];
  /** System-prompt builder; defaults to a minimal URDF-editing prompt. */
  systemPrompt?: (robot: RobotData, capabilities: AgentCapability[]) => string;
  /** Maximum tool-calling steps before the loop bails. */
  maxSteps?: number;
}

const DEFAULT_MAX_STEPS = 10;

const isAbortError = (e: unknown): boolean =>
  e instanceof Error && (e.name === 'AbortError' || e.name === 'APIUserAbortError');

const isToolsUnsupportedError = (e: unknown): boolean => {
  const err = e as { status?: number; message?: string; error?: { error?: { message?: string } } };
  if (err.status === 400 || err.status === 404) {
    return true;
  }
  const msg = (err.message || err.error?.error?.message || '').toLowerCase();
  return msg.includes('tool') || msg.includes('function call') || msg.includes('does not support');
};

/** Build the OpenAI tool-schema array from a capability registry. */
export function buildToolSchemas(capabilities: AgentCapability[]): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return capabilities.map((capability) => ({
    type: 'function' as const,
    function: {
      name: capability.name,
      description: capability.description,
      parameters: capability.parameters,
    },
  }));
}

/** Dispatch a single tool call against the registry by name. May be async. */
export async function dispatchCapability(
  capabilities: AgentCapability[],
  name: string,
  args: Record<string, unknown>,
  draft: RobotData,
): Promise<AgentToolResult> {
  const capability = capabilities.find((c) => c.name === name);
  if (!capability) {
    return { ok: false, message: `Unknown tool "${name}".` };
  }
  // External JSON boundary: the model's arguments are cast to the typed arg
  // shape. The pure tools validate semantic preconditions and report via ok:false.
  return await capability.execute(draft, args);
}

const defaultSystemPrompt = (_robot: RobotData): string =>
  'You are an AI editing agent. Use the provided tools to make the requested edits. ' +
  'Call tools to make changes; do not output URDF or code snippets. ' +
  'When all edits are done, reply with ONE short sentence summarizing what you changed. ' +
  'If the request is impossible with the available tools, say so briefly without calling tools.';

/**
 * Run the generic edit-agent loop. Deep-clones `robot` as the working draft,
 * loops the model with tools until it stops calling them, and returns the
 * modified draft (or null if no mutating tool was ever called). Throws
 * `AgentToolsUnsupportedError` if the BYOK endpoint rejects tool-calling.
 */
export async function runAgentEngine(
  userMessage: string,
  robot: RobotData,
  createClient: () => OpenAI,
  model: string,
  signal: AbortSignal | undefined,
  options: RunAgentEngineOptions = {},
): Promise<RobotEditAgentResult> {
  const capabilities = options.capabilities ?? buildRobotCapabilities('en');
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const systemPrompt = options.systemPrompt ?? defaultSystemPrompt;

  const draft: RobotData = structuredClone(robot);
  let anyToolRan = false;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt(draft, capabilities) },
    { role: 'user', content: userMessage },
  ];

  const toolSchemas = buildToolSchemas(capabilities);
  const mutatingNames = new Set(capabilities.filter((c) => c.mutates).map((c) => c.name));

  for (let step = 0; step < maxSteps; step += 1) {
    if (signal?.aborted) {
      throw new DOMException('Agent aborted', 'AbortError');
    }

    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await createClient().chat.completions.create(
        {
          model,
          messages,
          tools: toolSchemas,
          tool_choice: 'auto',
          temperature: 0,
        },
        { signal },
      );
    } catch (e) {
      if (isAbortError(e) || signal?.aborted) {
        throw e;
      }
      if (isToolsUnsupportedError(e)) {
        throw new AgentToolsUnsupportedError((e as Error).message || 'endpoint rejected tool request');
      }
      throw e;
    }

    const assistantMessage = response.choices[0].message;
    messages.push(assistantMessage);

    const toolCalls = assistantMessage.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      return {
        explanation: assistantMessage.content?.trim() ?? '',
        robot: anyToolRan ? draft : null,
      };
    }

    for (const call of toolCalls) {
      let parsedArgs: Record<string, unknown>;
      try {
        parsedArgs = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
      } catch {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: 'Invalid JSON arguments; please retry with valid arguments.',
        });
        continue;
      }
      const result = await dispatchCapability(capabilities, call.function.name, parsedArgs, draft);
      if (result.ok && result.replacement) {
        // Async rebuilders (e.g. the script sandbox) return a fresh draft.
        Object.assign(draft, result.replacement);
      }
      if (result.ok && mutatingNames.has(call.function.name)) {
        anyToolRan = true;
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: result.message });
    }
  }

  // Hit the step cap — return whatever the draft looks like now.
  return { explanation: '', robot: anyToolRan ? draft : null };
}