import type {
  StudioAgentPorts,
  StudioCommandContext,
  StudioCommandResult,
  StudioPanelPatch,
  StudioViewPatch,
  StudioWorkflow,
} from '@/features/ai-assistant'
import { useSelectionStore, useUIStore, validateEntityRef } from '@/store'
import { useWorkspaceStore } from '@/store/workspaceStore'
import type { EntityRef } from '@/types'
import { createStudioDomAgent } from './studioDomAgent'

interface StudioWorkflowCallbacks {
  openInspection: () => boolean
  openExport: () => boolean
  readPanelConfig: () => StudioPanelConfig
  updatePanelConfig: (patch: Partial<StudioPanelConfig>) => void
}

interface StudioPanelConfig {
  showOptionsPanel: boolean
  showJointPanel: boolean
}

function aborted(context: StudioCommandContext): StudioCommandResult | null {
  return context.signal?.aborted
    ? { ok: false, message: 'The Studio command was cancelled.' }
    : null
}

function validateTarget(target: EntityRef): StudioCommandResult | null {
  return validateEntityRef(useWorkspaceStore.getState().workspace, target)
    ? null
    : { ok: false, message: `The requested ${target.type} does not exist in the live workspace.` }
}

function describeTarget(target: EntityRef): string {
  if (target.type === 'assembly') return 'assembly'
  if (target.type === 'component') return `component ${target.componentId}`
  if (target.type === 'bridge') return `bridge ${target.bridgeId}`
  return `${target.type} ${target.componentId}/${target.entityId}`
}

function readState(panelConfig: StudioPanelConfig): ReturnType<StudioAgentPorts['readState']> {
  const workspaceState = useWorkspaceStore.getState()
  const selectionState = useSelectionStore.getState()
  const uiState = useUIStore.getState()
  return {
    workspaceName: workspaceState.workspace.name,
    activeComponentId: workspaceState.activeComponentId,
    components: Object.values(workspaceState.workspace.components).map(component => ({
      id: component.id,
      name: component.name,
      visible: component.visible,
      linkIds: Object.keys(component.robot.links),
      jointIds: Object.keys(component.robot.joints),
    })),
    bridgeIds: Object.keys(workspaceState.workspace.bridges),
    selection: selectionState.selection?.entity ?? null,
    focusTarget: selectionState.focusTarget,
    view: {
      showGrid: uiState.viewOptions.showGrid,
      showAxes: uiState.viewOptions.showAxes,
      showJointAxes: uiState.viewOptions.showJointAxes,
      showInertia: uiState.viewOptions.showInertia,
      showCenterOfMass: uiState.viewOptions.showCenterOfMass,
      showCollision: uiState.viewOptions.showCollision,
      modelOpacity: uiState.viewOptions.modelOpacity,
      cameraProjection: uiState.viewOptions.cameraProjection,
    },
    panels: {
      leftSidebarOpen: !uiState.sidebar.leftCollapsed,
      rightSidebarOpen: !uiState.sidebar.rightCollapsed,
      optionsPanelOpen: panelConfig.showOptionsPanel,
      jointPanelOpen: panelConfig.showJointPanel,
      propertyTab: uiState.detailLinkTab,
    },
  }
}

function selectEntity(
  target: EntityRef,
  options: { focus: boolean },
  context: StudioCommandContext,
): StudioCommandResult {
  const earlyResult = aborted(context) ?? validateTarget(target)
  if (earlyResult) return earlyResult

  const selectionState = useSelectionStore.getState()
  const nextSelection = { entity: target } as const
  if (!selectionState.isInteractionAllowed(nextSelection)) {
    return { ok: false, message: 'Selection is currently locked by an active Studio tool.' }
  }
  selectionState.setSelection(nextSelection)
  selectionState.pulseSelection(nextSelection)
  if (options.focus) selectionState.focusOn(target)
  return {
    ok: true,
    message: `${describeTarget(target)} selected${options.focus ? ' and framed' : ''}.`,
  }
}

function focusEntity(
  target: EntityRef,
  durationMs: number,
  context: StudioCommandContext,
): StudioCommandResult {
  const earlyResult = aborted(context) ?? validateTarget(target)
  if (earlyResult) return earlyResult
  useSelectionStore.getState().focusOn(target, durationMs)
  return { ok: true, message: `${describeTarget(target)} framed in the 3D view.` }
}

function configureView(
  patch: StudioViewPatch,
  context: StudioCommandContext,
): StudioCommandResult {
  const earlyResult = aborted(context)
  if (earlyResult) return earlyResult
  const uiState = useUIStore.getState()
  if (patch.showGrid !== undefined) uiState.setViewOption('showGrid', patch.showGrid)
  if (patch.showAxes !== undefined) uiState.setViewOption('showAxes', patch.showAxes)
  if (patch.showJointAxes !== undefined) {
    uiState.setViewOption('showJointAxes', patch.showJointAxes)
  }
  if (patch.showInertia !== undefined) uiState.setViewOption('showInertia', patch.showInertia)
  if (patch.showCenterOfMass !== undefined) {
    uiState.setViewOption('showCenterOfMass', patch.showCenterOfMass)
  }
  if (patch.showCollision !== undefined) {
    uiState.setViewOption('showCollision', patch.showCollision)
  }
  if (patch.modelOpacity !== undefined) {
    uiState.setViewOption('modelOpacity', patch.modelOpacity)
  }
  if (patch.cameraProjection !== undefined) {
    uiState.setViewOption('cameraProjection', patch.cameraProjection)
  }
  return { ok: true, message: `3D view configured: ${Object.keys(patch).join(', ')}.` }
}

function configurePanels(
  patch: StudioPanelPatch,
  context: StudioCommandContext,
  updatePanelConfig: StudioWorkflowCallbacks['updatePanelConfig'],
): StudioCommandResult {
  const earlyResult = aborted(context)
  if (earlyResult) return earlyResult
  const uiState = useUIStore.getState()
  if (patch.leftSidebarOpen !== undefined) {
    uiState.setSidebar('left', !patch.leftSidebarOpen)
  }
  if (patch.rightSidebarOpen !== undefined) {
    uiState.setSidebar('right', !patch.rightSidebarOpen)
  }
  const panelConfigPatch: Partial<StudioPanelConfig> = {}
  if (patch.optionsPanelOpen !== undefined) {
    panelConfigPatch.showOptionsPanel = patch.optionsPanelOpen
  }
  if (patch.jointPanelOpen !== undefined) {
    panelConfigPatch.showJointPanel = patch.jointPanelOpen
  }
  if (Object.keys(panelConfigPatch).length) {
    updatePanelConfig(panelConfigPatch)
  }
  if (patch.propertyTab !== undefined) {
    uiState.setDetailLinkTab(patch.propertyTab)
  }
  return { ok: true, message: `Studio panels configured: ${Object.keys(patch).join(', ')}.` }
}

/** Create the App-owned implementation of the AI feature's semantic command ports. */
export function createStudioAgentPorts(callbacks: StudioWorkflowCallbacks): StudioAgentPorts {
  const domAgent = createStudioDomAgent()
  return {
    readState: () => readState(callbacks.readPanelConfig()),
    selectEntity,
    focusEntity,
    configureView,
    configurePanels: (patch, context) =>
      configurePanels(patch, context, callbacks.updatePanelConfig),
    readElements: domAgent.readElements,
    interactWithElement: domAgent.interactWithElement,
    openWorkflow: (workflow: StudioWorkflow, context: StudioCommandContext) => {
      const earlyResult = aborted(context)
      if (earlyResult) return earlyResult
      const opened = workflow === 'inspection'
        ? callbacks.openInspection()
        : callbacks.openExport()
      if (!opened) {
        return { ok: false, message: `The ${workflow} workflow is unavailable right now.` }
      }
      return {
        ok: true,
        message: workflow === 'inspection'
          ? 'Opened the AI inspection setup. The user controls when it runs.'
          : 'Opened the export dialog. The user controls the format and download.',
      }
    },
  }
}
