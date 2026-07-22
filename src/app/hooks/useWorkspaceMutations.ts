import { useCallback } from 'react';

import {
  appendCollisionBody,
  createSourceSemanticRobotHash,
  getCollisionGeometryEntries,
  isComponentSourceDraftMatchingComponent,
  normalizeJointLimitOrder,
  resolveClosedLoopJointOriginCompensationDetailed,
} from '@/core/robot';
import { cloneAssemblyTransform } from '@/core/robot/assemblyTransformUtils';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { applyWorkspaceJointPropertyPatch } from '@/store/workspace/propertyPatches';
import type {
  WorkspaceAssemblyPropertyPatch,
  WorkspaceBridgePatch,
  WorkspaceComponentPropertyPatch,
  WorkspaceJointPropertyPatch,
  WorkspaceLinkPropertyPatch,
  WorkspacePropertyPatch,
} from '@/store/workspaceStore';
import { useAssetsStore } from '@/store/assetsStore';
import {
  repairWorkspaceSelection,
  useSelectionStore,
} from '@/store/selectionStore';
import { entityRefKey } from '@/types';
import type {
  AssemblyTransform,
  BridgeEntityRef,
  JointEntityRef,
  LinkEntityRef,
  RobotMjcfInspectionTendonSummary,
  TendonEntityRef,
  UrdfOrigin,
} from '@/types';
import type { UpdateCommitOptions } from '@/types/viewer';

import { usePendingHistoryCoordinator } from './usePendingHistoryCoordinator';
import type {
  UseWorkspaceMutationsParams,
  WorkspaceMutationHandlers,
  WorkspacePropertyRef,
} from './useWorkspaceMutationsTypes';
import { persistWorkspaceViewerShowVisualPreference } from './workspaceViewerDetailPreferences';
import { areAssemblyTransformsEqual } from './workspace-mutations/assemblyTransforms';
import {
  findAddedCollisionGeometryPatch,
  findRemovedCollisionGeometryObjectIndex,
  findUpdatedCollisionGeometryPatch,
} from './workspace-mutations/collisionGeometryDiff';
import { resolveViewerJointChangeContext } from './workspace-mutations/jointMotion';
import { hasLinkInertialChanged } from './workspace-mutations/linkInertialDiff';
import { applyLinkPatch } from './workspace-mutations/linkPatch';
import {
  applyComponentEditorLockPatch,
  applyLinkEditorControlPatch,
} from './workspace-mutations/editor_lock_mutations';
import { useCollisionTransformHandlers } from './workspace-mutations/useCollisionTransformHandlers';

type TransactionMutation = (operationId: string) => boolean;

function invalidateComponentDraftUnlessCurrent(componentId: string): void {
  const component = useWorkspaceStore.getState().workspace.components[componentId];
  const assets = useAssetsStore.getState();
  const draft = assets.componentSourceDrafts[componentId];
  if (!draft) return;
  if (!component || !isComponentSourceDraftMatchingComponent(draft, component)) {
    assets.removeComponentSourceDraft(componentId);
  }
}

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

export function useWorkspaceMutations({
  focusOn,
  setSelection,
  setPendingCollisionTransform,
  clearPendingCollisionTransform,
  handleTransformPendingChange,
  patchEditableSourceAddChild,
  patchEditableSourceDeleteSubtree,
  patchEditableSourceAddCollisionBody,
  patchEditableSourceDeleteCollisionBody,
  patchEditableSourceUpdateCollisionBody,
  patchEditableSourceUpdateJointLimit,
  patchEditableSourceUpdateLinkInertial,
  patchEditableSourceRobotName,
  patchEditableSourceRenameEntities,
}: UseWorkspaceMutationsParams): WorkspaceMutationHandlers {
  const {
    cancelPendingHistory,
    commitPendingHistory,
    ensurePendingHistory,
    schedulePendingHistoryCommit,
  } = usePendingHistoryCoordinator();

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

  const {
    handleCollisionTransformPreview,
    handleCollisionTransform,
    handleCollisionTransformPendingChange,
  } = useCollisionTransformHandlers({
    setPendingCollisionTransform,
    clearPendingCollisionTransform,
    handleTransformPendingChange,
    applyUpdate: updateLinkProperty,
  });

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
      // A bridged child is placed by its unique incoming bridge. Callers must
      // mutate that bridge explicitly; silently writing component.transform
      // would create history for state that placement and export do not use.
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
      updateBridgeProperty(
        ref,
        { joint: { origin } },
        { ...options, commitMode: options.commitMode ?? 'immediate' },
      );
    },
    [updateBridgeProperty],
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
    (ref: Parameters<WorkspaceMutationHandlers['handleDelete']>[0]) => {
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
      ref: JointEntityRef,
      angle: number,
      context?: Parameters<WorkspaceMutationHandlers['handleJointChange']>[2],
    ) => {
      const store = useWorkspaceStore.getState();
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
      store.setJointMotion(ref, angle);
    },
    [],
  );

  const flushJointMotion = useCallback(() => {
    commitPendingHistory();
    useWorkspaceStore
      .getState()
      .flushPendingJointMotion({ label: 'Update joint motion' });
  }, [commitPendingHistory]);

  return {
    handleWorkspaceNameChange,
    handleComponentNameChange,
    handleRobotNameChange,
    handleUpdate,
    handleCollisionTransformPreview,
    handleCollisionTransform,
    handleCollisionTransformPendingChange,
    handleAssemblyTransform,
    handleComponentTransform,
    handleBridgeTransform,
    handleAddChild,
    handleAddCollisionBody,
    handleDelete,
    handleSetComponentVisibility,
    handleSetShowVisual,
    handleJointChange,
    flushJointMotion,
  };
}
