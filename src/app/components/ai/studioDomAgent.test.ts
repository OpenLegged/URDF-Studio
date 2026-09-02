import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'

import { createStudioDomAgent } from './studioDomAgent.ts'

function createDocument(): Document {
  return new JSDOM(`<!doctype html><html><body>
    <h1>URDF Studio</h1>
    <button aria-label="Run inspection">Run</button>
    <button>Export URDF</button>
    <label for="robot-name">Robot name</label>
    <input id="robot-name" value="arm" />
    <input id="api-key" aria-label="API key" value="secret-value" />
    <select aria-label="Projection">
      <option value="perspective">Perspective</option>
      <option value="orthographic">Orthographic</option>
    </select>
    <div role="alert">Invalid joint limit</div>
    <div data-testid="details-panel">Details</div>
    <a href="https://example.com">External help</a>
    <div data-studio-agent-exclude="true"><button>Agent send</button></div>
  </body></html>`, { url: 'http://localhost/' }).window.document
}

test('Studio DOM agent exposes bounded semantic element snapshots', () => {
  const document = createDocument()
  for (let index = 0; index < 60; index += 1) {
    const button = document.createElement('button')
    button.textContent = `Bulk action ${index}`
    document.body.append(button)
  }
  const agent = createStudioDomAgent(document)

  const interactive = agent.readElements({ kind: 'interactive', limit: 20 }, {})
  assert.equal(interactive.elements.some(element => element.name === 'Run inspection'), true)
  assert.equal(interactive.elements.some(element => element.name === 'Agent send'), false)
  assert.equal(
    interactive.elements.find(element => element.name === 'API key')?.value,
    '[redacted]',
  )

  const status = agent.readElements({ kind: 'status' }, {})
  assert.equal(status.elements.some(element => element.name === 'Invalid joint limit'), true)

  const all = agent.readElements({ kind: 'all', query: 'details-panel', limit: 1 }, {})
  assert.equal(all.total, 1)
  assert.equal(all.elements[0]?.testId, 'details-panel')
  assert.equal(all.nextCursor, null)

  const defaultPage = agent.readElements({ kind: 'interactive', query: 'Bulk action' }, {})
  assert.equal(defaultPage.elements.length, 20)
  assert.equal(defaultPage.total, 60)
  assert.equal(defaultPage.nextCursor, 20)
  const clampedPage = agent.readElements({
    kind: 'interactive',
    query: 'Bulk action',
    limit: 100,
  }, {})
  assert.equal(clampedPage.elements.length, 40)
})

test('Studio DOM agent performs semantic interactions without coordinates', () => {
  const document = createDocument()
  const agent = createStudioDomAgent(document)
  let clickCount = 0
  let inputEventCount = 0
  document.querySelector('button')?.addEventListener('click', () => {
    clickCount += 1
  })
  document.querySelector('#robot-name')?.addEventListener('input', () => {
    inputEventCount += 1
  })

  const page = agent.readElements({ kind: 'interactive', limit: 20 }, {})
  const button = page.elements.find(element => element.name === 'Run inspection')
  const robotName = page.elements.find(element => element.name === 'Robot name')
  const projection = page.elements.find(element => element.name === 'Projection')
  const apiKey = page.elements.find(element => element.name === 'API key')
  const external = page.elements.find(element => element.name === 'External help')
  const exportButton = page.elements.find(element => element.name === 'Export URDF')
  assert.ok(button && robotName && projection && apiKey && external && exportButton)

  assert.equal(agent.interactWithElement({
    elementId: button.elementId,
    operation: 'click',
  }, {}).ok, true)
  assert.equal(clickCount, 1)

  assert.equal(agent.interactWithElement({
    query: 'Run inspection',
    operation: 'click',
  }, {}).ok, true)
  assert.equal(clickCount, 2)

  assert.equal(agent.interactWithElement({
    elementId: robotName.elementId,
    operation: 'set-value',
    value: 'mobile-arm',
  }, {}).ok, true)
  assert.equal((document.querySelector('#robot-name') as HTMLInputElement).value, 'mobile-arm')
  assert.equal(inputEventCount, 1)

  assert.equal(agent.interactWithElement({
    elementId: projection.elementId,
    operation: 'select-option',
    value: 'orthographic',
  }, {}).ok, true)
  assert.equal((document.querySelector('select') as HTMLSelectElement).value, 'orthographic')

  assert.equal(agent.interactWithElement({
    elementId: apiKey.elementId,
    operation: 'set-value',
    value: 'stolen',
  }, {}).ok, false)
  assert.equal(agent.interactWithElement({
    elementId: external.elementId,
    operation: 'click',
  }, {}).ok, false)
  assert.equal(agent.interactWithElement({
    elementId: exportButton.elementId,
    operation: 'click',
  }, {}).ok, false)

  const duplicate = document.createElement('button')
  duplicate.setAttribute('aria-label', 'Run inspection')
  document.body.append(duplicate)
  const ambiguous = agent.interactWithElement({
    query: 'Run inspection',
    operation: 'click',
  }, {})
  assert.equal(ambiguous.ok, false)
  assert.match(ambiguous.message, /matched 2 elements/)
})

test('Studio DOM element ids reject stale elements', () => {
  const document = createDocument()
  const agent = createStudioDomAgent(document)
  const page = agent.readElements({ kind: 'interactive' }, {})
  const button = page.elements.find(element => element.name === 'Run inspection')
  assert.ok(button)
  document.querySelector('button')?.remove()

  const result = agent.interactWithElement({
    elementId: button.elementId,
    operation: 'click',
  }, {})
  assert.equal(result.ok, false)
  assert.match(result.message, /stale/i)
})
