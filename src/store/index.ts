/**
 * Store - Zustand state management
 * Central export for all stores
 */

// UI Store - app mode, theme, language, view options, panels, etc.
export { useUIStore } from './uiStore';
export type {
  Language,
  ViewConfig,
  ViewOptions,
  PanelsState,
  SidebarState,
} from './uiStore';

// Selection Store - link/joint selection and hover state
export { useSelectionStore, validateSelection } from './selectionStore';
export type { Selection } from './selectionStore';

// Assets Store - mesh/texture resources, robot files, motor library
export { useAssetsStore } from './assetsStore';

// Robot Store - robot data and operations with undo/redo
export {
  useRobotStore,
  useRobotName,
  useRobotLinks,
  useRobotJoints,
  useRootLinkId,
  useCanUndo,
  useCanRedo,
} from './robotStore';
export type { RobotData } from './robotStore';

// History helper (for custom stores that need undo/redo)
export { createHistoryManager } from './historyMiddleware';
export type { HistoryState, HistoryActions, HistoryOptions } from './historyMiddleware';
