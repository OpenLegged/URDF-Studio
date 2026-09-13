import type { ResolvedViewerRobotSourceFormat } from '@/shared/components/3d/robot/renderers/sourceFormat';

export function shouldEnableViewerSceneCompileWarmup(
  sourceFormat: ResolvedViewerRobotSourceFormat,
): boolean {
  // MyoSuite-style MJCF scenes can lose the WebGL context during renderer precompile.
  // Skip warmup there and let the scene compile naturally on demand instead.
  return sourceFormat !== 'mjcf';
}
