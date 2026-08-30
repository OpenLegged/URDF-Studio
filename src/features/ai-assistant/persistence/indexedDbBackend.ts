import type {
  AgentSessionEventRecord,
  AgentSessionRecord,
  AgentSessionSnapshot,
  AgentSessionStorageBackend,
  AppendAgentSessionEventInput,
} from './types'
import { AgentSessionPersistenceError } from './types'

const DATABASE_NAME = 'urdf-studio-agent-sessions'
const DATABASE_VERSION = 1
const SESSION_STORE = 'sessions'
const EVENT_STORE = 'events'

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'))
  })
}

function sessionEventRange(sessionId: string): IDBKeyRange {
  return IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER])
}

/** IndexedDB backend. Event append and sequence allocation share one transaction. */
export class IndexedDbAgentSessionBackend implements AgentSessionStorageBackend {
  readonly mode = 'indexeddb' as const
  private databasePromise: Promise<IDBDatabase> | null = null

  constructor(private readonly indexedDBFactory: IDBFactory) {}

  async initialize(): Promise<void> {
    await this.database()
  }

  private database(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise
    this.databasePromise = new Promise((resolve, reject) => {
      const request = this.indexedDBFactory.open(DATABASE_NAME, DATABASE_VERSION)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(SESSION_STORE)) {
          database.createObjectStore(SESSION_STORE, { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains(EVENT_STORE)) {
          database.createObjectStore(EVENT_STORE, {
            keyPath: ['sessionId', 'sequence'],
          })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Unable to open IndexedDB.'))
      request.onblocked = () => reject(new Error('IndexedDB upgrade is blocked.'))
    })
    return this.databasePromise
  }

  async getSession(id: string): Promise<AgentSessionRecord | null> {
    const database = await this.database()
    const transaction = database.transaction(SESSION_STORE, 'readonly')
    const value = await requestResult(
      transaction.objectStore(SESSION_STORE).get(id) as IDBRequest<AgentSessionRecord | undefined>,
    )
    await transactionDone(transaction)
    return value ?? null
  }

  async listSessions(): Promise<AgentSessionRecord[]> {
    const database = await this.database()
    const transaction = database.transaction(SESSION_STORE, 'readonly')
    const values = await requestResult(
      transaction.objectStore(SESSION_STORE).getAll() as IDBRequest<AgentSessionRecord[]>,
    )
    await transactionDone(transaction)
    return values
  }

  async loadSession(id: string): Promise<AgentSessionSnapshot | null> {
    const database = await this.database()
    const transaction = database.transaction([SESSION_STORE, EVENT_STORE], 'readonly')
    const sessionRequest = transaction.objectStore(SESSION_STORE).get(id) as IDBRequest<
      AgentSessionRecord | undefined
    >
    const eventsRequest = transaction
      .objectStore(EVENT_STORE)
      .getAll(sessionEventRange(id)) as IDBRequest<AgentSessionEventRecord[]>
    const [session, events] = await Promise.all([
      requestResult(sessionRequest),
      requestResult(eventsRequest),
    ])
    await transactionDone(transaction)
    return session ? { session, events } : null
  }

  async putSession(session: AgentSessionRecord): Promise<void> {
    const database = await this.database()
    const transaction = database.transaction(SESSION_STORE, 'readwrite')
    transaction.objectStore(SESSION_STORE).put(session)
    await transactionDone(transaction)
  }

  async replaceSession(snapshot: AgentSessionSnapshot): Promise<void> {
    const database = await this.database()
    const transaction = database.transaction([SESSION_STORE, EVENT_STORE], 'readwrite')
    const sessions = transaction.objectStore(SESSION_STORE)
    const events = transaction.objectStore(EVENT_STORE)
    events.delete(sessionEventRange(snapshot.session.id))
    sessions.put(snapshot.session)
    for (const event of snapshot.events) events.put(event)
    await transactionDone(transaction)
  }

  async appendEvent(
    sessionId: string,
    input: AppendAgentSessionEventInput,
  ): Promise<AgentSessionEventRecord> {
    const database = await this.database()
    const transaction = database.transaction([SESSION_STORE, EVENT_STORE], 'readwrite')
    const sessions = transaction.objectStore(SESSION_STORE)
    const session = await requestResult(
      sessions.get(sessionId) as IDBRequest<AgentSessionRecord | undefined>,
    )
    if (!session) {
      transaction.abort()
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
      event: input.event,
    }
    transaction.objectStore(EVENT_STORE).add(record)
    sessions.put({
      ...session,
      updatedAt: record.timestamp,
      eventCount: session.eventCount + 1,
      lastSequence: sequence,
    })
    await transactionDone(transaction)
    return record
  }

  async deleteSession(id: string): Promise<boolean> {
    const existing = await this.getSession(id)
    if (!existing) return false
    const database = await this.database()
    const transaction = database.transaction([SESSION_STORE, EVENT_STORE], 'readwrite')
    transaction.objectStore(SESSION_STORE).delete(id)
    transaction.objectStore(EVENT_STORE).delete(sessionEventRange(id))
    await transactionDone(transaction)
    return true
  }

  async clear(): Promise<void> {
    const database = await this.database()
    const transaction = database.transaction([SESSION_STORE, EVENT_STORE], 'readwrite')
    transaction.objectStore(SESSION_STORE).clear()
    transaction.objectStore(EVENT_STORE).clear()
    await transactionDone(transaction)
  }
}
