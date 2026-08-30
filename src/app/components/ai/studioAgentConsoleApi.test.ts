import assert from 'node:assert/strict'
import test from 'node:test'

import type { StudioAgentPorts } from '@/features/ai-assistant'
import { installStudioAgentConsoleApi } from './studioAgentConsoleApi.ts'

function createPorts(calls: string[]): StudioAgentPorts {
  return {
    readState: () => ({
      workspaceName: 'workspace',
      activeComponentId: 'arm',
      components: [],
      bridgeIds: [],
      selection: null,
      focusTarget: null,
      view: {},
      panels: {
        leftSidebarOpen: true,
        rightSidebarOpen: true,
        optionsPanelOpen: true,
        jointPanelOpen: true,
        propertyTab: 'visual',
      },
    }),
    readElements: query => ({
      elements: [{ elementId: 'ui-1', tag: 'button', role: 'button', name: query.query ?? '' }],
      total: 1,
      nextCursor: null,
    }),
    interactWithElement: interaction => {
      calls.push(`interact:${interaction.elementId}:${interaction.operation}`)
      return { ok: true, message: 'operated' }
    },
    selectEntity: target => {
      calls.push(`select:${target.type}`)
      return { ok: true, message: 'selected' }
    },
    focusEntity: target => ({ ok: true, message: `focused:${target.type}` }),
    configureView: patch => ({ ok: true, message: `view:${Object.keys(patch).join(',')}` }),
    configurePanels: patch => ({ ok: true, message: `panels:${Object.keys(patch).join(',')}` }),
    openWorkflow: workflow => ({ ok: true, message: `workflow:${workflow}` }),
  }
}

test('browser console API exposes safe Studio commands and cleans up', async () => {
  const calls: string[] = []
  const targetWindow = {} as Window
  const cleanup = installStudioAgentConsoleApi(targetWindow, createPorts(calls))
  const api = targetWindow.urdfStudioAgent
  assert.ok(api)

  assert.equal(api.inspect().workspaceName, 'workspace')
  assert.equal((await api.elements({ query: 'Export' })).elements[0]?.name, 'Export')
  assert.equal((await api.interact({ elementId: 'ui-1', operation: 'click' })).ok, true)
  assert.equal((await api.select({ type: 'component', componentId: 'arm' })).ok, true)
  assert.match(api.help()[1] ?? '', /elements/)
  assert.deepEqual(calls, ['interact:ui-1:click', 'select:component'])

  cleanup()
  assert.equal(targetWindow.urdfStudioAgent, undefined)
})
