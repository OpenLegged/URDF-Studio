import assert from 'node:assert/strict';
import test from 'node:test';
import OpenAI from 'openai';
import { createLink } from '@/core/robot';
import { GeometryType, type RobotState } from '@/types';
import { __setAgentOpenAIClientFactoryForTests } from '../services/aiAgent';
import { resolveModificationProposal } from './resolveModificationProposal';

function createRequest() {
  const base = createLink({ id: 'base', name: 'base' });
  base.visual.type = GeometryType.MESH;
  base.visual.meshPath = 'C:/export/ur1/meshes/base.STL';
  const robot: RobotState = {
    name: 'ur1', rootLinkId: 'base', links: { base }, joints: {},
    selection: { type: null, id: null },
  };
  return {
    message: 'Rename the robot only', currentRobot: robot, robotData: robot,
    motorLibrary: {}, lang: 'en' as const, signal: new AbortController().signal,
  };
}

function setEnv(t: test.TestContext, name: string, value: string) {
  const previous = process.env[name];
  process.env[name] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

test('managed modification preserves mesh data and uses the backend even when a BYOK key exists', async (t) => {
  setEnv(t, 'AI_BACKEND_URL', 'https://feedback.test/ai');
  setEnv(t, 'API_KEY', 'test-key');
  const client = new OpenAI({ apiKey: 'test-key' });
  const agentCall = t.mock.method(client.chat.completions, 'create', async () => {
    throw new Error('managed mode must not use the BYOK client');
  });
  __setAgentOpenAIClientFactoryForTests(() => client);
  t.after(() => __setAgentOpenAIClientFactoryForTests(null));
  const request = createRequest();
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(url), 'https://feedback.test/ai/generate');
    const input = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ success: true, data: { content: JSON.stringify({
      actionType: 'modification', explanation: 'Renamed',
      robotData: { ...input.robot, name: 'edited', rootLinkId: 'base' },
    }) } }), { status: 200 });
  });
  const proposal = await resolveModificationProposal(request);
  assert.equal(proposal.kind, 'change');
  if (proposal.kind !== 'change') assert.fail('Expected a modification');
  assert.equal(proposal.robot.name, 'edited');
  assert.deepEqual(proposal.robot.links?.base, request.currentRobot.links.base);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(agentCall.mock.callCount(), 0);
});

test('a failed tool edit does not fall back to a second request that regenerates the robot', async (t) => {
  setEnv(t, 'AI_BACKEND_URL', '');
  setEnv(t, 'API_KEY', 'test-key');
  const originalError = new Error('Provider connection lost');
  const client = new OpenAI({ apiKey: 'test-key', maxRetries: 0 });
  t.mock.method(client.chat.completions, 'create', async () => { throw originalError; });
  __setAgentOpenAIClientFactoryForTests(() => client);
  t.after(() => __setAgentOpenAIClientFactoryForTests(null));
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected generation request');
  });
  const request = createRequest();
  const before = structuredClone(request.robotData);
  await assert.rejects(resolveModificationProposal(request), originalError);
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.deepEqual(request.robotData, before);
});

test('an already cancelled edit performs no generation request', async (t) => {
  setEnv(t, 'AI_BACKEND_URL', 'https://feedback.test/ai');
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected request'); });
  const request = createRequest();
  assert.deepEqual(await resolveModificationProposal({ ...request, signal: AbortSignal.abort() }), { kind: 'aborted' });
  assert.equal(fetchMock.mock.callCount(), 0);
});
