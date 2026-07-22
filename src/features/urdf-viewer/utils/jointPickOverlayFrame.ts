import * as THREE from 'three';

import type { PickedSnapFrame } from '@/store/jointPickSessionStore';

export interface PickedSnapLinkLocalDisplay {
  point: THREE.Vector3;
  pose: THREE.Matrix4;
}

/**
 * Convert the click-time world snapshot into the selected link's local space.
 * The bridge solver still consumes the immutable world snapshot, while the
 * overlay recomposes this local pose with the live runtime link after motion
 * or a runtime scene rebuild.
 */
export function derivePickedSnapLinkLocalDisplay(
  frame: PickedSnapFrame,
): PickedSnapLinkLocalDisplay {
  const capturedLinkWorldInverse = new THREE.Matrix4()
    .fromArray(frame.linkWorldMatrix)
    .invert();

  return {
    point: new THREE.Vector3(frame.pointWorld.x, frame.pointWorld.y, frame.pointWorld.z)
      .applyMatrix4(capturedLinkWorldInverse),
    pose: capturedLinkWorldInverse
      .clone()
      .multiply(new THREE.Matrix4().fromArray(frame.poseWorldMatrix)),
  };
}
