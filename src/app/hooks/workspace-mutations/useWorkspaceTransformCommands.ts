import { useCallback } from 'react';

import { cloneAssemblyTransform } from '@/core/robot/assemblyTransformUtils';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { entityRefKey } from '@/types';
import type {
  AssemblyTransform,
  BridgeEntityRef,
  UrdfOrigin,
} from '@/types';
import type { UpdateCommitOptions } from '@/types/viewer';

import { areAssemblyTransformsEqual } from './assemblyTransforms';
import type { PropertyHistoryCommands } from './usePropertyHistoryCommands';

function originsEqual(left: UrdfOrigin, right: UrdfOrigin): boolean {
  return (
    left.xyz.x === right.xyz.x
    && left.xyz.y === right.xyz.y
    && left.xyz.z === right.xyz.z
    && left.rpy.r === right.rpy.r
    && left.rpy.p === right.rpy.p
    && left.rpy.y === right.rpy.y
    && (left.quatXyzw?.x ?? 0) === (right.quatXyzw?.x ?? 0)
    && (left.quatXyzw?.y ?? 0) === (right.quatXyzw?.y ?? 0)
    && (left.quatXyzw?.z ?? 0) === (right.quatXyzw?.z ?? 0)
    && (left.quatXyzw?.w ?? 1) === (right.quatXyzw?.w ?? 1)
  );
}

interface UseWorkspaceTransformCommandsParams {
  mutationOptions: PropertyHistoryCommands['mutationOptions'];
  runPropertyMutation: PropertyHistoryCommands['runPropertyMutation'];
}

/** Owns assembly placement writes; source-document patches are not involved. */
export function useWorkspaceTransformCommands({
  mutationOptions,
  runPropertyMutation,
}: UseWorkspaceTransformCommandsParams) {
  const handleAssemblyTransform = useCallback(
    (
      _ref: { type: 'assembly' },
      transform: AssemblyTransform,
      options: UpdateCommitOptions = {},
    ) => {
      const next = cloneAssemblyTransform(transform);
      if (areAssemblyTransformsEqual(useWorkspaceStore.getState().workspace.transform, next)) {
        return;
      }
      const key = options.historyKey ?? 'transform:assembly';
      const label = options.historyLabel ?? 'Transform assembly';
      runPropertyMutation(
        key,
        label,
        { ...options, commitMode: options.commitMode ?? 'immediate' },
        (operationId) => useWorkspaceStore.getState().updateAssemblyTransform(
          next,
          mutationOptions(operationId, label, Boolean(options.skipHistory)),
        ),
      );
    },
    [mutationOptions, runPropertyMutation],
  );

  const handleComponentTransform = useCallback(
    (
      ref: { type: 'component'; componentId: string },
      transform: AssemblyTransform,
      options: UpdateCommitOptions = {},
    ) => {
      const next = cloneAssemblyTransform(transform);
      const workspace = useWorkspaceStore.getState().workspace;
      if (Object.values(workspace.bridges).some(
        (bridge) => bridge.childComponentId === ref.componentId,
      )) {
        return;
      }
      const current = workspace.components[ref.componentId]?.transform;
      if (!current || areAssemblyTransformsEqual(current, next)) {
        return;
      }
      const key = options.historyKey ?? `transform:${entityRefKey(ref)}`;
      const label = options.historyLabel ?? 'Transform component';
      runPropertyMutation(
        key,
        label,
        { ...options, commitMode: options.commitMode ?? 'immediate' },
        (operationId) => useWorkspaceStore.getState().updateComponentTransform(
          ref.componentId,
          next,
          mutationOptions(operationId, label, Boolean(options.skipHistory)),
        ),
      );
    },
    [mutationOptions, runPropertyMutation],
  );

  const handleBridgeTransform = useCallback(
    (
      ref: BridgeEntityRef,
      origin: UrdfOrigin,
      options: UpdateCommitOptions = {},
    ) => {
      const bridge = useWorkspaceStore.getState().workspace.bridges[ref.bridgeId];
      if (!bridge || originsEqual(bridge.joint.origin, origin)) {
        return;
      }
      const key = options.historyKey ?? `property:${entityRefKey(ref)}`;
      const label = options.historyLabel ?? 'Update bridge';
      runPropertyMutation(
        key,
        label,
        { ...options, commitMode: options.commitMode ?? 'immediate' },
        (operationId) => useWorkspaceStore.getState().updateBridge(
          ref.bridgeId,
          { joint: { origin } },
          mutationOptions(operationId, label, Boolean(options.skipHistory)),
        ),
      );
    },
    [mutationOptions, runPropertyMutation],
  );

  return {
    handleAssemblyTransform,
    handleBridgeTransform,
    handleComponentTransform,
  };
}

export type WorkspaceTransformCommands = ReturnType<typeof useWorkspaceTransformCommands>;
