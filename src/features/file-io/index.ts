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
} from './types';

// Utilities
export {
  detectFormat,
  isRobotDefinitionFile,
  isAssetFile,
  isMotorLibraryFile,
  shouldSkipPath,
  generateBOM,
  createAssetUrls,
  collectReferencedMeshes,
  fetchMeshBlobs,
  downloadBlob,
} from './utils';

// Hooks
export {
  useFileImport,
  useFileExport,
  useSnapshot,
  usePdfExport,
} from './hooks';
