import type { GeometryType as GeometryTypeValue, UrdfVisual } from '@/types';
import type { MeshAnalysis } from '../geometryConversion';
import type { CollisionOptimizationClearanceWorld } from './clearanceContext';
import type {
  CollisionOptimizationScope,
  CollisionOptimizationSource,
  CollisionTargetRef,
} from './collisionTargets';

export type MeshOptimizationStrategy = 'keep' | 'smart' | 'box' | 'sphere' | 'cylinder' | 'capsule';
export type CylinderOptimizationStrategy = 'keep' | 'capsule';
export type RodBoxOptimizationStrategy = 'keep' | 'capsule' | 'cylinder';
export type CoaxialJointMergeStrategy = 'keep' | 'capsule' | 'cylinder';
export type CollisionOptimizationManualMergeStrategy = Exclude<CoaxialJointMergeStrategy, 'keep'>;

export interface CollisionOptimizationManualMergePair {
  primaryTargetId: string;
  secondaryTargetId: string;
  strategy?: CollisionOptimizationManualMergeStrategy | null;
}

export interface CollisionOptimizationSettings {
  scope: CollisionOptimizationScope;
  meshStrategy: MeshOptimizationStrategy;
  cylinderStrategy: CylinderOptimizationStrategy;
  rodBoxStrategy: RodBoxOptimizationStrategy;
  coaxialJointMergeStrategy: CoaxialJointMergeStrategy;
  manualMergePairs?: CollisionOptimizationManualMergePair[];
  avoidSiblingOverlap: boolean;
  selectedTargetId?: string | null;
}

export type CollisionOptimizationReason =
  | 'mesh-smart-fit'
  | 'mesh-manual-fit'
  | 'cylinder-to-capsule'
  | 'rod-box-to-capsule'
  | 'rod-box-to-cylinder'
  | 'coaxial-merge-to-capsule'
  | 'coaxial-merge-to-cylinder';

export type CollisionOptimizationStatus =
  | 'ready'
  | 'disabled'
  | 'missing-mesh-path'
  | 'mesh-analysis-failed'
  | 'no-rule-match';

interface CollisionOptimizationMutationBase {
  componentId?: string;
  linkId: string;
  objectIndex: number;
}

export type CollisionOptimizationMutation =
  | (CollisionOptimizationMutationBase & {
      type: 'update';
      nextGeometry: UrdfVisual;
    })
  | (CollisionOptimizationMutationBase & {
      type: 'remove';
    })
  | (CollisionOptimizationMutationBase & {
      type: 'replace-many';
      nextGeometries: UrdfVisual[];
    });

export interface CollisionOptimizationCandidate {
  target: CollisionTargetRef;
  secondaryTarget?: CollisionTargetRef;
  eligible: boolean;
  currentType: GeometryTypeValue;
  suggestedType: GeometryTypeValue | null;
  status: CollisionOptimizationStatus;
  reason?: CollisionOptimizationReason;
  nextGeometry?: UrdfVisual;
  mutations?: CollisionOptimizationMutation[];
  affectedTargetIds?: string[];
  conflictPriority?: number;
  autoSelect?: boolean;
}

export interface CollisionOptimizationBaseAnalysis {
  source: CollisionOptimizationSource;
  targets: CollisionTargetRef[];
  meshAnalysisByTargetId: Record<string, MeshAnalysis | null>;
  clearanceWorld: CollisionOptimizationClearanceWorld | null;
}
