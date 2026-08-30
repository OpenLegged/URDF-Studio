import type { EntityRef } from '@/types'

export type StudioWorkflow = 'inspection' | 'export'
export type StudioElementKind = 'interactive' | 'status' | 'all'
export type StudioElementOperation = 'click' | 'focus' | 'set-value' | 'toggle' | 'select-option'

export interface StudioCommandContext {
  signal?: AbortSignal
}

export interface StudioCommandResult {
  ok: boolean
  message: string
}

export interface StudioElementQuery {
  kind?: StudioElementKind
  query?: string
  cursor?: number
  limit?: number
}

export interface StudioElementSnapshot {
  elementId: string
  tag: string
  role: string
  name: string
  testId?: string
  disabled?: boolean
  checked?: boolean
  expanded?: boolean
  selected?: boolean
  value?: string
  placeholder?: string
  options?: string[]
}

export interface StudioElementPage {
  elements: StudioElementSnapshot[]
  total: number
  nextCursor: number | null
}

export interface StudioElementInteraction {
  /** Stable id from `elements`, or an accessible-name query for one-shot use. */
  elementId?: string
  query?: string
  operation: StudioElementOperation
  value?: string | number | boolean
}

export interface StudioComponentSummary {
  id: string
  name: string
  visible: boolean
  linkIds: string[]
  jointIds: string[]
}

export interface StudioAppSnapshot {
  workspaceName: string
  activeComponentId: string | null
  components: StudioComponentSummary[]
  bridgeIds: string[]
  selection: EntityRef | null
  focusTarget: EntityRef | null
  view: StudioViewPatch
  panels: Required<StudioPanelPatch>
}

export interface StudioSelectOptions {
  focus: boolean
}

export interface StudioViewPatch {
  showGrid?: boolean
  showAxes?: boolean
  showJointAxes?: boolean
  showInertia?: boolean
  showCenterOfMass?: boolean
  showCollision?: boolean
  modelOpacity?: number
  cameraProjection?: 'perspective' | 'orthographic'
}

export interface StudioPanelPatch {
  leftSidebarOpen?: boolean
  rightSidebarOpen?: boolean
  optionsPanelOpen?: boolean
  jointPanelOpen?: boolean
  propertyTab?: 'visual' | 'collision' | 'physics'
}

/**
 * App-owned commands exposed to the browser harness. Implementations may use
 * stores and React workflow callbacks; the AI feature only sees this narrow
 * semantic port and never imports app orchestration.
 */
export interface StudioAgentPorts {
  readState: () => StudioAppSnapshot
  selectEntity: (
    target: EntityRef,
    options: StudioSelectOptions,
    context: StudioCommandContext,
  ) => StudioCommandResult | Promise<StudioCommandResult>
  focusEntity: (
    target: EntityRef,
    durationMs: number,
    context: StudioCommandContext,
  ) => StudioCommandResult | Promise<StudioCommandResult>
  configureView: (
    patch: StudioViewPatch,
    context: StudioCommandContext,
  ) => StudioCommandResult | Promise<StudioCommandResult>
  configurePanels: (
    patch: StudioPanelPatch,
    context: StudioCommandContext,
  ) => StudioCommandResult | Promise<StudioCommandResult>
  readElements: (
    query: StudioElementQuery,
    context: StudioCommandContext,
  ) => StudioElementPage | Promise<StudioElementPage>
  interactWithElement: (
    interaction: StudioElementInteraction,
    context: StudioCommandContext,
  ) => StudioCommandResult | Promise<StudioCommandResult>
  openWorkflow: (
    workflow: StudioWorkflow,
    context: StudioCommandContext,
  ) => StudioCommandResult | Promise<StudioCommandResult>
}
