import { getCollisionGeometryEntries } from '@/core/robot/collisionBodies';
import { getVisualGeometryEntries } from '@/core/robot/visualBodies';
import { GeometryType, type RobotData, type UrdfVisual } from '@/types';

type EditableGeometrySourceFormat = 'urdf' | 'xacro' | 'mjcf' | 'sdf';

const SHARED_GEOMETRY_TYPES = new Set([
  GeometryType.NONE,
  GeometryType.BOX,
  GeometryType.CYLINDER,
  GeometryType.SPHERE,
  // URDF retains capsule identity with the Studio data attributes on its cylinder.
  GeometryType.CAPSULE,
]);

function canPreserveGeometry(
  geometry: UrdfVisual,
  format: EditableGeometrySourceFormat,
): boolean {
  if (SHARED_GEOMETRY_TYPES.has(geometry.type)) return true;

  switch (geometry.type) {
    case GeometryType.MESH:
      return Boolean(geometry.meshPath?.trim())
        || (format === 'mjcf' && Boolean(geometry.mjcfMesh?.vertices?.length));
    case GeometryType.PLANE:
      return format === 'mjcf' || format === 'sdf';
    case GeometryType.ELLIPSOID:
      return format === 'mjcf';
    case GeometryType.HFIELD:
      return format === 'mjcf'
        ? Boolean(geometry.mjcfHfield?.size)
        : format === 'sdf' && !geometry.mjcfHfield
          && Boolean(geometry.sdfHeightmap?.uri || geometry.meshPath?.trim());
    case GeometryType.POLYLINE:
      return format === 'sdf' && (geometry.polylinePoints?.length ?? 0) >= 3;
    case GeometryType.SDF:
      return format === 'mjcf'
        && Boolean(geometry.meshPath?.trim() || geometry.mjcfMesh?.vertices?.length);
    default:
      return false;
  }
}

/** Export approximations must not become canonical-looking editable source. */
export function canPreserveGeometryInSource(
  robot: Pick<RobotData, 'links'>,
  format: EditableGeometrySourceFormat,
): boolean {
  return Object.values(robot.links).every(link => [
    ...getVisualGeometryEntries(link),
    ...getCollisionGeometryEntries(link),
  ].every(({ geometry }) => canPreserveGeometry(geometry, format)));
}
