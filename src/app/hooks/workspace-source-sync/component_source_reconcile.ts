import type {
  ComponentSourceDraft,
  RobotData,
  RobotFile,
} from '@/types';
import { useAssetsStore } from '@/store/assetsStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import {
  buildEditableSourcePatchState,
  resolveEditablePatchTarget,
} from './editable_source_patch_state';
import { reconcileMJCFEditableSource } from '../../utils/mjcfEditableSourceReconciler';
import { reconcileSdfEditableSource } from '../../utils/sdfEditableSourceReconciler';
import { reconcileUrdfEditableSource } from '../../utils/urdfEditableSourceReconciler';
import { reconcileXacroEditableSource } from '../../utils/xacroEditableSourceReconciler';

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
