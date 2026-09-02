import assert from 'node:assert/strict'
import test from 'node:test'

import { AgentSessionRepository, MemoryAgentSessionBackend } from '../persistence'
import type { AIConversationMessage } from '../types'
import {
  createAgentConversationSession,
  forkAgentConversationSession,
  persistConversationTimeline,
  replayConversationMessages,
  restoreLatestAgentConversation,
} from './conversationSessionPersistence'

test('restores the latest fork timeline without executing replayed work', async () => {
  const repository = new AgentSessionRepository(new MemoryAgentSessionBackend())
  const parent = await createAgentConversationSession(repository, 'general')
  const parentMessages: AIConversationMessage[] = [
    { kind: 'message', role: 'user', content: 'Inspect the knee joint' },
    { kind: 'message', role: 'assistant', content: 'The limit needs adjustment.' },
  ]
  await persistConversationTimeline(repository, parent.id, parentMessages)
  const currentParent = (await repository.loadSession(parent.id))?.session
  assert.ok(currentParent)

  const forkMessages: AIConversationMessage[] = [
    ...parentMessages,
    { kind: 'divider', marker: 'new-conversation' },
    { kind: 'message', role: 'user', content: 'Export the updated URDF' },
  ]
  const child = await forkAgentConversationSession(
    repository,
    currentParent,
    forkMessages,
    'general',
  )
  const restored = await restoreLatestAgentConversation(repository, 'general')

  assert.equal(restored?.session.id, child.id)
  assert.deepEqual(restored?.messages, forkMessages)
  assert.equal(restored?.session.parentSessionId, parent.id)
  assert.equal(restored?.session.forkedAtSequence, currentParent.lastSequence)
})
test('marks non-terminal restored Agent activity as aborted without replaying tools', () => {
  const runningTimeline: AIConversationMessage[] = [
    { kind: 'message', role: 'user', content: 'Run validation' },
    {
      kind: 'agent-activity',
      role: 'assistant',
      status: 'executing-tools',
      events: [
        {
          type: 'tool.started',
          callId: 'tool-1',
          name: 'validate_robot',
          summary: 'Validating robot',
          step: 2,
          index: 0,
          total: 1,
        },
      ],
    },
  ]
  const restored = replayConversationMessages([
    {
      replaySequence: 1,
      sourceSessionId: 'session-1',
      sourceSequence: 1,
      timestamp: '2026-08-30T00:00:00.000Z',
      event: { kind: 'conversation.timeline', timeline: runningTimeline },
    },
  ])

  assert.equal(restored.interruptedActivityCount, 1)
  const activity = restored.messages[1]
  assert.equal(activity?.kind, 'agent-activity')
  if (activity?.kind !== 'agent-activity') return
  assert.equal(activity.status, 'aborted')
  assert.deepEqual(activity.events.at(-1), {
    type: 'run.finished',
    reason: 'aborted',
    step: 2,
  })
})
