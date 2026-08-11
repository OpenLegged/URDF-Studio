import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Loader2,
  MessageCircle,
  Plus,
  RotateCcw,
  Send,
  Square,
  Trash2,
} from 'lucide-react';
import type { Language } from '@/shared/i18n';
import { translations } from '@/shared/i18n';
import {
  DraggableWindow,
  FLOATING_WINDOW_HEADER_HEIGHT_CLASS,
  FLOATING_WINDOW_RADIUS_CLASS,
  FLOATING_WINDOW_TITLE_CLASS,
} from '@/shared/components/DraggableWindow';
import { useDraggableWindow } from '@/shared/hooks/useDraggableWindow';
import { Button } from '@/shared/components/ui/Button';
import { CLOSE_BUTTON_DANGER_TERTIARY_CLASS } from '@/shared/components/ui/closeButtonStyles';
import { Dialog } from '@/shared/components/ui/Dialog';
import { useManagedWindowLayer, useUIStore } from '@/store';
import { ConversationMessageMarkdown } from './ConversationMessageMarkdown';
import { shouldSubmitConversationInput } from '../utils/conversationInput';
import { buildConversationPromptSuggestions } from '../utils/conversationPromptSuggestions';
import {
  createConversationMessage,
  isConversationChatMessage,
  removeTrailingAssistantPlaceholder,
  startNewConversationTimeline,
} from '../utils/conversationTimeline';
import type {
  AIConversationLaunchContext,
  AIConversationMessage,
  AIConversationModificationCard,
} from '../types';
import type { RobotState } from '@/types';
import { generateURDF } from '@/core/parsers';
import { canGenerateUrdf } from '@/core/parsers/urdf/urdfExportSupport';
import { resolveModificationProposal } from '../utils/resolveModificationProposal';
import { resolveAIWorkspaceRobotTarget } from '../utils/aiWorkspaceTarget';
import { useAssetsStore } from '@/store/assetsStore';
import { useSelectionStore } from '@/store/selectionStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { ConversationModificationCard } from './ConversationModificationCard';

interface AIConversationModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: Language;
  launchContext: AIConversationLaunchContext | null;
  onStartNewConversation: (launchContext: AIConversationLaunchContext) => void;
  onApply: (componentId: string, proposedUrdf: string) => boolean;
}

type ConversationResetAction = 'new-conversation' | 'clear-history';

function resolveSelectedEntityName(context: AIConversationLaunchContext | null): string | null {
  if (!context?.selectedEntity) {
    return null;
  }

  const { type, entityId, snapshotEntityId = entityId } = context.selectedEntity;
  return type === 'link'
    ? context.robotSnapshot.links[snapshotEntityId]?.name || entityId
    : context.robotSnapshot.joints[snapshotEntityId]?.name || entityId;
}

export function AIConversationModal({
  isOpen,
  onClose,
  lang,
  launchContext,
  onStartNewConversation,
  onApply,
}: AIConversationModalProps) {
  const t = translations[lang];
  const conversationWindowLayer = useManagedWindowLayer('aiConversation');
  const defaultWindowSize = useMemo(() => {
    if (typeof window === 'undefined') {
      return { width: 760, height: 620 };
    }

    return {
      width: Math.min(760, Math.max(480, window.innerWidth - 24)),
      height: Math.min(620, Math.max(420, window.innerHeight - 64)),
    };
  }, []);
  const windowState = useDraggableWindow({
    isOpen,
    defaultSize: defaultWindowSize,
    minSize: { width: 480, height: 420 },
    viewportMinSize: { width: 360, height: 320 },
    centerOnMount: true,
    enableMinimize: true,
    clampResizeToViewport: true,
    dragBounds: {
      allowNegativeX: true,
      minVisibleWidth: 100,
      bottomMargin: 50,
    },
  });
  const { isMinimized, size, isResizing } = windowState;
  const isCompactLayout = size.width < 700;

  const [messages, setMessages] = useState<AIConversationMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [copiedMessageKey, setCopiedMessageKey] = useState<string | null>(null);
  const [lastSubmittedTurn, setLastSubmittedTurn] = useState<{ userMessage: string } | null>(
    null,
  );
  const [pendingResetAction, setPendingResetAction] = useState<ConversationResetAction | null>(
    null,
  );

  const isMountedRef = useRef(false);
  const requestIdRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isComposingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const skipNextSessionResetRef = useRef(false);

  const selectedEntityName = useMemo(
    () => resolveSelectedEntityName(launchContext),
    [launchContext],
  );
  const aiAutoApply = useUIStore((s) => s.aiAutoApplyEdits);
  const isReportFollowup = launchContext?.mode === 'inspection-followup';
  const focusedIssue = isReportFollowup ? (launchContext?.focusedIssue ?? null) : null;
  const headerTitle = isReportFollowup ? t.discussReportWithAI : t.aiConversation;
  const latestTimelineValue = (() => {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) {
      return '';
    }

    if (isConversationChatMessage(lastMessage)) {
      return lastMessage.content;
    }

    if (lastMessage.kind === 'divider') {
      return lastMessage.marker;
    }

    return '';
  })();
  const showHeaderActionLabels = !isMinimized && !isCompactLayout;
  const suggestedPrompts = useMemo(
    () =>
      buildConversationPromptSuggestions({
        lang,
        isReportFollowup: Boolean(isReportFollowup),
        selectedEntityName,
        focusedIssueTitle: focusedIssue?.title,
      }),
    [focusedIssue?.title, isReportFollowup, lang, selectedEntityName],
  );

  const resetConversationState = useCallback(
    (options?: { preserveMessages?: boolean; startNewConversation?: boolean }) => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      requestIdRef.current += 1;
      setMessages((currentMessages) => {
        if (!options?.preserveMessages) {
          return [];
        }

        if (options.startNewConversation) {
          return startNewConversationTimeline(currentMessages);
        }

        return removeTrailingAssistantPlaceholder(currentMessages);
      });
      setInput('');
      setIsSending(false);
      setCopiedMessageKey(null);
      setLastSubmittedTurn(null);
      setPendingResetAction(null);
      isComposingRef.current = false;
    },
    [],
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      requestIdRef.current += 1;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (skipNextSessionResetRef.current) {
      skipNextSessionResetRef.current = false;
      return;
    }

    resetConversationState();
  }, [launchContext?.sessionId, resetConversationState]);

  useEffect(() => {
    if (!isOpen && isSending) {
      abortControllerRef.current?.abort();
    }
  }, [isOpen, isSending]);

  useEffect(() => {
    if (!isOpen || isMinimized) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }

      textarea.focus();
      const cursor = textarea.value.length;
      textarea.setSelectionRange(cursor, cursor);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [input.length, isOpen, isMinimized, launchContext?.sessionId]);

  useEffect(() => {
    if (!isOpen || isMinimized) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({
        block: 'end',
        behavior: messages.length <= 1 && !isSending ? 'auto' : 'smooth',
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [isOpen, isMinimized, isSending, latestTimelineValue, messages.length]);

  const handleCopyMessage = async (messageKey: string, content: string) => {
    if (!navigator.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(content);

      if (!isMountedRef.current) {
        return;
      }

      setCopiedMessageKey(messageKey);
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
      }

      copiedTimerRef.current = setTimeout(() => {
        setCopiedMessageKey((current) => (current === messageKey ? null : current));
      }, 1800);
    } catch (error) {
      console.error('Conversation copy failed', error);
    }
  };

  const handleStopGenerating = () => {
    abortControllerRef.current?.abort();
  };

  const handleConfirmResetAction = () => {
    if (!launchContext || !pendingResetAction) {
      return;
    }

    if (pendingResetAction === 'new-conversation') {
      skipNextSessionResetRef.current = true;
      resetConversationState({
        preserveMessages: true,
        startNewConversation: true,
      });
      onStartNewConversation(launchContext);
      return;
    }

    resetConversationState();
  };

  const handleSuggestedPromptSelect = async (prompt: string) => {
    if (!prompt.trim() || isSending) {
      return;
    }

    setInput('');
    await submitModificationTurn(prompt);
  };

  const handleSend = async () => {
    const trimmedInput = input.trim();
    if (!trimmedInput) {
      return;
    }

    setInput('');
    await submitModificationTurn(trimmedInput);
  };

  const handleRetry = async () => {
    if (!lastSubmittedTurn || isSending) {
      return;
    }

    await submitModificationTurn(lastSubmittedTurn.userMessage);
  };

  const submitModificationTurn = async (userMessage: string) => {
    if (!launchContext || !userMessage.trim() || isSending) {
      return;
    }

    const trimmedMessage = userMessage.trim();
    setInput('');
    setMessages((prev) => [
      ...removeTrailingAssistantPlaceholder(prev),
      createConversationMessage('user', trimmedMessage),
      createConversationMessage('assistant', ''),
    ]);
    setIsSending(true);

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const isRequestActive = () =>
      isMountedRef.current &&
      requestIdRef.current === requestId &&
      abortControllerRef.current === abortController;
    setLastSubmittedTurn({ userMessage: trimmedMessage });

    try {
      const workspace = useWorkspaceStore.getState().workspace;
      const selection = useSelectionStore.getState().selection;
      const target = resolveAIWorkspaceRobotTarget(workspace, selection);
      const componentId = target.componentId;
      if (!componentId) {
        setMessages((prev) => [
          ...removeTrailingAssistantPlaceholder(prev),
          createConversationMessage('assistant', t.aiModificationNoComponent),
        ]);
        return;
      }

      const currentRobot: RobotState = {
        ...target.robotData,
        selection: { type: null, id: null },
      };
      const motorLibrary = useAssetsStore.getState().motorLibrary;

      const proposal = await resolveModificationProposal({
        message: trimmedMessage,
        currentRobot,
        robotData: target.robotData,
        motorLibrary,
        lang,
        signal: abortController.signal,
        onToolCall: (step) => {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (!last || !isConversationChatMessage(last) || last.role !== 'assistant') {
              return prev;
            }
            const updated = [...prev];
            const current = last.content || '';
            updated[updated.length - 1] = {
              ...last,
              content: current ? `${current}\n${step}` : step,
            };
            return updated;
          });
        },
      });

      if (proposal.kind === 'aborted') {
        return;
      }
      if (proposal.kind === 'no-change') {
        setMessages((prev) => [
          ...removeTrailingAssistantPlaceholder(prev),
          createConversationMessage(
            'assistant',
            proposal.explanation || t.aiModificationNoChange,
          ),
        ]);
        return;
      }

      const proposedRobotState: RobotState = {
        name: proposal.robot.name ?? currentRobot.name,
        links: proposal.robot.links ?? currentRobot.links,
        joints: proposal.robot.joints ?? currentRobot.joints,
        rootLinkId: proposal.robot.rootLinkId ?? currentRobot.rootLinkId,
        selection: { type: null, id: null },
      };

      if (!canGenerateUrdf(proposedRobotState)) {
        setMessages((prev) => [
          ...removeTrailingAssistantPlaceholder(prev),
          createConversationMessage('assistant', t.aiModificationUnsupportedJoint),
        ]);
        return;
      }

      const proposedUrdf = generateURDF(proposedRobotState, { preserveMeshPaths: true });
      const currentDraft = useAssetsStore.getState().componentSourceDrafts[componentId];
      const currentUrdf =
        currentDraft?.format === 'urdf'
          ? currentDraft.content
          : generateURDF(currentRobot, { preserveMeshPaths: true });

      if (proposedUrdf === currentUrdf) {
        setMessages((prev) => [
          ...removeTrailingAssistantPlaceholder(prev),
          createConversationMessage(
            'assistant',
            proposal.explanation
              ? `${proposal.explanation}\n\n⚠️ 修改后与当前内容一致，未产生实际变更。`
              : t.aiModificationNoChange,
          ),
        ]);
        return;
      }

      if (aiAutoApply) {
        // Highest permission: apply immediately, surface a summary. Undoable
        // via workspace history (Ctrl+Z), same as the card's Apply path.
        const applied = onApply(componentId, proposedUrdf);
        const summary = applied
          ? t.aiAutoAppliedSummary.replace(
              '{explanation}',
              proposal.explanation || t.aiModificationApplied,
            )
          : t.aiModificationFailed;
        setMessages((prev) => [
          ...removeTrailingAssistantPlaceholder(prev),
          createConversationMessage('assistant', summary),
        ]);
        return;
      }

      const cardMessage: AIConversationModificationCard = {
        kind: 'modification-card',
        role: 'assistant',
        explanation: proposal.explanation,
        proposedUrdf,
        currentUrdf,
        componentId,
        status: 'pending',
      };
      setMessages((prev) => [...removeTrailingAssistantPlaceholder(prev), cardMessage]);
    } catch (error) {
      if (abortController.signal.aborted) {
        return;
      }
      console.error('AI modification turn failed', error);
      setMessages((prev) => [
        ...removeTrailingAssistantPlaceholder(prev),
        createConversationMessage('assistant', t.aiModificationFailed),
      ]);
    } finally {
      if (isRequestActive()) {
        abortControllerRef.current = null;
        setIsSending(false);
      }
    }
  };

  const handleApplyModification = useCallback(
    (componentId: string, proposedUrdf: string): boolean => {
      const ok = onApply(componentId, proposedUrdf);
      if (ok) {
        setMessages((prev) =>
          prev.map((message) =>
            message.kind === 'modification-card' && message.proposedUrdf === proposedUrdf
              ? { ...message, status: 'applied' as const }
              : message,
          ),
        );
      }
      return ok;
    },
    [onApply],
  );

  const handleDismissModification = useCallback((proposedUrdf: string) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.kind === 'modification-card' && message.proposedUrdf === proposedUrdf
          ? { ...message, status: 'dismissed' as const }
          : message,
      ),
    );
  }, []);

  if (!isOpen || !launchContext) {
    return null;
  }

  const confirmDialogTitle =
    pendingResetAction === 'new-conversation'
      ? t.newConversationConfirmTitle
      : t.clearConversationHistoryConfirmTitle;
  const confirmDialogMessage =
    pendingResetAction === 'new-conversation'
      ? t.newConversationConfirmMessage
      : t.clearConversationHistoryConfirmMessage;
  const confirmDialogActionLabel =
    pendingResetAction === 'new-conversation' ? t.newConversation : t.clearConversationHistory;
  const headerActionButtonClassName =
    'inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-black bg-panel-bg px-2.5 text-[11px] font-semibold text-text-secondary transition-colors hover:bg-element-hover focus:outline-none focus:ring-2 focus:ring-system-blue/30 dark:bg-panel-bg';
  const newConversationButtonClassName = `${headerActionButtonClassName} hover:border-system-blue/35 hover:text-system-blue focus:border-system-blue/35 focus:text-system-blue`;
  const clearHistoryButtonClassName = `${headerActionButtonClassName} hover:border-danger-border hover:bg-danger-soft hover:text-danger-hover focus:ring-danger/20`;

  return (
    <>
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[95] bg-transparent" />

      <DraggableWindow
        window={windowState}
        onClose={onClose}
        title={
          <div className="flex items-center gap-2">
            <div className="rounded-lg border border-border-black bg-panel-bg p-1.5 text-system-blue dark:bg-element-bg dark:text-system-blue">
              <MessageCircle className="w-4 h-4" />
            </div>
            <h1 className={FLOATING_WINDOW_TITLE_CLASS}>{headerTitle}</h1>
          </div>
        }
        headerActions={
          <div className="flex items-center gap-2">
            <button
              data-window-control
              type="button"
              onClick={() => setPendingResetAction('new-conversation')}
              className={newConversationButtonClassName}
              aria-label={t.newConversation}
              title={t.newConversation}
            >
              <Plus className="h-3 w-3" />
              {showHeaderActionLabels && <span>{t.newConversation}</span>}
            </button>
            <button
              data-window-control
              type="button"
              onClick={() => setPendingResetAction('clear-history')}
              className={clearHistoryButtonClassName}
              aria-label={t.clearConversationHistory}
              title={t.clearConversationHistory}
            >
              <Trash2 className="h-3 w-3" />
              {showHeaderActionLabels && <span>{t.clearConversationHistory}</span>}
            </button>
          </div>
        }
        className={`flex flex-col overflow-hidden ${FLOATING_WINDOW_RADIUS_CLASS} border border-border-black bg-panel-bg text-text-primary shadow-xl dark:bg-panel-bg`}
        zIndex={conversationWindowLayer.zIndex}
        onActivate={conversationWindowLayer.onActivate}
        headerClassName={`${FLOATING_WINDOW_HEADER_HEIGHT_CLASS} border-b border-border-black flex items-center justify-between bg-element-bg shrink-0 ${
          isCompactLayout ? 'px-3' : 'px-4'
        }`}
        interactionClassName="select-none"
        showMinimizeButton={false}
        showMaximizeButton={false}
        minimizeTitle={t.minimize}
        maximizeTitle={t.maximize}
        restoreTitle={t.restore}
        closeTitle={t.close}
        controlButtonClassName="p-1.5 hover:bg-element-hover rounded-md transition-colors"
        closeButtonClassName={`rounded-md p-1.5 ${CLOSE_BUTTON_DANGER_TERTIARY_CLASS}`}
        rightResizeHandleClassName="absolute resize-edge-right resize-edge-visual-right top-0 bottom-0 z-20 w-2 cursor-ew-resize after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:bg-transparent after:content-[''] after:transition-colors hover:after:bg-system-blue/50 active:after:bg-system-blue/70"
        bottomResizeHandleClassName="absolute resize-edge-bottom resize-edge-visual-bottom left-0 right-0 z-20 h-2 cursor-ns-resize after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:bg-transparent after:content-[''] after:transition-colors hover:after:bg-system-blue/50 active:after:bg-system-blue/70"
        cornerResizeHandleClassName="absolute resize-edge-bottom resize-edge-right z-30 flex h-6 w-6 cursor-nwse-resize items-center justify-center"
        cornerResizeHandle={<div className="h-2 w-2 border-b border-r border-border-strong" />}
      >
        {!isMinimized && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div
              data-ai-conversation-scroll-viewport
              className={`min-h-0 flex-1 overflow-y-auto bg-panel-bg custom-scrollbar ${
                isCompactLayout ? 'px-2.5 pt-2.5' : 'px-4 pt-3'
              } ${messages.length === 0 ? 'pb-2' : isCompactLayout ? 'pb-2.5' : 'pb-4'}
              }`}
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
              aria-label={headerTitle}
            >
              {messages.length === 0 ? (
                <div
                  className={`flex min-h-full flex-col items-center text-center ${
                    isCompactLayout ? 'justify-start px-0' : 'justify-end px-10'
                  }`}
                >
                  <div className={`${isCompactLayout ? '' : 'mt-4'} w-full max-w-2xl`}>
                    <div
                      className={`space-y-2.5 rounded-2xl border border-border-black bg-panel-bg/80 text-left shadow-sm dark:bg-element-bg/70 ${
                        isCompactLayout ? 'px-2 py-2' : 'px-2.5 py-2.5'
                      }`}
                    >
                      <div className="flex items-center gap-3 rounded-xl border border-border-black/60 bg-element-bg/70 px-2 py-2 dark:bg-element-bg">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border border-system-blue/20 bg-system-blue/10 text-system-blue">
                          <MessageCircle className="h-3.5 w-3.5" />
                        </div>
                        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
                          {t.examples}
                        </div>
                      </div>
                      <div
                        className={`grid grid-cols-1 gap-2 ${
                          isCompactLayout ? '' : 'md:grid-cols-2'
                        }`}
                      >
                        {suggestedPrompts.map((prompt) => (
                          <button
                            key={prompt}
                            type="button"
                            onClick={() => {
                              void handleSuggestedPromptSelect(prompt);
                            }}
                            className="group flex items-start gap-2.5 rounded-xl border border-border-black bg-panel-bg px-2.5 py-2 text-left shadow-sm transition-all duration-100 hover:-translate-y-0.5 hover:border-system-blue/35 hover:bg-element-hover focus:border-system-blue/35 focus:bg-element-hover focus:outline-none focus:ring-2 focus:ring-system-blue/30 dark:bg-panel-bg"
                            title={prompt}
                          >
                            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-system-blue/20 bg-system-blue/10 text-system-blue transition-colors group-hover:border-system-blue/35 group-hover:bg-system-blue/15 group-hover:text-system-blue-hover group-focus-visible:border-system-blue/35 group-focus-visible:bg-system-blue/15 group-focus-visible:text-system-blue-hover">
                              <Send className="h-3 w-3" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[11px] leading-relaxed text-text-secondary transition-colors group-hover:text-text-primary group-focus-visible:text-text-primary">
                                {prompt}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {messages.map((message, index) => {
                    if (message.kind === 'modification-card') {
                      return (
                        <div
                          key={`modification-${index}`}
                          className="flex justify-start py-1"
                        >
                          <div className="w-full max-w-[95%]">
                            <ConversationModificationCard
                              card={message}
                              t={t}
                              onApply={handleApplyModification}
                              onDismiss={handleDismissModification}
                            />
                          </div>
                        </div>
                      );
                    }

                    if (!isConversationChatMessage(message)) {
                      return (
                        <div key={`divider-${index}`} className="flex items-center gap-2 py-2">
                          <div className="h-px flex-1 bg-border-black" />
                          <span className="rounded-full border border-border-black bg-element-bg px-2 py-0.5 text-[9px] font-semibold tracking-[0.08em] text-text-tertiary dark:bg-element-bg">
                            {t.newConversationDividerLabel}
                          </span>
                          <div className="h-px flex-1 bg-border-black" />
                        </div>
                      );
                    }

                    const messageKey = `${message.role}-${index}`;
                    const isCopied = copiedMessageKey === messageKey;
                    const isStreamingAssistant =
                      message.role === 'assistant' && index === messages.length - 1 && isSending;

                    return (
                      <div
                        key={messageKey}
                        className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div className="max-w-[85%]">
                          <div
                            className={`rounded-xl px-4 py-3 shadow-sm ${
                              message.role === 'user'
                                ? 'rounded-tr-[4px] border border-system-blue-solid bg-system-blue-solid text-white'
                                : 'rounded-tl-[4px] border border-border-black bg-panel-bg text-text-secondary dark:bg-element-bg'
                            }`}
                          >
{isStreamingAssistant && !message.content ? (
                              <div className="flex items-center gap-2 text-sm text-text-tertiary">
                                <Loader2 className="w-4 h-4 animate-spin text-system-blue" />
                                <span>{t.aiAnalyzing}</span>
                              </div>
                            ) : isStreamingAssistant && message.content ? (
                              <div className="space-y-1">
                                <div className="flex items-center gap-2 text-xs text-text-tertiary">
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-system-blue" />
                                  <span>{t.aiAnalyzing}</span>
                                </div>
                                <div className="text-[11px] text-text-tertiary/80 font-mono whitespace-pre-wrap">
                                  {message.content}
                                </div>
                              </div>
                            ) : (
                              <ConversationMessageMarkdown
                                content={message.content}
                                tone={message.role === 'user' ? 'user' : 'assistant'}
                              />
                            )}
                          </div>
                          {message.content && (
                            <div
                              className={`mt-1.5 flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  void handleCopyMessage(messageKey, message.content);
                                }}
                                className={`inline-flex items-center gap-1 rounded-md border px-1 py-0.5 text-[9px] font-medium transition-colors focus:outline-none focus:ring-2 ${
                                  message.role === 'user'
                                    ? 'border-white/20 bg-white/10 text-white/90 hover:bg-white/15 focus:ring-white/30'
                                    : 'border-border-black bg-panel-bg text-text-tertiary hover:bg-element-hover hover:text-text-secondary focus:ring-system-blue/30 dark:bg-element-bg'
                                }`}
                                aria-label={isCopied ? t.copied : t.copyToClipboard}
                                title={isCopied ? t.copied : t.copyToClipboard}
                              >
                                {isCopied ? (
                                  <Check className="w-3 h-3" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                                <span>{isCopied ? t.copied : t.copy}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  <div ref={messagesEndRef} aria-hidden="true" />
                </div>
              )}
            </div>

            <div
              className={`shrink-0 border-t border-border-black bg-element-bg ${
                isCompactLayout ? 'p-2.5' : 'p-4'
              }`}
            >
              <div className="rounded-xl border border-border-black bg-panel-bg p-1 shadow-sm dark:bg-panel-bg">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onCompositionStart={() => {
                    isComposingRef.current = true;
                  }}
                  onCompositionEnd={() => {
                    isComposingRef.current = false;
                  }}
                  onKeyDown={(event) => {
                    if (
                      shouldSubmitConversationInput(event, { isComposing: isComposingRef.current })
                    ) {
                      event.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder={t.chatPlaceholder}
                  className={`w-full resize-none rounded-lg border-none bg-transparent px-1 py-1 text-[11px] text-text-primary outline-none placeholder:text-text-tertiary ${
                    isCompactLayout ? 'min-h-[64px]' : 'min-h-[88px]'
                  }`}
                />
                <div
                  className={`mt-2 flex gap-3 ${
                    isCompactLayout
                      ? 'flex-wrap items-center justify-end'
                      : 'items-center justify-between'
                  }`}
                >
                  <span
                    className={`px-1.5 text-[9px] font-medium text-text-tertiary ${
                      isCompactLayout ? 'mr-auto' : ''
                    }`}
                  >
                    {t.sendOnEnterHint}
                  </span>
                  <div className="flex items-center gap-2">
                    {lastSubmittedTurn && !isSending && (
                      <button
                        type="button"
                        onClick={() => {
                          void handleRetry();
                        }}
                        className="flex h-6 items-center gap-1 rounded-lg border border-border-black bg-panel-bg px-2 text-[11px] font-semibold text-text-secondary transition-colors hover:bg-element-hover"
                      >
                        <RotateCcw className="w-3 h-3" />
                        {t.retryLastResponse}
                      </button>
                    )}
                    {isSending && (
                      <button
                        type="button"
                        onClick={handleStopGenerating}
                        className="flex h-6 items-center gap-1 rounded-lg border border-border-black bg-panel-bg px-2 text-[11px] font-semibold text-text-secondary transition-colors hover:bg-element-hover"
                      >
                        <Square className="w-3 h-3 fill-current" />
                        {t.stopGenerating}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        void handleSend();
                      }}
                      disabled={isSending || !input.trim()}
                      className="flex h-6 items-center gap-1 rounded-lg bg-system-blue-solid px-2.5 text-[11px] font-semibold text-white transition-colors hover:bg-system-blue-hover disabled:opacity-30"
                    >
                      {isSending ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Send className="w-3 h-3" />
                      )}
                      {t.send}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {isResizing && (
          <div className="absolute bottom-2 right-12 z-50 rounded-lg bg-system-blue-solid px-2 py-1 text-[9px] font-medium text-white shadow-sm">
            {size.width} × {size.height}
          </div>
        )}
      </DraggableWindow>

      <Dialog
        isOpen={pendingResetAction !== null}
        onClose={() => setPendingResetAction(null)}
        title={confirmDialogTitle}
        width="w-[460px]"
        zIndexClassName="z-[260]"
        closeLabel={t.close}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setPendingResetAction(null)}>
              {t.cancel}
            </Button>
            <Button type="button" variant="danger" onClick={handleConfirmResetAction}>
              {confirmDialogActionLabel}
            </Button>
          </div>
        }
      >
        <p className="text-sm leading-6 text-text-secondary">{confirmDialogMessage}</p>
      </Dialog>
    </>
  );
}

export default AIConversationModal;
