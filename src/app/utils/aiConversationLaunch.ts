// 深导入而非 ai-assistant barrel：这两个轻量工具（深拷贝 + workspace 目标
// 解析）依赖只有 store；走 barrel 会把整个 feature-ai-assistant chunk
// （transport/sessionStore 等 ~512KB raw）静态拉进首屏。
import { cloneAISnapshot } from '@/features/ai-assistant/utils/aiConversationRobotSnapshot';
import { resolveAIWorkspaceRobotTarget } from '@/features/ai-assistant/utils/aiWorkspaceTarget';
import type {
  AIConversationFocusedIssue,
  AIConversationLaunchContext,
  AIConversationMode,
  AIConversationSelection,
} from '@/features/ai-assistant';
import { useSelectionStore } from '@/store/selectionStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import type { InspectionReport, RobotState } from '@/types';

export { cloneAISnapshot } from '@/features/ai-assistant/utils/aiConversationRobotSnapshot';

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
