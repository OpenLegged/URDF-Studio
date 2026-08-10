import type { ProjectImportResult } from '@/features/file-io';
import type {
  PrepareImportPayloadArgs,
  PrepareImportProgress,
  PreparedDeferredImportAssetFile,
  PreparedImportBlobFile,
  PreparedImportPayload,
  PreResolvedImportEntry,
} from '@/app/utils/importPreparation';
import type { MotorLibrary } from '@/shared/data/motorLibrary';
import type { translations } from '@/shared/i18n';
import type { RobotFile } from '@/types';
import type { FileImportWorkflowContext } from './runFileImportWorkflow';
import type { ImportPreparationOverlayState } from './importPreparationOverlay';

export type ImportInputFiles = FileList | readonly File[] | null;
export type HandleImportResult = {
  status: 'completed' | 'skipped' | 'failed';
};

export type TranslationBundle = (typeof translations)[keyof typeof translations];
export type WorkflowContext = FileImportWorkflowContext<ImportPreparationOverlayState>;

export interface FileImportAssetsStatePort {
  allFileContents: Record<string, string>;
  assets: Record<string, string>;
  availableFiles: RobotFile[];
  motorLibrary: MotorLibrary;
  selectedFile: RobotFile | null;
  addAssets: (assets: Record<string, string>) => void;
  setAllFileContents: (contents: Record<string, string>) => void;
  setAvailableFiles: (files: RobotFile[]) => void;
  setMotorLibrary: (library: MotorLibrary) => void;
}

export type PrepareImportPayloadPort = (
  args: PrepareImportPayloadArgs,
) => Promise<PreparedImportPayload>;

export type HydrateDeferredImportAssetsPort = (args: {
  archiveFile: File;
  assetFiles: readonly PreparedDeferredImportAssetFile[];
  onProgress?: (progress: PrepareImportProgress) => void;
}) => Promise<PreparedImportBlobFile[]>;

export type CreateAssetUrlsPort = (
  files: PreparedImportBlobFile[],
  options?: {
    onProgress?: (progress: { processedEntries: number; totalEntries: number }) => void;
    yieldToBrowser?: boolean;
  },
) => Promise<Record<string, string>>;

export interface ExecutePreparedFileImportWorkflowPorts {
  clearPreparedUsdStageOpenCache: () => void;
  commitImportedProject: (
    result: ProjectImportResult,
    options: { markWorkspaceBaselineSaved: () => void },
  ) => RobotFile | null;
  createAssetUrls: CreateAssetUrlsPort;
  createObjectUrl: (blob: Blob) => string;
  getAssetsState: () => FileImportAssetsStatePort;
  hydrateDeferredArchiveAssetsInBackground: (
    archiveFile: File,
    assetFiles: readonly PreparedDeferredImportAssetFile[],
    options: {
      expectedFileNames: string[];
      isCurrentImport: () => boolean;
      onShowToast?: (message: string, type?: 'info' | 'success') => void;
    },
  ) => void;
  hydrateDeferredImportAssets: HydrateDeferredImportAssetsPort;
  importProject: (file: File, lang?: keyof typeof translations) => Promise<ProjectImportResult>;
  loadRobot: (
    file: RobotFile,
    availableFiles?: RobotFile[],
    currentAssets?: Record<string, string>,
    currentAllFileContents?: Record<string, string>,
  ) => Promise<unknown>;
  logRegressionInfo: (message: string, metadata?: Record<string, unknown>) => void;
  markWorkspaceBaselineSaved: () => void;
  prepareImportPayload: PrepareImportPayloadPort;
  prewarmUsdSelectionInBackground: (
    file: RobotFile,
    availableFiles: RobotFile[],
    assets: Record<string, string>,
  ) => void;
  primePreResolvedRobotImports: (imports: readonly PreResolvedImportEntry[]) => void;
  waitForAnimationFrame: () => Promise<void>;
}

export interface ExecutePreparedFileImportWorkflowParams {
  files: ImportInputFiles;
  forceLoadRobot: boolean;
  isCurrentImport: () => boolean;
  lang: keyof typeof translations;
  onImportPreparationStateChange?: (state: ImportPreparationOverlayState | null) => void;
  onLoadRobot?: (file: RobotFile) => unknown | Promise<unknown>;
  onProjectImported?: (selectedFile: RobotFile | null) => void;
  onShowToast?: (message: string, type?: 'info' | 'success') => void;
  ports: ExecutePreparedFileImportWorkflowPorts;
  t: TranslationBundle;
}

export interface ClassifiedImportInput {
  inputFiles: File[];
  isArchiveImport: boolean;
  projectInputFiles: File[];
  shouldShowPreparationOverlay: boolean;
}

export interface PreparedImportArtifacts {
  deferredAssetResolutionAssets: Record<string, string>;
  hydratedDeferredAssets: Record<string, string>;
  newAssets: Record<string, string>;
  preparedImportPayload: PreparedImportPayload;
  renamedRobotFilesWithSources: RobotFile[];
  shouldHydrateArchiveAssetsInBackground: boolean;
  sourceAssets: Record<string, string>;
  usdSourceBlobUrls: Record<string, string>;
  visibleImportedFiles: RobotFile[];
}
