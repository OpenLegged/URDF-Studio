// @ts-nocheck
import { Matrix4, Quaternion, Vector3 } from 'three';
import * as Shared from './shared.js';
import { disposeMaterial } from '../../../../../shared/utils/three/dispose.ts';
import { getDefaultMaterial } from './default-material-state.js';
import { TextureRegistry } from './TextureRegistry.js';
const { buildProtoPrimPathCandidates, clamp01, createMatrixFromXformOp, debugInstancer, debugMaterials, debugMeshes, debugPrims, debugTextures, defaultGrayComponent, disableMaterials, disableTextures, disposeUsdHandle, extractJointRecordsFromLayerText, extractPrimPathFromMaterialBindingWarning, extractReferencePrimTargets, extractScopeBodyText, extractUsdAssetReferencesFromLayerText, getActiveMaterialBindingWarningOwner, getAngleInRadians, getCollisionGeometryTypeFromUrdfElement, getExpectedPrimTypesForCollisionProto, getExpectedPrimTypesForProtoType, getMatrixMaxElementDelta, getPathBasename, getPathWithoutRoot, getRawConsoleMethod, getRootPathFromPrimPath, getSafePrimTypeName, hasNonZeroTranslation, hydraCallbackErrorCounts, installMaterialBindingApiWarningInterceptor, isIdentityQuaternion, isLikelyDefaultGrayMaterial, isLikelyInverseTransform, isMaterialBindingApiWarningMessage, isMatrixApproximatelyIdentity, isNonZero, isPotentiallyLargeBaseAssetPath, logHydraCallbackError, materialBindingRepairMaxLayerTextLength, materialBindingWarningHandlers, maxHydraCallbackErrorLogsPerMethod, nearlyEqual, normalizeHydraPath, normalizeUsdPathToken, parseColliderEntriesFromLayerText, parseGuideCollisionReferencesFromLayerText, parseLinkDynamicsPatchesFromLayerText, parseProtoMeshIdentifier, parseUrdfTruthFromText, parseVector3Text, parseVisualSemanticChildNamesFromLayerText, parseXformOpFallbacksFromLayerText, rawConsoleError, rawConsoleWarn, registerMaterialBindingApiWarningHandler, remapRootPathIfNeeded, resolveSemanticChildLinkTargetFromResolvedPrimPath, resolveUrdfTruthFileNameForStagePath, resolveUsdAssetPath, setActiveMaterialBindingWarningOwner, shouldAllowLargeBaseAssetScan, stringifyConsoleArgs, toArrayLike, toColorArray, toFiniteNumber, toFiniteQuaternionWxyzTuple, toFiniteVector2Tuple, toFiniteVector3Tuple, toMatrixFromUrdfOrigin, toQuaternionWxyzFromRpy, transformEpsilon, unregisterMaterialBindingApiWarningHandler, wrapHydraCallbackObject } = Shared;
const HYDRA_PHASE_PROFILE_FROM_QUERY = false;

function collectAssignedUsdRootMaterials(usdRoot) {
    const assignedMaterials = new Set();
    if (!usdRoot || typeof usdRoot.traverse !== 'function') {
        return assignedMaterials;
    }
    usdRoot.traverse((node) => {
        const material = node?.material;
        if (Array.isArray(material)) {
            material.forEach((entry) => {
                if (entry) {
                    assignedMaterials.add(entry);
                }
            });
            return;
        }
        if (material) {
            assignedMaterials.add(material);
        }
    });
    return assignedMaterials;
}

export class ThreeRenderDelegateCore {
    /**
     * @param {import('..').threeJsRenderDelegateConfig} config
     */
    constructor(config) {
        const safeConfig = (config && typeof config === 'object') ? config : {};
        this.config = safeConfig;
        this.registry = new TextureRegistry(safeConfig);
        this.modelOverrides = safeConfig.modelOverrides || null;
        this.stageSourcePath = typeof safeConfig.stageSourcePath === 'string'
            ? String(safeConfig.stageSourcePath).split('?')[0]
            : null;
        this.suppressMaterialBindingApiWarnings = safeConfig.suppressMaterialBindingApiWarnings !== false;
        this.loadCollisionPrims = safeConfig.loadCollisionPrims !== false;
        this.loadVisualPrims = safeConfig.loadVisualPrims !== false;
        this.enableXformOpFallbackFromLayerText = safeConfig.enableXformOpFallbackFromLayerText === true;
        this.disableStageLayerTextFallbacks = safeConfig.disableStageLayerTextFallbacks === true;
        this.enableProtoBlobFastPath = safeConfig.enableProtoBlobFastPath !== false;
        this.preferProtoBlobOverHydraPayload = safeConfig.preferProtoBlobOverHydraPayload !== false;
        this.preferFinalStageOverrideBatchInProtoSync = safeConfig.preferFinalStageOverrideBatchInProtoSync !== false;
        // Strict one-shot loads must finish scene payload resolution before reveal.
        // Keep legacy per-mesh bridge fetches disabled until snapshot caches exist.
        this.strictOneShotSceneLoad = safeConfig.strictOneShotSceneLoad === true;
        this.allowPostReadyDriverDelta = safeConfig.allowPostReadyDriverDelta === true;
        // Keep first visual frame fast: hidden collision proto meshes can defer
        // expensive sync until they become visible.
        this.deferHiddenCollisionProtoSyncInCommit = safeConfig.deferHiddenCollisionProtoSyncInCommit !== false;
        // Reduce JS<->WASM bridge chatter by default: prime batch payloads once,
        // then resolve per-mesh reads from JS cache.
        this.autoBatchProtoBlobsOnFirstAccess = safeConfig.autoBatchProtoBlobsOnFirstAccess !== false;
        this.autoBatchPrimTransformsOnFirstAccess = safeConfig.autoBatchPrimTransformsOnFirstAccess !== false;
        this.autoBatchCollisionProtoOverridesOnFirstAccess = safeConfig.autoBatchCollisionProtoOverridesOnFirstAccess !== false;
        this.autoBatchVisualProtoOverridesOnFirstAccess = safeConfig.autoBatchVisualProtoOverridesOnFirstAccess !== false;
        this.allowDriverStageLookup = safeConfig.allowDriverStageLookup === true;
        // Avoid expensive driver.GetStage() calls inside high-frequency Hydra sync callbacks.
        // Stage-dependent fallback passes still run later once stage metadata is ready.
        this.deferDriverStageLookupInSyncHotPath = safeConfig.deferDriverStageLookupInSyncHotPath !== false;
        this._hydraSyncHotPathDepth = 0;
        this.enableHydraPhaseInstrumentation = safeConfig.enableHydraPhaseInstrumentation === true
            || HYDRA_PHASE_PROFILE_FROM_QUERY
            || globalThis?.__HYDRA_PROFILE_PHASES__ === true;
        this._hydraPhasePerfState = {
            drawSeq: 0,
            renderSeq: 0,
            activeDraw: null,
            history: [],
            maxHistory: 48,
            firstRenderSample: null,
        };
        this.maxVisualPrims = Number.isFinite(safeConfig.maxVisualPrims)
            ? Math.max(0, Math.floor(Number(safeConfig.maxVisualPrims)))
            : null;
        this.loadedVisualPrimCount = 0;
        this.materials = {};
        this.meshes = {};
        this.instancers = {};
        this.skeletons = {};
        this._meshMutationVersion = 0;
        this._localXformCache = new Map();
        this._localXformResetsStackCache = new Map();
        this._localXformAuthoredOpsCache = new Map();
        this._worldXformCache = new Map();
        this._worldXformCacheSourceByPath = new Map();
        this._primPathExistenceCache = new Map();
        this._knownPrimPathSet = null;
        this._knownPrimPathSetPrimed = false;
        this._meshFallbackCache = new Map();
        this._resolvedProtoPrimPathCache = new Map();
        this._resolvedVisualPrimPathCache = new Map();
        this._xformOpFallbackMapByStageSource = new Map();
        this._rootLayerXformOpFallbackMapByStageSource = new Map();
        this._stageFallbackMaterialCache = new Map();
        this._snapshotMaterialRecordById = new Map();
        this._snapshotMaterialIdsByStageSource = new Map();
        this._snapshotFallbackMaterialCache = new Map();
        this._linkVisualTransformCache = new Map();
        this._visualMeshIdByLinkPath = new Map();
        this._meshIdByLinkPath = new Map();
        this._protoMeshMetadataByMeshId = new Map();
        this._guideCollisionPrimPathCache = new Map();
        this._guideCollisionRefMapByStageSource = new Map();
        this._visualSemanticChildMapByStageSource = new Map();
        this._stageLayerTextParseCacheByStageSource = new Map();
        this._openedGuideStages = new Map();
        this._protoDataBlobBatchCache = new Map();
        this._protoDataBlobMissCache = new Set();
        this._protoDataBlobBatchPrimed = false;
        this._primTransformBatchPrimed = false;
        this._collisionProtoOverrideCache = new Map();
        this._collisionProtoOverrideMissCache = new Set();
        this._collisionProtoOverrideBatchPrimed = false;
        this._visualProtoOverrideCache = new Map();
        this._visualProtoOverrideMissCache = new Set();
        this._visualProtoOverrideBatchPrimed = false;
        this._finalStageOverrideBatchCache = new Map();
        this._finalStageOverrideBatchPrimed = false;
        this._finalStageOverrideBatchProtoMeshCount = 0;
        this._stageOverrideProtoMeshCache = null;
        this._primOverrideDataCache = new Map();
        this._primOverrideDataMissCache = new Set();
        this._urdfTruthByStageSource = new Map();
        this._urdfTruthLoadPromisesByStageSource = new Map();
        this._urdfTruthLoadErrorByStageSource = new Map();
        this._urdfLinkWorldTransformCacheByStageSource = new Map();
        this._urdfVisualFallbackDecisionCache = new Map();
        this._urdfVisualFallbackLinkDecisionCache = new Map();
        this._roundtripMaterialRecoveryByStageSource = new Map();
        this._robotMetadataSnapshotByStageSource = new Map();
        this._robotSceneSnapshotByStageSource = new Map();
        this._fullLoadPayloadReadyByStageSource = new Set();
        this._robotMetadataBuildPromisesByStageSource = new Map();
        this._preferredVisualMaterialByLinkCache = new Map();
        this._resolvedDriverStage = null;
        this._pendingDriverStagePromise = null;
        this._driverStageResolveState = 'idle';
        this._driverStageResolveSource = 'none';
        this._driverStageResolveError = null;
        this._driverStageResolveUpdatedAtMs = null;
        this._lastRobotSceneWarmupSummary = null;
        this._driverFallbackCallCounts = {
            fullLoadPayload: 0,
            robotSceneSnapshotBlob: 0,
            robotSceneSnapshot: 0,
            protoDataBlob: 0,
            collisionProtoOverride: 0,
            visualProtoOverride: 0,
            primOverrideData: 0,
            rprimDeltaBatch: 0,
        };
        this._decomposeScratchPosition = new Vector3();
        this._decomposeScratchQuaternion = new Quaternion();
        this._decomposeScratchScale = new Vector3();
        this._materialBindingWarningSummary = {
            count: 0,
            primPaths: new Set(),
            sampleMessages: [],
        };
        this._materialBindingWarningSummaryTimer = null;
        this._materialBindingSchemaRepairAttempted = false;
        this._materialBindingSchemaRepairSucceeded = false;
        this._materialBindingSchemaWriteSupported = null;
        this._hasRunStageTruthAlignmentDiagnostics = false;
        this._materialBindingWarningHandler = ({ message, level }) => this.handleMaterialBindingApiWarning({ message, level });
        setActiveMaterialBindingWarningOwner(this);
        registerMaterialBindingApiWarningHandler(this._materialBindingWarningHandler);
        this._disposed = false;
        // Bind hot transform helpers defensively so detached callback invocations
        // from external runtimes cannot lose `this`.
        if (typeof this.getWorldTransformForPrimPath === 'function') {
            this.getWorldTransformForPrimPath = this.getWorldTransformForPrimPath.bind(this);
        }
        if (typeof this.getLocalTransformForPrimPath === 'function') {
            this.getLocalTransformForPrimPath = this.getLocalTransformForPrimPath.bind(this);
        }
        if (this.isHydraPhaseInstrumentationEnabled() && typeof window !== 'undefined') {
            window.__HYDRA_PHASE_METRICS__ = {
                getSnapshot: () => this.getHydraPhasePerfSnapshot(),
            };
        }
    }
    disposeOpenedGuideStages() {
        if (!(this._openedGuideStages instanceof Map) || this._openedGuideStages.size <= 0) {
            return;
        }
        const globalScope = typeof window !== 'undefined' ? window : globalThis;
        const usdModule = globalScope?.USD || null;
        for (const stage of this._openedGuideStages.values()) {
            disposeUsdHandle(usdModule, stage);
        }
        this._openedGuideStages.clear();
    }
    disposeUnboundHydraMaterials() {
        const assignedMaterials = collectAssignedUsdRootMaterials(this.config?.usdRoot);
        const defaultMaterial = getDefaultMaterial();
        const disposedMaterials = new Set();
        const wrappedMaterials = [
            ...Object.values(this.materials || {}),
            ...((this._stageFallbackMaterialCache instanceof Map) ? Array.from(this._stageFallbackMaterialCache.values()) : []),
            ...((this._snapshotFallbackMaterialCache instanceof Map) ? Array.from(this._snapshotFallbackMaterialCache.values()) : []),
        ];
        for (const wrappedMaterial of wrappedMaterials) {
            const candidateMaterials = [
                wrappedMaterial?._material,
                wrappedMaterial?._ownedMaterial,
                wrappedMaterial,
            ].filter(Boolean);
            const materials = candidateMaterials
                .flatMap((rawMaterial) => Array.isArray(rawMaterial) ? rawMaterial : [rawMaterial])
                .filter((material) => !!material && typeof material.dispose === 'function');
            for (const material of materials) {
                if (!material || material === defaultMaterial || assignedMaterials.has(material) || disposedMaterials.has(material)) {
                    continue;
                }
                disposeMaterial(material, true);
                disposedMaterials.add(material);
            }
        }
    }
    dispose() {
        if (this._disposed === true)
            return;
        this._disposed = true;
        if (this._materialBindingWarningSummaryTimer) {
            clearTimeout(this._materialBindingWarningSummaryTimer);
            this._materialBindingWarningSummaryTimer = null;
        }
        if (this._materialBindingWarningHandler) {
            unregisterMaterialBindingApiWarningHandler(this._materialBindingWarningHandler);
        }
        if (getActiveMaterialBindingWarningOwner() === this) {
            setActiveMaterialBindingWarningOwner(null);
        }
        this.registry?.dispose?.();
        this.disposeUnboundHydraMaterials();
        const globalMetricsTarget = typeof window !== 'undefined' ? window : globalThis;
        if (this.enableHydraPhaseInstrumentation && globalMetricsTarget?.__HYDRA_PHASE_METRICS__) {
            globalMetricsTarget.__HYDRA_PHASE_METRICS__ = undefined;
        }
        this.disposeOpenedGuideStages();
        const clearableCaches = [
            this._localXformCache,
            this._localXformResetsStackCache,
            this._localXformAuthoredOpsCache,
            this._worldXformCache,
            this._worldXformCacheSourceByPath,
            this._primPathExistenceCache,
            this._meshFallbackCache,
            this._resolvedProtoPrimPathCache,
            this._resolvedVisualPrimPathCache,
            this._xformOpFallbackMapByStageSource,
            this._rootLayerXformOpFallbackMapByStageSource,
            this._stageFallbackMaterialCache,
            this._snapshotMaterialRecordById,
            this._snapshotMaterialIdsByStageSource,
            this._snapshotFallbackMaterialCache,
            this._linkVisualTransformCache,
            this._visualLinkWorldTransformCache,
            this._jointPrimPathCache,
            this._jointCatalogSnapshotByStageSource,
            this._jointCatalogBuildPromisesByStageSource,
            this._linkDynamicsSnapshotByStageSource,
            this._linkDynamicsBuildPromisesByStageSource,
            this._protoMeshMetadataByMeshId,
            this._protoVisualMetadataByStageSource,
            this._protoCollisionMetadataByStageSource,
            this._protoMeshTransformCache,
            this._protoCollisionWorldTransformCache,
            this._protoVisualWorldTransformCache,
            this._primTransformBatchByStageSource,
            this._primTransformBatchPromisesByStageSource,
            this._stageOverrideBatchByStageSource,
            this._stageOverrideBatchPromisesByStageSource,
            this._stageCollisionProtoOverridesByStageSource,
            this._stageCollisionProtoOverridePromisesByStageSource,
            this._stageVisualProtoOverridesByStageSource,
            this._stageVisualProtoOverridePromisesByStageSource,
            this._guideCollisionReferenceCache,
            this._stageLayerTextParseCacheByStageSource,
            this._protoDataBlobBatchCache,
            this._protoDataBlobMissCache,
            this._collisionProtoOverrideCache,
            this._collisionProtoOverrideMissCache,
            this._visualProtoOverrideCache,
            this._visualProtoOverrideMissCache,
            this._finalStageOverrideBatchCache,
            this._primOverrideDataCache,
            this._primOverrideDataMissCache,
            this._urdfTruthByStageSource,
            this._urdfTruthLoadPromisesByStageSource,
            this._urdfTruthLoadErrorByStageSource,
            this._urdfLinkWorldTransformCacheByStageSource,
            this._urdfVisualFallbackDecisionCache,
            this._urdfVisualFallbackLinkDecisionCache,
            this._roundtripMaterialRecoveryByStageSource,
            this._robotMetadataSnapshotByStageSource,
            this._robotSceneSnapshotByStageSource,
            this._fullLoadPayloadReadyByStageSource,
            this._robotMetadataBuildPromisesByStageSource,
            this._preferredVisualMaterialByLinkCache,
        ];
        clearableCaches.forEach((entry) => entry?.clear?.());
        this.materials = {};
        this.meshes = {};
        this.instancers = {};
        this.skeletons = {};
        this._knownPrimPathSet = null;
        this._resolvedDriverStage = null;
        this._pendingDriverStagePromise = null;
        this._driverStageResolveState = 'idle';
        this._driverStageResolveSource = 'none';
        this._driverStageResolveError = null;
        this._driverStageResolveUpdatedAtMs = null;
        this._lastRobotSceneWarmupSummary = null;
    }
    enterHydraSyncHotPath() {
        const nextDepth = Number(this._hydraSyncHotPathDepth || 0) + 1;
        this._hydraSyncHotPathDepth = nextDepth > 0 ? nextDepth : 1;
    }
    leaveHydraSyncHotPath() {
        const currentDepth = Number(this._hydraSyncHotPathDepth || 0);
        this._hydraSyncHotPathDepth = currentDepth > 1 ? currentDepth - 1 : 0;
    }
    isHydraSyncHotPathActive() {
        return Number(this._hydraSyncHotPathDepth || 0) > 0;
    }
    isHydraPhaseInstrumentationEnabled() {
        return this.enableHydraPhaseInstrumentation === true;
    }
    _nowPerfMs() {
        return (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
    }
    _markPerf(name) {
        if (typeof performance === 'undefined' || typeof performance.mark !== 'function')
            return;
        try {
            performance.mark(name);
        }
        catch { }
    }
    _measurePerf(name, startMark, endMark) {
        if (typeof performance === 'undefined' || typeof performance.measure !== 'function')
            return;
        try {
            performance.measure(name, startMark, endMark);
        }
        catch { }
    }
    _accumulatePerfMap(metricMap, key, value) {
        if (!(metricMap instanceof Map))
            return;
        const normalizedKey = String(key || '').trim() || '<unknown>';
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0)
            return;
        metricMap.set(normalizedKey, Number(metricMap.get(normalizedKey) || 0) + numeric);
    }
    beginHydraDrawPhase(source = 'driver.Draw') {
        if (!this.isHydraPhaseInstrumentationEnabled())
            return null;
        const state = this._hydraPhasePerfState;
        if (!state)
            return null;
        const seq = Number(state.drawSeq || 0) + 1;
        state.drawSeq = seq;
        const startMark = `hydra.phase.draw.${seq}.start`;
        this._markPerf(startMark);
        state.activeDraw = {
            seq,
            source: String(source || 'driver.Draw'),
            startedAtMs: this._nowPerfMs(),
            wasmFetchMs: 0,
            threeBuildMs: 0,
            commitMs: 0,
            renderMs: 0,
            wasmByMesh: new Map(),
            buildByMesh: new Map(),
            startMark,
            endMark: `hydra.phase.draw.${seq}.end`,
        };
        return state.activeDraw;
    }
    recordHydraWasmFetchPhase(durationMs, meshId = null) {
        if (!this.isHydraPhaseInstrumentationEnabled())
            return;
        const draw = this._hydraPhasePerfState?.activeDraw;
        if (!draw)
            return;
        const duration = Number(durationMs);
        if (!Number.isFinite(duration) || duration <= 0)
            return;
        draw.wasmFetchMs += duration;
        this._accumulatePerfMap(draw.wasmByMesh, meshId, duration);
    }
    recordHydraThreeBuildPhase(durationMs, meshId = null) {
        if (!this.isHydraPhaseInstrumentationEnabled())
            return;
        const draw = this._hydraPhasePerfState?.activeDraw;
        if (!draw)
            return;
        const duration = Number(durationMs);
        if (!Number.isFinite(duration) || duration <= 0)
            return;
        draw.threeBuildMs += duration;
        this._accumulatePerfMap(draw.buildByMesh, meshId, duration);
    }
    recordHydraCommitPhase(durationMs) {
        if (!this.isHydraPhaseInstrumentationEnabled())
            return;
        const draw = this._hydraPhasePerfState?.activeDraw;
        if (!draw)
            return;
        const duration = Number(durationMs);
        if (!Number.isFinite(duration) || duration <= 0)
            return;
        draw.commitMs += duration;
    }
    recordHydraRenderPhase(durationMs, source = 'renderer.render') {
        if (!this.isHydraPhaseInstrumentationEnabled())
            return;
        const state = this._hydraPhasePerfState;
        if (!state)
            return;
        const duration = Number(durationMs);
        if (!Number.isFinite(duration) || duration < 0)
            return;
        state.renderSeq = Number(state.renderSeq || 0) + 1;
        if (!state.firstRenderSample) {
            state.firstRenderSample = {
                seq: state.renderSeq,
                durationMs: duration,
                source: String(source || 'renderer.render'),
            };
            // Keep first-render instrumentation silent in hot paths.
        }
        if (state.activeDraw) {
            state.activeDraw.renderMs += duration;
        }
    }
    endHydraDrawPhase() {
        if (!this.isHydraPhaseInstrumentationEnabled())
            return null;
        const state = this._hydraPhasePerfState;
        const draw = state?.activeDraw;
        if (!draw)
            return null;
        this._markPerf(draw.endMark);
        this._measurePerf(`hydra.phase.draw.${draw.seq}`, draw.startMark, draw.endMark);
        const endedAtMs = this._nowPerfMs();
        const totalMs = Math.max(0, endedAtMs - Number(draw.startedAtMs || endedAtMs));
        const textureSnapshot = this.registry?.getTextureLoadSnapshot?.() || null;
        const summary = {
            seq: draw.seq,
            source: draw.source,
            totalMs,
            wasmFetchMs: Number(draw.wasmFetchMs || 0),
            threeBuildMs: Number(draw.threeBuildMs || 0),
            commitMs: Number(draw.commitMs || 0),
            renderMs: Number(draw.renderMs || 0),
            texturePending: Number(textureSnapshot?.pending || 0),
            loadingManagerPending: Number(textureSnapshot?.manager?.pending || 0),
            textureStarted: Number(textureSnapshot?.started || 0),
            textureCompleted: Number(textureSnapshot?.completed || 0),
            textureFailed: Number(textureSnapshot?.failed || 0),
            topWasmMeshes: Array.from(draw.wasmByMesh.entries())
                .sort((left, right) => right[1] - left[1])
                .slice(0, 5),
            topBuildMeshes: Array.from(draw.buildByMesh.entries())
                .sort((left, right) => right[1] - left[1])
                .slice(0, 5),
        };
        state.activeDraw = null;
        state.history.push(summary);
        const maxHistory = Number(state.maxHistory || 48);
        if (state.history.length > maxHistory) {
            state.history.splice(0, state.history.length - maxHistory);
        }
        // Profiling summary is retained in-memory via getHydraPhasePerfSnapshot().
        return summary;
    }
    getHydraPhasePerfSnapshot() {
        const state = this._hydraPhasePerfState;
        if (!state)
            return null;
        return {
            drawSeq: Number(state.drawSeq || 0),
            renderSeq: Number(state.renderSeq || 0),
            activeDraw: state.activeDraw ? {
                seq: state.activeDraw.seq,
                source: state.activeDraw.source,
                startedAtMs: state.activeDraw.startedAtMs,
                wasmFetchMs: Number(state.activeDraw.wasmFetchMs || 0),
                threeBuildMs: Number(state.activeDraw.threeBuildMs || 0),
                commitMs: Number(state.activeDraw.commitMs || 0),
                renderMs: Number(state.activeDraw.renderMs || 0),
            } : null,
            firstRenderSample: state.firstRenderSample || null,
            texture: this.registry?.getTextureLoadSnapshot?.() || null,
            history: Array.isArray(state.history) ? state.history.slice(-24) : [],
        };
    }
    getStageSourcePath() {
        if (this.stageSourcePath)
            return this.stageSourcePath;
        const stage = this.getStage();
        const rootLayer = stage?.GetRootLayer?.();
        const identifier = normalizeHydraPath(rootLayer?.identifier || '');
        if (!identifier)
            return null;
        this.stageSourcePath = identifier.split('?')[0];
        return this.stageSourcePath;
    }
    getNormalizedStageSourcePath() {
        const path = String(this.getStageSourcePath() || '').trim();
        return path ? path.split('?')[0] : null;
    }
    shouldAllowUrdfHttpFallback() {
        return false;
    }
    getStageMetadataLayerTexts(stage, stageSourcePathOverride = null) {
        if (this.disableStageLayerTextFallbacks === true && !stage) {
            return [];
        }
        const layerTexts = [];
        const seenTexts = new Set();
        const visitedLayerPaths = new Set();
        const stageSourcePath = String(stageSourcePathOverride || this.getStageSourcePath() || '').trim().split('?')[0];
        const allowLargeBaseAssetScan = shouldAllowLargeBaseAssetScan(stageSourcePath);
        const addLayerText = (text) => {
            const serialized = String(text || '').trim();
            if (!serialized)
                return false;
            if (seenTexts.has(serialized))
                return false;
            seenTexts.add(serialized);
            layerTexts.push(serialized);
            return true;
        };
        const visitLayerTextReferences = (layerPath, layerText) => {
            if (!layerText || typeof layerText !== 'string')
                return;
            const resolveBasePath = (layerPath && layerPath.startsWith('/')) ? layerPath : stageSourcePath;
            const referencedAssets = extractUsdAssetReferencesFromLayerText(layerText);
            for (const assetPath of referencedAssets) {
                if (!allowLargeBaseAssetScan && isPotentiallyLargeBaseAssetPath(assetPath))
                    continue;
                const resolvedPath = resolveUsdAssetPath(resolveBasePath, assetPath);
                if (!resolvedPath || visitedLayerPaths.has(resolvedPath))
                    continue;
                if (!allowLargeBaseAssetScan && isPotentiallyLargeBaseAssetPath(resolvedPath))
                    continue;
                const referencedStage = this.safeOpenUsdStage(resolvedPath);
                if (!referencedStage)
                    continue;
                addLayer(referencedStage.GetRootLayer?.(), resolvedPath);
            }
        };
        const addLayer = (layer, layerPath = null) => {
            if (!layer)
                return;
            const normalizedLayerPath = normalizeHydraPath(layerPath || layer.identifier || layer.GetDisplayName?.() || '');
            if (normalizedLayerPath) {
                if (visitedLayerPaths.has(normalizedLayerPath))
                    return;
                visitedLayerPaths.add(normalizedLayerPath);
            }
            const layerText = this.safeExportLayerText(layer);
            const addedNewText = addLayerText(layerText);
            if (!addedNewText)
                return;
            visitLayerTextReferences(normalizedLayerPath || layerPath || null, layerText);
        };
        const ingestStageLayers = (stageHandle, rootLayerPath = null) => {
            addLayer(stageHandle?.GetRootLayer?.(), rootLayerPath);
            try {
                const layerStack = stageHandle?.GetLayerStack?.(false);
                if (layerStack && typeof layerStack.size === 'function' && typeof layerStack.get === 'function') {
                    const stackSize = Number(layerStack.size()) || 0;
                    for (let layerIndex = 0; layerIndex < stackSize; layerIndex += 1) {
                        addLayer(layerStack.get(layerIndex));
                    }
                }
            }
            catch { }
            try {
                const usedLayers = toArrayLike(stageHandle?.GetUsedLayers?.());
                if (Array.isArray(usedLayers)) {
                    for (const layer of usedLayers) {
                        addLayer(layer);
                    }
                }
            }
            catch { }
        };
        ingestStageLayers(stage, stageSourcePath || null);
        if (layerTexts.length <= 0 && stageSourcePath) {
            const candidateStagePaths = [
                stageSourcePath,
                stageSourcePath.startsWith('/')
                    ? stageSourcePath.replace(/^\/+/, '')
                    : `/${stageSourcePath}`,
            ].filter((value, index, list) => value && list.indexOf(value) === index);
            for (const candidateStagePath of candidateStagePaths) {
                const reopenedStage = this.safeOpenUsdStage(candidateStagePath);
                if (!reopenedStage || reopenedStage === stage) {
                    continue;
                }
                ingestStageLayers(reopenedStage, candidateStagePath);
                if (layerTexts.length > 0) {
                    break;
                }
            }
        }
        return layerTexts;
    }
    getCachedRobotMetadataSnapshot(stageSourcePath = null) {
        const normalizedStagePath = String(stageSourcePath || this.getNormalizedStageSourcePath() || '').trim().split('?')[0];
        if (!normalizedStagePath)
            return null;
        return this._robotMetadataSnapshotByStageSource.get(normalizedStagePath) || null;
    }
    getCachedRobotSceneSnapshot(stageSourcePath = null) {
        const normalizedStagePath = String(stageSourcePath || this.getNormalizedStageSourcePath() || '').trim().split('?')[0];
        if (!normalizedStagePath)
            return null;
        return this._robotSceneSnapshotByStageSource.get(normalizedStagePath) || null;
    }
    emitRobotMetadataSnapshotReady(snapshot) {
        if (!snapshot || typeof snapshot !== 'object')
            return;
        if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function')
            return;
        try {
            window.dispatchEvent(new CustomEvent('usd:robot-metadata-ready', { detail: snapshot }));
        }
        catch {
            try {
                window.dispatchEvent(new Event('usd:robot-metadata-ready'));
            }
            catch { }
        }
    }
    emitRobotSceneSnapshotReady(snapshot) {
        if (!snapshot || typeof snapshot !== 'object')
            return;
        if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function')
            return;
        try {
            window.dispatchEvent(new CustomEvent('usd:robot-scene-ready', { detail: snapshot }));
        }
        catch {
            try {
                window.dispatchEvent(new Event('usd:robot-scene-ready'));
            }
            catch { }
        }
    }
    resolveRoundtripUsdVirtualPath(stageSourcePath = null, options = {}) {
        const normalizedStagePath = String(stageSourcePath || this.getNormalizedStageSourcePath() || '').trim().split('?')[0];
        if (!normalizedStagePath || !normalizedStagePath.startsWith('/'))
            return null;
        const lastSlash = normalizedStagePath.lastIndexOf('/');
        const directory = lastSlash >= 0 ? normalizedStagePath.slice(0, lastSlash) : '';
        const fileName = lastSlash >= 0 ? normalizedStagePath.slice(lastSlash + 1) : normalizedStagePath;
        if (!fileName)
            return null;
        const dotIndex = fileName.lastIndexOf('.');
        const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
        const extension = dotIndex > 0 ? fileName.slice(dotIndex) : '.usd';
        const suggestedFileName = String(options?.outputFileName || '').trim();
        const outputFileName = suggestedFileName || `${baseName}.viewer_roundtrip${extension || '.usd'}`;
        return directory ? `${directory}/${outputFileName}` : `/${outputFileName}`;
    }
    async writeUsdExportToServer(virtualPath, content, options = {}) {
        const normalizedVirtualPath = String(virtualPath || '').trim();
        if (!normalizedVirtualPath || !normalizedVirtualPath.startsWith('/')) {
            return { ok: false, error: 'invalid-export-path' };
        }
        if (typeof fetch !== 'function') {
            return { ok: false, error: 'fetch-unavailable' };
        }
        let response = null;
        let payload = null;
        try {
            response = await fetch('/api/write-usd-export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    virtualPath: normalizedVirtualPath,
                    content: String(content || ''),
                    overwrite: options?.overwrite !== false,
                }),
            });
            payload = await response.json();
        }
        catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error.message : String(error || 'write-usd-export-failed'),
            };
        }
        if (!response?.ok || payload?.ok !== true) {
            return {
                ok: false,
                error: String(payload?.error || `write-usd-export-${Number(response?.status || 0)}`),
                status: Number(response?.status || 0),
                payload: payload || null,
            };
        }
        return {
            ok: true,
            virtualPath: String(payload.virtualPath || normalizedVirtualPath),
            filePath: String(payload.filePath || ''),
            bytesWritten: Number(payload.bytesWritten || 0),
        };
    }
    async exportLoadedStageSnapshot(options = {}) {
        const activeDriver = options?.driver || this.config?.driver?.() || globalThis?.driver || null;
        const stageSourcePath = String(options?.stageSourcePath || this.getNormalizedStageSourcePath() || '').trim().split('?')[0];
        const flattenStage = options?.flattenStage === true;
        const emptyResult = {
            ok: false,
            error: 'export-unavailable',
            stageSourcePath: stageSourcePath || null,
            outputVirtualPath: null,
        };
        let exportPayload = null;
        if (activeDriver && typeof activeDriver.ExportLoadedStageSnapshot === 'function') {
            try {
                exportPayload = activeDriver.ExportLoadedStageSnapshot({
                    flattenStage,
                    stageSourcePath,
                });
            }
            catch {
                exportPayload = null;
            }
        }
        if ((!exportPayload || exportPayload.ok !== true) && typeof this.getStage === 'function') {
            const stage = this.getStage();
            const rootLayer = stage?.GetRootLayer?.() || null;
            if (rootLayer && typeof rootLayer.ExportToString === 'function') {
                try {
                    const content = rootLayer.ExportToString();
                    exportPayload = {
                        ok: !!content,
                        flattened: false,
                        content: typeof content === 'string' ? content : String(content || ''),
                        stageSourcePath,
                        rootLayerIdentifier: rootLayer?.identifier || null,
                        defaultPrimPath: stage?.GetDefaultPrim?.()?.GetPath?.()?.pathString || null,
                        outputFileName: null,
                        exportMode: 'root-layer-js-fallback',
                    };
                }
                catch {
                    exportPayload = null;
                }
            }
        }
        if (!exportPayload || exportPayload.ok !== true) {
            return emptyResult;
        }
        const content = typeof exportPayload.content === 'string'
            ? exportPayload.content
            : String(exportPayload.content || '');
        if (!content) {
            return {
                ...emptyResult,
                error: 'empty-export-content',
            };
        }
        const outputVirtualPath = String(options?.outputVirtualPath
            || this.resolveRoundtripUsdVirtualPath(stageSourcePath, { outputFileName: exportPayload.outputFileName })
            || '').trim();
        const result = {
            ok: true,
            flattened: exportPayload.flattened === true,
            content,
            stageSourcePath: String(exportPayload.stageSourcePath || stageSourcePath || '').trim() || null,
            rootLayerIdentifier: exportPayload.rootLayerIdentifier || null,
            defaultPrimPath: exportPayload.defaultPrimPath || null,
            outputFileName: exportPayload.outputFileName || null,
            outputVirtualPath: outputVirtualPath || null,
            exportMode: exportPayload.exportMode || (flattenStage ? 'flattened-stage' : 'root-layer'),
        };
        if (options?.persistToServer === false) {
            return result;
        }
        if (!outputVirtualPath) {
            return {
                ...result,
                ok: false,
                error: 'unsupported-export-path',
            };
        }
        const persisted = await this.writeUsdExportToServer(outputVirtualPath, content, options);
        return {
            ...result,
            persisted,
            ok: persisted.ok === true,
            error: persisted.ok === true ? null : persisted.error || 'write-usd-export-failed',
            filePath: persisted.filePath || null,
            bytesWritten: Number(persisted.bytesWritten || 0),
        };
    }
    tryBuildRobotMetadataSnapshotFromDriver(stageSourcePath, sortedLinkPaths, meshCountsByLinkPath) {
        if (!Array.isArray(sortedLinkPaths) || sortedLinkPaths.length <= 0) {
            return {
                stageSourcePath: stageSourcePath || null,
                generatedAtMs: this._nowPerfMs(),
                source: 'mesh-only',
                linkParentPairs: [],
                jointCatalogEntries: [],
                linkDynamicsEntries: [],
                closedLoopConstraintEntries: [],
                meshCountsByLinkPath,
            };
        }
        const activeDriver = typeof window !== 'undefined' ? window?.driver : null;
        if (!activeDriver || typeof activeDriver.GetRobotMetadataSnapshot !== 'function') {
            return null;
        }
        const toArray = (value) => (Array.isArray(value)
            ? value
            : (value && typeof value.length === 'number' ? Array.from(value) : []));
        try {
            const rawSnapshot = activeDriver.GetRobotMetadataSnapshot(sortedLinkPaths, String(stageSourcePath || ''));
            if (!rawSnapshot || typeof rawSnapshot !== 'object')
                return null;
            const linkParentPairs = toArray(rawSnapshot.linkParentPairs);
            const jointCatalogEntries = toArray(rawSnapshot.jointCatalogEntries);
            const linkDynamicsEntries = toArray(rawSnapshot.linkDynamicsEntries);
            const closedLoopConstraintEntries = toArray(rawSnapshot.closedLoopConstraintEntries);
            const hasStageData = (linkParentPairs.length > 0
                || jointCatalogEntries.length > 0
                || linkDynamicsEntries.length > 0
                || closedLoopConstraintEntries.length > 0);
            const generatedAtMs = Number(rawSnapshot.generatedAtMs);
            const errorFlags = toArray(rawSnapshot.errorFlags)
                .map((entry) => String(entry || '').trim())
                .filter((entry) => entry.length > 0);
            const truthLoadError = String(rawSnapshot.truthLoadError || '').trim() || null;
            const stale = rawSnapshot.stale === true || errorFlags.length > 0 || !!truthLoadError;
            return {
                stageSourcePath: String(rawSnapshot.stageSourcePath || stageSourcePath || '').trim() || null,
                generatedAtMs: Number.isFinite(generatedAtMs) ? generatedAtMs : this._nowPerfMs(),
                source: hasStageData
                    ? (String(rawSnapshot.source || 'usd-stage-cpp') || 'usd-stage-cpp')
                    : 'mesh-only',
                ...(stale ? { stale: true } : {}),
                ...(errorFlags.length > 0 ? { errorFlags } : {}),
                ...(truthLoadError ? { truthLoadError } : {}),
                linkParentPairs,
                jointCatalogEntries,
                linkDynamicsEntries,
                closedLoopConstraintEntries,
                meshCountsByLinkPath,
            };
        }
        catch (error) {
            console.error('[ThreeRenderDelegateCore] Failed to build robot metadata snapshot from USD driver.', {
                stageSourcePath: String(stageSourcePath || '').trim() || null,
                error,
            });
            return null;
        }
    }
    applyRobotMetadataErrorAnnotations(snapshot, options = {}) {
        if (!snapshot || typeof snapshot !== 'object')
            return snapshot;
        const nextErrorFlags = new Set();
        const addErrorFlag = (value) => {
            const normalized = String(value || '').trim();
            if (normalized) {
                nextErrorFlags.add(normalized);
            }
        };
        for (const errorFlag of Array.isArray(snapshot.errorFlags) ? snapshot.errorFlags : []) {
            addErrorFlag(errorFlag);
        }
        for (const errorFlag of Array.isArray(options.errorFlags) ? options.errorFlags : []) {
            addErrorFlag(errorFlag);
        }
        const normalizeErrorText = (value) => {
            if (typeof value === 'string') {
                const normalized = value.trim();
                return normalized || null;
            }
            if (value instanceof Error) {
                const normalized = String(value.message || value).trim();
                return normalized || null;
            }
            return null;
        };
        const truthLoadError = normalizeErrorText(options.truthLoadError)
            || normalizeErrorText(snapshot.truthLoadError)
            || null;
        const stale = options.stale === true
            || snapshot.stale === true
            || nextErrorFlags.size > 0
            || !!truthLoadError;
        if (!stale && nextErrorFlags.size <= 0 && !truthLoadError) {
            return snapshot;
        }
        return {
            ...snapshot,
            ...(stale ? { stale: true } : {}),
            ...(nextErrorFlags.size > 0 ? { errorFlags: Array.from(nextErrorFlags) } : {}),
            ...(truthLoadError ? { truthLoadError } : {}),
        };
    }
    buildRobotMetadataSnapshotForStage(stageSourcePath, truth) {
        const normalizedStagePath = String(stageSourcePath || this.getNormalizedStageSourcePath() || '').trim().split('?')[0] || null;
        const activeDriver = typeof window !== 'undefined' ? window?.driver : null;
        const hasDriverPhysicsAccess = !!activeDriver
            && (typeof activeDriver.GetPhysicsJointRecords === 'function'
                || typeof activeDriver.GetPhysicsLinkDynamicsRecords === 'function');
        const hasRuntimeMeshInventory = Object.keys(this.meshes || {}).length > 0;
        const shouldReadStageDataWithDriver = hasDriverPhysicsAccess
            && !hasRuntimeMeshInventory
            && this.disableStageLayerTextFallbacks !== true;
        if (!truth && normalizedStagePath) {
            const cachedSnapshot = this._robotMetadataSnapshotByStageSource?.get?.(normalizedStagePath) || null;
            if (cachedSnapshot && !hasDriverPhysicsAccess) {
                return cachedSnapshot;
            }
        }
        const shouldReadStageDataInJs = truth
            || (!hasDriverPhysicsAccess && this.disableStageLayerTextFallbacks !== true)
            || shouldReadStageDataWithDriver;
        let resolvedStage = null;
        let resolvedStageInitialized = false;
        const getStageForMetadataFallback = () => {
            if (resolvedStageInitialized) {
                return resolvedStage;
            }
            resolvedStageInitialized = true;
            resolvedStage = shouldReadStageDataInJs ? (this.getStage?.() || null) : null;
            return resolvedStage;
        };
        const metadataErrorFlags = new Set();
        const registerMetadataErrorFlag = (value) => {
            const normalized = String(value || '').trim();
            if (normalized) {
                metadataErrorFlags.add(normalized);
            }
        };
        const shouldRecoverStageMetadataFromLayerText = (rootLayerText) => {
            const text = String(rootLayerText || '');
            if (!text.trim())
                return false;
            if (text.includes('urdfStudio:roundtripMetadata'))
                return true;
            if (/\.viewer_roundtrip\.usd[a-z]?$/i.test(String(normalizedStagePath || '')))
                return true;
            return /variantSet\s+"Physics"/.test(text)
                && /variantSet\s+"Sensor"/.test(text)
                && (/_description\b/.test(text) || /_description(?:\.usd[a-z]?|\/)/i.test(String(normalizedStagePath || '')));
        };
        const hasRecoverableRobotMetadataLayerText = (layerTexts) => {
            if (!Array.isArray(layerTexts) || layerTexts.length <= 0)
                return false;
            return layerTexts.some((layerText) => {
                const text = String(layerText || '');
                return /def\s+Physics(?:Fixed|Revolute|Prismatic|Spherical|D6)Joint\b/.test(text)
                    || /rel\s+physics:body[01]\s*=/.test(text)
                    || /\burdf:(?:jointType|originXyz|originQuatWxyz|axisLocal|closedLoopType)\b/.test(text)
                    || /\bphysics:(?:mass|centerOfMass|diagonalInertia|principalAxes)\b/.test(text);
            });
        };
        let metadataLayerTexts = [];
        if (activeDriver && typeof activeDriver.GetRootLayerText === 'function') {
            try {
                const rootLayerText = activeDriver.GetRootLayerText();
                if (typeof rootLayerText === 'string' && rootLayerText.length > 0) {
                    metadataLayerTexts.push(rootLayerText);
                }
            } catch {
                registerMetadataErrorFlag('root-layer-text-unavailable');
            }
        }
        if (!truth && shouldReadStageDataInJs) {
            const stage = getStageForMetadataFallback();
            let rootLayerText = '';
            try {
                rootLayerText = this.safeExportLayerText?.(stage?.GetRootLayer?.()) || '';
            }
            catch {
                registerMetadataErrorFlag('root-layer-text-unavailable');
            }
            if (shouldReadStageDataWithDriver || shouldRecoverStageMetadataFromLayerText(rootLayerText)) {
                try {
                    const stageLayerTexts = this.getStageMetadataLayerTexts?.(stage, normalizedStagePath) || [];
                    if (Array.isArray(stageLayerTexts) && stageLayerTexts.length > 0) {
                        const seenTexts = new Set(metadataLayerTexts);
                        metadataLayerTexts = metadataLayerTexts.slice();
                        for (const layerText of stageLayerTexts) {
                            const text = String(layerText || '').trim();
                            if (!text || seenTexts.has(text))
                                continue;
                            seenTexts.add(text);
                            metadataLayerTexts.push(text);
                        }
                    }
                }
                catch {
                    registerMetadataErrorFlag('stage-layer-text-unavailable');
                }
            }
        }
        const meshCountsByLinkPath = {};
        const linkPathSet = new Set();
        const syntheticSemanticChildParentPathByChildLinkPath = new Map();
        const addKnownLinkPath = (value) => {
            const normalizedPath = normalizeUsdPathToken(String(value || ''));
            if (!normalizedPath || !normalizedPath.startsWith('/'))
                return null;
            linkPathSet.add(normalizedPath);
            return normalizedPath;
        };
        const normalizeLinkNameLookupKey = (value) => String(value || '').trim().replace(/[^\w]+/g, '_').toLowerCase();
        const getLinkNameLookupKeys = (value) => {
            const raw = String(value || '').trim();
            const normalized = normalizeLinkNameLookupKey(raw);
            return Array.from(new Set([raw, normalized].filter(Boolean)));
        };
        const resolveKnownLinkPathByEquivalentBasename = (value) => {
            const normalizedPath = normalizeUsdPathToken(String(value || ''));
            const sourceNameKey = normalizeLinkNameLookupKey(getPathBasename(normalizedPath));
            if (!sourceNameKey)
                return null;
            for (const knownPath of linkPathSet) {
                if (knownPath === normalizedPath)
                    return knownPath;
                if (normalizeLinkNameLookupKey(getPathBasename(knownPath)) === sourceNameKey) {
                    return knownPath;
                }
            }
            return null;
        };
        const addKnownStageMetadataLinkPath = (value) => {
            const remappedPath = resolveKnownLinkPathByEquivalentBasename(value);
            return addKnownLinkPath(remappedPath || value);
        };
        const addTruthLinkNames = (targetSet, source) => {
            if (!(targetSet instanceof Set) || !source)
                return;
            if (source instanceof Map) {
                for (const key of source.keys()) {
                    const normalizedKey = String(key || '').trim();
                    if (normalizedKey)
                        targetSet.add(normalizedKey);
                }
                return;
            }
            if (Array.isArray(source)) {
                for (const value of source) {
                    const normalizedValue = String(value || '').trim();
                    if (normalizedValue)
                        targetSet.add(normalizedValue);
                }
                return;
            }
            if (typeof source === 'object') {
                for (const key of Object.keys(source)) {
                    const normalizedKey = String(key || '').trim();
                    if (normalizedKey)
                        targetSet.add(normalizedKey);
                }
            }
        };
        const mergeSemanticChildNameMaps = (targetMap, nextMap) => {
            if (!(targetMap instanceof Map) || !(nextMap instanceof Map))
                return;
            for (const [linkName, childNames] of nextMap.entries()) {
                const normalizedLinkName = String(linkName || '').trim();
                if (!normalizedLinkName || !Array.isArray(childNames) || childNames.length <= 0)
                    continue;
                const existingNames = targetMap.get(normalizedLinkName) || [];
                for (const childName of childNames) {
                    const normalizedChildName = String(childName || '').trim();
                    if (!normalizedChildName || existingNames.includes(normalizedChildName))
                        continue;
                    existingNames.push(normalizedChildName);
                }
                targetMap.set(normalizedLinkName, existingNames);
            }
        };
        const incrementMeshCountsForLinkPath = (linkPath, sectionName, protoType, primitiveGeometry = null) => {
            if (!linkPath)
                return;
            if (!meshCountsByLinkPath[linkPath]) {
                meshCountsByLinkPath[linkPath] = {
                    visualMeshCount: 0,
                    collisionMeshCount: 0,
                    collisionPrimitiveCounts: {},
                };
            }
            const counts = meshCountsByLinkPath[linkPath];
            if (sectionName === 'collisions') {
                counts.collisionMeshCount += 1;
                const primitiveType = collisionPrimitiveTypeFromProto(protoType);
                if (primitiveType) {
                    counts.collisionPrimitiveCounts[primitiveType] = Number(counts.collisionPrimitiveCounts[primitiveType] || 0) + 1;
                }
                if (primitiveGeometry && typeof primitiveGeometry === 'object') {
                    if (!Array.isArray(counts.collisionPrimitiveGeometries)) {
                        counts.collisionPrimitiveGeometries = [];
                    }
                    counts.collisionPrimitiveGeometries.push(primitiveGeometry);
                }
            }
            else if (sectionName === 'visuals') {
                counts.visualMeshCount += 1;
            }
        };
        const mergeColliderFallbackCounts = (collisionMap) => {
            if (!(collisionMap instanceof Map))
                return;
            for (const [linkName, entries] of collisionMap.entries()) {
                const normalizedLinkName = String(linkName || '').trim();
                if (!normalizedLinkName || !Array.isArray(entries) || entries.length <= 0)
                    continue;
                const linkPath = resolveKnownLinkPathByEquivalentBasename(normalizedLinkName);
                if (!linkPath)
                    continue;
                const existingCounts = meshCountsByLinkPath[linkPath];
                if (Number(existingCounts?.collisionMeshCount || 0) > 0) {
                    const parsedGeometries = entries
                        .map((entry) => entry?.primitiveGeometry || entry?.geometry || null)
                        .filter((geometry) => geometry && typeof geometry === 'object');
                    if (parsedGeometries.length > 0) {
                        // Runtime proto descriptors provide the mesh count, but older
                        // Hydra builds can report unit-sized primitive defaults. Retain
                        // the authored layer dimensions as the authoritative geometry
                        // source even when the runtime already found the colliders.
                        existingCounts.collisionPrimitiveGeometries = parsedGeometries;
                    }
                    continue;
                }
                for (const entry of entries) {
                    incrementMeshCountsForLinkPath(
                        linkPath,
                        'collisions',
                        String(entry?.primitiveType || entry?.primType || 'mesh'),
                        entry?.primitiveGeometry || entry?.geometry || null,
                    );
                }
            }
        };
        const normalizeVector3 = (value, fallback = [0, 0, 0]) => {
            const source = Array.isArray(value)
                ? value
                : (value && typeof value.length === 'number' ? Array.from(value) : null);
            if (!source || source.length < 3)
                return fallback.slice(0, 3);
            const x = Number(source[0]);
            const y = Number(source[1]);
            const z = Number(source[2]);
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z))
                return fallback.slice(0, 3);
            return [x, y, z];
        };
        const normalizeQuaternionWxyz = (value, fallback = [1, 0, 0, 0]) => {
            const source = Array.isArray(value)
                ? value
                : (value && typeof value.length === 'number' ? Array.from(value) : null);
            if (!source || source.length < 4)
                return fallback.slice(0, 4);
            const w = Number(source[0]);
            const x = Number(source[1]);
            const y = Number(source[2]);
            const z = Number(source[3]);
            if (!Number.isFinite(w) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z))
                return fallback.slice(0, 4);
            return [w, x, y, z];
        };
        const conjugateQuaternionWxyz = (value) => {
            const normalized = normalizeQuaternionWxyz(value, [1, 0, 0, 0]);
            return [normalized[0], -normalized[1], -normalized[2], -normalized[3]];
        };
        const multiplyQuaternionWxyz = (leftValue, rightValue) => {
            const left = normalizeQuaternionWxyz(leftValue, [1, 0, 0, 0]);
            const right = normalizeQuaternionWxyz(rightValue, [1, 0, 0, 0]);
            const [lw, lx, ly, lz] = left;
            const [rw, rx, ry, rz] = right;
            const quaternion = new Quaternion(
                (lw * rx) + (lx * rw) + (ly * rz) - (lz * ry),
                (lw * ry) - (lx * rz) + (ly * rw) + (lz * rx),
                (lw * rz) + (lx * ry) - (ly * rx) + (lz * rw),
                (lw * rw) - (lx * rx) - (ly * ry) - (lz * rz),
            );
            if (!Number.isFinite(quaternion.lengthSq()) || quaternion.lengthSq() <= 1e-12) {
                return [1, 0, 0, 0];
            }
            quaternion.normalize();
            return [quaternion.w, quaternion.x, quaternion.y, quaternion.z];
        };
        const deriveJointOriginQuatWxyz = (jointRecord) => {
            if (jointRecord?.originQuatWxyz && typeof jointRecord.originQuatWxyz.length === 'number') {
                return jointRecord.originQuatWxyz;
            }
            const localRot0Wxyz = ((jointRecord?.localRot0Wxyz && typeof jointRecord.localRot0Wxyz.length === 'number')
                ? jointRecord.localRot0Wxyz
                : (jointRecord?.localRot0 && typeof jointRecord.localRot0.length === 'number')
                    ? jointRecord.localRot0
                    : null);
            if (!localRot0Wxyz) {
                return null;
            }
            const localRot1Wxyz = ((jointRecord?.localRot1Wxyz && typeof jointRecord.localRot1Wxyz.length === 'number')
                ? jointRecord.localRot1Wxyz
                : (jointRecord?.localRot1 && typeof jointRecord.localRot1.length === 'number')
                    ? jointRecord.localRot1
                    : null);
            if (!localRot1Wxyz) {
                return localRot0Wxyz;
            }
            return multiplyQuaternionWxyz(localRot0Wxyz, conjugateQuaternionWxyz(localRot1Wxyz));
        };
        const normalizeAxisToken = (value) => {
            const token = String(value || 'X').trim().toUpperCase();
            if (token.startsWith('Y'))
                return 'Y';
            if (token.startsWith('Z'))
                return 'Z';
            return 'X';
        };
        const toAxisVector = (axisToken) => {
            if (axisToken === 'Y')
                return new Vector3(0, 1, 0);
            if (axisToken === 'Z')
                return new Vector3(0, 0, 1);
            return new Vector3(1, 0, 0);
        };
        const rotateAxisByQuaternionWxyz = (axisToken, localRot1Wxyz) => {
            const axis = toAxisVector(axisToken);
            const normalizedWxyz = normalizeQuaternionWxyz(localRot1Wxyz, [1, 0, 0, 0]);
            const quaternion = new Quaternion(Number(normalizedWxyz[1] ?? 0), Number(normalizedWxyz[2] ?? 0), Number(normalizedWxyz[3] ?? 0), Number(normalizedWxyz[0] ?? 1));
            if (Number.isFinite(quaternion.lengthSq()) && quaternion.lengthSq() > 1e-12) {
                quaternion.normalize();
                axis.applyQuaternion(quaternion);
            }
            if (!Number.isFinite(axis.lengthSq()) || axis.lengthSq() <= 1e-12) {
                return [1, 0, 0];
            }
            axis.normalize();
            return [axis.x, axis.y, axis.z];
        };
        const axisTokenFromAxis = (axis) => {
            const x = Math.abs(Number(axis?.[0] || 0));
            const y = Math.abs(Number(axis?.[1] || 0));
            const z = Math.abs(Number(axis?.[2] || 0));
            if (y >= x && y >= z)
                return 'Y';
            if (z >= x && z >= y)
                return 'Z';
            return 'X';
        };
        const hasSignificantVector3 = (vector3Tuple, epsilon = 1e-8) => {
            if (!Array.isArray(vector3Tuple) || vector3Tuple.length < 3)
                return false;
            return (Math.abs(Number(vector3Tuple[0] || 0)) > epsilon
                || Math.abs(Number(vector3Tuple[1] || 0)) > epsilon
                || Math.abs(Number(vector3Tuple[2] || 0)) > epsilon);
        };
        const hasSignificantMassValue = (value, epsilon = 1e-8) => {
            const mass = Number(value);
            return Number.isFinite(mass) && Math.abs(mass) > epsilon;
        };
        const hasAuthoredVector3 = (vector3Tuple) => Array.isArray(vector3Tuple) && vector3Tuple.length >= 3;
        const hasAuthoredQuaternionWxyz = (quaternionWxyz) => Array.isArray(quaternionWxyz) && quaternionWxyz.length >= 4;
        const hasNonIdentityQuaternionWxyz = (quaternionWxyz, epsilon = 1e-6) => {
            if (!Array.isArray(quaternionWxyz) || quaternionWxyz.length < 4)
                return false;
            return (Math.abs(Number(quaternionWxyz[1] || 0)) > epsilon
                || Math.abs(Number(quaternionWxyz[2] || 0)) > epsilon
                || Math.abs(Number(quaternionWxyz[3] || 0)) > epsilon
                || Math.abs(Number(quaternionWxyz[0] ?? 1) - 1) > epsilon);
        };
        const safeGetPrimAtPath = (stageObject, primPath) => {
            if (!stageObject?.GetPrimAtPath || !primPath)
                return null;
            try {
                return stageObject.GetPrimAtPath(primPath) || null;
            }
            catch {
                return null;
            }
        };
        const safeGetPrimAttribute = (prim, attributeName) => {
            if (!prim?.GetAttribute || !attributeName)
                return null;
            try {
                return prim.GetAttribute(attributeName)?.Get?.() ?? null;
            }
            catch {
                return null;
            }
        };
        const normalizeStageJointType = (jointTypeName) => {
            const raw = String(jointTypeName || '').trim();
            const normalized = raw.toLowerCase();
            if (!normalized)
                return 'joint';
            if (normalized === 'revolute' || normalized.includes('revolute') || normalized === 'continuous' || normalized.includes('continuous')) {
                return 'revolute';
            }
            if (normalized === 'prismatic' || normalized.includes('prismatic'))
                return 'prismatic';
            if (normalized === 'fixed' || normalized.includes('fixed'))
                return 'fixed';
            if (normalized === 'distance' || normalized.includes('distance'))
                return 'distance';
            if (normalized === 'spherical' || normalized.includes('spherical') || normalized.includes('ball'))
                return 'spherical';
            if (normalized === 'd6' || normalized.includes('d6') || normalized.includes('6dof') || normalized.includes('sixdof'))
                return 'floating';
            if (normalized === 'floating' || normalized.includes('floating') || normalized === 'free' || normalized.includes('freejoint'))
                return 'floating';
            if (normalized === 'joint' || normalized === 'physicsjoint' || normalized === 'usdphysicsjoint' || normalized.includes('generic'))
                return 'floating';
            return raw || 'joint';
        };
        const isControllableStageJointType = (jointTypeName) => {
            return normalizeStageJointType(jointTypeName) === 'revolute';
        };
        const isNonRotationalStageJointType = (jointTypeName) => {
            const type = normalizeStageJointType(jointTypeName);
            return type === 'fixed' || type === 'prismatic' || type === 'distance' || type === 'floating';
        };
        const normalizeStageJointLimits = (jointTypeName, lowerLimitDeg, upperLimitDeg) => {
            const lower = Number(lowerLimitDeg);
            const upper = Number(upperLimitDeg);
            const hasLower = Number.isFinite(lower);
            const hasUpper = Number.isFinite(upper);
            if (!hasLower && !hasUpper) {
                if (isNonRotationalStageJointType(jointTypeName)) {
                    return { lower: 0, upper: 0 };
                }
                return { lower: -180, upper: 180 };
            }
            let normalizedLower = hasLower ? lower : (isNonRotationalStageJointType(jointTypeName) ? 0 : -180);
            let normalizedUpper = hasUpper ? upper : (isNonRotationalStageJointType(jointTypeName) ? 0 : 180);
            if (normalizedLower > normalizedUpper) {
                const midpoint = (normalizedLower + normalizedUpper) * 0.5;
                normalizedLower = midpoint;
                normalizedUpper = midpoint;
            }
            return { lower: normalizedLower, upper: normalizedUpper };
        };
        const collisionPrimitiveTypeFromProto = (protoType) => {
            const normalizedType = String(protoType || '').trim().toLowerCase();
            if (!normalizedType)
                return null;
            if (normalizedType === 'cube')
                return 'box';
            return normalizedType;
        };
        const parseLegacyRuntimeMeshDescriptor = (meshId) => {
            const normalizedMeshPath = normalizeUsdPathToken(meshId);
            if (!normalizedMeshPath || !normalizedMeshPath.startsWith('/'))
                return null;
            const sectionMatch = normalizedMeshPath.match(/^(.*)\/(visuals|collisions)(?:([/.])(.*))?$/i);
            if (!sectionMatch)
                return null;
            const linkPath = normalizeUsdPathToken(sectionMatch[1]);
            if (!linkPath || linkPath === '/')
                return null;
            const sectionName = String(sectionMatch[2] || '').toLowerCase();
            const suffix = String(sectionMatch[4] || '').trim().toLowerCase();
            const inferProtoType = () => {
                if (!suffix)
                    return 'mesh';
                if (suffix.includes('box') || suffix.includes('cube'))
                    return 'box';
                if (suffix.includes('sphere'))
                    return 'sphere';
                if (suffix.includes('cylinder'))
                    return 'cylinder';
                if (suffix.includes('capsule'))
                    return 'capsule';
                return 'mesh';
            };
            const inferProtoIndex = () => {
                const suffixIndexMatch = suffix.match(/(?:^|[^a-z0-9])(?:id|mesh_)(\d+)(?:[^a-z0-9]|$)/i);
                if (suffixIndexMatch) {
                    const parsed = Number(suffixIndexMatch[1]);
                    if (Number.isFinite(parsed) && parsed >= 0)
                        return parsed;
                }
                return 0;
            };
            return {
                containerPath: `${linkPath}/${sectionName}`,
                linkPath,
                linkName: getPathBasename(linkPath),
                sectionName,
                protoType: inferProtoType(),
                protoIndex: inferProtoIndex(),
            };
        };
        const parseRuntimeMeshDescriptor = (meshId) => {
            const cached = this._protoMeshMetadataByMeshId.get(meshId);
            if (cached?.linkPath)
                return cached;
            const parsedProto = parseProtoMeshIdentifier(meshId);
            if (parsedProto?.linkPath)
                return parsedProto;
            return parseLegacyRuntimeMeshDescriptor(meshId);
        };
        if (activeDriver && typeof activeDriver.GetPhysicsJointRecords === 'function') {
            let rawJointRecords = [];
            try {
                rawJointRecords = activeDriver.GetPhysicsJointRecords();
            }
            catch {
                registerMetadataErrorFlag('physics-joint-records-unavailable');
                rawJointRecords = [];
            }
            const driverJointRecords = (rawJointRecords && typeof rawJointRecords.length === 'number')
                ? Array.from(rawJointRecords)
                : [];
            for (const jointRecord of driverJointRecords) {
                addKnownLinkPath(jointRecord?.body0Path);
                addKnownLinkPath(jointRecord?.body1Path);
            }
        }
        if (activeDriver && typeof activeDriver.GetPhysicsLinkDynamicsRecords === 'function') {
            let rawLinkDynamicsRecords = [];
            try {
                rawLinkDynamicsRecords = activeDriver.GetPhysicsLinkDynamicsRecords();
            }
            catch {
                registerMetadataErrorFlag('physics-link-dynamics-unavailable');
                rawLinkDynamicsRecords = [];
            }
            const driverLinkDynamicsRecords = (rawLinkDynamicsRecords && typeof rawLinkDynamicsRecords.length === 'number')
                ? Array.from(rawLinkDynamicsRecords)
                : [];
            for (const dynamicsRecord of driverLinkDynamicsRecords) {
                addKnownLinkPath(dynamicsRecord?.linkPath);
            }
        }
        if (
            metadataLayerTexts.length > 0 &&
            (hasDriverPhysicsAccess || hasRecoverableRobotMetadataLayerText(metadataLayerTexts))
        ) {
            for (const layerText of metadataLayerTexts) {
                for (const jointRecord of extractJointRecordsFromLayerText(layerText)) {
                    addKnownStageMetadataLinkPath(jointRecord?.body0Path);
                    addKnownStageMetadataLinkPath(jointRecord?.body1Path);
                }
                for (const linkPath of parseLinkDynamicsPatchesFromLayerText(layerText).keys()) {
                    addKnownStageMetadataLinkPath(linkPath);
                }
            }
        }
        if (truth && !hasDriverPhysicsAccess) {
            registerMetadataErrorFlag('usd-driver-metadata-missing');
        }
        const truthLinkNameSet = new Set();
        addTruthLinkNames(truthLinkNameSet, truth?.visualsByLinkName);
        addTruthLinkNames(truthLinkNameSet, truth?.collisionsByLinkName);
        addTruthLinkNames(truthLinkNameSet, truth?.jointByChildLinkName);
        addTruthLinkNames(truthLinkNameSet, truth?.inertialByLinkName);
        const visualSemanticChildNameMapByLinkName = new Map();
        const collisionSemanticLinkNameSet = new Set();
        for (const layerText of metadataLayerTexts) {
            mergeSemanticChildNameMaps(visualSemanticChildNameMapByLinkName, parseVisualSemanticChildNamesFromLayerText(layerText));
            for (const collisionMap of [
                parseGuideCollisionReferencesFromLayerText(layerText),
                parseColliderEntriesFromLayerText(layerText),
            ]) {
                if (!(collisionMap instanceof Map))
                    continue;
                mergeColliderFallbackCounts(collisionMap);
                for (const linkName of collisionMap.keys()) {
                    const normalizedLinkName = String(linkName || '').trim();
                    if (normalizedLinkName) {
                        collisionSemanticLinkNameSet.add(normalizedLinkName);
                    }
                }
            }
        }
        const shouldAdoptSemanticChildTarget = ({ owningLinkPath, sectionName, semanticTarget }) => {
            if (!owningLinkPath || !semanticTarget?.linkName || !semanticTarget?.linkPath)
                return false;
            if (semanticTarget.linkPath === owningLinkPath)
                return false;
            if (linkPathSet.has(semanticTarget.linkPath))
                return true;
            if (truthLinkNameSet.has(semanticTarget.linkName))
                return true;
            if (sectionName === 'visuals') {
                const owningLinkName = getPathBasename(owningLinkPath);
                const allowedChildNames = visualSemanticChildNameMapByLinkName.get(owningLinkName) || [];
                return allowedChildNames.includes(semanticTarget.linkName);
            }
            if (sectionName === 'collisions') {
                return collisionSemanticLinkNameSet.has(semanticTarget.linkName);
            }
            return false;
        };
        for (const meshId of Object.keys(this.meshes || {})) {
            const proto = parseRuntimeMeshDescriptor(meshId);
            if (!proto?.linkPath)
                continue;
            this._protoMeshMetadataByMeshId.set(meshId, proto);
            let targetLinkPath = proto.linkPath;
            if (proto.sectionName === 'visuals' || proto.sectionName === 'collisions') {
                const resolvedPrimPath = proto.sectionName === 'visuals'
                    ? this.getResolvedVisualTransformPrimPathForMeshId?.(meshId)
                    : this.getResolvedPrimPathForMeshId?.(meshId);
                const semanticTarget = resolveSemanticChildLinkTargetFromResolvedPrimPath({
                    owningLinkPath: proto.linkPath,
                    resolvedPrimPath,
                    sectionName: proto.sectionName,
                });
                if (shouldAdoptSemanticChildTarget({
                    owningLinkPath: proto.linkPath,
                    sectionName: proto.sectionName,
                    semanticTarget,
                })) {
                    targetLinkPath = semanticTarget.linkPath;
                    if (!syntheticSemanticChildParentPathByChildLinkPath.has(targetLinkPath)) {
                        syntheticSemanticChildParentPathByChildLinkPath.set(targetLinkPath, proto.linkPath);
                    }
                }
            }
            addKnownLinkPath(targetLinkPath);
            incrementMeshCountsForLinkPath(targetLinkPath, proto.sectionName, proto.protoType);
        }
        const sortedLinkPaths = Array.from(linkPathSet).sort((left, right) => left.localeCompare(right));
        const mergeSyntheticSemanticChildLinkMetadata = (snapshot) => {
            if (!snapshot || typeof snapshot !== 'object')
                return snapshot;
            if (!(syntheticSemanticChildParentPathByChildLinkPath instanceof Map) || syntheticSemanticChildParentPathByChildLinkPath.size <= 0) {
                return snapshot;
            }
            const nextLinkParentPairs = Array.isArray(snapshot.linkParentPairs)
                ? snapshot.linkParentPairs.slice()
                : [];
            const pairKeys = new Set();
            for (const pair of nextLinkParentPairs) {
                if (!Array.isArray(pair) || pair.length <= 0)
                    continue;
                const childLinkPath = normalizeUsdPathToken(String(pair[0] || '')) || null;
                if (!childLinkPath)
                    continue;
                const parentLinkPath = normalizeUsdPathToken(String(pair[1] || '')) || null;
                pairKeys.add(`${childLinkPath}|${parentLinkPath || ''}`);
            }
            let mutated = false;
            for (const [childLinkPath, parentLinkPath] of syntheticSemanticChildParentPathByChildLinkPath.entries()) {
                if (!meshCountsByLinkPath[childLinkPath])
                    continue;
                const pairKey = `${childLinkPath}|${parentLinkPath || ''}`;
                if (pairKeys.has(pairKey))
                    continue;
                pairKeys.add(pairKey);
                nextLinkParentPairs.push([childLinkPath, parentLinkPath || null]);
                mutated = true;
            }
            if (!mutated)
                return snapshot;
            nextLinkParentPairs.sort((left, right) => String(left?.[0] || '').localeCompare(String(right?.[0] || '')));
            return {
                ...snapshot,
                linkParentPairs: nextLinkParentPairs,
            };
        };
        const mergeMissingJointCatalogEntriesFromDriver = (snapshot) => {
            if (!snapshot || typeof snapshot !== 'object')
                return snapshot;
            if (!Array.isArray(sortedLinkPaths) || sortedLinkPaths.length <= 0)
                return snapshot;
            if (!activeDriver || typeof activeDriver.GetPhysicsJointRecords !== 'function') {
                return snapshot;
            }
            let rawJointRecords = [];
            try {
                rawJointRecords = activeDriver.GetPhysicsJointRecords();
            }
            catch {
                registerMetadataErrorFlag('physics-joint-records-unavailable');
                rawJointRecords = [];
            }
            const driverJointRecords = (rawJointRecords && typeof rawJointRecords.length === 'number'
                ? Array.from(rawJointRecords)
                : []);
            if (driverJointRecords.length <= 0)
                return snapshot;
            const linkPathSetForMerge = new Set(sortedLinkPaths);
            const runtimeLinkPathsByNameForMerge = new Map();
            const rootPathSetForMerge = new Set();
            const rootPathsForMerge = [];
            for (const linkPath of sortedLinkPaths) {
                const linkName = getPathBasename(linkPath);
                if (linkName) {
                    for (const lookupKey of getLinkNameLookupKeys(linkName)) {
                        const existing = runtimeLinkPathsByNameForMerge.get(lookupKey) || [];
                        existing.push(linkPath);
                        runtimeLinkPathsByNameForMerge.set(lookupKey, existing);
                    }
                }
                const rootPath = getRootPathFromPrimPath(linkPath);
                if (rootPath && !rootPathSetForMerge.has(rootPath)) {
                    rootPathSetForMerge.add(rootPath);
                    rootPathsForMerge.push(rootPath);
                }
            }
            rootPathsForMerge.sort((left, right) => left.localeCompare(right));
            const sortByPreferredRootForMerge = (paths, preferredRootPath = null) => {
                const deduped = Array.from(new Set(paths.filter(Boolean)));
                deduped.sort((left, right) => left.localeCompare(right));
                if (!preferredRootPath)
                    return deduped;
                return deduped.sort((left, right) => {
                    const leftPreferred = getRootPathFromPrimPath(left) === preferredRootPath ? 0 : 1;
                    const rightPreferred = getRootPathFromPrimPath(right) === preferredRootPath ? 0 : 1;
                    if (leftPreferred !== rightPreferred)
                        return leftPreferred - rightPreferred;
                    return left.localeCompare(right);
                });
            };
            const resolveRuntimeLinkPathsFromSourcePathForMerge = (sourcePath, preferredRootPath = null) => {
                const source = String(sourcePath || '').trim();
                if (!source)
                    return [];
                const normalizedSourcePath = normalizeUsdPathToken(source);
                const matches = [];
                const addMatch = (candidatePath) => {
                    if (!candidatePath)
                        return;
                    if (!linkPathSetForMerge.has(candidatePath))
                        return;
                    if (matches.includes(candidatePath))
                        return;
                    matches.push(candidatePath);
                };
                addMatch(normalizedSourcePath);
                const linkName = getPathBasename(normalizedSourcePath || source.replace(/[<>]/g, ''));
                if (linkName) {
                    for (const lookupKey of getLinkNameLookupKeys(linkName)) {
                        for (const candidatePath of runtimeLinkPathsByNameForMerge.get(lookupKey) || []) {
                            addMatch(candidatePath);
                        }
                    }
                }
                if (normalizedSourcePath) {
                    const sourceWithoutRoot = getPathWithoutRoot(normalizedSourcePath);
                    if (sourceWithoutRoot && sourceWithoutRoot !== '/') {
                        if (preferredRootPath) {
                            addMatch(`${preferredRootPath}${sourceWithoutRoot}`);
                        }
                        for (const rootPath of rootPathsForMerge) {
                            if (preferredRootPath && rootPath === preferredRootPath)
                                continue;
                            addMatch(`${rootPath}${sourceWithoutRoot}`);
                        }
                    }
                }
                return sortByPreferredRootForMerge(matches, preferredRootPath);
            };
            const normalizeEntryChildLinkPath = (entry) => {
                return normalizeUsdPathToken(String(entry?.linkPath || entry?.childLinkPath || entry?.body1Path || '')) || null;
            };
            const existingJointCatalogEntries = Array.isArray(snapshot.jointCatalogEntries)
                ? snapshot.jointCatalogEntries.slice()
                : [];
            const existingEntryByChildLinkPath = new Map();
            for (const entry of existingJointCatalogEntries) {
                const childLinkPath = normalizeEntryChildLinkPath(entry);
                if (!childLinkPath)
                    continue;
                if (!linkPathSetForMerge.has(childLinkPath))
                    continue;
                if (existingEntryByChildLinkPath.has(childLinkPath))
                    continue;
                existingEntryByChildLinkPath.set(childLinkPath, entry);
            }
            const existingLinkParentPairs = Array.isArray(snapshot.linkParentPairs)
                ? snapshot.linkParentPairs.slice()
                : [];
            const existingPairKeySet = new Set();
            for (const pair of existingLinkParentPairs) {
                if (!Array.isArray(pair) || pair.length <= 0)
                    continue;
                const childLinkPath = normalizeUsdPathToken(String(pair[0] || '')) || null;
                if (!childLinkPath)
                    continue;
                const parentLinkPath = normalizeUsdPathToken(String(pair[1] || '')) || null;
                existingPairKeySet.add(`${childLinkPath}|${parentLinkPath || ''}`);
            }
            let mutated = false;
            for (const jointRecord of driverJointRecords) {
                const body1Path = normalizeUsdPathToken(String(jointRecord?.body1Path || '')) || null;
                if (!body1Path)
                    continue;
                const body0Path = normalizeUsdPathToken(String(jointRecord?.body0Path || '')) || null;
                const jointPath = normalizeUsdPathToken(String(jointRecord?.jointPath || jointRecord?.path || '')) || null;
                const fallbackJointName = jointPath ? getPathBasename(jointPath) : '';
                const jointName = String(jointRecord?.jointName || fallbackJointName || '').trim();
                const closedLoopType = String(jointRecord?.closedLoopType || '').trim();
                if (closedLoopType) {
                    continue;
                }
                const jointTypeName = String(jointRecord?.jointTypeName || jointRecord?.jointType || '').trim();
                const jointType = normalizeStageJointType(jointTypeName);
                const axisToken = normalizeAxisToken(jointRecord?.axisToken || jointRecord?.axis || 'X');
                const localPos0 = jointRecord?.localPos0 && typeof jointRecord.localPos0.length === 'number'
                    ? normalizeVector3(jointRecord.localPos0, [0, 0, 0])
                    : null;
                const localRot0Wxyz = ((jointRecord?.localRot0Wxyz && typeof jointRecord.localRot0Wxyz.length === 'number')
                    ? normalizeQuaternionWxyz(jointRecord.localRot0Wxyz, [1, 0, 0, 0])
                    : (jointRecord?.localRot0 && typeof jointRecord.localRot0.length === 'number')
                        ? normalizeQuaternionWxyz(jointRecord.localRot0, [1, 0, 0, 0])
                        : null);
                const localPos1 = normalizeVector3(jointRecord?.localPos1 || [0, 0, 0], [0, 0, 0]);
                const localRot1Wxyz = normalizeQuaternionWxyz(jointRecord?.localRot1Wxyz || jointRecord?.localRot1 || [1, 0, 0, 0], [1, 0, 0, 0]);
                const originXyz = ((jointRecord?.originXyz && typeof jointRecord.originXyz.length === 'number')
                    ? jointRecord.originXyz
                    : localPos0
                        ? localPos0
                        : null);
                const originQuatWxyz = deriveJointOriginQuatWxyz(jointRecord);
                const normalizedOriginXyz = originXyz
                    ? normalizeVector3(originXyz, [0, 0, 0])
                    : null;
                const normalizedOriginQuatWxyz = originQuatWxyz
                    ? normalizeQuaternionWxyz(originQuatWxyz, [1, 0, 0, 0])
                    : null;
                const axisLocal = jointRecord?.axisLocal && typeof jointRecord.axisLocal.length === 'number'
                    ? normalizeVector3(jointRecord.axisLocal, rotateAxisByQuaternionWxyz(axisToken, localRot1Wxyz))
                    : rotateAxisByQuaternionWxyz(axisToken, localRot1Wxyz);
                const limits = normalizeStageJointLimits(jointTypeName || jointType, Number(jointRecord?.lowerLimitDeg), Number(jointRecord?.upperLimitDeg));
                const angleDeg = toFiniteNumber(jointRecord?.angleDeg);
                const driveDamping = toFiniteNumber(jointRecord?.driveDamping);
                const driveMaxForce = toFiniteNumber(jointRecord?.driveMaxForce);
                const childLinkPaths = resolveRuntimeLinkPathsFromSourcePathForMerge(body1Path);
                for (const childLinkPath of childLinkPaths) {
                    if (!childLinkPath)
                        continue;
                    const preferredRootPath = getRootPathFromPrimPath(childLinkPath);
                    const parentCandidates = resolveRuntimeLinkPathsFromSourcePathForMerge(body0Path, preferredRootPath);
                    const parentLinkPath = parentCandidates[0] || null;
                    const pairKey = `${childLinkPath}|${parentLinkPath || ''}`;
                    if (!existingPairKeySet.has(pairKey)) {
                        existingPairKeySet.add(pairKey);
                        existingLinkParentPairs.push([childLinkPath, parentLinkPath]);
                        mutated = true;
                    }
                    const existingEntry = existingEntryByChildLinkPath.get(childLinkPath) || null;
                    if (existingEntry) {
                        if (!existingEntry.parentLinkPath && parentLinkPath) {
                            existingEntry.parentLinkPath = parentLinkPath;
                            mutated = true;
                        }
                        if (!existingEntry.jointPath && jointPath) {
                            existingEntry.jointPath = jointPath;
                            mutated = true;
                        }
                        if (!existingEntry.jointName && jointName) {
                            existingEntry.jointName = jointName;
                            mutated = true;
                        }
                        if (!existingEntry.jointTypeName && jointTypeName) {
                            existingEntry.jointTypeName = jointTypeName;
                            mutated = true;
                        }
                        if (!existingEntry.jointType && jointType) {
                            existingEntry.jointType = jointType;
                            mutated = true;
                        }
                        if ((!existingEntry.originXyz || typeof existingEntry.originXyz.length !== 'number') && normalizedOriginXyz) {
                            existingEntry.originXyz = normalizedOriginXyz;
                            mutated = true;
                        }
                        if ((!existingEntry.originQuatWxyz || typeof existingEntry.originQuatWxyz.length !== 'number') && normalizedOriginQuatWxyz) {
                            existingEntry.originQuatWxyz = normalizedOriginQuatWxyz;
                            mutated = true;
                        }
                        if ((!existingEntry.localPos0 || typeof existingEntry.localPos0.length !== 'number') && localPos0) {
                            existingEntry.localPos0 = localPos0;
                            mutated = true;
                        }
                        if ((!existingEntry.localRot0Wxyz || typeof existingEntry.localRot0Wxyz.length !== 'number') && localRot0Wxyz) {
                            existingEntry.localRot0Wxyz = localRot0Wxyz;
                            mutated = true;
                        }
                        if ((!existingEntry.localPos1 || typeof existingEntry.localPos1.length !== 'number') && localPos1) {
                            existingEntry.localPos1 = localPos1;
                            mutated = true;
                        }
                        if ((!existingEntry.localRot1Wxyz || typeof existingEntry.localRot1Wxyz.length !== 'number') && localRot1Wxyz) {
                            existingEntry.localRot1Wxyz = localRot1Wxyz;
                            mutated = true;
                        }
                        if ((!existingEntry.localPivotInLink || typeof existingEntry.localPivotInLink.length !== 'number') && localPos1) {
                            existingEntry.localPivotInLink = localPos1;
                            mutated = true;
                        }
                        if ((!existingEntry.axisLocal || typeof existingEntry.axisLocal.length !== 'number') && axisLocal) {
                            existingEntry.axisLocal = axisLocal;
                            mutated = true;
                        }
                        if ((existingEntry.angleDeg === undefined || existingEntry.angleDeg === null) && angleDeg !== undefined) {
                            existingEntry.angleDeg = angleDeg;
                            mutated = true;
                        }
                        if (isNonRotationalStageJointType(jointTypeName || jointType)) {
                            const existingLowerLimit = Number(existingEntry.lowerLimitDeg);
                            const existingUpperLimit = Number(existingEntry.upperLimitDeg);
                            const hasExistingLimits = Number.isFinite(existingLowerLimit) && Number.isFinite(existingUpperLimit);
                            const looksLikeLegacyDefaultLimits = hasExistingLimits
                                && Math.abs(existingLowerLimit + 180) <= 1e-6
                                && Math.abs(existingUpperLimit - 180) <= 1e-6;
                            if (!hasExistingLimits || looksLikeLegacyDefaultLimits) {
                                existingEntry.lowerLimitDeg = limits.lower;
                                existingEntry.upperLimitDeg = limits.upper;
                                mutated = true;
                            }
                        }
                        if (existingEntry.driveDamping === undefined || existingEntry.driveDamping === null) {
                            if (driveDamping !== undefined) {
                                existingEntry.driveDamping = driveDamping;
                                mutated = true;
                            }
                        }
                        if (existingEntry.driveMaxForce === undefined || existingEntry.driveMaxForce === null) {
                            if (driveMaxForce !== undefined) {
                                existingEntry.driveMaxForce = driveMaxForce;
                                mutated = true;
                            }
                        }
                        continue;
                    }
                    const fallbackRootPath = getRootPathFromPrimPath(childLinkPath);
                    const fallbackJointNameForPath = jointName || `${getPathBasename(childLinkPath) || 'link'}_joint`;
                    const resolvedJointPath = jointPath
                        || (fallbackRootPath
                            ? `${fallbackRootPath}/joints/${fallbackJointNameForPath}`
                            : `/joints/${fallbackJointNameForPath}`);
                    const newEntry = {
                        linkPath: childLinkPath,
                        childLinkPath: childLinkPath,
                        jointPath: resolvedJointPath,
                        jointName: fallbackJointNameForPath,
                        jointType: jointType,
                        jointTypeName: jointTypeName || null,
                        parentLinkPath,
                        axisToken,
                        axisLocal,
                        lowerLimitDeg: limits.lower,
                        upperLimitDeg: limits.upper,
                        angleDeg: angleDeg ?? null,
                        driveDamping: driveDamping ?? null,
                        driveMaxForce: driveMaxForce ?? null,
                        localPos0,
                        localRot0Wxyz,
                        localPivotInLink: localPos1,
                        localPos1,
                        localRot1Wxyz,
                        originXyz: normalizedOriginXyz,
                        originQuatWxyz: normalizedOriginQuatWxyz,
                    };
                    existingJointCatalogEntries.push(newEntry);
                    existingEntryByChildLinkPath.set(childLinkPath, newEntry);
                    mutated = true;
                }
            }
            if (!mutated)
                return snapshot;
            existingLinkParentPairs.sort((left, right) => String(left?.[0] || '').localeCompare(String(right?.[0] || '')));
            return {
                ...snapshot,
                linkParentPairs: existingLinkParentPairs,
                jointCatalogEntries: existingJointCatalogEntries,
            };
        };
        if (!truth) {
            let cxxSnapshot = this.tryBuildRobotMetadataSnapshotFromDriver(normalizedStagePath, sortedLinkPaths, meshCountsByLinkPath);
            cxxSnapshot = mergeMissingJointCatalogEntriesFromDriver(cxxSnapshot);
            cxxSnapshot = mergeSyntheticSemanticChildLinkMetadata(cxxSnapshot);
            const truthLoadError = String(this._urdfTruthLoadErrorByStageSource?.get?.(normalizedStagePath) || '').trim() || null;
            const annotationErrorFlags = Array.from(metadataErrorFlags);
            if (truthLoadError) {
                annotationErrorFlags.push('urdf-truth-load-failed');
            }
            if (cxxSnapshot) {
                const cxxLinkParentCount = Array.isArray(cxxSnapshot.linkParentPairs)
                    ? cxxSnapshot.linkParentPairs.length
                    : 0;
                const cxxJointCount = Array.isArray(cxxSnapshot.jointCatalogEntries)
                    ? cxxSnapshot.jointCatalogEntries.length
                    : 0;
                const cxxDynamicsCount = Array.isArray(cxxSnapshot.linkDynamicsEntries)
                    ? cxxSnapshot.linkDynamicsEntries.length
                    : 0;
                const cxxHasCompleteStageMetadata = cxxJointCount > 0 && cxxDynamicsCount > 0;
                const cxxHasAnyStageMetadata = cxxLinkParentCount > 0 || cxxJointCount > 0 || cxxDynamicsCount > 0;
                if (cxxHasAnyStageMetadata) {
                    const cxxAnnotationErrorFlags = cxxHasCompleteStageMetadata
                        ? annotationErrorFlags
                        : [...annotationErrorFlags, 'usd-driver-metadata-incomplete'];
                    return this.applyRobotMetadataErrorAnnotations(cxxSnapshot, {
                        errorFlags: cxxAnnotationErrorFlags,
                        truthLoadError,
                    });
                }
            }
            if (!hasRecoverableRobotMetadataLayerText(metadataLayerTexts)) {
                annotationErrorFlags.push('usd-driver-metadata-missing');
                const meshOnlySnapshot = this.applyRobotMetadataErrorAnnotations({
                    stageSourcePath: normalizedStagePath,
                    generatedAtMs: this._nowPerfMs(),
                    source: 'mesh-only',
                    linkParentPairs: [],
                    jointCatalogEntries: [],
                    linkDynamicsEntries: [],
                    closedLoopConstraintEntries: [],
                    meshCountsByLinkPath,
                }, {
                    errorFlags: annotationErrorFlags,
                    truthLoadError,
                });
                if (normalizedStagePath && this._robotMetadataSnapshotByStageSource?.set) {
                    this._robotMetadataSnapshotByStageSource.set(normalizedStagePath, meshOnlySnapshot);
                }
                return meshOnlySnapshot;
            }
        }
        const jointCatalogEntries = [];
        const linkDynamicsEntries = [];
        const closedLoopConstraintEntries = [];
        const closedLoopConstraintKeySet = new Set();
        const rootPaths = Array.from(new Set(sortedLinkPaths.map((linkPath) => getRootPathFromPrimPath(linkPath)).filter(Boolean)));
        const runtimeLinkPathsByName = new Map();
        for (const linkPath of sortedLinkPaths) {
            const linkName = getPathBasename(linkPath);
            if (!linkName)
                continue;
            for (const lookupKey of getLinkNameLookupKeys(linkName)) {
                const existing = runtimeLinkPathsByName.get(lookupKey) || [];
                existing.push(linkPath);
                runtimeLinkPathsByName.set(lookupKey, existing);
            }
        }
        const sortByPreferredRoot = (paths, preferredRootPath = null) => {
            const deduped = Array.from(new Set(paths.filter(Boolean)));
            deduped.sort((left, right) => left.localeCompare(right));
            if (!preferredRootPath)
                return deduped;
            return deduped.sort((left, right) => {
                const leftPreferred = getRootPathFromPrimPath(left) === preferredRootPath ? 0 : 1;
                const rightPreferred = getRootPathFromPrimPath(right) === preferredRootPath ? 0 : 1;
                if (leftPreferred !== rightPreferred)
                    return leftPreferred - rightPreferred;
                return left.localeCompare(right);
            });
        };
        const resolveRuntimeLinkPathsFromSourcePath = (sourcePath, preferredRootPath = null) => {
            const source = String(sourcePath || '').trim();
            if (!source)
                return [];
            const normalizedSourcePath = normalizeUsdPathToken(source);
            const matches = [];
            const addMatch = (candidatePath) => {
                if (!candidatePath)
                    return;
                if (!linkPathSet.has(candidatePath))
                    return;
                if (matches.includes(candidatePath))
                    return;
                matches.push(candidatePath);
            };
            addMatch(normalizedSourcePath);
            const linkName = getPathBasename(normalizedSourcePath || source.replace(/[<>]/g, ''));
            if (linkName) {
                for (const lookupKey of getLinkNameLookupKeys(linkName)) {
                    for (const candidatePath of runtimeLinkPathsByName.get(lookupKey) || []) {
                        addMatch(candidatePath);
                    }
                }
            }
            if (normalizedSourcePath) {
                const sourceWithoutRoot = getPathWithoutRoot(normalizedSourcePath);
                if (sourceWithoutRoot && sourceWithoutRoot !== '/') {
                    const remapOrder = preferredRootPath
                        ? [preferredRootPath, ...rootPaths.filter((entry) => entry !== preferredRootPath)]
                        : rootPaths;
                    for (const rootPath of remapOrder) {
                        if (!rootPath)
                            continue;
                        addMatch(`${rootPath}${sourceWithoutRoot}`);
                    }
                }
            }
            return sortByPreferredRoot(matches, preferredRootPath);
        };
        const resolveTruthParentLinkPath = (childLinkPath, parentLinkName, preferredRootPath = null) => {
            const parentName = String(parentLinkName || '').trim();
            if (!parentName)
                return null;
            const matches = [];
            const addMatch = (candidatePath) => {
                if (!candidatePath)
                    return;
                if (!linkPathSet.has(candidatePath))
                    return;
                if (matches.includes(candidatePath))
                    return;
                matches.push(candidatePath);
            };
            const normalizedChildLinkPath = normalizeUsdPathToken(String(childLinkPath || ''));
            let currentAncestorPath = normalizedChildLinkPath;
            while (currentAncestorPath) {
                const slashIndex = currentAncestorPath.lastIndexOf('/');
                if (slashIndex <= 0)
                    break;
                currentAncestorPath = currentAncestorPath.slice(0, slashIndex);
                if (getPathBasename(currentAncestorPath) === parentName) {
                    addMatch(currentAncestorPath);
                }
            }
            for (const candidatePath of runtimeLinkPathsByName.get(parentName) || []) {
                addMatch(candidatePath);
            }
            const fallbackRootPath = preferredRootPath || getRootPathFromPrimPath(normalizedChildLinkPath);
            if (parentName) {
                addMatch(fallbackRootPath ? `${fallbackRootPath}/${parentName}` : `/${parentName}`);
            }
            return sortByPreferredRoot(matches, preferredRootPath || fallbackRootPath)[0] || null;
        };
        const stageJointRecordByChildLinkPath = new Map();
        const stageLinkDynamicsRecordByLinkPath = new Map();
        const linkParentPathByChildLinkPath = new Map();
        const ingestStageJointRecords = (jointRecords) => {
            if (!Array.isArray(jointRecords) || jointRecords.length <= 0)
                return;
            const seenJointKeys = new Set();
            for (const jointRecord of jointRecords) {
                const body1Path = normalizeUsdPathToken(String(jointRecord?.body1Path || ''));
                if (!body1Path)
                    continue;
                const body0Path = normalizeUsdPathToken(String(jointRecord?.body0Path || '')) || null;
                const jointPath = normalizeUsdPathToken(String(jointRecord?.jointPath || jointRecord?.path || '')) || null;
                const fallbackJointName = jointPath ? getPathBasename(jointPath) : '';
                const jointName = String(jointRecord?.jointName || fallbackJointName || '').trim();
                const closedLoopId = String(jointRecord?.closedLoopId || jointName || fallbackJointName || '').trim();
                const closedLoopType = String(jointRecord?.closedLoopType || '').trim().toLowerCase();
                const jointTypeName = String(jointRecord?.jointTypeName || jointRecord?.jointType || '').trim();
                const jointType = normalizeStageJointType(jointTypeName);
                const axisToken = normalizeAxisToken(jointRecord?.axisToken || jointRecord?.axis || 'X');
                const limits = normalizeStageJointLimits(jointTypeName || jointType, Number(jointRecord?.lowerLimitDeg), Number(jointRecord?.upperLimitDeg));
                const localPos0 = jointRecord?.localPos0 && typeof jointRecord.localPos0.length === 'number'
                    ? normalizeVector3(jointRecord.localPos0, [0, 0, 0])
                    : null;
                const localRot0Wxyz = ((jointRecord?.localRot0Wxyz && typeof jointRecord.localRot0Wxyz.length === 'number')
                    ? normalizeQuaternionWxyz(jointRecord.localRot0Wxyz, [1, 0, 0, 0])
                    : (jointRecord?.localRot0 && typeof jointRecord.localRot0.length === 'number')
                        ? normalizeQuaternionWxyz(jointRecord.localRot0, [1, 0, 0, 0])
                        : null);
                const localPos1 = normalizeVector3(jointRecord?.localPos1 || [0, 0, 0], [0, 0, 0]);
                const localRot1Wxyz = normalizeQuaternionWxyz(jointRecord?.localRot1Wxyz || jointRecord?.localRot1 || [1, 0, 0, 0], [1, 0, 0, 0]);
                const originXyz = ((jointRecord?.originXyz && typeof jointRecord.originXyz.length === 'number')
                    ? jointRecord.originXyz
                    : localPos0
                        ? localPos0
                        : null);
                const originQuatWxyz = deriveJointOriginQuatWxyz(jointRecord);
                const normalizedOriginXyz = originXyz
                    ? normalizeVector3(originXyz, [0, 0, 0])
                    : null;
                const normalizedOriginQuatWxyz = originQuatWxyz
                    ? normalizeQuaternionWxyz(originQuatWxyz, [1, 0, 0, 0])
                    : null;
                const axisLocal = jointRecord?.axisLocal && typeof jointRecord.axisLocal.length === 'number'
                    ? normalizeVector3(jointRecord.axisLocal, rotateAxisByQuaternionWxyz(axisToken, localRot1Wxyz))
                    : rotateAxisByQuaternionWxyz(axisToken, localRot1Wxyz);
                const angleDeg = toFiniteNumber(jointRecord?.angleDeg);
                const driveDamping = toFiniteNumber(jointRecord?.driveDamping);
                const driveMaxForce = toFiniteNumber(jointRecord?.driveMaxForce);
                if (closedLoopType) {
                    const childCandidates = resolveRuntimeLinkPathsFromSourcePath(body1Path);
                    const exactChildPath = body1Path && linkPathSet.has(body1Path) ? body1Path : null;
                    const childLinkPath = exactChildPath || childCandidates[0] || null;
                    if (!childLinkPath)
                        continue;
                    const preferredRootPath = getRootPathFromPrimPath(childLinkPath);
                    const parentCandidates = resolveRuntimeLinkPathsFromSourcePath(body0Path, preferredRootPath);
                    const exactParentPath = body0Path && linkPathSet.has(body0Path) ? body0Path : null;
                    const parentLinkPath = exactParentPath || parentCandidates[0] || null;
                    if (!parentLinkPath)
                        continue;
                    const entryKey = `${closedLoopId || jointName || jointPath || ''}|${closedLoopType}`;
                    if (closedLoopConstraintKeySet.has(entryKey))
                        continue;
                    closedLoopConstraintKeySet.add(entryKey);
                    closedLoopConstraintEntries.push({
                        id: closedLoopId || jointName || null,
                        constraintType: closedLoopType,
                        linkAPath: parentLinkPath,
                        linkBPath: childLinkPath,
                        anchorWorld: jointRecord?.anchorWorld || null,
                        anchorLocalA: normalizedOriginXyz || [0, 0, 0],
                        anchorLocalB: localPos1,
                    });
                    continue;
                }
                const key = `${jointName}|${body0Path || ''}|${body1Path}`;
                if (seenJointKeys.has(key))
                    continue;
                seenJointKeys.add(key);
                const childLinkPaths = resolveRuntimeLinkPathsFromSourcePath(body1Path);
                for (const childLinkPath of childLinkPaths) {
                    if (!childLinkPath)
                        continue;
                    const preferredRootPath = getRootPathFromPrimPath(childLinkPath);
                    const parentCandidates = resolveRuntimeLinkPathsFromSourcePath(body0Path, preferredRootPath);
                    const parentLinkPath = parentCandidates[0] || null;
                    if (!linkParentPathByChildLinkPath.has(childLinkPath)) {
                        linkParentPathByChildLinkPath.set(childLinkPath, parentLinkPath);
                    }
                    if (stageJointRecordByChildLinkPath.has(childLinkPath))
                        continue;
                    stageJointRecordByChildLinkPath.set(childLinkPath, {
                        jointName,
                        jointPath,
                        jointTypeName,
                        jointType: jointType,
                        body0Path,
                        body1Path,
                        axisToken,
                        axisLocal,
                        lowerLimitDeg: limits.lower,
                        upperLimitDeg: limits.upper,
                        angleDeg: angleDeg ?? null,
                        driveDamping: driveDamping ?? null,
                        driveMaxForce: driveMaxForce ?? null,
                        originXyz: normalizedOriginXyz,
                        originQuatWxyz: normalizedOriginQuatWxyz,
                        localPos0,
                        localRot0Wxyz,
                        localPos1,
                        localRot1Wxyz,
                        parentLinkPath,
                    });
                }
            }
        };
        if (hasDriverPhysicsAccess) {
            const driverRecords = (() => {
                const activeDriver = typeof window !== 'undefined' ? window?.driver : null;
                if (!activeDriver) {
                    return { jointRecords: [], linkDynamicsRecords: [] };
                }
                let rawJointRecords = [];
                if (typeof activeDriver.GetPhysicsJointRecords === 'function') {
                    try {
                        rawJointRecords = activeDriver.GetPhysicsJointRecords();
                    }
                    catch {
                        registerMetadataErrorFlag('physics-joint-records-unavailable');
                        rawJointRecords = [];
                    }
                }
                let rawLinkDynamicsRecords = [];
                if (typeof activeDriver.GetPhysicsLinkDynamicsRecords === 'function') {
                    try {
                        rawLinkDynamicsRecords = activeDriver.GetPhysicsLinkDynamicsRecords();
                    }
                    catch {
                        registerMetadataErrorFlag('physics-link-dynamics-unavailable');
                        rawLinkDynamicsRecords = [];
                    }
                }
                const jointRecords = (rawJointRecords && typeof rawJointRecords.length === 'number'
                    ? Array.from(rawJointRecords)
                    : []);
                const linkDynamicsRecords = (rawLinkDynamicsRecords && typeof rawLinkDynamicsRecords.length === 'number'
                    ? Array.from(rawLinkDynamicsRecords)
                    : []);
                return { jointRecords, linkDynamicsRecords };
            })();
            ingestStageJointRecords(driverRecords.jointRecords);
            for (const dynamicsRecord of driverRecords.linkDynamicsRecords) {
                const linkPath = normalizeUsdPathToken(String(dynamicsRecord?.linkPath || ''));
                if (!linkPath)
                    continue;
                if (!linkPathSet.has(linkPath))
                    continue;
                const massValue = toFiniteNumber(dynamicsRecord?.mass);
                const hasAuthoredMassValue = Number.isFinite(Number(dynamicsRecord?.mass));
                const hasAuthoredCenterOfMass = hasAuthoredVector3(dynamicsRecord?.centerOfMassLocal);
                const centerOfMassLocal = hasAuthoredCenterOfMass
                    ? normalizeVector3(dynamicsRecord?.centerOfMassLocal, [0, 0, 0])
                    : null;
                const diagonalInertiaTuple = toFiniteVector3Tuple(dynamicsRecord?.diagonalInertia);
                const hasAuthoredDiagonalInertia = Array.isArray(diagonalInertiaTuple);
                const principalAxesLocalWxyz = hasAuthoredQuaternionWxyz(dynamicsRecord?.principalAxesLocalWxyz)
                    ? normalizeQuaternionWxyz(dynamicsRecord?.principalAxesLocalWxyz, [1, 0, 0, 0])
                    : null;
                const hasAuthoredPrincipalAxes = Array.isArray(principalAxesLocalWxyz);
                const hasAuthoredDynamicsData = (hasAuthoredMassValue
                    || hasAuthoredCenterOfMass
                    || hasAuthoredDiagonalInertia
                    || hasAuthoredPrincipalAxes);
                if (!hasAuthoredDynamicsData)
                    continue;
                stageLinkDynamicsRecordByLinkPath.set(linkPath, {
                    mass: hasAuthoredMassValue && massValue !== undefined ? Number(massValue) : null,
                    centerOfMassLocal,
                    diagonalInertia: hasAuthoredDiagonalInertia
                        ? normalizeVector3(diagonalInertiaTuple, [0, 0, 0])
                        : null,
                    principalAxesLocalWxyz,
                });
            }
        }
        if (metadataLayerTexts.length > 0) {
            for (const layerText of metadataLayerTexts) {
                ingestStageJointRecords(extractJointRecordsFromLayerText(layerText));
            }
        }
        const linkDynamicsPatchesByLinkPath = new Map();
        if (metadataLayerTexts.length > 0) {
            const mergePatch = (linkPath, incomingPatch) => {
                if (!linkPath || !incomingPatch || typeof incomingPatch !== 'object')
                    return;
                const existingPatch = linkDynamicsPatchesByLinkPath.get(linkPath) || {};
                const nextPatch = { ...existingPatch };
                if (incomingPatch.mass !== undefined && Number.isFinite(Number(incomingPatch.mass))) {
                    nextPatch.mass = Number(incomingPatch.mass);
                }
                if (Array.isArray(incomingPatch.centerOfMassLocal)) {
                    nextPatch.centerOfMassLocal = normalizeVector3(incomingPatch.centerOfMassLocal, [0, 0, 0]);
                }
                if (Array.isArray(incomingPatch.diagonalInertia)) {
                    nextPatch.diagonalInertia = normalizeVector3(incomingPatch.diagonalInertia, [0, 0, 0]);
                }
                if (Array.isArray(incomingPatch.principalAxesLocalWxyz)) {
                    nextPatch.principalAxesLocalWxyz = normalizeQuaternionWxyz(incomingPatch.principalAxesLocalWxyz, [1, 0, 0, 0]);
                }
                linkDynamicsPatchesByLinkPath.set(linkPath, nextPatch);
            };
            for (const layerText of metadataLayerTexts) {
                const parsedPatches = parseLinkDynamicsPatchesFromLayerText(layerText);
                for (const [linkPath, patch] of parsedPatches.entries()) {
                    mergePatch(linkPath, patch);
                }
            }
        }
        const linkDynamicsPatchesByLinkName = new Map();
        for (const [linkPath, patch] of linkDynamicsPatchesByLinkPath.entries()) {
            const linkName = getPathBasename(linkPath);
            if (!linkName)
                continue;
            if (!linkDynamicsPatchesByLinkName.has(linkName)) {
                linkDynamicsPatchesByLinkName.set(linkName, patch);
            }
        }
        const jointByChildLinkName = truth?.jointByChildLinkName;
        const inertialByLinkName = truth?.inertialByLinkName;
        const stage = shouldReadStageDataInJs ? getStageForMetadataFallback() : null;
        for (const linkPath of sortedLinkPaths) {
            const linkName = getPathBasename(linkPath);
            const rootPath = getRootPathFromPrimPath(linkPath);
            const stageJointEntry = stageJointRecordByChildLinkPath.get(linkPath) || null;
            const truthJointEntry = jointByChildLinkName?.get?.(linkName) || null;
            const jointEntry = stageJointEntry || truthJointEntry || null;
            if (jointEntry) {
                const isUrdfJointEntry = !stageJointEntry && !!truthJointEntry;
                const stageAxisToken = normalizeAxisToken(jointEntry.axisToken || 'X');
                const fallbackAxisLocal = rotateAxisByQuaternionWxyz(stageAxisToken, jointEntry.localRot1Wxyz);
                const resolvedAxisLocal = jointEntry.axisLocal && typeof jointEntry.axisLocal.length === 'number'
                    ? normalizeVector3(jointEntry.axisLocal, isUrdfJointEntry ? [1, 0, 0] : fallbackAxisLocal)
                    : (isUrdfJointEntry ? normalizeVector3(jointEntry.axisLocal, [1, 0, 0]) : fallbackAxisLocal);
                const axisToken = isUrdfJointEntry ? axisTokenFromAxis(resolvedAxisLocal) : stageAxisToken;
                const jointName = String(jointEntry.jointName || `${linkName}_joint`).trim() || `${linkName}_joint`;
                const stageParentCandidates = resolveRuntimeLinkPathsFromSourcePath(jointEntry.body0Path, rootPath);
                const parentLinkName = String(jointEntry.parentLinkName || '').trim();
                const truthParentLinkPath = resolveTruthParentLinkPath(linkPath, parentLinkName, rootPath);
                const parentLinkPath = linkParentPathByChildLinkPath.get(linkPath)
                    || stageParentCandidates[0]
                    || truthParentLinkPath
                    || (parentLinkName ? (rootPath ? `${rootPath}/${parentLinkName}` : `/${parentLinkName}`) : null);
                if (!linkParentPathByChildLinkPath.has(linkPath)) {
                    linkParentPathByChildLinkPath.set(linkPath, parentLinkPath || null);
                }
                const jointTypeName = String(jointEntry.jointTypeName || jointEntry.jointType || '').trim();
                const jointType = normalizeStageJointType(jointTypeName);
                const limits = normalizeStageJointLimits(jointTypeName || jointType, Number(jointEntry.lowerLimitDeg), Number(jointEntry.upperLimitDeg));
                const localPivotInLink = jointEntry.localPos1 && typeof jointEntry.localPos1.length === 'number'
                    ? normalizeVector3(jointEntry.localPos1, [0, 0, 0])
                    : null;
                const localPos0 = jointEntry.localPos0 && typeof jointEntry.localPos0.length === 'number'
                    ? normalizeVector3(jointEntry.localPos0, [0, 0, 0])
                    : null;
                const localRot0Wxyz = jointEntry.localRot0Wxyz && typeof jointEntry.localRot0Wxyz.length === 'number'
                    ? normalizeQuaternionWxyz(jointEntry.localRot0Wxyz, [1, 0, 0, 0])
                    : null;
                const localRot1Wxyz = jointEntry.localRot1Wxyz && typeof jointEntry.localRot1Wxyz.length === 'number'
                    ? normalizeQuaternionWxyz(jointEntry.localRot1Wxyz, [1, 0, 0, 0])
                    : null;
                const originXyz = jointEntry.originXyz && typeof jointEntry.originXyz.length === 'number'
                    ? normalizeVector3(jointEntry.originXyz, [0, 0, 0])
                    : null;
                const originQuatWxyz = jointEntry.originQuatWxyz && typeof jointEntry.originQuatWxyz.length === 'number'
                    ? normalizeQuaternionWxyz(jointEntry.originQuatWxyz, [1, 0, 0, 0])
                    : null;
                const angleDeg = toFiniteNumber(jointEntry.angleDeg);
                const driveDamping = toFiniteNumber(jointEntry.driveDamping);
                const driveMaxForce = toFiniteNumber(jointEntry.driveMaxForce);
                jointCatalogEntries.push({
                    linkPath,
                    jointPath: rootPath ? `${rootPath}/joints/${jointName}` : `/joints/${jointName}`,
                    jointName,
                    jointType: jointType,
                    jointTypeName: jointTypeName || null,
                    parentLinkPath,
                    axisToken,
                    axisLocal: resolvedAxisLocal,
                    lowerLimitDeg: limits.lower,
                    upperLimitDeg: limits.upper,
                    angleDeg: angleDeg ?? null,
                    driveDamping: driveDamping ?? null,
                    driveMaxForce: driveMaxForce ?? null,
                    localPos0,
                    localRot0Wxyz,
                    localPivotInLink,
                    localPos1: localPivotInLink,
                    localRot1Wxyz,
                    originXyz,
                    originQuatWxyz,
                });
            }
            const inertialEntry = inertialByLinkName?.get?.(linkName) || null;
            if (inertialEntry || stage) {
                const stageDynamicsRecord = stageLinkDynamicsRecordByLinkPath.get(linkPath) || null;
                const prim = safeGetPrimAtPath(stage, linkPath);
                const stagePatch = linkDynamicsPatchesByLinkPath.get(linkPath) || linkDynamicsPatchesByLinkName.get(linkName) || null;
                const massValueFromPrim = toFiniteNumber(safeGetPrimAttribute(prim, 'physics:mass'));
                const truthMassValue = Number.isFinite(Number(inertialEntry?.mass))
                    ? Number(inertialEntry.mass)
                    : null;
                const hasStageMassValue = (stageDynamicsRecord?.mass !== null && Number.isFinite(Number(stageDynamicsRecord?.mass)))
                    || massValueFromPrim !== undefined
                    || Number.isFinite(Number(stagePatch?.mass));
                const stageMassValue = stageDynamicsRecord?.mass !== null && Number.isFinite(Number(stageDynamicsRecord?.mass))
                    ? Number(stageDynamicsRecord.mass)
                    : (massValueFromPrim !== undefined ? Number(massValueFromPrim) : (Number.isFinite(Number(stagePatch?.mass)) ? Number(stagePatch.mass) : null));
                const centerOfMassTupleFromPrim = toFiniteVector3Tuple(safeGetPrimAttribute(prim, 'physics:centerOfMass'));
                const diagonalInertiaTupleFromPrim = toFiniteVector3Tuple(safeGetPrimAttribute(prim, 'physics:diagonalInertia'));
                const principalAxesTupleFromPrim = toFiniteQuaternionWxyzTuple(safeGetPrimAttribute(prim, 'physics:principalAxes'));
                const hasStageCenterOfMassValue = hasAuthoredVector3(stageDynamicsRecord?.centerOfMassLocal)
                    || Array.isArray(centerOfMassTupleFromPrim)
                    || hasAuthoredVector3(stagePatch?.centerOfMassLocal);
                const hasStageDiagonalInertiaValue = Array.isArray(stageDynamicsRecord?.diagonalInertia)
                    || Array.isArray(diagonalInertiaTupleFromPrim)
                    || hasAuthoredVector3(stagePatch?.diagonalInertia);
                const hasStagePrincipalAxesValue = hasAuthoredQuaternionWxyz(stageDynamicsRecord?.principalAxesLocalWxyz)
                    || Array.isArray(principalAxesTupleFromPrim)
                    || hasAuthoredQuaternionWxyz(stagePatch?.principalAxesLocalWxyz);
                const hasAuthoredDynamicsData = Boolean(inertialEntry)
                    || hasStageMassValue
                    || hasStageCenterOfMassValue
                    || hasStageDiagonalInertiaValue
                    || hasStagePrincipalAxesValue;
                const stageCenterOfMassSource = stageDynamicsRecord?.centerOfMassLocal || centerOfMassTupleFromPrim || stagePatch?.centerOfMassLocal || null;
                const stageDiagonalInertiaSource = stageDynamicsRecord?.diagonalInertia || diagonalInertiaTupleFromPrim || stagePatch?.diagonalInertia || null;
                const stagePrincipalAxesSource = stageDynamicsRecord?.principalAxesLocalWxyz || principalAxesTupleFromPrim || stagePatch?.principalAxesLocalWxyz || null;
                const massValue = stageMassValue ?? truthMassValue;
                const centerOfMassLocal = stageCenterOfMassSource
                    ? normalizeVector3(stageCenterOfMassSource, [0, 0, 0])
                    : (inertialEntry ? normalizeVector3(inertialEntry.centerOfMassLocal, [0, 0, 0]) : [0, 0, 0]);
                const diagonalInertia = Array.isArray(stageDiagonalInertiaSource)
                    ? normalizeVector3(stageDiagonalInertiaSource, [0, 0, 0])
                    : (inertialEntry && Array.isArray(inertialEntry.diagonalInertia)
                        ? normalizeVector3(inertialEntry.diagonalInertia, [0, 0, 0])
                        : null);
                const principalAxesWxyz = stagePrincipalAxesSource
                    ? normalizeQuaternionWxyz(stagePrincipalAxesSource, [1, 0, 0, 0])
                    : (inertialEntry
                        ? normalizeQuaternionWxyz(inertialEntry.principalAxesLocalWxyz, [1, 0, 0, 0])
                        : [1, 0, 0, 0]);
                const hasDynamicsData = (hasSignificantMassValue(massValue)
                    || hasSignificantVector3(centerOfMassLocal)
                    || hasSignificantVector3(diagonalInertia)
                    || hasNonIdentityQuaternionWxyz(principalAxesWxyz));
                if (!hasAuthoredDynamicsData && !hasDynamicsData) {
                    continue;
                }
                linkDynamicsEntries.push({
                    linkPath,
                    mass: massValue,
                    centerOfMassLocal,
                    diagonalInertia,
                    principalAxesLocal: [principalAxesWxyz[1], principalAxesWxyz[2], principalAxesWxyz[3], principalAxesWxyz[0]],
                });
            }
        }
        const linkParentPairs = Array.from(linkParentPathByChildLinkPath.entries())
            .filter(([childLinkPath]) => !!childLinkPath)
            .map(([childLinkPath, parentLinkPath]) => [childLinkPath, parentLinkPath || null]);
        linkParentPairs.sort((left, right) => String(left[0] || '').localeCompare(String(right[0] || '')));
        let metadataSource = 'mesh-only';
        if (truth) {
            metadataSource = 'urdf-truth';
        }
        else if (
            jointCatalogEntries.length > 0
            || linkDynamicsEntries.length > 0
            || linkParentPairs.length > 0
            || closedLoopConstraintEntries.length > 0
            || syntheticSemanticChildParentPathByChildLinkPath.size > 0
        ) {
            metadataSource = 'usd-stage';
        }
        const snapshot = mergeSyntheticSemanticChildLinkMetadata({
            stageSourcePath: normalizedStagePath,
            generatedAtMs: this._nowPerfMs(),
            source: metadataSource,
            linkParentPairs,
            jointCatalogEntries,
            linkDynamicsEntries,
            closedLoopConstraintEntries,
            meshCountsByLinkPath,
        });
        const truthLoadError = (!truth)
            ? (String(this._urdfTruthLoadErrorByStageSource?.get?.(normalizedStagePath) || '').trim() || null)
            : null;
        const annotationErrorFlags = Array.from(metadataErrorFlags);
        if (truthLoadError) {
            annotationErrorFlags.push('urdf-truth-load-failed');
        }
        const annotatedSnapshot = this.applyRobotMetadataErrorAnnotations(snapshot, {
            errorFlags: annotationErrorFlags,
            truthLoadError,
        });
        if (normalizedStagePath && this._robotMetadataSnapshotByStageSource?.set) {
            this._robotMetadataSnapshotByStageSource.set(normalizedStagePath, annotatedSnapshot);
        }
        return annotatedSnapshot;
    }
    startRobotMetadataWarmupForStage(stageSourcePathOrOptions = null, maybeOptions = null) {
        let stageSourcePath = null;
        let options = {};
        if (typeof stageSourcePathOrOptions === 'string') {
            stageSourcePath = stageSourcePathOrOptions;
            options = (maybeOptions && typeof maybeOptions === 'object') ? maybeOptions : {};
        }
        else {
            options = (stageSourcePathOrOptions && typeof stageSourcePathOrOptions === 'object')
                ? stageSourcePathOrOptions
                : {};
        }
        const force = options?.force === true;
        const skipIdleWait = options?.skipIdleWait === true;
        const skipUrdfTruthFallback = options?.skipUrdfTruthFallback === true;
        const normalizedStagePath = String(stageSourcePath || this.getNormalizedStageSourcePath() || '').trim().split('?')[0];
        if (!normalizedStagePath)
            return Promise.resolve(null);
        if (!force && this._robotMetadataSnapshotByStageSource.has(normalizedStagePath)) {
            const cachedSnapshot = this._robotMetadataSnapshotByStageSource.get(normalizedStagePath) || null;
            const hasCachedMetadata = (Array.isArray(cachedSnapshot?.jointCatalogEntries) && cachedSnapshot.jointCatalogEntries.length > 0)
                || (Array.isArray(cachedSnapshot?.linkDynamicsEntries) && cachedSnapshot.linkDynamicsEntries.length > 0)
                || (Array.isArray(cachedSnapshot?.linkParentPairs) && cachedSnapshot.linkParentPairs.length > 0)
                || (Array.isArray(cachedSnapshot?.closedLoopConstraintEntries) && cachedSnapshot.closedLoopConstraintEntries.length > 0);
            if (hasCachedMetadata) {
                return Promise.resolve(cachedSnapshot);
            }
        }
        if (this._robotMetadataBuildPromisesByStageSource.has(normalizedStagePath)) {
            return this._robotMetadataBuildPromisesByStageSource.get(normalizedStagePath);
        }
        const waitForIdleSlice = async (options = {}) => {
            const minBudgetMs = Math.max(0, Number(options?.minBudgetMs ?? 6));
            const maxPasses = Math.max(1, Math.floor(Number(options?.maxPasses ?? 6)));
            const timeoutMs = Math.max(0, Math.floor(Number(options?.timeoutMs ?? 360)));
            await new Promise((resolve) => {
                try {
                    globalThis.setTimeout(resolve, 0);
                }
                catch {
                    resolve();
                }
            });
            const requestIdle = globalThis.requestIdleCallback;
            if (typeof requestIdle !== 'function')
                return;
            for (let pass = 0; pass < maxPasses; pass += 1) {
                const hasBudget = await new Promise((resolve) => {
                    let done = false;
                    const finish = (value) => {
                        if (done)
                            return;
                        done = true;
                        resolve(value);
                    };
                    try {
                        requestIdle((deadline) => {
                            const remaining = Number(deadline?.timeRemaining?.() || 0);
                            const timedOut = deadline?.didTimeout === true;
                            finish(timedOut || remaining >= minBudgetMs);
                        }, { timeout: timeoutMs });
                    }
                    catch {
                        finish(true);
                        return;
                    }
                    try {
                        globalThis.setTimeout(() => finish(true), timeoutMs + 120);
                    }
                    catch { }
                });
                if (hasBudget)
                    return;
                await new Promise((resolve) => {
                    try {
                        globalThis.setTimeout(resolve, 0);
                    }
                    catch {
                        resolve();
                    }
                });
            }
        };
        const buildPromise = Promise.resolve()
            .then(async () => {
            if (!skipIdleWait) {
                await waitForIdleSlice({ minBudgetMs: 6, maxPasses: 8, timeoutMs: 360 });
            }
            let snapshot = this.buildRobotMetadataSnapshotForStage(normalizedStagePath, null);
            const needsUrdfTruth = (!skipUrdfTruthFallback
                && this.shouldAllowUrdfHttpFallback()
                && (!snapshot
                    || ((!Array.isArray(snapshot.jointCatalogEntries) || snapshot.jointCatalogEntries.length <= 0)
                        && (!Array.isArray(snapshot.linkDynamicsEntries) || snapshot.linkDynamicsEntries.length <= 0))));
            let truthLoadError = null;
            if (needsUrdfTruth) {
                const truthPromise = this.startUrdfTruthLoadForStage(normalizedStagePath);
                const truth = truthPromise ? await truthPromise.catch((error) => {
                    rawConsoleWarn?.('[HydraDelegate] Failed to load URDF truth snapshot; continuing without URDF fallback context.', error);
                    truthLoadError = String(error?.message || error || '').trim() || 'urdf-truth-load-failed';
                    return null;
                }) : null;
                const cachedTruthLoadError = String(this._urdfTruthLoadErrorByStageSource?.get?.(normalizedStagePath) || '').trim();
                if (!truthLoadError && cachedTruthLoadError) {
                    truthLoadError = cachedTruthLoadError;
                }
                if (!skipIdleWait) {
                    await waitForIdleSlice({ minBudgetMs: 4, maxPasses: 6, timeoutMs: 420 });
                }
                snapshot = this.buildRobotMetadataSnapshotForStage(normalizedStagePath, truth || null);
                if (truthLoadError) {
                    snapshot = this.applyRobotMetadataErrorAnnotations(snapshot, {
                        stale: true,
                        errorFlags: ['urdf-truth-load-failed'],
                        truthLoadError,
                    });
                }
            }
            if (!snapshot)
                return null;
            this._robotMetadataSnapshotByStageSource.set(normalizedStagePath, snapshot);
            const cachedSceneSnapshot = this._robotSceneSnapshotByStageSource.get(normalizedStagePath);
            if (cachedSceneSnapshot && typeof cachedSceneSnapshot === 'object') {
                const nextSceneSnapshot = {
                    ...cachedSceneSnapshot,
                    robotTree: {
                        ...(cachedSceneSnapshot.robotTree && typeof cachedSceneSnapshot.robotTree === 'object'
                            ? cachedSceneSnapshot.robotTree
                            : {}),
                        linkParentPairs: Array.isArray(snapshot.linkParentPairs)
                            ? snapshot.linkParentPairs
                            : [],
                        jointCatalogEntries: Array.isArray(snapshot.jointCatalogEntries)
                            ? snapshot.jointCatalogEntries
                            : [],
                    },
                    physics: {
                        ...(cachedSceneSnapshot.physics && typeof cachedSceneSnapshot.physics === 'object'
                            ? cachedSceneSnapshot.physics
                            : {}),
                        linkDynamicsEntries: Array.isArray(snapshot.linkDynamicsEntries)
                            ? snapshot.linkDynamicsEntries
                            : [],
                    },
                    robotMetadataSnapshot: snapshot,
                };
                this._robotSceneSnapshotByStageSource.set(normalizedStagePath, nextSceneSnapshot);
                this.emitRobotSceneSnapshotReady(nextSceneSnapshot);
            }
            this.emitRobotMetadataSnapshotReady(snapshot);
            return snapshot;
        })
            .finally(() => {
            this._robotMetadataBuildPromisesByStageSource.delete(normalizedStagePath);
        });
        this._robotMetadataBuildPromisesByStageSource.set(normalizedStagePath, buildPromise);
        return buildPromise;
    }
    async prefetchUrdfTruthForStage() {
        const stageSourcePath = this.getNormalizedStageSourcePath();
        if (!stageSourcePath)
            return null;
        const loadPromise = this.startUrdfTruthLoadForStage(stageSourcePath);
        if (!loadPromise)
            return null;
        try {
            return await loadPromise;
        }
        catch (error) {
            rawConsoleWarn?.('[HydraDelegate] URDF truth prefetch failed; continuing without prefetched truth data.', error);
            return null;
        }
    }
    startUrdfTruthLoadForStage(stageSourcePath) {
        const normalizedStagePath = String(stageSourcePath || '').trim().split('?')[0];
        if (!normalizedStagePath)
            return null;
        if (!this.shouldAllowUrdfHttpFallback()) {
            this._urdfTruthByStageSource.set(normalizedStagePath, null);
            this._urdfTruthLoadErrorByStageSource?.delete?.(normalizedStagePath);
            return Promise.resolve(null);
        }
        if (this._urdfTruthByStageSource.has(normalizedStagePath)) {
            return Promise.resolve(this._urdfTruthByStageSource.get(normalizedStagePath) || null);
        }
        if (this._urdfTruthLoadPromisesByStageSource.has(normalizedStagePath)) {
            return this._urdfTruthLoadPromisesByStageSource.get(normalizedStagePath);
        }
        const urdfFileName = resolveUrdfTruthFileNameForStagePath(normalizedStagePath);
        if (!urdfFileName) {
            this._urdfTruthByStageSource.set(normalizedStagePath, null);
            this._urdfTruthLoadErrorByStageSource?.delete?.(normalizedStagePath);
            return Promise.resolve(null);
        }
        this._urdfTruthLoadErrorByStageSource?.delete?.(normalizedStagePath);
        const loadPromise = fetch(`/urdf/${encodeURIComponent(urdfFileName)}`)
            .then(async (response) => {
            if (!response.ok) {
                throw new Error(`urdf-truth-fetch-http-${Number(response.status) || 0}`);
            }
            const text = await response.text();
            const truth = parseUrdfTruthFromText(text);
            if (!truth) {
                throw new Error('urdf-truth-parse-empty');
            }
            return truth;
        })
            .catch((error) => {
            rawConsoleWarn?.(`[HydraDelegate] Failed to fetch URDF truth file "${urdfFileName}" for stage "${normalizedStagePath}".`, error);
            const truthLoadError = String(error?.message || error || '').trim() || 'urdf-truth-load-failed';
            this._urdfTruthLoadErrorByStageSource?.set?.(normalizedStagePath, truthLoadError);
            return null;
        })
            .then((truth) => {
            this._urdfTruthByStageSource.set(normalizedStagePath, truth || null);
            if (truth) {
                this._urdfTruthLoadErrorByStageSource?.delete?.(normalizedStagePath);
            }
            return truth || null;
        })
            .finally(() => {
            this._urdfTruthLoadPromisesByStageSource.delete(normalizedStagePath);
        });
        this._urdfTruthLoadPromisesByStageSource.set(normalizedStagePath, loadPromise);
        return loadPromise;
    }
    getUrdfTruthForCurrentStage() {
        const stageSourcePath = this.getNormalizedStageSourcePath();
        if (!stageSourcePath)
            return null;
        if (this._urdfTruthByStageSource.has(stageSourcePath)) {
            return this._urdfTruthByStageSource.get(stageSourcePath) || null;
        }
        this.startUrdfTruthLoadForStage(stageSourcePath);
        return null;
    }
    getUrdfJointEntryForPrimPath(primPath) {
        const truth = this.getUrdfTruthForCurrentStage();
        if (!truth?.jointByChildLinkName)
            return null;
        const linkName = getPathBasename(primPath);
        if (!linkName)
            return null;
        return truth.jointByChildLinkName.get(linkName) || null;
    }
    getUrdfTruthLinkContextForMeshId(meshId, sectionName) {
        const normalizedSectionName = String(sectionName || '').trim().toLowerCase();
        if (normalizedSectionName !== 'visuals' && normalizedSectionName !== 'collisions')
            return null;
        const proto = parseProtoMeshIdentifier(meshId);
        if (!proto || proto.sectionName !== normalizedSectionName)
            return null;
        const truth = this.getUrdfTruthForCurrentStage();
        const truthLinkMap = normalizedSectionName === 'visuals'
            ? truth?.visualsByLinkName
            : truth?.collisionsByLinkName;
        const resolvedPrimPath = normalizedSectionName === 'visuals'
            ? this.getResolvedVisualTransformPrimPathForMeshId?.(meshId)
            : this.getResolvedPrimPathForMeshId?.(meshId);
        const semanticTarget = resolveSemanticChildLinkTargetFromResolvedPrimPath({
            owningLinkPath: proto.linkPath,
            resolvedPrimPath,
            sectionName: normalizedSectionName,
            validLinkNames: truthLinkMap,
        });
        return {
            proto,
            ownerLinkPath: proto.linkPath,
            effectiveLinkName: semanticTarget?.linkName || getPathBasename(proto.linkPath),
            effectiveLinkPath: semanticTarget?.linkPath || proto.linkPath,
            resolvedPrimPath: resolvedPrimPath || null,
        };
    }
    getVisualLinkFrameTransform(linkPath) {
        if (!linkPath || !linkPath.startsWith('/'))
            return null;
        const primaryVisualMeshMatrix = this.meshes?.[`${linkPath}/visuals.proto_mesh_id0`]?._mesh?.matrix || null;
        if (primaryVisualMeshMatrix)
            return primaryVisualMeshMatrix.clone();
        const representativeVisualMatrix = this.getRepresentativeVisualTransformForLinkPath(linkPath) || null;
        return representativeVisualMatrix ? representativeVisualMatrix.clone() : null;
    }
    getStageOrVisualLinkWorldTransform(linkPath) {
        if (!linkPath || !linkPath.startsWith('/'))
            return null;
        const stageWorldMatrix = this.getWorldTransformForPrimPath(linkPath) || null;
        const visualLinkFrameMatrix = this.getVisualLinkFrameTransform(linkPath) || null;
        if (!stageWorldMatrix)
            return visualLinkFrameMatrix ? visualLinkFrameMatrix.clone() : null;
        if (!visualLinkFrameMatrix)
            return stageWorldMatrix.clone();
        return stageWorldMatrix.clone();
    }
    getPreferredLinkWorldTransform(linkPath) {
        if (!linkPath || !linkPath.startsWith('/'))
            return null;
        return this.getStageOrVisualLinkWorldTransform(linkPath);
    }
    getUrdfLinkWorldTransformFromJointChain(linkPath) {
        if (!linkPath || !linkPath.startsWith('/'))
            return null;
        const stageSourcePath = this.getNormalizedStageSourcePath() || '__unknown_stage__';
        let stageCache = this._urdfLinkWorldTransformCacheByStageSource.get(stageSourcePath);
        if (!(stageCache instanceof Map)) {
            stageCache = new Map();
            this._urdfLinkWorldTransformCacheByStageSource.set(stageSourcePath, stageCache);
        }
        if (stageCache.has(linkPath)) {
            const cached = stageCache.get(linkPath);
            return cached ? cached.clone() : null;
        }
        const truth = this.getUrdfTruthForCurrentStage();
        if (!truth?.jointByChildLinkName) {
            return null;
        }
        const linkName = getPathBasename(linkPath);
        if (!linkName) {
            stageCache.set(linkPath, null);
            return null;
        }
        const urdfRelativeMatrix = new Matrix4().identity();
        let currentLinkName = linkName;
        let traversedJointCount = 0;
        const visitedLinks = new Set();
        while (currentLinkName && !visitedLinks.has(currentLinkName)) {
            visitedLinks.add(currentLinkName);
            const jointEntry = truth.jointByChildLinkName.get(currentLinkName);
            if (!jointEntry) {
                break;
            }
            let jointLocalMatrix = jointEntry.localMatrix || null;
            if (!jointLocalMatrix && jointEntry.originXyz && jointEntry.originQuatWxyz) {
                jointLocalMatrix = toMatrixFromUrdfOrigin(jointEntry.originXyz, jointEntry.originQuatWxyz);
            }
            if (jointLocalMatrix) {
                urdfRelativeMatrix.premultiply(jointLocalMatrix);
            }
            traversedJointCount += 1;
            const parentLinkName = String(jointEntry.parentLinkName || '').trim();
            if (!parentLinkName) {
                break;
            }
            currentLinkName = parentLinkName;
        }
        const rootLinkName = currentLinkName;
        const slashIndex = linkPath.lastIndexOf('/');
        const linkParentPath = slashIndex > 0 ? linkPath.slice(0, slashIndex) : '';
        let rootLinkStageMatrix = null;
        if (rootLinkName) {
            const rootLinkPathFromParent = linkParentPath ? `${linkParentPath}/${rootLinkName}` : '';
            const stageRootPath = getRootPathFromPrimPath(linkPath);
            const rootLinkPathFromStageRoot = stageRootPath ? `${stageRootPath}/${rootLinkName}` : '';
            const rootPathCandidates = [
                rootLinkPathFromParent,
                rootLinkPathFromStageRoot,
            ].filter((candidatePath, candidateIndex, allCandidates) => {
                return !!candidatePath && allCandidates.indexOf(candidatePath) === candidateIndex;
            });
            for (const candidatePath of rootPathCandidates) {
                rootLinkStageMatrix = this.getStageOrVisualLinkWorldTransform(candidatePath);
                if (rootLinkStageMatrix) {
                    break;
                }
            }
        }
        let result = null;
        if (rootLinkStageMatrix) {
            result = rootLinkStageMatrix.clone().multiply(urdfRelativeMatrix);
        }
        else if (traversedJointCount > 0) {
            result = urdfRelativeMatrix.clone();
        }
        stageCache.set(linkPath, result ? result.clone() : null);
        return result ? result.clone() : null;
    }
    getUrdfCollisionEntryForMeshId(meshId, linkContext = null) {
        const truth = this.getUrdfTruthForCurrentStage();
        if (!truth?.collisionsByLinkName)
            return null;
        const context = linkContext || this.getUrdfTruthLinkContextForMeshId(meshId, 'collisions');
        const proto = context?.proto || null;
        if (!proto)
            return null;
        const linkCollisions = truth.collisionsByLinkName.get(context.effectiveLinkName);
        if (!linkCollisions)
            return null;
        const geometryType = proto.protoType === 'box' ? 'box' : proto.protoType;
        const typedEntries = linkCollisions.byType?.get(geometryType) || [];
        if (typedEntries[proto.protoIndex])
            return typedEntries[proto.protoIndex];
        // Keep URDF fallback strict by proto index/type. If USD expands a link into
        // multiple collider prototypes while URDF only exposes one collider entry,
        // reusing index 0 for all prototypes causes stacked/overlapping colliders.
        if (proto.protoIndex === 0) {
            if (typedEntries.length === 1)
                return typedEntries[0];
            if (typedEntries.length === 0 && linkCollisions.all?.length === 1)
                return linkCollisions.all[0];
        }
        return null;
    }
    getCollisionPrimitiveGeometryOverride(meshId) {
        const proto = parseProtoMeshIdentifier(meshId);
        if (!proto || proto.sectionName !== 'collisions')
            return null;
        const snapshot = this.getCachedRobotMetadataSnapshot();
        const counts = snapshot?.meshCountsByLinkPath?.[proto.linkPath];
        const geometries = Array.isArray(counts?.collisionPrimitiveGeometries)
            ? counts.collisionPrimitiveGeometries
            : [];
        const expectedType = proto.protoType === 'box' ? 'cube' : String(proto.protoType || '').toLowerCase();
        const typedGeometries = geometries.filter((geometry) => {
            const geometryType = String(geometry?.primitiveType || '').toLowerCase();
            const normalizedType = geometryType === 'box' ? 'cube' : geometryType;
            return normalizedType === expectedType;
        });
        const geometry = typedGeometries[proto.protoIndex] || null;
        const dimensions = Array.isArray(geometry?.dimensions)
            ? geometry.dimensions.map((value) => Math.abs(Number(value)))
            : null;
        if (!dimensions || dimensions.length < 3 || dimensions.some((value) => !Number.isFinite(value)))
            return null;
        if (expectedType === 'cube') {
            return { extentSize: dimensions.slice(0, 3) };
        }
        if (expectedType === 'sphere') {
            return { radius: Math.max(...dimensions.slice(0, 3)) * 0.5 };
        }
        if (expectedType === 'cylinder' || expectedType === 'capsule') {
            return {
                radius: Math.max(dimensions[0], dimensions[1]) * 0.5,
                height: dimensions[2],
                axis: 'Z',
            };
        }
        return null;
    }
    getUrdfVisualEntryForMeshId(meshId, linkContext = null) {
        const truth = this.getUrdfTruthForCurrentStage();
        if (!truth?.visualsByLinkName)
            return null;
        const context = linkContext || this.getUrdfTruthLinkContextForMeshId(meshId, 'visuals');
        const proto = context?.proto || null;
        if (!proto)
            return null;
        const linkVisuals = truth.visualsByLinkName.get(context.effectiveLinkName);
        if (!Array.isArray(linkVisuals) || linkVisuals.length === 0)
            return null;
        if (linkVisuals[proto.protoIndex])
            return linkVisuals[proto.protoIndex];
        if (proto.protoIndex === 0 && linkVisuals.length === 1)
            return linkVisuals[0];
        return null;
    }
    getCollisionWorldTransformFromUrdfTruth(meshId) {
        const linkContext = this.getUrdfTruthLinkContextForMeshId(meshId, 'collisions');
        const collisionEntry = this.getUrdfCollisionEntryForMeshId(meshId, linkContext);
        if (!collisionEntry?.localMatrix)
            return null;
        const effectiveLinkPath = linkContext?.effectiveLinkPath || linkContext?.ownerLinkPath || null;
        if (!effectiveLinkPath)
            return null;
        const linkWorldMatrix = this.getUrdfLinkWorldTransformFromJointChain(effectiveLinkPath)
            || this.getPreferredLinkWorldTransform(effectiveLinkPath)
            || this.getPreferredLinkWorldTransform(linkContext?.ownerLinkPath)
            || null;
        if (!linkWorldMatrix)
            return null;
        const linkPosition = new Vector3();
        const linkQuaternion = new Quaternion();
        const linkScale = new Vector3();
        linkWorldMatrix.decompose(linkPosition, linkQuaternion, linkScale);
        const linkRigidMatrix = new Matrix4().compose(linkPosition, linkQuaternion, new Vector3(1, 1, 1));
        const urdfWorldMatrix = linkRigidMatrix.multiply(collisionEntry.localMatrix);
        const resolvedCollisionPrimPath = linkContext?.resolvedPrimPath || this.getResolvedPrimPathForMeshId(meshId);
        if (!resolvedCollisionPrimPath) {
            return urdfWorldMatrix;
        }
        const resolvedCollisionWorldMatrix = this.getWorldTransformForPrimPath(resolvedCollisionPrimPath);
        if (!resolvedCollisionWorldMatrix) {
            return urdfWorldMatrix;
        }
        const urdfPosition = new Vector3();
        const urdfQuaternion = new Quaternion();
        const urdfScale = new Vector3();
        urdfWorldMatrix.decompose(urdfPosition, urdfQuaternion, urdfScale);
        const resolvedScale = new Vector3();
        resolvedCollisionWorldMatrix.decompose(new Vector3(), new Quaternion(), resolvedScale);
        const epsilon = 1e-8;
        const resolveScaleComponent = (candidateValue, fallbackValue) => {
            if (Number.isFinite(candidateValue) && Math.abs(candidateValue) > epsilon) {
                return candidateValue;
            }
            if (Number.isFinite(fallbackValue) && Math.abs(fallbackValue) > epsilon) {
                return fallbackValue;
            }
            return 1;
        };
        const mergedScale = new Vector3(resolveScaleComponent(resolvedScale.x, urdfScale.x), resolveScaleComponent(resolvedScale.y, urdfScale.y), resolveScaleComponent(resolvedScale.z, urdfScale.z));
        return new Matrix4().compose(urdfPosition, urdfQuaternion, mergedScale);
    }
    getVisualWorldTransformFromUrdfTruth(meshId) {
        if (!this.shouldUseUrdfVisualFallbackForMesh(meshId))
            return null;
        const linkContext = this.getUrdfTruthLinkContextForMeshId(meshId, 'visuals');
        const proto = linkContext?.proto || null;
        if (!proto?.linkPath)
            return null;
        const visualEntry = this.getUrdfVisualEntryForMeshId(meshId, linkContext);
        const resolvedVisualPrimPath = linkContext?.resolvedPrimPath || this.getResolvedVisualTransformPrimPathForMeshId(meshId);
        const resolvedVisualWorldMatrix = resolvedVisualPrimPath
            ? this.getWorldTransformForPrimPath(resolvedVisualPrimPath)
            : null;
        const stageOwnerLinkWorldMatrix = this.getPreferredLinkWorldTransform(linkContext.ownerLinkPath);
        const linkWorldMatrix = this.getUrdfLinkWorldTransformFromJointChain(linkContext.effectiveLinkPath)
            || this.getPreferredLinkWorldTransform(linkContext.effectiveLinkPath)
            || stageOwnerLinkWorldMatrix
            || null;
        if (!linkWorldMatrix)
            return null;
        const deriveLocalVisualMatrix = (parentWorldMatrix, childWorldMatrix) => {
            if (!parentWorldMatrix || !childWorldMatrix)
                return null;
            const inverseParentWorldMatrix = parentWorldMatrix.clone().invert();
            return inverseParentWorldMatrix.multiply(childWorldMatrix.clone());
        };
        const resolvedVisualLocalMatrix = deriveLocalVisualMatrix(stageOwnerLinkWorldMatrix, resolvedVisualWorldMatrix);
        let localVisualMatrix = visualEntry?.localMatrix
            ? visualEntry.localMatrix.clone()
            : null;
        if (!localVisualMatrix) {
            localVisualMatrix = resolvedVisualLocalMatrix;
        }
        if (!localVisualMatrix) {
            // For primary visual proto, identity is a safe fallback when neither URDF
            // nor stage-local submesh transform is available.
            localVisualMatrix = proto.protoIndex === 0 ? new Matrix4().identity() : null;
        }
        if (!localVisualMatrix)
            return null;
        const linkPosition = new Vector3();
        const linkQuaternion = new Quaternion();
        const linkScale = new Vector3();
        linkWorldMatrix.decompose(linkPosition, linkQuaternion, linkScale);
        const linkRigidMatrix = new Matrix4().compose(linkPosition, linkQuaternion, new Vector3(1, 1, 1));
        const urdfWorldMatrix = linkRigidMatrix.multiply(localVisualMatrix);
        return urdfWorldMatrix;
    }
    getUrdfFallbackXformOpValueForPrimPath(primPath, opName) {
        if (!primPath || !opName || !opName.startsWith('xformOp:orient'))
            return undefined;
        const normalizedPrimPath = String(primPath || '');
        const isCollisionPrim = normalizedPrimPath.includes('/collisions/');
        if (!isCollisionPrim)
            return undefined;
        const collisionMatch = normalizedPrimPath.match(/^(.*)\/collisions\/mesh_(\d+)\/([^/]+)$/i);
        if (!collisionMatch)
            return undefined;
        const linkPath = collisionMatch[1];
        const protoIndex = Number(collisionMatch[2]);
        const protoTypeToken = String(collisionMatch[3] || '').toLowerCase();
        if (!Number.isFinite(protoIndex))
            return undefined;
        const protoType = protoTypeToken === 'cube' ? 'box' : protoTypeToken;
        const meshId = `${linkPath}/collisions.proto_${protoType}_id${protoIndex}`;
        const fallbackEntry = this.getUrdfCollisionEntryForMeshId(meshId);
        if (!fallbackEntry?.originQuatWxyz)
            return undefined;
        return fallbackEntry.originQuatWxyz.slice(0, 4);
    }
    safeExportLayerText(layer) {
        if (!layer || typeof layer.ExportToString !== 'function')
            return '';
        try {
            const exported = layer.ExportToString();
            return typeof exported === 'string' ? exported : String(exported || '');
        }
        catch {
            return '';
        }
    }
    safeExportRootLayerText(stage) {
        // First try to get layer text from snapshot (USD-free path)
        const snapshot = this.getCachedRobotSceneSnapshot?.();
        if (snapshot?.layerInfo?.layerTextByPath) {
            const rootLayerPath = snapshot.layerInfo.rootLayerPath;
            if (rootLayerPath && snapshot.layerInfo.layerTextByPath[rootLayerPath]) {
                return snapshot.layerInfo.layerTextByPath[rootLayerPath] || '';
            }
        }

        // Fallback to USD stage if snapshot doesn't have the data
        if (!stage || typeof stage.GetRootLayer !== 'function')
            return '';
        try {
            const rootLayer = stage.GetRootLayer();
            return this.safeExportLayerText(rootLayer);
        }
        catch {
            return '';
        }
    }
    getStageLayerTextParseCache(stageSourcePath = null) {
        if (!(this._stageLayerTextParseCacheByStageSource instanceof Map)) {
            this._stageLayerTextParseCacheByStageSource = new Map();
        }
        const stageKey = String(stageSourcePath || this.getStageSourcePath?.() || '__unknown_stage__').trim().split('?')[0] || '__unknown_stage__';
        let stageCache = this._stageLayerTextParseCacheByStageSource.get(stageKey);
        if (!(stageCache instanceof Map)) {
            stageCache = new Map();
            this._stageLayerTextParseCacheByStageSource.set(stageKey, stageCache);
        }
        return stageCache;
    }
    getStageLayerTextParseKey(layerPath, layerText = '') {
        const normalizedLayerPath = normalizeHydraPath(String(layerPath || '').trim()).split('?')[0];
        if (normalizedLayerPath) {
            return normalizedLayerPath;
        }
        const text = String(layerText || '');
        return `__inline__:${text.length}:${text.slice(0, 128)}:${text.slice(-128)}`;
    }
    shouldSkipStageLayerTextParsing(layerPath, layerText = null) {
        const normalizedLayerPath = normalizeHydraPath(String(layerPath || '').trim()).split('?')[0];
        if (normalizedLayerPath && isPotentiallyLargeBaseAssetPath(normalizedLayerPath)) {
            return true;
        }
        if (!normalizedLayerPath && typeof layerText === 'string' && layerText.length > materialBindingRepairMaxLayerTextLength) {
            return true;
        }
        return false;
    }
    createStageLayerTextParseBundle(layerPath, layerText, skipped = false) {
        const text = skipped ? '' : String(layerText || '');
        const emptyMap = () => new Map();
        return {
            layerPath: String(layerPath || '').trim() || null,
            skipped: skipped === true,
            getAssetReferences() {
                if (this.assetReferences === undefined) {
                    this.assetReferences = text ? extractUsdAssetReferencesFromLayerText(text) : [];
                }
                return this.assetReferences;
            },
            getGuideCollisionReferences() {
                if (this.guideCollisionReferences === undefined) {
                    this.guideCollisionReferences = text ? parseGuideCollisionReferencesFromLayerText(text) : emptyMap();
                }
                return this.guideCollisionReferences;
            },
            getColliderEntries() {
                if (this.colliderEntries === undefined) {
                    this.colliderEntries = text ? parseColliderEntriesFromLayerText(text) : emptyMap();
                }
                return this.colliderEntries;
            },
            getVisualSemanticChildNames() {
                if (this.visualSemanticChildNames === undefined) {
                    this.visualSemanticChildNames = text ? parseVisualSemanticChildNamesFromLayerText(text) : emptyMap();
                }
                return this.visualSemanticChildNames;
            },
            getXformOpFallbacks() {
                if (this.xformOpFallbacks === undefined) {
                    this.xformOpFallbacks = text ? parseXformOpFallbacksFromLayerText(text) : emptyMap();
                }
                return this.xformOpFallbacks;
            },
        };
    }
    getCachedStageLayerTextParseBundle(stageSourcePath, layerPath, layerText, skipped = false) {
        const stageCache = this.getStageLayerTextParseCache(stageSourcePath);
        const cacheKey = this.getStageLayerTextParseKey(layerPath, skipped ? '' : layerText);
        if (stageCache.has(cacheKey)) {
            return stageCache.get(cacheKey);
        }
        const bundle = this.createStageLayerTextParseBundle(layerPath, layerText, skipped);
        stageCache.set(cacheKey, bundle);
        return bundle;
    }
    getStageLayerTextParseBundleForLayer(stageSourcePath, layerPath, layer) {
        const normalizedLayerPath = normalizeHydraPath(String(layerPath || layer?.identifier || layer?.GetDisplayName?.() || '').trim()).split('?')[0];
        if (this.shouldSkipStageLayerTextParsing(normalizedLayerPath, null)) {
            return this.getCachedStageLayerTextParseBundle(stageSourcePath, normalizedLayerPath, '', true);
        }
        const layerText = this.safeExportLayerText(layer);
        const shouldSkipText = this.shouldSkipStageLayerTextParsing(normalizedLayerPath, layerText);
        return this.getCachedStageLayerTextParseBundle(stageSourcePath, normalizedLayerPath, shouldSkipText ? '' : layerText, shouldSkipText);
    }
    getParsedStageLayerTextBundlesForCurrentStage() {
        const stageSourcePath = this.getStageSourcePath();
        const stageCache = this.getStageLayerTextParseCache(stageSourcePath);
        const bundleListCacheKey = '__bundle_list__';
        if (stageCache.has(bundleListCacheKey)) {
            return stageCache.get(bundleListCacheKey) || [];
        }

        // Try to get layer info from snapshot (USD-free path)
        const snapshot = this.getCachedRobotSceneSnapshot?.();
        if (snapshot?.layerInfo?.usedLayerPaths?.length > 0) {
            const bundles = [];
            const visitedLayerPaths = new Set();
            const seenBundles = new Set();

            const addBundle = (bundle) => {
                if (!bundle || bundle.skipped === true || seenBundles.has(bundle)) {
                    return;
                }
                seenBundles.add(bundle);
                bundles.push(bundle);
            };

            const layerTextByPath = snapshot.layerInfo.layerTextByPath || {};

            // Process all layers from snapshot
            for (const layerPath of snapshot.layerInfo.usedLayerPaths) {
                if (visitedLayerPaths.has(layerPath)) continue;
                visitedLayerPaths.add(layerPath);

                const layerText = layerTextByPath[layerPath] || '';
                const skipped = !layerText || this.shouldSkipStageLayerTextParsing(layerPath, layerText);
                const bundle = this.createStageLayerTextParseBundle(layerPath, layerText, skipped);
                addBundle(bundle);
            }

            stageCache.set(bundleListCacheKey, bundles);
            return bundles;
        }

        // Fallback to USD stage if snapshot doesn't have the data
        const stage = this.getStage();
        if (!stage) {
            stageCache.set(bundleListCacheKey, []);
            return [];
        }
        const bundles = [];
        const visitedLayerPaths = new Set();
        const seenBundles = new Set();
        const addBundle = (bundle) => {
            if (!bundle || bundle.skipped === true || seenBundles.has(bundle)) {
                return;
            }
            seenBundles.add(bundle);
            bundles.push(bundle);
        };
        const addLayer = (layer, layerPath = null) => {
            if (!layer) {
                return null;
            }
            const normalizedLayerPath = normalizeHydraPath(String(layerPath || layer.identifier || layer.GetDisplayName?.() || '').trim()).split('?')[0];
            if (normalizedLayerPath) {
                if (visitedLayerPaths.has(normalizedLayerPath)) {
                    return null;
                }
                visitedLayerPaths.add(normalizedLayerPath);
            }
            const bundle = this.getStageLayerTextParseBundleForLayer(stageSourcePath, normalizedLayerPath || layerPath || null, layer);
            addBundle(bundle);
            return bundle;
        };
        const visitLayerReferences = (layerPath, bundle) => {
            if (!bundle || bundle.skipped === true) {
                return;
            }
            const resolveBasePath = (layerPath && String(layerPath).startsWith('/')) ? layerPath : stageSourcePath;
            for (const assetPath of bundle.getAssetReferences()) {
                if (this.shouldSkipStageLayerTextParsing(assetPath, null)) {
                    continue;
                }
                const resolvedPath = resolveUsdAssetPath(resolveBasePath, assetPath);
                if (!resolvedPath || visitedLayerPaths.has(resolvedPath)) {
                    continue;
                }
                if (this.shouldSkipStageLayerTextParsing(resolvedPath, null)) {
                    continue;
                }
                const referencedStage = this.safeOpenUsdStage(resolvedPath);
                if (!referencedStage) {
                    continue;
                }
                const referencedBundle = addLayer(referencedStage.GetRootLayer?.(), resolvedPath);
                visitLayerReferences(resolvedPath, referencedBundle);
            }
        };
        const rootBundle = addLayer(stage.GetRootLayer?.(), stageSourcePath || null);
        visitLayerReferences(stageSourcePath || null, rootBundle);
        try {
            const usedLayers = toArrayLike(stage.GetUsedLayers?.());
            if (Array.isArray(usedLayers)) {
                for (const layer of usedLayers) {
                    const layerPath = normalizeHydraPath(String(layer?.identifier || layer?.GetDisplayName?.() || '').trim()).split('?')[0];
                    const bundle = addLayer(layer, layerPath || null);
                    visitLayerReferences(layerPath || null, bundle);
                }
            }
        }
        catch { }
        stageCache.set(bundleListCacheKey, bundles);
        return bundles;
    }
    getParsedRootStageLayerTextBundleForCurrentStage() {
        const stageSourcePath = this.getStageSourcePath();
        const stage = this.getStage();
        const rootLayer = stage?.GetRootLayer?.() || null;
        if (!rootLayer) {
            return this.createStageLayerTextParseBundle(stageSourcePath, '', true);
        }
        return this.getStageLayerTextParseBundleForLayer(stageSourcePath, stageSourcePath || rootLayer.identifier || null, rootLayer);
    }
    safeOpenUsdStage(stagePath) {
        if (!stagePath)
            return null;
        if (!(this._openedGuideStages instanceof Map)) {
            this._openedGuideStages = new Map();
        }
        if (this._openedGuideStages.has(stagePath)) {
            return this._openedGuideStages.get(stagePath) || null;
        }
        const usdModule = typeof window !== 'undefined' ? window.USD : null;
        if (!usdModule?.UsdStage?.Open) {
            return null;
        }
        try {
            const openedStage = usdModule.UsdStage.Open(stagePath);
            if (openedStage && typeof openedStage.then === 'function') {
                console.error('[HydraDelegate] USD guide stage open returned a Promise; synchronous stage access is required.', {
                    stagePath,
                });
                return null;
            }
            const stage = openedStage || null;
            if (stage) {
                this._openedGuideStages.set(stagePath, stage);
            }
            return stage;
        }
        catch (error) {
            console.error('[HydraDelegate] Failed to open USD guide stage.', {
                stagePath,
                error,
            });
            return null;
        }
    }
    getGuideCollisionReferenceMapForCurrentStage() {
        const stageSourcePath = this.getStageSourcePath() || '__unknown_stage__';
        if (!(this._guideCollisionRefMapByStageSource instanceof Map)) {
            this._guideCollisionRefMapByStageSource = new Map();
        }
        if (this._guideCollisionRefMapByStageSource.has(stageSourcePath)) {
            return this._guideCollisionRefMapByStageSource.get(stageSourcePath);
        }
        const mergedMap = new Map();
        const mergeMap = (nextMap) => {
            if (!(nextMap instanceof Map))
                return;
            for (const [linkName, entries] of nextMap.entries()) {
                if (!linkName || !Array.isArray(entries))
                    continue;
                const existing = mergedMap.get(linkName) || [];
                for (const entry of entries) {
                    if (!entry)
                        continue;
                    const entryName = String(entry.entryName || '').trim();
                    const referencePath = entry.referencePath ? normalizeUsdPathToken(entry.referencePath) : null;
                    if (!entryName)
                        continue;
                    const isDuplicate = existing.some((item) => item.entryName === entryName && item.referencePath === referencePath);
                    if (isDuplicate)
                        continue;
                    existing.push({ entryName, referencePath });
                }
                mergedMap.set(linkName, existing);
            }
        };
        for (const bundle of this.getParsedStageLayerTextBundlesForCurrentStage()) {
            mergeMap(bundle.getGuideCollisionReferences());
            mergeMap(bundle.getColliderEntries());
        }
        this._guideCollisionRefMapByStageSource.set(stageSourcePath, mergedMap);
        return mergedMap;
    }
    mergeVisualSemanticChildMaps(targetMap, nextMap) {
        if (!(targetMap instanceof Map) || !(nextMap instanceof Map))
            return;
        for (const [linkName, childNames] of nextMap.entries()) {
            const normalizedLinkName = String(linkName || '').trim();
            if (!normalizedLinkName || !Array.isArray(childNames) || childNames.length === 0)
                continue;
            const existingNames = targetMap.get(normalizedLinkName) || [];
            for (const childName of childNames) {
                const normalizedChildName = String(childName || '').trim();
                if (!normalizedChildName || existingNames.includes(normalizedChildName))
                    continue;
                existingNames.push(normalizedChildName);
            }
            targetMap.set(normalizedLinkName, existingNames);
        }
    }
    getVisualSemanticChildMapForCurrentStage() {
        const stageSourcePath = this.getStageSourcePath();
        const cacheKey = stageSourcePath || '__unknown_stage__';
        if (!(this._visualSemanticChildMapByStageSource instanceof Map)) {
            this._visualSemanticChildMapByStageSource = new Map();
        }
        if (this._visualSemanticChildMapByStageSource.has(cacheKey)) {
            return this._visualSemanticChildMapByStageSource.get(cacheKey);
        }
        const mergedMap = new Map();
        for (const bundle of this.getParsedStageLayerTextBundlesForCurrentStage()) {
            this.mergeVisualSemanticChildMaps(mergedMap, bundle.getVisualSemanticChildNames());
        }
        this._visualSemanticChildMapByStageSource.set(cacheKey, mergedMap);
        return mergedMap;
    }
    mergeXformOpFallbackMaps(targetMap, nextMap) {
        if (!(targetMap instanceof Map) || !(nextMap instanceof Map))
            return;
        for (const [primPath, opMap] of nextMap.entries()) {
            if (!primPath || !(opMap instanceof Map))
                continue;
            let mergedOpMap = targetMap.get(primPath);
            if (!(mergedOpMap instanceof Map)) {
                mergedOpMap = new Map();
                targetMap.set(primPath, mergedOpMap);
            }
            for (const [opName, opValue] of opMap.entries()) {
                if (!opName)
                    continue;
                mergedOpMap.set(opName, Array.isArray(opValue) ? opValue.slice(0) : opValue);
            }
        }
    }
    getXformOpFallbackMapForCurrentStage() {
        const stageSourcePath = this.getStageSourcePath();
        const cacheKey = stageSourcePath || '__unknown_stage__';
        if (!(this._xformOpFallbackMapByStageSource instanceof Map)) {
            this._xformOpFallbackMapByStageSource = new Map();
        }
        if (this._xformOpFallbackMapByStageSource.has(cacheKey)) {
            return this._xformOpFallbackMapByStageSource.get(cacheKey);
        }
        const mergedMap = new Map();
        for (const bundle of this.getParsedStageLayerTextBundlesForCurrentStage()) {
            this.mergeXformOpFallbackMaps(mergedMap, bundle.getXformOpFallbacks());
        }
        this._xformOpFallbackMapByStageSource.set(cacheKey, mergedMap);
        return mergedMap;
    }
    getRootLayerXformOpFallbackMapForCurrentStage() {
        const stageSourcePath = this.getStageSourcePath();
        const cacheKey = stageSourcePath || '__unknown_stage__';
        if (!(this._rootLayerXformOpFallbackMapByStageSource instanceof Map)) {
            this._rootLayerXformOpFallbackMapByStageSource = new Map();
        }
        if (this._rootLayerXformOpFallbackMapByStageSource.has(cacheKey)) {
            return this._rootLayerXformOpFallbackMapByStageSource.get(cacheKey);
        }
        const rootBundle = this.getParsedRootStageLayerTextBundleForCurrentStage();
        const parsedMap = rootBundle.getXformOpFallbacks();
        const fallbackMap = parsedMap instanceof Map ? parsedMap : new Map();
        this._rootLayerXformOpFallbackMapByStageSource.set(cacheKey, fallbackMap);
        return fallbackMap;
    }
    getRootLayerFallbackXformOpValueForPrimPath(primPath, opName) {
        if (!primPath || !opName || !opName.startsWith('xformOp:'))
            return undefined;
        const fallbackMap = this.getRootLayerXformOpFallbackMapForCurrentStage();
        if (!(fallbackMap instanceof Map) || fallbackMap.size === 0)
            return undefined;
        const candidatePaths = this.getFallbackXformCandidatePaths(primPath);
        for (const candidatePath of candidatePaths) {
            const opMap = fallbackMap.get(candidatePath);
            if (!(opMap instanceof Map))
                continue;
            if (opMap.has(opName)) {
                const value = opMap.get(opName);
                return Array.isArray(value) ? value.slice(0) : value;
            }
            const baseOpNameMatch = opName.match(/^(xformOp:(?:transform|translate|scale|orient|rotate(?:XYZ|XZY|YXZ|YZX|ZXY|ZYX|X|Y|Z)))/);
            const baseOpName = baseOpNameMatch ? baseOpNameMatch[1] : null;
            if (baseOpName && baseOpName !== opName && opMap.has(baseOpName)) {
                const value = opMap.get(baseOpName);
                return Array.isArray(value) ? value.slice(0) : value;
            }
            if (opName.startsWith('xformOp:orient') && opMap.has('xformOp:orient')) {
                const value = opMap.get('xformOp:orient');
                return Array.isArray(value) ? value.slice(0) : value;
            }
        }
        const suffixMatchedOpMap = this.getSuffixMatchedFallbackOpMap(fallbackMap, primPath);
        if (suffixMatchedOpMap instanceof Map) {
            if (suffixMatchedOpMap.has(opName)) {
                const value = suffixMatchedOpMap.get(opName);
                return Array.isArray(value) ? value.slice(0) : value;
            }
            const baseOpNameMatch = opName.match(/^(xformOp:(?:transform|translate|scale|orient|rotate(?:XYZ|XZY|YXZ|YZX|ZXY|ZYX|X|Y|Z)))/);
            const baseOpName = baseOpNameMatch ? baseOpNameMatch[1] : null;
            if (baseOpName && baseOpName !== opName && suffixMatchedOpMap.has(baseOpName)) {
                const value = suffixMatchedOpMap.get(baseOpName);
                return Array.isArray(value) ? value.slice(0) : value;
            }
            if (opName.startsWith('xformOp:orient') && suffixMatchedOpMap.has('xformOp:orient')) {
                const value = suffixMatchedOpMap.get('xformOp:orient');
                return Array.isArray(value) ? value.slice(0) : value;
            }
        }
        return undefined;
    }
    getCollisionGuideFallbackPrimPath(primPath) {
        if (!primPath || !primPath.includes('/collisions/'))
            return null;
        const marker = '/collisions/';
        const markerIndex = primPath.indexOf(marker);
        if (markerIndex <= 0)
            return null;
        const linkPath = primPath.slice(0, markerIndex);
        const linkName = getPathBasename(linkPath);
        const suffix = primPath.slice(markerIndex + marker.length);
        if (!linkName || !suffix)
            return null;
        return normalizeUsdPathToken(`/colliders/${linkName}/${suffix}`);
    }
    getVisualGuideFallbackPrimPath(primPath) {
        if (!primPath || !primPath.includes('/visuals/'))
            return null;
        const marker = '/visuals/';
        const markerIndex = primPath.indexOf(marker);
        if (markerIndex <= 0)
            return null;
        const linkPath = primPath.slice(0, markerIndex);
        const linkName = getPathBasename(linkPath);
        const suffix = primPath.slice(markerIndex + marker.length);
        if (!linkName || !suffix)
            return null;
        // Some Unitree layers author fallback xform ops under `/visuals/<link>/<child>`
        // instead of `/<root>/<link>/visuals/<child>`. Probe both layouts.
        return normalizeUsdPathToken(`/visuals/${linkName}/${suffix}`);
    }
    getSectionStrippedFallbackPrimPaths(primPath) {
        const normalizedPath = normalizeUsdPathToken(primPath);
        if (!normalizedPath)
            return [];
        const tokens = normalizedPath.split('/').filter(Boolean);
        if (tokens.length < 3)
            return [];
        const strippedPaths = [];
        const seen = new Set();
        const sectionNames = new Set(['visuals', 'collisions']);
        for (let index = 1; index < tokens.length - 1; index++) {
            const sectionToken = String(tokens[index] || '').toLowerCase();
            if (!sectionNames.has(sectionToken))
                continue;
            const nextToken = String(tokens[index + 1] || '');
            if (!nextToken)
                continue;
            const parentToken = String(tokens[index - 1] || '');
            if (sectionToken === 'visuals'
                && parentToken
                && nextToken.toLowerCase() === parentToken.toLowerCase()) {
                continue;
            }
            const strippedTokens = tokens.slice(0, index).concat(tokens.slice(index + 1));
            const strippedPath = normalizeUsdPathToken(`/${strippedTokens.join('/')}`);
            if (!strippedPath || seen.has(strippedPath))
                continue;
            seen.add(strippedPath);
            strippedPaths.push(strippedPath);
        }
        return strippedPaths;
    }
    getFallbackXformCandidatePaths(primPath) {
        const candidatePaths = [];
        const addCandidatePath = (path) => {
            const normalizedPath = normalizeUsdPathToken(path);
            if (!normalizedPath || candidatePaths.includes(normalizedPath))
                return;
            candidatePaths.push(normalizedPath);
        };
        addCandidatePath(primPath);
        addCandidatePath(getPathWithoutRoot(primPath));
        addCandidatePath(this.getCollisionGuideFallbackPrimPath(primPath));
        const visualGuideFallbackPath = this.getVisualGuideFallbackPrimPath(primPath);
        addCandidatePath(visualGuideFallbackPath);
        addCandidatePath(getPathWithoutRoot(visualGuideFallbackPath));
        const sectionStrippedPaths = this.getSectionStrippedFallbackPrimPaths(primPath);
        for (const strippedPath of sectionStrippedPaths) {
            addCandidatePath(strippedPath);
            addCandidatePath(getPathWithoutRoot(strippedPath));
        }
        return candidatePaths;
    }
    getSuffixMatchedFallbackOpMap(fallbackMap, primPath) {
        if (!(fallbackMap instanceof Map) || !primPath)
            return null;
        const normalizedPrimPath = normalizeUsdPathToken(primPath);
        if (!normalizedPrimPath)
            return null;
        const primSegments = normalizedPrimPath.split('/').filter(Boolean);
        if (primSegments.length === 0)
            return null;
        // Avoid overly loose basename-only matches that can leak parent-link transforms
        // into child visual/collision prims (e.g. `/visuals/<same_link_name>` paths).
        const minimumMatchedSuffixSegments = primSegments.length >= 2 ? 2 : 1;
        const rootPath = getRootPathFromPrimPath(normalizedPrimPath);
        let bestRootMatchedOpMap = null;
        let bestRootMatchedScore = 0;
        let bestMatchedOpMap = null;
        let bestMatchedScore = 0;
        const getMatchedTrailingSegmentCount = (leftSegments, rightSegments) => {
            const maxComparableSegments = Math.min(leftSegments.length, rightSegments.length);
            let matchedSegments = 0;
            while (matchedSegments < maxComparableSegments) {
                const leftSegment = leftSegments[leftSegments.length - 1 - matchedSegments];
                const rightSegment = rightSegments[rightSegments.length - 1 - matchedSegments];
                if (leftSegment !== rightSegment)
                    break;
                matchedSegments++;
            }
            return matchedSegments;
        };
        for (const [fallbackPath, opMap] of fallbackMap.entries()) {
            if (!(opMap instanceof Map) || opMap.size === 0)
                continue;
            const normalizedFallbackPath = normalizeUsdPathToken(fallbackPath);
            if (!normalizedFallbackPath)
                continue;
            const fallbackSegments = normalizedFallbackPath.split('/').filter(Boolean);
            if (fallbackSegments.length === 0)
                continue;
            const matchedTrailingSegments = getMatchedTrailingSegmentCount(primSegments, fallbackSegments);
            if (matchedTrailingSegments < minimumMatchedSuffixSegments)
                continue;
            const sameRoot = !!rootPath && normalizedFallbackPath.startsWith(`${rootPath}/`);
            if (sameRoot && matchedTrailingSegments > bestRootMatchedScore) {
                bestRootMatchedScore = matchedTrailingSegments;
                bestRootMatchedOpMap = opMap;
            }
            if (matchedTrailingSegments > bestMatchedScore) {
                bestMatchedScore = matchedTrailingSegments;
                bestMatchedOpMap = opMap;
            }
        }
        return bestRootMatchedOpMap || bestMatchedOpMap || null;
    }
    getFallbackXformOpNamesForPrimPath(primPath) {
        if (!primPath)
            return [];
        const fallbackMap = this.getXformOpFallbackMapForCurrentStage();
        if (!(fallbackMap instanceof Map) || fallbackMap.size === 0)
            return [];
        const candidatePaths = this.getFallbackXformCandidatePaths(primPath);
        for (const candidatePath of candidatePaths) {
            const opMap = fallbackMap.get(candidatePath);
            if (!(opMap instanceof Map) || opMap.size === 0)
                continue;
            const opNames = Array.from(opMap.keys()).filter((opName) => typeof opName === 'string' && opName.startsWith('xformOp:'));
            if (opNames.length > 0)
                return opNames;
        }
        const suffixMatchedOpMap = this.getSuffixMatchedFallbackOpMap(fallbackMap, primPath);
        if (suffixMatchedOpMap instanceof Map) {
            const opNames = Array.from(suffixMatchedOpMap.keys()).filter((opName) => typeof opName === 'string' && opName.startsWith('xformOp:'));
            if (opNames.length > 0)
                return opNames;
        }
        return [];
    }
    getFallbackXformOpValueForPrimPath(primPath, opName) {
        if (!primPath || !opName || !opName.startsWith('xformOp:'))
            return undefined;
        const urdfFallbackValue = this.getUrdfFallbackXformOpValueForPrimPath(primPath, opName);
        if (urdfFallbackValue !== undefined && urdfFallbackValue !== null) {
            return Array.isArray(urdfFallbackValue) ? urdfFallbackValue.slice(0) : urdfFallbackValue;
        }
        const fallbackMap = this.getXformOpFallbackMapForCurrentStage();
        if (!(fallbackMap instanceof Map) || fallbackMap.size === 0)
            return undefined;
        const candidatePaths = this.getFallbackXformCandidatePaths(primPath);
        for (const candidatePath of candidatePaths) {
            const opMap = fallbackMap.get(candidatePath);
            if (!(opMap instanceof Map))
                continue;
            if (opMap.has(opName)) {
                const value = opMap.get(opName);
                return Array.isArray(value) ? value.slice(0) : value;
            }
            const baseOpNameMatch = opName.match(/^(xformOp:(?:transform|translate|scale|orient|rotate(?:XYZ|XZY|YXZ|YZX|ZXY|ZYX|X|Y|Z)))/);
            const baseOpName = baseOpNameMatch ? baseOpNameMatch[1] : null;
            if (baseOpName && baseOpName !== opName && opMap.has(baseOpName)) {
                const value = opMap.get(baseOpName);
                return Array.isArray(value) ? value.slice(0) : value;
            }
            if (opName.startsWith('xformOp:orient') && opMap.has('xformOp:orient')) {
                const value = opMap.get('xformOp:orient');
                return Array.isArray(value) ? value.slice(0) : value;
            }
        }
        const suffixMatchedOpMap = this.getSuffixMatchedFallbackOpMap(fallbackMap, primPath);
        if (suffixMatchedOpMap instanceof Map) {
            if (suffixMatchedOpMap.has(opName)) {
                const value = suffixMatchedOpMap.get(opName);
                return Array.isArray(value) ? value.slice(0) : value;
            }
            const baseOpNameMatch = opName.match(/^(xformOp:(?:transform|translate|scale|orient|rotate(?:XYZ|XZY|YXZ|YZX|ZXY|ZYX|X|Y|Z)))/);
            const baseOpName = baseOpNameMatch ? baseOpNameMatch[1] : null;
            if (baseOpName && baseOpName !== opName && suffixMatchedOpMap.has(baseOpName)) {
                const value = suffixMatchedOpMap.get(baseOpName);
                return Array.isArray(value) ? value.slice(0) : value;
            }
            if (opName.startsWith('xformOp:orient') && suffixMatchedOpMap.has('xformOp:orient')) {
                const value = suffixMatchedOpMap.get('xformOp:orient');
                return Array.isArray(value) ? value.slice(0) : value;
            }
        }
        return undefined;
    }
    buildGuideCollisionPrimPathCandidates(meshId, guideEntry) {
        const proto = parseProtoMeshIdentifier(meshId);
        if (!proto)
            return [];
        const candidates = [];
        const addCandidate = (path) => {
            if (!path || candidates.includes(path))
                return;
            candidates.push(path);
        };
        const names = [];
        const addName = (value) => {
            const name = getPathBasename(value);
            if (!name || names.includes(name))
                return;
            names.push(name);
        };
        addName(guideEntry?.entryName);
        addName(guideEntry?.referencePath);
        addName(proto.linkName);
        for (const name of names) {
            addCandidate(`${proto.linkPath}/collisions/${name}/mesh`);
            addCandidate(`${proto.linkPath}/collisions/${name}/collision_mesh`);
            addCandidate(`${proto.linkPath}/collisions/${name}/visual_mesh`);
            addCandidate(`${proto.linkPath}/collisions/${name}/cube`);
            addCandidate(`${proto.linkPath}/collisions/${name}/sphere`);
            addCandidate(`${proto.linkPath}/collisions/${name}/cylinder`);
            addCandidate(`${proto.linkPath}/collisions/${name}/capsule`);
        }
        addCandidate(`${proto.linkPath}/collisions/mesh_${proto.protoIndex}/mesh`);
        addCandidate(`${proto.linkPath}/collisions/mesh_${proto.protoIndex}/cube`);
        addCandidate(`${proto.linkPath}/collisions/mesh_${proto.protoIndex}/sphere`);
        addCandidate(`${proto.linkPath}/collisions/mesh_${proto.protoIndex}/cylinder`);
        addCandidate(`${proto.linkPath}/collisions/mesh_${proto.protoIndex}/capsule`);
        return candidates;
    }
    resolveGuideCollisionPrimPath(meshId) {
        if (!meshId)
            return null;
        const stageKey = this.getStageSourcePath() || '__unknown_stage__';
        const cacheKey = `${stageKey}::${meshId}`;
        if (this._guideCollisionPrimPathCache.has(cacheKey)) {
            return this._guideCollisionPrimPathCache.get(cacheKey) || null;
        }
        const stage = this.getStage();
        const proto = parseProtoMeshIdentifier(meshId);
        if (!stage || !proto || proto.sectionName !== 'collisions' || proto.protoType !== 'mesh') {
            this._guideCollisionPrimPathCache.set(cacheKey, null);
            return null;
        }
        const guideMap = this.getGuideCollisionReferenceMapForCurrentStage();
        const guideEntries = guideMap.get(proto.linkName) || [];
        if (!guideEntries.length) {
            this._guideCollisionPrimPathCache.set(cacheKey, null);
            return null;
        }
        const orderedEntries = [];
        const preferredEntry = guideEntries[proto.protoIndex];
        if (preferredEntry)
            orderedEntries.push(preferredEntry);
        for (const entry of guideEntries) {
            if (!entry || orderedEntries.includes(entry))
                continue;
            orderedEntries.push(entry);
        }
        const acceptableTypes = ['mesh', 'cube', 'sphere', 'cylinder', 'capsule'];
        for (const entry of orderedEntries) {
            const candidates = this.buildGuideCollisionPrimPathCandidates(meshId, entry);
            for (const candidatePath of candidates) {
                const prim = this.safeGetPrimAtPath(stage, candidatePath);
                if (!prim)
                    continue;
                const primType = getSafePrimTypeName(prim);
                if (!primType || !acceptableTypes.includes(primType))
                    continue;
                this._guideCollisionPrimPathCache.set(cacheKey, candidatePath);
                return candidatePath;
            }
        }
        this._guideCollisionPrimPathCache.set(cacheKey, null);
        return null;
    }
}
