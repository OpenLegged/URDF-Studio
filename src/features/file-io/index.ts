/**
 * File I/O Feature Module
 * Handles file import/export operations for URDF, MJCF, USD, Xacro formats
 */

// Types
export type {
  FileFormat,
  AssetFile,
  LibraryFile,
  ImportResult,
  ExportOptions,
  PdfExportOptions,
  ExportProgressState,
} from './types';
export type {
  ExportDialogConfig,
  ExportFormat,
  MjcfExportConfig,
  SdfExportConfig,
  UrdfExportConfig,
  XacroExportConfig,
  UsdExportConfig,
} from './components/ExportDialog';
export type {
  ExportRobotToUsdOptions,
  ExportRobotToUsdPayload,
  ExportRobotToUsdPhase,
  ExportRobotToUsdProgress,
  ProjectExportProgress,
  ProjectExportProgressPhase,
  ProjectImportResult,
  ImportedProjectArchiveData,
  ImportedProjectArchiveAssets,
  ImportedProjectAssets,
  ImportedProjectLibraryFile,
  ProjectImportWarning,
  UsdMeshCompressionOptions,
  ExportProjectParams,
  ProjectAssetsManifest,
  ProjectComponentSourceDraftEntry,
  ProjectComponentSourceDraftManifest,
  ProjectDerivedCaches,
  ProjectExportAssets,
  ProjectManifest,
} from './utils';
export type {
  MjcfVisualMeshVariant,
  PreparedMjcfMeshExportAssets,
  PrepareMjcfMeshExportAssetsOptions,
} from './utils/mjcfMeshExport';
export type { RawFilesCollectOptions } from './utils/rawFilesExport';

// Utilities
export {
  detectFormat,
  isRobotDefinitionFile,
  isAssetFile,
  isMotorLibraryFile,
  isMeshFile,
  shouldSkipPath,
  generateBOM,
  createAssetUrls,
  collectReferencedMeshes,
  fetchMeshBlobs,
  downloadBlob,
  prepareMjcfMeshExportAssets,
  assertUsdExportWorkerSupport,
  disposeUsdExportWorker,
  exportRobotToUsd,
  exportRobotToUsdWithWorker,
  getUsdExportWorkerUnsupportedMeshPaths,
  exportLibraryRobotFile,
  getDroppedFiles,
  getDroppedFilesFromEntries,
  isUsdExportWorkerSupportedMeshPath,
  createImportPathCollisionMap,
  remapImportedPath,
  exportProject,
  exportProjectWithWorker,
  buildProjectArchiveBlob,
  buildProjectArchiveBlobWithWorker,
  disposeProjectArchiveWorker,
  assertProjectArchiveWithinLimits,
  assertProjectArchiveEntryPath,
  DEFAULT_PROJECT_ARCHIVE_LIMITS,
  getProjectArchiveEntryUncompressedSize,
  loadProjectArchiveZip,
  importProject,
  importProjectWithWorker,
  disposeProjectImportWorker,
  USD_EXPORT_WORKER_SUPPORTED_MESH_EXTENSIONS,
} from './utils';
export type {
  BuildProjectArchiveBlobOptions,
  ProjectArchiveEntryData,
  ProjectArchiveLimits,
} from './utils';
export { collectRawFilesZip } from './utils/rawFilesExport';

// Hooks
export { useSnapshot, usePdfExport } from './hooks';

export { ExportDialog } from './components/ExportDialog';
export { EXPORT_FORMATS } from './components/ExportDialog';
export { ExportProgressDialog } from './components/ExportProgressDialog';
export { DisconnectedWorkspaceUrdfExportDialog } from './components/DisconnectedWorkspaceUrdfExportDialog';
