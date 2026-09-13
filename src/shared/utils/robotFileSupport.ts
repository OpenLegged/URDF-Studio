import { getAssetFileExtension } from '@/core/utils/assetFileTypes';
import type { RobotFile } from '@/types';

const LIBRARY_ROBOT_EXPORTABLE_FORMATS = new Set<RobotFile['format']>([
  'urdf',
  'mjcf',
  'xacro',
  'sdf',
]);

const ROBOT_DEFINITION_FORMATS = new Set<RobotFile['format']>([
  'urdf',
  'mjcf',
  'usd',
  'xacro',
  'sdf',
]);

const ASSET_LIBRARY_ONLY_FORMATS = new Set<RobotFile['format']>(['mesh', 'asset']);

export type LibraryFileKind = 'robot' | 'mesh' | 'image' | 'support';

export const SUPPORTED_ARCHIVE_IMPORT_EXTENSIONS = [
  '.zip',
  '.rar',
  '.7z',
  '.7zip',
  '.tar',
  '.tar.gz',
  '.tgz',
  '.tar.bz2',
  '.tbz2',
];

export const ROBOT_DEFINITION_IMPORT_EXTENSIONS = [
  '.urdf',
  '.sdf',
  '.xml',
  '.mjcf',
  '.usda',
  '.usdc',
  '.usdz',
  '.usd',
  '.xacro',
  '.usp',
] as const;

export const LIBRARY_MESH_IMPORT_EXTENSIONS = [
  '.stl',
  '.msh',
  '.obj',
  '.dae',
  '.gltf',
  '.glb',
  '.ply',
  '.vtk',
] as const;

export const LIBRARY_IMAGE_IMPORT_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'] as const;

export const ROBOT_IMPORT_ASSET_EXTENSIONS = [
  '.stl',
  '.msh',
  '.obj',
  '.dae',
  '.gltf',
  '.glb',
  '.ply',
  '.vtk',
  '.bin',
  '.mdl',
  '.png',
  '.jpg',
  '.jpeg',
  '.tga',
  '.bmp',
  '.tiff',
  '.tif',
  '.webp',
  '.hdr',
] as const;

export const ROBOT_IMPORT_AUXILIARY_TEXT_EXTENSIONS = [
  '.material',
  '.gazebo',
  '.mtl',
  '.srdf',
] as const;

export const ROBOT_IMPORT_ACCEPT_EXTENSIONS = [
  ...SUPPORTED_ARCHIVE_IMPORT_EXTENSIONS,
  ...ROBOT_DEFINITION_IMPORT_EXTENSIONS,
  ...LIBRARY_MESH_IMPORT_EXTENSIONS,
  ...LIBRARY_IMAGE_IMPORT_EXTENSIONS,
] as const;

const LIBRARY_MESH_IMPORT_EXTENSION_SET = new Set(
  LIBRARY_MESH_IMPORT_EXTENSIONS.map((extension) => extension.slice(1)),
);
const LIBRARY_IMAGE_IMPORT_EXTENSION_SET = new Set(
  LIBRARY_IMAGE_IMPORT_EXTENSIONS.map((extension) => extension.slice(1)),
);

function buildAcceptAttribute(
  extensions: readonly string[],
  includeUppercaseVariants = false,
): string {
  const values = includeUppercaseVariants
    ? extensions.flatMap((extension) => {
        const upper = extension.toUpperCase();
        return upper === extension ? [extension] : [extension, upper];
      })
    : [...extensions];
  return Array.from(new Set(values)).join(',');
}

function matchesImportExtension(fileName: string, extensions: readonly string[]): boolean {
  const normalizedFileName = fileName.trim().toLowerCase();
  return extensions.some((extension) => normalizedFileName.endsWith(extension));
}

export const ROBOT_IMPORT_ACCEPT_ATTRIBUTE = buildAcceptAttribute(ROBOT_IMPORT_ACCEPT_EXTENSIONS);
export const LIBRARY_MESH_IMPORT_ACCEPT_ATTRIBUTE = buildAcceptAttribute(
  LIBRARY_MESH_IMPORT_EXTENSIONS,
  true,
);
export const LIBRARY_IMAGE_IMPORT_ACCEPT_ATTRIBUTE = buildAcceptAttribute(
  LIBRARY_IMAGE_IMPORT_EXTENSIONS,
  true,
);

export function isSupportedArchiveImportFile(fileName: string): boolean {
  return matchesImportExtension(fileName, SUPPORTED_ARCHIVE_IMPORT_EXTENSIONS);
}

export function hasHiddenImportPathSegment(path: string): boolean {
  const normalizedPath = path.replace(/\\/g, '/').trim();
  return normalizedPath
    .split('/')
    .filter(Boolean)
    .some((part) => part.startsWith('.'));
}

function isMotorLibraryImportPath(path: string): boolean {
  const normalizedPath = path.replace(/\\/g, '/').toLowerCase();
  const fileName = normalizedPath.split('/').pop() ?? normalizedPath;

  if (fileName === 'motor-library.json' || fileName === 'motor_library.json') {
    return true;
  }

  return (
    normalizedPath.includes('motor library') &&
    (normalizedPath.endsWith('.txt') || normalizedPath.endsWith('.json'))
  );
}

export function isRobotImportCandidatePath(path: string): boolean {
  const normalizedPath = path.replace(/\\/g, '/').trim();
  if (!normalizedPath || hasHiddenImportPathSegment(normalizedPath)) {
    return false;
  }

  const lowerPath = normalizedPath.toLowerCase();
  const fileName = lowerPath.split('/').pop() ?? lowerPath;
  if (fileName === 'cmakelists.txt' || fileName === 'package.xml') {
    return false;
  }

  return (
    isMotorLibraryImportPath(lowerPath) ||
    matchesImportExtension(lowerPath, SUPPORTED_ARCHIVE_IMPORT_EXTENSIONS) ||
    matchesImportExtension(lowerPath, ROBOT_DEFINITION_IMPORT_EXTENSIONS) ||
    matchesImportExtension(lowerPath, ROBOT_IMPORT_ASSET_EXTENSIONS) ||
    matchesImportExtension(lowerPath, ROBOT_IMPORT_AUXILIARY_TEXT_EXTENSIONS)
  );
}

export function isRobotImportAssetPath(path: string): boolean {
  return matchesImportExtension(path, ROBOT_IMPORT_ASSET_EXTENSIONS);
}

export function isRobotDefinitionFormat(format: RobotFile['format']): boolean {
  return ROBOT_DEFINITION_FORMATS.has(format);
}

export function isAssetLibraryOnlyFormat(format: RobotFile['format']): boolean {
  return ASSET_LIBRARY_ONLY_FORMATS.has(format);
}

export function isLibraryRobotExportableFormat(format: RobotFile['format']): boolean {
  return LIBRARY_ROBOT_EXPORTABLE_FORMATS.has(format);
}

export function isLibraryMeshImportPath(path: string): boolean {
  return LIBRARY_MESH_IMPORT_EXTENSION_SET.has(getAssetFileExtension(path));
}

export function isLibraryImageImportPath(path: string): boolean {
  return LIBRARY_IMAGE_IMPORT_EXTENSION_SET.has(getAssetFileExtension(path));
}

export function isVisibleLibraryAssetPath(path: string): boolean {
  return isLibraryMeshImportPath(path) || isLibraryImageImportPath(path);
}

export function classifyLibraryFileKind(file: Pick<RobotFile, 'name' | 'format'>): LibraryFileKind {
  if (isRobotDefinitionFormat(file.format)) {
    return 'robot';
  }

  if (file.format === 'mesh') {
    if (isLibraryImageImportPath(file.name)) {
      return 'image';
    }

    if (isLibraryMeshImportPath(file.name)) {
      return 'mesh';
    }
  }

  return 'support';
}

export function isVisibleLibraryEntry(file: Pick<RobotFile, 'name' | 'format'>): boolean {
  return classifyLibraryFileKind(file) !== 'support';
}

export function isLibraryPreviewableFile(file: Pick<RobotFile, 'name' | 'format'>): boolean {
  return isVisibleLibraryEntry(file);
}

export function isLibraryComponentAddableFile(file: Pick<RobotFile, 'name' | 'format'>): boolean {
  const kind = classifyLibraryFileKind(file);
  return kind === 'robot' || kind === 'mesh';
}
