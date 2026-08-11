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
