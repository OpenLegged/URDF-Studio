import { isStandaloneXacroEntry, resolveRobotFileData } from '@/core/parsers/importRobotFile';
import {
  createImportPathCollisionMap,
  remapImportedPath,
} from '@/features/file-io/import_path_collisions';
import { isAssetLibraryOnlyFormat, isVisibleLibraryEntry } from '@/shared/utils/robotFileSupport';
import { pickPreferredImportFile } from '@/app/hooks/importPreferredFile';
import { buildPreResolvedImportContentSignature } from './preResolvedImportSignature.ts';
import { peekPreResolvedRobotImport } from './preResolvedRobotImportCache.ts';
import { normalizeLooseImportBundleRoot } from './import-preparation/bundleRootNormalization.ts';
import { pickFastPreparedPreferredFile } from './import-preparation/fastPreferredFile.ts';
import { mapImportProgressToPercentRange } from './import-preparation/progress.ts';
import { determineCriticalDeferredAssetNames } from './import-preparation/criticalDeferredAssets.ts';
import { isSupportedArchiveImportFile, withArchiveImportSession } from './archiveImport.ts';
import {
  collectImportPayloadFromArchiveSession,
  hydrateDeferredImportAssetsFromArchiveSession,
} from './import-preparation/archiveCollector.ts';
import {
  collectImportPayloadFromLooseFiles,
  resolveImportInputFile,
} from './import-preparation/looseFileCollector.ts';
import { appendPreparedImportBlobFileIfMissing } from './import-preparation/sidecarReferences.ts';
import {
  createEmptyPreparedImportPayload,
  sortCollectedImportPayload,
  type CollectedImportPayload,
  type PrepareImportPayloadArgs,
  type PreparedImportPayload,
} from './import-preparation/payload.ts';

export { detectImportFormat } from './import-preparation/formatDetection.ts';
export { hydrateDeferredImportAssets } from './import-preparation/archiveCollector.ts';
export type { PreResolvedImportEntry } from './preResolvedImportContract.ts';
export type {
  HydrateDeferredImportAssetsWorkerRequest,
  HydrateDeferredImportAssetsWorkerResponse,
  ImportPreparationFileDescriptor,
  ImportPreparationFileInput,
  ImportPreparationWorkerRequest,
  ImportPreparationWorkerResponse,
  PrepareImportPayloadArgs,
  PrepareImportProgress,
  PrepareImportProgressPhase,
  PrepareImportWorkerRequest,
  PrepareImportWorkerResponse,
  PreparedDeferredImportAssetFile,
  PreparedImportBlobFile,
  PreparedImportLibraryFile,
  PreparedImportPayload,
  PreparedImportTextFile,
} from './import-preparation/payload.ts';

function renameCollectedImportPayload(
  payload: CollectedImportPayload,
  existingPaths: readonly string[],
  options: {
    preResolvePreferredImport?: boolean;
  } = {},
): PreparedImportPayload {
  const importedPaths = [
    ...payload.robotFiles.map((file) => file.name),
    ...payload.assetFiles.map((file) => file.name),
    ...payload.deferredAssetFiles.map((file) => file.name),
    ...payload.libraryFiles.map((file) => file.path),
    ...payload.textFiles.map((file) => file.path),
  ];
  const pathCollisionMap = createImportPathCollisionMap(importedPaths, existingPaths);

  const renamedPayload = {
    robotFiles: payload.robotFiles.map((file) => ({
      ...file,
      name: remapImportedPath(file.name, pathCollisionMap),
    })),
    assetFiles: payload.assetFiles.map((file) => ({
      ...file,
      name: remapImportedPath(file.name, pathCollisionMap),
    })),
    deferredAssetFiles: payload.deferredAssetFiles.map((file) => ({
      ...file,
      name: remapImportedPath(file.name, pathCollisionMap),
    })),
    usdSourceFiles: payload.usdSourceFiles.map((file) => ({
      ...file,
      name: remapImportedPath(file.name, pathCollisionMap),
    })),
    libraryFiles: payload.libraryFiles.map((file) => ({
      ...file,
      path: remapImportedPath(file.path, pathCollisionMap),
    })),
    textFiles: payload.textFiles.map((file) => ({
      ...file,
      path: remapImportedPath(file.path, pathCollisionMap),
    })),
  };
  const shouldPreResolvePreferredImport = options.preResolvePreferredImport !== false;
  const importTextFileContents = shouldPreResolvePreferredImport
    ? Object.fromEntries(renamedPayload.textFiles.map((file) => [file.path, file.content]))
    : {};
  const visibleRobotFiles = renamedPayload.robotFiles.filter(isVisibleLibraryEntry);
  const standaloneRootXacro =
    shouldPreResolvePreferredImport &&
    visibleRobotFiles.length > 0 &&
    visibleRobotFiles.every(
      (file) => file.format === 'xacro' || isAssetLibraryOnlyFormat(file.format),
    )
      ? (visibleRobotFiles.find(
          (file) => file.format === 'xacro' && isStandaloneXacroEntry(file),
        ) ?? null)
      : null;
  const preferredFile = shouldPreResolvePreferredImport
    ? (standaloneRootXacro ?? pickPreferredImportFile(visibleRobotFiles, renamedPayload.robotFiles))
    : pickFastPreparedPreferredFile(visibleRobotFiles, renamedPayload.robotFiles);
  const cachedPreferredImportResult =
    shouldPreResolvePreferredImport && preferredFile
      ? peekPreResolvedRobotImport(preferredFile)
      : null;
  const preferredImportResult =
    cachedPreferredImportResult ??
    (shouldPreResolvePreferredImport && preferredFile
      ? preferredFile.format === 'xacro' || preferredFile.format === 'sdf'
        ? resolveRobotFileData(preferredFile, {
            availableFiles: renamedPayload.robotFiles,
            allFileContents: importTextFileContents,
          })
        : resolveRobotFileData(preferredFile, {
            availableFiles: renamedPayload.robotFiles,
          })
      : null);

  const preResolvedImports =
    shouldPreResolvePreferredImport && preferredFile && preferredImportResult
      ? [
          {
            fileName: preferredFile.name,
            format: preferredFile.format,
            contentSignature: buildPreResolvedImportContentSignature(preferredFile.content),
            result: preferredImportResult,
          },
        ]
      : [];

  return {
    ...renamedPayload,
    preferredFileName: preferredFile?.name ?? null,
    preResolvedImports,
  };
}

export async function prepareImportPayload({
  files,
  existingPaths,
  preResolvePreferredImport = true,
  onProgress,
}: PrepareImportPayloadArgs): Promise<PreparedImportPayload> {
  const firstFile = files[0] ? resolveImportInputFile(files[0]) : null;
  const isSingleArchiveImport =
    files.length === 1 && firstFile ? isSupportedArchiveImportFile(firstFile.name) : false;
  if (isSingleArchiveImport && firstFile) {
    return withArchiveImportSession(firstFile, async (archiveSession) => {
      const collectedPayload = await collectImportPayloadFromArchiveSession(
        archiveSession,
        {
          preResolvePreferredImport,
        },
        onProgress
          ? (progress) => onProgress(mapImportProgressToPercentRange(progress, 0, 72))
          : undefined,
      );
      const sortedCollectedPayload = sortCollectedImportPayload(collectedPayload);

      if (
        sortedCollectedPayload.robotFiles.length === 0 &&
        sortedCollectedPayload.libraryFiles.length === 0
      ) {
        return createEmptyPreparedImportPayload();
      }

      const preparedPayload = renameCollectedImportPayload(
        normalizeLooseImportBundleRoot(sortedCollectedPayload),
        existingPaths,
        {
          preResolvePreferredImport,
        },
      );

      if (preparedPayload.deferredAssetFiles.length === 0) {
        return preparedPayload;
      }

      const preferredFile = preparedPayload.preferredFileName
        ? (preparedPayload.robotFiles.find(
            (file) => file.name === preparedPayload.preferredFileName,
          ) ?? null)
        : null;
      const preparedTextFileContents = Object.fromEntries(
        preparedPayload.textFiles.map((file) => [file.path, file.content]),
      );
      const preResolvedPreferredImport =
        preferredFile == null
          ? null
          : (preparedPayload.preResolvedImports.find(
              (entry) => entry.fileName === preferredFile.name,
            ) ?? null);
      const preferredImportResult =
        preResolvedPreferredImport?.result ??
        (preferredFile && preferredFile.format !== 'usd'
          ? resolveRobotFileData(preferredFile, {
              availableFiles: preparedPayload.robotFiles,
              allFileContents: preparedTextFileContents,
            })
          : null);
      const criticalDeferredAssetNames = determineCriticalDeferredAssetNames(
        preferredFile,
        preferredImportResult,
        preparedPayload.deferredAssetFiles,
        preparedPayload.robotFiles,
        preparedTextFileContents,
      );

      if (criticalDeferredAssetNames.size === 0) {
        return preparedPayload;
      }

      const immediateDeferredAssetFiles = preparedPayload.deferredAssetFiles.filter((file) =>
        criticalDeferredAssetNames.has(file.name),
      );
      const remainingDeferredAssetFiles = preparedPayload.deferredAssetFiles.filter(
        (file) => !criticalDeferredAssetNames.has(file.name),
      );
      const criticalAssetFiles = await hydrateDeferredImportAssetsFromArchiveSession(
        archiveSession,
        immediateDeferredAssetFiles,
        onProgress
          ? (progress) => onProgress(mapImportProgressToPercentRange(progress, 72, 92))
          : undefined,
      );

      // Sidecar collection may already have eagerly added some of these assets (e.g. an
      // OBJ texture that is also a critical deferred asset), so dedup by name on merge.
      const mergedAssetFiles = [...preparedPayload.assetFiles];
      criticalAssetFiles.forEach((file) =>
        appendPreparedImportBlobFileIfMissing(mergedAssetFiles, file),
      );

      return {
        ...preparedPayload,
        assetFiles: mergedAssetFiles,
        deferredAssetFiles: remainingDeferredAssetFiles,
      };
    });
  }

  const collectedPayload = await collectImportPayloadFromLooseFiles(
    files,
    {
      preResolvePreferredImport,
    },
    onProgress,
  );
  const sortedCollectedPayload = sortCollectedImportPayload(collectedPayload);

  if (
    sortedCollectedPayload.robotFiles.length === 0 &&
    sortedCollectedPayload.libraryFiles.length === 0
  ) {
    return createEmptyPreparedImportPayload();
  }

  const preparedPayload = renameCollectedImportPayload(
    normalizeLooseImportBundleRoot(sortedCollectedPayload),
    existingPaths,
    {
      preResolvePreferredImport,
    },
  );

  return preparedPayload;
}
