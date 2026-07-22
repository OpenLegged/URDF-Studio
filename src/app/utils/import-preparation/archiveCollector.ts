import { isMotorLibraryDataFilePath } from '@/shared/data/motorLibrary';
import { isRobotImportAssetPath } from '@/shared/utils/robotFileSupport';
import { detectImportFormat } from './formatDetection.ts';
import { createImportedUsdFile, isUsdFamilyPath } from './usdFiles.ts';
import { createImportProgressEmitter } from './progress.ts';
import {
  assertDeferredImportAssetsWithinLimits,
  assertImportEntriesWithinLimits,
} from './import_limits.ts';
import {
  createVisibleImportedAssetFile,
  isAuxiliaryTextImportPath,
  isImportableDefinitionPath,
  shouldAlwaysLoadAuxiliaryImportPath,
  shouldLoadAuxiliaryImportText,
  shouldMirrorTextMeshAssetContent,
} from './pathClassification.ts';
import { processWithConcurrency, resolveImportPreparationConcurrency } from './concurrency.ts';
import {
  withArchiveImportSession,
  type ArchiveImportEntry,
  type ArchiveImportSession,
} from '../archiveImport.ts';
import {
  appendArchiveSidecars,
  appendPreparedImportBlobFileIfMissing,
  appendPreparedImportTextFileIfMissing,
  appendPreparedImportTextFilesIfMissing,
  collectAllDaeTextureMeshPaths,
  collectAllObjMaterialMeshPaths,
  collectReferencedObjMaterialPaths,
  collectReferencedTextMeshPathsForPreferredImport,
  MAX_EAGER_TEXT_MESH_ASSET_BYTES,
  normalizeImportPath,
  shouldSkipImportPath,
} from './sidecarReferences.ts';
import {
  createEmptyCollectedImportPayload,
  type CollectedImportPayload,
  type PreparedDeferredImportAssetFile,
  type PreparedImportBlobFile,
  type PrepareImportProgress,
  type PreparedImportTextFile,
} from './payload.ts';

export async function collectImportPayloadFromArchiveSession(
  archiveSession: ArchiveImportSession,
  options: {
    preResolvePreferredImport?: boolean;
    sourceArchiveImportPath?: string;
  } = {},
  onProgress?: (progress: PrepareImportProgress) => void,
): Promise<CollectedImportPayload> {
  const payload = createEmptyCollectedImportPayload();
  const emitProgress = createImportProgressEmitter(onProgress);
  emitProgress({
    phase: 'reading-archive',
    progressPercent: 0,
    processedEntries: 0,
    totalEntries: 0,
    processedBytes: 0,
    totalBytes: 0,
  });

  const processableEntries = archiveSession.entries.filter(
    (entry) => !shouldSkipImportPath(entry.path),
  );
  assertImportEntriesWithinLimits(processableEntries, 'Archive import');
  const auxiliaryTextEntries: ArchiveImportEntry[] = [];
  const mirroredTextMeshAssetEntries: ArchiveImportEntry[] = [];
  const usdEntries: ArchiveImportEntry[] = [];
  const definitionEntries: ArchiveImportEntry[] = [];
  const libraryEntries: ArchiveImportEntry[] = [];

  const totalEntries = processableEntries.length;
  const totalBytes = processableEntries.reduce((sum, current) => sum + current.size, 0);
  let processedEntries = 0;
  let processedBytes = 0;
  const reportExtractionProgress = () => {
    emitProgress({
      phase: 'extracting-files',
      progressPercent: totalEntries > 0 ? (processedEntries / totalEntries) * 100 : 100,
      processedEntries,
      totalEntries,
      processedBytes,
      totalBytes,
    });
  };

  reportExtractionProgress();

  processableEntries.forEach((entry) => {
    const { path, size } = entry;
    const lowerPath = path.toLowerCase();

    if (isUsdFamilyPath(path)) {
      usdEntries.push(entry);
    } else if (isImportableDefinitionPath(lowerPath)) {
      definitionEntries.push(entry);
    } else if (isMotorLibraryDataFilePath(path)) {
      libraryEntries.push(entry);
    } else if (isAuxiliaryTextImportPath(lowerPath)) {
      auxiliaryTextEntries.push(entry);
    } else if (isRobotImportAssetPath(path)) {
      payload.deferredAssetFiles.push({
        name: path,
        sourcePath: path,
        sourceArchiveImportPath: options.sourceArchiveImportPath,
      });
      if (shouldMirrorTextMeshAssetContent(lowerPath) && size <= MAX_EAGER_TEXT_MESH_ASSET_BYTES) {
        mirroredTextMeshAssetEntries.push(entry);
      }
      const visibleAssetFile = createVisibleImportedAssetFile(path);
      if (visibleAssetFile) {
        payload.robotFiles.push(visibleAssetFile);
      }
    }
    processedEntries += 1;
    processedBytes += size;
    reportExtractionProgress();
  });

  const concurrency = resolveImportPreparationConcurrency();

  const extractedUsdEntries = await archiveSession.extractEntries(
    usdEntries.map((entry) => entry.path),
  );
  await processWithConcurrency(extractedUsdEntries, concurrency, async ({ path, file }) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    payload.robotFiles.push(createImportedUsdFile(path, bytes));
    payload.usdSourceFiles.push({ name: path, blob: new Blob([bytes]) });
  });

  const extractedDefinitionEntries = await archiveSession.extractEntries(
    definitionEntries.map((entry) => entry.path),
  );
  await processWithConcurrency(extractedDefinitionEntries, concurrency, async ({ path, file }) => {
    const content = await file.text();
    const format = detectImportFormat(content, path);
    if (format) {
      payload.robotFiles.push({ name: path, content, format });
    }
  });

  const extractedLibraryEntries = await archiveSession.extractEntries(
    libraryEntries.map((entry) => entry.path),
  );
  await processWithConcurrency(extractedLibraryEntries, concurrency, async ({ path, file }) => {
    const content = await file.text();
    payload.libraryFiles.push({ path, content });
  });

  const referencedTextMeshPaths = collectReferencedTextMeshPathsForPreferredImport(
    payload.robotFiles,
    options.preResolvePreferredImport !== false,
  );
  const objMaterialMeshPaths = collectAllObjMaterialMeshPaths(
    payload.robotFiles,
    options.preResolvePreferredImport !== false,
  );
  const daeTextureMeshPaths = collectAllDaeTextureMeshPaths(
    payload.robotFiles,
    options.preResolvePreferredImport !== false,
  );

  const auxiliaryTextEntriesToLoad = auxiliaryTextEntries.filter((entry) => {
    const lowerPath = entry.path.toLowerCase();
    return (
      shouldLoadAuxiliaryImportText(payload.robotFiles) ||
      shouldAlwaysLoadAuxiliaryImportPath(lowerPath)
    );
  });

  if (auxiliaryTextEntriesToLoad.length > 0) {
    const extractedAuxiliaryTextEntries = await archiveSession.extractEntries(
      auxiliaryTextEntriesToLoad.map((entry) => entry.path),
    );
    await processWithConcurrency(
      extractedAuxiliaryTextEntries,
      concurrency,
      async ({ path, file }) => {
        const content = await file.text();
        appendPreparedImportTextFileIfMissing(payload.textFiles, { path, content });
      },
    );
  }

  if (referencedTextMeshPaths.size > 0 && mirroredTextMeshAssetEntries.length > 0) {
    const targetedMirroredTextMeshEntries = mirroredTextMeshAssetEntries.filter((entry) =>
      referencedTextMeshPaths.has(normalizeImportPath(entry.path)),
    );

    if (targetedMirroredTextMeshEntries.length > 0) {
      const extractedMirroredTextMeshEntries = await archiveSession.extractEntries(
        targetedMirroredTextMeshEntries.map((entry) => entry.path),
      );
      const importedMjcfMeshTextFiles: PreparedImportTextFile[] = [];

      await processWithConcurrency(
        extractedMirroredTextMeshEntries,
        concurrency,
        async ({ path, file }) => {
          importedMjcfMeshTextFiles.push({ path, content: await file.text() });
        },
      );

      appendPreparedImportTextFilesIfMissing(payload.textFiles, importedMjcfMeshTextFiles);

      const referencedObjMaterialPaths =
        collectReferencedObjMaterialPaths(importedMjcfMeshTextFiles);
      if (referencedObjMaterialPaths.size > 0 && auxiliaryTextEntries.length > 0) {
        const targetedAuxiliaryTextEntries = auxiliaryTextEntries.filter((entry) =>
          referencedObjMaterialPaths.has(normalizeImportPath(entry.path)),
        );

        if (targetedAuxiliaryTextEntries.length > 0) {
          const extractedAuxiliaryTextEntries = await archiveSession.extractEntries(
            targetedAuxiliaryTextEntries.map((entry) => entry.path),
          );
          await processWithConcurrency(
            extractedAuxiliaryTextEntries,
            concurrency,
            async ({ path, file }) => {
              appendPreparedImportTextFileIfMissing(payload.textFiles, {
                path,
                content: await file.text(),
              });
              appendPreparedImportBlobFileIfMissing(payload.assetFiles, {
                name: path,
                blob: file,
              });
            },
          );
        }
      }
    }
  }

  await appendArchiveSidecars({
    payload,
    archiveSession,
    auxiliaryTextEntries,
    concurrency,
    objMaterialMeshPaths,
    daeTextureMeshPaths,
  });

  emitProgress({
    phase: 'finalizing-import',
    progressPercent: 100,
    processedEntries: totalEntries,
    totalEntries,
    processedBytes: totalBytes,
    totalBytes,
  });

  return payload;
}

export async function hydrateDeferredImportAssetsFromArchiveSession(
  archiveSession: ArchiveImportSession,
  assetFiles: readonly PreparedDeferredImportAssetFile[],
  onProgress?: (progress: PrepareImportProgress) => void,
): Promise<PreparedImportBlobFile[]> {
  const emitProgress = createImportProgressEmitter(onProgress);
  emitProgress({
    phase: 'reading-archive',
    progressPercent: 0,
    processedEntries: 0,
    totalEntries: assetFiles.length,
    processedBytes: 0,
    totalBytes: 0,
  });

  const totalEntries = assetFiles.length;
  if (assetFiles.length === 0) {
    emitProgress({
      phase: 'finalizing-import',
      progressPercent: 100,
      processedEntries: 0,
      totalEntries: 0,
      processedBytes: 0,
      totalBytes: 0,
    });
    return [];
  }

  assertDeferredImportAssetsWithinLimits(archiveSession.entries, assetFiles);
  const assetFileLookup = new Map(assetFiles.map((file) => [file.sourcePath, file] as const));
  const extractedAssetFiles = await archiveSession.extractEntries(
    assetFiles.map((file) => file.sourcePath),
    ({ processedEntries, processedBytes, totalBytes }) => {
      emitProgress({
        phase: 'extracting-files',
        progressPercent: totalBytes > 0 ? (processedBytes / totalBytes) * 100 : 100,
        processedEntries,
        totalEntries,
        processedBytes,
        totalBytes,
      });
    },
  );
  const hydratedAssetFiles: PreparedImportBlobFile[] = [];

  await processWithConcurrency(
    extractedAssetFiles,
    resolveImportPreparationConcurrency(),
    async ({ path, file }) => {
      const assetFile = assetFileLookup.get(path);
      if (!assetFile) {
        throw new Error(`Missing deferred asset "${path}" in archive.`);
      }

      hydratedAssetFiles.push({
        name: assetFile.name,
        blob: file,
      });
    },
  );

  emitProgress({
    phase: 'finalizing-import',
    progressPercent: 100,
    processedEntries: extractedAssetFiles.length,
    totalEntries,
    processedBytes: extractedAssetFiles.reduce((sum, current) => sum + current.size, 0),
    totalBytes: extractedAssetFiles.reduce((sum, current) => sum + current.size, 0),
  });

  return hydratedAssetFiles.sort((left, right) => left.name.localeCompare(right.name));
}

export async function hydrateDeferredImportAssets(
  archiveFile: File,
  assetFiles: readonly PreparedDeferredImportAssetFile[],
  onProgress?: (progress: PrepareImportProgress) => void,
): Promise<PreparedImportBlobFile[]> {
  return withArchiveImportSession(archiveFile, async (archiveSession) =>
    hydrateDeferredImportAssetsFromArchiveSession(archiveSession, assetFiles, onProgress),
  );
}
