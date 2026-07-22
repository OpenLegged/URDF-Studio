// @ts-nocheck
import { BackSide, BoxGeometry, BufferGeometry, CapsuleGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, FrontSide, Matrix4, Mesh, MeshPhysicalMaterial, Quaternion, SkinnedMesh, SphereGeometry, Uint32BufferAttribute, Vector3, } from 'three';
import * as Shared from './shared.js';
import { mitigateCoplanarMaterialZFighting } from '../../../../../core/loaders/coplanarMaterialOffset.shared.js';
import { stackCoincidentVisualRoots } from '../../../../../core/loaders/visualMeshStacking.ts';
import { getDefaultMaterial } from './default-material-state.js';
import { createUnifiedHydraStandardMaterial, setHydraColorFromTuple } from './material-defaults.js';
const { buildProtoPrimPathCandidates, clamp01, createMatrixFromXformOp, debugInstancer, debugMaterials, debugMeshes, debugPrims, debugTextures, defaultGrayComponent, disableMaterials, disableTextures, extractPrimPathFromMaterialBindingWarning, extractReferencePrimTargets, extractScopeBodyText, extractUsdAssetReferencesFromLayerText, getActiveMaterialBindingWarningOwner, getAngleInRadians, getCollisionGeometryTypeFromUrdfElement, getExpectedPrimTypesForCollisionProto, getExpectedPrimTypesForProtoType, getMatrixMaxElementDelta, getPathBasename, getPathWithoutRoot, getRawConsoleMethod, getRootPathFromPrimPath, getSafePrimTypeName, hasNonZeroTranslation, hydraCallbackErrorCounts, installMaterialBindingApiWarningInterceptor, isIdentityQuaternion, isLikelyDefaultGrayMaterial, isLikelyInverseTransform, isMaterialBindingApiWarningMessage, isMatrixApproximatelyIdentity, isNonZero, isPotentiallyLargeBaseAssetPath, logHydraCallbackError, materialBindingRepairMaxLayerTextLength, materialBindingWarningHandlers, maxHydraCallbackErrorLogsPerMethod, nearlyEqual, normalizeHydraPath, normalizeUsdPathToken, parseGuideCollisionReferencesFromLayerText, parseProtoMeshIdentifier, parseUrdfTruthFromText, parseVector3Text, parseXformOpFallbacksFromLayerText, rawConsoleError, rawConsoleWarn, registerMaterialBindingApiWarningHandler, remapRootPathIfNeeded, resolveUrdfTruthFileNameForStagePath, resolveUsdAssetPath, setActiveMaterialBindingWarningOwner, shouldAllowLargeBaseAssetScan, stringifyConsoleArgs, toArrayLike, toColorArray, toFiniteNumber, toFiniteQuaternionWxyzTuple, toFiniteVector2Tuple, toFiniteVector3Tuple, toMatrixFromUrdfOrigin, toQuaternionWxyzFromRpy, transformEpsilon, wrapHydraCallbackObject } = Shared;
const HYDRA_SYNC_PROFILE_FROM_QUERY = false;
const PREFER_HYDRA_COLLISION_GEOMETRY = true;
const DEFER_COLLISION_OVERRIDE_IN_COMMIT = true;
const ALLOW_RESOLVED_VISUAL_SUBMESH_TRANSFORM = false;
const EMPTY_UINT32_ARRAY = new Uint32Array(0);
// Keep primitive tessellation multiples of 4 so cardinal directions land on
// vertices; this avoids ~1.5% AABB shrink on spheres/cylinders.
const PRIMITIVE_SEGMENTS = {
    sphereWidth: 24,
    sphereHeight: 16,
    cylinderRadial: 24,
    cylinderHeight: 1,
    capsuleCap: 12,
    capsuleRadial: 24,
};
// Collision primitives are debug overlays. Use a lighter tessellation profile to
// reduce first-commit CPU cost without affecting collision pose/size truth checks.
const FAST_COLLISION_PRIMITIVE_SEGMENTS = {
    sphereWidth: 12,
    sphereHeight: 8,
    cylinderRadial: 12,
    cylinderHeight: 1,
    capsuleCap: 8,
    capsuleRadial: 12,
};
const VISUAL_SEGMENT_PATTERN = /(?:^|\/)visuals?(?:$|[/.])/i;
const COLLISION_SEGMENT_PATTERN = /(?:^|\/)coll(?:isions?|iders?)(?:$|[/.])/i;
const PRIMITIVE_GEOMETRY_TEMPLATE_CACHE = new Map();
const warnedMissingMaterials = new Set();
const NORMAL_REPAIR_DOT_THRESHOLD = 0.2;
// Unitree cooked USDs contain very thin triangles whose normals still affect shading.
const NORMAL_REPAIR_EPSILON = 1e-12;
function toPrimitiveKeyNumber(value, digits = 6) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        return "nan";
    return parsed.toFixed(digits);
}
function normalizeLength(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0)
        return 0;
    return Math.floor(numeric);
}
function normalizeTopologyMode(value) {
    const normalized = String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
    if (normalized === 'nonindexed' || normalized === 'nonindex')
        return 'nonIndexed';
    if (normalized === 'indexed' || normalized === 'index')
        return 'indexed';
    return null;
}
function shouldProfileHydraSync() {
    return HYDRA_SYNC_PROFILE_FROM_QUERY || globalThis?.__HYDRA_PROFILE_SYNC__ === true;
}
class HydraMesh {
    /**
     * @param {string} typeId
     * @param {string} id
     * @param {ThreeRenderDelegateInterface} hydraInterface
     * @param {string} instancerId
     */
    constructor(typeId, id, hydraInterface, instancerId = null) {
        this._geometry = new BufferGeometry();
        this._typeId = normalizeHydraPath(typeId).toLowerCase();
        this._id = normalizeHydraPath(id);
        this._interface = hydraInterface;
        this._instancerId = normalizeHydraPath(instancerId); // Store relationship
        this._points = undefined;
        this._normals = undefined;
        this._colors = undefined;
        this._uvs = undefined;
        this._indices = undefined;
        this._expandedSharedVertexIndices = undefined;
        this._materials = [];
        this._hasEverReceivedTransform = false;
        this._hasCompletedProtoSync = false;
        this._primitiveFallbackType = this.getPrimitiveFallbackType();
        this._hasGeneratedPrimitiveFallback = false;
        this._appliedCollisionOverride = false;
        this._lastAppliedResolvedPrimPath = null;
        this._needsNormalFallback = false;
        this._needsNormalSanitization = false;
        // Track whether this mesh already received authored topology/vertex payloads
        // from Hydra. When true, proto blob fast-path is redundant and can add avoidable
        // first-sync stalls (especially if it triggers driver-side batch blob fetch).
        this._hasHydraGeometryPayload = false;
        // Keep the latest proto-blob matrix so visual proto sub-meshes can avoid
        // being overwritten by coarse resolved-prim transforms during post-sync.
        this._lastProtoBlobTransformMatrix = null;
        this._lastGeomSubsetSignature = '';
        this._pendingGeomSubsetSections = null;
        this._doubleSided = false;
        this._hasExplicitDoubleSided = false;
        this._cullStyle = null;
        this._hasExplicitCullStyle = false;
        this._resolvedFaceTopologyCache = new Map();
        this._decomposeScratchPositionA = new Vector3();
        this._decomposeScratchQuaternionA = new Quaternion();
        this._decomposeScratchScaleA = new Vector3();
        this._decomposeScratchPositionB = new Vector3();
        this._decomposeScratchQuaternionB = new Quaternion();
        this._decomposeScratchScaleB = new Vector3();
        let material = createUnifiedHydraStandardMaterial({
            side: DoubleSide,
            // envMap: hydraInterface.config.envMap,
        });
        this._materials.push(material);
        this._mesh = new Mesh(this._geometry, material);
        this._mesh.castShadow = true;
        this._mesh.receiveShadow = true;
        // ID can contain paths, we strip those here
        let _name = id;
        let lastSlash = _name.lastIndexOf('/');
        if (lastSlash >= 0) {
            _name = _name.substring(lastSlash + 1);
        }
        this._mesh.name = _name;
        // console.log("Creating HydraMesh: " + id + " -> " + _name);
        hydraInterface.config.usdRoot.add(this._mesh); // FIXME
    }
    _getAssignedMaterials() {
        const material = this._mesh?.material;
        if (Array.isArray(material)) {
            return material.filter(Boolean);
        }
        return material ? [material] : [];
    }
    _isSharedMaterialInstance(material) {
        if (!material) {
            return false;
        }
        if (material === getDefaultMaterial()) {
            return true;
        }
        const materialRecords = this._interface?.materials && typeof this._interface.materials === 'object'
            ? Object.values(this._interface.materials)
            : [];
        return materialRecords.some((record) => record?._material === material);
    }
    _prepareMaterialForSurfaceSide(material, side) {
        if (!material) {
            return material;
        }
        if (material.side === side) {
            return material;
        }
        const isLocalSurfaceMaterial = material.userData?.hydraSurfaceLocalMeshId === this._id;
        const canMutateInPlace = isLocalSurfaceMaterial || !this._isSharedMaterialInstance(material);
        const targetMaterial = canMutateInPlace ? material : material.clone();
        targetMaterial.side = side;
        targetMaterial.needsUpdate = true;
        if (!canMutateInPlace) {
            targetMaterial.userData = {
                ...(targetMaterial.userData || {}),
                hydraSurfaceLocalMeshId: this._id,
                hydraSurfaceSourceUuid: material.uuid || '',
            };
        }
        return targetMaterial;
    }
    _resolveMaterialSide() {
        const normalizedCullStyle = String(this._cullStyle || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
        if (!this._hasExplicitCullStyle || !normalizedCullStyle || normalizedCullStyle === 'derived' || normalizedCullStyle === 'default') {
            if (!this._hasExplicitDoubleSided) {
                return DoubleSide;
            }
            return this._doubleSided ? DoubleSide : FrontSide;
        }
        if (normalizedCullStyle.includes('nothing') || normalizedCullStyle === 'none' || normalizedCullStyle === 'dontcare') {
            return DoubleSide;
        }
        if (normalizedCullStyle.includes('front')) {
            return BackSide;
        }
        if (normalizedCullStyle.includes('backunlessdoublesided')) {
            return this._doubleSided ? DoubleSide : FrontSide;
        }
        if (normalizedCullStyle.includes('back')) {
            return FrontSide;
        }
        if (!this._hasExplicitDoubleSided) {
            return DoubleSide;
        }
        return this._doubleSided ? DoubleSide : FrontSide;
    }
    _applySurfaceState() {
        const side = this._resolveMaterialSide();
        const assignedMaterial = this._mesh?.material;
        if (Array.isArray(assignedMaterial)) {
            let changed = false;
            const nextMaterials = assignedMaterial.map((material) => {
                const nextMaterial = this._prepareMaterialForSurfaceSide(material, side);
                if (nextMaterial !== material) {
                    changed = true;
                }
                return nextMaterial;
            });
            if (changed) {
                this._mesh.material = nextMaterials;
                this._materials = nextMaterials.filter(Boolean);
            }
            return;
        }
        const nextMaterial = this._prepareMaterialForSurfaceSide(assignedMaterial, side);
        if (nextMaterial && nextMaterial !== assignedMaterial) {
            this._mesh.material = nextMaterial;
            this._materials = [nextMaterial];
        }
    }
    setDoubleSided(value) {
        this._doubleSided = !!value;
        this._hasExplicitDoubleSided = true;
        this._applySurfaceState();
    }
    setCullStyle(value) {
        this._cullStyle = value ?? null;
        this._hasExplicitCullStyle = this._cullStyle !== null && String(this._cullStyle).trim() !== '';
        this._applySurfaceState();
    }
    _getPrimitiveSegmentProfile() {
        if (this.isCollisionProtoMesh()) {
            return FAST_COLLISION_PRIMITIVE_SEGMENTS;
        }
        return PRIMITIVE_SEGMENTS;
    }
    _getCachedPrimitiveGeometry(cacheKey, buildGeometry) {
        const normalizedKey = String(cacheKey || "").trim();
        if (!normalizedKey || typeof buildGeometry !== "function")
            return null;
        const fromCache = PRIMITIVE_GEOMETRY_TEMPLATE_CACHE.get(normalizedKey);
        if (fromCache) {
            const cloned = fromCache.clone();
            if (!cloned.boundingBox)
                cloned.computeBoundingBox?.();
            if (!cloned.boundingSphere)
                cloned.computeBoundingSphere?.();
            return cloned;
        }
        const generated = buildGeometry();
        if (!generated)
            return null;
        generated.computeBoundingBox?.();
        generated.computeBoundingSphere?.();
        PRIMITIVE_GEOMETRY_TEMPLATE_CACHE.set(normalizedKey, generated);
        const cloned = generated.clone();
        if (!cloned.boundingBox)
            cloned.computeBoundingBox?.();
        if (!cloned.boundingSphere)
            cloned.computeBoundingSphere?.();
        return cloned;
    }
    getPrimitiveFallbackType() {
        const typeId = this._typeId || "";
        const meshId = this._id || "";
        const source = `${typeId}|${meshId}`.toLowerCase();
        const isCollisionMeshId = COLLISION_SEGMENT_PATTERN.test(source);
        if (source.includes("proto_box") || source.includes("cube") || source.includes("box")) {
            return "box";
        }
        if (source.includes("proto_sphere") || source.includes("sphere")) {
            return "sphere";
        }
        if (source.includes("proto_cylinder") || source.includes("cylinder") || source.includes("capsule")) {
            return "cylinder";
        }
        if (isCollisionMeshId && source.includes("proto_mesh")) {
            return "collisionProxy";
        }
        return null;
    }
    isCollisionProtoMesh() {
        if (!this._id || !this._id.includes(".proto_"))
            return false;
        const loweredId = this._id.toLowerCase();
        return COLLISION_SEGMENT_PATTERN.test(loweredId);
    }
    isVisualProtoMesh() {
        if (!this._id || !this._id.includes(".proto_"))
            return false;
        const proto = parseProtoMeshIdentifier(this._id);
        return !!proto && proto.sectionName === 'visuals';
    }
    restackSiblingVisualProtoMeshes(linkPath = null) {
        const resolvedLinkPath = normalizeHydraPath(linkPath)
            || normalizeHydraPath(parseProtoMeshIdentifier(this._id)?.linkPath || '');
        if (!resolvedLinkPath || !this._interface?.meshes) {
            return;
        }
        const visualRoots = Object.entries(this._interface.meshes)
            .map(([meshId, hydraMesh]) => ({
            hydraMesh,
            meshId,
            proto: parseProtoMeshIdentifier(meshId),
        }))
            .filter(({ hydraMesh, proto }) => !!hydraMesh?._mesh && proto?.sectionName === 'visuals' && proto.linkPath === resolvedLinkPath)
            .map(({ hydraMesh, meshId }) => ({
            root: hydraMesh._mesh,
            stableId: meshId,
        }));
        if (visualRoots.length < 2) {
            return;
        }
        stackCoincidentVisualRoots(visualRoots);
    }
    tryInheritVisualMaterialFromLink() {
        if (!this.isVisualProtoMesh())
            return false;
        const proto = parseProtoMeshIdentifier(this._id);
        if (!proto?.linkPath)
            return false;
        const currentMaterial = this._mesh.material;
        const looksDefaultMaterial = currentMaterial === getDefaultMaterial()
            || isLikelyDefaultGrayMaterial(Array.isArray(currentMaterial) ? currentMaterial.find(Boolean) : currentMaterial);
        if (!looksDefaultMaterial)
            return false;
        const inheritedMaterial = this._interface.getPreferredVisualMaterialForLink(proto.linkPath, this._id);
        if (!inheritedMaterial)
            return false;
        this._mesh.material = inheritedMaterial;
        this._pendingMaterialId = undefined;
        this.restackSiblingVisualProtoMeshes(proto.linkPath);
        return true;
    }
    tryApplyPendingGeomSubsetMaterials(profile = null) {
        const pendingSections = Array.isArray(this._pendingGeomSubsetSections)
            ? this._pendingGeomSubsetSections
            : [];
        if (pendingSections.length === 0)
            return false;
        this.setGeomSubsetMaterial(pendingSections, profile);
        return !Array.isArray(this._pendingGeomSubsetSections) || this._pendingGeomSubsetSections.length === 0;
    }
    ensurePrimitiveFallbackGeometry() {
        if (!this._primitiveFallbackType)
            return;
        if (this._interface?.strictOneShotSceneLoad === true) {
            const finalStageOverride = this._interface?._finalStageOverrideBatchCache?.get?.(this._id) || null;
            if (finalStageOverride?.valid === true) {
                this.applyFinalStageOverrideFromDriver(finalStageOverride, {
                    skipTransformFallback: true,
                    skipCollisionRotationFallback: true,
                });
                return;
            }
        }
        if (this._hasGeneratedPrimitiveFallback) {
            if (this.isCollisionProtoMesh() && !this._appliedCollisionOverride) {
                this.applyCollisionGeometryFromOverrides();
            }
            return;
        }
        const existingPositions = this._geometry.getAttribute('position');
        const hasExistingGeometry = !!(existingPositions && existingPositions.count > 0);
        const hasDimensionedCollisionPrimitive = this.isCollisionProtoMesh()
            && (this._primitiveFallbackType === 'box'
                || this._primitiveFallbackType === 'sphere'
                || this._primitiveFallbackType === 'cylinder');
        if (PREFER_HYDRA_COLLISION_GEOMETRY
            && hasExistingGeometry
            && this._hasHydraGeometryPayload
            && !hasDimensionedCollisionPrimitive) {
            // If Hydra already provided authored geometry, skip expensive stage/URDF
            // collision override resolution in the first commit hot-path.
            this._hasGeneratedPrimitiveFallback = true;
            return;
        }
        if (this.applyCollisionGeometryFromOverrides())
            return;
        if (existingPositions && existingPositions.count > 0) {
            this._hasGeneratedPrimitiveFallback = true;
            return;
        }
        if (this._interface?.strictOneShotSceneLoad === true) {
            return;
        }
        if (this.isCollisionProtoMesh()) {
            // Collision primitives must never be drawn from the generic unit-sized
            // visual fallback below. Their authored dimensions can arrive after the
            // proto mesh is created; synthesizing a 0.5 m radius / 1 m tall cylinder
            // in that gap produces enormous, fixed-size colliders. Keep the proto
            // pending so a later stage/driver override can provide the real geometry.
            return;
        }
        const segmentProfile = this._getPrimitiveSegmentProfile();
        let fallbackGeometry = null;
        switch (this._primitiveFallbackType) {
            case "box": {
                const key = "fallback|box|1.000000|1.000000|1.000000";
                fallbackGeometry = this._getCachedPrimitiveGeometry(key, () => new BoxGeometry(1, 1, 1));
                break;
            }
            case "sphere": {
                const key = [
                    "fallback|sphere|0.500000",
                    segmentProfile.sphereWidth,
                    segmentProfile.sphereHeight,
                ].join("|");
                fallbackGeometry = this._getCachedPrimitiveGeometry(key, () => new SphereGeometry(0.5, segmentProfile.sphereWidth, segmentProfile.sphereHeight));
                break;
            }
            case "cylinder":
                {
                    const key = [
                        "fallback|cylinder|0.500000|1.000000|Y",
                        segmentProfile.cylinderRadial,
                        segmentProfile.cylinderHeight,
                    ].join("|");
                    fallbackGeometry = this._getCachedPrimitiveGeometry(key, () => new CylinderGeometry(0.5, 0.5, 1, segmentProfile.cylinderRadial, segmentProfile.cylinderHeight, false));
                }
                break;
            case "collisionProxy": {
                const key = "fallback|collisionProxy|0.120000|0.120000|0.120000";
                fallbackGeometry = this._getCachedPrimitiveGeometry(key, () => new BoxGeometry(0.12, 0.12, 0.12));
                break;
            }
            default:
                return;
        }
        this.replaceGeometry(fallbackGeometry);
        this._hasGeneratedPrimitiveFallback = true;
    }
    replaceGeometry(nextGeometry) {
        if (!nextGeometry)
            return;
        const previousGeometry = this._geometry;
        this._geometry = nextGeometry;
        this._mesh.geometry = nextGeometry;
        this._needsNormalFallback = true;
        if (previousGeometry && previousGeometry !== nextGeometry && previousGeometry.dispose) {
            previousGeometry.dispose();
        }
    }
    getResolvedGeometryPrimPathForCurrentMesh() {
        const resolvedVisualPrimPath = this._interface?.getResolvedVisualTransformPrimPathForMeshId?.(this._id);
        if (resolvedVisualPrimPath) {
            return normalizeHydraPath(resolvedVisualPrimPath);
        }
        const resolvedPrimPath = this._interface?.getResolvedPrimPathForMeshId?.(this._id);
        if (resolvedPrimPath) {
            return normalizeHydraPath(resolvedPrimPath);
        }
        return null;
    }
    getResolvedFaceTopologyMetadataForPrimPath(primPath) {
        const normalizedPrimPath = normalizeHydraPath(primPath);
        if (!normalizedPrimPath) {
            return null;
        }
        if (this._resolvedFaceTopologyCache.has(normalizedPrimPath)) {
            return this._resolvedFaceTopologyCache.get(normalizedPrimPath) || null;
        }
        const stage = this._interface?.getStage?.();
        const prim = stage ? this._interface?.safeGetPrimAtPath?.(stage, normalizedPrimPath) : null;
        const faceVertexCounts = prim?.GetAttribute?.('faceVertexCounts')?.Get?.();
        if (!faceVertexCounts || typeof faceVertexCounts.length !== 'number' || faceVertexCounts.length <= 0) {
            this._resolvedFaceTopologyCache.set(normalizedPrimPath, null);
            return null;
        }
        const totalFaceCount = Math.max(0, Math.floor(Number(faceVertexCounts.length) || 0));
        const triangleIndexOffsets = new Uint32Array(totalFaceCount + 1);
        let sourceIndexCount = 0;
        let triangulatedIndexCount = 0;
        let hasPolygonalFaces = false;
        for (let faceIndex = 0; faceIndex < totalFaceCount; faceIndex += 1) {
            const count = Math.max(0, Math.floor(Number(faceVertexCounts[faceIndex]) || 0));
            triangleIndexOffsets[faceIndex] = triangulatedIndexCount;
            sourceIndexCount += count;
            if (count !== 3) {
                hasPolygonalFaces = true;
            }
            if (count >= 3) {
                triangulatedIndexCount += (count - 2) * 3;
            }
        }
        triangleIndexOffsets[totalFaceCount] = triangulatedIndexCount;
        const metadata = {
            faceVertexCounts,
            totalFaceCount,
            sourceIndexCount,
            triangulatedIndexCount,
            triangleIndexOffsets,
            hasPolygonalFaces,
        };
        this._resolvedFaceTopologyCache.set(normalizedPrimPath, metadata);
        return metadata;
    }
    getResolvedFaceTopologyMetadataForCurrentMesh(sourceIndexCount = null) {
        const resolvedPrimPath = this.getResolvedGeometryPrimPathForCurrentMesh();
        const metadata = resolvedPrimPath
            ? this.getResolvedFaceTopologyMetadataForPrimPath(resolvedPrimPath)
            : null;
        if (!metadata) {
            return null;
        }
        if (Number.isFinite(sourceIndexCount) && sourceIndexCount > 0 && metadata.sourceIndexCount !== sourceIndexCount) {
            return null;
        }
        return metadata;
    }
    triangulateProtoIndicesIfNeeded(indices) {
        if (!indices || typeof indices.length !== 'number' || indices.length <= 0) {
            return indices;
        }
        const metadata = this.getResolvedFaceTopologyMetadataForCurrentMesh(indices.length >>> 0);
        if (!metadata?.hasPolygonalFaces) {
            return indices;
        }
        const triangulated = this.toTriangleIndexArray(indices, metadata.faceVertexCounts);
        if (!triangulated || triangulated.length <= 0) {
            return indices;
        }
        return triangulated;
    }
    remapGeomSubsetSectionsToTriangleIndexRanges(sections) {
        if (!Array.isArray(sections) || sections.length === 0) {
            return sections;
        }
        const metadata = this.getResolvedFaceTopologyMetadataForCurrentMesh();
        if (!metadata) {
            return sections;
        }
        let maxSectionEnd = 0;
        for (const section of sections) {
            const start = Number(section?.start);
            const length = Number(section?.length);
            if (!Number.isFinite(start) || !Number.isFinite(length) || length <= 0) {
                continue;
            }
            maxSectionEnd = Math.max(maxSectionEnd, Math.floor(start + length));
        }
        // USD GeomSubset indices are face ordinals. The proto blob forwards them as
        // start/length spans, so convert those face ranges into triangle-index ranges
        // when the current mesh topology is polygonal or face-based.
        if (maxSectionEnd <= 0 || maxSectionEnd > metadata.totalFaceCount) {
            return sections;
        }
        const remappedSections = [];
        for (const section of sections) {
            const start = Math.max(0, Math.floor(Number(section?.start) || 0));
            const length = Math.max(0, Math.floor(Number(section?.length) || 0));
            if (length <= 0) {
                continue;
            }
            const end = Math.min(metadata.totalFaceCount, start + length);
            if (end <= start) {
                continue;
            }
            const triangleStart = Number(metadata.triangleIndexOffsets[start] || 0);
            const triangleEnd = Number(metadata.triangleIndexOffsets[end] || triangleStart);
            const triangleLength = Math.max(0, triangleEnd - triangleStart);
            if (triangleLength <= 0) {
                continue;
            }
            remappedSections.push({
                start: triangleStart,
                length: triangleLength,
                materialId: normalizeHydraPath(section?.materialId || '') || '',
            });
        }
        return remappedSections.length > 0 ? remappedSections : sections;
    }
    applyResolvedPrimGeometry(primPath) {
        if (!primPath)
            return false;
        const stage = this._interface.getStage();
        if (!stage)
            return false;
        const prim = this._interface.safeGetPrimAtPath(stage, primPath);
        if (!prim)
            return false;
        const primType = String(getSafePrimTypeName(prim) || '').toLowerCase();
        if (primType === 'mesh') {
            return this.applyUsdMeshGeometry(prim);
        }
        if (primType === 'cube' || primType === 'sphere' || primType === 'cylinder' || primType === 'capsule') {
            return this.applyUsdPrimitiveGeometry(prim, primType);
        }
        return false;
    }
    getExtentDimensionsFromDescriptor(descriptor) {
        if (!descriptor || !descriptor.extentSize || typeof descriptor.extentSize.length !== 'number')
            return null;
        if (Number(descriptor.extentSize.length) < 3)
            return null;
        const width = Math.abs(Number(descriptor.extentSize[0] ?? 0));
        const height = Math.abs(Number(descriptor.extentSize[1] ?? 0));
        const depth = Math.abs(Number(descriptor.extentSize[2] ?? 0));
        if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(depth))
            return null;
        return [Math.max(width, 1e-6), Math.max(height, 1e-6), Math.max(depth, 1e-6)];
    }
    applyPrimitiveGeometryFromDescriptor(primType, descriptor) {
        let generated = null;
        const normalizedType = String(primType || '').toLowerCase();
        const dimensionsFromExtent = this.getExtentDimensionsFromDescriptor(descriptor);
        const sizeValue = toFiniteNumber(descriptor?.size);
        const radiusValue = toFiniteNumber(descriptor?.radius);
        const heightValue = toFiniteNumber(descriptor?.height);
        const axis = String(descriptor?.axis || 'Z').toUpperCase();
        const segmentProfile = this._getPrimitiveSegmentProfile();
        if (normalizedType === 'cube') {
            if (!dimensionsFromExtent && sizeValue === undefined) {
                return false;
            }
            const extentMatchesSize = dimensionsFromExtent && sizeValue !== undefined
                ? nearlyEqual(dimensionsFromExtent[0], sizeValue)
                    && nearlyEqual(dimensionsFromExtent[1], sizeValue)
                    && nearlyEqual(dimensionsFromExtent[2], sizeValue)
                : false;
            const width = dimensionsFromExtent
                ? (sizeValue !== undefined && !extentMatchesSize ? sizeValue : dimensionsFromExtent[0])
                : sizeValue;
            const height = dimensionsFromExtent
                ? (sizeValue !== undefined && !extentMatchesSize ? sizeValue : dimensionsFromExtent[1])
                : sizeValue;
            const depth = dimensionsFromExtent
                ? (sizeValue !== undefined && !extentMatchesSize ? sizeValue : dimensionsFromExtent[2])
                : sizeValue;
            const safeWidth = Math.max(width, 1e-6);
            const safeHeight = Math.max(height, 1e-6);
            const safeDepth = Math.max(depth, 1e-6);
            const key = [
                "descriptor|cube",
                toPrimitiveKeyNumber(safeWidth),
                toPrimitiveKeyNumber(safeHeight),
                toPrimitiveKeyNumber(safeDepth),
            ].join("|");
            generated = this._getCachedPrimitiveGeometry(key, () => new BoxGeometry(safeWidth, safeHeight, safeDepth));
        }
        else if (normalizedType === 'sphere') {
            const radiusFromExtent = dimensionsFromExtent
                ? Math.max(dimensionsFromExtent[0], dimensionsFromExtent[1], dimensionsFromExtent[2]) * 0.5
                : undefined;
            if (radiusValue === undefined && radiusFromExtent === undefined) {
                return false;
            }
            const radius = Math.max(radiusValue ?? radiusFromExtent, 1e-6);
            const key = [
                "descriptor|sphere",
                toPrimitiveKeyNumber(radius),
                segmentProfile.sphereWidth,
                segmentProfile.sphereHeight,
            ].join("|");
            generated = this._getCachedPrimitiveGeometry(key, () => new SphereGeometry(radius, segmentProfile.sphereWidth, segmentProfile.sphereHeight));
        }
        else if (normalizedType === 'cylinder') {
            let radiusFromExtent = undefined;
            let heightFromExtent = undefined;
            if (dimensionsFromExtent) {
                if (axis === 'X') {
                    heightFromExtent = dimensionsFromExtent[0];
                    radiusFromExtent = Math.max(dimensionsFromExtent[1], dimensionsFromExtent[2]) * 0.5;
                }
                else if (axis === 'Y') {
                    heightFromExtent = dimensionsFromExtent[1];
                    radiusFromExtent = Math.max(dimensionsFromExtent[0], dimensionsFromExtent[2]) * 0.5;
                }
                else {
                    heightFromExtent = dimensionsFromExtent[2];
                    radiusFromExtent = Math.max(dimensionsFromExtent[0], dimensionsFromExtent[1]) * 0.5;
                }
            }
            if (radiusValue === undefined && radiusFromExtent === undefined) {
                return false;
            }
            if (heightValue === undefined && heightFromExtent === undefined) {
                return false;
            }
            const radius = Math.max(radiusValue ?? radiusFromExtent, 1e-6);
            const height = Math.max(heightValue ?? heightFromExtent, 1e-6);
            const key = [
                "descriptor|cylinder",
                toPrimitiveKeyNumber(radius),
                toPrimitiveKeyNumber(height),
                axis,
                segmentProfile.cylinderRadial,
                segmentProfile.cylinderHeight,
            ].join("|");
            generated = this._getCachedPrimitiveGeometry(key, () => {
                const geometry = new CylinderGeometry(radius, radius, height, segmentProfile.cylinderRadial, segmentProfile.cylinderHeight, false);
                if (axis === 'X') {
                    geometry.rotateZ(-Math.PI / 2);
                }
                else if (axis === 'Z') {
                    geometry.rotateX(Math.PI / 2);
                }
                return geometry;
            });
        }
        else if (normalizedType === 'capsule') {
            let radiusFromExtent = undefined;
            let totalHeightFromExtent = undefined;
            if (dimensionsFromExtent) {
                if (axis === 'X') {
                    totalHeightFromExtent = dimensionsFromExtent[0];
                    radiusFromExtent = Math.max(dimensionsFromExtent[1], dimensionsFromExtent[2]) * 0.5;
                }
                else if (axis === 'Y') {
                    totalHeightFromExtent = dimensionsFromExtent[1];
                    radiusFromExtent = Math.max(dimensionsFromExtent[0], dimensionsFromExtent[2]) * 0.5;
                }
                else {
                    totalHeightFromExtent = dimensionsFromExtent[2];
                    radiusFromExtent = Math.max(dimensionsFromExtent[0], dimensionsFromExtent[1]) * 0.5;
                }
            }
            if (radiusValue === undefined && radiusFromExtent === undefined) {
                return false;
            }
            if (heightValue === undefined && totalHeightFromExtent === undefined) {
                return false;
            }
            const radius = Math.max(radiusValue ?? radiusFromExtent, 1e-6);
            const totalHeight = Math.max(heightValue ?? totalHeightFromExtent, 1e-6);
            const capsuleBodyHeight = Math.max(totalHeight - 2 * radius, 1e-6);
            const key = [
                "descriptor|capsule",
                toPrimitiveKeyNumber(radius),
                toPrimitiveKeyNumber(capsuleBodyHeight),
                axis,
                segmentProfile.capsuleCap,
                segmentProfile.capsuleRadial,
            ].join("|");
            generated = this._getCachedPrimitiveGeometry(key, () => {
                const geometry = new CapsuleGeometry(radius, capsuleBodyHeight, segmentProfile.capsuleCap, segmentProfile.capsuleRadial);
                if (axis === 'X') {
                    geometry.rotateZ(-Math.PI / 2);
                }
                else if (axis === 'Z') {
                    geometry.rotateX(Math.PI / 2);
                }
                return geometry;
            });
        }
        if (!generated)
            return false;
        this.replaceGeometry(generated);
        return true;
    }
    applyCollisionGeometryFromDriverOverride(overridePayload) {
        if (!overridePayload || overridePayload.valid !== true)
            return false;
        const primType = String(overridePayload.primType || '').toLowerCase();
        if (!primType)
            return false;
        const authoredGeometryOverride = this._interface?.getCollisionPrimitiveGeometryOverride?.(this._id) || null;
        const geometryDescriptor = authoredGeometryOverride
            ? { ...overridePayload, ...authoredGeometryOverride }
            : overridePayload;
        let geometryApplied = false;
        if (primType === 'mesh') {
            const meshPayload = (overridePayload?.meshPayload && overridePayload.meshPayload.valid === true)
                ? overridePayload.meshPayload
                : null;
            try {
                geometryApplied = this.tryApplyProtoDataBlobFastPath(meshPayload
                    ? { blobOverride: meshPayload, allowForceRefreshRetry: false, replaceExistingGeometry: true }
                    : {}) === true;
            }
            catch {
                geometryApplied = false;
            }
            if (!geometryApplied) {
                try {
                    geometryApplied = this.tryApplyProtoDataBlobFastPath({ replaceExistingGeometry: true }) === true;
                }
                catch {
                    geometryApplied = false;
                }
            }
            if (!geometryApplied) {
                // Mesh proto IDs can still provide authored extents even when direct
                // mesh payload hydration fails. Use a box proxy from extents so collider
                // dimensions remain physically meaningful instead of default 0.12 cubes.
                geometryApplied = this.applyPrimitiveGeometryFromDescriptor('cube', geometryDescriptor) === true;
            }
        }
        else if (primType === 'cube' || primType === 'sphere' || primType === 'cylinder' || primType === 'capsule') {
            geometryApplied = this.applyPrimitiveGeometryFromDescriptor(primType, geometryDescriptor) === true;
        }
        if (!geometryApplied)
            return false;
        const localXformOverride = this._interface.getCollisionLocalXformOverride(this._id);
        if (localXformOverride) {
            const proto = parseProtoMeshIdentifier(this._id);
            const linkPath = localXformOverride.linkPath || proto?.linkPath || null;
            const linkTransform = linkPath ? this._interface.getWorldTransformForPrimPath(linkPath) : null;
            const localMatrix = new Matrix4().compose(localXformOverride.translation, localXformOverride.orientation, localXformOverride.scale);
            if (linkTransform) {
                localMatrix.premultiply(linkTransform);
            }
            this._mesh.matrix.copy(localMatrix);
            this._mesh.matrixAutoUpdate = false;
        }
        else if ((overridePayload.worldTransform || overridePayload.worldTransformElements)
            && this._setMatrixFromTransformOverride(overridePayload.worldTransform, overridePayload.worldTransformElements)) {
            this._mesh.matrixAutoUpdate = false;
        }
        else {
            const resolvedPath = normalizeHydraPath(overridePayload.resolvedPrimPath);
            if (resolvedPath) {
                const resolvedTransform = this._interface.getWorldTransformForPrimPath(resolvedPath);
                if (resolvedTransform) {
                    this._mesh.matrix.copy(resolvedTransform);
                    this._mesh.matrixAutoUpdate = false;
                }
            }
        }
        this._appliedCollisionOverride = true;
        this._lastAppliedResolvedPrimPath = normalizeHydraPath(overridePayload.resolvedPrimPath) || this._lastAppliedResolvedPrimPath;
        this._hasGeneratedPrimitiveFallback = true;
        return true;
    }
    applyFinalStageOverrideFromDriver(overridePayload, options = {}) {
        if (!overridePayload || overridePayload.valid !== true)
            return false;
        const normalizedMeshId = normalizeHydraPath(overridePayload.meshId || this._id) || this._id;
        const sectionNameRaw = String(overridePayload.sectionName || '').toLowerCase();
        const sectionName = sectionNameRaw
            || (normalizedMeshId.includes('/visuals.proto_') ? 'visuals' : '')
            || (normalizedMeshId.includes('/collisions.proto_') ? 'collisions' : '');
        const isCollisionSection = sectionName === 'collisions' || this.isCollisionProtoMesh();
        const isVisualSection = !isCollisionSection && (sectionName === 'visuals' || this.isVisualProtoMesh());
        if (isCollisionSection) {
            const geometryApplied = this.applyCollisionGeometryFromDriverOverride(overridePayload) === true;
            if (!geometryApplied)
                return false;
            if (options?.skipTransformFallback !== true) {
                this.syncProtoTransformFromFallback();
            }
            if (options?.skipCollisionRotationFallback !== true) {
                this.syncCollisionRotationFromVisualLink();
            }
            this._hasCompletedProtoSync = true;
            return true;
        }
        if (isVisualSection) {
            const overridePrimType = String(overridePayload?.primType || '').toLowerCase();
            const isPrimitiveVisualOverride = (overridePrimType === 'cube'
                || overridePrimType === 'sphere'
                || overridePrimType === 'cylinder'
                || overridePrimType === 'capsule');
            let primitiveGeometryApplied = false;
            if (isPrimitiveVisualOverride) {
                primitiveGeometryApplied = this.applyPrimitiveGeometryFromDescriptor(overridePrimType, overridePayload) === true;
                if (primitiveGeometryApplied) {
                    this._hasGeneratedPrimitiveFallback = true;
                }
            }
            const existingPosition = this._geometry?.getAttribute?.('position');
            let geometryReady = primitiveGeometryApplied || (!!existingPosition && Number(existingPosition.count || 0) > 0);
            if (!geometryReady) {
                const meshPayload = (overridePayload?.meshPayload && overridePayload.meshPayload.valid === true)
                    ? overridePayload.meshPayload
                    : null;
                try {
                    geometryReady = this.tryApplyProtoDataBlobFastPath(meshPayload
                        ? { blobOverride: meshPayload, allowForceRefreshRetry: false, replaceExistingGeometry: true }
                        : {}) === true;
                }
                catch {
                    geometryReady = false;
                }
            }
            if (!geometryReady) {
                try {
                    geometryReady = this.tryApplyProtoDataBlobFastPath() === true;
                }
                catch {
                    geometryReady = false;
                }
            }
            if (!geometryReady && this._hasHydraGeometryPayload === true) {
                geometryReady = true;
            }
            if (!geometryReady) {
                // Keep proto sync pending so applyProtoStageSync() can continue with fallback chains.
                return false;
            }
            const proto = parseProtoMeshIdentifier(this._id);
            const isVisualProtoSubMesh = !!proto
                && proto.sectionName === 'visuals'
                && proto.protoType === 'mesh'
                && proto.protoIndex > 0;
            const protoBlobMatrix = this._lastProtoBlobTransformMatrix;
            const hasVisualSubMeshProtoBlobTransform = isVisualProtoSubMesh && !!protoBlobMatrix;
            let transformApplied = false;
            const worldTransform = overridePayload?.worldTransform || null;
            let transformCandidate = null;
            if (worldTransform && worldTransform.isMatrix4 === true) {
                transformCandidate = worldTransform;
            }
            else {
                const worldElements = overridePayload?.worldTransformElements || worldTransform;
                transformCandidate = this._buildMatrix4FromRowMajorSource(worldElements);
            }
            if (!transformCandidate) {
                const resolvedPrimPath = normalizeHydraPath(overridePayload?.resolvedPrimPath || '');
                if (resolvedPrimPath) {
                    const resolvedTransform = this._interface.getWorldTransformForPrimPath(resolvedPrimPath);
                    if (resolvedTransform) {
                        transformCandidate = resolvedTransform;
                    }
                }
            }
            if (transformCandidate) {
                if (!transformApplied
                    && isVisualProtoSubMesh
                    && this._mesh?.matrix
                    && hasNonZeroTranslation(this._mesh.matrix)) {
                    const currentVsCandidateDelta = getMatrixMaxElementDelta(this._mesh.matrix, transformCandidate);
                    if (currentVsCandidateDelta > 1e-4) {
                        const currentElements = this._mesh.matrix?.elements;
                        const candidateElements = transformCandidate?.elements;
                        const translationDelta = (currentElements
                            && candidateElements
                            && currentElements.length >= 16
                            && candidateElements.length >= 16)
                            ? Math.hypot(Number(currentElements[12]) - Number(candidateElements[12]), Number(currentElements[13]) - Number(candidateElements[13]), Number(currentElements[14]) - Number(candidateElements[14]))
                            : Number.POSITIVE_INFINITY;
                        if (Number.isFinite(translationDelta) && translationDelta <= 1e-3) {
                            // Keep Hydra-authored sub-mesh orientation when stage override
                            // provides a coarse link-level transform at (nearly) identical
                            // translation.
                            transformApplied = true;
                        }
                    }
                }
                if (hasVisualSubMeshProtoBlobTransform) {
                    const candidateVsProtoBlobDelta = getMatrixMaxElementDelta(transformCandidate, protoBlobMatrix);
                    if (candidateVsProtoBlobDelta > 1e-4) {
                        const candidateElements = transformCandidate?.elements;
                        const protoElements = protoBlobMatrix?.elements;
                        const translationDelta = (candidateElements
                            && protoElements
                            && candidateElements.length >= 16
                            && protoElements.length >= 16)
                            ? Math.hypot(Number(candidateElements[12]) - Number(protoElements[12]), Number(candidateElements[13]) - Number(protoElements[13]), Number(candidateElements[14]) - Number(protoElements[14]))
                            : Number.POSITIVE_INFINITY;
                        if (Number.isFinite(translationDelta) && translationDelta <= 1e-3) {
                            // Some visual proto sub-meshes carry per-submesh orientation in proto blob,
                            // while resolved prim paths provide only coarse link transforms.
                            this._mesh.matrix.copy(protoBlobMatrix);
                            transformApplied = true;
                        }
                    }
                }
                if (!transformApplied) {
                    this._mesh.matrix.copy(transformCandidate);
                    transformApplied = true;
                }
            }
            if (!transformApplied)
                return false;
            this._mesh.matrixAutoUpdate = false;
            this._hasCompletedProtoSync = true;
            return true;
        }
        return false;
    }
    hasAppliedCollisionOverrideForPrimPath(primPath) {
        const normalizedPath = normalizeHydraPath(primPath);
        if (!normalizedPath || !normalizedPath.startsWith('/'))
            return false;
        if (this._appliedCollisionOverride !== true)
            return false;
        return this._lastAppliedResolvedPrimPath === normalizedPath;
    }
    shouldDeferProtoStageSyncUntilSceneSnapshot() {
        const renderInterface = this._interface;
        if (!renderInterface || renderInterface.strictOneShotSceneLoad !== true)
            return false;
        if (this.isCollisionProtoMesh())
            return false;
        if (typeof renderInterface.shouldDeferProtoStageSyncUntilSceneSnapshot === 'function') {
            return renderInterface.shouldDeferProtoStageSyncUntilSceneSnapshot() === true;
        }
        if (typeof renderInterface.hasResolvedRobotSceneSnapshot === 'function') {
            return renderInterface.hasResolvedRobotSceneSnapshot() !== true;
        }
        return false;
    }
    applyResolvedPrimGeometryAndTransform(primPath) {
        const normalizedPrimPath = normalizeHydraPath(primPath);
        if (!normalizedPrimPath || !normalizedPrimPath.startsWith('/'))
            return false;
        if (this.hasAppliedCollisionOverrideForPrimPath(normalizedPrimPath)) {
            const resolvedTransform = this._interface.getWorldTransformForPrimPath(normalizedPrimPath);
            if (resolvedTransform) {
                this._mesh.matrix.copy(resolvedTransform);
                this._mesh.matrixAutoUpdate = false;
            }
            return true;
        }
        const primOverrideData = this._interface?.getPrimOverrideData?.(normalizedPrimPath) || null;
        if (primOverrideData && primOverrideData.valid === true) {
            let geometryApplied = false;
            if (primOverrideData.primType === 'mesh') {
                const meshPayload = (primOverrideData?.meshPayload && primOverrideData.meshPayload.valid === true)
                    ? primOverrideData.meshPayload
                    : null;
                try {
                    geometryApplied = this.tryApplyProtoDataBlobFastPath(meshPayload
                        ? { blobOverride: meshPayload, allowForceRefreshRetry: false, replaceExistingGeometry: true }
                        : {}) === true;
                }
                catch {
                    geometryApplied = false;
                }
                if (!geometryApplied) {
                    try {
                        geometryApplied = this.tryApplyProtoDataBlobFastPath({ replaceExistingGeometry: true }) === true;
                    }
                    catch {
                        geometryApplied = false;
                    }
                }
            }
            else if (primOverrideData.primType === 'cube'
                || primOverrideData.primType === 'sphere'
                || primOverrideData.primType === 'cylinder'
                || primOverrideData.primType === 'capsule') {
                geometryApplied = this.applyPrimitiveGeometryFromDescriptor(primOverrideData.primType, primOverrideData) === true;
            }
            if (geometryApplied) {
                const localXformOverride = this._interface.getCollisionLocalXformOverride(this._id);
                if (localXformOverride) {
                    const proto = parseProtoMeshIdentifier(this._id);
                    const linkPath = localXformOverride.linkPath || proto?.linkPath || null;
                    const linkTransform = linkPath ? this._interface.getWorldTransformForPrimPath(linkPath) : null;
                    const localMatrix = new Matrix4().compose(localXformOverride.translation, localXformOverride.orientation, localXformOverride.scale);
                    if (linkTransform) {
                        localMatrix.premultiply(linkTransform);
                    }
                    this._mesh.matrix.copy(localMatrix);
                    this._mesh.matrixAutoUpdate = false;
                }
                else if ((primOverrideData.worldTransform || primOverrideData.worldTransformElements)
                    && this._setMatrixFromTransformOverride(primOverrideData.worldTransform, primOverrideData.worldTransformElements)) {
                    this._mesh.matrixAutoUpdate = false;
                }
                this._appliedCollisionOverride = true;
                this._lastAppliedResolvedPrimPath = normalizedPrimPath;
                this._hasGeneratedPrimitiveFallback = true;
                return true;
            }
        }
        return false;
    }
    syncVisualTransformFromResolvedPrim() {
        if (!this.isVisualProtoMesh())
            return false;
        const resolvedPrimPath = this._interface.getResolvedVisualTransformPrimPathForMeshId(this._id);
        if (!resolvedPrimPath)
            return false;
        const resolvedTransform = this._interface.getWorldTransformForPrimPath(resolvedPrimPath);
        if (!resolvedTransform)
            return false;
        const currentMatrix = this._mesh.matrix;
        const currentVsResolvedDelta = getMatrixMaxElementDelta(currentMatrix, resolvedTransform);
        const preferResolvedTransform = this._interface.shouldPreferResolvedVisualTransformForMeshId?.(this._id) === true;
        const proto = parseProtoMeshIdentifier(this._id);
        const isVisualProtoSubMesh = !!proto
            && proto.sectionName === 'visuals'
            && proto.protoType === 'mesh'
            && proto.protoIndex > 0;
        if (isVisualProtoSubMesh && !ALLOW_RESOLVED_VISUAL_SUBMESH_TRANSFORM) {
            return false;
        }
        if (preferResolvedTransform && isVisualProtoSubMesh) {
            // Proto blob transforms for visual sub-meshes are often authored as
            // link-local offsets. If Hydra hasn't provided a world transform yet,
            // keep fallback composition path active instead of force-overwriting with
            // resolved prim world transform.
            if (!this._hasEverReceivedTransform && this._lastProtoBlobTransformMatrix) {
                const fallbackTransform = this._interface.getSafeFallbackTransformForMeshId(this._id);
                if (fallbackTransform && hasNonZeroTranslation(fallbackTransform)) {
                    return false;
                }
            }
            const resolvedElements = resolvedTransform?.elements;
            const currentElements = currentMatrix?.elements;
            if (currentElements
                && resolvedElements
                && currentElements.length >= 16
                && resolvedElements.length >= 16) {
                const translationDelta = Math.hypot(Number(currentElements[12]) - Number(resolvedElements[12]), Number(currentElements[13]) - Number(resolvedElements[13]), Number(currentElements[14]) - Number(resolvedElements[14]));
                const currentLooksAuthored = hasNonZeroTranslation(currentMatrix)
                    || !isMatrixApproximatelyIdentity(currentMatrix);
                if (currentLooksAuthored && Number.isFinite(translationDelta) && translationDelta <= 1e-3) {
                    const currentVsResolvedDelta = getMatrixMaxElementDelta(currentMatrix, resolvedTransform);
                    if (currentVsResolvedDelta > 1e-4) {
                        // Preserve authored sub-mesh orientation when resolved prim provides
                        // only a coarse link-aligned rotation at essentially the same pivot.
                        return true;
                    }
                }
            }
            const protoBlobMatrix = this._lastProtoBlobTransformMatrix;
            if (protoBlobMatrix) {
                const resolvedVsProtoBlobDelta = getMatrixMaxElementDelta(resolvedTransform, protoBlobMatrix);
                if (resolvedVsProtoBlobDelta > 1e-4) {
                    const protoElements = protoBlobMatrix?.elements;
                    const translationDelta = (resolvedElements
                        && protoElements
                        && resolvedElements.length >= 16
                        && protoElements.length >= 16)
                        ? Math.hypot(Number(resolvedElements[12]) - Number(protoElements[12]), Number(resolvedElements[13]) - Number(protoElements[13]), Number(resolvedElements[14]) - Number(protoElements[14]))
                        : Number.POSITIVE_INFINITY;
                    if (Number.isFinite(translationDelta) && translationDelta <= 1e-3) {
                        const currentVsProtoBlobDelta = getMatrixMaxElementDelta(currentMatrix, protoBlobMatrix);
                        if (currentVsProtoBlobDelta > transformEpsilon) {
                            this._mesh.matrix.copy(protoBlobMatrix);
                            this._mesh.matrixAutoUpdate = false;
                        }
                        return true;
                    }
                }
            }
        }
        if (preferResolvedTransform) {
            if (currentVsResolvedDelta > transformEpsilon) {
                this._mesh.matrix.copy(resolvedTransform);
                this._mesh.matrixAutoUpdate = false;
            }
            return true;
        }
        const fallbackTransform = this._interface.getSafeFallbackTransformForMeshId(this._id);
        if (!fallbackTransform) {
            if (currentVsResolvedDelta > transformEpsilon) {
                this._mesh.matrix.copy(resolvedTransform);
                this._mesh.matrixAutoUpdate = false;
            }
            return true;
        }
        const nearFallbackEpsilon = Math.max(transformEpsilon, 1e-4);
        const currentVsFallbackDelta = getMatrixMaxElementDelta(currentMatrix, fallbackTransform);
        const resolvedVsFallbackDelta = getMatrixMaxElementDelta(resolvedTransform, fallbackTransform);
        const currentNearFallback = currentVsFallbackDelta <= nearFallbackEpsilon;
        const resolvedNearFallback = resolvedVsFallbackDelta <= nearFallbackEpsilon;
        const currentElements = currentMatrix.elements;
        const resolvedElements = resolvedTransform.elements;
        const fallbackElements = fallbackTransform.elements;
        const currentTranslationLength = Math.hypot(currentElements[12], currentElements[13], currentElements[14]);
        const resolvedTranslationLength = Math.hypot(resolvedElements[12], resolvedElements[13], resolvedElements[14]);
        const fallbackTranslationLength = Math.hypot(fallbackElements[12], fallbackElements[13], fallbackElements[14]);
        const currentLooksLocalRelativeToFallback = fallbackTranslationLength > 1e-6
            && currentTranslationLength < fallbackTranslationLength * 0.5;
        const resolvedLooksWorldRelativeToFallback = fallbackTranslationLength <= 1e-6
            || resolvedTranslationLength >= fallbackTranslationLength * 0.5;
        const keepResolvedPose = currentVsResolvedDelta <= transformEpsilon && resolvedLooksWorldRelativeToFallback;
        if (keepResolvedPose) {
            return true;
        }
        const shouldUseResolved = ((currentNearFallback && !resolvedNearFallback)
            || (resolvedLooksWorldRelativeToFallback && currentLooksLocalRelativeToFallback)
            || (resolvedLooksWorldRelativeToFallback && resolvedVsFallbackDelta + 1e-4 < currentVsFallbackDelta));
        if (!shouldUseResolved) {
            return false;
        }
        this._mesh.matrix.copy(resolvedTransform);
        this._mesh.matrixAutoUpdate = false;
        return true;
    }
    syncProtoTransformFromFallback() {
        if (!this._id.includes(".proto_"))
            return false;
        if (this.isCollisionProtoMesh()) {
            const resolvedCollisionPrimPath = this._interface.getResolvedPrimPathForMeshId(this._id);
            if (resolvedCollisionPrimPath)
                return false;
        }
        if (this.isVisualProtoMesh()) {
            const urdfVisualWorldTransform = this._interface.getVisualWorldTransformFromUrdfTruth(this._id);
            if (urdfVisualWorldTransform) {
                const shouldUpdate = getMatrixMaxElementDelta(this._mesh.matrix, urdfVisualWorldTransform) > transformEpsilon;
                if (!shouldUpdate)
                    return false;
                this._mesh.matrix.copy(urdfVisualWorldTransform);
                this._mesh.matrixAutoUpdate = false;
                return true;
            }
        }
        if (this.syncVisualTransformFromResolvedPrim())
            return true;
        const fallbackTransform = this._interface.getSafeFallbackTransformForMeshId(this._id);
        if (!fallbackTransform || !hasNonZeroTranslation(fallbackTransform))
            return false;
        const proto = parseProtoMeshIdentifier(this._id);
        const hasNoMeshTranslation = !hasNonZeroTranslation(this._mesh.matrix);
        if (!hasNoMeshTranslation) {
            // Some assets author proto transforms in link-local space (or even as inverse link
            // transforms). If we detect an inverse-link transform, compose fallback once so the
            // final mesh transform lands in world space consistently.
            const fallbackTranslationLength = Math.hypot(fallbackTransform.elements[12], fallbackTransform.elements[13], fallbackTransform.elements[14]);
            if (proto &&
                proto.sectionName === 'visuals' &&
                fallbackTranslationLength > 1e-3 &&
                isLikelyInverseTransform(this._mesh.matrix, fallbackTransform)) {
                this._mesh.matrix.premultiply(fallbackTransform);
                this._mesh.matrixAutoUpdate = false;
                return true;
            }
            // Some USD assets (notably H1-2 wrists) report sub-mesh local transforms for
            // additional visual prototypes (proto_mesh_id1+) while the sibling proto_mesh_id0
            // is already authored in link/world space. In that case we need to compose the
            // fallback link transform exactly once.
            if (!proto || proto.sectionName !== 'visuals' || proto.protoType !== 'mesh' || proto.protoIndex <= 0) {
                return false;
            }
            const meshElements = this._mesh.matrix.elements;
            const fallbackElements = fallbackTransform.elements;
            const fallbackTranslation = new Vector3(fallbackElements[12], fallbackElements[13], fallbackElements[14]);
            const meshTranslation = new Vector3(meshElements[12], meshElements[13], meshElements[14]);
            const translationDelta = meshTranslation.distanceTo(fallbackTranslation);
            if (translationDelta <= 1e-4)
                return false;
            const fallbackLength = fallbackTranslation.length();
            const meshLength = meshTranslation.length();
            if (fallbackLength > 1e-6 && meshLength >= fallbackLength * 0.8)
                return false;
            const siblingMeshId = `${proto.linkPath}/visuals.proto_mesh_id0`;
            const siblingMatrix = this._interface?.meshes?.[siblingMeshId]?._mesh?.matrix;
            if (!siblingMatrix)
                return false;
            const siblingElements = siblingMatrix.elements;
            const siblingTranslation = new Vector3(siblingElements[12], siblingElements[13], siblingElements[14]);
            const siblingLength = siblingTranslation.length();
            if (fallbackLength > 1e-6 && siblingLength < fallbackLength * 0.5)
                return false;
        }
        if (hasNoMeshTranslation && proto && proto.sectionName === 'visuals' && proto.protoType === 'mesh' && proto.protoIndex > 0) {
            const fallbackElements = fallbackTransform.elements;
            const fallbackTranslationLength = Math.hypot(fallbackElements[12], fallbackElements[13], fallbackElements[14]);
            if (fallbackTranslationLength > 1e-6) {
                const candidateMatrix = this._mesh.matrix.clone().premultiply(fallbackTransform);
                const siblingMeshId = `${proto.linkPath}/visuals.proto_mesh_id0`;
                const siblingMatrix = this._interface?.meshes?.[siblingMeshId]?._mesh?.matrix;
                if (siblingMatrix && getMatrixMaxElementDelta(candidateMatrix, siblingMatrix) <= transformEpsilon) {
                    // Only keep this conservative guard for stages that explicitly need it.
                    // For models like G1, unresolved proto_mesh_id1+ often start at identity and
                    // must still receive fallback link transforms to avoid visible detachment.
                    const shouldAvoidVisualSubmeshCollapse = this._interface?.shouldUseAggressiveVisualFallbackSync?.(this._id) === true;
                    if (shouldAvoidVisualSubmeshCollapse)
                        return false;
                }
            }
        }
        this._mesh.matrix.premultiply(fallbackTransform);
        this._mesh.matrixAutoUpdate = false;
        return true;
    }
    syncCollisionRotationFromVisualLink() {
        if (!this.isCollisionProtoMesh())
            return false;
        if (this._appliedCollisionOverride)
            return false;
        const resolvedPrimPath = this._interface.getResolvedPrimPathForMeshId(this._id);
        if (resolvedPrimPath)
            return false;
        const urdfWorldTransform = this._interface.getCollisionWorldTransformFromUrdfTruth(this._id);
        if (urdfWorldTransform) {
            this._mesh.matrix.copy(urdfWorldTransform);
            this._mesh.matrixAutoUpdate = false;
            return true;
        }
        const visualTransform = this._interface.getRepresentativeVisualTransformForMeshId(this._id);
        if (!visualTransform)
            return false;
        const currentPosition = this._decomposeScratchPositionA;
        const currentQuaternion = this._decomposeScratchQuaternionA;
        const currentScale = this._decomposeScratchScaleA;
        this._mesh.matrix.decompose(currentPosition, currentQuaternion, currentScale);
        const visualPosition = this._decomposeScratchPositionB;
        const visualQuaternion = this._decomposeScratchQuaternionB;
        const visualScale = this._decomposeScratchScaleB;
        visualTransform.decompose(visualPosition, visualQuaternion, visualScale);
        // Always apply visual rotation if it's not identity, regardless of current rotation
        // This ensures collision meshes follow visual meshes even if they have incorrect transforms
        if (!isIdentityQuaternion(visualQuaternion)) {
            this._mesh.matrix.compose(currentPosition, visualQuaternion, currentScale);
            this._mesh.matrixAutoUpdate = false;
            return true;
        }
        return false;
    }
    toTriangleIndexArray(faceVertexIndices, faceVertexCounts) {
        const sourceIndices = (faceVertexIndices && typeof faceVertexIndices.length === 'number')
            ? faceVertexIndices
            : EMPTY_UINT32_ARRAY;
        const sourceIndexLength = sourceIndices.length >>> 0;
        if (sourceIndexLength === 0)
            return EMPTY_UINT32_ARRAY;
        const sourceCounts = (faceVertexCounts && typeof faceVertexCounts.length === 'number')
            ? faceVertexCounts
            : null;
        if (!sourceCounts || sourceCounts.length === 0) {
            return sourceIndices;
        }
        let totalTriangles = 0;
        let cursor = 0;
        let allTriangles = true;
        for (let i = 0; i < sourceCounts.length; i++) {
            const countValue = sourceCounts[i];
            const count = countValue > 0 ? countValue : 0;
            if (count !== 3)
                allTriangles = false;
            if (count >= 3)
                totalTriangles += (count - 2);
            cursor += count;
            if (cursor >= sourceIndexLength) {
                if (cursor > sourceIndexLength)
                    allTriangles = false;
                break;
            }
        }
        if (allTriangles) {
            return sourceIndices;
        }
        if (totalTriangles <= 0) {
            return EMPTY_UINT32_ARRAY;
        }
        const triangles = new Uint32Array(totalTriangles * 3);
        cursor = 0;
        let writeOffset = 0;
        for (let i = 0; i < sourceCounts.length; i++) {
            const countValue = sourceCounts[i];
            const count = countValue > 0 ? countValue : 0;
            if (count >= 3) {
                if (cursor + count > sourceIndexLength)
                    break;
                const first = sourceIndices[cursor];
                for (let vertexIndex = 1; vertexIndex < count - 1; vertexIndex++) {
                    triangles[writeOffset++] = first;
                    triangles[writeOffset++] = sourceIndices[cursor + vertexIndex];
                    triangles[writeOffset++] = sourceIndices[cursor + vertexIndex + 1];
                }
            }
            cursor += count;
            if (cursor >= sourceIndexLength)
                break;
        }
        return writeOffset === triangles.length ? triangles : triangles.subarray(0, writeOffset);
    }
    applyUsdMeshGeometry(prim) {
        const pointsValue = prim?.GetAttribute?.('points')?.Get?.();
        if (!pointsValue || typeof pointsValue.length !== 'number' || pointsValue.length === 0)
            return false;
        const positions = new Float32Array(pointsValue.length * 3);
        for (let index = 0; index < pointsValue.length; index++) {
            const point = pointsValue[index];
            const x = Number(point?.[0] ?? point?.x ?? 0);
            const y = Number(point?.[1] ?? point?.y ?? 0);
            const z = Number(point?.[2] ?? point?.z ?? 0);
            positions[index * 3 + 0] = Number.isFinite(x) ? x : 0;
            positions[index * 3 + 1] = Number.isFinite(y) ? y : 0;
            positions[index * 3 + 2] = Number.isFinite(z) ? z : 0;
        }
        const faceVertexIndices = prim.GetAttribute('faceVertexIndices')?.Get?.();
        const faceVertexCounts = prim.GetAttribute('faceVertexCounts')?.Get?.();
        const triangulatedIndices = this.toTriangleIndexArray(faceVertexIndices, faceVertexCounts);
        let nextGeometry = new BufferGeometry();
        nextGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
        if (triangulatedIndices.length > 0) {
            nextGeometry.setIndex(triangulatedIndices);
        }

        // Check if USD has explicit normals - use them instead of recomputing
        const normalsValue = prim?.GetAttribute?.('normals')?.Get?.();
        if (normalsValue && normalsValue.length > 0 && normalsValue.length === pointsValue.length) {
            const normals = new Float32Array(normalsValue.length * 3);
            for (let index = 0; index < normalsValue.length; index++) {
                const normal = normalsValue[index];
                const nx = Number(normal?.[0] ?? normal?.x ?? 0);
                const ny = Number(normal?.[1] ?? normal?.y ?? 0);
                const nz = Number(normal?.[2] ?? normal?.z ?? 0);
                const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                if (len > 1e-12) {
                    const invLen = 1 / len;
                    normals[index * 3 + 0] = nx * invLen;
                    normals[index * 3 + 1] = ny * invLen;
                    normals[index * 3 + 2] = nz * invLen;
                } else {
                    normals[index * 3 + 0] = 0;
                    normals[index * 3 + 1] = 1;
                    normals[index * 3 + 2] = 0;
                }
            }
            nextGeometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
        } else {
            nextGeometry.computeVertexNormals();
        }

        nextGeometry.computeBoundingBox();
        nextGeometry.computeBoundingSphere();

        // Apply vertex normal smoothing to reduce triangle visibility
        nextGeometry = this._smoothGeometryNormals(nextGeometry);

        this.replaceGeometry(nextGeometry);
        return true;
    }

    /**
     * Smooth geometry normals to reduce triangle visibility and improve shading
     * This merges normals for vertices at the same position to create smooth shading
     */
    _smoothGeometryNormals(geometry) {
        const normals = geometry.getAttribute('normal');
        const position = geometry.getAttribute('position');
        const index = geometry.getIndex();

        if (!normals || !position) {
            return geometry;
        }

        const normalsArray = normals.array;
        const positionsArray = position.array;
        const count = position.count;

        // Map from position key to list of vertex indices with same position
        const vertexMap = new Map();
        const POSITION_PRECISION = 1e-5; // Precision for position comparison

        // Build vertex position map
        if (index) {
            // Indexed geometry: map positions based on vertex indices
            for (let i = 0; i < index.count; i++) {
                const idx = index.getX(i);
                const px = positionsArray[idx * 3];
                const py = positionsArray[idx * 3 + 1];
                const pz = positionsArray[idx * 3 + 2];
                const key = `${Math.round(px / POSITION_PRECISION)},${Math.round(py / POSITION_PRECISION)},${Math.round(pz / POSITION_PRECISION)}`;

                if (!vertexMap.has(key)) {
                    vertexMap.set(key, []);
                }
                vertexMap.get(key).push(idx);
            }
        } else {
            // Non-indexed geometry: direct mapping
            for (let i = 0; i < count; i++) {
                const px = positionsArray[i * 3];
                const py = positionsArray[i * 3 + 1];
                const pz = positionsArray[i * 3 + 2];
                const key = `${Math.round(px / POSITION_PRECISION)},${Math.round(py / POSITION_PRECISION)},${Math.round(pz / POSITION_PRECISION)}`;

                if (!vertexMap.has(key)) {
                    vertexMap.set(key, []);
                }
                vertexMap.get(key).push(i);
            }
        }

        // Smooth normals for vertices at same position
        for (const vertices of vertexMap.values()) {
            if (vertices.length <= 1) {
                continue;
            }

            // Calculate average normal for all vertices at same position
            let nx = 0, ny = 0, nz = 0;
            for (const vIdx of vertices) {
                nx += normalsArray[vIdx * 3];
                ny += normalsArray[vIdx * 3 + 1];
                nz += normalsArray[vIdx * 3 + 2];
            }

            // Normalize
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
            if (len > 1e-12) {
                const invLen = 1 / len;
                nx *= invLen;
                ny *= invLen;
                nz *= invLen;
            } else {
                nx = 0; ny = 1; nz = 0;
            }

            // Apply smoothed normal to all vertices
            for (const vIdx of vertices) {
                normalsArray[vIdx * 3] = nx;
                normalsArray[vIdx * 3 + 1] = ny;
                normalsArray[vIdx * 3 + 2] = nz;
            }
        }

        normals.needsUpdate = true;
        return geometry;
    }
    getExtentDimensions(prim) {
        const extent = prim?.GetAttribute?.('extent')?.Get?.();
        if (!extent || extent.length < 2)
            return null;
        const minimum = extent[0];
        const maximum = extent[1];
        const width = Math.abs(Number(maximum?.[0] ?? 0) - Number(minimum?.[0] ?? 0));
        const height = Math.abs(Number(maximum?.[1] ?? 0) - Number(minimum?.[1] ?? 0));
        const depth = Math.abs(Number(maximum?.[2] ?? 0) - Number(minimum?.[2] ?? 0));
        if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(depth))
            return null;
        return [Math.max(width, 1e-6), Math.max(height, 1e-6), Math.max(depth, 1e-6)];
    }
    applyUsdPrimitiveGeometry(prim, primType) {
        const dimensionsFromExtent = this.getExtentDimensions(prim);
        const descriptor = {
            size: toFiniteNumber(prim.GetAttribute('size')?.Get?.()),
            radius: toFiniteNumber(prim.GetAttribute('radius')?.Get?.()),
            height: toFiniteNumber(prim.GetAttribute('height')?.Get?.()),
            axis: String(prim.GetAttribute('axis')?.Get?.() || 'Z').toUpperCase(),
            extentSize: dimensionsFromExtent || undefined,
        };
        return this.applyPrimitiveGeometryFromDescriptor(primType, descriptor) === true;
    }
    applyCollisionGeometryFromOverrides() {
        if (!this._id)
            return false;
        const loweredId = this._id.toLowerCase();
        const isCollision = COLLISION_SEGMENT_PATTERN.test(loweredId);
        if (!isCollision)
            return false;
        const driverOverride = this._interface?.getCollisionProtoOverride?.(this._id) || null;
        if (driverOverride && this.applyCollisionGeometryFromDriverOverride(driverOverride)) {
            this._primitiveFallbackType = null;
            this._hasGeneratedPrimitiveFallback = true;
            return true;
        }
        const primPath = this._interface.getCollisionOverridePrimPath(this._id);
        if (!primPath)
            return false;
        if (!this.applyResolvedPrimGeometryAndTransform(primPath))
            return false;
        this._primitiveFallbackType = null;
        this._hasGeneratedPrimitiveFallback = true;
        return true;
    }
    applyVisualColorOverride() {
        if (!this._id || COLLISION_SEGMENT_PATTERN.test(this._id))
            return;
        const override = this._interface.getVisualColorOverride(this._id);
        if (!override)
            return;
        const materials = Array.isArray(this._mesh.material) ? this._mesh.material : [this._mesh.material];
        for (const material of materials) {
            if (!material || !material.color || material.map)
                continue;
            setHydraColorFromTuple(material.color, override);
            material.needsUpdate = true;
        }
    }
    _nowMs() {
        return (typeof performance !== "undefined" && typeof performance.now === "function")
            ? performance.now()
            : Date.now();
    }
    _addGpuUploadSample(profile, durationMs) {
        if (!profile)
            return;
        profile.gpuUploadMs = (Number(profile.gpuUploadMs) || 0) + (Number(durationMs) || 0);
    }
    _isHeapBackedView(view, heapView) {
        return !!(view && ArrayBuffer.isView(view) && heapView && view.buffer === heapView.buffer);
    }
    _resolveWasmHeapViews() {
        const candidates = [
            globalThis?.Module,
            globalThis?.USD,
            globalThis?.USD_WASM_MODULE,
        ];
        for (const candidate of candidates) {
            if (!candidate || typeof candidate !== 'object')
                continue;
            const heapF32 = candidate.HEAPF32;
            const heapU32 = candidate.HEAPU32;
            if ((heapF32 && Number(heapF32.length || 0) > 0) || (heapU32 && Number(heapU32.length || 0) > 0)) {
                return {
                    moduleRef: candidate,
                    heapF32: heapF32 || null,
                    heapU32: heapU32 || null,
                };
            }
        }
        const fallback = candidates.find((candidate) => candidate && typeof candidate === 'object') || null;
        return {
            moduleRef: fallback,
            heapF32: fallback?.HEAPF32 || null,
            heapU32: fallback?.HEAPU32 || null,
        };
    }
    _toStableFloat32Array(data, expectedLength = null) {
        if (!data || typeof data.length !== 'number')
            return null;
        const rawLength = Number(data.length);
        if (!Number.isFinite(rawLength) || rawLength <= 0)
            return null;
        const parsedExpectedLength = Number(expectedLength);
        const hasExpectedLength = expectedLength !== null
            && expectedLength !== undefined
            && Number.isFinite(parsedExpectedLength)
            && parsedExpectedLength >= 0;
        const normalizedLength = hasExpectedLength
            ? Math.min(Math.floor(parsedExpectedLength), Math.floor(rawLength))
            : Math.floor(rawLength);
        if (normalizedLength <= 0)
            return null;
        const heapF32 = this._resolveWasmHeapViews().heapF32;
        if (data instanceof Float32Array) {
            const view = normalizedLength === data.length ? data : data.subarray(0, normalizedLength);
            if (!this._isHeapBackedView(view, heapF32))
                return view;
            return view.slice(0);
        }
        if (ArrayBuffer.isView(data)) {
            const source = typeof data.subarray === 'function'
                ? data.subarray(0, normalizedLength)
                : data;
            const copied = new Float32Array(normalizedLength);
            copied.set(source);
            return copied;
        }
        if (Array.isArray(data)) {
            return Float32Array.from(data.slice(0, normalizedLength));
        }
        return null;
    }
    _toStableUint32Array(data, expectedLength = null) {
        if (!data || typeof data.length !== 'number')
            return null;
        const rawLength = Number(data.length);
        if (!Number.isFinite(rawLength) || rawLength <= 0)
            return null;
        const parsedExpectedLength = Number(expectedLength);
        const hasExpectedLength = expectedLength !== null
            && expectedLength !== undefined
            && Number.isFinite(parsedExpectedLength)
            && parsedExpectedLength >= 0;
        const normalizedLength = hasExpectedLength
            ? Math.min(Math.floor(parsedExpectedLength), Math.floor(rawLength))
            : Math.floor(rawLength);
        if (normalizedLength <= 0)
            return null;
        const heapU32 = this._resolveWasmHeapViews().heapU32;
        if (data instanceof Uint32Array) {
            const view = normalizedLength === data.length ? data : data.subarray(0, normalizedLength);
            if (!this._isHeapBackedView(view, heapU32))
                return view;
            return view.slice(0);
        }
        if (ArrayBuffer.isView(data)) {
            const source = typeof data.subarray === 'function'
                ? data.subarray(0, normalizedLength)
                : data;
            const copied = new Uint32Array(normalizedLength);
            copied.set(source);
            return copied;
        }
        if (Array.isArray(data)) {
            return Uint32Array.from(data.slice(0, normalizedLength));
        }
        return null;
    }
    _buildMatrix4FromRowMajorSource(matrixLike) {
        if (!matrixLike)
            return null;
        let source = null;
        if (Array.isArray(matrixLike) || ArrayBuffer.isView(matrixLike) || typeof matrixLike.length === 'number') {
            source = matrixLike;
        }
        else if (typeof matrixLike[Symbol.iterator] === 'function') {
            const materialized = new Float64Array(16);
            let index = 0;
            for (const value of matrixLike) {
                if (index >= 16)
                    break;
                const numeric = Number(value);
                if (!Number.isFinite(numeric))
                    return null;
                materialized[index] = numeric;
                index += 1;
            }
            if (index < 16)
                return null;
            source = materialized;
        }
        else {
            return null;
        }
        if (!source || Number(source.length) < 16)
            return null;
        const m00 = Number(source[0]);
        const m01 = Number(source[1]);
        const m02 = Number(source[2]);
        const m03 = Number(source[3]);
        const m10 = Number(source[4]);
        const m11 = Number(source[5]);
        const m12 = Number(source[6]);
        const m13 = Number(source[7]);
        const m20 = Number(source[8]);
        const m21 = Number(source[9]);
        const m22 = Number(source[10]);
        const m23 = Number(source[11]);
        const m30 = Number(source[12]);
        const m31 = Number(source[13]);
        const m32 = Number(source[14]);
        const m33 = Number(source[15]);
        if (!Number.isFinite(m00) || !Number.isFinite(m01) || !Number.isFinite(m02) || !Number.isFinite(m03)
            || !Number.isFinite(m10) || !Number.isFinite(m11) || !Number.isFinite(m12) || !Number.isFinite(m13)
            || !Number.isFinite(m20) || !Number.isFinite(m21) || !Number.isFinite(m22) || !Number.isFinite(m23)
            || !Number.isFinite(m30) || !Number.isFinite(m31) || !Number.isFinite(m32) || !Number.isFinite(m33)) {
            return null;
        }
        const matrix = new Matrix4();
        matrix.set(m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33);
        matrix.transpose();
        return matrix;
    }
    _setMatrixFromRowMajorSource(matrixLike) {
        const matrix = this._buildMatrix4FromRowMajorSource(matrixLike);
        if (!matrix)
            return false;
        this._mesh.matrix.copy(matrix);
        return true;
    }
    _setMatrixFromTransformOverride(transformOverride, rowMajorSource = null) {
        if (transformOverride && transformOverride.isMatrix4 === true && typeof transformOverride.clone === 'function') {
            this._mesh.matrix.copy(transformOverride);
            return true;
        }
        return this._setMatrixFromRowMajorSource(rowMajorSource || transformOverride);
    }
    _buildGeomSubsetSignature(sections) {
        if (!Array.isArray(sections) || sections.length === 0)
            return '';
        if (sections.length > 2048)
            return `sections:${sections.length}`;
        const signatureParts = new Array(sections.length);
        for (let index = 0; index < sections.length; index++) {
            const section = sections[index];
            if (!section) {
                signatureParts[index] = '#';
                continue;
            }
            const start = Number(section.start);
            const length = Number(section.length);
            const materialId = normalizeHydraPath(section.materialId);
            signatureParts[index] = `${Number.isFinite(start) ? start : 'n'}:${Number.isFinite(length) ? length : 'n'}:${materialId}`;
        }
        return signatureParts.join('|');
    }
    reorderIndexedAttributes(profile = null, phase = "unknown") {
        if (!this._indices)
            return;
        const reorderStart = this._nowMs();
        this.updateOrder(this._points, 'position', 3, profile, phase);
        this.updateOrder(this._normals, 'normal', 3, profile, phase);
        if (this._colors) {
            this.updateOrder(this._colors, 'color', 3, profile, phase);
        }
        if (this._uvs) {
            this.updateOrder(this._uvs, 'uv', 2, profile, phase);
            this._geometry.attributes.uv2 = this._geometry.attributes.uv;
        }
        const reorderEnd = this._nowMs();
        const reorderMs = reorderEnd - reorderStart;
        if (profile) {
            if (phase === "indices") {
                profile.indicesReorderMs = (Number(profile.indicesReorderMs) || 0) + reorderMs;
            }
            else if (phase === "points") {
                profile.pointsReorderMs = (Number(profile.pointsReorderMs) || 0) + reorderMs;
            }
            else {
                profile.deferredReorderMs = (Number(profile.deferredReorderMs) || 0) + reorderMs;
            }
        }
        this._needsNormalFallback = true;
    }
    updateOrder(attribute, attributeName, dimension = 3, profile = null, phase = "unknown", options = null) {
        if (!attribute || !this._indices)
            return;
        const loopStart = this._nowMs();
        const indices = this._indices;
        const indexCount = indices.length >>> 0;
        if (indexCount <= 0)
            return;
        const targetLength = indexCount * dimension;
        let reusableAttribute = null;
        let values = null;
        if (options?.reuse !== false) {
            const existingAttribute = this._geometry.getAttribute(attributeName);
            if (existingAttribute
                && existingAttribute.itemSize === dimension
                && existingAttribute.array instanceof Float32Array
                && existingAttribute.array.length === targetLength) {
                reusableAttribute = existingAttribute;
                values = existingAttribute.array;
                values.fill(0);
            }
        }
        if (!values) {
            values = new Float32Array(targetLength);
        }
        const attributeLength = attribute.length >>> 0;
        const useTypedArrayFastPath = attribute instanceof Float32Array && indices instanceof Uint32Array;
        if (useTypedArrayFastPath && dimension === 3) {
            for (let i = 0; i < indexCount; i++) {
                const sourceBase = indices[i] * 3;
                const targetBase = i * 3;
                if ((sourceBase + 2) >= attributeLength)
                    continue;
                values[targetBase + 0] = attribute[sourceBase + 0];
                values[targetBase + 1] = attribute[sourceBase + 1];
                values[targetBase + 2] = attribute[sourceBase + 2];
            }
        }
        else if (useTypedArrayFastPath && dimension === 2) {
            for (let i = 0; i < indexCount; i++) {
                const sourceBase = indices[i] * 2;
                const targetBase = i * 2;
                if ((sourceBase + 1) >= attributeLength)
                    continue;
                values[targetBase + 0] = attribute[sourceBase + 0];
                values[targetBase + 1] = attribute[sourceBase + 1];
            }
        }
        else {
            for (let i = 0; i < indexCount; i++) {
                const sourceBase = indices[i] * dimension;
                const targetBase = i * dimension;
                if ((sourceBase + dimension) > attributeLength)
                    continue;
                for (let j = 0; j < dimension; ++j) {
                    values[targetBase + j] = attribute[sourceBase + j];
                }
            }
        }
        const loopEnd = this._nowMs();
        if (profile) {
            const loopMs = loopEnd - loopStart;
            if (phase === "indices")
                profile.indicesLoopMs = (Number(profile.indicesLoopMs) || 0) + loopMs;
            if (phase === "points")
                profile.pointsLoopMs = (Number(profile.pointsLoopMs) || 0) + loopMs;
            if (phase === "primvars")
                profile.primvarLoopMs = (Number(profile.primvarLoopMs) || 0) + loopMs;
            if (phase === "deferred") {
                profile.indicesLoopMs = (Number(profile.indicesLoopMs) || 0) + loopMs;
                profile.pointsLoopMs = (Number(profile.pointsLoopMs) || 0) + loopMs;
            }
        }
        const uploadStart = this._nowMs();
        if (reusableAttribute) {
            reusableAttribute.needsUpdate = true;
        }
        else {
            this._geometry.setAttribute(attributeName, new Float32BufferAttribute(values, dimension));
        }
        if (attributeName === 'normal') {
            this._needsNormalSanitization = true;
        }
        const uploadEnd = this._nowMs();
        this._addGpuUploadSample(profile, uploadEnd - uploadStart);
    }
    updateIndices(indices, profile = null, options = null) {
        if (!indices || typeof indices.length !== "number")
            return;
        const deferReorder = options?.deferReorder === true;
        const totalStart = this._nowMs();
        if (profile) {
            profile.indicesForLoopUsed = true;
            const heapU32 = this._resolveWasmHeapViews().heapU32;
            profile.indicesFromHeapU32 = !!(ArrayBuffer.isView(indices) && heapU32 && indices.buffer === heapU32.buffer);
        }
        const copyStart = this._nowMs();
        const indexCount = indices.length >>> 0;
        const copied = this._toStableUint32Array(indices, indexCount);
        if (!copied)
            return;
        const copyEnd = this._nowMs();
        if (copied.length > 0) {
            this._hasHydraGeometryPayload = true;
        }
        if (profile) {
            profile.indicesCopyMs = (Number(profile.indicesCopyMs) || 0) + (copyEnd - copyStart);
        }
        this._expandedSharedVertexIndices = undefined;
        this._indices = copied;
        if (!deferReorder) {
            this.reorderIndexedAttributes(profile, "indices");
        }
        if (profile) {
            profile.indicesTotalMs = (Number(profile.indicesTotalMs) || 0) + (this._nowMs() - totalStart);
        }
    }
    /**
     * Sets the transform of the mesh.
     * @param {Iterable<number>} matrix - The 4x4 matrix to set on the mesh.
     */
    setTransform(matrix) {
        if (!matrix)
            return;
        const canIndexMatrix = Array.isArray(matrix)
            || ArrayBuffer.isView(matrix)
            || typeof matrix.length === "number"
            || typeof matrix[Symbol.iterator] === "function";
        if (!canIndexMatrix)
            return;
        const interfaceRef = this._interface;
        const hasSyncHotPathGuard = !!interfaceRef
            && typeof interfaceRef.enterHydraSyncHotPath === "function"
            && typeof interfaceRef.leaveHydraSyncHotPath === "function";
        if (hasSyncHotPathGuard) {
            interfaceRef.enterHydraSyncHotPath();
        }
        try {
            this._hasEverReceivedTransform = true;
            if (!this._setMatrixFromRowMajorSource(matrix)) {
                return;
            }
            if (this._id.includes(".proto_")) {
                if (this.shouldDeferProtoStageSyncUntilSceneSnapshot()) {
                    this._hasCompletedProtoSync = false;
                    this._mesh.matrixAutoUpdate = false;
                    return;
                }
                if (this.isCollisionProtoMesh()) {
                    const resolvedPrimPath = this._interface.getResolvedPrimPathForMeshId(this._id);
                    let geometryApplied = this._appliedCollisionOverride === true;
                    if (!geometryApplied) {
                        geometryApplied = this.applyCollisionGeometryFromOverrides() === true;
                    }
                    if (resolvedPrimPath && !geometryApplied) {
                        geometryApplied = this.applyResolvedPrimGeometryAndTransform(resolvedPrimPath) === true;
                    }
                    this.syncCollisionRotationFromVisualLink();
                    // Keep sync pending until collision override geometry is actually resolved.
                    this._hasCompletedProtoSync = geometryApplied;
                    this._mesh.matrixAutoUpdate = false;
                    return;
                }
                else if (this.isVisualProtoMesh()) {
                    const urdfVisualWorldTransform = this._interface.getVisualWorldTransformFromUrdfTruth(this._id);
                    if (urdfVisualWorldTransform) {
                        this._mesh.matrix.copy(urdfVisualWorldTransform);
                        this._hasCompletedProtoSync = true;
                        this._mesh.matrixAutoUpdate = false;
                        return;
                    }
                }
                this.applyProtoStageSync();
            }
            this._mesh.matrixAutoUpdate = false;
        }
        finally {
            if (typeof interfaceRef?.updateRepresentativeVisualTransformIndex === 'function') {
                interfaceRef.updateRepresentativeVisualTransformIndex(this._id, this._mesh.matrix);
            }
            if (this.isVisualProtoMesh()) {
                this.restackSiblingVisualProtoMeshes();
            }
            if (hasSyncHotPathGuard) {
                interfaceRef.leaveHydraSyncHotPath();
            }
        }
    }
    _shouldUseGeneratedNormals(normals) {
        const generatedLength = Number(normals?.length || 0);
        if (generatedLength <= 0)
            return false;
        const existingNormals = this._geometry?.getAttribute?.('normal');
        if (!existingNormals || existingNormals.count <= 0) {
            return true;
        }
        const existingArray = existingNormals.array;
        const existingLength = Number(existingArray?.length || 0);
        if (existingLength <= 0)
            return true;
        if (existingLength !== generatedLength) {
            // Attribute size mismatch usually means authored data is inconsistent with
            // current topology, prefer generated smooth normals in this case.
            return true;
        }
        const tripletCount = Math.floor(existingLength / 3);
        if (tripletCount <= 0)
            return true;
        const maxSamples = 2048;
        const sampleCount = Math.min(tripletCount, maxSamples);
        const stride = Math.max(1, Math.floor(tripletCount / sampleCount));
        let sampled = 0;
        let invalid = 0;
        const zeroLengthEpsilon = 1e-10;
        for (let normalIndex = 0; normalIndex < tripletCount && sampled < sampleCount; normalIndex += stride) {
            const base = normalIndex * 3;
            const x = Number(existingArray[base]);
            const y = Number(existingArray[base + 1]);
            const z = Number(existingArray[base + 2]);
            sampled += 1;
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
                invalid += 1;
                continue;
            }
            const lengthSq = x * x + y * y + z * z;
            if (lengthSq <= zeroLengthEpsilon) {
                invalid += 1;
            }
        }
        if (sampled <= 0)
            return true;
        // A small amount of bad authored normals is tolerated; beyond this threshold
        // we prefer robust generated normals from Hydra/OpenUSD.
        const invalidRatio = invalid / sampled;
        return invalidRatio >= 0.02;
    }
    _trySetDirectNonIndexedAttribute(attributeName, data, dimension, profile = null) {
        if (this._indices) {
            return false;
        }
        const geometry = this._geometry;
        const positionAttribute = geometry?.getAttribute?.('position');
        const vertexCount = normalizeLength(positionAttribute?.count);
        const safeDimension = Math.max(1, normalizeLength(dimension));
        if (!(vertexCount > 0 && safeDimension > 0)) {
            return false;
        }
        const expectedLength = vertexCount * safeDimension;
        const stable = this._toStableFloat32Array(data, expectedLength);
        if (!stable || stable.length !== expectedLength) {
            return false;
        }
        const existingAttribute = geometry.getAttribute?.(attributeName);
        const uploadStart = this._nowMs();
        if (existingAttribute
            && existingAttribute.itemSize === safeDimension
            && existingAttribute.array instanceof Float32Array
            && existingAttribute.array.length === expectedLength) {
            existingAttribute.array.set(stable);
            existingAttribute.needsUpdate = true;
        }
        else {
            geometry.setAttribute(attributeName, new Float32BufferAttribute(stable, safeDimension));
        }
        if (attributeName === 'normal') {
            this._needsNormalSanitization = true;
        }
        const uploadEnd = this._nowMs();
        this._addGpuUploadSample(profile, uploadEnd - uploadStart);
        return true;
    }
    /**
     * Sets automatically generated normals on the mesh. Prefer generated normals
     * when authored normals are absent or clearly invalid.
     * @param {} normals
     */
    updateNormals(normals, profile = null) {
        if (!normals || typeof normals.length !== 'number')
            return;
        if (!this._shouldUseGeneratedNormals(normals))
            return;
        const copyStart = this._nowMs();
        this._normals = this._toStableFloat32Array(normals);
        if (!this._normals)
            return;
        const copyEnd = this._nowMs();
        if (profile) {
            profile.primvarCopyMs = (Number(profile.primvarCopyMs) || 0) + (copyEnd - copyStart);
        }
        if (this._trySetDirectNonIndexedAttribute('normal', this._normals, 3, profile)) {
            this._needsNormalFallback = false;
            return;
        }
        this.updateOrder(this._normals, 'normal', 3, profile, "primvars");
        this._needsNormalFallback = false;
    }
    _captureExpandedSharedVertexIndices(indices, expectedCount = 0) {
        const indexCount = normalizeLength(expectedCount || indices?.length || 0);
        if (!(indices && indexCount > 0)) {
            this._expandedSharedVertexIndices = undefined;
            return null;
        }
        const copied = this._toStableUint32Array(indices, indexCount);
        this._expandedSharedVertexIndices = copied && copied.length === indexCount
            ? copied
            : undefined;
        return this._expandedSharedVertexIndices || null;
    }
    _buildExpandedSharedVertexNormals(positionAttribute, sharedVertexIndices = this._expandedSharedVertexIndices) {
        const positions = positionAttribute?.array;
        const vertexCount = normalizeLength(positionAttribute?.count);
        if (!(positions && sharedVertexIndices instanceof Uint32Array) || vertexCount <= 0 || vertexCount % 3 !== 0) {
            return null;
        }
        if (sharedVertexIndices.length < vertexCount) {
            return null;
        }
        let maxReferencedVertex = -1;
        for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
            const referencedVertex = sharedVertexIndices[vertexIndex] >>> 0;
            if (referencedVertex > maxReferencedVertex) {
                maxReferencedVertex = referencedVertex;
            }
        }
        if (maxReferencedVertex < 0) {
            return null;
        }
        const accumulatedNormals = new Float32Array((maxReferencedVertex + 1) * 3);
        const rebuiltNormals = new Float32Array(vertexCount * 3);
        for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 3) {
            const p0 = vertexIndex * 3;
            const p1 = (vertexIndex + 1) * 3;
            const p2 = (vertexIndex + 2) * 3;
            const ux = Number(positions[p1]) - Number(positions[p0]);
            const uy = Number(positions[p1 + 1]) - Number(positions[p0 + 1]);
            const uz = Number(positions[p1 + 2]) - Number(positions[p0 + 2]);
            const vx = Number(positions[p2]) - Number(positions[p0]);
            const vy = Number(positions[p2 + 1]) - Number(positions[p0 + 1]);
            const vz = Number(positions[p2 + 2]) - Number(positions[p0 + 2]);
            const nx = (uy * vz) - (uz * vy);
            const ny = (uz * vx) - (ux * vz);
            const nz = (ux * vy) - (uy * vx);
            const lenSq = nx * nx + ny * ny + nz * nz;
            if (!Number.isFinite(lenSq) || lenSq <= 1e-14) {
                continue;
            }
            const invLen = 1 / Math.sqrt(lenSq);
            const faceNormalX = nx * invLen;
            const faceNormalY = ny * invLen;
            const faceNormalZ = nz * invLen;
            for (let corner = 0; corner < 3; corner++) {
                const dst = (sharedVertexIndices[vertexIndex + corner] >>> 0) * 3;
                accumulatedNormals[dst] += faceNormalX;
                accumulatedNormals[dst + 1] += faceNormalY;
                accumulatedNormals[dst + 2] += faceNormalZ;
            }
        }
        let assignedNormalCount = 0;
        for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
            const source = (sharedVertexIndices[vertexIndex] >>> 0) * 3;
            const nx = accumulatedNormals[source];
            const ny = accumulatedNormals[source + 1];
            const nz = accumulatedNormals[source + 2];
            const lenSq = nx * nx + ny * ny + nz * nz;
            if (!Number.isFinite(lenSq) || lenSq <= 1e-14) {
                continue;
            }
            const invLen = 1 / Math.sqrt(lenSq);
            const dst = vertexIndex * 3;
            rebuiltNormals[dst] = nx * invLen;
            rebuiltNormals[dst + 1] = ny * invLen;
            rebuiltNormals[dst + 2] = nz * invLen;
            assignedNormalCount += 1;
        }
        return assignedNormalCount > 0 ? rebuiltNormals : null;
    }
    _repairNonIndexedNormalsAgainstFaceWinding(positionAttribute, normalAttribute, vertexCount) {
        if (this._geometry?.getIndex?.()) {
            return false;
        }
        const positions = positionAttribute?.array;
        const normals = normalAttribute?.array;
        const count = normalizeLength(vertexCount);
        if (!(positions && normals) || count < 3 || (count % 3) !== 0) {
            return false;
        }
        if (positions.length < count * 3 || normals.length < count * 3) {
            return false;
        }
        let repaired = false;
        for (let vertexIndex = 0; vertexIndex < count; vertexIndex += 3) {
            const p0 = vertexIndex * 3;
            const p1 = (vertexIndex + 1) * 3;
            const p2 = (vertexIndex + 2) * 3;
            const ux = Number(positions[p1]) - Number(positions[p0]);
            const uy = Number(positions[p1 + 1]) - Number(positions[p0 + 1]);
            const uz = Number(positions[p1 + 2]) - Number(positions[p0 + 2]);
            const vx = Number(positions[p2]) - Number(positions[p0]);
            const vy = Number(positions[p2 + 1]) - Number(positions[p0 + 1]);
            const vz = Number(positions[p2 + 2]) - Number(positions[p0 + 2]);
            let faceNormalX = (uy * vz) - (uz * vy);
            let faceNormalY = (uz * vx) - (ux * vz);
            let faceNormalZ = (ux * vy) - (uy * vx);
            const faceLenSq = faceNormalX * faceNormalX + faceNormalY * faceNormalY + faceNormalZ * faceNormalZ;
            if (!Number.isFinite(faceLenSq) || faceLenSq <= NORMAL_REPAIR_EPSILON) {
                continue;
            }
            const invFaceLen = 1 / Math.sqrt(faceLenSq);
            faceNormalX *= invFaceLen;
            faceNormalY *= invFaceLen;
            faceNormalZ *= invFaceLen;
            for (let corner = 0; corner < 3; corner++) {
                const normalBase = (vertexIndex + corner) * 3;
                const normalX = Number(normals[normalBase]);
                const normalY = Number(normals[normalBase + 1]);
                const normalZ = Number(normals[normalBase + 2]);
                const normalLenSq = normalX * normalX + normalY * normalY + normalZ * normalZ;
                if (!Number.isFinite(normalLenSq) || normalLenSq <= NORMAL_REPAIR_EPSILON) {
                    continue;
                }
                const invNormalLen = 1 / Math.sqrt(normalLenSq);
                const dot = (normalX * invNormalLen * faceNormalX)
                    + (normalY * invNormalLen * faceNormalY)
                    + (normalZ * invNormalLen * faceNormalZ);
                if (dot >= NORMAL_REPAIR_DOT_THRESHOLD) {
                    continue;
                }
                normals[normalBase] = faceNormalX;
                normals[normalBase + 1] = faceNormalY;
                normals[normalBase + 2] = faceNormalZ;
                repaired = true;
            }
        }
        return repaired;
    }
    _countInvalidNormalTriplets(normals, expectedVertexCount = null) {
        const tripletCount = expectedVertexCount !== null
            ? Math.min(normalizeLength(expectedVertexCount), Math.floor(Number(normals?.length || 0) / 3))
            : Math.floor(Number(normals?.length || 0) / 3);
        if (!(normals && tripletCount > 0)) {
            return 0;
        }
        let invalidCount = 0;
        for (let vertexIndex = 0; vertexIndex < tripletCount; vertexIndex++) {
            const base = vertexIndex * 3;
            const x = Number(normals[base]);
            const y = Number(normals[base + 1]);
            const z = Number(normals[base + 2]);
            const lenSq = x * x + y * y + z * z;
            const len = Number.isFinite(lenSq) && lenSq > 1e-10 ? Math.sqrt(lenSq) : 0;
            const isValid = Number.isFinite(x)
                && Number.isFinite(y)
                && Number.isFinite(z)
                && len >= 0.9
                && len <= 1.1;
            if (!isValid) {
                invalidCount += 1;
            }
        }
        return invalidCount;
    }
    _shouldPreferExpandedIndexedNormals(currentExpandedNormals, candidateExpandedNormals, expectedVertexCount = null) {
        const vertexCount = expectedVertexCount !== null
            ? normalizeLength(expectedVertexCount)
            : Math.min(Math.floor(Number(currentExpandedNormals?.length || 0) / 3), Math.floor(Number(candidateExpandedNormals?.length || 0) / 3));
        if (!(currentExpandedNormals instanceof Float32Array)
            || !(candidateExpandedNormals instanceof Float32Array)
            || vertexCount <= 0) {
            return false;
        }
        const currentInvalidCount = this._countInvalidNormalTriplets(currentExpandedNormals, vertexCount);
        const candidateInvalidCount = this._countInvalidNormalTriplets(candidateExpandedNormals, vertexCount);
        if (currentInvalidCount <= 0 || candidateInvalidCount >= currentInvalidCount) {
            return false;
        }
        if (candidateInvalidCount === 0 && currentInvalidCount >= 2) {
            return true;
        }
        if (currentInvalidCount >= 32 && candidateInvalidCount <= Math.floor(currentInvalidCount * 0.6)) {
            return true;
        }
        return (currentInvalidCount - candidateInvalidCount) >= 32;
    }
    _buildExpandedIndexedVertexNormals(points, indices) {
        if (!(points instanceof Float32Array) || !(indices instanceof Uint32Array)) {
            return null;
        }
        const pointValueCount = normalizeLength(points.length);
        const indexCount = normalizeLength(indices.length);
        if (pointValueCount < 9 || indexCount < 3 || (pointValueCount % 3) !== 0 || (indexCount % 3) !== 0) {
            return null;
        }
        const geometry = new BufferGeometry();
        try {
            geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
            geometry.setIndex(new Uint32BufferAttribute(indices, 1));
            geometry.computeVertexNormals?.();
            const indexedNormals = geometry.getAttribute?.('normal')?.array;
            if (!(indexedNormals instanceof Float32Array) || indexedNormals.length < pointValueCount) {
                return null;
            }
            const expandedNormals = new Float32Array(indexCount * 3);
            for (let index = 0; index < indexCount; index++) {
                const sourceBase = (indices[index] >>> 0) * 3;
                const targetBase = index * 3;
                if ((sourceBase + 2) >= indexedNormals.length) {
                    continue;
                }
                expandedNormals[targetBase] = indexedNormals[sourceBase];
                expandedNormals[targetBase + 1] = indexedNormals[sourceBase + 1];
                expandedNormals[targetBase + 2] = indexedNormals[sourceBase + 2];
            }
            return expandedNormals;
        }
        catch {
            return null;
        }
        finally {
            geometry.dispose?.();
        }
    }
    _hasExpandedPayloadEvidence(source) {
        const candidate = source?.normalDiagnostics && typeof source.normalDiagnostics === 'object'
            ? source.normalDiagnostics
            : (source?.normalDiagnostic && typeof source.normalDiagnostic === 'object'
                ? source.normalDiagnostic
                : source);
        const normalSource = String(candidate?.normalSource || '').trim();
        return /expanded/i.test(normalSource);
    }
    _isSuspiciousExpandedSharedIndex(indices, indexCount, positionCount, evidence = null) {
        if (!(indices && indexCount > 0 && positionCount > 0 && indexCount === positionCount)) {
            return false;
        }
        if ((indexCount % 3) !== 0 || !this._hasExpandedPayloadEvidence(evidence)) {
            return false;
        }
        let maxReferencedVertex = -1;
        let sawNonIdentityIndex = false;
        for (let index = 0; index < indexCount; index++) {
            const referencedVertex = indices[index] >>> 0;
            if (referencedVertex > maxReferencedVertex) {
                maxReferencedVertex = referencedVertex;
            }
            if (!sawNonIdentityIndex && referencedVertex !== index) {
                sawNonIdentityIndex = true;
            }
        }
        return sawNonIdentityIndex && (maxReferencedVertex + 1) < positionCount;
    }
    _dropSuspiciousExpandedIndexIfNeeded(evidence = null) {
        const positionAttribute = this._geometry?.getAttribute?.('position');
        const indexAttribute = this._geometry?.getIndex?.();
        if (!(positionAttribute?.count > 0) || !indexAttribute?.array) {
            return false;
        }
        const indexCount = normalizeLength(indexAttribute.count);
        const positionCount = normalizeLength(positionAttribute.count);
        if (indexCount <= 0 || indexCount !== positionCount) {
            return false;
        }
        const indices = indexAttribute.array;
        if (!this._isSuspiciousExpandedSharedIndex(indices, indexCount, positionCount, evidence)) {
            this._expandedSharedVertexIndices = undefined;
            return false;
        }
        this._captureExpandedSharedVertexIndices(indices, indexCount);
        this._indices = undefined;
        this._geometry.setIndex(null);
        return true;
    }
    setNormals(data, interpolation, profile = null) {
        if (!data)
            return;
        if (interpolation === 'facevarying') {
            // The UV buffer has already been prepared on the C++ side, so we just set it
            const stable = this._toStableFloat32Array(data);
            if (!stable)
                return;
            const uploadStart = this._nowMs();
            this._geometry.setAttribute('normal', new Float32BufferAttribute(stable, 3));
            this._needsNormalSanitization = true;
            const uploadEnd = this._nowMs();
            this._addGpuUploadSample(profile, uploadEnd - uploadStart);
            this._needsNormalFallback = false;
        }
        else if (interpolation === 'vertex') {
            // We have per-vertex UVs, so we need to sort them accordingly
            const copyStart = this._nowMs();
            this._normals = this._toStableFloat32Array(data);
            if (!this._normals)
                return;
            const copyEnd = this._nowMs();
            if (profile) {
                profile.primvarCopyMs = (Number(profile.primvarCopyMs) || 0) + (copyEnd - copyStart);
            }
            if (this._trySetDirectNonIndexedAttribute('normal', this._normals, 3, profile)) {
                this._needsNormalFallback = false;
                return;
            }
            this.updateOrder(this._normals, 'normal', 3, profile, "primvars");
            this._needsNormalFallback = false;
        }
    }
    // This is always called before prims are updated
    setMaterial(materialId) {
        this._dropSuspiciousExpandedIndexIfNeeded();
        materialId = normalizeHydraPath(materialId);
        const resolvedMaterialId = this._interface.resolveMaterialIdForMesh(materialId, this._id) || materialId;
        this._pendingMaterialId = resolvedMaterialId;
        const proto = parseProtoMeshIdentifier(this._id);
        const linkPath = proto?.sectionName === 'visuals' ? proto.linkPath : null;
        const resolvedMaterial = this._interface.materials[resolvedMaterialId]
            || this._interface.getOrCreateMaterialById(resolvedMaterialId, this._id)
            || (resolvedMaterialId !== materialId ? this._interface.getOrCreateMaterialById(materialId, this._id) : null);
        if (resolvedMaterial?._material) {
            this._mesh.material = resolvedMaterial._material;
            this._applySurfaceState();
            this._pendingMaterialId = undefined;
        }
        else {
            const warningKey = `${materialId}=>${resolvedMaterialId}`;
            if (!warnedMissingMaterials.has(warningKey)) {
                warnedMissingMaterials.add(warningKey);
            }
            if (this._materials.length > 0) {
                this._mesh.material = this._materials[0];
            }
            else if (getDefaultMaterial()) {
                this._mesh.material = getDefaultMaterial();
            }
        }
        if (linkPath) {
            this._interface._preferredVisualMaterialByLinkCache?.delete?.(linkPath);
            this.restackSiblingVisualProtoMeshes(linkPath);
        }
    }
    setGeomSubsetMaterial(sections, profile = null) {
        this._dropSuspiciousExpandedIndexIfNeeded();
        const remappedSections = this.remapGeomSubsetSectionsToTriangleIndexRanges(sections);
        const subsetsTotalStart = this._nowMs();
        if (!Array.isArray(remappedSections) || remappedSections.length === 0) {
            this._lastGeomSubsetSignature = '';
            this._pendingGeomSubsetSections = null;
            if (profile) {
                profile.subsetCount = 0;
            }
            return;
        }
        const subsetSignature = this._buildGeomSubsetSignature(remappedSections);
        const hasPendingSubsetMaterials = Array.isArray(this._pendingGeomSubsetSections) && this._pendingGeomSubsetSections.length > 0;
        if (!hasPendingSubsetMaterials && subsetSignature && subsetSignature === this._lastGeomSubsetSignature) {
            if (profile) {
                profile.subsetCount = Number(remappedSections.length) || 0;
                profile.subsetsTotalMs = (Number(profile.subsetsTotalMs) || 0) + (this._nowMs() - subsetsTotalStart);
            }
            return;
        }
        if (profile) {
            profile.subsetCount = Number(remappedSections.length) || 0;
        }
        //console.log("setting subset material: ", this._id, sections)
        const previousMaterial = Array.isArray(this._mesh.material) ? this._mesh.material.find(Boolean) : this._mesh.material;
        const fallbackMaterial = previousMaterial || this._materials.find(Boolean) || getDefaultMaterial() || createUnifiedHydraStandardMaterial({
            side: DoubleSide,
        });
        const hasExplicitBaseMaterial = Boolean(previousMaterial
            && previousMaterial !== getDefaultMaterial()
            && !isLikelyDefaultGrayMaterial(previousMaterial));
        this._geometry.clearGroups();
        const totalDrawableCount = (() => {
            const indexedCount = Number(this._geometry.getIndex()?.count || 0);
            if (Number.isFinite(indexedCount) && indexedCount > 0) {
                return indexedCount;
            }
            const positionCount = Number(this._geometry.getAttribute('position')?.count || 0);
            if (Number.isFinite(positionCount) && positionCount > 0) {
                return positionCount;
            }
            return 0;
        })();
        const nextMaterials = [];
        const pendingSections = [];
        let hasUnresolvedSectionMaterials = false;
        let lastResolvedSectionMaterial = null;
        const addMaterialGroup = (start, length, material, materialId = '') => {
            if (!Number.isFinite(start) || !Number.isFinite(length) || length <= 0 || !material) {
                return;
            }
            let materialIndex = nextMaterials.indexOf(material);
            if (materialIndex < 0) {
                materialIndex = nextMaterials.length;
                nextMaterials.push(material);
            }
            this._geometry.addGroup(start, length, materialIndex);
            if (materialId) {
                hasUnresolvedSectionMaterials = true;
                pendingSections.push({
                    start,
                    length,
                    materialId,
                });
            }
        };
        const resolveGapFallbackMaterial = (preferredMaterial = null) => {
            if (hasExplicitBaseMaterial) {
                return fallbackMaterial;
            }
            return preferredMaterial || lastResolvedSectionMaterial || fallbackMaterial;
        };
        const subsetsLoopStart = this._nowMs();
        const drawableSections = remappedSections
            .map((section) => {
            if (!section) {
                return null;
            }
            const start = Math.max(0, Math.floor(Number(section.start) || 0));
            const length = Math.max(0, Math.floor(Number(section.length) || 0));
            if (length <= 0) {
                return null;
            }
            const end = totalDrawableCount > 0
                ? Math.min(totalDrawableCount, start + length)
                : (start + length);
            if (end <= start) {
                return null;
            }
            return {
                start,
                end,
                materialId: normalizeHydraPath(section.materialId),
            };
        })
            .filter(Boolean)
            .sort((left, right) => left.start - right.start);
        let coveredUntil = 0;
        for (let i = 0; i < drawableSections.length; i++) {
            const section = drawableSections[i];
            if (!section)
                continue;
            const sectionMaterialId = normalizeHydraPath(section.materialId);
            const resolvedSectionMaterialId = this._interface.resolveMaterialIdForMesh(sectionMaterialId, this._id) || sectionMaterialId;
            let sectionMaterial = this._interface.materials[resolvedSectionMaterialId]?._material
                || this._interface.materials[sectionMaterialId]?._material
                || this._interface.getOrCreateMaterialById(resolvedSectionMaterialId, this._id)?._material
                || (resolvedSectionMaterialId !== sectionMaterialId ? this._interface.getOrCreateMaterialById(sectionMaterialId, this._id)?._material : null);
            if (section.start > coveredUntil) {
                addMaterialGroup(coveredUntil, section.start - coveredUntil, resolveGapFallbackMaterial(sectionMaterial));
            }
            const start = Math.max(section.start, coveredUntil);
            const length = Math.max(0, section.end - start);
            if (length <= 0) {
                coveredUntil = Math.max(coveredUntil, section.end);
                continue;
            }
            let unresolvedMaterialId = '';
            if (!sectionMaterial) {
                sectionMaterial = resolveGapFallbackMaterial();
                if (sectionMaterialId) {
                    unresolvedMaterialId = sectionMaterialId;
                }
            }
            addMaterialGroup(start, length, sectionMaterial, unresolvedMaterialId);
            if (sectionMaterial && !unresolvedMaterialId) {
                lastResolvedSectionMaterial = sectionMaterial;
            }
            coveredUntil = Math.max(coveredUntil, section.end);
        }
        if (totalDrawableCount > 0 && coveredUntil < totalDrawableCount) {
            addMaterialGroup(coveredUntil, totalDrawableCount - coveredUntil, resolveGapFallbackMaterial());
        }
        const subsetsLoopEnd = this._nowMs();
        if (profile) {
            profile.subsetsLoopMs = (Number(profile.subsetsLoopMs) || 0) + (subsetsLoopEnd - subsetsLoopStart);
        }
        let meshMaterial = fallbackMaterial;
        if (nextMaterials.length === 1) {
            meshMaterial = nextMaterials[0];
        }
        else if (nextMaterials.length > 1) {
            meshMaterial = nextMaterials;
        }
        const meshCreateStart = this._nowMs();
        this._mesh.material = meshMaterial;
        this._mesh.geometry = this._geometry;
        mitigateCoplanarMaterialZFighting(this._mesh);
        const meshCreateEnd = this._nowMs();
        if (profile) {
            profile.meshCreateMs = (Number(profile.meshCreateMs) || 0) + (meshCreateEnd - meshCreateStart);
        }
        this._materials = Array.isArray(this._mesh.material) ? this._mesh.material : [this._mesh.material];
        this._applySurfaceState();
        this._lastGeomSubsetSignature = subsetSignature;
        this._pendingGeomSubsetSections = hasUnresolvedSectionMaterials ? pendingSections : null;
        const proto = parseProtoMeshIdentifier(this._id);
        if (proto?.sectionName === 'visuals' && proto.linkPath) {
            this._interface._preferredVisualMaterialByLinkCache?.delete?.(proto.linkPath);
            this.restackSiblingVisualProtoMeshes(proto.linkPath);
        }
        const subsetsTotalEnd = this._nowMs();
        if (profile) {
            profile.subsetsTotalMs = (Number(profile.subsetsTotalMs) || 0) + (subsetsTotalEnd - subsetsTotalStart);
        }
    }
    setDisplayColor(data, interpolation) {
        if (disableMaterials)
            return;
        let wasDefaultMaterial = false;
        if (this._mesh.material === getDefaultMaterial()) {
            this._mesh.material = this._mesh.material.clone();
            wasDefaultMaterial = true;
        }
        this._colors = null;
        if (interpolation === 'constant') {
            this._mesh.material.vertexColors = false;
            this._mesh.material.color = setHydraColorFromTuple(new Color(), data);
        }
        else if (interpolation === 'vertex') {
            // Per-vertex buffer attribute
            this._mesh.material.vertexColors = true;
            if (wasDefaultMaterial) {
                // Reset the pink debugging color
                this._mesh.material.color = new Color(0xffffff);
            }
            const stableColors = this._toStableFloat32Array(data);
            if (!stableColors)
                return;
            this._colors = stableColors === data ? stableColors.slice(0) : stableColors;
            if (!this._colors)
                return;
            this.updateOrder(this._colors, 'color');
        }
        else {
            if (warningMessagesToCount.has(interpolation)) {
                warningMessagesToCount.set(interpolation, warningMessagesToCount.get(interpolation) + 1);
            }
            else {
                warningMessagesToCount.set(interpolation, 1);
            }
        }
    }
    setUV(data, dimension, interpolation, profile = null) {
        // TODO: Support multiple UVs. For now, we simply set uv = uv2, which is required when a material has an aoMap.
        this._uvs = null;
        if (interpolation === 'facevarying') {
            // The UV buffer has already been prepared on the C++ side, so we just set it
            const stable = this._toStableFloat32Array(data);
            if (!stable)
                return;
            const uploadStart = this._nowMs();
            this._geometry.setAttribute('uv', new Float32BufferAttribute(stable, dimension));
            const uploadEnd = this._nowMs();
            this._addGpuUploadSample(profile, uploadEnd - uploadStart);
        }
        else if (interpolation === 'vertex') {
            // We have per-vertex UVs, so we need to sort them accordingly
            const copyStart = this._nowMs();
            this._uvs = this._toStableFloat32Array(data);
            if (!this._uvs)
                return;
            const copyEnd = this._nowMs();
            if (profile) {
                profile.primvarCopyMs = (Number(profile.primvarCopyMs) || 0) + (copyEnd - copyStart);
            }
            this.updateOrder(this._uvs, 'uv', 2, profile, "primvars");
        }
        if (this._geometry.hasAttribute('uv'))
            this._geometry.attributes.uv2 = this._geometry.attributes.uv;
    }
    updatePrimvar(name, data, dimension, interpolation, profile = null) {
        if (!name)
            return;
        if (name === 'points') { // || name === 'normals') {
            // Points and normals are set separately
            return;
        }
        // TODO: Support multiple UVs. For now, we simply set uv = uv2, which is required when a material has an aoMap.
        if (name.startsWith('st')) {
            name = 'uv';
        }
        switch (name) {
            case 'displayColor':
                this.setDisplayColor(data, interpolation);
                break;
            case 'uv':
            case "UVMap":
            case "uvmap":
            case "uv0":
            case "UVW":
            case "uvw":
            case "map1":
                this.setUV(data, dimension, interpolation, profile);
                break;
            case "normals":
                this.setNormals(data, interpolation, profile);
                break;
            default:
                if (warningMessagesToCount.has(name)) {
                    warningMessagesToCount.set(name, warningMessagesToCount.get(name) + 1);
                }
                else {
                    warningMessagesToCount.set(name, 1);
                }
        }
    }
    updatePoints(points, profile = null, options = null) {
        if (!points || typeof points.length !== 'number')
            return;
        const deferReorder = options?.deferReorder === true;
        const totalStart = this._nowMs();
        if (profile) {
            const heapF32 = this._resolveWasmHeapViews().heapF32;
            profile.pointsFromHeapF32 = !!(ArrayBuffer.isView(points) && heapF32 && points.buffer === heapF32.buffer);
            // We currently do no explicit Y-up/Z-up conversion here; keep this metric to verify.
            profile.pointsAxisTransformMs = (Number(profile.pointsAxisTransformMs) || 0);
            profile.pointsAxisTransformLoopUsed = false;
        }
        const copyStart = this._nowMs();
        const pointCount = points.length >>> 0;
        this._points = this._toStableFloat32Array(points, pointCount);
        if (!this._points)
            return;
        const copyEnd = this._nowMs();
        if (this._points && Number(this._points.length || 0) > 0) {
            this._hasHydraGeometryPayload = true;
        }
        if (profile) {
            profile.pointsCopyMs = (Number(profile.pointsCopyMs) || 0) + (copyEnd - copyStart);
        }
        if (!deferReorder) {
            this.reorderIndexedAttributes(profile, "points");
        }
        if (profile) {
            profile.pointsTotalMs = (Number(profile.pointsTotalMs) || 0) + (this._nowMs() - totalStart);
        }
    }
    ensureFallbackNormalsIfMissing() {
        if (!this._needsNormalFallback)
            return;
        if (!this._id || !VISUAL_SEGMENT_PATTERN.test(this._id)) {
            this._needsNormalFallback = false;
            return;
        }
        const geometry = this._geometry;
        if (!geometry) {
            this._needsNormalFallback = false;
            return;
        }
        const position = geometry.getAttribute?.('position');
        if (!position || position.count <= 0)
            return;
        const existingNormals = geometry.getAttribute?.('normal');
        if (existingNormals && existingNormals.count > 0) {
            this._needsNormalFallback = false;
            return;
        }
        try {
            geometry.computeVertexNormals?.();
            this._needsNormalSanitization = true;
        }
        catch { }
        // If geometry is refreshed later, updatePoints/updateIndices will re-arm this flag.
        this._needsNormalFallback = false;
    }
    sanitizeNormalsIfNeeded() {
        if (!this._needsNormalSanitization)
            return;
        this._needsNormalSanitization = false;
        const geometry = this._geometry;
        if (!geometry)
            return;
        let normalAttribute = geometry.getAttribute?.('normal');
        const positionAttribute = geometry.getAttribute?.('position');
        if (!normalAttribute || !positionAttribute)
            return;
        if (normalAttribute.itemSize !== 3 || positionAttribute.itemSize !== 3)
            return;
        let normals = normalAttribute.array;
        const positions = positionAttribute.array;
        if (!normals || !positions)
            return;
        const collectInvalidVertexIndices = (array, vertexCount) => {
            const invalidIndices = [];
            let fallbackNormal = null;
            for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
                const base = vertexIndex * 3;
                const x = Number(array[base]);
                const y = Number(array[base + 1]);
                const z = Number(array[base + 2]);
                const lenSq = x * x + y * y + z * z;
                const len = Number.isFinite(lenSq) && lenSq > 1e-10 ? Math.sqrt(lenSq) : 0;
                const isValid = Number.isFinite(x)
                    && Number.isFinite(y)
                    && Number.isFinite(z)
                    && len >= 0.9
                    && len <= 1.1;
                if (isValid) {
                    if (!fallbackNormal) {
                        const invLen = 1 / len;
                        fallbackNormal = [x * invLen, y * invLen, z * invLen];
                    }
                    continue;
                }
                invalidIndices.push(vertexIndex);
            }
            return { invalidIndices, fallbackNormal };
        };
        let normalCount = Math.floor(Number(normals.length || 0) / 3);
        const positionCount = Math.floor(Number(positions.length || 0) / 3);
        let count = Math.min(normalCount, positionCount);
        if (count <= 0)
            return;
        let { invalidIndices, fallbackNormal } = collectInvalidVertexIndices(normals, count);
        if (invalidIndices.length <= 0) {
            if (this._repairNonIndexedNormalsAgainstFaceWinding(positionAttribute, normalAttribute, count)) {
                normalAttribute.needsUpdate = true;
            }
            return;
        }
        const indexAttribute = geometry.getIndex?.();
        if (indexAttribute && Number(indexAttribute.count || 0) > 0) {
            try {
                geometry.computeVertexNormals?.();
            }
            catch { }
            normalAttribute = geometry.getAttribute?.('normal');
            if (!normalAttribute || normalAttribute.itemSize !== 3 || !normalAttribute.array)
                return;
            normals = normalAttribute.array;
            normalCount = Math.floor(Number(normals.length || 0) / 3);
            count = Math.min(normalCount, positionCount);
            if (count <= 0)
                return;
            ({ invalidIndices, fallbackNormal } = collectInvalidVertexIndices(normals, count));
            if (invalidIndices.length <= 0) {
                normalAttribute.needsUpdate = true;
                return;
            }
        }
        const sharedVertexNormals = !indexAttribute
            ? this._buildExpandedSharedVertexNormals(positionAttribute)
            : null;
        const invalidRatio = invalidIndices.length / count;
        if (sharedVertexNormals && invalidRatio >= 0.005) {
            const rebuiltInvalidCount = collectInvalidVertexIndices(sharedVertexNormals, count).invalidIndices.length;
            if (rebuiltInvalidCount < invalidIndices.length) {
                normals.set(sharedVertexNormals.subarray(0, count * 3));
                normalAttribute.needsUpdate = true;
                return;
            }
        }
        const safeFallback = fallbackNormal || [0, 1, 0];
        const faceNormalScratch = [0, 0, 0];
        const sharedNormalScratch = [0, 0, 0];
        const computeTriangleFaceNormal = (triStartVertex) => {
            if (triStartVertex < 0 || (triStartVertex + 2) >= count)
                return null;
            const p0 = triStartVertex * 3;
            const p1 = (triStartVertex + 1) * 3;
            const p2 = (triStartVertex + 2) * 3;
            const ux = Number(positions[p1]) - Number(positions[p0]);
            const uy = Number(positions[p1 + 1]) - Number(positions[p0 + 1]);
            const uz = Number(positions[p1 + 2]) - Number(positions[p0 + 2]);
            const vx = Number(positions[p2]) - Number(positions[p0]);
            const vy = Number(positions[p2 + 1]) - Number(positions[p0 + 1]);
            const vz = Number(positions[p2 + 2]) - Number(positions[p0 + 2]);
            const nx = (uy * vz) - (uz * vy);
            const ny = (uz * vx) - (ux * vz);
            const nz = (ux * vy) - (uy * vx);
            const lenSq = nx * nx + ny * ny + nz * nz;
            if (!Number.isFinite(lenSq) || lenSq <= 1e-14)
                return null;
            const invLen = 1 / Math.sqrt(lenSq);
            faceNormalScratch[0] = nx * invLen;
            faceNormalScratch[1] = ny * invLen;
            faceNormalScratch[2] = nz * invLen;
            return faceNormalScratch;
        };
        const getSharedVertexNormal = (vertexIndex) => {
            if (!(sharedVertexNormals instanceof Float32Array)) {
                return null;
            }
            const base = vertexIndex * 3;
            const nx = Number(sharedVertexNormals[base]);
            const ny = Number(sharedVertexNormals[base + 1]);
            const nz = Number(sharedVertexNormals[base + 2]);
            const lenSq = nx * nx + ny * ny + nz * nz;
            if (!Number.isFinite(lenSq) || lenSq <= 1e-14) {
                return null;
            }
            sharedNormalScratch[0] = nx;
            sharedNormalScratch[1] = ny;
            sharedNormalScratch[2] = nz;
            return sharedNormalScratch;
        };
        for (const vertexIndex of invalidIndices) {
            let replacement = getSharedVertexNormal(vertexIndex);
            if (!replacement) {
                const triStart = Math.floor(vertexIndex / 3) * 3;
                replacement = computeTriangleFaceNormal(triStart);
            }
            if (!replacement) {
                replacement = safeFallback;
            }
            const base = vertexIndex * 3;
            normals[base] = replacement[0];
            normals[base + 1] = replacement[1];
            normals[base + 2] = replacement[2];
        }
        this._repairNonIndexedNormalsAgainstFaceWinding(positionAttribute, normalAttribute, count);
        normalAttribute.needsUpdate = true;
    }
    applyUpdates(updates) {
        if (!updates || typeof updates !== 'object')
            return;
        const phaseInstrumentationEnabled = this._interface?.isHydraPhaseInstrumentationEnabled?.() === true;
        const shouldCollectProfile = shouldProfileHydraSync() || phaseInstrumentationEnabled;
        const t0 = this._nowMs();
        const profile = shouldCollectProfile ? {
            gpuUploadMs: 0,
            indicesCopyMs: 0,
            indicesLoopMs: 0,
            indicesReorderMs: 0,
            indicesTotalMs: 0,
            indicesForLoopUsed: false,
            indicesFromHeapU32: false,
            pointsCopyMs: 0,
            pointsLoopMs: 0,
            pointsReorderMs: 0,
            pointsAxisTransformMs: 0,
            pointsAxisTransformLoopUsed: false,
            pointsTotalMs: 0,
            pointsFromHeapF32: false,
            primvarLoopMs: 0,
            primvarCopyMs: 0,
            subsetCount: 0,
            subsetsLoopMs: 0,
            subsetsTotalMs: 0,
            deferredReorderMs: 0,
            meshCreateMs: 0,
            visibilityOps: 0,
            loggingMs: 0,
        } : null;
        const materialId = (typeof updates.materialId === 'string' && updates.materialId.length > 0)
            ? updates.materialId
            : null;
        const geomSubsetSections = Array.isArray(updates.geomSubsetSections) ? updates.geomSubsetSections : [];
        const preferProtoPayload = this._id.includes(".proto_")
            && this._interface?.enableProtoBlobFastPath === true
            && this._interface?.preferProtoBlobOverHydraPayload === true;
        const points = !preferProtoPayload && (updates.points && typeof updates.points.length === 'number')
            ? updates.points
            : null;
        const indices = !preferProtoPayload && (updates.indices && typeof updates.indices.length === 'number')
            ? updates.indices
            : null;
        const primvars = !preferProtoPayload && Array.isArray(updates.primvars)
            ? updates.primvars
            : [];
        const normals = !preferProtoPayload && (updates.normals && typeof updates.normals.slice === 'function')
            ? updates.normals
            : null;
        const transform = (updates.transform && typeof updates.transform[Symbol.iterator] === 'function')
            ? updates.transform
            : null;
        const deferGeometryReorder = !!indices && !!points;
        const hasTopologyUpdates = !!indices || !!points;
        const applyPendingSurfaceState = () => {
            if (materialId) {
                this.setMaterial(materialId);
            }
            if (geomSubsetSections.length > 0) {
                this.setGeomSubsetMaterial(geomSubsetSections, profile);
            }
        };
        const t1 = this._nowMs();
        if (!hasTopologyUpdates) {
            applyPendingSurfaceState();
        }
        if (indices) {
            this.updateIndices(indices, profile, { deferReorder: deferGeometryReorder });
        }
        if (points) {
            this.updatePoints(points, profile, { deferReorder: deferGeometryReorder });
        }
        for (const primvar of primvars) {
            if (!primvar)
                continue;
            const name = primvar.name;
            const data = primvar.data;
            const dimension = Number(primvar.dimension);
            const interpolation = primvar.interpolation;
            if (!name || !data || !Number.isFinite(dimension) || dimension <= 0)
                continue;
            this.updatePrimvar(name, data, dimension, interpolation, profile);
        }
        if (normals) {
            this.updateNormals(normals, profile);
        }
        if (deferGeometryReorder) {
            this.reorderIndexedAttributes(profile, "deferred");
        }
        if (hasTopologyUpdates) {
            this._dropSuspiciousExpandedIndexIfNeeded();
            if (geomSubsetSections.length > 0) {
                this._lastGeomSubsetSignature = '';
            }
            applyPendingSurfaceState();
        }
        if (transform) {
            this.setTransform(transform);
        }
        if (Object.prototype.hasOwnProperty.call(updates, "visible")) {
            if (profile)
                profile.visibilityOps += 1;
            if (typeof this.setVisible === "function") {
                this.setVisible(updates.visible);
            }
        }
        if (Object.prototype.hasOwnProperty.call(updates, "doubleSided")) {
            if (profile)
                profile.visibilityOps += 1;
            if (typeof this.setDoubleSided === "function") {
                this.setDoubleSided(updates.doubleSided);
            }
        }
        if (Object.prototype.hasOwnProperty.call(updates, "cullStyle")) {
            if (profile)
                profile.visibilityOps += 1;
            if (typeof this.setCullStyle === "function") {
                this.setCullStyle(updates.cullStyle);
            }
        }
        if (profile) {
            profile.loggingMs = 0;
        }
        const unpackMs = t1 - t0;
        if (phaseInstrumentationEnabled && profile) {
            // "WASM Stage": time spent reading/copying topology/points/primvars payloads from
            // Hydra callback data into JS-owned arrays.
            const wasmFetchMs = Math.max(0, unpackMs
                + Number(profile.indicesCopyMs || 0)
                + Number(profile.pointsCopyMs || 0)
                + Number(profile.primvarCopyMs || 0));
            // "Three.js Build": time spent building Three-side data structures
            // (BufferAttribute uploads and mesh recreation for geomSubsets).
            const threeBuildMs = Math.max(0, Number(profile.gpuUploadMs || 0)
                + Number(profile.meshCreateMs || 0));
            this._interface?.recordHydraWasmFetchPhase?.(wasmFetchMs, this._id);
            this._interface?.recordHydraThreeBuildPhase?.(threeBuildMs, this._id);
        }
    }
    commit(profileAccumulator = null) {
        const trackStep = (fieldName, durationMs) => {
            if (!profileAccumulator || typeof profileAccumulator !== 'object')
                return;
            const safe = Number.isFinite(Number(durationMs)) ? Math.max(0, Number(durationMs)) : 0;
            profileAccumulator[fieldName] = Number(profileAccumulator[fieldName] || 0) + safe;
        };
        const commitStart = this._nowMs();
        if (this._pendingMaterialId && this._interface.materials[this._pendingMaterialId]?._material) {
            const materialStart = this._nowMs();
            this._mesh.material = this._interface.materials[this._pendingMaterialId]._material;
            this._applySurfaceState();
            if (this.isVisualProtoMesh()) {
                this.restackSiblingVisualProtoMeshes();
            }
            this._pendingMaterialId = undefined;
            trackStep('pendingMaterialMs', this._nowMs() - materialStart);
        }
        if (Array.isArray(this._pendingGeomSubsetSections) && this._pendingGeomSubsetSections.length > 0) {
            const subsetMaterialStart = this._nowMs();
            this.tryApplyPendingGeomSubsetMaterials();
            trackStep('pendingSubsetMaterialMs', this._nowMs() - subsetMaterialStart);
        }
        const primitiveFallbackStart = this._nowMs();
        this.ensurePrimitiveFallbackGeometry();
        trackStep('primitiveFallbackMs', this._nowMs() - primitiveFallbackStart);
        const normalFallbackStart = this._nowMs();
        this.ensureFallbackNormalsIfMissing();
        trackStep('normalFallbackMs', this._nowMs() - normalFallbackStart);
        const normalSanitizeStart = this._nowMs();
        this.sanitizeNormalsIfNeeded();
        trackStep('normalSanitizeMs', this._nowMs() - normalSanitizeStart);
        const visualColorStart = this._nowMs();
        this.applyVisualColorOverride();
        trackStep('visualColorMs', this._nowMs() - visualColorStart);
        const inheritMaterialStart = this._nowMs();
        this.tryInheritVisualMaterialFromLink();
        trackStep('inheritMaterialMs', this._nowMs() - inheritMaterialStart);
        const surfaceStateStart = this._nowMs();
        this._applySurfaceState();
        trackStep('surfaceStateMs', this._nowMs() - surfaceStateStart);
        if (!this._id.includes(".proto_")) {
            trackStep('meshTotalMs', this._nowMs() - commitStart);
            trackStep('meshCount', 1);
            return;
        }
        const shouldDeferHiddenCollisionProtoSync = this.isCollisionProtoMesh()
            && this._hasCompletedProtoSync !== true
            && this._mesh?.visible === false
            && this._interface?.deferHiddenCollisionProtoSyncInCommit === true;
        if (shouldDeferHiddenCollisionProtoSync) {
            trackStep('meshTotalMs', this._nowMs() - commitStart);
            trackStep('meshCount', 1);
            return;
        }
        if (this._hasCompletedProtoSync) {
            trackStep('meshTotalMs', this._nowMs() - commitStart);
            trackStep('meshCount', 1);
            return;
        }
        if (this.shouldDeferProtoStageSyncUntilSceneSnapshot()) {
            trackStep('meshTotalMs', this._nowMs() - commitStart);
            trackStep('meshCount', 1);
            return;
        }
        const protoSyncStart = this._nowMs();
        this.applyProtoStageSync();
        trackStep('protoSyncMs', this._nowMs() - protoSyncStart);
        const postProtoNormalSanitizeStart = this._nowMs();
        this.sanitizeNormalsIfNeeded();
        trackStep('postProtoNormalSanitizeMs', this._nowMs() - postProtoNormalSanitizeStart);
        trackStep('meshTotalMs', this._nowMs() - commitStart);
        trackStep('meshCount', 1);
    }
    tryApplyProtoDataBlobFastPath(options = {}) {
        const phaseInstrumentationEnabled = this._interface?.isHydraPhaseInstrumentationEnabled?.() === true;
        const forceRefresh = options?.forceRefresh === true;
        const allowForceRefreshRetry = options?.allowForceRefreshRetry !== false;
        const replaceExistingGeometry = options?.replaceExistingGeometry === true;
        const blobOverride = options?.blobOverride;
        const useBlobOverride = !!(blobOverride && blobOverride.valid === true);
        let wasmFetchMs = 0;
        let threeBuildMs = 0;
        const measureWasmStage = (fn) => {
            const startedAt = this._nowMs();
            const result = fn();
            const endedAt = this._nowMs();
            wasmFetchMs += Math.max(0, endedAt - startedAt);
            return result;
        };
        const measureThreeBuildStage = (fn) => {
            const startedAt = this._nowMs();
            const result = fn();
            const endedAt = this._nowMs();
            threeBuildMs += Math.max(0, endedAt - startedAt);
            return result;
        };
        try {
            let blob = useBlobOverride
                ? blobOverride
                : this._interface?.getProtoDataBlob?.(this._id, { forceRefresh });
            if ((!blob || blob.valid !== true) && allowForceRefreshRetry && !forceRefresh && !useBlobOverride) {
                return this.tryApplyProtoDataBlobFastPath({
                    forceRefresh: true,
                    allowForceRefreshRetry: false,
                    replaceExistingGeometry,
                });
            }
            if (!blob || blob.valid !== true)
                return false;
            if (useBlobOverride) {
                const cachedBlob = this._interface?.getProtoDataBlob?.(this._id, { forceRefresh: false }) || null;
                const overrideSections = Array.isArray(blob?.geomSubsetSections) ? blob.geomSubsetSections : [];
                const cachedSections = Array.isArray(cachedBlob?.geomSubsetSections) ? cachedBlob.geomSubsetSections : [];
                if (overrideSections.length <= 0 && cachedSections.length > 0) {
                    blob = {
                        ...blob,
                        geomSubsetSections: cachedSections,
                    };
                }
            }
            const isRenderReadyPayload = blob.renderReady === true;
            const renderReadyTopologyMode = normalizeTopologyMode(blob.topologyMode);
            const renderReadyNonIndexed = isRenderReadyPayload && renderReadyTopologyMode === 'nonIndexed';
            const heapViews = this._resolveWasmHeapViews();
            const moduleRef = heapViews?.moduleRef || null;
            const heapF32 = heapViews?.heapF32 || null;
            const heapU32 = heapViews?.heapU32 || null;
            const normalizeLength = (value) => {
                const parsed = Number(value);
                if (!Number.isFinite(parsed) || parsed <= 0)
                    return 0;
                return Math.floor(parsed);
            };
            const normalizePtr = (value) => {
                const parsed = Number(value);
                if (!Number.isFinite(parsed) || parsed <= 0)
                    return 0;
                const floored = Math.floor(parsed);
                if ((floored % 4) !== 0)
                    return 0;
                return floored;
            };
            const getHeapFloat32View = (ptr, valueCount) => {
                const normalizedPtr = normalizePtr(ptr);
                const normalizedCount = normalizeLength(valueCount);
                if (!normalizedPtr || !normalizedCount || !heapF32 || typeof heapF32.subarray !== 'function')
                    return null;
                const start = normalizedPtr >>> 2;
                const end = start + normalizedCount;
                if (end > heapF32.length)
                    return null;
                return heapF32.subarray(start, end);
            };
            const getHeapUint32View = (ptr, valueCount) => {
                const normalizedPtr = normalizePtr(ptr);
                const normalizedCount = normalizeLength(valueCount);
                if (!normalizedPtr || !normalizedCount || !heapU32 || typeof heapU32.subarray !== 'function')
                    return null;
                const start = normalizedPtr >>> 2;
                const end = start + normalizedCount;
                if (end > heapU32.length)
                    return null;
                return heapU32.subarray(start, end);
            };
            const isHeapBackedView = (view, heapView) => {
                return !!(view && ArrayBuffer.isView(view) && heapView && view.buffer === heapView.buffer);
            };
            const resolveFloatSource = (ptr, valueCount, fallback) => {
                const fromHeap = getHeapFloat32View(ptr, valueCount);
                if (fromHeap)
                    return fromHeap;
                if (!fallback || typeof fallback.length !== 'number')
                    return null;
                // Large non-typed ArrayLike payloads usually mean embind proxy objects,
                // where indexed reads cross the JS<->WASM boundary per element.
                if (!ArrayBuffer.isView(fallback) && normalizeLength(valueCount) > 2048)
                    return null;
                return fallback;
            };
            const resolveUintSource = (ptr, valueCount, fallback) => {
                const fromHeap = getHeapUint32View(ptr, valueCount);
                if (fromHeap)
                    return fromHeap;
                if (!fallback || typeof fallback.length !== 'number')
                    return null;
                if (!ArrayBuffer.isView(fallback) && normalizeLength(valueCount) > 2048)
                    return null;
                return fallback;
            };
            const copyFloat32Payload = (source, expectedLength) => {
                const normalizedLength = normalizeLength(expectedLength);
                if (!source || !normalizedLength || Number(source.length) < normalizedLength)
                    return null;
                if (source instanceof Float32Array) {
                    const sampled = source.subarray(0, normalizedLength);
                    if (!isHeapBackedView(sampled, heapF32))
                        return sampled;
                    return sampled.slice();
                }
                if (ArrayBuffer.isView(source) && typeof source.subarray === 'function') {
                    const sampled = source.subarray(0, normalizedLength);
                    if (sampled instanceof Float32Array && !isHeapBackedView(sampled, heapF32))
                        return sampled;
                    const copied = new Float32Array(normalizedLength);
                    copied.set(sampled);
                    return copied;
                }
                const copied = new Float32Array(normalizedLength);
                for (let index = 0; index < normalizedLength; index++) {
                    copied[index] = source[index];
                }
                return copied;
            };
            const copyUint32Payload = (source, expectedLength) => {
                const normalizedLength = normalizeLength(expectedLength);
                if (!source || !normalizedLength || Number(source.length) < normalizedLength)
                    return null;
                if (source instanceof Uint32Array) {
                    const sampled = source.subarray(0, normalizedLength);
                    if (!isHeapBackedView(sampled, heapU32))
                        return sampled;
                    return sampled.slice();
                }
                if (ArrayBuffer.isView(source) && typeof source.subarray === 'function') {
                    const sampled = source.subarray(0, normalizedLength);
                    if (sampled instanceof Uint32Array && !isHeapBackedView(sampled, heapU32))
                        return sampled;
                    const copied = new Uint32Array(normalizedLength);
                    copied.set(sampled);
                    return copied;
                }
                const copied = new Uint32Array(normalizedLength);
                for (let index = 0; index < normalizedLength; index++) {
                    copied[index] = source[index];
                }
                return copied;
            };
            const expandFloat32PayloadByIndices = (source, indices, dimension) => {
                const safeDimension = Math.max(1, normalizeLength(dimension));
                if (!(source instanceof Float32Array) || !(indices instanceof Uint32Array))
                    return null;
                const indexCount = normalizeLength(indices.length);
                if (indexCount <= 0)
                    return null;
                const expanded = new Float32Array(indexCount * safeDimension);
                const sourceLength = normalizeLength(source.length);
                for (let index = 0; index < indexCount; index++) {
                    const sourceBase = indices[index] * safeDimension;
                    const targetBase = index * safeDimension;
                    if ((sourceBase + safeDimension) > sourceLength)
                        continue;
                    for (let component = 0; component < safeDimension; component++) {
                        expanded[targetBase + component] = source[sourceBase + component];
                    }
                }
                return expanded;
            };
            // Single-shot path: resolve matrix from direct heap pointer first.
            // Fallback to blob.transform only when pointer-based view is unavailable.
            const transformSource = resolveFloatSource(blob.transformPtr, 16, (blob.transform && typeof blob.transform.length === 'number') ? blob.transform : null);
            if (!transformSource || Number(transformSource.length) < 16)
                return false;
            measureThreeBuildStage(() => {
                this._mesh.matrix.set(transformSource[0], transformSource[1], transformSource[2], transformSource[3], transformSource[4], transformSource[5], transformSource[6], transformSource[7], transformSource[8], transformSource[9], transformSource[10], transformSource[11], transformSource[12], transformSource[13], transformSource[14], transformSource[15]);
                this._mesh.matrix.transpose();
                this._mesh.matrixAutoUpdate = false;
                this._lastProtoBlobTransformMatrix = this._mesh.matrix.clone();
            });
            if (replaceExistingGeometry) {
                const existingPositionCount = Number(this._geometry?.getAttribute?.('position')?.count || 0);
                const existingIndexCount = Number(this._geometry?.getIndex?.()?.count || 0);
                if (existingPositionCount > 0 || existingIndexCount > 0) {
                    measureThreeBuildStage(() => {
                        this.replaceGeometry(new BufferGeometry());
                    });
                }
            }
            // Geometry payload from WASM must be copied before storing in BufferAttributes.
            // Keeping HEAP-backed views here causes silent corruption after later draws/reallocations.
            const numVertices = normalizeLength(blob.numVertices);
            let pointsCopy = null;
            let indicesCopy = null;
            let uvCopy = null;
            let normalsCopy = null;
            const pointValueCount = numVertices * 3;
            const positionAttribute = this._geometry.getAttribute('position');
            if ((replaceExistingGeometry || !positionAttribute || positionAttribute.count === 0) && pointValueCount > 0) {
                const pointsSource = resolveFloatSource(blob.pointsPtr, pointValueCount, (blob.points && typeof blob.points.length === 'number') ? blob.points : null);
                pointsCopy = pointsSource ? measureWasmStage(() => copyFloat32Payload(pointsSource, pointValueCount)) : null;
                if (pointsCopy) {
                    this._points = pointsCopy;
                    this._hasHydraGeometryPayload = true;
                    measureThreeBuildStage(() => {
                        this._geometry.setAttribute('position', new Float32BufferAttribute(pointsCopy, 3));
                    });
                }
            }
            const numIndices = normalizeLength(blob.numIndices);
            const existingIndex = this._geometry.getIndex();
            if (renderReadyNonIndexed) {
                this._indices = undefined;
                this._expandedSharedVertexIndices = undefined;
                measureThreeBuildStage(() => {
                    this._geometry.setIndex(null);
                });
            }
            else if ((replaceExistingGeometry || !existingIndex || existingIndex.count === 0) && numIndices > 0) {
                const indicesSource = resolveUintSource(blob.indicesPtr, numIndices, (blob.indices && typeof blob.indices.length === 'number') ? blob.indices : null);
                indicesCopy = indicesSource ? measureWasmStage(() => copyUint32Payload(indicesSource, numIndices)) : null;
                if (indicesCopy) {
                    if (!isRenderReadyPayload) {
                        indicesCopy = this.triangulateProtoIndicesIfNeeded(indicesCopy);
                    }
                    this._indices = indicesCopy;
                    this._hasHydraGeometryPayload = true;
                    measureThreeBuildStage(() => {
                        this._geometry.setIndex(new Uint32BufferAttribute(indicesCopy, 1));
                    });
                }
            }
            const uvDimension = Math.max(0, normalizeLength(blob.uvDimension));
            const numUVs = normalizeLength(blob.numUVs);
            const uvValueCount = uvDimension * numUVs;
            const uvAttribute = this._geometry.getAttribute('uv');
            if ((replaceExistingGeometry || !uvAttribute || uvAttribute.count === 0) && uvDimension >= 2 && uvValueCount > 0) {
                const uvSource = resolveFloatSource(blob.uvPtr, uvValueCount, (blob.uv && typeof blob.uv.length === 'number') ? blob.uv : null);
                uvCopy = uvSource ? measureWasmStage(() => copyFloat32Payload(uvSource, uvValueCount)) : null;
                if (uvCopy) {
                    this._uvs = uvCopy;
                    measureThreeBuildStage(() => {
                        this._geometry.setAttribute('uv', new Float32BufferAttribute(uvCopy, uvDimension));
                    });
                    this._geometry.attributes.uv2 = this._geometry.attributes.uv;
                }
            }
            const normalsDimension = Math.max(3, normalizeLength(blob.normalsDimension || 3));
            const numNormals = normalizeLength(blob.numNormals || numVertices);
            const normalValueCount = numNormals * normalsDimension;
            const normalAttribute = this._geometry.getAttribute('normal');
            if ((replaceExistingGeometry || !normalAttribute || normalAttribute.count === 0) && normalValueCount > 0) {
                const normalsSource = resolveFloatSource(blob.normalsPtr, normalValueCount, (blob.normals && typeof blob.normals.length === 'number') ? blob.normals : null);
                normalsCopy = normalsSource ? measureWasmStage(() => copyFloat32Payload(normalsSource, normalValueCount)) : null;
                if (normalsCopy) {
                    this._normals = normalsCopy;
                    measureThreeBuildStage(() => {
                        this._geometry.setAttribute('normal', new Float32BufferAttribute(normalsCopy, normalsDimension));
                    });
                    this._needsNormalSanitization = !isRenderReadyPayload;
                }
            }
            const effectiveNumIndices = indicesCopy instanceof Uint32Array
                ? normalizeLength(indicesCopy.length)
                : numIndices;
            let acceptedNonIndexedIndexPayload = renderReadyNonIndexed;
            const shouldDropExpandedIdentityMismatchedIndex = (() => {
                if (isRenderReadyPayload) {
                    return false;
                }
                if (!(pointsCopy instanceof Float32Array) || !(indicesCopy instanceof Uint32Array)) {
                    return false;
                }
                // Some Hydra proto payloads already expand positions/normals/uvs to one
                // vertex per triangle corner, but still forward the original shared-vertex
                // index buffer. Rendering that as indexed geometry reconnects unrelated
                // vertices into the long diagonal triangles seen on B2 visual meshes.
                return this._isSuspiciousExpandedSharedIndex(indicesCopy, effectiveNumIndices, numVertices, blob);
            })();
            if (shouldDropExpandedIdentityMismatchedIndex) {
                this._captureExpandedSharedVertexIndices(indicesCopy, effectiveNumIndices);
                this._indices = undefined;
                indicesCopy = undefined;
                measureThreeBuildStage(() => {
                    this._geometry.setIndex(null);
                });
                acceptedNonIndexedIndexPayload = true;
            }
            const shouldExpandToNonIndexedGeometry = !isRenderReadyPayload && !!(pointsCopy instanceof Float32Array
                && indicesCopy instanceof Uint32Array
                && numVertices > 0
                && effectiveNumIndices > 0
                && numVertices !== effectiveNumIndices
                && ((numNormals > 0 && numNormals === effectiveNumIndices)
                    || (uvDimension >= 2 && numUVs === effectiveNumIndices)));
            if (shouldExpandToNonIndexedGeometry) {
                if (!(normalsCopy instanceof Float32Array) && normalValueCount > 0) {
                    const normalsSource = resolveFloatSource(blob.normalsPtr, normalValueCount, (blob.normals && typeof blob.normals.length === 'number') ? blob.normals : null);
                    normalsCopy = normalsSource ? measureWasmStage(() => copyFloat32Payload(normalsSource, normalValueCount)) : null;
                    if (normalsCopy) {
                        this._normals = normalsCopy;
                    }
                }
                if (!(uvCopy instanceof Float32Array) && uvDimension >= 2 && uvValueCount > 0) {
                    const uvSource = resolveFloatSource(blob.uvPtr, uvValueCount, (blob.uv && typeof blob.uv.length === 'number') ? blob.uv : null);
                    uvCopy = uvSource ? measureWasmStage(() => copyFloat32Payload(uvSource, uvValueCount)) : null;
                    if (uvCopy) {
                        this._uvs = uvCopy;
                    }
                }
                const expandedPoints = expandFloat32PayloadByIndices(pointsCopy, indicesCopy, 3);
                const expandedNormals = normalsCopy instanceof Float32Array
                    ? (numNormals === numVertices
                        ? expandFloat32PayloadByIndices(normalsCopy, indicesCopy, normalsDimension)
                        : normalsCopy)
                    : null;
                const smoothedExpandedNormals = (expandedNormals instanceof Float32Array
                    && numNormals === numVertices
                    && normalsDimension === 3)
                    ? this._buildExpandedIndexedVertexNormals(pointsCopy, indicesCopy)
                    : null;
                const preferredExpandedNormals = (smoothedExpandedNormals instanceof Float32Array
                    && this._shouldPreferExpandedIndexedNormals(expandedNormals, smoothedExpandedNormals, Math.floor(expandedPoints?.length || 0) / 3))
                    ? smoothedExpandedNormals
                    : expandedNormals;
                const expandedUvs = uvCopy instanceof Float32Array
                    ? (numUVs === numVertices
                        ? expandFloat32PayloadByIndices(uvCopy, indicesCopy, uvDimension)
                        : uvCopy)
                    : null;
                if (expandedPoints) {
                    this._points = expandedPoints;
                    this._captureExpandedSharedVertexIndices(indicesCopy, effectiveNumIndices);
                    this._indices = undefined;
                    if (preferredExpandedNormals)
                        this._normals = preferredExpandedNormals;
                    if (expandedUvs)
                        this._uvs = expandedUvs;
                    measureThreeBuildStage(() => {
                        this._geometry.setIndex(null);
                        this._geometry.setAttribute('position', new Float32BufferAttribute(expandedPoints, 3));
                        if (preferredExpandedNormals) {
                            this._geometry.setAttribute('normal', new Float32BufferAttribute(preferredExpandedNormals, normalsDimension));
                            this._needsNormalSanitization = true;
                        }
                        else if (this._geometry.getAttribute('normal')) {
                            this._geometry.deleteAttribute('normal');
                        }
                        if (expandedUvs && uvDimension >= 2) {
                            this._geometry.setAttribute('uv', new Float32BufferAttribute(expandedUvs, uvDimension));
                            this._geometry.attributes.uv2 = this._geometry.attributes.uv;
                        }
                        else if (this._geometry.getAttribute('uv')) {
                            this._geometry.deleteAttribute('uv');
                            delete this._geometry.attributes.uv2;
                        }
                    });
                    acceptedNonIndexedIndexPayload = true;
                }
            }
            const positionAttributeAfterAssembly = this._geometry.getAttribute('position');
            const indexAttributeAfterAssembly = this._geometry.getIndex();
            if (positionAttributeAfterAssembly?.count > 0 && indexAttributeAfterAssembly?.array) {
                const assembledIndexCount = normalizeLength(indexAttributeAfterAssembly.count);
                const assembledPositionCount = normalizeLength(positionAttributeAfterAssembly.count);
                if (assembledIndexCount > 0 && assembledIndexCount === assembledPositionCount) {
                    const assembledIndices = indexAttributeAfterAssembly.array;
                    if (this._isSuspiciousExpandedSharedIndex(assembledIndices, assembledIndexCount, assembledPositionCount, blob)) {
                        this._captureExpandedSharedVertexIndices(assembledIndices, assembledIndexCount);
                        this._indices = undefined;
                        measureThreeBuildStage(() => {
                            this._geometry.setIndex(null);
                        });
                        acceptedNonIndexedIndexPayload = true;
                    }
                }
            }
            const materialId = normalizeHydraPath(blob.materialId);
            if (typeof materialId === 'string' && materialId.length > 0) {
                measureThreeBuildStage(() => this.setMaterial(materialId));
            }
            const geomSubsetSections = Array.isArray(blob.geomSubsetSections)
                ? blob.geomSubsetSections
                : [];
            if (geomSubsetSections.length > 0) {
                measureThreeBuildStage(() => this.setGeomSubsetMaterial(geomSubsetSections));
            }
            if (this._geometry.getAttribute('normal')?.count > 0) {
                this._needsNormalFallback = false;
            }
            else {
                this._needsNormalFallback = true;
                this.ensureFallbackNormalsIfMissing();
            }
            const finalPositionCount = Number(this._geometry.getAttribute('position')?.count || 0);
            const finalIndexCount = Number(this._geometry.getIndex()?.count || 0);
            const expectsPositionPayload = pointValueCount > 0;
            const expectsIndexPayload = numIndices > 0;
            const positionReady = !expectsPositionPayload || finalPositionCount > 0;
            const indexReady = !expectsIndexPayload || finalIndexCount > 0 || acceptedNonIndexedIndexPayload;
            const geometryReady = positionReady && indexReady;
            if (!geometryReady) {
                if (allowForceRefreshRetry && !forceRefresh && !useBlobOverride) {
                    return this.tryApplyProtoDataBlobFastPath({
                        forceRefresh: true,
                        allowForceRefreshRetry: false,
                    });
                }
                return false;
            }
            return true;
        }
        finally {
            if (phaseInstrumentationEnabled) {
                this._interface?.recordHydraWasmFetchPhase?.(Math.max(0, wasmFetchMs), this._id);
                this._interface?.recordHydraThreeBuildPhase?.(Math.max(0, threeBuildMs), this._id);
            }
        }
    }
    applyProtoStageSync(options = {}) {
        if (!this._id.includes(".proto_"))
            return;
        if (this.shouldDeferProtoStageSyncUntilSceneSnapshot())
            return;
        const allowDeferredFinalBatch = options?.allowDeferredFinalBatch !== false;
        const finalizeProtoSync = () => {
            if (this.isCollisionProtoMesh() && !this._appliedCollisionOverride) {
                this._hasCompletedProtoSync = false;
                return;
            }
            this._hasCompletedProtoSync = true;
        };
        const finalStageOverride = (this._interface?._finalStageOverrideBatchCache?.get?.(this._id)
            || (this.isVisualProtoMesh() ? this._interface?.getVisualProtoOverride?.(this._id) : null)
            || (this.isCollisionProtoMesh() ? this._interface?.getCollisionProtoOverride?.(this._id) : null)
            || null);
        const protoForSkipDecision = this.isVisualProtoMesh() ? parseProtoMeshIdentifier(this._id) : null;
        const shouldSkipVisualFinalStageOverride = (this.isVisualProtoMesh()
            && protoForSkipDecision?.protoType === 'mesh'
            && !this._hasEverReceivedTransform);
        if (finalStageOverride?.valid === true && !shouldSkipVisualFinalStageOverride) {
            const applied = this.applyFinalStageOverrideFromDriver(finalStageOverride, {
                skipTransformFallback: true,
                skipCollisionRotationFallback: true,
            }) === true;
            if (applied) {
                finalizeProtoSync();
                return;
            }
        }
        const preferFinalBatchSync = this._interface?.preferFinalStageOverrideBatchInProtoSync === true;
        const finalBatchPrimed = this._interface?._finalStageOverrideBatchPrimed === true;
        const shouldDeferToFinalBatch = (allowDeferredFinalBatch
            && preferFinalBatchSync
            && !finalBatchPrimed
            // Visual proto meshes must keep local fast-path sync available by default.
            // In the common fast-load configuration, visual stage-overrides are disabled,
            // so deferring here can leave visuals unsynchronized (empty placeholders).
            && this.isCollisionProtoMesh());
        if (shouldDeferToFinalBatch) {
            // Defer expensive per-mesh fallback sync until a final-stage override batch
            // is primed. Keep this optimization collision-only to avoid starving visuals.
            return;
        }
        const useProtoBlobFastPath = this._interface?.enableProtoBlobFastPath === true;
        // If Hydra has already streamed geometry payloads for this mesh, the proto blob
        // path is redundant and may trigger expensive driver batch fetches on the hot path.
        const shouldAttemptProtoBlobFastPath = this._hasHydraGeometryPayload !== true;
        if (useProtoBlobFastPath && shouldAttemptProtoBlobFastPath && this.tryApplyProtoDataBlobFastPath()) {
            // Keep initial fast-load pose stable: geometry comes from proto blob,
            // while transform alignment still follows the existing fallback sync path.
            this.syncProtoTransformFromFallback();
            this.syncCollisionRotationFromVisualLink();
            finalizeProtoSync();
            return;
        }
        if (this._appliedCollisionOverride) {
            this.syncProtoTransformFromFallback();
            this.syncCollisionRotationFromVisualLink();
            finalizeProtoSync();
            return;
        }
        if (this.isCollisionProtoMesh() && this.applyCollisionGeometryFromOverrides()) {
            this.syncProtoTransformFromFallback();
            this.syncCollisionRotationFromVisualLink();
            finalizeProtoSync();
            return;
        }
        const resolvedPrimPath = this.isCollisionProtoMesh() ? this._interface.getResolvedPrimPathForMeshId(this._id) : null;
        if (resolvedPrimPath && this.applyResolvedPrimGeometryAndTransform(resolvedPrimPath)) {
            this.syncProtoTransformFromFallback();
            this.syncCollisionRotationFromVisualLink();
            finalizeProtoSync();
            return;
        }
        this.syncProtoTransformFromFallback();
        this.syncCollisionRotationFromVisualLink();
        finalizeProtoSync();
    }
    ensureProtoReadyForVisibility() {
        if (!this._id.includes(".proto_"))
            return false;
        if (!this.isCollisionProtoMesh())
            return false;
        if (this._hasCompletedProtoSync)
            return false;
        this.applyProtoStageSync({ allowDeferredFinalBatch: false });
        return this._hasCompletedProtoSync === true;
    }
    // Lightweight post-draw resync path:
    // keep transform/collision alignment up to date without re-running proto geometry hydration.
    resyncProtoTransformOnly() {
        if (!this._id.includes(".proto_"))
            return;
        if (this.isVisualProtoMesh()) {
            const finalStageOverride = this._interface?._finalStageOverrideBatchCache?.get?.(this._id) || null;
            // Some visual primitives (e.g. torso marker spheres on H1) may never receive
            // a Hydra transform callback, so their descriptor geometry must be applied
            // from final-stage overrides during post-draw resync.
            if (finalStageOverride?.valid === true) {
                const applied = this.applyFinalStageOverrideFromDriver(finalStageOverride, {
                    skipTransformFallback: true,
                    skipCollisionRotationFallback: true,
                }) === true;
                if (applied) {
                    this._hasCompletedProtoSync = true;
                    return;
                }
            }
        }
        if (this.isCollisionProtoMesh() && !this._appliedCollisionOverride) {
            if (this.applyCollisionGeometryFromOverrides()) {
                this.syncProtoTransformFromFallback();
                this.syncCollisionRotationFromVisualLink();
                this._hasCompletedProtoSync = true;
                return;
            }
            const resolvedPrimPath = this._interface.getResolvedPrimPathForMeshId(this._id);
            if (resolvedPrimPath) {
                this.applyResolvedPrimGeometryAndTransform(resolvedPrimPath);
            }
        }
        this.syncProtoTransformFromFallback();
        this.syncCollisionRotationFromVisualLink();
        this._hasCompletedProtoSync = !this.isCollisionProtoMesh() || this._appliedCollisionOverride;
    }
    skelDetected(skelId, jointIndices, jointWeights, bindTransform) {
        const skeletonHandler = this._interface.skeletons[skelId];
        if (!skeletonHandler || !skeletonHandler._skeleton) {
            return;
        }
        // Prepare Geometry Attributes
        if (!this._geometry.attributes.skinIndex && jointIndices) {
            // Check stride
            const vertexCount = this._points ? this._points.length / 3 : 0; // _points might be null if not loaded yet? Usually it is.
            // Note: jointIndices is a Float32Array or similar.
            let stride = 4;
            if (vertexCount > 0) {
                stride = Math.floor(jointIndices.length / vertexCount);
            }
            // Three.js expects 4 indices/weights per vertex
            if (stride === 4) {
                this._geometry.setAttribute('skinIndex', new Float32BufferAttribute(jointIndices, 4));
                this._geometry.setAttribute('skinWeight', new Float32BufferAttribute(jointWeights, 4));
            }
            else {
                // We need to re-stride. This is expensive but necessary if data doesn't match.
                // For now, assume 4 or warn.
                // Often stride is defined by the elementSize.
                // Fallback: If stride is not 4, we might need to pad or truncate.
                // Let's try to just set it and hope Three.js handles it or we're lucky it's 4.
                this._geometry.setAttribute('skinIndex', new Float32BufferAttribute(jointIndices, stride));
                this._geometry.setAttribute('skinWeight', new Float32BufferAttribute(jointWeights, stride));
            }
        }
        // Create SkinnedMesh
        const newMesh = new SkinnedMesh(this._geometry, this._mesh.material);
        newMesh.castShadow = this._mesh.castShadow;
        newMesh.receiveShadow = this._mesh.receiveShadow;
        newMesh.name = this._mesh.name;
        newMesh.matrixAutoUpdate = false;
        newMesh.matrix.copy(this._mesh.matrix);
        newMesh.visible = this._mesh.visible;
        // Bind Skeleton
        const skeleton = skeletonHandler._skeleton;
        newMesh.add(skeleton.bones[0]); // Add root bone to mesh? Or to scene? 
        // Usually bones are added to the scene hierarchy. 
        // If we just add them to the mesh, they move with it.
        // But we need to make sure the bones are in the scene graph.
        // For simplicity, let's add the root bone(s) to the mesh so they are part of the object.
        // Or we should add them to the usdRoot if they are shared?
        // UsdSkel skeletons are often shared. If we add to mesh, we duplicate if shared?
        // Clone the skeleton for each mesh? 
        // Three.js SkinnedMesh usually takes a Skeleton instance.
        // If multiple meshes share a skeleton, the bones should probably be in a common parent.
        // Let's check if bones are already in scene.
        if (!skeleton.bones[0].parent) {
            // add root bones to the mesh or a common group
            // newMesh.add(skeleton.bones[0]);
            // Actually, let's add them to the mesh for now.
            skeleton.bones.forEach(b => {
                if (!b.parent)
                    newMesh.add(b);
            });
        }
        newMesh.bind(skeleton, bindTransform ? new Matrix4().fromArray(bindTransform).transpose().invert() : undefined);
        // Replace old mesh
        this._interface.config.usdRoot.remove(this._mesh);
        this._interface.config.usdRoot.add(newMesh);
        this._mesh = newMesh;
    }
}
export { HydraMesh };
