import type { TranslationKeys } from '@/shared/i18n';
import type { RobotFile } from '@/types';

export type RobotLoadErrorLabels = Pick<TranslationKeys,
  'robotLoadFailed' | 'usdBrowserUnsupported'>;

/** Keep worker/parser diagnostics intact while localizing the application feedback. */
export function reportRobotLoadError(
  error: unknown,
  file: Pick<RobotFile, 'name' | 'format'>,
  labels: RobotLoadErrorLabels,
): string {
  console.error(`[Robot load] ${file.name}`, error);
  const detail = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (file.format === 'usd' && (
    detail === 'OffscreenCanvas is unavailable for USD RobotState hydration.'
    || detail === 'USD offscreen viewer worker is unavailable in this environment'
    || detail === 'Web Worker is not available in this environment'
  )) {
    return labels.usdBrowserUnsupported;
  }
  return labels.robotLoadFailed
    .replace('{format}', file.format.toUpperCase())
    .replace('{name}', () => file.name);
}
