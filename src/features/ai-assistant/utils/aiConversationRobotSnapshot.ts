import { useSelectionStore } from '@/store/selectionStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import type { InteractionSelection, RobotState } from '@/types';

import { resolveAIWorkspaceRobotTarget } from './aiWorkspaceTarget';

const EMPTY_AI_SNAPSHOT_SELECTION: InteractionSelection = { type: null, id: null };

export function cloneAISnapshot<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Snapshot the live workspace robot (links, joints, geometry, hardware)
 * for use as AI conversation context.
 *
 * Must be called at submit time so the AI sees the current structure tree
 * rather than a frozen launch-time snapshot. The launch context created by
 * `createConversationLaunchContext` intentionally deep-clones its inputs
 * for header display and inspection follow-up binding, but the chat panel
 * re-queries the workspace on every submission — when the user opens the
 * AI window, asks a question, then edits links/joints, switches components,
 * or loads a new robot, the next turn carries the live tree, not the
 * structure that existed at the moment the window was opened.
 */
export function resolveCurrentAIRobotSnapshot(): RobotState {
  const workspace = useWorkspaceStore.getState().workspace;
  const selection = useSelectionStore.getState().selection;
  const target = resolveAIWorkspaceRobotTarget(workspace, selection);

  return cloneAISnapshot({
    ...target.robotData,
    // RobotState is an external AI snapshot shape. Canonical selection travels
    // separately as AIConversationSelection and is never mirrored here.
    selection: EMPTY_AI_SNAPSHOT_SELECTION,
  });
}
