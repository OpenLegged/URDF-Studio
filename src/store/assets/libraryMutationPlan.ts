import { normalizeLibraryPathKey } from '@/core/utils/pathKeys';
import type {
  LoadingProgressMode,
  RobotFile,
  UsdPreparedExportCache,
  UsdSceneSnapshot,
} from '@/types';

export type DocumentLoadStatus = 'idle' | 'loading' | 'hydrating' | 'ready' | 'error';

export interface DocumentLoadLifecycleState {
  status: DocumentLoadStatus;
  fileName: string | null;
  format: RobotFile['format'] | null;
}

export interface DocumentLoadState {
  status: DocumentLoadStatus;
  fileName: string | null;
  format: RobotFile['format'] | null;
  error: string | null;
  phase?: string | null;
  message?: string | null;
  progressMode?: LoadingProgressMode | null;
  progressPercent?: number | null;
  loadedCount?: number | null;
  totalCount?: number | null;
}

export const DEFAULT_DOCUMENT_LOAD_STATE: DocumentLoadState = {
  status: 'idle',
  fileName: null,
  format: null,
  error: null,
};

export interface LibraryMutationState {
  availableFiles: RobotFile[];
  selectedFile: RobotFile | null;
  allFileContents: Record<string, string>;
  assets: Record<string, string>;
  usdSceneSnapshots: Record<string, UsdSceneSnapshot>;
  usdPreparedExportCaches: Record<string, UsdPreparedExportCache>;
  documentLoadState: DocumentLoadState;
}

export type LibraryMutationPlanKind =
  | 'remove-file'
  | 'remove-folder'
  | 'rename-folder'
  | 'clear-library';

export interface LibraryMutationPlan {
  kind: LibraryMutationPlanKind;
  previousState: LibraryMutationState;
  nextState: LibraryMutationState;
  orphanBlobUrls: string[];
}

export type RenameRobotFolderResult =
  | { ok: true; nextPath: string }
  | { ok: false; reason: 'missing' | 'invalid' | 'conflict' };

export interface RenameRobotFolderPlanResult {
  result: RenameRobotFolderResult;
  plan: LibraryMutationPlan | null;
}

export interface RobotFolderRenameTarget {
  normalizedFolder: string;
  sanitizedName: string;
  parentPath: string;
  nextFolderPath: string;
}

export function toDocumentLoadLifecycleState(state: DocumentLoadState): DocumentLoadLifecycleState {
  return {
    status: state.status,
    fileName: state.fileName,
    format: state.format,
  };
}

function normalizeUsdSceneSnapshotKey(path: string | null | undefined): string {
  return normalizeLibraryPathKey(path);
}

function normalizeLibraryPath(path: string | null | undefined): string {
  return normalizeLibraryPathKey(path);
}

function isSameOrNestedLibraryPath(path: string, basePath: string): boolean {
  const normalizedPath = normalizeLibraryPath(path);
  return normalizedPath === basePath || normalizedPath.startsWith(`${basePath}/`);
}

function replaceLibraryPathPrefix(path: string, fromPath: string, toPath: string): string {
  const normalizedPath = normalizeLibraryPath(path);
  if (normalizedPath === fromPath) {
    return toPath;
  }

  if (normalizedPath.startsWith(`${fromPath}/`)) {
    return `${toPath}/${normalizedPath.slice(fromPath.length + 1)}`;
  }

  return normalizedPath;
}

export function resolveRobotFolderRenameTarget(
  folderPath: string,
  nextName: string,
): RobotFolderRenameTarget {
  const normalizedFolder = normalizeLibraryPath(folderPath);
  const sanitizedName = nextName.trim().replace(/[\\/]+/g, '');
  const parentPath = normalizedFolder.includes('/')
    ? normalizedFolder.split('/').slice(0, -1).join('/')
    : '';
  const nextFolderPath = parentPath ? `${parentPath}/${sanitizedName}` : sanitizedName;
  return { normalizedFolder, sanitizedName, parentPath, nextFolderPath };
}

function collectBlobUrlUsageCounts(assets: Record<string, string>): Map<string, number> {
  const usageCounts = new Map<string, number>();

  Object.values(assets).forEach((url) => {
    if (!url.startsWith('blob:')) {
      return;
    }

    usageCounts.set(url, (usageCounts.get(url) ?? 0) + 1);
  });

  return usageCounts;
}

function collectOrphanBlobUrls(
  previousAssets: Record<string, string>,
  nextAssets: Record<string, string>,
): string[] {
  const nextUsageCounts = collectBlobUrlUsageCounts(nextAssets);
  const orphanUrls = new Set<string>();

  Object.values(previousAssets).forEach((url) => {
    if (url.startsWith('blob:') && !nextUsageCounts.has(url)) {
      orphanUrls.add(url);
    }
  });

  return Array.from(orphanUrls);
}

function createPlan(
  kind: LibraryMutationPlanKind,
  previousState: LibraryMutationState,
  nextState: LibraryMutationState,
): LibraryMutationPlan {
  return {
    kind,
    previousState,
    nextState,
    orphanBlobUrls: collectOrphanBlobUrls(previousState.assets, nextState.assets),
  };
}

export function pruneUsdSceneSnapshots(
  snapshots: Record<string, UsdSceneSnapshot>,
  files: RobotFile[],
): Record<string, UsdSceneSnapshot> {
  const allowedKeys = new Set(
    files
      .filter((file) => file.format === 'usd')
      .map((file) => normalizeUsdSceneSnapshotKey(file.name))
      .filter(Boolean),
  );

  if (allowedKeys.size === 0) {
    return {};
  }

  const nextSnapshots: Record<string, UsdSceneSnapshot> = {};
  Object.entries(snapshots).forEach(([key, snapshot]) => {
    const normalizedKey = normalizeUsdSceneSnapshotKey(snapshot.stageSourcePath || key);
    if (allowedKeys.has(normalizedKey)) {
      nextSnapshots[normalizedKey] = snapshot;
    }
  });

  return nextSnapshots;
}

export function pruneUsdPreparedExportCaches(
  caches: Record<string, UsdPreparedExportCache>,
  files: RobotFile[],
): Record<string, UsdPreparedExportCache> {
  const allowedKeys = new Set(
    files
      .filter((file) => file.format === 'usd')
      .map((file) => normalizeUsdSceneSnapshotKey(file.name))
      .filter(Boolean),
  );

  if (allowedKeys.size === 0) {
    return {};
  }

  const nextCaches: Record<string, UsdPreparedExportCache> = {};
  Object.entries(caches).forEach(([key, cache]) => {
    const normalizedKey = normalizeUsdSceneSnapshotKey(cache.stageSourcePath || key);
    if (allowedKeys.has(normalizedKey)) {
      nextCaches[normalizedKey] = cache;
    }
  });

  return nextCaches;
}

export function createRemoveRobotFilePlan(
  state: LibraryMutationState,
  fileName: string,
): LibraryMutationPlan | null {
  if (!state.availableFiles.some((file) => file.name === fileName)) return null;

  const nextAvailableFiles = state.availableFiles.filter((file) => file.name !== fileName);
  const nextSelectedFile = state.selectedFile?.name === fileName ? null : state.selectedFile;

  const nextAllFileContents = { ...state.allFileContents };
  delete nextAllFileContents[fileName];

  const removableKeys = new Set<string>([fileName]);
  const baseName = fileName.split('/').pop();
  if (baseName) {
    removableKeys.add(baseName);
    removableKeys.add(`/meshes/${baseName}`);
  }

  const parts = fileName.split('/');
  for (let i = 0; i < parts.length; i += 1) {
    const subPath = parts.slice(i).join('/');
    removableKeys.add(subPath);
    removableKeys.add(`/${subPath}`);
  }

  const nextAssets: Record<string, string> = {};

  Object.entries(state.assets).forEach(([key, url]) => {
    if (removableKeys.has(key)) return;
    nextAssets[key] = url;
  });

  const removedSnapshotKey = normalizeUsdSceneSnapshotKey(fileName);
  const nextUsdSceneSnapshots: Record<string, UsdSceneSnapshot> = {};
  Object.entries(state.usdSceneSnapshots).forEach(([key, snapshot]) => {
    const normalizedKey = normalizeUsdSceneSnapshotKey(snapshot.stageSourcePath || key);
    if (normalizedKey !== removedSnapshotKey) {
      nextUsdSceneSnapshots[normalizedKey] = snapshot;
    }
  });

  const nextUsdPreparedExportCaches: Record<string, UsdPreparedExportCache> = {};
  Object.entries(state.usdPreparedExportCaches).forEach(([key, cache]) => {
    const normalizedKey = normalizeUsdSceneSnapshotKey(cache.stageSourcePath || key);
    if (normalizedKey !== removedSnapshotKey) {
      nextUsdPreparedExportCaches[normalizedKey] = cache;
    }
  });

  return createPlan('remove-file', state, {
    ...state,
    availableFiles: nextAvailableFiles,
    selectedFile: nextSelectedFile,
    allFileContents: nextAllFileContents,
    assets: nextAssets,
    usdSceneSnapshots: nextUsdSceneSnapshots,
    usdPreparedExportCaches: nextUsdPreparedExportCaches,
    documentLoadState:
      state.documentLoadState.fileName === fileName
        ? DEFAULT_DOCUMENT_LOAD_STATE
        : state.documentLoadState,
  });
}

export function createRemoveRobotFolderPlan(
  state: LibraryMutationState,
  folderPath: string,
): LibraryMutationPlan | null {
  const normalizedFolder = normalizeUsdSceneSnapshotKey(folderPath).replace(/\/+$/, '');
  if (!normalizedFolder) return null;

  const shouldRemove = (path: string) =>
    normalizeUsdSceneSnapshotKey(path) === normalizedFolder ||
    normalizeUsdSceneSnapshotKey(path).startsWith(`${normalizedFolder}/`);

  const removedFiles = state.availableFiles.filter((file) => shouldRemove(file.name));
  if (removedFiles.length === 0) return null;

  const removedFileNames = new Set(removedFiles.map((file) => file.name));
  const nextAvailableFiles = state.availableFiles.filter(
    (file) => !removedFileNames.has(file.name),
  );
  const nextSelectedFile =
    state.selectedFile && shouldRemove(state.selectedFile.name) ? null : state.selectedFile;

  const nextAllFileContents: Record<string, string> = {};
  Object.entries(state.allFileContents).forEach(([path, content]) => {
    if (!shouldRemove(path)) {
      nextAllFileContents[path] = content;
    }
  });

  const nextAssets: Record<string, string> = {};
  Object.entries(state.assets).forEach(([key, url]) => {
    if (shouldRemove(key)) return;
    nextAssets[key] = url;
  });

  const nextUsdSceneSnapshots: Record<string, UsdSceneSnapshot> = {};
  Object.entries(state.usdSceneSnapshots).forEach(([key, snapshot]) => {
    const normalizedKey = normalizeUsdSceneSnapshotKey(snapshot.stageSourcePath || key);
    if (!shouldRemove(normalizedKey)) {
      nextUsdSceneSnapshots[normalizedKey] = snapshot;
    }
  });

  const nextUsdPreparedExportCaches: Record<string, UsdPreparedExportCache> = {};
  Object.entries(state.usdPreparedExportCaches).forEach(([key, cache]) => {
    const normalizedKey = normalizeUsdSceneSnapshotKey(cache.stageSourcePath || key);
    if (!shouldRemove(normalizedKey)) {
      nextUsdPreparedExportCaches[normalizedKey] = cache;
    }
  });

  return createPlan('remove-folder', state, {
    ...state,
    availableFiles: nextAvailableFiles,
    selectedFile: nextSelectedFile,
    allFileContents: nextAllFileContents,
    assets: nextAssets,
    usdSceneSnapshots: nextUsdSceneSnapshots,
    usdPreparedExportCaches: nextUsdPreparedExportCaches,
    documentLoadState:
      state.documentLoadState.fileName && shouldRemove(state.documentLoadState.fileName)
        ? DEFAULT_DOCUMENT_LOAD_STATE
        : state.documentLoadState,
  });
}

export function createRenameRobotFolderPlan(
  state: LibraryMutationState,
  folderPath: string,
  nextName: string,
): RenameRobotFolderPlanResult {
  const { normalizedFolder, sanitizedName, nextFolderPath } = resolveRobotFolderRenameTarget(
    folderPath,
    nextName,
  );

  if (!normalizedFolder) {
    return { result: { ok: false, reason: 'missing' }, plan: null };
  }

  if (!sanitizedName || sanitizedName === '.' || sanitizedName === '..') {
    return { result: { ok: false, reason: 'invalid' }, plan: null };
  }

  if (nextFolderPath === normalizedFolder) {
    return {
      result: { ok: true, nextPath: nextFolderPath },
      plan: createPlan('rename-folder', state, state),
    };
  }

  const shouldRename = (path: string) => isSameOrNestedLibraryPath(path, normalizedFolder);
  const renamePath = (path: string) =>
    replaceLibraryPathPrefix(path, normalizedFolder, nextFolderPath);

  const hasExistingFolder =
    state.availableFiles.some((file) => shouldRename(file.name)) ||
    Object.keys(state.assets).some(shouldRename) ||
    Object.keys(state.allFileContents).some(shouldRename) ||
    Object.keys(state.usdSceneSnapshots).some(shouldRename) ||
    Object.keys(state.usdPreparedExportCaches).some(shouldRename);

  if (!hasExistingFolder) {
    return { result: { ok: false, reason: 'missing' }, plan: null };
  }

  const collidesWithExistingPath = (path: string) => {
    const normalizedPath = normalizeLibraryPath(path);
    if (!normalizedPath || shouldRename(normalizedPath)) return false;
    return normalizedPath === nextFolderPath || normalizedPath.startsWith(`${nextFolderPath}/`);
  };

  const hasConflict =
    state.availableFiles.some((file) => collidesWithExistingPath(file.name)) ||
    Object.keys(state.assets).some(collidesWithExistingPath) ||
    Object.keys(state.allFileContents).some(collidesWithExistingPath) ||
    Object.keys(state.usdSceneSnapshots).some(collidesWithExistingPath) ||
    Object.keys(state.usdPreparedExportCaches).some(collidesWithExistingPath);

  if (hasConflict) {
    return { result: { ok: false, reason: 'conflict' }, plan: null };
  }

  const nextAvailableFiles = state.availableFiles.map((file) =>
    shouldRename(file.name) ? { ...file, name: renamePath(file.name) } : file,
  );

  const nextSelectedFile = state.selectedFile
    ? shouldRename(state.selectedFile.name)
      ? { ...state.selectedFile, name: renamePath(state.selectedFile.name) }
      : state.selectedFile
    : null;

  const nextAllFileContents = Object.fromEntries(
    Object.entries(state.allFileContents).map(([path, content]) => [
      shouldRename(path) ? renamePath(path) : path,
      content,
    ]),
  );

  const nextAssets = Object.fromEntries(
    Object.entries(state.assets).map(([path, url]) => [
      shouldRename(path) ? renamePath(path) : path,
      url,
    ]),
  );

  const nextUsdSceneSnapshots = Object.fromEntries(
    Object.entries(state.usdSceneSnapshots).map(([path, snapshot]) => {
      const sourcePath = snapshot.stageSourcePath || path;
      const nextPath = shouldRename(sourcePath)
        ? renamePath(sourcePath)
        : normalizeLibraryPath(path);
      return [
        nextPath,
        shouldRename(sourcePath)
          ? { ...snapshot, stageSourcePath: renamePath(sourcePath) }
          : snapshot,
      ];
    }),
  );

  const nextUsdPreparedExportCaches = Object.fromEntries(
    Object.entries(state.usdPreparedExportCaches).map(([path, cache]) => {
      const sourcePath = cache.stageSourcePath || path;
      const nextPath = shouldRename(sourcePath)
        ? renamePath(sourcePath)
        : normalizeLibraryPath(path);
      return [
        nextPath,
        shouldRename(sourcePath) ? { ...cache, stageSourcePath: renamePath(sourcePath) } : cache,
      ];
    }),
  );

  const nextDocumentLoadState =
    state.documentLoadState.fileName && shouldRename(state.documentLoadState.fileName)
      ? {
          ...state.documentLoadState,
          fileName: renamePath(state.documentLoadState.fileName),
        }
      : state.documentLoadState;

  return {
    result: { ok: true, nextPath: nextFolderPath },
    plan: createPlan('rename-folder', state, {
      ...state,
      availableFiles: nextAvailableFiles,
      selectedFile: nextSelectedFile,
      allFileContents: nextAllFileContents,
      assets: nextAssets,
      usdSceneSnapshots: nextUsdSceneSnapshots,
      usdPreparedExportCaches: nextUsdPreparedExportCaches,
      documentLoadState: nextDocumentLoadState,
    }),
  };
}

export function createClearRobotLibraryPlan(state: LibraryMutationState): LibraryMutationPlan {
  return createPlan('clear-library', state, {
    ...state,
    availableFiles: [],
    selectedFile: null,
    allFileContents: {},
    assets: {},
    usdSceneSnapshots: {},
    usdPreparedExportCaches: {},
    documentLoadState: DEFAULT_DOCUMENT_LOAD_STATE,
  });
}

export function isLibraryMutationPlanCurrent(
  currentState: LibraryMutationState,
  plan: LibraryMutationPlan,
): boolean {
  const expected = plan.previousState;
  return (
    currentState.availableFiles === expected.availableFiles &&
    currentState.selectedFile === expected.selectedFile &&
    currentState.allFileContents === expected.allFileContents &&
    currentState.assets === expected.assets &&
    currentState.usdSceneSnapshots === expected.usdSceneSnapshots &&
    currentState.usdPreparedExportCaches === expected.usdPreparedExportCaches &&
    currentState.documentLoadState === expected.documentLoadState
  );
}
