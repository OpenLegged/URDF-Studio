import { useCallback, useRef, type MutableRefObject } from 'react';

import { useAssetsStore, useUIStore } from '@/store';
import type { RobotFile } from '@/types';

import {
  cancelPendingUsdWorkspaceLoad,
  commitResolvedRobotLoad,
  getPendingUsdWorkspaceLoad,
  type CommitResolvedRobotLoadOutcome,
  type WorkspaceLoadIntent,
} from '../utils/commitResolvedRobotLoad';
import { markUnsavedChangesBaselineSaved } from '../utils/unsavedChangesBaseline';
import { peekPreResolvedRobotImport } from '../utils/preResolvedRobotImportCache';
import { prewarmUsdSelectionInBackground } from '../utils/usdSelectionPrewarm';
import { waitForNextPaint } from '../utils/waitForNextPaint';
import { resolveRobotFileDataWithWorker } from './robotImportWorkerBridge';
import {
  runRobotLoadWorkflow,
  type RobotLoadWorkflowLabels,
  type RobotLoadRequestEpoch,
} from './robotLoadWorkflow';

export type LoadRobotFile = (
  file: RobotFile,
  options?: { forceReload?: boolean; intent?: WorkspaceLoadIntent },
) => Promise<CommitResolvedRobotLoadOutcome | null>;

interface UseRobotLoadWorkflowInput {
  labels: RobotLoadWorkflowLabels;
  onViewerReload: () => void;
  setAppMode: ReturnType<typeof useUIStore.getState>['setAppMode'];
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

interface UseRobotLoadWorkflowResult {
  loadRobotFile: LoadRobotFile;
  loadRobotFileRef: MutableRefObject<LoadRobotFile | null>;
}

/** Owns the request epoch and binds the robot-load workflow to app stores and workers. */
export function useRobotLoadWorkflow({
  labels,
  onViewerReload,
  setAppMode,
  showToast,
}: UseRobotLoadWorkflowInput): UseRobotLoadWorkflowResult {
  const setDocumentLoadState = useAssetsStore((state) => state.setDocumentLoadState);
  const requestEpochRef = useRef<RobotLoadRequestEpoch>({ current: 0 });
  const loadRobotFileRef = useRef<LoadRobotFile | null>(null);
  const { failedToParseFormat, importPackageAssetBundleHint, xacroSourceOnlyPreviewHint } = labels;
  const loadRobotFile = useCallback<LoadRobotFile>(
    (requestedFile, options) =>
      runRobotLoadWorkflow({
        labels: {
          failedToParseFormat,
          importPackageAssetBundleHint,
          xacroSourceOnlyPreviewHint,
        },
        options,
        ports: {
          cancelPendingUsdLoad: cancelPendingUsdWorkspaceLoad,
          commitResolvedLoad: commitResolvedRobotLoad,
          getAssetsState: useAssetsStore.getState,
          getCurrentAppMode: () => useUIStore.getState().appMode,
          getPendingUsdLoad: getPendingUsdWorkspaceLoad,
          markWorkspaceBaselineSaved: markUnsavedChangesBaselineSaved,
          onViewerReload,
          peekPreResolvedImport: peekPreResolvedRobotImport,
          prewarmUsdSelection: prewarmUsdSelectionInBackground,
          resolveRobotFileData: resolveRobotFileDataWithWorker,
          setAppMode,
          setDocumentLoadState,
          showToast: (message, type) => showToast(message, type),
          waitForNextPaint,
        },
        requestedFile,
        requestEpoch: requestEpochRef.current,
      }),
    [
      failedToParseFormat,
      importPackageAssetBundleHint,
      onViewerReload,
      setAppMode,
      setDocumentLoadState,
      showToast,
      xacroSourceOnlyPreviewHint,
    ],
  );

  loadRobotFileRef.current = loadRobotFile;
  return { loadRobotFile, loadRobotFileRef };
}
