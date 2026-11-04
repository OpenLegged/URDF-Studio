import assert from 'node:assert/strict'
import test from 'node:test'
import { agentSessionSourceUrl, readAgentSessionSource } from './source.ts'

test('source URLs retain origin, port and path without login payloads', () => {
  assert.equal(agentSessionSourceUrl('https://user:pass@example.com:8443/zh/?sso=secret#token'),
    'https://example.com:8443/zh/')
  assert.equal(agentSessionSourceUrl('http://localhost:3000/?regressionDebug=1'),
    'http://localhost:3000/')
  assert.throws(() => agentSessionSourceUrl('file:///tmp/export.json'))
})

test('absent legacy source is unknown and malformed provenance is rejected', () => {
  assert.equal(readAgentSessionSource(undefined), null)
  assert.equal(readAgentSessionSource(null), null)
  for (const source of [[], 'production', {}, { app: 'pro', environment: 1 }]) {
    assert.throws(() => readAgentSessionSource(source), /Invalid agent session source/)
  }
})
