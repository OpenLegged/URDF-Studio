import type { ExportProgressState } from '@/features/file-io';
import type { RobotFile, RobotState } from '@/types';

export type ExportTarget = { type: 'current' } | { type: 'library-file'; file: RobotFile };

export const DEFAULT_EXPORT_TARGET: ExportTarget = { type: 'current' };

export interface ExportContext {
  robot: RobotState;
  exportName: string;
  extraMeshFiles?: Map<string, Blob>;
}

export interface HandleExportWithConfigOptions {
  /** Deliver the archive to the caller instead of triggering a browser download. */
  onArchive?: (blob: Blob, fileName: string) => void;
  onProgress?: (progress: ExportProgressState) => void;
}

export interface HandleProjectExportOptions {
  onProgress?: (progress: ExportProgressState) => void;
  /**
   * Skip the default browser download and only return the generated blob.
   * Useful when another caller needs to upload or otherwise handle the file.
   */
  skipDownload?: boolean;
}

export interface ExportExecutionIssue {
  code: string;
  message: string;
  context?: Record<string, string>;
}

export interface DisconnectedWorkspaceUrdfExportAction {
  type: 'disconnected-workspace-urdf';
  componentCount: number;
  connectedGroupCount: number;
  exportName: string;
}

export type ExportActionRequired = DisconnectedWorkspaceUrdfExportAction;

export interface ExportExecutionResult {
  partial: boolean;
  warnings: string[];
  issues: ExportExecutionIssue[];
  actionRequired?: ExportActionRequired;
}

export interface ProjectExportExecutionResult {
  partial: boolean;
  warnings: string[];
  issues: ExportExecutionIssue[];
  actionRequired?: ExportActionRequired;
  /**
   * Generated USP archive content for callers that handle delivery themselves.
   */
  blob?: Blob;
}

export interface UrdfSourceExportPreference {
  useRelativePaths?: boolean;
  preferSourceVisualMeshes?: boolean;
}
