import * as THREE from 'three';

import { type RobotData, type Vector3 } from '@/types';

import {
  type JointAngleOverrideMap,
  type JointKinematicOverrideMap,
  type JointQuaternionOverrideMap,
} from './kinematics';
import {
  IK_LINE_SEARCH_ATTEMPTS,
  IK_NUMERICAL_EPSILON,
  LinkIkEvaluation,
  tempTargetWorldPosition,
  toVector3Value,
  toThreeVector3,
  getLeafLinkIds,
  isLinkIkHandleCandidate,
  isShadowedByMoreDistalIkHandleCandidate,
  collectLinkIkChain,
  buildLinkIkHandleDescriptor,
  computeLinkIkEffectorWorldPosition,
  buildLinkIkEvaluation,
  buildSeedOverrides,
  buildPositionJacobian,
  solveDampedLeastSquaresStep,
  applyIkStep,
  findCoordinateSearchImprovement,
  LinkIkHandleDescriptor,
  LinkIkSolveFailureReason,
  LinkIkPositionSolveRequest,
} from './linkIkHelpers';
export type {
  LinkIkHandleAnchorSource,
  LinkIkHandleDescriptor,
  LinkIkSolveFailureReason,
  LinkIkPositionSolveRequest,
} from './linkIkHelpers';

export interface LinkIkPositionSolveResult {
  angles: JointAngleOverrideMap;
  quaternions: JointQuaternionOverrideMap;
  converged: boolean;
  iterations: number;
  residual: number;
  effectorWorldPosition: Vector3;
  failureReason?: LinkIkSolveFailureReason;
}

export function resolveLinkIkHandleDescriptor(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId'>,
  linkId: string,
): LinkIkHandleDescriptor | null {
  const link = robot.links[linkId];
  if (!link) {
    return null;
  }

  if (!isLinkIkHandleCandidate(robot, linkId)) {
    return null;
  }

  const chainResult = collectLinkIkChain(robot, linkId);
  if (!chainResult.chain && linkId !== robot.rootLinkId) {
    return null;
  }

  if (
    linkId !== robot.rootLinkId &&
    chainResult.chain &&
    isShadowedByMoreDistalIkHandleCandidate(
      robot,
      linkId,
      chainResult.chain.joints.map((joint) => joint.jointId),
    )
  ) {
    return null;
  }

  return buildLinkIkHandleDescriptor(robot, link, linkId, chainResult.chain?.jointIds ?? []);
}

export function resolveDirectManipulableLinkIkDescriptor(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId'>,
  linkId: string,
): LinkIkHandleDescriptor | null {
  const link = robot.links[linkId];
  if (!link || linkId === robot.rootLinkId) {
    return null;
  }

  const chainResult = collectLinkIkChain(robot, linkId);
  if (!chainResult.chain) {
    return null;
  }

  return buildLinkIkHandleDescriptor(robot, link, linkId, chainResult.chain.jointIds);
}

export function resolveDirectManipulableLinkIkJointIds(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId'>,
  linkId: string,
): string[] | null {
  if (!robot.links[linkId] || linkId === robot.rootLinkId) {
    return null;
  }

  const chainResult = collectLinkIkChain(robot, linkId);
  return chainResult.chain ? [...chainResult.chain.jointIds] : null;
}

export function resolveLinkIkHandleDescriptors(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId'>,
): LinkIkHandleDescriptor[] {
  return [robot.rootLinkId, ...getLeafLinkIds(robot)]
    .map((linkId) => resolveLinkIkHandleDescriptor(robot, linkId))
    .filter((descriptor): descriptor is LinkIkHandleDescriptor => descriptor !== null);
}

export function resolveSelectableIkHandleLinkId(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId'>,
  linkId: string,
): string | null {
  if (!robot.links[linkId]) {
    return null;
  }

  if (resolveLinkIkHandleDescriptor(robot, linkId)) {
    return linkId;
  }

  const visitedLinkIds = new Set<string>([linkId]);
  const pendingLinkIds = [linkId];
  const descendantCandidateIds = new Set<string>();

  while (pendingLinkIds.length > 0) {
    const currentLinkId = pendingLinkIds.shift();
    if (!currentLinkId) {
      continue;
    }

    Object.values(robot.joints).forEach((joint) => {
      if (joint.parentLinkId !== currentLinkId || visitedLinkIds.has(joint.childLinkId)) {
        return;
      }

      visitedLinkIds.add(joint.childLinkId);
      pendingLinkIds.push(joint.childLinkId);

      const descriptor = resolveLinkIkHandleDescriptor(robot, joint.childLinkId);
      if (!descriptor) {
        return;
      }

      descendantCandidateIds.add(descriptor.linkId);
    });
  }

  if (descendantCandidateIds.size !== 1) {
    return null;
  }

  return [...descendantCandidateIds][0] ?? null;
}

export function resolveLinkIkHandleWorldPosition(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId'>,
  descriptor: Pick<LinkIkHandleDescriptor, 'linkId' | 'anchorLocal'>,
  overrides: JointKinematicOverrideMap = {},
): Vector3 {
  return toVector3Value(
    computeLinkIkEffectorWorldPosition(robot, descriptor.linkId, descriptor.anchorLocal, overrides),
  );
}

export function solveLinkIkPositionTarget(
  robot: Pick<RobotData, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'>,
  request: LinkIkPositionSolveRequest,
): LinkIkPositionSolveResult {
  const descriptor =
    request.anchorLocal === undefined
      ? (resolveDirectManipulableLinkIkDescriptor(robot, request.linkId) ??
        resolveLinkIkHandleDescriptor(robot, request.linkId))
      : null;
  const chainResult = collectLinkIkChain(robot, request.linkId);
  const maxIterations = request.maxIterations ?? 20;
  const positionTolerance = request.positionTolerance ?? 1e-3;
  const stallTolerance = request.stallTolerance ?? 1e-5;
  const damping = request.damping ?? 1e-3;
  const coordinatePairMaxDistance = request.coordinatePairMaxDistance ?? Number.POSITIVE_INFINITY;
  const anchorLocal = request.anchorLocal ?? descriptor?.anchorLocal;

  if (!anchorLocal || !chainResult.chain) {
    return {
      angles: {},
      quaternions: {},
      converged: false,
      iterations: 0,
      residual: Number.POSITIVE_INFINITY,
      effectorWorldPosition: toVector3Value(new THREE.Vector3()),
      failureReason: chainResult.failureReason ?? 'no-chain',
    };
  }

  tempTargetWorldPosition.copy(toThreeVector3(request.targetWorldPosition));
  const lockedJointIds = [...chainResult.chain.jointIds];
  let acceptedEvaluation = buildLinkIkEvaluation(
    robot,
    request.linkId,
    anchorLocal,
    tempTargetWorldPosition,
    buildSeedOverrides(robot, chainResult.chain, request),
    lockedJointIds,
    {
      damping,
      maxIterations,
      tolerance: positionTolerance,
    },
  );

  if (acceptedEvaluation.numericalFailure) {
    return {
      angles: {},
      quaternions: {},
      converged: false,
      iterations: 0,
      residual: Number.POSITIVE_INFINITY,
      effectorWorldPosition: toVector3Value(new THREE.Vector3()),
      failureReason: 'numerical-failure',
    };
  }

  if (acceptedEvaluation.residual <= positionTolerance) {
    return {
      angles: acceptedEvaluation.overrides.angles ?? {},
      quaternions: acceptedEvaluation.overrides.quaternions ?? {},
      converged: true,
      iterations: 0,
      residual: acceptedEvaluation.residual,
      effectorWorldPosition: toVector3Value(acceptedEvaluation.effectorWorldPosition),
    };
  }

  let failureReason: LinkIkSolveFailureReason | undefined;
  let iterations = 0;

  while (iterations < maxIterations) {
    const jacobianColumns = buildPositionJacobian(
      robot,
      chainResult.chain,
      acceptedEvaluation.effectorWorldPosition,
      acceptedEvaluation.overrides,
    );
    const delta = solveDampedLeastSquaresStep(jacobianColumns, acceptedEvaluation.error, damping);
    if (!delta) {
      failureReason = 'numerical-failure';
      break;
    }

    let nextEvaluation: LinkIkEvaluation | null = null;

    for (let attempt = 0; attempt < IK_LINE_SEARCH_ATTEMPTS; attempt += 1) {
      const scaledOverrides = applyIkStep(
        robot,
        chainResult.chain,
        acceptedEvaluation.overrides,
        delta,
        0.5 ** attempt,
      );
      if (!scaledOverrides) {
        failureReason = 'numerical-failure';
        continue;
      }

      const candidateEvaluation = buildLinkIkEvaluation(
        robot,
        request.linkId,
        anchorLocal,
        tempTargetWorldPosition,
        scaledOverrides,
        lockedJointIds,
        {
          damping,
          maxIterations,
          tolerance: positionTolerance,
        },
      );

      if (candidateEvaluation.numericalFailure) {
        failureReason = 'numerical-failure';
        continue;
      }

      if (candidateEvaluation.residual + IK_NUMERICAL_EPSILON < acceptedEvaluation.residual) {
        nextEvaluation = candidateEvaluation;
        break;
      }
    }

    if (!nextEvaluation) {
      nextEvaluation = findCoordinateSearchImprovement(
        robot,
        chainResult.chain,
        acceptedEvaluation,
        request.linkId,
        anchorLocal,
        tempTargetWorldPosition,
        lockedJointIds,
        {
          coordinatePairMaxDistance,
          damping,
          maxIterations,
          tolerance: positionTolerance,
        },
      );
      if (!nextEvaluation) {
        failureReason = failureReason ?? 'stalled';
        break;
      }
    }

    const improvement = acceptedEvaluation.residual - nextEvaluation.residual;
    acceptedEvaluation = nextEvaluation;
    iterations += 1;

    if (acceptedEvaluation.residual <= positionTolerance) {
      break;
    }

    if (improvement <= stallTolerance) {
      failureReason = 'stalled';
      break;
    }
  }

  return {
    angles: acceptedEvaluation.overrides.angles ?? {},
    quaternions: acceptedEvaluation.overrides.quaternions ?? {},
    converged: acceptedEvaluation.residual <= positionTolerance,
    iterations,
    residual: acceptedEvaluation.residual,
    effectorWorldPosition: toVector3Value(acceptedEvaluation.effectorWorldPosition),
    failureReason:
      acceptedEvaluation.residual <= positionTolerance ? undefined : (failureReason ?? 'stalled'),
  };
}
