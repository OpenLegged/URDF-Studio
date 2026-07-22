import type { RobotFile } from '@/types';
import type { PreResolvedImportEntry } from './preResolvedImportContract.ts';
import type {
  RobotImportResult,
} from '@/core/parsers/importRobotFile';
import { buildPreResolvedImportContentSignature } from './preResolvedImportSignature.ts';

function buildCacheKey(file: Pick<RobotFile, 'name' | 'format'>): string {
  return `${file.format}:${file.name}`;
}

const MAX_PRE_RESOLVED_IMPORT_CACHE_SIZE = 64;
const preResolvedRobotImportCache = new Map<string, PreResolvedImportEntry>();

function touchPreResolvedRobotImportCacheEntry(
  cacheKey: string,
  entry: PreResolvedImportEntry,
): void {
  if (preResolvedRobotImportCache.has(cacheKey)) {
    preResolvedRobotImportCache.delete(cacheKey);
  }

  preResolvedRobotImportCache.set(cacheKey, entry);

  while (preResolvedRobotImportCache.size > MAX_PRE_RESOLVED_IMPORT_CACHE_SIZE) {
    const oldestKey = preResolvedRobotImportCache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }

    preResolvedRobotImportCache.delete(oldestKey);
  }
}

export function primePreResolvedRobotImports(entries: readonly PreResolvedImportEntry[]): void {
  entries.forEach((entry) => {
    touchPreResolvedRobotImportCacheEntry(buildCacheKey({
      name: entry.fileName,
      format: entry.format,
    }), entry);
  });
}

export function consumePreResolvedRobotImport(
  file: Pick<RobotFile, 'name' | 'format' | 'content'>,
): RobotImportResult | null {
  const cachedEntry = peekPreResolvedRobotImport(file);
  if (!cachedEntry) {
    return null;
  }

  preResolvedRobotImportCache.delete(buildCacheKey(file));
  return cachedEntry;
}

export function peekPreResolvedRobotImport(
  file: Pick<RobotFile, 'name' | 'format' | 'content'>,
): RobotImportResult | null {
  const cacheKey = buildCacheKey(file);
  const cachedEntry = preResolvedRobotImportCache.get(cacheKey) ?? null;
  if (!cachedEntry) {
    return null;
  }

  if (cachedEntry.contentSignature !== buildPreResolvedImportContentSignature(file.content)) {
    preResolvedRobotImportCache.delete(cacheKey);
    return null;
  }

  return cachedEntry.result;
}

export function clearPreResolvedRobotImportCache(): void {
  preResolvedRobotImportCache.clear();
}
