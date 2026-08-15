import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import { createBridgeActions } from './workspace/bridgeActions';
import { createComponentActions } from './workspace/componentActions';
import { createInitialWorkspaceStoreData } from './workspace/helpers';
import { createWorkspaceRuntime } from './workspace/runtime';
import { createTopologyActions } from './workspace/topologyActions';
import type { WorkspaceStoreState } from './workspace/types';

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
  WorkspaceJointMotionTarget,
  WorkspaceStoreData,
  WorkspaceStoreState,
  WorkspaceTransactionState,
} from './workspace/types';

/** The sole mutable robot-domain store. RobotData exists only inside components. */
export const useWorkspaceStore = create<WorkspaceStoreState>()(
  immer((set, get) => {
    const runtime = createWorkspaceRuntime(set, get);
    return {
      ...createInitialWorkspaceStoreData('my_robot'),
      ...runtime.actions,
      ...createComponentActions(set, get, runtime),
      ...createTopologyActions(get, runtime),
      ...createBridgeActions(set, get, runtime),
    };
  }),
);

export const useWorkspace = () => useWorkspaceStore((state) => state.workspace);
export const useActiveComponentId = () =>
  useWorkspaceStore((state) => state.activeComponentId);
export const useWorkspaceCanUndo = () =>
  useWorkspaceStore((state) => state.history.past.length > 0);
export const useWorkspaceCanRedo = () =>
  useWorkspaceStore((state) => state.history.future.length > 0);
