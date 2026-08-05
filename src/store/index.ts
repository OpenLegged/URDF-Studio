/**
 * Store - Zustand state management
 * Central export for all stores
 */

// UI Store - app mode, theme, language, view options, panels, etc.
export {
  useUIStore,
  NAVIGATION_SENSITIVITY_MIN,
  NAVIGATION_SENSITIVITY_MAX,
  DEFAULT_CODE_EDITOR_OPACITY,
  MIN_CODE_EDITOR_OPACITY,
  MAX_CODE_EDITOR_OPACITY,
  DEFAULT_MANAGED_WINDOW_ORDER,
  MANAGED_WINDOW_Z_INDEX_BASE,
  bringManagedWindowToFront,
  getManagedWindowZIndex,
  normalizeManagedWindowOrder,
} from './uiStore';
export { useManagedWindowLayer } from './useManagedWindowLayer';
export type {
  Language,
  ViewConfig,
  ViewOptions,
  NavigationSensitivity,
  PanelsState,
  SidebarState,
  GlobalFontSize,
  CodeEditorFontFamily,
  RotationDisplayMode,
  MassInertiaChangeBehavior,
  ManagedWindowId,
} from './uiStore';
export type { ViewerRenderQuality } from '@/shared/utils/viewerRenderQuality';

// Selection Store - canonical workspace selection, hover, attention, and focus
export {
  matchesSelection,
  repairWorkspaceSelection,
  useSelectionStore,
  validateEntityRef,
} from './selectionStore';
export type {
  SelectionGuard,
  SelectionMatchOptions,
  SelectionState,
  WorkspaceSelectionDetails,
  WorkspaceSelectionValue,
} from './selectionStore';

// Assets Store - mesh/texture resources, robot files, motor library
export { useAssetsStore } from './assetsStore';

// Workspace Store - canonical AssemblyState and operations with unified history
export {
  useWorkspaceStore,
  useWorkspace,
  useActiveComponentId,
  useWorkspaceCanUndo,
  useWorkspaceCanRedo,
} from './workspaceStore';
export type {
  AddBridgeParams,
  AddChildTarget,
  BeginWorkspaceTransactionOptions,
  ReplaceWorkspaceOptions,
  WorkspaceBridgePatch,
  WorkspaceAssemblyPropertyPatch,
  WorkspaceComponentPropertyPatch,
  WorkspaceJointPropertyPatch,
  WorkspaceLinkPropertyPatch,
  WorkspacePropertyPatch,
  WorkspaceComponentSeed,
  WorkspaceMutationOptions,
  WorkspaceStoreData,
  WorkspaceStoreState,
  WorkspaceTransactionState,
} from './workspaceStore';

// Collision transform store - transient drag state for collision gizmos
export { useCollisionTransformStore } from './collisionTransformStore';
export type { PendingCollisionTransform } from './collisionTransformStore';

// Joint interaction preview store - transient drag/preview overlay for panels/editors
export {
  useJointInteractionPreviewStore,
  EMPTY_JOINT_INTERACTION_PREVIEW,
  hasJointInteractionPreview,
} from './jointInteractionPreviewStore';
export type {
  JointInteractionPreviewMatch,
  JointInteractionPreviewSource,
  JointInteractionPreviewSnapshot,
  WorkspaceJointInteractionPreview,
} from './jointInteractionPreviewStore';
