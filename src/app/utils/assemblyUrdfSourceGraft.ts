/**
 * Source-preserving URDF graft for a bridge-connected assembly group.
 *
 * Goal: keep the master (group root) component's original URDF text verbatim and
 * inject each bridge-connected slave — re-rooted so the bridge link becomes the
 * slave root, joints reversed along the path, names namespaced only on collision —
 * as text fragments before the master's closing `</robot>`. The result is a single
 * flat URDF that reads as one robot while the 3D workspace keeps its per-component
 * model. Anything this cannot express verbatim returns `{ ok: false }` so the caller
 * can fall back to a fully re-serialized read-only merge.
 *
 * This lives in the app layer (not core/robot) on purpose: it needs `generateURDF`
 * from core/parsers, and core/parsers already imports core/robot — importing the
 * serializer back into core/robot would create a dependency cycle.
 */
import type { AssemblyState, BridgeJoint, RobotData, UrdfJoint, UrdfLink } from '@/types';
import { generateURDF, parseURDF } from '@/core/parsers';
import { rerootAssemblyComponentRobot } from '@/core/robot/assemblyReroot';
import {
  buildAssemblyParentByChildComponentId,
  wouldCreateAssemblyComponentCycle,
} from '@/core/robot/assemblyBridgeTopology';
import {
  createFlattenedComponentPartitionHash,
  toRobotData,
} from './assemblyUrdfSourcePartitionModel.ts';

export interface GraftAssemblyGroupUrdfSourceParams {
  assembly: AssemblyState;
  groupComponentIds: string[];
  masterComponentId: string;
  /** The master component's original URDF draft text; preserved verbatim. */
  masterSourceUrdfText: string;
}

export interface GraftAssemblyGroupUrdfSourceResult {
  ok: boolean;
  urdfText?: string;
  provenance?: GraftAssemblyGroupUrdfSourceProvenance;
  /** Present when `ok` is false; explains why the caller must fall back. */
  reason?: string;
}

export interface GraftComponentEntityOwner {
  componentId: string;
  originalName: string;
}

export type GraftJointEntityOwner =
  | ({ kind: 'component' } & GraftComponentEntityOwner)
  | { kind: 'bridge'; bridgeId: string };

export interface GraftSlaveProvenance {
  originalRootLinkId: string;
}

export interface GraftBridgeProvenance {
  bridge: BridgeJoint;
  flattenedParentLinkName: string;
  flattenedChildLinkName: string;
}

/**
 * Transient edit-routing data for one flattened group document. Robot and bridge
 * snapshots are captured with the name maps so partitioning can detect semantic
 * changes without consulting mutable stores.
 */
export interface GraftAssemblyGroupUrdfSourceProvenance {
  masterComponentId: string;
  masterRobotName: string;
  masterRobotVersion?: string;
  linkOwnerByName: Map<string, GraftComponentEntityOwner>;
  jointOwnerByName: Map<string, GraftJointEntityOwner>;
  directLinkNames: Set<string>;
  directJointNames: Set<string>;
  slaveById: Map<string, GraftSlaveProvenance>;
  componentRobotById: Map<string, RobotData>;
  flattenedComponentHashById: Map<string, string>;
  bridgeById: Map<string, GraftBridgeProvenance>;
}

const CLOSING_ROBOT_TAG = /\s*<\/robot>\s*$/;
const BRIDGE_PARENT_LINK_KEY = '__graft_bridge_parent__';
const BRIDGE_CHILD_LINK_KEY = '__graft_bridge_child__';

function fail(reason: string): GraftAssemblyGroupUrdfSourceResult {
  return { ok: false, reason };
}

/**
 * The master (root) of a group is the component that is never a bridge child.
 * Returns null when the group has zero or multiple such roots (a shape this graft
 * cannot express as one verbatim-master URDF).
 */
export function resolveAssemblyGroupMasterComponentId(
  assembly: AssemblyState,
  groupComponentIds: string[],
): string | null {
  const idSet = new Set(groupComponentIds);
  const groupBridges = Object.values(assembly.bridges).filter(
    (bridge) => idSet.has(bridge.parentComponentId) && idSet.has(bridge.childComponentId),
  );
  const parentByChild = buildAssemblyParentByChildComponentId(groupBridges);
  const masters = groupComponentIds.filter((componentId) => !parentByChild.has(componentId));
  return masters.length === 1 ? masters[0] : null;
}

function sanitizeNamePrefix(name: string): string {
  return name.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'comp';
}

function uniquifyName(name: string, used: Set<string>, prefix: string): string {
  if (!used.has(name)) {
    return name;
  }
  const base = `${prefix}__${name}`;
  if (!used.has(base)) {
    return base;
  }
  let counter = 2;
  while (used.has(`${base}_${counter}`)) {
    counter += 1;
  }
  return `${base}_${counter}`;
}

interface NamespacedRobot {
  robot: RobotData;
  linkNameByOldId: Map<string, string>;
  jointNameByOldId: Map<string, string>;
}

/**
 * Rename a slave robot's link/joint names only where they collide with names
 * already used by the master or earlier slaves. Link/joint id keys are preserved,
 * so every internal parent/child/mimic reference (resolved by id) keeps pointing at
 * the renamed name automatically. Mutates the `used*` sets with the final names.
 */
function namespaceRobotOnCollision(
  robot: RobotData,
  usedLinkNames: Set<string>,
  usedJointNames: Set<string>,
  prefix: string,
): NamespacedRobot {
  const linkNameByOldId = new Map<string, string>();
  const links: Record<string, UrdfLink> = {};
  for (const [linkId, link] of Object.entries(robot.links)) {
    const finalName = uniquifyName(link.name, usedLinkNames, prefix);
    usedLinkNames.add(finalName);
    linkNameByOldId.set(linkId, finalName);
    links[linkId] = finalName === link.name ? link : { ...link, name: finalName };
  }

  const joints: Record<string, UrdfJoint> = {};
  const jointNameByOldId = new Map<string, string>();
  for (const [jointId, joint] of Object.entries(robot.joints)) {
    const finalName = uniquifyName(joint.name, usedJointNames, prefix);
    usedJointNames.add(finalName);
    jointNameByOldId.set(jointId, finalName);
    joints[jointId] = finalName === joint.name ? joint : { ...joint, name: finalName };
  }

  return { robot: { ...robot, links, joints }, linkNameByOldId, jointNameByOldId };
}

function addUniqueOwner<T>(owners: Map<string, T>, name: string, owner: T): boolean {
  if (owners.has(name)) return false;
  owners.set(name, owner);
  return true;
}

function stripRobotWrapper(urdf: string): string {
  return urdf
    .replace(/^\s*<\?xml[^>]*\?>\s*/, '')
    .replace(/^\s*<robot\b[^>]*>\s*/, '')
    .replace(/\s*<\/robot>\s*$/, '')
    .replace(/^\n+/, '')
    .replace(/\s+$/, '');
}

function collectDirectEntityNames(urdf: string, tagName: 'link' | 'joint'): Set<string> {
  const document = new DOMParser().parseFromString(urdf, 'text/xml');
  const robot = document.querySelector('robot');
  if (!robot) return new Set();
  return new Set(
    Array.from(robot.children)
      .filter((element) => element.tagName === tagName)
      .map((element) => element.getAttribute('name')?.trim())
      .filter((name): name is string => Boolean(name)),
  );
}

/**
 * Serialize just the bridge `<joint>` block by round-tripping a throwaway two-link
 * robot through `generateURDF` (synthetic distinct keys so identical parent/child
 * ids never collapse), then extracting the joint element. Reuses the canonical
 * serializer instead of hand-writing joint XML.
 */
function serializeBridgeJointXml(
  bridge: BridgeJoint,
  parentLink: UrdfLink,
  parentLinkName: string,
  childLink: UrdfLink,
): string {
  const tempRobot = {
    name: 'graft-bridge',
    links: {
      [BRIDGE_PARENT_LINK_KEY]: { ...parentLink, id: BRIDGE_PARENT_LINK_KEY, name: parentLinkName },
      [BRIDGE_CHILD_LINK_KEY]: { ...childLink, id: BRIDGE_CHILD_LINK_KEY },
    },
    joints: {
      [bridge.id]: {
        ...bridge.joint,
        id: bridge.id,
        name: bridge.name,
        parentLinkId: BRIDGE_PARENT_LINK_KEY,
        childLinkId: BRIDGE_CHILD_LINK_KEY,
      },
    },
    rootLinkId: BRIDGE_PARENT_LINK_KEY,
    selection: { type: null, id: null },
  } as const;

  const full = generateURDF(tempRobot, { preserveMeshPaths: true });
  const match = full.match(/[ \t]*<joint\b[\s\S]*?<\/joint>/);
  if (!match) {
    throw new Error(`Failed to serialize bridge joint "${bridge.id}"`);
  }
  return match[0];
}

interface GroupTopology {
  bridgeByChildComponentId: Map<string, BridgeJoint>;
  orderedChildComponentIds: string[];
}

interface GraftBuildContext {
  assembly: AssemblyState;
  masterComponentId: string;
  masterSourceUrdfText: string;
  bridgeByChildComponentId: Map<string, BridgeJoint>;
  usedLinkNames: Set<string>;
  usedJointNames: Set<string>;
  linkNameByOldIdByComponent: Map<string, Map<string, string>>;
  linkObjectsByComponent: Map<string, Record<string, UrdfLink>>;
  provenance: GraftAssemblyGroupUrdfSourceProvenance;
}

interface GraftedSlaveFragment {
  fragment: string;
}

/** Classify group bridges into a single-rooted tree, or fail on shapes URDF can't express. */
function resolveGroupTopology(
  assembly: AssemblyState,
  groupComponentIds: string[],
  masterComponentId: string,
): GroupTopology | GraftAssemblyGroupUrdfSourceResult {
  const idSet = new Set(groupComponentIds);
  const groupBridges = Object.values(assembly.bridges).filter(
    (bridge) => idSet.has(bridge.parentComponentId) && idSet.has(bridge.childComponentId),
  );

  const incomingCountByChild = new Map<string, number>();
  for (const bridge of groupBridges) {
    incomingCountByChild.set(
      bridge.childComponentId,
      (incomingCountByChild.get(bridge.childComponentId) ?? 0) + 1,
    );
  }

  const parentByChild = new Map<string, string>();
  const bridgeByChildComponentId = new Map<string, BridgeJoint>();
  for (const bridge of groupBridges) {
    const { childComponentId: child, parentComponentId: parent } = bridge;
    if ((incomingCountByChild.get(child) ?? 0) > 1) {
      return fail(`component "${child}" has multiple incoming bridges`);
    }
    if (wouldCreateAssemblyComponentCycle(parentByChild, parent, child)) {
      return fail(`bridge "${bridge.id}" closes a cycle that URDF cannot express`);
    }
    parentByChild.set(child, parent);
    bridgeByChildComponentId.set(child, bridge);
  }

  const masters = groupComponentIds.filter((componentId) => !parentByChild.has(componentId));
  if (masters.length !== 1 || masters[0] !== masterComponentId) {
    return fail('group does not have a single resolved master root');
  }

  const childrenByParent = new Map<string, string[]>();
  for (const [child, parent] of parentByChild) {
    const children = childrenByParent.get(parent) ?? [];
    children.push(child);
    childrenByParent.set(parent, children);
  }

  const orderedChildComponentIds: string[] = [];
  const queue = [masterComponentId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const child of childrenByParent.get(current) ?? []) {
      orderedChildComponentIds.push(child);
      queue.push(child);
    }
  }

  return { bridgeByChildComponentId, orderedChildComponentIds };
}

function createGraftBuildContext(
  params: GraftAssemblyGroupUrdfSourceParams,
  masterRobot: RobotData,
  topology: GroupTopology,
): GraftBuildContext | GraftAssemblyGroupUrdfSourceResult {
  const { assembly, groupComponentIds, masterComponentId, masterSourceUrdfText } = params;
  const usedLinkNames = new Set(Object.values(masterRobot.links).map((link) => link.name));
  const usedJointNames = new Set(Object.values(masterRobot.joints).map((joint) => joint.name));
  const linkOwnerByName = new Map<string, GraftComponentEntityOwner>();
  const jointOwnerByName = new Map<string, GraftJointEntityOwner>();
  for (const link of Object.values(masterRobot.links)) {
    const owner = { componentId: masterComponentId, originalName: link.name };
    if (!addUniqueOwner(linkOwnerByName, link.name, owner)) {
      return fail(`master has duplicate link name "${link.name}"`);
    }
  }
  for (const joint of Object.values(masterRobot.joints)) {
    const owner: GraftJointEntityOwner = {
      kind: 'component',
      componentId: masterComponentId,
      originalName: joint.name,
    };
    if (!addUniqueOwner(jointOwnerByName, joint.name, owner)) {
      return fail(`master has duplicate joint name "${joint.name}"`);
    }
  }
  for (const bridge of topology.bridgeByChildComponentId.values()) {
    const owner: GraftJointEntityOwner = { kind: 'bridge', bridgeId: bridge.id };
    if (!addUniqueOwner(jointOwnerByName, bridge.name, owner)) {
      return fail(`bridge joint name "${bridge.name}" conflicts with another joint`);
    }
    usedJointNames.add(bridge.name);
  }

  const componentRobotById = new Map<string, RobotData>();
  for (const componentId of groupComponentIds) {
    const robot = assembly.components[componentId]?.robot;
    if (!robot) return fail(`component "${componentId}" has no robot`);
    componentRobotById.set(componentId, structuredClone(robot));
  }
  const parsedMaster = parseURDF(masterSourceUrdfText);
  if (!parsedMaster) return fail('master source text could not be parsed');
  const flattenedComponentHashById = new Map<string, string>([[
    masterComponentId,
    createFlattenedComponentPartitionHash(toRobotData(parsedMaster)),
  ]]);
  return {
    assembly,
    masterComponentId,
    masterSourceUrdfText,
    bridgeByChildComponentId: topology.bridgeByChildComponentId,
    usedLinkNames,
    usedJointNames,
    linkNameByOldIdByComponent: new Map([[
      masterComponentId,
      new Map(Object.entries(masterRobot.links).map(([id, link]) => [id, link.name])),
    ]]),
    linkObjectsByComponent: new Map([[masterComponentId, masterRobot.links]]),
    provenance: {
      masterComponentId,
      masterRobotName: parsedMaster.name,
      masterRobotVersion: parsedMaster.version,
      linkOwnerByName,
      jointOwnerByName,
      directLinkNames: new Set(),
      directJointNames: new Set(),
      slaveById: new Map(),
      componentRobotById,
      flattenedComponentHashById,
      bridgeById: new Map(),
    },
  };
}

function registerSlaveOwners(
  context: GraftBuildContext,
  childComponentId: string,
  childRobot: RobotData,
  namespaced: NamespacedRobot,
): string | null {
  for (const [linkId, finalName] of namespaced.linkNameByOldId) {
    const originalName = childRobot.links[linkId]?.name;
    const owner = originalName ? { componentId: childComponentId, originalName } : null;
    if (!owner || !addUniqueOwner(context.provenance.linkOwnerByName, finalName, owner)) {
      return `cannot attribute slave link "${finalName}"`;
    }
  }
  for (const [jointId, finalName] of namespaced.jointNameByOldId) {
    const originalName = childRobot.joints[jointId]?.name;
    const owner: GraftJointEntityOwner | null = originalName
      ? { kind: 'component', componentId: childComponentId, originalName }
      : null;
    if (!owner || !addUniqueOwner(context.provenance.jointOwnerByName, finalName, owner)) {
      return `cannot attribute slave joint "${finalName}"`;
    }
  }
  return null;
}

function graftSlaveComponent(
  childComponentId: string,
  context: GraftBuildContext,
): GraftedSlaveFragment | GraftAssemblyGroupUrdfSourceResult {
  const bridge = context.bridgeByChildComponentId.get(childComponentId);
  if (!bridge) return fail(`missing bridge for component "${childComponentId}"`);
  const childRobot = context.assembly.components[childComponentId]?.robot;
  if (!childRobot) return fail(`child component "${childComponentId}" has no robot`);
  if (!childRobot.links[bridge.childLinkId]) {
    return fail(`bridge "${bridge.id}" child link "${bridge.childLinkId}" is missing`);
  }

  const parentLinkName = context.linkNameByOldIdByComponent
    .get(bridge.parentComponentId)?.get(bridge.parentLinkId);
  const parentLink = context.linkObjectsByComponent
    .get(bridge.parentComponentId)?.[bridge.parentLinkId];
  if (!parentLinkName || !parentLink) {
    return fail(`bridge "${bridge.id}" parent link "${bridge.parentLinkId}" is missing`);
  }
  if (
    bridge.parentComponentId === context.masterComponentId
    && !context.masterSourceUrdfText.includes(`name="${parentLinkName}"`)
  ) {
    return fail(`master link "${parentLinkName}" not found in preserved source text`);
  }

  const rerootedRobot = rerootAssemblyComponentRobot(
    childRobot,
    bridge.childLinkId,
    childComponentId,
  );
  const prefix = sanitizeNamePrefix(
    context.assembly.components[childComponentId]?.name ?? childComponentId,
  );
  const namespaced = namespaceRobotOnCollision(
    rerootedRobot,
    context.usedLinkNames,
    context.usedJointNames,
    prefix,
  );
  const ownerError = registerSlaveOwners(context, childComponentId, childRobot, namespaced);
  if (ownerError) return fail(ownerError);

  context.linkNameByOldIdByComponent.set(childComponentId, namespaced.linkNameByOldId);
  context.linkObjectsByComponent.set(childComponentId, namespaced.robot.links);
  context.provenance.slaveById.set(
    childComponentId,
    { originalRootLinkId: childRobot.rootLinkId },
  );
  const childRootLink = namespaced.robot.links[bridge.childLinkId];
  const slaveUrdf = generateURDF(
    { ...namespaced.robot, selection: { type: null, id: null } },
    { preserveMeshPaths: true },
  );
  const parsedSlave = parseURDF(slaveUrdf);
  if (!parsedSlave) return fail(`failed to parse grafted component "${childComponentId}"`);
  context.provenance.flattenedComponentHashById.set(
    childComponentId,
    createFlattenedComponentPartitionHash(toRobotData(parsedSlave)),
  );
  const bridgeJointXml = serializeBridgeJointXml(
    bridge,
    parentLink,
    parentLinkName,
    childRootLink,
  );
  context.provenance.bridgeById.set(bridge.id, {
    bridge: structuredClone(bridge),
    flattenedParentLinkName: parentLinkName,
    flattenedChildLinkName: childRootLink.name,
  });
  return { fragment: `${stripRobotWrapper(slaveUrdf)}\n\n${bridgeJointXml}` };
}

export function graftAssemblyGroupUrdfSource(
  params: GraftAssemblyGroupUrdfSourceParams,
): GraftAssemblyGroupUrdfSourceResult {
  const { assembly, groupComponentIds, masterComponentId, masterSourceUrdfText } = params;

  try {
    if (!CLOSING_ROBOT_TAG.test(masterSourceUrdfText)) {
      return fail('master source text does not end with </robot>');
    }
    const masterRobot = assembly.components[masterComponentId]?.robot;
    if (!masterRobot) {
      return fail(`master component "${masterComponentId}" has no robot`);
    }

    const topology = resolveGroupTopology(assembly, groupComponentIds, masterComponentId);
    if ('ok' in topology) {
      return topology;
    }
    const context = createGraftBuildContext(params, masterRobot, topology);
    if ('ok' in context) return context;
    const injectionFragments: string[] = [];
    for (const childComponentId of topology.orderedChildComponentIds) {
      const graftedSlave = graftSlaveComponent(childComponentId, context);
      if ('ok' in graftedSlave) return graftedSlave;
      injectionFragments.push(graftedSlave.fragment);
    }

    if (injectionFragments.length === 0) {
      return fail('no slave components to graft');
    }

    const injection = injectionFragments.join('\n\n');
    const urdfText = masterSourceUrdfText.replace(
      CLOSING_ROBOT_TAG,
      `\n\n${injection}\n\n</robot>\n`,
    );
    context.provenance.directLinkNames = collectDirectEntityNames(urdfText, 'link');
    context.provenance.directJointNames = collectDirectEntityNames(urdfText, 'joint');
    return {
      ok: true,
      urdfText,
      provenance: context.provenance,
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
