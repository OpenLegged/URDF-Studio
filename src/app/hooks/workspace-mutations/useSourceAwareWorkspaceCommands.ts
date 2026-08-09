import { useCallback } from 'react';

import {
  appendCollisionBody,
  createSourceSemanticRobotHash,
  getCollisionGeometryEntries,
  isComponentSourceDraftMatchingComponent,
  normalizeJointLimitOrder,
  resolveClosedLoopJointOriginCompensationDetailed,
} from '@/core/robot';
import { useAssetsStore } from '@/store/assetsStore';
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
  RobotMjcfInspectionTendonSummary,
  TendonEntityRef,
} from '@/types';
import type { UpdateCommitOptions } from '@/types/viewer';

import type {
  UseWorkspaceMutationsParams,
  WorkspacePropertyRef,
} from '../useWorkspaceMutationsTypes';
import {
  findAddedCollisionGeometryPatch,
  findRemovedCollisionGeometryObjectIndex,
  findUpdatedCollisionGeometryPatch,
} from './collisionGeometryDiff';
import {
  applyComponentEditorLockPatch,
  applyLinkEditorControlPatch,
} from './editor_lock_mutations';
import { hasLinkInertialChanged } from './linkInertialDiff';
import { applyLinkPatch } from './linkPatch';
import type { PropertyHistoryCommands } from './usePropertyHistoryCommands';
import type { WorkspaceTransformCommands } from './useWorkspaceTransformCommands';

function invalidateComponentDraftUnlessCurrent(componentId: string): void {
  const component = useWorkspaceStore.getState().workspace.components[componentId];
  const assets = useAssetsStore.getState();
  const draft = assets.componentSourceDrafts[componentId];
  if (!draft) return;
  if (!component || !isComponentSourceDraftMatchingComponent(draft, component)) {
    assets.removeComponentSourceDraft(componentId);
  }
}

interface UseSourceAwareWorkspaceCommandsParams {
  commitPendingHistory: PropertyHistoryCommands['commitPendingHistory'];
  focusOn: UseWorkspaceMutationsParams['focusOn'];
  handleAssemblyTransform: WorkspaceTransformCommands['handleAssemblyTransform'];
  handleComponentTransform: WorkspaceTransformCommands['handleComponentTransform'];
  mutationOptions: PropertyHistoryCommands['mutationOptions'];
  patchEditableSourceAddChild: UseWorkspaceMutationsParams['patchEditableSourceAddChild'];
  patchEditableSourceAddCollisionBody:
    UseWorkspaceMutationsParams['patchEditableSourceAddCollisionBody'];
  patchEditableSourceDeleteCollisionBody:
    UseWorkspaceMutationsParams['patchEditableSourceDeleteCollisionBody'];
  patchEditableSourceDeleteSubtree:
    UseWorkspaceMutationsParams['patchEditableSourceDeleteSubtree'];
  patchEditableSourceRenameEntities:
    UseWorkspaceMutationsParams['patchEditableSourceRenameEntities'];
  patchEditableSourceRobotName:
    UseWorkspaceMutationsParams['patchEditableSourceRobotName'];
  patchEditableSourceUpdateCollisionBody:
    UseWorkspaceMutationsParams['patchEditableSourceUpdateCollisionBody'];
  patchEditableSourceUpdateJointLimit:
    UseWorkspaceMutationsParams['patchEditableSourceUpdateJointLimit'];
  patchEditableSourceUpdateLinkInertial:
    UseWorkspaceMutationsParams['patchEditableSourceUpdateLinkInertial'];
  runPropertyMutation: PropertyHistoryCommands['runPropertyMutation'];
  setSelection: UseWorkspaceMutationsParams['setSelection'];
}

export function useSourceAwareWorkspaceCommands({
  commitPendingHistory,
  focusOn,
  handleAssemblyTransform,
  handleComponentTransform,
  mutationOptions,
  patchEditableSourceAddChild,
  patchEditableSourceAddCollisionBody,
  patchEditableSourceDeleteCollisionBody,
  patchEditableSourceDeleteSubtree,
  patchEditableSourceRenameEntities,
  patchEditableSourceRobotName,
  patchEditableSourceUpdateCollisionBody,
  patchEditableSourceUpdateJointLimit,
  patchEditableSourceUpdateLinkInertial,
  runPropertyMutation,
  setSelection,
}: UseSourceAwareWorkspaceCommandsParams) {
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
        patchEditableSourceRobotName?.({
          componentId: ref.componentId,
          expectedRobotSnapshotHash: createSourceSemanticRobotHash(component.robot),
          name,
        });
        invalidateComponentDraftUnlessCurrent(ref.componentId);
      }
    },
    [commitPendingHistory, patchEditableSourceRobotName],
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

      const nextLink = applyLinkPatch(currentLink, rawPatch);
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

      const sourceTarget = {
        componentId: ref.componentId,
        expectedRobotSnapshotHash: createSourceSemanticRobotHash(component.robot),
      };
      if (currentLink.name !== nextLink.name) {
        patchEditableSourceRenameEntities?.({
          ...sourceTarget,
          operations: [{
            kind: 'link',
            currentName: currentLink.name,
            nextName: nextLink.name,
          }],
        });
      }

      const addedCollision = findAddedCollisionGeometryPatch(currentLink, nextLink);
      const removedCollisionIndex = findRemovedCollisionGeometryObjectIndex(
        currentLink,
        nextLink,
      );
      const updatedCollision =
        addedCollision === null && removedCollisionIndex === null
          ? findUpdatedCollisionGeometryPatch(currentLink, nextLink)
          : null;
      if (addedCollision) {
        patchEditableSourceAddCollisionBody?.({
          ...sourceTarget,
          linkName: currentLink.name,
          geometry: addedCollision.geometry,
        });
      }
      if (removedCollisionIndex !== null) {
        patchEditableSourceDeleteCollisionBody?.({
          ...sourceTarget,
          linkName: currentLink.name,
          objectIndex: removedCollisionIndex,
        });
      }
      if (updatedCollision) {
        patchEditableSourceUpdateCollisionBody?.({
          ...sourceTarget,
          linkName: currentLink.name,
          objectIndex: updatedCollision.objectIndex,
          geometry: updatedCollision.geometry,
        });
      }
      if (
        nextLink.inertial
        && (
          Object.prototype.hasOwnProperty.call(rawPatch, 'inertial')
          || hasLinkInertialChanged(currentLink.inertial, nextLink.inertial)
        )
      ) {
        patchEditableSourceUpdateLinkInertial?.({
          ...sourceTarget,
          linkName: currentLink.name,
          inertial: nextLink.inertial,
        });
      }
      invalidateComponentDraftUnlessCurrent(ref.componentId);
    },
    [
      mutationOptions,
      patchEditableSourceAddCollisionBody,
      patchEditableSourceDeleteCollisionBody,
      patchEditableSourceRenameEntities,
      patchEditableSourceUpdateCollisionBody,
      patchEditableSourceUpdateLinkInertial,
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

      const sourceTarget = {
        componentId: ref.componentId,
        expectedRobotSnapshotHash: createSourceSemanticRobotHash(component.robot),
      };
      if (patch.limit && nextJoint.limit) {
        patchEditableSourceUpdateJointLimit?.({
          ...sourceTarget,
          jointName: currentJoint.name,
          jointType: nextJoint.type,
          limit: nextJoint.limit,
        });
      }
      if (typeof patch.name === 'string' && currentJoint.name !== patch.name) {
        patchEditableSourceRenameEntities?.({
          ...sourceTarget,
          operations: [{
            kind: 'joint',
            currentName: currentJoint.name,
            nextName: patch.name,
          }],
        });
      }
      invalidateComponentDraftUnlessCurrent(ref.componentId);
    },
    [
      mutationOptions,
      patchEditableSourceRenameEntities,
      patchEditableSourceUpdateJointLimit,
      runPropertyMutation,
    ],
  );

  const updateTendonProperty = useCallback(
    (
      ref: TendonEntityRef,
      data: RobotMjcfInspectionTendonSummary,
      options: UpdateCommitOptions,
    ) => {
      const key = options.historyKey ?? `property:${entityRefKey(ref)}`;
      const label = options.historyLabel ?? 'Update tendon';
      const changed = runPropertyMutation(key, label, options, (operationId) =>
        useWorkspaceStore.getState().updateTendon(
          ref,
          { rgba: data.rgba, width: data.width },
          mutationOptions(operationId, label, Boolean(options.skipHistory)),
        ),
      );
      if (changed) invalidateComponentDraftUnlessCurrent(ref.componentId);
    },
    [mutationOptions, runPropertyMutation],
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
      const nextComponent = useWorkspaceStore.getState().workspace.components[ref.componentId];
      const link = nextComponent?.robot.links[result.linkId];
      const joint = nextComponent?.robot.joints[result.jointId];
      if (link && joint) {
        patchEditableSourceAddChild?.({
          componentId: ref.componentId,
          expectedRobotSnapshotHash: createSourceSemanticRobotHash(component.robot),
          parentLinkName: parent.name,
          linkName: link.name,
          joint,
        });
      }
      invalidateComponentDraftUnlessCurrent(ref.componentId);
      const linkRef: LinkEntityRef = {
        type: 'link',
        componentId: ref.componentId,
        entityId: result.linkId,
      };
      setSelection({ entity: linkRef });
      focusOn(linkRef);
    },
    [commitPendingHistory, focusOn, patchEditableSourceAddChild, setSelection],
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
      const geometry = entries[objectIndex]?.geometry;
      if (geometry) {
        patchEditableSourceAddCollisionBody?.({
          componentId: ref.componentId,
          expectedRobotSnapshotHash: createSourceSemanticRobotHash(component.robot),
          linkName: link.name,
          geometry,
        });
      }
      invalidateComponentDraftUnlessCurrent(ref.componentId);
      setSelection({ entity: ref, subType: 'collision', objectIndex });
      focusOn(ref);
    },
    [
      commitPendingHistory,
      focusOn,
      patchEditableSourceAddCollisionBody,
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
      let deletedLink: {
        componentId: string;
        expectedRobotSnapshotHash: string;
        name: string;
      } | null = null;
      if (ref.type === 'component') {
        changed = store.removeComponent(ref.componentId, { label: 'Remove component' });
        if (changed) removedComponentId = ref.componentId;
      } else if (ref.type === 'bridge') {
        changed = store.removeBridge(ref.bridgeId, { label: 'Remove bridge' });
      } else if (ref.type === 'joint') {
        changed = store.deleteJoint(ref, { label: 'Delete joint' });
      } else {
        const component = store.workspace.components[ref.componentId];
        const link = component?.robot.links[ref.entityId];
        if (!component || !link) {
          return;
        }
        deletedLink = {
          componentId: ref.componentId,
          expectedRobotSnapshotHash: createSourceSemanticRobotHash(component.robot),
          name: link.name,
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
      if (deletedLink && !removedComponentId) {
        patchEditableSourceDeleteSubtree?.({
          componentId: deletedLink.componentId,
          expectedRobotSnapshotHash: deletedLink.expectedRobotSnapshotHash,
          linkName: deletedLink.name,
        });
      }
      if (removedComponentId) {
        useAssetsStore.getState().removeComponentSourceDraft(removedComponentId);
      } else if ('componentId' in ref) {
        invalidateComponentDraftUnlessCurrent(ref.componentId);
      }
      const nextState = useWorkspaceStore.getState();
      setSelection(repairWorkspaceSelection(
        nextState.workspace,
        selectionBefore,
        nextState.activeComponentId,
      ));
    },
    [commitPendingHistory, patchEditableSourceDeleteSubtree, setSelection],
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
