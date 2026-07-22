import { resolveImportedAssetPath } from '@/core/parsers/meshPathUtils';
import { normalizeRelativePath } from '@/core/utils/pathNormalization';

export interface ResolvedSdfIncludeSource {
  path: string;
  content: string;
}

export interface SdfIncludeResolutionContext {
  resolve(includeUri: string, sourcePath?: string | null): ResolvedSdfIncludeSource | null;
}

interface SdfIncludeSourceIndex {
  entries: ResolvedSdfIncludeSource[];
  byPath: Map<string, ResolvedSdfIncludeSource>;
}

function resolveIncludePath(uri: string, sourcePath?: string): string | null {
  const trimmed = uri.trim();
  if (!trimmed) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:')) {
    return null;
  }

  if (trimmed.startsWith('file://')) {
    return normalizeRelativePath(trimmed.slice('file://'.length));
  }

  return normalizeRelativePath(resolveImportedAssetPath(trimmed, sourcePath));
}

function preferCandidate(left: ResolvedSdfIncludeSource, right: ResolvedSdfIncludeSource): number {
  const rank = (candidatePath: string): number => {
    const lowerPath = candidatePath.toLowerCase();
    if (lowerPath.endsWith('/model.sdf')) return 0;
    if (/\/model-\d+_\d+\.sdf$/i.test(candidatePath)) return 1;
    if (lowerPath.endsWith('.sdf')) return 2;
    return 3;
  };

  return rank(left.path) - rank(right.path) || left.path.localeCompare(right.path);
}

function createSdfIncludeSourceIndex(
  allFileContents: Record<string, string>,
): SdfIncludeSourceIndex {
  const entries = Object.entries(allFileContents)
    .map(([path, content]) => ({
      path: normalizeRelativePath(path),
      content,
    }))
    .filter(({ path }) => path.toLowerCase().endsWith('.sdf'));

  const byPath = new Map<string, ResolvedSdfIncludeSource>();
  entries.forEach((entry) => {
    if (!byPath.has(entry.path)) {
      byPath.set(entry.path, entry);
    }
  });

  return { entries, byPath };
}

function resolveSdfIncludeSourceFromIndex(
  includeUri: string,
  index: SdfIncludeSourceIndex,
  sourcePath?: string | null,
): ResolvedSdfIncludeSource | null {
  const includeBasePath = resolveIncludePath(includeUri, sourcePath ?? undefined);
  if (!includeBasePath) {
    return null;
  }

  const exactCandidates = [
    includeBasePath,
    `${includeBasePath}.sdf`,
    `${includeBasePath}/model.sdf`,
  ];

  for (const candidatePath of exactCandidates) {
    const matched = index.byPath.get(candidatePath);
    if (matched) {
      return matched;
    }
  }

  const nestedCandidates = index.entries
    .filter(({ path }) => path.startsWith(`${includeBasePath}/`))
    .sort(preferCandidate);

  if (nestedCandidates[0]) {
    return nestedCandidates[0];
  }

  const basename = includeBasePath.split('/').pop()?.toLowerCase() || '';
  if (!basename) {
    return null;
  }

  const fallbackCandidates = index.entries
    .filter(({ path }) => path.toLowerCase().includes(`/${basename}/`))
    .sort(preferCandidate);

  return fallbackCandidates[0] ?? null;
}

export function createSdfIncludeResolutionContext(
  allFileContents: Record<string, string> = {},
): SdfIncludeResolutionContext {
  const index = createSdfIncludeSourceIndex(allFileContents);

  return {
    resolve: (includeUri, sourcePath) =>
      resolveSdfIncludeSourceFromIndex(includeUri, index, sourcePath),
  };
}

export function resolveSdfIncludeSource(
  includeUri: string,
  allFileContents: Record<string, string>,
  sourcePath?: string | null,
): ResolvedSdfIncludeSource | null {
  return createSdfIncludeResolutionContext(allFileContents).resolve(includeUri, sourcePath);
}

/**
 * Robot definition files (`.sdf`) are classified as robot files in the import
 * pipeline and land in `availableFiles`, not in the text-file `allFileContents`
 * map. Composite Gazebo SDF models use `<include><uri>model://child</uri></include>`
 * to pull in sibling model directories, so the include resolver must see those
 * nested `.sdf` contents too. This merges sdf robot file contents into the
 * allFileContents map without mutating the inputs.
 */
export interface SdfIncludeAvailableFile {
  name: string;
  format?: string;
  content?: string;
}

export function mergeSdfRobotFileContentsInto(
  allFileContents: Record<string, string> = {},
  availableFiles: readonly SdfIncludeAvailableFile[] = [],
): Record<string, string> {
  // Collect sdf robot files that carry inline content. If none contribute, the
  // original allFileContents reference is returned unchanged so callers that
  // track object identity (e.g. the include-index-once regression test) are
  // unaffected.
  const contributions: Array<{ key: string; content: string }> = [];
  for (const file of availableFiles) {
    if (file.format !== 'sdf') {
      continue;
    }
    const content = file.content;
    if (typeof content !== 'string' || content.length === 0) {
      continue;
    }
    const key = normalizeRelativePath(file.name);
    if (!Object.prototype.hasOwnProperty.call(allFileContents, key)) {
      contributions.push({ key, content });
    }
  }

  if (contributions.length === 0) {
    return allFileContents;
  }

  const merged: Record<string, string> = { ...allFileContents };
  for (const { key, content } of contributions) {
    merged[key] = content;
  }
  return merged;
}
