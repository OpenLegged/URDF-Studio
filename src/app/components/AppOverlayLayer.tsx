import { Suspense, type Dispatch, type SetStateAction } from 'react';
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
import type { ExportTarget } from '../hooks/file-export/types';
import type { ImportFromUrlProgress, ImportPhase } from '../hooks/useAssetImportFromUrl';
import type {
  AIConversationFocusedIssue,
  AIConversationLaunchContext,
  AIConversationSelection,
} from '@/features/ai-assistant';
import type { ExportDialogConfig, ExportProgressState } from '@/features/file-io';
import type { InspectionReport, RobotState } from '@/types';
import type { Language } from '@/shared/i18n';

export interface DisconnectedWorkspaceUrdfDialogState {
  config: ExportDialogConfig;
  request: {
    type: 'disconnected-workspace-urdf';
    componentCount: number;
    connectedGroupCount: number;
    exportName: string;
  };
}

interface BotWorldImportOverlayState {
  isImporting: boolean;
  phase: ImportPhase | null;
  progress: ImportFromUrlProgress | null;
}

interface AppOverlayLayerProps {
  aiConversationLaunchContext: AIConversationLaunchContext | null;
  botWorldImportState: BotWorldImportOverlayState;
  closeToast: () => void;
  disconnectedWorkspaceUrdfDialog: DisconnectedWorkspaceUrdfDialogState | null;
  exportDialogTarget: ExportTarget;
  /** Optional initial export format (e.g. from a `convertTo` handoff). */
  exportDialogDefaultFormat?: ExportDialogConfig['format'];
  extensions?: { slots?: AppExtensionSlots };
  handleConfirmDisconnectedWorkspaceUrdfExport: () => void;
  handleExportDialogExport: (
    config: ExportDialogConfig,
    options?: { onProgress?: (progress: ExportProgressState) => void },
  ) => Promise<void>;
  handleOpenConversationWithReport: (
    report: InspectionReport,
    robotSnapshot: RobotState,
    options?: {
      selectedEntity?: AIConversationSelection | null;
      focusedIssue?: AIConversationFocusedIssue | null;
    },
  ) => void;
  handleStartNewAIConversation: (currentLaunchContext: AIConversationLaunchContext) => void;
  isAIConversationOpen: boolean;
  isAIInspectionOpen: boolean;
  isDisconnectedWorkspaceUrdfExporting: boolean;
  isExportDialogOpen: boolean;
  isExporting: boolean;
  isSettingsOpen: boolean;
  lang: Language;
  loadingLabel: string;
  projectExportProgress: ExportProgressState | null;
  setDisconnectedWorkspaceUrdfDialog: Dispatch<
    SetStateAction<DisconnectedWorkspaceUrdfDialogState | null>
  >;
  setIsAIConversationOpen: Dispatch<SetStateAction<boolean>>;
  setIsAIInspectionOpen: Dispatch<SetStateAction<boolean>>;
  setIsExportDialogOpen: Dispatch<SetStateAction<boolean>>;
  shouldRenderAIConversationModal: boolean;
  shouldRenderAIInspectionModal: boolean;
  toast: AppToastState;
}

export function AppOverlayLayer({
  aiConversationLaunchContext,
  botWorldImportState,
  closeToast,
  disconnectedWorkspaceUrdfDialog,
  exportDialogTarget,
  exportDialogDefaultFormat,
  extensions,
  handleConfirmDisconnectedWorkspaceUrdfExport,
  handleExportDialogExport,
  handleOpenConversationWithReport,
  handleStartNewAIConversation,
  isAIConversationOpen,
  isAIInspectionOpen,
  isDisconnectedWorkspaceUrdfExporting,
  isExportDialogOpen,
  isExporting,
  isSettingsOpen,
  lang,
  loadingLabel,
  projectExportProgress,
  setDisconnectedWorkspaceUrdfDialog,
  setIsAIConversationOpen,
  setIsAIInspectionOpen,
  setIsExportDialogOpen,
  shouldRenderAIConversationModal,
  shouldRenderAIInspectionModal,
  toast,
}: AppOverlayLayerProps) {
  return (
    <>
      {isSettingsOpen && (
        <Suspense fallback={<LazyOverlayFallback label={loadingLabel} />}>
          <SettingsModal />
        </Suspense>
      )}
      {shouldRenderAIInspectionModal && (
        <Suspense fallback={<LazyOverlayFallback label={loadingLabel} />}>
          {/* Keep the modal mounted after first open so inspection results survive close/reopen. */}
          <AIInspectionConnector
            isOpen={isAIInspectionOpen}
            onClose={() => {
              setIsAIInspectionOpen(false);
            }}
            lang={lang}
            onOpenConversationWithReport={handleOpenConversationWithReport}
          />
        </Suspense>
      )}
      {shouldRenderAIConversationModal && (
        <Suspense fallback={<LazyOverlayFallback label={loadingLabel} />}>
          <AIConversationConnector
            isOpen={isAIConversationOpen}
            onClose={() => {
              setIsAIConversationOpen(false);
            }}
            lang={lang}
            launchContext={aiConversationLaunchContext}
            onStartNewConversation={handleStartNewAIConversation}
          />
        </Suspense>
      )}

      {isExportDialogOpen && (
        <Suspense fallback={<LazyOverlayFallback label={loadingLabel} />}>
          <ExportDialogConnector
            target={exportDialogTarget}
            lang={lang}
            isExporting={isExporting}
            defaultFormat={exportDialogDefaultFormat}
            onClose={() => {
              if (!isExporting) {
                setIsExportDialogOpen(false);
              }
            }}
            onExport={handleExportDialogExport}
          />
        </Suspense>
      )}

      {disconnectedWorkspaceUrdfDialog && (
        <Suspense fallback={<LazyOverlayFallback label={loadingLabel} />}>
          <DisconnectedWorkspaceUrdfExportDialog
            isOpen={true}
            lang={lang}
            componentCount={disconnectedWorkspaceUrdfDialog.request.componentCount}
            connectedGroupCount={disconnectedWorkspaceUrdfDialog.request.connectedGroupCount}
            isExporting={isDisconnectedWorkspaceUrdfExporting}
            onClose={() => {
              if (!isDisconnectedWorkspaceUrdfExporting) {
                setDisconnectedWorkspaceUrdfDialog(null);
              }
            }}
            onExportMultiple={() => {
              handleConfirmDisconnectedWorkspaceUrdfExport();
            }}
          />
        </Suspense>
      )}

      {projectExportProgress && !isExportDialogOpen && (
        <Suspense fallback={<LazyOverlayFallback label={loadingLabel} />}>
          <ExportProgressDialog lang={lang} progress={projectExportProgress} />
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
