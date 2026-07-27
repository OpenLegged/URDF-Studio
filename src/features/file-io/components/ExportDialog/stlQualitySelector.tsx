import { useCallback } from 'react';
import { Slider } from '@/shared/components/ui';
import type { TranslationKeys } from '@/shared/i18n/types';

const STL_QUALITY_PRESETS = [
  { key: 'none', quality: 100, compress: false },
  { key: 'light', quality: 75, compress: true },
  { key: 'medium', quality: 50, compress: true },
] as const;

export type StlPresetKey = (typeof STL_QUALITY_PRESETS)[number]['key'] | 'custom';

const QUALITY_SLIDER_MIN = 10;
const QUALITY_SLIDER_MAX = 100;

export function getStlPreset(compressSTL: boolean, stlQuality: number): StlPresetKey {
  if (!compressSTL) return 'none';
  if (stlQuality === 75) return 'light';
  if (stlQuality === 50) return 'medium';
  return 'custom';
}

function getCustomCompressionLabel(t: TranslationKeys, quality: number): string {
  if (quality <= 25) return t.compressionLevelAggressive;
  if (quality <= 45) return t.compressionLevelCompact;
  if (quality <= 65) return t.compressionLevelBalanced;
  if (quality <= 85) return t.compressionLevelDetailed;
  return t.compressionLevelPreserve;
}

export function STLQualitySelector({
  compressSTL,
  stlQuality,
  mode,
  t,
  onCompressChange,
  onQualityChange,
  onModeChange,
  label,
  description,
}: {
  compressSTL: boolean;
  stlQuality: number;
  mode: StlPresetKey;
  t: TranslationKeys;
  onCompressChange: (v: boolean) => void;
  onQualityChange: (v: number) => void;
  onModeChange: (mode: StlPresetKey) => void;
  label?: string;
  description?: string | null;
}) {
  const presetLabels: Record<StlPresetKey, string> = {
    none: t.stlQualityOriginal,
    light: t.stlQualityLight,
    medium: t.stlQualityMedium,
    custom: t.presetCustom,
  };
  const customQuality = Math.min(
    Math.max(Math.round(stlQuality), QUALITY_SLIDER_MIN),
    QUALITY_SLIDER_MAX,
  );

  const handlePresetSelect = useCallback(
    (preset: StlPresetKey) => {
      onModeChange(preset);

      if (preset === 'custom') {
        if (!compressSTL) onCompressChange(true);
        return;
      }

      const selectedPreset = STL_QUALITY_PRESETS.find((candidate) => candidate.key === preset);
      if (!selectedPreset) return;

      onCompressChange(selectedPreset.compress);
      if (selectedPreset.compress) {
        onQualityChange(selectedPreset.quality);
      }
    },
    [compressSTL, onCompressChange, onModeChange, onQualityChange],
  );

  const resolvedDescription = description === undefined ? t.stlMeshQualityDesc : description;

  return (
    <div className="py-2">
      <div className="text-xs text-text-primary mb-0.5">{label || t.stlMeshQuality}</div>
      {resolvedDescription ? (
        <div className="mb-2 text-[10px] text-text-tertiary">{resolvedDescription}</div>
      ) : null}
      <div className="grid grid-cols-4 gap-1 p-1 bg-segmented-bg rounded-xl border border-border-black">
        {[...STL_QUALITY_PRESETS, { key: 'custom' as const }].map((preset) => (
          <button
            key={preset.key}
            onClick={() => handlePresetSelect(preset.key)}
            className={`flex-1 py-1 px-2.5 text-xs rounded-lg transition-all font-medium ${
              mode === preset.key
                ? 'bg-segmented-active text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary hover:bg-element-hover'
            }`}
          >
            {presetLabels[preset.key]}
          </button>
        ))}
      </div>
      {mode === 'custom' && compressSTL && (
        <div className="mt-3 px-1">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-text-primary">{t.presetCustom}</span>
            <span className="rounded-md bg-element-bg px-1.5 py-0.5 text-[10px] text-text-secondary">
              {getCustomCompressionLabel(t, customQuality)}
            </span>
          </div>
          <Slider
            value={customQuality}
            min={QUALITY_SLIDER_MIN}
            max={QUALITY_SLIDER_MAX}
            step={1}
            showValue={false}
            onChange={(value) => {
              onModeChange('custom');
              if (!compressSTL) onCompressChange(true);
              onQualityChange(value);
            }}
          />
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-text-tertiary">
            <span>{t.compressionSmallerFile}</span>
            <span>{t.compressionMoreDetail}</span>
          </div>
        </div>
      )}
    </div>
  );
}
