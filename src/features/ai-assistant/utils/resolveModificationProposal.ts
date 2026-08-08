/**
 * Resolve an AI modification proposal: run the surgical tool-calling agent,
 * falling back to the legacy full-robot regeneration only for non-tool-calling
 * errors (network, timeout, etc.). When the endpoint rejects tool-calling,
 * the user gets a clear message instead of a silent fallback that clobbers
 * mesh data.
 *
 * Boundary: feature layer. Imports `@/core/...` (none here), same-feature
 * services (`aiService`, `aiAgent`), `@/shared/i18n`, `@/types`.
 */

import type { Language } from '@/shared/i18n';
import type { MotorSpec, RobotData, RobotState } from '@/types';
import { generateRobotFromPrompt } from '../services/aiService';
import { runRobotEditAgent, AgentToolsUnsupportedError } from '../services/aiAgent';

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
  /** Called for each tool call the agent makes. */
  onToolCall?: (step: string) => void;
}

/**
 * Returns `change` when there is an edited robot to apply, `no-change` when the
 * model made no tool calls (or the fallback returned only advice), and `aborted`
 * when the user cancelled mid-flight (caller should render nothing).
 */
export async function resolveModificationProposal(
  args: ResolveModificationProposalArgs,
): Promise<ModificationProposal> {
  const { message, currentRobot, robotData, motorLibrary, lang, signal, onToolCall } = args;
  try {
    const agentResult = await runRobotEditAgent(message, robotData, lang, signal, onToolCall);
    if (agentResult.robot) {
      return { kind: 'change', robot: agentResult.robot, explanation: agentResult.explanation };
    }
    return { kind: 'no-change', explanation: agentResult.explanation };
  } catch (agentError) {
    if (signal.aborted) {
      return { kind: 'aborted' };
    }
    if (agentError instanceof AgentToolsUnsupportedError) {
      const errorMessage = (agentError as Error).message || '';
      if (/api.?key/i.test(errorMessage)) {
        const response = await generateRobotFromPrompt(message, currentRobot, motorLibrary, lang);
        if (!response || !response.robotData) {
          return { kind: 'no-change', explanation: response?.explanation ?? '' };
        }
        return { kind: 'change', robot: response.robotData, explanation: response.explanation ?? '' };
      }
      const hint =
        lang === 'zh'
          ? '当前模型不支持工具调用（function calling），无法执行精准修改。请在环境变量中配置支持 function calling 的模型（如 gpt-4o、gpt-4.1-mini 等）。'
          : 'The current model does not support tool calling (function calling). Please configure a model that supports function calling (e.g., gpt-4o, gpt-4.1-mini) in your environment variables.';
      return { kind: 'no-change', explanation: hint };
    }
    console.warn('AI edit agent unavailable, falling back to generation', agentError);
    const response = await generateRobotFromPrompt(message, currentRobot, motorLibrary, lang);
    if (!response || !response.robotData) {
      return { kind: 'no-change', explanation: response?.explanation ?? '' };
    }
    return { kind: 'change', robot: response.robotData, explanation: response.explanation ?? '' };
  }
}
