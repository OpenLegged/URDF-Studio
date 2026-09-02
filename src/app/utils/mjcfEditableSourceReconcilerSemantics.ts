import {
  createSourceSemanticRobotHash,
  createStableJsonSnapshot,
} from '@/core/robot';
import type { RobotData, RobotState, UrdfLink, UrdfVisual } from '@/types';

import { parseEditableRobotSource } from './parseEditableRobotSource';

export interface MJCFEntityPair<T> {
  before: T;
  after: T;
}

export function asMJCFRobotState(robot: RobotData): RobotState {
  return { ...robot, selection: { type: null, id: null } };
}

function asSourceSemanticRobot(robot: RobotData, includeInspection: boolean): RobotData {
  const links = Object.fromEntries(
    Object.entries(robot.links).map(([linkId, link]) => [linkId, normalizeLink(link)]),
  );
  return {
    name: robot.name,
    ...(robot.version?.trim() ? { version: robot.version } : {}),
    rootLinkId: robot.rootLinkId,
    links,
    joints: robot.joints,
    ...(robot.closedLoopConstraints && robot.closedLoopConstraints.length > 0
      ? { closedLoopConstraints: robot.closedLoopConstraints }
      : {}),
    ...(includeInspection && robot.inspectionContext?.mjcf
      ? {
          inspectionContext: {
            sourceFormat: 'mjcf' as const,
            mjcf: robot.inspectionContext.mjcf,
          },
        }
      : {}),
  };
}

function normalizeGeometry(geometry: UrdfVisual): UrdfVisual {
  const {
    name: _name,
    materialSource: _materialSource,
    authoredMaterials: _authoredMaterials,
    ...semanticGeometry
  } = geometry;
  return semanticGeometry as UrdfVisual;
}

function normalizeLink(link: UrdfLink): UrdfLink {
  return {
    ...link,
    visual: normalizeGeometry(link.visual),
    visualBodies: link.visualBodies?.map(normalizeGeometry),
    collision: normalizeGeometry(link.collision),
    collisionBodies: link.collisionBodies?.map(normalizeGeometry),
  };
}

function geometryEncodingMetadata(geometry: UrdfVisual): unknown {
  return {
    name: geometry.name,
    materialSource: geometry.materialSource,
    authoredMaterials: geometry.authoredMaterials,
  };
}

function linkEncodingMetadata(link: UrdfLink): unknown {
  return {
    visual: geometryEncodingMetadata(link.visual),
    visualBodies: link.visualBodies?.map(geometryEncodingMetadata),
    collision: geometryEncodingMetadata(link.collision),
    collisionBodies: link.collisionBodies?.map(geometryEncodingMetadata),
  };
}

/**
 * These fields are normalized only because the generator synthesizes them.
 * A real user mutation of the same fields must never be accepted as unchanged.
 */
export function mjcfEncodingMetadataChanged(
  beforeRobot: RobotData,
  afterRobot: RobotData,
): boolean {
  const linkPairs = collectMJCFEntityPairs(beforeRobot.links, afterRobot.links);
  const before = {
    links: Object.fromEntries(
      linkPairs.map(({ before: link }) => [link.id, linkEncodingMetadata(link)]),
    ),
    materials: Object.fromEntries(
      Object.entries(beforeRobot.materials ?? {}).filter(([id]) =>
        linkPairs.some(({ before: link }) => id === link.id || id === link.name),
      ),
    ),
  };
  const after = {
    links: Object.fromEntries(
      linkPairs.map(({ before: oldLink, after: link }) => [
        oldLink.id,
        linkEncodingMetadata(link),
      ]),
    ),
    materials: Object.fromEntries(
      Object.entries(afterRobot.materials ?? {}).filter(([id]) =>
        linkPairs.some(({ after: link }) => id === link.id || id === link.name),
      ),
    ),
  };
  return createStableJsonSnapshot(before) !== createStableJsonSnapshot(after);
}

function buildSourceIdentityMap<T extends { id: string; name: string }>(
  records: Record<string, T>,
): Map<string, string> {
  const identities = new Map<string, string>();
  Object.entries(records).forEach(([key, record]) => {
    const name = record.name || record.id || key;
    identities.set(key, name);
    identities.set(record.id, name);
    identities.set(record.name, name);
  });
  return identities;
}

function projectToMJCFSourceIdentities(robot: RobotData): RobotData {
  const linkIdentities = buildSourceIdentityMap(robot.links);
  const jointIdentities = buildSourceIdentityMap(robot.joints);
  const links = Object.fromEntries(
    Object.entries(robot.links).map(([key, link]) => {
      const name = linkIdentities.get(key) ?? link.name;
      return [name, { ...link, id: name, name }];
    }),
  );
  const joints = Object.fromEntries(
    Object.entries(robot.joints).map(([key, joint]) => {
      const name = jointIdentities.get(key) ?? joint.name;
      return [
        name,
        {
          ...joint,
          id: name,
          name,
          parentLinkId: linkIdentities.get(joint.parentLinkId) ?? joint.parentLinkId,
          childLinkId: linkIdentities.get(joint.childLinkId) ?? joint.childLinkId,
          ...(joint.mimic
            ? {
                mimic: {
                  ...joint.mimic,
                  joint: jointIdentities.get(joint.mimic.joint) ?? joint.mimic.joint,
                },
              }
            : {}),
        },
      ];
    }),
  );
  const closedLoopConstraints = robot.closedLoopConstraints?.map((constraint) => ({
    ...constraint,
    linkAId: linkIdentities.get(constraint.linkAId) ?? constraint.linkAId,
    linkBId: linkIdentities.get(constraint.linkBId) ?? constraint.linkBId,
  }));

  return {
    ...robot,
    links,
    joints,
    rootLinkId: linkIdentities.get(robot.rootLinkId) ?? robot.rootLinkId,
    ...(closedLoopConstraints ? { closedLoopConstraints } : {}),
  };
}

/** Core semantics are those supported directly by the MJCF generator. */
export function mjcfCoreSemanticHash(robot: RobotData): string {
  return createSourceSemanticRobotHash(
    projectToMJCFSourceIdentities(asSourceSemanticRobot(robot, false)),
  );
}

/** Full semantics also cover MJCF-only inspection data retained by the parser. */
export function mjcfSourceSemanticHash(robot: RobotData): string {
  return createSourceSemanticRobotHash(
    projectToMJCFSourceIdentities(asSourceSemanticRobot(robot, true)),
  );
}

export function parseMJCFEditableSource(
  sourceFileName: string,
  content: string,
): RobotState | null {
  return parseEditableRobotSource({
    file: { name: sourceFileName || 'model.xml', format: 'mjcf' },
    content,
  });
}

function findEntityPair<T extends { id: string; name: string }>(
  records: Record<string, T>,
  key: string,
  id: string,
): T | undefined {
  return records[key] ?? Object.values(records).find((record) => record.id === id);
}

export function collectMJCFEntityPairs<T extends { id: string; name: string }>(
  beforeRecords: Record<string, T>,
  afterRecords: Record<string, T>,
): MJCFEntityPair<T>[] {
  return Object.entries(beforeRecords).flatMap(([key, before]) => {
    const after = findEntityPair(afterRecords, key, before.id);
    return after ? [{ before, after }] : [];
  });
}

export function findMJCFEntityPair<T extends { id: string; name: string }>(
  records: Record<string, T>,
  key: string,
  id: string,
): T | undefined {
  return findEntityPair(records, key, id);
}

export function mjcfValuesEqual(left: unknown, right: unknown): boolean {
  return createStableJsonSnapshot(left) === createStableJsonSnapshot(right);
}
