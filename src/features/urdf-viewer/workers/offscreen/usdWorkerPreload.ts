import type { UsdWasmRuntime } from '@/lib/robot-parser/usd/usdWasmRuntime';
import type { PreparedUsdPreloadFile } from '@/lib/robot-parser/usd/usdStageOpenPreparation';
import { toVirtualUsdPath } from '@/lib/robot-parser/usd/usdPreloadSources';
import { preloadUsdStageEntries } from '../../utils/usdStagePreloadExecution.ts';

interface UsdWorkerPreloadRuntime {
  USD: UsdWasmRuntime['USD'];
  usdFsHelper: UsdWasmRuntime['usdFsHelper'];
}

// All writes, including fallback configuration fetches, check the load generation.
// Stage teardown owns clearing the WASM filesystem; this pipeline never clears it.
function normalizePreparedUsdPreloadBytes(
  bytes: PreparedUsdPreloadFile['bytes'],
): Uint8Array | null {
  if (!bytes) {
    return null;
  }

  if (bytes instanceof Uint8Array) {
    return bytes.byteLength > 0 ? bytes : null;
  }

  if (bytes instanceof ArrayBuffer) {
    return bytes.byteLength > 0 ? new Uint8Array(bytes) : null;
  }

  return null;
}

function getSharedConfigurationVirtualPath(path: string): string | null {
  const normalizedPath = toVirtualUsdPath(path);
  if (!normalizedPath.toLowerCase().includes('/configuration/')) {
    return null;
  }

  const fileName = normalizedPath.split('/').pop();
  return fileName ? `/configuration/${fileName}` : null;
}

async function writeUsdBytesToVirtualPath(
  activeRuntime: UsdWorkerPreloadRuntime,
  virtualPath: string,
  bytes: Uint8Array,
  isActive: () => boolean,
): Promise<boolean> {
  if (!isActive() || !activeRuntime.usdFsHelper.canOperateOnUsdFilesystem()) {
    return false;
  }

  const normalizedVirtualPath = toVirtualUsdPath(virtualPath);
  const fileName = normalizedVirtualPath.split('/').pop() || 'resource.usd';
  const lastSlashIndex = normalizedVirtualPath.lastIndexOf('/');
  const directory = lastSlashIndex >= 0 ? normalizedVirtualPath.slice(0, lastSlashIndex + 1) : '/';

  if (
    typeof activeRuntime.USD.FS_createPath !== 'function' ||
    (typeof activeRuntime.USD.FS_writeFile !== 'function' &&
      (typeof activeRuntime.USD.FS_createDataFile !== 'function' ||
        typeof activeRuntime.USD.FS_unlink !== 'function'))
  ) {
    return false;
  }

  activeRuntime.USD.FS_createPath('', directory, true, true);
  if (typeof activeRuntime.USD.FS_writeFile === 'function') {
    try {
      activeRuntime.USD.FS_writeFile(normalizedVirtualPath, bytes);
      activeRuntime.usdFsHelper.trackVirtualFilePath?.(normalizedVirtualPath);
      return activeRuntime.usdFsHelper.hasVirtualFilePath(normalizedVirtualPath);
    } catch {
      // Fall back to the older unlink/createDataFile path if direct writes fail.
    }
  }

  const unlinkUsdFile = activeRuntime.USD.FS_unlink;
  const createUsdDataFile = activeRuntime.USD.FS_createDataFile;
  if (typeof unlinkUsdFile !== 'function' || typeof createUsdDataFile !== 'function') {
    return false;
  }

  try {
    unlinkUsdFile(normalizedVirtualPath);
  } catch {}
  activeRuntime.usdFsHelper.untrackVirtualFilePath?.(normalizedVirtualPath);
  createUsdDataFile(directory, fileName, bytes, true, true, true);
  activeRuntime.usdFsHelper.trackVirtualFilePath?.(normalizedVirtualPath);

  return activeRuntime.usdFsHelper.hasVirtualFilePath(normalizedVirtualPath);
}

async function readUsdBlobBytes(blob: Blob, isActive: () => boolean): Promise<Uint8Array | null> {
  if (!isActive()) {
    return null;
  }

  const arrayBuffer = await blob.arrayBuffer();
  if (!isActive() || arrayBuffer.byteLength <= 0) {
    return null;
  }

  return new Uint8Array(arrayBuffer);
}

async function resolvePreparedUsdPreloadWriteBytes(
  entry: PreparedUsdPreloadFile,
  isActive: () => boolean,
): Promise<Uint8Array | null> {
  const normalizedBytes = normalizePreparedUsdPreloadBytes(entry.bytes);
  if (normalizedBytes) {
    return normalizedBytes;
  }

  if (!entry.blob) {
    return null;
  }

  const blobBytes = await readUsdBlobBytes(entry.blob, isActive);
  if (!blobBytes) {
    return null;
  }

  const blobMimeType = entry.blob.type || null;
  entry.bytes = blobBytes;
  entry.blob = null;
  entry.mimeType = entry.mimeType ?? blobMimeType;
  return blobBytes;
}

async function preloadUsdEntry(
  activeRuntime: UsdWorkerPreloadRuntime,
  entry: PreparedUsdPreloadFile,
  isActive: () => boolean,
): Promise<boolean> {
  if (!isActive()) {
    return false;
  }

  const resolvedBytes = await resolvePreparedUsdPreloadWriteBytes(entry, isActive);
  if (!resolvedBytes) {
    return false;
  }

  const loaded = await writeUsdBytesToVirtualPath(
    activeRuntime,
    entry.path,
    resolvedBytes,
    isActive,
  );

  if (!loaded) {
    return false;
  }

  const sharedConfigurationPath = getSharedConfigurationVirtualPath(entry.path);
  if (
    sharedConfigurationPath &&
    sharedConfigurationPath !== entry.path &&
    !activeRuntime.usdFsHelper.hasVirtualFilePath(sharedConfigurationPath)
  ) {
    await writeUsdBytesToVirtualPath(
      activeRuntime,
      sharedConfigurationPath,
      resolvedBytes,
      isActive,
    );
  }

  return activeRuntime.usdFsHelper.hasVirtualFilePath(entry.path);
}

export async function preloadUsdDependencies(
  activeRuntime: UsdWorkerPreloadRuntime,
  stageSourcePath: string,
  entries: PreparedUsdPreloadFile[],
  isActive: () => boolean,
): Promise<void> {
  await preloadUsdStageEntries({
    stageSourcePath,
    entries,
    isActive,
    preloadEntry: async (entry, entryIsActive) => {
      await preloadUsdEntry(activeRuntime, entry, entryIsActive);
    },
  });
}

async function preloadSharedConfigurationDependency({
  runtime,
  requiredPath,
  isActive,
}: {
  runtime: UsdWorkerPreloadRuntime;
  requiredPath: string;
  isActive: () => boolean;
}): Promise<boolean> {
  const fileName = requiredPath.split('/').pop();
  if (!fileName) return false;
  const sharedPath = `/configuration/${fileName}`;
  try {
    const response = await fetch(sharedPath);
    if (!response.ok) return false;
    const bytes = await readUsdBlobBytes(await response.blob(), isActive);
    if (!bytes) return false;
    if (!(await writeUsdBytesToVirtualPath(runtime, sharedPath, bytes, isActive))) return false;
    return await writeUsdBytesToVirtualPath(runtime, requiredPath, bytes, isActive);
  } catch (error) {
    console.error(`Skipping shared USD configuration preload for ${requiredPath}`, error);
    return false;
  }
}

export async function ensureCriticalUsdDependenciesLoaded({
  runtime: activeRuntime,
  stagePath,
  requiredPaths,
  entries,
  isActive,
}: {
  runtime: UsdWorkerPreloadRuntime;
  stagePath: string;
  requiredPaths: string[];
  entries: PreparedUsdPreloadFile[];
  isActive: () => boolean;
}): Promise<void> {
  const entryByPath = new Map(entries.map((entry) => [entry.path, entry]));
  const missingPaths: string[] = [];

  for (const requiredPath of requiredPaths) {
    if (!isActive()) {
      return;
    }

    if (activeRuntime.usdFsHelper.hasVirtualFilePath(requiredPath)) {
      continue;
    }

    let loaded = false;
    const exactEntry = entryByPath.get(requiredPath);
    if (exactEntry) {
      loaded = await preloadUsdEntry(activeRuntime, exactEntry, isActive);
    }

    if (!loaded) {
      loaded = await preloadSharedConfigurationDependency({
        runtime: activeRuntime,
        requiredPath,
        isActive,
      });
    }

    if (!loaded) {
      missingPaths.push(requiredPath);
    }
  }

  if (missingPaths.length > 0) {
    throw new Error(
      `Critical USD dependencies are missing for "${stagePath}": ${missingPaths.join(', ')}`,
    );
  }
}
