import type { UsdJointCatalogEntry, UsdSceneSnapshot } from '@/types';
import type { ViewerRobotDataResolution } from './viewerRobotData';

function normalizeUsdPath(path: string | null | undefined): string {
  const normalized = String(path || '')
    .trim()
    .replace(/[<>]/g, '')
    .replace(/\\/g, '/');
  if (!normalized) return '';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function getJointCatalogEntries(snapshot: UsdSceneSnapshot): UsdJointCatalogEntry[] {
  return Array.from(
    snapshot.robotMetadataSnapshot?.jointCatalogEntries ||
      snapshot.robotTree?.jointCatalogEntries ||
      [],
  );
}

/** Reject corrupt articulated metadata without rejecting valid mesh-only USD scenes. */
export function assertUsdSceneSnapshotIntegrity(
  snapshot: UsdSceneSnapshot,
  resolution: ViewerRobotDataResolution,
): void {
  const metadata = snapshot.robotMetadataSnapshot;
  const errorFlags = Array.from(metadata?.errorFlags || []).filter((flag) => String(flag).trim());
  const truthLoadError = String(metadata?.truthLoadError || '').trim();
  if (metadata?.stale || errorFlags.length > 0 || truthLoadError) {
    const details = [
      metadata?.stale ? 'stale metadata' : '',
      ...errorFlags.map(String),
      truthLoadError,
    ].filter(Boolean);
    throw new Error(`USD scene metadata is invalid: ${details.join(', ')}`);
  }

  const catalogEntries = getJointCatalogEntries(snapshot);
  if (catalogEntries.length === 0) return;

  const missingTopology = catalogEntries.find((entry) => {
    const childPath = normalizeUsdPath(entry.linkPath || entry.childLinkPath);
    const parentPath = normalizeUsdPath(entry.parentLinkPath);
    return (
      !childPath ||
      !parentPath ||
      !resolution.linkIdByPath[childPath] ||
      !resolution.linkIdByPath[parentPath]
    );
  });
  if (
    missingTopology ||
    Object.keys(resolution.robotData.joints).length < catalogEntries.length
  ) {
    throw new Error('USD articulated metadata is incomplete; refusing a fixed-scene fallback');
  }
}
