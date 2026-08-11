import { toVirtualUsdPath } from '@/lib/robot-parser/usd/usdPreloadSources';
import { inferUsdDescriptorOwningLinkPath } from '@/lib/robot-parser/usd/usdDescriptorLinkResolution';

import type { DescriptorRole, SnapshotMeshDescriptor } from './internalTypes.ts';

export function normalizeUsdPath(path: string | null | undefined): string {
  const normalized = String(path || '')
    .trim()
    .replace(/[<>]/g, '')
    .replace(/\\/g, '/');
  if (!normalized) return '';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

export function getPathBasename(path: string | null | undefined): string {
  const normalized = normalizeUsdPath(path);
  if (!normalized) return '';
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] || '';
}

export function sanitizeFileToken(value: string): string {
  const normalized = String(value || '')
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'mesh';
}

export function buildUsdSnapshotLookupPaths(stageSourcePath?: string | null): Array<string | null> {
  const rawStagePath = String(stageSourcePath || '')
    .trim()
    .split('?')[0];
  if (!rawStagePath) {
    return [null];
  }

  const normalizedStagePath = rawStagePath.startsWith('/')
    ? rawStagePath
    : toVirtualUsdPath(rawStagePath);

  return normalizedStagePath === rawStagePath
    ? [normalizedStagePath]
    : [normalizedStagePath, rawStagePath];
}

export function normalizeSemanticToken(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .split('_')
    .filter(
      (token) =>
        token.length > 0 &&
        ![
          'link',
          'joint',
          'visual',
          'visuals',
          'collision',
          'collisions',
          'mesh',
          'geom',
          'geometry',
          'proto',
          'id',
          'usd',
          'xform',
          'body',
        ].includes(token),
    )
    .join('_');
}

export function isGenericDescriptorName(value: string | null | undefined): boolean {
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

export function getDescriptorSemanticName(descriptor: SnapshotMeshDescriptor): string {
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

  return inferUsdDescriptorOwningLinkPath(descriptor);
}

export function getDescriptorLinkPath(descriptor: SnapshotMeshDescriptor): string {
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
  }

  return inferUsdDescriptorOwningLinkPath(descriptor);
}

export function getDescriptorRole(descriptor: SnapshotMeshDescriptor): DescriptorRole {
  const sectionName = String(descriptor.sectionName || '')
    .trim()
    .toLowerCase();
  if (sectionName === 'collisions' || sectionName === 'collision') {
    return 'collision';
  }

  const candidateText =
    `${descriptor.meshId || ''} ${descriptor.resolvedPrimPath || ''}`.toLowerCase();
  return /\/coll(?:isions?|iders?)(?:$|[/.])/.test(candidateText) ? 'collision' : 'visual';
}

export function parseDescriptorOrdinal(
  descriptor: SnapshotMeshDescriptor,
  fallbackIndex: number,
): number {
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
