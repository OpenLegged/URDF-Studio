/**
 * Collision optimization dialog label/option/label-resolver builders. Pure
 * derivation from `TranslationKeys` / `CollisionOptimizationCopy` /
 * `CollisionOptimizationCandidate`; no React, no IO.
 *
 * Boundary: feature utils (property-editor/collision-optimization). Imports
 * `@/types` (GeometryType), `@/shared/i18n` (TranslationKeys), and
 * `../collisionOptimization` types.
 */
import type { TranslationKeys } from '@/shared/i18n';
import { GeometryType } from '@/types';
import type {
  CollisionOptimizationCandidate,
  CoaxialJointMergeStrategy,
  CylinderOptimizationStrategy,
  MeshOptimizationStrategy,
  RodBoxOptimizationStrategy,
} from '../collisionOptimization';

export function buildCollisionOptimizationCopy(t: TranslationKeys) {
  return {
    title: t.collisionOptimizerDialog,
    scope: t.collisionOptimizerScope,
    scopeAll: t.collisionOptimizerScopeAll,
    scopeMesh: t.collisionOptimizerScopeMesh,
    scopePrimitive: t.collisionOptimizerScopePrimitive,
    scopeSelected: t.collisionOptimizerScopeSelected,
    panelSettings: t.collisionOptimizerSettings,
    strategySmart: t.collisionOptimizerStrategySmart,
    strategyKeep: t.collisionOptimizerStrategyKeep,
    strategyBox: t.box,
    strategySphere: t.sphere,
    strategyCylinder: t.cylinder,
    strategyCapsule: t.capsule,
    defaultStrategies: t.collisionOptimizerDefaultStrategies,
    showDefaultStrategies: t.collisionOptimizerShowDefaultStrategies,
    hideDefaultStrategies: t.collisionOptimizerHideDefaultStrategies,
    selectCandidateHint: t.collisionOptimizerSelectCandidateHint,
    selectedCandidate: t.collisionOptimizerSelectedCandidate,
    includeCandidate: t.collisionOptimizerIncludeCandidate,
    meshStrategyLabel: t.collisionOptimizerMeshStrategyLabel,
    meshStrategyDesc: t.collisionOptimizerMeshStrategyDesc,
    cylinderStrategyLabel: t.collisionOptimizerCylinderStrategyLabel,
    cylinderStrategyDesc: t.collisionOptimizerCylinderStrategyDesc,
    rodBoxStrategyLabel: t.collisionOptimizerRodBoxStrategyLabel,
    rodBoxStrategyDesc: t.collisionOptimizerRodBoxStrategyDesc,
    coaxialMergeStrategyLabel: t.collisionOptimizerCoaxialMergeStrategyLabel,
    coaxialMergeStrategyDesc: t.collisionOptimizerCoaxialMergeStrategyDesc,
    rules: t.collisionOptimizerRules,
    avoidSiblingOverlap: t.collisionOptimizerAvoidSiblingOverlap,
    avoidSiblingOverlapDesc: t.collisionOptimizerAvoidSiblingOverlapDesc,
    candidates: t.collisionOptimizerCandidates,
    selectAll: t.collisionOptimizerSelectAll,
    clearAll: t.collisionOptimizerClearSelection,
    selectedCount: t.selected,
    noCandidates: t.collisionOptimizerNoSuggestion,
    noSelectedCollision: t.collisionOptimizerNoSelectedCollision,
    analyzing: t.collisionOptimizerLoading,
    apply: t.collisionOptimizerApplyAction,
    warningTitle: t.collisionOptimizerWarningTitle,
    warningBefore: t.collisionOptimizerWarningBefore,
    warningAfter: t.collisionOptimizerWarningAfter,
    ready: t.collisionOptimizerReady,
    disabled: t.collisionOptimizerDisabled,
    missingMeshPath: t.collisionOptimizerMissingMeshPath,
    meshAnalysisFailed: t.collisionOptimizerMeshAnalysisFailed,
    noRuleMatch: t.collisionOptimizerNoRuleMatch,
    reasonMeshSmart: t.collisionOptimizerReasonMeshSmart,
    reasonMeshManual: t.collisionOptimizerReasonMeshManual,
    reasonCylinder: t.collisionOptimizerReasonCylinder,
    reasonRodBox: t.collisionOptimizerReasonRodBox,
    reasonRodBoxCylinder: t.collisionOptimizerReasonRodBoxCylinder,
    reasonCoaxialCapsule: t.collisionOptimizerReasonCoaxialCapsule,
    reasonCoaxialCylinder: t.collisionOptimizerReasonCoaxialCylinder,
    totalCollisions: t.collisionOptimizerStatsTotal,
    meshCollisions: t.collisionOptimizerStatsMeshes,
    eligible: t.collisionOptimizerStatsOptimizable,
    warnings: t.collisionOptimizerStatsWarnings,
    collisionIndex: t.collisionOptimizerCollisionIndex,
    current: t.collisionOptimizerCurrent,
    primary: t.collisionOptimizerPrimary,
    component: t.collisionOptimizerComponent,
    jointPair: t.collisionOptimizerJointPair,
    suggested: t.collisionOptimizerSuggested,
    viewList: t.collisionOptimizerViewList,
    viewGraph: t.collisionOptimizerViewGraph,
    frontView: t.collisionOptimizerFrontView,
    graphHint: t.collisionOptimizerGraphHint,
    clearManualPairs: t.collisionOptimizerClearManualPairs,
    manualPair: t.collisionOptimizerManualPair,
    autoPair: t.collisionOptimizerAutoPair,
    mergeTo: t.collisionOptimizerMergeTo,
    mergedInto: t.collisionOptimizerMergedInto,
    connectTargets: t.collisionOptimizerConnectTargets,
    zoomIn: t.collisionOptimizerZoomIn,
    zoomOut: t.collisionOptimizerZoomOut,
    resetView: t.collisionOptimizerResetView,
  };
}

export type CollisionOptimizationCopy = ReturnType<typeof buildCollisionOptimizationCopy>;

export function buildCandidatePanelLabels(copy: CollisionOptimizationCopy) {
  return {
    analyzing: copy.analyzing,
    clearAll: copy.clearAll,
    clearManualPairs: copy.clearManualPairs,
    eligible: copy.eligible,
    noCandidates: copy.noCandidates,
    noSelectedCollision: copy.noSelectedCollision,
    scopeAll: copy.scopeAll,
    scopeMesh: copy.scopeMesh,
    scopePrimitive: copy.scopePrimitive,
    scopeSelected: copy.scopeSelected,
    selectAll: copy.selectAll,
    selectedCount: copy.selectedCount,
    title: copy.candidates,
    viewGraph: copy.viewGraph,
    viewList: copy.viewList,
  };
}

export function buildCandidateListLabels(copy: CollisionOptimizationCopy) {
  return {
    clearAll: copy.clearAll,
    collisionIndex: copy.collisionIndex,
    component: copy.component,
    jointPair: copy.jointPair,
    noCandidates: copy.noCandidates,
    selectedCount: copy.selectedCount,
  };
}

export function buildGraphLabels(copy: CollisionOptimizationCopy) {
  return {
    autoPair: copy.autoPair,
    collisionIndex: copy.collisionIndex,
    component: copy.component,
    connectionHandle: copy.connectTargets,
    dragHint: copy.graphHint,
    empty: copy.noCandidates,
    frontView: copy.frontView,
    manualPair: copy.manualPair,
    mergeTo: copy.mergeTo,
    mergedInto: copy.mergedInto,
    primary: copy.primary,
    selectCandidate: copy.selectAll,
    resetView: copy.resetView,
    unselectCandidate: copy.clearAll,
    zoomIn: copy.zoomIn,
    zoomOut: copy.zoomOut,
  };
}

export function buildMeshStrategyOptions(
  copy: CollisionOptimizationCopy,
): Array<{ value: MeshOptimizationStrategy; label: string }> {
  return [
    { value: 'capsule', label: copy.strategyCapsule },
    { value: 'smart', label: copy.strategySmart },
    { value: 'cylinder', label: copy.strategyCylinder },
    { value: 'box', label: copy.strategyBox },
    { value: 'sphere', label: copy.strategySphere },
    { value: 'keep', label: copy.strategyKeep },
  ];
}

export function buildCylinderStrategyOptions(
  copy: CollisionOptimizationCopy,
): Array<{ value: CylinderOptimizationStrategy; label: string }> {
  return [
    { value: 'capsule', label: copy.strategyCapsule },
    { value: 'keep', label: copy.strategyKeep },
  ];
}

export function buildRodBoxStrategyOptions(
  copy: CollisionOptimizationCopy,
): Array<{ value: RodBoxOptimizationStrategy; label: string }> {
  return [
    { value: 'capsule', label: copy.strategyCapsule },
    { value: 'cylinder', label: copy.strategyCylinder },
    { value: 'keep', label: copy.strategyKeep },
  ];
}

export function buildCoaxialMergeStrategyOptions(
  copy: CollisionOptimizationCopy,
): Array<{ value: CoaxialJointMergeStrategy; label: string }> {
  return [
    { value: 'capsule', label: copy.strategyCapsule },
    { value: 'cylinder', label: copy.strategyCylinder },
    { value: 'keep', label: copy.strategyKeep },
  ];
}

export function formatGeometryTypeLabel(
  type: GeometryType | null | undefined,
  t: TranslationKeys,
): string {
  switch (type) {
    case GeometryType.BOX:
      return t.box;
    case GeometryType.PLANE:
      return t.plane;
    case GeometryType.SPHERE:
      return t.sphere;
    case GeometryType.ELLIPSOID:
      return t.ellipsoid;
    case GeometryType.CYLINDER:
      return t.cylinder;
    case GeometryType.CAPSULE:
      return t.capsule;
    case GeometryType.HFIELD:
      return t.hfield;
    case GeometryType.SDF:
      return t.sdf;
    case GeometryType.MESH:
      return t.mesh;
    default:
      return t.none;
  }
}

export function getCandidateStatusLabel(
  candidate: CollisionOptimizationCandidate,
  copy: CollisionOptimizationCopy,
): string {
  if (candidate.eligible) {
    return copy.ready;
  }

  switch (candidate.status) {
    case 'disabled':
      return copy.disabled;
    case 'missing-mesh-path':
      return copy.missingMeshPath;
    case 'mesh-analysis-failed':
      return copy.meshAnalysisFailed;
    case 'no-rule-match':
    default:
      return copy.noRuleMatch;
  }
}

export function getCandidateReasonLabel(
  candidate: CollisionOptimizationCandidate,
  copy: CollisionOptimizationCopy,
): string | null {
  switch (candidate.reason) {
    case 'mesh-smart-fit':
      return copy.reasonMeshSmart;
    case 'mesh-manual-fit':
      return copy.reasonMeshManual;
    case 'cylinder-to-capsule':
      return copy.reasonCylinder;
    case 'rod-box-to-capsule':
      return copy.reasonRodBox;
    case 'rod-box-to-cylinder':
      return copy.reasonRodBoxCylinder;
    case 'coaxial-merge-to-capsule':
      return copy.reasonCoaxialCapsule;
    case 'coaxial-merge-to-cylinder':
      return copy.reasonCoaxialCylinder;
    default:
      return null;
  }
}
