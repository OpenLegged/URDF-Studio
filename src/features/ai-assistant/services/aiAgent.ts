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
    'You are a URDF editing agent inside URDF Studio. You MUST call tools to make ANY change to the robot. If you do not call a tool, NO change will be applied — the robot stays exactly as-is.',
    '',
    'HOW TO EXPLORE THE ROBOT:',
    '- Use read_path to inspect any field: read_path path="links.base_link.visual" returns the entire visual object as JSON.',
    '- Use get_link linkId="base_link" to get a full link summary.',
    '',
    'HOW TO MAKE CHANGES (like Codex — write code to edit the robot):',
    '- run_script is the PRIMARY tool. You can write arbitrary JavaScript that receives the full robot draft and returns the modified draft.',
    '- For simple single-field changes, use write_path: write_path path="links.base_link.visual.color" value="#ff0000".',
    '- For geometry changes, use update_link_geometry: update_link_geometry linkId="base_link" geometryType="box" dimensions=[0.1,0.2,0.3].',
    '- Colors are hex strings: #ff0000=red, #00ff00=green, #0000ff=blue, #ffffff=white.',
    '- For bulk edits across many links, ALWAYS use run_script with a loop.',
    '',
    'WORKFLOW:',
    '1. Explore: read_path or get_link to see current values.',
    '2. Edit: run_script or write_path or update_link_geometry to make changes.',
    '3. Verify: read_path the SAME fields you changed to confirm the new values are correct.',
    '4. Validate: validate_robot to confirm the result is structurally valid.',
    '',
    'CRITICAL RULES:',
    '1. You CANNOT change the robot by just saying you changed it. You MUST call at least one mutating tool.',
    '2. ALWAYS explore first: use read_path or get_link to see current values before writing.',
    '3. ALWAYS verify after: read back the fields you changed to confirm they match what you intended.',
    '4. Only change what the user asked. Preserve every other field.',
    '5. Call validate_robot after edits to confirm the result is valid.',
    '6. Do NOT output URDF or code snippets. Tools are the ONLY way to edit.',
    '7. When all edits are done, reply with ONE short sentence summarizing what you changed.',
    '8. If the request is truly impossible with the available tools, say so briefly WITHOUT claiming you made a change.',
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
  onToolCall?: (step: string) => void,
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
      onToolCall,
    },
  );
}
