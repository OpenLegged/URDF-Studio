import JSZip from 'jszip';

import type { RobotData, UsdPreparedExportCache } from '@/types';
import { assertCanonicalRobotData } from '@/core/robot/canonicalWorkspace';
import {
  assertProjectArchiveEntryPath,
  ensureUniqueLogicalPath,
  normalizeArchivePath,
  PROJECT_USD_PREPARED_EXPORT_CACHES_FILE,
  stringifyProjectJson,
} from './projectArchive';
import type { ProjectArchiveEntryData } from './projectArchiveWorkerTransfer';
import { appendProjectArchiveEntriesToZip } from './projectArchiveZip';
import { normalizeLibraryPathKey } from '@/core/utils/pathKeys';

const PROJECT_USD_PREPARED_EXPORT_CACHE_PREFIX = 'workspace/usd-prepared-export-caches';

interface SerializedUsdPreparedExportMeshEntry {
  path: string;
  archivePath: string;
}

interface SerializedUsdPreparedExportCachePayload {
  stageSourcePath?: string | null;
  robotData: RobotData;
  meshFiles: SerializedUsdPreparedExportMeshEntry[];
}

interface SerializedUsdPreparedExportCacheManifestEntry {
  stageSourcePath: string;
  cacheFile: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const allowed = new Set(keys);
  const missing = keys.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(`Invalid project file: ${label} has invalid fields`);
  }
}

function parseJson(content: string, label: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(`Invalid project file: failed to parse ${label}`, { cause: error });
  }
}

function assertCacheManifest(
  value: unknown,
): asserts value is SerializedUsdPreparedExportCacheManifestEntry[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid project file: USD prepared cache manifest must be an array');
  }
  const cacheFiles = new Set<string>();
  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid project file: USD prepared cache manifest[${index}] must be an object`);
    }
    assertExactKeys(entry, ['stageSourcePath', 'cacheFile'], `USD cache manifest[${index}]`);
    if (typeof entry.stageSourcePath !== 'string' || !normalizeUsdCacheKey(entry.stageSourcePath)) {
      throw new Error(`Invalid project file: USD cache manifest[${index}] has an invalid key`);
    }
    assertProjectArchiveEntryPath(entry.cacheFile, `USD cache manifest[${index}].cacheFile`);
    if (!entry.cacheFile.startsWith(`${PROJECT_USD_PREPARED_EXPORT_CACHE_PREFIX}/`)) {
      throw new Error(`Invalid project file: USD cache manifest[${index}] has an invalid cache path`);
    }
    if (cacheFiles.has(entry.cacheFile)) {
      throw new Error('Invalid project file: USD cache manifest contains duplicate cache files');
    }
    cacheFiles.add(entry.cacheFile);
  });
}

function assertCachePayload(
  value: unknown,
  label: string,
): asserts value is SerializedUsdPreparedExportCachePayload {
  if (!isRecord(value)) {
    throw new Error(`Invalid project file: ${label} must be an object`);
  }
  assertExactKeys(value, ['stageSourcePath', 'robotData', 'meshFiles'], label);
  if (
    value.stageSourcePath !== null
    && (typeof value.stageSourcePath !== 'string' || !normalizeUsdCacheKey(value.stageSourcePath))
  ) {
    throw new Error(`Invalid project file: ${label}.stageSourcePath is invalid`);
  }
  if (!isRecord(value.robotData)) {
    throw new Error(`Invalid project file: ${label}.robotData must be an object`);
  }
  for (const field of ['name', 'rootLinkId'] as const) {
    if (typeof value.robotData[field] !== 'string') {
      throw new Error(`Invalid project file: ${label}.robotData.${field} must be a string`);
    }
  }
  if (!isRecord(value.robotData.links) || !isRecord(value.robotData.joints)) {
    throw new Error(`Invalid project file: ${label}.robotData must contain link and joint maps`);
  }
  assertCanonicalRobotData(value.robotData, `${label}.robotData`);
  if (!Array.isArray(value.meshFiles)) {
    throw new Error(`Invalid project file: ${label}.meshFiles must be an array`);
  }
  value.meshFiles.forEach((meshEntry, index) => {
    if (!isRecord(meshEntry)) {
      throw new Error(`Invalid project file: ${label}.meshFiles[${index}] must be an object`);
    }
    assertExactKeys(meshEntry, ['path', 'archivePath'], `${label}.meshFiles[${index}]`);
    if (typeof meshEntry.path !== 'string' || meshEntry.path.length === 0) {
      throw new Error(`Invalid project file: ${label}.meshFiles[${index}].path is invalid`);
    }
    assertProjectArchiveEntryPath(
      meshEntry.archivePath,
      `${label}.meshFiles[${index}].archivePath`,
    );
    if (!meshEntry.archivePath.startsWith(`${PROJECT_USD_PREPARED_EXPORT_CACHE_PREFIX}/`)) {
      throw new Error(`Invalid project file: ${label}.meshFiles[${index}] has an invalid path`);
    }
  });
}

function normalizeUsdCacheKey(path: string | null | undefined): string {
  return normalizeLibraryPathKey(path);
}

export async function buildUsdPreparedExportCacheEntries(
  caches: Record<string, UsdPreparedExportCache>,
): Promise<Map<string, ProjectArchiveEntryData>> {
  const cacheEntries = Object.entries(caches).filter(([, cache]) => cache?.robotData);
  const archiveEntries = new Map<string, ProjectArchiveEntryData>();
  if (cacheEntries.length === 0) {
    return archiveEntries;
  }

  const manifest: SerializedUsdPreparedExportCacheManifestEntry[] = [];

  for (const [index, [cacheKey, cache]] of cacheEntries.entries()) {
    const normalizedCacheKey = normalizeUsdCacheKey(cache.stageSourcePath || cacheKey);
    if (!normalizedCacheKey) {
      continue;
    }
    assertCanonicalRobotData(
      cache.robotData,
      `USD prepared cache "${normalizedCacheKey}".robotData`,
    );

    const cacheFolder = `${PROJECT_USD_PREPARED_EXPORT_CACHE_PREFIX}/cache-${index + 1}`;
    const usedMeshPaths = new Set<string>();
    const meshFiles: SerializedUsdPreparedExportMeshEntry[] = [];

    for (const [meshIndex, [meshPath, meshBlob]] of Object.entries(cache.meshFiles || {}).entries()) {
      if (!(meshBlob instanceof Blob)) {
        continue;
      }

      const uniqueMeshPath = ensureUniqueLogicalPath(
        normalizeArchivePath(meshPath) || `mesh_${meshIndex + 1}.obj`,
        usedMeshPaths,
        `mesh_${meshIndex + 1}.obj`,
      );
      const archivePath = `${cacheFolder}/meshes/${uniqueMeshPath}`;
      archiveEntries.set(archivePath, meshBlob);
      meshFiles.push({
        path: meshPath,
        archivePath,
      });
    }

    const cacheFile = `${cacheFolder}/cache.json`;
    const payload: SerializedUsdPreparedExportCachePayload = {
      stageSourcePath: cache.stageSourcePath || normalizedCacheKey,
      robotData: cache.robotData,
      meshFiles,
    };

    archiveEntries.set(cacheFile, stringifyProjectJson(payload));
    manifest.push({
      stageSourcePath: normalizedCacheKey,
      cacheFile,
    });
  }

  if (manifest.length > 0) {
    archiveEntries.set(PROJECT_USD_PREPARED_EXPORT_CACHES_FILE, stringifyProjectJson(manifest));
  }

  return archiveEntries;
}

export async function writeUsdPreparedExportCaches(
  zip: JSZip,
  caches: Record<string, UsdPreparedExportCache>,
): Promise<void> {
  const archiveEntries = await buildUsdPreparedExportCacheEntries(caches);
  appendProjectArchiveEntriesToZip(zip, archiveEntries);
}

export async function readUsdPreparedExportCaches(
  zip: JSZip,
  manifestPath?: string | null,
): Promise<Record<string, UsdPreparedExportCache>> {
  if (manifestPath === null) {
    return {};
  }
  const resolvedManifestPath = manifestPath ?? PROJECT_USD_PREPARED_EXPORT_CACHES_FILE;
  assertProjectArchiveEntryPath(resolvedManifestPath, 'USD prepared cache manifest');
  const manifestEntry = zip.file(resolvedManifestPath);
  if (!manifestEntry) {
    if (manifestPath === undefined) {
      return {};
    }
    throw new Error(
      `Invalid project file: missing required USD prepared cache manifest at "${resolvedManifestPath}"`,
    );
  }
  const manifestContent = await manifestEntry.async('string');
  if (!manifestContent) {
    throw new Error('Invalid project file: USD prepared cache manifest is empty');
  }

  const manifestValue = parseJson(manifestContent, 'USD prepared cache manifest');
  assertCacheManifest(manifestValue);
  const manifest = manifestValue;
  const caches: Record<string, UsdPreparedExportCache> = {};

  await Promise.all(manifest.map(async (entry) => {
    const payloadEntry = zip.file(entry.cacheFile);
    if (!payloadEntry) {
      throw new Error(
        `Invalid project file: missing required USD prepared cache at "${entry.cacheFile}"`,
      );
    }
    const payloadContent = await payloadEntry.async('string');
    if (!payloadContent) {
      throw new Error(`Invalid project file: USD prepared cache "${entry.cacheFile}" is empty`);
    }

    const payloadValue = parseJson(payloadContent, `USD prepared cache "${entry.cacheFile}"`);
    assertCachePayload(payloadValue, `USD prepared cache "${entry.cacheFile}"`);
    const payload = payloadValue;
    const meshFilesEntries = await Promise.all(
      payload.meshFiles.map(async (meshEntry) => {
        const meshFile = zip.file(meshEntry.archivePath);
        if (!meshFile) {
          throw new Error(
            `Invalid project file: missing required USD cache mesh at "${meshEntry.archivePath}"`,
          );
        }
        return [meshEntry.path, await meshFile.async('blob')] as const;
      }),
    );

    const normalizedKey = normalizeUsdCacheKey(payload.stageSourcePath || entry.stageSourcePath);
    if (!normalizedKey || caches[normalizedKey]) {
      throw new Error('Invalid project file: USD prepared cache contains duplicate keys');
    }

    caches[normalizedKey] = {
      stageSourcePath: payload.stageSourcePath || entry.stageSourcePath,
      robotData: payload.robotData,
      meshFiles: Object.fromEntries(meshFilesEntries),
    };
  }));

  return caches;
}
