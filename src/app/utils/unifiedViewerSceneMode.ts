import type { UnifiedViewerMode } from './unifiedViewerContract';

export function resolveUnifiedViewerSceneMode(mode: UnifiedViewerMode): 'editor' {
  void mode;
  return 'editor';
}
