import type { UsdLoadingProgress } from '../../types';

export type UsdModule = {
  FS_createPath?: (...args: any[]) => void;
  FS_createDataFile?: (...args: any[]) => void;
  FS_readFile?: (path: string, opts?: { encoding?: 'utf8'; flags?: string }) => Uint8Array | string;
  FS_writeFile?: (
    path: string,
    data: string | ArrayLike<number> | ArrayBufferView,
    opts?: { flags?: string },
  ) => void;
  FS_unlink?: (...args: any[]) => void;
  flushPendingDeletes?: () => void;
  HdWebSyncDriver?: new (...args: any[]) => any;
};

export type UsdFsHelperInstance = {
  canOperateOnUsdFilesystem: () => boolean;
  clearStageFiles: (usdRoot: { clear?: () => void } | null) => void;
  hasVirtualFilePath: (filePath: string) => boolean;
  trackVirtualFilePath?: (filePath: string) => void;
  untrackVirtualFilePath?: (filePath: string) => void;
};

export interface LoadUsdStageArgs {
  USD: UsdModule;
  usdFsHelper: UsdFsHelperInstance;
  messageLog?: HTMLElement | null;
  progressBar?: HTMLElement | null;
  progressLabel?: HTMLElement | null;
  showLoadUi?: boolean;
  readStageMetadata?: boolean;
  loadCollisionPrims?: boolean;
  loadVisualPrims?: boolean;
  loadPassLabel?: string;
  params: URLSearchParams;
  displayName: string;
  pathToLoad: string;
  isLoadActive: () => boolean;
  /** Synchronous ownership handoff before the loader can yield to a replacement. */
  onStageResourcesCreated?: () => void;
  debugFileHandling?: boolean;
  onResolvedFilename: (normalizedPath: string, resolvedDisplayName: string) => void;
  applyMeshFilters: () => void;
  rebuildLinkAxes: () => void;
  renderFrame: () => void;
  onProgress?: (progress: UsdLoadingProgress) => void;
}

export interface LoadUsdStageResult {
  driver: any;
  ready: boolean;
  drawFailed: boolean;
  drawFailureReason?: string | null;
  timeout: number;
  endTimeCode: number;
  normalizedPath: string;
  loadedCollisionPrims: boolean;
  loadedVisualPrims: boolean;
}

export type LoadUsdStageFn = (args: LoadUsdStageArgs) => Promise<LoadUsdStageResult | null>;
