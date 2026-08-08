import { Loader2, MessageCircle, Send, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { InspectionReport, MotorSpec, RobotState } from '@/types'
import type { Language, TranslationKeys } from '@/shared/i18n'
import { CLOSE_BUTTON_DANGER_SECONDARY_CLASS } from '@/shared/components/ui'
import { buildInspectionEvidenceSummary } from '@/shared/utils/inspectionEvidenceSummary'
import { generateRobotFromPrompt } from '../services/aiService'
import { buildInspectionRobotContext } from '../utils/buildInspectionRobotContext'

interface ReportChatOverlayProps {
  isOpen: boolean
  onClose: () => void
  robot: RobotState
  motorLibrary: Record<string, MotorSpec[]>
  inspectionReport: InspectionReport | null
  lang: Language
  t: TranslationKeys
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export function ReportChatOverlay({
  isOpen,
  onClose,
  robot,
  motorLibrary,
  inspectionReport,
  lang,
  t
}: ReportChatOverlayProps) {
  const [reportChatMessages, setReportChatMessages] = useState<ChatMessage[]>([])
  const [reportChatInput, setReportChatInput] = useState('')
  const [isChatGenerating, setIsChatGenerating] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setReportChatMessages([])
      setReportChatInput('')
      setIsChatGenerating(false)
    }
  }, [isOpen])

  const handleReportChatSend = async () => {
    if (!reportChatInput.trim() || isChatGenerating || !inspectionReport) return

    const userMessage = reportChatInput.trim()
    setReportChatInput('')
    setReportChatMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setIsChatGenerating(true)

    try {
      const inspectionRobotContext = buildInspectionRobotContext(robot)
      const evidenceSummary = buildInspectionEvidenceSummary(robot.inspectionContext, lang)
      const evidenceText = evidenceSummary
        ? evidenceSummary.metrics.map(metric => `- ${metric.label}: ${metric.value}`).join('\n')
        : lang === 'zh'
          ? '- 无额外源格式证据'
          : '- No additional source-format evidence'
      const contextPrompt =
        lang === 'zh'
          ? `当前检查上下文：\n${JSON.stringify(inspectionRobotContext, null, 2)}\n\n源格式证据：\n${evidenceText}\n\n检测报告摘要：\n${inspectionReport.summary}\n\n检测报告中的问题列表：\n${inspectionReport.issues.map(i => `- ${i.title} (${i.type}): ${i.description}`).join('\n')}\n\n用户问题：${userMessage}`
          : `Current inspection context:\n${JSON.stringify(inspectionRobotContext, null, 2)}\n\nSource-format evidence:\n${evidenceText}\n\nInspection report summary:\n${inspectionReport.summary}\n\nIssues:\n${inspectionReport.issues.map(i => `- ${i.title} (${i.type}): ${i.description}`).join('\n')}\n\nUser question: ${userMessage}`

      const response = await generateRobotFromPrompt(contextPrompt, robot, motorLibrary, lang)
      const assistantMessage = response?.explanation || t.reportChatNoReply
      setReportChatMessages(prev => [...prev, { role: 'assistant', content: assistantMessage }])
    } catch (error) {
      console.error('Chat Error', error)
      setReportChatMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: t.reportChatSendError
        }
      ])
    } finally {
      setIsChatGenerating(false)
    }
  }

  if (!isOpen || !inspectionReport) {
    return null
  }

  return (
    <div className="absolute inset-0 bg-panel-bg dark:bg-panel-bg z-40 flex flex-col animate-in slide-in-from-right-4 duration-300">
      <div className="h-9 px-3 border-b border-border-black flex items-center justify-between bg-element-bg shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-0.5 bg-panel-bg text-text-secondary border border-border-black rounded-lg dark:bg-element-bg dark:text-white">
            <MessageCircle className="w-3 h-3" />
          </div>
          <span className="text-[11px] font-semibold text-text-primary">{t.chatTitle}</span>
        </div>
        <button
          onClick={onClose}
          className={`rounded-md p-1 ${CLOSE_BUTTON_DANGER_SECONDARY_CLASS}`}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
        {reportChatMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-text-tertiary space-y-2.5 px-10 text-center">
            <div className="p-3 bg-panel-bg dark:bg-element-bg border border-border-black rounded-xl shadow-sm">
              <MessageCircle className="w-6 h-6 opacity-20" />
            </div>
            <p className="text-[11px] leading-relaxed">{t.askAboutReport}</p>
          </div>
        ) : (
          reportChatMessages.map((message, index) => (
            <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] px-2.5 py-1.5 rounded-xl text-xs leading-relaxed ${
                  message.role === 'user'
                    ? 'bg-system-blue-solid text-white rounded-tr-[4px] border border-system-blue-solid'
                    : 'bg-panel-bg dark:bg-element-bg text-text-secondary rounded-tl-[4px] border border-border-black shadow-sm'
                }`}
              >
                {message.content}
              </div>
            </div>
          ))
        )}

        {isChatGenerating && (
          <div className="flex justify-start">
            <div className="bg-panel-bg dark:bg-element-bg rounded-xl rounded-tl-[4px] border border-border-black px-2.5 py-1.5 shadow-sm">
              <Loader2 className="w-3 h-3 animate-spin text-system-blue" />
            </div>
          </div>
        )}
      </div>

      <div className="p-2.5 border-t border-border-black bg-element-bg dark:bg-panel-bg">
        <div className="relative group">
          <input
            type="text"
            value={reportChatInput}
            onChange={e => setReportChatInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleReportChatSend()
              }
            }}
            placeholder={t.chatPlaceholder}
            className="w-full bg-panel-bg dark:bg-element-bg border border-border-black rounded-lg py-1.5 pl-2.5 pr-8 text-[11px] text-text-secondary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-system-blue/25 focus:border-system-blue transition-all shadow-sm"
          />
          <button
            onClick={handleReportChatSend}
            disabled={isChatGenerating || !reportChatInput.trim()}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 bg-system-blue-solid text-white rounded-lg hover:bg-system-blue-hover transition-colors disabled:opacity-30 shadow-sm"
          >
            <Send className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  )
}

export default ReportChatOverlay
