import type { EntityRef } from '@/types'
import type { AgentCapability, AgentToolResult } from './types'
import type {
  StudioAgentPorts,
  StudioCommandResult,
  StudioElementInteraction,
  StudioElementQuery,
  StudioPanelPatch,
  StudioViewPatch,
} from '../studioAppControl'

interface StudioCapabilityOptions {
  editableComponentId: string | null
}

const STUDIO_ACTION_HELP = {
  inspect: '{}',
  elements: '{kind?: interactive|status|all, query?, cursor?, limit?: 1..40}',
  interact: '{elementId?|query?, operation: click|focus|set-value|toggle|select-option, value?}',
  select: '{type, componentId?, entityId?, bridgeId?, focus?}',
  focus: '{type, componentId?, entityId?, bridgeId?, durationMs?}',
  view: '{showGrid?, showAxes?, showJointAxes?, showInertia?, showCenterOfMass?, showCollision?, modelOpacity?, cameraProjection?}',
  panels: '{leftSidebarOpen?, rightSidebarOpen?, optionsPanelOpen?, jointPanelOpen?, propertyTab?}',
  workflow: '{workflow: inspection|export}',
} as const

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parseEntityTarget(args: Record<string, unknown>): EntityRef | null {
  const type = args.type
  if (type === 'assembly') {
    return { type }
  }
  if (type === 'component') {
    const componentId = nonEmptyString(args.componentId)
    return componentId ? { type, componentId } : null
  }
  if (type === 'bridge') {
    const bridgeId = nonEmptyString(args.bridgeId)
    return bridgeId ? { type, bridgeId } : null
  }
  if (type === 'link' || type === 'joint' || type === 'tendon') {
    const componentId = nonEmptyString(args.componentId)
    const entityId = nonEmptyString(args.entityId)
    return componentId && entityId ? { type, componentId, entityId } : null
  }
  return null
}

function invalidTarget(): AgentToolResult {
  return {
    ok: false,
    message:
      'Invalid entity target. Links, joints, and tendons need componentId + entityId; components need componentId; bridges need bridgeId.',
  }
}

function resolveTargetComponentId(target: EntityRef): string | null {
  return target.type === 'component' || target.type === 'link' || target.type === 'joint'
    || target.type === 'tendon'
    ? target.componentId
    : null
}

function addDraftMutationGuard(
  result: AgentToolResult,
  target: EntityRef,
  editableComponentId: string | null,
): AgentToolResult {
  const targetComponentId = resolveTargetComponentId(target)
  if (!result.ok || !targetComponentId || targetComponentId === editableComponentId) {
    return result
  }
  return {
    ...result,
    blocksDraftMutation: true,
    message:
      `${result.message} The robot editing draft remains scoped to component `
      + `${editableComponentId ?? 'none'} for this turn; robot edits are blocked until the next turn.`,
  }
}

function readBoolean(
  args: Record<string, unknown>,
  key: string,
): boolean | undefined | null {
  const value = args[key]
  return value === undefined ? undefined : typeof value === 'boolean' ? value : null
}

function parseViewPatch(args: Record<string, unknown>): StudioViewPatch | null {
  const patch: StudioViewPatch = {}
  const booleanKeys = [
    'showGrid',
    'showAxes',
    'showJointAxes',
    'showInertia',
    'showCenterOfMass',
    'showCollision',
  ] as const
  for (const key of booleanKeys) {
    const value = readBoolean(args, key)
    if (value === null) return null
    if (value !== undefined) patch[key] = value
  }
  if (args.modelOpacity !== undefined) {
    if (typeof args.modelOpacity !== 'number' || args.modelOpacity < 0.05 || args.modelOpacity > 1) {
      return null
    }
    patch.modelOpacity = args.modelOpacity
  }
  if (args.cameraProjection !== undefined) {
    if (args.cameraProjection !== 'perspective' && args.cameraProjection !== 'orthographic') {
      return null
    }
    patch.cameraProjection = args.cameraProjection
  }
  return Object.keys(patch).length ? patch : null
}

function parsePanelPatch(args: Record<string, unknown>): StudioPanelPatch | null {
  const patch: StudioPanelPatch = {}
  const booleanKeys = [
    'leftSidebarOpen',
    'rightSidebarOpen',
    'optionsPanelOpen',
    'jointPanelOpen',
  ] as const
  for (const key of booleanKeys) {
    const value = readBoolean(args, key)
    if (value === null) return null
    if (value !== undefined) patch[key] = value
  }
  if (args.propertyTab !== undefined) {
    const propertyTab = args.propertyTab
    if (propertyTab !== 'visual' && propertyTab !== 'collision' && propertyTab !== 'physics') {
      return null
    }
    patch.propertyTab = propertyTab
  }
  return Object.keys(patch).length ? patch : null
}

function wrapCommand(result: StudioCommandResult): AgentToolResult {
  return { ok: result.ok, message: result.message, effect: 'app-command' }
}

function readInput(args: Record<string, unknown>): Record<string, unknown> | null {
  if (args.input === undefined) return {}
  return args.input !== null && typeof args.input === 'object' && !Array.isArray(args.input)
    ? args.input as Record<string, unknown>
    : null
}

function parseElementQuery(input: Record<string, unknown>): StudioElementQuery | null {
  const kind = input.kind
  const query = input.query
  const cursor = input.cursor
  const limit = input.limit
  if (kind !== undefined && kind !== 'interactive' && kind !== 'status' && kind !== 'all') {
    return null
  }
  if (query !== undefined && typeof query !== 'string') return null
  if (cursor !== undefined && (typeof cursor !== 'number' || cursor < 0)) return null
  if (limit !== undefined && (typeof limit !== 'number' || limit < 1 || limit > 40)) return null
  return {
    kind,
    query,
    cursor,
    limit,
  } as StudioElementQuery
}

function parseElementInteraction(
  input: Record<string, unknown>,
): StudioElementInteraction | null {
  const elementId = nonEmptyString(input.elementId)
  const query = nonEmptyString(input.query)
  const operation = input.operation
  const allowedOperations = ['click', 'focus', 'set-value', 'toggle', 'select-option']
  if (
    (!elementId && !query)
    || (elementId && query)
    || typeof operation !== 'string'
    || !allowedOperations.includes(operation)
  ) {
    return null
  }
  if (input.value !== undefined && !['string', 'number', 'boolean'].includes(typeof input.value)) {
    return null
  }
  return {
    ...(elementId ? { elementId } : { query: query ?? undefined }),
    operation,
    value: input.value,
  } as StudioElementInteraction
}

interface StudioActionExecution {
  ports: StudioAgentPorts
  editableComponentId: string | null
  args: Record<string, unknown>
  context: Parameters<AgentCapability['execute']>[2]
}

async function executeSelectAction(
  execution: StudioActionExecution,
  input: Record<string, unknown>,
): Promise<AgentToolResult> {
  const target = parseEntityTarget(input)
  if (!target) return invalidTarget()
  const focus = input.focus === undefined ? true : input.focus
  if (typeof focus !== 'boolean') return { ok: false, message: 'focus must be a boolean.' }
  const result = wrapCommand(await execution.ports.selectEntity(
    target,
    { focus },
    execution.context,
  ))
  return addDraftMutationGuard(result, target, execution.editableComponentId)
}

async function executeFocusAction(
  execution: StudioActionExecution,
  input: Record<string, unknown>,
): Promise<AgentToolResult> {
  const target = parseEntityTarget(input)
  if (!target) return invalidTarget()
  const durationMs = input.durationMs === undefined ? 1500 : input.durationMs
  if (typeof durationMs !== 'number' || durationMs < 250 || durationMs > 10000) {
    return { ok: false, message: 'durationMs must be between 250 and 10000.' }
  }
  return wrapCommand(await execution.ports.focusEntity(target, durationMs, execution.context))
}

async function executeViewAction(
  execution: StudioActionExecution,
  input: Record<string, unknown>,
): Promise<AgentToolResult> {
  const patch = parseViewPatch(input)
  return patch
    ? wrapCommand(await execution.ports.configureView(patch, execution.context))
    : { ok: false, message: 'Provide at least one valid view setting.' }
}

async function executePanelAction(
  execution: StudioActionExecution,
  input: Record<string, unknown>,
): Promise<AgentToolResult> {
  const patch = parsePanelPatch(input)
  return patch
    ? wrapCommand(await execution.ports.configurePanels(patch, execution.context))
    : { ok: false, message: 'Provide at least one valid panel setting.' }
}

async function executeElementReadAction(
  execution: StudioActionExecution,
  input: Record<string, unknown>,
): Promise<AgentToolResult> {
  const query = parseElementQuery(input)
  if (!query) return { ok: false, message: 'Invalid element query.' }
  const page = await execution.ports.readElements(query, execution.context)
  return { ok: true, message: JSON.stringify(page), effect: 'read' }
}

async function executeElementInteractionAction(
  execution: StudioActionExecution,
  input: Record<string, unknown>,
): Promise<AgentToolResult> {
  const interaction = parseElementInteraction(input)
  return interaction
    ? wrapCommand(await execution.ports.interactWithElement(interaction, execution.context))
    : { ok: false, message: 'Provide exactly one of elementId/query and a valid operation.' }
}

async function executeWorkflowAction(
  execution: StudioActionExecution,
  input: Record<string, unknown>,
): Promise<AgentToolResult> {
  const workflow = input.workflow
  if (workflow !== 'inspection' && workflow !== 'export') {
    return { ok: false, message: 'workflow must be inspection or export.' }
  }
  return wrapCommand(await execution.ports.openWorkflow(workflow, execution.context))
}

async function executeNamedStudioAction(
  execution: StudioActionExecution,
  action: unknown,
  input: Record<string, unknown>,
): Promise<AgentToolResult> {
  switch (action) {
    case 'inspect':
      return { ok: true, message: JSON.stringify(execution.ports.readState()), effect: 'read' }
    case 'select':
      return executeSelectAction(execution, input)
    case 'focus':
      return executeFocusAction(execution, input)
    case 'view':
      return executeViewAction(execution, input)
    case 'panels':
      return executePanelAction(execution, input)
    case 'elements':
      return executeElementReadAction(execution, input)
    case 'interact':
      return executeElementInteractionAction(execution, input)
    case 'workflow':
      return executeWorkflowAction(execution, input)
    default:
      return { ok: false, message: 'Unknown studio action.' }
  }
}

async function executeStudioAction(execution: StudioActionExecution): Promise<AgentToolResult> {
  const input = readInput(execution.args)
  if (!input) return { ok: false, message: 'studio input must be an object.' }

  if (execution.args.action === 'help') {
    const requestedAction = nonEmptyString(input.for)
    const help = requestedAction && requestedAction in STUDIO_ACTION_HELP
      ? { [requestedAction]: STUDIO_ACTION_HELP[requestedAction as keyof typeof STUDIO_ACTION_HELP] }
      : STUDIO_ACTION_HELP
    return { ok: true, message: JSON.stringify(help), effect: 'read' }
  }
  return executeNamedStudioAction(execution, execution.args.action, input)
}

/** Build one compact semantic URDF Studio tool backed by app-owned command ports. */
export function buildStudioAppCapabilities(
  ports: StudioAgentPorts,
  options: StudioCapabilityOptions,
): AgentCapability[] {
  return [
    {
      name: 'studio',
      description: 'Operate URDF Studio UI. Actions: inspect, elements, interact, select, focus, view, panels, workflow, help. Multiple calls can be issued together. Robot edits belong in run_script.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: [
              'help',
              'inspect',
              'elements',
              'interact',
              'select',
              'focus',
              'view',
              'panels',
              'workflow',
            ],
          },
          input: {
            type: 'object',
            description: 'Arguments for the selected action. Use action=help when unsure.',
          },
        },
        required: ['action'],
      },
      execute: (_draft, args, context) => executeStudioAction({
        ports,
        editableComponentId: options.editableComponentId,
        args,
        context,
      }),
      mutates: false,
      effect: 'app-command',
      verificationScopes: ['app'],
    },
  ]
}
