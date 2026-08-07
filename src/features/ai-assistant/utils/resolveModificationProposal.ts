/**
 * Resolve an AI modification proposal: run the surgical tool-calling agent,
 * falling back to the legacy full-robot regeneration when the BYOK endpoint
 * can't do tool calling or the agent errors. Extracted from
 * `AIConversationModal.submitModificationTurn` so the turn handler stays under
 * the cyclomatic-complexity limit and the resolve logic is independently testable.
 *
 * Boundary: feature layer. Imports `@/core/...` (none here), same-feature
 * services (`aiService`, `aiAgent`), `@/shared/i18n`, `@/types`.
 */

import type { Language } from '@/shared/i18n';
import type { MotorSpec, RobotData, RobotState } from '@/types';
import { generateRobotFromPrompt } from '../services/aiService';
import { runRobotEditAgent } from '../services/aiAgent';

export type ModificationProposal =
  | { kind: 'change'; robot: Partial<RobotState>; explanation: string }
  | { kind: 'no-change'; explanation: string }
  | { kind: 'aborted' };

export interface ResolveModificationProposalArgs {
  message: string;
  /** Current robot (with selection stripped) for the legacy fallback path. */
  currentRobot: RobotState;
  /** Live robot data fed to the agent (re-resolved at submit time). */
  robotData: RobotData;
  motorLibrary: Record<string, MotorSpec[]>;
  lang: Language;
  signal: AbortSignal;
}

/**
 * Returns `change` when there is an edited robot to apply, `no-change` when the
 * model made no tool calls (or the fallback returned only advice), and `aborted`
 * when the user cancelled mid-flight (caller should render nothing).
 */
export async function resolveModificationProposal(
  args: ResolveModificationProposalArgs,
): Promise<ModificationProposal> {
  const { message, currentRobot, robotData, motorLibrary, lang, signal } = args;
  try {
    const agentResult = await runRobotEditAgent(message, robotData, lang, signal);
    if (agentResult.robot) {
      return { kind: 'change', robot: agentResult.robot, explanation: agentResult.explanation };
    }
    return { kind: 'no-change', explanation: agentResult.explanation };
  } catch (agentError) {
    if (signal.aborted) {
      return { kind: 'aborted' };
    }
    console.warn('AI edit agent unavailable, falling back to generation', agentError);
    const response = await generateRobotFromPrompt(message, currentRobot, motorLibrary, lang);
    if (!response || !response.robotData) {
      return { kind: 'no-change', explanation: response?.explanation ?? '' };
    }
    return { kind: 'change', robot: response.robotData, explanation: response.explanation ?? '' };
  }
}
