/**
 * Assets Store - Manages mesh and texture file resources
 * Handles blob URLs for imported 3D assets
 */
import { create } from 'zustand';
import type { RobotFile, MotorSpec } from '@/types';
import { DEFAULT_MOTOR_LIBRARY } from '@/features/hardware-config';

interface AssetsState {
  // Mesh and texture assets (blob URLs)
  assets: Record<string, string>;
  setAssets: (assets: Record<string, string>) => void;
  addAsset: (path: string, url: string) => void;
  addAssets: (newAssets: Record<string, string>) => void;
  getAsset: (path: string) => string | undefined;
  clearAssets: () => void;

  // Available robot files (URDF/MJCF/USD/Xacro)
  availableFiles: RobotFile[];
  setAvailableFiles: (files: RobotFile[]) => void;
  addRobotFile: (file: RobotFile) => void;

  // Currently selected file in file browser
  selectedFile: RobotFile | null;
  setSelectedFile: (file: RobotFile | null) => void;

  // All text file contents for xacro includes
  allFileContents: Record<string, string>;
  setAllFileContents: (contents: Record<string, string>) => void;
  addFileContent: (path: string, content: string) => void;

  // Motor library
  motorLibrary: Record<string, MotorSpec[]>;
  setMotorLibrary: (library: Record<string, MotorSpec[]>) => void;
  addMotorSpec: (brand: string, spec: MotorSpec) => void;

  // Original URDF content (for preserving material colors)
  originalUrdfContent: string;
  setOriginalUrdfContent: (content: string) => void;

  // Original file format
  originalFileFormat: 'urdf' | 'mjcf' | 'usd' | 'xacro' | null;
  setOriginalFileFormat: (format: 'urdf' | 'mjcf' | 'usd' | 'xacro' | null) => void;

  // Upload a single file and create blob URL
  uploadAsset: (file: File) => string;

  // Cleanup all blob URLs
  revokeAllAssets: () => void;
}

export const useAssetsStore = create<AssetsState>()((set, get) => ({
  // Assets (blob URLs)
  assets: {},
  setAssets: (assets) => set({ assets }),
  addAsset: (path, url) =>
    set((state) => ({
      assets: { ...state.assets, [path]: url },
    })),
  addAssets: (newAssets) =>
    set((state) => ({
      assets: { ...state.assets, ...newAssets },
    })),
  getAsset: (path) => get().assets[path],
  clearAssets: () => {
    // Revoke all existing blob URLs before clearing
    Object.values(get().assets).forEach((url) => {
      if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    });
    set({ assets: {} });
  },

  // Robot files
  availableFiles: [],
  setAvailableFiles: (files) => set({ availableFiles: files }),
  addRobotFile: (file) =>
    set((state) => ({
      availableFiles: [...state.availableFiles, file],
    })),

  // Selected file
  selectedFile: null,
  setSelectedFile: (file) => set({ selectedFile: file }),

  // File contents
  allFileContents: {},
  setAllFileContents: (contents) => set({ allFileContents: contents }),
  addFileContent: (path, content) =>
    set((state) => ({
      allFileContents: { ...state.allFileContents, [path]: content },
    })),

  // Motor library
  motorLibrary: DEFAULT_MOTOR_LIBRARY,
  setMotorLibrary: (library) => set({ motorLibrary: library }),
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

  // Original content
  originalUrdfContent: '',
  setOriginalUrdfContent: (content) => set({ originalUrdfContent: content }),

  // Original format
  originalFileFormat: null,
  setOriginalFileFormat: (format) => set({ originalFileFormat: format }),

  // Upload helper
  uploadAsset: (file) => {
    const url = URL.createObjectURL(file);
    set((state) => ({
      assets: { ...state.assets, [file.name]: url },
    }));
    return url;
  },

  // Cleanup
  revokeAllAssets: () => {
    Object.values(get().assets).forEach((url) => {
      if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    });
  },
}));
