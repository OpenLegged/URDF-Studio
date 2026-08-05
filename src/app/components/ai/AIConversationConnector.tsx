import { AIConversationModal } from '@/features/ai-assistant';
import type { AIConversationLaunchContext } from '@/features/ai-assistant';
import type { Language } from '@/shared/i18n';

interface AIConversationConnectorProps {
  isOpen: boolean;
  onClose: () => void;
  lang: Language;
  launchContext: AIConversationLaunchContext | null;
  onStartNewConversation: (launchContext: AIConversationLaunchContext) => void;
  onApply: (componentId: string, proposedUrdf: string) => boolean;
}

export function AIConversationConnector({
  isOpen,
  onClose,
  lang,
  launchContext,
  onStartNewConversation,
  onApply,
}: AIConversationConnectorProps) {
  return (
    <AIConversationModal
      isOpen={isOpen}
      onClose={onClose}
      lang={lang}
      launchContext={launchContext}
      onStartNewConversation={onStartNewConversation}
      onApply={onApply}
    />
  );
}
