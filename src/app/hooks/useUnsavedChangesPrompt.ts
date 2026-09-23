import { useCallback, useEffect, useState } from 'react';

import { registerUnsavedChangesBaselineMarker } from '@/app/utils/unsavedChangesBaseline';
import {
  isRegressionBeforeUnloadPromptSuppressed,
  subscribeRegressionBeforeUnloadPromptSuppression,
} from '@/shared/debug/regressionPromptSuppression';
import { createStableJsonSnapshot } from '@/shared/utils/robot/semanticSnapshot';
import { useWorkspaceStore } from '@/store/workspaceStore';
import type { AssemblyState } from '@/types';

function createWorkspaceSnapshotReader() {
  // Retain only the latest immutable workspace, not serialized copies of every
  // workspace still reachable through undo history.
  let cached: { workspace: AssemblyState; snapshot: string } | undefined;
  return (workspace: AssemblyState): string => {
    if (cached?.workspace !== workspace) {
      cached = { workspace, snapshot: createStableJsonSnapshot(workspace) };
    }
    return cached.snapshot;
  };
}

export function useUnsavedChangesPrompt() {
  const [getWorkspaceSnapshot] = useState(createWorkspaceSnapshotReader);
  const currentSnapshot = useWorkspaceStore((state) =>
    getWorkspaceSnapshot(state.workspace),
  );
  const [baseline, setBaseline] = useState(currentSnapshot);
  const [beforeUnloadPromptSuppressed, setBeforeUnloadPromptSuppressed] = useState(() =>
    isRegressionBeforeUnloadPromptSuppressed(),
  );

  const markCurrentStateSaved = useCallback(() => {
    setBaseline(getWorkspaceSnapshot(useWorkspaceStore.getState().workspace));
  }, [getWorkspaceSnapshot]);
  const hasUnsavedChanges = currentSnapshot !== baseline;

  useEffect(() => {
    registerUnsavedChangesBaselineMarker(markCurrentStateSaved);
    return () => registerUnsavedChangesBaselineMarker(null);
  }, [markCurrentStateSaved]);

  useEffect(() =>
    subscribeRegressionBeforeUnloadPromptSuppression(
      setBeforeUnloadPromptSuppressed,
    ), []);

  useEffect(() => {
    if (typeof window === 'undefined' || !hasUnsavedChanges || beforeUnloadPromptSuppressed) {
      return undefined;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [beforeUnloadPromptSuppressed, hasUnsavedChanges]);

  return { hasUnsavedChanges, markCurrentStateSaved };
}
