import * as THREE from 'three';

import type { UrdfJoint, UrdfLink, UrdfOrigin } from '@/types';

function originMatrix(origin: UrdfOrigin): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3().copy(origin.xyz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(
      origin.rpy.r, origin.rpy.p, origin.rpy.y, 'ZYX',
    )),
    new THREE.Vector3(1, 1, 1),
  );
}

function matrixOrigin(matrix: THREE.Matrix4): UrdfOrigin {
  const position = new THREE.Vector3().setFromMatrixPosition(matrix);
  const rotation = new THREE.Euler().setFromRotationMatrix(matrix, 'ZYX');
  return {
    xyz: { x: position.x, y: position.y, z: position.z },
    rpy: { r: rotation.x, p: rotation.y, y: rotation.z },
  };
}

function isIdentity(matrix: THREE.Matrix4): boolean {
  return matrix.elements.every((value, index) => Math.abs(value - (index % 5 === 0 ? 1 : 0)) < 1e-12);
}

/** Only tree joints own the canonical child link frame. A loop closer must
 * never rebase its child's geometry, which already belongs to another joint. */
export function rebaseSdfTreeJointFrames({
  links, joints, linkRecords, jointRecords,
}: {
  links: Record<string, UrdfLink>;
  joints: Record<string, UrdfJoint>;
  linkRecords: Map<string, { worldMatrix: THREE.Matrix4 }>;
  jointRecords: Map<string, { worldMatrix: THREE.Matrix4 }>;
}): Map<string, THREE.Matrix4> {
  const frames = new Map(Array.from(linkRecords, ([id, record]) => [id, record.worldMatrix]));
  for (const joint of Object.values(joints)) {
    const jointWorld = jointRecords.get(joint.id)?.worldMatrix;
    if (jointWorld) frames.set(joint.childLinkId, jointWorld);
  }
  for (const joint of Object.values(joints)) {
    const parentAuthored = linkRecords.get(joint.parentLinkId)?.worldMatrix;
    const parentCanonical = frames.get(joint.parentLinkId);
    if (parentAuthored && parentCanonical) {
      const offset = parentCanonical.clone().invert().multiply(parentAuthored);
      if (!isIdentity(offset)) joint.origin = matrixOrigin(offset.multiply(originMatrix(joint.origin)));
    }
    const authored = linkRecords.get(joint.childLinkId)?.worldMatrix;
    const canonical = frames.get(joint.childLinkId);
    const link = links[joint.childLinkId];
    if (!authored || !canonical || !link) continue;
    const offset = canonical.clone().invert().multiply(authored);
    if (isIdentity(offset)) continue;
    const applyOffset = (origin: UrdfOrigin) => matrixOrigin(offset.clone().multiply(originMatrix(origin)));
    link.visual = { ...link.visual, origin: applyOffset(link.visual.origin) };
    link.collision = { ...link.collision, origin: applyOffset(link.collision.origin) };
    link.visualBodies = link.visualBodies?.map((visual) => ({ ...visual, origin: applyOffset(visual.origin) }));
    link.collisionBodies = link.collisionBodies?.map((collision) => ({ ...collision, origin: applyOffset(collision.origin) }));
    if (link.inertial?.origin) link.inertial = { ...link.inertial, origin: applyOffset(link.inertial.origin) };
  }
  return frames;
}
