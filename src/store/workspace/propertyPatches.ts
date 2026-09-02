import {
  clampJointInteractionValue,
  hasFiniteJointLimitBounds,
  normalizeJointLimitOrder,
} from '@/core/robot';
import { JointType, type UrdfJoint, type UrdfLink, type UrdfOrigin, type UrdfVisual } from '@/types';

import type {
  WorkspaceJointPropertyPatch,
  WorkspaceLinkPropertyPatch,
} from './types';

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function mergeOrigin(
  current: UrdfOrigin | undefined,
  patch: WorkspaceJointPropertyPatch['origin'],
): UrdfOrigin | undefined {
  if (patch === undefined) return current;
  return {
    ...(current ?? {
      xyz: { x: 0, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: 0 },
    }),
    ...structuredClone(patch),
    xyz: {
      ...(current?.xyz ?? { x: 0, y: 0, z: 0 }),
      ...(patch.xyz ?? {}),
    },
    rpy: {
      ...(current?.rpy ?? { r: 0, p: 0, y: 0 }),
      ...(patch.rpy ?? {}),
    },
  };
}

function mergeVisual(
  current: UrdfVisual,
  patch: NonNullable<WorkspaceLinkPropertyPatch['visual']>,
): UrdfVisual {
  return {
    ...current,
    ...structuredClone(patch),
    dimensions: { ...current.dimensions, ...(patch.dimensions ?? {}) },
    origin: mergeOrigin(current.origin, patch.origin) ?? current.origin,
  };
}

export function applyWorkspaceLinkPropertyPatch(
  current: UrdfLink,
  patch: WorkspaceLinkPropertyPatch,
): UrdfLink {
  const next: UrdfLink = { ...current, ...structuredClone(patch), id: current.id } as UrdfLink;
  if (patch.visual) next.visual = mergeVisual(current.visual, patch.visual);
  if (patch.collision) next.collision = mergeVisual(current.collision, patch.collision);
  if (hasOwn(patch, 'inertial')) {
    if (patch.inertial === undefined) {
      delete next.inertial;
    } else {
      const currentInertial = current.inertial;
      next.inertial = {
        ...(currentInertial ?? patch.inertial),
        ...structuredClone(patch.inertial),
        origin: mergeOrigin(currentInertial?.origin, patch.inertial.origin),
        inertia: {
          ...(currentInertial?.inertia ?? patch.inertial.inertia),
          ...(patch.inertial.inertia ?? {}),
        },
      } as NonNullable<UrdfLink['inertial']>;
    }
  }
  return next;
}

export function applyWorkspaceJointPropertyPatch(
  current: UrdfJoint,
  patch: WorkspaceJointPropertyPatch,
): UrdfJoint {
  const next: UrdfJoint = { ...current, ...structuredClone(patch), id: current.id } as UrdfJoint;
  if (patch.origin) next.origin = mergeOrigin(current.origin, patch.origin)!;
  if (patch.axis) next.axis = { ...(current.axis ?? patch.axis), ...patch.axis } as UrdfJoint['axis'];
  if (patch.limit) {
    next.limit = normalizeJointLimitOrder({
      ...(current.limit ?? patch.limit),
      ...patch.limit,
    }) as UrdfJoint['limit'];

    if (
      (next.type === JointType.REVOLUTE || next.type === JointType.PRISMATIC) &&
      hasFiniteJointLimitBounds(next.limit)
    ) {
      const currentAngle = Number.isFinite(next.angle) ? next.angle! : 0;
      const clampedAngle = clampJointInteractionValue(
        currentAngle,
        next.limit.lower,
        next.limit.upper,
      );
      if (clampedAngle !== currentAngle) {
        next.angle = clampedAngle;
      }
    }
  }
  if (patch.dynamics) next.dynamics = { ...current.dynamics, ...patch.dynamics };
  if (patch.hardware) next.hardware = { ...current.hardware, ...patch.hardware };
  return next;
}
