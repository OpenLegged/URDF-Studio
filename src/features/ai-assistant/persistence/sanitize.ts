import type {
  AgentSessionEventInput,
  SerializableValue,
} from './types'

const SENSITIVE_KEYS = new Set([
  'apikey',
  'authorization',
  'accesstoken',
  'refreshtoken',
  'providertoken',
  'providerkey',
  'password',
  'secret',
])

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]'],
  [/\bsk-[A-Za-z0-9_-]{12,}/g, '[REDACTED_API_KEY]'],
  [/([?&](?:api[_-]?key|access[_-]?token)=)[^&#\s]+/gi, '$1[REDACTED]'],
]

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function redactText(value: string): string {
  return SECRET_PATTERNS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value,
  )
}

function sanitizeUnknown(value: unknown, seen: WeakSet<object>): SerializableValue {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') return redactText(value)
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    return null
  }
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  if (Array.isArray(value)) {
    const result = value.map(item => sanitizeUnknown(item, seen))
    seen.delete(value)
    return result
  }
  const result: Record<string, SerializableValue> = {}
  for (const [key, child] of Object.entries(value)) {
    result[key] = SENSITIVE_KEYS.has(normalizeKey(key))
      ? '[REDACTED]'
      : sanitizeUnknown(child, seen)
  }
  seen.delete(value)
  return result
}

/** Returns a JSON-safe clone with common provider secrets removed. */
export function sanitizeAgentSessionEvent(
  event: AgentSessionEventInput,
): AgentSessionEventInput {
  return sanitizeUnknown(event, new WeakSet()) as AgentSessionEventInput
}

export function sanitizeAgentSessionMetadata(
  metadata: Record<string, SerializableValue>,
): Record<string, SerializableValue> {
  return sanitizeUnknown(metadata, new WeakSet()) as Record<string, SerializableValue>
}
