import type { RobotFile } from '@/types';
import type { PreResolvedImportEntry } from '../preResolvedImportContract.ts';

export interface PreparedImportBlobFile {
  name: string;
  blob: Blob;
}

export interface PreparedDeferredImportAssetFile {
  name: string;
  sourcePath: string;
  sourceArchiveImportPath?: string;
}

export interface PreparedImportLibraryFile {
  path: string;
  content: string;
}

export interface PreparedImportTextFile {
  path: string;
  content: string;
}

export interface PreparedImportPayload {
  robotFiles: RobotFile[];
  assetFiles: PreparedImportBlobFile[];
  deferredAssetFiles: PreparedDeferredImportAssetFile[];
  usdSourceFiles: PreparedImportBlobFile[];
  libraryFiles: PreparedImportLibraryFile[];
  textFiles: PreparedImportTextFile[];
  preferredFileName: string | null;
  preResolvedImports: PreResolvedImportEntry[];
}

export interface ImportPreparationFileDescriptor {
  file: File;
  relativePath?: string;
}

export type ImportPreparationFileInput = File | ImportPreparationFileDescriptor;

export interface PrepareImportPayloadArgs {
  files: readonly ImportPreparationFileInput[];
  existingPaths: readonly string[];
  preResolvePreferredImport?: boolean;
  onProgress?: (progress: PrepareImportProgress) => void;
}

export type PrepareImportProgressPhase =
  | 'reading-archive'
  | 'extracting-files'
  | 'finalizing-import';

export interface PrepareImportProgress {
  phase: PrepareImportProgressPhase;
  progressPercent: number | null;
  processedEntries: number;
  totalEntries: number;
  processedBytes: number;
  totalBytes: number;
}

export interface PrepareImportWorkerRequest {
  type: 'prepare-import';
  requestId: number;
  files: ImportPreparationFileDescriptor[];
  existingPaths: string[];
  preResolvePreferredImport?: boolean;
}

export interface HydrateDeferredImportAssetsWorkerRequest {
  type: 'hydrate-deferred-import-assets';
  requestId: number;
  archiveFile: File;
  assetFiles: PreparedDeferredImportAssetFile[];
}

export interface PrepareImportWorkerResponse {
  type: 'prepare-import-result' | 'prepare-import-error' | 'prepare-import-progress';
  requestId: number;
  payload?: PreparedImportPayload;
  error?: string;
  progress?: PrepareImportProgress;
}

export interface HydrateDeferredImportAssetsWorkerResponse {
  type:
    | 'hydrate-deferred-import-assets-result'
    | 'hydrate-deferred-import-assets-error'
    | 'hydrate-deferred-import-assets-progress';
  requestId: number;
  assetFiles?: PreparedImportBlobFile[];
  error?: string;
  progress?: PrepareImportProgress;
}

export type ImportPreparationWorkerResponse =
  | PrepareImportWorkerResponse
  | HydrateDeferredImportAssetsWorkerResponse;

export type ImportPreparationWorkerRequest =
  | PrepareImportWorkerRequest
  | HydrateDeferredImportAssetsWorkerRequest;

export interface CollectedImportPayload {
  robotFiles: RobotFile[];
  assetFiles: PreparedImportBlobFile[];
  deferredAssetFiles: PreparedDeferredImportAssetFile[];
  usdSourceFiles: PreparedImportBlobFile[];
  libraryFiles: PreparedImportLibraryFile[];
  textFiles: PreparedImportTextFile[];
}

export function createEmptyCollectedImportPayload(): CollectedImportPayload {
  return {
    robotFiles: [],
    assetFiles: [],
    deferredAssetFiles: [],
    usdSourceFiles: [],
    libraryFiles: [],
    textFiles: [],
  };
}

export function appendCollectedImportPayload(
  target: CollectedImportPayload,
  next: CollectedImportPayload,
): void {
  target.robotFiles.push(...next.robotFiles);
  target.assetFiles.push(...next.assetFiles);
  target.deferredAssetFiles.push(...next.deferredAssetFiles);
  target.usdSourceFiles.push(...next.usdSourceFiles);
  target.libraryFiles.push(...next.libraryFiles);
  target.textFiles.push(...next.textFiles);
}

export function createEmptyPreparedImportPayload(): PreparedImportPayload {
  return {
    robotFiles: [],
    assetFiles: [],
    deferredAssetFiles: [],
    usdSourceFiles: [],
    libraryFiles: [],
    textFiles: [],
    preferredFileName: null,
    preResolvedImports: [],
  };
}

export function sortCollectedImportPayload(
  payload: CollectedImportPayload,
): CollectedImportPayload {
  return {
    robotFiles: [...payload.robotFiles].sort((left, right) => left.name.localeCompare(right.name)),
    assetFiles: [...payload.assetFiles].sort((left, right) => left.name.localeCompare(right.name)),
    deferredAssetFiles: [...payload.deferredAssetFiles].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    usdSourceFiles: [...payload.usdSourceFiles].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    libraryFiles: [...payload.libraryFiles].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
    textFiles: [...payload.textFiles].sort((left, right) => left.path.localeCompare(right.path)),
  };
}
