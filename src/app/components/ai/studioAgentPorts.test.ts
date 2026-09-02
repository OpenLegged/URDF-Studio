import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'

import { createSingleComponentWorkspace } from '@/core/robot'
import { DEFAULT_LINK, type RobotData } from '@/types'

const robot: RobotData = {
  name: 'arm',
  rootLinkId: 'base_link',
  links: {
    base_link: { ...DEFAULT_LINK, id: 'base_link', name: 'base_link' },
  },
  joints: {},
}

function installLocalStorageStub(): void {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
  })
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    localStorage: { configurable: true, value: dom.window.localStorage },
    navigator: { configurable: true, value: dom.window.navigator },
  })
}

test('Studio app ports operate canonical selection and UI stores', async () => {
  installLocalStorageStub()
  const [{ createStudioAgentPorts }, { useSelectionStore, useUIStore }, { useWorkspaceStore }] =
    await Promise.all([
      import('./studioAgentPorts.ts'),
      import('@/store'),
      import('@/store/workspaceStore'),
    ])
  useWorkspaceStore.getState().replaceWorkspace(
    createSingleComponentWorkspace(robot, {
      workspaceName: 'Agent workspace',
      componentId: 'arm',
    }),
    { resetHistory: true },
  )
  useSelectionStore.getState().clearSelection()
  useUIStore.getState().setViewOption('showCollision', false)
  useUIStore.getState().setSidebar('right', false)

  let inspectionOpens = 0
  let exportOpens = 0
  let panelConfig = { showOptionsPanel: true, showJointPanel: true }
  const ports = createStudioAgentPorts({
    openInspection: () => {
      inspectionOpens += 1
      return true
    },
    openExport: () => {
      exportOpens += 1
      return true
    },
    readPanelConfig: () => panelConfig,
    updatePanelConfig: patch => {
      panelConfig = { ...panelConfig, ...patch }
    },
  })

  const snapshot = ports.readState()
  assert.equal(snapshot.workspaceName, 'Agent workspace')
  assert.deepEqual(snapshot.components[0]?.linkIds, ['base_link'])

  const selected = await ports.selectEntity(
    { type: 'link', componentId: 'arm', entityId: 'base_link' },
    { focus: false },
    {},
  )
  assert.equal(selected.ok, true)
  assert.deepEqual(useSelectionStore.getState().selection?.entity, {
    type: 'link',
    componentId: 'arm',
    entityId: 'base_link',
  })

  await ports.configureView({ showCollision: true, cameraProjection: 'orthographic' }, {})
  await ports.configurePanels({
    rightSidebarOpen: false,
    optionsPanelOpen: false,
    jointPanelOpen: false,
    propertyTab: 'physics',
  }, {})
  assert.equal(useUIStore.getState().viewOptions.showCollision, true)
  assert.equal(useUIStore.getState().viewOptions.cameraProjection, 'orthographic')
  assert.equal(useUIStore.getState().sidebar.rightCollapsed, true)
  assert.equal(useUIStore.getState().detailLinkTab, 'physics')
  assert.deepEqual(panelConfig, { showOptionsPanel: false, showJointPanel: false })
  assert.equal(ports.readState().panels.optionsPanelOpen, false)

  await ports.openWorkflow('inspection', {})
  await ports.openWorkflow('export', {})
  assert.equal(inspectionOpens, 1)
  assert.equal(exportOpens, 1)
})

test('Studio app ports reject stale entity refs and cancelled commands', async () => {
  installLocalStorageStub()
  const { createStudioAgentPorts } = await import('./studioAgentPorts.ts')
  const ports = createStudioAgentPorts({
    openInspection: () => true,
    openExport: () => true,
    readPanelConfig: () => ({ showOptionsPanel: true, showJointPanel: true }),
    updatePanelConfig: () => {},
  })
  const controller = new AbortController()
  controller.abort()

  const missing = await ports.selectEntity(
    { type: 'link', componentId: 'arm', entityId: 'missing' },
    { focus: false },
    {},
  )
  const cancelled = await ports.configureView({ showGrid: false }, {
    signal: controller.signal,
  })

  assert.equal(missing.ok, false)
  assert.equal(cancelled.ok, false)
})
