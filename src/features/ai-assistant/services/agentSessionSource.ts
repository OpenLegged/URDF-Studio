import { agentSessionSourceUrl } from '../persistence/source'
import type { AgentSessionSource } from '../persistence/types'

/** Capture the executing frontend, not a domain-derived guess at its deployment mode. */
export function captureAgentSessionSource(): AgentSessionSource {
  const build = typeof __APP_BUILD__ === 'undefined' ? null : __APP_BUILD__
  return {
    app: build?.app ?? 'unknown',
    url: typeof window === 'undefined' ? null : agentSessionSourceUrl(window.location.href),
    environment: import.meta.env?.MODE ?? 'unknown',
    appVersion: typeof __APP_VERSION__ === 'undefined' ? null : __APP_VERSION__,
    revision: build?.revision ?? null,
    coreRevision: build?.coreRevision ?? null,
    builtAt: build?.builtAt ?? null,
    dirty: build?.dirty ?? null,
  }
}
