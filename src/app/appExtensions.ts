import type { ReactNode } from 'react';
import type {
  HeaderAction,
  HeaderContextFileMenuConfig,
  HeaderSurfaceModeSelectorConfig,
  ToolboxItem,
} from './components/header/types';
import type { RobotFile } from '@/types';

/** Stable, brand-neutral toolbox contribution exposed to host applications. */
export type AppToolboxItem = ToolboxItem;

/** Awaitable result for every host-triggered file import. */
export interface AppImportResult {
  status: 'completed' | 'skipped' | 'failed';
}

/** Render slots: allows external repos to inject extra modals and overlays. */
export interface AppExtensionSlots {
  /** Rendered after core built-in modals, before toast. */
  renderModals?: () => ReactNode;
  /** Rendered after toast (highest z-index layer). */
  renderTopOverlays?: () => ReactNode;
}

/** Config extension: allows external repos to inject header actions etc. */
export interface AppExtensionConfig {
  headerQuickAction?: HeaderAction;
  headerSecondaryAction?: HeaderAction;
  surfaceModeSelector?: HeaderSurfaceModeSelectorConfig;
  /** Host-owned file actions rendered for an alternate workspace surface. */
  contextFileMenu?: HeaderContextFileMenuConfig;
  /** Additional host-owned tools appended after the built-in toolbox entries. */
  toolboxItems?: readonly AppToolboxItem[];
}

/** Core internal actions exposed to external consumers. */
export interface AppExposedActions {
  importFiles: (files: FileList | readonly File[]) => Promise<AppImportResult>;
  openLibraryExport: (file: RobotFile) => void;
  openAIInspection: () => void;
  openAIConversation: () => void;
  openIkTool: () => void;
  openCollisionOptimizer: () => void;
  openTool: (key: string) => void;
  exportProjectBlob: () => Promise<Blob>;
  collectRawFilesBlob: () => Promise<Blob>;
}

export interface AppContentProps {
  extensions?: {
    slots?: AppExtensionSlots;
    config?: AppExtensionConfig;
  };
  /** Core calls this on mount to expose internal handlers to the external host. */
  onExposeActions?: (actions: AppExposedActions) => void;
}
