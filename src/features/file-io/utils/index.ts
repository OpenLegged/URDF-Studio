/**
 * File I/O Utilities
 * Re-export all utility functions
 */

export {
  detectFormat,
  isRobotDefinitionFile,
  isAssetFile,
  isMotorLibraryFile,
  isMeshFile,
  shouldSkipPath,
} from './formatDetection';

export { generateBOM } from './bomGenerator';

export {
  createAssetUrls,
  collectReferencedMeshes,
  fetchMeshBlobs,
  downloadBlob,
} from './assetUtils';

export { exportLibraryRobotFile } from './libraryFileExport';
export type {
  LibraryExportFormat,
  ExportLibraryRobotFileOptions,
  ExportLibraryRobotFileResult,
} from './libraryFileExport';

export { getDroppedFiles, getDroppedFilesFromEntries } from './fileTraverser';
export { createImportPathCollisionMap, remapImportedPath } from './libraryImportPathCollisions';

export { exportProject, exportProjectWithWorker } from './projectExport';
export { importProject } from './projectImport';
export { disposeProjectImportWorker, importProjectWithWorker } from './projectImportWorkerBridge';
export {
  assertProjectArchiveWithinLimits,
  buildProjectArchiveBlob,
  DEFAULT_PROJECT_ARCHIVE_LIMITS,
  getProjectArchiveEntryUncompressedSize,
  loadProjectArchiveZip,
} from './projectArchiveZip';
export { assertProjectArchiveEntryPath } from './projectArchivePath';
export {
  buildProjectArchiveBlobWithWorker,
  disposeProjectArchiveWorker,
} from './projectArchiveWorkerBridge';
export type {
  BuildProjectArchiveBlobOptions,
  ProjectArchiveLimits,
} from './projectArchiveZip';
export type { ProjectArchiveEntryData } from './projectArchiveWorkerTransfer';
export { prepareMjcfMeshExportAssets } from './mjcfMeshExport';
export {
  disposeUsdExportWorker,
  exportRobotToUsd,
  exportRobotToUsdWithWorker,
  assertUsdExportWorkerSupport,
  getUsdExportWorkerUnsupportedMeshPaths,
  isUsdExportWorkerSupportedMeshPath,
  USD_EXPORT_WORKER_SUPPORTED_MESH_EXTENSIONS,
} from './usdExport';
export type {
  ImportedProjectArchiveData,
  ImportedProjectArchiveAssets,
  ImportedProjectAssets,
  ImportedProjectLibraryFile,
  ProjectImportResult,
  ProjectImportWarning,
} from './projectImport';
export type {
  ExportProjectParams,
  ProjectAssetsManifest,
  ProjectComponentSourceDraftEntry,
  ProjectComponentSourceDraftManifest,
  ProjectDerivedCaches,
  ProjectExportAssets,
  ProjectManifest,
  ProjectExportProgress,
  ProjectExportProgressPhase,
} from './projectExport';
export type {
  ExportRobotToUsdOptions,
  ExportRobotToUsdPayload,
  ExportRobotToUsdPhase,
  ExportRobotToUsdProgress,
  UsdMeshCompressionOptions,
} from './usdExport';
