// @ts-nocheck
import { normalizeHydraPath } from './shared.js';

function copyFloat32(values) {
    return values && typeof values.length === 'number'
        ? Float32Array.from(values, Number)
        : new Float32Array(0);
}

/** Capture already-tessellated live point/curve Rprims for the persistent scene snapshot. */
export function collectLivePointBasedSnapshotEntries(meshes) {
    const entries = [];
    for (const [rawId, prim] of Object.entries(meshes || {})) {
        const primType = String(prim?._typeId || '').trim().toLowerCase();
        if (primType !== 'points' && primType !== 'basiscurves') continue;

        const object = prim?._mesh;
        const positionAttribute = object?.geometry?.getAttribute?.('position');
        if (!positionAttribute?.array || Number(positionAttribute.count || 0) <= 0) continue;

        const meshId = normalizeHydraPath(rawId || prim?._id || '');
        if (!meshId) continue;
        const transform = copyFloat32(object?.matrix?.elements);
        entries.push({
            meshId,
            resolvedPrimPath: normalizeHydraPath(object?.userData?.usdPrimPath || meshId),
            primType,
            materialId: normalizeHydraPath(prim?._pendingMaterialId || ''),
            positions: copyFloat32(positionAttribute.array),
            transform: transform.length >= 16 ? transform.subarray(0, 16) : new Float32Array(0),
        });
    }
    return entries.sort((left, right) => left.meshId.localeCompare(right.meshId));
}
