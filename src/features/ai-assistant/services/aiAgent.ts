/**
 * AI edit agent — a tool-calling loop that applies surgical edits to a robot
 * draft via the pure tools in `@/core/robot/agentRobotTools`.
 *
 * This supersedes the legacy "regenerate whole robot JSON" path
 * (`generateRobotFromPrompt`) for the "Modify robot" button. The model calls
 * tools to change only what the user asked, so inertia / origin / color /
 * sibling links / unrelated joints are preserved instead of being clobbered by
 * `normalizeAIRobotResponse` (which hard-coded inertia and reset origins).
 *
 * The actual loop, tool-schema generation, and dispatch live in the generic
 * `agentEngine.ts`; this module wires the engine to the robot capability
 * registry and the BYOK OpenAI client. Adding a new capability means adding an
 * entry to `capabilities/robotCapabilities.ts` — not changing anything here.
 *
 * Boundary: feature layer. Imports `openai` (external), `@/core/robot` (pure
 * tools), `@/features/ai-assistant/services/aiRuntimeEnv` (BYOK env, same
 * feature), `@/shared/i18n` and `@/types`. No app, no store, no cross-feature.
 */

import OpenAI from 'openai';
import type { Language } from '@/shared/i18n';
import type { RobotData } from '@/types';
import { buildRobotCapabilities } from '../capabilities/robotCapabilities';
import { resolveAiRuntimeEnv } from './aiRuntimeEnv';
import {
  AgentToolsUnsupportedError,
  runAgentEngine,
  type RobotEditAgentResult,
} from './agentEngine';

export { AgentToolsUnsupportedError };
export type { RobotEditAgentResult };

// -------------------------------------------------------------------------------------
// OpenAI client (with test seam, mirroring aiService.ts)
// -------------------------------------------------------------------------------------

let openAIClientFactoryForTests: (() => OpenAI) | null = null;

const createOpenAIClient = (): OpenAI => {
  if (openAIClientFactoryForTests) {
    return openAIClientFactoryForTests();
  }
  const runtime = resolveAiRuntimeEnv();
  return new OpenAI({
    apiKey: runtime.apiKey,
    baseURL: runtime.baseUrl,
    dangerouslyAllowBrowser: true,
  });
};

/** Test seam: inject a mock OpenAI client (see aiAgent.test.ts). */
export function __setAgentOpenAIClientFactoryForTests(factory: (() => OpenAI) | null): void {
  openAIClientFactoryForTests = factory;
}

// -------------------------------------------------------------------------------------
// System prompt
// -------------------------------------------------------------------------------------

function summarizeRobot(robot: RobotData): string {
  const linkIds = Object.values(robot.links).map((l) => l.id);
  const joints = Object.values(robot.joints).map(
    (j) => `${j.id} (${j.type}, ${j.parentLinkId} -> ${j.childLinkId})`,
  );
  return `links: [${linkIds.join(', ')}]\njoints: [${joints.join(', ')}]`;
}

function getAgentSystemPrompt(robot: RobotData, lang: Language): string {
  const langInstruction = lang === 'zh' ? '请用中文回复。' : 'Respond in English.';
  return [
    'You are a URDF editing agent inside URDF Studio. Edit the robot by calling the provided tools.',
    '- Only change what the user asked. Preserve every other field (inertia, origin, color, sibling links, unrelated joints).',
    '- Geometry dimensions are Vector3 {x,y,z}: cylinder/sphere use x=radius, cylinder y=length; box uses x/y/z as size.',
    '- Use get_link / get_joint to inspect exact current values before editing (e.g. to preserve an unspecified field like length when only radius should change).',
    '- Call validate_robot after edits to confirm the result is a valid URDF tree before finishing.',
    '- Call tools to make edits. Do NOT output URDF or code snippets.',
    '- When all edits are done, reply with ONE short sentence summarizing what you changed.',
    '- If the request is impossible with the available tools, say so briefly without calling tools.',
    '',
    'Current robot:',
    summarizeRobot(robot),
    '',
    langInstruction,
  ].join('\n');
}

// -------------------------------------------------------------------------------------
// Agent entry point
// -------------------------------------------------------------------------------------

/**
 * Run the edit agent. Deep-clones `robot` as the working draft, loops the model
 * with the robot capability registry, and returns the modified draft (or null
 * if no tool was ever called). Throws `AgentToolsUnsupportedError` if the BYOK
 * endpoint rejects tool-calling, so the caller can fall back.
 */
export async function runRobotEditAgent(
  userMessage: string,
  robot: RobotData,
  lang: Language,
  signal?: AbortSignal,
): Promise<RobotEditAgentResult> {
  const runtime = resolveAiRuntimeEnv();
  if (!runtime.apiKey) {
    // No key — caller falls back to the legacy path, which has its own advice.
    throw new AgentToolsUnsupportedError('API key missing');
  }

  return runAgentEngine(
    userMessage,
    robot,
    createOpenAIClient,
    runtime.model,
    signal,
    {
      capabilities: buildRobotCapabilities(lang),
      systemPrompt: (draft) => getAgentSystemPrompt(draft, lang),
    },
  );
}
