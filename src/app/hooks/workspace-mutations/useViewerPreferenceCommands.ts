import { useCallback } from 'react';

import { useUIStore } from '@/store/uiStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import type { BridgeEntityRef, JointEntityRef } from '@/types';

import type { WorkspaceMutationHandlers } from '../useWorkspaceMutationsTypes';
import { persistWorkspaceViewerShowVisualPreference } from '../workspaceViewerDetailPreferences';
import { resolveViewerJointChangeContext } from './jointMotion';
import {
  commitComponentJointMotionReset,
  commitWorkspaceJointMotionReset,
  type WorkspaceJointMotionResetTarget,
} from './jointMotionReset';

interface UseViewerPreferenceCommandsParams {
  commitPendingHistory: (expectedKey?: string) => boolean;
}

/** Owns viewer preferences and transient joint-motion commits. */
export function useViewerPreferenceCommands({
  commitPendingHistory,
}: UseViewerPreferenceCommandsParams) {
  const handleSetShowVisual = useCallback(
    (visible: boolean) => {
      commitPendingHistory();
      persistWorkspaceViewerShowVisualPreference(visible);
      useWorkspaceStore.getState().setAllWorkspaceLinksVisibility(
        visible,
        { label: 'Toggle workspace link visibility' },
      );
    },
    [commitPendingHistory],
  );

  const handleJointChange = useCallback(
    (
      ref: JointEntityRef | BridgeEntityRef,
      angle: number,
      context?: Parameters<WorkspaceMutationHandlers['handleJointChange']>[2],
    ) => {
      const store = useWorkspaceStore.getState();
      if (ref.type === 'joint' && context) {
        const joints = store.workspace.components[ref.componentId]?.robot.joints;
        if (!joints?.[ref.entityId]) {
          return;
        }
        const contextMotion = resolveViewerJointChangeContext(
          joints,
          ref.entityId,
          angle,
          context,
        );
        if (contextMotion) {
          store.setComponentJointMotion(
            ref.componentId,
            contextMotion.angles,
            contextMotion.quaternions,
          );
          return;
        }
      }
      store.driveWorkspaceJoint(ref, angle, {
        ignoreLimits: useUIStore.getState().ignoreJointLimits,
      });
    },
    [],
  );

  const handleResetJointAngles = useCallback(
    (componentId: string, jointAngles: Record<string, number>) => {
      const store = useWorkspaceStore.getState();
      return commitComponentJointMotionReset({
        componentId,
        jointAngles,
        flushPendingHistory: commitPendingHistory,
        store,
        workspace: store.workspace,
      });
    },
    [commitPendingHistory],
  );

  const handleResetWorkspaceJointAngles = useCallback(
    (targets: readonly WorkspaceJointMotionResetTarget[]) => {
      const store = useWorkspaceStore.getState();
      return commitWorkspaceJointMotionReset({
        targets,
        flushPendingHistory: commitPendingHistory,
        store,
        workspace: store.workspace,
      });
    },
    [commitPendingHistory],
  );

  const flushJointMotion = useCallback(() => {
    commitPendingHistory();
    useWorkspaceStore
      .getState()
      .flushPendingJointMotion({ label: 'Update joint motion' });
  }, [commitPendingHistory]);

  return {
    flushJointMotion,
    handleJointChange,
    handleResetJointAngles,
    handleResetWorkspaceJointAngles,
    handleSetShowVisual,
  };
}
