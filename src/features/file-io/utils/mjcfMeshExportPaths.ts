import { normalizeMeshPathForExport, resolveImportedAssetPath } from '@/core/parsers/meshPathUtils';

/** Preserve source directories only when the usual export paths would collide. */
export function buildMjcfMeshExportPathOverrides(meshPaths: ReadonlySet<string>): Map<string, string> {
  const pathsByTarget = new Map<string, string[]>();
  for (const path of meshPaths) {
    const target = normalizeMeshPathForExport(path).toLowerCase();
    const group = pathsByTarget.get(target) ?? [];
    group.push(path);
    pathsByTarget.set(target, group);
  }
  const overrides = new Map<string, string>();
  const usedTargets = new Set([...pathsByTarget].filter(([, paths]) => paths.length === 1).map(([target]) => target));
  for (const paths of pathsByTarget.values()) {
    if (paths.length < 2) continue;
    for (const path of [...paths].sort()) {
      const base = resolveImportedAssetPath(path).replace(/^[a-z]+:\/\//i, '').replace(/^\/+/, '');
      let target = base;
      let index = 2;
      while (usedTargets.has(target.toLowerCase())) {
        target = base.replace(/(\.[^./]+)?$/, `_${index++}$1`);
      }
      usedTargets.add(target.toLowerCase());
      overrides.set(path, target);
    }
  }
  return overrides;
}
