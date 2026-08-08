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
  /** Called for each tool call with a human-readable step description. */
  onToolCall?: (step: string) => void;
}

const DEFAULT_MAX_STEPS = 10;

const isAbortError = (e: unknown): boolean =>
  e instanceof Error && (e.name === 'AbortError' || e.name === 'APIUserAbortError');

const isToolsUnsupportedError = (e: unknown): boolean => {
  const err = e as { status?: number; message?: string; error?: { error?: { message?: string } } };
  const msg = (err.message || err.error?.error?.message || '').toLowerCase();
  if (msg.includes('tool') || msg.includes('function call') || msg.includes('does not support')) {
    return true;
  }
  if (err.status === 404) {
    return true;
  }
  return false;
};

const CHANGE_CLAIM_PATTERNS = [
  /\b(changed|updated|modified|set|applied|已(将|经)|修改|更新|设置|应用|改为)\b/i,
];

function looksLikeChangeClaim(text: string): boolean {
  return CHANGE_CLAIM_PATTERNS.some((pattern) => pattern.test(text));
}

function formatPreToolCallStep(name: string, args: Record<string, unknown>): string {
  const label = name.replace(/_/g, ' ');
  const detail = summarizeToolArgs(args);
  return detail ? `${label}: ${detail}` : label;
}

function summarizeToolArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  const linkId = args.linkId as string | undefined;
  const jointId = args.jointId as string | undefined;
  const path = args.path as string | undefined;
  const value = args.value;
  const type = args.geometryType as string | undefined;
  const radius = args.radius as number | undefined;
  const dims = args.dimensions as number[] | undefined;
  const code = args.code as string | undefined;
  const lower = args.lower as number | undefined;
  const upper = args.upper as number | undefined;

  if (linkId) parts.push(linkId);
  if (jointId) parts.push(jointId);
  if (path) {
    parts.push(path);
    if (value !== undefined) {
      parts.push('= ' + (typeof value === 'string' ? value : JSON.stringify(value)));
    }
  } else if (value !== undefined && !linkId && !jointId) {
    parts.push(JSON.stringify(value));
  }
  if (type) parts.push(type);
  if (radius !== undefined) parts.push(`r=${radius}`);
  if (dims) parts.push(dims.join('×'));
  if (lower !== undefined || upper !== undefined) {
    const limits = [];
    if (lower !== undefined) limits.push(`lo=${lower}`);
    if (upper !== undefined) limits.push(`hi=${upper}`);
    parts.push(limits.join(' '));
  }
  if (code) {
    const preview = code.replace(/\n/g, ' ').slice(0, 60);
    parts.push(preview + (code.length > 60 ? '...' : ''));
  }
  return parts.join(' · ');
}

function formatToolCallStep(name: string, ok: boolean, message: string): string {
  if (!ok) {
    return `  ✗ ${message}`;
  }
  const clean = message.length > 100 ? message.slice(0, 97) + '...' : message;
  return `  → ${clean}`;
}

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

    const reasoning = assistantMessage.content?.trim();
    if (reasoning && options.onToolCall) {
      options.onToolCall(`📝 ${reasoning}`);
      await new Promise<void>((r) => setTimeout(r, 0));
    }

    const toolCalls = assistantMessage.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      const explanation = assistantMessage.content?.trim() ?? '';
      if (!anyToolRan && looksLikeChangeClaim(explanation)) {
        return {
          explanation: `The model claimed a change was made but no tool was actually called. The robot was NOT modified. Please try again with a more specific request. Original response: "${explanation}"`,
          robot: null,
        };
      }
      return {
        explanation,
        robot: anyToolRan ? draft : null,
      };
    }

    for (let ti = 0; ti < toolCalls.length; ti += 1) {
      const call = toolCalls[ti];
      const stepNum = toolCalls.length > 1 ? `[${ti + 1}/${toolCalls.length}] ` : '';
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
      if (options.onToolCall) {
        options.onToolCall(stepNum + formatPreToolCallStep(call.function.name, parsedArgs));
        await new Promise<void>((r) => setTimeout(r, 0));
      }
      const result = await dispatchCapability(capabilities, call.function.name, parsedArgs, draft);
      if (result.ok && result.replacement) {
        // Async rebuilders (e.g. the script sandbox) return a fresh draft.
        Object.assign(draft, result.replacement);
      }
      if (result.ok && mutatingNames.has(call.function.name)) {
        anyToolRan = true;
      }
      if (options.onToolCall) {
        options.onToolCall(formatToolCallStep(call.function.name, result.ok, result.message));
        await new Promise<void>((r) => setTimeout(r, 0));
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: result.message });
    }
  }

  // Hit the step cap — return whatever the draft looks like now.
  return { explanation: '', robot: anyToolRan ? draft : null };
}