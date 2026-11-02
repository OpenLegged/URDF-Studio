import { useCallback } from 'react';
import { hasComponentEditorLocks } from '@/core/robot';
import { clearPreparedUsdStageOpenCache } from '@/features/editor/usd_prewarm';
import type { TranslationKeys } from '@/shared/i18n';
import { isLibraryRobotExportableFormat } from '@/shared/utils';
import {
  isSameOrNestedLibraryPath,
  normalizeLiteralLibraryPath,
  replaceLibraryPathPrefix,
  resolveRobotFolderRenameTarget,
  type LibraryMutationPlan,
  type RenameRobotFolderResult,
  useAssetsStore,
} from '@/store/assetsStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import type { AssemblyComponent, AssemblyState, RobotFile } from '@/types';
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

/**
 * Names of components the workspace store would refuse to mutate, mirroring
 * the editor-lock guards in `removeComponent` and `updateComponentSourceFile`
 * so library mutations report the conflict up front instead of throwing
 * mid-transaction.
 */
function findEditorLockedComponentNames(
  components: AssemblyState['components'],
  componentIds: readonly string[],
): string[] {
  return componentIds
    .map((componentId) => components[componentId])
    .filter(
      (component): component is AssemblyComponent =>
        Boolean(component && hasComponentEditorLocks(component)),
    )
    .map((component) => component.name);
}

function formatLockedComponentNames(names: readonly string[]): string {
  const preview = names.slice(0, 3).join(', ');
  return names.length > 3 ? `${preview} +${names.length - 3}` : preview;
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

  /**
   * Toast the edit-lock conflict for components a library mutation would touch
   * and return true when one blocks it. The replacer is a function so component
   * names containing `$` patterns are inserted literally.
   */
  const toastEditorLockedConflict = useCallback(
    (relatedComponentIds: readonly string[], message: string): boolean => {
      const lockedComponentNames = findEditorLockedComponentNames(
        assemblyState.components,
        relatedComponentIds,
      );
      if (lockedComponentNames.length === 0) return false;
      showToast(
        message.replace('{names}', () => formatLockedComponentNames(lockedComponentNames)),
        'info',
      );
      return true;
    },
    [assemblyState.components, showToast],
  );

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

  const handleDeleteLibraryFile = useCallback(
    (file: RobotFile) => {
      const plan = useAssetsStore.getState().createRemoveRobotFilePlan(file.name);
      if (!plan) return;

      const isCurrentModel = selectedFile?.name === file.name;
      const relatedComponentIds = Object.values(assemblyState.components)
        .filter((component) => component.sourceFile === file.name)
        .map((component) => component.id);
      if (toastEditorLockedConflict(relatedComponentIds, t.assetLibraryDeleteLockedConflict)) {
        return;
      }

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
      t,
      toastEditorLockedConflict,
    ],
  );

  const handleDeleteLibraryFolder = useCallback(
    (folderPath: string) => {
      const normalizedFolder = normalizeLiteralLibraryPath(folderPath);
      if (!normalizedFolder) return;
      const plan = useAssetsStore.getState().createRemoveRobotFolderPlan(normalizedFolder);
      if (!plan) return;

      const isCurrentModel =
        plan.previousState.selectedFile !== null && plan.nextState.selectedFile === null;
      const relatedComponentIds = Object.values(assemblyState.components)
        .filter(
          (component) =>
            component.sourceFile !== null &&
            isSameOrNestedLibraryPath(component.sourceFile, normalizedFolder),
        )
        .map((component) => component.id);
      if (toastEditorLockedConflict(relatedComponentIds, t.assetLibraryDeleteLockedConflict)) {
        return;
      }
      const removedFiles = plan.previousState.availableFiles.filter((file) =>
        isSameOrNestedLibraryPath(file.name, normalizedFolder),
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
      clearLoadedModel,
      commitLibraryMutation,
      removeComponentDrafts,
      removeWorkspaceComponents,
      t,
      toastEditorLockedConflict,
    ],
  );

  const handleRenameLibraryFolder = useCallback(
    (folderPath: string, nextName: string): RenameRobotFolderResult => {
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

      if (normalizedFolder !== expectedNextPath) {
        const relatedComponentIds = Object.values(assemblyState.components)
          .filter(
            (component) =>
              component.sourceFile !== null &&
              isSameOrNestedLibraryPath(component.sourceFile, normalizedFolder),
          )
          .map((component) => component.id);
        if (toastEditorLockedConflict(relatedComponentIds, t.assetLibraryRenameLockedConflict)) {
          return { ok: false, reason: 'locked' };
        }
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
              isSameOrNestedLibraryPath(component.sourceFile, normalizedFolder),
          );
          affectedComponents.forEach((component) => {
            const sourceFile = component.sourceFile!;
            const nextSourceFile = replaceLibraryPathPrefix(
              sourceFile, normalizedFolder, expectedNextPath,
            );
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
    [assemblyState, commitLibraryMutation, showToast, t, toastEditorLockedConflict],
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
    if (toastEditorLockedConflict(relatedComponentIds, t.assetLibraryDeleteLockedConflict)) {
      return;
    }


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
    t,
    toastEditorLockedConflict,
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
