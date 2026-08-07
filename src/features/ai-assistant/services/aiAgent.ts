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
 * Boundary: feature layer. Imports `openai` (external), `@/core/robot` (pure
 * tools), `@/features/ai-assistant/services/aiRuntimeEnv` (BYOK env, same
 * feature), `@/shared/i18n` and `@/types`. No app, no store, no cross-feature.
 */

import OpenAI from 'openai';
import type { Language } from '@/shared/i18n';
import type { RobotData } from '@/types';
import { canGenerateUrdf } from '@/core/parsers/urdf/urdfExportSupport';
import { generateURDF, parseURDF } from '@/core/parsers';
import {
  addLinkJoint,
  deleteLink,
  getJoint,
  getLink,
  updateJoint,
  updateJointLimit,
  updateLinkGeometry,
  updateLinkInertial,
  updateLinkOrigin,
  type AgentToolResult,
} from '@/core/robot/agentRobotTools';
import { resolveAiRuntimeEnv } from './aiRuntimeEnv';

const MAX_AGENT_STEPS = 10;

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

// -------------------------------------------------------------------------------------
// OpenAI tool schemas + dispatch
//
// The schemas mirror the arg interfaces in `agentRobotTools.ts` (camelCase field
// names) so the model's JSON arguments can be cast directly to the TS arg type.
// Dispatch is the single adapter that crosses the external JSON boundary; the
// `as unknown as <Args>` cast is intentional and contained here (per the
// project's boundary rules for external/JSON boundaries).
// -------------------------------------------------------------------------------------

type ToolName =
  | 'update_link_geometry'
  | 'update_link_inertial'
  | 'update_link_origin'
  | 'add_link_joint'
  | 'delete_link'
  | 'update_joint'
  | 'update_joint_limit'
  | 'get_link'
  | 'get_joint'
  | 'validate_robot';

/**
 * Tools that mutate the robot draft. Read/validate tools (`get_link`, `get_joint`,
 * `validate_robot`) are excluded so an agent that only inspects without editing
 * returns `robot: null` (no spurious empty diff card).
 */
const MUTATING_TOOLS = new Set<ToolName>([
  'update_link_geometry',
  'update_link_inertial',
  'update_link_origin',
  'add_link_joint',
  'delete_link',
  'update_joint',
  'update_joint_limit',
]);

const TOOL_SCHEMAS: Array<{
  type: 'function';
  function: { name: ToolName; description: string; parameters: Record<string, unknown> };
}> = [
  {
    type: 'function',
    function: {
      name: 'update_link_geometry',
      description:
        "Update a link's visual AND collision geometry. Cylinder: radius (and optionally length); sphere: radius; box: dimensions [x,y,z]. Unspecified values are preserved, so 'change only the radius' keeps the current length.",
      parameters: {
        type: 'object',
        properties: {
          linkId: { type: 'string' },
          geometryType: { type: 'string', enum: ['cylinder', 'box', 'sphere'] },
          radius: { type: 'number' },
          length: { type: 'number' },
          dimensions: { type: 'array', items: { type: 'number' }, description: 'box size [x, y, z]' },
        },
        required: ['linkId', 'geometryType'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_link_inertial',
      description: "Patch a link's inertial (mass, origin, inertia tensor). Unspecified fields are preserved.",
      parameters: {
        type: 'object',
        properties: {
          linkId: { type: 'string' },
          mass: { type: 'number' },
          originXyz: { type: 'array', items: { type: 'number' }, description: '[x, y, z]' },
          originRpy: { type: 'array', items: { type: 'number' }, description: '[r, p, y]' },
          inertia: {
            type: 'object',
            properties: {
              ixx: { type: 'number' },
              ixy: { type: 'number' },
              ixz: { type: 'number' },
              iyy: { type: 'number' },
              iyz: { type: 'number' },
              izz: { type: 'number' },
            },
          },
        },
        required: ['linkId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_link_origin',
      description: "Patch a link's visual, collision, or inertial origin. Unspecified xyz/rpy are preserved.",
      parameters: {
        type: 'object',
        properties: {
          linkId: { type: 'string' },
          target: { type: 'string', enum: ['visual', 'collision', 'inertial'] },
          xyz: { type: 'array', items: { type: 'number' } },
          rpy: { type: 'array', items: { type: 'number' } },
        },
        required: ['linkId', 'target'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_link_joint',
      description: 'Add a new child link plus the joint connecting it to an existing parent link.',
      parameters: {
        type: 'object',
        properties: {
          linkId: { type: 'string', description: 'desired link id; a unique id is generated if omitted or already taken' },
          linkName: { type: 'string' },
          parentLinkId: { type: 'string' },
          jointName: { type: 'string' },
          jointType: { type: 'string', enum: ['fixed', 'revolute', 'continuous', 'prismatic'] },
          originXyz: { type: 'array', items: { type: 'number' } },
          originRpy: { type: 'array', items: { type: 'number' } },
          axis: { type: 'array', items: { type: 'number' } },
        },
        required: ['parentLinkId', 'jointType'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_link',
      description: 'Delete a leaf link (no children) and its connecting joint. Refuses non-leaf or root links.',
      parameters: {
        type: 'object',
        properties: { linkId: { type: 'string' } },
        required: ['linkId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_joint',
      description: "Patch a joint's type, origin, and/or axis. Unspecified fields are preserved.",
      parameters: {
        type: 'object',
        properties: {
          jointId: { type: 'string' },
          type: { type: 'string', enum: ['fixed', 'revolute', 'continuous', 'prismatic'] },
          originXyz: { type: 'array', items: { type: 'number' } },
          originRpy: { type: 'array', items: { type: 'number' } },
          axis: { type: 'array', items: { type: 'number' } },
        },
        required: ['jointId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_joint_limit',
      description: "Patch a joint's limits (lower, upper, effort, velocity). Unspecified fields are preserved.",
      parameters: {
        type: 'object',
        properties: {
          jointId: { type: 'string' },
          lower: { type: 'number' },
          upper: { type: 'number' },
          effort: { type: 'number' },
          velocity: { type: 'number' },
        },
        required: ['jointId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_link',
      description: "Read a link's current geometry, origin, and inertial values as JSON. Use before editing to get exact current values (e.g. to preserve an unspecified field). Does not modify the robot.",
      parameters: {
        type: 'object',
        properties: { linkId: { type: 'string' } },
        required: ['linkId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_joint',
      description: "Read a joint's current type, origin, axis, limit, dynamics, and hardware as JSON. Use before editing to inspect exact current values. Does not modify the robot.",
      parameters: {
        type: 'object',
        properties: { jointId: { type: 'string' } },
        required: ['jointId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'validate_robot',
      description: 'Validate the current draft: checks it can be exported to URDF and re-parsed. Call after edits to confirm the result is a valid URDF tree before finishing. Does not modify the robot.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

/** Validate the draft can round-trip through URDF (generate → parse). Feature-level because it depends on `@/core/parsers`, which reverse-imports `@/core/robot` (a cycle if placed in core). */
function validateRobot(draft: RobotData): AgentToolResult {
  if (!canGenerateUrdf(draft)) {
    return { ok: false, message: 'Cannot export to URDF: unsupported joint type or structure.' };
  }
  let urdf: string;
  try {
    urdf = generateURDF({ ...draft, selection: { type: null, id: null } }, { preserveMeshPaths: true });
  } catch (e) {
    return { ok: false, message: `URDF generation failed: ${(e as Error).message}` };
  }
  if (!parseURDF(urdf)) {
    return { ok: false, message: 'Generated URDF failed to re-parse; the draft is not a valid robot.' };
  }
  return {
    ok: true,
    message: `Robot valid: ${Object.keys(draft.links).length} links, ${Object.keys(draft.joints).length} joints, root=${draft.rootLinkId}.`,
  };
}

function dispatchTool(name: string, args: Record<string, unknown>, draft: RobotData): AgentToolResult {
  // External JSON boundary: the model's arguments are cast to the typed arg
  // shape. The pure tool functions validate semantic preconditions (link/joint
  // existence, leaf checks) and report failure via `ok:false`.
  switch (name) {
    case 'update_link_geometry':
      return updateLinkGeometry(draft, args as unknown as Parameters<typeof updateLinkGeometry>[1]);
    case 'update_link_inertial':
      return updateLinkInertial(draft, args as unknown as Parameters<typeof updateLinkInertial>[1]);
    case 'update_link_origin':
      return updateLinkOrigin(draft, args as unknown as Parameters<typeof updateLinkOrigin>[1]);
    case 'add_link_joint':
      return addLinkJoint(draft, args as unknown as Parameters<typeof addLinkJoint>[1]);
    case 'delete_link':
      return deleteLink(draft, args as unknown as Parameters<typeof deleteLink>[1]);
    case 'update_joint':
      return updateJoint(draft, args as unknown as Parameters<typeof updateJoint>[1]);
    case 'update_joint_limit':
      return updateJointLimit(draft, args as unknown as Parameters<typeof updateJointLimit>[1]);
    case 'get_link':
      return getLink(draft, args as unknown as Parameters<typeof getLink>[1]);
    case 'get_joint':
      return getJoint(draft, args as unknown as Parameters<typeof getJoint>[1]);
    case 'validate_robot':
      return validateRobot(draft);
    default:
      return { ok: false, message: `Unknown tool "${name}".` };
  }
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
  const langInstruction =
    lang === 'zh' ? '请用中文回复。' : 'Respond in English.';
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
}

/** Test seam: inject a mock OpenAI client (see aiAgent.test.ts). */
export function __setAgentOpenAIClientFactoryForTests(factory: (() => OpenAI) | null): void {
  openAIClientFactoryForTests = factory;
}

// -------------------------------------------------------------------------------------
// Error classification
// -------------------------------------------------------------------------------------

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

// -------------------------------------------------------------------------------------
// Agent loop
// -------------------------------------------------------------------------------------

/**
 * Run the edit agent. Deep-clones `robot` as the working draft, loops the model
 * with tools until it stops calling them, and returns the modified draft (or
 * null if no tool was ever called). Throws `AgentToolsUnsupportedError` if the
 * BYOK endpoint rejects tool-calling, so the caller can fall back.
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

  const draft: RobotData = structuredClone(robot);
  let anyToolRan = false;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: getAgentSystemPrompt(draft, lang) },
    { role: 'user', content: userMessage },
  ];

  const model = runtime.model;
  for (let step = 0; step < MAX_AGENT_STEPS; step += 1) {
    if (signal?.aborted) {
      throw new DOMException('Agent aborted', 'AbortError');
    }

    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await createOpenAIClient().chat.completions.create(
        {
          model,
          messages,
          tools: TOOL_SCHEMAS,
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
      const toolName = call.function.name;
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
      const result = dispatchTool(toolName, parsedArgs, draft);
      if (result.ok && MUTATING_TOOLS.has(toolName as ToolName)) {
        anyToolRan = true;
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: result.message });
    }
  }

  // Hit the step cap — return whatever the draft looks like now.
  return { explanation: '', robot: anyToolRan ? draft : null };
}
