import {
  detectRobotDefinitionFormat,
  type RobotDefinitionFormat,
} from '@/core/parsers/format_detection';
import type { ParseRobotDefinitionOptions } from '../types';

export interface RobotDefinitionPackageFile {
  path: string;
  content?: string;
}

export interface RobotDefinitionEntry {
  path: string;
  format: RobotDefinitionFormat;
  label: string;
}

const normalizePackagePath = (path: string) =>
  path.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '');

const getPackageDirectory = (path: string) => {
  const normalized = normalizePackagePath(path);
  const slash = normalized.lastIndexOf('/');
  return slash >= 0 ? normalized.slice(0, slash + 1) : '';
};

export function listRobotDefinitionEntries(
  files: readonly RobotDefinitionPackageFile[],
): RobotDefinitionEntry[] {
  return files.flatMap((file) => {
    const path = normalizePackagePath(file.path);
    if (!path) return [];
    const format = detectRobotDefinitionFormat(file.content ?? '', path);
    if (!format) return [];
    const fileName = path.split('/').pop() ?? path;
    return [{ path, format, label: fileName.replace(/\.[^/.]+$/, '') || fileName }];
  });
}

export function createRobotDefinitionParseOptions(
  files: readonly RobotDefinitionPackageFile[],
  rootPath: string,
): ParseRobotDefinitionOptions {
  const allFileContents: Record<string, string> = {};
  files.forEach((file) => {
    if (typeof file.content !== 'string') return;
    const path = normalizePackagePath(file.path);
    if (!path) return;
    allFileContents[path] = file.content;
    const fileName = path.split('/').pop();
    if (fileName && !(fileName in allFileContents)) {
      allFileContents[fileName] = file.content;
    }
  });

  const normalizedRootPath = normalizePackagePath(rootPath);
  return {
    allFileContents,
    availableFiles: files.map((file) => ({
      name: normalizePackagePath(file.path),
      content: file.content,
    })),
    sourcePath: normalizedRootPath,
    xacroFileMap: allFileContents,
    xacroBasePath: getPackageDirectory(normalizedRootPath),
  };
}
