import * as THREE from 'three';
import { isSingleDofJoint } from '@/shared/utils/jointTypes';
import type { UrdfJoint } from '@/types';
import { isPassiveSpringJointDragTarget } from './passiveSpringJointDragTarget';

export interface DraggableRuntimeJoint extends THREE.Object3D {
  axis?: THREE.Vector3;
  angle?: number;
  jointValue?: number | readonly number[] | null;
  jointType?: string;
  limit?: { lower?: number; upper?: number } | null;
  isURDFJoint?: boolean;
  setJointValue?: (value: number) => unknown;
}

interface RuntimeLinkObject extends THREE.Object3D {
  isURDFLink?: boolean;
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

  const findParentLinkForJoint = (jointObject: THREE.Object3D): RuntimeLinkObject | null => {
    let parentLink: THREE.Object3D | null = jointObject.parent;
    while (parentLink && parentLink !== robot) {
      const runtimeLink = parentLink as RuntimeLinkObject;
      if (runtimeLink.isURDFLink || runtimeLink.type === 'URDFLink') {
        return runtimeLink;
      }
      parentLink = parentLink.parent;
    }
    return null;
  };

  function resolveControllableJoint(
    jointObject: DraggableRuntimeJoint,
  ): DraggableRuntimeJoint | null {
    if (
      !isSingleDofJoint(jointObject) ||
      isPassiveSpringJointDragTarget(jointObject.name, robotJoints, jointObject)
    ) {
      return findParentJoint(findParentLinkForJoint(jointObject));
    }
    return jointObject;
  }

  function findParentJoint(linkObject: THREE.Object3D | null): DraggableRuntimeJoint | null {
    if (!linkObject) {
      return null;
    }

    let current: THREE.Object3D | null = linkObject.parent;
    while (current && current !== robot) {
      if (isRuntimeJointObject(current)) {
        return resolveControllableJoint(current);
      }
      current = current.parent;
    }
    return null;
  }

  return {
    findParentJoint,
    resolveJointObject(object: THREE.Object3D | null) {
      return isRuntimeJointObject(object) ? resolveControllableJoint(object) : null;
    },
  };
}
