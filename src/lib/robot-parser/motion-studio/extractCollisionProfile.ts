import { GeometryType } from '@/types/geometry';
import type { RobotData } from '@/types/robot';
import type { UrdfVisual } from '@/types/geometry';
import type { RobotCollisionBody, RobotCollisionProfile } from './types';

/**
 * Extract Motion Studio's collision profile from canonical {@link RobotData}
 * produced by any supported definition format.
 *
 * Geometry dimension remapping is required because URDF Studio's RobotData
 * stores compact dimensions per geometry type (see
 * `src/core/parsers/urdf/parser/geometry.ts`):
 * - box:     dimensions = {sizeX, sizeY, sizeZ}
 * - sphere:  dimensions = {radius, 0, 0}
 * - cylinder:dimensions = {radius, length, 0}
 * - capsule: dimensions = {radius, bodyLength, 0}; bodyLength excludes caps
 * - mesh:    dimensions = {scaleX, scaleY, scaleZ} (mesh scale, not geometry!)
 *
 * Motion Studio expects symmetric dimensions (sphere {r,r,r}, cylinder
 * {r,length,r}), so each type is remapped accordingly.
 */
export function extractCollisionProfile(
  robotData: RobotData,
  robotId?: string,
): RobotCollisionProfile {
  const links: Record<string, RobotCollisionBody[]> = {};

  for (const link of Object.values(robotData.links)) {
    const linkName = link.name;
    if (!linkName) continue;

    const visuals = [link.collision, ...(link.collisionBodies ?? [])];
    const bodies: RobotCollisionBody[] = [];
    visuals.forEach((visual, index) => {
      const body = mapVisualToCollisionBody(visual, linkName, index);
      if (body) bodies.push(body);
    });

    if (bodies.length > 0) links[linkName] = bodies;
  }

  return { robotId: robotId ?? robotData.name, links };
}

function mapVisualToCollisionBody(
  visual: UrdfVisual,
  linkName: string,
  index: number,
): RobotCollisionBody | null {
  const mapped = mapGeometry(visual);
  if (!mapped) return null;

  return {
    id: `${linkName}:collision:${index}`,
    runtimeKey: `${linkName}::collision::${index}`,
    linkName,
    source: 'definition',
    type: mapped.type,
    dimensions: mapped.dimensions,
    meshFilename: mapped.meshFilename,
    scale: mapped.scale,
    origin: {
      xyz: {
        x: visual.origin.xyz.x,
        y: visual.origin.xyz.y,
        z: visual.origin.xyz.z,
      },
      rpy: {
        r: visual.origin.rpy.r,
        p: visual.origin.rpy.p,
        y: visual.origin.rpy.y,
      },
    },
    enabled: true,
    visible: true,
  };
}

type MappedGeometry = Pick<RobotCollisionBody, 'type' | 'dimensions' | 'meshFilename' | 'scale'>;

function mapGeometry(visual: UrdfVisual): MappedGeometry | null {
  const { type, dimensions } = visual;

  switch (type) {
    case GeometryType.BOX:
      return {
        type: 'box',
        dimensions: { x: dimensions.x, y: dimensions.y, z: dimensions.z },
      };
    case GeometryType.PLANE:
      return {
        type: 'plane',
        dimensions: { x: dimensions.x, y: dimensions.y, z: dimensions.z },
      };
    case GeometryType.SPHERE:
      return {
        type: 'sphere',
        dimensions: { x: dimensions.x, y: dimensions.x, z: dimensions.x },
      };
    case GeometryType.ELLIPSOID:
      return {
        type: 'ellipsoid',
        dimensions: { x: dimensions.x, y: dimensions.y, z: dimensions.z },
      };
    case GeometryType.CYLINDER:
      return {
        type: 'cylinder',
        dimensions: { x: dimensions.x, y: dimensions.y, z: dimensions.x },
      };
    case GeometryType.CAPSULE:
      return {
        type: 'capsule',
        dimensions: { x: dimensions.x, y: dimensions.y, z: dimensions.x },
      };
    case GeometryType.HFIELD:
      return {
        type: 'hfield',
        dimensions: { x: dimensions.x, y: dimensions.y, z: dimensions.z },
      };
    case GeometryType.POLYLINE:
      return {
        type: 'polyline',
        dimensions: { x: dimensions.x, y: dimensions.y, z: dimensions.z },
      };
    case GeometryType.MESH: {
      const meshFilename = visual.meshPath;
      if (!meshFilename) return null;
      // URDF mesh: scale stored in `dimensions` (geometry.ts:82-86).
      // MJCF mesh: scale stored in `mjcfMesh.scale` (array form).
      const scale = visual.mjcfMesh?.scale
        ? { x: visual.mjcfMesh.scale[0], y: visual.mjcfMesh.scale[1], z: visual.mjcfMesh.scale[2] }
        : { x: dimensions.x, y: dimensions.y, z: dimensions.z };
      return { type: 'mesh', meshFilename, scale };
    }
    default:
      // SDF / NONE do not describe a directly renderable collision body.
      return null;
  }
}
