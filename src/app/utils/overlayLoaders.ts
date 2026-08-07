import { createPreloadableComponent } from './preloadableComponent';

export const loadCollisionOptimizationDialogModule = () =>
  import('@/features/property-editor/collision_optimization_dialog');

export const loadBridgeCreateModalModule = () =>
  import('@/features/assembly/bridge_create_modal');

export const loadSnapshotDialogModule = () => import('../components/SnapshotDialog');

const collisionOptimizationDialogResource = createPreloadableComponent(
  loadCollisionOptimizationDialogModule,
  (module) => module.CollisionOptimizationDialog,
);

const bridgeCreateModalResource = createPreloadableComponent(
  loadBridgeCreateModalModule,
  (module) => module.BridgeCreateModal,
);

const snapshotDialogResource = createPreloadableComponent(
  loadSnapshotDialogModule,
  (module) => module.SnapshotDialog,
);

export const CollisionOptimizationDialog = collisionOptimizationDialogResource.Component;
export const preloadCollisionOptimizationDialog = collisionOptimizationDialogResource.preload;

export const BridgeCreateModal = bridgeCreateModalResource.Component;
export const preloadBridgeCreateModal = bridgeCreateModalResource.preload;

export const SnapshotDialog = snapshotDialogResource.Component;
export const preloadSnapshotDialog = snapshotDialogResource.preload;
