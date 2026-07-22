import { parseURDF } from '@/core/parsers';
import { resolveJointKey } from '@/core/robot';
import { rerootAssemblyComponentRobot } from '@/core/robot/assemblyReroot';
import { createStableJsonSnapshot } from '@/core/robot/semanticSnapshot';
import type { RobotData, RobotMaterialState, UrdfJoint, UrdfLink } from '@/types';
import type {
  GraftAssemblyGroupUrdfSourceProvenance,
  GraftComponentEntityOwner,
} from './assemblyUrdfSourceGraft.ts';
import {
  createFlattenedComponentPartitionHash,
  toRobotData,
} from './assemblyUrdfSourcePartitionModel.ts';

export interface FlattenedBridgeJointEdit {
  bridgeId: string;
  joint: UrdfJoint;
}

export interface PartitionFlattenedGroupEditResult {
  ok: boolean;
  componentRobots?: Map<string, RobotData>;
  bridgeJointEdits?: FlattenedBridgeJointEdit[];
  reason?: string;
}

function fail(reason: string): PartitionFlattenedGroupEditResult {
  return { ok: false, reason };
}

function validateDirectEntityNames(
  text: string,
  provenance: GraftAssemblyGroupUrdfSourceProvenance,
): string | null {
  const document = new DOMParser().parseFromString(text, 'text/xml');
  const robot = document.querySelector('robot');
  if (!robot) return null;
  const expectedNamesByTag = {
    link: provenance.directLinkNames,
    joint: provenance.directJointNames,
  };
  for (const tagName of ['link', 'joint'] as const) {
    const names = new Set<string>();
    for (const element of Array.from(robot.children)) {
      if (element.tagName !== tagName) continue;
      const name = element.getAttribute('name')?.trim();
      if (!name) return `${tagName} without a name cannot be attributed safely`;
      if (names.has(name)) return `duplicate ${tagName} "${name}" cannot be attributed safely`;
      if (name) names.add(name);
    }
    const expectedNames = expectedNamesByTag[tagName];
    const addedName = Array.from(names).find((name) => !expectedNames.has(name));
    if (addedName) {
      const owner = tagName === 'link'
        ? provenance.linkOwnerByName.get(addedName)
        : provenance.jointOwnerByName.get(addedName);
      return owner
        ? `${tagName} "${addedName}" cannot be added in the flattened view`
        : `${tagName} "${addedName}" has no component provenance`;
    }
    const missingName = Array.from(expectedNames).find((name) => !names.has(name));
    if (missingName) return `${tagName} "${missingName}" cannot be removed in the flattened view`;
  }
  return null;
}

function findOriginalEntityId<T extends { name: string }>(
  entities: Record<string, T>,
  originalName: string,
): string | null {
  const matches = Object.entries(entities).filter(([, entity]) => entity.name === originalName);
  return matches.length === 1 ? matches[0][0] : null;
}

function resolveOriginalLinkId(
  flattenedLinkName: string,
  componentId: string,
  provenance: GraftAssemblyGroupUrdfSourceProvenance,
): string | null {
  const owner = provenance.linkOwnerByName.get(flattenedLinkName);
  const originalRobot = provenance.componentRobotById.get(componentId);
  if (!owner || owner.componentId !== componentId || !originalRobot) return null;
  return findOriginalEntityId(originalRobot.links, owner.originalName);
}

function resolveOriginalMimicName(
  flattenedJointName: string,
  componentId: string,
  provenance: GraftAssemblyGroupUrdfSourceProvenance,
): string | null {
  const owner = provenance.jointOwnerByName.get(flattenedJointName);
  return owner?.kind === 'component' && owner.componentId === componentId
    ? owner.originalName
    : null;
}

function partitionFlatComponentRobot(
  parsedRobot: RobotData,
  componentId: string,
  provenance: GraftAssemblyGroupUrdfSourceProvenance,
): RobotData | null {
  const links: Record<string, UrdfLink> = {};
  for (const [linkId, link] of Object.entries(parsedRobot.links)) {
    if (provenance.linkOwnerByName.get(link.name)?.componentId === componentId) {
      links[linkId] = link;
    }
  }

  const joints: Record<string, UrdfJoint> = {};
  for (const [jointId, joint] of Object.entries(parsedRobot.joints)) {
    const owner = provenance.jointOwnerByName.get(joint.name);
    if (owner?.kind === 'component' && owner.componentId === componentId) {
      joints[jointId] = joint;
    }
  }

  const childLinkIds = new Set(Object.values(joints).map((joint) => joint.childLinkId));
  const rootLinkIds = Object.keys(links).filter((linkId) => !childLinkIds.has(linkId));
  if (rootLinkIds.length !== 1) return null;

  const materials = parsedRobot.materials
    ? Object.fromEntries(
        Object.entries(parsedRobot.materials).filter(([linkId]) => Boolean(links[linkId])),
      )
    : undefined;
  return {
    name: 'flattened-component-partition',
    links,
    joints,
    rootLinkId: rootLinkIds[0],
    ...(materials && Object.keys(materials).length > 0 ? { materials } : {}),
  };
}

function rebuildComponentRobot(
  parsedRobot: RobotData,
  componentId: string,
  provenance: GraftAssemblyGroupUrdfSourceProvenance,
): RobotData | null {
  const originalRobot = provenance.componentRobotById.get(componentId);
  if (!originalRobot) return null;

  const links: Record<string, UrdfLink> = {};
  const materials: Record<string, RobotMaterialState> = {};
  for (const [flattenedId, parsedLink] of Object.entries(parsedRobot.links)) {
    const owner = provenance.linkOwnerByName.get(parsedLink.name);
    if (owner?.componentId !== componentId) continue;
    const originalId = findOriginalEntityId(originalRobot.links, owner.originalName);
    if (!originalId) return null;
    links[originalId] = { ...parsedLink, id: originalId, name: owner.originalName };
    const material = parsedRobot.materials?.[flattenedId];
    if (material) materials[originalId] = material;
  }

  const joints: Record<string, UrdfJoint> = {};
  for (const parsedJoint of Object.values(parsedRobot.joints)) {
    const owner = provenance.jointOwnerByName.get(parsedJoint.name);
    if (owner?.kind !== 'component' || owner.componentId !== componentId) continue;
    const originalId = findOriginalEntityId(originalRobot.joints, owner.originalName);
    const parentLinkId = resolveOriginalLinkId(
      parsedJoint.parentLinkId,
      componentId,
      provenance,
    );
    const childLinkId = resolveOriginalLinkId(parsedJoint.childLinkId, componentId, provenance);
    if (!originalId || !parentLinkId || !childLinkId) return null;
    const mimicName = parsedJoint.mimic?.joint
      ? resolveOriginalMimicName(parsedJoint.mimic.joint, componentId, provenance)
      : null;
    if (parsedJoint.mimic?.joint && !mimicName) return null;
    joints[originalId] = {
      ...parsedJoint,
      id: originalId,
      name: owner.originalName,
      parentLinkId,
      childLinkId,
      ...(parsedJoint.mimic
        ? { mimic: { ...parsedJoint.mimic, joint: mimicName as string } }
        : {}),
    };
  }

  const childLinkIds = new Set(Object.values(joints).map((joint) => joint.childLinkId));
  const rootLinkIds = Object.keys(links).filter((linkId) => !childLinkIds.has(linkId));
  if (rootLinkIds.length !== 1) return null;

  return {
    ...originalRobot,
    ...(componentId === provenance.masterComponentId
      ? { name: parsedRobot.name, version: parsedRobot.version }
      : {}),
    links,
    joints,
    rootLinkId: rootLinkIds[0],
    ...(Object.keys(materials).length > 0 ? { materials } : { materials: undefined }),
  };
}

function hasSameKeys<T>(left: Record<string, T>, right: Record<string, T>): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index]);
}

function resolveExpectedFlattenedRobot(
  componentId: string,
  provenance: GraftAssemblyGroupUrdfSourceProvenance,
): RobotData | null {
  const originalRobot = provenance.componentRobotById.get(componentId);
  if (!originalRobot) return null;
  if (componentId === provenance.masterComponentId) return originalRobot;

  const bridge = Array.from(provenance.bridgeById.values()).find((candidate) =>
    provenance.linkOwnerByName.get(candidate.flattenedChildLinkName)?.componentId === componentId,
  );
  const rootOwner = bridge
    ? provenance.linkOwnerByName.get(bridge.flattenedChildLinkName)
    : null;
  const targetRootLinkId = rootOwner
    ? findOriginalEntityId(originalRobot.links, rootOwner.originalName)
    : null;
  return targetRootLinkId
    ? rerootAssemblyComponentRobot(originalRobot, targetRootLinkId, componentId)
    : null;
}

function validateComponentStructure(
  componentId: string,
  rebuiltFlatRobot: RobotData,
  provenance: GraftAssemblyGroupUrdfSourceProvenance,
): string | null {
  const expectedFlatRobot = resolveExpectedFlattenedRobot(componentId, provenance);
  if (!expectedFlatRobot) return `component "${componentId}" has no flattened topology baseline`;
  if (
    !hasSameKeys(rebuiltFlatRobot.links, expectedFlatRobot.links)
    || !hasSameKeys(rebuiltFlatRobot.joints, expectedFlatRobot.joints)
  ) {
    return `component "${componentId}" entities cannot be added or removed in the flattened view`;
  }
  if (rebuiltFlatRobot.rootLinkId !== expectedFlatRobot.rootLinkId) {
    return `component "${componentId}" root topology cannot be edited in the flattened view`;
  }
  for (const [jointId, expectedJoint] of Object.entries(expectedFlatRobot.joints)) {
    const joint = rebuiltFlatRobot.joints[jointId];
    const mimicJointId = joint?.mimic?.joint
      ? resolveJointKey(rebuiltFlatRobot.joints, joint.mimic.joint)
      : null;
    const expectedMimicJointId = expectedJoint.mimic?.joint
      ? resolveJointKey(expectedFlatRobot.joints, expectedJoint.mimic.joint)
      : null;
    if (
      !joint
      || joint.parentLinkId !== expectedJoint.parentLinkId
      || joint.childLinkId !== expectedJoint.childLinkId
      || mimicJointId !== expectedMimicJointId
    ) {
      return `joint "${expectedJoint.name}" topology cannot be edited in the flattened view`;
    }
  }
  return null;
}

function validateComponentJointEndpoints(
  joint: UrdfJoint,
  owner: GraftComponentEntityOwner,
  provenance: GraftAssemblyGroupUrdfSourceProvenance,
): boolean {
  const parentOwner = provenance.linkOwnerByName.get(joint.parentLinkId);
  const childOwner = provenance.linkOwnerByName.get(joint.childLinkId);
  if (
    parentOwner?.componentId !== owner.componentId
    || childOwner?.componentId !== owner.componentId
  ) {
    return false;
  }
  const mimicOwner = joint.mimic?.joint
    ? provenance.jointOwnerByName.get(joint.mimic.joint)
    : null;
  return !joint.mimic?.joint
    || Boolean(
      mimicOwner?.kind === 'component' && mimicOwner.componentId === owner.componentId,
    );
}

function bridgeEditableSnapshot(joint: UrdfJoint): string {
  const dynamic = joint.type === 'revolute' || joint.type === 'continuous' || joint.type === 'prismatic';
  const axisBearing = dynamic || joint.type === 'planar';
  return createStableJsonSnapshot({
    type: joint.type,
    origin: joint.origin,
    ...(axisBearing ? { axis: joint.axis } : {}),
    ...(dynamic ? { limit: joint.limit, dynamics: joint.dynamics } : {}),
  });
}

type BuildBridgeEditResult =
  | { ok: true; edit: FlattenedBridgeJointEdit | null }
  | { ok: false; reason: string };

function buildBridgeEdit(
  parsedJoint: UrdfJoint,
  bridgeId: string,
  provenance: GraftAssemblyGroupUrdfSourceProvenance,
): BuildBridgeEditResult {
  const baseline = provenance.bridgeById.get(bridgeId);
  if (!baseline) return { ok: false, reason: `bridge "${bridgeId}" has no provenance` };
  if (
    parsedJoint.parentLinkId !== baseline.flattenedParentLinkName
    || parsedJoint.childLinkId !== baseline.flattenedChildLinkName
  ) {
    return {
      ok: false,
      reason: `bridge "${bridgeId}" endpoints cannot be edited in the flattened view`,
    };
  }
  if (bridgeEditableSnapshot(parsedJoint) === bridgeEditableSnapshot(baseline.bridge.joint)) {
    return { ok: true, edit: null };
  }
  return {
    ok: true,
    edit: {
      bridgeId,
      joint: {
        ...baseline.bridge.joint,
        type: parsedJoint.type,
        origin: structuredClone(parsedJoint.origin),
        axis: parsedJoint.axis ? structuredClone(parsedJoint.axis) : undefined,
        limit: parsedJoint.limit ? structuredClone(parsedJoint.limit) : undefined,
        dynamics: structuredClone(parsedJoint.dynamics),
      },
    },
  };
}

function validateParsedEntityAttribution(
  parsedRobot: RobotData,
  provenance: GraftAssemblyGroupUrdfSourceProvenance,
): string | null {
  const unknownLink = Object.values(parsedRobot.links).find(
    (link) => !provenance.linkOwnerByName.has(link.name),
  );
  if (unknownLink) return `link "${unknownLink.name}" has no component provenance`;

  for (const joint of Object.values(parsedRobot.joints)) {
    const owner = provenance.jointOwnerByName.get(joint.name);
    if (!owner) return `joint "${joint.name}" has no component or bridge provenance`;
    if (owner.kind === 'component' && !validateComponentJointEndpoints(joint, owner, provenance)) {
      return `joint "${joint.name}" crosses its component boundary`;
    }
  }
  return null;
}

type ComponentRobotCollection =
  | { componentRobots: Map<string, RobotData> }
  | { reason: string };

function collectChangedComponentRobots(
  parsedRobot: RobotData,
  provenance: GraftAssemblyGroupUrdfSourceProvenance,
): ComponentRobotCollection {
  const componentRobots = new Map<string, RobotData>();
  for (const [componentId, baselineHash] of provenance.flattenedComponentHashById) {
    const flatRobot = partitionFlatComponentRobot(parsedRobot, componentId, provenance);
    const rebuiltFlatRobot = rebuildComponentRobot(parsedRobot, componentId, provenance);
    if (!flatRobot || !rebuiltFlatRobot) {
      return { reason: `component "${componentId}" could not be partitioned` };
    }
    const structureError = validateComponentStructure(
      componentId,
      rebuiltFlatRobot,
      provenance,
    );
    if (structureError) return { reason: structureError };
    const changed = createFlattenedComponentPartitionHash(flatRobot) !== baselineHash;
    const masterMetadataChanged = componentId === provenance.masterComponentId
      && (parsedRobot.name !== provenance.masterRobotName
        || parsedRobot.version !== provenance.masterRobotVersion);
    if (!changed && !masterMetadataChanged) continue;
    if (componentId === provenance.masterComponentId) {
      componentRobots.set(componentId, rebuiltFlatRobot);
      continue;
    }

    const slave = provenance.slaveById.get(componentId);
    const originalRobot = provenance.componentRobotById.get(componentId);
    if (!slave || !originalRobot) {
      return { reason: `slave component "${componentId}" has no inverse provenance` };
    }
    const {
      closedLoopConstraints: _closedLoopConstraints,
      inspectionContext: _inspectionContext,
      ...urdfFlatRobot
    } = rebuiltFlatRobot;
    const restoredRobot = rerootAssemblyComponentRobot(
      urdfFlatRobot,
      slave.originalRootLinkId,
      componentId,
    );
    componentRobots.set(componentId, {
      ...restoredRobot,
      closedLoopConstraints: originalRobot.closedLoopConstraints,
      inspectionContext: originalRobot.inspectionContext,
    });
  }
  return { componentRobots };
}

type BridgeEditCollection =
  | { edits: FlattenedBridgeJointEdit[] }
  | { reason: string };

function collectBridgeEdits(
  parsedRobot: RobotData,
  provenance: GraftAssemblyGroupUrdfSourceProvenance,
): BridgeEditCollection {
  const edits: FlattenedBridgeJointEdit[] = [];
  const seenBridgeIds = new Set<string>();
  for (const joint of Object.values(parsedRobot.joints)) {
    const owner = provenance.jointOwnerByName.get(joint.name);
    if (owner?.kind !== 'bridge') continue;
    const result = buildBridgeEdit(joint, owner.bridgeId, provenance);
    if (result.ok === false) {
      return { reason: result.reason };
    }
    if (result.edit) edits.push(result.edit);
    seenBridgeIds.add(owner.bridgeId);
  }
  const missingBridgeId = Array.from(provenance.bridgeById.keys()).find(
    (bridgeId) => !seenBridgeIds.has(bridgeId),
  );
  return missingBridgeId
    ? { reason: `bridge joint "${missingBridgeId}" cannot be removed in the flattened view` }
    : { edits };
}

/** Partition a flattened group edit and invert slave name/reroot projection changes. */
export function partitionFlattenedGroupEdit(
  editedText: string,
  provenance: GraftAssemblyGroupUrdfSourceProvenance,
): PartitionFlattenedGroupEditResult {
  try {
    const directEntityError = validateDirectEntityNames(editedText, provenance);
    if (directEntityError) return fail(directEntityError);
    const parsedState = parseURDF(editedText);
    if (!parsedState) return fail('edited flattened URDF could not be parsed');
    const parsedRobot = toRobotData(parsedState);

    const attributionError = validateParsedEntityAttribution(parsedRobot, provenance);
    if (attributionError) return fail(attributionError);
    const componentResult = collectChangedComponentRobots(parsedRobot, provenance);
    if ('reason' in componentResult) return fail(componentResult.reason);

    const bridgeEdits = collectBridgeEdits(parsedRobot, provenance);
    if ('reason' in bridgeEdits) return fail(bridgeEdits.reason);

    return {
      ok: true,
      componentRobots: componentResult.componentRobots,
      bridgeJointEdits: bridgeEdits.edits,
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
