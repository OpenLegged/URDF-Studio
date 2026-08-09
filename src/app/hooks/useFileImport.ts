/**
 * File Import Hook
 * Handles importing URDF, MJCF, USD, Xacro files and supported archive packages
 */
import { useCallback, useRef } from 'react';
import type { RobotFile } from '@/types';
import { useAssetsStore, useUIStore } from '@/store';
import type { ProjectImportResult } from '@/features/file-io';
import { translations } from '@/shared/i18n';
import { commitImportedProject } from '../utils/commitImportedProject';
import { commitResolvedRobotLoad } from '../utils/commitResolvedRobotLoad';
import {
  prepareImportPayloadWithWorker,
  hydrateDeferredImportAssetsWithWorker,
} from './importPreparationWorkerBridge';
import { resolveRobotFileDataWithWorker } from './robotImportWorkerBridge';
import { hydrateDeferredArchiveAssetsInBackground } from './deferred_import_hydration';
import { createAssetUrls } from './import_blob_urls';
import {
  detectImportFormat,
} from '@/app/utils/importPreparation';
import { primePreResolvedRobotImports } from '@/app/utils/preResolvedRobotImportCache';
import { prewarmUsdSelectionInBackground } from '@/app/utils/usdSelectionPrewarm';
import { markUnsavedChangesBaselineSaved } from '@/app/utils/unsavedChangesBaseline';
import { waitForAnimationFrame } from '@/app/utils/waitForAnimationFrame';
import { logRegressionInfo } from '@/shared/debug/consoleDiagnostics';
import { clearPreparedUsdStageOpenCache } from '@/features/editor/usd_prewarm';
import type { ImportPreparationOverlayState } from './file-import/importPreparationOverlay';
import {
  executePreparedFileImportWorkflow,
  type HandleImportResult,
  type ImportInputFiles,
} from './file-import/executePreparedFileImportWorkflow';

export type { ImportPreparationOverlayState } from './file-import/importPreparationOverlay';
export type { HandleImportResult, ImportInputFiles } from './file-import/executePreparedFileImportWorkflow';

interface UseFileImportOptions {
  onLoadRobot?: (file: RobotFile) => unknown | Promise<unknown>;
  onShowToast?: (message: string, type?: 'info' | 'success') => void;
  onImportPreparationStateChange?: (state: ImportPreparationOverlayState | null) => void;
  onProjectImported?: (selectedFile: RobotFile | null) => void;
  projectImporter?: (file: File, lang?: keyof typeof translations) => Promise<ProjectImportResult>;
  prepareImportPayload?: typeof prepareImportPayloadWithWorker;
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

      if (importResult.status === 'ready' || importResult.status === 'needs_hydration') {
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
    async (
      files: ImportInputFiles,
      options?: { forceLoadRobot?: boolean },
    ): Promise<HandleImportResult> => {
      const { forceLoadRobot = false } = options ?? {};
      if (!files || files.length === 0) {
        return { status: 'skipped' };
      }

      const importGeneration = ++importGenerationRef.current;
      const isCurrentImport = () => importGenerationRef.current === importGeneration;
      const uiState = useUIStore.getState();
      const t = translations[uiState.lang];

      const importProject =
        projectImporter ??
        (async (file: File, lang?: keyof typeof translations) => {
          const { importProjectWithWorker } = await import('@/features/file-io');
          return importProjectWithWorker(file, lang);
        });

      return executePreparedFileImportWorkflow({
        files,
        forceLoadRobot,
        isCurrentImport,
        lang: uiState.lang,
        onImportPreparationStateChange,
        onLoadRobot,
        onProjectImported,
        onShowToast,
        ports: {
          clearPreparedUsdStageOpenCache,
          commitImportedProject,
          createAssetUrls,
          createObjectUrl: (blob) => URL.createObjectURL(blob),
          getAssetsState: useAssetsStore.getState,
          hydrateDeferredArchiveAssetsInBackground,
          hydrateDeferredImportAssets: hydrateDeferredImportAssetsWithWorker,
          importProject,
          loadRobot,
          logRegressionInfo,
          markWorkspaceBaselineSaved: markUnsavedChangesBaselineSaved,
          prepareImportPayload,
          prewarmUsdSelectionInBackground,
          primePreResolvedRobotImports,
          waitForAnimationFrame,
        },
        t,
      });
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
