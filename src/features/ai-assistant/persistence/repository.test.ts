import assert from 'node:assert/strict'
import test from 'node:test'

import { MemoryAgentSessionBackend } from './memoryBackend.ts'
import {
  AgentSessionRepository,
  createAgentSessionRepository,
} from './repository.ts'
import { AgentSessionPersistenceError } from './types.ts'

async function makeRepository(): Promise<AgentSessionRepository> {
  const backend = new MemoryAgentSessionBackend()
  await backend.initialize()
  return new AgentSessionRepository(backend)
}

test('stores sessions and assigns append-only event sequences', async () => {
  const repository = await makeRepository()
  const session = await repository.createSession({ id: 's1', title: 'Robot edits' })

  const first = await repository.appendEvent(session.id, {
    timestamp: '2026-08-30T10:00:00.000Z',
    event: {
      kind: 'conversation.message',
      message: { kind: 'message', role: 'user', content: 'Widen the base.' },
    },
  })
  const second = await repository.appendEvent(session.id, {
    timestamp: '2026-08-30T10:00:01.000Z',
    event: {
      kind: 'context.checkpoint',
      turns: [{ role: 'assistant', content: 'Base width is now 0.6 m.' }],
    },
  })

  assert.equal(first.sequence, 1)
  assert.equal(second.sequence, 2)
  const loaded = await repository.loadSession(session.id)
  assert.equal(loaded?.session.eventCount, 2)
  assert.deepEqual(loaded?.events.map(event => event.sequence), [1, 2])

  const renamed = await repository.upsertSession({ id: session.id, title: 'Base work' })
  assert.equal(renamed.title, 'Base work')
  assert.equal(renamed.lastSequence, 2)
})

test('fork metadata resolves parent events into a replay without copying them', async () => {
  const repository = await makeRepository()
  const parent = await repository.createSession({ id: 'parent' })
  for (const content of ['one', 'two', 'three']) {
    await repository.appendEvent(parent.id, {
      event: {
        kind: 'conversation.message',
        message: { kind: 'message', role: 'user', content },
      },
    })
  }
  const child = await repository.forkSession(parent.id, 2, { id: 'child' })
  await repository.appendEvent(child.id, {
    event: { kind: 'workspace.revision', revision: 'revision-child' },
  })

  assert.equal(child.parentSessionId, parent.id)
  assert.equal(child.forkedAtSequence, 2)
  const replay = await repository.loadReplay(child.id)
  assert.deepEqual(replay.map(event => [event.sourceSessionId, event.sourceSequence]), [
    ['parent', 1],
    ['parent', 2],
    ['child', 1],
  ])
  assert.deepEqual(replay.map(event => event.replaySequence), [1, 2, 3])
})

test('redacts common API credentials before persistence', async () => {
  const repository = await makeRepository()
  const session = await repository.createSession({
    id: 'secrets',
    metadata: { apiKey: 'sk-should-never-persist-12345' },
  })
  await repository.appendEvent(session.id, {
    event: {
      kind: 'custom',
      name: 'provider-debug',
      data: {
        authorization: 'Bearer provider-token-123456',
        output: 'request used sk-example_credential123456789',
      },
    },
  })

  const serialized = JSON.stringify(await repository.loadSession(session.id))
  assert.doesNotMatch(serialized, /should-never-persist/)
  assert.doesNotMatch(serialized, /provider-token/)
  assert.doesNotMatch(serialized, /examplecredential/)
  assert.match(serialized, /REDACTED/)
})

test('exports and imports sessions while remapping conflicting fork lineage', async () => {
  const repository = await makeRepository()
  const parent = await repository.createSession({ id: 'root-session' })
  await repository.appendEvent(parent.id, {
    event: { kind: 'workspace.revision', revision: 'r1' },
  })
  await repository.forkSession(parent.id, 1, { id: 'fork-session' })
  const archive = await repository.exportArchive()

  const imported = await repository.importArchive(archive)
  assert.deepEqual(imported.renamedSessionIds, {
    'root-session': 'root-session-imported',
    'fork-session': 'fork-session-imported',
  })
  const importedChild = await repository.loadSession('fork-session-imported')
  assert.equal(importedChild?.session.parentSessionId, 'root-session-imported')

  const stats = await repository.getStorageStats()
  assert.equal(stats.persistence, 'memory')
  assert.equal(stats.sessionCount, 4)
  assert.equal(stats.eventCount, 2)
  assert.ok(stats.approximateBytes > 0)
})

test('delete and clear remove stored events together with their sessions', async () => {
  const repository = await makeRepository()
  const first = await repository.createSession({ id: 'first' })
  await repository.appendEvent(first.id, {
    event: { kind: 'workspace.revision', revision: 'r1' },
  })
  await repository.createSession({ id: 'second' })

  assert.equal(await repository.deleteSession(first.id), true)
  assert.equal(await repository.loadSession(first.id), null)
  await repository.clear()
  assert.deepEqual(await repository.listSessions(), [])
  assert.equal((await repository.getStorageStats()).approximateBytes, 0)
})

test('factory falls back to memory or reports unavailable persistence explicitly', async () => {
  const fallback = await createAgentSessionRepository({ indexedDB: null })
  assert.equal(fallback.persistenceMode, 'memory')

  await assert.rejects(
    createAgentSessionRepository({ indexedDB: null, fallbackToMemory: false }),
    (error: unknown) => (
      error instanceof AgentSessionPersistenceError
      && error.code === 'storage-unavailable'
    ),
  )
})
