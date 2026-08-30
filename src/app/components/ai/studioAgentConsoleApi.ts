import type {
  StudioAgentPorts,
  StudioCommandResult,
  StudioElementInteraction,
  StudioElementPage,
  StudioElementQuery,
  StudioPanelPatch,
  StudioSelectOptions,
  StudioViewPatch,
  StudioWorkflow,
} from '@/features/ai-assistant'
import type { EntityRef } from '@/types'

export interface StudioAgentConsoleApi {
  help: () => string[]
  inspect: StudioAgentPorts['readState']
  elements: (query?: StudioElementQuery) => Promise<StudioElementPage>
  interact: (interaction: StudioElementInteraction) => Promise<StudioCommandResult>
  select: (
    target: EntityRef,
    options?: Partial<StudioSelectOptions>,
  ) => Promise<StudioCommandResult>
  focus: (target: EntityRef, durationMs?: number) => Promise<StudioCommandResult>
  view: (patch: StudioViewPatch) => Promise<StudioCommandResult>
  panels: (patch: StudioPanelPatch) => Promise<StudioCommandResult>
  workflow: (workflow: StudioWorkflow) => Promise<StudioCommandResult>
}

declare global {
  interface Window {
    urdfStudioAgent?: StudioAgentConsoleApi
  }
}

function createStudioAgentConsoleApi(ports: StudioAgentPorts): StudioAgentConsoleApi {
  return {
    help: () => [
      'urdfStudioAgent.inspect()',
      "await urdfStudioAgent.elements({kind:'interactive', query:'settings'})",
      "await urdfStudioAgent.interact({query:'Settings', operation:'click'})",
      "await urdfStudioAgent.select({type:'link', componentId:'arm', entityId:'base_link'})",
      "await urdfStudioAgent.view({showCollision:true, cameraProjection:'orthographic'})",
      "await urdfStudioAgent.panels({rightSidebarOpen:true, propertyTab:'physics'})",
      "await urdfStudioAgent.workflow('inspection')",
    ],
    inspect: ports.readState,
    elements: query => Promise.resolve(ports.readElements(query ?? {}, {})),
    interact: interaction => Promise.resolve(ports.interactWithElement(interaction, {})),
    select: (target, options) => Promise.resolve(ports.selectEntity(
      target,
      { focus: options?.focus ?? true },
      {},
    )),
    focus: (target, durationMs = 1500) => Promise.resolve(ports.focusEntity(target, durationMs, {})),
    view: patch => Promise.resolve(ports.configureView(patch, {})),
    panels: patch => Promise.resolve(ports.configurePanels(patch, {})),
    workflow: workflow => Promise.resolve(ports.openWorkflow(workflow, {})),
  }
}

/** Install the same safe semantic commands for manual use from browser DevTools. */
export function installStudioAgentConsoleApi(
  targetWindow: Window,
  ports: StudioAgentPorts,
): () => void {
  const api = createStudioAgentConsoleApi(ports)
  targetWindow.urdfStudioAgent = api
  return () => {
    if (targetWindow.urdfStudioAgent === api) {
      delete targetWindow.urdfStudioAgent
    }
  }
}
