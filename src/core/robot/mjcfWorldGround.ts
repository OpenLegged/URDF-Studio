import * as THREE from 'three';

import { GeometryType, type RobotData } from '@/types';
import { createOriginMatrix } from './kinematics';
import { getVisualGeometryEntries } from './visualBodies';

/** Find the broad horizontal support authored directly on an MJCF world body. */
export function resolveMjcfWorldGround(
  robot?: RobotData | null,
  componentMatrix = new THREE.Matrix4(),
): THREE.Box3 | null {
  if (robot?.inspectionContext?.sourceFormat !== 'mjcf') return null;
  const root = robot.links[robot.rootLinkId];
  if (!root || root.name !== 'world' || (root.inertial?.mass ?? 0) > 0) return null;

  let ground: THREE.Box3 | null = null;
  let largestArea = 0;
  for (const { geometry } of getVisualGeometryEntries(root)) {
    const { x, y, z } = geometry.dimensions;
    const plane = geometry.type === GeometryType.PLANE;
    if (!plane && (geometry.type !== GeometryType.BOX || Math.min(x, y) < z * 10)) continue;
    if (!(x > 0 && y > 0 && x * y > largestArea)) continue;
    const matrix = componentMatrix.clone().multiply(createOriginMatrix(geometry.origin));
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(matrix);
    if (Math.abs(normal.z) < 1 - 1e-8) continue;
    const half = new THREE.Vector3(x / 2, y / 2, plane ? 0 : z / 2);
    ground = new THREE.Box3(half.clone().negate(), half).applyMatrix4(matrix);
    largestArea = x * y;
  }
  return ground;
}
