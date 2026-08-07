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
} from './aiAgent.ts';

/** Minimal scripted mock OpenAI client — returns one canned response per call. */
function scriptedClient(responses: Array<{ toolCalls?: unknown[]; content?: string }>): {
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

test('runRobotEditAgent applies a tool call and returns the edited draft', async () => {
  const responses = [
    {
      toolCalls: [
        {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'update_link_geometry',
            arguments: JSON.stringify({ linkId: 'base_link', geometryType: 'cylinder', radius: 0.3 }),
          },
        },
      ],
    },
    { content: 'Updated base_link cylinder radius to 0.3.' },
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
            name: 'update_link_geometry',
            arguments: JSON.stringify({ linkId: 'base_link', geometryType: 'cylinder', radius: 0.3 }),
          },
        },
      ],
    },
    { content: 'Done.' },
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
        { id: 'c1', type: 'function', function: { name: 'get_link', arguments: JSON.stringify({ linkId: 'base_link' }) } },
      ],
    },
    {
      toolCalls: [
        {
          id: 'c2',
          type: 'function',
          function: {
            name: 'update_link_geometry',
            arguments: JSON.stringify({ linkId: 'base_link', geometryType: 'cylinder', radius: 0.3 }),
          },
        },
      ],
    },
    {
      toolCalls: [{ id: 'c3', type: 'function', function: { name: 'validate_robot', arguments: '{}' } }],
    },
    { content: 'Updated base_link radius to 0.3 and validated.' },
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
        { id: 'c1', type: 'function', function: { name: 'get_link', arguments: JSON.stringify({ linkId: 'base_link' }) } },
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
