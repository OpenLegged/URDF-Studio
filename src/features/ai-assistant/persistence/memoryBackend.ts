import type {
  AgentSessionEventRecord,
  AgentSessionRecord,
  AgentSessionSnapshot,
  AgentSessionStorageBackend,
  AppendAgentSessionEventInput,
} from './types'
import { AgentSessionPersistenceError } from './types'

function cloneValue<T>(value: T): T {
  return structuredClone(value)
}

/** In-memory backend used as a fail-safe and for deterministic tests. */
export class MemoryAgentSessionBackend implements AgentSessionStorageBackend {
  readonly mode = 'memory' as const
  private readonly sessions = new Map<string, AgentSessionRecord>()
  private readonly events = new Map<string, AgentSessionEventRecord[]>()

  async initialize(): Promise<void> {}

  async getSession(id: string): Promise<AgentSessionRecord | null> {
    const session = this.sessions.get(id)
    return session ? cloneValue(session) : null
  }

  async listSessions(): Promise<AgentSessionRecord[]> {
    return [...this.sessions.values()].map(cloneValue)
  }

  async loadSession(id: string): Promise<AgentSessionSnapshot | null> {
    const session = this.sessions.get(id)
    if (!session) return null
    return {
      session: cloneValue(session),
      events: cloneValue(this.events.get(id) ?? []),
    }
  }

  async putSession(session: AgentSessionRecord): Promise<void> {
    this.sessions.set(session.id, cloneValue(session))
    if (!this.events.has(session.id)) this.events.set(session.id, [])
  }

  async replaceSession(snapshot: AgentSessionSnapshot): Promise<void> {
    this.sessions.set(snapshot.session.id, cloneValue(snapshot.session))
    this.events.set(snapshot.session.id, cloneValue(snapshot.events))
  }

  async appendEvent(
    sessionId: string,
    input: AppendAgentSessionEventInput,
  ): Promise<AgentSessionEventRecord> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new AgentSessionPersistenceError(
        'session-not-found',
        `Agent session "${sessionId}" does not exist.`,
      )
    }
    const sequence = session.lastSequence + 1
    const record = {
      sessionId,
      sequence,
      timestamp: input.timestamp ?? new Date().toISOString(),
      event: cloneValue(input.event),
    }
    const events = this.events.get(sessionId) ?? []
    events.push(record)
    this.events.set(sessionId, events)
    this.sessions.set(sessionId, {
      ...session,
      updatedAt: record.timestamp,
      eventCount: session.eventCount + 1,
      lastSequence: sequence,
    })
    return cloneValue(record)
  }

  async deleteSession(id: string): Promise<boolean> {
    const deleted = this.sessions.delete(id)
    this.events.delete(id)
    return deleted
  }

  async clear(): Promise<void> {
    this.sessions.clear()
    this.events.clear()
  }
}
