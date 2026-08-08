/**
 * Agent robot edit tools — surgical, in-place transforms on a `RobotData` draft.
 *
 * These pure functions are the tool surface exposed to the AI edit agent (see
 * `src/features/ai-assistant/services/aiAgent.ts`). Each operates on an
 * agent-owned deep clone of the canonical robot and mutates ONLY the fields the
 * tool targets — every other field (inertia, origin, color, sibling links,
 * unrelated joints) is left untouched. This is the core reason the agent
 * supersedes the legacy "regenerate whole robot JSON" path, which was lossy
 * (`normalizeAIRobotResponse` hard-coded inertia/origin) and clobbered fields
 * the user did not ask to change.
 *
 * Boundary: core layer. Imports only `@/types` and `@/core/robot/*`. No React,
 * no store, no feature code — so the tools are independently unit-testable.
 *
 * Geometry dimension convention (see `src/types/geometry.ts`): `dimensions` is
 * always `Vector3 {x, y, z}`, reused semantically per type — cylinder/sphere
 * use `x` = radius, cylinder `y` = length; box uses `x/y/z`. Tool args use
 * human-friendly `radius` / `length` / `dimensions[3]` and are mapped here.
 */

import type { Euler, RobotData, Vector3 } from '@/types';
import { GeometryType, JointType } from '@/types';
import { createJoint, createLink, generateJointId, generateLinkId } from './builders';

/** Tool outcome surfaced back to the model as the `tool` role message content. */
export interface AgentToolResult {
  ok: boolean;
  message: string;
}

type GeometryKind = 'cylinder' | 'box' | 'sphere';
type JointKind = 'fixed' | 'revolute' | 'continuous' | 'prismatic';
type OriginTarget = 'visual' | 'collision' | 'inertial';

const ok = (message: string): AgentToolResult => ({ ok: true, message });
const fail = (message: string): AgentToolResult => ({ ok: false, message });

const mapGeometryType = (kind: GeometryKind): GeometryType => {
  switch (kind) {
    case 'cylinder':
      return GeometryType.CYLINDER;
    case 'box':
      return GeometryType.BOX;
    case 'sphere':
      return GeometryType.SPHERE;
  }
};

const mapJointType = (kind: JointKind): JointType => {
  switch (kind) {
    case 'fixed':
      return JointType.FIXED;
    case 'revolute':
      return JointType.REVOLUTE;
    case 'continuous':
      return JointType.CONTINUOUS;
    case 'prismatic':
      return JointType.PRISMATIC;
  }
};

const toVec3 = (values: [number, number, number] | undefined, fallback: Vector3): Vector3 =>
  values ? { x: values[0], y: values[1], z: values[2] } : { ...fallback };

const toEuler = (values: [number, number, number] | undefined, fallback: Euler): Euler =>
  values ? { r: values[0], p: values[1], y: values[2] } : { ...fallback };

/**
 * Resolve the `dimensions` vector for a geometry type from human-friendly args.
 * Unspecified scalars fall back to the link's existing values so a request like
 * "change only the radius" preserves the current length (the user's explicit ask).
 */
const resolveGeometryDimensions = (
  type: GeometryType,
  existing: Vector3,
  args: { radius?: number; length?: number; dimensions?: [number, number, number] },
): Vector3 => {
  switch (type) {
    case GeometryType.CYLINDER:
      return {
        x: args.radius ?? existing.x,
        y: args.length ?? existing.y,
        z: 0,
      };
    case GeometryType.SPHERE:
      return { x: args.radius ?? existing.x, y: 0, z: 0 };
    case GeometryType.BOX:
      if (args.dimensions) {
        return { x: args.dimensions[0], y: args.dimensions[1], z: args.dimensions[2] };
      }
      return { ...existing };
    default:
      return { ...existing };
  }
};

const describeGeometry = (type: GeometryType, dims: Vector3): string => {
  switch (type) {
    case GeometryType.CYLINDER:
      return `cylinder radius=${dims.x} length=${dims.y}`;
    case GeometryType.SPHERE:
      return `sphere radius=${dims.x}`;
    case GeometryType.BOX:
      return `box size=${dims.x} ${dims.y} ${dims.z}`;
    default:
      return `${type}`;
  }
};

export interface UpdateLinkGeometryArgs {
  linkId: string;
  geometryType: GeometryKind;
  radius?: number;
  length?: number;
  /** Box size [x, y, z]; ignored for cylinder/sphere. */
  dimensions?: [number, number, number];
}

/** Update a link's primary visual AND collision geometry together. */
export function updateLinkGeometry(robot: RobotData, args: UpdateLinkGeometryArgs): AgentToolResult {
  const link = robot.links[args.linkId];
  if (!link) {
    return fail(`Link "${args.linkId}" not found. Available: ${Object.keys(robot.links).join(', ')}.`);
  }

  const type = mapGeometryType(args.geometryType);
  const dims = resolveGeometryDimensions(type, link.visual.dimensions, args);
  link.visual = { ...link.visual, type, dimensions: dims };
  link.collision = { ...link.collision, type, dimensions: dims };
  return ok(`Updated ${args.linkId} visual and collision to ${describeGeometry(type, dims)}.`);
}

export interface UpdateLinkInertialArgs {
  linkId: string;
  mass?: number;
  originXyz?: [number, number, number];
  originRpy?: [number, number, number];
  inertia?: { ixx: number; ixy: number; ixz: number; iyy: number; iyz: number; izz: number };
}

/** Patch a link's inertial properties, preserving unspecified fields. */
export function updateLinkInertial(robot: RobotData, args: UpdateLinkInertialArgs): AgentToolResult {
  const link = robot.links[args.linkId];
  if (!link) {
    return fail(`Link "${args.linkId}" not found. Available: ${Object.keys(robot.links).join(', ')}.`);
  }

  // Seed from the existing inertial (or a sane default) so unspecified fields survive.
  const base = link.inertial ?? {
    mass: 1,
    origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    inertia: { ixx: 0.1, ixy: 0, ixz: 0, iyy: 0.1, iyz: 0, izz: 0.1 },
  };

  link.inertial = {
    mass: args.mass ?? base.mass,
    origin: {
      xyz: toVec3(args.originXyz, base.origin?.xyz ?? { x: 0, y: 0, z: 0 }),
      rpy: toEuler(args.originRpy, base.origin?.rpy ?? { r: 0, p: 0, y: 0 }),
    },
    inertia: args.inertia ? { ...args.inertia } : { ...base.inertia },
  };
  return ok(`Updated ${args.linkId} inertial (mass=${link.inertial.mass}).`);
}

export interface UpdateLinkOriginArgs {
  linkId: string;
  target: OriginTarget;
  xyz?: [number, number, number];
  rpy?: [number, number, number];
}

/** Patch a link's visual, collision, or inertial origin. */
export function updateLinkOrigin(robot: RobotData, args: UpdateLinkOriginArgs): AgentToolResult {
  const link = robot.links[args.linkId];
  if (!link) {
    return fail(`Link "${args.linkId}" not found. Available: ${Object.keys(robot.links).join(', ')}.`);
  }

  if (args.target === 'inertial' && !link.inertial) {
    return fail(`Link "${args.linkId}" has no inertial; set inertial first.`);
  }

  const fallbackOrigin = { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } };
  const current =
    (args.target === 'visual'
      ? link.visual.origin
      : args.target === 'collision'
        ? link.collision.origin
        : link.inertial!.origin) ?? fallbackOrigin;

  const nextOrigin = {
    xyz: toVec3(args.xyz, current.xyz),
    rpy: toEuler(args.rpy, current.rpy),
  };

  if (args.target === 'visual') {
    link.visual = { ...link.visual, origin: nextOrigin };
  } else if (args.target === 'collision') {
    link.collision = { ...link.collision, origin: nextOrigin };
  } else {
    link.inertial = { ...link.inertial!, origin: nextOrigin };
  }
  return ok(`Updated ${args.linkId} ${args.target} origin.`);
}

export interface AddLinkJointArgs {
  /** Desired link id; falls back to a generated id if omitted or already taken. */
  linkId?: string;
  linkName?: string;
  parentLinkId: string;
  jointName?: string;
  jointType: JointKind;
  originXyz?: [number, number, number];
  originRpy?: [number, number, number];
  axis?: [number, number, number];
}

/** Add a new child link plus the joint connecting it to an existing parent link. */
export function addLinkJoint(robot: RobotData, args: AddLinkJointArgs): AgentToolResult {
  if (!robot.links[args.parentLinkId]) {
    return fail(`Parent link "${args.parentLinkId}" not found. Available: ${Object.keys(robot.links).join(', ')}.`);
  }

  const linkId = args.linkId && !robot.links[args.linkId] ? args.linkId : generateLinkId();
  if (args.linkId && robot.links[args.linkId]) {
    // Fall back to a generated id but tell the model so it can reference the real id.
    // Continue rather than fail — the model still gets a usable child link.
  }

  const link = createLink({ id: linkId, name: args.linkName ?? linkId });
  const jointId = generateJointId();
  const joint = createJoint({
    id: jointId,
    name: args.jointName ?? `joint_${linkId}`,
    type: mapJointType(args.jointType),
    parentLinkId: args.parentLinkId,
    childLinkId: linkId,
    origin: args.originXyz || args.originRpy
      ? {
          xyz: toVec3(args.originXyz, { x: 0, y: 0, z: 0.5 }),
          rpy: toEuler(args.originRpy, { r: 0, p: 0, y: 0 }),
        }
      : undefined,
    axis: args.axis ? { x: args.axis[0], y: args.axis[1], z: args.axis[2] } : undefined,
  });

  robot.links[linkId] = link;
  robot.joints[jointId] = joint;
  return ok(`Added link "${linkId}" connected to "${args.parentLinkId}" via joint "${jointId}" (${args.jointType}).`);
}

export interface DeleteLinkArgs {
  linkId: string;
}

/**
 * Delete a leaf link and its incoming joint. Refuses non-leaf links so the tree
 * never gets an orphaned subtree — the model must delete children first.
 */
export function deleteLink(robot: RobotData, args: DeleteLinkArgs): AgentToolResult {
  const link = robot.links[args.linkId];
  if (!link) {
    return fail(`Link "${args.linkId}" not found. Available: ${Object.keys(robot.links).join(', ')}.`);
  }
  if (args.linkId === robot.rootLinkId) {
    return fail(`Cannot delete root link "${args.linkId}".`);
  }

  const childJoints = Object.values(robot.joints).filter((j) => j.parentLinkId === args.linkId);
  if (childJoints.length > 0) {
    return fail(
      `Link "${args.linkId}" has ${childJoints.length} child joint(s); delete child links first.`,
    );
  }

  // Remove the incoming joint (the one whose child is this link) and the link.
  for (const [jointId, joint] of Object.entries(robot.joints)) {
    if (joint.childLinkId === args.linkId || joint.parentLinkId === args.linkId) {
      delete robot.joints[jointId];
    }
  }
  delete robot.links[args.linkId];
  return ok(`Deleted link "${args.linkId}" and its connecting joint.`);
}

export interface UpdateJointArgs {
  jointId: string;
  type?: JointKind;
  originXyz?: [number, number, number];
  originRpy?: [number, number, number];
  axis?: [number, number, number];
}

/** Patch a joint's type, origin, and/or axis, preserving unspecified fields. */
export function updateJoint(robot: RobotData, args: UpdateJointArgs): AgentToolResult {
  const joint = robot.joints[args.jointId];
  if (!joint) {
    return fail(`Joint "${args.jointId}" not found. Available: ${Object.keys(robot.joints).join(', ')}.`);
  }

  if (args.type) {
    joint.type = mapJointType(args.type);
  }
  if (args.originXyz || args.originRpy) {
    joint.origin = {
      xyz: toVec3(args.originXyz, joint.origin.xyz),
      rpy: toEuler(args.originRpy, joint.origin.rpy),
    };
  }
  if (args.axis) {
    joint.axis = { x: args.axis[0], y: args.axis[1], z: args.axis[2] };
  }
  return ok(`Updated joint "${args.jointId}".`);
}

export interface UpdateJointLimitArgs {
  jointId: string;
  lower?: number;
  upper?: number;
  effort?: number;
  velocity?: number;
}

/** Patch a joint's limit, preserving unspecified fields. */
export function updateJointLimit(robot: RobotData, args: UpdateJointLimitArgs): AgentToolResult {
  const joint = robot.joints[args.jointId];
  if (!joint) {
    return fail(`Joint "${args.jointId}" not found. Available: ${Object.keys(robot.joints).join(', ')}.`);
  }

  const base = joint.limit ?? { lower: -1.57, upper: 1.57, effort: 100, velocity: 10 };
  joint.limit = {
    lower: args.lower ?? base.lower,
    upper: args.upper ?? base.upper,
    effort: args.effort ?? base.effort,
    velocity: args.velocity ?? base.velocity,
  };
  return ok(`Updated joint "${args.jointId}" limits (lower=${joint.limit.lower} upper=${joint.limit.upper}).`);
}

// -------------------------------------------------------------------------------------
// Read-only inspection tools. These return the current values as JSON so the model
// can inspect axis/limit/origin/inertia before deciding an edit. They do NOT mutate
// the draft; the agent loop does not count them toward "anyToolRan".
// -------------------------------------------------------------------------------------

export interface GetLinkArgs {
  linkId: string;
}

/** Read a link's full properties (geometry, origin, inertial) as JSON. */
export function getLink(robot: RobotData, args: GetLinkArgs): AgentToolResult {
  const link = robot.links[args.linkId];
  if (!link) {
    return fail(`Link "${args.linkId}" not found. Available: ${Object.keys(robot.links).join(', ')}.`);
  }
  const summary = {
    id: link.id,
    name: link.name,
    visual: {
      type: link.visual.type,
      dimensions: link.visual.dimensions,
      origin: link.visual.origin,
      color: link.visual.color,
    },
    collision: {
      type: link.collision.type,
      dimensions: link.collision.dimensions,
      origin: link.collision.origin,
    },
    inertial: link.inertial
      ? {
          mass: link.inertial.mass,
          origin: link.inertial.origin,
          inertia: link.inertial.inertia,
        }
      : null,
  };
  return ok(JSON.stringify(summary));
}

export interface GetJointArgs {
  jointId: string;
}

/** Read a joint's full properties (type, origin, axis, limit, hardware) as JSON. */
export function getJoint(robot: RobotData, args: GetJointArgs): AgentToolResult {
  const joint = robot.joints[args.jointId];
  if (!joint) {
    return fail(`Joint "${args.jointId}" not found. Available: ${Object.keys(robot.joints).join(', ')}.`);
  }
  const summary = {
    id: joint.id,
    name: joint.name,
    type: joint.type,
    parentLinkId: joint.parentLinkId,
    childLinkId: joint.childLinkId,
    origin: joint.origin,
    axis: joint.axis ?? null,
    limit: joint.limit ?? null,
    dynamics: joint.dynamics,
    hardware: {
      motorType: joint.hardware.motorType,
      motorId: joint.hardware.motorId,
      motorDirection: joint.hardware.motorDirection,
      armature: joint.hardware.armature,
    },
  };
  return ok(JSON.stringify(summary));
}

// -------------------------------------------------------------------------------------
// Generic read/write-by-path tools.
//
// These give the agent a "catch-all" escape hatch for fields not covered by a
// dedicated capability (color, motor sub-fields, dynamics, etc.). Paths are
// dot-separated and MUST start with `links.<id>` or `joints.<id>` so the agent
// can never reach outside the robot draft. Writes shallow-merge at an object
// leaf (preserving sibling fields) and replace otherwise — the same surgical
// principle as the dedicated tools.
// -------------------------------------------------------------------------------------

export interface ReadRobotPathArgs {
  /** e.g. `links.base_link.visual.color` or `joints.shoulder_h.axis`. */
  path: string;
}

/** Read any scalar/sub-object under `links.*` or `joints.*` as JSON. */
export function readRobotPath(robot: RobotData, args: ReadRobotPathArgs): AgentToolResult {
  const path = (args.path || '').trim();
  const segments = path.split('.').map((s) => s.trim()).filter(Boolean);
  if (segments.length < 2 || !['links', 'joints'].includes(segments[0])) {
    return fail(
      'Invalid path. Path must start with "links.<linkId>" or "joints.<jointId>", e.g. links.base_link.visual.color.',
    );
  }

  const root: Record<string, Record<string, unknown>> =
    segments[0] === 'links'
      ? (robot.links as unknown as Record<string, Record<string, unknown>>)
      : (robot.joints as unknown as Record<string, Record<string, unknown>>);
  const id = segments[1];
  const entity = root[id];
  if (!entity) {
    return fail(`${segments[0]} "${id}" not found.`);
  }

  let value: unknown = entity;
  for (let i = 2; i < segments.length; i += 1) {
    if (typeof value !== 'object' || value === null) {
      return fail(`Path segment "${segments[i]}" on non-object value at "${segments.slice(0, i).join('.')}".`);
    }
    value = (value as Record<string, unknown>)[segments[i]];
    if (value === undefined) {
      return fail(`Key "${segments[i]}" does not exist at "${segments.slice(0, i).join('.')}".`);
    }
  }

  return ok(JSON.stringify(value));
}

export interface WriteRobotPathArgs {
  /** e.g. `links.base_link.visual.color` or `joints.shoulder_h.dynamics.damping`. */
  path: string;
  /** JSON value to write. When the target is an object, it is shallow-merged with existing. */
  value: unknown;
}

/** Write a scalar or shallow-merge an object under `links.*` / `joints.*`. */
export function writeRobotPath(robot: RobotData, args: WriteRobotPathArgs): AgentToolResult {
  const path = (args.path || '').trim();
  const segments = path.split('.').map((s) => s.trim()).filter(Boolean);
  if (segments.length < 3 || !['links', 'joints'].includes(segments[0])) {
    return fail(
      'Invalid path. Path must have at least 3 segments and start with "links.<linkId>" or "joints.<jointId>", e.g. links.base_link.visual.color.',
    );
  }

  const root: Record<string, Record<string, unknown>> =
    segments[0] === 'links'
      ? (robot.links as unknown as Record<string, Record<string, unknown>>)
      : (robot.joints as unknown as Record<string, Record<string, unknown>>);
  const id = segments[1];
  const entity = root[id];
  if (!entity) {
    return fail(`${segments[0]} "${id}" not found.`);
  }

  // Walk to the parent of the leaf segment.
  let parent: Record<string, unknown> = entity;
  for (let i = 2; i < segments.length - 1; i += 1) {
    const next = parent[segments[i]];
    if (typeof next !== 'object' || next === null) {
      return fail(`Cannot write: "${segments.slice(0, i + 1).join('.')}" is not an object.`);
    }
    parent = next as Record<string, unknown>;
  }

  const leafKey = segments[segments.length - 1];
  const existing = parent[leafKey];
  if (typeof existing === 'object' && existing !== null && !Array.isArray(existing)) {
    // Shallow-merge so unspecified sibling fields are preserved.
    parent[leafKey] = {
      ...(existing as Record<string, unknown>),
      ...(args.value as Record<string, unknown>),
    };
  } else {
    parent[leafKey] = args.value;
  }

  // When writing to links.<id>.visual.color, also update the first
  // authoredMaterial so the change survives the authored-materials
  // precedence in resolveVisualMaterialOverride.
  if (
    segments[0] === 'links'
    && segments[2] === 'visual'
    && leafKey === 'color'
    && typeof args.value === 'string'
  ) {
    const visual = entity.visual as Record<string, unknown> | undefined;
    const authoredMaterials = visual?.authoredMaterials as Array<Record<string, unknown>> | undefined;
    if (authoredMaterials && authoredMaterials.length === 1) {
      authoredMaterials[0].color = args.value;
      authoredMaterials[0].colorRgba = undefined;
    }
  }

  const valueStr = typeof args.value === 'string' ? args.value : JSON.stringify(args.value);
  return ok(`Wrote "${path}" → ${valueStr}`);
}
