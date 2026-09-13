import { useCallback, useRef, useState } from 'react';

import type {
  AIConversationFocusedIssue,
  AIConversationLaunchContext,
  AIConversationMode,
  AIConversationSelection,
} from '@/features/ai-assistant';
import type { InspectionReport, RobotState } from '@/types';
import { createConversationLaunchContext } from '../utils/aiConversationLaunch';

interface AIConversationContextOptions {
  selectedEntity?: AIConversationSelection | null;
  focusedIssue?: AIConversationFocusedIssue | null;
}

interface AIWorkspaceSessionState {
  inspectionOpen: boolean;
  inspectionMounted: boolean;
  conversationOpen: boolean;
  conversationMounted: boolean;
  conversationContext: AIConversationLaunchContext | null;
}

interface UseAIWorkspaceSessionOptions {
  canEnter: () => boolean;
  readRobotSnapshot: () => RobotState;
  prefetchInspection: () => void;
  prefetchConversation: () => void;
}

const INITIAL_STATE: AIWorkspaceSessionState = {
  inspectionOpen: false,
  inspectionMounted: false,
  conversationOpen: false,
  conversationMounted: false,
  conversationContext: null,
};

/** Owns AI window visibility and conversation identity for one app instance. */
export function useAIWorkspaceSession({
  canEnter,
  readRobotSnapshot,
  prefetchInspection,
  prefetchConversation,
}: UseAIWorkspaceSessionOptions) {
  const [state, setState] = useState(INITIAL_STATE);
  const entryRef = useRef({ canEnter, readRobotSnapshot });
  entryRef.current = { canEnter, readRobotSnapshot };
  // Commands can be invoked consecutively by an agent before React renders.
  const stateRef = useRef(state);
  const sessionIdRef = useRef(0);
  const updateState = useCallback((patch: Partial<AIWorkspaceSessionState>) => {
    stateRef.current = { ...stateRef.current, ...patch };
    setState(stateRef.current);
  }, []);
  const createContext = useCallback((
    mode: AIConversationMode,
    robotSnapshot: RobotState,
    report: InspectionReport | null = null,
    options: AIConversationContextOptions = {},
  ) => {
    sessionIdRef.current += 1;
    return createConversationLaunchContext({
      sessionId: sessionIdRef.current,
      mode,
      robotSnapshot,
      inspectionReportSnapshot: report,
      ...options,
    });
  }, []);

  const openInspection = useCallback((options: { coexist?: boolean } = {}): boolean => {
    if (!entryRef.current.canEnter()) return false;
    prefetchInspection();
    updateState({
      inspectionOpen: true,
      inspectionMounted: true,
      conversationOpen: options.coexist ? stateRef.current.conversationOpen : false,
    });
    return true;
  }, [prefetchInspection, updateState]);

  const openConversation = useCallback((): boolean => {
    if (!entryRef.current.canEnter()) return false;
    const current = stateRef.current;
    const context = current.conversationOpen && current.conversationContext?.mode === 'general'
      ? current.conversationContext
      : createContext('general', entryRef.current.readRobotSnapshot());
    prefetchConversation();
    updateState({
      conversationOpen: true,
      conversationMounted: true,
      conversationContext: context,
      inspectionOpen: false,
    });
    return true;
  }, [createContext, prefetchConversation, updateState]);

  const followUpReport = useCallback((
    report: InspectionReport,
    robotSnapshot: RobotState,
    options: AIConversationContextOptions = {},
  ) => {
    if (!entryRef.current.canEnter()) return;
    const context = createContext('inspection-followup', robotSnapshot, report, options);
    prefetchConversation();
    updateState({
      conversationOpen: true,
      conversationMounted: true,
      conversationContext: context,
    });
  }, [createContext, prefetchConversation, updateState]);

  const startNewConversation = useCallback(() => {
    const currentContext = stateRef.current.conversationContext;
    if (!currentContext) return;
    updateState({
      conversationContext: createContext(
        currentContext.mode,
        entryRef.current.readRobotSnapshot(),
        currentContext.inspectionReportSnapshot ?? null,
        {
          selectedEntity: currentContext.selectedEntity,
          focusedIssue: currentContext.focusedIssue,
        },
      ),
    });
  }, [createContext, updateState]);
  const closeInspection = useCallback(() => updateState({ inspectionOpen: false }), [updateState]);
  const closeConversation = useCallback(() => updateState({ conversationOpen: false }), [updateState]);

  return {
    ...state,
    openInspection,
    openConversation,
    followUpReport,
    startNewConversation,
    closeInspection,
    closeConversation,
    prefetchInspection,
    prefetchConversation,
  };
}

export type AIWorkspaceSession = ReturnType<typeof useAIWorkspaceSession>;
