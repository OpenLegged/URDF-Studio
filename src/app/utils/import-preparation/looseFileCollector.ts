import { isMotorLibraryDataFilePath } from '@/shared/data/motorLibrary';
import {
  isRobotImportAssetPath,
  isRobotImportCandidatePath,
} from '@/shared/utils/robotFileSupport';
import { detectImportFormat } from './formatDetection.ts';
import { createImportedUsdFileFromLooseFile, isUsdFamilyPath } from './usdFiles.ts';
import { createImportProgressEmitter } from './progress.ts';
import {
  createVisibleImportedAssetFile,
  isAuxiliaryTextImportPath,
  isImportableDefinitionPath,
  shouldAlwaysLoadAuxiliaryImportPath,
  shouldLoadAuxiliaryImportText,
  shouldMirrorTextMeshAssetContent,
} from './pathClassification.ts';
import { processWithConcurrency, resolveImportPreparationConcurrency } from './concurrency.ts';
import { isSupportedArchiveImportFile, withArchiveImportSession } from '../archiveImport.ts';
import { collectImportPayloadFromArchiveSession } from './archiveCollector.ts';
import {
  appendObjMaterialSidecarsFromLooseFiles,
  appendPreparedImportBlobFileIfMissing,
  appendPreparedImportTextFileIfMissing,
  appendPreparedImportTextFilesIfMissing,
  collectAllObjMaterialMeshPaths,
  collectReferencedObjMaterialPaths,
  collectReferencedTextMeshPathsForPreferredImport,
  MAX_EAGER_TEXT_MESH_ASSET_BYTES,
  normalizeImportPath,
  shouldSkipImportPath,
} from './sidecarReferences.ts';
import {
  appendCollectedImportPayload,
  createEmptyCollectedImportPayload,
  type CollectedImportPayload,
  type ImportPreparationFileInput,
  type PrepareImportProgress,
  type PreparedImportTextFile,
} from './payload.ts';

export function resolveImportInputFile(input: ImportPreparationFileInput): File {
  return input instanceof File ? input : input.file;
}

function resolveImportInputPath(input: ImportPreparationFileInput): string {
  if (!(input instanceof File) && input.relativePath) {
    return input.relativePath;
  }

  const file = resolveImportInputFile(input);
  return file.webkitRelativePath || file.name;
}

export async function collectImportPayloadFromLooseFiles(
  files: readonly ImportPreparationFileInput[],
  options: {
    preResolvePreferredImport?: boolean;
  } = {},
  onProgress?: (progress: PrepareImportProgress) => void,
): Promise<CollectedImportPayload> {
  const payload = createEmptyCollectedImportPayload();
  const emitProgress = createImportProgressEmitter(onProgress);
  const auxiliaryTextFiles: Array<{ path: string; file: File }> = [];
  const mirroredTextMeshFiles: Array<{ path: string; file: File }> = [];
  // Every loose OBJ/DAE file by normalized path, NOT size-gated — used for sidecar scanning
  // so large meshes still get their MTL/texture sidecars (mirroredTextMeshFiles caps at 8 MiB
  // because it eagerly keeps text content; sidecar scanning only needs to read on demand).
  const looseTextMeshFilesByPath = new Map<string, File>();
  const candidateFiles = files.filter((input) =>
    isRobotImportCandidatePath(resolveImportInputPath(input)),
  );
  const totalEntries = candidateFiles.length;
  const totalBytes = candidateFiles.reduce(
    (sum, input) => sum + resolveImportInputFile(input).size,
    0,
  );
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

  await processWithConcurrency(
    candidateFiles,
    resolveImportPreparationConcurrency(),
    async (input) => {
      const file = resolveImportInputFile(input);
      const path = resolveImportInputPath(input);
      const lowerPath = path.toLowerCase();

      if (shouldSkipImportPath(path)) {
        processedEntries += 1;
        processedBytes += file.size;
        reportExtractionProgress();
        return;
      }

      if (isSupportedArchiveImportFile(path)) {
        const archivePayload = await withArchiveImportSession(file, (archiveSession) =>
          collectImportPayloadFromArchiveSession(archiveSession, {
            preResolvePreferredImport: options.preResolvePreferredImport,
            sourceArchiveImportPath: normalizeImportPath(path),
          }),
        );
        appendCollectedImportPayload(payload, archivePayload);
      } else if (isUsdFamilyPath(path)) {
        payload.robotFiles.push(await createImportedUsdFileFromLooseFile(path, file));
        payload.usdSourceFiles.push({ name: path, blob: file });
      } else if (isImportableDefinitionPath(lowerPath)) {
        const content = await file.text();
        const format = detectImportFormat(content, file.name);
        if (format) {
          payload.robotFiles.push({ name: path, content, format });
        }
      } else if (isMotorLibraryDataFilePath(path)) {
        const content = await file.text();
        payload.libraryFiles.push({ path, content });
      } else if (isAuxiliaryTextImportPath(lowerPath)) {
        auxiliaryTextFiles.push({ path, file });
      } else if (isRobotImportAssetPath(path)) {
        if (shouldMirrorTextMeshAssetContent(lowerPath)) {
          looseTextMeshFilesByPath.set(normalizeImportPath(path), file);
          if (file.size <= MAX_EAGER_TEXT_MESH_ASSET_BYTES) {
            mirroredTextMeshFiles.push({ path, file });
          }
        }
        payload.assetFiles.push({ name: path, blob: file });
        const visibleAssetFile = createVisibleImportedAssetFile(path);
        if (visibleAssetFile) {
          payload.robotFiles.push(visibleAssetFile);
        }
      }

      processedEntries += 1;
      processedBytes += file.size;
      reportExtractionProgress();
    },
  );

  const auxiliaryTextFilesToLoad = auxiliaryTextFiles.filter(({ path }) => {
    const lowerPath = path.toLowerCase();
    return (
      shouldLoadAuxiliaryImportText(payload.robotFiles) ||
      shouldAlwaysLoadAuxiliaryImportPath(lowerPath)
    );
  });

  if (auxiliaryTextFilesToLoad.length > 0) {
    await processWithConcurrency(
      auxiliaryTextFilesToLoad,
      resolveImportPreparationConcurrency(),
      async ({ path, file }) => {
        appendPreparedImportTextFileIfMissing(payload.textFiles, {
          path,
          content: await file.text(),
        });
      },
    );
  }

  const referencedTextMeshPaths = collectReferencedTextMeshPathsForPreferredImport(
    payload.robotFiles,
    options.preResolvePreferredImport !== false,
  );
  const objMaterialMeshPaths = collectAllObjMaterialMeshPaths(
    payload.robotFiles,
    options.preResolvePreferredImport !== false,
  );

  if (referencedTextMeshPaths.size > 0 && mirroredTextMeshFiles.length > 0) {
    const targetedMirroredTextMeshFiles = mirroredTextMeshFiles.filter(({ path }) =>
      referencedTextMeshPaths.has(normalizeImportPath(path)),
    );

    if (targetedMirroredTextMeshFiles.length > 0) {
      const importedMjcfMeshTextFiles: PreparedImportTextFile[] = [];

      await processWithConcurrency(
        targetedMirroredTextMeshFiles,
        resolveImportPreparationConcurrency(),
        async ({ path, file }) => {
          importedMjcfMeshTextFiles.push({ path, content: await file.text() });
        },
      );

      appendPreparedImportTextFilesIfMissing(payload.textFiles, importedMjcfMeshTextFiles);

      const referencedObjMaterialPaths =
        collectReferencedObjMaterialPaths(importedMjcfMeshTextFiles);
      if (referencedObjMaterialPaths.size > 0 && auxiliaryTextFiles.length > 0) {
        const targetedAuxiliaryTextFiles = auxiliaryTextFiles.filter(({ path }) =>
          referencedObjMaterialPaths.has(normalizeImportPath(path)),
        );

        if (targetedAuxiliaryTextFiles.length > 0) {
          await processWithConcurrency(
            targetedAuxiliaryTextFiles,
            resolveImportPreparationConcurrency(),
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

  await appendObjMaterialSidecarsFromLooseFiles(
    payload,
    looseTextMeshFilesByPath,
    auxiliaryTextFiles,
    objMaterialMeshPaths,
  );

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
