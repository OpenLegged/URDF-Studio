import type { TranslationKeys } from '@/shared/i18n';

interface SnapshotProgressOverlayProps {
  t: TranslationKeys;
  label: string;
  percent: number;
}

export function SnapshotProgressOverlay({ t, label, percent }: SnapshotProgressOverlayProps) {
  return (
    <div
      data-testid="snapshot-export-progress"
      className="absolute inset-0 z-10 flex items-center justify-center bg-panel-bg/95 px-4 py-6 backdrop-blur-sm"
    >
      <div className="w-full max-w-[360px] rounded-lg border border-border-black bg-element-bg p-3 shadow-sm">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-text-primary">
              {t.snapshotProgressTitle}
            </div>
            <div className="mt-1 text-[10px] text-text-secondary">{label}</div>
          </div>
          <div className="shrink-0 rounded-md border border-border-black bg-panel-bg px-1.5 py-0.5 text-[9px] font-medium text-text-secondary">
            {percent}%
          </div>
        </div>
        <div
          role="progressbar"
          aria-label={t.snapshotProgressTitle}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-2 overflow-hidden rounded-full border border-border-black bg-panel-bg"
        >
          <div
            className="h-full rounded-full bg-system-blue-solid transition-[width] duration-200"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="mt-2 text-[9px] text-text-tertiary">{t.snapshotProgressCancelHint}</div>
      </div>
    </div>
  );
}
