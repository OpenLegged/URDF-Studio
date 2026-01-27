/**
 * File I/O Types
 * Type definitions for file import/export operations
 */

/** Supported robot file formats */
export type FileFormat = 'urdf' | 'mjcf' | 'usd' | 'xacro';

/** Asset file with blob data */
export interface AssetFile {
  name: string;
  blob: Blob;
}

/** Library file with path and content */
export interface LibraryFile {
  path: string;
  content: string;
}

/** Result of file import operation */
export interface ImportResult {
  robotFiles: import('@/types').RobotFile[];
  assetFiles: AssetFile[];
  libraryFiles: LibraryFile[];
}

/** Export options */
export interface ExportOptions {
  includeExtended?: boolean;
  includeBOM?: boolean;
  includeMuJoCo?: boolean;
  includeMeshes?: boolean;
}

/** PDF report options */
export interface PdfExportOptions {
  includeScore?: boolean;
  includeDetails?: boolean;
}
