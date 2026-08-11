import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  GeometryType,
  JointType,
  type RobotClosedLoopConstraint,
  type RobotData,
  type UrdfJoint,
  type UrdfLink,
} from '@/types';
import type { ViewerRobotDataResolution } from './viewerRobotData';
import { resolveUsdDescriptorTargetLinkPath } from './usdDescriptorLinkResolution';
import { shouldUseUsdCollisionVisualProxy } from './usdCollisionVisualProxy';
import { isUsdGenericSceneSnapshot } from './usdGenericScenePolicy';
import { resolveUsdPrimitiveGeometryFromDescriptor } from './usdPrimitiveGeometry';
import {
  createPlaceholderVisual,
  createUniqueId,
  getCollisionGeometryVisualProxy,
  getPathBasename,
  isUsdInternalMeshLibraryPath,
  normalizeUsdPath,
  shouldOmitUsdInternalMeshLibraryPaths,
  type LinkDynamicsEntry,
  type MeshDescriptor,
  type ResolvedUsdGeometry,
  type RobotSceneSnapshot,
} from './usdViewerRobotAdapter/usdAdapterConversions';
import {
  applyVisualGroupMaterialsToLink,
  attachUsdMeshDescriptorRefs,
  deriveMeshCountsByLinkPath,
  getDescriptorSemanticName,
  getSnapshotMaterialLookup,
  getUsdDescriptorAttachmentGroupKey,
  groupDescriptorEntries,
  isUsdMeshLikeDescriptor,
  normalizeDescriptorSectionName,
  parseDescriptorOrdinal,
  type DescriptorEntry,
} from './usdViewerRobotAdapter/usdAdapterDescriptors';
import {
  buildMeshOnlyHierarchyFallback,
  createClosedLoopConstraintFromUsdEntry,
  createJointFromViewerEntry,
  createLinkFromViewerMetadata,
  populateClosedLoopConstraintWorldAnchors,
} from './usdViewerRobotAdapter/usdAdapterTopology';

export type { ViewerRobotDataResolution } from './viewerRobotData';
export type UsdViewerRobotDataResolution = ViewerRobotDataResolution;

export type UsdViewerRobotSceneSnapshot = RobotSceneSnapshot;

export function adaptUsdViewerSnapshotToRobotData(
  snapshot: RobotSceneSnapshot | null | undefined,
  options: { fileName?: string } = {},
): ViewerRobotDataResolution | null {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }

  const metadata = snapshot.robotMetadataSnapshot || {};
  const linkParentPairs = Array.from(
    metadata.linkParentPairs || snapshot.robotTree?.linkParentPairs || [],
  );
  const jointCatalogEntries = Array.from(
    metadata.jointCatalogEntries || snapshot.robotTree?.jointCatalogEntries || [],
  );
  const closedLoopConstraintEntries = Array.from(metadata.closedLoopConstraintEntries || []);
  const linkDynamicsEntries = Array.from(
    metadata.linkDynamicsEntries || snapshot.physics?.linkDynamicsEntries || [],
  );
  const rootLinkPaths = Array.from(snapshot.robotTree?.rootLinkPaths || []);

  const linkPaths = new Set<string>();
  const addLinkPath = (value: string | null | undefined) => {
    const normalized = normalizeUsdPath(value);
    if (normalized) linkPaths.add(normalized);
  };

  linkParentPairs.forEach((pair) => {
    addLinkPath(pair?.[0]);
    addLinkPath(pair?.[1]);
  });
  jointCatalogEntries.forEach((entry) => {
    addLinkPath(entry.linkPath);
    addLinkPath(entry.childLinkPath);
    addLinkPath(entry.parentLinkPath);
  });
  linkDynamicsEntries.forEach((entry) => addLinkPath(entry.linkPath));
  rootLinkPaths.forEach((entry) => addLinkPath(entry));
  Object.keys(metadata.meshCountsByLinkPath || {}).forEach((path) => addLinkPath(path));

  let meshCountsByLinkPath = deriveMeshCountsByLinkPath(snapshot, linkPaths);
  Object.keys(meshCountsByLinkPath).forEach((path) => addLinkPath(path));
  const normalizedDefaultPrimPath = normalizeUsdPath(snapshot.stage?.defaultPrimPath);
  const isGenericScene = isUsdGenericSceneSnapshot(snapshot);
  const hasInternalMeshLibraryPath = Array.from(linkPaths).some((path) =>
    isUsdInternalMeshLibraryPath(path),
  );
  const shouldOmitInternalMeshLibraryPaths =
    shouldOmitUsdInternalMeshLibraryPaths(linkPaths) ||
    (hasInternalMeshLibraryPath &&
      Boolean(normalizedDefaultPrimPath) &&
      !isUsdInternalMeshLibraryPath(normalizedDefaultPrimPath));
  const effectiveSourceLinkPaths =
    isGenericScene && normalizedDefaultPrimPath
      ? new Set([normalizedDefaultPrimPath])
      : shouldOmitInternalMeshLibraryPaths
        ? new Set(Array.from(linkPaths).filter((path) => !isUsdInternalMeshLibraryPath(path)))
        : new Set(linkPaths);
  if (
    shouldOmitInternalMeshLibraryPaths &&
    effectiveSourceLinkPaths.size === 0 &&
    normalizedDefaultPrimPath
  ) {
    effectiveSourceLinkPaths.add(normalizedDefaultPrimPath);
  }
  const effectiveSourceLinkParentPairs = isGenericScene
    ? []
    : shouldOmitInternalMeshLibraryPaths
      ? linkParentPairs.filter(
          ([childPath, parentPath]) =>
            !isUsdInternalMeshLibraryPath(childPath) && !isUsdInternalMeshLibraryPath(parentPath),
        )
      : linkParentPairs;
  const effectiveJointCatalogEntries = isGenericScene
    ? []
    : shouldOmitInternalMeshLibraryPaths
      ? jointCatalogEntries.filter(
          (entry) =>
            !isUsdInternalMeshLibraryPath(entry.linkPath) &&
            !isUsdInternalMeshLibraryPath(entry.childLinkPath) &&
            !isUsdInternalMeshLibraryPath(entry.parentLinkPath),
        )
      : jointCatalogEntries;
  const effectiveSourceRootLinkPaths =
    isGenericScene && normalizedDefaultPrimPath
      ? [normalizedDefaultPrimPath]
      : shouldOmitInternalMeshLibraryPaths
        ? rootLinkPaths.filter((path) => !isUsdInternalMeshLibraryPath(path))
        : rootLinkPaths;
  if (
    shouldOmitInternalMeshLibraryPaths &&
    effectiveSourceRootLinkPaths.length === 0 &&
    normalizedDefaultPrimPath
  ) {
    effectiveSourceRootLinkPaths.push(normalizedDefaultPrimPath);
  }

  if (shouldOmitInternalMeshLibraryPaths) {
    meshCountsByLinkPath = Object.fromEntries(
      Object.entries(meshCountsByLinkPath).filter(
        ([linkPath]) => !isUsdInternalMeshLibraryPath(linkPath),
      ),
    );
  }
  if (isGenericScene && normalizedDefaultPrimPath) {
    meshCountsByLinkPath = {
      [normalizedDefaultPrimPath]: meshCountsByLinkPath[normalizedDefaultPrimPath] || {},
    };
  }

  const hierarchyFallback = buildMeshOnlyHierarchyFallback({
    defaultPrimPath: snapshot.stage?.defaultPrimPath,
    linkPaths: effectiveSourceLinkPaths,
    linkParentPairs: effectiveSourceLinkParentPairs,
    jointCatalogEntries: effectiveJointCatalogEntries,
    rootLinkPaths: effectiveSourceRootLinkPaths,
  });
  const effectiveLinkPaths = hierarchyFallback.linkPaths;
  const effectiveLinkParentPairs = hierarchyFallback.linkParentPairs;
  const effectiveRootLinkPaths = hierarchyFallback.rootLinkPaths;

  const normalizedStageSourcePath = normalizeUsdPath(
    snapshot.stageSourcePath || metadata.stageSourcePath,
  );
  if (effectiveLinkPaths.size === 0) {
    return null;
  }

  const sortedLinkPaths = Array.from(effectiveLinkPaths).sort((left, right) =>
    left.localeCompare(right),
  );
  const dynamicsByLinkPath = new Map<string, LinkDynamicsEntry>();
  linkDynamicsEntries.forEach((entry) => {
    const normalizedPath = normalizeUsdPath(entry.linkPath);
    if (normalizedPath && !dynamicsByLinkPath.has(normalizedPath)) {
      dynamicsByLinkPath.set(normalizedPath, entry);
    }
  });

  const links: Record<string, UrdfLink> = {};
  const linkIdByPath = new Map<string, string>();
  const linkPathById = new Map<string, string>();
  const usedLinkIds = new Set<string>();

  for (const linkPath of sortedLinkPaths) {
    const linkName = getPathBasename(linkPath) || 'link';
    const linkId = createUniqueId(linkName, usedLinkIds, linkPath);
    linkIdByPath.set(linkPath, linkId);

    const link = createLinkFromViewerMetadata(
      linkPath,
      meshCountsByLinkPath[linkPath] || {},
      dynamicsByLinkPath.get(linkPath) || null,
    );
    link.id = linkId;
    link.name = linkName;
    links[linkId] = link;
    linkPathById.set(linkId, linkPath);
  }

  const joints: Record<string, UrdfJoint> = {};
  const usedJointIds = new Set<string>();
  const explicitChildPaths = new Set<string>();
  const jointPathById = new Map<string, string>();
  const childLinkPathByJointId = new Map<string, string>();
  const parentLinkPathByJointId = new Map<string, string>();

  for (const entry of effectiveJointCatalogEntries) {
    const joint = createJointFromViewerEntry(entry, linkIdByPath, usedJointIds);
    if (!joint) continue;
    joints[joint.id] = joint;

    const childPath = normalizeUsdPath(entry.linkPath || entry.childLinkPath);
    const parentPath = normalizeUsdPath(entry.parentLinkPath);
    const jointPath = normalizeUsdPath(entry.jointPath);
    if (childPath) {
      explicitChildPaths.add(childPath);
      childLinkPathByJointId.set(joint.id, childPath);
    }
    if (parentPath) {
      parentLinkPathByJointId.set(joint.id, parentPath);
    }
    if (jointPath) {
      jointPathById.set(joint.id, jointPath);
    }
  }

  for (const pair of effectiveLinkParentPairs) {
    const childPath = normalizeUsdPath(pair?.[0]);
    const parentPath = normalizeUsdPath(pair?.[1]);
    if (!childPath || !parentPath || explicitChildPaths.has(childPath)) continue;

    const childLinkId = linkIdByPath.get(childPath);
    const parentLinkId = linkIdByPath.get(parentPath);
    if (!childLinkId || !parentLinkId) continue;

    const jointId = createUniqueId(
      `${getPathBasename(childPath) || childLinkId}_fixed`,
      usedJointIds,
      `${parentPath}_${childPath}_fixed`,
    );
    joints[jointId] = {
      ...DEFAULT_JOINT,
      id: jointId,
      name: jointId,
      type: JointType.FIXED,
      parentLinkId,
      childLinkId,
      origin: {
        xyz: { x: 0, y: 0, z: 0 },
        rpy: { r: 0, p: 0, y: 0 },
      },
      axis: { x: 0, y: 0, z: 1 },
    };
    childLinkPathByJointId.set(jointId, childPath);
    parentLinkPathByJointId.set(jointId, parentPath);
  }

  const childLinkIds = new Set(Object.values(joints).map((joint) => joint.childLinkId));
  const preferredRootPath = normalizeUsdPath(effectiveRootLinkPaths[0]);
  const rootLinkId =
    (preferredRootPath ? linkIdByPath.get(preferredRootPath) : null) ||
    Object.keys(links).find((linkId) => !childLinkIds.has(linkId)) ||
    Object.keys(links)[0];

  if (!rootLinkId) {
    return null;
  }

  const robotName =
    getPathBasename(snapshot.stage?.defaultPrimPath) ||
    (options.fileName
      ? options.fileName
          .split('/')
          .pop()
          ?.replace(/\.[^/.]+$/, '')
      : '') ||
    getPathBasename(normalizedStageSourcePath) ||
    'usd_scene';

  const materials: NonNullable<RobotData['materials']> = {};
  const materialLookup = getSnapshotMaterialLookup(snapshot);
  const descriptors = Array.from(snapshot.render?.meshDescriptors || []);
  const visualDescriptorsByLinkPath = new Map<string, DescriptorEntry[]>();
  const collisionDescriptorsByLinkPath = new Map<string, DescriptorEntry[]>();
  const visualDescriptorTargetLinkIds = new Map<string, string>();

  const getDescriptorEntryKey = (descriptor: MeshDescriptor, ordinal: number) =>
    `${normalizeDescriptorSectionName(descriptor.sectionName)}|${normalizeUsdPath(descriptor.meshId)}|${normalizeUsdPath(descriptor.resolvedPrimPath)}|${ordinal}`;

  descriptors.forEach((descriptor) => {
    const linkPath = resolveUsdDescriptorTargetLinkPath({
      descriptor,
      knownLinkPaths: effectiveLinkPaths,
    });
    if (!linkPath) {
      return;
    }

    const sectionName = normalizeDescriptorSectionName(descriptor.sectionName);
    const targetMap =
      sectionName === 'collisions' ? collisionDescriptorsByLinkPath : visualDescriptorsByLinkPath;
    const entries = targetMap.get(linkPath) || [];
    entries.push({
      descriptor,
      ordinal: parseDescriptorOrdinal(descriptor, entries.length),
      groupKey: getUsdDescriptorAttachmentGroupKey(descriptor),
    });
    targetMap.set(linkPath, entries);
  });

  visualDescriptorsByLinkPath.forEach((entries) => {
    entries.sort((left, right) => left.ordinal - right.ordinal);
  });
  collisionDescriptorsByLinkPath.forEach((entries) => {
    entries.sort((left, right) => left.ordinal - right.ordinal);
  });

  visualDescriptorsByLinkPath.forEach((entries, linkPath) => {
    const parentLinkId = linkIdByPath.get(linkPath);
    if (!parentLinkId) {
      return;
    }

    const groupedEntries = groupDescriptorEntries(entries);
    const primaryGroup = groupedEntries[0];
    primaryGroup?.entries.forEach(({ descriptor, ordinal }) => {
      visualDescriptorTargetLinkIds.set(getDescriptorEntryKey(descriptor, ordinal), parentLinkId);
    });
    applyVisualGroupMaterialsToLink(
      links[parentLinkId],
      parentLinkId,
      primaryGroup,
      materialLookup,
      materials,
    );
    links[parentLinkId].visual = attachUsdMeshDescriptorRefs(
      links[parentLinkId].visual,
      primaryGroup,
    );

    groupedEntries.slice(1).forEach((group, index) => {
      const descriptor = group.entries[0]?.descriptor;
      if (!descriptor) {
        return;
      }

      const semanticName = getDescriptorSemanticName(descriptor);
      const childLinkId = createUniqueId(
        semanticName || `${parentLinkId}_geom_${index + 1}`,
        usedLinkIds,
        `${parentLinkId}_${descriptor.resolvedPrimPath || descriptor.meshId || index}`,
      );
      const childJointId = createUniqueId(
        `fixed_${childLinkId}`,
        usedJointIds,
        `${parentLinkId}_${childLinkId}_fixed`,
      );

      links[childLinkId] = {
        ...DEFAULT_LINK,
        id: childLinkId,
        name: childLinkId,
        visual: createPlaceholderVisual(GeometryType.MESH, DEFAULT_LINK.visual.color),
        collision: createPlaceholderVisual(GeometryType.NONE, DEFAULT_LINK.collision.color),
        inertial: {
          ...DEFAULT_LINK.inertial,
          mass: 0,
        },
      };
      joints[childJointId] = {
        ...DEFAULT_JOINT,
        id: childJointId,
        name: childJointId,
        type: JointType.FIXED,
        parentLinkId,
        childLinkId,
        origin: {
          xyz: { x: 0, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        axis: { x: 0, y: 0, z: 1 },
      };
      applyVisualGroupMaterialsToLink(
        links[childLinkId],
        childLinkId,
        group,
        materialLookup,
        materials,
      );
      links[childLinkId].visual = attachUsdMeshDescriptorRefs(
        links[childLinkId].visual,
        group,
      );

      group.entries.forEach(({ descriptor: groupDescriptor, ordinal }) => {
        visualDescriptorTargetLinkIds.set(
          getDescriptorEntryKey(groupDescriptor, ordinal),
          childLinkId,
        );
      });
    });
  });

  const visualGeometryAssignedLinkIds = new Set<string>();
  visualDescriptorsByLinkPath.forEach((entries) => {
    entries.forEach(({ descriptor, ordinal }) => {
      const targetLinkId = visualDescriptorTargetLinkIds.get(
        getDescriptorEntryKey(descriptor, ordinal),
      );
      if (
        !targetLinkId ||
        !links[targetLinkId] ||
        visualGeometryAssignedLinkIds.has(targetLinkId)
      ) {
        return;
      }

      const nextGeometry: ResolvedUsdGeometry | null = resolveUsdPrimitiveGeometryFromDescriptor(
        descriptor,
        links[targetLinkId].visual,
        snapshot,
      );
      if (!nextGeometry) {
        return;
      }

      links[targetLinkId].visual = {
        ...links[targetLinkId].visual,
        ...nextGeometry,
        meshPath: undefined,
      };
      visualGeometryAssignedLinkIds.add(targetLinkId);
    });
  });

  collisionDescriptorsByLinkPath.forEach((entries, linkPath) => {
    const linkId = linkIdByPath.get(linkPath);
    const link = linkId ? links[linkId] : null;
    if (!link) {
      return;
    }

    groupDescriptorEntries(entries).forEach((group, index) => {
      const descriptor = group.entries[0]?.descriptor;
      if (!descriptor) {
        return;
      }

      const currentCollision = index === 0 ? link.collision : link.collisionBodies?.[index - 1];
      const primitiveGeometry = resolveUsdPrimitiveGeometryFromDescriptor(
        descriptor,
        currentCollision,
        snapshot,
      );
      const nextGeometry: ResolvedUsdGeometry | null = primitiveGeometry ?? (
        isUsdMeshLikeDescriptor(descriptor)
          ? {
              type: GeometryType.MESH,
              dimensions: currentCollision?.dimensions ?? { x: 1, y: 1, z: 1 },
            }
          : null
      );
      if (!nextGeometry) {
        const unresolvedCollision = attachUsdMeshDescriptorRefs(
          {
            ...DEFAULT_LINK.collision,
            ...(currentCollision || {}),
            type: GeometryType.NONE,
            dimensions: { x: 0, y: 0, z: 0 },
            meshPath: undefined,
            origin: currentCollision?.origin ?? { ...DEFAULT_LINK.collision.origin },
            verbose: `USD collision descriptor is missing real primitive or mesh payload data: ${
              descriptor.resolvedPrimPath || descriptor.meshId || 'unknown'
            }`,
          },
          group,
        );
        if (index === 0) {
          link.collision = unresolvedCollision;
          return;
        }
        const collisionBodies = [...(link.collisionBodies || [])];
        collisionBodies[index - 1] = unresolvedCollision;
        link.collisionBodies = collisionBodies;
        return;
      }

      const nextCollision = attachUsdMeshDescriptorRefs(
        {
          ...DEFAULT_LINK.collision,
          ...(currentCollision || {}),
          ...nextGeometry,
          meshPath: undefined,
          origin: nextGeometry.origin ??
            currentCollision?.origin ?? { ...DEFAULT_LINK.collision.origin },
        },
        group,
      );

      if (index === 0) {
        link.collision = nextCollision;
        return;
      }

      const collisionBodies = [...(link.collisionBodies || [])];
      collisionBodies[index - 1] = nextCollision;
      link.collisionBodies = collisionBodies;
    });
  });

  if (shouldUseUsdCollisionVisualProxy(snapshot)) {
    Object.values(links).forEach((link) => {
      if (link.visual.type !== GeometryType.NONE) {
        return;
      }

      const proxyGeometry = getCollisionGeometryVisualProxy(link);
      if (!proxyGeometry) {
        return;
      }

      link.visual = {
        ...link.visual,
        type: proxyGeometry.type,
        dimensions: proxyGeometry.dimensions
          ? { ...proxyGeometry.dimensions }
          : link.visual.dimensions,
        origin: proxyGeometry.origin
          ? {
              xyz: { ...proxyGeometry.origin.xyz },
              rpy: { ...proxyGeometry.origin.rpy },
            }
          : link.visual.origin,
        meshPath: undefined,
      };
    });
  }

  const closedLoopConstraints = populateClosedLoopConstraintWorldAnchors(
    closedLoopConstraintEntries
      .map((entry) => createClosedLoopConstraintFromUsdEntry(entry, linkIdByPath))
      .filter((entry): entry is RobotClosedLoopConstraint => Boolean(entry)),
    links,
    joints,
    rootLinkId,
  );

  return {
    stageSourcePath: normalizedStageSourcePath || null,
    linkIdByPath: Object.fromEntries(linkIdByPath.entries()),
    linkPathById: Object.fromEntries(linkPathById.entries()),
    jointPathById: Object.fromEntries(jointPathById.entries()),
    childLinkPathByJointId: Object.fromEntries(childLinkPathByJointId.entries()),
    parentLinkPathByJointId: Object.fromEntries(parentLinkPathByJointId.entries()),
    runtimeLinkMappingMode: 'robot-data',
    robotData: {
      name: robotName,
      links,
      joints,
      rootLinkId,
      ...(Object.keys(materials).length > 0 ? { materials } : {}),
      ...(closedLoopConstraints.length > 0 ? { closedLoopConstraints } : {}),
    },
  };
}
