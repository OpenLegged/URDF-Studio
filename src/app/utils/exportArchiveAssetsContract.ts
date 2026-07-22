import type { RobotState } from '@/types';

export interface ExportArchiveAssetsCompressOptions {
  compressSTL: boolean;
  stlQuality: number;
}

export interface PrepareExportArchiveAssetsProgress {
  completed: number;
  total: number;
  currentFile: string;
  assetType?: 'mesh' | 'texture';
  stage?: 'read' | 'compress' | 'complete';
}

export interface PrepareExportArchiveAssetsArgs {
  robot: RobotState;
  assets: Record<string, string>;
  compressOptions?: ExportArchiveAssetsCompressOptions;
  extraMeshFiles?: ReadonlyMap<string, Blob>;
  skipMeshPaths?: ReadonlySet<string>;
  onProgress?: (progress: PrepareExportArchiveAssetsProgress) => void;
}

export interface PreparedExportArchiveAssetFile {
  assetType: 'mesh' | 'texture';
  folder: 'meshes' | 'textures';
  sourcePath: string;
  exportPath: string;
  bytes: ArrayBuffer;
  mimeType?: string;
  compressed?: boolean;
  originalSize?: number;
  compressedSize?: number;
}

export type RobotAssetPackagingFailureCode =
  | 'mesh_asset_missing'
  | 'mesh_fetch_failed'
  | 'texture_asset_missing'
  | 'texture_fetch_failed';

export interface RobotAssetPackagingFailure {
  code: RobotAssetPackagingFailureCode;
  assetType: 'mesh' | 'texture';
  sourcePath: string;
  exportPath: string;
  message: string;
}

export interface PrepareExportArchiveAssetsResult {
  totalTasks: number;
  completedTasks: number;
  failedAssets: RobotAssetPackagingFailure[];
  files: PreparedExportArchiveAssetFile[];
}

export interface ExportArchiveAssetsWorkerInlineFile {
  path: string;
  blob: Blob;
}

export interface ExportArchiveAssetsWorkerPayload {
  robot: RobotState;
  assets: Record<string, string>;
  compressOptions?: ExportArchiveAssetsCompressOptions;
  extraMeshFiles: ExportArchiveAssetsWorkerInlineFile[];
  skipMeshPaths: string[];
}

export interface PrepareExportArchiveAssetsWorkerRequest {
  type: 'prepare-export-archive-assets';
  requestId: number;
  payload: ExportArchiveAssetsWorkerPayload;
}

export interface PrepareExportArchiveAssetsProgressWorkerResponse {
  type: 'prepare-export-archive-assets-progress';
  requestId: number;
  progress: PrepareExportArchiveAssetsProgress;
}

export interface PrepareExportArchiveAssetsResultWorkerResponse {
  type: 'prepare-export-archive-assets-result';
  requestId: number;
  result: PrepareExportArchiveAssetsResult;
}

export interface PrepareExportArchiveAssetsErrorWorkerResponse {
  type: 'prepare-export-archive-assets-error';
  requestId: number;
  error: string;
}

export type ExportArchiveAssetsWorkerRequest = PrepareExportArchiveAssetsWorkerRequest;

export type ExportArchiveAssetsWorkerResponse =
  | PrepareExportArchiveAssetsProgressWorkerResponse
  | PrepareExportArchiveAssetsResultWorkerResponse
  | PrepareExportArchiveAssetsErrorWorkerResponse;
