import type {
  PrepareImportProgress,
  PreparedDeferredImportAssetFile,
  PreparedImportBlobFile,
  PreparedImportPayload,
  PreResolvedImportEntry,
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
import { DEFAULT_MOTOR_LIBRARY } from '@/shared/data/motorLibrary';
import type { MotorLibrary } from '@/shared/data/motorLibrary';
import { mergeMotorLibraryEntries } from '@/shared/data/motorLibraryMerge';
import type { translations } from '@/shared/i18n';
import {
  isAssetLibraryOnlyFormat,
  isLibraryPreviewableFile,
  isVisibleLibraryEntry,
  isSupportedArchiveImportFile,
  isRobotImportCandidatePath,
} from '@/shared/utils/robotFileSupport';
import { normalizeLibraryPathKey } from '@/core/utils/pathKeys';
import { isRobotDefinitionPath } from '@/core/parsers/format_detection';
import type { RobotFile } from '@/types';
import { buildLiveImportMergeState } from './liveImportMergeState';
import {
  createImportPreparationOverlayStateFromProgress,
  createInitialImportPreparationOverlayState,
  type ImportPreparationOverlayState,
} from './importPreparationOverlay';
import type {
  ClassifiedImportInput,
  ExecutePreparedFileImportWorkflowPorts,
  HandleImportResult,
  ImportInputFiles,
  PreparedImportArtifacts,
  TranslationBundle,
  WorkflowContext,
} from './executePreparedFileImportWorkflowTypes';

interface ExecuteRobotImportTransactionParams {
  classifiedInput: ClassifiedImportInput;
  forceLoadRobot: boolean;
  isCurrentImport: () => boolean;
  onLoadRobot?: (file: RobotFile) => unknown | Promise<unknown>;
  onShowToast?: (message: string, type?: 'info' | 'success') => void;
  ports: ExecutePreparedFileImportWorkflowPorts;
  t: TranslationBundle;
  workflow: WorkflowContext;
}

interface ExecuteProjectImportParams {
  lang: keyof typeof translations;
  onProjectImported?: (selectedFile: RobotFile | null) => void;
  ports: ExecutePreparedFileImportWorkflowPorts;
  projectInputFiles: readonly File[];
  workflow: WorkflowContext;
}

interface CreateImmediateAssetUrlsParams {
  assetFiles: PreparedImportBlobFile[];
  ports: ExecutePreparedFileImportWorkflowPorts;
  shouldShowPreparationOverlay: boolean;
  t: TranslationBundle;
  workflow: WorkflowContext;
}

interface HydrateImmediateDeferredAssetsParams {
  classifiedInput: ClassifiedImportInput;
  deferredAssetFiles: readonly PreparedDeferredImportAssetFile[];
  ports: ExecutePreparedFileImportWorkflowPorts;
  preferredFileName: string | null;
  t: TranslationBundle;
  workflow: WorkflowContext;
}

interface MaterializePreparedImportArtifactsParams {
  classifiedInput: ClassifiedImportInput;
  ports: ExecutePreparedFileImportWorkflowPorts;
  preparedImportPayload: PreparedImportPayload;
  t: TranslationBundle;
  workflow: WorkflowContext;
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

function createFinalizingImportProgressOverlay(
  t: TranslationBundle,
  processedEntries: number,
  totalEntries: number,
): ImportPreparationOverlayState {
  return {
    label: t.importPreparationLoadingTitle,
    detail: `${processedEntries} / ${totalEntries}`,
    progress: totalEntries > 0 ? processedEntries / totalEntries : null,
    statusLabel: totalEntries > 0 ? `${processedEntries} / ${totalEntries}` : null,
    stageLabel: t.importPreparationFinalizingImport,
  };
}

export function classifyImportInput(files: ImportInputFiles): ClassifiedImportInput | null {
  if (!files || files.length === 0) {
    return null;
  }

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

  return {
    inputFiles,
    isArchiveImport,
    projectInputFiles,
    shouldShowPreparationOverlay:
      inputFiles.length > 1 ||
      inputFiles.some((file) => Boolean(file.webkitRelativePath)) ||
      isArchiveImport ||
      importsRobotDefinition,
  };
}

export async function executeProjectImportIfPresent({
  lang,
  onProjectImported,
  ports,
  projectInputFiles,
  workflow,
}: ExecuteProjectImportParams): Promise<HandleImportResult | null> {
  if (projectInputFiles.length > 1) {
    throw new Error(
      'Import contains multiple project files. Import one .usp project at a time.',
    );
  }

  const projectInputFile = projectInputFiles[0] ?? null;
  if (!projectInputFile) {
    return null;
  }

  const result = await ports.importProject(projectInputFile, lang);
  workflow.trackBlobUrls(Object.values(result.assets.assetUrls));
  workflow.throwIfStale();

  const restoredSelectedFile = ports.commitImportedProject(result, {
    markWorkspaceBaselineSaved: ports.markWorkspaceBaselineSaved,
  });
  workflow.markStateMutated();
  ports.clearPreparedUsdStageOpenCache();
  onProjectImported?.(restoredSelectedFile);

  return { status: 'completed' };
}

async function prepareImportPayloadForInput(
  classifiedInput: ClassifiedImportInput,
  ports: ExecutePreparedFileImportWorkflowPorts,
  t: TranslationBundle,
  workflow: WorkflowContext,
): Promise<PreparedImportPayload> {
  if (classifiedInput.shouldShowPreparationOverlay) {
    workflow.setOverlay(createInitialImportPreparationOverlayState(t));
    await ports.waitForAnimationFrame();
    workflow.throwIfStale();
  }

  const assetsState = ports.getAssetsState();
  const existingImportPaths = [
    ...assetsState.availableFiles.map((file) => file.name),
    ...Object.keys(assetsState.assets),
    ...Object.keys(assetsState.allFileContents),
  ];
  const onProgress = classifiedInput.shouldShowPreparationOverlay
    ? (progress: PrepareImportProgress) => {
        workflow.setOverlay(createImportPreparationOverlayStateFromProgress(t, progress));
      }
    : undefined;

  const preparedImportPayload = await ports.prepareImportPayload({
    files: classifiedInput.inputFiles,
    existingPaths: existingImportPaths,
    preResolvePreferredImport: false,
    onProgress,
  });
  workflow.throwIfStale();
  return preparedImportPayload;
}

async function createImmediateAssetUrls({
  assetFiles,
  ports,
  shouldShowPreparationOverlay,
  t,
  workflow,
}: CreateImmediateAssetUrlsParams): Promise<Record<string, string>> {
  const assetUrls = await ports.createAssetUrls(assetFiles, {
    onProgress:
      shouldShowPreparationOverlay && assetFiles.length > 512
        ? ({ processedEntries, totalEntries }) => {
            workflow.setOverlay(
              createFinalizingImportProgressOverlay(t, processedEntries, totalEntries),
            );
          }
        : undefined,
    yieldToBrowser: shouldShowPreparationOverlay && assetFiles.length > 512,
  });
  workflow.trackBlobUrls(Object.values(assetUrls));
  workflow.throwIfStale();
  return assetUrls;
}

function groupDeferredAssetsByArchive(
  deferredAssetFiles: readonly PreparedDeferredImportAssetFile[],
  legacySourceArchiveImportPath: string | null,
): Map<string, PreparedDeferredImportAssetFile[]> {
  const deferredAssetFilesByArchive = new Map<string, PreparedDeferredImportAssetFile[]>();

  deferredAssetFiles.forEach((assetFile) => {
    const sourceArchiveImportPath = normalizeImportSourcePath(
      assetFile.sourceArchiveImportPath || legacySourceArchiveImportPath || '',
    );
    if (!sourceArchiveImportPath) {
      throw new Error(
        `Deferred import assets were prepared without a supported source archive for "${assetFile.name}".`,
      );
    }

    const groupedAssetFiles = deferredAssetFilesByArchive.get(sourceArchiveImportPath) ?? [];
    groupedAssetFiles.push(assetFile);
    deferredAssetFilesByArchive.set(sourceArchiveImportPath, groupedAssetFiles);
  });

  return deferredAssetFilesByArchive;
}

async function hydrateImmediateDeferredAssets({
  classifiedInput,
  deferredAssetFiles,
  ports,
  preferredFileName,
  t,
  workflow,
}: HydrateImmediateDeferredAssetsParams): Promise<Record<string, string>> {
  if (deferredAssetFiles.length === 0 || classifiedInput.isArchiveImport) {
    return {};
  }

  const archiveFilesByImportPath = new Map(
    classifiedInput.inputFiles
      .filter((file) => isSupportedArchiveImportFile(file.name))
      .map((file) => [resolveImportSourceFilePath(file), file] as const),
  );
  const legacySourceArchiveFile =
    classifiedInput.inputFiles.length === 1 &&
    isSupportedArchiveImportFile(classifiedInput.inputFiles[0]?.name ?? '')
      ? classifiedInput.inputFiles[0]
      : null;
  const legacySourceArchiveImportPath = legacySourceArchiveFile
    ? resolveImportSourceFilePath(legacySourceArchiveFile)
    : null;
  const deferredAssetFilesByArchive = groupDeferredAssetsByArchive(
    deferredAssetFiles,
    legacySourceArchiveImportPath,
  );
  let hydratedDeferredAssets: Record<string, string> = {};

  for (const [sourceArchiveImportPath, groupedAssetFiles] of deferredAssetFilesByArchive) {
    const sourceArchiveFile =
      archiveFilesByImportPath.get(sourceArchiveImportPath) ??
      (legacySourceArchiveImportPath === sourceArchiveImportPath ? legacySourceArchiveFile : null);

    if (!sourceArchiveFile) {
      throw new Error(
        `Deferred import assets were prepared without a supported source archive for "${preferredFileName ?? sourceArchiveImportPath}".`,
      );
    }

    const hydratedAssetFiles = await ports.hydrateDeferredImportAssets({
      archiveFile: sourceArchiveFile,
      assetFiles: groupedAssetFiles,
      onProgress: classifiedInput.shouldShowPreparationOverlay
        ? (progress) => {
            workflow.setOverlay(createImportPreparationOverlayStateFromProgress(t, progress));
          }
        : undefined,
    });
    workflow.throwIfStale();
    hydratedDeferredAssets = {
      ...hydratedDeferredAssets,
      ...(await createImmediateAssetUrls({
        assetFiles: hydratedAssetFiles,
        ports,
        shouldShowPreparationOverlay: classifiedInput.shouldShowPreparationOverlay,
        t,
        workflow,
      })),
    };
  }

  workflow.trackBlobUrls(Object.values(hydratedDeferredAssets));
  return hydratedDeferredAssets;
}

async function materializePreparedImportArtifacts({
  classifiedInput,
  ports,
  preparedImportPayload,
  t,
  workflow,
}: MaterializePreparedImportArtifactsParams): Promise<PreparedImportArtifacts> {
  const usdSourceBlobUrls = Object.fromEntries(
    preparedImportPayload.usdSourceFiles.map((file) => [
      file.name,
      ports.createObjectUrl(file.blob),
    ]),
  );
  workflow.trackBlobUrls(Object.values(usdSourceBlobUrls));

  const renamedRobotFilesWithSources = preparedImportPayload.robotFiles.map((file) =>
    file.format === 'usd' && usdSourceBlobUrls[file.name]
      ? { ...file, blobUrl: usdSourceBlobUrls[file.name] }
      : file,
  );
  const newAssets = await createImmediateAssetUrls({
    assetFiles: preparedImportPayload.assetFiles,
    ports,
    shouldShowPreparationOverlay: classifiedInput.shouldShowPreparationOverlay,
    t,
    workflow,
  });
  const hydratedDeferredAssets = await hydrateImmediateDeferredAssets({
    classifiedInput,
    deferredAssetFiles: preparedImportPayload.deferredAssetFiles,
    ports,
    preferredFileName: preparedImportPayload.preferredFileName,
    t,
    workflow,
  });
  const sourceAssets = {
    ...newAssets,
    ...hydratedDeferredAssets,
    ...usdSourceBlobUrls,
  };

  return {
    deferredAssetResolutionAssets: Object.fromEntries(
      preparedImportPayload.deferredAssetFiles.map((file) => [file.name, file.name]),
    ),
    hydratedDeferredAssets,
    newAssets,
    preparedImportPayload,
    renamedRobotFilesWithSources,
    shouldHydrateArchiveAssetsInBackground:
      classifiedInput.isArchiveImport && preparedImportPayload.deferredAssetFiles.length > 0,
    sourceAssets,
    usdSourceBlobUrls,
    visibleImportedFiles: renamedRobotFilesWithSources.filter(isVisibleLibraryEntry),
  };
}

function createLiveImportMergeStateForArtifacts(
  artifacts: PreparedImportArtifacts,
  ports: ExecutePreparedFileImportWorkflowPorts,
) {
  const liveAssetsState = ports.getAssetsState();
  return {
    assetsState: liveAssetsState,
    ...buildLiveImportMergeState({
      allFileContents: liveAssetsState.allFileContents,
      assets: liveAssetsState.assets,
      availableFiles: liveAssetsState.availableFiles,
      deferredAssetResolutionAssets: artifacts.deferredAssetResolutionAssets,
      importedFiles: artifacts.renamedRobotFilesWithSources,
      importedTextFiles: artifacts.preparedImportPayload.textFiles,
      selectedFile: liveAssetsState.selectedFile,
      sourceAssets: artifacts.sourceAssets,
    }),
  };
}

type LiveImportMergeState = ReturnType<typeof createLiveImportMergeStateForArtifacts>;

async function buildResolvedImportsForArtifacts(
  artifacts: PreparedImportArtifacts,
  liveMerge: LiveImportMergeState,
): Promise<PreResolvedImportEntry[]> {
  const { deferredAssetFiles, preferredFileName, preResolvedImports } =
    artifacts.preparedImportPayload;
  const shouldPreResolveWithImportContext =
    deferredAssetFiles.length > 0 ||
    shouldBuildContextualPreResolvedImports({
      availableFiles: liveMerge.assetsState.availableFiles,
      assets: liveMerge.assetsState.assets,
      allFileContents: liveMerge.assetsState.allFileContents,
    });
  const contextualPreResolvedImports = shouldPreResolveWithImportContext
    ? await buildContextualPreResolvedImports(
        artifacts.renamedRobotFilesWithSources,
        {
          availableFiles: liveMerge.mergedFiles,
          assets: liveMerge.mergedResolutionAssets,
          allFileContents: liveMerge.mergedAllFileContents,
        },
        {
          preferredFileName: deferredAssetFiles.length > 0 ? preferredFileName : null,
        },
      )
    : [];
  const preResolvedImportKeys = new Set(
    preResolvedImports.map((entry) => `${entry.format}:${entry.fileName}`),
  );

  return [
    ...preResolvedImports,
    ...contextualPreResolvedImports.filter(
      (entry) => !preResolvedImportKeys.has(`${entry.format}:${entry.fileName}`),
    ),
  ];
}

function resolveNextMotorLibrary(
  artifacts: PreparedImportArtifacts,
  currentMotorLibrary: MotorLibrary,
): MotorLibrary | null {
  const { libraryFiles } = artifacts.preparedImportPayload;
  if (libraryFiles.length === 0) {
    return null;
  }

  const baseMotorLibrary =
    Object.keys(currentMotorLibrary).length > 0 ? currentMotorLibrary : DEFAULT_MOTOR_LIBRARY;
  const mergeResult = mergeMotorLibraryEntries(libraryFiles, baseMotorLibrary);
  if (mergeResult.parseFailures.length > 0) {
    mergeResult.parseFailures.forEach((failedPath) => {
      console.error('Failed to parse motor spec', failedPath);
    });
    throw new Error(
      `Failed to import motor library entries: ${mergeResult.parseFailures.join(', ')}`,
    );
  }
  return mergeResult.library;
}

function commitPreparedImportArtifacts({
  artifacts,
  liveMerge,
  nextMotorLibrary,
  ports,
  workflow,
}: {
  artifacts: PreparedImportArtifacts;
  liveMerge: LiveImportMergeState;
  nextMotorLibrary: MotorLibrary | null;
  ports: ExecutePreparedFileImportWorkflowPorts;
  workflow: WorkflowContext;
}): void {
  if (
    liveMerge.uniqueNewFiles.length > 0 ||
    Object.keys(artifacts.sourceAssets).length > 0 ||
    artifacts.preparedImportPayload.textFiles.length > 0
  ) {
    if (artifacts.renamedRobotFilesWithSources.some((file) => file.format === 'usd')) {
      ports.clearPreparedUsdStageOpenCache();
    }
    liveMerge.assetsState.addAssets(artifacts.sourceAssets);
    liveMerge.assetsState.setAvailableFiles(liveMerge.mergedFiles);
    liveMerge.assetsState.setAllFileContents(liveMerge.mergedAllFileContents);
    workflow.markStateMutated();
  }

  if (nextMotorLibrary) {
    liveMerge.assetsState.setMotorLibrary(nextMotorLibrary);
    workflow.markStateMutated();
  }
}

function reportStandaloneImportWarnings(
  preferredFile: RobotFile | null,
  liveMerge: LiveImportMergeState,
  t: TranslationBundle,
): { canProceed: boolean } {
  const importedAssetPathsForWarning = collectStandaloneImportSupportAssetPaths(
    liveMerge.mergedResolutionAssets,
    liveMerge.mergedFiles,
  );
  const standaloneImportAssetWarning = buildStandaloneImportAssetWarning(
    preferredFile,
    importedAssetPathsForWarning,
    {
      allFileContents: liveMerge.mergedAllFileContents,
      availableFiles: liveMerge.mergedFiles,
      sourcePath: preferredFile?.name,
    },
  );
  const primitiveGeometryHint = buildStandalonePrimitiveGeometryHint(
    preferredFile,
    importedAssetPathsForWarning,
    {
      allFileContents: liveMerge.mergedAllFileContents,
      sourcePath: preferredFile?.name,
    },
  );

  if (!preferredFile) {
    return { canProceed: false };
  }

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

  return {
    canProceed:
      !standaloneImportAssetWarning ||
      canProceedWithStandaloneImportAssetWarning(preferredFile),
  };
}

async function openRobotFileFromImport({
  artifacts,
  forceLoadRobot,
  liveMerge,
  onLoadRobot,
  ports,
  t,
  workflow,
}: {
  artifacts: PreparedImportArtifacts;
  forceLoadRobot: boolean;
  liveMerge: LiveImportMergeState;
  onLoadRobot?: (file: RobotFile) => unknown | Promise<unknown>;
  ports: ExecutePreparedFileImportWorkflowPorts;
  t: TranslationBundle;
  workflow: WorkflowContext;
}): Promise<void> {
  if (artifacts.visibleImportedFiles.length === 0) {
    return;
  }

  const preferredFile = pickPreparedPreferredFile(
    artifacts.visibleImportedFiles,
    artifacts.preparedImportPayload.preferredFileName,
    artifacts.preparedImportPayload.preResolvedImports[0]?.fileName ?? null,
  );
  const { canProceed } = reportStandaloneImportWarnings(preferredFile, liveMerge, t);
  if (!preferredFile || !canProceed) {
    return;
  }

  const shouldOpen =
    !liveMerge.hadExistingAvailableFiles || forceLoadRobot || !liveMerge.hadSelectedFile;
  if (!shouldOpen) {
    return;
  }

  workflow.throwIfStale();
  ports.prewarmUsdSelectionInBackground(
    preferredFile,
    liveMerge.mergedFiles,
    liveMerge.mergedAssets,
  );
  workflow.throwIfStale();
  if (onLoadRobot) {
    await onLoadRobot(preferredFile);
    workflow.throwIfStale();
    return;
  }

  await ports.loadRobot(
    preferredFile,
    liveMerge.mergedFiles,
    liveMerge.mergedResolutionAssets,
    liveMerge.mergedAllFileContents,
  );
  workflow.throwIfStale();
}

function reportSkippedImportIfNeeded({
  artifacts,
  classifiedInput,
  onShowToast,
  ports,
  t,
  workflow,
}: {
  artifacts: PreparedImportArtifacts;
  classifiedInput: ClassifiedImportInput;
  onShowToast?: (message: string, type?: 'info' | 'success') => void;
  ports: ExecutePreparedFileImportWorkflowPorts;
  t: TranslationBundle;
  workflow: WorkflowContext;
}): void {
  if (
    artifacts.visibleImportedFiles.length > 0 ||
    artifacts.preparedImportPayload.libraryFiles.length > 0
  ) {
    return;
  }

  workflow.throwIfStale();
  const infoMessage = t.noSupportedImportFilesFound;
  ports.logRegressionInfo('[useFileImport] Skipped import with no visible library files.', {
    importedFileNames: classifiedInput.inputFiles.map((file) => file.name),
  });
  onShowToast?.(infoMessage, 'info');
}

function scheduleBackgroundDeferredHydration({
  artifacts,
  classifiedInput,
  isCurrentImport,
  onShowToast,
  ports,
}: {
  artifacts: PreparedImportArtifacts;
  classifiedInput: ClassifiedImportInput;
  isCurrentImport: () => boolean;
  onShowToast?: (message: string, type?: 'info' | 'success') => void;
  ports: ExecutePreparedFileImportWorkflowPorts;
}): void {
  if (!artifacts.shouldHydrateArchiveAssetsInBackground || !classifiedInput.inputFiles[0]) {
    return;
  }

  ports.hydrateDeferredArchiveAssetsInBackground(
    classifiedInput.inputFiles[0],
    artifacts.preparedImportPayload.deferredAssetFiles,
    {
      expectedFileNames: artifacts.renamedRobotFilesWithSources.map((file) => file.name),
      isCurrentImport,
      onShowToast,
    },
  );
}

export async function executeRobotFileImportTransaction({
  classifiedInput,
  forceLoadRobot,
  isCurrentImport,
  onLoadRobot,
  onShowToast,
  ports,
  t,
  workflow,
}: ExecuteRobotImportTransactionParams): Promise<HandleImportResult> {
  const preparedImportPayload = await prepareImportPayloadForInput(
    classifiedInput,
    ports,
    t,
    workflow,
  );
  const artifacts = await materializePreparedImportArtifacts({
    classifiedInput,
    ports,
    preparedImportPayload,
    t,
    workflow,
  });
  let liveMerge = createLiveImportMergeStateForArtifacts(artifacts, ports);
  const resolvedImports = await buildResolvedImportsForArtifacts(artifacts, liveMerge);
  workflow.throwIfStale();
  liveMerge = createLiveImportMergeStateForArtifacts(artifacts, ports);
  const nextMotorLibrary = resolveNextMotorLibrary(
    artifacts,
    liveMerge.assetsState.motorLibrary,
  );
  ports.primePreResolvedRobotImports(resolvedImports);
  commitPreparedImportArtifacts({
    artifacts,
    liveMerge,
    nextMotorLibrary,
    ports,
    workflow,
  });

  if (workflow.hasStateMutated()) {
    await ports.waitForAnimationFrame();
    workflow.throwIfStale();
  }

  await openRobotFileFromImport({
    artifacts,
    forceLoadRobot,
    liveMerge,
    onLoadRobot,
    ports,
    t,
    workflow,
  });
  reportSkippedImportIfNeeded({
    artifacts,
    classifiedInput,
    onShowToast,
    ports,
    t,
    workflow,
  });
  scheduleBackgroundDeferredHydration({
    artifacts,
    classifiedInput,
    isCurrentImport,
    onShowToast,
    ports,
  });

  return {
    status:
      artifacts.visibleImportedFiles.length > 0 ||
      artifacts.preparedImportPayload.libraryFiles.length > 0
        ? 'completed'
        : 'skipped',
  };
}
