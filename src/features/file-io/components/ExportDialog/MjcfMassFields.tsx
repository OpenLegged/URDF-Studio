import { Checkbox, Input } from '@/shared/components/ui';
import { translations } from '@/shared/i18n';
import type { MjcfExportConfig, ExportDialogProps } from './types';

export function MjcfMassFields({ config, lang, onChange }: {
  config: MjcfExportConfig;
  lang: ExportDialogProps['lang'];
  onChange: (patch: Partial<MjcfExportConfig>) => void;
}) {
  const t = translations[lang];
  const density = config.densityKgM3 ?? 1000;
  return <div className="my-3 space-y-2 text-xs text-text-secondary">
    <p>{t.exportMassAutoHint}</p>
    <details>
      <summary className="cursor-pointer text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30">{t.exportMassAdvanced}</summary>
      <div className="mt-2 space-y-2">
        <Checkbox label={t.exportMassRecompute} checked={config.massMode === 'recompute'}
          onChange={(enabled) => onChange({ massMode: enabled ? 'recompute' : 'auto' })} />
        <Input key={density} label={t.exportMassDensity} type="number" min="0.001" step="any" defaultValue={density}
          onBlur={(event) => {
            const value = event.currentTarget.valueAsNumber;
            if (Number.isFinite(value) && value > 0) onChange({ densityKgM3: value });
            else event.currentTarget.value = String(density);
          }}
          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
        <p>{config.massMode === 'recompute' ? t.exportMassRecomputeHint : t.exportMassDensityHint}</p>
      </div>
    </details>
  </div>;
}
