import type {
  ResolveRobotFileDataOptions,
  RobotImportProgress,
  RobotImportResult,
} from '@/core/parsers/importRobotFile';
import { resolveMJCFSource } from '@/core/parsers/mjcf/mjcfSourceResolver';
import { logRegressionInfo, logRegressionWarn } from '@/shared/debug/consoleDiagnostics';
import type { DocumentLoadState } from '@/store/assetsStore';
import type { AppMode, RobotData, RobotFile } from '@/types';

import type {
  CommitResolvedRobotLoadOutcome,
  WorkspaceLoadIntent,
} from '../utils/commitResolvedRobotLoad';
import {
  preserveDocumentLoadProgressForSameFile,
  shouldCommitResolvedRobotSelection,
  shouldReuseResolvedMjcfViewerRuntime,
} from '../utils/documentLoadFlow';
import {
  mapRobotImportProgressToDocumentLoadPercent,
  resolveBootstrapDocumentLoadPhase,
  resolveRobotImportCompletedDocumentLoadPercent,
} from '../utils/documentLoadProgress';
import {
  buildStandaloneImportAssetWarning,
  canProceedWithStandaloneImportAssetWarning,
  collectStandaloneImportSupportAssetPaths,
} from '../utils/importPackageAssetReferences';
import { resolveUsdViewerRoundtripSelection } from '../utils/usdViewerRoundtripSelection';

type CommittableRobotImportResult = Extract<
  RobotImportResult,
  { status: 'ready' | 'needs_hydration' }
>;

interface RobotLoadAssetsState {
  allFileContents: Record<string, string>;
  assets: Record<string, string>;
  availableFiles: RobotFile[];
  documentLoadState: DocumentLoadState;
  getUsdPreparedExportCache: (path: string) => { robotData?: RobotData | null } | null;
  selectedFile: RobotFile | null;
}

interface ResolvedRobotLoadCommitInput {
  currentAppMode: AppMode;
  file: RobotFile;
  importResult: CommittableRobotImportResult;
  intent?: WorkspaceLoadIntent;
  markWorkspaceBaselineSaved: () => void;
  onViewerReload: () => void;
  previousDocumentLoadState: DocumentLoadState;
  reloadViewer: boolean;
  setAppMode: (mode: AppMode) => void;
}

export interface RobotLoadWorkflowPorts {
  cancelPendingUsdLoad: (
    operationId: string,
    options: { restoreDocumentSession: boolean },
  ) => boolean;
  commitResolvedLoad: (
    input: ResolvedRobotLoadCommitInput,
  ) => CommitResolvedRobotLoadOutcome | null;
  getAssetsState: () => RobotLoadAssetsState;
  getCurrentAppMode: () => AppMode;
  getPendingUsdLoad: () => { operationId: string } | null;
  markWorkspaceBaselineSaved: () => void;
  onViewerReload: () => void;
  peekPreResolvedImport: (file: RobotFile) => RobotImportResult | null;
  prewarmUsdSelection: (
    file: RobotFile,
    availableFiles: RobotFile[],
    assets: Record<string, string>,
  ) => void;
  resolveRobotFileData: (
    file: RobotFile,
    options: ResolveRobotFileDataOptions,
    callbacks: { onProgress: (progress: RobotImportProgress) => void },
  ) => Promise<RobotImportResult>;
  setAppMode: (mode: AppMode) => void;
  setDocumentLoadState: (state: DocumentLoadState) => void;
  showToast: (message: string, type: 'info') => void;
  waitForNextPaint: () => Promise<void>;
}

export interface RobotLoadWorkflowLabels {
  failedToParseFormat: string;
  importPackageAssetBundleHint: string;
  xacroSourceOnlyPreviewHint: string;
}

export interface RobotLoadRequestEpoch {
  current: number;
}

interface RunRobotLoadWorkflowInput {
  labels: RobotLoadWorkflowLabels;
  options?: { forceReload?: boolean; intent?: WorkspaceLoadIntent };
  ports: RobotLoadWorkflowPorts;
  requestedFile: RobotFile;
  requestEpoch: RobotLoadRequestEpoch;
}

function createLoadingDocumentState(file: RobotFile): DocumentLoadState {
  return {
    status: 'loading',
    fileName: file.name,
    format: file.format,
    error: null,
    phase: resolveBootstrapDocumentLoadPhase(file.format),
    message: null,
    progressMode: 'percent',
    progressPercent: 0,
    loadedCount: null,
    totalCount: null,
  };
}

function applyResolvedRobotImport(
  file: RobotFile,
  importResult: RobotImportResult,
  labels: RobotLoadWorkflowLabels,
  ports: Pick<RobotLoadWorkflowPorts, 'setDocumentLoadState' | 'showToast'>,
): void {
  if (importResult.status === 'ready' || importResult.status === 'needs_hydration') {
    ports.setDocumentLoadState({
      status: importResult.status === 'needs_hydration' ? 'hydrating' : 'loading',
      fileName: file.name,
      format: file.format,
      error: null,
      phase:
        importResult.status === 'needs_hydration'
          ? 'checking-path'
          : file.format === 'usd'
            ? 'checking-path'
            : 'preparing-scene',
      message: null,
      progressMode: 'percent',
      progressPercent: resolveRobotImportCompletedDocumentLoadPercent(file.format),
      loadedCount: null,
      totalCount: null,
    });
    return;
  }

  if (importResult.reason === 'source_only_fragment') {
    ports.setDocumentLoadState({
      status: 'ready',
      fileName: file.name,
      format: file.format,
      error: null,
      phase: null,
      message: labels.xacroSourceOnlyPreviewHint,
      progressPercent: 100,
      loadedCount: null,
      totalCount: null,
    });
    logRegressionInfo(`[urdf-studio] ${labels.xacroSourceOnlyPreviewHint}`);
    return;
  }

  const message =
    importResult.message ??
    labels.failedToParseFormat.replace('{format}', file.format.toUpperCase());
  ports.setDocumentLoadState({
    status: 'error',
    fileName: file.name,
    format: file.format,
    error: message,
  });
  ports.showToast(message, 'info');
}

function finishResolvedRobotLoad({
  file,
  importResult,
  labels,
  options,
  ports,
  previousDocumentLoadState,
  reloadViewer,
}: {
  file: RobotFile;
  importResult: RobotImportResult;
  labels: RobotLoadWorkflowLabels;
  options?: RunRobotLoadWorkflowInput['options'];
  ports: RobotLoadWorkflowPorts;
  previousDocumentLoadState: DocumentLoadState;
  reloadViewer: boolean;
}): CommitResolvedRobotLoadOutcome | null {
  const outcome = shouldCommitResolvedRobotSelection(importResult)
    ? ports.commitResolvedLoad({
        currentAppMode: ports.getCurrentAppMode(),
        file,
        importResult,
        intent: options?.intent,
        markWorkspaceBaselineSaved: ports.markWorkspaceBaselineSaved,
        onViewerReload: ports.onViewerReload,
        previousDocumentLoadState,
        reloadViewer,
        setAppMode: ports.setAppMode,
      })
    : null;

  const currentDocumentLoadState = ports.getAssetsState().documentLoadState;
  applyResolvedRobotImport(file, importResult, labels, {
    setDocumentLoadState: (nextState) => {
      ports.setDocumentLoadState(
        preserveDocumentLoadProgressForSameFile({
          currentState: currentDocumentLoadState,
          nextState,
        }),
      );
    },
    showToast: ports.showToast,
  });

  if (!reloadViewer && importResult.status === 'ready' && file.format === 'mjcf') {
    ports.setDocumentLoadState({
      status: 'ready',
      fileName: file.name,
      format: file.format,
      error: null,
      phase: 'ready',
      message: null,
      progressMode: 'percent',
      progressPercent: 100,
      loadedCount: null,
      totalCount: null,
    });
  }
  return outcome;
}

function reportImportProgress({
  file,
  ports,
  progress,
  requestEpoch,
  requestId,
}: {
  file: RobotFile;
  ports: RobotLoadWorkflowPorts;
  progress: RobotImportProgress;
  requestEpoch: RobotLoadRequestEpoch;
  requestId: number;
}): void {
  if (requestId !== requestEpoch.current) {
    return;
  }

  const currentState = ports.getAssetsState().documentLoadState;
  const isIndeterminate = progress.progressMode === 'indeterminate';
  const isCurrentFileLoading =
    currentState.fileName === file.name &&
    (currentState.status === 'loading' || currentState.status === 'hydrating');
  const mappedPercent = isIndeterminate
    ? null
    : mapRobotImportProgressToDocumentLoadPercent(file.format, progress);
  const progressPercent = isIndeterminate
    ? isCurrentFileLoading
      ? (currentState.progressPercent ?? null)
      : null
    : isCurrentFileLoading
      ? Math.max(currentState.progressPercent ?? 0, mappedPercent ?? 0)
      : mappedPercent;

  ports.setDocumentLoadState({
    status: 'loading',
    fileName: file.name,
    format: file.format,
    error: null,
    phase: resolveBootstrapDocumentLoadPhase(file.format),
    message: progress.message ?? null,
    progressMode: isIndeterminate ? 'indeterminate' : 'percent',
    progressPercent,
    loadedCount: null,
    totalCount: null,
  });
}

export async function runRobotLoadWorkflow({
  labels,
  options,
  ports,
  requestedFile,
  requestEpoch,
}: RunRobotLoadWorkflowInput): Promise<CommitResolvedRobotLoadOutcome | null> {
  if ((options?.intent ?? 'replace') === 'replace') {
    const pendingUsdLoad = ports.getPendingUsdLoad();
    if (pendingUsdLoad) {
      ports.cancelPendingUsdLoad(pendingUsdLoad.operationId, {
        restoreDocumentSession: true,
      });
    }
  }

  const assetsState = ports.getAssetsState();
  const previousDocumentLoadState = structuredClone(assetsState.documentLoadState);
  const file = resolveUsdViewerRoundtripSelection(requestedFile, assetsState.availableFiles);
  const preResolvedImportResult = ports.peekPreResolvedImport(file);
  const standaloneImportAssetWarning =
    preResolvedImportResult?.status === 'ready'
      ? null
      : buildStandaloneImportAssetWarning(
          file,
          collectStandaloneImportSupportAssetPaths(assetsState.assets, assetsState.availableFiles),
          {
            allFileContents: assetsState.allFileContents,
            availableFiles: assetsState.availableFiles,
            sourcePath: file.name,
          },
        );
  if (standaloneImportAssetWarning) {
    const assetLabel =
      standaloneImportAssetWarning.missingAssetPaths.length > 3
        ? `${standaloneImportAssetWarning.missingAssetPaths.slice(0, 3).join(', ')}, …`
        : standaloneImportAssetWarning.missingAssetPaths.join(', ');
    const message = labels.importPackageAssetBundleHint
      .replace('{packages}', assetLabel)
      .replace('{assets}', assetLabel);
    logRegressionWarn(`[urdf-studio] ${message}`);
    if (!canProceedWithStandaloneImportAssetWarning(file)) {
      ports.setDocumentLoadState({
        status: 'error',
        fileName: file.name,
        format: file.format,
        error: message,
      });
      return null;
    }
  }

  const currentResolvedMjcfSource =
    assetsState.selectedFile?.format === 'mjcf'
      ? resolveMJCFSource(assetsState.selectedFile, assetsState.availableFiles)
      : null;
  const nextResolvedMjcfSource =
    file.format === 'mjcf' ? resolveMJCFSource(file, assetsState.availableFiles) : null;
  const reloadViewer = Boolean(
    options?.forceReload ||
    !shouldReuseResolvedMjcfViewerRuntime({
      currentSelectedFile: assetsState.selectedFile,
      nextFile: file,
      currentResolvedSource: currentResolvedMjcfSource
        ? {
            effectiveFileName: currentResolvedMjcfSource.effectiveFile.name,
            content: currentResolvedMjcfSource.content,
          }
        : null,
      nextResolvedSource: nextResolvedMjcfSource
        ? {
            effectiveFileName: nextResolvedMjcfSource.effectiveFile.name,
            content: nextResolvedMjcfSource.content,
          }
        : null,
    }),
  );

  ports.setDocumentLoadState(
    preserveDocumentLoadProgressForSameFile({
      currentState: assetsState.documentLoadState,
      nextState: createLoadingDocumentState(file),
    }),
  );
  const requestId = ++requestEpoch.current;
  ports.prewarmUsdSelection(file, assetsState.availableFiles, assetsState.assets);

  if (preResolvedImportResult) {
    await ports.waitForNextPaint();
    if (requestId !== requestEpoch.current) {
      return null;
    }
    return finishResolvedRobotLoad({
      file,
      importResult: preResolvedImportResult,
      labels,
      options,
      ports,
      previousDocumentLoadState,
      reloadViewer,
    });
  }

  const importResultPromise = ports.resolveRobotFileData(
    file,
    {
      availableFiles: assetsState.availableFiles,
      assets: assetsState.assets,
      allFileContents: assetsState.allFileContents,
      usdRobotData:
        file.format === 'usd'
          ? null
          : (assetsState.getUsdPreparedExportCache(file.name)?.robotData ?? null),
    },
    {
      onProgress: (progress) => {
        reportImportProgress({ file, ports, progress, requestEpoch, requestId });
      },
    },
  );

  await ports.waitForNextPaint();
  let importResult: RobotImportResult;
  try {
    importResult = await importResultPromise;
  } catch (error) {
    if (requestId !== requestEpoch.current) {
      return null;
    }
    const message =
      error instanceof Error
        ? error.message
        : labels.failedToParseFormat.replace('{format}', file.format.toUpperCase());
    ports.setDocumentLoadState({
      status: 'error',
      fileName: file.name,
      format: file.format,
      error: message,
    });
    ports.showToast(message, 'info');
    return null;
  }

  if (requestId !== requestEpoch.current) {
    return null;
  }
  return finishResolvedRobotLoad({
    file,
    importResult,
    labels,
    options,
    ports,
    previousDocumentLoadState,
    reloadViewer,
  });
}
