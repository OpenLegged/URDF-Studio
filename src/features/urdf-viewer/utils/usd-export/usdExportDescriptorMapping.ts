import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  GeometryType,
  JointType,
  type RobotState,
  type UrdfJoint,
  type UrdfLink,
  type UrdfVisual,
} from '../../../../types/index.ts';
import { getVisualGeometryEntries } from '@/core/robot';

import {
  getUsdDescriptorTransformScale,
  resolveUsdPrimitiveGeometryFromDescriptor as resolvePrimitiveGeometryFromDescriptor,
} from '../usdPrimitiveGeometry.ts';
import type { ViewerRobotDataResolution } from '../viewerRobotData.ts';

import {
  cloneRobotState,
  hasNonIdentityOrigin,
  mergeCurrentRobotWithSnapshotMeshPaths,
  stripSyntheticWorldRootForExport,
} from './usdExportRobotMerge.ts';
export {
  cloneRobotState,
  hasNonIdentityOrigin,
  mergeCurrentRobotWithPreparedCacheGeometry,
  stripSyntheticWorldRootForExport,
} from './usdExportRobotMerge.ts';
import {
  getDescriptorLinkPath,
  getDescriptorRole,
  getDescriptorSemanticName,
  normalizeSemanticToken,
  normalizeUsdPath,
  parseDescriptorOrdinal,
  sanitizeFileToken,
} from './usdExportPaths.ts';
import {
  applyDescriptorMaterialToLink,
  applySnapshotMaterialRecordToLink,
  applyVisualMaterialFallbackToLink,
  buildGeomSubsetAuthoredMaterials,
  buildGeomSubsetDisplayColors,
  buildGeomSubsetMaterialGroups,
  colorArrayToVertexColor,
  colorHexToVertexColor,
  getDescriptorMaterialRecord,
  getSnapshotMaterialLookup,
  getSnapshotPreferredVisualMaterialLookup,
  hasNonEmptyTexturePath,
  resolveVisualMaterialFallbackForDescriptor,
  snapshotMaterialUsesTextureCoordinates,
  visualUsesTextureCoordinates,
} from './usdExportMaterials.ts';
import type {
  ExportDescriptor,
  RobotLike,
  SnapshotMaterialRecord,
  SnapshotMeshDescriptor,
  UsdExportSnapshot,
} from './internalTypes.ts';



function cloneVisualOrigin(
  origin: NonNullable<UrdfVisual['origin']> | null | undefined,
): NonNullable<UrdfVisual['origin']> {
  return {
    xyz: {
      x: origin?.xyz?.x || 0,
      y: origin?.xyz?.y || 0,
      z: origin?.xyz?.z || 0,
    },
    rpy: {
      r: origin?.rpy?.r || 0,
      p: origin?.rpy?.p || 0,
      y: origin?.rpy?.y || 0,
    },
  };
}


function ensureMeshDimensions(
  dimensions: UrdfVisual['dimensions'] | null | undefined,
): UrdfVisual['dimensions'] {
  if (!dimensions) {
    return { x: 1, y: 1, z: 1 };
  }

  const values = [dimensions.x, dimensions.y, dimensions.z];
  const hasMeaningfulDimension = values.some(
    (value) => Number.isFinite(value) && Math.abs(value) > 1e-9,
  );
  return hasMeaningfulDimension ? dimensions : { x: 1, y: 1, z: 1 };
}

export function resolveUsdSnapshotMeshDimensions(
  dimensions: UrdfVisual['dimensions'] | null | undefined,
  descriptor: SnapshotMeshDescriptor,
  snapshot: UsdExportSnapshot,
): UrdfVisual['dimensions'] {
  const current = ensureMeshDimensions(dimensions);
  const hasEditedScale =
    Math.abs(current.x - 1) > 1e-9 ||
    Math.abs(current.y - 1) > 1e-9 ||
    Math.abs(current.z - 1) > 1e-9;
  if (hasEditedScale) {
    return current;
  }

  const snapshotScale = getUsdDescriptorTransformScale(descriptor, snapshot);
  return snapshotScale
    ? { x: snapshotScale[0], y: snapshotScale[1], z: snapshotScale[2] }
    : current;
}

function buildFixedChildLinksByParent(robot: RobotState): Map<string, string[]> {
  const result = new Map<string, string[]>();

  Object.values(robot.joints).forEach((joint) => {
    if (joint.type !== JointType.FIXED) {
      return;
    }

    const list = result.get(joint.parentLinkId) || [];
    list.push(joint.childLinkId);
    result.set(joint.parentLinkId, list);
  });

  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getGeomSuffixOrder(candidate: string, parentLinkId: string, parentName: string): number {
  const patterns = [
    new RegExp(`^${escapeRegExp(parentLinkId)}_geom_(\\d+)$`),
    new RegExp(`^${escapeRegExp(parentName)}_geom_(\\d+)$`),
  ];

  for (const pattern of patterns) {
    const match = candidate.match(pattern);
    if (match) {
      const numeric = Number(match[1]);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
    }
  }

  return Number.POSITIVE_INFINITY;
}

function getLinkSemanticCandidates(link: UrdfLink): string[] {
  const candidates = [normalizeSemanticToken(link.id), normalizeSemanticToken(link.name)].filter(
    Boolean,
  );

  return Array.from(new Set(candidates));
}

function scoreDescriptorAgainstLink(descriptor: SnapshotMeshDescriptor, link: UrdfLink): number {
  const descriptorToken = normalizeSemanticToken(getDescriptorSemanticName(descriptor));
  if (!descriptorToken) {
    return 0;
  }

  let bestScore = 0;
  getLinkSemanticCandidates(link).forEach((candidate) => {
    if (candidate === descriptorToken) {
      bestScore = Math.max(bestScore, 8);
      return;
    }

    if (candidate.endsWith(`_${descriptorToken}`) || candidate.startsWith(`${descriptorToken}_`)) {
      bestScore = Math.max(bestScore, 6);
      return;
    }

    if (candidate.includes(descriptorToken) || descriptorToken.includes(candidate)) {
      bestScore = Math.max(bestScore, 4);
    }
  });

  return bestScore;
}

function isVisualAttachmentLink(
  link: UrdfLink | undefined,
  parentLinkId: string,
  parentName: string,
): boolean {
  if (!link) {
    return false;
  }

  const zeroMass = (link.inertial?.mass || 0) <= 1e-9;
  const visualPresent = link.visual.type !== GeometryType.NONE;
  const collisionOnly =
    link.visual.type === GeometryType.NONE && link.collision.type !== GeometryType.NONE;
  const syntheticName =
    getGeomSuffixOrder(link.id, parentLinkId, parentName) !== Number.POSITIVE_INFINITY ||
    getGeomSuffixOrder(link.name, parentLinkId, parentName) !== Number.POSITIVE_INFINITY;

  return !collisionOnly && (syntheticName || (zeroMass && visualPresent));
}

function sortVisualAttachmentLinkIds(
  robot: RobotState,
  parentLinkId: string,
  candidateIds: string[],
): string[] {
  const parent = robot.links[parentLinkId];
  const parentName = parent?.name || parentLinkId;

  return [...candidateIds].sort((leftId, rightId) => {
    const leftLink = robot.links[leftId];
    const rightLink = robot.links[rightId];
    const leftOrder = getGeomSuffixOrder(leftId, parentLinkId, parentName);
    const rightOrder = getGeomSuffixOrder(rightId, parentLinkId, parentName);

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    const leftName = leftLink?.name || leftId;
    const rightName = rightLink?.name || rightId;
    return leftName.localeCompare(rightName);
  });
}

function collectVisualAttachmentLinkIds(
  robot: RobotState,
  parentLinkId: string,
  fixedChildrenByParent: Map<string, string[]>,
): string[] {
  const parent = robot.links[parentLinkId];
  if (!parent) {
    return [];
  }

  const childIds = (fixedChildrenByParent.get(parentLinkId) || []).filter((childId) =>
    isVisualAttachmentLink(robot.links[childId], parentLinkId, parent.name),
  );

  return [parentLinkId, ...sortVisualAttachmentLinkIds(robot, parentLinkId, childIds)];
}

function createUniqueRobotRecordKey(
  existing: Record<string, unknown>,
  preferredKeys: string[],
  fallbackKey: string,
): string {
  const candidates = [...preferredKeys, fallbackKey]
    .map((value) => sanitizeFileToken(value))
    .filter(Boolean);

  for (const candidate of candidates) {
    if (!existing[candidate]) {
      return candidate;
    }
  }

  const base = sanitizeFileToken(fallbackKey);
  let suffix = 2;
  while (existing[`${base}_${suffix}`]) {
    suffix += 1;
  }
  return `${base}_${suffix}`;
}

function createSyntheticVisualAttachmentLink(
  robot: RobotState,
  parentLinkId: string,
  descriptor: SnapshotMeshDescriptor,
  ordinal: number,
): string {
  const descriptorToken = normalizeSemanticToken(getDescriptorSemanticName(descriptor));
  const linkId = createUniqueRobotRecordKey(
    robot.links,
    [
      descriptorToken ? `${descriptorToken}_link` : '',
      descriptorToken ? `${parentLinkId}_${descriptorToken}` : '',
    ],
    `${parentLinkId}_geom_${ordinal}`,
  );
  const jointId = createUniqueRobotRecordKey(
    robot.joints,
    [`fixed_${linkId}`],
    `${parentLinkId}_fixed_${linkId}`,
  );

  robot.links[linkId] = {
    ...DEFAULT_LINK,
    id: linkId,
    name: linkId,
    visual: {
      ...DEFAULT_LINK.visual,
      type: GeometryType.MESH,
      dimensions: { x: 1, y: 1, z: 1 },
      origin: { ...DEFAULT_LINK.visual.origin },
    },
    collision: {
      ...DEFAULT_LINK.collision,
      type: GeometryType.NONE,
      dimensions: { x: 0, y: 0, z: 0 },
      origin: { ...DEFAULT_LINK.collision.origin },
    },
    inertial: {
      ...DEFAULT_LINK.inertial,
      mass: 0,
    },
  };

  robot.joints[jointId] = {
    ...DEFAULT_JOINT,
    id: jointId,
    name: jointId,
    type: JointType.FIXED,
    parentLinkId,
    childLinkId: linkId,
    origin: {
      xyz: { x: 0, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: 0 },
    },
    axis: { x: 0, y: 0, z: 1 },
    limit: undefined as UrdfJoint['limit'],
  };

  return linkId;
}

function assignVisualDescriptorToLink(
  snapshot: UsdExportSnapshot,
  robot: RobotState,
  linkId: string,
  entry: ExportDescriptor,
  descriptorByPath: Map<string, ExportDescriptor>,
  materialLookup: Map<string, SnapshotMaterialRecord>,
  preferredMaterialRecord?: SnapshotMaterialRecord | null,
  explicitMaterialFallback?: {
    color?: string;
    texture?: string;
  } | null,
): void {
  const link = robot.links[linkId];
  if (!link) {
    return;
  }

  const descriptorMaterialRecord = getDescriptorMaterialRecord(entry, materialLookup);
  const explicitFallbackColor = colorHexToVertexColor(explicitMaterialFallback?.color);
  const preferredFallbackColor = colorArrayToVertexColor(preferredMaterialRecord?.color);
  entry.writeTextureCoordinates =
    snapshotMaterialUsesTextureCoordinates(descriptorMaterialRecord) ||
    snapshotMaterialUsesTextureCoordinates(preferredMaterialRecord) ||
    hasNonEmptyTexturePath(explicitMaterialFallback?.texture) ||
    visualUsesTextureCoordinates(link.visual);
  entry.displayColor =
    colorArrayToVertexColor(descriptorMaterialRecord?.color) ||
    explicitFallbackColor ||
    preferredFallbackColor;

  const primitiveGeometry = resolvePrimitiveGeometryFromDescriptor(
    entry.descriptor,
    link.visual,
    snapshot,
  );
  if (primitiveGeometry) {
    link.visual = {
      ...DEFAULT_LINK.visual,
      ...(link.visual || {}),
      ...primitiveGeometry,
      meshPath: undefined,
      origin: link.visual?.origin || { ...DEFAULT_LINK.visual.origin },
    };
    const appliedMaterial = applyDescriptorMaterialToLink(robot, linkId, entry, materialLookup);
    if (
      !appliedMaterial &&
      !applyVisualMaterialFallbackToLink(robot, linkId, explicitMaterialFallback)
    ) {
      applySnapshotMaterialRecordToLink(robot, linkId, preferredMaterialRecord);
    }
    return;
  }

  const visual = link.visual;
  link.visual = {
    ...DEFAULT_LINK.visual,
    ...(visual || {}),
    type: GeometryType.MESH,
    meshPath: entry.exportPath,
    doubleSided: true,
    dimensions: resolveUsdSnapshotMeshDimensions(visual?.dimensions, entry.descriptor, snapshot),
    origin: visual?.origin || { ...DEFAULT_LINK.visual.origin },
  };
  entry.bakeTransformIntoMesh = !hasNonIdentityOrigin(link.visual.origin);
  descriptorByPath.set(entry.exportPath, entry);
  const subsetAuthoredMaterials = buildGeomSubsetAuthoredMaterials(
    entry.descriptor,
    materialLookup,
  );
  if (subsetAuthoredMaterials) {
    link.visual = {
      ...link.visual,
      authoredMaterials: subsetAuthoredMaterials,
      materialSource: 'named',
    };
  }
  const appliedMaterial = applyDescriptorMaterialToLink(robot, linkId, entry, materialLookup);
  if (
    !appliedMaterial &&
    !applyVisualMaterialFallbackToLink(robot, linkId, explicitMaterialFallback)
  ) {
    applySnapshotMaterialRecordToLink(robot, linkId, preferredMaterialRecord);
  }
  const meshMaterialGroups = buildGeomSubsetMaterialGroups(entry.descriptor, link.visual);
  const subsetDisplayColors = buildGeomSubsetDisplayColors(entry.descriptor, link.visual);
  if (meshMaterialGroups) {
    link.visual = {
      ...link.visual,
      meshMaterialGroups,
    };
  }
  if (subsetDisplayColors) {
    entry.subsetDisplayColors = subsetDisplayColors;
  }
}

function assignCollisionDescriptorToLink(
  snapshot: UsdExportSnapshot,
  robot: RobotState,
  linkId: string,
  entry: ExportDescriptor,
  descriptorByPath: Map<string, ExportDescriptor>,
  collisionIndex: number,
): void {
  const link = robot.links[linkId];
  if (!link) {
    return;
  }

  const currentCollision =
    collisionIndex === 0 ? link.collision : link.collisionBodies?.[collisionIndex - 1];
  const primitiveGeometry = resolvePrimitiveGeometryFromDescriptor(
    entry.descriptor,
    currentCollision,
    snapshot,
  );
  if (primitiveGeometry) {
    const nextCollision = {
      ...DEFAULT_LINK.collision,
      ...(currentCollision || {}),
      ...primitiveGeometry,
      meshPath: undefined,
      origin: currentCollision?.origin || { ...DEFAULT_LINK.collision.origin },
    };

    if (collisionIndex === 0) {
      link.collision = nextCollision;
      return;
    }

    const bodies = [...(link.collisionBodies || [])];
    bodies[collisionIndex - 1] = nextCollision;
    link.collisionBodies = bodies;
    return;
  }

  const sanitizedCollision = currentCollision;
  if (collisionIndex === 0) {
    link.collision = {
      ...DEFAULT_LINK.collision,
      ...(sanitizedCollision || {}),
      type: GeometryType.MESH,
      meshPath: entry.exportPath,
      dimensions: resolveUsdSnapshotMeshDimensions(
        sanitizedCollision?.dimensions,
        entry.descriptor,
        snapshot,
      ),
      origin: sanitizedCollision?.origin || { ...DEFAULT_LINK.collision.origin },
    };
    entry.bakeTransformIntoMesh = !hasNonIdentityOrigin(link.collision.origin);
    descriptorByPath.set(entry.exportPath, entry);
    return;
  }

  const bodies = [...(link.collisionBodies || [])];
  const currentBody = sanitizedCollision;
  bodies[collisionIndex - 1] = {
    ...DEFAULT_LINK.collision,
    ...(currentBody || {}),
    type: GeometryType.MESH,
    meshPath: entry.exportPath,
    dimensions: resolveUsdSnapshotMeshDimensions(
      currentBody?.dimensions,
      entry.descriptor,
      snapshot,
    ),
    origin: currentBody?.origin || { ...DEFAULT_LINK.collision.origin },
  };
  link.collisionBodies = bodies;
  entry.bakeTransformIntoMesh = !hasNonIdentityOrigin(bodies[collisionIndex - 1]?.origin);
  descriptorByPath.set(entry.exportPath, entry);
}

function assignLinkDescriptors(
  snapshot: UsdExportSnapshot,
  robot: RobotState,
  linkId: string,
  linkPath: string,
  visualDescriptors: ExportDescriptor[],
  collisionDescriptors: ExportDescriptor[],
  descriptorByPath: Map<string, ExportDescriptor>,
  materialLookup: Map<string, SnapshotMaterialRecord>,
  preferredMaterialLookup: Map<string, SnapshotMaterialRecord>,
  fixedChildrenByParent: Map<string, string[]>,
): void {
  if (!robot.links[linkId]) {
    return;
  }

  const visualLinkIds = collectVisualAttachmentLinkIds(robot, linkId, fixedChildrenByParent);
  const usedVisualLinkIds = new Set<string>();
  const preferredMaterialRecord = preferredMaterialLookup.get(normalizeUsdPath(linkPath)) || null;
  const sourceLink = robot.links[linkId];

  visualDescriptors.forEach((entry, index) => {
    let targetLinkId: string | undefined;
    const explicitMaterialFallback = resolveVisualMaterialFallbackForDescriptor(
      sourceLink,
      entry,
      index,
    );

    if (index === 0) {
      targetLinkId = linkId;
    } else {
      const availableLinkIds = visualLinkIds.filter(
        (candidateId) => candidateId !== linkId && !usedVisualLinkIds.has(candidateId),
      );

      let bestMatchId: string | undefined;
      let bestScore = 0;
      availableLinkIds.forEach((candidateId) => {
        const candidateLink = robot.links[candidateId];
        const score = candidateLink
          ? scoreDescriptorAgainstLink(entry.descriptor, candidateLink)
          : 0;
        if (score > bestScore) {
          bestScore = score;
          bestMatchId = candidateId;
        }
      });

      targetLinkId = bestMatchId || availableLinkIds[0];
      if (!targetLinkId) {
        targetLinkId = createSyntheticVisualAttachmentLink(robot, linkId, entry.descriptor, index);
        visualLinkIds.push(targetLinkId);
        const children = fixedChildrenByParent.get(linkId) || [];
        children.push(targetLinkId);
        fixedChildrenByParent.set(linkId, children);
      }
    }

    if (entry.subsetSection && targetLinkId !== linkId) {
      const sourceOrigin = robot.links[linkId]?.visual?.origin;
      const targetLink = robot.links[targetLinkId];
      if (
        targetLink &&
        hasNonIdentityOrigin(sourceOrigin) &&
        !hasNonIdentityOrigin(targetLink.visual.origin)
      ) {
        targetLink.visual = {
          ...targetLink.visual,
          origin: cloneVisualOrigin(sourceOrigin),
        };
      }
    }

    usedVisualLinkIds.add(targetLinkId);
    assignVisualDescriptorToLink(
      snapshot,
      robot,
      targetLinkId,
      entry,
      descriptorByPath,
      materialLookup,
      preferredMaterialRecord,
      explicitMaterialFallback,
    );
  });

  collisionDescriptors.forEach((entry, index) => {
    assignCollisionDescriptorToLink(snapshot, robot, linkId, entry, descriptorByPath, index);
  });
}

export function collectReferencedMeshPaths(robot: RobotState): Set<string> {
  const referenced = new Set<string>();

  Object.values(robot.links).forEach((link) => {
    getVisualGeometryEntries(link).forEach((entry) => {
      if (entry.geometry.type === GeometryType.MESH && entry.geometry.meshPath) {
        referenced.add(entry.geometry.meshPath);
      }
    });
    if (link.collision.type === GeometryType.MESH && link.collision.meshPath) {
      referenced.add(link.collision.meshPath);
    }
    (link.collisionBodies || []).forEach((body) => {
      if (body.type === GeometryType.MESH && body.meshPath) {
        referenced.add(body.meshPath);
      }
    });
  });

  return referenced;
}

export function createDescriptorExportMap(
  snapshot: UsdExportSnapshot,
  resolution: ViewerRobotDataResolution,
  currentRobot?: RobotLike | null,
): {
  robot: RobotState;
  descriptorByPath: Map<string, ExportDescriptor>;
} {
  const snapshotRobot = cloneRobotState({
    ...resolution.robotData,
    selection: { type: null, id: null },
  });
  const baseRobot = currentRobot
    ? mergeCurrentRobotWithSnapshotMeshPaths(currentRobot, snapshotRobot)
    : snapshotRobot;
  const descriptors = Array.from(snapshot.render?.meshDescriptors || []);
  const descriptorsByLinkRole = new Map<string, ExportDescriptor[]>();
  const materialLookup = getSnapshotMaterialLookup(snapshot);
  const preferredMaterialLookup = getSnapshotPreferredVisualMaterialLookup(snapshot);

  descriptors.forEach((descriptor, index) => {
    const linkPath = getDescriptorLinkPath(descriptor);
    if (!linkPath) return;

    const linkId = resolution.linkIdByPath[linkPath];
    if (!linkId) return;

    const role = getDescriptorRole(descriptor);
    const ordinal = parseDescriptorOrdinal(descriptor, index);
    const key = `${linkId}:${role}`;
    const current = descriptorsByLinkRole.get(key) || [];
    current.push({
      descriptor,
      meshId: normalizeUsdPath(descriptor.meshId || ''),
      linkPath,
      linkId,
      role,
      exportPath: `${sanitizeFileToken(linkId)}_${role}_${ordinal}.obj`,
      ordinal,
      subsetIndex: 0,
      subsetSection: null,
      materialIdOverride: null,
    } satisfies ExportDescriptor);
    descriptorsByLinkRole.set(key, current);
  });

  descriptorsByLinkRole.forEach((entries) => {
    entries.sort((left, right) => {
      if (left.ordinal !== right.ordinal) {
        return left.ordinal - right.ordinal;
      }
      if ((left.subsetIndex || 0) !== (right.subsetIndex || 0)) {
        return (left.subsetIndex || 0) - (right.subsetIndex || 0);
      }
      return left.meshId.localeCompare(right.meshId);
    });
  });

  const descriptorByPath = new Map<string, ExportDescriptor>();
  const fixedChildrenByParent = buildFixedChildLinksByParent(baseRobot);

  Object.entries(resolution.linkIdByPath).forEach(([linkPath, linkId]) => {
    assignLinkDescriptors(
      snapshot,
      baseRobot,
      linkId,
      linkPath,
      descriptorsByLinkRole.get(`${linkId}:visual`) || [],
      descriptorsByLinkRole.get(`${linkId}:collision`) || [],
      descriptorByPath,
      materialLookup,
      preferredMaterialLookup,
      fixedChildrenByParent,
    );
  });

  return {
    robot: stripSyntheticWorldRootForExport(baseRobot),
    descriptorByPath,
  };
}
