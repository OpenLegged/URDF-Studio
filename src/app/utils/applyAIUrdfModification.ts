import { parseMJCF, parseURDF } from '@/core/parsers';
import {
  createComponentSourceDraft,
  createSourceSemanticRobotHash,
  normalizeComponentRobot,
  validateCanonicalRobotData,
} from '@/core/robot';
import type { ComponentSourceDraft, RobotData, RobotState } from '@/types';
import type { AIConversationApplyResult } from '@/features/ai-assistant';
import { useAssetsStore } from '@/store/assetsStore';
import { useWorkspaceStore } from '@/store/workspaceStore';

function toRobotData(state: RobotState): RobotData {
  const { selection: _selection, ...robot } = state;
  return robot;
}

/**
 * Apply the canonical AI proposal with workspace history. Source synchronization
 * follows the workspace mutation; preview text never replaces the proposed data.
 * Legacy saved cards without a robot snapshot still parse and apply their source.
 *
 * Lives in `app/` (not `features/ai-assistant/`) because it orchestrates
 * workspace + assets-store mutation; the feature modal receives it as an
 * `onApply` prop to keep the feature -> app dependency direction correct.
 *
 * Returns the canonical robot read back after a successful commit so callers
 * can verify the applied state. Parse/missing/conflict failures are reported
 * as typed results without mutating the workspace.
 */
export function applyAIUrdfModification(
  componentId: string,
  proposedUrdf: string,
  sourceFormat: 'urdf' | 'mjcf' = 'urdf',
  proposedRobot?: RobotData,
): AIConversationApplyResult {
  let robot: RobotData;
  let draft: ComponentSourceDraft | undefined;
  if (proposedRobot !== undefined) {
    if (!validateCanonicalRobotData(proposedRobot).valid) {
      return { ok: false, reason: 'invalid-robot' };
    }
    robot = normalizeComponentRobot(structuredClone(proposedRobot));
  } else {
    const parsed = sourceFormat === 'mjcf' ? parseMJCF(proposedUrdf) : parseURDF(proposedUrdf);
    if (!parsed) {
      return { ok: false, reason: sourceFormat === 'mjcf' ? 'invalid-mjcf' : 'invalid-urdf' };
    }
    robot = normalizeComponentRobot(toRobotData(parsed));
    draft = createComponentSourceDraft({
      componentId,
      format: sourceFormat,
      content: proposedUrdf,
      robot,
    });
  }

  const workspaceState = useWorkspaceStore.getState();
  const component = workspaceState.workspace.components[componentId];
  if (!component) {
    return { ok: false, reason: 'component-missing' };
  }

  const robotChanged =
    createSourceSemanticRobotHash(component.robot) !== createSourceSemanticRobotHash(robot);
  if (robotChanged) {
    const replaced = workspaceState.replaceComponentRobotAtRevision(
      componentId,
      workspaceState.revision,
      robot,
      { label: 'Apply AI modification' },
    );
    if (!replaced) {
      return { ok: false, reason: 'revision-conflict' };
    }
  }

  if (draft) useAssetsStore.getState().setComponentSourceDraft(draft);
  const committedState = useWorkspaceStore.getState();
  const committedRobot = committedState.workspace.components[componentId]?.robot;
  if (!committedRobot) {
    return { ok: false, reason: 'component-missing' };
  }
  const liveRobot = structuredClone(committedRobot);
  return {
    ok: true,
    componentId,
    revision: committedState.revision,
    liveRobot,
    liveRobotHash: createSourceSemanticRobotHash(liveRobot),
  };
}
