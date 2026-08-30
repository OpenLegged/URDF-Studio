import type {
  UsdSceneMaterialRecord,
  UsdSceneMeshDescriptor,
  UsdSceneSnapshot,
} from '@/types';

function normalizedPath(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .replace(/[<>]/g, '')
    .replace(/\\/g, '/');
}

function materialLookupKeys(record: UsdSceneMaterialRecord): string[] {
  return [record.materialId, record.name]
    .map(normalizedPath)
    .filter(Boolean);
}

function isPhysicsOnlyMaterial(
  descriptor: UsdSceneMeshDescriptor,
  materialsById: ReadonlyMap<string, UsdSceneMaterialRecord>,
): boolean {
  const materialId = normalizedPath(
    descriptor.materialId ?? descriptor.geometry?.materialId ?? null,
  );
  const record = materialsById.get(materialId) ?? null;
  const identity = [materialId, record?.name, record?.materialId]
    .map(normalizedPath)
    .join(' ');
  const names = identity
    .split(/\s+/)
    .map((value) => value.split('/').at(-1) || '')
    .filter(Boolean);
  return names.some((name) => /^PhysicsMaterial(?:_\d+)?$/i.test(name));
}

/**
 * Select the authored render descriptors for each composed Prim.
 *
 * Some native USD bridges expose a visible material binding and a second
 * `material:binding:physics` descriptor for the same Mesh. The latter is
 * simulation metadata, not a gray visual surface. Keeping both produces
 * coincident geometry, z-fighting, selection boxes, and lets PhysicsMaterial
 * cover the authored texture.
 */
export function selectUsdRenderableMeshDescriptors(
  snapshot: Pick<UsdSceneSnapshot, 'render'> | null | undefined,
): UsdSceneMeshDescriptor[] {
  const descriptors = Array.from(snapshot?.render?.meshDescriptors ?? []);
  if (descriptors.length < 2) return descriptors;

  const materialsById = new Map<string, UsdSceneMaterialRecord>();
  Array.from(snapshot?.render?.materials ?? []).forEach((record) => {
    materialLookupKeys(record).forEach((key) => {
      if (!materialsById.has(key)) materialsById.set(key, record);
    });
  });

  const descriptorsByPrimPath = new Map<string, UsdSceneMeshDescriptor[]>();
  descriptors.forEach((descriptor) => {
    const primPath = normalizedPath(descriptor.resolvedPrimPath ?? descriptor.meshId) || '/';
    const entries = descriptorsByPrimPath.get(primPath) ?? [];
    entries.push(descriptor);
    descriptorsByPrimPath.set(primPath, entries);
  });

  const retained = new Set<UsdSceneMeshDescriptor>();
  descriptorsByPrimPath.forEach((entries) => {
    const readyEntries = entries.filter((descriptor) => descriptor.renderReady === true);
    const preferredEntries = readyEntries.length > 0 ? readyEntries : entries;
    const authoredRenderEntries = preferredEntries.filter(
      (descriptor) => !isPhysicsOnlyMaterial(descriptor, materialsById),
    );
    (authoredRenderEntries.length > 0 ? authoredRenderEntries : preferredEntries)
      .forEach((descriptor) => retained.add(descriptor));
  });

  return descriptors.filter((descriptor) => retained.has(descriptor));
}
