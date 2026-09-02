/**
 * Browser-native harness primitives shared by the edit-agent engine and UI.
 * These mirror the useful DSH boundaries (plan state and typed run events)
 * without importing its Node runtime into the Vite bundle.
 */

import type { Language } from '@/shared/i18n'
import type { AgentCapability } from '../capabilities/types'
import type { AgentPlanItem, AgentPlanItemStatus, AgentRunEvent } from '../agentRuntimeTypes'

const MAX_PLAN_ITEMS = 8
const MAX_VISIBLE_EVENT_TEXT = 160
const PLAN_ITEM_STATUSES = new Set<AgentPlanItemStatus>([
  'pending',
  'in_progress',
  'completed',
])

export interface AgentPlanController {
  capability: AgentCapability
  getPlan: () => AgentPlanItem[]
}

const clonePlan = (plan: AgentPlanItem[]): AgentPlanItem[] => plan.map(item => ({ ...item }))

const sanitizeVisibleEventText = (value: string): string => value
  .replace(/\p{Cc}+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, MAX_VISIBLE_EVENT_TEXT)

const getToolDetail = (summary: string): string => {
  const normalized = sanitizeVisibleEventText(summary)
  const separatorIndex = normalized.indexOf(':')
  const detail = separatorIndex === -1
    ? normalized
    : normalized.slice(separatorIndex + 1).trim()
  return detail.split(' · ')[0]?.trim() ?? ''
}

const formatRobotPathSubject = (path: string, zh: boolean): string => {
  const normalized = path.trim()
  if (!normalized) return zh ? '机器人参数' : 'robot parameters'
  if (normalized === 'name') return zh ? '机器人名称' : 'the robot name'
  if (normalized === 'rootLinkId') return zh ? '根连杆' : 'the root link'

  const linkMatch = normalized.match(/^links\.([^.]+)/)
  if (linkMatch?.[1]) {
    return zh ? `连杆 ${linkMatch[1]}` : `link ${linkMatch[1]}`
  }
  const jointMatch = normalized.match(/^joints\.([^.]+)/)
  if (jointMatch?.[1]) {
    return zh ? `关节 ${jointMatch[1]}` : `joint ${jointMatch[1]}`
  }
  return zh ? '机器人参数' : 'robot parameters'
}

const formatToolActivity = (
  event: Extract<AgentRunEvent, { type: 'tool.started' }>,
  zh: boolean,
): string | null => {
  const detail = getToolDetail(event.summary)
  switch (event.name) {
    case 'update_plan':
      return null
    case 'read_path':
      return zh
        ? `read_path · 正在查看${formatRobotPathSubject(detail, true)}…`
        : `read_path · Reading ${formatRobotPathSubject(detail, false)}…`
    case 'write_path':
      return zh
        ? `write_path · 正在调整${formatRobotPathSubject(detail, true)}…`
        : `write_path · Adjusting ${formatRobotPathSubject(detail, false)}…`
    case 'validate_robot':
      return zh ? 'validate_robot · 正在检查机器人结构…' : 'validate_robot · Checking the robot structure…'
    case 'run_script':
      return zh ? 'run_script · 正在批量调整机器人…' : 'run_script · Applying a set of robot changes…'
    case 'studio':
      return zh ? 'studio · 正在查看当前工作区…' : 'studio · Inspecting the current workspace…'
    default: {
      const readableName = event.name.replace(/_/g, ' ')
      return zh
        ? `${event.name} · 正在处理 ${readableName}…`
        : `${event.name} · Working on ${readableName}…`
    }
  }
}

const parsePlan = (value: unknown): AgentPlanItem[] | null => {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PLAN_ITEMS) {
    return null
  }

  const plan: AgentPlanItem[] = []
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') {
      return null
    }

    const item = candidate as { step?: unknown; status?: unknown }
    const step = typeof item.step === 'string' ? item.step.trim() : ''
    const status = item.status as AgentPlanItemStatus
    if (!step || !PLAN_ITEM_STATUSES.has(status)) {
      return null
    }
    plan.push({ step, status })
  }

  if (plan.filter(item => item.status === 'in_progress').length > 1) {
    return null
  }
  return plan
}

export function createAgentPlanController(): AgentPlanController {
  let currentPlan: AgentPlanItem[] = []

  return {
    capability: {
      name: 'update_plan',
      description:
        'Create or update the plan for this turn. Use for multi-step work and update it after meaningful progress. Keep exactly one item in_progress until all items are completed.',
      parameters: {
        type: 'object',
        properties: {
          plan: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_PLAN_ITEMS,
            items: {
              type: 'object',
              properties: {
                step: { type: 'string' },
                status: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'completed'],
                },
              },
              required: ['step', 'status'],
            },
          },
        },
        required: ['plan'],
      },
      execute: (_draft, args) => {
        const nextPlan = parsePlan(args.plan)
        if (!nextPlan) {
          return {
            ok: false,
            message:
              'Plan must contain 1-8 non-empty items with valid statuses and at most one in_progress item.',
          }
        }
        currentPlan = nextPlan
        const completed = currentPlan.filter(item => item.status === 'completed').length
        return {
          ok: true,
          message: `Plan updated: ${completed}/${currentPlan.length} steps completed.`,
        }
      },
      mutates: false,
    },
    getPlan: () => clonePlan(currentPlan),
  }
}

export function formatAgentRunEvent(event: AgentRunEvent, lang: Language): string | null {
  const zh = lang === 'zh'
  switch (event.type) {
    case 'run.status':
      if (event.status === 'validating') return zh ? '正在检查刚才的调整…' : 'Checking the latest changes…'
      if (event.status === 'verifying') return zh ? '正在对照你的要求检查结果…' : 'Checking the result against your request…'
      if (event.status === 'recovering') return zh ? '发现结果还不对，正在继续调整…' : 'The result still needs work; continuing…'
      return null
    case 'assistant.reasoning':
      // Raw model reasoning is retained in the audit log only. It must never be
      // rendered as a user-visible chain-of-thought surrogate.
      return null
    case 'assistant.progress':
      return `${zh ? '思路' : 'Approach'} · ${sanitizeVisibleEventText(event.content)}`
    case 'plan.updated': {
      const items = event.plan.map(item => {
        const marker = item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '→' : '○'
        return `${marker} ${sanitizeVisibleEventText(item.step)}`
      })
      return `${zh ? '计划' : 'Plan'}\n${items.join('\n')}`
    }
    case 'tool.started':
      return formatToolActivity(event, zh)
    case 'tool.finished':
      return event.ok
        ? null
        : (zh ? '这一步没有成功，正在换一种方式…' : "That didn't work; trying another approach…")
    case 'validation.finished':
      return event.ok
        ? (zh ? '机器人结构看起来正常' : 'The robot structure looks good')
        : (zh ? '发现结构问题，正在继续调整…' : 'Found a structural issue; continuing to adjust…')
    case 'completion.verification.finished':
      return event.ok
        ? null
        : (zh ? '结果还不符合要求，正在继续调整…' : 'The result does not match the request yet; continuing…')
    case 'context.compacted':
      return null
    case 'run.finished':
      if (event.reason === 'step-limit') {
        return zh ? '这次处理步骤较多，已停在当前进度。' : 'This task took many steps and stopped at the current progress.'
      }
      if (event.reason === 'validation-failed') {
        return zh ? '调整后仍有结构问题，没有生成修改方案。' : 'Structural issues remain, so no proposal was created.'
      }
      if (event.reason === 'verification-failed') {
        return zh ? '结果还没有满足要求，没有生成修改方案。' : 'The result does not satisfy the request, so no proposal was created.'
      }
      return null
  }
}
