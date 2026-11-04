import assert from 'node:assert/strict'
import test from 'node:test'

import { MemoryAgentSessionBackend } from './memoryBackend.ts'
import {
  AgentSessionRepository,
  createAgentSessionRepository,
} from './repository.ts'
import { AgentSessionPersistenceError, type AgentSessionSource } from './types.ts'

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

const productionSource: AgentSessionSource = {
  app: 'urdf-studio-pro',
  url: 'https://studio.example.com/zh/',
  environment: 'production',
  appVersion: '2.0.0',
  revision: 'production-revision',
  coreRevision: 'core-revision',
  builtAt: '2026-11-04T01:00:00.000Z',
  dirty: false,
}

test('captures session/event origins at write time and export origin separately', async () => {
  let source = structuredClone(productionSource)
  const repository = await createAgentSessionRepository({
    backend: new MemoryAgentSessionBackend(),
    sourceProvider: () => source,
  })
  await repository.createSession({ id: 'production' })
  await repository.appendEvent('production', {
    event: { kind: 'custom', name: 'scene.turn.started', data: {} },
  })
  source.revision = 'next-production-revision'
  await repository.appendEvent('production', {
    event: { kind: 'workspace.revision', revision: 'workspace-2' },
  })
  await repository.upsertSession({ id: 'production', metadata: { surface: 'scene' } })
  source = { ...source, environment: 'fat', url: 'https://studio-fat.example.com/' }
  const archive = await repository.exportArchive()
  assert.deepEqual(archive.exportedFrom, source)
  assert.deepEqual(archive.sessions[0].session.source, productionSource)
  assert.equal(archive.sessions[0].events[0].source?.revision, 'production-revision')
  assert.equal(archive.sessions[0].events[1].source?.revision, 'next-production-revision')
  assert.deepEqual(archive.sessions[0].events.map(event => event.sequence), [1, 2])
  assert.equal(archive.sessions[0].session.eventCount, 2)

  const imported = await repository.importArchive(archive)
  const id = imported.importedSessionIds[0]
  await repository.appendEvent(id, {
    event: { kind: 'workspace.revision', revision: 'workspace-3' },
  })
  const reexported = await repository.exportArchive([id])
  assert.deepEqual(reexported.sessions[0].session.source, productionSource)
  assert.deepEqual(reexported.sessions[0].events[0].source, productionSource)
  assert.deepEqual(reexported.sessions[0].events[2].source, source)
  assert.deepEqual((await repository.loadReplay(id))[0].source, productionSource)
  const fork = await repository.forkSession(id)
  assert.deepEqual(fork.source, source)
  assert.deepEqual((await repository.loadReplay(fork.id))[0].source, productionSource)
})

test('legacy imports stay unknown even when resumed and exported in another environment', async () => {
  const repository = await createAgentSessionRepository({
    indexedDB: null,
    sourceProvider: () => productionSource,
  })
  const legacy = {
    format: 'urdf-studio-agent-sessions', version: 1,
    sessions: [{
      session: { id: 'legacy', title: 'Historical scene' },
      events: [{ event: { kind: 'workspace.revision', revision: 'old' } }],
    }],
  }
  await repository.importArchive(legacy)
  await repository.appendEvent('legacy', {
    event: { kind: 'workspace.revision', revision: 'resumed' },
  })
  const archive = await repository.exportArchive()
  assert.deepEqual(archive.exportedFrom, productionSource)
  assert.equal(archive.sessions[0].session.source, null)
  assert.equal(archive.sessions[0].events[0].source, null)
  assert.deepEqual(archive.sessions[0].events[1].source, productionSource)
})

test('import validates provenance before writing and strips source URL credentials', async () => {
  const repository = await makeRepository()
  await repository.createSession({ id: 'source' })
  const archive = await repository.exportArchive()
  archive.sessions[0].session.source = {
    ...productionSource,
    url: 'https://name:password@studio.example.com/zh/?token=private#secret',
  }
  await repository.importArchive(archive)
  assert.equal((await repository.loadSession('source-imported'))?.session.source?.url,
    'https://studio.example.com/zh/')
  archive.sessions[0].session.source.url = 'javascript:alert(1)'
  await assert.rejects(repository.importArchive(archive), /Invalid agent session source URL/)
  assert.equal((await repository.listSessions()).length, 2)
})
