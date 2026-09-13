import { isMJCFContent } from '@/core/parsers/mjcf/index';
import { isUsdLikeFormat } from '@/core/parsers/usd/index';
import type { RobotFile } from '@/types/index';

export type ViewerRobotSourceFormat = 'auto' | 'urdf' | 'mjcf' | 'sdf' | 'xacro' | 'usd';
export type ResolvedViewerRobotSourceFormat = 'urdf' | 'mjcf' | 'usd';

export function getViewerRobotSourceFormat(
  fileFormat: RobotFile['format'] | null | undefined,
): ViewerRobotSourceFormat {
  switch (fileFormat) {
    case 'urdf':
    case 'mjcf':
    case 'sdf':
    case 'xacro':
    case 'usd':
      return fileFormat;
    default:
      return 'auto';
  }
}

export function resolvePreferredViewerRobotSourceFormat(
  explicitSourceFormat: ViewerRobotSourceFormat | undefined,
  fileFormat: RobotFile['format'] | null | undefined,
): ViewerRobotSourceFormat {
  if (explicitSourceFormat !== undefined) {
    return explicitSourceFormat;
  }

  return getViewerRobotSourceFormat(fileFormat);
}

export function resolveViewerRobotSourceFormat(
  content: string,
  sourceFormat: ViewerRobotSourceFormat = 'auto',
): ResolvedViewerRobotSourceFormat {
  if (sourceFormat === 'mjcf') {
    return 'mjcf';
  }

  if (isUsdLikeFormat(sourceFormat)) {
    return 'usd';
  }

  if (sourceFormat === 'urdf' || sourceFormat === 'sdf' || sourceFormat === 'xacro') {
    return 'urdf';
  }

  // Check if content is USD format
  if (content.includes('#usda') || content.includes('def Xform') || content.includes('def Sphere')) {
    return 'usd';
  }

  return isMJCFContent(content) ? 'mjcf' : 'urdf';
}
