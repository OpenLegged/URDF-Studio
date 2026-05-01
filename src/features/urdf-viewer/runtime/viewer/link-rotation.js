import { MathUtils, Matrix4, Plane, Raycaster, Vector2, Vector3 } from "three";
import { getRenderRobotMetadataSnapshot, warmupRenderRobotMetadataSnapshot, } from "./robot-metadata.js";
import { disposeUsdStageHandle } from "./usd-stage-handle.js";
import { axisTokenFromAxisVector, buildRuntimeLinkPathIndex, clampJointAnglePreservingNeutralZero, cloneJointCatalogEntry, extractPhysicsPayloadAssetPathsFromLayerText, getInteractiveJointLimits, getJointPathCandidatesForLinkPath, getLinkPathFromMeshId, getRootPathFromLinkPath, getRootPathsFromRenderInterface, isControllableRevoluteJointTypeName, isPhysicsJointTypeName, jointCatalogCacheByStagePath, maxJointCatalogCacheEntries, normalizeAxisToken, normalizeAxisVector, normalizeLimits, pickRuntimeParentLinkPath, resolveRuntimeLinkPathsFromSourcePath, resolveUsdAssetPath, rotateAxisByQuaternion, roundAngleDegrees, safeGetPrimAtPath, safeGetPrimAttribute, safeGetPrimTypeName, toFiniteNumber, toQuaternionFromValue, toUsdPathListFromValue, toVector3FromValue, } from "./link-rotation/shared.js";
import { ingestJointCatalogFromStage, } from "./link-rotation/catalog-ingestion.js";
import { resolveRevoluteDragDelta } from "./link-rotation/drag-delta.js";
import { resolveLinkRotationCursor } from "./link-rotation-cursor.js";
export class LinkRotationController {
    constructor() {
        this.enabled = false;
        this.dragging = false;
        this.selectedLinkPath = null;
        this.activeLinkPath = null;
        this.pickSubType = null;
        this.renderInterface = null;
        this.domElement = null;
        this.camera = null;
        this.controls = null;
        this.onSelectionChanged = null;
        this.raycaster = new Raycaster();
        this.pointer = new Vector2();
        this.linkJointStateByLinkPath = new Map();
        this.jointCatalogByLinkPath = new Map();
        this.linkParentPathByLinkPath = new Map();
        this.linkPathByMeshId = new Map();
        this.subtreeLinkPathsByAncestorLinkPath = new Map();
        this.subtreeMeshIdsByAncestorLinkPath = new Map();
        this.lastAppliedMeshIds = new Set();
        this.baseMatrixByMeshId = new Map();
        this.baseLinkFrameMatrixByLinkPath = new Map();
        this.posedLinkFrameMatrixByLinkPath = new Map();
        this.subtreeIndexDirty = true;
        this.jointCatalogBuildPromise = null;
        this.jointCatalogStatus = "idle";
        this.jointCatalogError = null;
        this.lastJointCatalogBuildAttemptAtMs = 0;
        this.hasAppliedJointPose = false;
        this.jointPoseDirty = false;
        this.basePoseDirty = true;
        this.lastIdleBasePoseRefreshAtMs = 0;
        this.lastKnownMeshCount = -1;
        this.idleBasePoseRefreshIntervalMs = this.getDurationParamMsFromQuery("idleBasePoseRefreshIntervalMs", 2500, 120, 120000);
        this.jointCatalogUiWaitBudgetMs = this.getDurationParamMsFromQuery("jointCatalogWaitBudgetMs", 96, 0, 10000);
        this.jointCatalogStageFallbackDelayMs = this.getDurationParamMsFromQuery("jointCatalogStageFallbackDelayMs", 40, 0, 120000);
        this.jointCatalogStageFallbackIdleTimeoutMs = this.getDurationParamMsFromQuery("jointCatalogStageFallbackIdleTimeoutMs", 40, 0, 120000);
        this.jointCatalogRebuildCooldownMs = this.getDurationParamMsFromQuery("jointCatalogRebuildCooldownMs", 320, 0, 120000);
        this.stageSourcePath = null;
        this.tempTranslateToPivot = new Matrix4();
        this.tempTranslateFromPivot = new Matrix4();
        this.tempRotation = new Matrix4();
        this.tempComposed = new Matrix4();
        this.tempAxisWorld = new Vector3();
        this.tempPivotWorld = new Vector3();
        this.tempDragPlane = new Plane();
        this.tempDragPointWorld = new Vector3();
        this.tempPrevDragPointWorld = new Vector3();
        this.tempProjectedPrevVectorWorld = new Vector3();
        this.tempProjectedNextVectorWorld = new Vector3();
        this.tempDragCrossWorld = new Vector3();
        this.tempDragDeltaWorld = new Vector3();
        this.tempCameraViewWorld = new Vector3();
        this.tempCameraForwardWorld = new Vector3();
        this.tempUsdRootInverseWorldMatrix = new Matrix4();
        this.tempRayOriginLocal = new Vector3();
        this.tempRayDirectionLocal = new Vector3();
        this.tempPrevRayOriginLocal = new Vector3();
        this.tempPrevRayDirectionLocal = new Vector3();
        this.dragHitDistance = 0;
        this.dragLastLocalX = 0;
        this.dragLastLocalY = 0;
        this.pointerBounds = null;
        this.handlePointerDown = (event) => {
            if (!this.enabled || event.button !== 0)
                return;
            this.ensureJointCatalogBuildScheduled();
            const hit = this.pickLinkHitAtPointer(event);
            if (!hit)
                return;
            const { linkPath, distance, localX, localY } = hit;
            this.selectedLinkPath = linkPath;
            this.activeLinkPath = null;
            this.dragging = false;
            this.dragHitDistance = distance;
            this.dragLastLocalX = localX;
            this.dragLastLocalY = localY;
            const jointState = this.getOrResolveJointStateForLinkPath(linkPath);
            if (!jointState) {
                this.updateCursor();
                this.emitSelectionChanged(linkPath);
                return;
            }
            this.activeLinkPath = linkPath;
            this.dragging = true;
            if (this.controls)
                this.controls.enabled = false;
            this.updateCursor();
            this.emitSelectionChanged(linkPath);
            try {
                this.domElement?.setPointerCapture(event.pointerId);
            }
            catch { }
            event.preventDefault();
        };
        this.handlePointerMove = (event) => {
            if (!this.enabled || !this.dragging || !this.activeLinkPath)
                return;
            const jointState = this.getOrResolveJointStateForLinkPath(this.activeLinkPath);
            if (!jointState)
                return;
            const localPoint = this.resolveLocalPointerFromClient(event.clientX, event.clientY);
            if (!localPoint)
                return;
            const deltaAngleDeg = this.getRevoluteDeltaDeg(jointState, this.dragLastLocalX, this.dragLastLocalY, localPoint.x, localPoint.y);
            const interactiveLimits = getInteractiveJointLimits(jointState.lowerLimitDeg, jointState.upperLimitDeg);
            const nextAngle = clampJointAnglePreservingNeutralZero(jointState.angleDeg + deltaAngleDeg, interactiveLimits.lower, interactiveLimits.upper);
            this.dragLastLocalX = localPoint.x;
            this.dragLastLocalY = localPoint.y;
            if (Math.abs(nextAngle - jointState.angleDeg) <= 1e-8)
                return;
            jointState.angleDeg = nextAngle;
            this.jointPoseDirty = true;
            this.emitSelectionChanged(this.activeLinkPath);
            event.preventDefault();
        };
        this.handlePointerUp = () => {
            if (!this.dragging)
                return;
            this.dragging = false;
            this.activeLinkPath = null;
            this.dragHitDistance = 0;
            this.pointerBounds = null;
            if (this.controls)
                this.controls.enabled = true;
            if (this.selectedLinkPath) {
                this.emitSelectionChanged(this.selectedLinkPath);
            }
            this.updateCursor();
        };
    }
    attach(domElement, camera, controls) {
        if (this.domElement) {
            this.domElement.removeEventListener("pointerdown", this.handlePointerDown);
            window.removeEventListener("pointermove", this.handlePointerMove);
            window.removeEventListener("pointerup", this.handlePointerUp);
            window.removeEventListener("pointercancel", this.handlePointerUp);
            window.removeEventListener("blur", this.handlePointerUp);
        }
        this.domElement = domElement || null;
        this.camera = camera || null;
        this.controls = controls || null;
        if (!this.domElement)
            return;
        this.domElement.addEventListener("pointerdown", this.handlePointerDown);
        window.addEventListener("pointermove", this.handlePointerMove);
        window.addEventListener("pointerup", this.handlePointerUp);
        window.addEventListener("pointercancel", this.handlePointerUp);
        window.addEventListener("blur", this.handlePointerUp);
        this.updateCursor();
    }
    setRenderInterface(renderInterface) {
        this.renderInterface = renderInterface || null;
        this.linkJointStateByLinkPath.clear();
        this.jointCatalogByLinkPath.clear();
        this.linkParentPathByLinkPath.clear();
        this.linkPathByMeshId.clear();
        this.subtreeLinkPathsByAncestorLinkPath.clear();
        this.subtreeMeshIdsByAncestorLinkPath.clear();
        this.lastAppliedMeshIds.clear();
        this.baseMatrixByMeshId.clear();
        this.baseLinkFrameMatrixByLinkPath.clear();
        this.posedLinkFrameMatrixByLinkPath.clear();
        this.subtreeIndexDirty = true;
        this.jointCatalogBuildPromise = null;
        this.hasAppliedJointPose = false;
        this.jointPoseDirty = false;
        this.basePoseDirty = true;
        this.lastKnownMeshCount = -1;
        this.lastIdleBasePoseRefreshAtMs = 0;
        this.lastJointCatalogBuildAttemptAtMs = 0;
        this.setJointCatalogStatus("idle");
    }
    setStageSourcePath(path) {
        const normalized = String(path || "").trim();
        this.stageSourcePath = normalized ? normalized.split("?")[0] : null;
    }
    getStageSourcePath() {
        return this.stageSourcePath;
    }
    setEnabled(enabled) {
        this.enabled = !!enabled;
        if (!this.enabled) {
            this.dragging = false;
            this.activeLinkPath = null;
            if (this.controls)
                this.controls.enabled = true;
        }
        this.updateCursor();
    }
    setPickSubType(subType) {
        this.pickSubType = subType === "visual" || subType === "collision" ? subType : null;
    }
    prewarmJointPosePipeline() {
        if (!this.enabled || !this.renderInterface?.meshes)
            return;
        if (Object.keys(this.renderInterface.meshes).length <= 0)
            return;
        if (!this.basePoseDirty && this.baseMatrixByMeshId.size > 0 && this.posedLinkFrameMatrixByLinkPath.size > 0) {
            return;
        }
        try {
            this.apply(this.renderInterface, {
                force: true,
                suppressIdleRefresh: true,
            });
        }
        catch { }
    }
    async prewarmJointCatalog() {
        this.ensureJointCatalogBuildScheduled();
        try {
            await this.ensureJointCatalogReady();
        }
        catch { }
    }
    prewarmInteractivePoseCaches() {
        if (!this.enabled || !this.renderInterface?.meshes)
            return;
        if (Object.keys(this.renderInterface.meshes).length <= 0)
            return;
        this.refreshMeshLinkPathIndex();
        if (this.jointCatalogByLinkPath.size === 0 && this.linkParentPathByLinkPath.size === 0) {
            const runtimeLinkPathIndex = buildRuntimeLinkPathIndex(this.renderInterface);
            if (runtimeLinkPathIndex.allLinkPaths.size > 0) {
                const cachedRenderSnapshot = getRenderRobotMetadataSnapshot(this.renderInterface, this.stageSourcePath);
                this.ingestJointCatalogFromRenderSnapshot(cachedRenderSnapshot, runtimeLinkPathIndex);
            }
        }
        this.ensureSubtreeIndex({ resolveMissingParents: true });
        this.captureCurrentPoseAsBasePose();
        const baseLinkPoseByLinkPath = this.buildBaseLinkPoseMap();
        this.syncPosedLinkFrameMap(baseLinkPoseByLinkPath);
        this.basePoseDirty = false;
        this.jointPoseDirty = false;
        this.hasAppliedJointPose = false;
        const nowMs = (typeof performance !== "undefined" && typeof performance.now === "function")
            ? performance.now()
            : Date.now();
        this.lastIdleBasePoseRefreshAtMs = nowMs;
    }
    setOnSelectionChanged(handler) {
        this.onSelectionChanged = handler;
    }
    getSelectedLinkPath() {
        return this.selectedLinkPath;
    }
    getJointInfoForLink(linkPath) {
        const jointState = this.getOrResolveJointStateForLinkPath(linkPath);
        if (!jointState)
            return null;
        return {
            linkPath,
            jointPath: jointState.jointPath,
            axisToken: jointState.axisToken,
            lowerLimitDeg: roundAngleDegrees(jointState.lowerLimitDeg),
            upperLimitDeg: roundAngleDegrees(jointState.upperLimitDeg),
            angleDeg: roundAngleDegrees(jointState.angleDeg),
        };
    }
    getCurrentLinkFrameMatrix(linkPath) {
        if (!linkPath)
            return null;
        return this.getCurrentLinkFrameMatrixForLinkPath(linkPath);
    }
    async getAllJointInfos() {
        this.ensureJointCatalogBuildScheduled();
        await this.ensureJointCatalogReady({ maxWaitMs: this.jointCatalogUiWaitBudgetMs });
        const linkPaths = new Set();
        for (const linkPath of this.jointCatalogByLinkPath.keys()) {
            linkPaths.add(linkPath);
        }
        for (const linkPath of this.linkJointStateByLinkPath.keys()) {
            linkPaths.add(linkPath);
        }
        const scanMeshLinksForJoints = false;
        if (scanMeshLinksForJoints && this.renderInterface?.meshes) {
            for (const meshId of Object.keys(this.renderInterface.meshes)) {
                const linkPath = getLinkPathFromMeshId(meshId);
                if (linkPath)
                    linkPaths.add(linkPath);
            }
        }
        const entries = [];
        for (const linkPath of linkPaths) {
            const isKnownLinkPath = this.jointCatalogByLinkPath.has(linkPath) || this.linkJointStateByLinkPath.has(linkPath);
            if (!isKnownLinkPath && !scanMeshLinksForJoints)
                continue;
            const info = this.getJointInfoForLink(linkPath);
            if (!info)
                continue;
            entries.push(info);
        }
        entries.sort((left, right) => left.linkPath.localeCompare(right.linkPath));
        return entries;
    }
    setJointAngleForLink(linkPath, angleDeg, options = {}) {
        const jointState = this.getOrResolveJointStateForLinkPath(linkPath);
        if (!jointState)
            return null;
        if (!Number.isFinite(angleDeg))
            return this.getJointInfoForLink(linkPath);
        const previousAngle = jointState.angleDeg;
        const interactiveLimits = getInteractiveJointLimits(jointState.lowerLimitDeg, jointState.upperLimitDeg);
        jointState.angleDeg = clampJointAnglePreservingNeutralZero(angleDeg, interactiveLimits.lower, interactiveLimits.upper);
        if (Math.abs(jointState.angleDeg - previousAngle) > 1e-8) {
            this.jointPoseDirty = true;
        }
        const shouldEmitSelectionChanged = options.emitSelectionChanged !== false;
        if (shouldEmitSelectionChanged && (this.selectedLinkPath === linkPath || this.activeLinkPath === linkPath)) {
            this.emitSelectionChanged(linkPath);
        }
        return this.getJointInfoForLink(linkPath);
    }
    clear() {
        this.linkJointStateByLinkPath.clear();
        this.jointCatalogByLinkPath.clear();
        this.linkParentPathByLinkPath.clear();
        this.linkPathByMeshId.clear();
        this.subtreeLinkPathsByAncestorLinkPath.clear();
        this.subtreeMeshIdsByAncestorLinkPath.clear();
        this.lastAppliedMeshIds.clear();
        this.baseMatrixByMeshId.clear();
        this.baseLinkFrameMatrixByLinkPath.clear();
        this.posedLinkFrameMatrixByLinkPath.clear();
        this.subtreeIndexDirty = true;
        this.jointCatalogBuildPromise = null;
        this.lastJointCatalogBuildAttemptAtMs = 0;
        this.setJointCatalogStatus("idle");
        this.hasAppliedJointPose = false;
        this.jointPoseDirty = false;
        this.basePoseDirty = true;
        this.lastKnownMeshCount = -1;
        this.lastIdleBasePoseRefreshAtMs = 0;
        this.selectedLinkPath = null;
        this.activeLinkPath = null;
        this.dragging = false;
        if (this.controls)
            this.controls.enabled = true;
        this.updateCursor();
    }
    setJointCatalogStatus(status, error = null) {
        this.jointCatalogStatus = status;
        this.jointCatalogError = error ?? null;
    }
    apply(renderInterface, options = {}) {
        const force = options.force === true;
        const suppressIdleRefresh = options.suppressIdleRefresh === true;
        if (renderInterface)
            this.renderInterface = renderInterface;
        if (!this.enabled || !this.renderInterface?.meshes)
            return false;
        const meshCount = Object.keys(this.renderInterface.meshes).length;
        if (meshCount !== this.lastKnownMeshCount) {
            this.lastKnownMeshCount = meshCount;
            this.refreshMeshLinkPathIndex();
            this.basePoseDirty = true;
            if (meshCount > 0) {
                this.ensureJointCatalogBuildScheduled();
            }
        }
        const activeJointStates = Array.from(this.linkJointStateByLinkPath.values())
            .filter((jointState) => Math.abs(jointState.angleDeg) > 1e-8)
            .sort((left, right) => this.getLinkDepth(left.linkPath) - this.getLinkDepth(right.linkPath));
        if (activeJointStates.length === 0) {
            if (this.hasAppliedJointPose) {
                const meshIdsToRestore = this.lastAppliedMeshIds.size > 0 ? this.lastAppliedMeshIds : null;
                this.restoreBasePoseToCurrentMeshes(meshIdsToRestore);
                this.lastAppliedMeshIds.clear();
                const restoredLinkPoseByLinkPath = this.buildBaseLinkPoseMap();
                this.syncPosedLinkFrameMap(restoredLinkPoseByLinkPath);
                this.hasAppliedJointPose = false;
                this.basePoseDirty = true;
                this.lastIdleBasePoseRefreshAtMs = 0;
                this.jointPoseDirty = false;
                return true;
            }
            if (!this.basePoseDirty && suppressIdleRefresh) {
                this.jointPoseDirty = false;
                return false;
            }
            const nowMs = (typeof performance !== "undefined" && typeof performance.now === "function")
                ? performance.now()
                : Date.now();
            if (!this.basePoseDirty
                && (nowMs - this.lastIdleBasePoseRefreshAtMs) < this.idleBasePoseRefreshIntervalMs) {
                this.jointPoseDirty = false;
                return false;
            }
            this.captureCurrentPoseAsBasePose();
            const basePoseChanged = this.restoreBasePoseToCurrentMeshes();
            this.lastAppliedMeshIds.clear();
            const refreshedLinkPoseByLinkPath = this.buildBaseLinkPoseMap();
            this.syncPosedLinkFrameMap(refreshedLinkPoseByLinkPath);
            this.basePoseDirty = false;
            this.lastIdleBasePoseRefreshAtMs = nowMs;
            this.jointPoseDirty = false;
            return basePoseChanged;
        }
        if (!force && !this.jointPoseDirty && this.hasAppliedJointPose && !this.basePoseDirty) {
            return false;
        }
        this.ensureSubtreeIndex();
        const affectedLinkPaths = this.collectAffectedLinkPaths(activeJointStates);
        const affectedMeshIds = this.collectAffectedMeshIds(activeJointStates);
        const meshIdsToRestore = new Set(this.lastAppliedMeshIds);
        for (const meshId of affectedMeshIds) {
            meshIdsToRestore.add(meshId);
        }
        if (meshIdsToRestore.size > 0) {
            this.restoreBasePoseToCurrentMeshes(meshIdsToRestore);
        }
        else {
            this.restoreBasePoseToCurrentMeshes();
        }
        this.lastAppliedMeshIds.clear();
        for (const meshId of affectedMeshIds) {
            this.lastAppliedMeshIds.add(meshId);
        }
        const linkPoseByLinkPath = new Map();
        if (affectedLinkPaths.size > 0) {
            for (const linkPath of affectedLinkPaths) {
                const baseMatrix = this.getBaseLinkFrameMatrixForLinkPath(linkPath);
                if (!baseMatrix)
                    continue;
                linkPoseByLinkPath.set(linkPath, baseMatrix.clone());
            }
        }
        else {
            const fullBaseLinkPose = this.buildBaseLinkPoseMap();
            for (const [linkPath, linkMatrix] of fullBaseLinkPose.entries()) {
                linkPoseByLinkPath.set(linkPath, linkMatrix.clone());
            }
        }
        for (const jointState of activeJointStates) {
            const linkMatrix = linkPoseByLinkPath.get(jointState.linkPath) || this.getBaseLinkFrameMatrixForLinkPath(jointState.linkPath);
            if (!linkMatrix)
                continue;
            this.tempAxisWorld.copy(jointState.axisLocal).transformDirection(linkMatrix).normalize();
            if (this.tempAxisWorld.lengthSq() <= 1e-12)
                continue;
            if (jointState.localPivotInLink) {
                this.tempPivotWorld.copy(jointState.localPivotInLink).applyMatrix4(linkMatrix);
            }
            else {
                this.tempPivotWorld.setFromMatrixPosition(linkMatrix);
            }
            this.tempTranslateToPivot.makeTranslation(this.tempPivotWorld.x, this.tempPivotWorld.y, this.tempPivotWorld.z);
            this.tempRotation.makeRotationAxis(this.tempAxisWorld, MathUtils.degToRad(jointState.angleDeg));
            this.tempTranslateFromPivot.makeTranslation(-this.tempPivotWorld.x, -this.tempPivotWorld.y, -this.tempPivotWorld.z);
            this.tempComposed.copy(this.tempTranslateToPivot);
            this.tempComposed.multiply(this.tempRotation);
            this.tempComposed.multiply(this.tempTranslateFromPivot);
            this.applyRotationToLinkSubtree(jointState.linkPath, this.tempComposed);
            this.applyRotationToLinkPoseSubtree(jointState.linkPath, this.tempComposed, linkPoseByLinkPath);
        }
        this.syncPosedLinkFrameMap(linkPoseByLinkPath);
        this.hasAppliedJointPose = true;
        this.basePoseDirty = false;
        this.jointPoseDirty = false;
        return true;
    }
    captureCurrentPoseAsBasePose() {
        const meshes = this.renderInterface?.meshes;
        if (!meshes)
            return;
        const seen = new Set();
        for (const [meshId, hydraMesh] of Object.entries(meshes)) {
            const mesh = hydraMesh?._mesh;
            if (!mesh?.matrix)
                continue;
            seen.add(meshId);
            this.baseMatrixByMeshId.set(meshId, this.getPreferredBaseMatrixForMesh(meshId, mesh.matrix));
        }
        for (const meshId of Array.from(this.baseMatrixByMeshId.keys())) {
            if (!seen.has(meshId)) {
                this.baseMatrixByMeshId.delete(meshId);
            }
        }
        // Base link frames should follow the currently displayed pose source.
        // Stage transforms can lag behind runtime mesh fallback corrections, so
        // reset this cache whenever we refresh the base snapshot.
        this.baseLinkFrameMatrixByLinkPath.clear();
    }
    restoreBasePoseToCurrentMeshes(targetMeshIds = null) {
        const meshes = this.renderInterface?.meshes;
        if (!meshes)
            return false;
        if (this.baseMatrixByMeshId.size === 0) {
            this.captureCurrentPoseAsBasePose();
        }
        const targetSet = targetMeshIds ? new Set(targetMeshIds) : null;
        let changed = false;
        const seen = new Set();
        for (const [meshId, hydraMesh] of Object.entries(meshes)) {
            if (targetSet && !targetSet.has(meshId))
                continue;
            const mesh = hydraMesh?._mesh;
            if (!mesh?.matrix)
                continue;
            seen.add(meshId);
            let baseMatrix = this.baseMatrixByMeshId.get(meshId);
            if (!baseMatrix) {
                baseMatrix = this.getPreferredBaseMatrixForMesh(meshId, mesh.matrix);
                this.baseMatrixByMeshId.set(meshId, baseMatrix.clone());
                if (this.getMatrixMaxElementDelta(mesh.matrix, baseMatrix) > 1e-6) {
                    changed = true;
                }
                mesh.matrix.copy(baseMatrix);
                mesh.matrixAutoUpdate = false;
                continue;
            }
            const preferredBaseMatrix = this.getPreferredBaseMatrixForMesh(meshId, baseMatrix);
            if (this.getMatrixMaxElementDelta(baseMatrix, preferredBaseMatrix) > 1e-6) {
                baseMatrix = preferredBaseMatrix.clone();
                this.baseMatrixByMeshId.set(meshId, baseMatrix.clone());
            }
            if (this.getMatrixMaxElementDelta(mesh.matrix, baseMatrix) > 1e-6) {
                changed = true;
            }
            mesh.matrix.copy(baseMatrix);
            mesh.matrixAutoUpdate = false;
        }
        if (!targetSet) {
            for (const meshId of Array.from(this.baseMatrixByMeshId.keys())) {
                if (!seen.has(meshId)) {
                    this.baseMatrixByMeshId.delete(meshId);
                }
            }
        }
        return changed;
    }
    getPreferredBaseMatrixForMesh(meshId, currentMatrix) {
        const currentClone = currentMatrix.clone();
        if (!this.renderInterface)
            return currentClone;
        if (!meshId.includes(".proto_") || !/\/visuals\.|\/visuals\//i.test(meshId))
            return currentClone;
        const resolvedVisualPath = this.renderInterface.getResolvedVisualTransformPrimPathForMeshId?.(meshId) || null;
        if (!resolvedVisualPath)
            return currentClone;
        const resolvedVisualMatrix = this.renderInterface.getWorldTransformForPrimPath?.(resolvedVisualPath) || null;
        if (!resolvedVisualMatrix)
            return currentClone;
        const protoMeshMatch = meshId.match(/\/visuals\.proto_mesh_id(\d+)$/i);
        const protoMeshIndex = protoMeshMatch ? Number(protoMeshMatch[1]) : -1;
        const isVisualProtoSubMesh = Number.isFinite(protoMeshIndex) && protoMeshIndex > 0;
        if (isVisualProtoSubMesh) {
            const hydraMesh = this.renderInterface?.meshes?.[meshId];
            const protoBlobMatrix = hydraMesh?._lastProtoBlobTransformMatrix;
            if (protoBlobMatrix?.elements && protoBlobMatrix.elements.length >= 16) {
                const resolvedVsProtoBlobDelta = this.getMatrixMaxElementDelta(resolvedVisualMatrix, protoBlobMatrix);
                if (resolvedVsProtoBlobDelta > 1e-4) {
                    const resolvedElements = resolvedVisualMatrix.elements;
                    const protoElements = protoBlobMatrix.elements;
                    const translationDelta = Math.hypot(Number(resolvedElements[12] || 0) - Number(protoElements[12] || 0), Number(resolvedElements[13] || 0) - Number(protoElements[13] || 0), Number(resolvedElements[14] || 0) - Number(protoElements[14] || 0));
                    if (Number.isFinite(translationDelta) && translationDelta <= 1e-3) {
                        return protoBlobMatrix.clone();
                    }
                }
            }
        }
        const currentVsResolvedDelta = this.getMatrixMaxElementDelta(currentClone, resolvedVisualMatrix);
        if (currentVsResolvedDelta <= 1e-6)
            return currentClone;
        const fallbackMatrix = this.renderInterface.getFallbackTransformForMeshId?.(meshId) || null;
        if (fallbackMatrix) {
            const currentVsFallbackDelta = this.getMatrixMaxElementDelta(currentClone, fallbackMatrix);
            const resolvedVsFallbackDelta = this.getMatrixMaxElementDelta(resolvedVisualMatrix, fallbackMatrix);
            if (currentVsFallbackDelta <= 1e-5 && resolvedVsFallbackDelta > 1e-5) {
                return resolvedVisualMatrix.clone();
            }
        }
        if (!/\/mesh_\d+(?:\/mesh)?$/i.test(resolvedVisualPath)) {
            return resolvedVisualMatrix.clone();
        }
        return currentClone;
    }
    emitSelectionChanged(linkPath) {
        if (!this.onSelectionChanged)
            return;
        if (!linkPath) {
            this.onSelectionChanged(null, null);
            return;
        }
        this.onSelectionChanged(linkPath, this.getJointInfoForLink(linkPath));
    }
    updateCursor() {
        if (!this.domElement)
            return;
        this.domElement.style.cursor = resolveLinkRotationCursor({
            enabled: this.enabled,
            dragging: this.dragging,
        });
    }
    getPointerBounds(forceRefresh = false) {
        if (!this.domElement)
            return null;
        const cachedBounds = this.pointerBounds;
        const width = this.domElement.clientWidth;
        const height = this.domElement.clientHeight;
        if (!forceRefresh && cachedBounds && cachedBounds.width === width && cachedBounds.height === height) {
            return cachedBounds;
        }
        const rect = this.domElement.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0)
            return null;
        this.pointerBounds = {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
        };
        return this.pointerBounds;
    }
    setRayFromLocalPointer(localX, localY) {
        if (!this.camera || !this.domElement)
            return false;
        const width = this.domElement.clientWidth;
        const height = this.domElement.clientHeight;
        if (width <= 0 || height <= 0)
            return false;
        this.pointer.x = (localX / width) * 2 - 1;
        this.pointer.y = -(localY / height) * 2 + 1;
        this.raycaster.setFromCamera(this.pointer, this.camera);
        return true;
    }
    resolveLocalPointerFromClient(clientX, clientY, forceRefresh = false) {
        const bounds = this.getPointerBounds(forceRefresh);
        if (!bounds)
            return null;
        return {
            x: clientX - bounds.left,
            y: clientY - bounds.top,
            width: bounds.width,
            height: bounds.height,
        };
    }
    pickLinkHitAtPointer(event) {
        if (!this.camera || !this.domElement || !this.renderInterface?.meshes)
            return null;
        const localPoint = this.resolveLocalPointerFromClient(event.clientX, event.clientY, true);
        if (!localPoint)
            return null;
        if (localPoint.x < 0 || localPoint.x > localPoint.width || localPoint.y < 0 || localPoint.y > localPoint.height)
            return null;
        if (!this.setRayFromLocalPointer(localPoint.x, localPoint.y))
            return null;
        const pickMeshes = [];
        const pickMap = new Map();
        for (const [meshId, hydraMesh] of Object.entries(this.renderInterface.meshes)) {
            const mesh = hydraMesh?._mesh;
            if (!mesh || !mesh.visible)
                continue;
            if (this.pickSubType === "visual" && (mesh.userData?.isCollisionMesh === true || /\/coll(?:isions?|iders?)(?:\/|\.|$)/i.test(meshId)))
                continue;
            if (this.pickSubType === "collision" && (mesh.userData?.isVisualMesh === true || /\/visuals?(?:\/|\.|$)/i.test(meshId)))
                continue;
            pickMeshes.push(mesh);
            pickMap.set(mesh, meshId);
        }
        if (pickMeshes.length === 0)
            return null;
        const hits = this.raycaster.intersectObjects(pickMeshes, false);
        for (const hit of hits) {
            const hitMeshId = pickMap.get(hit.object);
            if (!hitMeshId)
                continue;
            const linkPath = getLinkPathFromMeshId(hitMeshId);
            if (linkPath)
                return {
                    localX: localPoint.x,
                    localY: localPoint.y,
                    linkPath,
                    distance: hit.distance,
                };
        }
        return null;
    }
    getLocalPointerRay(localX, localY, outOrigin, outDirection) {
        if (!this.camera || !this.domElement)
            return false;
        if (!this.setRayFromLocalPointer(localX, localY))
            return false;
        outOrigin.copy(this.raycaster.ray.origin);
        outDirection.copy(this.raycaster.ray.direction);
        const usdRoot = window.usdRoot;
        if (usdRoot) {
            usdRoot.updateMatrixWorld(true);
            this.tempUsdRootInverseWorldMatrix.copy(usdRoot.matrixWorld).invert();
            outOrigin.applyMatrix4(this.tempUsdRootInverseWorldMatrix);
            outDirection.transformDirection(this.tempUsdRootInverseWorldMatrix);
        }
        return true;
    }
    getLocalCameraForward(outDirection) {
        if (!this.camera)
            return false;
        this.camera.getWorldDirection(outDirection);
        const usdRoot = window.usdRoot;
        if (usdRoot) {
            usdRoot.updateMatrixWorld(true);
            this.tempUsdRootInverseWorldMatrix.copy(usdRoot.matrixWorld).invert();
            outDirection.transformDirection(this.tempUsdRootInverseWorldMatrix);
        }
        return outDirection.lengthSq() > 1e-12;
    }
    getRevoluteDeltaDeg(jointState, startLocalX, startLocalY, endLocalX, endLocalY) {
        const linkMatrix = this.getCurrentLinkFrameMatrixForLinkPath(jointState.linkPath);
        if (!linkMatrix)
            return 0;
        this.tempAxisWorld.copy(jointState.axisLocal).transformDirection(linkMatrix).normalize();
        if (this.tempAxisWorld.lengthSq() <= 1e-12)
            return 0;
        if (jointState.localPivotInLink) {
            this.tempPivotWorld.copy(jointState.localPivotInLink).applyMatrix4(linkMatrix);
        }
        else {
            this.tempPivotWorld.setFromMatrixPosition(linkMatrix);
        }
        if (!this.getLocalPointerRay(startLocalX, startLocalY, this.tempPrevRayOriginLocal, this.tempPrevRayDirectionLocal))
            return 0;
        if (!this.getLocalPointerRay(endLocalX, endLocalY, this.tempRayOriginLocal, this.tempRayDirectionLocal))
            return 0;
        this.tempPrevDragPointWorld.copy(this.tempPrevRayDirectionLocal).multiplyScalar(this.dragHitDistance).add(this.tempPrevRayOriginLocal);
        this.tempDragPointWorld.copy(this.tempRayDirectionLocal).multiplyScalar(this.dragHitDistance).add(this.tempRayOriginLocal);
        this.tempProjectedPrevVectorWorld.copy(this.tempPrevDragPointWorld);
        this.tempProjectedNextVectorWorld.copy(this.tempDragPointWorld);
        this.tempDragPlane.setFromNormalAndCoplanarPoint(this.tempAxisWorld, this.tempPivotWorld);
        this.tempDragPlane.projectPoint(this.tempProjectedPrevVectorWorld, this.tempProjectedPrevVectorWorld);
        this.tempDragPlane.projectPoint(this.tempProjectedNextVectorWorld, this.tempProjectedNextVectorWorld);
        this.tempProjectedPrevVectorWorld.sub(this.tempPivotWorld);
        this.tempProjectedNextVectorWorld.sub(this.tempPivotWorld);
        const projectedPrevLengthSq = this.tempProjectedPrevVectorWorld.lengthSq();
        const projectedNextLengthSq = this.tempProjectedNextVectorWorld.lengthSq();
        let worldDeltaDeg = 0;
        if (projectedPrevLengthSq > 1e-12 && projectedNextLengthSq > 1e-12) {
            this.tempDragCrossWorld.copy(this.tempProjectedPrevVectorWorld).cross(this.tempProjectedNextVectorWorld);
            worldDeltaDeg = MathUtils.radToDeg(Math.atan2(this.tempAxisWorld.dot(this.tempDragCrossWorld), MathUtils.clamp(this.tempProjectedPrevVectorWorld.dot(this.tempProjectedNextVectorWorld), -1, 1)));
        }
        this.tempCameraViewWorld.copy(this.tempPrevRayDirectionLocal).multiplyScalar(-1);
        const planeFacingRatio = Math.abs(this.tempCameraViewWorld.dot(this.tempAxisWorld));
        let tangentDeltaDeg = 0;
        if (this.getLocalCameraForward(this.tempCameraForwardWorld)) {
            this.tempDragDeltaWorld.copy(this.tempDragPointWorld).sub(this.tempPrevDragPointWorld);
            this.tempDragCrossWorld.copy(this.tempCameraForwardWorld).cross(this.tempAxisWorld);
            tangentDeltaDeg = MathUtils.radToDeg(this.tempDragCrossWorld.dot(this.tempDragDeltaWorld));
        }
        return resolveRevoluteDragDelta({
            worldDeltaDeg,
            tangentDeltaDeg,
            planeFacingRatio,
        });
    }
    getOrResolveJointStateForLinkPath(linkPath) {
        if (!linkPath)
            return null;
        const cachedState = this.linkJointStateByLinkPath.get(linkPath);
        if (cachedState)
            return cachedState;
        this.ensureJointCatalogBuildScheduled();
        const catalogEntry = this.jointCatalogByLinkPath.get(linkPath);
        if (catalogEntry) {
            const state = this.createStateFromCatalogEntry(catalogEntry);
            this.linkJointStateByLinkPath.set(linkPath, state);
            return state;
        }
        const stage = this.renderInterface?.getStage?.() || null;
        if (!stage)
            return null;
        const jointCandidates = getJointPathCandidatesForLinkPath(linkPath);
        for (const jointPath of jointCandidates) {
            const prim = safeGetPrimAtPath(stage, jointPath);
            if (!prim)
                continue;
            const typeName = safeGetPrimTypeName(prim).toLowerCase();
            if (!isControllableRevoluteJointTypeName(typeName))
                continue;
            const body1Path = toUsdPathListFromValue(safeGetPrimAttribute(prim, "physics:body1"))[0] || null;
            if (body1Path && body1Path !== linkPath)
                continue;
            const parentLinkPath = toUsdPathListFromValue(safeGetPrimAttribute(prim, "physics:body0"))[0] || null;
            const axisToken = normalizeAxisToken(safeGetPrimAttribute(prim, "physics:axis"));
            const localRot1 = toQuaternionFromValue(safeGetPrimAttribute(prim, "physics:localRot1"));
            const axisLocal = normalizeAxisVector(
                toVector3FromValue(safeGetPrimAttribute(prim, "urdf:axisLocal"))
                    || rotateAxisByQuaternion(axisToken, localRot1)
            );
            const limits = normalizeLimits(toFiniteNumber(safeGetPrimAttribute(prim, "physics:lowerLimit")), toFiniteNumber(safeGetPrimAttribute(prim, "physics:upperLimit")));
            const localPivotInLink = toVector3FromValue(safeGetPrimAttribute(prim, "physics:localPos1"));
            const state = {
                linkPath,
                jointPath,
                parentLinkPath,
                axisToken,
                axisLocal,
                lowerLimitDeg: limits.lower,
                upperLimitDeg: limits.upper,
                angleDeg: 0,
                localPivotInLink,
            };
            this.linkJointStateByLinkPath.set(linkPath, state);
            this.setLinkParentPath(linkPath, parentLinkPath);
            this.jointCatalogByLinkPath.set(linkPath, {
                linkPath,
                jointPath,
                parentLinkPath,
                axisToken,
                axisLocal: axisLocal.clone(),
                lowerLimitDeg: limits.lower,
                upperLimitDeg: limits.upper,
                localPivotInLink: localPivotInLink ? localPivotInLink.clone() : null,
            });
            return state;
        }
        return null;
    }
    getRepresentativeMatrixForLinkPath(linkPath) {
        if (!this.renderInterface?.meshes)
            return null;
        const prefix = `${linkPath}/`;
        let preferredVisualMatrix = null;
        let fallbackMatrix = null;
        for (const [meshId, hydraMesh] of Object.entries(this.renderInterface.meshes)) {
            if (!meshId.startsWith(prefix))
                continue;
            const matrix = hydraMesh?._mesh?.matrix;
            if (!matrix)
                continue;
            if (/\/visuals\.proto_mesh_id0$/i.test(meshId)) {
                return matrix.clone();
            }
            if (/\/visuals\.|\/visuals\//i.test(meshId)) {
                if (!preferredVisualMatrix) {
                    preferredVisualMatrix = matrix.clone();
                }
                continue;
            }
            if (!fallbackMatrix) {
                fallbackMatrix = matrix.clone();
            }
        }
        return preferredVisualMatrix || fallbackMatrix;
    }
    getMatrixMaxElementDelta(lhs, rhs) {
        if (!lhs || !rhs)
            return Number.POSITIVE_INFINITY;
        let maxDelta = 0;
        for (let elementIndex = 0; elementIndex < 16; elementIndex++) {
            const lhsValue = Number(lhs.elements[elementIndex] || 0);
            const rhsValue = Number(rhs.elements[elementIndex] || 0);
            const delta = Math.abs(lhsValue - rhsValue);
            if (delta > maxDelta)
                maxDelta = delta;
        }
        return maxDelta;
    }
    collectKnownLinkPaths() {
        const linkPaths = new Set();
        for (const linkPath of this.linkJointStateByLinkPath.keys()) {
            if (linkPath)
                linkPaths.add(linkPath);
        }
        for (const linkPath of this.jointCatalogByLinkPath.keys()) {
            if (linkPath)
                linkPaths.add(linkPath);
        }
        for (const linkPath of this.linkParentPathByLinkPath.keys()) {
            if (linkPath)
                linkPaths.add(linkPath);
        }
        if (this.renderInterface?.meshes) {
            for (const meshId of Object.keys(this.renderInterface.meshes)) {
                const linkPath = getLinkPathFromMeshId(meshId);
                if (linkPath)
                    linkPaths.add(linkPath);
            }
        }
        return Array.from(linkPaths);
    }
    getBaseLinkFrameMatrixForLinkPath(linkPath) {
        if (!linkPath)
            return null;
        const cached = this.baseLinkFrameMatrixByLinkPath.get(linkPath);
        if (cached)
            return cached.clone();
        const preferredLinkMatrix = this.renderInterface?.getPreferredLinkWorldTransform?.(linkPath) || null;
        const representativeMatrix = this.getRepresentativeMatrixForLinkPath(linkPath);
        const stage = this.renderInterface?.getStage?.() || null;
        const stagePrim = safeGetPrimAtPath(stage, linkPath);
        const stageMatrix = this.renderInterface?.getWorldTransformForPrimPath?.(linkPath) || null;
        let selectedMatrix = null;
        if (preferredLinkMatrix) {
            // Prefer the delegate's link frame selection. It keeps joint rotation axes in
            // the physical link frame (e.g. Go2 thigh/calf), while still allowing visual
            // fallback only when the stage link transform is truly degenerate.
            selectedMatrix = preferredLinkMatrix.clone();
        }
        else if (stageMatrix && stagePrim) {
            selectedMatrix = stageMatrix.clone();
        }
        else if (representativeMatrix) {
            selectedMatrix = representativeMatrix;
        }
        else if (stageMatrix) {
            selectedMatrix = stageMatrix.clone();
        }
        if (selectedMatrix) {
            this.baseLinkFrameMatrixByLinkPath.set(linkPath, selectedMatrix.clone());
            return selectedMatrix.clone();
        }
        return null;
    }
    buildBaseLinkPoseMap() {
        const linkPoseByLinkPath = new Map();
        for (const linkPath of this.collectKnownLinkPaths()) {
            const baseMatrix = this.getBaseLinkFrameMatrixForLinkPath(linkPath);
            if (!baseMatrix)
                continue;
            linkPoseByLinkPath.set(linkPath, baseMatrix.clone());
        }
        return linkPoseByLinkPath;
    }
    syncPosedLinkFrameMap(linkPoseByLinkPath) {
        this.posedLinkFrameMatrixByLinkPath.clear();
        for (const [linkPath, linkMatrix] of linkPoseByLinkPath.entries()) {
            this.posedLinkFrameMatrixByLinkPath.set(linkPath, linkMatrix.clone());
        }
    }
    getCurrentLinkFrameMatrixForLinkPath(linkPath) {
        const posedMatrix = this.posedLinkFrameMatrixByLinkPath.get(linkPath);
        if (posedMatrix)
            return posedMatrix.clone();
        return this.getBaseLinkFrameMatrixForLinkPath(linkPath);
    }
    applyRotationToLinkPoseSubtree(ancestorLinkPath, rotationMatrix, linkPoseByLinkPath) {
        const subtreeLinkPaths = this.getSubtreeLinkPaths(ancestorLinkPath);
        if (subtreeLinkPaths && subtreeLinkPaths.size > 0) {
            for (const linkPath of subtreeLinkPaths) {
                const linkMatrix = linkPoseByLinkPath.get(linkPath);
                if (!linkMatrix)
                    continue;
                linkMatrix.premultiply(rotationMatrix);
            }
            return;
        }
        for (const linkPath of this.collectKnownLinkPaths()) {
            if (!this.isLinkPathInSubtree(linkPath, ancestorLinkPath))
                continue;
            const linkMatrix = linkPoseByLinkPath.get(linkPath);
            if (!linkMatrix)
                continue;
            linkMatrix.premultiply(rotationMatrix);
        }
    }
    getParentLinkPath(linkPath) {
        if (!linkPath)
            return null;
        if (this.linkParentPathByLinkPath.has(linkPath)) {
            return this.linkParentPathByLinkPath.get(linkPath) || null;
        }
        const stage = this.renderInterface?.getStage?.() || null;
        if (!stage)
            return null;
        const jointCandidates = getJointPathCandidatesForLinkPath(linkPath);
        for (const jointPath of jointCandidates) {
            const prim = safeGetPrimAtPath(stage, jointPath);
            if (!prim)
                continue;
            const typeName = safeGetPrimTypeName(prim);
            if (!isPhysicsJointTypeName(typeName))
                continue;
            const body1Path = toUsdPathListFromValue(safeGetPrimAttribute(prim, "physics:body1"))[0] || null;
            if (body1Path && body1Path !== linkPath)
                continue;
            const parentLinkPath = toUsdPathListFromValue(safeGetPrimAttribute(prim, "physics:body0"))[0] || null;
            this.setLinkParentPath(linkPath, parentLinkPath);
            return parentLinkPath;
        }
        this.setLinkParentPath(linkPath, null);
        return null;
    }
    applyRotationToLinkSubtree(ancestorLinkPath, rotationMatrix) {
        if (!this.renderInterface?.meshes)
            return;
        if (this.linkPathByMeshId.size <= 0) {
            this.refreshMeshLinkPathIndex();
        }
        const subtreeMeshIds = this.getSubtreeMeshIds(ancestorLinkPath);
        if (subtreeMeshIds && subtreeMeshIds.length > 0) {
            for (const meshId of subtreeMeshIds) {
                const hydraMesh = this.renderInterface.meshes[meshId];
                const mesh = hydraMesh?._mesh;
                if (!mesh)
                    continue;
                mesh.matrix.premultiply(rotationMatrix);
                mesh.matrixAutoUpdate = false;
            }
            return;
        }
        const inSubtreeByLinkPath = new Map();
        for (const [meshId, linkPath] of this.linkPathByMeshId.entries()) {
            const cached = inSubtreeByLinkPath.get(linkPath);
            const inSubtree = cached !== undefined ? cached : this.isLinkPathInSubtree(linkPath, ancestorLinkPath);
            if (cached === undefined)
                inSubtreeByLinkPath.set(linkPath, inSubtree);
            if (!inSubtree)
                continue;
            const hydraMesh = this.renderInterface.meshes[meshId];
            const mesh = hydraMesh?._mesh;
            if (!mesh)
                continue;
            mesh.matrix.premultiply(rotationMatrix);
            mesh.matrixAutoUpdate = false;
        }
    }
    refreshMeshLinkPathIndex() {
        this.linkPathByMeshId.clear();
        const meshes = this.renderInterface?.meshes;
        this.markSubtreeIndexDirty();
        if (!meshes)
            return;
        for (const meshId of Object.keys(meshes)) {
            const linkPath = getLinkPathFromMeshId(meshId);
            if (!linkPath)
                continue;
            this.linkPathByMeshId.set(meshId, linkPath);
        }
    }
    isLinkPathInSubtree(linkPath, ancestorLinkPath) {
        if (linkPath === ancestorLinkPath)
            return true;
        const subtreeLinkPaths = this.getSubtreeLinkPaths(ancestorLinkPath);
        if (subtreeLinkPaths) {
            return subtreeLinkPaths.has(linkPath);
        }
        const visited = new Set();
        let currentLinkPath = linkPath;
        while (true) {
            if (visited.has(currentLinkPath))
                return false;
            visited.add(currentLinkPath);
            const parentLinkPath = this.getParentLinkPath(currentLinkPath);
            if (!parentLinkPath)
                return false;
            if (parentLinkPath === ancestorLinkPath)
                return true;
            currentLinkPath = parentLinkPath;
        }
    }
    getLinkDepth(linkPath) {
        let depth = 0;
        const visited = new Set();
        let currentLinkPath = linkPath;
        while (true) {
            if (visited.has(currentLinkPath))
                return depth;
            visited.add(currentLinkPath);
            const parentLinkPath = this.getParentLinkPath(currentLinkPath);
            if (!parentLinkPath)
                return depth;
            depth++;
            currentLinkPath = parentLinkPath;
        }
    }
    setLinkParentPath(linkPath, parentLinkPath) {
        if (!linkPath)
            return;
        const normalizedParent = parentLinkPath || null;
        const existingParent = this.linkParentPathByLinkPath.has(linkPath)
            ? (this.linkParentPathByLinkPath.get(linkPath) || null)
            : undefined;
        if (existingParent !== undefined && existingParent === normalizedParent)
            return;
        this.linkParentPathByLinkPath.set(linkPath, normalizedParent);
        this.markSubtreeIndexDirty();
    }
    markSubtreeIndexDirty() {
        this.subtreeIndexDirty = true;
    }
    ensureSubtreeIndex(options = {}) {
        if (this.linkPathByMeshId.size <= 0) {
            this.refreshMeshLinkPathIndex();
        }
        if (options.resolveMissingParents === true) {
            const knownLinkPaths = new Set();
            for (const linkPath of this.linkPathByMeshId.values()) {
                if (linkPath)
                    knownLinkPaths.add(linkPath);
            }
            for (const linkPath of this.linkJointStateByLinkPath.keys()) {
                if (linkPath)
                    knownLinkPaths.add(linkPath);
            }
            for (const linkPath of this.jointCatalogByLinkPath.keys()) {
                if (linkPath)
                    knownLinkPaths.add(linkPath);
            }
            for (const linkPath of knownLinkPaths) {
                if (!this.linkParentPathByLinkPath.has(linkPath)) {
                    this.getParentLinkPath(linkPath);
                }
            }
        }
        if (!this.subtreeIndexDirty && this.subtreeLinkPathsByAncestorLinkPath.size > 0) {
            return;
        }
        this.subtreeLinkPathsByAncestorLinkPath.clear();
        this.subtreeMeshIdsByAncestorLinkPath.clear();
        const allLinkPaths = new Set();
        for (const linkPath of this.collectKnownLinkPaths()) {
            if (linkPath)
                allLinkPaths.add(linkPath);
        }
        for (const [childLinkPath, parentLinkPath] of this.linkParentPathByLinkPath.entries()) {
            if (childLinkPath)
                allLinkPaths.add(childLinkPath);
            if (parentLinkPath)
                allLinkPaths.add(parentLinkPath);
        }
        if (allLinkPaths.size <= 0) {
            this.subtreeIndexDirty = false;
            return;
        }
        const childLinkPathsByParentLinkPath = new Map();
        for (const [childLinkPath, parentLinkPath] of this.linkParentPathByLinkPath.entries()) {
            if (!childLinkPath || !parentLinkPath)
                continue;
            const children = childLinkPathsByParentLinkPath.get(parentLinkPath) || [];
            children.push(childLinkPath);
            childLinkPathsByParentLinkPath.set(parentLinkPath, children);
        }
        const meshIdsByLinkPath = new Map();
        for (const [meshId, linkPath] of this.linkPathByMeshId.entries()) {
            const meshIds = meshIdsByLinkPath.get(linkPath) || [];
            meshIds.push(meshId);
            meshIdsByLinkPath.set(linkPath, meshIds);
        }
        for (const ancestorLinkPath of allLinkPaths) {
            const descendants = new Set();
            const queue = [ancestorLinkPath];
            while (queue.length > 0) {
                const currentLinkPath = queue.pop() || "";
                if (!currentLinkPath || descendants.has(currentLinkPath))
                    continue;
                descendants.add(currentLinkPath);
                const children = childLinkPathsByParentLinkPath.get(currentLinkPath) || [];
                for (const childLinkPath of children) {
                    if (!descendants.has(childLinkPath)) {
                        queue.push(childLinkPath);
                    }
                }
            }
            this.subtreeLinkPathsByAncestorLinkPath.set(ancestorLinkPath, descendants);
            const meshIds = [];
            for (const descendantLinkPath of descendants) {
                const descendantMeshIds = meshIdsByLinkPath.get(descendantLinkPath);
                if (!descendantMeshIds || descendantMeshIds.length <= 0)
                    continue;
                meshIds.push(...descendantMeshIds);
            }
            this.subtreeMeshIdsByAncestorLinkPath.set(ancestorLinkPath, meshIds);
        }
        this.subtreeIndexDirty = false;
    }
    getSubtreeLinkPaths(ancestorLinkPath) {
        if (!ancestorLinkPath)
            return null;
        this.ensureSubtreeIndex();
        return this.subtreeLinkPathsByAncestorLinkPath.get(ancestorLinkPath) || null;
    }
    getSubtreeMeshIds(ancestorLinkPath) {
        if (!ancestorLinkPath)
            return null;
        this.ensureSubtreeIndex();
        return this.subtreeMeshIdsByAncestorLinkPath.get(ancestorLinkPath) || null;
    }
    collectAffectedLinkPaths(activeJointStates) {
        const affectedLinkPaths = new Set();
        for (const jointState of activeJointStates) {
            const subtreeLinkPaths = this.getSubtreeLinkPaths(jointState.linkPath);
            if (!subtreeLinkPaths || subtreeLinkPaths.size <= 0) {
                affectedLinkPaths.add(jointState.linkPath);
                continue;
            }
            for (const linkPath of subtreeLinkPaths) {
                affectedLinkPaths.add(linkPath);
            }
        }
        return affectedLinkPaths;
    }
    collectAffectedMeshIds(activeJointStates) {
        const affectedMeshIds = new Set();
        for (const jointState of activeJointStates) {
            const subtreeMeshIds = this.getSubtreeMeshIds(jointState.linkPath);
            if (!subtreeMeshIds || subtreeMeshIds.length <= 0)
                continue;
            for (const meshId of subtreeMeshIds) {
                affectedMeshIds.add(meshId);
            }
        }
        return affectedMeshIds;
    }
    createStateFromCatalogEntry(entry) {
        return {
            linkPath: entry.linkPath,
            jointPath: entry.jointPath,
            parentLinkPath: entry.parentLinkPath,
            axisToken: entry.axisToken,
            axisLocal: entry.axisLocal.clone(),
            lowerLimitDeg: entry.lowerLimitDeg,
            upperLimitDeg: entry.upperLimitDeg,
            angleDeg: Number.isFinite(Number(entry.angleDeg)) ? Number(entry.angleDeg) : 0,
            localPivotInLink: entry.localPivotInLink ? entry.localPivotInLink.clone() : null,
        };
    }
    ensureJointCatalogBuildScheduled() {
        this.startJointCatalogBuildIfNeeded();
    }
    async ensureJointCatalogReady(options = {}) {
        const buildPromise = this.startJointCatalogBuildIfNeeded();
        if (!buildPromise)
            return;
        const maxWaitMs = Number(options.maxWaitMs);
        if (!Number.isFinite(maxWaitMs) || maxWaitMs < 0) {
            await buildPromise;
            return;
        }
        if (maxWaitMs <= 0)
            return;
        let timeoutHandle = null;
        const timeoutToken = Symbol("joint-catalog-timeout");
        let waitResult = null;
        try {
            waitResult = await Promise.race([
                buildPromise.then(() => null),
                new Promise((resolve) => {
                    timeoutHandle = window.setTimeout(() => resolve(timeoutToken), maxWaitMs);
                }),
            ]);
        }
        finally {
            if (timeoutHandle !== null) {
                window.clearTimeout(timeoutHandle);
            }
        }
        if (waitResult === timeoutToken) {
            console.warn("[link-rotation] Joint catalog readiness wait timed out; continuing with partial joint data.", {
                waitedMs: maxWaitMs,
                jointCatalogStatus: this.jointCatalogStatus,
                jointCatalogError: this.jointCatalogError,
                stageSourcePath: this.stageSourcePath,
            });
        }
    }
    startJointCatalogBuildIfNeeded() {
        if (this.jointCatalogBuildPromise)
            return this.jointCatalogBuildPromise;
        if (this.jointCatalogByLinkPath.size > 0 || this.linkParentPathByLinkPath.size > 0) {
            this.setJointCatalogStatus("ready");
            return Promise.resolve();
        }
        const cacheKey = this.getJointCatalogCacheKey();
        if (cacheKey && this.restoreJointCatalogFromCache(cacheKey)) {
            this.setJointCatalogStatus("ready");
            return Promise.resolve();
        }
        const runtimeLinkPathIndex = buildRuntimeLinkPathIndex(this.renderInterface);
        if (runtimeLinkPathIndex.allLinkPaths.size <= 0) {
            return null;
        }
        const nowMs = (typeof performance !== "undefined" && typeof performance.now === "function")
            ? performance.now()
            : Date.now();
        if (this.lastJointCatalogBuildAttemptAtMs > 0
            && (nowMs - this.lastJointCatalogBuildAttemptAtMs) < this.jointCatalogRebuildCooldownMs) {
            return null;
        }
        let cachedRenderSnapshot = null;
        try {
            cachedRenderSnapshot = getRenderRobotMetadataSnapshot(this.renderInterface, this.stageSourcePath, {
                strictErrors: true,
                logErrors: false,
            });
        }
        catch (error) {
            console.error("[link-rotation] Failed to read cached render robot metadata snapshot for joint catalog build.", error);
            const errorText = String(error?.message || error || "").trim() || "joint-catalog-build-failed";
            this.setJointCatalogStatus("error", errorText);
            const buildPromise = Promise.reject(error).finally(() => {
                this.jointCatalogBuildPromise = null;
            });
            void buildPromise.catch(() => { });
            this.jointCatalogBuildPromise = buildPromise;
            return buildPromise;
        }
        const importedFromCachedSnapshot = this.ingestJointCatalogFromRenderSnapshot(cachedRenderSnapshot, runtimeLinkPathIndex);
        if (importedFromCachedSnapshot > 0) {
            this.setJointCatalogStatus("ready");
            return Promise.resolve();
        }
        this.lastJointCatalogBuildAttemptAtMs = nowMs;
        this.setJointCatalogStatus("loading");
        const initialStage = this.renderInterface?.getStage?.() || null;
        const buildPromise = Promise.resolve()
            .then(async () => {
            await this.buildJointCatalog(initialStage);
            if (cacheKey && (this.jointCatalogByLinkPath.size > 0 || this.linkParentPathByLinkPath.size > 0)) {
                this.saveJointCatalogToCache(cacheKey);
            }
            this.setJointCatalogStatus("ready");
        })
            .catch((error) => {
            const errorText = String(error?.message || error || "").trim() || "joint-catalog-build-failed";
            this.setJointCatalogStatus("error", errorText);
            throw error;
        })
            .finally(() => {
            this.jointCatalogBuildPromise = null;
        });
        this.jointCatalogBuildPromise = buildPromise;
        return buildPromise;
    }
    getDurationParamMsFromQuery(paramName, fallbackMs, minMs, maxMs) {
        void paramName;
        void minMs;
        void maxMs;
        return fallbackMs;
    }
    async waitForBrowserIdleSlice(timeoutMs) {
        const normalizedTimeoutMs = Math.max(1, Math.floor(timeoutMs));
        const requestIdle = window.requestIdleCallback;
        if (typeof requestIdle !== "function") {
            await new Promise((resolve) => window.setTimeout(resolve, Math.min(120, normalizedTimeoutMs)));
            return;
        }
        await new Promise((resolve) => {
            let finished = false;
            const finish = () => {
                if (finished)
                    return;
                finished = true;
                resolve();
            };
            try {
                requestIdle(() => finish(), { timeout: normalizedTimeoutMs });
            }
            catch {
                finish();
                return;
            }
            window.setTimeout(finish, normalizedTimeoutMs + 40);
        });
    }
    getJointCatalogCacheKey() {
        const normalizedPath = String(this.stageSourcePath || "").trim();
        if (!normalizedPath)
            return null;
        return normalizedPath.split("?")[0];
    }
    restoreJointCatalogFromCache(cacheKey) {
        if (!cacheKey)
            return false;
        const cacheEntry = jointCatalogCacheByStagePath.get(cacheKey);
        if (!cacheEntry)
            return false;
        jointCatalogCacheByStagePath.delete(cacheKey);
        jointCatalogCacheByStagePath.set(cacheKey, cacheEntry);
        this.linkParentPathByLinkPath.clear();
        this.markSubtreeIndexDirty();
        for (const [linkPath, parentLinkPath] of cacheEntry.linkParentPairs) {
            this.setLinkParentPath(linkPath, parentLinkPath);
        }
        this.jointCatalogByLinkPath.clear();
        for (const entry of cacheEntry.jointCatalogEntries) {
            this.jointCatalogByLinkPath.set(entry.linkPath, cloneJointCatalogEntry(entry));
        }
        for (const [linkPath, existingState] of this.linkJointStateByLinkPath) {
            const cachedEntry = this.jointCatalogByLinkPath.get(linkPath);
            if (!cachedEntry)
                continue;
            existingState.jointPath = cachedEntry.jointPath;
            existingState.parentLinkPath = cachedEntry.parentLinkPath;
            existingState.axisToken = cachedEntry.axisToken;
            existingState.axisLocal = cachedEntry.axisLocal.clone();
            existingState.lowerLimitDeg = cachedEntry.lowerLimitDeg;
            existingState.upperLimitDeg = cachedEntry.upperLimitDeg;
            existingState.localPivotInLink = cachedEntry.localPivotInLink ? cachedEntry.localPivotInLink.clone() : null;
        }
        return true;
    }
    saveJointCatalogToCache(cacheKey) {
        if (!cacheKey)
            return;
        if (this.jointCatalogByLinkPath.size === 0 && this.linkParentPathByLinkPath.size === 0)
            return;
        const cacheEntry = {
            linkParentPairs: Array.from(this.linkParentPathByLinkPath.entries()),
            jointCatalogEntries: Array.from(this.jointCatalogByLinkPath.values()).map((entry) => cloneJointCatalogEntry(entry)),
        };
        jointCatalogCacheByStagePath.delete(cacheKey);
        jointCatalogCacheByStagePath.set(cacheKey, cacheEntry);
        while (jointCatalogCacheByStagePath.size > maxJointCatalogCacheEntries) {
            const oldestKey = jointCatalogCacheByStagePath.keys().next().value;
            if (!oldestKey)
                break;
            jointCatalogCacheByStagePath.delete(oldestKey);
        }
    }
    async buildJointCatalog(initialStage) {
        const runtimeLinkPathIndex = buildRuntimeLinkPathIndex(this.renderInterface);
        const importedFromRenderSnapshot = this.ingestJointCatalogFromRenderSnapshot(await warmupRenderRobotMetadataSnapshot(this.renderInterface, {
            stageSourcePath: this.stageSourcePath,
            skipIdleWait: true,
            skipUrdfTruthFallback: true,
            logErrors: false,
        }), runtimeLinkPathIndex);
        if (importedFromRenderSnapshot > 0) {
            return;
        }
        const rootPathSet = new Set([
            ...getRootPathsFromRenderInterface(this.renderInterface),
            ...runtimeLinkPathIndex.rootPaths,
        ]);
        const rootPaths = Array.from(rootPathSet);
        let stage = initialStage;
        const usdModule = window.USD;
        let ownedRootStage = null;
        if (!stage && this.stageSourcePath && usdModule?.UsdStage?.Open) {
            ownedRootStage = await this.safeOpenUsdStage(usdModule, this.stageSourcePath);
            stage = ownedRootStage;
        }
        if (!stage) {
            const stageSuffix = this.stageSourcePath ? ` for ${this.stageSourcePath}` : "";
            throw new Error(`[link-rotation] Failed to resolve USD stage for joint catalog build${stageSuffix}.`);
        }
        try {
            const fallbackDelayMs = Math.max(0, Math.floor(this.jointCatalogStageFallbackDelayMs));
            if (fallbackDelayMs > 0) {
                await new Promise((resolve) => window.setTimeout(resolve, fallbackDelayMs));
            }
            await this.waitForBrowserIdleSlice(this.jointCatalogStageFallbackIdleTimeoutMs);
            const rootLayerText = this.safeExportRootLayerText(stage);
            this.ingestJointCatalogFromStage(stage, rootLayerText, rootPaths, runtimeLinkPathIndex);
            const physicsPayloadAssets = extractPhysicsPayloadAssetPathsFromLayerText(rootLayerText);
            if (physicsPayloadAssets.length > 0 && usdModule?.UsdStage?.Open) {
                for (const payloadAssetPath of physicsPayloadAssets) {
                    const resolvedPath = resolveUsdAssetPath(this.stageSourcePath, payloadAssetPath);
                    if (!resolvedPath)
                        continue;
                    const payloadStage = await this.safeOpenUsdStage(usdModule, resolvedPath);
                    if (!payloadStage)
                        continue;
                    try {
                        const payloadText = this.safeExportRootLayerText(payloadStage);
                        this.ingestJointCatalogFromStage(payloadStage, payloadText, rootPaths, runtimeLinkPathIndex);
                    }
                    finally {
                        disposeUsdStageHandle(usdModule, payloadStage);
                    }
                }
            }
        }
        finally {
            disposeUsdStageHandle(usdModule, ownedRootStage);
        }
    }
    safeExportRootLayerText(stage) {
        if (!stage?.GetRootLayer)
            return "";
        try {
            const rootLayer = stage.GetRootLayer();
            if (!rootLayer?.ExportToString)
                return "";
            const exported = rootLayer.ExportToString();
            return typeof exported === "string" ? exported : String(exported || "");
        }
        catch (error) {
            const stageSuffix = this.stageSourcePath ? ` for ${this.stageSourcePath}` : "";
            console.error(`[link-rotation] Failed to export USD root layer text${stageSuffix}.`, error);
            throw new Error(`[link-rotation] Failed to export USD root layer text${stageSuffix}.`, {
                cause: error,
            });
        }
    }
    async safeOpenUsdStage(usdModule, stagePath) {
        if (!usdModule?.UsdStage?.Open || !stagePath)
            return null;
        try {
            const openedStage = usdModule.UsdStage.Open(stagePath);
            if (openedStage && typeof openedStage.then === "function") {
                const resolvedStage = await openedStage;
                return resolvedStage || null;
            }
            return openedStage || null;
        }
        catch (error) {
            console.error(`[link-rotation] Failed to open USD stage: ${stagePath}`, error);
            throw new Error(`[link-rotation] Failed to open USD stage: ${stagePath}`, {
                cause: error,
            });
        }
    }
    ingestJointCatalogFromStage(stage, layerText, fallbackRootPaths, runtimeLinkPathIndex) {
        return ingestJointCatalogFromStage(this, stage, layerText, fallbackRootPaths, runtimeLinkPathIndex);
    }
    ingestJointCatalogFromRenderSnapshot(snapshot, runtimeLinkPathIndex) {
        if (!snapshot)
            return 0;
        if (Array.isArray(snapshot.linkParentPairs) && snapshot.linkParentPairs.length > 0) {
            for (const pair of snapshot.linkParentPairs) {
                if (!Array.isArray(pair) || pair.length <= 0)
                    continue;
                const childCandidates = resolveRuntimeLinkPathsFromSourcePath(pair[0], runtimeLinkPathIndex);
                if (childCandidates.length <= 0)
                    continue;
                for (const childLinkPath of childCandidates) {
                    if (!childLinkPath)
                        continue;
                    const preferredRootPath = getRootPathFromLinkPath(childLinkPath);
                    const parentCandidates = resolveRuntimeLinkPathsFromSourcePath(pair[1], runtimeLinkPathIndex, preferredRootPath);
                    const parentLinkPath = pickRuntimeParentLinkPath(parentCandidates, preferredRootPath);
                    this.setLinkParentPath(childLinkPath, parentLinkPath);
                }
            }
        }
        if (!Array.isArray(snapshot.jointCatalogEntries) || snapshot.jointCatalogEntries.length <= 0)
            return 0;
        let imported = 0;
        for (const entry of snapshot.jointCatalogEntries) {
            if (!entry?.linkPath)
                continue;
            const jointTypeName = String(entry.jointTypeName || entry.jointType || "").trim();
            if (jointTypeName && !isControllableRevoluteJointTypeName(jointTypeName))
                continue;
            const resolvedLinkPaths = resolveRuntimeLinkPathsFromSourcePath(entry.linkPath, runtimeLinkPathIndex);
            if (resolvedLinkPaths.length <= 0)
                continue;
            for (const linkPath of resolvedLinkPaths) {
                if (!linkPath)
                    continue;
                const preferredRootPath = getRootPathFromLinkPath(linkPath);
                const parentCandidates = resolveRuntimeLinkPathsFromSourcePath(entry.parentLinkPath, runtimeLinkPathIndex, preferredRootPath);
                const parentLinkPath = pickRuntimeParentLinkPath(parentCandidates, preferredRootPath);
                this.setLinkParentPath(linkPath, parentLinkPath);
                const axisLocal = normalizeAxisVector(new Vector3(Number(entry.axisLocal?.[0] || 0), Number(entry.axisLocal?.[1] || 0), Number(entry.axisLocal?.[2] || 0)));
                const limits = normalizeLimits(toFiniteNumber(entry.lowerLimitDeg), toFiniteNumber(entry.upperLimitDeg));
                const localPivotInLink = Array.isArray(entry.localPivotInLink)
                    ? new Vector3(Number(entry.localPivotInLink[0] || 0), Number(entry.localPivotInLink[1] || 0), Number(entry.localPivotInLink[2] || 0))
                    : null;
                const fallbackJointName = String(entry.jointName || `${linkPath.split("/").pop() || "link"}_joint`).trim();
                const jointPath = String(entry.jointPath || "").trim()
                    || (preferredRootPath
                        ? `${preferredRootPath}/joints/${fallbackJointName}`
                        : `/joints/${fallbackJointName}`);
                this.applyJointCatalogEntry({
                    linkPath,
                    jointPath,
                    parentLinkPath,
                    axisToken: normalizeAxisToken(entry.axisToken || axisTokenFromAxisVector(axisLocal)),
                    axisLocal,
                    lowerLimitDeg: limits.lower,
                    upperLimitDeg: limits.upper,
                    ...(Number.isFinite(Number(entry.angleDeg)) ? { angleDeg: Number(entry.angleDeg) } : {}),
                    localPivotInLink,
                });
                imported++;
            }
        }
        return imported;
    }
    buildJointSearchRoots(rootPaths, preferredRootPath) {
        const ordered = new Set();
        if (preferredRootPath)
            ordered.add(preferredRootPath);
        for (const rootPath of rootPaths || []) {
            if (!rootPath)
                continue;
            ordered.add(rootPath);
        }
        return Array.from(ordered);
    }
    applyJointCatalogEntry(entry) {
        if (!entry?.linkPath || !entry.jointPath)
            return;
        const normalizedEntry = {
            ...entry,
            axisLocal: normalizeAxisVector(entry.axisLocal),
            localPivotInLink: entry.localPivotInLink ? entry.localPivotInLink.clone() : null,
        };
        this.jointCatalogByLinkPath.set(normalizedEntry.linkPath, {
            ...normalizedEntry,
            axisLocal: normalizedEntry.axisLocal.clone(),
            localPivotInLink: normalizedEntry.localPivotInLink ? normalizedEntry.localPivotInLink.clone() : null,
        });
        this.setLinkParentPath(normalizedEntry.linkPath, normalizedEntry.parentLinkPath);
        const existingState = this.linkJointStateByLinkPath.get(normalizedEntry.linkPath);
        if (!existingState)
            return;
        existingState.jointPath = normalizedEntry.jointPath;
        existingState.parentLinkPath = normalizedEntry.parentLinkPath;
        existingState.axisToken = normalizedEntry.axisToken;
        existingState.axisLocal = normalizedEntry.axisLocal.clone();
        existingState.lowerLimitDeg = normalizedEntry.lowerLimitDeg;
        existingState.upperLimitDeg = normalizedEntry.upperLimitDeg;
        existingState.localPivotInLink = normalizedEntry.localPivotInLink ? normalizedEntry.localPivotInLink.clone() : null;
    }
    resolveJointPathFromName(stage, rootPaths, jointName) {
        if (!jointName)
            return null;
        const candidates = new Set();
        if (rootPaths.length === 0) {
            candidates.add(`/joints/${jointName}`);
            candidates.add(`/${jointName}`);
        }
        else {
            for (const rootPath of rootPaths) {
                candidates.add(`${rootPath}/joints/${jointName}`);
                candidates.add(`${rootPath}/${jointName}`);
            }
        }
        for (const candidatePath of candidates) {
            const prim = safeGetPrimAtPath(stage, candidatePath);
            const typeName = safeGetPrimTypeName(prim).toLowerCase();
            if (!isControllableRevoluteJointTypeName(typeName))
                continue;
            return candidatePath;
        }
        for (const candidatePath of candidates) {
            if (candidatePath.includes(`/joints/${jointName}`))
                return candidatePath;
        }
        return Array.from(candidates)[0] || null;
    }
}
