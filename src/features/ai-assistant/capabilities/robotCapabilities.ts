/**
 * Robot edit capability registry.
 *
 * Central registry of everything the AI edit agent can do to a robot draft.
 * Each entry is a self-contained `AgentCapability` (schema + execute + mutates
 * flag). The engine treats this as the single source of truth — adding a new
 * capability here automatically exposes it to the model and to the dispatch
 * loop, with no changes to `agentEngine.ts` or the diff/undo path.
 *
 * Persisted edit semantics live in the pure tools under `@/core/robot/agentRobotTools`
 * (feature-layer schemas here, pure logic there — matches the existing boundary).
 *
 * Boundary: feature layer. Imports `@/types` and `@/core/robot/*`. No app/store.
 */

import type { Language } from '@/shared/i18n';
import type { RobotData } from '@/types';
import { canGenerateUrdf } from '@/core/parsers/urdf/urdfExportSupport';
import { generateURDF, parseURDF } from '@/core/parsers';
import {
  addLinkJoint,
  deleteLink,
  getJoint,
  getLink,
  readRobotPath,
  updateJoint,
  updateJointLimit,
  updateLinkGeometry,
  updateLinkInertial,
  updateLinkOrigin,
  writeRobotPath,
  type AgentToolResult,
} from '@/core/robot/agentRobotTools';
import type { AgentCapability } from './types';
import { runAgentScript } from '../sandbox/scriptSandboxWorkerBridge';

/** External-JSON-boundary cast: model args are untyped JSON; typed tools validate. */
const typed = <T>(args: Record<string, unknown>): T => args as unknown as T;

/** Validate the draft can round-trip through URDF (generate → parse). */
function validateRobot(draft: RobotData): AgentToolResult {
  if (!canGenerateUrdf(draft)) {
    return { ok: false, message: 'Cannot export to URDF: unsupported joint type or structure.' };
  }
  let urdf: string;
  try {
    urdf = generateURDF({ ...draft, selection: { type: null, id: null } }, { preserveMeshPaths: true });
  } catch (e) {
    return { ok: false, message: `URDF generation failed: ${(e as Error).message}` };
  }
  if (!parseURDF(urdf)) {
    return { ok: false, message: 'Generated URDF failed to re-parse; the draft is not a valid robot.' };
  }
  return {
    ok: true,
    message: `Robot valid: ${Object.keys(draft.links).length} links, ${Object.keys(draft.joints).length} joints, root=${draft.rootLinkId}.`,
  };
}

/**
 * Build the registry of robot edit capabilities. The `lang` hint is accepted so
 * future capabilities can localize tool descriptions; today all descriptions are
 * English (the system prompt already carries the language instruction).
 */
export function buildRobotCapabilities(_lang: Language): AgentCapability[] {
  return [
    {
      name: 'update_link_geometry',
      description:
        "Update a link's visual AND collision geometry. Cylinder: radius (and optionally length); sphere: radius; box: dimensions [x,y,z]. Unspecified values are preserved, so 'change only the radius' keeps the current length.",
      parameters: {
        type: 'object',
        properties: {
          linkId: { type: 'string' },
          geometryType: { type: 'string', enum: ['cylinder', 'box', 'sphere'] },
          radius: { type: 'number' },
          length: { type: 'number' },
          dimensions: { type: 'array', items: { type: 'number' }, description: 'box size [x, y, z]' },
        },
        required: ['linkId', 'geometryType'],
      },
      execute: (draft, args) =>
        updateLinkGeometry(draft, typed<Parameters<typeof updateLinkGeometry>[1]>(args)),
      mutates: true,
    },
    {
      name: 'update_link_inertial',
      description: "Patch a link's inertial (mass, origin, inertia tensor). Unspecified fields are preserved.",
      parameters: {
        type: 'object',
        properties: {
          linkId: { type: 'string' },
          mass: { type: 'number' },
          originXyz: { type: 'array', items: { type: 'number' }, description: '[x, y, z]' },
          originRpy: { type: 'array', items: { type: 'number' }, description: '[r, p, y]' },
          inertia: {
            type: 'object',
            properties: {
              ixx: { type: 'number' },
              ixy: { type: 'number' },
              ixz: { type: 'number' },
              iyy: { type: 'number' },
              iyz: { type: 'number' },
              izz: { type: 'number' },
            },
          },
        },
        required: ['linkId'],
      },
      execute: (draft, args) =>
        updateLinkInertial(draft, typed<Parameters<typeof updateLinkInertial>[1]>(args)),
      mutates: true,
    },
    {
      name: 'update_link_origin',
      description: "Patch a link's visual, collision, or inertial origin. Unspecified xyz/rpy are preserved.",
      parameters: {
        type: 'object',
        properties: {
          linkId: { type: 'string' },
          target: { type: 'string', enum: ['visual', 'collision', 'inertial'] },
          xyz: { type: 'array', items: { type: 'number' } },
          rpy: { type: 'array', items: { type: 'number' } },
        },
        required: ['linkId', 'target'],
      },
      execute: (draft, args) =>
        updateLinkOrigin(draft, typed<Parameters<typeof updateLinkOrigin>[1]>(args)),
      mutates: true,
    },
    {
      name: 'add_link_joint',
      description: 'Add a new child link plus the joint connecting it to an existing parent link.',
      parameters: {
        type: 'object',
        properties: {
          linkId: { type: 'string', description: 'desired link id; a unique id is generated if omitted or already taken' },
          linkName: { type: 'string' },
          parentLinkId: { type: 'string' },
          jointName: { type: 'string' },
          jointType: { type: 'string', enum: ['fixed', 'revolute', 'continuous', 'prismatic'] },
          originXyz: { type: 'array', items: { type: 'number' } },
          originRpy: { type: 'array', items: { type: 'number' } },
          axis: { type: 'array', items: { type: 'number' } },
        },
        required: ['parentLinkId', 'jointType'],
      },
      execute: (draft, args) =>
        addLinkJoint(draft, typed<Parameters<typeof addLinkJoint>[1]>(args)),
      mutates: true,
    },
    {
      name: 'delete_link',
      description: 'Delete a leaf link (no children) and its connecting joint. Refuses non-leaf or root links.',
      parameters: {
        type: 'object',
        properties: { linkId: { type: 'string' } },
        required: ['linkId'],
      },
      execute: (draft, args) =>
        deleteLink(draft, typed<Parameters<typeof deleteLink>[1]>(args)),
      mutates: true,
    },
    {
      name: 'update_joint',
      description: "Patch a joint's type, origin, and/or axis. Unspecified fields are preserved.",
      parameters: {
        type: 'object',
        properties: {
          jointId: { type: 'string' },
          type: { type: 'string', enum: ['fixed', 'revolute', 'continuous', 'prismatic'] },
          originXyz: { type: 'array', items: { type: 'number' } },
          originRpy: { type: 'array', items: { type: 'number' } },
          axis: { type: 'array', items: { type: 'number' } },
        },
        required: ['jointId'],
      },
      execute: (draft, args) =>
        updateJoint(draft, typed<Parameters<typeof updateJoint>[1]>(args)),
      mutates: true,
    },
    {
      name: 'update_joint_limit',
      description: "Patch a joint's limits (lower, upper, effort, velocity). Unspecified fields are preserved.",
      parameters: {
        type: 'object',
        properties: {
          jointId: { type: 'string' },
          lower: { type: 'number' },
          upper: { type: 'number' },
          effort: { type: 'number' },
          velocity: { type: 'number' },
        },
        required: ['jointId'],
      },
      execute: (draft, args) =>
        updateJointLimit(draft, typed<Parameters<typeof updateJointLimit>[1]>(args)),
      mutates: true,
    },
    {
      name: 'get_link',
      description: "Read a link's current geometry, origin, and inertial values as JSON. Use before editing to get exact current values (e.g. to preserve an unspecified field). Does not modify the robot.",
      parameters: {
        type: 'object',
        properties: { linkId: { type: 'string' } },
        required: ['linkId'],
      },
      execute: (draft, args) => getLink(draft, typed<Parameters<typeof getLink>[1]>(args)),
      mutates: false,
    },
    {
      name: 'get_joint',
      description: "Read a joint's current type, origin, axis, limit, dynamics, and hardware as JSON. Use before editing to inspect exact current values. Does not modify the robot.",
      parameters: {
        type: 'object',
        properties: { jointId: { type: 'string' } },
        required: ['jointId'],
      },
      execute: (draft, args) => getJoint(draft, typed<Parameters<typeof getJoint>[1]>(args)),
      mutates: false,
    },
    {
      name: 'read_path',
      description:
        "Read any field of the robot under 'links.<linkId>...' or 'joints.<jointId>...' by dot-path as JSON. Catch-all for fields without a dedicated tool (e.g. links.base_link.visual.color, joints.shoulder_h.dynamics). Does not modify the robot.",
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: "e.g. 'links.base_link.visual.color' or 'joints.shoulder_h.dynamics'" },
        },
        required: ['path'],
      },
      execute: (draft, args) =>
        readRobotPath(draft, typed<Parameters<typeof readRobotPath>[1]>(args)),
      mutates: false,
    },
    {
      name: 'write_path',
      description:
        "Write a field of the robot under 'links.<linkId>...' or 'joints.<jointId>...' by dot-path. Catch-all for fields without a dedicated tool. When the target value is an object, it is merged with existing (preserving sibling fields); otherwise it is replaced. Use read_path first to get exact current values.",
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: "e.g. 'links.base_link.visual.color' or 'joints.shoulder_h.limit.upper'" },
          value: { description: 'JSON value to write, e.g. {"r":0.85,"g":0.1,"b":0.1} or a number' },
        },
        required: ['path', 'value'],
      },
      execute: (draft, args) =>
        writeRobotPath(draft, typed<Parameters<typeof writeRobotPath>[1]>(args)),
      mutates: true,
    },
    {
      name: 'validate_robot',
      description: 'Validate the current draft: checks it can be exported to URDF and re-parsed. Call after edits to confirm the result is a valid URDF tree before finishing. Does not modify the robot.',
      parameters: { type: 'object', properties: {} },
      execute: (draft) => validateRobot(draft),
      mutates: false,
    },
    {
      name: 'run_script',
      description:
        "Run arbitrary JavaScript to edit the robot. This is the most powerful tool — use it for ANY edit that the dedicated tools cannot express, or when you need to loop over many links/joints. The script runs as `(draft, api) => { ...; return draft; }`. `draft` is the full robot: `draft.links` (Record<id, link>), `draft.joints` (Record<id, joint>), `draft.rootLinkId`. Each link has: `visual { type, dimensions{x,y,z}, origin{xyz,rpy}, color }, collision { type, dimensions, origin }, inertial { mass, origin, inertia{ixx,ixy,ixz,iyy,iyz,izz} }`. Each joint has: `type, origin{xyz, rpy}, axis{x,y,z}, limit{lower,upper,effort,velocity}, dynamics{damping,friction}, hardware`. `api` gives: `json` (JSON), `math` (Math), `clone` (structuredClone), `keys` (Object.keys), `has` (in operator). No DOM, no network, no stores. ALWAYS return the draft object. Examples: change all link colors: `Object.values(draft.links).forEach(l => l.visual.color = '#ff0000'); return draft;` — set every joint limit: `Object.values(draft.joints).forEach(j => { if(j.limit) j.limit.upper = 3.14; }); return draft;`",
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description:
              "JavaScript function body. Receives `draft` and `api`. Must return the edited draft. Example: `draft.links['base_link'].visual.color = '#ff0000'; return draft;`",
          },
        },
        required: ['code'],
      },
      execute: async (draft, args) => {
        const code = typeof args.code === 'string' ? args.code : '';
        if (!code.trim()) {
          return { ok: false, message: 'Script code is empty.' };
        }
        const outcome = await runAgentScript({ code, draft });
        if (!outcome.ok) {
          return { ok: false, message: outcome.error };
        }
        const result = outcome.result;
        if (result === null || typeof result !== 'object' || Array.isArray(result)) {
          return { ok: false, message: 'Script must return a plain object (the edited robot draft).' };
        }
        const replacement = result as RobotData;
        const validation = validateRobot(replacement);
        if (!validation.ok) {
          return { ok: false, message: `Script produced an invalid robot: ${validation.message}` };
        }
        return {
          ok: true,
          message: `Script ran successfully; robot now has ${Object.keys(replacement.links).length} links, ${Object.keys(replacement.joints).length} joints.`,
          replacement,
        };
      },
      mutates: true,
    },
  ];
}