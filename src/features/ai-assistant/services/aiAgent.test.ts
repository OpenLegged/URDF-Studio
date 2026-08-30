import test from 'node:test';
import assert from 'node:assert/strict';
import type OpenAI from 'openai';
import { JSDOM } from 'jsdom';

// validate_robot calls parseURDF, which needs a DOMParser (native in the browser,
// polyfilled via jsdom in Node). Mirrors the pattern in core/parsers *.test.ts.
globalThis.DOMParser = new JSDOM().window.DOMParser as typeof DOMParser;

import { createLink, createSourceSemanticRobotHash } from '@/core/robot';
import { generateURDF, parseURDF } from '@/core/parsers';
import { updateLinkInertial } from '@/core/robot/agentRobotTools';
import type { RobotData } from '@/types';
import {
  AgentToolsUnsupportedError,
  __setAgentOpenAIClientFactoryForTests,
  runRobotEditAgent,
  verifyAppliedRobotTask,
} from './aiAgent.ts';
import { buildAgentConversationMessages, runAgentEngine } from './agentEngine.ts';
import type { AgentRunEvent } from '../agentRuntimeTypes.ts';
import { buildStudioAppCapabilities } from '../capabilities/studioAppCapabilities.ts';
import type { AgentCapability } from '../capabilities/types.ts';
import type { StudioAgentPorts } from '../studioAppControl.ts';

/** Minimal scripted mock OpenAI client — returns one canned response per call. */
function scriptedClient(responses: Array<{
  toolCalls?: unknown[];
  content?: string;
  reasoningContent?: string;
}>): {
  chat: { completions: { create: (...args: unknown[]) => Promise<unknown> } };
} {
  let index = 0;
  return {
    chat: {
      completions: {
        create: async () => {
          const r = responses[index];
          index += 1;
          return {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: r.content ?? null,
                  tool_calls: r.toolCalls,
                  ...(r.reasoningContent === undefined
                    ? {}
                    : { reasoning_content: r.reasoningContent }),
                },
                finish_reason: r.toolCalls ? 'tool_calls' : 'stop',
              },
            ],
          };
        },
      },
    },
  };
}

const completionPass = (message = 'All requested outcomes have current tool evidence.') => ({
  content: JSON.stringify({
    ok: true,
    checks: [{
      requirement: 'All explicit requested outcomes are complete.',
      status: 'pass',
      evidence: [2, 3],
    }],
    message,
  }),
});

function buildRobot(): RobotData {
  const base = createLink({ id: 'base_link', name: 'base_link' });
  return { name: 'robot', rootLinkId: 'base_link', links: { base_link: base }, joints: {} };
}

const withKey = <T>(fn: () => Promise<T>): Promise<T> => {
  const previous = process.env.API_KEY;
  process.env.API_KEY = 'test-key';
  return fn().finally(() => {
    if (previous === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = previous;
    }
  });
};

const installClient = (client: unknown): void => {
  __setAgentOpenAIClientFactoryForTests(() => client as unknown as OpenAI);
};

test('buildAgentConversationMessages keeps valid history for token-aware compaction', () => {
  const history = Array.from({ length: 14 }, (_, index) => ({
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: ` turn ${index} `,
  }));
  history.splice(8, 0, { role: 'assistant', content: '   ' });

  const messages = buildAgentConversationMessages('system', history, ' current request ');

  assert.equal(messages.length, 16, 'system + all valid turns + current user request');
  assert.deepEqual(messages[0], { role: 'system', content: 'system' });
  assert.deepEqual(messages[1], { role: 'user', content: 'turn 0' });
  assert.deepEqual(messages.at(-1), { role: 'user', content: 'current request' });
});

test('main agent enables provider thinking and preserves reasoning across tool calls', async () => {
  const requests: Array<Record<string, unknown>> = [];
  let responseIndex = 0;
  const responses = [
    {
      choices: [{
        message: {
          role: 'assistant',
          content: 'I will inspect the current robot first.',
          reasoning_content: 'PRIVATE_REASONING_SENTINEL',
          tool_calls: [{
            id: 'read-1',
            type: 'function',
            function: { name: 'read_robot', arguments: '{}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    },
    {
      choices: [{
        message: {
          role: 'assistant',
          content: 'The robot was inspected; no change was requested.',
          tool_calls: null,
        },
        finish_reason: 'stop',
      }],
    },
  ];
  const client = {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>) => {
          requests.push(structuredClone(params));
          return responses[responseIndex++];
        },
      },
    },
  } as unknown as OpenAI;
  const capabilities: AgentCapability[] = [{
    name: 'read_robot',
    description: 'Read the robot.',
    parameters: { type: 'object', properties: {} },
    execute: () => ({ ok: true, message: 'Read.' }),
    mutates: false,
  }];

  const result = await runAgentEngine({
    userMessage: 'inspect it',
    robot: buildRobot(),
    createClient: () => client,
    model: 'deepseek-v4-pro',
    options: {
      capabilities,
      thinking: {
        thinking: { type: 'enabled' },
        reasoning_effort: 'high',
      },
    },
  });

  assert.deepEqual(requests[0]?.thinking, { type: 'enabled' });
  assert.equal(requests[0]?.reasoning_effort, 'high');
  assert.equal('temperature' in (requests[0] ?? {}), false);
  const secondMessages = requests[1]?.messages as Array<Record<string, unknown>>;
  const reasoningMessage = secondMessages.find(message => (
    message.role === 'assistant' && message.reasoning_content === 'PRIVATE_REASONING_SENTINEL'
  ));
  assert.ok(reasoningMessage, 'reasoning_content must be sent back during the same tool turn');
  assert.equal(
    result.events.some(event => (
      event.type === 'assistant.reasoning' && event.content.includes('PRIVATE_REASONING_SENTINEL')
    )),
    false,
    'private provider reasoning must not be copied into the visible/audit event stream',
  );
  assert.equal(
    result.events.some(event => (
      event.type === 'assistant.progress' && event.content === 'I will inspect the current robot first.'
    )),
    true,
  );
});

test('post-apply verification is read-only and returns an internal checklist verdict', async () => {
  const requests: Array<{ messages?: unknown; tools?: unknown }> = [];
  const client = {
    chat: {
      completions: {
        create: async (params: { messages?: unknown; tools?: unknown }) => {
          requests.push(structuredClone(params));
          return {
            choices: [{
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  ok: true,
                  checks: [
                    { requirement: 'The robot has four wheels.', status: 'pass', evidence: [1] },
                    { requirement: 'The robot is structurally valid.', status: 'pass', evidence: [2] },
                  ],
                  message: 'The applied robot satisfies the request.',
                }),
                tool_calls: null,
              },
              finish_reason: 'stop',
            }],
          };
        },
      },
    },
  };
  installClient(client);

  try {
    const verdict = await withKey(() => verifyAppliedRobotTask(
      'Keep the current one-link robot valid.',
      buildRobot(),
      'en',
    ));

    assert.equal(verdict.ok, true);
    assert.equal(verdict.checks.length, 2);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.tools, undefined, 'post-apply verification must expose no tools');
  } finally {
    __setAgentOpenAIClientFactoryForTests(null);
  }
});

test('post-apply verification rejects a structurally valid robot that misses the requested wheels', async () => {
  const client = {
    chat: {
      completions: {
        create: async () => ({
          choices: [{
            message: {
              role: 'assistant',
              content: JSON.stringify({
                ok: false,
                checks: [
                  { requirement: 'The car has four wheels.', status: 'fail', evidence: [1] },
                  { requirement: 'The robot is structurally valid.', status: 'pass', evidence: [2] },
                ],
                message: 'The applied robot has no wheel links or joints.',
              }),
              tool_calls: null,
            },
            finish_reason: 'stop',
          }],
        }),
      },
    },
  };
  installClient(client);

  try {
    const verdict = await withKey(() => verifyAppliedRobotTask(
      'Generate a small car with four wheels.',
      buildRobot(),
      'en',
    ));

    assert.equal(verdict.ok, false);
    assert.equal(verdict.checks[0]?.status, 'fail');
    assert.match(verdict.message, /no wheel links or joints/i);
  } finally {
    __setAgentOpenAIClientFactoryForTests(null);
  }
});

test('browser harness compacts history at the configured token pressure threshold', async () => {
  const requests: Array<{
    messages: Array<{ role: string; content?: unknown }>;
    tools?: unknown[];
  }> = [];
  const client = {
    chat: {
      completions: {
        create: async (params: {
          messages: Array<{ role: string; content?: unknown }>;
          tools?: unknown[];
        }) => {
          requests.push(structuredClone(params));
          if (!params.tools) {
            return {
              choices: [{
                message: { role: 'assistant', content: 'Old goals and decisions.', tool_calls: null },
                finish_reason: 'stop',
              }],
            };
          }
          return {
            choices: [{
              message: { role: 'assistant', content: 'No edit needed.', tool_calls: null },
              finish_reason: 'stop',
            }],
          };
        },
      },
    },
  };
  const events: AgentRunEvent[] = [];
  const history = Array.from({ length: 8 }, (_, index) => ({
    role: index % 2 ? ('assistant' as const) : ('user' as const),
    content: `history-${index}-${'x'.repeat(260)}`,
  }));

  const result = await runAgentEngine({
    userMessage: 'current request',
    robot: buildRobot(),
    createClient: () => client as unknown as OpenAI,
    model: 'test-model',
    options: {
      capabilities: [],
      contextBudget: {
        contextWindowTokens: 4_096,
        thresholdRatio: 0.5,
        retainRatio: 0.1,
        summaryTokenLimit: 128,
        tokenEstimator: text => text.length,
      },
      history,
      onEvent: event => events.push(event),
      systemPrompt: () => 'system',
    },
  });

  assert.equal(requests.filter(request => !request.tools).length, 1)
  const modelRequest = requests.find(request => request.tools)
  assert.ok(modelRequest)
  assert.match(String(modelRequest.messages[1]?.content), /<compacted-summary>/)
  assert.equal(
    events.some(event => event.type === 'context.compacted' && event.trigger === 'pressure'),
    true,
  )
  assert.ok(result.historyCheckpoint)
  assert.match(result.historyCheckpoint[0]?.content ?? '', /<compacted-summary>/)
});

test('browser harness compacts and retries after a provider context overflow', async () => {
  let mainRequestCount = 0
  const events: AgentRunEvent[] = []
  const client = {
    chat: {
      completions: {
        create: async (params: { tools?: unknown[] }) => {
          if (!params.tools) {
            return {
              choices: [{
                message: { role: 'assistant', content: 'Recovered context summary.', tool_calls: null },
                finish_reason: 'stop',
              }],
            }
          }
          mainRequestCount += 1
          if (mainRequestCount === 1) {
            throw { code: 'context_length_exceeded', message: 'maximum context length reached' }
          }
          return {
            choices: [{
              message: { role: 'assistant', content: 'Recovered.', tool_calls: null },
              finish_reason: 'stop',
            }],
          }
        },
      },
    },
  }

  const result = await runAgentEngine({
    userMessage: 'current request',
    robot: buildRobot(),
    createClient: () => client as unknown as OpenAI,
    model: 'test-model',
    options: {
      capabilities: [],
      contextBudget: { contextWindowTokens: 100_000 },
      history: [
        { role: 'user', content: 'old question' },
        { role: 'assistant', content: 'old answer' },
        { role: 'user', content: 'newer question' },
        { role: 'assistant', content: 'newer answer' },
      ],
      onEvent: event => events.push(event),
      systemPrompt: () => 'system',
    },
  })

  assert.equal(mainRequestCount, 2)
  assert.equal(
    events.some(event =>
      event.type === 'context.compacted' && event.trigger === 'context-overflow'),
    true,
  )
  assert.ok(result.historyCheckpoint)
});

test('browser harness can continue beyond the former ten-step limit', async () => {
  let mutationCount = 0;
  const capabilities: AgentCapability[] = [{
    name: 'advance_work',
    description: 'Advance a multi-step edit.',
    parameters: { type: 'object', properties: {} },
    execute: draft => {
      mutationCount += 1;
      draft.name = `robot-${mutationCount}`;
      return { ok: true, message: `Completed edit ${mutationCount}.` };
    },
    mutates: true,
  }];
  const toolSteps = Array.from({ length: 11 }, (_, index) => ({
    toolCalls: [{
      id: `advance_${index + 1}`,
      type: 'function',
      function: { name: 'advance_work', arguments: '{}' },
    }],
  }));
  const client = scriptedClient([
    ...toolSteps,
    { content: 'All work completed.' },
  ]) as unknown as OpenAI;

  const result = await runAgentEngine({
    userMessage: 'perform a long edit',
    robot: buildRobot(),
    createClient: () => client,
    model: 'test-model',
    options: { capabilities },
  });

  assert.equal(result.endReason, 'completed');
  assert.equal(result.robot?.name, 'robot-11');
});

test('runRobotEditAgent sends prior conversation and task context to the model', async () => {
  const capturedMessages: Array<Array<{ role: string; content?: unknown }>> = [];
  installClient({
    chat: {
      completions: {
        create: async (params: { messages: Array<{ role: string; content?: unknown }> }) => {
          capturedMessages.push(structuredClone(params.messages));
          return {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'No edit is needed.',
                  tool_calls: null,
                },
                finish_reason: 'stop',
              },
            ],
          };
        },
      },
    },
  });

  await withKey(async () => {
    await runRobotEditAgent('Keep the same limit.', buildRobot(), 'en', {
      history: [
        { role: 'user', content: 'Inspect base_link.' },
        { role: 'assistant', content: 'The link is valid.' },
      ],
      context: '{"focusedIssue":{"title":"Joint limit"}}',
    });
  });

  assert.equal(capturedMessages.length, 1);
  const messages = capturedMessages[0];
  assert.equal(messages[0]?.role, 'system');
  assert.match(String(messages[0]?.content), /Conversation task context/);
  assert.match(String(messages[0]?.content), /Joint limit/);
  assert.deepEqual(messages.slice(1), [
    { role: 'user', content: 'Inspect base_link.' },
    { role: 'assistant', content: 'The link is valid.' },
    { role: 'user', content: 'Keep the same limit.' },
  ]);
});

test('runRobotEditAgent exposes injected Studio app capabilities and control guidance', async () => {
  let capturedTools: Array<{ function?: { name?: string } }> = [];
  let capturedSystemPrompt = '';
  installClient({
    chat: {
      completions: {
        create: async (params: {
          messages: Array<{ role: string; content?: unknown }>;
          tools: Array<{ function?: { name?: string } }>;
        }) => {
          capturedTools = params.tools;
          capturedSystemPrompt = String(params.messages[0]?.content ?? '');
          return {
            choices: [{
              message: { role: 'assistant', content: 'No action needed.', tool_calls: null },
              finish_reason: 'stop',
            }],
          };
        },
      },
    },
  });
  const [appCapability] = buildStudioAppCapabilities({} as StudioAgentPorts, {
    editableComponentId: 'base_link',
  });
  assert.ok(appCapability);

  await withKey(() => runRobotEditAgent('inspect the app', buildRobot(), 'en', {
    additionalCapabilities: [appCapability],
  }));

  assert.deepEqual(
    capturedTools.map(tool => tool.function?.name).sort(),
    ['read_path', 'run_script', 'studio', 'update_plan', 'validate_robot', 'write_path'],
  );
  assert.ok(
    JSON.stringify(capturedTools).length < 3000,
    'The complete default tool schema must stay below the low-context budget',
  );
  assert.match(capturedSystemPrompt, /URDF STUDIO APP CONTROL/);
  assert.match(capturedSystemPrompt, /multiple studio tool calls/);
  assert.match(capturedSystemPrompt, /accessible query directly/);
});

test('runRobotEditAgent keeps the generic Studio executor without routing robot edits through it', async () => {
  let capturedTools: Array<{ function?: { name?: string } }> = [];
  let capturedSystemPrompt = '';
  installClient({
    chat: {
      completions: {
        create: async (params: {
          messages: Array<{ role: string; content?: unknown }>;
          tools: Array<{ function?: { name?: string } }>;
        }) => {
          capturedTools = params.tools;
          capturedSystemPrompt = String(params.messages[0]?.content ?? '');
          return {
            choices: [{
              message: { role: 'assistant', content: 'No action needed.', tool_calls: null },
              finish_reason: 'stop',
            }],
          };
        },
      },
    },
  });
  const [appCapability] = buildStudioAppCapabilities({} as StudioAgentPorts, {
    editableComponentId: 'base_link',
  });
  assert.ok(appCapability);

  await withKey(() => runRobotEditAgent(
    '你可以帮我在这个网页做出一辆小车吗？用基础模块搭建',
    buildRobot(),
    'zh',
    { additionalCapabilities: [appCapability] },
  ));

  assert.deepEqual(
    capturedTools.map(tool => tool.function?.name).sort(),
    ['read_path', 'run_script', 'studio', 'update_plan', 'validate_robot', 'write_path'],
  );
  assert.match(capturedSystemPrompt, /URDF STUDIO APP CONTROL/);
  assert.match(capturedSystemPrompt, /does not make a robot construction request a UI task/);
  assert.match(capturedSystemPrompt, /multiple studio tool calls/);
});

test('browser harness records a plan, tool lifecycle, and automatic validation', async () => {
  const responses = [
    {
      toolCalls: [
        {
          id: 'plan_1',
          type: 'function',
          function: {
            name: 'update_plan',
            arguments: JSON.stringify({
              plan: [
                { step: 'Inspect and edit base_link', status: 'in_progress' },
                { step: 'Validate the result', status: 'pending' },
              ],
            }),
          },
        },
      ],
    },
    {
      toolCalls: [
        {
          id: 'edit_1',
          type: 'function',
          function: {
            name: 'write_path',
            arguments: JSON.stringify({ path: 'links.base_link.visual.dimensions.x', value: 0.3 }),
          },
        },
      ],
    },
    {
      toolCalls: [
        {
          id: 'plan_2',
          type: 'function',
          function: {
            name: 'update_plan',
            arguments: JSON.stringify({
              plan: [
                { step: 'Inspect and edit base_link', status: 'completed' },
                { step: 'Validate the result', status: 'completed' },
              ],
            }),
          },
        },
      ],
    },
    {
      toolCalls: [{
        id: 'verify_read_1',
        type: 'function',
        function: {
          name: 'read_path',
          arguments: JSON.stringify({ path: 'links.base_link.visual.dimensions.x' }),
        },
      }],
    },
    { content: 'Updated and validated base_link.' },
    completionPass(),
  ];
  const events: AgentRunEvent[] = [];
  installClient(scriptedClient(responses));

  await withKey(async () => {
    const result = await runRobotEditAgent('make base_link wider', buildRobot(), 'en', {
      onEvent: event => events.push(event),
    });

    assert.equal(result.endReason, 'completed');
    assert.ok(result.robot);
    assert.equal(result.plan.every(item => item.status === 'completed'), true);
    assert.equal(events.some(event => event.type === 'plan.updated'), true);
    assert.equal(events.some(event => event.type === 'tool.started'), true);
    assert.equal(
      events.some(event => event.type === 'validation.finished' && event.automatic && event.ok),
      true,
    );
    assert.equal(
      events.some(event => event.type === 'completion.verification.finished' && event.ok),
      true,
    );
    assert.deepEqual(result.events, events);
  });
});

test('browser harness repairs a draft after automatic validation fails', async () => {
  const events: AgentRunEvent[] = [];
  const capabilities: AgentCapability[] = [
    {
      name: 'break_robot',
      description: 'Break the robot name for testing.',
      parameters: { type: 'object', properties: {} },
      execute: draft => {
        draft.name = '';
        return { ok: true, message: 'Robot name cleared.' };
      },
      mutates: true,
    },
    {
      name: 'repair_robot',
      description: 'Repair the robot name for testing.',
      parameters: { type: 'object', properties: {} },
      execute: draft => {
        draft.name = 'robot';
        return { ok: true, message: 'Robot name repaired.' };
      },
      mutates: true,
    },
    {
      name: 'validate_robot',
      description: 'Validate the robot name for testing.',
      parameters: { type: 'object', properties: {} },
      execute: draft => ({
        ok: Boolean(draft.name),
        message: draft.name ? 'Robot valid.' : 'Robot name is required.',
      }),
      mutates: false,
    },
  ];
  const client = scriptedClient([
    {
      toolCalls: [
        { id: 'break_1', type: 'function', function: { name: 'break_robot', arguments: '{}' } },
      ],
    },
    { content: 'Done.' },
    {
      toolCalls: [
        { id: 'repair_1', type: 'function', function: { name: 'repair_robot', arguments: '{}' } },
      ],
    },
    { content: 'Repaired.' },
  ]) as unknown as OpenAI;

  const result = await runAgentEngine({
    userMessage: 'test repair',
    robot: buildRobot(),
    createClient: () => client,
    model: 'test-model',
    options: { capabilities, onEvent: event => events.push(event) },
  });

  const validations = events.filter(event => event.type === 'validation.finished');
  assert.equal(result.endReason, 'completed');
  assert.equal(result.robot?.name, 'robot');
  assert.equal(validations.length, 2);
  assert.equal(validations[0]?.type === 'validation.finished' && validations[0].ok, false);
  assert.equal(validations[1]?.type === 'validation.finished' && validations[1].ok, true);
  assert.equal(
    events.some(event => event.type === 'run.status' && event.status === 'recovering'),
    true,
  );
});

test('completion gate collects fresh evidence and repairs a rejected result', async () => {
  const events: AgentRunEvent[] = [];
  const capabilities: AgentCapability[] = [
    {
      name: 'set_name',
      description: 'Set the robot name.',
      parameters: { type: 'object', properties: { value: { type: 'string' } } },
      execute: (draft, args) => {
        draft.name = String(args.value);
        return { ok: true, message: `Name set to ${draft.name}.` };
      },
      mutates: true,
    },
    {
      name: 'read_name',
      description: 'Read the robot name.',
      parameters: { type: 'object', properties: {} },
      execute: draft => ({ ok: true, message: `Current name: ${draft.name}.` }),
      mutates: false,
      effect: 'read',
      verificationScopes: ['draft'],
    },
    {
      name: 'validate_robot',
      description: 'Validate the test robot.',
      parameters: { type: 'object', properties: {} },
      execute: () => ({ ok: true, message: 'Robot valid.' }),
      mutates: false,
    },
  ];
  const client = scriptedClient([
    {
      toolCalls: [{
        id: 'wrong_edit',
        type: 'function',
        function: { name: 'set_name', arguments: '{"value":"wrong"}' },
      }],
    },
    { content: 'Set the requested name.' },
    {
      toolCalls: [{
        id: 'read_wrong',
        type: 'function',
        function: { name: 'read_name', arguments: '{}' },
      }],
    },
    { content: 'The name is correct.' },
    {
      content: JSON.stringify({
        ok: false,
        checks: [{
          requirement: 'Robot name equals target.',
          status: 'fail',
          evidence: [1],
        }],
        message: 'Expected target, observed wrong.',
      }),
    },
    {
      toolCalls: [{
        id: 'repair_edit',
        type: 'function',
        function: { name: 'set_name', arguments: '{"value":"target"}' },
      }],
    },
    { content: 'Corrected the name.' },
    {
      toolCalls: [{
        id: 'read_target',
        type: 'function',
        function: { name: 'read_name', arguments: '{}' },
      }],
    },
    { content: 'Corrected and verified the name.' },
    completionPass('Observed target after the latest edit.'),
  ]) as unknown as OpenAI;

  const result = await runAgentEngine({
    userMessage: 'Set the robot name to target.',
    robot: buildRobot(),
    createClient: () => client,
    model: 'test-model',
    options: {
      capabilities,
      verifyCompletion: true,
      onEvent: event => events.push(event),
    },
  });

  assert.equal(result.endReason, 'completed');
  assert.equal(result.robot?.name, 'target');
  const verdicts = events.filter(event => event.type === 'completion.verification.finished');
  assert.deepEqual(verdicts.map(event => event.ok), [false, true]);
  assert.deepEqual(verdicts.map(event => event.checkCount), [1, 1]);
  assert.deepEqual(verdicts.map(event => event.passedCheckCount), [0, 1]);
  assert.equal(
    events.some(event => event.type === 'run.status' && event.status === 'recovering'),
    true,
  );
});

test('completion gate requires read-back of the exact write_path target', async () => {
  const events: AgentRunEvent[] = [];
  const capabilities: AgentCapability[] = [
    {
      name: 'write_path',
      description: 'Write a test path.',
      parameters: { type: 'object', properties: {} },
      execute: (draft, args) => {
        draft.name = String(args.value);
        return { ok: true, message: `${String(args.path)} = ${draft.name}` };
      },
      mutates: true,
    },
    {
      name: 'read_path',
      description: 'Read a test path.',
      parameters: { type: 'object', properties: {} },
      execute: (draft, args) => ({
        ok: true,
        message: String(args.path) === 'name'
          ? `name = ${draft.name}`
          : `rootLinkId = ${draft.rootLinkId}`,
      }),
      mutates: false,
      effect: 'read',
      verificationScopes: ['draft'],
    },
    {
      name: 'validate_robot',
      description: 'Validate the test robot.',
      parameters: { type: 'object', properties: {} },
      execute: () => ({ ok: true, message: 'Robot valid.' }),
      mutates: false,
    },
  ];
  const client = scriptedClient([
    {
      toolCalls: [{
        id: 'write_name',
        type: 'function',
        function: { name: 'write_path', arguments: '{"path":"name","value":"target"}' },
      }],
    },
    { content: 'Done.' },
    {
      toolCalls: [{
        id: 'read_wrong_path',
        type: 'function',
        function: { name: 'read_path', arguments: '{"path":"rootLinkId"}' },
      }],
    },
    { content: 'Verified.' },
    {
      toolCalls: [{
        id: 'read_exact_path',
        type: 'function',
        function: { name: 'read_path', arguments: '{"path":"name"}' },
      }],
    },
    { content: 'Verified the exact field.' },
    completionPass('The requested name was read back after the write.'),
  ]) as unknown as OpenAI;

  const result = await runAgentEngine({
    userMessage: 'Set the robot name to target.',
    robot: buildRobot(),
    createClient: () => client,
    model: 'test-model',
    options: {
      capabilities,
      verifyCompletion: true,
      onEvent: event => events.push(event),
    },
  });

  assert.equal(result.endReason, 'completed');
  assert.equal(result.robot?.name, 'target');
  assert.equal(
    events.filter(event => event.type === 'completion.verification.finished').length,
    1,
  );
});

test('completion gate fails closed when the verifier request is unavailable', async () => {
  const events: AgentRunEvent[] = [];
  const capabilities: AgentCapability[] = [
    {
      name: 'write_path',
      description: 'Write a test path.',
      parameters: { type: 'object', properties: {} },
      execute: (draft, args) => {
        draft.name = String(args.value);
        return { ok: true, message: `${String(args.path)} = ${draft.name}` };
      },
      mutates: true,
    },
    {
      name: 'read_path',
      description: 'Read a test path.',
      parameters: { type: 'object', properties: {} },
      execute: draft => ({ ok: true, message: `name = ${draft.name}` }),
      mutates: false,
      effect: 'read',
      verificationScopes: ['draft'],
    },
    {
      name: 'validate_robot',
      description: 'Validate the test robot.',
      parameters: { type: 'object', properties: {} },
      execute: () => ({ ok: true, message: 'Robot valid.' }),
      mutates: false,
    },
  ];
  let requestIndex = 0;
  const client = {
    chat: {
      completions: {
        create: async () => {
          requestIndex += 1;
          if (requestIndex === 3) throw new Error('verifier offline');
          const message = requestIndex === 1
            ? {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'write_name',
                    type: 'function',
                    function: { name: 'write_path', arguments: '{"path":"name","value":"target"}' },
                  },
                  {
                    id: 'read_name',
                    type: 'function',
                    function: { name: 'read_path', arguments: '{"path":"name"}' },
                  },
                ],
              }
            : { role: 'assistant', content: 'Done and verified.', tool_calls: null };
          return { choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] };
        },
      },
    },
  };

  const result = await runAgentEngine({
    userMessage: 'Set the robot name to target.',
    robot: buildRobot(),
    createClient: () => client as unknown as OpenAI,
    model: 'test-model',
    options: {
      capabilities,
      verifyCompletion: true,
      onEvent: event => events.push(event),
    },
  });

  assert.equal(result.endReason, 'verification-failed');
  assert.equal(result.robot, null);
  assert.equal(
    events.some(event => event.type === 'completion.verification.finished' && !event.ok),
    true,
  );
});

test('completion gate rejects a bare ok self-report without an evidence checklist', async () => {
  const events: AgentRunEvent[] = [];
  const capabilities: AgentCapability[] = [
    {
      name: 'write_path',
      description: 'Write the robot name.',
      parameters: { type: 'object', properties: {} },
      execute: (draft, args) => {
        draft.name = String(args.value);
        return { ok: true, message: `name = ${draft.name}` };
      },
      mutates: true,
    },
    {
      name: 'read_path',
      description: 'Read the robot name.',
      parameters: { type: 'object', properties: {} },
      execute: draft => ({ ok: true, message: `name = ${draft.name}` }),
      mutates: false,
      effect: 'read',
      verificationScopes: ['draft'],
    },
    {
      name: 'validate_robot',
      description: 'Validate the test robot.',
      parameters: { type: 'object', properties: {} },
      execute: () => ({ ok: true, message: 'Robot valid.' }),
      mutates: false,
    },
  ];
  const client = scriptedClient([
    {
      toolCalls: [
        {
          id: 'write_name',
          type: 'function',
          function: { name: 'write_path', arguments: '{"path":"name","value":"target"}' },
        },
        {
          id: 'read_name',
          type: 'function',
          function: { name: 'read_path', arguments: '{"path":"name"}' },
        },
      ],
    },
    { content: 'Done.' },
    { content: '{"ok":true,"message":"Trust me, it is done."}' },
  ]) as unknown as OpenAI;

  const result = await runAgentEngine({
    userMessage: 'Set the robot name to target.',
    robot: buildRobot(),
    createClient: () => client,
    model: 'test-model',
    options: {
      capabilities,
      verifyCompletion: true,
      maxVerificationAttempts: 0,
      onEvent: event => events.push(event),
    },
  });

  assert.equal(result.endReason, 'verification-failed');
  assert.equal(result.robot, null);
  assert.equal(
    events.some(event => (
      event.type === 'completion.verification.finished'
      && !event.ok
      && event.checkCount === 1
      && event.passedCheckCount === 0
    )),
    true,
  );
});

test('browser harness never offers a partial draft after the step limit', async () => {
  const capabilities: AgentCapability[] = [
    {
      name: 'rename_robot',
      description: 'Rename the robot.',
      parameters: { type: 'object', properties: {} },
      execute: draft => {
        draft.name = 'partial';
        return { ok: true, message: 'Renamed.' };
      },
      mutates: true,
    },
  ];
  const client = scriptedClient([
    {
      toolCalls: [
        { id: 'rename_1', type: 'function', function: { name: 'rename_robot', arguments: '{}' } },
      ],
    },
  ]) as unknown as OpenAI;

  const result = await runAgentEngine({
    userMessage: 'rename it',
    robot: buildRobot(),
    createClient: () => client,
    model: 'test-model',
    options: { capabilities, maxSteps: 1 },
  });

  assert.equal(result.endReason, 'step-limit');
  assert.equal(result.robot, null);
  assert.match(result.explanation, /no partial edit/i);
});

test('browser harness completes a successful app command without a robot proposal', async () => {
  let appCommandCount = 0;
  const capabilities: AgentCapability[] = [
    {
      name: 'studio',
      description: 'Select an entity in the app.',
      parameters: { type: 'object', properties: {} },
      execute: () => {
        appCommandCount += 1;
        return { ok: true, message: 'Selected and framed.' };
      },
      mutates: false,
      effect: 'app-command',
    },
  ];
  const client = scriptedClient([
    {
      toolCalls: [
        {
          id: 'select_1',
          type: 'function',
          function: { name: 'studio', arguments: '{}' },
        },
      ],
    },
    { content: '已选择并聚焦目标。' },
  ]) as unknown as OpenAI;

  const result = await runAgentEngine({
    userMessage: '选择目标',
    robot: buildRobot(),
    createClient: () => client,
    model: 'test-model',
    options: { capabilities },
  });

  assert.equal(appCommandCount, 1);
  assert.equal(result.endReason, 'completed');
  assert.equal(result.robot, null);
  assert.equal(result.explanation, '已选择并聚焦目标。');
});

test('browser harness executes multiple Studio calls from one model step in order', async () => {
  const commands: string[] = [];
  const capabilities: AgentCapability[] = [{
    name: 'studio',
    description: 'Operate the Studio UI.',
    parameters: { type: 'object', properties: {} },
    execute: (_draft, args) => {
      commands.push(String(args.action));
      return { ok: true, message: `${String(args.action)} complete.`, effect: 'app-command' };
    },
    mutates: false,
    effect: 'app-command',
  }];
  const client = scriptedClient([
    {
      toolCalls: [
        {
          id: 'view_1',
          type: 'function',
          function: { name: 'studio', arguments: '{"action":"view"}' },
        },
        {
          id: 'panels_1',
          type: 'function',
          function: { name: 'studio', arguments: '{"action":"panels"}' },
        },
      ],
    },
    { content: 'Both UI commands completed.' },
  ]) as unknown as OpenAI;

  const result = await runAgentEngine({
    userMessage: 'update the view and panels',
    robot: buildRobot(),
    createClient: () => client,
    model: 'test-model',
    options: { capabilities },
  });

  assert.deepEqual(commands, ['view', 'panels']);
  assert.equal(result.endReason, 'completed');
  assert.equal(result.robot, null);
});

test('browser harness blocks draft edits after selecting another component', async () => {
  let mutationCount = 0;
  const capabilities: AgentCapability[] = [
    {
      name: 'studio',
      description: 'Select another component.',
      parameters: { type: 'object', properties: {} },
      execute: () => ({
        ok: true,
        message: 'Selected gripper; edits are blocked until the next turn.',
        effect: 'app-command',
        blocksDraftMutation: true,
      }),
      mutates: false,
      effect: 'app-command',
    },
    {
      name: 'write_path',
      description: 'Mutate the current draft.',
      parameters: { type: 'object', properties: {} },
      execute: draft => {
        mutationCount += 1;
        draft.name = 'wrong component';
        return { ok: true, message: 'Edited.' };
      },
      mutates: true,
    },
  ];
  const client = scriptedClient([
    {
      toolCalls: [
        { id: 'select_1', type: 'function', function: { name: 'studio', arguments: '{}' } },
        { id: 'edit_1', type: 'function', function: { name: 'write_path', arguments: '{}' } },
      ],
    },
    { content: 'Selected the requested component; edit requires a new turn.' },
  ]) as unknown as OpenAI;

  const result = await runAgentEngine({
    userMessage: 'select gripper and edit it',
    robot: buildRobot(),
    createClient: () => client,
    model: 'test-model',
    options: { capabilities },
  });

  assert.equal(mutationCount, 0);
  assert.equal(result.robot, null);
  assert.equal(result.endReason, 'completed');
  assert.equal(
    result.events.some(event =>
      event.type === 'tool.finished' && event.name === 'write_path' && !event.ok),
    true,
  );
});

test('browser harness rolls back a tool that mutates before throwing', async () => {
  const capabilities: AgentCapability[] = [
    {
      name: 'poison_then_throw',
      description: 'Mutate and throw for testing.',
      parameters: { type: 'object', properties: {} },
      execute: draft => {
        draft.name = 'poisoned';
        throw new Error('boom');
      },
      mutates: true,
    },
    {
      name: 'recover_name',
      description: 'Recover only if the failed mutation was rolled back.',
      parameters: { type: 'object', properties: {} },
      execute: draft => {
        if (draft.name !== 'robot') {
          return { ok: false, message: `Unexpected dirty draft: ${draft.name}` };
        }
        draft.name = 'recovered';
        return { ok: true, message: 'Recovered cleanly.' };
      },
      mutates: true,
    },
    {
      name: 'validate_robot',
      description: 'Validate the recovered name.',
      parameters: { type: 'object', properties: {} },
      execute: draft => ({ ok: draft.name === 'recovered', message: 'Name checked.' }),
      mutates: false,
    },
  ];
  const client = scriptedClient([
    {
      toolCalls: [
        { id: 'bad_1', type: 'function', function: { name: 'poison_then_throw', arguments: '{}' } },
      ],
    },
    {
      toolCalls: [
        { id: 'fix_1', type: 'function', function: { name: 'recover_name', arguments: '{}' } },
      ],
    },
    { content: 'Recovered.' },
  ]) as unknown as OpenAI;

  const result = await runAgentEngine({
    userMessage: 'recover from a failed tool',
    robot: buildRobot(),
    createClient: () => client,
    model: 'test-model',
    options: { capabilities },
  });

  assert.equal(result.endReason, 'completed');
  assert.equal(result.robot?.name, 'recovered');
  assert.equal(
    result.events.some(
      event => event.type === 'tool.finished' && event.name === 'poison_then_throw' && !event.ok,
    ),
    true,
  );
});

test('browser harness stops dispatching a tool batch after cancellation', async () => {
  const controller = new AbortController();
  let secondToolRuns = 0;
  const capabilities: AgentCapability[] = [
    {
      name: 'first_tool',
      description: 'First tool.',
      parameters: { type: 'object', properties: {} },
      execute: () => ({ ok: true, message: 'First done.' }),
      mutates: false,
    },
    {
      name: 'second_tool',
      description: 'Second tool.',
      parameters: { type: 'object', properties: {} },
      execute: () => {
        secondToolRuns += 1;
        return { ok: true, message: 'Second done.' };
      },
      mutates: false,
    },
  ];
  const client = scriptedClient([
    {
      toolCalls: [
        { id: 'first_1', type: 'function', function: { name: 'first_tool', arguments: '{}' } },
        { id: 'second_1', type: 'function', function: { name: 'second_tool', arguments: '{}' } },
      ],
    },
  ]) as unknown as OpenAI;

  await assert.rejects(
    runAgentEngine({
      userMessage: 'cancel the batch',
      robot: buildRobot(),
      createClient: () => client,
      model: 'test-model',
      signal: controller.signal,
      options: {
        capabilities,
        onEvent: event => {
          if (event.type === 'tool.finished' && event.name === 'first_tool') {
            controller.abort();
          }
        },
      },
    }),
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  );

  assert.equal(secondToolRuns, 0);
});

test('browser harness pairs invalid tool arguments with started and finished events', async () => {
  const capabilities: AgentCapability[] = [
    {
      name: 'read_robot',
      description: 'Read the robot.',
      parameters: { type: 'object', properties: {} },
      execute: () => ({ ok: true, message: 'Read.' }),
      mutates: false,
    },
  ];
  const client = scriptedClient([
    {
      toolCalls: [
        {
          id: 'invalid_1',
          type: 'function',
          function: { name: 'read_robot', arguments: '{not valid json' },
        },
      ],
    },
    { content: 'Could not read.' },
  ]) as unknown as OpenAI;

  const result = await runAgentEngine({
    userMessage: 'read it',
    robot: buildRobot(),
    createClient: () => client,
    model: 'test-model',
    options: { capabilities },
  });
  const lifecycle = result.events.filter(
    event =>
      (event.type === 'tool.started' || event.type === 'tool.finished') &&
      event.callId === 'invalid_1',
  );

  assert.deepEqual(lifecycle.map(event => event.type), ['tool.started', 'tool.finished']);
});

test('runRobotEditAgent applies a tool call and returns the edited draft', async () => {
  const responses = [
    {
      toolCalls: [
        {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'write_path',
            arguments: JSON.stringify({ path: 'links.base_link.visual.dimensions.x', value: 0.3 }),
          },
        },
        {
          id: 'call_2',
          type: 'function',
          function: {
            name: 'write_path',
            arguments: JSON.stringify({ path: 'links.base_link.collision.dimensions.x', value: 0.3 }),
          },
        },
      ],
    },
    {
      toolCalls: [
        {
          id: 'verify_1',
          type: 'function',
          function: {
            name: 'read_path',
            arguments: JSON.stringify({ path: 'links.base_link.visual.dimensions.x' }),
          },
        },
        {
          id: 'verify_2',
          type: 'function',
          function: {
            name: 'read_path',
            arguments: JSON.stringify({ path: 'links.base_link.collision.dimensions.x' }),
          },
        },
      ],
    },
    { content: 'Updated base_link cylinder radius to 0.3.' },
    completionPass(),
  ];
  installClient(scriptedClient(responses));

  await withKey(async () => {
    const result = await runRobotEditAgent('change base_link radius to 0.3', buildRobot(), 'en');
    assert.ok(result.robot, 'agent must return the edited draft');
    assert.equal(result.robot!.links.base_link.visual.dimensions.x, 0.3);
    assert.equal(result.robot!.links.base_link.visual.dimensions.y, 0.5, 'length must be preserved');
    assert.equal(result.robot!.links.base_link.collision.dimensions.x, 0.3);
    assert.match(result.explanation, /Updated/);
  });
});

test('runRobotEditAgent is surgical — untouched fields keep their values', async () => {
  const responses = [
    {
      toolCalls: [
        {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'write_path',
            arguments: JSON.stringify({ path: 'links.base_link.visual.dimensions.x', value: 0.3 }),
          },
        },
      ],
    },
    {
      toolCalls: [{
        id: 'verify_1',
        type: 'function',
        function: {
          name: 'read_path',
          arguments: JSON.stringify({ path: 'links.base_link.visual.dimensions.x' }),
        },
      }],
    },
    { content: 'Done.' },
    completionPass(),
  ];
  installClient(scriptedClient(responses));

  await withKey(async () => {
    const robot = buildRobot();
    const massBefore = robot.links.base_link.inertial?.mass;
    const result = await runRobotEditAgent('change radius', robot, 'en');
    assert.equal(result.robot!.links.base_link.inertial?.mass, massBefore, 'inertia must be untouched');
  });
});

test('runRobotEditAgent returns null robot when the model calls no tools', async () => {
  installClient(scriptedClient([{ content: 'I cannot do that with the available tools.' }]));

  await withKey(async () => {
    const result = await runRobotEditAgent('make it fly', buildRobot(), 'en');
    assert.equal(result.robot, null);
    assert.match(result.explanation, /cannot/);
  });
});

test('runRobotEditAgent throws AgentToolsUnsupportedError when endpoint rejects tools', async () => {
  const errorClient = {
    chat: {
      completions: {
        create: async () => {
          const e = new Error('model does not support tools');
          (e as { status?: number }).status = 400;
          throw e;
        },
      },
    },
  };
  installClient(errorClient);

  await withKey(async () => {
    await assert.rejects(
      runRobotEditAgent('change radius', buildRobot(), 'en'),
      (e: unknown) => {
        assert.ok(e instanceof AgentToolsUnsupportedError);
        return true;
      },
    );
  });
});

test('runRobotEditAgent throws AgentToolsUnsupportedError when API key is missing', async () => {
  const previous = process.env.API_KEY;
  delete process.env.API_KEY;
  installClient(scriptedClient([{ content: 'x' }]));
  try {
    await assert.rejects(
      runRobotEditAgent('change radius', buildRobot(), 'en'),
      (e: unknown) => {
        assert.ok(e instanceof AgentToolsUnsupportedError);
        return true;
      },
    );
  } finally {
    if (previous === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = previous;
    }
  }
});

test('runRobotEditAgent runs an inspect → edit → validate flow', async () => {
  const responses = [
    {
      toolCalls: [
        { id: 'c1', type: 'function', function: { name: 'read_path', arguments: JSON.stringify({ path: 'links.base_link' }) } },
      ],
    },
    {
      toolCalls: [
        {
          id: 'c2',
          type: 'function',
          function: {
            name: 'write_path',
            arguments: JSON.stringify({ path: 'links.base_link.visual.dimensions.x', value: 0.3 }),
          },
        },
      ],
    },
    {
      toolCalls: [{ id: 'c3', type: 'function', function: { name: 'validate_robot', arguments: '{}' } }],
    },
    {
      toolCalls: [
        { id: 'c4', type: 'function', function: { name: 'read_path', arguments: JSON.stringify({ path: 'links.base_link.visual.dimensions.x' }) } },
      ],
    },
    { content: 'Updated base_link radius to 0.3 and validated.' },
    completionPass(),
  ];
  installClient(scriptedClient(responses));

  await withKey(async () => {
    const result = await runRobotEditAgent('change base_link radius to 0.3', buildRobot(), 'en');
    assert.ok(result.robot, 'agent must return the edited draft after an edit tool');
    assert.equal(result.robot!.links.base_link.visual.dimensions.x, 0.3);
    assert.equal(result.robot!.links.base_link.visual.dimensions.y, 0.5, 'length preserved');
    assert.match(result.explanation, /Updated/);
  });
});

test('runRobotEditAgent returns null robot when only read/validate tools are called', async () => {
  const responses = [
    {
      toolCalls: [
        { id: 'c1', type: 'function', function: { name: 'read_path', arguments: JSON.stringify({ path: 'links.base_link' }) } },
      ],
    },
    {
      toolCalls: [{ id: 'c2', type: 'function', function: { name: 'validate_robot', arguments: '{}' } }],
    },
    { content: 'Inspected; no changes needed.' },
  ];
  installClient(scriptedClient(responses));

  await withKey(async () => {
    const result = await runRobotEditAgent('inspect base_link', buildRobot(), 'en');
    assert.equal(result.robot, null, 'read/validate-only runs must not produce a diff card');
    assert.match(result.explanation, /Inspected/);
  });
});

// Ensure no leaked seam between suites.
test('cleanup: agent client seam defaults to null after tests', () => {
  __setAgentOpenAIClientFactoryForTests(null);
  assert.ok(true);
});

// Reproduces the user report "changed mass but fundamental properties didn't take
// effect". Verifies the full apply data path: tool sets mass → generateURDF writes
// it → parseURDF reads it back → semantic hash differs (so apply replaces the robot).
test('mass change survives the full generateURDF → parseURDF → hash round-trip', () => {
  const before = buildRobot();
  const draft = buildRobot();
  const res = updateLinkInertial(draft, { linkId: 'base_link', mass: 2.5 });
  assert.equal(res.ok, true);
  assert.equal(draft.links.base_link.inertial?.mass, 2.5, 'tool must set the mass');

  const urdf = generateURDF(
    { ...draft, selection: { type: null, id: null } },
    { preserveMeshPaths: true },
  );
  assert.ok(
    urdf.includes('<mass value="2.5"'),
    `URDF must contain the new mass; inertial snippet: ${urdf.slice(urdf.indexOf('<inertial>'), urdf.indexOf('</inertial>') + 12)}`,
  );

  const parsed = parseURDF(urdf);
  assert.ok(parsed, 'parseURDF must succeed');
  assert.equal(
    parsed!.links.base_link.inertial?.mass,
    2.5,
    'parsed mass must be 2.5 (round-trip preserves it)',
  );

  const oldHash = createSourceSemanticRobotHash(before);
  const newHash = createSourceSemanticRobotHash(parsed!);
  assert.notEqual(
    oldHash,
    newHash,
    'mass change must change the semantic hash so applyAIUrdfModification replaces the robot',
  );
});
