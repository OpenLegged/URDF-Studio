## Review Findings

### Summary
All three scopes are correctly implemented. The key question about aliasing preserving direct material bindings is answered correctly in the test.

---

### 1. HydraMesh Material Sidedness Reapplication

**Severity:** ✅ No issues

**File:** `src/features/urdf-viewer/runtime/hydra/render-delegate/HydraMesh.js`

**Changes:**
- Line 148: `material.needsUpdate = true` added after `material.side = side` — ensures Three.js recompiles shaders for sidedness changes
- Lines 2102, 2744: `_applySurfaceState()` calls added after material assignment — reapplies sidedness when `setMaterial` replaces the material

**Test verification:** `HydraMesh.test.ts:59-82` confirms that `setMaterial` preserves `DoubleSide` and increments material version.

---

### 2. MeshLibrary Direct Material Preservation

**Severity:** ✅ No issues - aliasing logic correctly preserves direct bindings

**File:** `src/features/urdf-viewer/runtime/hydra/render-delegate/shared-basic.js`

**Key question verified:** Does `mergeBindingEntry` preserve an existing MeshLibrary `materialId` while adding aliased GeomSubsets?

**Analysis:**
1. `mergeBindingEntry` at line 828-873 only merges `geomSubsetSections` from the source entry
2. The `materialId` field is **not** overwritten when the source entry has `materialId: null`
3. Processing order: Library mesh is parsed first (with direct `materialId`), then the instance is parsed (with GeomSubsets), then aliasing merges GeomSubsets to the library target

**Test verification:** `roundtrip-export-parsing.test.js:283-294` confirms:
```javascript
assert.deepEqual(result.get('/go2_description/__MeshLibrary/Geometry_6'), {
    materialId: '/go2_description/Looks/LibraryDefault',  // ✓ Preserved
    geomSubsetSections: [
        { start: 0, length: 4, materialId: '/go2_description/Looks/Material_6' },  // ✓ Aliased
    ],
});
```

The `normalizeRobotSceneSnapshot` test (lines 296-371) further validates that mesh library descriptors receive the aliased GeomSubsets in `geometry.geomSubsetSections`.

---

### 3. RobotState __MeshLibrary Filtering

**Severity:** ✅ No issues

**File:** `src/features/urdf-viewer/utils/usdViewerRobotAdapter.ts`

**Changes:** Lines 1393-1405 and 1418-1424 add fallback logic:
- When filtering removes all effective link paths (e.g., only `__MeshLibrary` paths existed), fall back to `normalizedDefaultPrimPath`
- This prevents an empty robot tree when the USD has internal mesh libraries but no actual link metadata

**Test verification:** `usdViewerRobotAdapter.test.ts:456-504` confirms:
- `rootLinkId` becomes `'go2_description'` (the default prim)
- `/go2_description/__MeshLibrary` is excluded from `linkIdByPath`
- The fallback link has `GeometryType.NONE` (empty visual)

---

### Conclusion

**No blocking issues remain.** The regression test correctly verifies that:

1. Direct material bindings on MeshLibrary meshes are **preserved** when aliasing GeomSubsets from instance prims
2. HydraMesh reapplies sidedness after material replacement
3. Internal `__MeshLibrary` paths are correctly filtered from RobotState root links

All tests pass (19/19, 7/7, 14/14) and typecheck passes.
