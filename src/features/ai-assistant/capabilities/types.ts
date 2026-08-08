/**
 * Agent capability registry types.
 *
 * A capability is a self-contained description of ONE thing the AI edit agent
 * can do to a robot draft. It bundles the OpenAI tool schema (given to the
 * model), the actual mutation/read logic, and whether it counts as an edit.
 *
 * The agent loop (`agentEngine.ts`) is generic: it auto-builds the tool list
 * the model sees and dispatches tool calls by name against this registry. Adding
 * a new capability = add one entry to `robotCapabilities.ts` — the engine, the
 * diff/validate flow, and the undo path are untouched.
 *
 * Boundary: feature layer. Imports `@/types` (RobotData) and `@/core/robot`
 * (pure edit tools). No app, no store.
 */

import type { RobotData } from '@/types';

/** Tool outcome surfaced back to the model as the `tool` role message content. */
export interface AgentToolResult {
  ok: boolean;
  message: string;
  /** When set, replaces the agent's working draft (used by async rebuilders). */
  replacement?: RobotData;
}

/**
 * A single agent capability. `execute` mutates (or reads) the agent-owned deep
 * clone of the robot draft in place and returns a short result message the model
 * sees (and, for async capabilities like the script sandbox, the replacement
 * draft). `mutates` marks whether a successful call counts as "an edit happened"
 * — only mutating capabilities produce a diff card; read/validate-only runs
 * resolve to `robot: null`.
 */
export interface AgentCapability {
  readonly name: string;
  /** Model-facing description of what the tool does and when to call it. */
  readonly description: string;
  /** OpenAI JSON-schema `parameters` object (see `TOOL_SCHEMAS` shape). */
  readonly parameters: Record<string, unknown>;
  /**
   * Apply (or inspect) against the draft. Must not throw for bad input. May be
   * async; a returned `AgentToolResult` with a `replacement` draft replaces the
   * working draft (used by capabilities that rebuild it, e.g. the sandbox).
   */
  execute: (
    draft: RobotData,
    args: Record<string, unknown>,
  ) => AgentToolResult | Promise<AgentToolResult>;
  /** true ⇒ a successful call marks the draft as edited. */
  readonly mutates: boolean;
}