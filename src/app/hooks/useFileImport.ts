/**
 * File Import Hook
 * Handles importing URDF, MJCF, USD, Xacro files and supported archive packages
 */
import { useCallback, useRef } from 'react';
import type { RobotFile } from '@/types';
import { DEFAULT_MOTOR_LIBRARY } from '@/shared/data/motorLibrary';
import { mergeMotorLibraryEntries } from '@/shared/data/motorLibraryMerge';
import {
  useAssetsStore,
  useUIStore,
} from '@/store';
import type { ProjectImportResult } from '@/features/file-io';
import { translations } from '@/shared/i18n';
import {
  isAssetLibraryOnlyFormat,
  isLibraryPreviewableFile,
  isVisibleLibraryEntry,
  isSupportedArchiveImportFile,
  isRobotImportCandidatePath,
} from '@/shared/utils/robotFileSupport';
import { commitImportedProject } from '../utils/commitImportedProject';
import { commitResolvedRobotLoad } from '../utils/commitResolvedRobotLoad';
import {
  prepareImportPayloadWithWorker,
  hydrateDeferredImportAssetsWithWorker,
} from './importPreparationWorkerBridge';
import { resolveRobotFileDataWithWorker } from './robotImportWorkerBridge';
import { hydrateDeferredArchiveAssetsInBackground } from './deferred_import_hydration';
import { createAssetUrls, revokeBlobUrls } from './import_blob_urls';
import {
  detectImportFormat,
  type PreparedImportPayload,
  type PrepareImportProgress,
} from '@/app/utils/importPreparation';
import {
  buildContextualPreResolvedImports,
  shouldBuildContextualPreResolvedImports,
} from '@/app/utils/contextualPreResolvedImports';
import {
  buildStandaloneImportAssetWarning,
  buildStandalonePrimitiveGeometryHint,
  canProceedWithStandaloneImportAssetWarning,
  collectStandaloneImportSupportAssetPaths,
} from '@/app/utils/importPackageAssetReferences.ts';
import { primePreResolvedRobotImports } from '@/app/utils/preResolvedRobotImportCache';
import { prewarmUsdSelectionInBackground } from '@/app/utils/usdSelectionPrewarm';
import { markUnsavedChangesBaselineSaved } from '@/app/utils/unsavedChangesBaseline';
import { waitForAnimationFrame } from '@/app/utils/waitForAnimationFrame';
import { normalizeLibraryPathKey } from '@/core/utils/pathKeys';
import { logRegressionInfo } from '@/shared/debug/consoleDiagnostics';
import { clearPreparedUsdStageOpenCache } from '@/features/editor/usd_prewarm';
import { isRobotDefinitionPath } from '@/core/parsers/format_detection';

export interface ImportPreparationOverlayState {
  label: string;
  detail?: string;
  progress?: number | null;
  statusLabel?: string | null;
  stageLabel?: string | null;
}

export type ImportInputFiles = FileList | readonly File[] | null;
export type HandleImportResult = {
  status: 'completed' | 'skipped' | 'failed';
};

class StaleImportRequestError extends Error {
  constructor() {
    super('A newer import request superseded this import.');
    this.name = 'StaleImportRequestError';
  }
}

interface UseFileImportOptions {
  onLoadRobot?: (file: RobotFile) => unknown | Promise<unknown>;
  onShowToast?: (message: string, type?: 'info' | 'success') => void;
  onImportPreparationStateChange?: (state: ImportPreparationOverlayState | null) => void;
  onProjectImported?: (selectedFile: RobotFile | null) => void;
  projectImporter?: (file: File, lang?: keyof typeof translations) => Promise<ProjectImportResult>;
  prepareImportPayload?: typeof prepareImportPayloadWithWorker;
}

function normalizeImportSourcePath(path: string): string {
  return normalizeLibraryPathKey(path);
}

function resolveImportSourceFilePath(file: File): string {
  return normalizeImportSourcePath(file.webkitRelativePath || file.name);
}

function pickPreparedPreferredFile(
  files: readonly RobotFile[],
  preferredFileName: string | null,
  preResolvedFileName: string | null,
): RobotFile | null {
  const visibleFiles = files.filter(isLibraryPreviewableFile);

  if (preferredFileName) {
    return visibleFiles.find((file) => file.name === preferredFileName) ?? null;
  }

  if (preResolvedFileName) {
    return visibleFiles.find((file) => file.name === preResolvedFileName) ?? null;
  }

  return (
    visibleFiles.find((file) => !isAssetLibraryOnlyFormat(file.format)) ??
    visibleFiles.find((file) => isLibraryPreviewableFile(file)) ??
    null
  );
}

function formatImportPreparationBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Math.max(0, bytes);
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const fractionDigits = unitIndex === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

function resolveImportPreparationStageLabel(
  t: (typeof translations)[keyof typeof translations],
  progress: PrepareImportProgress,
): string {
  switch (progress.phase) {
    case 'reading-archive':
      return t.importPreparationReadingArchive;
    case 'extracting-files':
      return t.importPreparationExtractingFiles;
    case 'finalizing-import':
      return t.importPreparationFinalizingImport;
    default:
      return t.importPreparationLoadingTitle;
  }
}

function createInitialImportPreparationOverlayState(
  t: (typeof translations)[keyof typeof translations],
): ImportPreparationOverlayState {
  return {
    label: t.importPreparationLoadingTitle,
    detail: t.importPreparationLoadingDetail,
    progress: null,
    statusLabel: null,
    stageLabel: t.importPreparationReadingArchive,
  };
}

function createImportPreparationOverlayStateFromProgress(
  t: (typeof translations)[keyof typeof translations],
  progress: PrepareImportProgress,
): ImportPreparationOverlayState {
  const stageLabel = resolveImportPreparationStageLabel(t, progress);
  const normalizedProgress =
    progress.progressPercent == null
      ? null
      : Math.max(0, Math.min(1, progress.progressPercent / 100));
  const detail =
    progress.totalBytes > 0
      ? `${formatImportPreparationBytes(progress.processedBytes)} / ${formatImportPreparationBytes(progress.totalBytes)}`
      : progress.totalEntries > 0
        ? `${progress.processedEntries} / ${progress.totalEntries}`
        : stageLabel;
  const statusLabel =
    progress.totalEntries > 0
      ? `${progress.processedEntries} / ${progress.totalEntries}`
      : progress.progressPercent != null
        ? `${Math.round(progress.progressPercent)}%`
        : null;

  return {
    label: t.importPreparationLoadingTitle,
    detail,
    progress: normalizedProgress,
    statusLabel,
    stageLabel,
  };
}

export function useFileImport(options: UseFileImportOptions = {}) {
  const {
    onLoadRobot,
    onShowToast,
    onImportPreparationStateChange,
    onProjectImported,
    projectImporter,
    prepareImportPayload = prepareImportPayloadWithWorker,
  } = options;
  const importGenerationRef = useRef(0);

  const loadRobot = useCallback(
    async (
      file: RobotFile,
      availableFiles?: RobotFile[],
      currentAssets?: Record<string, string>,
      currentAllFileContents?: Record<string, string>,
    ) => {
      const assetsState = useAssetsStore.getState();
      const importResult = await resolveRobotFileDataWithWorker(file, {
        availableFiles: availableFiles ?? assetsState.availableFiles,
        assets: currentAssets ?? assetsState.assets,
        allFileContents: currentAllFileContents ?? assetsState.allFileContents,
        // Let USD imports resolve through the current hydration pipeline. A
        // prepared cache is auxiliary export data, not an authoritative import
        // result for a new load of the same file path.
        usdRobotData:
          file.format === 'usd'
            ? null
            : (assetsState.getUsdPreparedExportCache(file.name)?.robotData ?? null),
      });

      if (
        importResult.status === 'ready' || importResult.status === 'needs_hydration'
      ) {
        if (onLoadRobot) {
          await onLoadRobot(file);
        } else {
          commitResolvedRobotLoad({
            currentAppMode: useUIStore.getState().appMode,
            file,
            importResult,
            markWorkspaceBaselineSaved: markUnsavedChangesBaselineSaved,
            setAppMode: useUIStore.getState().setAppMode,
          });
        }
      }

      return importResult;
    },
    [onLoadRobot],
  );

  const handleImport = useCallback(
    async (files: ImportInputFiles): Promise<HandleImportResult> => {
      if (!files || files.length === 0) {
        return { status: 'skipped' };
      }

      const importGeneration = ++importGenerationRef.current;
      const isCurrentImport = () => importGenerationRef.current === importGeneration;
      const throwIfStaleImport = () => {
        if (!isCurrentImport()) {
          throw new StaleImportRequestError();
        }
      };
      const uiState = useUIStore.getState();
      const assetsState = useAssetsStore.getState();
      const t = translations[uiState.lang];
      const rawInputFiles = Array.from(files);
      const projectInputFiles = rawInputFiles.filter((file) =>
        file.name.toLowerCase().endsWith('.usp'),
      );
      const candidateInputFiles = rawInputFiles.filter((file) =>
        isRobotImportCandidatePath(resolveImportSourceFilePath(file)),
      );
      const inputFiles = candidateInputFiles.length > 0 ? candidateInputFiles : rawInputFiles;
      const isArchiveImport =
        inputFiles.length === 1 && isSupportedArchiveImportFile(inputFiles[0]?.name ?? '');
      const importsRobotDefinition = inputFiles.some((file) => isRobotDefinitionPath(file.name));
      const shouldShowPreparationOverlay =
        inputFiles.length > 1 ||
        inputFiles.some((file) => Boolean(file.webkitRelativePath)) ||
        isArchiveImport ||
        importsRobotDefinition;

      const createdBlobUrls: string[] = [];
      let importStateMutated = false;
      let importOverlayActive = false;

      const setImportPreparationOverlay = (state: ImportPreparationOverlayState | null) => {
        if (!isCurrentImport()) {
          return;
        }

        onImportPreparationStateChange?.(state);
        importOverlayActive = state !== null;
      };

      const clearImportPreparationOverlay = () => {
        if (!importOverlayActive) {
          return;
        }

        setImportPreparationOverlay(null);
      };

      try {
        if (projectInputFiles.length > 1) {
          throw new Error('Import contains multiple project files. Import one .usp project at a time.');
        }

        const projectInputFile = projectInputFiles[0] ?? null;
        if (projectInputFile) {
          const importProject =
            projectImporter ??
            (async (file: File, lang?: keyof typeof translations) => {
              const { importProjectWithWorker } = await import('@/features/file-io');
              return importProjectWithWorker(file, lang);
            });
          const result = await importProject(projectInputFile, uiState.lang);
          createdBlobUrls.push(...Object.values(result.assets.assetUrls));
          throwIfStaleImport();

          const restoredSelectedFile = commitImportedProject(result, {
            markWorkspaceBaselineSaved: markUnsavedChangesBaselineSaved,
          });
          importStateMutated = true;
          clearPreparedUsdStageOpenCache();
          onProjectImported?.(restoredSelectedFile);

          return { status: 'completed' };
        }

        if (shouldShowPreparationOverlay) {
          setImportPreparationOverlay(createInitialImportPreparationOverlayState(t));
          await waitForAnimationFrame();
          throwIfStaleImport();
        }

        const existingImportPaths = [
          ...assetsState.availableFiles.map((file) => file.name),
          ...Object.keys(assetsState.assets),
          ...Object.keys(assetsState.allFileContents),
        ];
        const onPreparationProgress = shouldShowPreparationOverlay
          ? (progress: PrepareImportProgress) => {
              setImportPreparationOverlay(
                createImportPreparationOverlayStateFromProgress(t, progress),
              );
            }
          : undefined;
        const preparedImportPayload: PreparedImportPayload = await prepareImportPayload({
          files: inputFiles,
          existingPaths: existingImportPaths,
          preResolvePreferredImport: false,
          onProgress: onPreparationProgress,
        });
        throwIfStaleImport();

        const {
          robotFiles: renamedRobotFiles,
          assetFiles: renamedAssetFiles,
          deferredAssetFiles: renamedDeferredAssetFiles,
          usdSourceFiles: renamedUsdSourceFiles,
          libraryFiles: renamedLibraryFiles,
          textFiles: renamedTextFiles,
          preferredFileName,
          preResolvedImports,
        } = preparedImportPayload;
        const usdSourceBlobUrls = Object.fromEntries(
          renamedUsdSourceFiles.map((file) => [file.name, URL.createObjectURL(file.blob)]),
        );
        createdBlobUrls.push(...Object.values(usdSourceBlobUrls));

        const renamedRobotFilesWithSources = renamedRobotFiles.map((file) =>
          file.format === 'usd' && usdSourceBlobUrls[file.name]
            ? { ...file, blobUrl: usdSourceBlobUrls[file.name] }
            : file,
        );
        const visibleImportedFiles = renamedRobotFilesWithSources.filter(isVisibleLibraryEntry);

        const newAssets = await createAssetUrls(renamedAssetFiles, {
          onProgress:
            shouldShowPreparationOverlay && renamedAssetFiles.length > 512
              ? ({ processedEntries, totalEntries }) => {
                  setImportPreparationOverlay({
                    label: t.importPreparationLoadingTitle,
                    detail: `${processedEntries} / ${totalEntries}`,
                    progress: totalEntries > 0 ? processedEntries / totalEntries : null,
                    statusLabel:
                      totalEntries > 0 ? `${processedEntries} / ${totalEntries}` : null,
                    stageLabel: t.importPreparationFinalizingImport,
                  });
                }
              : undefined,
          yieldToBrowser: shouldShowPreparationOverlay && renamedAssetFiles.length > 512,
        });
        createdBlobUrls.push(...Object.values(newAssets));
        throwIfStaleImport();

        let hydratedDeferredAssets: Record<string, string> = {};
        const shouldHydrateArchiveAssetsInBackground =
          isArchiveImport && renamedDeferredAssetFiles.length > 0;

        if (renamedDeferredAssetFiles.length > 0 && !shouldHydrateArchiveAssetsInBackground) {
          const archiveFilesByImportPath = new Map(
            inputFiles
              .filter((file) => isSupportedArchiveImportFile(file.name))
              .map((file) => [resolveImportSourceFilePath(file), file] as const),
          );
          const legacySourceArchiveFile =
            inputFiles.length === 1 && isSupportedArchiveImportFile(inputFiles[0]?.name ?? '')
              ? inputFiles[0]
              : null;
          const legacySourceArchiveImportPath = legacySourceArchiveFile
            ? resolveImportSourceFilePath(legacySourceArchiveFile)
            : null;
          const deferredAssetFilesByArchive = new Map<string, typeof renamedDeferredAssetFiles>();

          renamedDeferredAssetFiles.forEach((assetFile) => {
            const sourceArchiveImportPath = normalizeImportSourcePath(
              assetFile.sourceArchiveImportPath || legacySourceArchiveImportPath || '',
            );
            if (!sourceArchiveImportPath) {
              throw new Error(
                `Deferred import assets were prepared without a supported source archive for "${assetFile.name}".`,
              );
            }

            const groupedAssetFiles =
              deferredAssetFilesByArchive.get(sourceArchiveImportPath) ?? [];
            groupedAssetFiles.push(assetFile);
            deferredAssetFilesByArchive.set(sourceArchiveImportPath, groupedAssetFiles);
          });

          for (const [sourceArchiveImportPath, deferredAssetFiles] of deferredAssetFilesByArchive) {
            const sourceArchiveFile =
              archiveFilesByImportPath.get(sourceArchiveImportPath) ??
              (legacySourceArchiveImportPath === sourceArchiveImportPath
                ? legacySourceArchiveFile
                : null);

            if (!sourceArchiveFile) {
              throw new Error(
                `Deferred import assets were prepared without a supported source archive for "${preferredFileName ?? sourceArchiveImportPath}".`,
              );
            }

            const hydratedAssetFiles = await hydrateDeferredImportAssetsWithWorker({
              archiveFile: sourceArchiveFile,
              assetFiles: deferredAssetFiles,
              onProgress: shouldShowPreparationOverlay
                ? (progress) => {
                    setImportPreparationOverlay(
                      createImportPreparationOverlayStateFromProgress(t, progress),
                    );
                  }
                : undefined,
            });
            throwIfStaleImport();
            hydratedDeferredAssets = {
              ...hydratedDeferredAssets,
              ...(await createAssetUrls(hydratedAssetFiles, {
                onProgress:
                  shouldShowPreparationOverlay && hydratedAssetFiles.length > 512
                    ? ({ processedEntries, totalEntries }) => {
                        setImportPreparationOverlay({
                          label: t.importPreparationLoadingTitle,
                          detail: `${processedEntries} / ${totalEntries}`,
                          progress: totalEntries > 0 ? processedEntries / totalEntries : null,
                          statusLabel:
                            totalEntries > 0 ? `${processedEntries} / ${totalEntries}` : null,
                          stageLabel: t.importPreparationFinalizingImport,
                        });
                      }
                    : undefined,
                yieldToBrowser: shouldShowPreparationOverlay && hydratedAssetFiles.length > 512,
              })),
            };
            throwIfStaleImport();
          }
          createdBlobUrls.push(...Object.values(hydratedDeferredAssets));
        }

        const sourceAssets = {
          ...newAssets,
          ...hydratedDeferredAssets,
          ...usdSourceBlobUrls,
        };
        const deferredAssetResolutionAssets = Object.fromEntries(
          renamedDeferredAssetFiles.map((file) => [file.name, file.name]),
        );

        const createLiveImportMergeState = () => {
          const liveAssetsState = useAssetsStore.getState();
          const existingNames = new Set(liveAssetsState.availableFiles.map((file) => file.name));
          const uniqueNewFiles = renamedRobotFilesWithSources.filter(
            (file) => !existingNames.has(file.name),
          );
          const mergedAssets = {
            ...liveAssetsState.assets,
            ...sourceAssets,
          };
          const mergedFiles = [...liveAssetsState.availableFiles, ...uniqueNewFiles];
          const mergedAllFileContents = {
            ...liveAssetsState.allFileContents,
            ...Object.fromEntries(renamedTextFiles.map((file) => [file.path, file.content])),
          };

          return {
            assetsState: liveAssetsState,
            hadExistingAvailableFiles: liveAssetsState.availableFiles.length > 0,
            hadSelectedFile: Boolean(liveAssetsState.selectedFile),
            mergedAllFileContents,
            mergedAssets,
            mergedFiles,
            mergedResolutionAssets: {
              ...mergedAssets,
              ...deferredAssetResolutionAssets,
            },
            uniqueNewFiles,
          };
        };

        let liveMerge = createLiveImportMergeState();

        const shouldPreResolveWithImportContext =
          renamedDeferredAssetFiles.length > 0 ||
          shouldBuildContextualPreResolvedImports({
            availableFiles: liveMerge.assetsState.availableFiles,
            assets: liveMerge.assetsState.assets,
            allFileContents: liveMerge.assetsState.allFileContents,
          });
        const contextualPreResolvedImports = shouldPreResolveWithImportContext
          ? await buildContextualPreResolvedImports(
              renamedRobotFilesWithSources,
              {
                availableFiles: liveMerge.mergedFiles,
                assets: liveMerge.mergedResolutionAssets,
                allFileContents: liveMerge.mergedAllFileContents,
              },
              {
                preferredFileName:
                  renamedDeferredAssetFiles.length > 0 ? preferredFileName : null,
              },
            )
          : [];
        throwIfStaleImport();
        liveMerge = createLiveImportMergeState();

        const nextMotorLibrary =
          renamedLibraryFiles.length > 0
            ? (() => {
                const currentMotorLibrary =
                  Object.keys(liveMerge.assetsState.motorLibrary).length > 0
                    ? liveMerge.assetsState.motorLibrary
                    : DEFAULT_MOTOR_LIBRARY;
                const mergeResult = mergeMotorLibraryEntries(
                  renamedLibraryFiles,
                  currentMotorLibrary,
                );
                if (mergeResult.parseFailures.length > 0) {
                  mergeResult.parseFailures.forEach((failedPath) => {
                    console.error('Failed to parse motor spec', failedPath);
                  });
                  throw new Error(
                    `Failed to import motor library entries: ${mergeResult.parseFailures.join(', ')}`,
                  );
                }
                return mergeResult.library;
              })()
            : null;

        const preResolvedImportKeys = new Set(
          preResolvedImports.map((entry) => `${entry.format}:${entry.fileName}`),
        );
        const resolvedImports = [
          ...preResolvedImports,
          ...contextualPreResolvedImports.filter(
            (entry) => !preResolvedImportKeys.has(`${entry.format}:${entry.fileName}`),
          ),
        ];
        primePreResolvedRobotImports(resolvedImports);

        if (
          liveMerge.uniqueNewFiles.length > 0 ||
          Object.keys(sourceAssets).length > 0 ||
          renamedTextFiles.length > 0
        ) {
          if (renamedRobotFilesWithSources.some((file) => file.format === 'usd')) {
            clearPreparedUsdStageOpenCache();
          }
          liveMerge.assetsState.addAssets(sourceAssets);
          liveMerge.assetsState.setAvailableFiles(liveMerge.mergedFiles);
          liveMerge.assetsState.setAllFileContents(liveMerge.mergedAllFileContents);
          importStateMutated = true;
        }

        if (nextMotorLibrary) {
          liveMerge.assetsState.setMotorLibrary(nextMotorLibrary);
          importStateMutated = true;
        }

        // Yield to the browser so the library panel renders with the new assets
        // before the potentially heavy canvas loading begins.
        if (importStateMutated) {
          await waitForAnimationFrame();
          throwIfStaleImport();
        }

        if (visibleImportedFiles.length > 0) {
          const preferredFile = pickPreparedPreferredFile(
            visibleImportedFiles,
            preferredFileName,
            preResolvedImports[0]?.fileName ?? null,
          );
          const fileForStandaloneImportWarnings = preferredFile;
          const fileForStandaloneImportOpen = preferredFile;
          const importedAssetPathsForWarning = collectStandaloneImportSupportAssetPaths(
            liveMerge.mergedResolutionAssets,
            liveMerge.mergedFiles,
          );

          const standaloneImportAssetWarning = buildStandaloneImportAssetWarning(
            fileForStandaloneImportWarnings,
            importedAssetPathsForWarning,
            {
              allFileContents: liveMerge.mergedAllFileContents,
              availableFiles: liveMerge.mergedFiles,
              sourcePath: fileForStandaloneImportWarnings?.name,
            },
          );
          const primitiveGeometryHint = buildStandalonePrimitiveGeometryHint(
            fileForStandaloneImportWarnings,
            importedAssetPathsForWarning,
            {
              allFileContents: liveMerge.mergedAllFileContents,
              sourcePath: fileForStandaloneImportWarnings?.name,
            },
          );

          if (fileForStandaloneImportOpen) {
            const canProceedDespiteStandaloneAssetWarning =
              canProceedWithStandaloneImportAssetWarning(fileForStandaloneImportOpen);

            if (standaloneImportAssetWarning) {
              const assetLabel =
                standaloneImportAssetWarning.missingAssetPaths.length > 3
                  ? `${standaloneImportAssetWarning.missingAssetPaths.slice(0, 3).join(', ')}, …`
                  : standaloneImportAssetWarning.missingAssetPaths.join(', ');
              const warningMessage = t.importPackageAssetBundleHint
                .replace('{packages}', assetLabel)
                .replace('{assets}', assetLabel);

              console.warn(`[urdf-studio] ${warningMessage}`);
            }

            if (!standaloneImportAssetWarning && primitiveGeometryHint) {
              const assetLabel =
                primitiveGeometryHint.siblingMeshAssetCount >
                primitiveGeometryHint.siblingMeshAssetPaths.length
                  ? `${primitiveGeometryHint.siblingMeshAssetPaths.join(', ')}, …`
                  : primitiveGeometryHint.siblingMeshAssetPaths.join(', ');
              const warningMessage = t.importPrimitiveGeometryHint.replace('{assets}', assetLabel);

              console.warn(`[urdf-studio] ${warningMessage}`);
            }

            if (!standaloneImportAssetWarning || canProceedDespiteStandaloneAssetWarning) {
              if (!liveMerge.hadExistingAvailableFiles) {
                throwIfStaleImport();
                prewarmUsdSelectionInBackground(
                  fileForStandaloneImportOpen,
                  liveMerge.mergedFiles,
                  liveMerge.mergedAssets,
                );
                throwIfStaleImport();
                if (onLoadRobot) {
                  await onLoadRobot(fileForStandaloneImportOpen);
                  throwIfStaleImport();
                } else {
                  await loadRobot(
                    fileForStandaloneImportOpen,
                    liveMerge.mergedFiles,
                    liveMerge.mergedResolutionAssets,
                    liveMerge.mergedAllFileContents,
                  );
                  throwIfStaleImport();
                }
              } else if (!liveMerge.hadSelectedFile) {
                throwIfStaleImport();
                prewarmUsdSelectionInBackground(
                  fileForStandaloneImportOpen,
                  liveMerge.mergedFiles,
                  liveMerge.mergedAssets,
                );
                throwIfStaleImport();
                if (onLoadRobot) {
                  await onLoadRobot(fileForStandaloneImportOpen);
                  throwIfStaleImport();
                } else {
                  await loadRobot(
                    fileForStandaloneImportOpen,
                    liveMerge.mergedFiles,
                    liveMerge.mergedResolutionAssets,
                    liveMerge.mergedAllFileContents,
                  );
                  throwIfStaleImport();
                }
              }
            }
          }
        } else if (renamedLibraryFiles.length === 0) {
          throwIfStaleImport();
          const infoMessage = t.noSupportedImportFilesFound;
          logRegressionInfo('[useFileImport] Skipped import with no visible library files.', {
            importedFileNames: inputFiles.map((file) => file.name),
          });
          if (onShowToast) {
            onShowToast(infoMessage, 'info');
          }
        }

        if (shouldHydrateArchiveAssetsInBackground && inputFiles[0]) {
          hydrateDeferredArchiveAssetsInBackground(inputFiles[0], renamedDeferredAssetFiles, {
            expectedFileNames: renamedRobotFilesWithSources.map((file) => file.name),
            isCurrentImport,
            onShowToast,
          });
        }

        return {
          status:
            visibleImportedFiles.length > 0 || renamedLibraryFiles.length > 0
              ? 'completed'
              : 'skipped',
        };
      } catch (error) {
        if (error instanceof StaleImportRequestError) {
          if (!importStateMutated) {
            revokeBlobUrls(createdBlobUrls);
          }
          return { status: 'skipped' };
        }

        console.error('Import failed:', error);
        if (!importStateMutated) {
          revokeBlobUrls(createdBlobUrls);
        }
        const fallbackMessage = translations[useUIStore.getState().lang].importFailedCheckFiles;
        const errorMessage = error instanceof Error ? error.message.trim() : '';
        alert(errorMessage ? `${fallbackMessage}\n${errorMessage}` : fallbackMessage);
        return { status: 'failed' };
      } finally {
        clearImportPreparationOverlay();
      }
    },
    [
      loadRobot,
      onImportPreparationStateChange,
      onLoadRobot,
      onProjectImported,
      onShowToast,
      projectImporter,
      prepareImportPayload,
    ],
  );

  return {
    handleImport,
    loadRobot,
    detectFormat: detectImportFormat,
  };
}

export default useFileImport;
