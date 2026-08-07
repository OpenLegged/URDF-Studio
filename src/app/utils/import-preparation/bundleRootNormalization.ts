import { inferCommonPackageAssetBundleRoot } from '@/app/utils/importPackageAssetReferences.ts';
import { isAssetLibraryOnlyFormat } from '@/shared/utils/robotFileSupport';
import { normalizeLibraryPathKey } from '@/core/utils/pathKeys';
import type { RobotFile } from '@/types';

interface BundleRootPayload {
  robotFiles: RobotFile[];
  assetFiles: Array<{ name: string }>;
  deferredAssetFiles: Array<{ name: string }>;
  usdSourceFiles: Array<{ name: string }>;
  libraryFiles: Array<{ path: string }>;
  textFiles: Array<{ path: string }>;
}

const LOOSE_IMPORT_ROOTLESS_FOLDERS = new Set([
  'meshes',
  'mesh',
  'mjcf',
  'urdf',
  'textures',
  'texture',
  'dae',
  'obj',
  'stl',
  'usd',
  'usda',
  'usdc',
  'usdz',
  'xacro',
  'sdf',
  'motor library',
  'materials',
  'launch',
  'config',
  'rviz',
  'worlds',
  'media',
  'thumbnail',
  'thumbnails',
]);

function normalizeImportPath(path: string): string {
  return normalizeLibraryPathKey(path);
}

interface PathStructureInfo {
  topLevelSegments: string[];
  topSegmentsAreRootlessFolders: boolean;
}

function analyzeImportPathStructure(paths: readonly string[]): PathStructureInfo {
  const normalizedPaths = paths.map(normalizeImportPath).filter(Boolean);

  if (normalizedPaths.length === 0) {
    return {
      topLevelSegments: [],
      topSegmentsAreRootlessFolders: false,
    };
  }

  const topLevelSegments = new Set(
    normalizedPaths
      .map(getTopLevelImportSegment)
      .filter((segment): segment is string => segment !== null),
  );
  const topLevelSegmentList = Array.from(topLevelSegments);

  const topSegmentsAreRootlessFolders = Array.from(topLevelSegments).every((segment) =>
    LOOSE_IMPORT_ROOTLESS_FOLDERS.has(segment.toLowerCase()),
  );

  return {
    topLevelSegments: topLevelSegmentList,
    topSegmentsAreRootlessFolders,
  };
}

function getTopLevelImportSegment(path: string): string | null {
  const normalized = normalizeImportPath(path);
  const separatorIndex = normalized.indexOf('/');
  if (separatorIndex <= 0) {
    return null;
  }

  return normalized.slice(0, separatorIndex);
}

function sanitizeInferredImportRoot(rootName: string | null | undefined): string | null {
  const trimmed = rootName?.trim();
  if (!trimmed) {
    return null;
  }

  const sanitized = trimmed
    .replace(/[\\/]+/g, '-')
    .replace(/^\.+/, '')
    .trim();

  return sanitized || null;
}

function collectPayloadImportPaths(payload: BundleRootPayload): string[] {
  return [
    ...payload.robotFiles.map((file) => file.name),
    ...payload.assetFiles.map((file) => file.name),
    ...payload.deferredAssetFiles.map((file) => file.name),
    ...payload.usdSourceFiles.map((file) => file.name),
    ...payload.libraryFiles.map((file) => file.path),
    ...payload.textFiles.map((file) => file.path),
  ].map(normalizeImportPath);
}

function inferBundleRootFromRobotFiles(robotFiles: readonly RobotFile[]): string | null {
  for (const file of robotFiles) {
    if (file.format === 'sdf') {
      const match = file.content.match(/<model\b[^>]*\bname\s*=\s*["']([^"']+)["']/i);
      const inferred = sanitizeInferredImportRoot(match?.[1]);
      if (inferred) {
        return inferred;
      }
    }
  }

  for (const file of robotFiles) {
    if (file.format === 'urdf' || file.format === 'xacro') {
      const match = file.content.match(/<robot\b[^>]*\bname\s*=\s*["']([^"']+)["']/i);
      const inferred = sanitizeInferredImportRoot(match?.[1]);
      if (inferred) {
        return inferred;
      }
    }
  }

  for (const file of robotFiles) {
    if (file.format === 'mjcf') {
      const match = file.content.match(/<mujoco\b[^>]*\bmodel\s*=\s*["']([^"']+)["']/i);
      const inferred = sanitizeInferredImportRoot(match?.[1]);
      if (inferred) {
        return inferred;
      }
    }
  }

  const firstDefinitionFile =
    robotFiles.find((file) => !isAssetLibraryOnlyFormat(file.format) && file.format !== 'usd') ??
    robotFiles.find((file) => !isAssetLibraryOnlyFormat(file.format)) ??
    robotFiles[0];

  if (!firstDefinitionFile) {
    return null;
  }

  const inferredFromStem = firstDefinitionFile.name
    .split('/')
    .pop()
    ?.replace(/\.[^.]+$/, '');
  return sanitizeInferredImportRoot(inferredFromStem);
}

function hasExistingBundleRootPrefix(payload: BundleRootPayload, bundleRoot: string): boolean {
  const normalizedBundleRoot = normalizeImportPath(bundleRoot);
  if (!normalizedBundleRoot) {
    return false;
  }

  const allPaths = collectPayloadImportPaths(payload);

  return allPaths.some(
    (path) => path === normalizedBundleRoot || path.startsWith(`${normalizedBundleRoot}/`),
  );
}

function shouldWrapLooseImportUnderBundleRoot(
  payload: BundleRootPayload,
  options: {
    bundleRoot?: string | null;
    allowRootLevelDefinitionWithSingleFolder?: boolean;
  } = {},
): boolean {
  const allPaths = collectPayloadImportPaths(payload);

  if (allPaths.length === 0) {
    return false;
  }

  if (options.bundleRoot && hasExistingBundleRootPrefix(payload, options.bundleRoot)) {
    return false;
  }

  const pathStructure = analyzeImportPathStructure(allPaths);

  const hasRootLevelDefinitionFile = payload.robotFiles.some(
    (file) =>
      !isAssetLibraryOnlyFormat(file.format) &&
      file.format !== 'usd' &&
      getTopLevelImportSegment(file.name) === null,
  );

  if (pathStructure.topLevelSegments.length === 0) {
    return false;
  }

  if (!pathStructure.topSegmentsAreRootlessFolders) {
    return false;
  }

  if (
    options.allowRootLevelDefinitionWithSingleFolder &&
    pathStructure.topLevelSegments.length === 1 &&
    hasRootLevelDefinitionFile
  ) {
    return true;
  }

  if (pathStructure.topLevelSegments.length <= 1) {
    return false;
  }

  return payload.robotFiles.some((file) => !isAssetLibraryOnlyFormat(file.format));
}

function shouldWrapLooseImportUnderPackageAssetRoot(
  payload: BundleRootPayload,
  bundleRoot: string | null,
): boolean {
  if (!bundleRoot || hasExistingBundleRootPrefix(payload, bundleRoot)) {
    return false;
  }

  const allPaths = collectPayloadImportPaths(payload);
  if (allPaths.length === 0) {
    return false;
  }

  const hasDefinitionFile = payload.robotFiles.some(
    (file) => !isAssetLibraryOnlyFormat(file.format) && file.format !== 'usd',
  );
  if (!hasDefinitionFile) {
    return false;
  }

  const hasRootLevelDefinitionFile = payload.robotFiles.some(
    (file) =>
      !isAssetLibraryOnlyFormat(file.format) &&
      file.format !== 'usd' &&
      getTopLevelImportSegment(file.name) === null,
  );
  const pathStructure = analyzeImportPathStructure(allPaths);

  if (pathStructure.topLevelSegments.length === 0) {
    return false;
  }

  if (pathStructure.topLevelSegments.length === 1 && !hasRootLevelDefinitionFile) {
    return false;
  }

  return true;
}

function prefixCollectedImportPath(path: string, bundleRoot: string): string {
  const normalized = normalizeImportPath(path);
  if (!normalized) {
    return bundleRoot;
  }

  return `${bundleRoot}/${normalized}`;
}

export function normalizeLooseImportBundleRoot<T extends BundleRootPayload>(payload: T): T {
  const packageAssetBundleRoot = inferCommonPackageAssetBundleRoot(
    payload.robotFiles
      .filter((file) => !isAssetLibraryOnlyFormat(file.format) && file.format !== 'usd')
      .map((file) => ({ format: file.format, content: file.content })),
  );
  const bundleRoot =
    packageAssetBundleRoot &&
    shouldWrapLooseImportUnderPackageAssetRoot(payload, packageAssetBundleRoot)
      ? packageAssetBundleRoot
      : shouldWrapLooseImportUnderBundleRoot(payload)
        ? inferBundleRootFromRobotFiles(payload.robotFiles)
        : null;
  if (!bundleRoot) {
    return payload;
  }

  return {
    ...payload,
    robotFiles: payload.robotFiles.map((file) => ({
      ...file,
      name: prefixCollectedImportPath(file.name, bundleRoot),
    })),
    assetFiles: payload.assetFiles.map((file) => ({
      ...file,
      name: prefixCollectedImportPath(file.name, bundleRoot),
    })),
    deferredAssetFiles: payload.deferredAssetFiles.map((file) => ({
      ...file,
      name: prefixCollectedImportPath(file.name, bundleRoot),
    })),
    usdSourceFiles: payload.usdSourceFiles.map((file) => ({
      ...file,
      name: prefixCollectedImportPath(file.name, bundleRoot),
    })),
    libraryFiles: payload.libraryFiles.map((file) => ({
      ...file,
      path: prefixCollectedImportPath(file.path, bundleRoot),
    })),
    textFiles: payload.textFiles.map((file) => ({
      ...file,
      path: prefixCollectedImportPath(file.path, bundleRoot),
    })),
  };
}
