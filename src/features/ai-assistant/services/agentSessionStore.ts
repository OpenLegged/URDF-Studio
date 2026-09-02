import {
  createAgentSessionRepository,
  type AgentSessionArchive,
  type AgentSessionRepository,
  type AgentSessionStorageStats,
  type ImportAgentSessionArchiveResult,
} from '../persistence'

export type AgentSessionStoreChange = 'cleared' | 'imported'

const AGENT_SESSION_CHANNEL = 'urdf-studio-agent-session-store'
const listeners = new Set<(change: AgentSessionStoreChange) => void>()
let repositoryPromise: Promise<AgentSessionRepository> | null = null
let broadcastChannel: BroadcastChannel | null = null
let repositoryScope: Window | typeof globalThis | null = null

function getBroadcastChannel(): BroadcastChannel | null {
  if (
    broadcastChannel ||
    typeof window === 'undefined' ||
    typeof window.BroadcastChannel === 'undefined'
  ) {
    return broadcastChannel
  }

  broadcastChannel = new window.BroadcastChannel(AGENT_SESSION_CHANNEL)
  broadcastChannel.onmessage = (event: MessageEvent<AgentSessionStoreChange>) => {
    if (event.data === 'cleared' || event.data === 'imported') {
      listeners.forEach(listener => listener(event.data))
    }
  }
  return broadcastChannel
}

function publishChange(change: AgentSessionStoreChange): void {
  listeners.forEach(listener => listener(change))
  getBroadcastChannel()?.postMessage(change)
}

/** Returns the shared browser-local repository used by the Agent and settings UI. */
export function getAgentSessionRepository(): Promise<AgentSessionRepository> {
  const currentScope = typeof window === 'undefined' ? globalThis : window
  if (repositoryScope !== currentScope) {
    repositoryScope = currentScope
    repositoryPromise = null
    broadcastChannel?.close()
    broadcastChannel = null
  }
  repositoryPromise ??= createAgentSessionRepository()
  return repositoryPromise
}

export function subscribeAgentSessionStore(
  listener: (change: AgentSessionStoreChange) => void,
): () => void {
  listeners.add(listener)
  getBroadcastChannel()
  return () => listeners.delete(listener)
}

export async function getAgentSessionStorageStats(): Promise<AgentSessionStorageStats> {
  return (await getAgentSessionRepository()).getStorageStats()
}

export async function exportAgentSessionArchive(): Promise<AgentSessionArchive> {
  return (await getAgentSessionRepository()).exportArchive()
}

export async function importAgentSessionArchive(
  archive: unknown,
): Promise<ImportAgentSessionArchiveResult> {
  const result = await (await getAgentSessionRepository()).importArchive(archive)
  publishChange('imported')
  return result
}

export async function clearAgentSessionStore(): Promise<void> {
  await (await getAgentSessionRepository()).clear()
  publishChange('cleared')
}
