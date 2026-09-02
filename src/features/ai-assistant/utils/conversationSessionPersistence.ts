import type { AgentRunEvent, AgentRunStatus } from '../agentRuntimeTypes'
import type {
  AgentSessionRecord,
  AgentSessionReplayEvent,
  AgentSessionRepository,
} from '../persistence'
import type {
  AIConversationMessage,
  AIConversationMode,
} from '../types'

const CONVERSATION_METADATA_KIND = 'ai-conversation'
let lastConversationOrder = 0
const AGENT_RUN_STATUSES = new Set<AgentRunStatus>([
  'running',
  'waiting-for-model',
  'compacting-context',
  'executing-tools',
  'validating',
  'verifying',
  'recovering',
  'completed',
  'failed',
  'aborted',
])

export interface RestoredAgentConversation {
  session: AgentSessionRecord
  messages: AIConversationMessage[]
  interruptedActivityCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type RecordValidator = (value: Record<string, unknown>) => boolean

const AGENT_EVENT_VALIDATORS: Record<string, RecordValidator> = {
  'run.status': value => typeof value.status === 'string' &&
    AGENT_RUN_STATUSES.has(value.status as AgentRunStatus),
  'assistant.reasoning': value => typeof value.content === 'string',
  'assistant.progress': value => typeof value.content === 'string',
  'plan.updated': value => Array.isArray(value.plan) && value.plan.every(item => (
    isRecord(item) && typeof item.step === 'string' &&
    (item.status === 'pending' || item.status === 'in_progress' || item.status === 'completed')
  )),
  'tool.started': value => typeof value.callId === 'string' &&
    typeof value.name === 'string' && typeof value.summary === 'string' &&
    typeof value.index === 'number' && typeof value.total === 'number',
  'tool.finished': value => typeof value.callId === 'string' &&
    typeof value.name === 'string' && typeof value.ok === 'boolean' &&
    typeof value.message === 'string',
  'validation.finished': value => typeof value.ok === 'boolean' &&
    typeof value.message === 'string' && typeof value.automatic === 'boolean',
  'completion.verification.finished': value => typeof value.ok === 'boolean' &&
    typeof value.message === 'string' && typeof value.evidenceCount === 'number' &&
    (value.checkCount === undefined || typeof value.checkCount === 'number') &&
    (value.passedCheckCount === undefined || typeof value.passedCheckCount === 'number'),
  'context.compacted': value => (
    value.trigger === 'pressure' || value.trigger === 'context-overflow'
  ) && typeof value.beforeTokens === 'number' && typeof value.afterTokens === 'number' &&
    typeof value.summarizedMessages === 'number' &&
    typeof value.prunedToolResults === 'number' && typeof value.usedModelSummary === 'boolean',
  'run.finished': value => value.reason === 'completed' || value.reason === 'no-change' ||
    value.reason === 'step-limit' || value.reason === 'validation-failed' ||
    value.reason === 'verification-failed' || value.reason === 'aborted' ||
    value.reason === 'failed',
}

function isAgentRunEvent(value: unknown): value is AgentRunEvent {
  if (!isRecord(value) || typeof value.type !== 'string' || typeof value.step !== 'number') {
    return false
  }
  return AGENT_EVENT_VALIDATORS[value.type]?.(value) === true
}

const CONVERSATION_MESSAGE_VALIDATORS: Record<string, RecordValidator> = {
  message: value => (value.role === 'user' || value.role === 'assistant') &&
    typeof value.content === 'string',
  divider: value => value.marker === 'new-conversation',
  'agent-activity': value => value.role === 'assistant' &&
    typeof value.status === 'string' && AGENT_RUN_STATUSES.has(value.status as AgentRunStatus) &&
    Array.isArray(value.events) && value.events.every(isAgentRunEvent),
  'context-checkpoint': value => Array.isArray(value.turns) && value.turns.every(turn => (
    isRecord(turn) && (turn.role === 'user' || turn.role === 'assistant') &&
    typeof turn.content === 'string'
  )),
  'modification-card': value => value.role === 'assistant' &&
    typeof value.explanation === 'string' && typeof value.proposedUrdf === 'string' &&
    typeof value.currentUrdf === 'string' && typeof value.componentId === 'string' &&
    (value.status === 'pending' || value.status === 'applied' || value.status === 'dismissed'),
}

function isConversationMessage(value: unknown): value is AIConversationMessage {
  if (!isRecord(value) || typeof value.kind !== 'string') return false
  return CONVERSATION_MESSAGE_VALIDATORS[value.kind]?.(value) === true
}

function readTimeline(event: AgentSessionReplayEvent): AIConversationMessage[] | null {
  if (event.event.kind === 'conversation.timeline' && Array.isArray(event.event.timeline)) {
    return event.event.timeline.filter(isConversationMessage)
  }
  return null
}

function markInterruptedActivities(messages: AIConversationMessage[]): {
  messages: AIConversationMessage[]
  count: number
} {
  let count = 0
  const nextMessages = messages.map(message => {
    if (
      message.kind !== 'agent-activity' ||
      message.status === 'completed' ||
      message.status === 'failed' ||
      message.status === 'aborted'
    ) {
      return message
    }

    count += 1
    const step = message.events.reduce(
      (latest, event) => Math.max(latest, event.step),
      0,
    )
    return {
      ...message,
      status: 'aborted' as const,
      events: [
        ...message.events,
        { type: 'run.status' as const, status: 'aborted' as const, step },
        { type: 'run.finished' as const, reason: 'aborted' as const, step },
      ],
    }
  })
  return { messages: nextMessages, count }
}

export function replayConversationMessages(
  events: AgentSessionReplayEvent[],
): { messages: AIConversationMessage[]; interruptedActivityCount: number } {
  let messages: AIConversationMessage[] = []
  for (const event of events) {
    const timeline = readTimeline(event)
    if (timeline) messages = timeline
  }
  const interrupted = markInterruptedActivities(messages)
  return {
    messages: interrupted.messages,
    interruptedActivityCount: interrupted.count,
  }
}

function conversationMetadata(mode: AIConversationMode) {
  lastConversationOrder = Math.max(lastConversationOrder + 1, Date.now() * 1000)
  return {
    kind: CONVERSATION_METADATA_KIND,
    mode,
    order: lastConversationOrder,
  }
}

function conversationOrder(session: AgentSessionRecord): number {
  return typeof session.metadata.order === 'number' ? session.metadata.order : 0
}

export async function createAgentConversationSession(
  repository: AgentSessionRepository,
  mode: AIConversationMode,
): Promise<AgentSessionRecord> {
  return repository.createSession({
    title: mode === 'general' ? 'AI conversation' : 'Inspection follow-up',
    metadata: conversationMetadata(mode),
  })
}

export async function restoreLatestAgentConversation(
  repository: AgentSessionRepository,
  mode: AIConversationMode,
): Promise<RestoredAgentConversation | null> {
  const sessions = await repository.listSessions()
  const conversations = sessions.filter(candidate => (
    candidate.metadata.kind === CONVERSATION_METADATA_KIND &&
    candidate.metadata.mode === mode
  ))
  const byId = new Map(conversations.map(session => [session.id, session]))
  const lineageDepth = (session: AgentSessionRecord): number => {
    let depth = 0
    let parentId = session.parentSessionId
    const visited = new Set<string>()
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId)
      const parent = byId.get(parentId)
      if (!parent) break
      depth += 1
      parentId = parent.parentSessionId
    }
    return depth
  }
  const session = conversations.sort((left, right) => (
    right.updatedAt.localeCompare(left.updatedAt) ||
    conversationOrder(right) - conversationOrder(left) ||
    lineageDepth(right) - lineageDepth(left) ||
    right.createdAt.localeCompare(left.createdAt) ||
    right.id.localeCompare(left.id)
  ))[0]
  if (!session) return null

  const replay = await repository.loadReplay(session.id)
  const restored = replayConversationMessages(replay)
  return { session, ...restored }
}

export async function forkAgentConversationSession(
  repository: AgentSessionRepository,
  parent: AgentSessionRecord,
  messages: AIConversationMessage[],
  mode: AIConversationMode,
): Promise<AgentSessionRecord> {
  const child = await repository.forkSession(parent.id, parent.lastSequence, {
    title: parent.title,
    metadata: conversationMetadata(mode),
  })
  await repository.appendEvent(child.id, {
    event: { kind: 'conversation.timeline', timeline: messages },
  })
  return (await repository.loadSession(child.id))?.session ?? child
}

export async function persistConversationTimeline(
  repository: AgentSessionRepository,
  sessionId: string,
  messages: AIConversationMessage[],
): Promise<AgentSessionRecord | null> {
  await repository.appendEvent(sessionId, {
    event: { kind: 'conversation.timeline', timeline: messages },
  })
  return (await repository.loadSession(sessionId))?.session ?? null
}
