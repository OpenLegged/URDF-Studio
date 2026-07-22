/**
 * Robot Core Module
 * Provides robot data manipulation utilities
 */

// Constants
export * from './constants';

// Builders - Factory functions for creating robot components
export {
  generateId,
  generateLinkId,
  generateJointId,
  createLink,
  createAttachedChildLink,
  createJoint,
  createEmptyRobot,
  addChildToRobot,
  resolveDefaultChildJointOrigin,
  cloneLink,
  cloneJoint,
} from './builders';

// Validators - Data validation functions
export {
  validateLink,
  validateJoint,
  validateRobot,
  hasLinks,
  hasJoints,
  isRootLink,
  hasChildren,
  getParentJoint,
  getChildJoints,
} from './validators';

export type { ValidationError, ValidationResult } from './validators';

export {
  getPrimaryTreeRenderRootLinkId,
  getPrimaryTreeDisplayRootLinkId,
  getTreeRenderRootLinkIds,
  getTreeDisplayRootLinkIds,
  isTransparentDisplayLink,
  isSyntheticJointStageLink,
  isSyntheticWorldRoot,
} from './treeRoots';

// Collision body manipulation
export {
  appendCollisionBody,
  getCollisionGeometryByObjectIndex,
  getCollisionGeometryEntries,
  optimizeCylinderCollisionsToCapsules,
  removeCollisionGeometryByObjectIndex,
  replaceCollisionGeometriesByObjectIndex,
  updateCollisionGeometryByObjectIndex,
} from './collisionBodies';

export {
  getVisualGeometryEntries,
  getVisualGeometryByObjectIndex,
  removeVisualGeometryByObjectIndex,
  updateVisualGeometryByObjectIndex,
} from './visualBodies';
export {
  BOX_FACE_MATERIAL_ORDER,
  canEditGeometryBaseTexture,
  collectGeometryTexturePaths,
  getEffectiveGeometryAuthoredMaterials,
  getBoxFaceMaterialPalette,
  getGeometryAuthoredMaterials,
  getPreferredSingleMaterialFromBoxFacePalette,
  hasBoxFaceMaterialPalette,
  hasMultipleAuthoredMaterials,
  resolveVisualMaterialOverride,
  updateVisualAuthoredMaterialByObjectIndex,
  updateVisualBaseTextureByObjectIndex,
} from './visualMaterials';
export type { BoxFaceMaterialEntry, BoxFaceMaterialName } from './visualMaterials';
export {
  applyMeshMaterialPaintEdit,
  getGeometryMeshMaterialGroups,
  getGeometryMeshMaterialGroupsForMesh,
  hasGeometryMeshMaterialGroups,
  normalizeGeometryAuthoredMaterials,
} from './visualMeshMaterialGroups';

export { resolveJointKey, resolveLinkKey } from './identity';

export {
  computeLinkWorldMatrices,
  extractJointActualAngleFromQuaternion,
  extractJointMotionAngleFromQuaternion,
  extractSignedAngleAroundAxis,
  getJointActualAngleFromMotionAngle,
  getJointMotionPose,
  getJointMotionAngleFromActualAngle,
  getJointReferencePosition,
  getNormalizedJointAxis,
  getChildJointsByParentLink,
  getParentJointByChildLink,
} from './kinematics';

export {
  getOrderedJointLimitBounds,
  hasFiniteJointLimitBounds,
  normalizeJointLimitOrder,
} from './jointLimits';

export { resolveMimicJointAngleTargets } from './mimic';
export {
  clampJointInteractionValue,
  normalizeJointInteractionLimits,
} from './jointInteractionLimits.js';
export {
  HARD_PASSIVE_SPRING_STIFFNESS_THRESHOLD,
  PASSIVE_SPRING_EFFORT_EPSILON,
  isHardPassiveSpringJoint,
  isPassiveSpringJoint,
  isUnactuatedJoint,
  resolveMjcfPassiveSpringJointMetadata,
} from './passiveSpringJoints';

export {
  createRobotClosedLoopConstraint,
  createRobotDistanceClosedLoopConstraint,
  solveClosedLoopMotionCompensation,
  resolveClosedLoopDrivenJointMotion,
  resolveClosedLoopJointMotionCompensation,
  resolveClosedLoopJointAngleCompensation,
  resolveClosedLoopJointOriginCompensation,
  resolveClosedLoopJointOriginCompensationDetailed,
} from './closedLoops';

// Assembly Merger - Merge AssemblyState to RobotData
export { mergeAssembly } from './assemblyMerger';
export { createAssemblySceneProjection } from './assemblySceneProjection';
export {
  buildAssemblyProjectedAssetAliases,
  projectAssemblyComponentRobotResources,
  resolveAssemblyComponentResourcePath,
  resolveAssemblySceneRenderStrategy,
} from './assemblyResourcePaths';
export type { AssemblySceneRenderStrategy } from './assemblyResourcePaths';
export type {
  AssemblyComponentRootTarget,
  AssemblySceneProjection,
} from './assemblySceneProjection';
export { createAssemblyScenePlacement } from './assemblyScenePlacement';
export type {
  AssemblyComponentSceneTransformTarget,
  AssemblyScenePlacement,
} from './assemblyScenePlacement';
export { resolveWorkspaceRobotDataTarget } from './workspaceRobotTarget';
export type {
  WorkspaceInspectableEntityRef,
  WorkspaceRobotDataTarget,
} from './workspaceRobotTarget';
export { analyzeAssemblyConnectivity } from './assemblyConnectivity';
export {
  buildAssemblyComponentIdentity,
  createUniqueAssemblyComponentName,
  normalizeComponentRobot,
  prepareAssemblyRobotData,
  resolveAssemblyComponentBaseName,
  sanitizeAssemblyComponentId,
} from './assemblyComponentPreparation';
export {
  assertCanonicalRobotData,
  assertCanonicalWorkspace,
  createDefaultWorkspace,
  createSingleComponentWorkspace,
  validateCanonicalRobotData,
  validateCanonicalWorkspace,
} from './canonicalWorkspace';
export type {
  CanonicalAssemblyComponent,
  CanonicalAssemblyState,
  CanonicalWorkspaceValidationIssue,
  CanonicalWorkspaceValidationResult,
  CreateSingleComponentWorkspaceOptions,
} from './canonicalWorkspace';
export {
  buildDefaultAssemblyComponentPlacementTransform,
  estimateLinkCollisionBounds,
  estimateLinkRenderableBounds,
  estimateLinkVisualBounds,
  estimateRobotGroundOffset,
  resolveLinkRenderableBounds,
} from './assemblyPlacement';

export {
  resolveDirectManipulableLinkIkDescriptor,
  resolveDirectManipulableLinkIkJointIds,
  resolveLinkIkHandleDescriptor,
  resolveLinkIkHandleDescriptors,
  resolveSelectableIkHandleLinkId,
  solveLinkIkPositionTarget,
} from './linkIk';
export type {
  LinkIkHandleDescriptor,
  LinkIkHandleAnchorSource,
  LinkIkPositionSolveRequest,
  LinkIkPositionSolveResult,
  LinkIkSolveFailureReason,
} from './linkIk';

// Transforms - Coordinate transformation utilities
export {
  zeroVector,
  zeroEuler,
  addVectors,
  subtractVectors,
  scaleVector,
  vectorMagnitude,
  normalizeVector,
  dotProduct,
  crossProduct,
  distance,
  degToRad,
  radToDeg,
  clamp,
  lerp,
  lerpVector,
  vectorsEqual,
  eulersEqual,
  eulerToRotationMatrix,
  rotateVector,
  rotateVectorAroundAxis,
  transformPoint,
  inverseTransformPoint,
  formatNumber,
  formatVector,
  formatEuler,
} from './transforms';

export { buildDeletionPlan, applyDeletionPlan, type DeletionPlan } from './treeOperations';
export {
  detectGeometryPatches,
  detectJointPatches,
} from './runtime_patch_diff';
export type {
  GeometryPatchCandidate,
  JointPatchCandidate,
} from './runtime_patch_diff';

export {
  createComponentSourceDraft,
  createSourceSemanticRobotHash,
  isComponentSourceDraftMatchingComponent,
  isComponentSourceDraftMatchingRobot,
  isComponentSourceFormat,
  requireSourcePreservingComponentDraft,
  resolveSourcePreservingComponentDraft,
} from './componentSourceDraft';
export type { SourcePreservingDraftResolution } from './componentSourceDraft';
export {
  createRobotPersistenceSnapshot,
  createRobotSemanticSnapshot,
  createStableJsonSnapshot,
  stripPresentationStateFromRobotData,
  stripRobotPersistenceState,
  stripTransientJointMotionFromJoint,
  stripTransientJointMotionFromJoints,
  stripTransientJointMotionFromRobotData,
} from './semanticSnapshot';
export {
  hasComponentEditorLocks,
  isEntityEditorLocked,
  isWorkspaceSelectionEditorLocked,
  resolveRobotLinkEditorLock,
} from './editorLock';
