/**
 * Manual merge pair relation helpers for collision optimization. Pure functions
 * over `CollisionOptimizationSource` / `CollisionTargetRef`; no React, no IO.
 *
 * Boundary: feature utils (property-editor/collision-optimization). Imports
 * `../collisionOptimization` types only.
 */
import type {
  CollisionOptimizationSource,
  CollisionTargetRef,
} from '../collisionOptimization';

export function createRelationKey(
  componentId: string | undefined,
  sourceLinkId: string,
  targetLinkId: string,
): string {
  return `${componentId ?? 'robot'}::${sourceLinkId}::${targetLinkId}`;
}

export function createManualMergePairKey(
  primaryTargetId: string,
  secondaryTargetId: string,
): string {
  return `${primaryTargetId}::${secondaryTargetId}`;
}

export interface LinkRelationEntry {
  componentId?: string;
  parentLinkId: string;
  childLinkId: string;
}

export type LinkRelationByDirection = Map<string, LinkRelationEntry>;

export function buildLinkRelationByDirection(
  source: CollisionOptimizationSource,
): LinkRelationByDirection {
  const relationMap: LinkRelationByDirection = new Map();

  if (source.kind === 'robot') {
    Object.values(source.robot.joints).forEach((joint) => {
      if (joint.type !== 'fixed' && joint.type !== 'revolute' && joint.type !== 'continuous') {
        return;
      }

      const relation: LinkRelationEntry = {
        componentId: undefined,
        parentLinkId: joint.parentLinkId,
        childLinkId: joint.childLinkId,
      };
      relationMap.set(
        createRelationKey(undefined, joint.parentLinkId, joint.childLinkId),
        relation,
      );
      relationMap.set(
        createRelationKey(undefined, joint.childLinkId, joint.parentLinkId),
        relation,
      );
    });
    return relationMap;
  }

  Object.values(source.assembly.components).forEach((component) => {
    Object.values(component.robot.joints).forEach((joint) => {
      if (joint.type !== 'fixed' && joint.type !== 'revolute' && joint.type !== 'continuous') {
        return;
      }

      const relation: LinkRelationEntry = {
        componentId: component.id,
        parentLinkId: joint.parentLinkId,
        childLinkId: joint.childLinkId,
      };
      relationMap.set(
        createRelationKey(component.id, joint.parentLinkId, joint.childLinkId),
        relation,
      );
      relationMap.set(
        createRelationKey(component.id, joint.childLinkId, joint.parentLinkId),
        relation,
      );
    });
  });

  return relationMap;
}

export function canCreateManualPair(
  sourceTargetId: string,
  targetTargetId: string,
  targetById: Map<string, CollisionTargetRef>,
  linkRelationByDirection: LinkRelationByDirection,
): boolean {
  if (sourceTargetId === targetTargetId) {
    return false;
  }

  const sourceTarget = targetById.get(sourceTargetId);
  const target = targetById.get(targetTargetId);
  if (!sourceTarget || !target) {
    return false;
  }

  if ((sourceTarget.componentId ?? 'robot') !== (target.componentId ?? 'robot')) {
    return false;
  }

  return linkRelationByDirection.has(
    createRelationKey(sourceTarget.componentId, sourceTarget.linkId, target.linkId),
  );
}
