import { useCallback, useRef } from 'react';
import { useAssetsStore } from '@/store';
import type { DocumentLoadState } from '@/store/assetsStore';
import { classifyLibraryFileKind } from '@/shared/utils/robotFileSupport';
import type { RobotData, RobotFile } from '@/types';
import {
  buildStandaloneImportAssetWarning,
  canProceedWithStandaloneImportAssetWarning,
  collectStandaloneImportSupportAssetPaths,
} from '../utils/importPackageAssetReferences';
import {
  mapRobotImportProgressToDocumentLoadPercent,
  resolveBootstrapDocumentLoadPhase,
  resolveRobotImportCompletedDocumentLoadPercent,
} from '../utils/documentLoadProgress';
import { resolveRobotFileDataWithWorker } from './robotImportWorkerBridge';

interface PreviewFeedbackLabels {
  failedToParseFormat: string;
  importPackageAssetBundleHint: string;
  usdPreviewRequiresOpen: string;
  xacroSourceOnlyPreviewHint: string;
}

interface UsePreviewFileWithFeedbackOptions {
  allFileContents: Record<string, string>;
  assemblyComponentFileNames?: ReadonlySet<string>;
  assets: Record<string, string>;
  availableFiles: RobotFile[];
  getUsdPreparedExportCache: (path: string) => { robotData?: RobotData } | null;
  handlePreviewFile: (file: RobotFile) => void;
  labels: PreviewFeedbackLabels;
  setDocumentLoadState: (state: DocumentLoadState) => void;
  showToast: (message: string, type?: 'info' | 'success') => void;
}

export function usePreviewFileWithFeedback({
  allFileContents,
  assemblyComponentFileNames,
  assets,
  availableFiles,
  getUsdPreparedExportCache,
  handlePreviewFile,
  labels,
  setDocumentLoadState,
  showToast,
}: UsePreviewFileWithFeedbackOptions) {
  const previewRequestIdRef = useRef(0);

  const handlePreviewFileWithFeedback = useCallback(
    (file: RobotFile) => {
      const requestId = ++previewRequestIdRef.current;
      if (classifyLibraryFileKind(file) === 'image') {
        setDocumentLoadState({
          status: 'ready',
          fileName: file.name,
          format: file.format,
          error: null,
          phase: null,
          message: null,
          progressMode: 'percent',
          progressPercent: 100,
          loadedCount: null,
          totalCount: null,
        });
        handlePreviewFile(file);
        return;
      }

      const isAlreadyAssemblyComponent =
        assemblyComponentFileNames && assemblyComponentFileNames.has(file.name);

      const importedAssetPaths = collectStandaloneImportSupportAssetPaths(assets, availableFiles);
      const standaloneImportAssetWarning = isAlreadyAssemblyComponent
        ? null
        : buildStandaloneImportAssetWarning(file, importedAssetPaths, {
            allFileContents,
            availableFiles,
            sourcePath: file.name,
          });
      if (standaloneImportAssetWarning) {
        const assetLabel =
          standaloneImportAssetWarning.missingAssetPaths.length > 3
            ? `${standaloneImportAssetWarning.missingAssetPaths.slice(0, 3).join(', ')}, ...`
            : standaloneImportAssetWarning.missingAssetPaths.join(', ');
        const warningMessage = labels.importPackageAssetBundleHint
          .replace('{packages}', assetLabel)
          .replace('{assets}', assetLabel);

        showToast(warningMessage, 'info');
        if (!canProceedWithStandaloneImportAssetWarning(file)) {
          setDocumentLoadState({
            status: 'error',
            fileName: file.name,
            format: file.format,
            error: warningMessage,
            phase: null,
            message: null,
            progressPercent: null,
            loadedCount: null,
            totalCount: null,
          });
          return;
        }
      }

      setDocumentLoadState({
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
      });
      handlePreviewFile(file);

      void resolveRobotFileDataWithWorker(
        file,
        {
          availableFiles,
          assets,
          allFileContents,
          usdRobotData: getUsdPreparedExportCache(file.name)?.robotData ?? null,
        },
        {
          onProgress: (progress) => {
            if (requestId !== previewRequestIdRef.current) {
              return;
            }

            const currentDocumentLoadState = useAssetsStore.getState().documentLoadState;
            const isIndeterminateProgress = progress.progressMode === 'indeterminate';
            const isCurrentFileLoading =
              currentDocumentLoadState.fileName === file.name &&
              (currentDocumentLoadState.status === 'loading' ||
                currentDocumentLoadState.status === 'hydrating');
            let nextProgressPercent: number | null;
            if (isIndeterminateProgress) {
              nextProgressPercent = isCurrentFileLoading
                ? (currentDocumentLoadState.progressPercent ?? null)
                : null;
            } else {
              const mappedProgressPercent = mapRobotImportProgressToDocumentLoadPercent(
                file.format,
                progress,
              );
              nextProgressPercent = isCurrentFileLoading
                ? Math.max(currentDocumentLoadState.progressPercent ?? 0, mappedProgressPercent)
                : mappedProgressPercent;
            }

            setDocumentLoadState({
              status: 'loading',
              fileName: file.name,
              format: file.format,
              error: null,
              phase: resolveBootstrapDocumentLoadPhase(file.format),
              message: progress.message ?? null,
              progressMode: isIndeterminateProgress ? 'indeterminate' : 'percent',
              progressPercent: nextProgressPercent,
              loadedCount: null,
              totalCount: null,
            });
          },
        },
      )
        .then((previewResult) => {
          if (requestId !== previewRequestIdRef.current) {
            return;
          }

          if (previewResult.status === 'ready') {
            // Keep the overlay in 'loading' here; the viewer's mesh-streaming +
            // onLoad events are authoritative for declaring the document ready.
            // Marking 'ready' eagerly hides the overlay during WASM mesh parsing
            // and shouldIgnoreViewerLoadRegressionAfterReadySameFile then blocks
            // the viewer's streaming-meshes events from re-opening it.
            setDocumentLoadState({
              status: 'loading',
              fileName: file.name,
              format: file.format,
              error: null,
              phase: resolveBootstrapDocumentLoadPhase(file.format),
              message: null,
              progressMode: 'percent',
              progressPercent: resolveRobotImportCompletedDocumentLoadPercent(file.format),
              loadedCount: null,
              totalCount: null,
            });
            return;
          }

          if (previewResult.status === 'needs_hydration') {
            setDocumentLoadState({
              status: 'ready',
              fileName: file.name,
              format: file.format,
              error: null,
              phase: null,
              message: labels.usdPreviewRequiresOpen,
              progressMode: 'percent',
              progressPercent: 100,
              loadedCount: null,
              totalCount: null,
            });
            return;
          }

          if (previewResult.reason === 'source_only_fragment') {
            setDocumentLoadState({
              status: 'ready',
              fileName: file.name,
              format: file.format,
              error: null,
              phase: null,
              message: labels.xacroSourceOnlyPreviewHint,
              progressMode: 'percent',
              progressPercent: 100,
              loadedCount: null,
              totalCount: null,
            });
            return;
          }

          const errorMessage = labels.failedToParseFormat.replace(
            '{format}',
            file.format.toUpperCase(),
          );
          setDocumentLoadState({
            status: 'error',
            fileName: file.name,
            format: file.format,
            error: errorMessage,
          });
          showToast(errorMessage, 'info');
        })
        .catch((error) => {
          if (requestId !== previewRequestIdRef.current) {
            return;
          }

          console.error(
            `[usePreviewFileWithFeedback] Failed to resolve preview robot data for "${file.name}".`,
            error,
          );
          const errorMessage = labels.failedToParseFormat.replace(
            '{format}',
            file.format.toUpperCase(),
          );
          setDocumentLoadState({
            status: 'error',
            fileName: file.name,
            format: file.format,
            error: errorMessage,
          });
          showToast(errorMessage, 'info');
        });
    },
    [
      allFileContents,
      assemblyComponentFileNames,
      assets,
      availableFiles,
      getUsdPreparedExportCache,
      handlePreviewFile,
      labels.failedToParseFormat,
      labels.importPackageAssetBundleHint,
      labels.usdPreviewRequiresOpen,
      labels.xacroSourceOnlyPreviewHint,
      setDocumentLoadState,
      showToast,
    ],
  );

  return {
    handlePreviewFileWithFeedback,
  };
}
