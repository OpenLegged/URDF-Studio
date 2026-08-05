import { parseURDF } from '@/core/parsers';
import {
  createComponentSourceDraft,
  createSourceSemanticRobotHash,
  normalizeComponentRobot,
} from '@/core/robot';
import type { RobotData, RobotState } from '@/types';
import { useAssetsStore } from '@/store/assetsStore';
import { useWorkspaceStore } from '@/store/workspaceStore';

function toRobotData(state: RobotState): RobotData {
  const { selection: _selection, ...robot } = state;
  return robot;
}

/**
 * Apply an AI-proposed URDF modification to the active component.
 *
 * Re-parses `proposedUrdf` into a RobotState, builds a `urdf` source draft,
 * and commits with the same CAS pattern as `commitPreparedComponentSourceApply`:
 * the component robot is replaced through `replaceComponentRobotAtRevision`
 * (which pushes a workspace history entry, so the change is undoable) and the
 * source draft is updated so the source-code editor reflects the new URDF.
 *
 * Lives in `app/` (not `features/ai-assistant/`) because it orchestrates
 * workspace + assets-store mutation; the feature modal receives it as an
 * `onApply` prop to keep the feature -> app dependency direction correct.
 *
 * Returns false without mutating when the URDF fails to parse, the component
 * is missing, or a concurrent workspace edit invalidated the revision.
 */
export function applyAIUrdfModification(
  componentId: string,
  proposedUrdf: string,
): boolean {
  const parsed = parseURDF(proposedUrdf);
  if (!parsed) {
    return false;
  }

  const robot = normalizeComponentRobot(toRobotData(parsed));
  const draft = createComponentSourceDraft({
    componentId,
    format: 'urdf',
    content: proposedUrdf,
    robot,
  });

  const workspaceState = useWorkspaceStore.getState();
  const component = workspaceState.workspace.components[componentId];
  if (!component) {
    return false;
  }

  const robotChanged =
    createSourceSemanticRobotHash(component.robot) !== draft.robotSnapshotHash;
  if (robotChanged) {
    const replaced = workspaceState.replaceComponentRobotAtRevision(
      componentId,
      workspaceState.revision,
      robot,
      { label: 'Apply AI modification' },
    );
    if (!replaced) {
      return false;
    }
  }

  useAssetsStore.getState().setComponentSourceDraft(draft);
  return true;
}
