import { useCallback } from 'react';
import { clearPreparedUsdStageOpenCache } from '@/features/editor/usd_prewarm';
import type { TranslationKeys } from '@/shared/i18n';
import { isLibraryRobotExportableFormat } from '@/shared/utils';
import {
  resolveRobotFolderRenameTarget,
  type LibraryMutationPlan,
  useAssetsStore,
} from '@/store/assetsStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import type { AssemblyState, RobotFile } from '@/types';
import { beginCoordinatedWorkspaceTransaction } from '@/app/utils/pendingHistory';

interface UseLibraryFileActionsParams {
  availableFiles: RobotFile[];
  selectedFile: RobotFile | null;
  assemblyState: AssemblyState;
  clearSelection: () => void;
  uploadAsset: (file: File) => void;
  openLibraryExportDialog: (file: RobotFile) => void;
  showToast: (message: string, type?: 'info' | 'success') => void;
  t: TranslationKeys;
}

export function useLibraryFileActions({
  availableFiles,
  selectedFile,
  assemblyState,
  clearSelection,
  uploadAsset,
  openLibraryExportDialog,
  showToast,
  t,
}: UseLibraryFileActionsParams) {
  const handleUploadAsset = useCallback(
    (file: File) => {
      uploadAsset(file);
    },
    [uploadAsset],
  );

  const clearLoadedModel = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  const removeWorkspaceComponents = useCallback(
    (componentIds: readonly string[], operationId: string, label: string) => {
      componentIds.forEach((componentId) => {
        if (!useWorkspaceStore.getState().workspace.components[componentId]) return;
        const removed = useWorkspaceStore.getState().removeComponent(componentId, {
          operationId,
          label,
        });
        if (!removed) {
          throw new Error(`Failed to remove workspace component "${componentId}".`);
        }
      });
    },
    [],
  );

  const removeComponentDrafts = useCallback((componentIds: readonly string[]) => {
    const assets = useAssetsStore.getState();
    componentIds.forEach((componentId) => assets.removeComponentSourceDraft(componentId));
  }, []);

  const commitLibraryMutation = useCallback(
    (
      plan: LibraryMutationPlan,
      options: {
        label: string;
        commitFailureMessage: string;
        skipHistory?: boolean;
        mutateWorkspace: (operationId: string) => void;
      },
    ) => {
      const operationId = beginCoordinatedWorkspaceTransaction(options.label, {
        skipHistory: options.skipHistory,
      });
      let assetsApplied = false;

      try {
        options.mutateWorkspace(operationId);
        if (!useAssetsStore.getState().applyLibraryMutationPlan(plan, { revokeOrphans: false })) {
          throw new Error('Asset library changed before the workspace transaction committed.');
        }
        assetsApplied = true;
        if (!useWorkspaceStore.getState().commitWorkspaceTransaction(operationId)) {
          throw new Error(options.commitFailureMessage);
        }
      } catch (error) {
        useWorkspaceStore.getState().cancelWorkspaceTransaction(operationId);
        if (assetsApplied) {
          useAssetsStore.getState().restoreLibraryMutationState(plan.previousState);
        }
        throw error;
      }
    },
    [],
  );

  const isPathInFolder = useCallback((path: string, folderPath: string) => {
    const normalized = folderPath.replace(/\/+$/, '');
    return path === normalized || path.startsWith(`${normalized}/`);
  }, []);

  const handleDeleteLibraryFile = useCallback(
    (file: RobotFile) => {
      const plan = useAssetsStore.getState().createRemoveRobotFilePlan(file.name);
      if (!plan) return;

      const isCurrentModel = selectedFile?.name === file.name;
      const relatedComponentIds = Object.values(assemblyState.components)
        .filter((component) => component.sourceFile === file.name)
        .map((component) => component.id);

      commitLibraryMutation(plan, {
        label: 'Remove library components',
        commitFailureMessage: 'Failed to commit library file removal.',
        mutateWorkspace: (operationId) => {
          removeWorkspaceComponents(relatedComponentIds, operationId, 'Remove library components');
        },
      });
      removeComponentDrafts(relatedComponentIds);
      useAssetsStore.getState().revokeLibraryMutationPlanOrphans(plan);
      if (file.format === 'usd') {
        clearPreparedUsdStageOpenCache();
      }
      if (isCurrentModel) {
        clearLoadedModel();
      }

    },
    [
      assemblyState,
      clearLoadedModel,
      commitLibraryMutation,
      removeComponentDrafts,
      removeWorkspaceComponents,
      selectedFile?.name,
    ],
  );

  const handleDeleteLibraryFolder = useCallback(
    (folderPath: string) => {
      const normalizedFolder = folderPath.replace(/\/+$/, '');
      if (!normalizedFolder) return;
      const plan = useAssetsStore.getState().createRemoveRobotFolderPlan(normalizedFolder);
      if (!plan) return;

      const isCurrentModel = selectedFile?.name
        ? isPathInFolder(selectedFile.name, normalizedFolder)
        : false;
      const relatedComponentIds = Object.values(assemblyState.components)
        .filter(
          (component) =>
            component.sourceFile !== null && isPathInFolder(component.sourceFile, normalizedFolder),
        )
        .map((component) => component.id);
      const removedFiles = availableFiles.filter((file) =>
        isPathInFolder(file.name, normalizedFolder),
      );

      commitLibraryMutation(plan, {
        label: 'Remove library components',
        commitFailureMessage: 'Failed to commit library folder removal.',
        mutateWorkspace: (operationId) => {
          removeWorkspaceComponents(relatedComponentIds, operationId, 'Remove library components');
        },
      });
      removeComponentDrafts(relatedComponentIds);
      useAssetsStore.getState().revokeLibraryMutationPlanOrphans(plan);
      if (removedFiles.some((file) => file.format === 'usd')) {
        clearPreparedUsdStageOpenCache();
      }
      if (isCurrentModel) {
        clearLoadedModel();
      }

    },
    [
      assemblyState,
      availableFiles,
      clearLoadedModel,
      commitLibraryMutation,
      isPathInFolder,
      removeComponentDrafts,
      removeWorkspaceComponents,
      selectedFile?.name,
    ],
  );

  const handleRenameLibraryFolder = useCallback(
    (folderPath: string, nextName: string) => {
      const {
        normalizedFolder,
        sanitizedName,
        parentPath,
        nextFolderPath: expectedNextPath,
      } = resolveRobotFolderRenameTarget(folderPath, nextName);
      const { result, plan } = useAssetsStore
        .getState()
        .createRenameRobotFolderPlan(normalizedFolder, nextName);

      if (result.ok === false) {
        if (result.reason === 'conflict') {
          const targetPath = sanitizedName
            ? parentPath
              ? `${parentPath}/${sanitizedName}`
              : sanitizedName
            : normalizedFolder;
          showToast(t.assetLibraryRenameConflict.replace('{path}', targetPath), 'info');
          return result;
        }

        showToast(t.assetLibraryRenameInvalid, 'info');
        return result;
      }

      if (!plan) {
        return result;
      }

      if (result.nextPath !== expectedNextPath) {
        throw new Error(`Asset folder rename resolved to unexpected path "${result.nextPath}".`);
      }

      commitLibraryMutation(plan, {
        label: 'Rename library folder',
        commitFailureMessage: 'Failed to commit library folder rename.',
        skipHistory: true,
        mutateWorkspace: (operationId) => {
          if (normalizedFolder === expectedNextPath) return;
          const workspace = useWorkspaceStore.getState().workspace;
          const affectedComponents = Object.values(workspace.components).filter(
            (component) =>
              component.sourceFile !== null &&
              isPathInFolder(component.sourceFile, normalizedFolder),
          );
          affectedComponents.forEach((component) => {
            const sourceFile = component.sourceFile!;
            const nextSourceFile = `${expectedNextPath}${sourceFile.slice(normalizedFolder.length)}`;
            const changed = useWorkspaceStore
              .getState()
              .updateComponentSourceFile(component.id, nextSourceFile, {
                operationId,
                label: 'Rename library folder',
              });
            if (!changed) {
              throw new Error(
                `Failed to rename source path for workspace component "${component.id}".`,
              );
            }
          });
        },
      });
      useAssetsStore.getState().revokeLibraryMutationPlanOrphans(plan);

      return result;
    },
    [commitLibraryMutation, isPathInFolder, showToast, t],
  );

  const handleDeleteAllLibraryFiles = useCallback(() => {
    if (availableFiles.length === 0) return;
    const plan = useAssetsStore.getState().createClearRobotLibraryPlan();

    const availableFileNames = new Set(availableFiles.map((file) => file.name));
    const shouldClearCurrentModel = selectedFile?.name
      ? availableFileNames.has(selectedFile.name)
      : false;
    const relatedComponentIds = Object.values(assemblyState.components)
      .filter(
        (component) =>
          component.sourceFile !== null && availableFileNames.has(component.sourceFile),
      )
      .map((component) => component.id);

    commitLibraryMutation(plan, {
      label: 'Remove library components',
      commitFailureMessage: 'Failed to commit library clear.',
      mutateWorkspace: (operationId) => {
        removeWorkspaceComponents(relatedComponentIds, operationId, 'Remove library components');
      },
    });
    removeComponentDrafts(relatedComponentIds);
    useAssetsStore.getState().revokeLibraryMutationPlanOrphans(plan);

    if (shouldClearCurrentModel) {
      clearLoadedModel();
    }

    if (availableFiles.some((file) => file.format === 'usd')) {
      clearPreparedUsdStageOpenCache();
    }

  }, [
    assemblyState,
    availableFiles,
    clearLoadedModel,
    commitLibraryMutation,
    removeComponentDrafts,
    removeWorkspaceComponents,
    selectedFile?.name,
  ]);

  const handleExportLibraryFile = useCallback(
    (file: RobotFile) => {
      if (!isLibraryRobotExportableFormat(file.format)) {
        showToast(t.onlyUrdfMjcfExport, 'info');
        return;
      }

      openLibraryExportDialog(file);
    },
    [openLibraryExportDialog, showToast, t],
  );

  return {
    handleUploadAsset,
    handleDeleteLibraryFile,
    handleDeleteLibraryFolder,
    handleRenameLibraryFolder,
    handleDeleteAllLibraryFiles,
    handleExportLibraryFile,
  };
}
