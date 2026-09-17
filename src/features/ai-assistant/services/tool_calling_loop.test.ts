import test from 'node:test';
import assert from 'node:assert/strict';
import { runToolCallingLoop } from './tool_calling_loop.ts';

test('tool feedback and rejected completion continue the same turn', async () => {
  const messages = [[1, 2], [], [3], []];
  const executed: number[] = [];
  let completions = 0;
  const result = await runToolCallingLoop({
    maxSteps: 4, maxToolCalls: 3,
    request: async () => messages.shift()!, calls: m => m,
    execute: async call => { executed.push(call); },
    complete: async () => ++completions === 2 ? 'verified' : null,
    limit: async () => 'limit',
  });
  assert.equal(result, 'verified');
  assert.deepEqual(executed, [1, 2, 3]);
});
test('cancellation between batched tools prevents later effects', async () => {
  const controller = new AbortController();
  const executed: number[] = [];
  await assert.rejects(runToolCallingLoop({
    signal: controller.signal, maxSteps: 4, maxToolCalls: 4,
    request: async () => [1, 2], calls: m => m,
    execute: async call => { executed.push(call); controller.abort(); },
    complete: async () => 'done', limit: async () => 'limit',
  }), { name: 'AbortError' });
  assert.deepEqual(executed, [1]);
});
test('tool budget stops without executing excess calls or accepting completion', async () => {
  const executed: number[] = [];
  const result = await runToolCallingLoop({
    maxSteps: 4, maxToolCalls: 1, request: async () => [1, 2], calls: m => m,
    execute: async call => { executed.push(call); }, complete: async () => 'done', limit: async (_, reason) => reason,
  });
  assert.equal(result, 'tools'); assert.deepEqual(executed, [1]);
});
