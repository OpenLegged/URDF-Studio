import type React from 'react';

import type { HeaderAction } from './components/header/types';
import type { ImportPreparationOverlayState } from './hooks/useFileImport';
import type {
  CommitResolvedRobotLoadOutcome,
  WorkspaceLoadIntent,
} from './utils/commitResolvedRobotLoad';
import type { RobotFile } from '@/types';

export interface ProModeRoundtripSession {
  baselineSnapshot: string;
  generatedFileName: string | null;
}

export interface AppLayoutViewConfig {
  showOptionsPanel: boolean;
  showJointPanel: boolean;
  showStructureGraph: boolean;
}

export interface AppLayoutExposedActions {
  openIkTool: () => void;
  openCollisionOptimizer: () => void;
  openTool: (key: string) => void;
}

export interface AppLayoutProps {
  importInputRef: React.RefObject<HTMLInputElement | null>;
  importFolderInputRef: React.RefObject<HTMLInputElement | null>;
  onFileDrop: (files: File[]) => void;
  onOpenExport: () => void;
  onPrefetchExport: () => void;
  onOpenLibraryExport: (file: RobotFile) => void;
  onExportProject: () => void;
  isExportingProject?: boolean;
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
  onOpenAIInspection: () => void;
  onPrefetchAIInspection: () => void;
  onOpenAIConversation: () => void;
  onPrefetchAIConversation: () => void;
  isCodeViewerOpen: boolean;
  setIsCodeViewerOpen: (open: boolean) => void;
  onOpenSettings: () => void;
  onPrefetchSettings: () => void;
  headerQuickAction?: HeaderAction;
  headerSecondaryAction?: HeaderAction;
  viewConfig: AppLayoutViewConfig;
  setViewConfig: React.Dispatch<React.SetStateAction<AppLayoutViewConfig>>;
  onLoadRobot: (
    file: RobotFile,
    options?: { intent?: WorkspaceLoadIntent },
  ) => Promise<CommitResolvedRobotLoadOutcome | null> | CommitResolvedRobotLoadOutcome | null;
  viewerReloadKey: number;
  importPreparationOverlay?: ImportPreparationOverlayState | null;
  onExposeLayoutActions?: (actions: AppLayoutExposedActions) => void;
}
