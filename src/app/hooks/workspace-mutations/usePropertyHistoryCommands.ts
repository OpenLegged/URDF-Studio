import { useCallback } from 'react';

import type { UpdateCommitOptions } from '@/types/viewer';

import { usePendingHistoryCoordinator } from '../usePendingHistoryCoordinator';

export type TransactionMutation = (operationId: string) => boolean;

/** Owns property-edit transaction reuse and commit scheduling. */
export function usePropertyHistoryCommands() {
  const coordinator = usePendingHistoryCoordinator();
  const {
    cancelPendingHistory,
    commitPendingHistory,
    ensurePendingHistory,
    schedulePendingHistoryCommit,
  } = coordinator;

  const runPropertyMutation = useCallback(
    (
      key: string,
      label: string,
      options: UpdateCommitOptions,
      mutate: TransactionMutation,
    ): boolean => {
      if (options.skipHistory) {
        commitPendingHistory();
        return mutate('');
      }

      const operationId = ensurePendingHistory(key, label);
      if (!operationId) {
        return false;
      }

      let changed: boolean;
      try {
        changed = mutate(operationId);
      } catch (error) {
        cancelPendingHistory(key);
        throw error;
      }

      const commitMode = options.commitMode ?? 'debounced';
      if (commitMode === 'immediate') {
        commitPendingHistory(key);
      } else if (commitMode !== 'manual') {
        schedulePendingHistoryCommit(key, options.debounceMs);
      }
      return changed;
    },
    [
      cancelPendingHistory,
      commitPendingHistory,
      ensurePendingHistory,
      schedulePendingHistoryCommit,
    ],
  );

  const mutationOptions = useCallback(
    (operationId: string, label: string, skipHistory = false) =>
      operationId
        ? { operationId, label }
        : { skipHistory, label },
    [],
  );

  return {
    ...coordinator,
    mutationOptions,
    runPropertyMutation,
  };
}

export type PropertyHistoryCommands = ReturnType<typeof usePropertyHistoryCommands>;
