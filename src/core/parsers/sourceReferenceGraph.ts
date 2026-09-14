import type { RobotFile } from '@/types';
import { detectRobotDefinitionFormat } from './format_detection';
import {
  extractUsdLayerReferencesFromText,
  resolveUsdLayerReferencePath,
} from './usd/usdLayerReferences';

export type SourceFileFormat = RobotFile['format'] | null;

export interface SourceTextFileEntry {
  path: string;
  content: string;
  format: SourceFileFormat;
  blobUrl?: string;
}
const XACRO_INCLUDE_REGEX =
  /<!--[\s\S]*?-->|<xacro:include\b([^>]*?)(?:\/>|>\s*<\/xacro:include>)/g;
const MJCF_INCLUDE_REGEX = /<!--[\s\S]*?-->|<include\b([^>]*?)(?:\/>|>\s*<\/include>)/g;

export function normalizeSourcePath(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '');
}

function getSourceBasePath(filePath: string): string {
  const normalizedPath = normalizeSourcePath(filePath);
  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  return lastSlashIndex === -1 ? '' : normalizedPath.slice(0, lastSlashIndex);
}

export function getSourceFileName(filePath: string): string {
  const normalizedPath = normalizeSourcePath(filePath);
  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  return lastSlashIndex === -1 ? normalizedPath : normalizedPath.slice(lastSlashIndex + 1);
}

function parseXmlAttributeMap(attrs: string): Map<string, string> {
  const parsed = new Map<string, string>();
  const attrRegex = /([A-Za-z_][\w:.-]*)\s*=\s*(["'])(.*?)\2/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(attrs)) !== null) {
    parsed.set(match[1], match[3]);
  }
  return parsed;
}

function extractXmlAttributeReferences(
  content: string,
  tagRegex: RegExp,
  attributeName: string,
): string[] {
  return Array.from(content.matchAll(tagRegex), (match) => {
    if (match[0].startsWith('<!--')) {
      return null;
    }
    return parseXmlAttributeMap(match[1] ?? '').get(attributeName)?.trim() ?? null;
  }).filter((value): value is string => Boolean(value));
}

function buildSourceFileIndex(
  availableFiles: RobotFile[],
  allFileContents: Record<string, string>,
): Map<string, SourceTextFileEntry> {
  const index = new Map<string, SourceTextFileEntry>();

  availableFiles.forEach((file) => {
    if (file.format === 'mesh' || file.format === 'asset') {
      return;
    }

    const normalizedPath = normalizeSourcePath(file.name);
    index.set(normalizedPath, {
      path: file.name,
      content: file.content,
      format: file.format,
      blobUrl: file.blobUrl,
    });
  });

  Object.entries(allFileContents).forEach(([path, content]) => {
    if (typeof content !== 'string') {
      return;
    }

    const normalizedPath = normalizeSourcePath(path);
    const existingEntry = index.get(normalizedPath);
    index.set(normalizedPath, {
      path: existingEntry?.path ?? path,
      content,
      format: existingEntry?.format ?? detectRobotDefinitionFormat(content, path),
      blobUrl: existingEntry?.blobUrl,
    });
  });

  return index;
}

function extractIncludeReferences(format: SourceFileFormat, content: string): string[] {
  if (format === 'xacro') {
    return extractXmlAttributeReferences(content, XACRO_INCLUDE_REGEX, 'filename');
  }

  if (format === 'mjcf') {
    return extractXmlAttributeReferences(content, MJCF_INCLUDE_REGEX, 'file');
  }

  if (format === 'usd') {
    return extractUsdLayerReferencesFromText(content);
  }

  return [];
}

function resolveXacroReference(
  reference: string,
  fileIndex: Map<string, SourceTextFileEntry>,
  basePath: string,
): string | null {
  const trimmedReference = reference.trim();
  if (!trimmedReference) {
    return null;
  }

  const normalizedKeys = Array.from(fileIndex.keys());
  const packageReferenceMatch = trimmedReference.match(/^\$\(find\s+([^)]+)\)(?:\/(.*))?$/);
  if (packageReferenceMatch) {
    const packageName = packageReferenceMatch[1]?.trim();
    const relativePath = normalizeSourcePath(packageReferenceMatch[2] ?? '');
    const searchPattern = normalizeSourcePath(
      relativePath ? `${packageName}/${relativePath}` : packageName,
    );

    return (
      normalizedKeys.find(
        (candidate) => candidate === searchPattern || candidate.endsWith(`/${searchPattern}`),
      ) ?? null
    );
  }

  const normalizedReference = normalizeSourcePath(trimmedReference);
  if (!normalizedReference) {
    return null;
  }

  const normalizedBasePath = normalizeSourcePath(basePath);
  if (normalizedBasePath) {
    const baseParts = normalizedBasePath.split('/').filter(Boolean);
    for (let index = baseParts.length; index >= 0; index -= 1) {
      const prefix = baseParts.slice(0, index).join('/');
      const candidatePath = normalizeSourcePath(
        prefix ? `${prefix}/${normalizedReference}` : normalizedReference,
      );
      if (fileIndex.has(candidatePath)) {
        return candidatePath;
      }
    }
  }

  if (fileIndex.has(normalizedReference)) {
    return normalizedReference;
  }

  const fuzzyMatch = normalizedKeys.find(
    (candidate) =>
      candidate === normalizedReference || candidate.endsWith(`/${normalizedReference}`),
  );
  if (fuzzyMatch) {
    return fuzzyMatch;
  }

  const fileName = getSourceFileName(normalizedReference);
  if (!fileName || !fileName.includes('.')) {
    return null;
  }

  return (
    normalizedKeys.find(
      (candidate) => candidate === fileName || candidate.endsWith(`/${fileName}`),
    ) ?? null
  );
}

function resolveMjcfReference(
  reference: string,
  fileIndex: Map<string, SourceTextFileEntry>,
  basePath: string,
): string | null {
  const normalizedReference = normalizeSourcePath(reference.trim());
  if (!normalizedReference) {
    return null;
  }

  const normalizedBasePath = normalizeSourcePath(basePath);
  if (normalizedBasePath) {
    const baseParts = normalizedBasePath.split('/').filter(Boolean);
    for (let index = baseParts.length; index >= 0; index -= 1) {
      const prefix = baseParts.slice(0, index).join('/');
      const candidatePath = normalizeSourcePath(
        prefix ? `${prefix}/${normalizedReference}` : normalizedReference,
      );
      if (fileIndex.has(candidatePath)) {
        return candidatePath;
      }
    }
  }

  if (fileIndex.has(normalizedReference)) {
    return normalizedReference;
  }

  return null;
}

function resolveUsdReference(
  reference: string,
  fileIndex: Map<string, SourceTextFileEntry>,
  parentPath: string,
): string | null {
  const resolvedVirtualPath = resolveUsdLayerReferencePath(parentPath, reference);
  if (!resolvedVirtualPath) {
    return null;
  }

  const normalizedResolvedPath = normalizeSourcePath(resolvedVirtualPath);
  if (fileIndex.has(normalizedResolvedPath)) {
    return normalizedResolvedPath;
  }

  const normalizedReference = normalizeSourcePath(reference);
  if (fileIndex.has(normalizedReference)) {
    return normalizedReference;
  }

  const normalizedKeys = Array.from(fileIndex.keys());
  return (
    normalizedKeys.find(
      (candidate) =>
        candidate === normalizedResolvedPath ||
        candidate.endsWith(`/${normalizedResolvedPath}`) ||
        candidate === normalizedReference ||
        candidate.endsWith(`/${normalizedReference}`),
    ) ?? null
  );
}

function resolveIncludedFilePath(
  parentFormat: SourceFileFormat,
  reference: string,
  fileIndex: Map<string, SourceTextFileEntry>,
  parentPath: string,
): string | null {
  const basePath = getSourceBasePath(parentPath);
  if (parentFormat === 'xacro') {
    return resolveXacroReference(reference, fileIndex, basePath);
  }

  if (parentFormat === 'mjcf') {
    return resolveMjcfReference(reference, fileIndex, basePath);
  }

  if (parentFormat === 'usd') {
    return resolveUsdReference(reference, fileIndex, parentPath);
  }

  return null;
}

/** Resolve reachable text resources without assigning editor tabs or mutation targets.
 * Missing references are omitted and cycles visited once; inputs are never mutated.
 */
export function collectRelatedSourceEntries({
  rootFile,
  availableFiles,
  allFileContents,
}: {
  rootFile: RobotFile;
  availableFiles: RobotFile[];
  allFileContents: Record<string, string>;
}): SourceTextFileEntry[] {
  const rootContent = rootFile.content;
  const fileIndex = buildSourceFileIndex(availableFiles, allFileContents);
  const visitedPaths = new Set<string>([normalizeSourcePath(rootFile.name)]);
  const relatedEntries: SourceTextFileEntry[] = [];

  const visitEntry = (entryPath: string, entryContent: string, entryFormat: SourceFileFormat) => {
    const includeReferences = extractIncludeReferences(entryFormat, entryContent);
    if (includeReferences.length === 0) {
      return;
    }

    includeReferences.forEach((reference) => {
      const resolvedPath = resolveIncludedFilePath(
        entryFormat,
        reference,
        fileIndex,
        entryPath,
      );
      if (!resolvedPath || visitedPaths.has(resolvedPath)) {
        return;
      }

      const relatedEntry = fileIndex.get(resolvedPath);
      if (!relatedEntry) {
        return;
      }

      visitedPaths.add(resolvedPath);
      relatedEntries.push(relatedEntry);
      visitEntry(relatedEntry.path, relatedEntry.content, relatedEntry.format ?? entryFormat);
    });
  };

  visitEntry(rootFile.name, rootContent, rootFile.format);
  return relatedEntries;
}
