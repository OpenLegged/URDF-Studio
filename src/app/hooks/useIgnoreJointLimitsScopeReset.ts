import { useEffect } from 'react';

import { useUIStore } from '@/store/uiStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import type { AssemblyState } from '@/types';

/**
 * Identify "which model am I editing", so the override can be dropped when that
 * changes. Source file is part of the key because re-importing into the same
 * component id is still a different model to the user.
 */
export function resolveIgnoreJointLimitsScopeKey(
  workspace: AssemblyState,
  activeComponentId: string | null,
): string | null {
  if (!activeComponentId) {
    return null;
  }
  const component = workspace.components[activeComponentId];
  return component ? `${activeComponentId}:${component.sourceFile ?? component.robot.name}` : null;
}

/**
 * App-owned lifetime for the temporary joint-limit override.
 *
 * The override intentionally does not survive a model switch: it disables a
 * safety check, and a user who left it on for one robot almost never means it
 * for the next one.
 */
export function useIgnoreJointLimitsScopeReset(): void {
  useEffect(() => {
    let previousScopeKey = resolveIgnoreJointLimitsScopeKey(
      useWorkspaceStore.getState().workspace,
      useWorkspaceStore.getState().activeComponentId,
    );

    return useWorkspaceStore.subscribe((state) => {
      const nextScopeKey = resolveIgnoreJointLimitsScopeKey(
        state.workspace,
        state.activeComponentId,
      );
      if (nextScopeKey === previousScopeKey) {
        return;
      }

      previousScopeKey = nextScopeKey;
      if (useUIStore.getState().ignoreJointLimits) {
        useUIStore.getState().setIgnoreJointLimits(false);
      }
    });
  }, []);
}
