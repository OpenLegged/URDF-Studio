import { useCallback, type MutableRefObject } from 'react';

import { analyzeAssemblyConnectivity } from '@/core/robot';
import { useAssetsStore } from '@/store/assetsStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import type { RobotData, RobotFile } from '@/types';

import type { ProModeRoundtripSession } from '../appLayoutTypes';
import {
  createGeneratedWorkspaceUrdfFile,
  createWorkspaceGeneratedRobotSnapshot,
  isGeneratedWorkspaceUrdfFileName,
  resolveWorkspaceGeneratedUrdfRobotData,
  shouldPromptGenerateWorkspaceUrdfOnStructureSwitch,
} from './workspaceSourceSyncUtils';
import { buildGeneratedWorkspaceFileState } from './workspaceGeneratedSourceState';

interface UseWorkspaceModeTransitionsTranslations {
  generateWorkspaceUrdfDisconnected: string;
  generateWorkspaceUrdfUnavailable: string;
}

interface UseWorkspaceModeTransitionsParams {
  previewFile: RobotFile | null;
  selectedFile: RobotFile | null;
  availableFiles: RobotFile[];
  allFileContents: Record<string, string>;
  assets: Record<string, string>;
  getUsdPreparedExportCache: (
    fileName: string,
  ) => { robotData?: RobotData | null } | null | undefined;
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
  t: UseWorkspaceModeTransitionsTranslations;
  handleClosePreview: () => void;
  proModeRoundtripSessionRef: MutableRefObject<ProModeRoundtripSession | null>;
}

export function useWorkspaceModeTransitions({
  previewFile,
  selectedFile,
  showToast,
  t,
  handleClosePreview,
  proModeRoundtripSessionRef,
}: UseWorkspaceModeTransitionsParams) {
  const updateProModeRoundtripBaseline = useCallback(
    (generatedFileName: string | null) => {
      const workspace = useWorkspaceStore.getState().workspace;
      proModeRoundtripSessionRef.current = {
        baselineSnapshot: createWorkspaceGeneratedRobotSnapshot(workspace),
        generatedFileName,
      };
      return true;
    },
    [proModeRoundtripSessionRef],
  );

  const switchTreeEditorToStructure = useCallback(() => {
    handleClosePreview();
    proModeRoundtripSessionRef.current = null;
    return 'switched' as const;
  }, [handleClosePreview, proModeRoundtripSessionRef]);

  const generateWorkspaceUrdfFromProMode = useCallback(
    (options: { switchToStructure?: boolean } = {}) => {
      const workspace = useWorkspaceStore.getState().workspace;
      const connectivity = analyzeAssemblyConnectivity(workspace);
      if (connectivity.hasDisconnectedComponents) {
        showToast(t.generateWorkspaceUrdfDisconnected, 'info');
        return false;
      }

      const mergedRobotData = resolveWorkspaceGeneratedUrdfRobotData({
        assemblyState: workspace,
      });

      const assetsState = useAssetsStore.getState();
      const session = proModeRoundtripSessionRef.current;
      const { file, snapshot } = createGeneratedWorkspaceUrdfFile({
        assemblyName: workspace.name,
        mergedRobotData,
        availableFiles: assetsState.availableFiles,
        preferredFileName: session?.generatedFileName,
      });
      const generatedState = buildGeneratedWorkspaceFileState({
        availableFiles: assetsState.availableFiles,
        allFileContents: assetsState.allFileContents,
        file,
      });
      assetsState.setAvailableFiles(generatedState.nextAvailableFiles);
      assetsState.setAllFileContents(generatedState.nextAllFileContents);
      assetsState.setSelectedFile(generatedState.nextSelectedFile);
      assetsState.setDocumentLoadState({
        status: 'ready',
        fileName: file.name,
        format: 'urdf',
        error: null,
        phase: 'ready',
        progressMode: 'percent',
        progressPercent: 100,
      });
      handleClosePreview();

      proModeRoundtripSessionRef.current = options.switchToStructure
        ? null
        : { baselineSnapshot: snapshot, generatedFileName: file.name };
      return true;
    },
    [handleClosePreview, proModeRoundtripSessionRef, showToast, t],
  );

  const handleRequestSwitchTreeEditorToStructure = useCallback(
    (intent: 'direct' | 'generate' | 'skip-generate') => {
      if (intent === 'generate') {
        return generateWorkspaceUrdfFromProMode({ switchToStructure: true })
          ? 'switched'
          : 'blocked';
      }
      if (intent === 'skip-generate' || !proModeRoundtripSessionRef.current) {
        return switchTreeEditorToStructure();
      }

      const workspace = useWorkspaceStore.getState().workspace;
      return shouldPromptGenerateWorkspaceUrdfOnStructureSwitch({
        assemblyState: workspace,
        baselineSnapshot: proModeRoundtripSessionRef.current.baselineSnapshot,
      })
        ? 'needs-generate-confirm' as const
        : switchTreeEditorToStructure();
    },
    [generateWorkspaceUrdfFromProMode, proModeRoundtripSessionRef, switchTreeEditorToStructure],
  );

  const handleSwitchTreeEditorToProMode = useCallback(() => {
    const activeFile = previewFile ?? selectedFile;
    updateProModeRoundtripBaseline(
      isGeneratedWorkspaceUrdfFileName(activeFile?.name)
        ? activeFile?.name ?? null
        : null,
    );
  }, [previewFile, selectedFile, updateProModeRoundtripBaseline]);

  return {
    updateProModeRoundtripBaseline,
    handleRequestSwitchTreeEditorToStructure,
    handleSwitchTreeEditorToProMode,
  };
}
