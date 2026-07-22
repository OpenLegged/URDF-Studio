import { DEFAULT_LINK, GeometryType } from '@/types';
import type { UrdfLink } from '@/types';

const ZERO_VECTOR = { x: 0, y: 0, z: 0 } as const;
const ZERO_RPY = { r: 0, p: 0, y: 0 } as const;
const DEFAULT_COLLISION_BOX_DIMENSIONS = { x: 0.08, y: 0.12, z: 0.08 } as const;

function getCollisionOriginSource(parentLink: UrdfLink): UrdfLink['collision'] {
  if (parentLink.collision.type !== GeometryType.NONE) {
    return parentLink.collision;
  }

  const lastCollisionBody = [...(parentLink.collisionBodies || [])]
    .reverse()
    .find((body) => body.type !== GeometryType.NONE);
  if (lastCollisionBody) {
    return lastCollisionBody;
  }

  if (parentLink.visual.type !== GeometryType.NONE) {
    return parentLink.visual;
  }

  return DEFAULT_LINK.collision;
}

function getCollisionBodyCount(link: UrdfLink): number {
  const primary = link.collision.type !== GeometryType.NONE ? 1 : 0;
  const extras = (link.collisionBodies || []).filter(
    (body) => body.type !== GeometryType.NONE,
  ).length;
  return primary + extras;
}

export interface CollisionGeometryEntry {
  geometry: UrdfLink['collision'];
  objectIndex: number;
  bodyIndex: number | null;
}

export function getCollisionGeometryEntries(link: UrdfLink): CollisionGeometryEntry[] {
  const entries: CollisionGeometryEntry[] = [];

  if (link.collision.type !== GeometryType.NONE) {
    entries.push({
      geometry: link.collision,
      objectIndex: entries.length,
      bodyIndex: null,
    });
  }

  (link.collisionBodies || []).forEach((body, bodyIndex) => {
    if (body.type === GeometryType.NONE) return;
    entries.push({
      geometry: body,
      objectIndex: entries.length,
      bodyIndex,
    });
  });

  return entries;
}

export function getCollisionGeometryByObjectIndex(
  link: UrdfLink,
  objectIndex = 0,
): CollisionGeometryEntry | null {
  const entries = getCollisionGeometryEntries(link);
  if (entries.length === 0) return null;
  return entries.find((entry) => entry.objectIndex === objectIndex) ?? null;
}

export function updateCollisionGeometryByObjectIndex(
  link: UrdfLink,
  objectIndex: number,
  updates: Partial<UrdfLink['collision']>,
): UrdfLink {
  const target = getCollisionGeometryByObjectIndex(link, objectIndex);

  if (!target) {
    return link;
  }

  if (target.bodyIndex === null) {
    return {
      ...link,
      collision: {
        ...link.collision,
        ...updates,
      },
    };
  }

  const nextCollisionBodies = [...(link.collisionBodies || [])];
  nextCollisionBodies[target.bodyIndex] = {
    ...nextCollisionBodies[target.bodyIndex],
    ...updates,
  };

  return {
    ...link,
    collisionBodies: nextCollisionBodies,
  };
}

export function replaceCollisionGeometriesByObjectIndex(
  link: UrdfLink,
  objectIndex: number,
  geometries: UrdfLink['collision'][],
): { link: UrdfLink; replaced: boolean } {
  const target = getCollisionGeometryByObjectIndex(link, objectIndex);
  if (!target || geometries.length === 0) {
    return { link, replaced: false };
  }

  if (target.bodyIndex === null) {
    const [primaryGeometry, ...additionalGeometries] = geometries;
    return {
      link: {
        ...link,
        collision: primaryGeometry!,
        collisionBodies:
          additionalGeometries.length > 0
            ? [...additionalGeometries, ...(link.collisionBodies || [])]
            : link.collisionBodies,
      },
      replaced: true,
    };
  }

  const collisionBodies = [...(link.collisionBodies || [])];
  collisionBodies.splice(target.bodyIndex, 1, ...geometries);
  return {
    link: { ...link, collisionBodies },
    replaced: true,
  };
}

export function removeCollisionGeometryByObjectIndex(
  link: UrdfLink,
  objectIndex: number,
): {
  link: UrdfLink;
  removed: boolean;
  nextObjectIndex: number | null;
} {
  const target = getCollisionGeometryByObjectIndex(link, objectIndex);

  if (!target) {
    return {
      link,
      removed: false,
      nextObjectIndex: null,
    };
  }

  let nextLink = link;

  if (target.bodyIndex === null) {
    nextLink = {
      ...link,
      collision: {
        ...link.collision,
        type: GeometryType.NONE,
        meshPath: undefined,
      },
    };
  } else {
    const nextCollisionBodies = [...(link.collisionBodies || [])];
    nextCollisionBodies.splice(target.bodyIndex, 1);
    nextLink = {
      ...link,
      collisionBodies: nextCollisionBodies,
    };
  }

  const remainingEntries = getCollisionGeometryEntries(nextLink);

  return {
    link: nextLink,
    removed: true,
    nextObjectIndex: remainingEntries.length
      ? Math.min(objectIndex, remainingEntries.length - 1)
      : null,
  };
}

function createCollisionBodyFromLink(link: UrdfLink): UrdfLink['collision'] {
  const source = getCollisionOriginSource(link);
  const count = getCollisionBodyCount(link);
  const offset = count * 0.08;
  const origin = source.origin || { xyz: { ...ZERO_VECTOR }, rpy: { ...ZERO_RPY } };

  return {
    ...DEFAULT_LINK.collision,
    type: GeometryType.BOX,
    dimensions: { ...DEFAULT_COLLISION_BOX_DIMENSIONS },
    visible: true,
    color: DEFAULT_LINK.collision.color,
    materialSource: undefined,
    meshPath: undefined,
    origin: {
      xyz: {
        x: origin.xyz.x,
        y: origin.xyz.y + offset,
        z: origin.xyz.z,
      },
      rpy: { ...origin.rpy },
      ...(origin.quatXyzw ? { quatXyzw: { ...origin.quatXyzw } } : {}),
    },
  };
}

export function appendCollisionBody(link: UrdfLink): UrdfLink {
  const newBody = createCollisionBodyFromLink(link);
  const hasPrimary = link.collision.type !== GeometryType.NONE;

  if (!hasPrimary) {
    return {
      ...link,
      collision: newBody,
      collisionBodies: link.collisionBodies || [],
    };
  }

  return {
    ...link,
    collisionBodies: [...(link.collisionBodies || []), newBody],
  };
}

export function optimizeCylinderCollisionsToCapsules(link: UrdfLink): {
  link: UrdfLink;
  optimizedCount: number;
} {
  let optimizedCount = 0;
  let nextCollision = link.collision;
  let nextCollisionBodies = link.collisionBodies;

  if (link.collision.type === GeometryType.CYLINDER) {
    nextCollision = {
      ...link.collision,
      type: GeometryType.CAPSULE,
    };
    optimizedCount += 1;
  }

  if (link.collisionBodies?.length) {
    let collisionBodiesChanged = false;
    nextCollisionBodies = link.collisionBodies.map((body) => {
      if (body.type !== GeometryType.CYLINDER) return body;
      collisionBodiesChanged = true;
      optimizedCount += 1;
      return {
        ...body,
        type: GeometryType.CAPSULE,
      };
    });

    if (!collisionBodiesChanged) {
      nextCollisionBodies = link.collisionBodies;
    }
  }

  if (optimizedCount === 0) {
    return { link, optimizedCount: 0 };
  }

  return {
    link: {
      ...link,
      collision: nextCollision,
      collisionBodies: nextCollisionBodies,
    },
    optimizedCount,
  };
}
