import * as THREE from 'three';
import type { AssemblyTransform, RenderableBounds, RobotData, UrdfLink, UrdfVisual } from '@/types';
import { GeometryType } from '@/types';
import { computeLinkWorldMatrices } from './kinematics';
import { cloneAssemblyTransform, IDENTITY_ASSEMBLY_TRANSFORM } from './assemblyTransforms';
import { getVisualGeometryEntries } from './visualBodies';

const DEFAULT_ASSEMBLY_COMPONENT_PLACEMENT_GAP = 0.12;
const DEFAULT_ASSEMBLY_COMPONENT_HALF_WIDTH = 0.45;

const UNIT_BOX_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
const UNIT_PLANE_GEOMETRY = new THREE.PlaneGeometry(1, 1);
const UNIT_CYLINDER_GEOMETRY = new THREE.CylinderGeometry(1, 1, 1, 12, 1);
const UNIT_SPHERE_GEOMETRY = new THREE.SphereGeometry(1, 12, 12);
const IDENTITY_MATRIX = new THREE.Matrix4().identity();

type AssemblyPlacementComparableComponent = {
  robot?: RobotData | null;
  renderableBounds?: RenderableBounds | null;
  transform?: AssemblyTransform | null;
};

type GeometryBoundsDescriptor = {
  geometry: THREE.BufferGeometry;
  scale: THREE.Vector3;
  rotation: THREE.Euler;
  disposeAfterUse?: boolean;
};

function toFiniteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function createGeometryBoundsDescriptor(geometry: UrdfVisual): GeometryBoundsDescriptor | null {
  switch (geometry.type) {
    case GeometryType.BOX:
      return {
        geometry: UNIT_BOX_GEOMETRY,
        scale: new THREE.Vector3(
          toFiniteOr(geometry.dimensions.x, 0),
          toFiniteOr(geometry.dimensions.y, 0),
          toFiniteOr(geometry.dimensions.z, 0),
        ),
        rotation: new THREE.Euler(0, 0, 0, 'ZYX'),
      };
    case GeometryType.PLANE:
      return {
        geometry: UNIT_PLANE_GEOMETRY,
        scale: new THREE.Vector3(
          Math.max(toFiniteOr(geometry.dimensions.x, 1), 1e-6),
          Math.max(toFiniteOr(geometry.dimensions.y, 1), 1e-6),
          1,
        ),
        rotation: new THREE.Euler(0, 0, 0, 'ZYX'),
      };
    case GeometryType.CYLINDER:
      return {
        geometry: UNIT_CYLINDER_GEOMETRY,
        scale: new THREE.Vector3(
          Math.max(toFiniteOr(geometry.dimensions.x, 0), 0),
          Math.max(toFiniteOr(geometry.dimensions.y, 0), 0),
          Math.max(toFiniteOr(geometry.dimensions.z, geometry.dimensions.x), 0),
        ),
        rotation: new THREE.Euler(-Math.PI / 2, 0, 0, 'ZYX'),
      };
    case GeometryType.SPHERE:
    case GeometryType.ELLIPSOID:
      return {
        geometry: UNIT_SPHERE_GEOMETRY,
        scale: new THREE.Vector3(
          Math.max(toFiniteOr(geometry.dimensions.x, 0), 0),
          Math.max(toFiniteOr(geometry.dimensions.y, geometry.dimensions.x), 0),
          Math.max(toFiniteOr(geometry.dimensions.z, geometry.dimensions.x), 0),
        ),
        rotation: new THREE.Euler(0, 0, 0, 'ZYX'),
      };
    case GeometryType.CAPSULE: {
      const radius = Math.max(toFiniteOr(geometry.dimensions.x, 0), 0);
      const totalLength = Math.max(toFiniteOr(geometry.dimensions.y, 0), 0);
      const cylinderLength = Math.max(0, totalLength - 2 * radius);
      return {
        geometry: new THREE.CapsuleGeometry(radius, cylinderLength, 4, 8),
        scale: new THREE.Vector3(1, 1, 1),
        rotation: new THREE.Euler(-Math.PI / 2, 0, 0, 'ZYX'),
        disposeAfterUse: true,
      };
    }
    case GeometryType.MESH:
      return null;
    default:
      return null;
  }
}

function unionGeometryBounds(
  bounds: THREE.Box3,
  hasBounds: { current: boolean },
  linkMatrix: THREE.Matrix4,
  geometry: UrdfVisual,
): void {
  const descriptor = createGeometryBoundsDescriptor(geometry);
  if (!descriptor) {
    return;
  }

  if (!descriptor.geometry.boundingBox) {
    descriptor.geometry.computeBoundingBox();
  }

  const geometryBox = descriptor.geometry.boundingBox;
  if (!geometryBox) {
    if (descriptor.disposeAfterUse) {
      descriptor.geometry.dispose();
    }
    return;
  }

  const origin = geometry.origin ?? {
    xyz: { x: 0, y: 0, z: 0 },
    rpy: { r: 0, p: 0, y: 0 },
  };
  const originMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(
      toFiniteOr(origin.xyz?.x, 0),
      toFiniteOr(origin.xyz?.y, 0),
      toFiniteOr(origin.xyz?.z, 0),
    ),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        toFiniteOr(origin.rpy?.r, 0),
        toFiniteOr(origin.rpy?.p, 0),
        toFiniteOr(origin.rpy?.y, 0),
        'ZYX',
      ),
    ),
    new THREE.Vector3(1, 1, 1),
  );
  const childMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(0, 0, 0),
    new THREE.Quaternion().setFromEuler(descriptor.rotation),
    descriptor.scale,
  );
  const worldMatrix = linkMatrix.clone().multiply(originMatrix).multiply(childMatrix);
  const worldBox = geometryBox.clone().applyMatrix4(worldMatrix);

  if (!hasBounds.current) {
    bounds.copy(worldBox);
    hasBounds.current = true;
  } else {
    bounds.union(worldBox);
  }

  if (descriptor.disposeAfterUse) {
    descriptor.geometry.dispose();
  }
}

function estimateRobotRenderableBounds(robot: RobotData): THREE.Box3 | null {
  const bounds = new THREE.Box3();
  const hasBounds = { current: false };
  const linkWorldMatrices = computeLinkWorldMatrices(robot);

  Object.entries(robot.links).forEach(([linkId, link]) => {
    const linkMatrix = linkWorldMatrices[linkId] ?? IDENTITY_MATRIX;
    const linkBounds = new THREE.Box3();
    const linkHasBounds = { current: false };

    getVisualGeometryEntries(link).forEach((entry) => {
      unionGeometryBounds(linkBounds, linkHasBounds, linkMatrix, entry.geometry);
    });

    if (!linkHasBounds.current && link.collision.type !== GeometryType.NONE) {
      unionGeometryBounds(linkBounds, linkHasBounds, linkMatrix, link.collision);
    }

    if (!linkHasBounds.current) {
      (link.collisionBodies ?? []).forEach((body) => {
        if (body.type !== GeometryType.NONE) {
          unionGeometryBounds(linkBounds, linkHasBounds, linkMatrix, body);
        }
      });
    }

    if (!linkHasBounds.current) {
      return;
    }

    if (!hasBounds.current) {
      bounds.copy(linkBounds);
      hasBounds.current = true;
      return;
    }

    bounds.union(linkBounds);
  });

  return hasBounds.current ? bounds : null;
}

function estimateLinkVisualBoundsInternal(link: UrdfLink): THREE.Box3 | null {
  const linkBounds = new THREE.Box3();
  const linkHasBounds = { current: false };

  getVisualGeometryEntries(link).forEach((entry) => {
    unionGeometryBounds(linkBounds, linkHasBounds, IDENTITY_MATRIX, entry.geometry);
  });

  return linkHasBounds.current ? linkBounds : null;
}

function estimateLinkCollisionBoundsInternal(link: UrdfLink): THREE.Box3 | null {
  const linkBounds = new THREE.Box3();
  const linkHasBounds = { current: false };

  if (link.collision.type !== GeometryType.NONE) {
    unionGeometryBounds(linkBounds, linkHasBounds, IDENTITY_MATRIX, link.collision);
  }

  (link.collisionBodies ?? []).forEach((body) => {
    if (body.type !== GeometryType.NONE) {
      unionGeometryBounds(linkBounds, linkHasBounds, IDENTITY_MATRIX, body);
    }
  });

  return linkHasBounds.current ? linkBounds : null;
}

export function estimateLinkVisualBounds(link: UrdfLink): THREE.Box3 | null {
  return estimateLinkVisualBoundsInternal(link);
}

export function estimateLinkCollisionBounds(link: UrdfLink): THREE.Box3 | null {
  return estimateLinkCollisionBoundsInternal(link);
}

export function resolveLinkRenderableBounds(
  link: UrdfLink,
): { bounds: THREE.Box3; source: 'visual-bounds' | 'collision-bounds' } | null {
  const visualBounds = estimateLinkVisualBoundsInternal(link);
  if (visualBounds) {
    return { bounds: visualBounds, source: 'visual-bounds' };
  }

  const collisionBounds = estimateLinkCollisionBoundsInternal(link);
  if (collisionBounds) {
    return { bounds: collisionBounds, source: 'collision-bounds' };
  }

  return null;
}

export function estimateLinkRenderableBounds(link: UrdfLink): THREE.Box3 | null {
  return resolveLinkRenderableBounds(link)?.bounds ?? null;
}

function createBoxFromRenderableBounds(bounds?: RenderableBounds | null): THREE.Box3 | null {
  if (!bounds) {
    return null;
  }

  return new THREE.Box3(
    new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
    new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
  );
}

function resolveRenderableBounds(
  robot: RobotData | null | undefined,
  renderableBounds?: RenderableBounds | null,
): THREE.Box3 | null {
  return (
    createBoxFromRenderableBounds(renderableBounds) ??
    (robot ? estimateRobotRenderableBounds(robot) : null)
  );
}

export function estimateRobotGroundOffset(
  robot: RobotData,
  options: { renderableBounds?: RenderableBounds | null } = {},
): number {
  const minZ = resolveRenderableBounds(robot, options.renderableBounds)?.min.z;
  return Number.isFinite(minZ) ? -Number(minZ) : 0;
}

function transformBounds(bounds: THREE.Box3, transform?: AssemblyTransform | null): THREE.Box3 {
  const normalized = cloneAssemblyTransform(transform);
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(normalized.position.x, normalized.position.y, normalized.position.z),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(normalized.rotation.r, normalized.rotation.p, normalized.rotation.y, 'ZYX'),
    ),
    new THREE.Vector3(1, 1, 1),
  );

  return bounds.clone().applyMatrix4(matrix);
}

function buildFallbackBounds(): THREE.Box3 {
  return new THREE.Box3(
    new THREE.Vector3(
      -DEFAULT_ASSEMBLY_COMPONENT_HALF_WIDTH,
      -DEFAULT_ASSEMBLY_COMPONENT_HALF_WIDTH,
      0,
    ),
    new THREE.Vector3(
      DEFAULT_ASSEMBLY_COMPONENT_HALF_WIDTH,
      DEFAULT_ASSEMBLY_COMPONENT_HALF_WIDTH,
      0,
    ),
  );
}

export function buildDefaultAssemblyComponentPlacementTransform({
  robot,
  renderableBounds,
  existingComponents,
  gap = DEFAULT_ASSEMBLY_COMPONENT_PLACEMENT_GAP,
}: {
  robot: RobotData;
  renderableBounds?: RenderableBounds | null;
  existingComponents: AssemblyPlacementComparableComponent[];
  gap?: number;
}): AssemblyTransform {
  if (existingComponents.length === 0) {
    return cloneAssemblyTransform({
      position: {
        x: IDENTITY_ASSEMBLY_TRANSFORM.position.x,
        y: IDENTITY_ASSEMBLY_TRANSFORM.position.y,
        z: estimateRobotGroundOffset(robot, { renderableBounds }),
      },
      rotation: { ...IDENTITY_ASSEMBLY_TRANSFORM.rotation },
    });
  }

  const nextBounds = resolveRenderableBounds(robot, renderableBounds) ?? buildFallbackBounds();
  let maxExistingX = Number.NEGATIVE_INFINITY;
  let minExistingZ = Number.POSITIVE_INFINITY;

  existingComponents.forEach((component) => {
    const componentBounds =
      resolveRenderableBounds(component.robot, component.renderableBounds) ?? buildFallbackBounds();
    const placedComponentBounds = transformBounds(componentBounds, component.transform);
    maxExistingX = Math.max(
      maxExistingX,
      placedComponentBounds.max.x,
    );
    minExistingZ = Math.min(minExistingZ, placedComponentBounds.min.z);
  });

  if (!Number.isFinite(maxExistingX)) {
    maxExistingX = 0;
  }
  if (!Number.isFinite(minExistingZ)) {
    minExistingZ = 0;
  }

  return cloneAssemblyTransform({
    position: {
      x: maxExistingX + gap - nextBounds.min.x,
      y: 0,
      // The viewer grounds the assembled runtime once as a whole. Align the
      // appended component to that existing raw scene floor instead of ground
      // zero, otherwise both this transform and the runtime root add a ground
      // offset. A mesh-aware runtime pass finalizes any estimate error later.
      z: minExistingZ - nextBounds.min.z,
    },
    rotation: { ...IDENTITY_ASSEMBLY_TRANSFORM.rotation },
  });
}
