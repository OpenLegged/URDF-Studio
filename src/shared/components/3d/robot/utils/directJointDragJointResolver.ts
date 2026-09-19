import * as THREE from 'three';
import { isSingleDofJoint } from '@/shared/utils/jointTypes';
import type { UrdfJoint } from '@/types/index';
import { isPassiveSpringJointDragTarget } from '@/shared/components/3d/robot/utils/passiveSpringJointDragTarget';

export interface DraggableRuntimeJoint extends THREE.Object3D {
  axis?: THREE.Vector3;
  angle?: number;
  jointValue?: number | readonly number[] | null;
  jointType?: string;
  limit?: { lower?: number; upper?: number } | null;
  isURDFJoint?: boolean;
  setJointValue?: (value: number) => unknown;
}

interface DirectJointDragJointResolverOptions {
  robot: THREE.Object3D | null;
  robotJoints: Record<string, UrdfJoint> | undefined;
}

/** Resolves geometry hits to the nearest controllable runtime joint. */
export function createDirectJointDragJointResolver({
  robot,
  robotJoints,
}: DirectJointDragJointResolverOptions) {
  const isRuntimeJointObject = (
    object: THREE.Object3D | null,
  ): object is DraggableRuntimeJoint =>
    Boolean(
      object &&
        ((object as DraggableRuntimeJoint).isURDFJoint || object.type === 'URDFJoint'),
    );

  function resolveAncestorJoint(
    object: THREE.Object3D | null,
  ): DraggableRuntimeJoint | null {
    const visited = new Set<THREE.Object3D>();
    let nearestPassiveJoint: DraggableRuntimeJoint | null = null;
    let current = object;
    while (current && current !== robot && !visited.has(current)) {
      visited.add(current);
      if (isRuntimeJointObject(current) && isSingleDofJoint(current)) {
        if (!isPassiveSpringJointDragTarget(current.name, robotJoints, current)) {
          return current;
        }
        nearestPassiveJoint ??= current;
      }
      current = current.parent;
    }

    // Prefer upstream control joints in compliant robot chains, while allowing
    // passive mechanisms to move when the entire ancestor chain is passive.
    return nearestPassiveJoint;
  }

  return {
    findParentJoint(linkObject: THREE.Object3D | null) {
      return resolveAncestorJoint(linkObject?.parent ?? null);
    },
    resolveJointObject(object: THREE.Object3D | null) {
      return isRuntimeJointObject(object) ? resolveAncestorJoint(object) : null;
    },
  };
}
