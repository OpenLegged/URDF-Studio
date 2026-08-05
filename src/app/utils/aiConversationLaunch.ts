import {
  cloneAISnapshot,
  resolveAIWorkspaceRobotTarget,
} from '@/features/ai-assistant';
import type {
  AIConversationFocusedIssue,
  AIConversationLaunchContext,
  AIConversationMode,
  AIConversationSelection,
} from '@/features/ai-assistant';
import { useSelectionStore } from '@/store/selectionStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import type { InspectionReport, RobotState } from '@/types';

export { cloneAISnapshot } from '@/features/ai-assistant';

export function resolveCurrentAIConversationSelection(): AIConversationSelection | null {
  const workspace = useWorkspaceStore.getState().workspace;
  const selection = useSelectionStore.getState().selection;
  return resolveAIWorkspaceRobotTarget(workspace, selection).selectedEntity;
}

export function createConversationLaunchContext({
  sessionId,
  mode,
  robotSnapshot,
  inspectionReportSnapshot = null,
  selectedEntity,
  focusedIssue = null,
}: {
  sessionId: number;
  mode: AIConversationMode;
  robotSnapshot: RobotState;
  inspectionReportSnapshot?: InspectionReport | null;
  selectedEntity?: AIConversationSelection | null;
  focusedIssue?: AIConversationFocusedIssue | null;
}): AIConversationLaunchContext {
  const nextRobotSnapshot = cloneAISnapshot(robotSnapshot);
  const nextFocusedIssue = focusedIssue ? cloneAISnapshot(focusedIssue) : null;
  const resolvedSelectedEntity = selectedEntity === undefined
    ? resolveCurrentAIConversationSelection()
    : selectedEntity;

  return {
    sessionId,
    mode,
    robotSnapshot: nextRobotSnapshot,
    inspectionReportSnapshot: inspectionReportSnapshot
      ? cloneAISnapshot(inspectionReportSnapshot)
      : null,
    selectedEntity: resolvedSelectedEntity
      ? cloneAISnapshot(resolvedSelectedEntity)
      : null,
    focusedIssue: nextFocusedIssue,
  };
}
