import { normalizeLibraryPathKey } from '@/core/utils/pathKeys';

const DUPLICATE_SUFFIX_PATTERN = /^(.*?)(?: \((\d+)\))?$/;

function normalizeImportPath(path: string): string {
  return normalizeLibraryPathKey(path);
}

function getTopLevelFolder(path: string): string | null {
  const normalizedPath = normalizeImportPath(path);
  const separatorIndex = normalizedPath.indexOf('/');
  if (separatorIndex <= 0) {
    return null;
  }

  return normalizedPath.slice(0, separatorIndex);
}

function createUniqueFolderName(folderName: string, reservedNames: Set<string>): string {
  if (!reservedNames.has(folderName)) {
    return folderName;
  }

  const match = folderName.match(DUPLICATE_SUFFIX_PATTERN);
  const baseName = match?.[1] || folderName;
  let suffix = match?.[2] ? Number(match[2]) + 1 : 1;
  let candidate = `${baseName} (${suffix})`;

  while (reservedNames.has(candidate)) {
    suffix += 1;
    candidate = `${baseName} (${suffix})`;
  }

  return candidate;
}

export function createImportPathCollisionMap(
  importedPaths: readonly string[],
  existingPaths: Iterable<string>,
): Map<string, string> {
  const reservedTopLevelFolders = new Set<string>();

  for (const path of existingPaths) {
    const topLevelFolder = getTopLevelFolder(path);
    if (topLevelFolder) {
      reservedTopLevelFolders.add(topLevelFolder);
    }
  }

  const topLevelFolderMap = new Map<string, string>();
  const pathMap = new Map<string, string>();

  for (const path of importedPaths) {
    const normalizedPath = normalizeImportPath(path);
    const topLevelFolder = getTopLevelFolder(normalizedPath);

    if (!topLevelFolder) {
      pathMap.set(normalizedPath, normalizedPath);
      continue;
    }

    let resolvedFolderName = topLevelFolderMap.get(topLevelFolder);
    if (!resolvedFolderName) {
      resolvedFolderName = createUniqueFolderName(topLevelFolder, reservedTopLevelFolders);
      topLevelFolderMap.set(topLevelFolder, resolvedFolderName);
      reservedTopLevelFolders.add(resolvedFolderName);
    }

    if (resolvedFolderName === topLevelFolder) {
      pathMap.set(normalizedPath, normalizedPath);
      continue;
    }

    pathMap.set(
      normalizedPath,
      `${resolvedFolderName}${normalizedPath.slice(topLevelFolder.length)}`,
    );
  }

  return pathMap;
}

export function remapImportedPath(path: string, pathMap: ReadonlyMap<string, string>): string {
  const normalizedPath = normalizeImportPath(path);
  return pathMap.get(normalizedPath) ?? normalizedPath;
}
