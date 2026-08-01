import * as THREE from 'three';

export interface RobotPrimitiveGeometryDetail {
  readonly cylinderRadialSegments: number;
  readonly sphereWidthSegments: number;
  readonly sphereHeightSegments: number;
  readonly capsuleCapSegments: number;
  readonly capsuleRadialSegments: number;
}

/**
 * Keeps curved robot primitives visually smooth at the viewer's normal zoom levels.
 * Each caller owns the returned geometry and is responsible for disposing it.
 */
export const DEFAULT_ROBOT_PRIMITIVE_GEOMETRY_DETAIL: RobotPrimitiveGeometryDetail = {
  cylinderRadialSegments: 96,
  sphereWidthSegments: 48,
  sphereHeightSegments: 32,
  capsuleCapSegments: 12,
  capsuleRadialSegments: 24,
};

function resolveSegmentCount(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, Math.round(value!)));
}

export function resolveRobotPrimitiveGeometryDetail(
  detail: Partial<RobotPrimitiveGeometryDetail> | undefined,
): RobotPrimitiveGeometryDetail {
  return {
    cylinderRadialSegments: resolveSegmentCount(
      detail?.cylinderRadialSegments,
      DEFAULT_ROBOT_PRIMITIVE_GEOMETRY_DETAIL.cylinderRadialSegments,
      12,
      256,
    ),
    sphereWidthSegments: resolveSegmentCount(
      detail?.sphereWidthSegments,
      DEFAULT_ROBOT_PRIMITIVE_GEOMETRY_DETAIL.sphereWidthSegments,
      8,
      256,
    ),
    sphereHeightSegments: resolveSegmentCount(
      detail?.sphereHeightSegments,
      DEFAULT_ROBOT_PRIMITIVE_GEOMETRY_DETAIL.sphereHeightSegments,
      4,
      128,
    ),
    capsuleCapSegments: resolveSegmentCount(
      detail?.capsuleCapSegments,
      DEFAULT_ROBOT_PRIMITIVE_GEOMETRY_DETAIL.capsuleCapSegments,
      2,
      64,
    ),
    capsuleRadialSegments: resolveSegmentCount(
      detail?.capsuleRadialSegments,
      DEFAULT_ROBOT_PRIMITIVE_GEOMETRY_DETAIL.capsuleRadialSegments,
      4,
      128,
    ),
  };
}

export function createRobotCylinderGeometry(
  detail?: Partial<RobotPrimitiveGeometryDetail>,
): THREE.CylinderGeometry {
  const resolved = resolveRobotPrimitiveGeometryDetail(detail);
  return new THREE.CylinderGeometry(1, 1, 1, resolved.cylinderRadialSegments);
}

export function createRobotSphereGeometry(
  detail?: Partial<RobotPrimitiveGeometryDetail>,
): THREE.SphereGeometry {
  const resolved = resolveRobotPrimitiveGeometryDetail(detail);
  return new THREE.SphereGeometry(1, resolved.sphereWidthSegments, resolved.sphereHeightSegments);
}

export function createRobotCapsuleGeometry(
  radius: number,
  bodyLength: number,
  detail?: Partial<RobotPrimitiveGeometryDetail>,
): THREE.CapsuleGeometry {
  const resolved = resolveRobotPrimitiveGeometryDetail(detail);
  return new THREE.CapsuleGeometry(
    radius,
    bodyLength,
    resolved.capsuleCapSegments,
    resolved.capsuleRadialSegments,
  );
}
