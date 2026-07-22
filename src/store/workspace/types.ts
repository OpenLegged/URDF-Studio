import type { StateCreator } from 'zustand';

import type { AssemblySceneProjection } from '@/core/robot';
import type {
  AssemblyComponent,
  AssemblyState,
  AssemblyTransform,
  BridgeJoint,
  JointEntityRef,
  JointQuaternion,
  LinkEntityRef,
  RenderableBounds,
  RobotData,
  RobotMjcfTendonVisualizationUpdate,
  TendonEntityRef,
  UrdfJoint,
  UrdfLink,
  WorkspaceHistory,
} from '@/types';

export interface WorkspaceMutationOptions {
  label?: string;
  skipHistory?: boolean;
  operationId?: string;
}

export interface ReplaceWorkspaceOptions extends WorkspaceMutationOptions {
  resetHistory?: boolean;
}

export interface WorkspaceComponentSeed {
  id?: string;
  name?: string;
  sourceFile?: string | null;
  robot: RobotData;
  renderableBounds?: RenderableBounds;
  transform?: AssemblyTransform;
  visible?: boolean;
  queueAutoGround?: boolean;
}

export interface AddChildTarget {
  componentId: string;
  parentLinkId: string;
}

export interface AddBridgeParams {
  id?: string;
  name: string;
  parentComponentId: string;
  parentLinkId: string;
  childComponentId: string;
  childLinkId: string;
  joint: Partial<UrdfJoint>;
}

export type WorkspaceBridgePatch = Partial<Omit<BridgeJoint, 'id' | 'joint'>> & {
  joint?: WorkspaceJointPropertyPatch;
};

export type WorkspaceAssemblyPropertyPatch = Partial<Pick<AssemblyState, 'name' | 'transform'>>;
export type WorkspaceComponentPropertyPatch = Partial<
  Pick<AssemblyComponent, 'name' | 'visible' | 'editorLocked' | 'transform'>
>;
type WorkspaceOriginPropertyPatch = Partial<
  Omit<UrdfJoint['origin'], 'xyz' | 'rpy'>
> & {
  xyz?: Partial<UrdfJoint['origin']['xyz']>;
  rpy?: Partial<UrdfJoint['origin']['rpy']>;
};
export type WorkspaceLinkPropertyPatch = Partial<
  Omit<UrdfLink, 'visual' | 'collision' | 'inertial'>
> & {
  visual?: Partial<Omit<UrdfLink['visual'], 'dimensions' | 'origin'>> & {
    dimensions?: Partial<UrdfLink['visual']['dimensions']>;
    origin?: WorkspaceOriginPropertyPatch;
  };
  collision?: Partial<Omit<UrdfLink['collision'], 'dimensions' | 'origin'>> & {
    dimensions?: Partial<UrdfLink['collision']['dimensions']>;
    origin?: WorkspaceOriginPropertyPatch;
  };
  inertial?: Partial<Omit<NonNullable<UrdfLink['inertial']>, 'origin' | 'inertia'>> & {
    origin?: WorkspaceOriginPropertyPatch;
    inertia?: Partial<NonNullable<UrdfLink['inertial']>['inertia']>;
  };
};
export type WorkspaceJointPropertyPatch = Partial<
  Omit<UrdfJoint, 'origin' | 'axis' | 'limit' | 'dynamics' | 'hardware'>
> & {
  origin?: WorkspaceOriginPropertyPatch;
  axis?: Partial<NonNullable<UrdfJoint['axis']>>;
  limit?: Partial<NonNullable<UrdfJoint['limit']>>;
  dynamics?: Partial<UrdfJoint['dynamics']>;
  hardware?: Partial<UrdfJoint['hardware']>;
};
export type WorkspacePropertyPatch =
  | WorkspaceAssemblyPropertyPatch
  | WorkspaceComponentPropertyPatch
  | WorkspaceBridgePatch
  | WorkspaceLinkPropertyPatch
  | WorkspaceJointPropertyPatch
  | RobotMjcfTendonVisualizationUpdate;

export interface WorkspaceTransactionState {
  id: string;
  label: string;
  startedRevision: number;
  componentId?: string;
  exclusive: boolean;
  skipHistory?: boolean;
}

export interface BeginWorkspaceTransactionOptions {
  operationId?: string;
  componentId?: string;
  exclusive?: boolean;
  skipHistory?: boolean;
}

export interface WorkspaceStoreData {
  workspace: AssemblyState;
  activeComponentId: string;
  history: WorkspaceHistory;
  revision: number;
  jointMotionRevision: number;
  pendingAutoGroundComponentIds: string[];
  transaction: WorkspaceTransactionState | null;
}

export interface WorkspaceActions {
  replaceWorkspace: (workspace: AssemblyState, options?: ReplaceWorkspaceOptions) => boolean;
  restoreWorkspace: (workspace: AssemblyState, history: WorkspaceHistory) => boolean;
  resetWorkspace: (name?: string) => void;
  renameWorkspace: (name: string, options?: WorkspaceMutationOptions) => boolean;
  setActiveComponent: (componentId: string) => boolean;

  beginWorkspaceTransaction: (
    label: string,
    options?: BeginWorkspaceTransactionOptions,
  ) => string;
  commitWorkspaceTransaction: (operationId: string) => boolean;
  cancelWorkspaceTransaction: (operationId: string) => boolean;

  undo: () => boolean;
  redo: () => boolean;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearHistory: () => void;

  appendComponent: (
    seed: WorkspaceComponentSeed,
    options?: WorkspaceMutationOptions,
  ) => AssemblyComponent;
  insertComponent: (
    component: AssemblyComponent,
    options?: WorkspaceMutationOptions & { queueAutoGround?: boolean },
  ) => boolean;
  removeComponent: (componentId: string, options?: WorkspaceMutationOptions) => boolean;
  renameComponent: (
    componentId: string,
    name: string,
    options?: WorkspaceMutationOptions,
  ) => boolean;
  updateComponentSourceFile: (
    componentId: string,
    sourceFile: string | null,
    options?: WorkspaceMutationOptions,
  ) => boolean;
  updateComponentTransform: (
    componentId: string,
    transform: AssemblyTransform,
    options?: WorkspaceMutationOptions,
  ) => boolean;
  setComponentVisibility: (
    componentId: string,
    visible: boolean,
    options?: WorkspaceMutationOptions,
  ) => boolean;
  setComponentEditorLocked: (
    componentId: string,
    locked: boolean,
    options?: WorkspaceMutationOptions,
  ) => boolean;
  replaceComponentRobot: (
    componentId: string,
    robot: RobotData,
    options?: WorkspaceMutationOptions,
  ) => boolean;
  replaceComponentRobotAtRevision: (
    componentId: string,
    expectedRevision: number,
    robot: RobotData,
    options?: WorkspaceMutationOptions,
  ) => boolean;

  addLink: (
    componentId: string,
    link: UrdfLink,
    options?: WorkspaceMutationOptions,
  ) => boolean;
  updateLink: (
    ref: LinkEntityRef,
    patch: WorkspaceLinkPropertyPatch,
    options?: WorkspaceMutationOptions,
  ) => boolean;
  deleteLink: (ref: LinkEntityRef, options?: WorkspaceMutationOptions) => boolean;
  setLinkVisibility: (
    ref: LinkEntityRef,
    visible: boolean,
    options?: WorkspaceMutationOptions,
  ) => boolean;
  setLinkEditorLocked: (
    ref: LinkEntityRef,
    locked: boolean,
    options?: WorkspaceMutationOptions,
  ) => boolean;
  setAllLinksVisibility: (
    componentId: string,
    visible: boolean,
    options?: WorkspaceMutationOptions,
  ) => boolean;
  setAllWorkspaceLinksVisibility: (
    visible: boolean,
    options?: WorkspaceMutationOptions,
  ) => boolean;
  addJoint: (
    componentId: string,
    joint: UrdfJoint,
    options?: WorkspaceMutationOptions,
  ) => boolean;
  updateJoint: (
    ref: JointEntityRef,
    patch: WorkspaceJointPropertyPatch,
    options?: WorkspaceMutationOptions,
  ) => boolean;
  deleteJoint: (ref: JointEntityRef, options?: WorkspaceMutationOptions) => boolean;
  updateTendon: (
    ref: TendonEntityRef,
    patch: RobotMjcfTendonVisualizationUpdate,
    options?: WorkspaceMutationOptions,
  ) => boolean;
  addChild: (target: AddChildTarget, options?: WorkspaceMutationOptions) => {
    linkId: string;
    jointId: string;
  } | null;
  deleteSubtree: (ref: LinkEntityRef, options?: WorkspaceMutationOptions) => boolean;

  setJointMotion: (
    ref: JointEntityRef,
    angle: number,
    options?: Pick<WorkspaceMutationOptions, 'operationId'>,
  ) => boolean;
  setComponentJointMotion: (
    componentId: string,
    angles: Record<string, number>,
    quaternions?: Record<string, JointQuaternion>,
    options?: Pick<WorkspaceMutationOptions, 'operationId'>,
  ) => boolean;
  flushPendingJointMotion: (options?: WorkspaceMutationOptions) => boolean;

  updateAssemblyTransform: (
    transform: AssemblyTransform,
    options?: WorkspaceMutationOptions,
  ) => boolean;
  addBridge: (params: AddBridgeParams, options?: WorkspaceMutationOptions) => BridgeJoint;
  updateBridge: (
    bridgeId: string,
    patch: WorkspaceBridgePatch,
    options?: WorkspaceMutationOptions,
  ) => boolean;
  removeBridge: (bridgeId: string, options?: WorkspaceMutationOptions) => boolean;

  consumePendingAutoGroundComponentIds: (componentIds: Iterable<string>) => void;
  clearPendingAutoGroundComponentIds: () => void;
  getSceneProjection: () => AssemblySceneProjection;
}

export type WorkspaceStoreState = WorkspaceStoreData & WorkspaceActions;

type WorkspaceStoreCreator = StateCreator<
  WorkspaceStoreState,
  [['zustand/immer', never]],
  []
>;

export type WorkspaceStoreSet = Parameters<WorkspaceStoreCreator>[0];
export type WorkspaceStoreGet = Parameters<WorkspaceStoreCreator>[1];
