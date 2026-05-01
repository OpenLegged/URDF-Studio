import type { UrdfJoint, UrdfLink, UrdfVisual as LinkGeometry } from '@/types';

export interface GeometryPatchCandidate {
  linkName: string;
  linkDisplayName?: string;
  previousLinkData: UrdfLink;
  linkData: UrdfLink;
  linkNameChanged?: boolean;
  visualChanged: boolean;
  visualBodiesChanged: boolean;
  collisionChanged: boolean;
  collisionBodiesChanged: boolean;
  inertialChanged: boolean;
  visibilityChanged: boolean;
}

export interface JointPatchCandidate {
  jointName: string;
  jointId?: string;
  previousJointData: UrdfJoint;
  jointData: UrdfJoint;
  jointNameChanged?: boolean;
}

export const DEFAULT_VEC3 = { x: 0, y: 0, z: 0 };
export const DEFAULT_RPY = { r: 0, p: 0, y: 0 };

export function sameVisibleFlag(a: boolean | undefined, b: boolean | undefined): boolean {
  return (a ?? true) === (b ?? true);
}

function normalizeMaterialField(value: string | undefined): string {
  return (value || '').trim().toLowerCase();
}

function sameRgba(
  a: [number, number, number, number] | undefined,
  b: [number, number, number, number] | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

function sameAuthoredMaterials(
  a: LinkGeometry['authoredMaterials'] | undefined,
  b: LinkGeometry['authoredMaterials'] | undefined,
): boolean {
  const left = a || [];
  const right = b || [];

  return (
    left.length === right.length &&
    left.every((material, index) => {
      const target = right[index];
      return (
        normalizeMaterialField(material?.name) === normalizeMaterialField(target?.name) &&
        normalizeMaterialField(material?.color) === normalizeMaterialField(target?.color) &&
        sameRgba(material?.colorRgba, target?.colorRgba) &&
        normalizeMaterialField(material?.texture) === normalizeMaterialField(target?.texture)
      );
    })
  );
}

function sameMeshMaterialGroups(
  a: LinkGeometry['meshMaterialGroups'] | undefined,
  b: LinkGeometry['meshMaterialGroups'] | undefined,
): boolean {
  const left = a || [];
  const right = b || [];

  return (
    left.length === right.length &&
    left.every((group, index) => {
      const target = right[index];
      return (
        (group?.meshKey || '').trim() === (target?.meshKey || '').trim() &&
        group?.start === target?.start &&
        group?.count === target?.count &&
        group?.materialIndex === target?.materialIndex
      );
    })
  );
}

export function sameVec3(
  a: { x: number; y: number; z: number } | undefined,
  b: { x: number; y: number; z: number } | undefined,
): boolean {
  const av = a || DEFAULT_VEC3;
  const bv = b || DEFAULT_VEC3;
  return av.x === bv.x && av.y === bv.y && av.z === bv.z;
}

function sameRPY(
  a: { r: number; p: number; y: number } | undefined,
  b: { r: number; p: number; y: number } | undefined,
): boolean {
  const av = a || DEFAULT_RPY;
  const bv = b || DEFAULT_RPY;
  return av.r === bv.r && av.p === bv.p && av.y === bv.y;
}

export function sameOrigin(
  a:
    | { xyz: { x: number; y: number; z: number }; rpy: { r: number; p: number; y: number } }
    | undefined,
  b:
    | { xyz: { x: number; y: number; z: number }; rpy: { r: number; p: number; y: number } }
    | undefined,
): boolean {
  return sameVec3(a?.xyz, b?.xyz) && sameRPY(a?.rpy, b?.rpy);
}

export function sameGeometry(a: LinkGeometry | undefined, b: LinkGeometry | undefined): boolean {
  if (!a || !b) return a === b;

  return (
    (a.name || '') === (b.name || '') &&
    a.type === b.type &&
    sameVec3(a.dimensions, b.dimensions) &&
    sameOrigin(a.origin, b.origin) &&
    (a.meshPath || '') === (b.meshPath || '') &&
    (a.color || '') === (b.color || '') &&
    (a.doubleSided === true) === (b.doubleSided === true) &&
    sameAuthoredMaterials(a.authoredMaterials, b.authoredMaterials) &&
    sameMeshMaterialGroups(a.meshMaterialGroups, b.meshMaterialGroups) &&
    sameVisibleFlag(a.visible, b.visible)
  );
}

function sameGeometryList(a: LinkGeometry[] | undefined, b: LinkGeometry[] | undefined): boolean {
  const listA = a || [];
  const listB = b || [];

  return (
    listA.length === listB.length &&
    listA.every((geometry, index) => sameGeometry(geometry, listB[index]))
  );
}

function sameInertial(
  a: UrdfLink['inertial'] | undefined,
  b: UrdfLink['inertial'] | undefined,
): boolean {
  if (!a || !b) return a === b;

  return (
    a.mass === b.mass &&
    sameOrigin(a.origin, b.origin) &&
    a.inertia.ixx === b.inertia.ixx &&
    a.inertia.ixy === b.inertia.ixy &&
    a.inertia.ixz === b.inertia.ixz &&
    a.inertia.iyy === b.inertia.iyy &&
    a.inertia.iyz === b.inertia.iyz &&
    a.inertia.izz === b.inertia.izz
  );
}

function isSameLink(prev: UrdfLink, next: UrdfLink): boolean {
  return (
    prev.id === next.id &&
    prev.name === next.name &&
    prev.visible === next.visible &&
    sameInertial(prev.inertial, next.inertial) &&
    sameGeometry(prev.visual, next.visual) &&
    sameGeometryList(prev.visualBodies, next.visualBodies) &&
    sameGeometry(prev.collision, next.collision) &&
    sameGeometryList(prev.collisionBodies, next.collisionBodies)
  );
}

function getGeometryPatchForLink(prev: UrdfLink, next: UrdfLink): GeometryPatchCandidate | null {
  if (isSameLink(prev, next)) return null;

  if (prev.id !== next.id) {
    return null;
  }

  const linkNameChanged = prev.name !== next.name;
  const inertialChanged = !sameInertial(prev.inertial, next.inertial);
  const visibilityChanged = prev.visible !== next.visible;
  const visualChanged = !sameGeometry(prev.visual, next.visual);
  const visualBodiesChanged = !sameGeometryList(prev.visualBodies, next.visualBodies);
  const collisionChanged = !sameGeometry(prev.collision, next.collision);
  const collisionBodiesChanged = !sameGeometryList(prev.collisionBodies, next.collisionBodies);

  if (
    !visualChanged &&
    !visualBodiesChanged &&
    !collisionChanged &&
    !collisionBodiesChanged &&
    !inertialChanged &&
    !visibilityChanged &&
    !linkNameChanged
  ) {
    return null;
  }

  return {
    linkName: next.id,
    linkDisplayName: next.name,
    previousLinkData: prev,
    linkData: next,
    linkNameChanged,
    visualChanged,
    visualBodiesChanged,
    collisionChanged,
    collisionBodiesChanged,
    inertialChanged,
    visibilityChanged,
  };
}

export function detectSingleGeometryPatch(
  prevLinks: Record<string, UrdfLink> | null,
  nextLinks: Record<string, UrdfLink> | undefined,
): GeometryPatchCandidate | null {
  if (!prevLinks || !nextLinks) return null;

  const prevIds = Object.keys(prevLinks);
  const nextIds = Object.keys(nextLinks);
  if (prevIds.length !== nextIds.length) return null;

  const candidates: GeometryPatchCandidate[] = [];

  for (const id of nextIds) {
    const prev = prevLinks[id];
    const next = nextLinks[id];
    if (!prev || !next) return null;

    const patch = getGeometryPatchForLink(prev, next);
    if (!patch) {
      if (!isSameLink(prev, next)) return null;
      continue;
    }

    candidates.push(patch);
    if (candidates.length > 1) return null;
  }

  return candidates.length === 1 ? candidates[0] : null;
}

function sameLimit(a: UrdfJoint['limit'], b: UrdfJoint['limit']): boolean {
  if (!a || !b) {
    return a === b;
  }

  return (
    a.lower === b.lower && a.upper === b.upper && a.effort === b.effort && a.velocity === b.velocity
  );
}

function sameDynamics(a: UrdfJoint['dynamics'], b: UrdfJoint['dynamics']): boolean {
  return a.damping === b.damping && a.friction === b.friction;
}

function sameHardware(a: UrdfJoint['hardware'], b: UrdfJoint['hardware']): boolean {
  return (
    a.armature === b.armature &&
    a.brand === b.brand &&
    a.motorType === b.motorType &&
    a.motorId === b.motorId &&
    a.motorDirection === b.motorDirection &&
    a.hardwareInterface === b.hardwareInterface
  );
}

function isSameJoint(prev: UrdfJoint, next: UrdfJoint): boolean {
  return (
    prev.id === next.id &&
    prev.name === next.name &&
    prev.parentLinkId === next.parentLinkId &&
    prev.childLinkId === next.childLinkId &&
    prev.type === next.type &&
    sameOrigin(prev.origin, next.origin) &&
    sameVec3(prev.axis, next.axis) &&
    sameLimit(prev.limit, next.limit) &&
    sameDynamics(prev.dynamics, next.dynamics) &&
    sameHardware(prev.hardware, next.hardware)
  );
}

function getJointPatchForJoint(prev: UrdfJoint, next: UrdfJoint): JointPatchCandidate | null {
  if (isSameJoint(prev, next)) return null;

  if (
    prev.id !== next.id ||
    prev.parentLinkId !== next.parentLinkId ||
    prev.childLinkId !== next.childLinkId
  ) {
    return null;
  }

  return {
    jointName: next.name,
    jointId: next.id,
    previousJointData: prev,
    jointData: next,
    jointNameChanged: prev.name !== next.name,
  };
}

export function detectSingleJointPatch(
  prevJoints: Record<string, UrdfJoint> | null,
  nextJoints: Record<string, UrdfJoint> | undefined,
): JointPatchCandidate | null {
  const patches = detectJointPatches(prevJoints, nextJoints);
  return patches?.length === 1 ? patches[0] : null;
}

export function detectJointPatches(
  prevJoints: Record<string, UrdfJoint> | null,
  nextJoints: Record<string, UrdfJoint> | undefined,
): JointPatchCandidate[] | null {
  if (!prevJoints || !nextJoints) return null;

  const prevIds = Object.keys(prevJoints);
  const nextIds = Object.keys(nextJoints);
  if (prevIds.length !== nextIds.length) return null;

  const candidates: JointPatchCandidate[] = [];

  for (const id of nextIds) {
    const prev = prevJoints[id];
    const next = nextJoints[id];
    if (!prev || !next) return null;

    const patch = getJointPatchForJoint(prev, next);
    if (!patch) {
      if (!isSameJoint(prev, next)) return null;
      continue;
    }

    candidates.push(patch);
  }

  return candidates;
}
