import { isImageAssetPath } from '@/core/utils/assetFileTypes';
import type { RobotFile } from '@/types';

export function normalizeRobotImportFilePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

export function normalizeRobotImportSourceLookupPath(filePath: string): string {
  return normalizeRobotImportFilePath(filePath).trim().replace(/^\/+/, '').split('?')[0];
}

export function getRobotImportFileName(filePath: string): string {
  const normalized = normalizeRobotImportFilePath(filePath);
  const segments = normalized.split('/');
  return segments[segments.length - 1] || normalized;
}

export function hasRobotImportSourceContent(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function hasTextMeshMaterialInputs(allFileContents: Record<string, string>): boolean {
  for (const assetPath in allFileContents) {
    if (!Object.prototype.hasOwnProperty.call(allFileContents, assetPath)) {
      continue;
    }

    const lowerPath = assetPath.toLowerCase();
    if (lowerPath.endsWith('.dae') || lowerPath.endsWith('.obj')) {
      return true;
    }
  }

  return false;
}

interface RobotImportAssetPathOptions {
  availableFiles: RobotFile[];
  assets: Record<string, string>;
  allFileContents: Record<string, string>;
}

export function buildMeshTextMaterialAssetPaths(options: RobotImportAssetPathOptions): Set<string> {
  const paths = new Set<string>();

  Object.keys(options.allFileContents).forEach((assetPath) => {
    paths.add(assetPath);
  });

  Object.keys(options.assets).forEach((assetPath) => {
    if (isImageAssetPath(assetPath)) {
      paths.add(assetPath);
    }
  });

  options.availableFiles.forEach((file) => {
    if (isImageAssetPath(file.name)) {
      paths.add(file.name);
    }
  });

  return paths;
}

export function buildImportAssetPaths(options: RobotImportAssetPathOptions): Set<string> {
  const paths = new Set<string>();

  options.availableFiles.forEach((file) => {
    paths.add(file.name);
  });

  Object.keys(options.assets).forEach((assetPath) => {
    paths.add(assetPath);
  });

  Object.keys(options.allFileContents).forEach((contentPath) => {
    paths.add(contentPath);
  });

  return paths;
}
