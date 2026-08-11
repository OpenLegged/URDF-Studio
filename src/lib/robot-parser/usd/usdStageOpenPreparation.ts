export interface PreparedUsdPreloadFile {
  path: string;
  blob: Blob | null;
  bytes?: ArrayBuffer | Uint8Array | null;
  mimeType?: string | null;
  transferBytes?: boolean;
  error?: string | null;
}

export interface PreparedUsdStageOpenMetrics {
  preloadFileCount: number;
  successfulPreloadFileCount: number;
  failedPreloadFileCount: number;
  totalByteCount: number;
  blobByteCount: number;
  bytesByteCount: number;
  normalizedTextFileCount: number;
  normalizedTextByteCount: number;
  blobBackedTextProbeCount: number;
  transferableByteCount: number;
}

export interface PreparedUsdStageOpenData {
  stageSourcePath: string;
  criticalDependencyPaths: string[];
  preloadFiles: PreparedUsdPreloadFile[];
  metrics?: PreparedUsdStageOpenMetrics;
}
