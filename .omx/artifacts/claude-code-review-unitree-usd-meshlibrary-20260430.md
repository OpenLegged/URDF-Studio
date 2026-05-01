I'll review this focused URDF Studio patch across the three scopes you specified.

## Code Review Findings

### **BLOCKING ISSUE**: Material binding aliasing bug in `shared-basic.js`

**Severity: High**  
**File: `src/features/urdf-viewer/runtime/hydra/render-delegate/shared-basic.js:903-909`**

```javascript
Array.from(materialBindingsByPrimPath.entries()).forEach(([primPath, entry]) => {
    const referenceTargets = referenceTargetsByPrimPath.get(primPath) || [];
    referenceTargets.forEach((referenceTarget) => {
        mergeBindingEntry(referenceTarget, entry);
    });
});
```

The current implementation copies the **entire** binding entry when aliasing to referenced targets. This causes a **regression** when a MeshLibrary mesh has its own direct `material:binding` that differs from the referencing mesh's GeomSubset bindings.

Consider this scenario:
```usda
def Mesh "Geometry_6" (
    prepend material:binding = </go2_description/Looks/Material_X>  # MeshLibrary's own binding
)
{
}

def Mesh "mesh" (
    prepend references = </go2_description/__MeshLibrary/Geometry_6>  # References MeshLibrary
)
{
    def GeomSubset "subset_0" (
        ...
        rel material:binding = </go2_description/Looks/Material_Y>  # Different binding
    )
}
```

After aliasing:
- `/go2_description/__MeshLibrary/Geometry_6` entry will be **overwritten** with the mesh's GeomSubset-only entry (`materialId: null`)
- The MeshLibrary's original `materialId: Material_X` is **lost**

**Fix**: Only alias the `geomSubsetSections`, not the top-level `materialId`:

```javascript
Array.from(materialBindingsByPrimPath.entries()).forEach(([primPath, entry]) => {
    const referenceTargets = referenceTargetsByPrimPath.get(primPath) || [];
    if (entry.geomSubsetSections?.length > 0) {
        referenceTargets.forEach((referenceTarget) => {
            const existing = materialBindingsByPrimPath.get(referenceTarget);
            if (existing) {
                // Only merge GeomSubset sections; preserve any existing direct material binding
                existing.geomSubsetSections.push(...entry.geomSubsetSections);
            } else {
                // No existing entry - create one with GeomSubset only (no top-level materialId)
                materialBindingsByPrimPath.set(referenceTarget, {
                    materialId: null,
                    geomSubsetSections: [...entry.geomSubsetSections],
                });
            }
        });
    }
});
```

---

### **MEDIUM**: Missing cleanup in `HydraMesh.js` for stale material properties

**Severity: Medium**  
**File: `src/features/urdf-viewer/runtime/hydra/render-delegate/HydraMesh.js:145-148`**

```javascript
for (const material of this._getAssignedMaterials()) {
    if (material && material.side !== side) {
        material.side = side;
        material.needsUpdate = true;
    }
}
```

The `material.needsUpdate = true` is correct, but consider materials that are **replaced** via `setMaterial()` - if the old material had customized properties (e.g., custom depth test, blending), those should be reset when assigning the new material. Current implementation silently inherits whatever state the new material has.

This isn't a regression from this patch but is a potential edge case: if materials are swapped in/out, properties like `side` need to be re-applied. The new `_applySurfaceState()` calls help with this, but `setDoubleSided` only sets `side` - what about `transparent`, `depthWrite`, `opacity`, etc. that `_applySurfaceState` might manage?

**Recommendation**: After `setMaterial`, consider calling a broader state reapplication method or explicitly document which properties are persisted vs reset.

---

### **LOW**: Test coverage gap for multi-reference material binding conflicts

**Severity: Low**  
**File: `src/features/urdf-viewer/runtime/hydra/render-delegate/roundtrip-export-parsing.test.js`**

The new test covers the happy case where a single mesh references a MeshLibrary. Missing test coverage:

1. **Multiple meshes referencing the same MeshLibrary** with different GeomSubset bindings
2. **MeshLibrary with its own direct `material:binding`** that should be preserved
3. **Direct Mesh reference** (not through GeomSubset) to a MeshLibrary entry

Consider adding:
```javascript
test('handles multiple meshes referencing the same MeshLibrary with different bindings', () => {
    // Mesh1 references Geometry_6 with Material_A
    // Mesh2 references Geometry_6 with Material_B  
    // Verify Geometry_6 entry captures this correctly
});
```

---

### **LOW**: `usdViewerRobotAdapter.ts` fallback logic could be more defensive

**Severity: Low**  
**File: `src/features/urdf-viewer/utils/usdViewerRobotAdapter.ts:1409-1415`**

```javascript
if (
  shouldOmitInternalMeshLibraryPaths &&
  effectiveSourceLinkPaths.size === 0 &&
  normalizedDefaultPrimPath
) {
  effectiveSourceLinkPaths.add(normalizedDefaultPrimPath);
}
```

The fallback to `normalizedDefaultPrimPath` when all link paths are filtered out is correct for the Unitree case. However, it should also verify that the default prim actually exists in `linkPaths` (was filtered due to being a MeshLibrary) OR actually exists in the scene. If `normalizedDefaultPrimPath` is unrelated to the filtered paths, it might not be a valid link path.

**Recommendation**: Add a guard:
```javascript
if (
  shouldOmitInternalMeshLibraryPaths &&
  effectiveSourceLinkPaths.size === 0 &&
  normalizedDefaultPrimPath &&
  (linkPaths.has(normalizedDefaultPrimPath) || hasMeshDescriptorAtPath(snapshot, normalizedDefaultPrimPath))
) {
  effectiveSourceLinkPaths.add(normalizedDefaultPrimPath);
}
```

---

## Summary

| Issue | Severity | Scope |
|-------|----------|-------|
| Material binding aliasing copies entire entry, losing MeshLibrary direct bindings | **HIGH** | `shared-basic.js` |
| Material property persistence not clearly defined after replacement | MEDIUM | `HydraMesh.js` |
| Missing test coverage for multi-reference conflicts | LOW | Test coverage |
| Fallback path not validated against scene | LOW | `usdViewerRobotAdapter.ts` |

**The material binding aliasing bug (first issue) is blocking** as it causes correctness regression for MeshLibrary meshes with their own direct material bindings. The other issues are medium/low and could be addressed in follow-up work.

The verification you ran (browser regression, IsaacSim pass) likely passed because the Unitree test data doesn't have MeshLibrary entries with conflicting direct bindings - but the bug would manifest on real-world USD files where MeshLibrary meshes define their own `material:binding`.
