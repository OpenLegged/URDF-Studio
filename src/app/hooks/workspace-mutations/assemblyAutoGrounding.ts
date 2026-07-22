import { useCallback } from 'react';

import type { AssemblyComponentAutoGroundResolution } from '@/features/editor';
import { useWorkspaceStore } from '@/store/workspaceStore';
import type { ComponentEntityRef } from '@/types';
import type { UpdateCommitOptions } from '@/types/viewer';

const EMPTY_PENDING_COMPONENT_IDS: readonly string[] = [];

interface ApplyAssemblyAutoGroundResolutionOptions {
  consumePendingComponentIds: (componentIds: Iterable<string>) => void;
  onComponentTransform: (
    ref: ComponentEntityRef,
    transform: AssemblyComponentAutoGroundResolution['adjustments'][number]['transform'],
    options?: UpdateCommitOptions,
  ) => void;
  resolution: AssemblyComponentAutoGroundResolution;
}

/** Applies renderer measurements through the canonical app mutation boundary. */
export function applyAssemblyAutoGroundResolution({
  consumePendingComponentIds,
  onComponentTransform,
  resolution,
}: ApplyAssemblyAutoGroundResolutionOptions): void {
  resolution.adjustments.forEach(({ componentId, transform }) => {
    onComponentTransform({ type: 'component', componentId }, transform, {
      commitMode: 'immediate',
      historyLabel: 'Ground component',
      skipHistory: true,
    });
  });
  consumePendingComponentIds(resolution.measuredComponentIds);
}

interface UseAssemblyAutoGroundingCoordinatorOptions {
  enabled: boolean;
  onComponentTransform?: ApplyAssemblyAutoGroundResolutionOptions['onComponentTransform'];
}

/** Owns the workspace queue and mutation policy for renderer auto-ground facts. */
export function useAssemblyAutoGroundingCoordinator({
  enabled,
  onComponentTransform,
}: UseAssemblyAutoGroundingCoordinatorOptions) {
  const pendingComponentIds = useWorkspaceStore((state) =>
    enabled ? state.pendingAutoGroundComponentIds : EMPTY_PENDING_COMPONENT_IDS,
  );
  const consumePendingComponentIds = useWorkspaceStore(
    (state) => state.consumePendingAutoGroundComponentIds,
  );

  const handleResolution = useCallback(
    (resolution: AssemblyComponentAutoGroundResolution) => {
      if (!onComponentTransform) {
        return;
      }
      applyAssemblyAutoGroundResolution({
        consumePendingComponentIds,
        onComponentTransform,
        resolution,
      });
    },
    [consumePendingComponentIds, onComponentTransform],
  );

  return {
    onResolution: onComponentTransform ? handleResolution : undefined,
    pendingComponentIds: onComponentTransform ? pendingComponentIds : EMPTY_PENDING_COMPONENT_IDS,
  };
}
