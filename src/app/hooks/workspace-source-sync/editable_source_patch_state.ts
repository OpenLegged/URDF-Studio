import { createSourceSemanticRobotHash } from '@/core/robot';
import type { AssemblyState, ComponentSourceDraft } from '@/types';

export type EditableSourcePatchInvalidationReason =
  | 'component-missing'
  | 'draft-missing'
  | 'foreign-component'
  | 'unexpected-robot';

export type ResolvedEditablePatchTarget =
  | {
      status: 'ready';
      draft: ComponentSourceDraft;
      currentRobotSnapshotHash: string;
    }
  | { status: 'invalid'; reason: EditableSourcePatchInvalidationReason };

export function resolveEditablePatchTarget({
  workspace,
  drafts,
  componentId,
  expectedRobotSnapshotHash,
}: {
  workspace: AssemblyState;
  drafts: Record<string, ComponentSourceDraft>;
  componentId: string;
  expectedRobotSnapshotHash: string;
}): ResolvedEditablePatchTarget {
  const component = workspace.components[componentId];
  if (!component) return { status: 'invalid', reason: 'component-missing' };
  const draft = drafts[componentId];
  if (!draft) return { status: 'invalid', reason: 'draft-missing' };
  if (draft.componentId !== componentId) {
    return { status: 'invalid', reason: 'foreign-component' };
  }
  const currentRobotSnapshotHash = createSourceSemanticRobotHash(component.robot);
  if (
    draft.robotSnapshotHash !== expectedRobotSnapshotHash
    && draft.robotSnapshotHash !== currentRobotSnapshotHash
  ) {
    return { status: 'invalid', reason: 'unexpected-robot' };
  }
  return { status: 'ready', draft, currentRobotSnapshotHash };
}

export function buildEditableSourcePatchState({
  draft,
  nextContent,
  currentRobotSnapshotHash,
}: {
  draft: ComponentSourceDraft;
  nextContent: string;
  currentRobotSnapshotHash: string;
}): ComponentSourceDraft {
  return {
    ...draft,
    content: nextContent,
    robotSnapshotHash: currentRobotSnapshotHash,
  };
}
