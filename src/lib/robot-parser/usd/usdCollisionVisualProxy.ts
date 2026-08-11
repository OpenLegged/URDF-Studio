import type { UsdSceneSnapshot } from '@/types';

function normalizeDescriptorSectionName(sectionName: string | null | undefined): string {
  const normalized = String(sectionName || '')
    .trim()
    .toLowerCase();
  if (normalized === 'visual') return 'visuals';
  if (normalized === 'collision' || normalized === 'collider' || normalized === 'colliders') {
    return 'collisions';
  }
  return normalized;
}

export function shouldUseUsdCollisionVisualProxy(
  snapshot: UsdSceneSnapshot | null | undefined,
): boolean {
  const descriptors = Array.from(snapshot?.render?.meshDescriptors || []);
  let visualDescriptorCount = 0;
  let collisionDescriptorCount = 0;

  descriptors.forEach((descriptor) => {
    const sectionName = normalizeDescriptorSectionName(descriptor.sectionName);
    if (sectionName === 'collisions') {
      collisionDescriptorCount += 1;
      return;
    }

    if (sectionName === 'visuals') {
      visualDescriptorCount += 1;
    }
  });

  const meshCountsByLinkPath = snapshot?.robotMetadataSnapshot?.meshCountsByLinkPath || {};
  let visualMeshCount = 0;
  let collisionMeshCount = 0;
  Object.values(meshCountsByLinkPath).forEach((entry) => {
    visualMeshCount += Number(entry?.visualMeshCount || 0);
    collisionMeshCount += Number(entry?.collisionMeshCount || 0);
  });

  const hasVisualEvidence = visualDescriptorCount > 0 || visualMeshCount > 0;
  const hasCollisionEvidence = collisionDescriptorCount > 0 || collisionMeshCount > 0;
  return hasCollisionEvidence && !hasVisualEvidence;
}
