import { useCallback, useLayoutEffect, useState } from 'react';

import {
  DEFAULT_SNAPSHOT_CAPTURE_OPTIONS,
  SNAPSHOT_ASPECT_RATIO_PRESETS,
  type SnapshotCaptureOptions,
} from '@/shared/components/3d/scene/snapshotConfig.ts';
import type { SegmentedControlOption, SelectOption } from '@/shared/components/ui';
import type { TranslationKeys } from '@/shared/i18n';

export const SNAPSHOT_RESOLUTION_OPTIONS = [
  { value: '1280', label: '720p' },
  { value: '1920', label: '1080p' },
  { value: '2560', label: '2K' },
  { value: '3840', label: '4K' },
  { value: '7680', label: '8K' },
] as const;

const SNAPSHOT_ANTIALIAS_OPTIONS: ReadonlyArray<
  SegmentedControlOption<SnapshotCaptureOptions['detailLevel']>
> = [
  { value: 'viewport', label: '1x' },
  { value: 'high', label: '2x' },
  { value: 'ultra', label: '4x' },
];

export interface SnapshotCaptureChoiceModel {
  resolutionOptions: SelectOption[];
  formatOptions: SelectOption[];
  aspectRatioOptions: SelectOption[];
  environmentOptions: SelectOption[];
  backgroundOptions: SelectOption[];
  shadowOptions: SelectOption[];
  groundOptions: SelectOption[];
  antialiasOptions: ReadonlyArray<SegmentedControlOption<SnapshotCaptureOptions['detailLevel']>>;
  compressionOptions: ReadonlyArray<SegmentedControlOption<number>>;
  compactLabels: {
    output: string;
    scene: string;
    resolution: string;
    aspect: string;
    format: string;
    aa: string;
    quality: string;
    lighting: string;
    background: string;
    shadow: string;
    ground: string;
    grid: string;
  };
}

export function createDefaultSnapshotCaptureOptions(): SnapshotCaptureOptions {
  return { ...DEFAULT_SNAPSHOT_CAPTURE_OPTIONS };
}

export function updateSnapshotCaptureOptions(
  current: SnapshotCaptureOptions,
  patch: Partial<SnapshotCaptureOptions>,
): SnapshotCaptureOptions {
  const next = { ...current, ...patch };
  if (next.imageFormat === 'jpeg' && next.backgroundStyle === 'transparent') {
    next.backgroundStyle = DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.backgroundStyle;
  }
  return next;
}

export function resolveSnapshotCompressionControlValue(options: SnapshotCaptureOptions): number {
  if (options.imageFormat === 'png') {
    return options.pngOptimizeLevel;
  }
  return options.imageQuality >= 90 ? 96 : options.imageQuality >= 70 ? 80 : 60;
}

export function createSnapshotCaptureChoiceModel(
  imageFormat: SnapshotCaptureOptions['imageFormat'],
  t: TranslationKeys,
): SnapshotCaptureChoiceModel {
  const supportsLossyCompression = imageFormat !== 'png';
  const backgroundOptions: SelectOption[] = [
    { value: 'viewport', label: t.snapshotBackgroundViewport },
    { value: 'studio', label: t.snapshotBackgroundStudio },
    { value: 'sky', label: t.snapshotBackgroundSky },
    { value: 'dark', label: t.snapshotBackgroundDark },
  ];
  if (imageFormat !== 'jpeg') {
    backgroundOptions.push({ value: 'transparent', label: t.snapshotBackgroundTransparent });
  }

  return {
    resolutionOptions: SNAPSHOT_RESOLUTION_OPTIONS.map((option) => ({ ...option })),
    formatOptions: [
      { value: 'png', label: t.snapshotFormatPng },
      { value: 'jpeg', label: t.snapshotFormatJpeg },
      { value: 'webp', label: t.snapshotFormatWebp },
    ],
    aspectRatioOptions: SNAPSHOT_ASPECT_RATIO_PRESETS.map((preset) => ({
      value: preset,
      label: preset === 'viewport' ? t.snapshotAspectViewport : preset,
    })),
    environmentOptions: [
      { value: 'viewport', label: t.snapshotEnvironmentViewport },
      { value: 'studio', label: t.snapshotEnvironmentStudio },
      { value: 'city', label: t.snapshotEnvironmentCity },
      { value: 'contrast', label: t.snapshotEnvironmentContrast },
    ],
    backgroundOptions,
    shadowOptions: [
      { value: 'soft', label: t.snapshotShadowSoft },
      { value: 'balanced', label: t.snapshotShadowBalanced },
      { value: 'crisp', label: t.snapshotShadowCrisp },
    ],
    groundOptions: [
      { value: 'shadow', label: t.snapshotFloorShadow },
      { value: 'contact', label: t.snapshotFloorContact },
      { value: 'reflective', label: t.snapshotFloorReflective },
    ],
    antialiasOptions: SNAPSHOT_ANTIALIAS_OPTIONS,
    compressionOptions: supportsLossyCompression
      ? [
          { value: 60, label: t.compressionLevelCompact },
          { value: 80, label: t.compressionLevelBalanced },
          { value: 96, label: t.compressionLevelPreserve },
        ]
      : [
          { value: 1, label: t.snapshotPngOptimizeFast },
          { value: 2, label: t.snapshotPngOptimizeBalanced },
          { value: 3, label: t.snapshotPngOptimizeSmallest },
        ],
    compactLabels: {
      output: t.snapshotCompactOutput,
      scene: t.snapshotCompactScene,
      resolution: t.snapshotCompactResolution,
      aspect: t.snapshotCompactAspect,
      format: t.snapshotCompactFormat,
      aa: 'AA',
      quality: t.snapshotCompactQuality,
      lighting: t.snapshotCompactLighting,
      background: t.snapshotCompactBackground,
      shadow: t.snapshotCompactShadow,
      ground: t.snapshotCompactGround,
      grid: t.snapshotCompactGrid,
    },
  };
}

export function useSnapshotCaptureForm(isOpen: boolean) {
  const [options, setOptions] = useState(createDefaultSnapshotCaptureOptions);

  useLayoutEffect(() => {
    if (isOpen) {
      setOptions(createDefaultSnapshotCaptureOptions());
    }
  }, [isOpen]);

  const updateOptions = useCallback((patch: Partial<SnapshotCaptureOptions>) => {
    setOptions((current) => updateSnapshotCaptureOptions(current, patch));
  }, []);

  return { options, updateOptions };
}
