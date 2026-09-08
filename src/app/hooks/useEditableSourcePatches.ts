import { useCallback } from 'react';

import type {
  ComponentSourceDraft,
  RobotData,
  RobotFile,
  UrdfJoint,
  UrdfLink,
} from '@/types';
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
import { reconcileMJCFEditableSource } from '../utils/mjcfEditableSourceReconciler';
import { reconcileSdfEditableSource } from '../utils/sdfEditableSourceReconciler';
import { reconcileUrdfEditableSource } from '../utils/urdfEditableSourceReconciler';
import { reconcileXacroEditableSource } from '../utils/xacroEditableSourceReconciler';

interface UseEditableSourcePatchesParams {
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
}

interface ComponentSourceTarget {
  componentId: string;
  expectedRobotSnapshotHash: string;
}

type DraftPatcher = (draft: ComponentSourceDraft) => string | null;

export type SourcePatchOutcome = 'patched' | 'unavailable' | 'invalidated';

export interface ComponentSourceReconcileResult {
  handled: boolean;
  outcome?: SourcePatchOutcome;
  reason?: string;
}

type ReconciledEditableSourceFormat = Extract<
  ComponentSourceDraft['format'],
  'mjcf' | 'sdf' | 'urdf' | 'xacro'
>;

interface EditableSourceReconcileParams {
  sourceContent: string;
  beforeRobot: RobotData;
  afterRobot: RobotData;
  sourceFileName: string;
  availableFiles: RobotFile[];
  allFileContents: Record<string, string>;
}

type EditableSourceReconcileResult =
  | { status: 'patched'; content: string }
  | { status: 'unsafe'; reason: string };

const SOURCE_FILE_EXTENSIONS: Record<ReconciledEditableSourceFormat, string> = {
  mjcf: 'xml',
  sdf: 'sdf',
  urdf: 'urdf',
  xacro: 'xacro',
};

const RECONCILED_SOURCE_FORMATS = new Set<ComponentSourceDraft['format']>(
  Object.keys(SOURCE_FILE_EXTENSIONS) as ReconciledEditableSourceFormat[],
);

function isReconciledEditableSourceFormat(
  format: ComponentSourceDraft['format'],
): format is ReconciledEditableSourceFormat {
  return RECONCILED_SOURCE_FORMATS.has(format);
}

function reconcileEditableSource(
  format: ReconciledEditableSourceFormat,
  params: EditableSourceReconcileParams,
): EditableSourceReconcileResult {
  switch (format) {
    case 'mjcf':
      return reconcileMJCFEditableSource(params);
    case 'sdf':
      return reconcileSdfEditableSource(params);
    case 'urdf':
      return reconcileUrdfEditableSource(params);
    case 'xacro':
      return reconcileXacroEditableSource(params);
  }
}

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
    return 'invalidated';
  }

  const nextContent = patch(resolved.draft);
  if (nextContent === null) {
    return 'invalidated';
  }
  if (
    nextContent === resolved.draft.content
    && resolved.draft.robotSnapshotHash !== resolved.currentRobotSnapshotHash
  ) {
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

/**
 * Store-level source coordinator shared by property mutations and history.
 * `handled` means callers must not run a second, partial source patch.
 */
export function reconcileComponentEditableRobotSource({
  componentId,
  expectedRobotSnapshotHash,
  previousRobot,
  nextRobot,
}: ComponentSourceTarget & {
  previousRobot: RobotData;
  nextRobot: RobotData;
}): ComponentSourceReconcileResult {
  const assets = useAssetsStore.getState();
  const draft = assets.componentSourceDrafts[componentId];
  if (!draft || !isReconciledEditableSourceFormat(draft.format)) {
    return { handled: false };
  }

  const format = draft.format;

  const component = useWorkspaceStore.getState().workspace.components[componentId];
  const sourceFileName = component?.sourceFile
    ?? nextRobot.sourceDocument?.filename
    ?? previousRobot.sourceDocument?.filename
    ?? `${componentId}.${SOURCE_FILE_EXTENSIONS[format]}`;
  let unsafeReason: string | undefined;
  try {
    const outcome = applyComponentEditableSourcePatch({
      componentId,
      expectedRobotSnapshotHash,
      patch: (currentDraft) => {
        const params = {
          sourceContent: currentDraft.content,
          beforeRobot: previousRobot,
          afterRobot: nextRobot,
          sourceFileName,
          availableFiles: assets.availableFiles,
          allFileContents: assets.allFileContents,
        };
        const result = reconcileEditableSource(format, params);
        if (result.status === 'unsafe') {
          unsafeReason = result.reason;
          return null;
        }
        return result.content;
      },
    });
    return { handled: true, outcome, reason: unsafeReason };
  } catch (error) {
    assets.removeComponentSourceDraft(componentId);
    return {
      handled: true,
      outcome: 'invalidated',
      reason: error instanceof Error ? error.message : 'Source reconciliation failed.',
    };
  }
}

/** @deprecated Use the format-neutral coordinator. */
export const reconcileComponentEditableUrdfSource = reconcileComponentEditableRobotSource;

export function useEditableSourcePatches({ showToast }: UseEditableSourcePatchesParams) {
  const runPatch = useCallback((
    target: ComponentSourceTarget,
    patch: DraftPatcher,
    errorLabel: string,
  ) => {
    try {
      return applyComponentEditableSourcePatch({ ...target, patch });
    } catch (error) {
      console.error(errorLabel, error);
      showToast(errorLabel, 'info');
      return 'invalidated' as const;
    }
  }, [showToast]);

  const patchEditableSourceRobot = useCallback((args: ComponentSourceTarget & {
    previousRobot: RobotData;
    nextRobot: RobotData;
  }): boolean => {
    const format = useAssetsStore.getState().componentSourceDrafts[args.componentId]?.format;
    const result = reconcileComponentEditableRobotSource(args);
    if (result.handled && result.outcome === 'invalidated' && result.reason) {
      console.info('Source-preserving reconciliation was invalidated:', result.reason);
      showToast(
        `This ${format?.toUpperCase() ?? 'source'} change cannot be preserved exactly; `
          + 'showing generated source instead.',
        'info',
      );
    }
    return result.handled;
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
    patchEditableSourceRobot,
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
