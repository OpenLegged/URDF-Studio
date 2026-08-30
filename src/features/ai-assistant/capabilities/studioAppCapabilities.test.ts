import assert from 'node:assert/strict'
import test from 'node:test'

import type { RobotData } from '@/types'
import { buildStudioAppCapabilities } from './studioAppCapabilities.ts'
import type { AgentCapability } from './types.ts'
import type { StudioAgentPorts } from '../studioAppControl.ts'

const draft = { name: 'test', rootLinkId: '', links: {}, joints: {} } satisfies RobotData

function createPorts() {
  const calls: string[] = []
  const ports: StudioAgentPorts = {
    readState: () => ({
      workspaceName: 'workspace',
      activeComponentId: 'arm',
      components: [{
        id: 'arm',
        name: 'Arm',
        visible: true,
        linkIds: ['base_link'],
        jointIds: [],
      }],
      bridgeIds: [],
      selection: null,
      focusTarget: null,
      view: { showGrid: true },
      panels: {
        leftSidebarOpen: true,
        rightSidebarOpen: true,
        optionsPanelOpen: true,
        jointPanelOpen: true,
        propertyTab: 'visual',
      },
    }),
    selectEntity: (target, options) => {
      calls.push(`select:${target.type}:${options.focus}`)
      return { ok: true, message: 'selected' }
    },
    focusEntity: (target, durationMs) => {
      calls.push(`focus:${target.type}:${durationMs}`)
      return { ok: true, message: 'focused' }
    },
    configureView: patch => {
      calls.push(`view:${JSON.stringify(patch)}`)
      return { ok: true, message: 'view configured' }
    },
    configurePanels: patch => {
      calls.push(`panels:${JSON.stringify(patch)}`)
      return { ok: true, message: 'panels configured' }
    },
    readElements: query => {
      calls.push(`elements:${query.kind ?? 'interactive'}`)
      return {
        elements: [{ elementId: 'ui-1', tag: 'button', role: 'button', name: 'Export' }],
        total: 1,
        nextCursor: null,
      }
    },
    interactWithElement: interaction => {
      calls.push(`interact:${interaction.elementId ?? interaction.query}:${interaction.operation}`)
      return { ok: true, message: 'element operated' }
    },
    openWorkflow: workflow => {
      calls.push(`workflow:${workflow}`)
      return { ok: true, message: 'opened' }
    },
  }
  return { ports, calls }
}

function findCapability(capabilities: AgentCapability[], name: string): AgentCapability {
  const capability = capabilities.find(candidate => candidate.name === name)
  assert.ok(capability, `expected ${name} capability`)
  return capability
}

test('Studio capabilities inspect state and execute semantic app commands', async () => {
  const { ports, calls } = createPorts()
  const capabilities = buildStudioAppCapabilities(ports, { editableComponentId: 'arm' })
  assert.deepEqual(capabilities.map(capability => capability.name), ['studio'])
  const studio = findCapability(capabilities, 'studio')
  assert.ok(JSON.stringify(studio.parameters).length < 400, 'Studio tool schema must stay compact')
  assert.equal(
    (studio.parameters.properties as Record<string, Record<string, unknown>>).input?.properties,
    undefined,
  )

  const help = await studio.execute(draft, {
    action: 'help',
    input: { for: 'elements' },
  }, {})
  assert.deepEqual(JSON.parse(help.message), {
    elements: '{kind?: interactive|status|all, query?, cursor?, limit?: 1..40}',
  })

  const inspect = await studio.execute(draft, { action: 'inspect' }, {})
  assert.equal(inspect.ok, true)
  assert.equal(inspect.effect, 'read')
  assert.match(inspect.message, /"workspaceName":"workspace"/)

  const select = await studio.execute(draft, {
    action: 'select',
    input: { type: 'link', componentId: 'arm', entityId: 'base_link' },
  }, {})
  assert.equal(select.ok, true)
  assert.equal(select.effect, 'app-command')
  assert.deepEqual(calls, ['select:link:true'])

  const view = await studio.execute(draft, {
    action: 'view',
    input: { showCollision: true, cameraProjection: 'orthographic' },
  }, {})
  assert.equal(view.ok, true)
  assert.equal(calls.at(-1), 'view:{"showCollision":true,"cameraProjection":"orthographic"}')

  const elements = await studio.execute(draft, {
    action: 'elements',
    input: { kind: 'interactive', query: 'export' },
  }, {})
  assert.equal(elements.effect, 'read')
  assert.match(elements.message, /"elementId":"ui-1"/)

  const interact = await studio.execute(draft, {
    action: 'interact',
    input: { query: 'Export', operation: 'click' },
  }, {})
  assert.equal(interact.ok, true)
  assert.equal(calls.at(-1), 'interact:Export:click')
})

test('Studio capabilities reject invalid arguments before dispatch', async () => {
  const { ports, calls } = createPorts()
  const capabilities = buildStudioAppCapabilities(ports, { editableComponentId: 'arm' })
  const studio = findCapability(capabilities, 'studio')

  const invalidTarget = await studio.execute(
    draft,
    { action: 'select', input: { type: 'link', entityId: 'base_link' } },
    {},
  )
  const invalidView = await studio.execute(
    draft,
    { action: 'view', input: { modelOpacity: 2 } },
    {},
  )
  const oversizedPage = await studio.execute(
    draft,
    { action: 'elements', input: { limit: 41 } },
    {},
  )

  assert.equal(invalidTarget.ok, false)
  assert.equal(invalidView.ok, false)
  assert.equal(oversizedPage.ok, false)
  assert.deepEqual(calls, [])
})

test('selecting another component blocks draft mutation for the rest of the run', async () => {
  const { ports } = createPorts()
  const capabilities = buildStudioAppCapabilities(ports, { editableComponentId: 'arm' })

  const result = await findCapability(capabilities, 'studio').execute(draft, {
    action: 'select',
    input: { type: 'component', componentId: 'gripper' },
  }, {})

  assert.equal(result.ok, true)
  assert.equal(result.blocksDraftMutation, true)
  assert.match(result.message, /editing draft remains scoped to component arm/)
})
