import * as THREE from 'three';

import { createOriginMatrix, getChildJointsByParentLink } from '@/core/robot/kinematics';
import type { InteractionSelection, UrdfJoint } from '@/types';
import type { ViewerRobotDataResolution } from '@/lib/robot-parser/usd/viewerRobotData';
import { resolveOriginTransformJointId } from './originTransformControlsShared';

export interface ResolvedUsdOriginTransformTarget {
  jointId: string;
  childLinkId: string;
  childLinkPath: string;
  parentLinkPath: string | null;
}

export interface BuildUsdOriginPreviewLinkWorldOverridesOptions {
  resolution: ViewerRobotDataResolution;
  jointId: string;
  nextOrigin: UrdfJoint['origin'];
  linkWorldMatrixResolver: (linkPath: string) => THREE.Matrix4 | null;
}

function cloneMatrix(matrix: THREE.Matrix4): THREE.Matrix4 {
  return matrix.clone();
}

function collectAffectedLinkIds(
  resolution: ViewerRobotDataResolution,
  rootLinkId: string,
): string[] {
  const childJointsByParentLink = getChildJointsByParentLink(resolution.robotData);
  const affectedLinkIds: string[] = [];
  const visited = new Set<string>();
  const queue = [rootLinkId];

  while (queue.length > 0) {
    const linkId = queue.shift();
    if (!linkId || visited.has(linkId)) {
      continue;
    }

    visited.add(linkId);
    affectedLinkIds.push(linkId);

    const childJoints = childJointsByParentLink.get(linkId) ?? [];
    childJoints.forEach((joint) => {
      if (!visited.has(joint.childLinkId)) {
        queue.push(joint.childLinkId);
      }
    });
  }

  return affectedLinkIds;
}

export function resolveUsdOriginTransformTarget(
  selection: Pick<InteractionSelection, 'type' | 'id' | 'helperKind'> | null | undefined,
  resolution: ViewerRobotDataResolution | null | undefined,
): ResolvedUsdOriginTransformTarget | null {
  if (!selection || !resolution) {
    return null;
  }

  const jointId = resolveOriginTransformJointId(selection, resolution.robotData.joints);
  if (!jointId) {
    return null;
  }

  const joint = resolution.robotData.joints[jointId];
  const childLinkPath = resolution.childLinkPathByJointId[jointId];
  if (!joint || !childLinkPath) {
    return null;
  }

  return {
    jointId,
    childLinkId: joint.childLinkId,
    childLinkPath,
    parentLinkPath: resolution.linkPathById[joint.parentLinkId] ?? null,
  };
}

export function buildUsdOriginPreviewLinkWorldOverrides({
  resolution,
  jointId,
  nextOrigin,
  linkWorldMatrixResolver,
}: BuildUsdOriginPreviewLinkWorldOverridesOptions): Map<string, THREE.Matrix4> | null {
  const joint = resolution.robotData.joints[jointId];
  const childLinkPath = resolution.childLinkPathByJointId[jointId];
  if (!joint || !childLinkPath) {
    return null;
  }

  const childWorldMatrix = linkWorldMatrixResolver(childLinkPath);
  if (!childWorldMatrix) {
    return null;
  }

  const parentLinkPath = resolution.linkPathById[joint.parentLinkId] ?? null;
  const parentWorldMatrix = parentLinkPath
    ? linkWorldMatrixResolver(parentLinkPath)
    : new THREE.Matrix4().identity();
  if (!parentWorldMatrix) {
    return null;
  }

  const currentJointBaseMatrix = cloneMatrix(parentWorldMatrix).multiply(
    createOriginMatrix(joint.origin),
  );
  const jointMotionMatrix = currentJointBaseMatrix.clone().invert().multiply(childWorldMatrix.clone());
  const nextChildWorldMatrix = cloneMatrix(parentWorldMatrix)
    .multiply(createOriginMatrix(nextOrigin))
    .multiply(jointMotionMatrix);
  const subtreeDeltaMatrix = nextChildWorldMatrix.clone().multiply(childWorldMatrix.clone().invert());

  const nextMatrices = new Map<string, THREE.Matrix4>();
  const affectedLinkIds = collectAffectedLinkIds(resolution, joint.childLinkId);

  affectedLinkIds.forEach((linkId) => {
    const linkPath = resolution.linkPathById[linkId];
    if (!linkPath) {
      return;
    }

    const currentWorldMatrix = linkWorldMatrixResolver(linkPath);
    if (!currentWorldMatrix) {
      return;
    }

    nextMatrices.set(linkPath, subtreeDeltaMatrix.clone().multiply(currentWorldMatrix));
  });

  return nextMatrices;
}
