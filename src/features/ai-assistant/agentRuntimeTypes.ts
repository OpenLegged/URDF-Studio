export type AgentRunStatus =
  | 'running'
  | 'waiting-for-model'
  | 'compacting-context'
  | 'executing-tools'
  | 'validating'
  | 'verifying'
  | 'recovering'
  | 'completed'
  | 'failed'
  | 'aborted'

export type AgentRunEndReason =
  | 'completed'
  | 'no-change'
  | 'step-limit'
  | 'validation-failed'
  | 'verification-failed'
  | 'aborted'
  | 'failed'

export type AgentPlanItemStatus = 'pending' | 'in_progress' | 'completed'

export interface AgentPlanItem {
  step: string
  status: AgentPlanItemStatus
}

export type AgentRunEvent =
  | {
      type: 'run.status'
      status: AgentRunStatus
      step: number
    }
  | {
      type: 'assistant.reasoning'
      content: string
      step: number
    }
  | {
      /** Short user-facing intent supplied in regular assistant content. */
      type: 'assistant.progress'
      content: string
      step: number
    }
  | {
      type: 'plan.updated'
      plan: AgentPlanItem[]
      step: number
    }
  | {
      type: 'tool.started'
      callId: string
      name: string
      summary: string
      step: number
      index: number
      total: number
    }
  | {
      type: 'tool.finished'
      callId: string
      name: string
      ok: boolean
      message: string
      step: number
    }
  | {
      type: 'validation.finished'
      ok: boolean
      message: string
      automatic: boolean
      step: number
    }
  | {
      type: 'completion.verification.finished'
      ok: boolean
      message: string
      evidenceCount: number
      /** Number of explicit user/structural requirements evaluated. */
      checkCount?: number
      /** Checks backed by cited evidence and marked pass. */
      passedCheckCount?: number
      step: number
    }
  | {
      type: 'context.compacted'
      trigger: 'pressure' | 'context-overflow'
      beforeTokens: number
      afterTokens: number
      summarizedMessages: number
      prunedToolResults: number
      usedModelSummary: boolean
      step: number
    }
  | {
      type: 'run.finished'
      reason: AgentRunEndReason
      step: number
    }
