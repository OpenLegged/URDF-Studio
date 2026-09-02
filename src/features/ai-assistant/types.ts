/**
 * AI Assistant Feature Types
 */

import type {
  InspectionReport,
  JointEntityRef,
  LinkEntityRef,
  RobotData,
  RobotState,
} from '@/types';
import type { AgentRunEvent, AgentRunStatus } from './agentRuntimeTypes';

/**
 * AI response structure
 */
export interface AIResponse {
  explanation: string;
  actionType: 'modification' | 'generation' | 'advice';
  robotData?: Partial<RobotState>;
}

/**
 * Inspection item definition
 */
export interface InspectionItem {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  descriptionZh: string;
  maxScore: number;
}

/**
 * Issue types for inspection
 */
export type IssueType = 'error' | 'warning' | 'suggestion' | 'pass';

/**
 * Inspection issue
 */
export interface InspectionIssue {
  type: IssueType;
  title: string;
  description: string;
  profileId: string;
  itemId: string;
  evidenceLevel?: 'L1' | 'L2' | 'L3' | 'L4';
  evidenceSource?: string;
  score?: number;
  relatedIds?: string[];
}

export type AIConversationMode = 'general' | 'inspection-followup';

export interface AIConversationChatMessage {
  kind: 'message';
  role: 'user' | 'assistant';
  content: string;
}

export interface AIConversationDivider {
  kind: 'divider';
  marker: 'new-conversation';
}

export interface AIConversationAgentActivity {
  kind: 'agent-activity';
  role: 'assistant';
  status: AgentRunStatus;
  events: AgentRunEvent[];
}

/** Hidden canonical history after token-pressure compaction. */
export interface AIConversationContextCheckpoint {
  kind: 'context-checkpoint';
  turns: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/**
 * A proposed URDF modification returned by the AI. The user previews the diff
 * against `currentUrdf` and applies it; apply re-parses `proposedUrdf` and
 * commits via `commitPreparedComponentSourceApply` so the robot and source
 * draft update together (undoable via workspace history).
 */
export interface AIConversationModificationCard {
  kind: 'modification-card';
  role: 'assistant';
  explanation: string;
  proposedUrdf: string;
  currentUrdf: string;
  componentId: string;
  status: 'pending' | 'applied' | 'dismissed';
  /** Stable identity for exactly one proposal/apply/verification lifecycle. */
  proposalId?: string;
  /** Original visible request used by the post-apply requirement verifier. */
  originalUserRequest?: string;
  /** Post-apply checks are intentionally summarized rather than shown as a checklist. */
  verificationStatus?:
    | 'not-started'
    | 'verifying'
    | 'verified'
    | 'failed'
    | 'unverified'
    | 'stale';
}

export type AIConversationApplyResult =
  | {
      ok: true;
      componentId: string;
      revision: number;
      liveRobot: RobotData;
      liveRobotHash: string;
    }
  | {
      ok: false;
      reason: 'invalid-urdf' | 'component-missing' | 'revision-conflict';
    };

export type AIConversationMessage =
  | AIConversationChatMessage
  | AIConversationAgentActivity
  | AIConversationContextCheckpoint
  | AIConversationDivider
  | AIConversationModificationCard;

/** Canonical entity identity plus its key in the immutable AI snapshot. */
export type AIConversationSelection = (LinkEntityRef | JointEntityRef) & {
  snapshotEntityId?: string;
};

export interface AIConversationFocusedIssue {
  type: IssueType;
  title: string;
  description: string;
  itemId?: string;
  profileId?: string;
  evidenceLevel?: 'L1' | 'L2' | 'L3' | 'L4';
  evidenceSource?: string;
  score?: number;
  relatedIds?: string[];
}

export interface AIConversationLaunchContext {
  sessionId: number;
  mode: AIConversationMode;
  robotSnapshot: RobotState;
  inspectionReportSnapshot?: InspectionReport | null;
  selectedEntity?: AIConversationSelection | null;
  focusedIssue?: AIConversationFocusedIssue | null;
}

export interface AIConversationTurnError {
  code: 'empty_user_message' | 'missing_api_key' | 'empty_response' | 'request_failed';
  message: string;
}

export interface AIConversationTurnResult {
  reply: string;
  error: AIConversationTurnError | null;
}
