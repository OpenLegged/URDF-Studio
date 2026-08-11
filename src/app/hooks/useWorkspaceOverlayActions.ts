import { useCallback } from 'react';

import {
  preloadBridgeCreateModal,
  preloadCollisionOptimizationDialog,
} from '@/app/utils/overlayLoaders';
import type {
  CommitResolvedRobotLoadOutcome,
  WorkspaceLoadIntent,
} from '@/app/utils/commitResolvedRobotLoad';
import type { BridgeJoint, RobotFile } from '@/types';
import { logRegressionError } from '@/shared/debug/consoleDiagnostics';

function preloadWorkspaceOverlay(label: string, preload: () => Promise<unknown>): void {
  void preload().catch((error: unknown) => {
    logRegressionError(`[AppLayout] Failed to preload ${label}:`, error);
  });
}

interface UseWorkspaceOverlayActionsParams {
  onLoadRobot: (
    file: RobotFile,
    options?: { intent?: WorkspaceLoadIntent },
  ) => Promise<CommitResolvedRobotLoadOutcome | null> | CommitResolvedRobotLoadOutcome | null;
  showAssemblyComponentPreparationOverlay: (
    file: RobotFile,
    stage: 'prepare' | 'add' | 'ground',
  ) => void;
  clearAssemblyComponentPreparationOverlay: () => void;
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
  setBridgePreview: (value: BridgeJoint | null) => void;
  setShouldRenderBridgeModal: (value: boolean) => void;
  setIsBridgeModalOpen: (value: boolean) => void;
  addBridge: (params: {
    name: string;
    parentComponentId: string;
    parentLinkId: string;
    childComponentId: string;
    childLinkId: string;
    joint: Partial<import('@/types').UrdfJoint>;
  }) => unknown;
  setIsCollisionOptimizerOpen: (value: boolean) => void;
}

export function useWorkspaceOverlayActions({
  onLoadRobot,
  showAssemblyComponentPreparationOverlay,
  clearAssemblyComponentPreparationOverlay,
  showToast,
  setBridgePreview,
  setShouldRenderBridgeModal,
  setIsBridgeModalOpen,
  addBridge,
  setIsCollisionOptimizerOpen,
}: UseWorkspaceOverlayActionsParams) {
  const handleAddComponent = useCallback(
    (file: RobotFile) => {
      showAssemblyComponentPreparationOverlay(file, 'prepare');
      void Promise.resolve(onLoadRobot(file, { intent: 'append' }))
        .then((outcome) => {
          if (outcome?.status === 'hydration-pending') {
            return;
          }
          clearAssemblyComponentPreparationOverlay();
        })
        .catch((error: unknown) => {
          clearAssemblyComponentPreparationOverlay();
          const detail = error instanceof Error && error.message.trim()
            ? ` ${error.message.trim()}`
            : '';
          showToast(`Failed to add assembly component: ${file.name}.${detail}`, 'info');
        });
    },
    [
      clearAssemblyComponentPreparationOverlay,
      onLoadRobot,
      showAssemblyComponentPreparationOverlay,
      showToast,
    ],
  );

  const handlePrefetchBridgeCreateModal = useCallback(() => {
    preloadWorkspaceOverlay('bridge create modal', preloadBridgeCreateModal);
  }, []);

  const handleCreateBridge = useCallback(() => {
    setBridgePreview(null);
    setShouldRenderBridgeModal(true);
    handlePrefetchBridgeCreateModal();
    setIsBridgeModalOpen(true);
  }, [
    handlePrefetchBridgeCreateModal,
    setBridgePreview,
    setIsBridgeModalOpen,
    setShouldRenderBridgeModal,
  ]);

  const handleCloseBridgeModal = useCallback(() => {
    setBridgePreview(null);
    setIsBridgeModalOpen(false);
  }, [setBridgePreview, setIsBridgeModalOpen]);

  const handleBridgePreviewChange = useCallback(
    (nextPreview: BridgeJoint | null) => {
      setBridgePreview(nextPreview);
    },
    [setBridgePreview],
  );

  const handleCreateBridgeCommit = useCallback(
    (params: Parameters<typeof addBridge>[0]) => {
      setBridgePreview(null);
      return addBridge(params);
    },
    [addBridge, setBridgePreview],
  );

  const handlePrefetchCollisionOptimizer = useCallback(() => {
    preloadWorkspaceOverlay('collision optimization dialog', preloadCollisionOptimizationDialog);
  }, []);

  const handleOpenCollisionOptimizer = useCallback(() => {
    handlePrefetchCollisionOptimizer();
    setIsCollisionOptimizerOpen(true);
  }, [handlePrefetchCollisionOptimizer, setIsCollisionOptimizerOpen]);

  return {
    handleAddComponent,
    handleCreateBridge,
    handlePrefetchBridgeCreateModal,
    handleCloseBridgeModal,
    handleBridgePreviewChange,
    handleCreateBridgeCommit,
    handleOpenCollisionOptimizer,
    handlePrefetchCollisionOptimizer,
  };
}
