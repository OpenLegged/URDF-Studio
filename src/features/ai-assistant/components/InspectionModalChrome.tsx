import { ScanSearch, X } from 'lucide-react';
import type { InspectionReport } from '@/types';
import { FLOATING_WINDOW_TITLE_CLASS } from '@/shared/components/DraggableWindow';
import { SegmentedControl } from '@/shared/components/ui/SegmentedControl';
import type { TranslationKeys } from '@/shared/i18n';
import { getScoreBgColor } from '../utils/scoreHelpers';
import type { InspectionProgressState } from './InspectionProgress';
import type { InspectionSetupMode } from './inspectionModalState';

export const getInspectionProgressStageLabel = (
  stage: InspectionProgressState['stage'],
  t: TranslationKeys,
) => {
  switch (stage) {
    case 'preparing-context':
      return t.inspectionPreparingContext;
    case 'requesting-model':
      return t.inspectionRequestingModel;
    case 'processing-response':
      return t.inspectionProcessingResponse;
    case 'finalizing-report':
      return t.inspectionFinalizingReport;
  }
};

interface InspectionCancellationNoticeProps {
  notice: string;
  onDismiss: () => void;
  t: TranslationKeys;
}

export function InspectionCancellationNotice({
  notice,
  t,
  onDismiss,
}: InspectionCancellationNoticeProps) {
  return (
    <div
      data-inspection-cancelled-notice
      className="flex items-start gap-3 rounded-lg border border-warning-border bg-warning-soft px-3 py-2 text-xs font-medium text-warning"
    >
      <span className="min-w-0 flex-1 leading-5">{notice}</span>
      <button
        type="button"
        data-inspection-cancelled-notice-dismiss
        aria-label={t.close}
        title={t.close}
        onClick={onDismiss}
        className="-mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-warning transition-colors hover:bg-warning/10 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

interface InspectionModalTitleProps {
  inspectionReport: InspectionReport | null;
  isMinimized: boolean;
  isSetupView: boolean;
  t: TranslationKeys;
}

export function InspectionModalTitle({
  inspectionReport,
  isMinimized,
  isSetupView,
  t,
}: InspectionModalTitleProps) {
  if (isSetupView) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <div
          data-inspection-setup-header-logo
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-border-black bg-panel-bg text-system-blue shadow-sm dark:bg-element-bg"
        >
          <ScanSearch className="h-4 w-4" />
        </div>
        <h1 className={FLOATING_WINDOW_TITLE_CLASS}>{t.aiInspection}</h1>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-border-black bg-panel-bg text-system-blue dark:bg-element-bg dark:text-system-blue">
          <ScanSearch className="h-4 w-4" />
        </div>
        <h1 className={FLOATING_WINDOW_TITLE_CLASS}>{t.aiInspection}</h1>
      </div>

      {inspectionReport && !isMinimized ? (
        <div className="ml-4 hidden items-center gap-2 rounded-lg border border-border-black bg-panel-bg px-2 py-1 shadow-sm dark:bg-panel-bg md:flex">
          <div
            className={`w-2 h-2 rounded-full ${getScoreBgColor(
              inspectionReport.overallScore || 0,
              inspectionReport.maxScore || 100,
            )}`}
          />
          <span className="text-[10px] font-medium tracking-wide text-text-secondary">
            {t.overallScore}: {inspectionReport.overallScore?.toFixed(1)}/
            {inspectionReport.maxScore ?? 100}
          </span>
        </div>
      ) : null}
    </>
  );
}

interface InspectionSetupModeSwitcherProps {
  compact: boolean;
  mode: InspectionSetupMode;
  onModeChange: (mode: InspectionSetupMode) => void;
  t: TranslationKeys;
}

export function InspectionSetupModeSwitcher({
  compact,
  mode,
  onModeChange,
  t,
}: InspectionSetupModeSwitcherProps) {
  return (
    <div
      data-inspection-setup-mode-switcher
      className={
        compact
          ? 'shrink-0 border-b border-border-black bg-element-bg px-3 py-2'
          : 'absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2'
      }
    >
      <SegmentedControl<InspectionSetupMode>
        options={[
          { value: 'normal', label: t.inspectionNormalMode },
          { value: 'advanced', label: t.inspectionAdvancedMode },
        ]}
        value={mode}
        onChange={onModeChange}
        stretch={compact}
        ariaLabel={t.aiInspection}
        className={compact ? 'w-full' : 'w-full max-w-[300px]'}
        itemClassName={compact ? 'min-w-0' : 'min-w-[126px]'}
      />
    </div>
  );
}
