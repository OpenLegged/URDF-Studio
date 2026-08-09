import {
  GeometryType,
  type RobotData,
  type RobotState,
  type SdfHeightmapTexture,
  type UrdfLink,
} from '@/types';
import { normalizeRelativePath } from '@/core/utils/pathNormalization';

export const MESH_EXPORT_ROOT_SEGMENTS = new Set([
  'assets',
  'dae',
  'obj',
  'stl',
  'gltf',
  'glb',
  'mesh',
  'meshes',
  'texture',
  'textures',
  'material',
  'materials',
]);

export const TEXTURE_EXPORT_ROOT_SEGMENTS = new Set([
  'assets',
  'texture',
  'textures',
  'material',
  'materials',
  'image',
  'images',
]);

export const PACKAGE_ASSET_ROOT_SEGMENTS = new Set([
  ...MESH_EXPORT_ROOT_SEGMENTS,
  ...TEXTURE_EXPORT_ROOT_SEGMENTS,
  'image',
  'images',
  'media',
  'thumbnail',
  'thumbnails',
]);

export const SOURCE_LAYOUT_DIRECTORIES = new Set([
  'urdf',
  'xacro',
  'sdf',
  'mjcf',
  'usd',
  'xml',
  'robots',
  'models',
]);

export function slicePathFromKnownRoot(
  normalizedPath: string,
  rootSegments: ReadonlySet<string>,
  dropRootSegments: ReadonlySet<string> = new Set(),
): string | null {
  const segments = normalizedPath.split('/');

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]?.toLowerCase();
    if (!segment || !rootSegments.has(segment)) {
      continue;
    }

    const sliced = dropRootSegments.has(segment)
      ? segments.slice(index + 1)
      : segments.slice(index);
    const result = normalizeRelativePath(sliced.join('/'));
    if (result) {
      return result;
    }
  }

  return null;
}

export const stripPackagePrefix = (path: string): string => {
  const scheme = path.startsWith('package://')
    ? 'package://'
    : path.startsWith('model://')
      ? 'model://'
      : null;
  if (!scheme) return path;
  const withoutScheme = path.slice(scheme.length);
  const slashIndex = withoutScheme.indexOf('/');
  return slashIndex >= 0 ? withoutScheme.slice(slashIndex + 1) : withoutScheme;
};

export const stripBlobPrefix = (path: string): string => {
  if (!path.startsWith('blob:')) return path;
  const slashIndex = path.indexOf('/', 5);
  return slashIndex >= 0 ? path.slice(slashIndex + 1) : path;
};

export const stripFilePrefix = (path: string): string => {
  if (!/^file:\/\//i.test(path)) return path;

  try {
    const parsed = new URL(path);
    return decodeURIComponent(parsed.pathname).replace(/^\/([A-Za-z]:\/)/, '$1');
  } catch {
    return path.replace(/^file:\/\/*/i, '');
  }
};

export const stripExternalPrefix = (path: string): string => {
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith('data:')) return path;
  return stripPackagePrefix(stripFilePrefix(stripBlobPrefix(path)));
};

export const normalizePackageAssetPath = (path: string): string | null => {
  const scheme = path.startsWith('package://')
    ? 'package://'
    : path.startsWith('model://')
      ? 'model://'
      : null;
  if (!scheme) return null;

  const withoutScheme = path.slice(scheme.length).replace(/\\/g, '/');
  const slashIndex = withoutScheme.indexOf('/');
  const packageName = slashIndex >= 0 ? withoutScheme.slice(0, slashIndex) : withoutScheme;
  const relativePath = slashIndex >= 0 ? withoutScheme.slice(slashIndex + 1) : '';
  const normalizedRelativePath = normalizeRelativePath(
    relativePath
      .replace(/^[A-Za-z]:\//, '')
      .replace(/^\/+/, '')
      .replace(/^(\.\/)+/, ''),
  );

  if (!packageName) return normalizedRelativePath || null;
  if (!normalizedRelativePath) return packageName;

  return `${packageName}/${normalizedRelativePath}`;
};

export interface ImportedAssetPathResolutionOptions {
  candidateAssetPaths?: Iterable<string>;
}

export function countCommonLeadingSegments(leftPath: string, rightPath: string): number {
  const leftSegments = leftPath.split('/').filter(Boolean);
  const rightSegments = rightPath.split('/').filter(Boolean);
  const length = Math.min(leftSegments.length, rightSegments.length);
  let count = 0;

  while (count < length && leftSegments[count] === rightSegments[count]) {
    count += 1;
  }

  return count;
}

export function resolvePackageAssetPathFromCandidates(
  packageAssetPath: string,
  sourceFilePath: string | null | undefined,
  candidateAssetPaths: Iterable<string> | undefined,
): string | null {
  if (!candidateAssetPaths) {
    return null;
  }

  const normalizedPackageAssetPath = normalizeRelativePath(
    packageAssetPath.replace(/\\/g, '/').replace(/^\/+/, ''),
  );
  if (!normalizedPackageAssetPath) {
    return null;
  }

  const packageAssetReferencePaths = buildPackageAssetReferencePaths(normalizedPackageAssetPath);
  const suffixMatches: Array<{ path: string; score: number }> = [];

  for (const candidatePath of candidateAssetPaths) {
    const normalizedCandidatePath = normalizeAssetPathForComparison(candidatePath);
    if (!normalizedCandidatePath) {
      continue;
    }

    packageAssetReferencePaths.forEach((referencePath) => {
      if (
        normalizedCandidatePath === referencePath ||
        normalizedCandidatePath.endsWith(`/${referencePath}`)
      ) {
        suffixMatches.push({
          path: normalizedCandidatePath,
          score: referencePath.split('/').length,
        });
      }
    });
  }

  if (suffixMatches.length === 0) {
    return null;
  }

  const bestReferenceScore = Math.max(...suffixMatches.map((match) => match.score));
  const bestReferenceMatches = suffixMatches.filter((match) => match.score === bestReferenceScore);
  const uniqueMatches = Array.from(new Set(bestReferenceMatches.map((match) => match.path)));

  if (uniqueMatches.length === 1) {
    return uniqueMatches[0];
  }

  const normalizedSourcePath = normalizeAssetPathForComparison(sourceFilePath ?? '');
  if (!normalizedSourcePath) {
    return null;
  }

  let bestMatch: string | null = null;
  let bestScore = 0;
  let isAmbiguous = false;

  uniqueMatches.forEach((candidatePath) => {
    const score = countCommonLeadingSegments(candidatePath, normalizedSourcePath);
    if (score > bestScore) {
      bestMatch = candidatePath;
      bestScore = score;
      isAmbiguous = false;
      return;
    }

    if (score === bestScore && score > 0) {
      isAmbiguous = true;
    }
  });

  return bestMatch && bestScore > 0 && !isAmbiguous ? bestMatch : null;
}

export function buildPackageAssetReferencePaths(normalizedPackageAssetPath: string): string[] {
  const segments = normalizedPackageAssetPath.split('/').filter(Boolean);
  const referencePaths = new Set<string>([normalizedPackageAssetPath]);

  segments.forEach((segment, index) => {
    if (!PACKAGE_ASSET_ROOT_SEGMENTS.has(segment.toLowerCase())) {
      return;
    }

    for (let startIndex = 1; startIndex <= index; startIndex += 1) {
      const suffix = segments.slice(startIndex).join('/');
      if (suffix) {
        referencePaths.add(suffix);
      }
    }
  });

  return [...referencePaths];
}

export const getSourceFileDirectory = (sourceFilePath?: string | null): string => {
  const normalized = (sourceFilePath ?? '').trim().replace(/\\/g, '/');
  if (!normalized) return '';

  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash < 0) return '';

  return normalized.slice(0, lastSlash + 1);
};

export function getSourceBundleRootSegments(sourceFilePath?: string | null): string[] {
  const normalizedSourcePath = normalizeAssetPathForComparison(sourceFilePath ?? '');
  if (!normalizedSourcePath) {
    return [];
  }

  const sourceSegments = normalizedSourcePath.split('/').filter(Boolean);
  if (sourceSegments.length <= 1) {
    return [];
  }

  const layoutDirectoryIndex = sourceSegments.findIndex(
    (segment, index) => index > 0 && SOURCE_LAYOUT_DIRECTORIES.has(segment.toLowerCase()),
  );
  if (layoutDirectoryIndex > 0) {
    return sourceSegments.slice(0, layoutDirectoryIndex);
  }

  return [sourceSegments[0]];
}

export function isBundleRootedAssetPath(
  normalizedAssetPath: string,
  sourceFilePath?: string | null,
): boolean {
  const assetSegments = normalizeRelativePath(normalizedAssetPath).split('/').filter(Boolean);
  const sourceRootSegments = getSourceBundleRootSegments(sourceFilePath);
  if (sourceRootSegments.length === 0 || assetSegments.length <= sourceRootSegments.length) {
    return false;
  }

  const startsWithSourceRoot = sourceRootSegments.every(
    (segment, index) => assetSegments[index] === segment,
  );
  if (!startsWithSourceRoot) {
    return false;
  }

  return assetSegments
    .slice(sourceRootSegments.length)
    .some((segment) => PACKAGE_ASSET_ROOT_SEGMENTS.has(segment.toLowerCase()));
}

export const resolveImportedAssetPath = (
  assetPath: string,
  sourceFilePath?: string | null,
  options: ImportedAssetPathResolutionOptions = {},
): string => {
  const raw = (assetPath || '').trim();
  if (!raw) return '';

  if (/^(?:blob:|https?:\/\/|data:)/i.test(raw)) {
    return raw;
  }

  const packageAssetPath = normalizePackageAssetPath(raw);
  if (packageAssetPath) {
    return (
      resolvePackageAssetPathFromCandidates(
        packageAssetPath,
        sourceFilePath,
        options.candidateAssetPaths,
      ) ?? packageAssetPath
    );
  }

  let normalized = raw.replace(/\\/g, '/');
  normalized = stripExternalPrefix(normalized);
  normalized = normalized.replace(/^[A-Za-z]:\//, '');
  normalized = normalized.replace(/^\/+/, '');
  normalized = normalized.replace(/^(\.\/)+/, '');

  const sourceDir = getSourceFileDirectory(sourceFilePath);
  if (!normalized) return raw;
  if (!sourceDir) return normalizeRelativePath(normalized);
  if (normalized.startsWith(sourceDir)) return normalizeRelativePath(normalized);
  if (isBundleRootedAssetPath(normalized, sourceFilePath)) {
    return normalizeRelativePath(normalized);
  }

  return normalizeRelativePath(`${sourceDir}${normalized}`);
};

export type RobotWithLinks = RobotData | RobotState;

export const IMPORTED_ASSET_DIRECTORY_HINTS = new Set([
  'materials',
  'meshes',
  'textures',
  'media',
  'scripts',
  'dae',
  'obj',
  'stl',
]);

export function inferSourcePackageSegment(sourceFilePath?: string | null): string {
  const normalizedSourcePath = normalizeRelativePath(
    String(sourceFilePath || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^[A-Za-z]:\//, '')
      .replace(/^\/+/, ''),
  );
  if (!normalizedSourcePath) {
    return '';
  }

  const directorySegments = normalizedSourcePath.split('/').slice(0, -1);
  if (directorySegments.length === 0) {
    return '';
  }

  for (let index = directorySegments.length - 1; index >= 0; index -= 1) {
    const segment = directorySegments[index];
    if (!SOURCE_LAYOUT_DIRECTORIES.has(segment.toLowerCase())) {
      return segment;
    }
  }

  return directorySegments[directorySegments.length - 1] || '';
}

export function isExplicitRelativeAssetPath(path: string): boolean {
  return /^(?:\.\.?(?:[\\/]|$)|[\\/])/.test(path);
}

export function normalizeAssetPathForComparison(path: string): string {
  return normalizeRelativePath(
    stripExternalPrefix(path.replace(/\\/g, '/'))
      .replace(/^[A-Za-z]:\//, '')
      .replace(/^\/+/, '')
      .replace(/^\.\//, ''),
  );
}

export function isLikelyCanonicalImportedAssetPath(
  assetPath: string,
  sourceFilePath?: string | null,
): boolean {
  if (!sourceFilePath) {
    return false;
  }

  const normalizedAssetPath = normalizeAssetPathForComparison(assetPath);
  if (!normalizedAssetPath) {
    return false;
  }

  const sourceDirectory = getSourceFileDirectory(sourceFilePath);
  if (sourceDirectory && normalizedAssetPath.startsWith(sourceDirectory)) {
    return true;
  }

  const firstAssetSegment = normalizedAssetPath.split('/')[0] || '';
  if (!firstAssetSegment) {
    return false;
  }

  const assetSegments = normalizedAssetPath.split('/');
  const secondAssetSegment = assetSegments[1]?.toLowerCase() || '';

  const normalizedSourcePath = normalizeRelativePath(
    String(sourceFilePath || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^[A-Za-z]:\//, '')
      .replace(/^\/+/, ''),
  );
  const firstSourceSegment = normalizedSourcePath.split('/')[0] || '';
  if (firstSourceSegment && firstAssetSegment === firstSourceSegment) {
    return true;
  }

  const sourcePackageSegment = inferSourcePackageSegment(sourceFilePath);
  if (sourcePackageSegment && firstAssetSegment === sourcePackageSegment) {
    return true;
  }

  if (
    normalizedSourcePath.toLowerCase().endsWith('.sdf') &&
    assetSegments.length >= 2 &&
    !IMPORTED_ASSET_DIRECTORY_HINTS.has(firstAssetSegment.toLowerCase()) &&
    IMPORTED_ASSET_DIRECTORY_HINTS.has(secondAssetSegment)
  ) {
    return true;
  }

  return false;
}

export function rewriteTexturePathForSource(
  texturePath: string,
  sourceFilePath?: string | null,
  options: ImportedAssetPathResolutionOptions = {},
): string {
  const rawTexturePath = String(texturePath || '').trim();
  if (!rawTexturePath) {
    return texturePath;
  }

  const hasPackageLikeScheme =
    rawTexturePath.startsWith('package://') || rawTexturePath.startsWith('model://');
  if (
    !hasPackageLikeScheme &&
    !isExplicitRelativeAssetPath(rawTexturePath) &&
    isLikelyCanonicalImportedAssetPath(rawTexturePath, sourceFilePath)
  ) {
    // SDF/gazebo script materials may already resolve textures to package-rooted paths.
    return normalizeAssetPathForComparison(rawTexturePath) || texturePath;
  }

  const resolvedPath = resolveImportedAssetPath(texturePath, sourceFilePath, options);
  return resolvedPath || texturePath;
}

export function rewriteGeometryTextureRefsForSource<T extends UrdfLink['visual'] | UrdfLink['collision']>(
  geometry: T,
  sourceFilePath?: string | null,
  options: ImportedAssetPathResolutionOptions = {},
): T {
  const authoredMaterials = geometry?.authoredMaterials;
  if (!geometry || !Array.isArray(authoredMaterials) || authoredMaterials.length === 0) {
    return geometry;
  }

  let materialsChanged = false;
  const nextAuthoredMaterials = authoredMaterials.map((material) => {
    const texturePath = material.texture?.trim();
    const resolvedTexturePath = texturePath
      ? rewriteTexturePathForSource(texturePath, sourceFilePath, options)
      : undefined;
    const textureChanged = texturePath && resolvedTexturePath !== texturePath;

    let passesChanged = false;
    const nextPasses = material.passes?.map((pass) => {
      if (!pass.texture?.trim()) {
        return pass;
      }
      const resolvedPassTexture = rewriteTexturePathForSource(
        pass.texture,
        sourceFilePath,
        options,
      );
      if (resolvedPassTexture === pass.texture) {
        return pass;
      }
      passesChanged = true;
      return { ...pass, texture: resolvedPassTexture };
    });

    if (!textureChanged && !passesChanged) {
      return material;
    }

    materialsChanged = true;
    return {
      ...material,
      ...(textureChanged ? { texture: resolvedTexturePath } : {}),
      ...(passesChanged ? { passes: nextPasses } : {}),
    };
  });

  if (!materialsChanged) {
    return geometry;
  }

  return {
    ...geometry,
    authoredMaterials: nextAuthoredMaterials,
  };
}

export function rewriteMeshGeometryForSource<T extends UrdfLink['visual'] | UrdfLink['collision']>(
  geometry: T,
  sourceFilePath?: string | null,
  options: ImportedAssetPathResolutionOptions = {},
): T {
  if (!geometry || !geometry.meshPath) {
    return geometry;
  }

  const isRewritableType =
    geometry.type === GeometryType.MESH || geometry.type === GeometryType.HFIELD;
  if (!isRewritableType) {
    return geometry;
  }

  const resolvedPath = resolveImportedAssetPath(geometry.meshPath, sourceFilePath, options);
  if (!resolvedPath || resolvedPath === geometry.meshPath) {
    return geometry;
  }

  const result = {
    ...geometry,
    meshPath: resolvedPath,
  };

  if (geometry.type === GeometryType.HFIELD && geometry.sdfHeightmap) {
    const hfield = geometry.sdfHeightmap;
    const resolvedUri = resolveImportedAssetPath(hfield.uri, sourceFilePath, options);

    const resolvedTextures: SdfHeightmapTexture[] = hfield.textures.map((tex) => {
      const resolvedDiffuse = tex.diffuse
        ? resolveImportedAssetPath(tex.diffuse, sourceFilePath, options)
        : undefined;
      const resolvedNormal = tex.normal
        ? resolveImportedAssetPath(tex.normal, sourceFilePath, options)
        : undefined;
      return {
        ...tex,
        ...(resolvedDiffuse && resolvedDiffuse !== tex.diffuse ? { diffuse: resolvedDiffuse } : {}),
        ...(resolvedNormal && resolvedNormal !== tex.normal ? { normal: resolvedNormal } : {}),
      };
    });

    return {
      ...result,
      sdfHeightmap: {
        ...hfield,
        uri: resolvedUri || hfield.uri,
        textures: resolvedTextures,
      },
    } as T;
  }

  return result as T;
}

export function rewriteGeometryAssetPathsForSource<T extends UrdfLink['visual'] | UrdfLink['collision']>(
  geometry: T,
  sourceFilePath?: string | null,
  options: ImportedAssetPathResolutionOptions = {},
): T {
  const nextGeometry = rewriteMeshGeometryForSource(geometry, sourceFilePath, options);
  return rewriteGeometryTextureRefsForSource(nextGeometry, sourceFilePath, options);
}

export const normalizeMeshPathForExport = (meshPath: string): string => {
  const raw = (meshPath || '').trim();
  if (!raw) return '';
  if (/^(?:https?:\/\/|data:)/i.test(raw)) return raw;

  let normalized = raw.replace(/\\/g, '/');
  normalized = stripExternalPrefix(normalized);

  // Drop Windows drive prefix (e.g. C:/)
  normalized = normalized.replace(/^[A-Za-z]:\//, '');

  normalized = normalized.replace(/^\/+/, '');
  normalized = normalized.replace(/^(\.\/)+/, '');
  normalized = normalizeRelativePath(normalized);

  const lower = normalized.toLowerCase();
  const meshDirIndex = lower.indexOf('/meshes/');
  if (meshDirIndex >= 0) {
    normalized = normalized.slice(meshDirIndex + '/meshes/'.length);
  } else if (lower.startsWith('meshes/')) {
    normalized = normalized.slice('meshes/'.length);
  } else if (lower.startsWith('mesh/')) {
    normalized = normalized.slice('mesh/'.length);
  } else {
    const assetRootSlice = slicePathFromKnownRoot(
      normalized,
      MESH_EXPORT_ROOT_SEGMENTS,
      new Set(['mesh', 'meshes']),
    );
    if (assetRootSlice) {
      normalized = assetRootSlice;
    } else {
      const segments = normalized.split('/');
      const packageAssetRoots = new Set([
        'assets',
        'dae',
        'obj',
        'stl',
        'gltf',
        'glb',
        'texture',
        'textures',
        'material',
        'materials',
      ]);

      // Imported ROS packages are often rewritten to "pkg_name/dae/part.dae".
      // Strip the package root here because the URDF export already prepends
      // "package://<export-name>/meshes/" on top of the stored mesh path.
      if (segments.length >= 3 && packageAssetRoots.has(segments[1].toLowerCase())) {
        normalized = segments.slice(1).join('/');
      }
    }
  }

  normalized = normalizeRelativePath(normalized);

  if (!normalized) {
    const fallback = raw.split(/[\\/]/).pop() || '';
    return fallback;
  }

  return normalized;
};

export const normalizeTexturePathForExport = (texturePath: string): string => {
  const raw = (texturePath || '').trim();
  if (!raw) return '';
  if (/^(?:blob:|https?:\/\/|data:)/i.test(raw)) {
    return raw;
  }

  let normalized = raw.replace(/\\/g, '/');
  normalized = stripExternalPrefix(normalized);

  normalized = normalized.replace(/^[A-Za-z]:\//, '');
  normalized = normalized.replace(/^\/+/, '');
  normalized = normalized.replace(/^(\.\/)+/, '');
  normalized = normalizeRelativePath(normalized);

  const lower = normalized.toLowerCase();
  const textureDirIndex = lower.indexOf('/textures/');
  if (textureDirIndex >= 0) {
    return normalized.slice(textureDirIndex + '/textures/'.length);
  }

  if (lower.startsWith('textures/')) {
    return normalized.slice('textures/'.length);
  }

  if (lower.startsWith('texture/')) {
    return normalized.slice('texture/'.length);
  }

  const textureRootSlice = slicePathFromKnownRoot(
    normalized,
    TEXTURE_EXPORT_ROOT_SEGMENTS,
    new Set(['texture', 'textures']),
  );
  if (textureRootSlice) {
    return textureRootSlice;
  }

  const segments = normalized.split('/');
  const packageTextureRoots = new Set([
    'texture',
    'textures',
    'material',
    'materials',
    'image',
    'images',
  ]);

  if (segments.length >= 3 && packageTextureRoots.has(segments[1].toLowerCase())) {
    return segments.slice(2).join('/');
  }

  return normalized;
};

export function normalizeTextureSourceKey(texturePath: string): string {
  const raw = (texturePath || '').trim();
  if (!raw) {
    return '';
  }

  if (/^(?:blob:|https?:\/\/|data:)/i.test(raw)) {
    return raw;
  }

  let normalized = raw.replace(/\\/g, '/');
  normalized = stripExternalPrefix(normalized);
  normalized = normalized.replace(/^[A-Za-z]:\//, '');
  normalized = normalized.replace(/^\/+/, '');
  normalized = normalized.replace(/^(\.\/)+/, '');
  return normalizeRelativePath(normalized);
}

export function buildTextureCollisionFallbackPath(texturePath: string): string {
  const normalizedSourceKey = normalizeTextureSourceKey(texturePath);
  if (!normalizedSourceKey || /^(?:blob:|https?:\/\/|data:)/i.test(normalizedSourceKey)) {
    return normalizedSourceKey;
  }

  const segments = normalizedSourceKey.split('/').filter(Boolean);
  if (segments.length === 0) {
    return normalizedSourceKey;
  }

  const textureRootIndex = segments.findIndex((segment) => {
    const lowerSegment = segment.toLowerCase();
    return lowerSegment === 'texture' || lowerSegment === 'textures';
  });
  const materialRootIndex = segments.findIndex((segment) => {
    const lowerSegment = segment.toLowerCase();
    return lowerSegment === 'material' || lowerSegment === 'materials';
  });
  const boundaryIndex = textureRootIndex >= 0 ? textureRootIndex : materialRootIndex;
  if (boundaryIndex < 0) {
    return normalizedSourceKey;
  }

  const prefixSegments = segments.slice(0, boundaryIndex);
  while (
    prefixSegments.length > 0 &&
    TEXTURE_EXPORT_ROOT_SEGMENTS.has(prefixSegments[prefixSegments.length - 1]!.toLowerCase())
  ) {
    prefixSegments.pop();
  }

  const suffixSegments = segments.slice(boundaryIndex + 1);
  if (suffixSegments.length === 0) {
    return normalizedSourceKey;
  }

  return normalizeRelativePath([...prefixSegments, ...suffixSegments].join('/'));
}

export function dedupeExportPath(path: string, usedPaths: Set<string>): string {
  const normalized = normalizeRelativePath(path);
  if (!normalized) {
    return normalized;
  }

  const extensionIndex = normalized.lastIndexOf('.');
  const hasExtension = extensionIndex > normalized.lastIndexOf('/');
  const base = hasExtension ? normalized.slice(0, extensionIndex) : normalized;
  const extension = hasExtension ? normalized.slice(extensionIndex) : '';

  let candidate = normalized;
  let counter = 2;
  while (usedPaths.has(candidate.toLowerCase())) {
    candidate = `${base}_${counter}${extension}`;
    counter += 1;
  }

  return candidate;
}

export interface RewriteUrdfAssetPathsForExportOptions {
  exportRobotName: string;
  useRelativePaths?: boolean;
}

export function isExternalAssetPath(path: string): boolean {
  return /^(?:blob:|https?:\/\/|data:)/i.test(path);
}

export function buildUrdfMeshExportFilename(
  meshPath: string,
  { exportRobotName, useRelativePaths = false }: RewriteUrdfAssetPathsForExportOptions,
): string {
  if (isExternalAssetPath(meshPath)) {
    return meshPath;
  }

  const normalizedPath = normalizeMeshPathForExport(meshPath) || meshPath.replace(/\\/g, '/');
  return useRelativePaths
    ? `meshes/${normalizedPath}`
    : `package://${exportRobotName}/meshes/${normalizedPath}`;
}

export function buildUrdfTextureExportFilename(
  texturePath: string,
  { exportRobotName, useRelativePaths = false }: RewriteUrdfAssetPathsForExportOptions,
): string {
  if (isExternalAssetPath(texturePath)) {
    return texturePath;
  }

  const normalizedPath =
    normalizeTexturePathForExport(texturePath) || texturePath.replace(/\\/g, '/');
  return useRelativePaths
    ? `textures/${normalizedPath}`
    : `package://${exportRobotName}/textures/${normalizedPath}`;
}

export function rewriteXmlTagFilenameAttribute(
  xml: string,
  tagName: 'mesh' | 'texture',
  rewritePath: (path: string) => string,
): string {
  const tagPattern = new RegExp(
    `(<${tagName}\\b[^>]*\\bfilename\\s*=\\s*)(["'])([^"']*)(\\2)`,
    'gi',
  );

  return xml.replace(
    tagPattern,
    (_match, prefix, quote, filename, closingQuote) =>
      `${prefix}${quote}${rewritePath(filename)}${closingQuote}`,
  );
}

export const pushUnique = (values: string[], seen: Set<string>, value?: string) => {
  if (!value) return;
  const v = value.trim();
  if (!v) return;
  if (seen.has(v)) return;
  seen.add(v);
  values.push(v);
};
