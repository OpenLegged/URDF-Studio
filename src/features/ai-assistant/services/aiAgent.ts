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
import {
  buildCompactRobotCapabilities,
  validateRobotDraft,
} from '../capabilities/robotCapabilities';
import type { AgentCapability } from '../capabilities/types';
import { buildAiThinkingRequestOptions, resolveAiRuntimeEnv } from './aiRuntimeEnv';
import {
  AgentToolsUnsupportedError,
  runAgentEngine,
  type AgentConversationTurn,
  type RobotEditAgentResult,
} from './agentEngine';
import type { AgentRunEvent } from '../agentRuntimeTypes';
import {
  clipAgentTextToTokens,
  estimateAgentTextTokens,
} from './contextCompaction';
import {
  buildAppliedRobotVerificationMessages,
  parseCompletionVerificationVerdict,
  type CompletionVerificationVerdict,
} from './completionVerification';

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

export async function verifyAppliedRobotTask(
  userMessage: string,
  liveRobot: RobotData,
  lang: Language,
  options: { signal?: AbortSignal } = {},
): Promise<CompletionVerificationVerdict> {
  const structuralValidation = validateRobotDraft(liveRobot);
  if (!structuralValidation.ok) {
    return {
      ok: false,
      message: structuralValidation.message,
      checks: [{
        requirement: 'The applied robot remains structurally valid.',
        status: 'fail',
        evidence: [2],
      }],
    };
  }

  const runtime = resolveAiRuntimeEnv();
  if (!runtime.apiKey) {
    return {
      ok: false,
      message: 'Post-apply verification is unavailable because no AI API key is configured.',
      checks: [{
        requirement: 'Verify the applied result against the original request.',
        status: 'unknown',
        evidence: [],
      }],
    };
  }

  const thinking = buildAiThinkingRequestOptions(runtime, 'low');
  const request = {
    model: runtime.model,
    messages: buildAppliedRobotVerificationMessages({
      userRequest: userMessage,
      liveRobot,
      structuralValidation: structuralValidation.message,
      lang,
      tokenEstimator: estimateAgentTextTokens,
    }),
    max_tokens: 1280,
    ...(thinking.thinking?.type === 'enabled' ? {} : { temperature: 0 }),
    ...thinking,
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
  const response = await createOpenAIClient().chat.completions.create(
    request,
    { signal: options.signal },
  );
  const content = response.choices[0]?.message?.content;
  const verdict = typeof content === 'string'
    ? parseCompletionVerificationVerdict(content, 2, new Set([1, 2]))
    : null;
  return verdict ?? {
    ok: false,
    message: 'The post-apply verifier returned no valid verdict.',
    checks: [{
      requirement: 'Verify the applied result against the original request.',
      status: 'unknown',
      evidence: [],
    }],
  };
}

// -------------------------------------------------------------------------------------
// System prompt
// -------------------------------------------------------------------------------------

const MAX_PROMPT_ENTITY_ITEMS = 40;
const MAX_TASK_CONTEXT_TOKENS = 2_048;

function formatBoundedItems(items: string[]): string {
  const visible = items.slice(0, MAX_PROMPT_ENTITY_ITEMS);
  const omitted = items.length - visible.length;
  return omitted > 0
    ? `${visible.join(', ')}, … ${omitted} more (use read_path for exact data)`
    : visible.join(', ');
}

function summarizeRobot(robot: RobotData): string {
  const linkIds = Object.values(robot.links).map((l) => l.id);
  const joints = Object.values(robot.joints).map(
    (j) => `${j.id} (${j.type}, ${j.parentLinkId} -> ${j.childLinkId})`,
  );
  return `links (${linkIds.length}): [${formatBoundedItems(linkIds)}]\n`
    + `joints (${joints.length}): [${formatBoundedItems(joints)}]`;
}

function getAgentSystemPrompt(
  robot: RobotData,
  lang: Language,
  context: string | undefined,
  capabilities: AgentCapability[],
): string {
  const langInstruction = lang === 'zh' ? '请用中文回复。' : 'Respond in English.';
  const canControlStudio = capabilities.some(capability => capability.effect === 'app-command');
  const promptSections = [
    'You are an agent operating inside URDF Studio. Use tools for every robot edit or app action; never claim an action happened unless its tool succeeded.',
    '',
    'TASK ROUTING:',
    '- Robot/model/URDF construction and property edits operate on the live RobotData draft. Use read_path, write_path, and run_script directly.',
    '- The generated source editor and page DOM are views of the model, not the editing API. Never inspect or operate UI elements to discover or perform a robot edit.',
    '- Saying "in this webpage" or "in URDF Studio" does not make a robot construction request a UI task.',
    '- Never mutate the draft as an experiment or probe. Read exact draft values, make the intended edit once, then verify and validate it.',
    '',
    'HOW TO EXPLORE THE ROBOT:',
    '- Use read_path for exact values. Root fields such as name/rootLinkId are valid paths; reading links.base_link returns the full link.',
    '',
    'HOW TO MAKE CHANGES (like Codex — write code to edit the robot):',
    '- run_script is the PRIMARY tool. You can write arbitrary JavaScript that receives the full robot draft and returns the modified draft.',
    '- For simple single-field changes, use write_path: write_path path="links.base_link.visual.color" value="#ff0000".',
    '- Colors are hex strings: #ff0000=red, #00ff00=green, #0000ff=blue, #ffffff=white.',
    '- For bulk edits across many links, ALWAYS use run_script with a loop.',
    '',
    'WORKFLOW:',
    '- Before each tool batch, put at most one short user-facing sentence in assistant content describing the immediate intent. Do not reveal private chain-of-thought.',
    '1. Plan: for multi-step work, call update_plan before editing and update it as work completes.',
    '2. Explore: read_path to see current values.',
    '3. Edit: write_path for focused fields or run_script for topology and bulk changes.',
    '4. Verify: read_path the SAME fields you changed to confirm the new values are correct.',
    '5. Validate: validate_robot to confirm the result is structurally valid.',
    '6. Completion gate: the harness accepts completion only after fresh observable evidence; if its verifier finds a gap, continue fixing and re-checking.',
    '',
    'CRITICAL RULES:',
    '1. You CANNOT change the robot by just saying you changed it. You MUST call at least one mutating tool.',
    '2. ALWAYS explore first with read_path before writing.',
    '3. ALWAYS verify after: read back the fields you changed to confirm they match what you intended.',
    '4. Only change what the user asked. Preserve every other field.',
    '5. Call validate_robot after edits to confirm the result is valid.',
    '6. Do NOT output URDF or code snippets. Tools are the ONLY way to edit.',
    '7. When all edits are done, reply with ONE short sentence summarizing what you changed.',
    '8. If the request is truly impossible with the available tools, say so briefly WITHOUT claiming you made a change.',
  ];

  if (canControlStudio) {
    promptSections.push(
      '',
      'URDF STUDIO APP CONTROL:',
      '- studio is a general UI command executor, not a robot-data editor. Keep it available for any UI portion of the request.',
      '- For related UI changes, emit multiple studio tool calls in the same response; the harness executes that tool batch in order without another model round.',
      '- Use studio action=inspect before acting when the live target or UI state is ambiguous.',
      '- For controls without a semantic command, use action=interact with an accessible query directly. Use elements only to resolve ambiguity or read visible status/errors.',
      '- studio actions select/focus/view/panels act immediately on the browser UI and do not create a robot modification card.',
      '- studio action=workflow only opens inspection setup or export. The user controls running checks and downloading.',
      '- The robot editing draft is fixed to the component named in the task context for this turn. Selecting another component does NOT retarget the draft; use a later user turn before editing it.',
      '- Do not use robot mutation tools for a request that only asks to navigate or configure the Studio UI.',
      '- Use studio only for the explicit UI portion of the current request. Never use studio elements/interact to edit robot structure, geometry, joints, or properties.',
    );
  }

  promptSections.push('', 'Current robot editing draft:', summarizeRobot(robot));

  if (context?.trim()) {
    promptSections.push(
      '',
      'Conversation task context (read-only). The live draft returned by tools is authoritative:',
      clipAgentTextToTokens(context.trim(), MAX_TASK_CONTEXT_TOKENS),
    );
  }

  promptSections.push('', langInstruction);
  return promptSections.join('\n');
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
  options: {
    signal?: AbortSignal;
    onToolCall?: (step: string) => void;
    history?: AgentConversationTurn[];
    context?: string;
    onEvent?: (event: AgentRunEvent) => void;
    additionalCapabilities?: AgentCapability[];
    /** Keep false for confirmation-card proposals; verify the committed live robot after Apply. */
    verifyCompletion?: boolean;
  } = {},
): Promise<RobotEditAgentResult> {
  const runtime = resolveAiRuntimeEnv();
  if (!runtime.apiKey) {
    // No key — caller falls back to the legacy path, which has its own advice.
    throw new AgentToolsUnsupportedError('API key missing');
  }

  const capabilities = [
    ...buildCompactRobotCapabilities(lang),
    ...(options.additionalCapabilities ?? []),
  ];

  return runAgentEngine({
    userMessage,
    robot,
    createClient: createOpenAIClient,
    model: runtime.model,
    signal: options.signal,
    options: {
      capabilities,
      contextBudget: { contextWindowTokens: runtime.contextWindowTokens },
      thinking: buildAiThinkingRequestOptions(runtime),
      verifyCompletion: options.verifyCompletion ?? true,
      verificationContext: options.context,
      systemPrompt: (draft, activeCapabilities) =>
        getAgentSystemPrompt(draft, lang, options.context, activeCapabilities),
      history: options.history,
      onEvent: options.onEvent,
      onToolCall: options.onToolCall,
    },
  });
}
