import { useCallback } from 'react';

import type { ComponentSourceDraft, UrdfJoint, UrdfLink } from '@/types';
import { useAssetsStore } from '@/store/assetsStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import {
  buildEditableSourcePatchState,
  resolveEditablePatchTarget,
} from './editableSourcePatchState';
import {
  patchSdfJointLimitInSource,
  patchSdfModelNameInSource,
  patchUrdfLinkInertialInSource,
  patchUrdfJointLimitInSource,
  patchUrdfRobotNameInSource,
} from '../utils/jointEditableSourcePatch';
import {
  appendMJCFBodyCollisionGeomToSource,
  appendMJCFChildBodyToSource,
  canPatchMJCFEditableSource,
  patchMJCFJointLimitInSource,
  patchMJCFRootModelNameInSource,
  patchMJCFBodyInertialInSource,
  removeMJCFBodyCollisionGeomFromSource,
  removeMJCFBodyFromSource,
  renameMJCFEntitiesInSource,
  updateMJCFBodyCollisionGeomInSource,
  type MJCFRenameOperation,
} from '../utils/mjcfEditableSourcePatch';

interface UseEditableSourcePatchesParams {
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

interface ComponentSourceTarget {
  componentId: string;
  expectedRobotSnapshotHash: string;
}

type DraftPatcher = (draft: ComponentSourceDraft) => string | null;

export type SourcePatchOutcome = 'patched' | 'unavailable' | 'invalidated';

function asPatchableSourceFile(draft: ComponentSourceDraft) {
  return {
    name: `component-draft/${draft.componentId}`,
    format: draft.format,
    content: draft.content,
  };
}

/** Patch or invalidate exactly one component draft; library templates are never mutated. */
export function applyComponentEditableSourcePatch({
  componentId,
  expectedRobotSnapshotHash,
  patch,
}: ComponentSourceTarget & { patch: DraftPatcher }): SourcePatchOutcome {
  const assets = useAssetsStore.getState();
  const resolved = resolveEditablePatchTarget({
    workspace: useWorkspaceStore.getState().workspace,
    drafts: assets.componentSourceDrafts,
    componentId,
    expectedRobotSnapshotHash,
  });
  if (resolved.status === 'invalid') {
    if (resolved.reason === 'draft-missing') return 'unavailable';
    assets.removeComponentSourceDraft(componentId);
    return 'invalidated';
  }

  const nextContent = patch(resolved.draft);
  if (nextContent === null) {
    assets.removeComponentSourceDraft(componentId);
    return 'invalidated';
  }
  assets.setComponentSourceDraft(buildEditableSourcePatchState({
    draft: resolved.draft,
    nextContent,
    currentRobotSnapshotHash: resolved.currentRobotSnapshotHash,
  }));
  return 'patched';
}

export function useEditableSourcePatches({ showToast }: UseEditableSourcePatchesParams) {
  const runPatch = useCallback((
    target: ComponentSourceTarget,
    patch: DraftPatcher,
    errorLabel: string,
  ) => {
    try {
      return applyComponentEditableSourcePatch({ ...target, patch });
    } catch (error) {
      useAssetsStore.getState().removeComponentSourceDraft(target.componentId);
      console.error(errorLabel, error);
      showToast(errorLabel, 'info');
      return 'invalidated' as const;
    }
  }, [showToast]);

  const patchEditableSourceAddChild = useCallback(({
    parentLinkName,
    linkName,
    joint,
    ...target
  }: ComponentSourceTarget & {
    parentLinkName: string;
    linkName: string;
    joint: UrdfJoint;
  }) => runPatch(target, (draft) => {
    const file = asPatchableSourceFile(draft);
    if (!canPatchMJCFEditableSource(file)) return null;
    return appendMJCFChildBodyToSource({
      sourceContent: draft.content,
      parentBodyName: parentLinkName,
      childBodyName: linkName,
      joint,
    });
  }, `Failed to patch component source after adding ${linkName}`), [runPatch]);

  const patchEditableSourceDeleteSubtree = useCallback(({
    linkName,
    ...target
  }: ComponentSourceTarget & { linkName: string }) => runPatch(target, (draft) => {
    if (!canPatchMJCFEditableSource(asPatchableSourceFile(draft))) return null;
    return removeMJCFBodyFromSource(draft.content, linkName);
  }, `Failed to patch component source after deleting ${linkName}`), [runPatch]);

  const patchEditableSourceAddCollisionBody = useCallback(({
    linkName,
    geometry,
    ...target
  }: ComponentSourceTarget & {
    linkName: string;
    geometry: UrdfLink['collision'];
  }) => runPatch(target, (draft) => {
    if (!canPatchMJCFEditableSource(asPatchableSourceFile(draft))) return null;
    return appendMJCFBodyCollisionGeomToSource({
      sourceContent: draft.content,
      bodyName: linkName,
      geometry,
    });
  }, `Failed to patch collision source for ${linkName}`), [runPatch]);

  const patchEditableSourceDeleteCollisionBody = useCallback(({
    linkName,
    objectIndex,
    ...target
  }: ComponentSourceTarget & { linkName: string; objectIndex: number }) => runPatch(
    target,
    (draft) => {
      if (!canPatchMJCFEditableSource(asPatchableSourceFile(draft))) return null;
      return removeMJCFBodyCollisionGeomFromSource(draft.content, linkName, objectIndex);
    },
    `Failed to delete collision source for ${linkName}`,
  ), [runPatch]);

  const patchEditableSourceUpdateCollisionBody = useCallback(({
    linkName,
    objectIndex,
    geometry,
    ...target
  }: ComponentSourceTarget & {
    linkName: string;
    objectIndex: number;
    geometry: UrdfLink['collision'];
  }) => runPatch(target, (draft) => {
    if (!canPatchMJCFEditableSource(asPatchableSourceFile(draft))) return null;
    return updateMJCFBodyCollisionGeomInSource(
      draft.content,
      linkName,
      objectIndex,
      geometry,
    );
  }, `Failed to update collision source for ${linkName}`), [runPatch]);

  const patchEditableSourceRobotName = useCallback(({
    name,
    ...target
  }: ComponentSourceTarget & { name: string }) => runPatch(target, (draft) => {
    if (draft.format === 'urdf' || draft.format === 'xacro') {
      return patchUrdfRobotNameInSource(draft.content, name);
    }
    if (draft.format === 'sdf') return patchSdfModelNameInSource(draft.content, name);
    if (canPatchMJCFEditableSource(asPatchableSourceFile(draft))) {
      return patchMJCFRootModelNameInSource(draft.content, name);
    }
    return null;
  }, `Failed to patch component robot name to ${name}`), [runPatch]);

  const patchEditableSourceRenameEntities = useCallback(({
    operations,
    ...target
  }: ComponentSourceTarget & { operations: MJCFRenameOperation[] }) => runPatch(
    target,
    (draft) => {
      if (
        operations.length === 0
        || !canPatchMJCFEditableSource(asPatchableSourceFile(draft))
      ) return null;
      return renameMJCFEntitiesInSource(draft.content, operations);
    },
    'Failed to rename entities in component source',
  ), [runPatch]);

  const patchEditableSourceUpdateJointLimit = useCallback(({
    jointName,
    jointType,
    limit,
    ...target
  }: ComponentSourceTarget & {
    jointName: string;
    jointType: UrdfJoint['type'];
    limit: NonNullable<UrdfJoint['limit']>;
  }) => runPatch(target, (draft) => {
    if (draft.format === 'urdf' || draft.format === 'xacro') {
      return patchUrdfJointLimitInSource({
        sourceContent: draft.content,
        jointName,
        jointType,
        limit,
      });
    }
    if (draft.format === 'sdf') {
      return patchSdfJointLimitInSource({
        sourceContent: draft.content,
        jointName,
        jointType,
        limit,
      });
    }
    if (!canPatchMJCFEditableSource(asPatchableSourceFile(draft))) return null;
    return patchMJCFJointLimitInSource({
      sourceContent: draft.content,
      jointName,
      jointType,
      limit,
    });
  }, `Failed to patch joint limit for ${jointName}`), [runPatch]);

  const patchEditableSourceUpdateLinkInertial = useCallback(({
    linkName,
    inertial,
    ...target
  }: ComponentSourceTarget & {
    linkName: string;
    inertial: NonNullable<UrdfLink['inertial']>;
  }) => runPatch(target, (draft) => {
    if (draft.format === 'urdf' || draft.format === 'xacro') {
      return patchUrdfLinkInertialInSource({
        sourceContent: draft.content,
        linkName,
        inertial,
      });
    }
    if (!canPatchMJCFEditableSource(asPatchableSourceFile(draft))) return null;
    return patchMJCFBodyInertialInSource({
      sourceContent: draft.content,
      bodyName: linkName,
      inertial,
    });
  }, `Failed to patch inertial source for ${linkName}`), [runPatch]);

  return {
    patchEditableSourceAddChild,
    patchEditableSourceDeleteSubtree,
    patchEditableSourceAddCollisionBody,
    patchEditableSourceDeleteCollisionBody,
    patchEditableSourceUpdateCollisionBody,
    patchEditableSourceUpdateJointLimit,
    patchEditableSourceUpdateLinkInertial,
    patchEditableSourceRobotName,
    patchEditableSourceRenameEntities,
  };
}
