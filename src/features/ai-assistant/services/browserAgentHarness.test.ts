import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentRunEvent } from '../agentRuntimeTypes';
import { formatAgentRunEvent } from './browserAgentHarness';

test('visible Agent progress omits raw reasoning, results, verifier details, and runtime internals', () => {
  const hiddenEvents: AgentRunEvent[] = [
    { type: 'assistant.reasoning', content: 'RAW_REASONING_SENTINEL', step: 1 },
    {
      type: 'tool.finished',
      callId: 'read-1',
      name: 'read_path',
      ok: true,
      message: 'RAW_TOOL_RESULT_SENTINEL',
      step: 1,
    },
    {
      type: 'validation.finished',
      ok: false,
      message: 'RAW_VALIDATION_CHECKLIST_SENTINEL',
      automatic: true,
      step: 2,
    },
    {
      type: 'completion.verification.finished',
      ok: false,
      message: 'RAW_COMPLETION_CHECKLIST_SENTINEL',
      evidenceCount: 3,
      checkCount: 4,
      passedCheckCount: 3,
      step: 3,
    },
    {
      type: 'context.compacted',
      trigger: 'pressure',
      beforeTokens: 40000,
      afterTokens: 12000,
      prunedToolResults: 3,
      summarizedMessages: 8,
      usedModelSummary: true,
      step: 4,
    },
  ];

  const visible = hiddenEvents
    .map(event => formatAgentRunEvent(event, 'en'))
    .filter((line): line is string => Boolean(line))
    .join('\n');

  assert.equal(visible.includes('RAW_REASONING_SENTINEL'), false);
  assert.equal(visible.includes('RAW_TOOL_RESULT_SENTINEL'), false);
  assert.equal(visible.includes('RAW_VALIDATION_CHECKLIST_SENTINEL'), false);
  assert.equal(visible.includes('RAW_COMPLETION_CHECKLIST_SENTINEL'), false);
  assert.equal(visible.includes('40000'), false);
  assert.equal(visible.includes('Operation completed'), false);
  assert.equal(visible.includes('Found a structural issue'), true);
  assert.equal(visible.includes('does not match the request yet'), true);
});

test('visible Agent progress shows a bounded public approach note', () => {
  const line = formatAgentRunEvent({
    type: 'assistant.progress',
    content: `先确认轮子数量，再检查连接关系。\n${'x'.repeat(240)}`,
    step: 1,
  }, 'zh');

  assert.ok(line?.startsWith('思路 · 先确认轮子数量，再检查连接关系。'));
  assert.equal(line?.includes('\n'), false);
  assert.ok((line?.length ?? 0) < 180);
});

test('visible plan and tool summaries are single-line, bounded operational descriptions', () => {
  const plan = formatAgentRunEvent({
    type: 'plan.updated',
    plan: [{ step: `Inspect current robot\n${'x'.repeat(240)}`, status: 'in_progress' }],
    step: 1,
  }, 'en');
  const tool = formatAgentRunEvent({
    type: 'tool.started',
    callId: 'tool-1',
    name: 'studio',
    summary: `Read current state\n${'y'.repeat(240)}`,
    step: 1,
    index: 0,
    total: 1,
  }, 'en');
  const script = formatAgentRunEvent({
    type: 'tool.started',
    callId: 'script-1',
    name: 'run_script',
    summary: 'SECRET_SCRIPT_SOURCE',
    step: 1,
    index: 0,
    total: 1,
  }, 'en');
  const readLink = formatAgentRunEvent({
    type: 'tool.started',
    callId: 'read-link',
    name: 'read_path',
    summary: 'read path: links.base_link.visual.dimensions.x',
    step: 1,
    index: 0,
    total: 1,
  }, 'zh');
  const writeName = formatAgentRunEvent({
    type: 'tool.started',
    callId: 'write-name',
    name: 'write_path',
    summary: 'write path: name · = next-name',
    step: 1,
    index: 0,
    total: 1,
  }, 'zh');

  assert.ok(plan);
  assert.equal(plan.split('\n').length, 2);
  assert.ok(plan.length < 190);
  assert.ok(tool);
  assert.equal(tool.includes('\n'), false);
  assert.ok(tool.length < 190);
  assert.equal(script?.includes('SECRET_SCRIPT_SOURCE'), false);
  assert.equal(script?.includes('Applying a set of robot changes'), true);
  assert.equal(readLink, 'read_path · 正在查看连杆 base_link…');
  assert.equal(writeName, 'write_path · 正在调整机器人名称…');
  assert.equal(formatAgentRunEvent({ type: 'run.status', status: 'running', step: 0 }, 'zh'), null);
  assert.equal(
    formatAgentRunEvent({ type: 'run.status', status: 'waiting-for-model', step: 1 }, 'zh'),
    null,
  );
});
