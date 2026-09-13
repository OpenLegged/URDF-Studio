import {
  MAX_GEOMETRY_DIMENSION_DECIMALS,
  MAX_PROPERTY_DECIMALS,
  formatNumberPreservingPrecision,
  formatNumberWithMaxDecimals,
} from '@/core/utils/numberPrecision';
import type { UrdfVisual } from '@/types';

/** Source serialization keeps numeric values; ordinary exports retain compact formatting. */
export function createSdfNumericFormat(preserveNumericPrecision = false) {
  const epsilon = preserveNumericPrecision ? 0 : 1e-9;
  const scalar = preserveNumericPrecision
    ? formatNumberPreservingPrecision
    : (value: number) => formatNumberWithMaxDecimals(value, MAX_PROPERTY_DECIMALS);
  const shape = preserveNumericPrecision
    ? formatNumberPreservingPrecision
    : (value: number) => formatNumberWithMaxDecimals(value, MAX_GEOMETRY_DIMENSION_DECIMALS);
  const color = preserveNumericPrecision
    ? formatNumberPreservingPrecision
    : (value: number) => value.toFixed(8);
  const components = (pose: UrdfVisual['origin']) => [
    pose.xyz.x, pose.xyz.y, pose.xyz.z, pose.rpy.r, pose.rpy.p, pose.rpy.y,
  ];

  return {
    epsilon,
    scalar,
    shape,
    color,
    pose: (pose: UrdfVisual['origin']) => components(pose).map(scalar).join(' '),
    isIdentityPose: (pose: UrdfVisual['origin']) =>
      components(pose).every((value) => Math.abs(value) <= epsilon),
  };
}

export type SdfNumericFormat = ReturnType<typeof createSdfNumericFormat>;
