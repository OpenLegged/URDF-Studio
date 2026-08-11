import type { UsdSceneMeshDescriptor } from '@/types';

const GENERIC_SEMANTIC_CHILD_PRIM_NAMES = new Set([
  'mesh',
  'visual_mesh',
  'collision_mesh',
  'cube',
  'sphere',
  'cylinder',
  'capsule',
  'scene',
  'root',
]);

const GENERIC_SEMANTIC_CHILD_PRIM_PATTERNS = [
  /^mesh_\d+$/i,
  /^visual_\d+$/i,
  /^collision_\d+$/i,
  /^group(?:_\d+)?$/i,
  /^xform(?:_\d+)?$/i,
];

function normalizeUsdPath(path: string | null | undefined): string {
  const normalized = String(path || '')
    .trim()
    .replace(/[<>]/g, '')
    .replace(/\\/g, '/');
  if (!normalized) return '';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function normalizeSectionName(sectionName: string | null | undefined): string {
  const normalized = String(sectionName || '')
    .trim()
    .toLowerCase();
  if (normalized === 'visual') return 'visuals';
  if (normalized === 'collider' || normalized === 'colliders') return 'collisions';
  if (normalized === 'collision') return 'collisions';
  return normalized;
}

function getPathParent(path: string | null | undefined): string {
  const normalized = normalizeUsdPath(path);
  if (!normalized) return '';

  const segments = normalized.split('/').filter(Boolean);
  if (segments.length <= 1) {
    return '';
  }

  return `/${segments.slice(0, -1).join('/')}`;
}

export function buildNormalizedUsdPathSet(paths: Iterable<string | null | undefined>): Set<string> {
  const normalized = new Set<string>();
  Array.from(paths).forEach((path) => {
    const value = normalizeUsdPath(path);
    if (value) {
      normalized.add(value);
    }
  });
  return normalized;
}

export function inferUsdDescriptorOwningLinkPath(
  descriptor: Pick<UsdSceneMeshDescriptor, 'meshId' | 'resolvedPrimPath' | 'primType'>,
): string {
  const meshId = normalizeUsdPath(descriptor.meshId || '');
  if (meshId) {
    const markerIndex = meshId.indexOf('.proto_');
    if (markerIndex > 0) {
      let linkPath = meshId.slice(0, markerIndex);
      if (
        linkPath.endsWith('/visuals') ||
        linkPath.endsWith('/collisions') ||
        linkPath.endsWith('/colliders')
      ) {
        const parentSlash = linkPath.lastIndexOf('/');
        if (parentSlash > 0) {
          linkPath = linkPath.slice(0, parentSlash);
        }
      }
      if (linkPath) {
        return linkPath;
      }
    }
  }

  const candidates = [descriptor.resolvedPrimPath, descriptor.meshId];
  for (const candidate of candidates) {
    const normalized = normalizeUsdPath(candidate || '');
    if (!normalized) continue;

    const authoredPathMatch = normalized.match(
      /^(.*?)(?:\/(?:visuals?|coll(?:isions?|iders?)))(?:$|[/.])/i,
    );
    if (authoredPathMatch?.[1]) {
      return normalizeUsdPath(authoredPathMatch[1]);
    }

    if (candidate === descriptor.resolvedPrimPath) {
      const normalizedMeshId = normalizeUsdPath(descriptor.meshId || '');
      if (
        normalizedMeshId &&
        normalizedMeshId !== normalized &&
        normalizedMeshId.startsWith(`${normalized}/`)
      ) {
        return normalized;
      }

      const primType = String(descriptor.primType || '')
        .trim()
        .toLowerCase();
      const resolvedPrimParent = getPathParent(normalized);
      if (primType === 'mesh' && resolvedPrimParent) {
        return resolvedPrimParent;
      }

      return normalized;
    }
  }

  if (meshId) {
    const meshPathSegments = meshId.split('/').filter(Boolean);
    if (meshPathSegments.length > 1) {
      return `/${meshPathSegments.slice(0, -1).join('/')}`;
    }
  }

  return '';
}

export function getUsdDescriptorSemanticChildLinkName(
  descriptor: Pick<UsdSceneMeshDescriptor, 'meshId' | 'resolvedPrimPath' | 'sectionName'>,
): string {
  const candidateLinkName = getUsdDescriptorSectionChildToken(descriptor);
  if (
    !candidateLinkName ||
    GENERIC_SEMANTIC_CHILD_PRIM_NAMES.has(candidateLinkName.toLowerCase()) ||
    GENERIC_SEMANTIC_CHILD_PRIM_PATTERNS.some((pattern) => pattern.test(candidateLinkName))
  ) {
    return '';
  }

  return candidateLinkName;
}

export function getUsdDescriptorSectionChildToken(
  descriptor: Pick<UsdSceneMeshDescriptor, 'meshId' | 'resolvedPrimPath' | 'sectionName'>,
): string {
  const normalizedResolvedPrimPath = normalizeUsdPath(descriptor.resolvedPrimPath || '');
  const normalizedSectionName = normalizeSectionName(descriptor.sectionName);
  if (
    !normalizedResolvedPrimPath ||
    (normalizedSectionName !== 'visuals' && normalizedSectionName !== 'collisions')
  ) {
    return '';
  }

  const resolvedSegments = normalizedResolvedPrimPath.split('/').filter(Boolean);
  if (resolvedSegments.length === 0) {
    return '';
  }

  const sectionIndex = resolvedSegments.findIndex(
    (segment) => String(segment || '').toLowerCase() === normalizedSectionName,
  );
  if (sectionIndex < 0 || sectionIndex + 1 >= resolvedSegments.length) {
    return '';
  }

  const normalizedMeshId = normalizeUsdPath(descriptor.meshId || '');
  if (normalizedMeshId) {
    const descriptorOwningLinkPath = inferUsdDescriptorOwningLinkPath(descriptor);
    const authoredSectionOwnerPath = `/${resolvedSegments.slice(0, sectionIndex).join('/')}`;
    if (
      descriptorOwningLinkPath
      && normalizeUsdPath(descriptorOwningLinkPath) !== normalizeUsdPath(authoredSectionOwnerPath)
    ) {
      return '';
    }
  }

  const candidateLinkName = String(resolvedSegments[sectionIndex + 1] || '').trim();
  return candidateLinkName;
}

export function resolveUsdDescriptorTargetLinkPath({
  descriptor,
  knownLinkPaths,
}: {
  descriptor: Pick<
    UsdSceneMeshDescriptor,
    'meshId' | 'resolvedPrimPath' | 'sectionName' | 'primType'
  >;
  knownLinkPaths?: Iterable<string | null | undefined>;
}): string {
  const owningLinkPath = inferUsdDescriptorOwningLinkPath(descriptor);
  if (!owningLinkPath) {
    return '';
  }

  const normalizedKnownLinkPaths = buildNormalizedUsdPathSet(knownLinkPaths || []);
  if (normalizedKnownLinkPaths.size === 0) {
    return owningLinkPath;
  }

  const semanticChildLinkName = getUsdDescriptorSemanticChildLinkName(descriptor);
  if (!semanticChildLinkName) {
    return owningLinkPath;
  }

  const parentSlashIndex = owningLinkPath.lastIndexOf('/');
  const owningLinkParentPath =
    parentSlashIndex > 0 ? owningLinkPath.slice(0, parentSlashIndex) : '';
  const semanticLinkPath = owningLinkParentPath
    ? `${owningLinkParentPath}/${semanticChildLinkName}`
    : owningLinkPath;

  return normalizedKnownLinkPaths.has(semanticLinkPath) ? semanticLinkPath : owningLinkPath;
}
