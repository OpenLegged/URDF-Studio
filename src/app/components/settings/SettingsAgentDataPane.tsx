import React from 'react'
import {
  Database,
  Download,
  HardDrive,
  Loader2,
  Trash2,
  Upload,
} from 'lucide-react'

import {
  clearAgentSessionStore,
  exportAgentSessionArchive,
  getAgentSessionStorageStats,
  importAgentSessionArchive,
  subscribeAgentSessionStore,
  type AgentSessionStorageStats,
} from '@/features/ai-assistant'
import { downloadBlob } from '@/features/file-io'
import { Button } from '@/shared/components/ui'
import { translations, type Language } from '@/shared/i18n'
import { SettingsRow, SettingsSection, ToggleRow } from './SettingsComponents'
import {
  SETTINGS_ICON_STROKE_WIDTH,
  SETTINGS_INLINE_BUTTON_CLASSNAME,
} from './settingsTypes'

interface SettingsAgentDataPaneProps {
  lang: Language
  aiAutoApplyEdits: boolean
  setAiAutoApplyEdits: (value: boolean) => void
}

type OperationStatus = 'idle' | 'loading' | 'exported' | 'imported' | 'cleared' | 'failed'

function formatBytes(bytes: number, lang: Language): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = units[0]
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024
    unit = units[index]
  }
  return `${new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
    maximumFractionDigits: 1,
  }).format(value)} ${unit}`
}

export function SettingsAgentDataPane({
  lang,
  aiAutoApplyEdits,
  setAiAutoApplyEdits,
}: SettingsAgentDataPaneProps) {
  const t = translations[lang]
  const importInputRef = React.useRef<HTMLInputElement | null>(null)
  const [stats, setStats] = React.useState<AgentSessionStorageStats | null>(null)
  const [status, setStatus] = React.useState<OperationStatus>('loading')
  const [confirmClear, setConfirmClear] = React.useState(false)

  const refreshStats = React.useCallback(async () => {
    try {
      setStats(await getAgentSessionStorageStats())
      setStatus(current => current === 'loading' ? 'idle' : current)
    } catch (error) {
      console.error('Unable to read Agent session storage statistics', error)
      setStatus('failed')
    }
  }, [])

  React.useEffect(() => {
    void refreshStats()
    return subscribeAgentSessionStore(() => {
      void refreshStats()
    })
  }, [refreshStats])

  const handleExport = async () => {
    setStatus('loading')
    try {
      const archive = await exportAgentSessionArchive()
      const date = new Date().toISOString().slice(0, 10)
      downloadBlob(
        new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' }),
        `urdf-studio-agent-sessions-${date}.json`,
      )
      setStatus('exported')
    } catch (error) {
      console.error('Unable to export Agent session data', error)
      setStatus('failed')
    }
  }

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const [file] = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    if (!file) return

    setStatus('loading')
    try {
      await importAgentSessionArchive(JSON.parse(await file.text()) as unknown)
      await refreshStats()
      setStatus('imported')
    } catch (error) {
      console.error('Unable to import Agent session data', error)
      setStatus('failed')
    }
  }

  const handleClear = async () => {
    setStatus('loading')
    try {
      await clearAgentSessionStore()
      setStats(await getAgentSessionStorageStats())
      setConfirmClear(false)
      setStatus('cleared')
    } catch (error) {
      console.error('Unable to clear Agent session data', error)
      setStatus('failed')
    }
  }

  const statusMessage = status === 'exported'
    ? t.agentDataExported
    : status === 'imported'
      ? t.agentDataImported
      : status === 'cleared'
        ? t.agentDataCleared
        : status === 'failed'
          ? t.agentDataOperationFailed
          : null

  return (
    <div className="space-y-3">
      <SettingsSection
        icon={<Database className="h-4 w-4" strokeWidth={SETTINGS_ICON_STROKE_WIDTH} />}
        title={t.aiAgentSettings}
      >
        <ToggleRow
          label={t.aiAutoApply}
          checked={aiAutoApplyEdits}
          onChange={setAiAutoApplyEdits}
        />
        <SettingsRow stacked>
          <div className="space-y-1 text-[10px] leading-4 text-text-tertiary">
            <p>{t.aiAutoApplyDesc}</p>
            <p>
            {t.agentLocalDataDescription}
            </p>
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        icon={<HardDrive className="h-4 w-4" strokeWidth={SETTINGS_ICON_STROKE_WIDTH} />}
        title={t.agentLocalData}
        actions={status === 'loading' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      >
        <SettingsRow label={t.agentStorageMode}>
          <span className="text-[11px] font-medium text-text-primary">
            {stats?.persistence === 'indexeddb'
              ? t.agentStorageIndexedDb
              : t.agentStorageMemory}
          </span>
        </SettingsRow>
        <SettingsRow label={t.agentSessionCount}>
          <span data-testid="agent-session-count" className="text-[11px] text-text-primary">
            {stats?.sessionCount ?? '—'}
          </span>
        </SettingsRow>
        <SettingsRow label={t.agentEventCount}>
          <span data-testid="agent-event-count" className="text-[11px] text-text-primary">
            {stats?.eventCount ?? '—'}
          </span>
        </SettingsRow>
        <SettingsRow label={t.agentStorageSize}>
          <span className="text-[11px] text-text-primary">
            {stats ? formatBytes(stats.approximateBytes, lang) : '—'}
          </span>
        </SettingsRow>
        <SettingsRow stacked>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void handleExport()}
              disabled={!stats?.sessionCount || status === 'loading'}
              className={SETTINGS_INLINE_BUTTON_CLASSNAME}
              icon={<Download className="h-3.5 w-3.5" />}
            >
              {t.agentDataExport}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => importInputRef.current?.click()}
              disabled={status === 'loading'}
              className={SETTINGS_INLINE_BUTTON_CLASSNAME}
              icon={<Upload className="h-3.5 w-3.5" />}
            >
              {t.agentDataImport}
            </Button>
            <Button
              type="button"
              variant={confirmClear ? 'danger' : 'secondary'}
              size="sm"
              onClick={() => confirmClear ? void handleClear() : setConfirmClear(true)}
              disabled={!stats?.sessionCount || status === 'loading'}
              className={SETTINGS_INLINE_BUTTON_CLASSNAME}
              icon={<Trash2 className="h-3.5 w-3.5" />}
            >
              {confirmClear ? t.agentDataClearConfirm : t.agentDataClear}
            </Button>
            {confirmClear && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmClear(false)}
                className={SETTINGS_INLINE_BUTTON_CLASSNAME}
              >
                {t.cancel}
              </Button>
            )}
          </div>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            data-testid="agent-session-import-input"
            onChange={(event) => void handleImport(event)}
          />
          {confirmClear && (
            <p className="mt-2 text-[10px] leading-4 text-danger">
              {t.agentDataClearWarning}
            </p>
          )}
          {statusMessage && (
            <p role="status" className="mt-2 text-[10px] leading-4 text-text-secondary">
              {statusMessage}
            </p>
          )}
        </SettingsRow>
      </SettingsSection>
    </div>
  )
}
