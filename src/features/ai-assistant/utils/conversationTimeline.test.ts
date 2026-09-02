import assert from 'node:assert/strict'
import test from 'node:test'

import {
  appendConversationContextCheckpoint,
  createConversationMessage,
  createNewConversationDivider,
  getActiveConversationHistory,
  replaceActiveConversationTimeline,
} from './conversationTimeline.ts'

test('getActiveConversationHistory only returns turns after the latest new conversation divider', () => {
  const timeline = [
    createConversationMessage('user', 'older question'),
    createConversationMessage('assistant', 'older answer'),
    createNewConversationDivider(),
    createConversationMessage('user', 'current question'),
    createConversationMessage('assistant', 'current answer'),
  ]

  assert.deepEqual(getActiveConversationHistory(timeline), [
    { role: 'user', content: 'current question' },
    { role: 'assistant', content: 'current answer' },
  ])
})

test('getActiveConversationHistory includes modification summaries as assistant context', () => {
  const timeline = [
    createConversationMessage('user', 'make the base wider'),
    {
      kind: 'modification-card' as const,
      role: 'assistant' as const,
      explanation: 'Increased the base width to 0.6 m.',
      proposedUrdf: '<robot />',
      currentUrdf: '<robot />',
      componentId: 'base',
      status: 'applied' as const,
    },
    createConversationMessage('user', 'now make it red'),
  ]

  assert.deepEqual(getActiveConversationHistory(timeline), [
    { role: 'user', content: 'make the base wider' },
    { role: 'assistant', content: 'Increased the base width to 0.6 m.' },
    { role: 'user', content: 'now make it red' },
  ])
})

test('getActiveConversationHistory does not treat pending or dismissed proposals as applied facts', () => {
  const makeCard = (status: 'pending' | 'dismissed') => ({
    kind: 'modification-card' as const,
    role: 'assistant' as const,
    explanation: `Proposal is ${status}.`,
    proposedUrdf: '<robot name="next" />',
    currentUrdf: '<robot name="current" />',
    componentId: 'base',
    status,
  })
  const timeline = [
    createConversationMessage('user', 'make a proposal'),
    makeCard('pending'),
    makeCard('dismissed'),
  ]

  assert.deepEqual(getActiveConversationHistory(timeline), [
    { role: 'user', content: 'make a proposal' },
  ])
})

test('getActiveConversationHistory excludes browser harness execution traces', () => {
  const timeline = [
    createConversationMessage('user', 'change the radius'),
    {
      kind: 'agent-activity' as const,
      role: 'assistant' as const,
      status: 'completed' as const,
      events: [
        { type: 'tool.started' as const, callId: 'c1', name: 'write_path', summary: 'write radius', step: 1, index: 1, total: 1 },
        { type: 'tool.finished' as const, callId: 'c1', name: 'write_path', ok: true, message: 'done', step: 1 },
      ],
    },
  ]

  assert.deepEqual(getActiveConversationHistory(timeline), [
    { role: 'user', content: 'change the radius' },
  ])
})

test('context checkpoint replaces older model history without hiding visible messages', () => {
  const visibleTimeline = [
    createConversationMessage('user', 'very old question'),
    createConversationMessage('assistant', 'very old answer'),
    createConversationMessage('user', 'recent question'),
  ]
  const withCheckpoint = appendConversationContextCheckpoint(visibleTimeline, [
    { role: 'user', content: '<compacted-summary>old facts</compacted-summary>' },
    { role: 'user', content: 'recent question' },
  ])
  withCheckpoint.push(createConversationMessage('assistant', 'recent answer'))

  assert.equal(withCheckpoint[0], visibleTimeline[0])
  assert.deepEqual(getActiveConversationHistory(withCheckpoint), [
    { role: 'user', content: '<compacted-summary>old facts</compacted-summary>' },
    { role: 'user', content: 'recent question' },
    { role: 'assistant', content: 'recent answer' },
  ])
})

test('replaceActiveConversationTimeline preserves previous conversations when rebuilding the active one', () => {
  const timeline = [
    createConversationMessage('user', 'first question'),
    createConversationMessage('assistant', 'first answer'),
    createNewConversationDivider(),
    createConversationMessage('user', 'draft question'),
    createConversationMessage('assistant', 'draft answer'),
  ]

  const rebuiltTimeline = replaceActiveConversationTimeline(timeline, [
    createConversationMessage('user', 'retry question'),
    createConversationMessage('assistant', ''),
  ])

  assert.deepEqual(rebuiltTimeline, [
    createConversationMessage('user', 'first question'),
    createConversationMessage('assistant', 'first answer'),
    timeline[2]!,
    createConversationMessage('user', 'retry question'),
    createConversationMessage('assistant', ''),
  ])
})
