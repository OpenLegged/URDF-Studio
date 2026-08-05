/**
 * Assets Store - Manages mesh and texture file resources
 * Handles blob URLs for imported 3D assets
 */
import { create } from 'zustand';
import type {
  ComponentSourceDraft,
  LoadingProgressMode,
  MotorSpec,
  RobotFile,
  UsdBakedScene,
  UsdPreparedExportCache,
  UsdSceneSnapshot,
} from '@/types';
import { DEFAULT_MOTOR_LIBRARY, normalizeMotorLibrary } from '@/shared/data/motorLibrary';
import { normalizeLibraryPathKey } from '@/core/utils/pathKeys';

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

const DEFAULT_DOCUMENT_LOAD_STATE: DocumentLoadState = {
  status: 'idle',
  fileName: null,
  format: null,
  error: null,
};

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

export type RenameRobotFolderResult =
  | { ok: true; nextPath: string }
  | { ok: false; reason: 'missing' | 'invalid' | 'conflict' };

export interface RobotFolderRenameTarget {
  normalizedFolder: string;
  sanitizedName: string;
  parentPath: string;
  nextFolderPath: string;
}

/** Resolve the exact path policy shared by asset and workspace source renames. */
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

function pruneUsdSceneSnapshots(
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

function pruneUsdPreparedExportCaches(
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

function revokeBlobUrls(urls: Iterable<string>): void {
  Array.from(new Set(urls)).forEach((url) => {
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  });
}

function revokeReplacedBlobUrls(
  previousAssets: Record<string, string>,
  nextAssets: Record<string, string>,
  keysToCheck?: Iterable<string>,
): void {
  const nextBlobUrlUsageCounts = collectBlobUrlUsageCounts(nextAssets);
  const targetKeys = keysToCheck ? Array.from(keysToCheck) : Object.keys(previousAssets);

  targetKeys.forEach((key) => {
    const previousUrl = previousAssets[key];
    if (!previousUrl?.startsWith('blob:')) {
      return;
    }

    if (previousUrl === nextAssets[key]) {
      return;
    }

    if (!nextBlobUrlUsageCounts.has(previousUrl)) {
      URL.revokeObjectURL(previousUrl);
    }
  });
}

interface AssetsState {
  // Mesh and texture assets (blob URLs)
  assets: Record<string, string>;
  setAssets: (assets: Record<string, string>) => void;
  addAsset: (path: string, url: string) => void;
  addAssets: (newAssets: Record<string, string>) => void;
  removeAsset: (path: string) => void;
  getAsset: (path: string) => string | undefined;
  clearAssets: () => void;

  // Available robot files (URDF/MJCF/USD/Xacro)
  availableFiles: RobotFile[];
  setAvailableFiles: (files: RobotFile[]) => void;
  addRobotFile: (file: RobotFile) => void;
  removeRobotFile: (fileName: string) => void;
  removeRobotFolder: (folderPath: string) => void;
  renameRobotFolder: (folderPath: string, nextName: string) => RenameRobotFolderResult;
  clearRobotLibrary: () => void;

  // Cached USD scene snapshots for export/runtime reuse
  usdSceneSnapshots: Record<string, UsdSceneSnapshot>;
  setUsdSceneSnapshot: (path: string, snapshot: UsdSceneSnapshot | null) => void;
  getUsdSceneSnapshot: (path: string) => UsdSceneSnapshot | null;
  clearUsdSceneSnapshots: () => void;
  setUsdBakedScene: (path: string, bakedScene: UsdBakedScene | null) => void;
  getUsdBakedScene: (path: string) => UsdBakedScene | null;
  clearUsdBakedScenes: () => void;

  // Prepared USD export caches for export without live snapshot recomputation
  usdPreparedExportCaches: Record<string, UsdPreparedExportCache>;
  setUsdPreparedExportCache: (path: string, cache: UsdPreparedExportCache | null) => void;
  getUsdPreparedExportCache: (path: string) => UsdPreparedExportCache | null;
  clearUsdPreparedExportCaches: () => void;

  // Currently selected file in file browser
  selectedFile: RobotFile | null;
  setSelectedFile: (file: RobotFile | null) => void;

  // Current document loading lifecycle
  documentLoadState: DocumentLoadState;
  setDocumentLoadState: (state: DocumentLoadState) => void;
  resetDocumentLoadState: () => void;

  // All text file contents for xacro includes
  allFileContents: Record<string, string>;
  setAllFileContents: (contents: Record<string, string>) => void;
  addFileContent: (path: string, content: string) => void;

  // Motor library
  motorLibrary: Record<string, MotorSpec[]>;
  setMotorLibrary: (library: Record<string, MotorSpec[]>) => void;
  addMotorSpec: (brand: string, spec: MotorSpec) => void;

  // Per-component editable sources. Library files remain immutable templates.
  componentSourceDrafts: Record<string, ComponentSourceDraft>;
  setComponentSourceDraft: (draft: ComponentSourceDraft) => void;
  removeComponentSourceDraft: (componentId: string) => void;
  pruneComponentSourceDrafts: (componentIds: readonly string[]) => void;
  replaceComponentSourceDrafts: (drafts: Record<string, ComponentSourceDraft>) => void;
  clearComponentSourceDrafts: () => void;

  // Upload a single file and create blob URL
  uploadAsset: (file: File) => string;

  // Cleanup all blob URLs
  revokeAllAssets: () => void;
}

export const useAssetsStore = create<AssetsState>()((set, get) => ({
  // Assets (blob URLs)
  assets: {},
  setAssets: (assets) =>
    set((state) => {
      revokeReplacedBlobUrls(state.assets, assets);
      return { assets };
    }),
  addAsset: (path, url) =>
    set((state) => {
      const nextAssets = { ...state.assets, [path]: url };
      revokeReplacedBlobUrls(state.assets, nextAssets, [path]);
      return { assets: nextAssets };
    }),
  addAssets: (newAssets) =>
    set((state) => {
      const nextAssets = { ...state.assets, ...newAssets };
      revokeReplacedBlobUrls(state.assets, nextAssets, Object.keys(newAssets));
      return { assets: nextAssets };
    }),
  removeAsset: (path) =>
    set((state) => {
      const removedUrl = state.assets[path];
      if (!removedUrl) {
        return state;
      }

      const nextAssets = { ...state.assets };
      delete nextAssets[path];
      revokeReplacedBlobUrls(state.assets, nextAssets, [path]);
      return { assets: nextAssets };
    }),
  getAsset: (path) => get().assets[path],
  clearAssets: () => {
    revokeBlobUrls(Object.values(get().assets));
    set({ assets: {} });
  },

  // Robot files
  availableFiles: [],
  setAvailableFiles: (files) =>
    set((state) => ({
      availableFiles: files,
      usdSceneSnapshots: pruneUsdSceneSnapshots(state.usdSceneSnapshots, files),
      usdPreparedExportCaches: pruneUsdPreparedExportCaches(state.usdPreparedExportCaches, files),
    })),
  addRobotFile: (file) =>
    set((state) => ({
      availableFiles: [...state.availableFiles, file],
    })),
  removeRobotFile: (fileName) =>
    set((state) => {
      if (!state.availableFiles.some((file) => file.name === fileName)) return state;

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

      const targetUrl = state.assets[fileName];
      const removeByUrl = Boolean(targetUrl && targetUrl.startsWith('blob:'));
      const nextAssets: Record<string, string> = {};

      Object.entries(state.assets).forEach(([key, url]) => {
        if (removableKeys.has(key)) return;
        if (removeByUrl && url === targetUrl) return;
        nextAssets[key] = url;
      });

      if (removeByUrl && targetUrl) {
        URL.revokeObjectURL(targetUrl);
      }

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

      return {
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
      };
    }),
  removeRobotFolder: (folderPath) =>
    set((state) => {
      const normalizedFolder = normalizeUsdSceneSnapshotKey(folderPath).replace(/\/+$/, '');
      if (!normalizedFolder) return state;

      const shouldRemove = (path: string) =>
        normalizeUsdSceneSnapshotKey(path) === normalizedFolder ||
        normalizeUsdSceneSnapshotKey(path).startsWith(`${normalizedFolder}/`);

      const removedFiles = state.availableFiles.filter((file) => shouldRemove(file.name));
      if (removedFiles.length === 0) return state;

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

      const targetUrls = new Set<string>();
      Object.entries(state.assets).forEach(([key, url]) => {
        if (shouldRemove(key) && url.startsWith('blob:')) {
          targetUrls.add(url);
        }
      });

      const nextAssets: Record<string, string> = {};
      Object.entries(state.assets).forEach(([key, url]) => {
        if (shouldRemove(key)) return;
        if (targetUrls.has(url)) return;
        nextAssets[key] = url;
      });

      targetUrls.forEach((url) => URL.revokeObjectURL(url));

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

      return {
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
      };
    }),
  renameRobotFolder: (folderPath, nextName) => {
    const {
      normalizedFolder,
      sanitizedName,
      nextFolderPath,
    } = resolveRobotFolderRenameTarget(folderPath, nextName);

    if (!normalizedFolder) {
      return { ok: false, reason: 'missing' };
    }

    if (!sanitizedName || sanitizedName === '.' || sanitizedName === '..') {
      return { ok: false, reason: 'invalid' };
    }

    if (nextFolderPath === normalizedFolder) {
      return { ok: true, nextPath: nextFolderPath };
    }

    const state = get();
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
      return { ok: false, reason: 'missing' };
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
      return { ok: false, reason: 'conflict' };
    }

    set((currentState) => {
      const nextAvailableFiles = currentState.availableFiles.map((file) =>
        shouldRename(file.name) ? { ...file, name: renamePath(file.name) } : file,
      );

      const nextSelectedFile = currentState.selectedFile
        ? shouldRename(currentState.selectedFile.name)
          ? { ...currentState.selectedFile, name: renamePath(currentState.selectedFile.name) }
          : currentState.selectedFile
        : null;

      const nextAllFileContents = Object.fromEntries(
        Object.entries(currentState.allFileContents).map(([path, content]) => [
          shouldRename(path) ? renamePath(path) : path,
          content,
        ]),
      );

      const nextAssets = Object.fromEntries(
        Object.entries(currentState.assets).map(([path, url]) => [
          shouldRename(path) ? renamePath(path) : path,
          url,
        ]),
      );

      const nextUsdSceneSnapshots = Object.fromEntries(
        Object.entries(currentState.usdSceneSnapshots).map(([path, snapshot]) => {
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
        Object.entries(currentState.usdPreparedExportCaches).map(([path, cache]) => {
          const sourcePath = cache.stageSourcePath || path;
          const nextPath = shouldRename(sourcePath)
            ? renamePath(sourcePath)
            : normalizeLibraryPath(path);
          return [
            nextPath,
            shouldRename(sourcePath)
              ? { ...cache, stageSourcePath: renamePath(sourcePath) }
              : cache,
          ];
        }),
      );

      const nextDocumentLoadState =
        currentState.documentLoadState.fileName &&
        shouldRename(currentState.documentLoadState.fileName)
          ? {
              ...currentState.documentLoadState,
              fileName: renamePath(currentState.documentLoadState.fileName),
            }
          : currentState.documentLoadState;

      return {
        availableFiles: nextAvailableFiles,
        selectedFile: nextSelectedFile,
        allFileContents: nextAllFileContents,
        assets: nextAssets,
        usdSceneSnapshots: nextUsdSceneSnapshots,
        usdPreparedExportCaches: nextUsdPreparedExportCaches,
        documentLoadState: nextDocumentLoadState,
      };
    });

    return { ok: true, nextPath: nextFolderPath };
  },
  clearRobotLibrary: () =>
    set((state) => {
      const targetUrls = new Set(
        Object.values(state.assets).filter((url) => url.startsWith('blob:')),
      );

      targetUrls.forEach((url) => URL.revokeObjectURL(url));

      return {
        availableFiles: [],
        selectedFile: null,
        allFileContents: {},
        assets: {},
        usdSceneSnapshots: {},
        usdPreparedExportCaches: {},
        documentLoadState: DEFAULT_DOCUMENT_LOAD_STATE,
      };
    }),

  // USD scene snapshot cache
  usdSceneSnapshots: {},
  setUsdSceneSnapshot: (path, snapshot) =>
    set((state) => {
      const normalizedKey = normalizeUsdSceneSnapshotKey(path);
      if (!normalizedKey) {
        return state;
      }

      const nextUsdSceneSnapshots = { ...state.usdSceneSnapshots };
      if (!snapshot) {
        delete nextUsdSceneSnapshots[normalizedKey];
        return { usdSceneSnapshots: nextUsdSceneSnapshots };
      }

      nextUsdSceneSnapshots[normalizedKey] = snapshot;
      return { usdSceneSnapshots: nextUsdSceneSnapshots };
    }),
  getUsdSceneSnapshot: (path) => {
    const normalizedKey = normalizeUsdSceneSnapshotKey(path);
    if (!normalizedKey) {
      return null;
    }
    return get().usdSceneSnapshots[normalizedKey] || null;
  },
  clearUsdSceneSnapshots: () => set({ usdSceneSnapshots: {} }),
  setUsdBakedScene: (path, bakedScene) => get().setUsdSceneSnapshot(path, bakedScene),
  getUsdBakedScene: (path) => get().getUsdSceneSnapshot(path),
  clearUsdBakedScenes: () => get().clearUsdSceneSnapshots(),

  // Prepared USD export cache
  usdPreparedExportCaches: {},
  setUsdPreparedExportCache: (path, cache) =>
    set((state) => {
      const normalizedKey = normalizeUsdSceneSnapshotKey(path);
      if (!normalizedKey) {
        return state;
      }

      const nextUsdPreparedExportCaches = { ...state.usdPreparedExportCaches };
      if (!cache) {
        delete nextUsdPreparedExportCaches[normalizedKey];
        return { usdPreparedExportCaches: nextUsdPreparedExportCaches };
      }

      nextUsdPreparedExportCaches[normalizedKey] = cache;
      return { usdPreparedExportCaches: nextUsdPreparedExportCaches };
    }),
  getUsdPreparedExportCache: (path) => {
    const normalizedKey = normalizeUsdSceneSnapshotKey(path);
    if (!normalizedKey) {
      return null;
    }
    return get().usdPreparedExportCaches[normalizedKey] || null;
  },
  clearUsdPreparedExportCaches: () => set({ usdPreparedExportCaches: {} }),

  // Selected file
  selectedFile: null,
  setSelectedFile: (file) =>
    set((state) => ({
      selectedFile: file,
      documentLoadState: file ? state.documentLoadState : DEFAULT_DOCUMENT_LOAD_STATE,
    })),

  // Document load lifecycle
  documentLoadState: DEFAULT_DOCUMENT_LOAD_STATE,
  setDocumentLoadState: (documentLoadState) => set({ documentLoadState }),
  resetDocumentLoadState: () => set({ documentLoadState: DEFAULT_DOCUMENT_LOAD_STATE }),

  // File contents
  allFileContents: {},
  setAllFileContents: (contents) => set({ allFileContents: contents }),
  addFileContent: (path, content) =>
    set((state) => ({
      allFileContents: { ...state.allFileContents, [path]: content },
    })),

  // Motor library
  motorLibrary: normalizeMotorLibrary(DEFAULT_MOTOR_LIBRARY, 'assetsStore.init'),
  setMotorLibrary: (library) =>
    set({ motorLibrary: normalizeMotorLibrary(library, 'assetsStore.setMotorLibrary') }),
  addMotorSpec: (brand, spec) =>
    set((state) => {
      const existing = state.motorLibrary[brand] || [];
      // Avoid duplicates
      if (existing.some((m) => m.name === spec.name)) {
        return state;
      }
      return {
        motorLibrary: {
          ...state.motorLibrary,
          [brand]: [...existing, spec],
        },
      };
    }),

  componentSourceDrafts: {},
  setComponentSourceDraft: (draft) =>
    set((state) => ({
      componentSourceDrafts: {
        ...state.componentSourceDrafts,
        [draft.componentId]: structuredClone(draft),
      },
    })),
  removeComponentSourceDraft: (componentId) =>
    set((state) => {
      if (!state.componentSourceDrafts[componentId]) return state;
      const componentSourceDrafts = { ...state.componentSourceDrafts };
      delete componentSourceDrafts[componentId];
      return { componentSourceDrafts };
    }),
  pruneComponentSourceDrafts: (componentIds) =>
    set((state) => {
      const retainedIds = new Set(componentIds);
      const componentSourceDrafts = Object.fromEntries(
        Object.entries(state.componentSourceDrafts).filter(([componentId]) =>
          retainedIds.has(componentId),
        ),
      );
      return Object.keys(componentSourceDrafts).length ===
        Object.keys(state.componentSourceDrafts).length
        ? state
        : { componentSourceDrafts };
    }),
  replaceComponentSourceDrafts: (drafts) =>
    set({ componentSourceDrafts: structuredClone(drafts) }),
  clearComponentSourceDrafts: () => set({ componentSourceDrafts: {} }),

  // Upload helper
  uploadAsset: (file) => {
    const url = URL.createObjectURL(file);
    set((state) => {
      const nextAssets = { ...state.assets, [file.name]: url };
      revokeReplacedBlobUrls(state.assets, nextAssets, [file.name]);
      return { assets: nextAssets };
    });
    return url;
  },

  // Cleanup
  revokeAllAssets: () => {
    revokeBlobUrls(Object.values(get().assets));
  },
}));
