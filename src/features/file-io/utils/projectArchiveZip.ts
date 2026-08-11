import JSZip from 'jszip';

import { assertProjectArchiveEntryPath } from './projectArchivePath.ts';
import type { ProjectArchiveEntryData } from './projectArchiveWorkerTransfer.ts';

export interface ProjectArchiveLimits {
  maxArchiveBytes: number;
  maxEntries: number;
  maxExtractedBytes: number;
  maxSingleEntryBytes: number;
}

export const DEFAULT_PROJECT_ARCHIVE_LIMITS: Readonly<ProjectArchiveLimits> = {
  maxArchiveBytes: 512 * 1024 * 1024,
  maxEntries: 10_000,
  maxExtractedBytes: 1024 * 1024 * 1024,
  maxSingleEntryBytes: 512 * 1024 * 1024,
};

export interface BuildProjectArchiveBlobOptions {
  compressionLevel?: number;
  onProgress?: (progress: {
    completed: number;
    total: number;
    label?: string;
  }) => void;
}

function normalizeProjectArchiveEntryForZip(entry: ProjectArchiveEntryData): ProjectArchiveEntryData | Promise<ArrayBuffer> {
  if (entry instanceof Blob) {
    return entry.arrayBuffer();
  }

  return entry;
}

function archiveInputByteLength(file: File | Blob | ArrayBuffer | Uint8Array): number {
  return file instanceof Blob ? file.size : file.byteLength;
}

export function getProjectArchiveEntryUncompressedSize(entry: JSZip.JSZipObject): number {
  const metadata = entry as JSZip.JSZipObject & {
    _data?: { uncompressedSize?: number };
  };
  return Number(metadata._data?.uncompressedSize ?? 0);
}

export function assertProjectArchiveWithinLimits(
  file: File | Blob | ArrayBuffer | Uint8Array,
  zip?: JSZip,
  limits: Readonly<ProjectArchiveLimits> = DEFAULT_PROJECT_ARCHIVE_LIMITS,
): void {
  const inputBytes = archiveInputByteLength(file);
  if (inputBytes > limits.maxArchiveBytes) {
    throw new Error(
      `Project archive is too large (${inputBytes} bytes). Maximum: ${limits.maxArchiveBytes} bytes.`,
    );
  }
  if (!zip) return;

  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > limits.maxEntries) {
    throw new Error(
      `Project archive contains too many files (${entries.length}). Maximum: ${limits.maxEntries}.`,
    );
  }

  let extractedBytes = 0;
  entries.forEach((entry, index) => {
    assertProjectArchiveEntryPath(entry.name, `archive entry[${index}]`);
    const entrySize = getProjectArchiveEntryUncompressedSize(entry);
    extractedBytes += entrySize;
    if (entrySize > limits.maxSingleEntryBytes) {
      throw new Error(
        `Project archive entry "${entry.name}" is too large (${entrySize} bytes). Maximum: ${limits.maxSingleEntryBytes} bytes.`,
      );
    }
  });
  if (extractedBytes > limits.maxExtractedBytes) {
    throw new Error(
      `Project archive expands to too much data (${extractedBytes} bytes). Maximum: ${limits.maxExtractedBytes} bytes.`,
    );
  }
}

export async function loadProjectArchiveZip(
  file: File | Blob | ArrayBuffer | Uint8Array,
  limits: Readonly<ProjectArchiveLimits> = DEFAULT_PROJECT_ARCHIVE_LIMITS,
): Promise<JSZip> {
  assertProjectArchiveWithinLimits(file, undefined, limits);
  const zip = await JSZip.loadAsync(
    file instanceof Blob ? await file.arrayBuffer() : file,
  );
  assertProjectArchiveWithinLimits(file, zip, limits);
  return zip;
}

export function appendProjectArchiveEntriesToZip(
  zip: JSZip,
  entries: Map<string, ProjectArchiveEntryData>,
): void {
  [...entries.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([path, entry]) => {
      assertProjectArchiveEntryPath(path, `archive entry "${path}"`);
      zip.file(path, normalizeProjectArchiveEntryForZip(entry), {
        // ZIP stores local DOS time. A fixed local date keeps byte output
        // deterministic without depending on the host time zone.
        date: new Date(1980, 0, 1, 0, 0, 0),
        createFolders: false,
      });
  });
}

export async function buildProjectArchiveBlob(
  entries: Map<string, ProjectArchiveEntryData>,
  {
    compressionLevel = 6,
    onProgress,
  }: BuildProjectArchiveBlobOptions = {},
): Promise<Blob> {
  const zip = new JSZip();
  appendProjectArchiveEntriesToZip(zip, entries);

  return await zip.generateAsync(
    {
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: compressionLevel },
      platform: 'DOS',
    },
    (metadata) => {
      onProgress?.({
        completed: Math.round(metadata.percent),
        total: 100,
        label: metadata.currentFile ?? undefined,
      });
    },
  );
}
