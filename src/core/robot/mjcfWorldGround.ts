import * as THREE from 'three';

import { GeometryType, type RobotData, type UrdfLink } from '@/types';
import { getCollisionGeometryEntries } from './collisionBodies';
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

  return resolveWorldGroundFromLink(root, componentMatrix);
}

/**
 * Whether an MJCF model authored its own world floor.
 *
 * Runtime load paths only hold the links record (no RobotData root id), so the
 * parser-generated world link is matched by id/name here. Used to keep the
 * authored scene placement — floor at the MuJoCo world origin, robot at its
 * authored height above it — instead of grounding the robot on the viewer grid.
 */
export function hasAuthoredMjcfWorldGround(
  links: Record<string, UrdfLink> | null | undefined,
): boolean {
  if (!links) return false;
  const worldLink = links.world ?? Object.values(links).find((link) => link?.name === 'world');
  if (!worldLink || (worldLink.inertial?.mass ?? 0) > 0) return false;

  return resolveWorldGroundFromLink(worldLink, new THREE.Matrix4()) !== null;
}

function resolveWorldGroundFromLink(
  link: UrdfLink,
  componentMatrix: THREE.Matrix4,
): THREE.Box3 | null {
  let ground: THREE.Box3 | null = null;
  let largestArea = 0;
  for (const { geometry } of [...getCollisionGeometryEntries(link), ...getVisualGeometryEntries(link)]) {
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
