import { IndexedDbAgentSessionBackend } from './indexedDbBackend'
import { MemoryAgentSessionBackend } from './memoryBackend'
import {
  sanitizeAgentSessionEvent,
  sanitizeAgentSessionMetadata,
} from './sanitize'
import type {
  AgentSessionArchive,
  AgentSessionEventInput,
  AgentSessionEventRecord,
  AgentSessionRecord,
  AgentSessionReplayEvent,
  AgentSessionSnapshot,
  AgentSessionStorageBackend,
  AgentSessionStorageStats,
  AppendAgentSessionEventInput,
  CreateAgentSessionInput,
  ImportAgentSessionArchiveOptions,
  ImportAgentSessionArchiveResult,
  SerializableValue,
  UpdateAgentSessionInput,
} from './types'
import { AgentSessionPersistenceError } from './types'

export interface CreateAgentSessionRepositoryOptions {
  backend?: AgentSessionStorageBackend
  indexedDB?: IDBFactory | null
  fallbackToMemory?: boolean
}

const ARCHIVE_FORMAT = 'urdf-studio-agent-sessions'
const EVENT_KINDS = new Set([
  'conversation.message',
  'conversation.timeline',
  'run.event',
  'context.checkpoint',
  'run.interrupted',
  'workspace.revision',
  'custom',
])

function createId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function utf8ByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEventInput(value: unknown): value is AgentSessionEventInput {
  return isRecord(value) && typeof value.kind === 'string' && EVENT_KINDS.has(value.kind)
}

function readSession(value: unknown): AgentSessionRecord {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.title !== 'string') {
    throw new AgentSessionPersistenceError('invalid-archive', 'Archive contains an invalid session.')
  }
  const metadata = isRecord(value.metadata)
    ? sanitizeAgentSessionMetadata(value.metadata as Record<string, SerializableValue>)
    : {}
  return {
    id: value.id,
    title: value.title,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
    parentSessionId: typeof value.parentSessionId === 'string' ? value.parentSessionId : null,
    forkedAtSequence: Number.isInteger(value.forkedAtSequence)
      ? Number(value.forkedAtSequence)
      : null,
    workspaceRevision: typeof value.workspaceRevision === 'string'
      ? value.workspaceRevision
      : null,
    eventCount: 0,
    lastSequence: 0,
    metadata,
  }
}

function readEvents(value: unknown, sessionId: string): AgentSessionEventRecord[] {
  if (!Array.isArray(value)) {
    throw new AgentSessionPersistenceError('invalid-archive', 'Session events must be an array.')
  }
  const events = value.map((candidate, index) => {
    if (!isRecord(candidate) || !isEventInput(candidate.event)) {
      throw new AgentSessionPersistenceError('invalid-archive', 'Archive contains an invalid event.')
    }
    const sequence = index + 1
    return {
      sessionId,
      sequence,
      timestamp: typeof candidate.timestamp === 'string'
        ? candidate.timestamp
        : new Date().toISOString(),
      event: sanitizeAgentSessionEvent(candidate.event),
    }
  })
  return events
}

function readArchive(value: unknown): AgentSessionArchive {
  if (
    !isRecord(value)
    || value.format !== ARCHIVE_FORMAT
    || value.version !== 1
    || !Array.isArray(value.sessions)
  ) {
    throw new AgentSessionPersistenceError('invalid-archive', 'Unsupported agent session archive.')
  }
  const sessions = value.sessions.map(candidate => {
    if (!isRecord(candidate)) {
      throw new AgentSessionPersistenceError('invalid-archive', 'Archive contains an invalid snapshot.')
    }
    const session = readSession(candidate.session)
    const events = readEvents(candidate.events, session.id)
    session.eventCount = events.length
    session.lastSequence = events.length
    return { session, events }
  })
  return {
    format: ARCHIVE_FORMAT,
    version: 1,
    exportedAt: typeof value.exportedAt === 'string'
      ? value.exportedAt
      : new Date().toISOString(),
    sessions,
  }
}

function uniqueImportedId(id: string, reserved: Set<string>): string {
  let suffix = 1
  let candidate = `${id}-imported`
  while (reserved.has(candidate)) {
    suffix += 1
    candidate = `${id}-imported-${suffix}`
  }
  return candidate
}

/** Browser-local append-only Agent session repository. */
export class AgentSessionRepository {
  constructor(private readonly backend: AgentSessionStorageBackend) {}

  get persistenceMode(): AgentSessionStorageBackend['mode'] {
    return this.backend.mode
  }

  async createSession(input: CreateAgentSessionInput = {}): Promise<AgentSessionRecord> {
    const id = input.id ?? createId()
    const existing = await this.backend.getSession(id)
    if (existing) {
      throw new Error(`Agent session "${id}" already exists.`)
    }
    const now = new Date().toISOString()
    const session: AgentSessionRecord = {
      id,
      title: input.title?.trim() || 'New conversation',
      createdAt: now,
      updatedAt: now,
      parentSessionId: input.parentSessionId ?? null,
      forkedAtSequence: input.forkedAtSequence ?? null,
      workspaceRevision: input.workspaceRevision ?? null,
      eventCount: 0,
      lastSequence: 0,
      metadata: sanitizeAgentSessionMetadata(input.metadata ?? {}),
    }
    await this.backend.putSession(session)
    return session
  }

  async upsertSession(input: UpdateAgentSessionInput): Promise<AgentSessionRecord> {
    const existing = await this.backend.getSession(input.id)
    if (!existing) {
      return this.createSession({
        id: input.id,
        title: input.title,
        workspaceRevision: input.workspaceRevision,
        metadata: input.metadata,
      })
    }
    const next = {
      ...existing,
      title: input.title?.trim() || existing.title,
      workspaceRevision: input.workspaceRevision === undefined
        ? existing.workspaceRevision
        : input.workspaceRevision,
      metadata: input.metadata === undefined
        ? existing.metadata
        : sanitizeAgentSessionMetadata(input.metadata),
      updatedAt: new Date().toISOString(),
    }
    await this.backend.putSession(next)
    return next
  }

  async forkSession(
    parentSessionId: string,
    forkedAtSequence?: number,
    input: Omit<CreateAgentSessionInput, 'parentSessionId' | 'forkedAtSequence'> = {},
  ): Promise<AgentSessionRecord> {
    const parent = await this.requireSession(parentSessionId)
    const boundary = forkedAtSequence ?? parent.lastSequence
    if (!Number.isInteger(boundary) || boundary < 0 || boundary > parent.lastSequence) {
      throw new AgentSessionPersistenceError(
        'invalid-fork-boundary',
        `Fork boundary ${boundary} is outside session "${parentSessionId}".`,
      )
    }
    return this.createSession({
      ...input,
      title: input.title ?? `${parent.title} (fork)`,
      parentSessionId,
      forkedAtSequence: boundary,
    })
  }

  async listSessions(): Promise<AgentSessionRecord[]> {
    const sessions = await this.backend.listSessions()
    return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  async loadSession(id: string): Promise<AgentSessionSnapshot | null> {
    return this.backend.loadSession(id)
  }

  /** Resolves a fork lineage into a read-only, deterministic replay stream. */
  async loadReplay(id: string): Promise<AgentSessionReplayEvent[]> {
    const events = await this.loadReplayLineage(id, new Set())
    return events.map((event, index) => ({ ...event, replaySequence: index + 1 }))
  }

  async appendEvent(
    sessionId: string,
    input: AppendAgentSessionEventInput,
  ): Promise<AgentSessionEventRecord> {
    return this.backend.appendEvent(sessionId, {
      ...input,
      event: sanitizeAgentSessionEvent(input.event),
    })
  }

  async deleteSession(id: string): Promise<boolean> {
    return this.backend.deleteSession(id)
  }

  async clear(): Promise<void> {
    await this.backend.clear()
  }

  async getStorageStats(): Promise<AgentSessionStorageStats> {
    const sessions = await this.listSessions()
    const snapshots = await Promise.all(sessions.map(session => this.backend.loadSession(session.id)))
    const existingSnapshots = snapshots.filter(snapshot => snapshot !== null)
    return {
      persistence: this.backend.mode,
      sessionCount: sessions.length,
      eventCount: sessions.reduce((total, session) => total + session.eventCount, 0),
      approximateBytes: existingSnapshots.length > 0
        ? utf8ByteLength(existingSnapshots)
        : 0,
    }
  }

  async exportArchive(sessionIds?: string[]): Promise<AgentSessionArchive> {
    const ids = sessionIds ?? (await this.listSessions()).map(session => session.id)
    const snapshots = await Promise.all(ids.map(id => this.backend.loadSession(id)))
    return {
      format: ARCHIVE_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      sessions: snapshots.filter(snapshot => snapshot !== null),
    }
  }

  async importArchive(
    archiveValue: unknown,
    options: ImportAgentSessionArchiveOptions = {},
  ): Promise<ImportAgentSessionArchiveResult> {
    const archive = readArchive(archiveValue)
    const conflict = options.conflict ?? 'rename'
    const existingIds = new Set((await this.listSessions()).map(session => session.id))
    const idMap = new Map<string, string>()
    for (const snapshot of archive.sessions) {
      const id = existingIds.has(snapshot.session.id) && conflict === 'rename'
        ? uniqueImportedId(snapshot.session.id, existingIds)
        : snapshot.session.id
      idMap.set(snapshot.session.id, id)
      existingIds.add(id)
    }
    return this.writeImportedSessions(archive.sessions, idMap, conflict)
  }

  private async writeImportedSessions(
    snapshots: AgentSessionSnapshot[],
    idMap: Map<string, string>,
    conflict: NonNullable<ImportAgentSessionArchiveOptions['conflict']>,
  ): Promise<ImportAgentSessionArchiveResult> {
    const result: ImportAgentSessionArchiveResult = {
      importedSessionIds: [],
      skippedSessionIds: [],
      renamedSessionIds: {},
    }
    for (const snapshot of snapshots) {
      const sourceId = snapshot.session.id
      const exists = await this.backend.getSession(sourceId)
      if (exists && conflict === 'skip') {
        result.skippedSessionIds.push(sourceId)
        continue
      }
      const targetId = idMap.get(sourceId) ?? sourceId
      const parentSessionId = snapshot.session.parentSessionId
      const imported = {
        session: {
          ...snapshot.session,
          id: targetId,
          parentSessionId: parentSessionId ? idMap.get(parentSessionId) ?? parentSessionId : null,
        },
        events: snapshot.events.map(event => ({ ...event, sessionId: targetId })),
      }
      await this.backend.replaceSession(imported)
      result.importedSessionIds.push(targetId)
      if (targetId !== sourceId) result.renamedSessionIds[sourceId] = targetId
    }
    return result
  }

  private async requireSession(id: string): Promise<AgentSessionRecord> {
    const session = await this.backend.getSession(id)
    if (session) return session
    throw new AgentSessionPersistenceError(
      'session-not-found',
      `Agent session "${id}" does not exist.`,
    )
  }

  private async loadReplayLineage(
    id: string,
    ancestry: Set<string>,
  ): Promise<Array<Omit<AgentSessionReplayEvent, 'replaySequence'>>> {
    if (ancestry.has(id)) {
      throw new AgentSessionPersistenceError('invalid-archive', 'Session fork lineage is cyclic.')
    }
    const snapshot = await this.backend.loadSession(id)
    if (!snapshot) {
      throw new AgentSessionPersistenceError(
        'session-not-found',
        `Agent session "${id}" does not exist.`,
      )
    }
    const nextAncestry = new Set(ancestry).add(id)
    let lineage: Array<Omit<AgentSessionReplayEvent, 'replaySequence'>> = []
    if (snapshot.session.parentSessionId) {
      const boundary = snapshot.session.forkedAtSequence ?? 0
      const parentId = snapshot.session.parentSessionId
      const parentLineage = await this.loadReplayLineage(parentId, nextAncestry)
      lineage = parentLineage.filter(event => (
        event.sourceSessionId !== parentId || event.sourceSequence <= boundary
      ))
    }
    return lineage.concat(snapshot.events.map(event => ({
      sourceSessionId: id,
      sourceSequence: event.sequence,
      timestamp: event.timestamp,
      event: event.event,
    })))
  }
}

/** Opens IndexedDB, falling back to an ephemeral repository when unavailable. */
export async function createAgentSessionRepository(
  options: CreateAgentSessionRepositoryOptions = {},
): Promise<AgentSessionRepository> {
  if (options.backend) {
    await options.backend.initialize()
    return new AgentSessionRepository(options.backend)
  }
  const indexedDBFactory = options.indexedDB === undefined
    ? globalThis.indexedDB
    : options.indexedDB
  if (indexedDBFactory) {
    const backend = new IndexedDbAgentSessionBackend(indexedDBFactory)
    try {
      await backend.initialize()
      return new AgentSessionRepository(backend)
    } catch (error) {
      if (options.fallbackToMemory === false) {
        throw new AgentSessionPersistenceError(
          'storage-unavailable',
          'Unable to initialize browser Agent session storage.',
          { cause: error },
        )
      }
    }
  } else if (options.fallbackToMemory === false) {
    throw new AgentSessionPersistenceError(
      'storage-unavailable',
      'IndexedDB is unavailable in this environment.',
    )
  }
  const backend = new MemoryAgentSessionBackend()
  await backend.initialize()
  return new AgentSessionRepository(backend)
}
