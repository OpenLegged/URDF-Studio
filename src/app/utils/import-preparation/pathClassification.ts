import { isVisibleLibraryAssetPath } from '@/shared/utils/robotFileSupport';
import type { RobotFile } from '@/types';

export function isImportableDefinitionPath(lowerPath: string): boolean {
  return (
    lowerPath.endsWith('.urdf') ||
    lowerPath.endsWith('.sdf') ||
    lowerPath.endsWith('.xml') ||
    lowerPath.endsWith('.mjcf') ||
    lowerPath.endsWith('.xacro')
  );
}

export function isAuxiliaryTextImportPath(lowerPath: string): boolean {
  return (
    lowerPath.endsWith('.yaml') ||
    lowerPath.endsWith('.yml') ||
    lowerPath.endsWith('.material') ||
    lowerPath.endsWith('.gazebo') ||
    lowerPath.endsWith('.mtl') ||
    lowerPath.endsWith('.srdf')
  );
}

export function shouldAlwaysLoadAuxiliaryImportPath(lowerPath: string): boolean {
  return lowerPath.endsWith('.srdf');
}

export function shouldMirrorTextMeshAssetContent(lowerPath: string): boolean {
  return lowerPath.endsWith('.dae') || lowerPath.endsWith('.obj');
}

export function createVisibleImportedAssetFile(path: string): RobotFile | null {
  if (!isVisibleLibraryAssetPath(path)) {
    return null;
  }

  return {
    name: path,
    content: '',
    format: 'mesh',
  };
}

export function shouldLoadAuxiliaryImportText(robotFiles: readonly RobotFile[]): boolean {
  return robotFiles.some(
    (file) => file.format === 'sdf' || file.format === 'xacro' || file.format === 'usd',
  );
}
