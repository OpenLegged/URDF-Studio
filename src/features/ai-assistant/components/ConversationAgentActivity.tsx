import { AlertTriangle, ChevronRight, CircleStop, Loader2 } from 'lucide-react'

import type { Language } from '@/shared/i18n'
import type { AIConversationAgentActivity } from '../types'
import { formatAgentRunEvent } from '../services/browserAgentHarness'

interface ConversationAgentActivityProps {
  activity: AIConversationAgentActivity
  lang: Language
}

const getStatusLabel = (activity: AIConversationAgentActivity, lang: Language): string => {
  const labels = lang === 'zh'
      ? {
        completed: '查看处理过程',
        failed: '处理已停止',
        aborted: '已停止处理',
        active: '正在处理你的请求',
        thinking: 'AI 正在思考',
        checking: 'AI 正在检查结果',
        recovering: 'AI 正在继续调整',
      }
    : {
        completed: 'View process',
        failed: 'Processing stopped',
        aborted: 'Processing cancelled',
        active: 'Working on your request',
        thinking: 'AI is thinking',
        checking: 'AI is checking the result',
        recovering: 'AI is continuing to adjust',
      }

  if (activity.status === 'completed') return labels.completed
  if (activity.status === 'failed') return labels.failed
  if (activity.status === 'aborted') return labels.aborted
  if (activity.status === 'waiting-for-model') return labels.thinking
  if (activity.status === 'validating' || activity.status === 'verifying') return labels.checking
  if (activity.status === 'recovering') return labels.recovering
  return labels.active
}

export function ConversationAgentActivity({
  activity,
  lang,
}: ConversationAgentActivityProps) {
  const latestPlanLine = [...activity.events]
    .reverse()
    .find(event => event.type === 'plan.updated')
  const formattedPlan = latestPlanLine
    ? formatAgentRunEvent(latestPlanLine, lang)
    : null
  const allEventLines = activity.events
    .filter(event => event.type !== 'plan.updated')
    .map(event => formatAgentRunEvent(event, lang))
    .filter((line): line is string => Boolean(line))
  const recentEventLines = allEventLines
    .filter((line, index) => allEventLines.indexOf(line) === index)
    .slice(formattedPlan ? -11 : -12)
  const eventLines = formattedPlan
    ? [formattedPlan, ...recentEventLines]
    : recentEventLines
  const isTerminal = activity.status === 'completed' ||
    activity.status === 'failed' ||
    activity.status === 'aborted'

  const trace = eventLines.length > 0 ? (
    <div className="relative mt-2 space-y-1 border-l border-border-strong/50 pl-3">
      {eventLines.map((line, index) => (
        <div
          key={`${index}-${line}`}
          className={`relative whitespace-pre-wrap break-words text-xs leading-5 ${
            index === (eventLines.length || 1) - 1
              ? 'text-text-secondary'
              : 'text-text-tertiary'
          }`}
        >
          <span
            aria-hidden="true"
            className={`absolute -left-[15.5px] top-[5px] h-1.5 w-1.5 rounded-full ring-2 ring-element-bg ${
              index === (eventLines.length || 1) - 1 ? 'bg-system-blue' : 'bg-border-strong'
            }`}
          />
          {line}
        </div>
      ))}
    </div>
  ) : null

  if (isTerminal) {
    const TerminalIcon = activity.status === 'failed'
        ? AlertTriangle
        : CircleStop
    const terminalIconClassName = activity.status === 'failed'
        ? 'text-warning'
        : 'text-text-tertiary'
    return (
      <div className="flex justify-start">
        <details
          data-agent-activity={activity.status}
          className="group max-w-[90%] px-1 py-0.5"
        >
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary [&::-webkit-details-marker]:hidden">
            <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
            {activity.status !== 'completed' && (
              <TerminalIcon className={`h-3 w-3 ${terminalIconClassName}`} />
            )}
            <span>{getStatusLabel(activity, lang)}</span>
          </summary>
          {trace}
        </details>
      </div>
    )
  }

  return (
    <div className="flex justify-start">
      <div
        data-agent-activity={activity.status}
        className="w-full max-w-[90%] px-1 py-1 text-text-tertiary"
      >
        <div className="flex items-center gap-2 text-[13px] font-medium text-text-secondary">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-system-blue motion-reduce:animate-none" />
          <span>{getStatusLabel(activity, lang)}</span>
        </div>
        {trace}
      </div>
    </div>
  )
}
