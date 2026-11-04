import { AgentSessionPersistenceError, type AgentSessionSource } from './types'

/** Keep only the browser origin and pathname; query/fragment/userinfo are not provenance. */
export function agentSessionSourceUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('Agent session source URL must use HTTP or HTTPS.')
  }
  return `${url.origin}${url.pathname}`
}

/** Missing legacy provenance stays unknown. Never infer it from the importing browser. */
export function readAgentSessionSource(value: unknown): AgentSessionSource | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentSessionPersistenceError('invalid-archive', 'Invalid agent session source.')
  }
  const source = value as Record<string, unknown>
  const nullableStrings = ['url', 'appVersion', 'revision', 'coreRevision', 'builtAt'] as const
  if (
    typeof source.app !== 'string' || !source.app.trim()
    || typeof source.environment !== 'string' || !source.environment.trim()
    || nullableStrings.some(key => source[key] !== null && typeof source[key] !== 'string')
    || (source.dirty !== null && typeof source.dirty !== 'boolean')
  ) {
    throw new AgentSessionPersistenceError('invalid-archive', 'Invalid agent session source fields.')
  }
  let url: string | null = null
  if (typeof source.url === 'string') {
    try {
      url = agentSessionSourceUrl(source.url)
    } catch (cause) {
      throw new AgentSessionPersistenceError('invalid-archive', 'Invalid agent session source URL.', { cause })
    }
  }
  return {
    app: source.app,
    environment: source.environment,
    url,
    appVersion: source.appVersion as string | null,
    revision: source.revision as string | null,
    coreRevision: source.coreRevision as string | null,
    builtAt: source.builtAt as string | null,
    dirty: source.dirty as boolean | null,
  }
}
