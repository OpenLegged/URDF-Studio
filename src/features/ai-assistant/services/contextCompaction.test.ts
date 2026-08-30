import assert from 'node:assert/strict'
import test from 'node:test'
import type OpenAI from 'openai'

import {
  buildAgentHistoryCheckpoint,
  estimateAgentRequestTokens,
  prepareAgentContextCompaction,
  replaceAgentContextPrefix,
  resolveAgentContextBudget,
} from './contextCompaction.ts'

type AgentMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam

const tools = [{
  type: 'function' as const,
  function: {
    name: 'read',
    description: 'Read state.',
    parameters: { type: 'object', properties: {} },
  },
}]

test('context budget resolves the 80% pressure and 16% retention thresholds', () => {
  const budget = resolveAgentContextBudget({
    contextWindowTokens: 10_000,
    tokenEstimator: text => text.length,
  })

  assert.equal(budget.thresholdTokens, 8_000)
  assert.equal(budget.retainTokens, 1_600)
})

test('context compaction prunes large tool results and keeps tool pairs balanced', () => {
  const messages: AgentMessage[] = [
    { role: 'system', content: 'system' },
    { role: 'user', content: `old request ${'a'.repeat(180)}` },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'call-1',
        type: 'function',
        function: { name: 'read', arguments: '{}' },
      }],
    },
    { role: 'tool', tool_call_id: 'call-1', content: `result ${'b'.repeat(400)}` },
    { role: 'user', content: 'recent request' },
    { role: 'assistant', content: 'recent answer' },
  ]
  const budget = resolveAgentContextBudget({
    contextWindowTokens: 1_024,
    thresholdRatio: 0.5,
    retainRatio: 0.1,
    toolResultTokenLimit: 80,
    tokenEstimator: text => text.length,
  })
  const preparation = prepareAgentContextCompaction(messages, tools, budget)

  assert.ok(preparation)
  assert.equal(preparation.prunedToolResults, 1)
  assert.equal(preparation.prefixEndIndex, 4)
  assert.equal(preparation.messages[2]?.role, 'assistant')
  assert.equal(preparation.messages[3]?.role, 'tool')
  assert.ok(String(preparation.messages[3]?.content).includes('context compacted'))

  const compacted = replaceAgentContextPrefix(
    preparation.messages,
    preparation.prefixEndIndex,
    'Earlier request and its read result were summarized.',
  )
  assert.deepEqual(compacted.slice(-2), messages.slice(-2))
  const checkpoint = buildAgentHistoryCheckpoint(compacted)
  assert.match(checkpoint[0]?.content ?? '', /<compacted-summary>/)
  assert.deepEqual(checkpoint.slice(1), [
    { role: 'user', content: 'recent request' },
    { role: 'assistant', content: 'recent answer' },
  ])
})

test('context compaction stays idle below the pressure threshold', () => {
  const messages: AgentMessage[] = [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'short request' },
  ]
  const budget = resolveAgentContextBudget({
    contextWindowTokens: 4_096,
    tokenEstimator: text => text.length,
  })

  assert.ok(estimateAgentRequestTokens(messages, tools, budget.tokenEstimator) < 3_276)
  assert.equal(prepareAgentContextCompaction(messages, tools, budget), null)
})

test('context compaction never summarizes the active reasoning/tool turn', () => {
  const activeTurn: AgentMessage[] = [
    { role: 'user', content: 'current request' },
    ...Array.from({ length: 3 }, (_, index): AgentMessage[] => [
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: `current-${index}`,
          type: 'function',
          function: { name: 'read', arguments: '{}' },
        }],
        reasoning_content: `reasoning-${index}`,
      } as AgentMessage,
      { role: 'tool', tool_call_id: `current-${index}`, content: `result-${index}` },
    ]).flat(),
  ]
  const messages: AgentMessage[] = [
    { role: 'system', content: 'system' },
    { role: 'user', content: `old request ${'x'.repeat(300)}` },
    { role: 'assistant', content: `old response ${'y'.repeat(300)}` },
    ...activeTurn,
  ]
  const budget = resolveAgentContextBudget({
    contextWindowTokens: 1_024,
    thresholdRatio: 0.5,
    retainRatio: 0.05,
    tokenEstimator: text => text.length,
  })
  const currentTurnStartIndex = 3
  const preparation = prepareAgentContextCompaction(
    messages,
    tools,
    budget,
    true,
    currentTurnStartIndex,
  )

  assert.ok(preparation)
  assert.equal(preparation.prefixEndIndex, currentTurnStartIndex)
  assert.deepEqual(preparation.messages.slice(currentTurnStartIndex), activeTurn)
})
