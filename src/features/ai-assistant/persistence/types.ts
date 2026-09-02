import type { AgentRunEvent } from '../agentRuntimeTypes'
import type { AIConversationMessage } from '../types'

export type AgentSessionPersistenceMode = 'indexeddb' | 'memory'

export type SerializablePrimitive = string | number | boolean | null
export type SerializableValue =
  | SerializablePrimitive
  | SerializableValue[]
  | { [key: string]: SerializableValue }

export interface AgentSessionRecord {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  parentSessionId: string | null
  forkedAtSequence: number | null
  workspaceRevision: string | null
  eventCount: number
  lastSequence: number
  metadata: Record<string, SerializableValue>
}

export type AgentSessionEventInput =
  | {
      kind: 'conversation.message'
      message: AIConversationMessage
    }
  | {
      kind: 'conversation.timeline'
      timeline: AIConversationMessage[]
    }
  | {
      kind: 'run.event'
      runId: string
      event: AgentRunEvent
    }
  | {
      kind: 'context.checkpoint'
      turns: Array<{ role: 'user' | 'assistant'; content: string }>
    }
  | {
      kind: 'run.interrupted'
      runId: string
      reason: string
    }
  | {
      kind: 'workspace.revision'
      revision: string
    }
  | {
      kind: 'custom'
      name: string
      data: Record<string, SerializableValue>
    }

export interface AgentSessionEventRecord {
  sessionId: string
  sequence: number
  timestamp: string
  event: AgentSessionEventInput
}

export interface AgentSessionSnapshot {
  session: AgentSessionRecord
  events: AgentSessionEventRecord[]
}

export interface AgentSessionReplayEvent {
  replaySequence: number
  sourceSessionId: string
  sourceSequence: number
  timestamp: string
  event: AgentSessionEventInput
}

export interface CreateAgentSessionInput {
  id?: string
  title?: string
  parentSessionId?: string | null
  forkedAtSequence?: number | null
  workspaceRevision?: string | null
  metadata?: Record<string, SerializableValue>
}

export interface UpdateAgentSessionInput {
  id: string
  title?: string
  workspaceRevision?: string | null
  metadata?: Record<string, SerializableValue>
}

export interface AppendAgentSessionEventInput {
  timestamp?: string
  event: AgentSessionEventInput
}

export interface AgentSessionStorageStats {
  persistence: AgentSessionPersistenceMode
  sessionCount: number
  eventCount: number
  approximateBytes: number
}

export interface AgentSessionArchive {
  format: 'urdf-studio-agent-sessions'
  version: 1
  exportedAt: string
  sessions: AgentSessionSnapshot[]
}

export interface ImportAgentSessionArchiveOptions {
  conflict?: 'rename' | 'replace' | 'skip'
}

export interface ImportAgentSessionArchiveResult {
  importedSessionIds: string[]
  skippedSessionIds: string[]
  renamedSessionIds: Record<string, string>
}

export interface AgentSessionStorageBackend {
  readonly mode: AgentSessionPersistenceMode
  initialize(): Promise<void>
  getSession(id: string): Promise<AgentSessionRecord | null>
  listSessions(): Promise<AgentSessionRecord[]>
  loadSession(id: string): Promise<AgentSessionSnapshot | null>
  putSession(session: AgentSessionRecord): Promise<void>
  replaceSession(snapshot: AgentSessionSnapshot): Promise<void>
  appendEvent(
    sessionId: string,
    input: AppendAgentSessionEventInput,
  ): Promise<AgentSessionEventRecord>
  deleteSession(id: string): Promise<boolean>
  clear(): Promise<void>
}

export class AgentSessionPersistenceError extends Error {
  constructor(
    public readonly code:
      | 'storage-unavailable'
      | 'session-not-found'
      | 'invalid-archive'
      | 'invalid-fork-boundary',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'AgentSessionPersistenceError'
  }
}
