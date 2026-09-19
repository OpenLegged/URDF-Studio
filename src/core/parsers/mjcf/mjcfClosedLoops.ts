/**
 * MJCF closed-loop constraints
 *
 * Pure logic extracted from mjcfParser.ts: turns MuJoCo <connect> equality
 * constraints and fixed-length spatial tendons into RobotState closed-loop
 * constraints. Walks the body tree to bind sites / link-frame offsets, then
 * resolves each loop's anchor into world space via the robot's link matrices.
 */

import * as THREE from 'three';

import {
  computeLinkWorldMatrices,
  createRobotClosedLoopConstraint,
  createRobotDistanceClosedLoopConstraint,
  resolveLinkKey,
} from '@/core/robot';
import { JointType, type RobotClosedLoopJointConstraint, type RobotState } from '@/types';

import { isNonZeroPosition, subtractLocalOffset, toPositionObject, toRPYObjectFromQuat } from './mjcfMath';
import { type MJCFModelConnectConstraint, type MJCFModelWeldConstraint, type ParsedMJCFModel } from './mjcfModel';

const FIXED_TENDON_RANGE_EPSILON = 1e-5;

interface MJCFSiteConstraintBinding {
  bodyName: string;
  anchorLocal: { x: number; y: number; z: number };
}

function resolveBodyLinkFrameOffsetLocal(
  body: ParsedMJCFModel['worldBody'],
): { x: number; y: number; z: number } | null {
  const jointOffset = toPositionObject(body.joints?.[0]?.pos);
  return isNonZeroPosition(jointOffset) ? jointOffset : null;
}

function collectSiteConstraintBindings(
  body: ParsedMJCFModel['worldBody'],
  bindings = new Map<string, MJCFSiteConstraintBinding>(),
): Map<string, MJCFSiteConstraintBinding> {
  const linkFrameOffsetLocal = resolveBodyLinkFrameOffsetLocal(body);

  (body.sites || []).forEach((site) => {
    const binding: MJCFSiteConstraintBinding = {
      bodyName: body.name,
      // MJCF sites live in the raw body frame; imported links are rebased to the
      // joint pivot when joint.pos is non-zero, so tendon anchors must follow that shift.
      anchorLocal: subtractLocalOffset(toPositionObject(site.pos), linkFrameOffsetLocal) ?? {
        x: 0,
        y: 0,
        z: 0,
      },
    };

    bindings.set(site.name, binding);
    if (site.sourceName) {
      bindings.set(site.sourceName, binding);
    }
  });

  (body.children || []).forEach((child) => collectSiteConstraintBindings(child, bindings));
  return bindings;
}

function collectBodyLinkFrameOffsets(
  body: ParsedMJCFModel['worldBody'],
  bindings = new Map<
    string,
    { linkFrameOffsetLocal: { x: number; y: number; z: number } | null }
  >(),
): Map<string, { linkFrameOffsetLocal: { x: number; y: number; z: number } | null }> {
  bindings.set(body.name, {
    linkFrameOffsetLocal: resolveBodyLinkFrameOffsetLocal(body),
  });

  (body.children || []).forEach((child) => collectBodyLinkFrameOffsets(child, bindings));
  return bindings;
}

function isFixedSpatialTendonRange(range: [number, number] | undefined): range is [number, number] {
  return !!range && Math.abs(range[1] - range[0]) <= FIXED_TENDON_RANGE_EPSILON;
}

function buildTendonDistanceClosedLoopConstraints(
  robot: Pick<RobotState, 'links' | 'joints' | 'rootLinkId'>,
  tendonMap: ParsedMJCFModel['tendonMap'],
  worldBody: ParsedMJCFModel['worldBody'],
): RobotState['closedLoopConstraints'] {
  if (tendonMap.size === 0) {
    return undefined;
  }

  const siteBindings = collectSiteConstraintBindings(worldBody);
  if (siteBindings.size === 0) {
    return undefined;
  }

  const linkWorldMatrices = computeLinkWorldMatrices(robot);
  const closedLoopConstraints = Array.from(tendonMap.values()).flatMap((tendon) => {
    if (
      tendon.type !== 'spatial' ||
      tendon.attachments.length !== 2 ||
      !isFixedSpatialTendonRange(tendon.range)
    ) {
      return [];
    }

    const [attachmentA, attachmentB] = tendon.attachments;
    if (
      attachmentA?.type !== 'site' ||
      attachmentB?.type !== 'site' ||
      !attachmentA.ref ||
      !attachmentB.ref
    ) {
      return [];
    }

    const bindingA = siteBindings.get(attachmentA.ref);
    const bindingB = siteBindings.get(attachmentB.ref);
    if (!bindingA || !bindingB) {
      return [];
    }

    const linkAId = resolveLinkKey(robot.links, bindingA.bodyName);
    const linkBId = resolveLinkKey(robot.links, bindingB.bodyName);
    if (!linkAId || !linkBId) {
      return [];
    }

    const linkAMatrix = linkWorldMatrices[linkAId];
    if (!linkAMatrix) {
      return [];
    }

    const anchorWorldVector = new THREE.Vector3(
      bindingA.anchorLocal.x,
      bindingA.anchorLocal.y,
      bindingA.anchorLocal.z,
    ).applyMatrix4(linkAMatrix);

    return [
      createRobotDistanceClosedLoopConstraint(
        `mjcf-distance-${tendon.name}`,
        linkAId,
        linkBId,
        bindingA.anchorLocal,
        bindingB.anchorLocal,
        {
          x: anchorWorldVector.x,
          y: anchorWorldVector.y,
          z: anchorWorldVector.z,
        },
        tendon.range[0],
        {
          format: 'mjcf',
          body1Name: bindingA.bodyName,
          body2Name: bindingB.bodyName,
        },
      ),
    ];
  });

  return closedLoopConstraints.length > 0 ? closedLoopConstraints : undefined;
}

function buildWeldClosedLoopConstraints(
  robot: Pick<RobotState, 'links' | 'joints' | 'rootLinkId'>,
  weldConstraints: MJCFModelWeldConstraint[],
  worldBody: ParsedMJCFModel['worldBody'],
): RobotClosedLoopJointConstraint[] {
  const matrices = computeLinkWorldMatrices(robot);
  const bindings = collectBodyLinkFrameOffsets(worldBody);
  return weldConstraints.map(constraint => {
    const linkAId = resolveLinkKey(robot.links, constraint.body1);
    const linkBId = resolveLinkKey(robot.links, constraint.body2);
    if (!linkAId || !linkBId) throw new Error(`MJCF weld "${constraint.name ?? ''}" references an unknown body.`);
    const matrixA = matrices[linkAId];
    const matrixB = matrices[linkBId];
    const rawAnchorB = toPositionObject(constraint.anchor);
    const anchorLocalB = subtractLocalOffset(rawAnchorB, bindings.get(constraint.body2)?.linkFrameOffsetLocal ?? null) ?? rawAnchorB;
    const anchorWorldB = new THREE.Vector3().copy(anchorLocalB).applyMatrix4(matrixB);
    const relpose = constraint.relpose;
    const hasAuthoredPose = relpose && relpose.slice(3).some(value => value !== 0);
    const inferredAnchorA = anchorWorldB.clone().applyMatrix4(matrixA.clone().invert());
    const rawAnchorA = hasAuthoredPose
      ? { x: relpose[0], y: relpose[1], z: relpose[2] }
      : null;
    const anchorLocalA = rawAnchorA
      ? subtractLocalOffset(rawAnchorA, bindings.get(constraint.body1)?.linkFrameOffsetLocal ?? null) ?? rawAnchorA
      : { x: inferredAnchorA.x, y: inferredAnchorA.y, z: inferredAnchorA.z };
    const quaternion = hasAuthoredPose
      ? new THREE.Quaternion(relpose[4], relpose[5], relpose[6], relpose[3]).normalize()
      : new THREE.Quaternion().setFromRotationMatrix(matrixA).invert()
        .multiply(new THREE.Quaternion().setFromRotationMatrix(matrixB)).normalize();
    const anchorWorld = new THREE.Vector3().copy(anchorLocalA).applyMatrix4(matrixA);
    return {
      id: constraint.name || `mjcf-weld-${constraint.body1}-${constraint.body2}`,
      type: 'joint', jointType: JointType.FIXED, linkAId, linkBId,
      anchorLocalA, anchorLocalB,
      anchorWorld: { x: anchorWorld.x, y: anchorWorld.y, z: anchorWorld.z },
      origin: { xyz: anchorLocalA, rpy: toRPYObjectFromQuat(quaternion) ?? { r: 0, p: 0, y: 0 },
        quatXyzw: { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w } },
      source: { format: 'mjcf', body1Name: constraint.body1, body2Name: constraint.body2 },
    };
  });
}

export function buildClosedLoopConstraints(
  robot: Pick<RobotState, 'links' | 'joints' | 'rootLinkId'>,
  { connectConstraints, weldConstraints, tendonMap, worldBody }: {
    connectConstraints: MJCFModelConnectConstraint[];
    weldConstraints: MJCFModelWeldConstraint[];
    tendonMap: ParsedMJCFModel['tendonMap'];
    worldBody: ParsedMJCFModel['worldBody'];
  },
): RobotState['closedLoopConstraints'] {
  if (connectConstraints.length === 0 && weldConstraints.length === 0 && tendonMap.size === 0) return undefined;

  const linkWorldMatrices = computeLinkWorldMatrices(robot);
  const bodyBindings = collectBodyLinkFrameOffsets(worldBody);
  const connectClosedLoopConstraints = connectConstraints.flatMap((constraint) => {
    const linkAId = resolveLinkKey(robot.links, constraint.body1);
    const linkBId = resolveLinkKey(robot.links, constraint.body2);

    if (!linkAId || !linkBId) {
      return [];
    }

    const linkAMatrix = linkWorldMatrices[linkAId];
    const linkBMatrix = linkWorldMatrices[linkBId];
    if (!linkAMatrix || !linkBMatrix) {
      return [];
    }

    const rawAnchorLocalA = {
      x: constraint.anchor[0] ?? 0,
      y: constraint.anchor[1] ?? 0,
      z: constraint.anchor[2] ?? 0,
    };
    const anchorLocalA =
      subtractLocalOffset(
        rawAnchorLocalA,
        bodyBindings.get(constraint.body1)?.linkFrameOffsetLocal ?? null,
      ) ?? rawAnchorLocalA;
    const anchorWorldVector = new THREE.Vector3(
      anchorLocalA.x,
      anchorLocalA.y,
      anchorLocalA.z,
    ).applyMatrix4(linkAMatrix);
    const anchorLocalBVector = anchorWorldVector.clone().applyMatrix4(linkBMatrix.clone().invert());

    return [
      createRobotClosedLoopConstraint(
        constraint.name || `mjcf-connect-${constraint.body1}-${constraint.body2}`,
        linkAId,
        linkBId,
        anchorLocalA,
        {
          x: anchorLocalBVector.x,
          y: anchorLocalBVector.y,
          z: anchorLocalBVector.z,
        },
        {
          x: anchorWorldVector.x,
          y: anchorWorldVector.y,
          z: anchorWorldVector.z,
        },
        {
          format: 'mjcf',
          body1Name: constraint.body1,
          body2Name: constraint.body2,
        },
      ),
    ];
  });

  const tendonClosedLoopConstraints =
    buildTendonDistanceClosedLoopConstraints(robot, tendonMap, worldBody) ?? [];
  const closedLoopConstraints = [...connectClosedLoopConstraints, ...tendonClosedLoopConstraints,
    ...buildWeldClosedLoopConstraints(robot, weldConstraints, worldBody)];

  return closedLoopConstraints.length > 0 ? closedLoopConstraints : undefined;
}
