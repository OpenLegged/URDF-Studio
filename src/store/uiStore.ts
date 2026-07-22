/**
 * UI Store - Manages UI-related state
 * Handles app mode, view options, panel visibility, theme, language, etc.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppMode, DetailLinkTab, Theme } from '@/types';
import { translations } from '@/shared/i18n';
import { normalizeMergedAppMode } from '@/shared/utils/appMode';
import { applyDocumentTheme } from '@/shared/utils/theme';

// Language type
export type Language = 'en' | 'zh';
export type RotationDisplayMode = 'euler_deg' | 'euler_rad' | 'quaternion';
export type GlobalFontSize = 'small' | 'medium' | 'large';
export type CodeEditorFontFamily = 'jetbrains-mono' | 'fira-code' | 'system-mono';
export type MassInertiaChangeBehavior = 'ask' | 'preserve' | 'reestimate';
export type TreePanelHeightMode = 'balanced' | 'custom';
export type ManagedWindowId =
  | 'snapshot'
  | 'settings'
  | 'exportDialog'
  | 'exportProgress'
  | 'aiInspection'
  | 'aiConversation'
  | 'filePreview'
  | 'collisionOptimization'
  | 'sourceCode'
  | 'structureGraph'
  | 'bridgeCreate'
  | 'viewerOptions'
  | 'viewerJoints'
  | 'measureTool'
  | 'paintTool'
  | 'ikTool';

export const MANAGED_WINDOW_Z_INDEX_BASE = 220;

export const DEFAULT_MANAGED_WINDOW_ORDER: readonly ManagedWindowId[] = [
  'snapshot',
  'settings',
  'exportDialog',
  'exportProgress',
  'aiInspection',
  'aiConversation',
  'filePreview',
  'collisionOptimization',
  'sourceCode',
  'structureGraph',
  'bridgeCreate',
  'viewerOptions',
  'viewerJoints',
  'measureTool',
  'paintTool',
  'ikTool',
];

const managedWindowIdSet = new Set<ManagedWindowId>(DEFAULT_MANAGED_WINDOW_ORDER);

const areManagedWindowOrdersEqual = (
  first: readonly ManagedWindowId[],
  second: readonly ManagedWindowId[],
) => first.length === second.length && first.every((id, index) => id === second[index]);

export const normalizeManagedWindowOrder = (
  order: readonly ManagedWindowId[] | null | undefined,
): ManagedWindowId[] => {
  const normalized = (order ?? []).filter((id): id is ManagedWindowId =>
    managedWindowIdSet.has(id),
  );
  DEFAULT_MANAGED_WINDOW_ORDER.forEach((id) => {
    if (!normalized.includes(id)) {
      normalized.push(id);
    }
  });
  return normalized;
};

export const bringManagedWindowToFront = (
  order: readonly ManagedWindowId[] | null | undefined,
  windowId: ManagedWindowId,
): ManagedWindowId[] => {
  const normalized = normalizeManagedWindowOrder(order);
  const nextOrder = normalized.filter((id) => id !== windowId);
  nextOrder.push(windowId);
  return nextOrder;
};

export const getManagedWindowZIndex = (
  order: readonly ManagedWindowId[] | null | undefined,
  windowId: ManagedWindowId,
): number => {
  const normalized = normalizeManagedWindowOrder(order);
  const index = normalized.indexOf(windowId);
  return MANAGED_WINDOW_Z_INDEX_BASE + Math.max(0, index);
};

// View configuration for different modes
export interface ViewConfig {
  showOptionsPanel: boolean; // For viewer scene options
  showJointPanel: boolean;
}

// Camera projection mode for the 3D workspace canvas.
// - 'perspective': default wide-angle perspective (current behavior).
// - 'orthographic': orthographic projection, gives true CAD-style three-view
//   snapshots when clicking the gizmo axes (ground plane collapses to a line).
export type CameraProjectionMode = 'perspective' | 'orthographic';

// View options for 3D visualization
export interface ViewOptions {
  showGrid: boolean;
  showAxes: boolean;
  showUsageGuide: boolean;
  showMjcfWorldLink: boolean;
  showIkHandles: boolean;
  showJointAxes: boolean;
  showInertia: boolean;
  showCenterOfMass: boolean;
  showCollision: boolean;
  modelOpacity: number;
  cameraProjection: CameraProjectionMode;
}

// Camera navigation sensitivity multipliers (1 = 100% = default feel).
// Applied on top of the built-in WorkspaceOrbitControls tuning + the
// model-size adaptive scaling, so the slider behaves like the "Navigation"
// sensitivity preferences in large 3D software (Blender / Maya).
export interface NavigationSensitivity {
  zoom: number;
  rotate: number;
  pan: number;
}

// Panel visibility state
export interface PanelsState {
  codeEditor: boolean;
  aiAssistant: boolean;
}

// Sidebar collapse state
export interface SidebarState {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
}

export interface PanelLayoutState {
  propertyEditorWidth: number;
  treeFileBrowserHeight: number;
  treeJointPanelHeight: number;
  treePanelHeightMode: TreePanelHeightMode;
  treeSidebarWidth: number;
}

interface UIState {
  // App mode
  appMode: AppMode;
  setAppMode: (mode: AppMode) => void;

  // Theme (light/dark/system)
  theme: Theme;
  setTheme: (theme: Theme) => void;

  // Language (en/zh)
  lang: Language;
  setLang: (lang: Language) => void;

  // View configuration
  viewConfig: ViewConfig;
  setViewConfig: <K extends keyof ViewConfig>(key: K, value: ViewConfig[K]) => void;

  // View options for 3D scene
  viewOptions: ViewOptions;
  setViewOption: <K extends keyof ViewOptions>(key: K, value: ViewOptions[K]) => void;

  // Ground plane offset (Z position)
  groundPlaneOffset: number;
  setGroundPlaneOffset: (offset: number) => void;

  // Camera navigation sensitivity (zoom / rotate / pan multipliers)
  navigationSensitivity: NavigationSensitivity;
  setNavigationSensitivity: (partial: Partial<NavigationSensitivity>) => void;

  // Panel visibility
  panels: PanelsState;
  togglePanel: (panel: keyof PanelsState) => void;
  setPanel: (panel: keyof PanelsState, open: boolean) => void;

  // Sidebar collapse
  sidebar: SidebarState;
  toggleSidebar: (side: 'left' | 'right') => void;
  setSidebar: (side: 'left' | 'right', collapsed: boolean) => void;

  // Resizable panel layout
  panelLayout: PanelLayoutState;
  setPanelLayout: <K extends keyof PanelLayoutState>(key: K, value: PanelLayoutState[K]) => void;

  // Settings modal
  isSettingsOpen: boolean;
  settingsPos: { x: number; y: number };
  openSettings: (pos?: { x: number; y: number }) => void;
  closeSettings: () => void;
  setSettingsPos: (pos: { x: number; y: number }) => void;

  // OS detection
  os: 'mac' | 'win';
  setOs: (os: 'mac' | 'win') => void;

  // Import warning
  showImportWarning: boolean;
  setShowImportWarning: (show: boolean) => void;

  // Panel Sections (collapsed state)
  panelSections: Record<string, boolean>;
  setPanelSection: (section: string, collapsed: boolean) => void;

  // Font Size Preference
  fontSize: GlobalFontSize;
  setFontSize: (size: GlobalFontSize) => void;

  // Source code editor typography
  codeEditorFontFamily: CodeEditorFontFamily;
  setCodeEditorFontFamily: (fontFamily: CodeEditorFontFamily) => void;
  codeEditorFontSize: number;
  setCodeEditorFontSize: (size: number) => void;
  codeEditorOpacity: number;
  setCodeEditorOpacity: (opacity: number) => void;

  // Source code editor
  sourceCodeAutoApply: boolean;
  setSourceCodeAutoApply: (enabled: boolean) => void;

  // Floating workbench window z-order. Session-only; intentionally not persisted.
  managedWindowOrder: ManagedWindowId[];
  bringWindowToFront: (windowId: ManagedWindowId) => void;
  getManagedWindowZIndex: (windowId: ManagedWindowId) => number;

  // Property editor rotation format
  rotationDisplayMode: RotationDisplayMode;
  setRotationDisplayMode: (mode: RotationDisplayMode) => void;

  // Property editor mass/inertia confirmation preference
  massInertiaChangeBehavior: MassInertiaChangeBehavior;
  setMassInertiaChangeBehavior: (behavior: MassInertiaChangeBehavior) => void;

  // Editor link property tab
  detailLinkTab: DetailLinkTab;
  setDetailLinkTab: (tab: DetailLinkTab) => void;

  // Structure tree geometry detail disclosure
  structureTreeShowGeometryDetails: boolean;
  setStructureTreeShowGeometryDetails: (show: boolean) => void;
}

// Default values
const defaultViewConfig: ViewConfig = {
  showOptionsPanel: true,
  showJointPanel: true,
};

const defaultViewOptions: ViewOptions = {
  showGrid: true,
  showAxes: true,
  showUsageGuide: true,
  showMjcfWorldLink: true,
  showIkHandles: false,
  showJointAxes: false,
  showInertia: false,
  showCenterOfMass: false,
  showCollision: false,
  modelOpacity: 1,
  cameraProjection: 'perspective',
};

export const NAVIGATION_SENSITIVITY_MIN = 0.25;
export const NAVIGATION_SENSITIVITY_MAX = 2;

const defaultNavigationSensitivity: NavigationSensitivity = {
  zoom: 1,
  rotate: 1,
  pan: 1,
};

const clampNavigationSensitivityValue = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 1;
  }
  return Math.min(Math.max(numeric, NAVIGATION_SENSITIVITY_MIN), NAVIGATION_SENSITIVITY_MAX);
};

const normalizeNavigationSensitivity = (value: unknown): NavigationSensitivity => {
  const source = (value ?? {}) as Partial<NavigationSensitivity>;
  return {
    zoom: clampNavigationSensitivityValue(source.zoom ?? defaultNavigationSensitivity.zoom),
    rotate: clampNavigationSensitivityValue(source.rotate ?? defaultNavigationSensitivity.rotate),
    pan: clampNavigationSensitivityValue(source.pan ?? defaultNavigationSensitivity.pan),
  };
};

const defaultPanels: PanelsState = {
  codeEditor: false,
  aiAssistant: false,
};

const defaultSidebar: SidebarState = {
  leftCollapsed: false,
  rightCollapsed: false,
};

const defaultPanelLayout: PanelLayoutState = {
  propertyEditorWidth: 248,
  treeFileBrowserHeight: 240,
  treeJointPanelHeight: 240,
  treePanelHeightMode: 'balanced',
  treeSidebarWidth: 264,
};

const LEGACY_DEFAULT_TREE_FILE_BROWSER_HEIGHT = 216;
const LEGACY_DEFAULT_TREE_JOINT_PANEL_HEIGHT = 132;

const normalizeDetailLinkTab = (value: unknown): DetailLinkTab =>
  value === 'collision' || value === 'physics'
    ? value
    : value === 'material' || value === 'joint'
      ? value === 'joint'
        ? 'physics'
        : 'visual'
      : 'visual';

// Detect system language
const getSystemLang = (): Language => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('language');
    if (saved === 'en' || saved === 'zh') {
      return saved;
    }
    const systemLang =
      navigator.language || (navigator as unknown as { userLanguage?: string }).userLanguage;
    if (systemLang && systemLang.toLowerCase().startsWith('zh')) {
      return 'zh';
    }
  }
  return 'en';
};

// Detect OS
const detectOs = (): 'mac' | 'win' => {
  if (typeof navigator !== 'undefined') {
    const userAgent = navigator.userAgent.toLowerCase();
    const userAgentDataPlatform =
      (
        navigator as Navigator & {
          userAgentData?: { platform?: string };
        }
      ).userAgentData?.platform?.toLowerCase() || '';
    const osHint = `${userAgentDataPlatform} ${userAgent}`;

    if (osHint.includes('mac') || osHint.includes('darwin')) {
      return 'mac';
    }
  }
  return 'win';
};

// Get saved theme or default
const getSavedTheme = (): Theme => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light' || saved === 'system') {
      return saved;
    }
  }
  return 'system';
};

// Get saved sidebar state
const getSavedSidebar = (): SidebarState => {
  if (typeof window !== 'undefined') {
    return {
      leftCollapsed: localStorage.getItem('leftSidebarCollapsed') === 'true',
      rightCollapsed: localStorage.getItem('rightSidebarCollapsed') === 'true',
    };
  }
  return defaultSidebar;
};

// Helper to apply font size (affects text size via CSS variable)
const DEFAULT_GLOBAL_FONT_SIZE: GlobalFontSize = 'medium';
const DEFAULT_CODE_EDITOR_FONT_FAMILY: CodeEditorFontFamily = 'jetbrains-mono';
const DEFAULT_CODE_EDITOR_FONT_SIZE = 13;
const MIN_CODE_EDITOR_FONT_SIZE = 11;
const MAX_CODE_EDITOR_FONT_SIZE = 24;
export const DEFAULT_CODE_EDITOR_OPACITY = 0.6;
export const MIN_CODE_EDITOR_OPACITY = 0.35;
export const MAX_CODE_EDITOR_OPACITY = 1;

const normalizeGlobalFontSize = (value: unknown): GlobalFontSize =>
  value === 'small' || value === 'large' ? value : 'medium';

const normalizeCodeEditorFontFamily = (value: unknown): CodeEditorFontFamily =>
  value === 'fira-code' || value === 'system-mono' ? value : 'jetbrains-mono';

const normalizeMassInertiaChangeBehavior = (value: unknown): MassInertiaChangeBehavior =>
  value === 'preserve' || value === 'reestimate' ? value : 'ask';

const normalizeTreePanelHeightMode = (value: unknown): TreePanelHeightMode =>
  value === 'custom' ? 'custom' : 'balanced';

const clampCodeEditorFontSize = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CODE_EDITOR_FONT_SIZE;
  }

  return Math.round(
    Math.min(MAX_CODE_EDITOR_FONT_SIZE, Math.max(MIN_CODE_EDITOR_FONT_SIZE, parsed)),
  );
};

const clampCodeEditorOpacity = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CODE_EDITOR_OPACITY;
  }

  return Math.min(MAX_CODE_EDITOR_OPACITY, Math.max(MIN_CODE_EDITOR_OPACITY, parsed));
};

const applyFontSize = (fontSize: GlobalFontSize) => {
  if (typeof window === 'undefined') return;
  let scale: number;
  switch (fontSize) {
    case 'small':
      scale = 0.85;
      break; // 85%
    case 'large':
      scale = 1.25;
      break; // 125%
    case 'medium':
    default:
      scale = 1.0;
      break; // 100%
  }
  document.documentElement.style.setProperty('--font-scale', scale.toString());
  document.documentElement.setAttribute('data-font-size', fontSize);
};

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      // App mode
      appMode: normalizeMergedAppMode('editor'),
      setAppMode: (mode) => set({ appMode: normalizeMergedAppMode(mode) }),

      // Theme
      theme: getSavedTheme(),
      setTheme: (theme) => set({ theme }),

      // Language
      lang: getSystemLang(),
      setLang: (lang) => {
        // Update document title
        document.title = translations[lang].documentTitle;
        set({ lang });
      },

      // View configuration
      viewConfig: defaultViewConfig,
      setViewConfig: (key, value) =>
        set((state) => ({
          viewConfig: { ...state.viewConfig, [key]: value },
        })),

      // View options
      viewOptions: defaultViewOptions,
      setViewOption: (key, value) =>
        set((state) => ({
          viewOptions: { ...state.viewOptions, [key]: value },
        })),

      // Ground plane offset
      groundPlaneOffset: 0,
      setGroundPlaneOffset: (offset) => set({ groundPlaneOffset: offset }),

      // Camera navigation sensitivity
      navigationSensitivity: defaultNavigationSensitivity,
      setNavigationSensitivity: (partial) =>
        set((state) => ({
          navigationSensitivity: normalizeNavigationSensitivity({
            ...state.navigationSensitivity,
            ...partial,
          }),
        })),

      // Panels
      panels: defaultPanels,
      togglePanel: (panel) =>
        set((state) => ({
          panels: { ...state.panels, [panel]: !state.panels[panel] },
        })),
      setPanel: (panel, open) =>
        set((state) => ({
          panels: { ...state.panels, [panel]: open },
        })),

      // Sidebar
      sidebar: getSavedSidebar(),
      toggleSidebar: (side) =>
        set((state) => {
          const key = side === 'left' ? 'leftCollapsed' : 'rightCollapsed';
          const newValue = !state.sidebar[key];
          // Persist to localStorage
          localStorage.setItem(
            side === 'left' ? 'leftSidebarCollapsed' : 'rightSidebarCollapsed',
            String(newValue),
          );
          return {
            sidebar: { ...state.sidebar, [key]: newValue },
          };
        }),
      setSidebar: (side, collapsed) =>
        set((state) => {
          const key = side === 'left' ? 'leftCollapsed' : 'rightCollapsed';
          localStorage.setItem(
            side === 'left' ? 'leftSidebarCollapsed' : 'rightSidebarCollapsed',
            String(collapsed),
          );
          return {
            sidebar: { ...state.sidebar, [key]: collapsed },
          };
        }),

      // Resizable panel layout
      panelLayout: defaultPanelLayout,
      setPanelLayout: (key, value) =>
        set((state) => ({
          panelLayout: { ...state.panelLayout, [key]: value },
        })),

      // Settings modal
      isSettingsOpen: false,
      settingsPos: { x: 0, y: 0 }, // Will be calculated on open
      openSettings: (pos) =>
        set((state) => {
          let newPos = pos;
          const nextManagedWindowOrder = bringManagedWindowToFront(
            state.managedWindowOrder,
            'settings',
          );
          // Only calculate center if no pos provided AND current pos is default (0,0)
          if (!newPos && state.settingsPos.x === 0 && state.settingsPos.y === 0) {
            if (typeof window !== 'undefined') {
              const defaultWidth = 580;
              const defaultHeight = 420;
              newPos = {
                x: Math.max(12, window.innerWidth / 2 - defaultWidth / 2),
                y: Math.max(12, window.innerHeight / 2 - defaultHeight / 2),
              };
            } else {
              newPos = { x: 100, y: 100 };
            }
          }
          return {
            isSettingsOpen: true,
            settingsPos: newPos || state.settingsPos,
            managedWindowOrder: nextManagedWindowOrder,
          };
        }),
      closeSettings: () => set({ isSettingsOpen: false }),
      setSettingsPos: (pos) => set({ settingsPos: pos }),

      // OS detection
      os: detectOs(),
      setOs: (os) => set({ os }),

      // Import warning
      showImportWarning: true,
      setShowImportWarning: (show) => set({ showImportWarning: show }),

      // Panel Sections
      panelSections: {},
      setPanelSection: (section, collapsed) =>
        set((state) => ({
          panelSections: { ...state.panelSections, [section]: collapsed },
        })),

      // Font Size
      fontSize: DEFAULT_GLOBAL_FONT_SIZE,
      setFontSize: (size) => {
        applyFontSize(size);
        set({ fontSize: size });
      },

      // Source code editor typography
      codeEditorFontFamily: DEFAULT_CODE_EDITOR_FONT_FAMILY,
      setCodeEditorFontFamily: (codeEditorFontFamily) =>
        set({ codeEditorFontFamily: normalizeCodeEditorFontFamily(codeEditorFontFamily) }),
      codeEditorFontSize: DEFAULT_CODE_EDITOR_FONT_SIZE,
      setCodeEditorFontSize: (codeEditorFontSize) =>
        set({ codeEditorFontSize: clampCodeEditorFontSize(codeEditorFontSize) }),
      codeEditorOpacity: DEFAULT_CODE_EDITOR_OPACITY,
      setCodeEditorOpacity: (codeEditorOpacity) =>
        set({ codeEditorOpacity: clampCodeEditorOpacity(codeEditorOpacity) }),

      // Source code editor
      sourceCodeAutoApply: false,
      setSourceCodeAutoApply: (sourceCodeAutoApply) => set({ sourceCodeAutoApply }),

      // Floating workbench windows
      managedWindowOrder: [...DEFAULT_MANAGED_WINDOW_ORDER],
      bringWindowToFront: (windowId) =>
        set((state) => {
          const nextOrder = bringManagedWindowToFront(state.managedWindowOrder, windowId);
          return areManagedWindowOrdersEqual(state.managedWindowOrder, nextOrder)
            ? state
            : { managedWindowOrder: nextOrder };
        }),
      getManagedWindowZIndex: (windowId) =>
        getManagedWindowZIndex(get().managedWindowOrder, windowId),

      // Property editor rotation format
      rotationDisplayMode: 'euler_deg',
      setRotationDisplayMode: (rotationDisplayMode) => set({ rotationDisplayMode }),

      // Property editor mass/inertia confirmation preference
      massInertiaChangeBehavior: 'ask',
      setMassInertiaChangeBehavior: (massInertiaChangeBehavior) =>
        set({
          massInertiaChangeBehavior: normalizeMassInertiaChangeBehavior(massInertiaChangeBehavior),
        }),

      // Editor link property tab
      detailLinkTab: 'visual',
      setDetailLinkTab: (detailLinkTab) =>
        set({ detailLinkTab: normalizeDetailLinkTab(detailLinkTab) }),

      // Structure tree geometry detail disclosure
      structureTreeShowGeometryDetails: false,
      setStructureTreeShowGeometryDetails: (structureTreeShowGeometryDetails) =>
        set({ structureTreeShowGeometryDetails }),
    }),
    {
      name: 'urdf-studio-ui',
      version: 21,
      migrate: (persistedState: unknown, persistedVersion) => {
        if (!persistedState || typeof persistedState !== 'object') {
          return persistedState;
        }

        const state = persistedState as {
          panelLayout?: Partial<PanelLayoutState>;
          viewOptions?: Partial<ViewOptions>;
          detailLinkTab?: unknown;
          fontSize?: unknown;
          codeEditorFontFamily?: unknown;
          codeEditorFontSize?: unknown;
          codeEditorOpacity?: unknown;
          massInertiaChangeBehavior?: unknown;
          navigationSensitivity?: unknown;
        };
        const persistedPanelLayout = state.panelLayout ?? {};
        const hasLegacyCustomTreeHeights =
          Number.isFinite(persistedPanelLayout.treeFileBrowserHeight) &&
          Number.isFinite(persistedPanelLayout.treeJointPanelHeight) &&
          (persistedPanelLayout.treeFileBrowserHeight !==
            LEGACY_DEFAULT_TREE_FILE_BROWSER_HEIGHT ||
            persistedPanelLayout.treeJointPanelHeight !== LEGACY_DEFAULT_TREE_JOINT_PANEL_HEIGHT);
        const treePanelHeightMode =
          (persistedVersion ?? 0) < 18
            ? hasLegacyCustomTreeHeights
              ? 'custom'
              : 'balanced'
            : normalizeTreePanelHeightMode(persistedPanelLayout.treePanelHeightMode);

        const migratedViewOptions: ViewOptions = {
          ...defaultViewOptions,
          ...state.viewOptions,
        };

        // Earlier builds persisted MJCF world visibility as enabled by default.
        // Reset upgraded sessions to the current hidden-by-default behavior so
        // MJCF ground/world geometry stays opt-in unless the user toggles it again.
        if ((persistedVersion ?? 0) < 14) {
          migratedViewOptions.showMjcfWorldLink = false;
        }

        // IK handles should stay opt-in. Older sessions could carry them as
        // always-visible, which leaves a green helper ball on first load.
        if ((persistedVersion ?? 0) < 15) {
          migratedViewOptions.showIkHandles = false;
        }

        // MJCF world link (ground plane) should be visible by default.
        // Earlier migrations (v14) forced this to false; reset to true so
        // imported MJCF scenes show their floor immediately.
        if ((persistedVersion ?? 0) < 16) {
          migratedViewOptions.showMjcfWorldLink = true;
        }

        return {
          ...state,
          viewOptions: migratedViewOptions,
          panelLayout: {
            ...defaultPanelLayout,
            ...persistedPanelLayout,
            treeFileBrowserHeight:
              (persistedVersion ?? 0) < 18 && !hasLegacyCustomTreeHeights
                ? defaultPanelLayout.treeFileBrowserHeight
                : (persistedPanelLayout.treeFileBrowserHeight ??
                  defaultPanelLayout.treeFileBrowserHeight),
            treeJointPanelHeight:
              (persistedVersion ?? 0) < 18 && !hasLegacyCustomTreeHeights
                ? defaultPanelLayout.treeJointPanelHeight
                : (persistedPanelLayout.treeJointPanelHeight ??
                  defaultPanelLayout.treeJointPanelHeight),
            treePanelHeightMode,
          },
          fontSize: normalizeGlobalFontSize(state.fontSize),
          codeEditorFontFamily: normalizeCodeEditorFontFamily(state.codeEditorFontFamily),
          codeEditorFontSize: clampCodeEditorFontSize(state.codeEditorFontSize),
          codeEditorOpacity: clampCodeEditorOpacity(state.codeEditorOpacity),
          massInertiaChangeBehavior: normalizeMassInertiaChangeBehavior(
            state.massInertiaChangeBehavior,
          ),
          detailLinkTab: normalizeDetailLinkTab(state.detailLinkTab),
          navigationSensitivity: normalizeNavigationSensitivity(state.navigationSensitivity),
        };
      },
      partialize: (state) => ({
        theme: state.theme,
        lang: state.lang,
        sidebar: state.sidebar,
        viewOptions: state.viewOptions,
        panelLayout: state.panelLayout,
        showImportWarning: state.showImportWarning,
        panelSections: state.panelSections,
        fontSize: state.fontSize,
        codeEditorFontFamily: state.codeEditorFontFamily,
        codeEditorFontSize: state.codeEditorFontSize,
        codeEditorOpacity: state.codeEditorOpacity,
        sourceCodeAutoApply: state.sourceCodeAutoApply,
        rotationDisplayMode: state.rotationDisplayMode,
        massInertiaChangeBehavior: state.massInertiaChangeBehavior,
        detailLinkTab: state.detailLinkTab,
        structureTreeShowGeometryDetails: state.structureTreeShowGeometryDetails,
        navigationSensitivity: state.navigationSensitivity,
      }),
      onRehydrateStorage: () => (state) => {
        // Re-apply theme and font size on hydration
        if (state) {
          applyDocumentTheme(state.theme);
          document.documentElement.style.fontSize = '100%';
          // Re-apply font size
          applyFontSize(normalizeGlobalFontSize(state.fontSize));
          const normalizedCodeEditorFontFamily = normalizeCodeEditorFontFamily(
            state.codeEditorFontFamily,
          );
          if (state.codeEditorFontFamily !== normalizedCodeEditorFontFamily) {
            state.setCodeEditorFontFamily(normalizedCodeEditorFontFamily);
          }
          const normalizedCodeEditorFontSize = clampCodeEditorFontSize(state.codeEditorFontSize);
          if (state.codeEditorFontSize !== normalizedCodeEditorFontSize) {
            state.setCodeEditorFontSize(normalizedCodeEditorFontSize);
          }
          const normalizedCodeEditorOpacity = clampCodeEditorOpacity(state.codeEditorOpacity);
          if (state.codeEditorOpacity !== normalizedCodeEditorOpacity) {
            state.setCodeEditorOpacity(normalizedCodeEditorOpacity);
          }
          const normalizedMassInertiaChangeBehavior = normalizeMassInertiaChangeBehavior(
            state.massInertiaChangeBehavior,
          );
          if (state.massInertiaChangeBehavior !== normalizedMassInertiaChangeBehavior) {
            state.setMassInertiaChangeBehavior(normalizedMassInertiaChangeBehavior);
          }
          const normalizedDetailLinkTab = normalizeDetailLinkTab(state.detailLinkTab);
          if (state.detailLinkTab !== normalizedDetailLinkTab) {
            state.setDetailLinkTab(normalizedDetailLinkTab);
          }
        }
      },
    },
  ),
);
