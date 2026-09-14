import { useCallback } from 'react';

import {
  appendCollisionBody,
  getCollisionGeometryEntries,
  normalizeJointLimitOrder,
  resolveClosedLoopJointOriginCompensationDetailed,
} from '@/core/robot';
import {
  repairWorkspaceSelection,
  useSelectionStore,
} from '@/store/selectionStore';
import { applyWorkspaceJointPropertyPatch } from '@/store/workspace/propertyPatches';
import { useWorkspaceStore } from '@/store/workspaceStore';
import type {
  WorkspaceAssemblyPropertyPatch,
  WorkspaceBridgePatch,
  WorkspaceComponentPropertyPatch,
  WorkspaceJointPropertyPatch,
  WorkspaceLinkPropertyPatch,
  WorkspacePropertyPatch,
} from '@/store/workspaceStore';
import { entityRefKey } from '@/types';
import type {
  BridgeEntityRef,
  EntityRef,
  JointEntityRef,
  LinkEntityRef,
  RobotData,
  RobotMjcfInspectionTendonSummary,
  TendonEntityRef,
} from '@/types';
import type { UpdateCommitOptions } from '@/types/viewer';

import type {
  UseWorkspaceMutationsParams,
  WorkspacePropertyRef,
} from '../useWorkspaceMutationsTypes';
import {
  applyComponentEditorLockPatch,
  applyLinkEditorControlPatch,
} from './editor_lock_mutations';
import type { PropertyHistoryCommands } from './usePropertyHistoryCommands';
import type { WorkspaceTransformCommands } from './useWorkspaceTransformCommands';
import { synchronizeComponentSourceAfterMutation } from '../workspace-source-sync/component_source_commands';

interface UseSourceAwareWorkspaceCommandsParams {
  commitPendingHistory: PropertyHistoryCommands['commitPendingHistory'];
  focusOn: UseWorkspaceMutationsParams['focusOn'];
  handleAssemblyTransform: WorkspaceTransformCommands['handleAssemblyTransform'];
  handleComponentTransform: WorkspaceTransformCommands['handleComponentTransform'];
  mutationOptions: PropertyHistoryCommands['mutationOptions'];
  synchronizeComponentSource: UseWorkspaceMutationsParams['synchronizeComponentSource'];
  runPropertyMutation: PropertyHistoryCommands['runPropertyMutation'];
  setSelection: UseWorkspaceMutationsParams['setSelection'];
}

interface DeletedComponentSourceMutation {
  componentId: string;
  previousRobot: RobotData;
}

export function useSourceAwareWorkspaceCommands({
  commitPendingHistory,
  focusOn,
  handleAssemblyTransform,
  handleComponentTransform,
  mutationOptions,
  synchronizeComponentSource = synchronizeComponentSourceAfterMutation,
  runPropertyMutation,
  setSelection,
}: UseSourceAwareWorkspaceCommandsParams) {
  const synchronizeComponentRobot = useCallback((
    componentId: string,
    previousRobot: RobotData,
  ): void => {
    synchronizeComponentSource({ componentId, previousRobot });
  }, [synchronizeComponentSource]);

  const handleWorkspaceNameChange = useCallback(
    (name: string) => {
      commitPendingHistory();
      useWorkspaceStore.getState().renameWorkspace(name, { label: 'Rename workspace' });
    },
    [commitPendingHistory],
  );

  const handleComponentNameChange = useCallback(
    (ref: { type: 'component'; componentId: string }, name: string) => {
      commitPendingHistory();
      useWorkspaceStore
        .getState()
        .renameComponent(ref.componentId, name, { label: 'Rename component' });
    },
    [commitPendingHistory],
  );

  const handleRobotNameChange = useCallback(
    (ref: { type: 'component'; componentId: string }, name: string) => {
      commitPendingHistory();
      const store = useWorkspaceStore.getState();
      const component = store.workspace.components[ref.componentId];
      if (!component || component.robot.name === name) {
        return;
      }
      const changed = store.replaceComponentRobot(
        ref.componentId,
        { ...component.robot, name },
        { label: 'Rename source robot' },
      );
      if (changed) {
        synchronizeComponentRobot(ref.componentId, component.robot);
      }
    },
    [commitPendingHistory, synchronizeComponentRobot],
  );

  const updateLinkProperty = useCallback(
    (
      ref: LinkEntityRef,
      rawPatch: WorkspaceLinkPropertyPatch,
      options: UpdateCommitOptions = {},
    ) => {
      const store = useWorkspaceStore.getState();
      const component = store.workspace.components[ref.componentId];
      const currentLink = component?.robot.links[ref.entityId];
      if (!component || !currentLink) {
        return;
      }

      const key = options.historyKey ?? `property:${entityRefKey(ref)}`;
      const label = options.historyLabel ?? 'Update link';
      const changed = runPropertyMutation(key, label, options, (operationId) =>
        useWorkspaceStore.getState().updateLink(
          ref,
          rawPatch,
          mutationOptions(operationId, label, Boolean(options.skipHistory)),
        ),
      );
      if (!changed) {
        return;
      }

      synchronizeComponentRobot(ref.componentId, component.robot);
    },
    [
      mutationOptions,
      synchronizeComponentRobot,
      runPropertyMutation,
    ],
  );

  const updateJointProperty = useCallback(
    (
      ref: JointEntityRef,
      rawPatch: WorkspaceJointPropertyPatch,
      options: UpdateCommitOptions,
    ) => {
      const store = useWorkspaceStore.getState();
      const component = store.workspace.components[ref.componentId];
      const currentJoint = component?.robot.joints[ref.entityId];
      if (!component || !currentJoint) {
        return;
      }

      const patch = rawPatch.limit
        ? {
            ...rawPatch,
            limit: normalizeJointLimitOrder({
              ...(currentJoint.limit ?? rawPatch.limit),
              ...rawPatch.limit,
            }),
          }
        : rawPatch;
      const nextJoint = applyWorkspaceJointPropertyPatch(currentJoint, patch);
      const key = options.historyKey ?? `property:${entityRefKey(ref)}`;
      const label = options.historyLabel ?? 'Update joint';
      const compensation = patch.origin
        ? resolveClosedLoopJointOriginCompensationDetailed(
            component.robot,
            ref.entityId,
            nextJoint.origin,
          )
        : null;
      const changed = runPropertyMutation(key, label, options, (operationId) => {
        const actionOptions = mutationOptions(
          operationId,
          label,
          Boolean(options.skipHistory),
        );
        let didChange = useWorkspaceStore.getState().updateJoint(ref, patch, actionOptions);
        Object.entries(compensation?.origins ?? {}).forEach(([jointId, origin]) => {
          didChange = useWorkspaceStore.getState().updateJoint(
            { type: 'joint', componentId: ref.componentId, entityId: jointId },
            { origin },
            actionOptions,
          ) || didChange;
        });
        Object.entries(compensation?.quaternions ?? {}).forEach(
          ([jointId, quaternion]) => {
            didChange = useWorkspaceStore.getState().updateJoint(
              { type: 'joint', componentId: ref.componentId, entityId: jointId },
              { quaternion },
              actionOptions,
            ) || didChange;
          },
        );
        return didChange;
      });
      if (!changed) {
        return;
      }

      synchronizeComponentRobot(ref.componentId, component.robot);
    },
    [
      mutationOptions,
      synchronizeComponentRobot,
      runPropertyMutation,
    ],
  );

  const updateTendonProperty = useCallback(
    (
      ref: TendonEntityRef,
      data: RobotMjcfInspectionTendonSummary,
      options: UpdateCommitOptions,
    ) => {
      const previousRobot = useWorkspaceStore.getState().workspace.components[
        ref.componentId
      ]?.robot;
      if (!previousRobot) return;
      const key = options.historyKey ?? `property:${entityRefKey(ref)}`;
      const label = options.historyLabel ?? 'Update tendon';
      const changed = runPropertyMutation(key, label, options, (operationId) =>
        useWorkspaceStore.getState().updateTendon(
          ref,
          { rgba: data.rgba, width: data.width },
          mutationOptions(operationId, label, Boolean(options.skipHistory)),
        ),
      );
      if (changed) {
        synchronizeComponentRobot(ref.componentId, previousRobot);
      }
    },
    [mutationOptions, synchronizeComponentRobot, runPropertyMutation],
  );

  const updateBridgeProperty = useCallback(
    (
      ref: BridgeEntityRef,
      rawPatch: WorkspaceBridgePatch,
      options: UpdateCommitOptions,
    ) => {
      const bridge = useWorkspaceStore.getState().workspace.bridges[ref.bridgeId];
      if (!bridge) {
        return;
      }
      const jointPatch = rawPatch.joint;
      const patch = jointPatch?.limit
        ? {
            ...rawPatch,
            joint: {
              ...jointPatch,
              limit: normalizeJointLimitOrder({
                ...(bridge.joint.limit ?? jointPatch.limit),
                ...jointPatch.limit,
              }),
            },
          }
        : rawPatch;
      const key = options.historyKey ?? `property:${entityRefKey(ref)}`;
      const label = options.historyLabel ?? 'Update bridge';
      runPropertyMutation(key, label, options, (operationId) =>
        useWorkspaceStore.getState().updateBridge(
          ref.bridgeId,
          patch,
          mutationOptions(operationId, label, Boolean(options.skipHistory)),
        ),
      );
    },
    [mutationOptions, runPropertyMutation],
  );

  const handleSetComponentVisibility = useCallback(
    (ref: { type: 'component'; componentId: string }, visible: boolean) => {
      commitPendingHistory();
      useWorkspaceStore.getState().setComponentVisibility(
        ref.componentId,
        visible,
        { label: 'Set component visibility' },
      );
    },
    [commitPendingHistory],
  );

  const handleUpdate = useCallback(
    (
      ref: WorkspacePropertyRef,
      data: WorkspacePropertyPatch,
      options: UpdateCommitOptions = {},
    ) => {
      switch (ref.type) {
        case 'assembly': {
          const patch = data as WorkspaceAssemblyPropertyPatch;
          if (typeof patch.name === 'string') handleWorkspaceNameChange(patch.name);
          if (patch.transform) handleAssemblyTransform(ref, patch.transform, options);
          return;
        }
        case 'component': {
          const patch = data as WorkspaceComponentPropertyPatch;
          if (typeof patch.name === 'string') handleComponentNameChange(ref, patch.name);
          if (typeof patch.visible === 'boolean') {
            handleSetComponentVisibility(ref, patch.visible);
          }
          applyComponentEditorLockPatch({ ref, patch, commitPendingHistory });
          if (patch.transform) handleComponentTransform(ref, patch.transform, options);
          return;
        }
        case 'link': {
          const patch = data as WorkspaceLinkPropertyPatch;
          if (applyLinkEditorControlPatch({ ref, patch, commitPendingHistory })) return;
          updateLinkProperty(ref, patch, options);
          return;
        }
        case 'joint':
          updateJointProperty(ref, data as WorkspaceJointPropertyPatch, options);
          return;
        case 'tendon':
          updateTendonProperty(
            ref,
            data as RobotMjcfInspectionTendonSummary,
            options,
          );
          return;
        case 'bridge':
          updateBridgeProperty(ref, data as WorkspaceBridgePatch, options);
      }
    },
    [
      commitPendingHistory,
      handleAssemblyTransform,
      handleComponentNameChange,
      handleComponentTransform,
      handleSetComponentVisibility,
      handleWorkspaceNameChange,
      updateBridgeProperty,
      updateJointProperty,
      updateLinkProperty,
      updateTendonProperty,
    ],
  );

  const handleAddChild = useCallback(
    (ref: LinkEntityRef) => {
      commitPendingHistory();
      const store = useWorkspaceStore.getState();
      const component = store.workspace.components[ref.componentId];
      const parent = component?.robot.links[ref.entityId];
      if (!component || !parent) {
        return;
      }
      const result = store.addChild(
        { componentId: ref.componentId, parentLinkId: ref.entityId },
        { label: 'Add child link' },
      );
      if (!result) {
        return;
      }
      synchronizeComponentRobot(ref.componentId, component.robot);
      const linkRef: LinkEntityRef = {
        type: 'link',
        componentId: ref.componentId,
        entityId: result.linkId,
      };
      setSelection({ entity: linkRef });
      focusOn(linkRef);
    },
    [
      commitPendingHistory,
      focusOn,
      synchronizeComponentRobot,
      setSelection,
    ],
  );

  const handleAddCollisionBody = useCallback(
    (ref: LinkEntityRef) => {
      commitPendingHistory();
      const store = useWorkspaceStore.getState();
      const component = store.workspace.components[ref.componentId];
      const link = component?.robot.links[ref.entityId];
      if (!component || !link) {
        return;
      }
      const updatedLink = appendCollisionBody(link);
      if (!store.updateLink(ref, updatedLink, { label: 'Add collision body' })) {
        return;
      }
      const entries = getCollisionGeometryEntries(updatedLink);
      const objectIndex = Math.max(0, entries.length - 1);
      synchronizeComponentRobot(ref.componentId, component.robot);
      setSelection({ entity: ref, subType: 'collision', objectIndex });
      focusOn(ref);
    },
    [
      commitPendingHistory,
      focusOn,
      synchronizeComponentRobot,
      setSelection,
    ],
  );

  const handleDelete = useCallback(
    (ref: EntityRef) => {
      commitPendingHistory();
      const store = useWorkspaceStore.getState();
      const selectionBefore = useSelectionStore.getState().selection;
      if (ref.type === 'assembly' || ref.type === 'tendon') {
        return;
      }

      let changed = false;
      let removedComponentId: string | null = null;
      let sourceMutation: DeletedComponentSourceMutation | null = null;
      if (ref.type === 'component') {
        changed = store.removeComponent(ref.componentId, { label: 'Remove component' });
        if (changed) removedComponentId = ref.componentId;
      } else if (ref.type === 'bridge') {
        changed = store.removeBridge(ref.bridgeId, { label: 'Remove bridge' });
      } else if (ref.type === 'joint') {
        const component = store.workspace.components[ref.componentId];
        if (component) {
          sourceMutation = {
            componentId: ref.componentId,
            previousRobot: component.robot,
          };
        }
        changed = store.deleteJoint(ref, { label: 'Delete joint' });
      } else {
        const component = store.workspace.components[ref.componentId];
        const link = component?.robot.links[ref.entityId];
        if (!component || !link) {
          return;
        }
        sourceMutation = {
          componentId: ref.componentId,
          previousRobot: component.robot,
        };
        changed = ref.entityId === component.robot.rootLinkId
          ? store.removeComponent(ref.componentId, { label: 'Remove component' })
          : store.deleteSubtree(ref, { label: 'Delete subtree' });
        if (changed && ref.entityId === component.robot.rootLinkId) {
          removedComponentId = ref.componentId;
        }
      }
      if (!changed) {
        return;
      }
      if (removedComponentId) {
        synchronizeComponentSource({ componentId: removedComponentId });
      } else if (sourceMutation) {
        synchronizeComponentRobot(sourceMutation.componentId, sourceMutation.previousRobot);
      }
      const nextState = useWorkspaceStore.getState();
      setSelection(repairWorkspaceSelection(
        nextState.workspace,
        selectionBefore,
        nextState.activeComponentId,
      ));
    },
    [
      commitPendingHistory,
      synchronizeComponentRobot,
      synchronizeComponentSource,
      setSelection,
    ],
  );

  return {
    handleAddChild,
    handleAddCollisionBody,
    handleComponentNameChange,
    handleDelete,
    handleRobotNameChange,
    handleSetComponentVisibility,
    handleUpdate,
    handleWorkspaceNameChange,
    updateLinkProperty,
  };
}

export type SourceAwareWorkspaceCommands =
  ReturnType<typeof useSourceAwareWorkspaceCommands>;
