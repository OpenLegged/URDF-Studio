/** Resolve a proposal using the configured transport; tool failures never regenerate the model. */

import type { Language } from '@/shared/i18n';
import type { MotorSpec, RobotData, RobotState } from '@/types';
import { generateRobotFromPromptWithOptions } from '../services/aiService';
import { resolveAiRuntimeEnv } from '../services/aiRuntimeEnv';
import { runRobotEditAgent, AgentToolsUnsupportedError } from '../services/aiAgent';
import type { AgentConversationTurn } from '../services/agentEngine';
import type { AgentRunEvent } from '../agentRuntimeTypes';
import type { AgentCapability } from '../capabilities/types';

export type ModificationProposal =
  | {
      kind: 'change'
      robot: Partial<RobotState>
      explanation: string
      historyCheckpoint?: AgentConversationTurn[]
    }
  | { kind: 'no-change'; explanation: string; historyCheckpoint?: AgentConversationTurn[] }
  | { kind: 'aborted' };

export interface ResolveModificationProposalArgs {
  message: string;
  /** Current robot (with selection stripped) for managed generation. */
  currentRobot: RobotState;
  /** Live robot data fed to the agent (re-resolved at submit time). */
  robotData: RobotData;
  motorLibrary: Record<string, MotorSpec[]>;
  lang: Language;
  signal: AbortSignal;
  /** Active conversation turns from before the current user message. */
  history?: AgentConversationTurn[];
  /** Selected entity / inspection report context for this turn. */
  context?: string;
  /** Typed browser-harness lifecycle events for the active turn. */
  onAgentEvent?: (event: AgentRunEvent) => void;
  /** Called for each tool call the agent makes. */
  onToolCall?: (step: string) => void;
  /** App-hosted semantic commands exposed alongside the robot draft tools. */
  additionalCapabilities?: AgentCapability[];
}

/**
 * Returns `change` when there is an edited robot to apply, `no-change` when the
 * model made no tool calls (or managed generation returned only advice), and `aborted`
 * when the user cancelled mid-flight (caller should render nothing).
 */
export async function resolveModificationProposal(
  args: ResolveModificationProposalArgs,
): Promise<ModificationProposal> {
  const {
    message,
    currentRobot,
    robotData,
    motorLibrary,
    lang,
    signal,
    history,
    context,
    onAgentEvent,
    onToolCall,
    additionalCapabilities,
  } = args;
  if (signal.aborted) return { kind: 'aborted' };
  const runtime = resolveAiRuntimeEnv();
  if (runtime.backendUrl || !runtime.apiKey) {
    const response = await generateRobotFromPromptWithOptions({
      prompt: message,
      currentRobot,
      motorLibrary,
      lang,
      signal,
    });
    if (signal.aborted) return { kind: 'aborted' };
    if (!response?.robotData) {
      return { kind: 'no-change', explanation: response?.explanation ?? '' };
    }
    return { kind: 'change', robot: response.robotData, explanation: response.explanation ?? '' };
  }
  try {
    const agentResult = await runRobotEditAgent(message, robotData, lang, {
      signal,
      history,
      context,
      onEvent: onAgentEvent,
      onToolCall,
      additionalCapabilities,
      verifyCompletion: false,
    });
    if (agentResult.robot) {
      return {
        kind: 'change',
        robot: agentResult.robot,
        explanation: agentResult.explanation,
        historyCheckpoint: agentResult.historyCheckpoint ?? undefined,
      };
    }
    return {
      kind: 'no-change',
      explanation: agentResult.explanation,
      historyCheckpoint: agentResult.historyCheckpoint ?? undefined,
    };
  } catch (agentError) {
    if (signal.aborted) {
      return { kind: 'aborted' };
    }
    if (agentError instanceof AgentToolsUnsupportedError) {
      const hint =
        lang === 'zh'
          ? '当前模型不支持工具调用（function calling），无法执行精准修改。请在环境变量中配置支持 function calling 的模型（如 gpt-4o、gpt-4.1-mini 等）。'
          : 'The current model does not support tool calling (function calling). Please configure a model that supports function calling (e.g., gpt-4o, gpt-4.1-mini) in your environment variables.';
      return { kind: 'no-change', explanation: hint };
    }
    throw agentError;
  }
}
