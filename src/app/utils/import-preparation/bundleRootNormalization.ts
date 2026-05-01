import { inferCommonPackageAssetBundleRoot } from '@/app/utils/importPackageAssetReferences.ts';
import { isAssetLibraryOnlyFormat } from '@/shared/utils/robotFileSupport';
import { normalizeLibraryPathKey } from '@/shared/utils/pathKeys';
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
  'robot',
  'robots',
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
  topLevelSegment: string | null;
  hasMultipleTopLevelSegments: boolean;
  topSegmentsAreRootlessFolders: boolean;
}

function analyzeImportPathStructure(paths: readonly string[]): PathStructureInfo {
  const normalizedPaths = paths.map(normalizeImportPath);

  if (normalizedPaths.length === 0) {
    return { topLevelSegment: null, hasMultipleTopLevelSegments: false, topSegmentsAreRootlessFolders: false };
  }

  const topLevelSegments = new Set(
    normalizedPaths
      .map(getTopLevelImportSegment)
      .filter((s): s is string => s !== null)
  );

  const hasMultipleTopLevelSegments = topLevelSegments.size > 1;
  const topLevelSegment = topLevelSegments.size === 1 ? Array.from(topLevelSegments)[0] : null;

  const topSegmentsAreRootlessFolders = Array.from(topLevelSegments).every((segment) =>
    LOOSE_IMPORT_ROOTLESS_FOLDERS.has(segment.toLowerCase())
  );

  return {
    topLevelSegment,
    hasMultipleTopLevelSegments,
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

  const allFilePaths = robotFiles.map((file) => file.name);
  const pathStructure = analyzeImportPathStructure(allFilePaths);

  if (
    pathStructure.topLevelSegment &&
    !pathStructure.hasMultipleTopLevelSegments &&
    !pathStructure.topSegmentsAreRootlessFolders
  ) {
    return null;
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

  const allPaths = [
    ...payload.robotFiles.map((file) => file.name),
    ...payload.assetFiles.map((file) => file.name),
    ...payload.usdSourceFiles.map((file) => file.name),
    ...payload.libraryFiles.map((file) => file.path),
    ...payload.textFiles.map((file) => file.path),
  ].map(normalizeImportPath);

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
  const allPaths = [
    ...payload.robotFiles.map((file) => file.name),
    ...payload.assetFiles.map((file) => file.name),
    ...payload.usdSourceFiles.map((file) => file.name),
    ...payload.libraryFiles.map((file) => file.path),
    ...payload.textFiles.map((file) => file.path),
  ].map(normalizeImportPath);

  if (allPaths.length === 0) {
    return false;
  }

  if (options.bundleRoot && hasExistingBundleRootPrefix(payload, options.bundleRoot)) {
    return false;
  }

  const topLevelSegments = new Set(
    allPaths.map(getTopLevelImportSegment).filter((segment): segment is string => Boolean(segment)),
  );

  const hasRootLevelDefinitionFile = payload.robotFiles.some(
    (file) =>
      !isAssetLibraryOnlyFormat(file.format) &&
      file.format !== 'usd' &&
      getTopLevelImportSegment(file.name) === null,
  );

  if (topLevelSegments.size === 0) {
    return false;
  }

  const hasConventionalRobotFolders = Array.from(topLevelSegments).every((segment) =>
    LOOSE_IMPORT_ROOTLESS_FOLDERS.has(segment.toLowerCase()),
  );

  if (!hasConventionalRobotFolders) {
    return false;
  }

  if (
    options.allowRootLevelDefinitionWithSingleFolder &&
    topLevelSegments.size === 1 &&
    hasRootLevelDefinitionFile
  ) {
    return true;
  }

  if (topLevelSegments.size <= 1) {
    return false;
  }

  return payload.robotFiles.some((file) => !isAssetLibraryOnlyFormat(file.format));
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
    shouldWrapLooseImportUnderBundleRoot(payload, {
      bundleRoot: packageAssetBundleRoot,
      allowRootLevelDefinitionWithSingleFolder: true,
    })
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
