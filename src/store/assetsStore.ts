/**
 * Assets Store - Manages mesh and texture file resources
 * Handles blob URLs for imported 3D assets
 */
import { create } from 'zustand';
import type {
  ComponentSourceDraft,
  MotorSpec,
  RobotFile,
  UsdBakedScene,
  UsdPreparedExportCache,
  UsdSceneSnapshot,
} from '@/types';
import { DEFAULT_MOTOR_LIBRARY, normalizeMotorLibrary } from '@/shared/data/motorLibrary';
import { normalizeLibraryPathKey } from '@/core/utils/pathKeys';
import {
  createClearRobotLibraryPlan,
  createRemoveRobotFilePlan,
  createRemoveRobotFolderPlan,
  createRenameRobotFolderPlan,
  DEFAULT_DOCUMENT_LOAD_STATE,
  isLibraryMutationPlanCurrent,
  pruneUsdPreparedExportCaches,
  pruneUsdSceneSnapshots,
  resolveRobotFolderRenameTarget,
  toDocumentLoadLifecycleState,
  type DocumentLoadLifecycleState,
  type DocumentLoadState,
  type LibraryMutationPlan,
  type LibraryMutationState,
  type RenameRobotFolderPlanResult,
  type RenameRobotFolderResult,
  type RobotFolderRenameTarget,
} from '@/store/assets/libraryMutationPlan';

export {
  DEFAULT_DOCUMENT_LOAD_STATE,
  resolveRobotFolderRenameTarget,
  toDocumentLoadLifecycleState,
  type DocumentLoadLifecycleState,
  type DocumentLoadState,
  type LibraryMutationPlan,
  type LibraryMutationState,
  type RenameRobotFolderPlanResult,
  type RenameRobotFolderResult,
  type RobotFolderRenameTarget,
};

function normalizeUsdSceneSnapshotKey(path: string | null | undefined): string {
  return normalizeLibraryPathKey(path);
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
  createRemoveRobotFilePlan: (fileName: string) => LibraryMutationPlan | null;
  createRemoveRobotFolderPlan: (folderPath: string) => LibraryMutationPlan | null;
  createRenameRobotFolderPlan: (
    folderPath: string,
    nextName: string,
  ) => RenameRobotFolderPlanResult;
  createClearRobotLibraryPlan: () => LibraryMutationPlan;
  applyLibraryMutationPlan: (
    plan: LibraryMutationPlan,
    options?: { revokeOrphans?: boolean },
  ) => boolean;
  restoreLibraryMutationState: (state: LibraryMutationState) => void;
  revokeLibraryMutationPlanOrphans: (plan: LibraryMutationPlan) => void;

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
  removeRobotFile: (fileName) => {
    const plan = get().createRemoveRobotFilePlan(fileName);
    if (plan) {
      get().applyLibraryMutationPlan(plan);
    }
  },
  removeRobotFolder: (folderPath) => {
    const plan = get().createRemoveRobotFolderPlan(folderPath);
    if (plan) {
      get().applyLibraryMutationPlan(plan);
    }
  },
  renameRobotFolder: (folderPath, nextName) => {
    const { result, plan } = get().createRenameRobotFolderPlan(folderPath, nextName);
    if (plan) {
      get().applyLibraryMutationPlan(plan);
    }
    return result;
  },
  clearRobotLibrary: () => {
    get().applyLibraryMutationPlan(get().createClearRobotLibraryPlan());
  },
  createRemoveRobotFilePlan: (fileName) => createRemoveRobotFilePlan(get(), fileName),
  createRemoveRobotFolderPlan: (folderPath) => createRemoveRobotFolderPlan(get(), folderPath),
  createRenameRobotFolderPlan: (folderPath, nextName) =>
    createRenameRobotFolderPlan(get(), folderPath, nextName),
  createClearRobotLibraryPlan: () => createClearRobotLibraryPlan(get()),
  applyLibraryMutationPlan: (plan, options = {}) => {
    if (!isLibraryMutationPlanCurrent(get(), plan)) {
      return false;
    }

    set(plan.nextState);
    if (options.revokeOrphans ?? true) {
      get().revokeLibraryMutationPlanOrphans(plan);
    }
    return true;
  },
  restoreLibraryMutationState: (state) => set(state),
  revokeLibraryMutationPlanOrphans: (plan) => revokeBlobUrls(plan.orphanBlobUrls),

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
  replaceComponentSourceDrafts: (drafts) => set({ componentSourceDrafts: structuredClone(drafts) }),
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
