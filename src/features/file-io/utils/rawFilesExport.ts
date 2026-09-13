// 类型导入：运行时实例在各导出函数内动态 import 创建，避免把 export-vendor 拉进启动 chunk。
import type JSZip from 'jszip';
import type { RobotFile } from '@/types';

export interface RawFilesCollectOptions {
  assets: Record<string, string>;
  availableFiles: RobotFile[];
  allFileContents: Record<string, string>;
  selectedFile: RobotFile | null;
  onProgress?: (completed: number, total: number, label?: string) => void;
}

/**
 * Normalize a file path for consistent ZIP entries.
 * Strips leading `/`, replaces `\` with `/`, collapses `//`.
 */
function normalizePath(p: string): string {
  return p.replace(/^\/+/, '').replace(/\\/g, '/').replace(/\/+/g, '/');
}

type BlobEntryKind = 'asset' | 'file';

function createBlobFetchError(kind: BlobEntryKind, path: string, detail?: string): Error {
  return new Error(
    detail
      ? `[RawFilesExport] Failed to fetch ${kind} blob: ${path} (${detail})`
      : `[RawFilesExport] Failed to fetch ${kind} blob: ${path}`,
  );
}

/**
 * Fetch a blob URL and return its ArrayBuffer.
 * Throws when the blob cannot be read so the export fails fast.
 */
async function fetchBlobUrl(url: string, kind: BlobEntryKind, path: string): Promise<ArrayBuffer> {
  let response: Response;

  try {
    response = await fetch(url);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw createBlobFetchError(kind, path, detail);
  }

  if (!response.ok) {
    throw createBlobFetchError(kind, path, `${response.status} ${response.statusText}`.trim());
  }

  try {
    return await response.arrayBuffer();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw createBlobFetchError(kind, path, detail);
  }
}

/**
 * Collect all raw workspace files into a lightweight ZIP.
 *
 * Files are gathered from three sources:
 * 1. `assets` — mesh/texture blob URLs keyed by relative path
 * 2. `availableFiles` — robot definition files with `content` or `blobUrl`
 * 3. `allFileContents` — text file contents (e.g. xacro includes)
 *
 * Missing or unreadable asset payloads abort the export.
 */
export async function collectRawFilesZip(options: RawFilesCollectOptions): Promise<Blob> {
  const { assets, availableFiles, allFileContents, onProgress } = options;

  // 动态加载：该函数仅在用户导出时调用，避免把 jszip 拉进启动 chunk。
  const { default: JSZipRuntime } = await import('jszip');
  const zip = new JSZipRuntime();
  const addedPaths = new Set<string>();
  let completed = 0;

  // Estimate total: assets + availableFiles + allFileContents
  const estimatedTotal =
    Object.keys(assets).length + availableFiles.length + Object.keys(allFileContents).length;

  const reportProgress = (label?: string) => {
    completed += 1;
    onProgress?.(completed, estimatedTotal, label);
  };

  // --- 1. Add mesh/texture assets ---
  for (const [rawPath, url] of Object.entries(assets)) {
    const path = normalizePath(rawPath);
    if (!path || addedPaths.has(path)) {
      reportProgress(path);
      continue;
    }

    try {
      const buffer = await fetchBlobUrl(url, 'asset', path);
      zip.file(path, buffer);
      addedPaths.add(path);
    } finally {
      reportProgress(path);
    }
  }

  // --- 2. Add robot definition files ---
  const textFormats = new Set(['urdf', 'mjcf', 'xacro', 'sdf']);

  for (const file of availableFiles) {
    const path = normalizePath(file.name);
    if (!path || addedPaths.has(path)) {
      reportProgress(path);
      continue;
    }

    if (textFormats.has(file.format) && file.content) {
      zip.file(path, file.content);
      addedPaths.add(path);
    } else if (file.blobUrl) {
      try {
        const buffer = await fetchBlobUrl(file.blobUrl, 'file', path);
        zip.file(path, buffer);
        addedPaths.add(path);
      } finally {
        reportProgress(path);
      }
      continue;
    } else if (file.content) {
      // Fallback: treat content as text
      zip.file(path, file.content);
      addedPaths.add(path);
    }
    reportProgress(path);
  }

  // --- 3. Add text file contents (deduplicated) ---
  for (const [rawPath, content] of Object.entries(allFileContents)) {
    const path = normalizePath(rawPath);
    if (!path || addedPaths.has(path)) {
      reportProgress(path);
      continue;
    }

    zip.file(path, content);
    addedPaths.add(path);
    reportProgress(path);
  }

  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
