/**
 * Asset path index + fuzzy mesh-path matching
 *
 * Pure, THREE-free path/string logic extracted from meshLoader.ts: builds an
 * O(1) lookup index over imported asset paths and resolves a requested mesh
 * path against it (exact, case-insensitive, filename, suffix, and approximate
 * stem/extension matching). No Three.js or loader state — only path math, built
 * on the shared meshPathUtils candidate/resolution helpers.
 */

import { buildMeshLookupCandidates, resolveImportedAssetPath } from '@/core/parsers/meshPathUtils';

import { cleanFilePath } from './pathNormalization';

// ============================================================
// PERFORMANCE: Pre-indexed asset lookup for O(1) complexity
// Build once, lookup many times
// ============================================================
export interface AssetIndex {
  // Direct path -> URL mapping
  direct: Map<string, string>;
  // Lowercase path -> URL mapping (case-insensitive)
  lowercase: Map<string, string>;
  // Filename only -> URL mapping
  filename: Map<string, string>;
  // Lowercase filename -> URL mapping
  filenameLower: Map<string, string>;
  // Suffix matches (for fuzzy matching)
  suffixes: Map<string, string>;
  // All cleaned asset paths grouped by lowercase filename
  filenameCandidates: Map<string, string[]>;
  // All cleaned asset paths grouped by lowercase suffix
  suffixCandidates: Map<string, string[]>;
  // Unique cleaned asset paths for last-resort similarity matching
  cleanedPaths: string[];
}

const assetIndexCache = new WeakMap<Record<string, string>, Map<string, AssetIndex>>();

const pushUniqueCandidate = (target: string[], seen: Set<string>, value?: string) => {
  const normalized = cleanFilePath(String(value || ''));
  if (!normalized || seen.has(normalized)) {
    return;
  }

  seen.add(normalized);
  target.push(normalized);
};

const pushIndexedAssetPath = (target: Map<string, string[]>, key: string, value: string) => {
  if (!key || !value) {
    return;
  }

  const existing = target.get(key);
  if (!existing) {
    target.set(key, [value]);
    return;
  }

  if (!existing.includes(value)) {
    existing.push(value);
  }
};

const splitPathSegments = (value: string): string[] =>
  cleanFilePath(value).split('/').filter(Boolean);

const tokenizePathSegment = (segment: string): string[] => {
  const normalized = segment
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .toLowerCase();

  return normalized.split(/[^a-z0-9]+/).filter(Boolean);
};

const flattenPathTokens = (segments: string[]): string[] =>
  segments.flatMap((segment) => tokenizePathSegment(segment));

const countMatchingPrefixSegments = (left: string[], right: string[]): number => {
  let count = 0;
  while (count < left.length && count < right.length && left[count] === right[count]) {
    count += 1;
  }
  return count;
};

const countMatchingSuffixSegments = (left: string[], right: string[]): number => {
  let count = 0;
  while (
    count < left.length &&
    count < right.length &&
    left[left.length - 1 - count] === right[right.length - 1 - count]
  ) {
    count += 1;
  }
  return count;
};

const countLongestCommonSubpath = (left: string[], right: string[]): number => {
  let best = 0;

  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      let span = 0;
      while (
        leftIndex + span < left.length &&
        rightIndex + span < right.length &&
        left[leftIndex + span] === right[rightIndex + span]
      ) {
        span += 1;
      }
      if (span > best) {
        best = span;
      }
    }
  }

  return best;
};

const countSharedTokens = (left: string[], right: string[]): number => {
  const leftTokens = new Set(flattenPathTokens(left));
  const rightTokens = new Set(flattenPathTokens(right));

  let count = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) {
      count += 1;
    }
  });

  return count;
};

const countOverlapSuffixPrefix = (
  ancestorSegments: string[],
  relativeSegments: string[],
): number => {
  const maxOverlap = Math.min(ancestorSegments.length, relativeSegments.length);

  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    let matches = true;
    for (let index = 0; index < overlap; index += 1) {
      if (ancestorSegments[ancestorSegments.length - overlap + index] !== relativeSegments[index]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return overlap;
    }
  }

  return 0;
};

function scoreAssetCandidatePath(
  candidatePath: string,
  references: string[],
  urdfDir: string,
): number {
  const candidateSegments = splitPathSegments(candidatePath);
  if (candidateSegments.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  let bestReferenceScore = 0;
  for (const reference of references) {
    const referenceSegments = splitPathSegments(reference);
    if (referenceSegments.length === 0) {
      continue;
    }

    const suffixScore = countMatchingSuffixSegments(candidateSegments, referenceSegments);
    const subpathScore = countLongestCommonSubpath(candidateSegments, referenceSegments);
    const prefixScore = countMatchingPrefixSegments(candidateSegments, referenceSegments);
    const tokenScore = countSharedTokens(candidateSegments, referenceSegments);
    const score = suffixScore * 10000 + subpathScore * 1000 + prefixScore * 100 + tokenScore * 10;

    if (score > bestReferenceScore) {
      bestReferenceScore = score;
    }
  }

  const urdfSegments = splitPathSegments(urdfDir);
  const urdfScore =
    urdfSegments.length > 0
      ? countMatchingPrefixSegments(candidateSegments, urdfSegments) * 1000 +
        countSharedTokens(candidateSegments, urdfSegments) * 25
      : 0;

  return bestReferenceScore + urdfScore + candidateSegments.length;
}

function selectBestAssetMatch(
  candidatePaths: string[] | undefined,
  index: AssetIndex,
  references: string[],
  urdfDir: string,
): string | null {
  if (!candidatePaths || candidatePaths.length === 0) {
    return null;
  }

  let bestPath: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let secondBestScore = Number.NEGATIVE_INFINITY;

  for (const candidatePath of candidatePaths) {
    const cleanedCandidate = cleanFilePath(candidatePath);
    const score = scoreAssetCandidatePath(cleanedCandidate, references, urdfDir);

    if (score > bestScore) {
      secondBestScore = bestScore;
      bestPath = cleanedCandidate;
      bestScore = score;
      continue;
    }

    if (score > secondBestScore) {
      secondBestScore = score;
    }
  }

  if (!bestPath || bestScore <= secondBestScore) {
    return null;
  }

  return index.direct.get(bestPath) || index.lowercase.get(bestPath.toLowerCase()) || null;
}

function resolveImportedPackageCandidateMatch(
  packagePath: string,
  index: AssetIndex,
  urdfDir: string,
  references: string[],
  seenReferences: Set<string>,
): string | null {
  if (!packagePath) {
    return null;
  }

  const importedPackageCandidates = buildImportedPackagePathCandidates(packagePath, urdfDir);
  importedPackageCandidates.forEach((candidate) => {
    pushUniqueCandidate(references, seenReferences, candidate);
  });

  for (const candidate of importedPackageCandidates) {
    let result: string | null | undefined = index.direct.get(candidate);
    if (result) return result;

    result = index.lowercase.get(candidate.toLowerCase());
    if (result) return result;

    result = selectBestAssetMatch(
      index.suffixCandidates.get(candidate.toLowerCase()),
      index,
      references,
      urdfDir,
    );
    if (result) return result;
  }

  return null;
}

const getFilenameFromPath = (value: string): string => {
  const cleaned = cleanFilePath(value);
  const lastSlash = cleaned.lastIndexOf('/');
  return lastSlash === -1 ? cleaned : cleaned.substring(lastSlash + 1);
};

const splitFilenameStem = (filename: string): { extension: string; stemSegments: string[] } => {
  const cleaned = cleanFilePath(filename);
  const lastDot = cleaned.lastIndexOf('.');
  const extension = lastDot >= 0 ? cleaned.substring(lastDot).toLowerCase() : '';
  const stem = lastDot >= 0 ? cleaned.substring(0, lastDot) : cleaned;
  return {
    extension,
    stemSegments: stem ? [stem] : [],
  };
};

const APPROXIMATE_STEM_SUFFIX_PATTERN = /(?:[_\-.](?:visual|collision|mesh|model))+$/i;
export const SUPPORTED_MESH_EXTENSIONS = new Set([
  'stl',
  'msh',
  'dae',
  'obj',
  'gltf',
  'glb',
  'ply',
  'vtk',
]);
const APPROXIMATE_EXTENSION_ALIASES: Record<string, string[]> = {
  '.mesh': ['.mesh', '.dae', '.obj', '.stl', '.gltf', '.glb', '.ply'],
  '.obj': ['.obj', '.stl'],
};

export const getPathExtension = (value: string): string => {
  const cleaned = cleanFilePath(value);
  const lastSlash = cleaned.lastIndexOf('/');
  const filename = lastSlash === -1 ? cleaned : cleaned.substring(lastSlash + 1);
  const lastDot = filename.lastIndexOf('.');
  return lastDot === -1 ? '' : filename.substring(lastDot + 1).toLowerCase();
};

const getApproximateCompatibleExtensions = (extension: string): Set<string> | null => {
  if (!extension) {
    return null;
  }

  const normalized = extension.toLowerCase();
  const aliases = APPROXIMATE_EXTENSION_ALIASES[normalized];
  return new Set(aliases ?? [normalized]);
};

const buildApproximateStemVariants = (
  filename: string,
): Array<{ stemSegments: string[]; aliasStripped: boolean }> => {
  const { stemSegments } = splitFilenameStem(filename);
  const variants: Array<{ stemSegments: string[]; aliasStripped: boolean }> = [];
  const seen = new Set<string>();

  const pushVariant = (stem: string, aliasStripped: boolean) => {
    const normalized = cleanFilePath(stem);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    variants.push({
      stemSegments: [normalized],
      aliasStripped,
    });
  };

  const originalStem = stemSegments[0] ?? '';
  pushVariant(originalStem, false);

  let simplifiedStem = originalStem;
  while (simplifiedStem) {
    const strippedStem = simplifiedStem.replace(APPROXIMATE_STEM_SUFFIX_PATTERN, '');
    if (!strippedStem || strippedStem === simplifiedStem) {
      break;
    }
    pushVariant(strippedStem, true);
    simplifiedStem = strippedStem;
  }

  return variants;
};

function selectBestApproximateFilenameMatch(
  filename: string,
  index: AssetIndex,
  references: string[],
  urdfDir: string,
): string | null {
  const { extension } = splitFilenameStem(filename);
  const compatibleExtensions = getApproximateCompatibleExtensions(extension);
  const prefersVisualCandidates = extension === '.mesh';
  const requestVariants = buildApproximateStemVariants(filename)
    .map((variant) => ({
      ...variant,
      normalizedStem: cleanFilePath(variant.stemSegments[0] ?? ''),
      tokens: new Set(flattenPathTokens(variant.stemSegments)),
    }))
    .filter((variant) => variant.tokens.size > 0);

  if (requestVariants.length === 0) {
    return null;
  }

  let bestPath: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let secondBestScore = Number.NEGATIVE_INFINITY;

  for (const candidatePath of index.cleanedPaths) {
    const candidateFilename = getFilenameFromPath(candidatePath);
    const { extension: candidateExtension, stemSegments: candidateStemSegments } =
      splitFilenameStem(candidateFilename);
    const candidateStem = cleanFilePath(candidateStemSegments[0] ?? '');
    if (
      compatibleExtensions &&
      candidateExtension &&
      !compatibleExtensions.has(candidateExtension)
    ) {
      continue;
    }

    const candidateTokens = new Set(flattenPathTokens(candidateStemSegments));
    let candidateBestScore = Number.NEGATIVE_INFINITY;

    for (const requestVariant of requestVariants) {
      let tokenOverlap = 0;
      requestVariant.tokens.forEach((token) => {
        if (candidateTokens.has(token)) {
          tokenOverlap += 1;
        }
      });

      if (tokenOverlap === 0) {
        continue;
      }

      let score = scoreAssetCandidatePath(candidatePath, references, urdfDir) + tokenOverlap * 5000;
      const requestIsSubset = Array.from(requestVariant.tokens).every((token) =>
        candidateTokens.has(token),
      );
      if (requestIsSubset) {
        score += 2000;
      }
      if (requestVariant.normalizedStem && requestVariant.normalizedStem === candidateStem) {
        score += 4000;
      }
      if (requestVariant.aliasStripped) {
        score += 1000;
      }
      if (prefersVisualCandidates) {
        const candidatePathLower = candidatePath.toLowerCase();
        if (candidatePathLower.includes('/visual/')) {
          score += 1500;
        }
        if (candidatePathLower.includes('/collision/')) {
          score -= 1500;
        }
      }

      if (score > candidateBestScore) {
        candidateBestScore = score;
      }
    }

    if (candidateBestScore === Number.NEGATIVE_INFINITY) {
      continue;
    }

    if (candidateBestScore > bestScore) {
      secondBestScore = bestScore;
      bestScore = candidateBestScore;
      bestPath = candidatePath;
      continue;
    }

    if (candidateBestScore > secondBestScore) {
      secondBestScore = candidateBestScore;
    }
  }

  if (!bestPath || bestScore <= secondBestScore) {
    return null;
  }

  return index.direct.get(bestPath) || index.lowercase.get(bestPath.toLowerCase()) || null;
}

function buildImportedPackagePathCandidates(packagePath: string, urdfDir: string = ''): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const normalizedPackagePath = cleanFilePath(packagePath);
  const normalizedUrdfDir = cleanFilePath(urdfDir).replace(/\/+$/, '');

  if (!normalizedPackagePath || !normalizedUrdfDir) {
    return candidates;
  }

  const urdfSegments = normalizedUrdfDir.split('/').filter(Boolean);
  if (urdfSegments.length === 0) {
    return candidates;
  }

  const [packageName] = normalizedPackagePath.split('/');
  const packageIndex = packageName ? urdfSegments.indexOf(packageName) : -1;
  const packageSegments = normalizedPackagePath.split('/').filter(Boolean);
  const packageTailSegments = packageSegments.slice(1);
  const packageTail = packageTailSegments.join('/');

  if (packageIndex > 0) {
    pushUniqueCandidate(
      candidates,
      seen,
      `${urdfSegments.slice(0, packageIndex).join('/')}/${normalizedPackagePath}`,
    );
  }

  if (packageIndex === -1) {
    pushUniqueCandidate(candidates, seen, `${normalizedUrdfDir}/${normalizedPackagePath}`);
    pushUniqueCandidate(candidates, seen, `${urdfSegments[0]}/${normalizedPackagePath}`);

    if (packageTail) {
      for (let prefixLength = urdfSegments.length; prefixLength >= 1; prefixLength -= 1) {
        const ancestorSegments = urdfSegments.slice(0, prefixLength);
        const overlap = countOverlapSuffixPrefix(ancestorSegments, packageTailSegments);
        const ancestorPrefix = ancestorSegments
          .slice(0, ancestorSegments.length - overlap)
          .join('/');
        pushUniqueCandidate(
          candidates,
          seen,
          ancestorPrefix ? `${ancestorPrefix}/${packageTail}` : packageTail,
        );
      }
    }
  }

  return candidates;
}

function buildAssetIndexUncached(assets: Record<string, string>, urdfDir: string = ''): AssetIndex {
  const index: AssetIndex = {
    direct: new Map(),
    lowercase: new Map(),
    filename: new Map(),
    filenameLower: new Map(),
    suffixes: new Map(),
    filenameCandidates: new Map(),
    suffixCandidates: new Map(),
    cleanedPaths: [],
  };
  const cleanedPathSet = new Set<string>();

  for (const [key, value] of Object.entries(assets)) {
    // Direct mapping
    index.direct.set(key, value);

    // Cleaned path
    const cleaned = cleanFilePath(key);
    index.direct.set(cleaned, value);
    if (!cleanedPathSet.has(cleaned)) {
      cleanedPathSet.add(cleaned);
      index.cleanedPaths.push(cleaned);
    }

    // With urdfDir prefix
    if (urdfDir) {
      index.direct.set(urdfDir + cleaned, value);
      index.direct.set(urdfDir + key, value);
    }

    // Lowercase variants
    index.lowercase.set(key.toLowerCase(), value);
    index.lowercase.set(cleaned.toLowerCase(), value);

    // Filename only
    const filename = key.split('/').pop() || key;
    index.filename.set(filename, value);
    index.filenameLower.set(filename.toLowerCase(), value);
    pushIndexedAssetPath(index.filenameCandidates, filename.toLowerCase(), cleaned);

    // Suffix matching: keep every slash-delimited suffix so that
    // visual/collision subpaths and package tails remain distinguishable.
    const cleanedSegments = cleaned.split('/').filter(Boolean);
    for (let indexOffset = 0; indexOffset < cleanedSegments.length; indexOffset += 1) {
      const suffix = cleanedSegments.slice(indexOffset).join('/').toLowerCase();
      if (!index.suffixes.has(suffix)) {
        index.suffixes.set(suffix, value);
      }
      pushIndexedAssetPath(index.suffixCandidates, suffix, cleaned);
    }
  }

  return index;
}

// Build pre-indexed asset lookup (call once during model load)
export const buildAssetIndex = (
  assets: Record<string, string>,
  urdfDir: string = '',
): AssetIndex => {
  const normalizedUrdfDir = cleanFilePath(urdfDir);
  const cachedByDirectory = assetIndexCache.get(assets);
  const cachedIndex = cachedByDirectory?.get(normalizedUrdfDir);
  if (cachedIndex) {
    return cachedIndex;
  }

  const nextIndex = buildAssetIndexUncached(assets, urdfDir);
  const nextCachedByDirectory = cachedByDirectory ?? new Map<string, AssetIndex>();
  nextCachedByDirectory.set(normalizedUrdfDir, nextIndex);
  if (!cachedByDirectory) {
    assetIndexCache.set(assets, nextCachedByDirectory);
  }

  return nextIndex;
};

// Fast O(1) asset lookup using pre-built index
export const findAssetByIndex = (
  path: string,
  index: AssetIndex,
  urdfDir: string = '',
): string | null => {
  // Strategy 0: Direct match (most common case)
  let result: string | null | undefined = index.direct.get(path);
  if (result) return result;

  const referencePaths: string[] = [];
  const seenReferencePaths = new Set<string>();
  // Clean the path (optimized version)
  let cleanPath = path.replace(/\\/g, '/');
  let packagePath = '';

  // Remove blob: prefix if present
  if (cleanPath.startsWith('blob:')) {
    const slashIdx = cleanPath.indexOf('/', 5);
    if (slashIdx !== -1) {
      cleanPath = cleanPath.substring(slashIdx + 1);
    }
  }

  // Try package-relative lookup before falling back to package-local paths.
  if (cleanPath.startsWith('package://')) {
    packagePath = cleanFilePath(cleanPath.substring(10).replace(/^\/+/, ''));
    if (packagePath) {
      pushUniqueCandidate(referencePaths, seenReferencePaths, packagePath);
      result = index.direct.get(packagePath);
      if (result) return result;

      result = index.lowercase.get(packagePath.toLowerCase());
      if (result) return result;

      result = resolveImportedPackageCandidateMatch(
        packagePath,
        index,
        urdfDir,
        referencePaths,
        seenReferencePaths,
      );
      if (result) return result;
    }

    cleanPath = packagePath;
    const slashIdx = cleanPath.indexOf('/');
    if (slashIdx !== -1) {
      cleanPath = cleanPath.substring(slashIdx + 1);
    }
  }

  // Remove leading ./
  if (cleanPath.startsWith('./')) {
    cleanPath = cleanPath.substring(2);
  }

  // Normalize path
  const normalizedPath = cleanFilePath(cleanPath);
  const resolvedPath = urdfDir
    ? resolveImportedAssetPath(cleanPath, `${urdfDir}__asset_lookup__`)
    : normalizedPath;
  pushUniqueCandidate(referencePaths, seenReferencePaths, cleanPath);
  pushUniqueCandidate(referencePaths, seenReferencePaths, normalizedPath);
  pushUniqueCandidate(referencePaths, seenReferencePaths, resolvedPath);

  if (!packagePath && normalizedPath.startsWith('/')) {
    const absolutePackagePath = normalizedPath.replace(/^\/+/, '');
    pushUniqueCandidate(referencePaths, seenReferencePaths, absolutePackagePath);
    result = resolveImportedPackageCandidateMatch(
      absolutePackagePath,
      index,
      urdfDir,
      referencePaths,
      seenReferencePaths,
    );
    if (result) return result;
  }

  // Strategy 1: Direct lookup with normalized path
  result = index.direct.get(normalizedPath);
  if (result) return result;

  // Strategy 2: With urdfDir
  if (urdfDir && resolvedPath) {
    result = index.direct.get(resolvedPath);
    if (result) return result;
  }

  // Strategy 3: Clean path
  result = index.direct.get(cleanPath);
  if (result) return result;

  // Strategy 4: Lowercase lookup
  const lowerPath = resolvedPath.toLowerCase();
  result = index.lowercase.get(lowerPath);
  if (result) return result;

  // Strategy 5: Filename only
  const lastSlash = resolvedPath.lastIndexOf('/');
  const filename = lastSlash === -1 ? resolvedPath : resolvedPath.substring(lastSlash + 1);
  const requestedExtension = splitFilenameStem(filename).extension;
  result = selectBestAssetMatch(
    index.filenameCandidates.get(filename.toLowerCase()),
    index,
    referencePaths,
    urdfDir,
  );
  if (result) return result;

  // Strategy 6: Suffix match
  result = selectBestAssetMatch(
    index.suffixCandidates.get(lowerPath),
    index,
    referencePaths,
    urdfDir,
  );
  if (result) return result;

  // Strategy 7: Candidate-based lookup for imported package paths like
  // "/pkg/meshes/part.dae" when the asset library only stores "meshes/part.dae".
  //
  // `buildMeshLookupCandidates` rewrites the request stem with mesh extensions
  // (.dae/.obj/.stl/...), so this strategy is only meaningful for mesh asset
  // requests. Running it for an image/texture request (.png/.jpg/...) would
  // wrongly substitute a same-stem mesh file when the texture is missing — e.g.
  // return "wing.dae" for an unresolved "wing.png". Non-mesh requests fall
  // through to Strategy 8, whose `selectBestApproximateFilenameMatch` already
  // enforces extension compatibility and returns null instead of a mismatch.
  const requestedExtensionIsMesh =
    !requestedExtension ||
    requestedExtension === '.mesh' ||
    SUPPORTED_MESH_EXTENSIONS.has(requestedExtension.slice(1));
  if (requestedExtensionIsMesh) {
    for (const candidate of buildMeshLookupCandidates(path)) {
      pushUniqueCandidate(referencePaths, seenReferencePaths, candidate);
      result = index.direct.get(candidate);
      if (result) return result;

      result = index.lowercase.get(candidate.toLowerCase());
      if (result) return result;

      if (requestedExtension !== '.mesh') {
        result = selectBestAssetMatch(
          index.suffixCandidates.get(candidate.toLowerCase()),
          index,
          referencePaths,
          urdfDir,
        );
        if (result) return result;
      }
    }
  }

  result = selectBestApproximateFilenameMatch(filename, index, referencePaths, urdfDir);
  if (result) return result;

  return null;
};

// Legacy function for backward compatibility (uses non-indexed lookup)
export const findAssetByPath = (
  path: string,
  assets: Record<string, string>,
  urdfDir: string = '',
): string | null => {
  const assetIndex = buildAssetIndex(assets, urdfDir);
  const result = findAssetByIndex(path, assetIndex, urdfDir);
  if (result) {
    return result;
  }

  if (Object.keys(assets).length > 0) {
    const normalizedPath = cleanFilePath(
      path
        .replace(/\\/g, '/')
        .replace(/^blob:[^/]*\//, '')
        .replace(/^package:\/\//i, '')
        .replace(/^\/+/, '')
        .replace(/^(\.\/)+/, ''),
    );
    console.error(`[MeshLoader] Asset lookup failed for: "${path}"`);
    console.error(`[MeshLoader] Search path was: "${normalizedPath}"`);
    const keys = Object.keys(assets);
    console.error(`[MeshLoader] Available assets (first 10):`, keys.slice(0, 10));
    const fn = path.split('/').pop() || '';
    const partialMatches = keys.filter((k) => k.toLowerCase().includes(fn.toLowerCase()));
    if (partialMatches.length > 0) {
      console.error(`[MeshLoader] Potential partial matches found:`, partialMatches);
    }
  }

  return null;
};
