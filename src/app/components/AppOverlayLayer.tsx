import { Suspense } from 'react';
import { LazyOverlayFallback } from './LazyOverlayFallback';
import { AppToast } from './AppToast';
import { BotWorldImportOverlay } from './BotWorldImportOverlay';
import type { AppExtensionSlots } from '../appExtensions';
import {
  AIConversationConnector,
  AIInspectionConnector,
  DisconnectedWorkspaceUrdfExportDialog,
  ExportDialogConnector,
  ExportProgressDialog,
  SettingsModal,
} from './lazyAppOverlays';
import type { AppToastState } from '../hooks/useAppShellState';
import type { AIWorkspaceSession } from '../hooks/useAIWorkspaceSession';
import type { ExportSession } from '../hooks/useExportSession';
import type { ImportFromUrlProgress, ImportPhase } from '../hooks/useAssetImportFromUrl';
import type {
  AIConversationApplyResult,
  StudioAgentPorts,
} from '@/features/ai-assistant';
import type { RobotData } from '@/types';
import type { Language } from '@/shared/i18n';

interface BotWorldImportOverlayState {
  isImporting: boolean;
  phase: ImportPhase | null;
  progress: ImportFromUrlProgress | null;
}

interface AppOverlayLayerProps {
  aiSession: AIWorkspaceSession;
  exportSession: ExportSession;
  botWorldImportState: BotWorldImportOverlayState;
  closeToast: () => void;
  extensions?: { slots?: AppExtensionSlots };
  onApplyAIUrdfModification: (
    componentId: string,
    proposedUrdf: string,
    sourceFormat?: 'urdf' | 'mjcf',
    proposedRobot?: RobotData,
  ) => AIConversationApplyResult;
  isSettingsOpen: boolean;
  lang: Language;
  loadingLabel: string;
  studioAgentPorts: StudioAgentPorts;
  toast: AppToastState;
}

export function AppOverlayLayer({
  aiSession,
  exportSession,
  botWorldImportState,
  closeToast,
  extensions,
  onApplyAIUrdfModification,
  isSettingsOpen,
  lang,
  loadingLabel,
  studioAgentPorts,
  toast,
}: AppOverlayLayerProps) {
  return (
    <>
      {isSettingsOpen && (
        <Suspense fallback={<LazyOverlayFallback label={loadingLabel} />}>
          <SettingsModal />
        </Suspense>
      )}
      {aiSession.inspectionMounted && (
        <Suspense fallback={<LazyOverlayFallback label={loadingLabel} />}>
          {/* Keep the modal mounted after first open so inspection results survive close/reopen. */}
          <AIInspectionConnector
            isOpen={aiSession.inspectionOpen}
            onClose={aiSession.closeInspection}
            lang={lang}
            onOpenConversationWithReport={aiSession.followUpReport}
          />
        </Suspense>
      )}
      {aiSession.conversationMounted && (
        <Suspense fallback={<LazyOverlayFallback label={loadingLabel} />}>
          <AIConversationConnector
            isOpen={aiSession.conversationOpen}
            onClose={aiSession.closeConversation}
            lang={lang}
            launchContext={aiSession.conversationContext}
            onStartNewConversation={aiSession.startNewConversation}
            onApply={onApplyAIUrdfModification}
            studioAgentPorts={studioAgentPorts}
          />
        </Suspense>
      )}

      {exportSession.step === 'configure' && (
        <Suspense fallback={<LazyOverlayFallback label={loadingLabel} />}>
          <ExportDialogConnector
            target={exportSession.target}
            lang={lang}
            isExporting={exportSession.busy}
            defaultFormat={exportSession.defaultFormat}
            onClose={exportSession.close}
            onExport={exportSession.submit}
          />
        </Suspense>
      )}

      {exportSession.step === 'disconnected' && exportSession.disconnectedDialog && (
        <Suspense fallback={<LazyOverlayFallback label={loadingLabel} />}>
          <DisconnectedWorkspaceUrdfExportDialog
            isOpen={true}
            lang={lang}
            componentCount={exportSession.disconnectedDialog.request.componentCount}
            connectedGroupCount={exportSession.disconnectedDialog.request.connectedGroupCount}
            isExporting={exportSession.busy}
            onClose={exportSession.close}
            onExportMultiple={exportSession.confirmDisconnected}
          />
        </Suspense>
      )}

      {exportSession.progress && exportSession.step === 'closed' && (
        <Suspense fallback={<LazyOverlayFallback label={loadingLabel} />}>
          <ExportProgressDialog lang={lang} progress={exportSession.progress} />
        </Suspense>
      )}

      {extensions?.slots?.renderModals?.()}
      <AppToast toast={toast} onClose={closeToast} />
      {extensions?.slots?.renderTopOverlays?.()}

      {botWorldImportState.isImporting && (
        <BotWorldImportOverlay
          phase={botWorldImportState.phase}
          progress={botWorldImportState.progress}
          lang={lang}
        />
      )}
    </>
  );
}
