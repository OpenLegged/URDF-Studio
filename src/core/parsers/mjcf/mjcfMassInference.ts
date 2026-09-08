import { GeometryType, type UrdfLink, type UrdfVisual } from '@/types';

export interface MjcfMassOptions {
  massMode?: 'auto' | 'recompute';
  densityKgM3?: number;
}

export const DEFAULT_MJCF_DENSITY = 1000;

export function mjcfCollisionGeometries(link: UrdfLink): UrdfVisual[] {
  return [link.collision, ...(link.collisionBodies ?? [])].filter((g) => g && g.type !== GeometryType.NONE);
}

/** Zero tensors are missing data; nonzero malformed tensors remain explicit errors. */
export function needsMjcfInertiaInference(link: UrdfLink): boolean {
  if (!link.inertial) return true;
  const { mass, inertia } = link.inertial;
  return Number.isFinite(mass) && mass >= 0 && [
    inertia.ixx, inertia.iyy, inertia.izz, inertia.ixy, inertia.ixz, inertia.iyz,
  ].every((value) => value === 0);
}

/** Volumes follow the MJCF generator's primitive size conventions. Meshes need prepared vertices. */
export function mjcfPrimitiveVolume(geometry: UrdfVisual): number | null {
  const { x, y, z } = geometry.dimensions;
  switch (geometry.type) {
    case GeometryType.BOX: return x * y * z;
    case GeometryType.SPHERE: return 4 * Math.PI * x ** 3 / 3;
    case GeometryType.CYLINDER: return Math.PI * x * x * y;
    case GeometryType.ELLIPSOID: return 4 * Math.PI * x * y * z / 3;
    case GeometryType.CAPSULE: return Math.PI * x * x * y + 4 * Math.PI * x ** 3 / 3;
    default: return null;
  }
}

export function mjcfCollisionMasses(link: UrdfLink, volumes?: readonly number[]): number[] {
  const values = volumes ?? mjcfCollisionGeometries(link).map(mjcfPrimitiveVolume);
  if (!values.length || values.some((v) => v === null || !Number.isFinite(v) || v <= 0)) {
    throw new Error(`[MJCF export] ${link.name}: preserving mass requires collision shapes with measurable volume.`);
  }
  const validVolumes = values.filter((value): value is number => typeof value === 'number');
  const total = validVolumes.reduce((sum, value) => sum + value, 0);
  return validVolumes.map((value) => link.inertial!.mass * value / total);
}
