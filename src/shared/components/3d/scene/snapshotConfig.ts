import { SNAPSHOT_MIN_LONG_EDGE } from './snapshotResolution';
import type { WorkspaceCameraSnapshot } from '../workspace/workspaceCameraSnapshot';
import type { PngOptimizeLevel } from '@/core/image-compressor';

export const SNAPSHOT_MAX_LONG_EDGE_INPUT = 16384;
export const SNAPSHOT_LONG_EDGE_INPUT_STEP = 64;

export const SNAPSHOT_IMAGE_FORMATS = ['png', 'jpeg', 'webp'] as const;
export type SnapshotImageFormat = (typeof SNAPSHOT_IMAGE_FORMATS)[number];

export const SNAPSHOT_IMAGE_QUALITY_MIN = 60;
export const SNAPSHOT_IMAGE_QUALITY_MAX = 100;
export const SNAPSHOT_IMAGE_QUALITY_STEP = 1;
export const SNAPSHOT_DEFAULT_IMAGE_QUALITY = 96;

export const SNAPSHOT_DETAIL_LEVELS = ['viewport', 'high', 'ultra'] as const;
export type SnapshotDetailLevel = (typeof SNAPSHOT_DETAIL_LEVELS)[number];

// oxipng effort tiers exposed for PNG exports. All tiers are lossless; higher
// levels trade markedly longer encode time for diminishing size gains, so the
// ceiling is kept at 3 (levels 4–6 add exhaustive/zopfli passes that can be
// pathologically slow on multi-megapixel renders without shrinking further).
export const SNAPSHOT_PNG_OPTIMIZE_LEVELS = [1, 2, 3] as const;
export const SNAPSHOT_DEFAULT_PNG_OPTIMIZE_LEVEL: PngOptimizeLevel = 2;

export const SNAPSHOT_ENVIRONMENT_PRESETS = ['viewport', 'studio', 'city', 'contrast'] as const;
export type SnapshotEnvironmentPreset = (typeof SNAPSHOT_ENVIRONMENT_PRESETS)[number];

export const SNAPSHOT_SHADOW_STYLES = ['soft', 'balanced', 'crisp'] as const;
export type SnapshotShadowStyle = (typeof SNAPSHOT_SHADOW_STYLES)[number];

export const SNAPSHOT_GROUND_STYLES = ['shadow', 'contact', 'reflective'] as const;
export type SnapshotGroundStyle = (typeof SNAPSHOT_GROUND_STYLES)[number];

export const SNAPSHOT_DOF_MODES = ['off', 'subtle', 'hero'] as const;
export type SnapshotDofMode = (typeof SNAPSHOT_DOF_MODES)[number];

export const SNAPSHOT_BACKGROUND_STYLES = [
  'studio',
  'viewport',
  'sky',
  'dark',
  'transparent',
] as const;
export type SnapshotBackgroundStyle = (typeof SNAPSHOT_BACKGROUND_STYLES)[number];

export const SNAPSHOT_ASPECT_RATIO_PRESETS = [
  'viewport',
  '16:9',
  '4:3',
  '1:1',
  '3:4',
  '9:16',
] as const;
export type SnapshotAspectRatioPreset = (typeof SNAPSHOT_ASPECT_RATIO_PRESETS)[number];

export const SNAPSHOT_FIXED_ASPECT_RATIOS: Record<
  Exclude<SnapshotAspectRatioPreset, 'viewport'>,
  number
> = {
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '1:1': 1,
  '3:4': 3 / 4,
  '9:16': 9 / 16,
};

export interface SnapshotCaptureOptions {
  longEdgePx: number;
  imageFormat: SnapshotImageFormat;
  imageQuality: number;
  detailLevel: SnapshotDetailLevel;
  environmentPreset: SnapshotEnvironmentPreset;
  shadowStyle: SnapshotShadowStyle;
  groundStyle: SnapshotGroundStyle;
  dofMode: SnapshotDofMode;
  backgroundStyle: SnapshotBackgroundStyle;
  hideGrid: boolean;
  aspectRatioPreset: SnapshotAspectRatioPreset;
  /** oxipng effort tier applied to PNG exports (lossless). Ignored for JPEG/WebP. */
  pngOptimizeLevel: PngOptimizeLevel;
  cameraSnapshot?: WorkspaceCameraSnapshot | null;
  /**
   * Opt out of the snapshot preview path's 800px long-edge cap. The cap keeps
   * the on-screen snapshot dialog preview fast; only batch/automation callers
   * that need the full requested resolution (e.g. --long-edge 1920) set this.
   */
  bypassPreviewResolutionCap?: boolean;
}

export type SnapshotCaptureProgressPhase =
  | 'preparing'
  | 'warming-up'
  | 'rendering'
  | 'encoding'
  | 'optimizing'
  | 'downloading'
  | 'complete';

export interface SnapshotCaptureProgress {
  phase: SnapshotCaptureProgressPhase;
  progress: number;
}

export interface SnapshotCaptureRunControls {
  signal?: AbortSignal;
  onProgress?: (progress: SnapshotCaptureProgress) => void;
}

export type SnapshotCaptureRequest = Partial<SnapshotCaptureOptions> & SnapshotCaptureRunControls;

export type SnapshotCaptureAction = (options?: SnapshotCaptureRequest | null) => Promise<void>;
export interface SnapshotPreviewResult {
  blob: Blob;
  width: number;
  height: number;
  options: SnapshotCaptureOptions;
}

export type SnapshotPreviewAction = (
  options?: Partial<SnapshotCaptureOptions>,
) => Promise<SnapshotPreviewResult>;

export function createSnapshotCaptureAbortError(): Error | DOMException {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Snapshot export cancelled', 'AbortError');
  }

  const error = new Error('Snapshot export cancelled');
  error.name = 'AbortError';
  return error;
}

export function isSnapshotCaptureAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

export function throwIfSnapshotCaptureAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createSnapshotCaptureAbortError();
  }
}

export const DEFAULT_SNAPSHOT_CAPTURE_OPTIONS: SnapshotCaptureOptions = {
  longEdgePx: SNAPSHOT_MIN_LONG_EDGE,
  imageFormat: 'png',
  imageQuality: SNAPSHOT_DEFAULT_IMAGE_QUALITY,
  detailLevel: 'high',
  environmentPreset: 'city',
  shadowStyle: 'balanced',
  groundStyle: 'shadow',
  dofMode: 'off',
  backgroundStyle: 'studio',
  hideGrid: true,
  aspectRatioPreset: 'viewport',
  pngOptimizeLevel: SNAPSHOT_DEFAULT_PNG_OPTIMIZE_LEVEL,
};

export const SNAPSHOT_DETAIL_SHADOW_MAP_SIZE: Record<SnapshotDetailLevel, number | null> = {
  viewport: null,
  high: 2048,
  ultra: 4096,
};

export const SNAPSHOT_DETAIL_SUPERSAMPLE_SCALE: Record<SnapshotDetailLevel, number> = {
  viewport: 1,
  high: 2,
  ultra: 4,
};

function clampPositiveInteger(value: number, fallback: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.max(1, Math.round(value));
}

export function normalizeSnapshotLongEdgePx(value: number) {
  return Math.min(
    SNAPSHOT_MAX_LONG_EDGE_INPUT,
    Math.max(512, clampPositiveInteger(value, SNAPSHOT_MIN_LONG_EDGE)),
  );
}

export function normalizeSnapshotImageQuality(value: number | null | undefined) {
  const fallback = SNAPSHOT_DEFAULT_IMAGE_QUALITY;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(
    SNAPSHOT_IMAGE_QUALITY_MAX,
    Math.max(SNAPSHOT_IMAGE_QUALITY_MIN, clampPositiveInteger(value, fallback)),
  );
}

export function normalizeSnapshotPngOptimizeLevel(
  value: number | null | undefined,
): PngOptimizeLevel {
  const fallback = SNAPSHOT_DEFAULT_PNG_OPTIMIZE_LEVEL;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  const rounded = Math.round(value);
  return (SNAPSHOT_PNG_OPTIMIZE_LEVELS as readonly number[]).includes(rounded)
    ? (rounded as PngOptimizeLevel)
    : fallback;
}

export function normalizeSnapshotAspectRatioPreset(
  value: string | null | undefined,
): SnapshotAspectRatioPreset {
  return SNAPSHOT_ASPECT_RATIO_PRESETS.includes(value as SnapshotAspectRatioPreset)
    ? (value as SnapshotAspectRatioPreset)
    : DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.aspectRatioPreset;
}

export function resolveSnapshotAspectRatio(
  preset: SnapshotAspectRatioPreset,
  viewportAspectRatio: number | null | undefined,
) {
  if (preset !== 'viewport') {
    return SNAPSHOT_FIXED_ASPECT_RATIOS[preset];
  }

  return typeof viewportAspectRatio === 'number' &&
    Number.isFinite(viewportAspectRatio) &&
    viewportAspectRatio > 0
    ? viewportAspectRatio
    : 16 / 9;
}

export function resolveSnapshotLongEdgeDimensions(longEdgePx: number, aspectRatio: number) {
  const safeLongEdge = normalizeSnapshotLongEdgePx(longEdgePx);
  const safeAspectRatio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 16 / 9;

  if (safeAspectRatio >= 1) {
    return {
      width: safeLongEdge,
      height: Math.max(1, Math.round(safeLongEdge / safeAspectRatio)),
    };
  }

  return {
    width: Math.max(1, Math.round(safeLongEdge * safeAspectRatio)),
    height: safeLongEdge,
  };
}

export function normalizeSnapshotCaptureOptions(
  options?: Partial<SnapshotCaptureOptions> | null,
): SnapshotCaptureOptions {
  const longEdgePx = normalizeSnapshotLongEdgePx(
    options?.longEdgePx ?? DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.longEdgePx,
  );

  const imageFormat = SNAPSHOT_IMAGE_FORMATS.includes(options?.imageFormat as SnapshotImageFormat)
    ? (options?.imageFormat as SnapshotImageFormat)
    : DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.imageFormat;
  const imageQuality = normalizeSnapshotImageQuality(options?.imageQuality);

  const detailLevel = SNAPSHOT_DETAIL_LEVELS.includes(options?.detailLevel as SnapshotDetailLevel)
    ? (options?.detailLevel as SnapshotDetailLevel)
    : DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.detailLevel;

  const environmentPreset = SNAPSHOT_ENVIRONMENT_PRESETS.includes(
    options?.environmentPreset as SnapshotEnvironmentPreset,
  )
    ? (options?.environmentPreset as SnapshotEnvironmentPreset)
    : DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.environmentPreset;

  const shadowStyle = SNAPSHOT_SHADOW_STYLES.includes(options?.shadowStyle as SnapshotShadowStyle)
    ? (options?.shadowStyle as SnapshotShadowStyle)
    : DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.shadowStyle;

  const groundStyle = SNAPSHOT_GROUND_STYLES.includes(options?.groundStyle as SnapshotGroundStyle)
    ? (options?.groundStyle as SnapshotGroundStyle)
    : DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.groundStyle;

  const requestedBackgroundStyle = SNAPSHOT_BACKGROUND_STYLES.includes(
    options?.backgroundStyle as SnapshotBackgroundStyle,
  )
    ? (options?.backgroundStyle as SnapshotBackgroundStyle)
    : DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.backgroundStyle;
  const backgroundStyle =
    imageFormat === 'jpeg' && requestedBackgroundStyle === 'transparent'
      ? DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.backgroundStyle
      : requestedBackgroundStyle;
  return {
    longEdgePx,
    imageFormat,
    imageQuality,
    detailLevel,
    environmentPreset,
    shadowStyle,
    groundStyle,
    dofMode: 'off',
    backgroundStyle,
    hideGrid: options?.hideGrid ?? DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.hideGrid,
    aspectRatioPreset: normalizeSnapshotAspectRatioPreset(options?.aspectRatioPreset),
    pngOptimizeLevel: normalizeSnapshotPngOptimizeLevel(options?.pngOptimizeLevel),
    cameraSnapshot: options?.cameraSnapshot ?? null,
    bypassPreviewResolutionCap: Boolean(options?.bypassPreviewResolutionCap),
  };
}

export function getSnapshotFileExtension(format: SnapshotImageFormat) {
  return format === 'jpeg' ? 'jpg' : format;
}

export function buildSnapshotFileName(
  robotName: string,
  format: SnapshotImageFormat,
  now = new Date(),
) {
  const safeRobotName = (robotName || 'robot').replace(/[\\/:*?"<>|]/g, '_');
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '_',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');

  return `URDF_Studio_${safeRobotName}_${timestamp}.${getSnapshotFileExtension(format)}`;
}

export function getSnapshotMimeType(format: SnapshotImageFormat) {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'png':
    default:
      return 'image/png';
  }
}
