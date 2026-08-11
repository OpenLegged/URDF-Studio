/**
 * Property Editor Feature Module
 * Provides link and joint property editing capabilities
 */

// Components
export { PropertyEditor } from './components/PropertyEditor';
export { TransformFields } from './components/TransformFields';
export { CollisionOptimizationDialog } from './components/CollisionOptimizationDialog';

// Types
export type {
  PropertyEditorProps,
  WorkspaceAssemblyPropertyPatch,
  WorkspaceComponentPropertyPatch,
  WorkspaceJointPropertyPatch,
  WorkspaceLinkPropertyPatch,
  WorkspacePropertyPatch,
} from './components/PropertyEditor';
export {
  analyzeCollisionOptimization,
  applyCollisionOptimizationOperationsToLinks,
  buildCollisionOptimizationOperations,
  collectCollisionTargets,
  countSameLinkOverlapWarnings,
  resolveDetailLinkTabAfterGeometrySelection,
  resolveDetailLinkTabAfterViewerMeshSelect,
} from './utils';
export type {
  CollisionOptimizationOperation,
  CollisionOptimizationSource,
  CollisionTargetRef,
} from './utils';
