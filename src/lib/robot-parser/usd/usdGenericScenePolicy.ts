import type { UsdSceneSnapshot } from '@/types';

function normalizeUsdPath(path: string | null | undefined): string {
  const normalized = String(path || '')
    .trim()
    .replace(/[<>]/g, '')
    .replace(/\\/g, '/');
  if (!normalized) {
    return '';
  }
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

export function isUsdGenericSceneSnapshot(
  snapshot: UsdSceneSnapshot | null | undefined,
): boolean {
  const metadata = snapshot?.robotMetadataSnapshot;
  const metadataSource = String(metadata?.source || '').trim().toLowerCase();
  const hasSemanticLinkHierarchy =
    metadataSource !== 'mesh-only' &&
    (Array.from(metadata?.linkParentPairs || []).length > 0 ||
      Array.from(snapshot?.robotTree?.linkParentPairs || []).length > 0);
  const hasAuthoredRobotTopology =
    Array.from(metadata?.jointCatalogEntries || []).length > 0 ||
    Array.from(snapshot?.robotTree?.jointCatalogEntries || []).length > 0 ||
    hasSemanticLinkHierarchy;
  if (hasAuthoredRobotTopology) {
    return false;
  }

  const defaultPrimPath = normalizeUsdPath(snapshot?.stage?.defaultPrimPath);
  if (!defaultPrimPath) {
    return false;
  }

  const genericVisualPrefix = `${defaultPrimPath}/visuals.proto_`;
  return Array.from(snapshot?.render?.meshDescriptors || []).some((descriptor) =>
    normalizeUsdPath(descriptor.meshId).startsWith(genericVisualPrefix),
  );
}

export const shouldAutoFrameUsdGenericSceneSnapshot = isUsdGenericSceneSnapshot;
