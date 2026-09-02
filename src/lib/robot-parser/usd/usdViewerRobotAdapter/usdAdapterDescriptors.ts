import {
  DEFAULT_LINK,
  type RobotData,
  type UrdfLink,
  type UrdfUsdMeshDescriptorRef,
  type UrdfVisual,
  type UrdfVisualMaterial,
} from '@/types';
import {
  buildNormalizedUsdPathSet,
  getUsdDescriptorSectionChildToken,
  getUsdDescriptorSemanticChildLinkName,
  resolveUsdDescriptorTargetLinkPath,
} from '../usdDescriptorLinkResolution';
import { getUsdDescriptorPrimitiveType } from '../usdPrimitiveGeometry';
import {
  getPathBasename,
  hasMaterialRecordContent,
  normalizeUsdPath,
  resolveSnapshotAuthoredMaterial,
  type MaterialRecord,
  type MeshCountsEntry,
  type MeshDescriptor,
  type RobotSceneSnapshot,
} from './usdAdapterConversions';

export interface DescriptorEntry {
  descriptor: MeshDescriptor;
  ordinal: number;
  groupKey: string;
}

export interface DescriptorGroup {
  groupKey: string;
  entries: DescriptorEntry[];
}

interface DescriptorGeomSubsetSection {
  start: number;
  length: number;
  materialId: string | null;
}

interface ResolvedDescriptorMaterialRecord {
  materialId: string | null;
  material: MaterialRecord;
  authoredMaterial: UrdfVisualMaterial;
}

export function createUsdMeshDescriptorRef(
  descriptor: MeshDescriptor,
): UrdfUsdMeshDescriptorRef {
  return {
    meshId: descriptor.meshId ?? null,
    sectionName: descriptor.sectionName ?? null,
    resolvedPrimPath: descriptor.resolvedPrimPath ?? null,
    primType: descriptor.primType ?? null,
    materialId: descriptor.materialId ?? descriptor.geometry?.materialId ?? null,
  };
}

export function createUsdMeshDescriptorRefs(
  group: DescriptorGroup | null | undefined,
): UrdfUsdMeshDescriptorRef[] | undefined {
  const refs = group?.entries
    .map(({ descriptor }) => createUsdMeshDescriptorRef(descriptor))
    .filter((descriptor) => descriptor.meshId || descriptor.resolvedPrimPath);
  return refs && refs.length > 0 ? refs : undefined;
}

export function attachUsdMeshDescriptorRefs<T extends UrdfVisual>(
  geometry: T,
  group: DescriptorGroup | null | undefined,
): T {
  const refs = createUsdMeshDescriptorRefs(group);
  if (!refs) {
    return geometry;
  }
  return {
    ...geometry,
    usdMeshDescriptors: refs,
  };
}

export function isUsdMeshLikeDescriptor(descriptor: MeshDescriptor): boolean {
  if (getUsdDescriptorPrimitiveType(descriptor)) {
    return false;
  }

  const primType = String(descriptor.primType || '').trim().toLowerCase();
  if (primType === 'mesh') {
    return true;
  }

  return Boolean(
    descriptor.ranges?.positions ||
      descriptor.ranges?.indices ||
      descriptor.geometry?.topologyMode,
  );
}

export function normalizeDescriptorSectionName(sectionName: string | null | undefined): string {
  const normalized = String(sectionName || '')
    .trim()
    .toLowerCase();
  if (normalized === 'visual') return 'visuals';
  if (normalized === 'collision' || normalized === 'collider' || normalized === 'colliders') {
    return 'collisions';
  }
  return normalized;
}

export interface UsdDescriptorRoles {
  visual: boolean;
  collision: boolean;
}

const USD_COLLISION_SCOPE_NAMES = new Set([
  'collision',
  'collisions',
  'collider',
  'colliders',
]);

function descriptorUsesAuthoredCollisionScope(descriptor: MeshDescriptor): boolean {
  return normalizeUsdPath(descriptor.resolvedPrimPath || '')
    .split('/')
    .filter(Boolean)
    .some((segment) => USD_COLLISION_SCOPE_NAMES.has(segment.toLowerCase()));
}

/**
 * Resolve render roles without assuming visual and collision are mutually exclusive.
 * OpenUSD commonly applies PhysicsCollisionAPI directly to a visible Mesh instead of
 * duplicating it below a named `collisions` scope.
 */
export function createUsdDescriptorRoleResolver(
  snapshot: RobotSceneSnapshot | null | undefined,
): (descriptor: MeshDescriptor) => UsdDescriptorRoles {
  const collisionStateByPrimPath = new Map(
    Array.from(snapshot?.stage?.primDescriptors || [])
      .filter((descriptor) => typeof descriptor.collisionEnabled === 'boolean')
      .map((descriptor) => [
        normalizeUsdPath(descriptor.path),
        descriptor.collisionEnabled === true,
      ] as const)
      .filter(([path]) => Boolean(path)),
  );

  const sourceDeclaresCollision = (descriptor: MeshDescriptor): boolean => {
    let primPath = normalizeUsdPath(descriptor.resolvedPrimPath || descriptor.meshId || '');
    while (primPath) {
      const collisionEnabled = collisionStateByPrimPath.get(primPath);
      if (collisionEnabled !== undefined) return collisionEnabled;
      const slashIndex = primPath.lastIndexOf('/');
      if (slashIndex <= 0) break;
      primPath = primPath.slice(0, slashIndex);
    }
    return false;
  };

  return (descriptor) => {
    const sectionName = normalizeDescriptorSectionName(descriptor.sectionName);
    const collisionSection = sectionName === 'collisions';
    // Some native USD render snapshots place every renderable primitive in the
    // synthetic `visuals` descriptor section, including authored primitives
    // below a `Collisions` scope. Treat those primitives as collision-only.
    // A visible mesh with PhysicsCollisionAPI applied directly remains both a
    // visual and a collision because it does not live below such a scope.
    const authoredCollisionScope = descriptorUsesAuthoredCollisionScope(descriptor);
    return {
      visual: !collisionSection && !authoredCollisionScope,
      collision:
        collisionSection || authoredCollisionScope || sourceDeclaresCollision(descriptor),
    };
  };
}

function getDescriptorMaterialId(descriptor: MeshDescriptor): string {
  return normalizeUsdPath(descriptor.materialId || descriptor.geometry?.materialId || '');
}

function getDescriptorGeomSubsetSections(
  descriptor: MeshDescriptor,
): DescriptorGeomSubsetSection[] {
  const rawSections = Array.isArray(descriptor.geometry?.geomSubsetSections)
    ? descriptor.geometry.geomSubsetSections
    : [];

  return rawSections
    .map((section) => {
      const start = Number(section?.start);
      const length = Number(section?.length);
      if (!Number.isFinite(start) || !Number.isFinite(length) || length <= 0) {
        return null;
      }

      return {
        start: Math.max(0, Math.floor(start)),
        length: Math.max(0, Math.floor(length)),
        materialId: normalizeUsdPath(section?.materialId || '') || null,
      } satisfies DescriptorGeomSubsetSection;
    })
    .filter((section): section is DescriptorGeomSubsetSection => Boolean(section));
}

function getResolvedDescriptorMaterialRecords(
  descriptor: MeshDescriptor,
  materialLookup: Map<string, MaterialRecord>,
): ResolvedDescriptorMaterialRecord[] {
  const resolvedMaterials: ResolvedDescriptorMaterialRecord[] = [];
  const seenKeys = new Set<string>();

  const pushResolvedMaterial = (materialId: string | null, material: MaterialRecord | null) => {
    if (!material) {
      return;
    }

    const authoredMaterial = resolveSnapshotAuthoredMaterial(material, materialId);
    if (!authoredMaterial) {
      return;
    }

    const dedupeKey =
      materialId ||
      JSON.stringify({
        name: authoredMaterial.name || '',
        color: authoredMaterial.color || '',
        texture: authoredMaterial.texture || '',
        opacity: authoredMaterial.opacity ?? null,
        roughness: authoredMaterial.roughness ?? null,
        metalness: authoredMaterial.metalness ?? null,
        emissive: authoredMaterial.emissive || '',
        emissiveIntensity: authoredMaterial.emissiveIntensity ?? null,
      });
    if (seenKeys.has(dedupeKey)) {
      return;
    }

    seenKeys.add(dedupeKey);
    resolvedMaterials.push({
      materialId,
      material,
      authoredMaterial,
    });
  };

  getDescriptorGeomSubsetSections(descriptor).forEach((section) => {
    if (!section.materialId) {
      return;
    }

    pushResolvedMaterial(section.materialId, materialLookup.get(section.materialId) || null);
  });

  const directMaterialId = getDescriptorMaterialId(descriptor);
  if (directMaterialId) {
    pushResolvedMaterial(directMaterialId, materialLookup.get(directMaterialId) || null);
  }

  return resolvedMaterials;
}

export function applyVisualGroupMaterialsToLink(
  link: UrdfLink,
  linkId: string,
  group: DescriptorGroup | null | undefined,
  materialLookup: Map<string, MaterialRecord>,
  materials: NonNullable<RobotData['materials']>,
): void {
  if (!group) {
    return;
  }

  const resolvedMaterials: ResolvedDescriptorMaterialRecord[] = [];
  const seenKeys = new Set<string>();
  group.entries.forEach(({ descriptor }) => {
    getResolvedDescriptorMaterialRecords(descriptor, materialLookup).forEach((resolvedMaterial) => {
      const dedupeKey =
        resolvedMaterial.materialId ||
        JSON.stringify({
          name: resolvedMaterial.authoredMaterial.name || '',
          color: resolvedMaterial.authoredMaterial.color || '',
          texture: resolvedMaterial.authoredMaterial.texture || '',
          opacity: resolvedMaterial.authoredMaterial.opacity ?? null,
          roughness: resolvedMaterial.authoredMaterial.roughness ?? null,
          metalness: resolvedMaterial.authoredMaterial.metalness ?? null,
          emissive: resolvedMaterial.authoredMaterial.emissive || '',
          emissiveIntensity: resolvedMaterial.authoredMaterial.emissiveIntensity ?? null,
        });
      if (seenKeys.has(dedupeKey)) {
        return;
      }

      seenKeys.add(dedupeKey);
      resolvedMaterials.push(resolvedMaterial);
    });
  });
  if (resolvedMaterials.length === 0) {
    return;
  }

  if (resolvedMaterials.length > 1) {
    link.visual = {
      ...link.visual,
      color: link.visual.color,
      authoredMaterials: resolvedMaterials.map(({ authoredMaterial }) => ({ ...authoredMaterial })),
      materialSource: 'named',
    };
    delete materials[linkId];
    return;
  }

  const [resolvedMaterial] = resolvedMaterials;
  const color = resolvedMaterial?.authoredMaterial.color;
  const texture = resolvedMaterial?.authoredMaterial.texture;
  const hasUsdMaterial = hasMaterialRecordContent(resolvedMaterial?.material);

  link.visual = {
    ...link.visual,
    ...(color && (link.visual.color === DEFAULT_LINK.visual.color || !link.visual.color)
      ? { color }
      : {}),
    materialSource: 'named',
  };
  delete link.visual.authoredMaterials;

  if (!color && !texture && !hasUsdMaterial) {
    delete materials[linkId];
    return;
  }

  materials[linkId] = {
    ...(color ? { color } : {}),
    ...(texture ? { texture } : {}),
    ...(hasUsdMaterial ? { usdMaterial: structuredClone(resolvedMaterial.material) } : {}),
  };
}

export function getSnapshotMaterialLookup(
  snapshot: RobotSceneSnapshot,
): Map<string, MaterialRecord> {
  const lookup = new Map<string, MaterialRecord>();
  const materials = Array.from(snapshot.render?.materials || []);

  materials.forEach((material) => {
    const keys = [
      normalizeUsdPath(material.materialId || ''),
      normalizeUsdPath(material.name || ''),
    ].filter(Boolean);

    keys.forEach((key) => {
      if (!lookup.has(key)) {
        lookup.set(key, material);
      }
    });
  });

  return lookup;
}

function isGenericDescriptorName(value: string | null | undefined): boolean {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (!raw) return true;
  return (
    /^mesh(?:[_-]?\d+)?$/.test(raw) ||
    /^geom(?:[_-]?\d+)?$/.test(raw) ||
    /^proto(?:[_-].*)?$/.test(raw)
  );
}

export function getDescriptorSemanticName(descriptor: MeshDescriptor): string {
  const semanticChildLinkName = getUsdDescriptorSemanticChildLinkName(descriptor);
  if (semanticChildLinkName) {
    return semanticChildLinkName;
  }

  const candidates = [
    getPathBasename(descriptor.resolvedPrimPath),
    getPathBasename(descriptor.meshId),
  ];

  for (const candidate of candidates) {
    if (!candidate || isGenericDescriptorName(candidate)) {
      continue;
    }
    return candidate;
  }

  return '';
}

export function parseDescriptorOrdinal(descriptor: MeshDescriptor, fallbackIndex: number): number {
  const meshId = String(descriptor.meshId || '');
  const match = meshId.match(/(?:\.proto_(?:mesh|[a-z]+)_id)(\d+)$/i);
  if (match) {
    const numeric = Number(match[1]);
    if (Number.isInteger(numeric) && numeric >= 0) {
      return numeric;
    }
  }

  return fallbackIndex;
}

export function getUsdDescriptorAttachmentGroupKey(
  descriptor: MeshDescriptor,
  options: { fallbackToResolvedPrimPath?: boolean } = {},
): string {
  return (
    getUsdDescriptorSectionChildToken(descriptor) ||
    (options.fallbackToResolvedPrimPath
      ? normalizeUsdPath(descriptor.resolvedPrimPath) || normalizeUsdPath(descriptor.meshId)
      : '') ||
    '__default__'
  );
}

export function groupDescriptorEntries(entries: DescriptorEntry[]): DescriptorGroup[] {
  const groups = new Map<string, DescriptorEntry[]>();

  entries.forEach((entry) => {
    const bucket = groups.get(entry.groupKey) || [];
    bucket.push(entry);
    groups.set(entry.groupKey, bucket);
  });

  return Array.from(groups.entries())
    .map(([groupKey, groupedEntries]) => ({
      groupKey,
      entries: groupedEntries.slice().sort((left, right) => left.ordinal - right.ordinal),
    }))
    .sort((left, right) => {
      const leftOrdinal = left.entries[0]?.ordinal ?? 0;
      const rightOrdinal = right.entries[0]?.ordinal ?? 0;
      return leftOrdinal - rightOrdinal;
    });
}

function cloneMeshCountsEntry(entry: MeshCountsEntry | null | undefined): MeshCountsEntry {
  return {
    visualMeshCount: Number(entry?.visualMeshCount || 0),
    collisionMeshCount: Number(entry?.collisionMeshCount || 0),
    collisionPrimitiveCounts: {
      ...(entry?.collisionPrimitiveCounts || {}),
    },
  };
}

export function deriveMeshCountsByLinkPath(
  snapshot: RobotSceneSnapshot,
  knownLinkPaths: Iterable<string | null | undefined>,
): Record<string, MeshCountsEntry> {
  const existing = snapshot.robotMetadataSnapshot?.meshCountsByLinkPath;
  const descriptors = Array.from(snapshot.render?.meshDescriptors || []);
  if (descriptors.length === 0) {
    return existing || {};
  }

  const derivedGroupsByLinkPath = new Map<
    string,
    {
      visualGroups: Set<string>;
      collisionGroupPrimitiveTypes: Map<string, string>;
    }
  >();
  const normalizedKnownLinkPaths = buildNormalizedUsdPathSet(knownLinkPaths);
  const resolveRoles = createUsdDescriptorRoleResolver(snapshot);

  const ensureEntry = (linkPath: string) => {
    let entry = derivedGroupsByLinkPath.get(linkPath);
    if (!entry) {
      entry = {
        visualGroups: new Set<string>(),
        collisionGroupPrimitiveTypes: new Map<string, string>(),
      };
      derivedGroupsByLinkPath.set(linkPath, entry);
    }
    return entry;
  };

  for (const descriptor of descriptors) {
    const linkPath = resolveUsdDescriptorTargetLinkPath({
      descriptor,
      knownLinkPaths: normalizedKnownLinkPaths,
    });
    if (!linkPath) continue;

    const entry = ensureEntry(linkPath);
    const roles = resolveRoles(descriptor);
    const groupKey = getUsdDescriptorAttachmentGroupKey(descriptor);
    if (roles.collision) {
      if (!entry.collisionGroupPrimitiveTypes.has(groupKey)) {
        const primitiveType =
          String(descriptor.primType || '')
            .trim()
            .toLowerCase() || 'mesh';
        entry.collisionGroupPrimitiveTypes.set(groupKey, primitiveType);
      }
    }

    if (roles.visual) {
      entry.visualGroups.add(groupKey);
    }
  }

  const derived = Object.fromEntries(
    Array.from(derivedGroupsByLinkPath.entries()).map(([linkPath, entry]) => {
      const collisionPrimitiveCounts: Record<string, number> = {};
      entry.collisionGroupPrimitiveTypes.forEach((primitiveType) => {
        collisionPrimitiveCounts[primitiveType] =
          Number(collisionPrimitiveCounts[primitiveType] || 0) + 1;
      });

      return [
        linkPath,
        {
          visualMeshCount: entry.visualGroups.size,
          collisionMeshCount: entry.collisionGroupPrimitiveTypes.size,
          collisionPrimitiveCounts,
        } satisfies MeshCountsEntry,
      ];
    }),
  ) as Record<string, MeshCountsEntry>;

  if (!existing || Object.keys(existing).length === 0) {
    return derived;
  }

  const result: Record<string, MeshCountsEntry> = {};
  const allLinkPaths = new Set([...Object.keys(existing), ...Object.keys(derived)]);

  allLinkPaths.forEach((linkPath) => {
    const existingEntry = cloneMeshCountsEntry(existing[linkPath]);
    const derivedEntry = cloneMeshCountsEntry(derived[linkPath]);
    const mergedEntry: MeshCountsEntry = {
      visualMeshCount:
        (derivedEntry.visualMeshCount ?? 0) > 0
          ? (derivedEntry.visualMeshCount ?? 0)
          : (existingEntry.visualMeshCount ?? 0),
      collisionMeshCount:
        (derivedEntry.collisionMeshCount ?? 0) > 0
          ? (derivedEntry.collisionMeshCount ?? 0)
          : (existingEntry.collisionMeshCount ?? 0),
      collisionPrimitiveCounts:
        Object.keys(derivedEntry.collisionPrimitiveCounts || {}).length > 0
          ? derivedEntry.collisionPrimitiveCounts
          : existingEntry.collisionPrimitiveCounts,
    };

    if ((mergedEntry.visualMeshCount ?? 0) > 0 || (mergedEntry.collisionMeshCount ?? 0) > 0) {
      result[linkPath] = mergedEntry;
    }
  });

  return result;
}
