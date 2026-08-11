// @ts-nocheck
import { Color, FrontSide, LinearSRGBColorSpace, Quaternion, SRGBColorSpace, Vector2, Vector3 } from 'three';
import * as Shared from './shared.js';
import { ThreeRenderDelegateCore } from './ThreeRenderDelegateCore.js';
import { createHydraColorFromTuple, createUnifiedHydraPhysicalMaterial, createUnifiedHydraStandardMaterial, hydraMaterialRequiresPhysicalExtensions, HYDRA_UNIFIED_MATERIAL_DEFAULTS } from './material-defaults.js';
const { buildProtoPrimPathCandidates, clamp01, createMatrixFromXformOp, debugInstancer, debugMaterials, debugMeshes, debugPrims, debugTextures, defaultGrayComponent, disableMaterials, disableTextures, extractPrimPathFromMaterialBindingWarning, extractReferencePrimTargets, extractScopeBodyText, extractUsdAssetReferencesFromLayerText, getActiveMaterialBindingWarningOwner, getAngleInRadians, getCollisionGeometryTypeFromUrdfElement, getExpectedPrimTypesForCollisionProto, getExpectedPrimTypesForProtoType, getMatrixMaxElementDelta, getPathBasename, getPathWithoutRoot, getRawConsoleMethod, getRootPathFromPrimPath, getSafePrimTypeName, hasNonZeroTranslation, hydraCallbackErrorCounts, installMaterialBindingApiWarningInterceptor, isIdentityQuaternion, isLikelyDefaultGrayMaterial, isLikelyInverseTransform, isMaterialBindingApiWarningMessage, isMatrixApproximatelyIdentity, isNonZero, isPotentiallyLargeBaseAssetPath, logHydraCallbackError, materialBindingRepairMaxLayerTextLength, materialBindingWarningHandlers, maxHydraCallbackErrorLogsPerMethod, nearlyEqual, normalizeHydraPath, normalizeUsdPathToken, parseGuideCollisionReferencesFromLayerText, parseProtoMeshIdentifier, parseUrdfTruthFromText, parseVector3Text, parseXformOpFallbacksFromLayerText, rawConsoleError, rawConsoleWarn, registerMaterialBindingApiWarningHandler, remapRootPathIfNeeded, resolveUrdfTruthFileNameForStagePath, resolveUsdAssetPath, setActiveMaterialBindingWarningOwner, shouldAllowLargeBaseAssetScan, stringifyConsoleArgs, toArrayLike, toColorArray, toFiniteNumber, toFiniteQuaternionWxyzTuple, toFiniteVector2Tuple, toFiniteVector3Tuple, toMatrixFromUrdfOrigin, toQuaternionWxyzFromRpy, transformEpsilon, wrapHydraCallbackObject } = Shared;
export class ThreeRenderDelegateMaterialOps extends ThreeRenderDelegateCore {
    snapshotRecordRequiresPhysicalMaterial(record) {
        if (!record || typeof record !== 'object')
            return false;
        const candidateNames = [];
        const scalarOrColorPropertyNames = [
            'clearcoat',
            'clearcoatRoughness',
            'clearcoatNormalScale',
            'specularIntensity',
            'specularColor',
            'ior',
            'transmission',
            'thickness',
            'attenuationDistance',
            'attenuationColor',
            'sheen',
            'sheenColor',
            'sheenRoughness',
            'iridescence',
            'iridescenceIOR',
            'anisotropy',
            'anisotropyRotation',
        ];
        for (const propertyName of scalarOrColorPropertyNames) {
            if (record[propertyName] === undefined || record[propertyName] === null)
                continue;
            candidateNames.push(propertyName);
        }
        const texturePropertyNames = [
            'clearcoatMap',
            'clearcoatRoughnessMap',
            'clearcoatNormalMap',
            'specularColorMap',
            'specularIntensityMap',
            'transmissionMap',
            'thicknessMap',
            'sheenColorMap',
            'sheenRoughnessMap',
            'anisotropyMap',
            'iridescenceMap',
            'iridescenceThicknessMap',
        ];
        for (const texturePropertyName of texturePropertyNames) {
            const recordPathKey = `${texturePropertyName}Path`;
            if (!record[recordPathKey])
                continue;
            candidateNames.push(texturePropertyName);
        }
        return hydraMaterialRequiresPhysicalExtensions(candidateNames);
    }
    resolveSnapshotMaterialEmissionEnabled(record) {
        if (!record || typeof record !== 'object')
            return true;
        if (record.emissiveEnabled === true)
            return true;
        if (record.emissiveEnabled === false)
            return false;
        return record.isOmniPbr === true ? false : true;
    }
    getActiveStageRootPrimPath() {
        const snapshotDefaultPrimPath = normalizeHydraPath(this.getCachedRobotSceneSnapshot?.()?.stage?.defaultPrimPath || '');
        if (snapshotDefaultPrimPath)
            return snapshotDefaultPrimPath;
        const stageDefaultPrimPath = normalizeHydraPath(this.getStage?.()?.GetDefaultPrim?.()?.GetPath?.()?.pathString || '');
        if (stageDefaultPrimPath)
            return stageDefaultPrimPath;
        return null;
    }
    getPrimPathIfWithinActiveStageRoot(primPath) {
        const normalizedPrimPath = normalizeHydraPath(primPath || '');
        if (!normalizedPrimPath)
            return null;
        const activeStageRootPrimPath = this.getActiveStageRootPrimPath?.();
        if (!activeStageRootPrimPath)
            return normalizedPrimPath;
        if (normalizedPrimPath === activeStageRootPrimPath)
            return normalizedPrimPath;
        if (normalizedPrimPath.startsWith(`${activeStageRootPrimPath}/`))
            return normalizedPrimPath;
        return null;
    }
    shouldSuppressSyntheticTopLevelMesh(meshId) {
        const normalizedMeshId = normalizeHydraPath(meshId || '');
        if (!normalizedMeshId || normalizedMeshId.includes('.proto_'))
            return false;
        if (!/^\/(?:meshes|visuals|coll(?:isions?|iders?))(?:$|[/.])/i.test(normalizedMeshId))
            return false;
        const activeStageRootPrimPath = this.getActiveStageRootPrimPath?.();
        if (!activeStageRootPrimPath)
            return false;
        if (this.getPrimPathIfWithinActiveStageRoot(normalizedMeshId))
            return false;
        // Robot stages can carry duplicate helper scopes like `/visuals/...` or
        // `/colliders/...` outside the default-prim root. Those prims are not part
        // of the active robot subtree and keeping them produces duplicate rendering.
        return true;
    }
    pruneSyntheticTopLevelMeshes() {
        const meshEntries = Object.entries(this.meshes || {});
        if (meshEntries.length === 0)
            return 0;
        let removedCount = 0;
        for (const [meshId, hydraMesh] of meshEntries) {
            if (!this.shouldSuppressSyntheticTopLevelMesh?.(meshId))
                continue;
            const threeMesh = hydraMesh?._mesh || null;
            try {
                threeMesh?.parent?.remove?.(threeMesh);
            }
            catch { }
            delete this.meshes[meshId];
            removedCount += 1;
        }
        if (removedCount > 0) {
            this._meshMutationVersion = Number(this._meshMutationVersion || 0) + 1;
            this._stageOverrideProtoMeshCache = null;
        }
        return removedCount;
    }
    handleMaterialBindingApiWarning({ message }) {
        if (getActiveMaterialBindingWarningOwner() !== this)
            return false;
        if (!message || !this.suppressMaterialBindingApiWarnings)
            return false;
        // Zero-overhead suppression path: swallow MaterialBindingAPI warnings
        // immediately so Hydra sync does not enqueue async callback work.
        if (!isMaterialBindingApiWarningMessage(message))
            return false;
        return true;
    }
    flushMaterialBindingApiWarningSummary() {
        if (this._materialBindingWarningSummaryTimer) {
            clearTimeout(this._materialBindingWarningSummaryTimer);
            this._materialBindingWarningSummaryTimer = null;
        }
        const warningSummary = this._materialBindingWarningSummary;
        if (!warningSummary)
            return;
        warningSummary.count = 0;
        warningSummary.primPaths.clear();
        warningSummary.sampleMessages.length = 0;
    }
    tryRepairMaterialBindingApiSchemas() {
        if (this._materialBindingSchemaRepairAttempted) {
            return this._materialBindingSchemaRepairSucceeded;
        }
        this._materialBindingSchemaRepairAttempted = true;
        this._materialBindingSchemaRepairSucceeded = false;
        this._materialBindingSchemaWriteSupported = false;
        const stage = this.getStage();
        if (!stage)
            return false;
        const candidateLayers = [];
        const seenLayers = new Set();
        const addLayer = (layer, label) => {
            if (!layer)
                return;
            const identifier = normalizeHydraPath(layer.identifier || layer.GetDisplayName?.() || label || '');
            if (!identifier || seenLayers.has(identifier))
                return;
            seenLayers.add(identifier);
            candidateLayers.push({ layer, identifier });
        };
        const rootLayer = stage.GetRootLayer?.();
        addLayer(rootLayer, 'rootLayer');
        try {
            const layerStack = stage.GetLayerStack?.(false);
            if (layerStack && typeof layerStack.size === 'function' && typeof layerStack.get === 'function') {
                const stackSize = Number(layerStack.size()) || 0;
                for (let layerIndex = 0; layerIndex < stackSize; layerIndex++) {
                    addLayer(layerStack.get(layerIndex), `layerStack[${layerIndex}]`);
                }
            }
        }
        catch { }
        const rootLayerText = this.safeExportLayerText(rootLayer);
        const referencedAssets = extractUsdAssetReferencesFromLayerText(rootLayerText, { baseOnly: true });
        const stageSourcePath = this.getStageSourcePath();
        for (const assetPath of referencedAssets) {
            if (isPotentiallyLargeBaseAssetPath(assetPath))
                continue;
            const resolvedAssetPath = resolveUsdAssetPath(stageSourcePath, assetPath);
            if (!resolvedAssetPath)
                continue;
            if (isPotentiallyLargeBaseAssetPath(resolvedAssetPath))
                continue;
            const referencedStage = this.safeOpenUsdStage(resolvedAssetPath);
            if (!referencedStage)
                continue;
            addLayer(referencedStage.GetRootLayer?.(), resolvedAssetPath);
        }
        let detectedRepairCandidates = 0;
        for (const { layer } of candidateLayers) {
            const beforeText = this.safeExportLayerText(layer);
            if (!beforeText || beforeText.length > materialBindingRepairMaxLayerTextLength || !beforeText.includes('material:binding'))
                continue;
            const repairedText = this.repairMaterialBindingApiSchemasInLayerText(beforeText);
            if (!repairedText.changed)
                continue;
            detectedRepairCandidates += repairedText.count;
            if (typeof layer.ImportFromString !== 'function')
                continue;
            try {
                layer.ImportFromString(repairedText.text);
            }
            catch { }
            const afterText = this.safeExportLayerText(layer);
            const writeSucceeded = !!afterText && afterText !== beforeText && afterText.includes('MaterialBindingAPI');
            if (writeSucceeded) {
                this._materialBindingSchemaWriteSupported = true;
                this._materialBindingSchemaRepairSucceeded = true;
            }
        }
        if (!this._materialBindingSchemaWriteSupported && detectedRepairCandidates > 0) {
            this.suppressMaterialBindingApiWarnings = true;
            getRawConsoleMethod('warn')('[HydraDelegate] MaterialBindingAPI schema repair is unavailable in current WASM bindings; using aggregated warning fallback.');
        }
        return this._materialBindingSchemaRepairSucceeded;
    }
    repairMaterialBindingApiSchemasInLayerText(layerText) {
        if (!layerText || !layerText.includes('material:binding')) {
            return { text: layerText, changed: false, count: 0 };
        }
        const lines = layerText.split(/\r?\n/);
        const injectionMap = new Map();
        const stack = [];
        let pendingContext = null;
        const registerApiSchemasLine = (context, lineIndex, lineText) => {
            if (!context || context.apiSchemasLineIndex !== null)
                return;
            if (!/apiSchemas\s*=/.test(lineText))
                return;
            context.apiSchemasLineIndex = lineIndex;
            context.hasMaterialBindingApi = /MaterialBindingAPI/.test(lineText);
        };
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            const trimmed = line.trim();
            if (pendingContext) {
                if (trimmed.includes('material:binding'))
                    pendingContext.hasMaterialBinding = true;
                registerApiSchemasLine(pendingContext, lineIndex, line);
            }
            if (stack.length > 0) {
                const current = stack[stack.length - 1];
                if (trimmed.includes('material:binding'))
                    current.hasMaterialBinding = true;
                registerApiSchemasLine(current, lineIndex, line);
            }
            const defMatch = trimmed.match(/^(?:def|over|class)\s+\w+\s+"[^"]+"/);
            if (defMatch) {
                pendingContext = {
                    hasMaterialBinding: false,
                    hasMaterialBindingApi: false,
                    apiSchemasLineIndex: null,
                    metadataStartLineIndex: null,
                    metadataEndLineIndex: null,
                    openBraceLineIndex: null,
                };
            }
            for (const character of line) {
                if (character === '(') {
                    if (pendingContext && pendingContext.metadataStartLineIndex === null && pendingContext.openBraceLineIndex === null) {
                        pendingContext.metadataStartLineIndex = lineIndex;
                    }
                }
                else if (character === ')') {
                    if (pendingContext && pendingContext.metadataStartLineIndex !== null && pendingContext.metadataEndLineIndex === null) {
                        pendingContext.metadataEndLineIndex = lineIndex;
                    }
                    if (stack.length > 0) {
                        const top = stack[stack.length - 1];
                        if (top.metadataStartLineIndex !== null && top.metadataEndLineIndex === null) {
                            top.metadataEndLineIndex = lineIndex;
                        }
                    }
                }
                else if (character === '{') {
                    if (pendingContext) {
                        pendingContext.openBraceLineIndex = lineIndex;
                        stack.push(pendingContext);
                        pendingContext = null;
                    }
                    else {
                        stack.push({
                            hasMaterialBinding: false,
                            hasMaterialBindingApi: false,
                            apiSchemasLineIndex: null,
                            metadataStartLineIndex: null,
                            metadataEndLineIndex: null,
                            openBraceLineIndex: lineIndex,
                            anonymous: true,
                        });
                    }
                }
                else if (character === '}') {
                    const poppedContext = stack.pop();
                    if (!poppedContext || poppedContext.anonymous)
                        continue;
                    if (!poppedContext.hasMaterialBinding || poppedContext.hasMaterialBindingApi)
                        continue;
                    if (poppedContext.apiSchemasLineIndex !== null) {
                        injectionMap.set(poppedContext.apiSchemasLineIndex, { type: 'appendApiSchema' });
                        continue;
                    }
                    const targetLine = poppedContext.metadataEndLineIndex !== null
                        ? poppedContext.metadataEndLineIndex
                        : poppedContext.openBraceLineIndex;
                    if (targetLine !== null) {
                        injectionMap.set(targetLine, { type: 'injectApiSchemaLine' });
                    }
                }
            }
        }
        if (injectionMap.size === 0) {
            return { text: layerText, changed: false, count: 0 };
        }
        const outputLines = [];
        let changedCount = 0;
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            let line = lines[lineIndex];
            const instruction = injectionMap.get(lineIndex);
            if (instruction?.type === 'appendApiSchema') {
                if (/\[\s*\]/.test(line)) {
                    line = line.replace(/\[\s*\]/, '["MaterialBindingAPI"]');
                }
                else if (/\]/.test(line)) {
                    line = line.replace(/\]/, ', "MaterialBindingAPI"]');
                }
                else if (/apiSchemas\s*=/.test(line)) {
                    line = `${line.trimEnd()} = ["MaterialBindingAPI"]`;
                }
                changedCount += 1;
            }
            else if (instruction?.type === 'injectApiSchemaLine') {
                const indentation = (line.match(/^(\s*)/) || [''])[0];
                outputLines.push(`${indentation}prepend apiSchemas = ["MaterialBindingAPI"]`);
                changedCount += 1;
            }
            outputLines.push(line);
        }
        return {
            text: outputLines.join('\n'),
            changed: changedCount > 0,
            count: changedCount,
        };
    }
    getCollisionOverridePrimPath(meshId) {
        if (!meshId)
            return null;
        const proto = parseProtoMeshIdentifier(meshId);
        if (!proto)
            return null;
        const expectedTypes = getExpectedPrimTypesForCollisionProto(proto);
        if (expectedTypes.length === 0)
            return null;
        const driverOverride = this.getCollisionProtoOverride?.(meshId);
        const overrideType = String(driverOverride?.primType || '').toLowerCase();
        const overridePath = normalizeHydraPath(driverOverride?.resolvedPrimPath);
        if (overridePath && overrideType && expectedTypes.includes(overrideType)) {
            return overridePath;
        }
        const resolved = this.getResolvedPrimPathForMeshId(meshId);
        if (!resolved)
            return null;
        const primOverrideData = this.getPrimOverrideData?.(resolved);
        const overridePrimType = String(primOverrideData?.primType || '').toLowerCase();
        if (overridePrimType && expectedTypes.includes(overridePrimType)) {
            return resolved;
        }
        const prim = this.getPrimAtPathAllowUnknown(this.getStage(), resolved);
        const primType = getSafePrimTypeName(prim);
        if (!expectedTypes.includes(primType))
            return null;
        return resolved;
    }
    getPrimAtPathAllowUnknown(stage, primPath) {
        const normalizedPath = normalizeHydraPath(primPath);
        if (!stage || !normalizedPath)
            return null;
        const safePrim = this.safeGetPrimAtPath(stage, normalizedPath);
        if (safePrim)
            return safePrim;
        // Some valid child prim paths are missing from driver path indexes.
        // Fall back to direct stage lookup so collision path upgrades can still
        // resolve concrete primitive children (e.g. `/collisions/mesh_N/cylinder`).
        try {
            if (typeof stage.GetPrimAtPath !== 'function')
                return null;
            const directPrim = stage.GetPrimAtPath(normalizedPath);
            if (!directPrim)
                return null;
            if (this._primPathExistenceCache instanceof Map) {
                this._primPathExistenceCache.set(normalizedPath, true);
            }
            if (this._knownPrimPathSet instanceof Set) {
                this._knownPrimPathSet.add(normalizedPath);
            }
            return directPrim;
        }
        catch {
            return null;
        }
    }
    resolveLegacyCollisionPrimPathFromStage(meshPath) {
        const normalizedMeshPath = normalizeHydraPath(meshPath);
        if (!normalizedMeshPath || !/\/collisions(?:$|[/.])/i.test(normalizedMeshPath)) {
            return null;
        }
        const candidatePaths = [];
        const seenCandidatePaths = new Set();
        const addCandidatePath = (candidatePath) => {
            const normalizedCandidatePath = normalizeHydraPath(candidatePath);
            if (!normalizedCandidatePath || seenCandidatePaths.has(normalizedCandidatePath))
                return;
            seenCandidatePaths.add(normalizedCandidatePath);
            candidatePaths.push(normalizedCandidatePath);
        };
        const protoLikeMatch = normalizedMeshPath.match(/^(.*\/collisions)\/mesh_(\d+)$/i);
        if (protoLikeMatch) {
            const protoLikeMeshId = `${protoLikeMatch[1]}.proto_mesh_id${protoLikeMatch[2]}`;
            for (const candidatePath of buildProtoPrimPathCandidates(protoLikeMeshId)) {
                addCandidatePath(candidatePath);
            }
        }
        if (this._knownPrimPathSet && typeof this._knownPrimPathSet[Symbol.iterator] === 'function') {
            for (const knownPath of this._knownPrimPathSet) {
                const normalizedKnownPath = normalizeHydraPath(knownPath);
                if (!normalizedKnownPath || !normalizedKnownPath.startsWith(`${normalizedMeshPath}/`))
                    continue;
                addCandidatePath(normalizedKnownPath);
            }
        }
        const stage = this.getStage();
        const containerPrim = this.getPrimAtPathAllowUnknown(stage, normalizedMeshPath);
        if (containerPrim) {
            try {
                let rawChildren = null;
                if (containerPrim.IsInstance?.()) {
                    rawChildren = containerPrim.GetPrototype?.()?.GetChildren?.() || null;
                }
                if (!rawChildren) {
                    rawChildren = containerPrim.GetChildren?.();
                }
                const children = Array.isArray(rawChildren)
                    ? rawChildren
                    : (rawChildren && typeof rawChildren[Symbol.iterator] === 'function'
                        ? Array.from(rawChildren)
                        : []);
                for (const childPrim of children) {
                    const childName = normalizeHydraPath(childPrim?.GetName?.());
                    if (!childName)
                        continue;
                    addCandidatePath(`${normalizedMeshPath}/${childName}`);
                }
            }
            catch { }
        }
        addCandidatePath(normalizedMeshPath);
        const expectedPrimitiveTypes = new Set(['mesh', 'cube', 'sphere', 'cylinder', 'capsule']);
        const primitiveLeafNames = new Set(['mesh', 'collision_mesh', 'visual_mesh', 'cube', 'sphere', 'cylinder', 'capsule']);
        for (const candidatePath of candidatePaths) {
            const prim = this.getPrimAtPathAllowUnknown(stage, candidatePath);
            if (!prim)
                continue;
            const primType = getSafePrimTypeName(prim);
            if (primType && expectedPrimitiveTypes.has(primType)) {
                return candidatePath;
            }
            const leafName = String(candidatePath.split('/').pop() || '').toLowerCase();
            if (primitiveLeafNames.has(leafName)) {
                return candidatePath;
            }
        }
        return normalizedMeshPath;
    }
    getCollisionSemanticMeshCandidatesFromKnownSet(containerPath) {
        const normalizedContainerPath = normalizeHydraPath(containerPath);
        if (!normalizedContainerPath || !normalizedContainerPath.startsWith('/'))
            return [];
        let knownPathSet = this._knownPrimPathSet instanceof Set ? this._knownPrimPathSet : null;
        if ((!knownPathSet || knownPathSet.size === 0) && typeof this.prefetchPrimPathSetFromDriver === 'function') {
            const driver = typeof this.config?.driver === 'function' ? this.config.driver() : null;
            if (driver) {
                try {
                    this.prefetchPrimPathSetFromDriver(driver, { force: false });
                    knownPathSet = this._knownPrimPathSet instanceof Set ? this._knownPrimPathSet : null;
                }
                catch { }
            }
        }
        if (!knownPathSet || knownPathSet.size === 0)
            return [];
        const prefix = `${normalizedContainerPath}/`;
        const candidates = [];
        const seen = new Set();
        for (const rawPath of knownPathSet) {
            const normalizedPath = normalizeHydraPath(rawPath);
            if (!normalizedPath || !normalizedPath.startsWith(prefix) || !normalizedPath.endsWith('/mesh'))
                continue;
            const relativePath = normalizedPath.slice(prefix.length);
            const parts = relativePath.split('/');
            if (parts.length !== 2)
                continue;
            const childName = String(parts[0] || '');
            if (!childName || /^mesh_\d+$/i.test(childName))
                continue;
            if (seen.has(normalizedPath))
                continue;
            seen.add(normalizedPath);
            candidates.push(normalizedPath);
        }
        candidates.sort((left, right) => left.localeCompare(right));
        return candidates;
    }
    resolveCollisionMeshPrimPathFromKnownSet(meshId, overridePrimPath = null) {
        if (!meshId || typeof meshId !== 'string')
            return null;
        const proto = parseProtoMeshIdentifier(meshId);
        if (!proto || proto.sectionName !== 'collisions' || proto.protoType !== 'mesh')
            return null;
        const semanticCandidates = this.getCollisionSemanticMeshCandidatesFromKnownSet(proto.containerPath);
        if (semanticCandidates.length === 0)
            return null;
        const semanticCandidateSet = new Set(semanticCandidates);
        const peerMeshIds = Object.keys(this.meshes || {})
            .filter((candidateMeshId) => {
            const candidateProto = parseProtoMeshIdentifier(candidateMeshId);
            return !!candidateProto
                && candidateProto.sectionName === 'collisions'
                && candidateProto.protoType === 'mesh'
                && normalizeHydraPath(candidateProto.containerPath) === proto.containerPath;
        })
            .sort((leftMeshId, rightMeshId) => {
            const leftProto = parseProtoMeshIdentifier(leftMeshId);
            const rightProto = parseProtoMeshIdentifier(rightMeshId);
            return Number(leftProto?.protoIndex || 0) - Number(rightProto?.protoIndex || 0);
        });
        if (peerMeshIds.length === 0)
            return null;
        const usedByPeers = new Set();
        const pathUseCounts = new Map();
        for (const peerMeshId of peerMeshIds) {
            const peerOverride = this.getCollisionProtoOverride?.(peerMeshId);
            const peerPath = normalizeHydraPath(peerOverride?.resolvedPrimPath || '');
            if (!peerPath || !semanticCandidateSet.has(peerPath))
                continue;
            pathUseCounts.set(peerPath, Number(pathUseCounts.get(peerPath) || 0) + 1);
            if (peerMeshId !== meshId) {
                usedByPeers.add(peerPath);
            }
        }
        const normalizedOverridePath = normalizeHydraPath(overridePrimPath || '');
        const overrideInSemanticSet = !!normalizedOverridePath && semanticCandidateSet.has(normalizedOverridePath);
        const overrideUseCount = normalizedOverridePath ? Number(pathUseCounts.get(normalizedOverridePath) || 0) : 0;
        const unresolvedCandidates = semanticCandidates.filter((candidatePath) => !usedByPeers.has(candidatePath));
        if (overrideInSemanticSet && overrideUseCount <= 1 && unresolvedCandidates.length <= 1) {
            return null;
        }
        if (unresolvedCandidates.length === 1) {
            return unresolvedCandidates[0];
        }
        const ordinal = peerMeshIds.indexOf(meshId);
        if (ordinal >= 0 && ordinal < semanticCandidates.length) {
            const ordinalCandidate = semanticCandidates[ordinal];
            if (ordinalCandidate && unresolvedCandidates.includes(ordinalCandidate)) {
                return ordinalCandidate;
            }
        }
        if (overrideInSemanticSet && overrideUseCount <= 1) {
            return normalizedOverridePath;
        }
        return unresolvedCandidates[0] || null;
    }
    getResolvedPrimPathForMeshId(meshId) {
        if (!meshId)
            return null;
        if (this._resolvedProtoPrimPathCache.has(meshId)) {
            const cachedPath = this.getPrimPathIfWithinActiveStageRoot(this._resolvedProtoPrimPathCache.get(meshId) || null);
            if (!meshId.includes('.proto_')) {
                const normalizedMeshPath = normalizeHydraPath(meshId);
                if (cachedPath && normalizedMeshPath && cachedPath === normalizedMeshPath) {
                    let upgradedLegacyPath = null;
                    try {
                        upgradedLegacyPath = this.resolveLegacyCollisionPrimPathFromStage(normalizedMeshPath);
                    }
                    catch {
                        upgradedLegacyPath = null;
                    }
                    if (upgradedLegacyPath && upgradedLegacyPath !== cachedPath) {
                        this._resolvedProtoPrimPathCache.set(meshId, upgradedLegacyPath);
                        return upgradedLegacyPath;
                    }
                }
            }
            return cachedPath;
        }
        if (!meshId.includes('.proto_')) {
            const normalizedMeshPath = normalizeHydraPath(meshId);
            if (!normalizedMeshPath || !/\/collisions(?:$|[/.])/i.test(normalizedMeshPath)) {
                return null;
            }
            const scopedMeshPath = this.getPrimPathIfWithinActiveStageRoot(normalizedMeshPath);
            if (!scopedMeshPath) {
                this._resolvedProtoPrimPathCache.set(meshId, null);
                return null;
            }
            let resolvedLegacyPath = null;
            try {
                resolvedLegacyPath = this.resolveLegacyCollisionPrimPathFromStage(scopedMeshPath);
            }
            catch {
                resolvedLegacyPath = null;
            }
            const resolvedPath = this.getPrimPathIfWithinActiveStageRoot(resolvedLegacyPath || scopedMeshPath);
            this._resolvedProtoPrimPathCache.set(meshId, resolvedPath);
            return resolvedPath;
        }
        const proto = parseProtoMeshIdentifier(meshId);
        if (!proto || proto.sectionName !== 'collisions') {
            return null;
        }
        const driverOverride = this.getCollisionProtoOverride?.(meshId);
        const overridePrimPath = normalizeHydraPath(driverOverride?.resolvedPrimPath);
        if (proto.protoType === 'mesh') {
            const correctedFromKnownSet = this.resolveCollisionMeshPrimPathFromKnownSet(meshId, overridePrimPath);
            if (correctedFromKnownSet) {
                this._resolvedProtoPrimPathCache.set(meshId, correctedFromKnownSet);
                return correctedFromKnownSet;
            }
        }
        if (overridePrimPath) {
            this._resolvedProtoPrimPathCache.set(meshId, overridePrimPath);
            return overridePrimPath;
        }
        let stageResolved = null;
        try {
            stageResolved = this.resolveProtoPrimPathFromStage(meshId);
        }
        catch {
            stageResolved = null;
        }
        if (stageResolved) {
            this._resolvedProtoPrimPathCache.set(meshId, stageResolved);
        }
        return stageResolved;
    }
    getResolvedVisualTransformPrimPathForMeshId(meshId) {
        if (!meshId)
            return null;
        if (this._resolvedVisualPrimPathCache.has(meshId)) {
            return this.getPrimPathIfWithinActiveStageRoot(this._resolvedVisualPrimPathCache.get(meshId) || null);
        }
        if (!meshId.includes('.proto_')) {
            const normalizedMeshPath = normalizeHydraPath(meshId);
            if (!normalizedMeshPath || !/\/visuals(?:$|[/.])/i.test(normalizedMeshPath)) {
                return null;
            }
            const scopedMeshPath = this.getPrimPathIfWithinActiveStageRoot(normalizedMeshPath);
            this._resolvedVisualPrimPathCache.set(meshId, scopedMeshPath);
            return scopedMeshPath;
        }
        const proto = parseProtoMeshIdentifier(meshId);
        if (!proto || proto.sectionName !== 'visuals' || proto.protoType !== 'mesh')
            return null;
        const driverOverride = this.getVisualProtoOverride?.(meshId);
        const overridePrimPath = normalizeHydraPath(driverOverride?.resolvedPrimPath);
        if (overridePrimPath) {
            this._resolvedVisualPrimPathCache.set(meshId, overridePrimPath);
            return overridePrimPath;
        }
        const stage = this.getStage();
        if (!stage)
            return null;
        const containerPrim = this.safeGetPrimAtPath(stage, proto.containerPath);
        if (!containerPrim)
            return null;
        const transformChildren = [];
        try {
            let rawChildren = null;
            let useContainerPathAsPrefix = false;
            if (containerPrim.IsInstance?.()) {
                const prototypePrim = containerPrim.GetPrototype?.();
                rawChildren = prototypePrim?.GetChildren?.() || null;
                useContainerPathAsPrefix = true;
            }
            if (!rawChildren) {
                rawChildren = containerPrim.GetChildren?.();
            }
            const children = Array.isArray(rawChildren)
                ? rawChildren
                : (rawChildren && typeof rawChildren[Symbol.iterator] === 'function'
                    ? Array.from(rawChildren)
                    : []);
            for (const childPrim of children) {
                if (!childPrim)
                    continue;
                const childType = getSafePrimTypeName(childPrim);
                const isRecognizedType = childType === 'xform'
                    || childType === 'mesh'
                    || childType === 'cube'
                    || childType === 'sphere'
                    || childType === 'cylinder'
                    || childType === 'capsule';
                // Some Unitree USD crates report empty type names for valid child prims in
                // WASM bindings. Keep unknown/empty types instead of dropping them so proto
                // index mapping can still resolve sub-mesh transform prims.
                if (childType && !isRecognizedType) {
                    continue;
                }
                const childName = normalizeHydraPath(childPrim.GetName?.());
                let childPath = '';
                if (useContainerPathAsPrefix) {
                    if (childName) {
                        childPath = `${proto.containerPath}/${childName}`;
                    }
                }
                if (!childPath) {
                    childPath = normalizeHydraPath(childPrim.GetPath?.());
                }
                if (!childPath)
                    continue;
                transformChildren.push({
                    path: childPath,
                    name: childName || getPathBasename(childPath),
                });
            }
        }
        catch { }
        const extractMeshIndexFromName = (name) => {
            const normalizedName = String(name || '').toLowerCase();
            const match = normalizedName.match(/(?:^|_)mesh_(\d+)(?:$|_)/i);
            if (!match)
                return null;
            const parsedIndex = Number(match[1]);
            return Number.isFinite(parsedIndex) ? parsedIndex : null;
        };
        const normalizeLinkToken = (value) => {
            const normalized = String(value || '').trim().toLowerCase();
            if (!normalized)
                return '';
            return normalized.endsWith('_link') ? normalized.slice(0, -'_link'.length) : normalized;
        };
        const normalizedLinkName = String(proto.linkName || '').toLowerCase();
        const normalizedLinkStem = normalizeLinkToken(normalizedLinkName);
        const normalizedLinkToken = normalizeLinkToken(normalizedLinkName);
        const isLikelyLinkNameMatch = (childName) => {
            const normalizedChildName = String(childName || '').toLowerCase();
            if (!normalizedChildName)
                return false;
            if (normalizedChildName === normalizedLinkName || normalizedChildName === normalizedLinkStem)
                return true;
            if (normalizedLinkName && normalizedChildName.includes(normalizedLinkName))
                return true;
            if (!normalizedLinkStem)
                return false;
            return normalizedChildName.includes(`${normalizedLinkStem}_`) || normalizedChildName.startsWith(`${normalizedLinkStem}-`);
        };
        const isGenericMeshPath = (path) => /\/mesh_\d+(?:\/mesh)?$/i.test(String(path || ''));
        const buildFallbackSemanticChildrenFromMap = (candidateMap) => {
            if (!(candidateMap instanceof Map) || candidateMap.size === 0)
                return [];
            const semanticChildren = [];
            const semanticChildNameSet = new Set();
            const extractLinkAndChildFromFallbackPath = (fallbackPath) => {
                const normalizedFallbackPath = normalizeUsdPathToken(fallbackPath);
                if (!normalizedFallbackPath)
                    return null;
                const segments = normalizedFallbackPath.split('/').filter(Boolean);
                if (segments.length < 3)
                    return null;
                const leadingVisuals = String(segments[0] || '').toLowerCase() === 'visuals';
                if (leadingVisuals) {
                    return {
                        linkName: String(segments[1] || '').trim(),
                        childName: String(segments[2] || '').trim(),
                    };
                }
                const visualsIndex = segments.findIndex((segment) => String(segment || '').toLowerCase() === 'visuals');
                if (visualsIndex <= 0 || visualsIndex + 1 >= segments.length)
                    return null;
                return {
                    linkName: String(segments[visualsIndex - 1] || '').trim(),
                    childName: String(segments[visualsIndex + 1] || '').trim(),
                };
            };
            for (const [fallbackPath] of candidateMap.entries()) {
                const parsed = extractLinkAndChildFromFallbackPath(fallbackPath);
                if (!parsed)
                    continue;
                const fallbackLinkName = parsed.linkName;
                if (!fallbackLinkName)
                    continue;
                if (normalizeLinkToken(fallbackLinkName) !== normalizedLinkToken)
                    continue;
                const childName = parsed.childName;
                if (!childName)
                    continue;
                const childNameKey = childName.toLowerCase();
                if (semanticChildNameSet.has(childNameKey))
                    continue;
                const stagePathCandidates = [
                    `${proto.linkPath}/visuals/${childName}/mesh`,
                    `${proto.linkPath}/visuals/${childName}`,
                ];
                let stageResolvedPath = null;
                for (const candidatePath of stagePathCandidates) {
                    if (!candidatePath)
                        continue;
                    if (!this.safeGetPrimAtPath(stage, candidatePath))
                        continue;
                    stageResolvedPath = candidatePath;
                    break;
                }
                if (!stageResolvedPath)
                    continue;
                semanticChildNameSet.add(childNameKey);
                semanticChildren.push({
                    name: childName,
                    path: stageResolvedPath,
                });
            }
            return semanticChildren;
        };
        let fallbackSemanticChildrenCache = null;
        const getFallbackSemanticChildren = () => {
            if (fallbackSemanticChildrenCache) {
                return fallbackSemanticChildrenCache;
            }
            const rootLayerMap = this.enableXformOpFallbackFromLayerText === true
                ? this.getXformOpFallbackMapForCurrentStage()
                : (typeof this.getRootLayerXformOpFallbackMapForCurrentStage === 'function'
                    ? this.getRootLayerXformOpFallbackMapForCurrentStage()
                    : null);
            let semanticChildren = buildFallbackSemanticChildrenFromMap(rootLayerMap);
            // Root layer can be sparse (e.g. only `/`) while semantic child xformOps are
            // authored in referenced layers. Prefer a lightweight visuals-scope parser
            // before escalating to the full xform fallback scan.
            if (semanticChildren.length === 0
                && this.enableXformOpFallbackFromLayerText !== true) {
                const visualSemanticChildMap = typeof this.getVisualSemanticChildMapForCurrentStage === 'function'
                    ? this.getVisualSemanticChildMapForCurrentStage()
                    : null;
                if (visualSemanticChildMap instanceof Map && visualSemanticChildMap.size > 0) {
                    const visualChildren = [];
                    for (const [fallbackLinkName, childNames] of visualSemanticChildMap.entries()) {
                        if (normalizeLinkToken(fallbackLinkName) !== normalizedLinkToken)
                            continue;
                        if (!Array.isArray(childNames) || childNames.length === 0)
                            continue;
                        for (const childName of childNames) {
                            const normalizedChildName = String(childName || '').trim();
                            if (!normalizedChildName)
                                continue;
                            const stagePathCandidates = [
                                `${proto.linkPath}/visuals/${normalizedChildName}/mesh`,
                                `${proto.linkPath}/visuals/${normalizedChildName}`,
                            ];
                            let stageResolvedPath = null;
                            for (const candidatePath of stagePathCandidates) {
                                if (!candidatePath)
                                    continue;
                                if (!this.safeGetPrimAtPath(stage, candidatePath))
                                    continue;
                                stageResolvedPath = candidatePath;
                                break;
                            }
                            if (!stageResolvedPath)
                                continue;
                            if (visualChildren.some((child) => String(child.name || '').toLowerCase() === normalizedChildName.toLowerCase())) {
                                continue;
                            }
                            visualChildren.push({
                                name: normalizedChildName,
                                path: stageResolvedPath,
                            });
                        }
                    }
                    semanticChildren = visualChildren;
                }
                if (semanticChildren.length === 0) {
                    const fullLayerMap = this.getXformOpFallbackMapForCurrentStage();
                    if (fullLayerMap !== rootLayerMap) {
                        semanticChildren = buildFallbackSemanticChildrenFromMap(fullLayerMap);
                    }
                }
            }
            fallbackSemanticChildrenCache = semanticChildren;
            return semanticChildren;
        };
        let resolvedPath = null;
        const nameMatchedChild = transformChildren.find((child) => {
            const normalizedName = String(child.name || '').toLowerCase();
            if (normalizedName === `mesh_${proto.protoIndex}`)
                return true;
            const meshIndex = extractMeshIndexFromName(child.name);
            return meshIndex === proto.protoIndex;
        });
        if (nameMatchedChild?.path) {
            resolvedPath = nameMatchedChild.path;
        }
        // When child prim names are semantic (e.g. torso/head/logo, wrist/rubber_hand),
        // proto index 0 should map to the child that best matches the owning link name.
        if (!resolvedPath && proto.protoIndex === 0) {
            const linkMatchedChild = transformChildren.find((child) => isLikelyLinkNameMatch(child.name));
            if (linkMatchedChild?.path) {
                resolvedPath = linkMatchedChild.path;
            }
        }
        // Keep authored child order from USD instead of lexicographic sorting.
        // Sorting can swap semantic children and cause cross-link drift.
        if (!resolvedPath && proto.protoIndex >= 0 && proto.protoIndex < transformChildren.length) {
            resolvedPath = transformChildren[proto.protoIndex]?.path || null;
        }
        // If stage children are generic (`mesh_0`, `mesh_1`, ...), prefer semantic
        // visual child paths parsed from authored xformOps (`/visuals/<link>/<child>`).
        // This preserves per-submesh transforms for models that mix link-local and
        // world-space visual children (e.g. torso + head/logo style layouts).
        if (!resolvedPath || isGenericMeshPath(resolvedPath)) {
            const fallbackSemanticChildren = getFallbackSemanticChildren();
            if (fallbackSemanticChildren.length > 0) {
                if (proto.protoIndex === 0) {
                    const semanticLinkMatchedChild = fallbackSemanticChildren.find((child) => isLikelyLinkNameMatch(child.name));
                    if (semanticLinkMatchedChild?.path) {
                        resolvedPath = semanticLinkMatchedChild.path;
                    }
                }
                if ((!resolvedPath || isGenericMeshPath(resolvedPath)) && proto.protoIndex >= 0 && proto.protoIndex < fallbackSemanticChildren.length) {
                    resolvedPath = fallbackSemanticChildren[proto.protoIndex]?.path || resolvedPath;
                }
            }
        }
        if (!resolvedPath) {
            const fallbackCandidates = [
                ...buildProtoPrimPathCandidates(meshId),
                `${proto.containerPath}/mesh_${proto.protoIndex}`,
            ];
            for (const candidatePath of fallbackCandidates) {
                if (!candidatePath)
                    continue;
                if (!this.safeGetPrimAtPath(stage, candidatePath))
                    continue;
                resolvedPath = candidatePath;
                break;
            }
        }
        if (!resolvedPath && proto.protoIndex === 0 && transformChildren.length === 1) {
            resolvedPath = transformChildren[0].path;
        }
        if (!resolvedPath && proto.protoIndex === 0) {
            resolvedPath = proto.containerPath;
        }
        const scopedResolvedPath = this.getPrimPathIfWithinActiveStageRoot(resolvedPath || null);
        this._resolvedVisualPrimPathCache.set(meshId, scopedResolvedPath);
        return scopedResolvedPath;
    }
    shouldPreferResolvedVisualTransformForMeshId(meshId) {
        if (!meshId || !meshId.includes('.proto_'))
            return false;
        const proto = parseProtoMeshIdentifier(meshId);
        if (!proto || proto.sectionName !== 'visuals' || proto.protoType !== 'mesh' || !proto.linkPath) {
            return false;
        }
        const resolvedPath = this.getResolvedVisualTransformPrimPathForMeshId(meshId);
        if (!resolvedPath)
            return false;
        // Generic mesh_N paths typically still require link fallback composition.
        if (/\/mesh_\d+(?:\/mesh)?$/i.test(resolvedPath))
            return false;
        // Prefer semantic visual children authored under `<link>/visuals/<child>`.
        const semanticPrefix = `${proto.linkPath}/visuals/`;
        if (!resolvedPath.startsWith(semanticPrefix))
            return false;
        return true;
    }
    resolveProtoPrimPathFromStage(meshId) {
        const stage = this.getStage();
        if (!stage)
            return null;
        const proto = parseProtoMeshIdentifier(meshId);
        if (!proto)
            return null;
        const expectedTypes = getExpectedPrimTypesForCollisionProto(proto);
        if (expectedTypes.length === 0)
            return null;
        if (proto.sectionName === 'collisions' && proto.protoType === 'mesh') {
            const guideResolvedPath = this.resolveGuideCollisionPrimPath(meshId);
            if (guideResolvedPath)
                return guideResolvedPath;
        }
        const candidates = buildProtoPrimPathCandidates(meshId);
        for (const candidatePath of candidates) {
            const prim = this.getPrimAtPathAllowUnknown(stage, candidatePath);
            if (!prim)
                continue;
            const primType = getSafePrimTypeName(prim);
            if (!primType || !expectedTypes.includes(primType))
                continue;
            return candidatePath;
        }
        return null;
    }
    getStageGeometryCandidatePrimPathsForMeshId(meshId) {
        const normalizedMeshId = normalizeHydraPath(meshId);
        if (!normalizedMeshId)
            return [];
        const candidatePaths = [];
        const seenPaths = new Set();
        const addCandidate = (candidatePath) => {
            const normalizedPath = normalizeHydraPath(candidatePath);
            if (!normalizedPath || seenPaths.has(normalizedPath))
                return;
            seenPaths.add(normalizedPath);
            candidatePaths.push(normalizedPath);
        };
        if (normalizedMeshId.includes('.proto_')) {
            const proto = parseProtoMeshIdentifier(normalizedMeshId);
            if (proto?.sectionName === 'collisions') {
                addCandidate(this.getResolvedPrimPathForMeshId(normalizedMeshId));
            }
            else if (proto?.sectionName === 'visuals') {
                addCandidate(this.getResolvedVisualTransformPrimPathForMeshId(normalizedMeshId));
            }
            for (const candidatePath of buildProtoPrimPathCandidates(normalizedMeshId)) {
                addCandidate(candidatePath);
            }
            if (proto?.containerPath && Number.isFinite(proto.protoIndex)) {
                addCandidate(`${proto.containerPath}/mesh_${proto.protoIndex}`);
            }
        }
        else {
            addCandidate(normalizedMeshId);
        }
        return candidatePaths;
    }
    hydrateMissingMeshGeometryFromStage() {
        const stage = this.getStage();
        if (!stage) {
            return { attempted: 0, hydrated: 0, skippedReady: 0, durationMs: 0 };
        }
        const startedAt = (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
        let attempted = 0;
        let hydrated = 0;
        let skippedReady = 0;
        for (const mesh of Object.values(this.meshes)) {
            if (!mesh || typeof mesh._id !== 'string')
                continue;
            if (typeof mesh.applyResolvedPrimGeometry !== 'function')
                continue;
            const positionAttribute = mesh?._mesh?.geometry?.getAttribute?.('position');
            if (positionAttribute && Number(positionAttribute.count) > 0) {
                skippedReady += 1;
                continue;
            }
            const candidatePaths = this.getStageGeometryCandidatePrimPathsForMeshId(mesh._id);
            if (candidatePaths.length === 0)
                continue;
            attempted += 1;
            for (const candidatePath of candidatePaths) {
                let geometryApplied = false;
                try {
                    geometryApplied = mesh.applyResolvedPrimGeometry(candidatePath) === true;
                }
                catch {
                    geometryApplied = false;
                }
                if (!geometryApplied)
                    continue;
                if (typeof mesh.syncProtoTransformFromFallback === 'function') {
                    mesh.syncProtoTransformFromFallback();
                }
                if (typeof mesh.syncCollisionRotationFromVisualLink === 'function') {
                    mesh.syncCollisionRotationFromVisualLink();
                }
                hydrated += 1;
                break;
            }
        }
        const finishedAt = (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
        return {
            attempted,
            hydrated,
            skippedReady,
            durationMs: Math.max(0, finishedAt - startedAt),
        };
    }
    invalidateStageCaches(options = {}) {
        const preserveResolvedPrimCaches = options?.preserveResolvedPrimCaches === true;
        const preserveDriverCaches = options?.preserveDriverCaches === true;
        const preserveRuntimeBridgeCaches = options?.preserveRuntimeBridgeCaches === true;
        this._stageOverrideProtoMeshCache = null;
        if (!preserveRuntimeBridgeCaches) {
            this._localXformCache.clear();
            if (this._localXformResetsStackCache instanceof Map) {
                this._localXformResetsStackCache.clear();
            }
            if (this._localXformAuthoredOpsCache instanceof Map) {
                this._localXformAuthoredOpsCache.clear();
            }
            this._worldXformCache.clear();
            if (this._worldXformCacheSourceByPath instanceof Map) {
                this._worldXformCacheSourceByPath.clear();
            }
            // Transform caches were cleared, so batch-prime state must be reset.
            // Otherwise future prefetchPrimTransformsFromDriver(force=false) calls may
            // incorrectly short-circuit with empty caches and trigger slow per-prim fallback.
            this._primTransformBatchPrimed = false;
            this._primPathExistenceCache.clear();
            this._knownPrimPathSet = null;
            this._knownPrimPathSetPrimed = false;
        }
        this._meshFallbackCache.clear();
        if (this._stageFallbackMaterialCache instanceof Map) {
            this._stageFallbackMaterialCache.clear();
        }
        if (!preserveRuntimeBridgeCaches) {
            if (this._snapshotMaterialRecordById instanceof Map) {
                this._snapshotMaterialRecordById.clear();
            }
            if (this._snapshotMaterialIdsByStageSource instanceof Map) {
                this._snapshotMaterialIdsByStageSource.clear();
            }
            if (this._snapshotFallbackMaterialCache instanceof Map) {
                this._snapshotFallbackMaterialCache.clear();
            }
            if (this._snapshotTextureApplyFailures instanceof Map) {
                this._snapshotTextureApplyFailures.clear();
            }
        }
        if (!preserveResolvedPrimCaches) {
            this._resolvedProtoPrimPathCache.clear();
            this._resolvedVisualPrimPathCache.clear();
        }
        this._xformOpFallbackMapByStageSource.clear();
        this._rootLayerXformOpFallbackMapByStageSource.clear();
        this._linkVisualTransformCache.clear();
        this._guideCollisionPrimPathCache.clear();
        this._guideCollisionRefMapByStageSource.clear();
        this._visualSemanticChildMapByStageSource.clear();
        this.disposeOpenedGuideStages();
        if (!preserveDriverCaches) {
            this._protoDataBlobBatchCache.clear();
            this._protoDataBlobBatchPrimed = false;
            this._collisionProtoOverrideCache.clear();
            this._collisionProtoOverrideBatchPrimed = false;
            this._visualProtoOverrideCache.clear();
            this._visualProtoOverrideBatchPrimed = false;
            this._finalStageOverrideBatchCache.clear();
            this._finalStageOverrideBatchPrimed = false;
            this._finalStageOverrideBatchProtoMeshCount = 0;
            this._primOverrideDataCache.clear();
        }
        this._urdfLinkWorldTransformCacheByStageSource.clear();
        this._urdfVisualFallbackDecisionCache.clear();
        this._urdfVisualFallbackLinkDecisionCache.clear();
        this._preferredVisualMaterialByLinkCache.clear();
        this._resolvedDriverStage = null;
        this._pendingDriverStagePromise = null;
        this._hasRunStageTruthAlignmentDiagnostics = false;
        if (!preserveResolvedPrimCaches && !preserveDriverCaches && !preserveRuntimeBridgeCaches) {
            this._runtimeBridgeCacheStageKey = null;
        }
        this.flushMaterialBindingApiWarningSummary();
    }
    refreshMeshStageOverrides(options = {}) {
        const stage = this.getStage();
        const includeCollision = options?.includeCollision !== false;
        const includeVisual = options?.includeVisual !== false;
        const prefetchFinalStageBatch = options?.prefetchFinalStageBatch !== false;
        const forceFinalStageBatchRefresh = options?.forceFinalStageBatchRefresh === true;
        const allowPerMeshFallback = options?.allowPerMeshFallback !== false;
        const reuseProtoMeshCache = options?.reuseProtoMeshCache !== false;
        const startIndexRaw = Number(options?.startIndex);
        const startIndex = Number.isFinite(startIndexRaw) ? Math.max(0, Math.floor(startIndexRaw)) : 0;
        const chunkSizeRaw = Number(options?.chunkSize);
        const chunkSize = Number.isFinite(chunkSizeRaw) && chunkSizeRaw > 0
            ? Math.max(1, Math.floor(chunkSizeRaw))
            : Number.POSITIVE_INFINITY;
        const stageSourcePath = String(this.getStageSourcePath() || '').split('?')[0];
        const hasSceneSnapshot = typeof this.hasResolvedRobotSceneSnapshot === 'function' && this.hasResolvedRobotSceneSnapshot(stageSourcePath);
        if (startIndex === 0) {
            const canPreserveRuntimeBridgeCaches = !!stageSourcePath && (hasSceneSnapshot
                || stageSourcePath === String(this._runtimeBridgeCacheStageKey || ''));
            this.invalidateStageCaches({
                preserveResolvedPrimCaches: canPreserveRuntimeBridgeCaches,
                preserveDriverCaches: canPreserveRuntimeBridgeCaches,
                preserveRuntimeBridgeCaches: canPreserveRuntimeBridgeCaches,
            });
            if (!this.suppressMaterialBindingApiWarnings && stage) {
                this.tryRepairMaterialBindingApiSchemas();
            }
            this.pruneSyntheticTopLevelMeshes();
        }
        const meshMutationVersion = Number(this._meshMutationVersion || 0);
        const cachedProtoMeshState = this._stageOverrideProtoMeshCache;
        const canUseCachedProtoMeshes = (reuseProtoMeshCache
            && startIndex > 0
            && cachedProtoMeshState
            && Array.isArray(cachedProtoMeshState.meshes)
            && Number(cachedProtoMeshState.meshMutationVersion || 0) === meshMutationVersion);
        const protoMeshes = canUseCachedProtoMeshes
            ? cachedProtoMeshState.meshes
            : Object.values(this.meshes || {}).filter((mesh) => !!mesh && typeof mesh._id === 'string' && mesh._id.includes('.proto_'));
        if (reuseProtoMeshCache) {
            this._stageOverrideProtoMeshCache = {
                meshMutationVersion,
                meshes: protoMeshes,
            };
        }
        const resolvedDriver = typeof this.config?.driver === 'function'
            ? this.config.driver()
            : null;
        let finalStageBatchEntries = null;
        let finalStageBatchEnabled = false;
        if (!hasSceneSnapshot && prefetchFinalStageBatch && resolvedDriver && typeof this.prefetchFinalStageOverrideBatchFromDriver === 'function') {
            try {
                const batchSummary = this.prefetchFinalStageOverrideBatchFromDriver(resolvedDriver, {
                    force: forceFinalStageBatchRefresh || startIndex === 0,
                }) || {};
                const batchSource = String(batchSummary?.source || '');
                const batchEntries = batchSummary?.entries;
                if (batchEntries instanceof Map
                    && batchEntries.size > 0
                    && batchSource !== 'single-only'
                    && batchSource !== 'error') {
                    finalStageBatchEntries = batchEntries;
                    finalStageBatchEnabled = true;
                }
            }
            catch { }
        }
        else if (this._finalStageOverrideBatchCache instanceof Map && this._finalStageOverrideBatchCache.size > 0) {
            finalStageBatchEntries = this._finalStageOverrideBatchCache;
            finalStageBatchEnabled = true;
        }
        if (!stage && !finalStageBatchEnabled)
            return;
        const finalStageBatchProtoMeshCount = Number(this._finalStageOverrideBatchProtoMeshCount || 0);
        const finalStageBatchCoverageLikelyFull = (finalStageBatchEnabled
            && finalStageBatchProtoMeshCount > 0
            && finalStageBatchEntries instanceof Map
            && finalStageBatchEntries.size >= finalStageBatchProtoMeshCount);
        let nextIndex = startIndex;
        let processed = 0;
        let appliedByBatchCount = 0;
        let appliedByFallbackCount = 0;
        let skippedFallbackCount = 0;
        for (let meshIndex = startIndex; meshIndex < protoMeshes.length; meshIndex++) {
            if (processed >= chunkSize)
                break;
            const mesh = protoMeshes[meshIndex];
            if (!mesh || typeof mesh._id !== 'string' || !mesh._id.includes('.proto_'))
                continue;
            try {
                const isCollisionProto = typeof mesh.isCollisionProtoMesh === 'function' ? mesh.isCollisionProtoMesh() : false;
                if (isCollisionProto && !includeCollision)
                    continue;
                if (!isCollisionProto && !includeVisual)
                    continue;
                let appliedByFinalStageBatch = false;
                if (finalStageBatchEnabled && finalStageBatchEntries) {
                    const finalOverride = finalStageBatchEntries.get(mesh._id) || null;
                    if (finalOverride?.valid === true) {
                        if (typeof mesh.applyFinalStageOverrideFromDriver === 'function') {
                            appliedByFinalStageBatch = mesh.applyFinalStageOverrideFromDriver(finalOverride, {
                                skipTransformFallback: true,
                                skipCollisionRotationFallback: true,
                            }) === true;
                        }
                        else if (isCollisionProto
                            && typeof mesh.applyCollisionGeometryFromDriverOverride === 'function') {
                            appliedByFinalStageBatch = mesh.applyCollisionGeometryFromDriverOverride(finalOverride) === true;
                        }
                        if (appliedByFinalStageBatch) {
                            appliedByBatchCount += 1;
                        }
                    }
                }
                // Missing/failed final-batch entries must still fall back per-mesh.
                // Otherwise models that lack full batch coverage (e.g. analytic collision
                // primitives or deferred visual sync) can end up with empty placeholders.
                if (!appliedByFinalStageBatch) {
                    if (!allowPerMeshFallback && finalStageBatchEnabled) {
                        skippedFallbackCount += 1;
                        continue;
                    }
                    const collisionOverride = isCollisionProto
                        ? this.getCollisionProtoOverride?.(mesh._id)
                        : null;
                    const primPath = isCollisionProto
                        ? normalizeHydraPath(this.getResolvedPrimPathForMeshId(mesh._id) || collisionOverride?.resolvedPrimPath)
                        : null;
                    const shouldSkipCollisionReapply = (isCollisionProto
                        && primPath
                        && typeof mesh.hasAppliedCollisionOverrideForPrimPath === 'function'
                        && mesh.hasAppliedCollisionOverrideForPrimPath(primPath) === true);
                    let collisionOverrideApplied = false;
                    if (isCollisionProto
                        && collisionOverride?.valid === true
                        && !shouldSkipCollisionReapply
                        && typeof mesh.applyCollisionGeometryFromDriverOverride === 'function') {
                        collisionOverrideApplied = mesh.applyCollisionGeometryFromDriverOverride(collisionOverride) === true;
                    }
                    let overrideTransformMismatchedResolved = false;
                    if (isCollisionProto
                        && collisionOverrideApplied
                        && primPath
                        && mesh?._mesh?.matrix) {
                        try {
                            const resolvedTransform = this.getWorldTransformForPrimPath(primPath, { clone: false });
                            if (resolvedTransform) {
                                const delta = getMatrixMaxElementDelta(mesh._mesh.matrix, resolvedTransform);
                                overrideTransformMismatchedResolved = Number.isFinite(delta) && delta > 1e-3;
                            }
                        }
                        catch {
                            overrideTransformMismatchedResolved = false;
                        }
                    }
                    const needsResolvedPrimFallback = (isCollisionProto
                        && primPath
                        && !shouldSkipCollisionReapply
                        && typeof mesh.applyResolvedPrimGeometryAndTransform === 'function'
                        && (!collisionOverrideApplied
                            || (typeof mesh.hasAppliedCollisionOverrideForPrimPath === 'function'
                                && mesh.hasAppliedCollisionOverrideForPrimPath(primPath) !== true)
                            || overrideTransformMismatchedResolved));
                    if (needsResolvedPrimFallback) {
                        mesh.applyResolvedPrimGeometryAndTransform(primPath);
                    }
                    else if (!isCollisionProto
                        && typeof mesh.tryApplyProtoDataBlobFastPath === 'function') {
                        let visualApplied = false;
                        try {
                            visualApplied = mesh.tryApplyProtoDataBlobFastPath() === true;
                        }
                        catch {
                            visualApplied = false;
                        }
                        if (visualApplied && Object.prototype.hasOwnProperty.call(mesh, '_hasCompletedProtoSync')) {
                            mesh._hasCompletedProtoSync = true;
                        }
                    }
                    if (typeof mesh.syncProtoTransformFromFallback === 'function') {
                        mesh.syncProtoTransformFromFallback();
                    }
                    if (isCollisionProto && typeof mesh.syncCollisionRotationFromVisualLink === 'function') {
                        mesh.syncCollisionRotationFromVisualLink();
                    }
                    appliedByFallbackCount += 1;
                }
            }
            catch { }
            processed += 1;
            nextIndex = meshIndex + 1;
        }
        const done = nextIndex >= protoMeshes.length;
        if (done && options?.skipDiagnostics !== true) {
            this.runStageTruthAlignmentDiagnostics();
        }
        return {
            done,
            nextIndex,
            processed,
            total: protoMeshes.length,
            appliedByBatch: appliedByBatchCount,
            appliedByFallback: appliedByFallbackCount,
            skippedFallback: skippedFallbackCount,
            finalBatchCoverageLikelyFull: finalStageBatchCoverageLikelyFull,
        };
    }
    getVisualColorOverride(meshId) {
        if (!meshId || !this.modelOverrides)
            return null;
        const value = this.modelOverrides.visualColorByMeshId?.[meshId];
        if (!Array.isArray(value) || value.length < 3)
            return null;
        const r = toFiniteNumber(value[0]);
        const g = toFiniteNumber(value[1]);
        const b = toFiniteNumber(value[2]);
        if (r === undefined || g === undefined || b === undefined)
            return null;
        return [clamp01(r), clamp01(g), clamp01(b)];
    }
    getCollisionLocalXformOverride(meshId) {
        if (!meshId || !this.modelOverrides)
            return null;
        const value = this.modelOverrides.collisionLocalXformByMeshId?.[meshId];
        if (!value || typeof value !== 'object')
            return null;
        const translateSource = toArrayLike(value.translate);
        const orientSource = toArrayLike(value.orient);
        const scaleSource = toArrayLike(value.scale);
        if (!translateSource || translateSource.length < 3 || !orientSource || orientSource.length < 4 || !scaleSource || scaleSource.length < 3) {
            return null;
        }
        const tx = toFiniteNumber(translateSource[0]);
        const ty = toFiniteNumber(translateSource[1]);
        const tz = toFiniteNumber(translateSource[2]);
        const qw = toFiniteNumber(orientSource[0]);
        const qx = toFiniteNumber(orientSource[1]);
        const qy = toFiniteNumber(orientSource[2]);
        const qz = toFiniteNumber(orientSource[3]);
        const sx = toFiniteNumber(scaleSource[0]);
        const sy = toFiniteNumber(scaleSource[1]);
        const sz = toFiniteNumber(scaleSource[2]);
        if (tx === undefined || ty === undefined || tz === undefined ||
            qw === undefined || qx === undefined || qy === undefined || qz === undefined ||
            sx === undefined || sy === undefined || sz === undefined) {
            return null;
        }
        const orientation = new Quaternion(qx, qy, qz, qw);
        if (orientation.lengthSq() <= 1e-12 || !Number.isFinite(orientation.lengthSq())) {
            return null;
        }
        orientation.normalize();
        const linkPath = typeof value.linkPath === 'string' && value.linkPath.startsWith('/') ? value.linkPath : null;
        return {
            linkPath,
            translation: new Vector3(tx, ty, tz),
            orientation,
            scale: new Vector3(sx, sy, sz),
        };
    }
    getUrdfVisualFallbackDecisionForLink(linkPath) {
        if (!linkPath || !linkPath.startsWith('/'))
            return false;
        if (this._urdfVisualFallbackLinkDecisionCache.has(linkPath)) {
            return this._urdfVisualFallbackLinkDecisionCache.get(linkPath) === true;
        }
        const currentLinkFrameMatrix = this.getVisualLinkFrameTransform(linkPath) || null;
        const urdfLinkWorldMatrix = this.getUrdfLinkWorldTransformFromJointChain(linkPath) || null;
        const stageLinkWorldMatrix = this.getWorldTransformForPrimPath(linkPath) || null;
        const looksDegenerate = (matrix) => !matrix || (isMatrixApproximatelyIdentity(matrix) && !hasNonZeroTranslation(matrix));
        const looksAuthored = (matrix) => !!matrix && (!isMatrixApproximatelyIdentity(matrix) || hasNonZeroTranslation(matrix));
        let shouldUseFallback = false;
        if (!urdfLinkWorldMatrix) {
            shouldUseFallback = false;
        }
        else if (looksDegenerate(currentLinkFrameMatrix) && looksAuthored(urdfLinkWorldMatrix)) {
            shouldUseFallback = true;
        }
        else if (looksDegenerate(stageLinkWorldMatrix) && looksAuthored(urdfLinkWorldMatrix)) {
            shouldUseFallback = true;
        }
        else if (currentLinkFrameMatrix && urdfLinkWorldMatrix) {
            const deltaCurrentUrdf = getMatrixMaxElementDelta(currentLinkFrameMatrix, urdfLinkWorldMatrix);
            shouldUseFallback = deltaCurrentUrdf > 0.25;
        }
        this._urdfVisualFallbackLinkDecisionCache.set(linkPath, shouldUseFallback);
        return shouldUseFallback;
    }
    shouldUseUrdfVisualFallbackForMesh(meshId) {
        const proto = parseProtoMeshIdentifier(meshId);
        if (!proto || proto.sectionName !== 'visuals')
            return false;
        if (this._urdfVisualFallbackDecisionCache.has(meshId)) {
            return this._urdfVisualFallbackDecisionCache.get(meshId) === true;
        }
        if (this.config?.forceUrdfVisualFallback === false)
            return false;
        if (this.config?.forceUrdfVisualFallback === true)
            return true;
        const linkPath = proto.linkPath;
        if (!linkPath)
            return false;
        const urdfLinkWorldMatrix = this.getUrdfLinkWorldTransformFromJointChain(linkPath) || null;
        const urdfVisualEntry = this.getUrdfVisualEntryForMeshId(meshId);
        const hasUrdfVisualLocalMatrix = !!urdfVisualEntry?.localMatrix;
        if (!urdfLinkWorldMatrix) {
            this._urdfVisualFallbackDecisionCache.set(meshId, false);
            return false;
        }
        const looksAuthored = (matrix) => !!matrix && (!isMatrixApproximatelyIdentity(matrix) || hasNonZeroTranslation(matrix));
        const looksDegenerate = (matrix) => !looksAuthored(matrix);
        const stageLinkWorldMatrix = this.getWorldTransformForPrimPath(linkPath) || null;
        const resolvedVisualPrimPath = this.getResolvedVisualTransformPrimPathForMeshId(meshId);
        const resolvedVisualWorldMatrix = resolvedVisualPrimPath
            ? this.getWorldTransformForPrimPath(resolvedVisualPrimPath)
            : null;
        const resolvedLooksAuthored = looksAuthored(resolvedVisualWorldMatrix);
        const stageLooksAuthored = looksAuthored(stageLinkWorldMatrix);
        if (!hasUrdfVisualLocalMatrix && proto.protoIndex > 0) {
            this._urdfVisualFallbackDecisionCache.set(meshId, false);
            return false;
        }
        if (resolvedLooksAuthored) {
            if (hasUrdfVisualLocalMatrix && stageLinkWorldMatrix) {
                const resolvedLocalVisualMatrix = stageLinkWorldMatrix.clone().invert().multiply(resolvedVisualWorldMatrix.clone());
                const resolvedLocalLooksBroken = looksDegenerate(resolvedLocalVisualMatrix);
                const urdfLocalLooksAuthored = looksAuthored(urdfVisualEntry.localMatrix);
                let shouldFallback = resolvedLocalLooksBroken && urdfLocalLooksAuthored;
                if (!shouldFallback) {
                    const resolvedLocalPosition = new Vector3();
                    const resolvedLocalQuaternion = new Quaternion();
                    const resolvedLocalScale = new Vector3();
                    resolvedLocalVisualMatrix.decompose(resolvedLocalPosition, resolvedLocalQuaternion, resolvedLocalScale);
                    const urdfLocalPosition = new Vector3();
                    const urdfLocalQuaternion = new Quaternion();
                    const urdfLocalScale = new Vector3();
                    urdfVisualEntry.localMatrix.decompose(urdfLocalPosition, urdfLocalQuaternion, urdfLocalScale);
                    const localMatrixDelta = getMatrixMaxElementDelta(resolvedLocalVisualMatrix, urdfVisualEntry.localMatrix);
                    const translationDelta = resolvedLocalPosition.distanceTo(urdfLocalPosition);
                    const urdfLocalHasRotation = !isIdentityQuaternion(urdfLocalQuaternion);
                    const resolvedLocalHasRotation = !isIdentityQuaternion(resolvedLocalQuaternion);
                    // Some USD stages resolve a semantic visual prim with the same pivot as the
                    // URDF visual, but inject an extra basis rotation once the real mesh arrives.
                    // Prefer the URDF local pose when the authored local offset is effectively the
                    // same translation and only the stage-local rotation diverges.
                    shouldFallback = localMatrixDelta > 1e-4
                        && translationDelta <= 1e-3
                        && !urdfLocalHasRotation
                        && resolvedLocalHasRotation;
                }
                this._urdfVisualFallbackDecisionCache.set(meshId, shouldFallback);
                return shouldFallback;
            }
            this._urdfVisualFallbackDecisionCache.set(meshId, false);
            return false;
        }
        let shouldFallback = false;
        if (hasUrdfVisualLocalMatrix) {
            shouldFallback = true;
        }
        else if (proto.protoIndex === 0) {
            shouldFallback = !stageLooksAuthored;
        }
        this._urdfVisualFallbackDecisionCache.set(meshId, shouldFallback);
        return shouldFallback;
    }
    shouldTreatNamedHexDiffuseAsSrgb() {
        // By default keep named hex diffuse values in authored linear space.
        // This avoids over-darkening colors like material_333333 on Unitree G1.
        if (this.config?.forceNamedHexDiffuseAsSrgb === true)
            return true;
        return false;
    }
    shouldUseAggressiveVisualFallbackSync(meshId) {
        const proto = parseProtoMeshIdentifier(meshId);
        if (!proto || proto.sectionName !== 'visuals' || proto.protoType !== 'mesh' || proto.protoIndex <= 0) {
            return false;
        }
        const resolvedVisualPrimPath = this.getResolvedVisualTransformPrimPathForMeshId(meshId);
        if (!resolvedVisualPrimPath)
            return false;
        const resolvedVisualWorldMatrix = this.getWorldTransformForPrimPath(resolvedVisualPrimPath);
        const fallbackTransform = this.getSafeFallbackTransformForMeshId(meshId);
        if (!resolvedVisualWorldMatrix || !fallbackTransform)
            return false;
        const resolvedHasAuthoredTransform = !isMatrixApproximatelyIdentity(resolvedVisualWorldMatrix)
            || hasNonZeroTranslation(resolvedVisualWorldMatrix);
        if (!resolvedHasAuthoredTransform)
            return false;
        const resolvedVsFallbackDelta = getMatrixMaxElementDelta(resolvedVisualWorldMatrix, fallbackTransform);
        return resolvedVsFallbackDelta > 1e-4;
    }
    getStage() {
        if (this._resolvedDriverStage) {
            return this._resolvedDriverStage;
        }
        if (typeof this.config.stage === 'function') {
            try {
                const staged = this.config.stage();
                if (staged) {
                    this._resolvedDriverStage = staged;
                    this.setDriverStageResolveState('resolved', { source: 'config-stage' });
                    return staged;
                }
            }
            catch { }
        }
        if (this.allowDriverStageLookup === false)
            return null;
        const shouldSkipDriverStageLookup = this.deferDriverStageLookupInSyncHotPath !== false
            && this.isHydraSyncHotPathActive?.() === true;
        if (shouldSkipDriverStageLookup)
            return null;
        if (!this.config.driver)
            return null;
        const driver = this.config.driver();
        if (!driver || !driver.GetStage)
            return null;
        const stage = driver.GetStage();
        const isAsyncStage = !!stage && typeof stage.then === 'function';
        if (isAsyncStage) {
            if (!this._pendingDriverStagePromise) {
                this.setDriverStageResolveState('pending', { source: 'driver-async' });
                this._pendingDriverStagePromise = Promise.resolve(stage)
                    .then((resolvedStage) => {
                    const maybeSyncStage = driver.GetStage?.();
                    const candidateStage = (maybeSyncStage && typeof maybeSyncStage.then !== 'function'
                        ? maybeSyncStage
                        : resolvedStage) || null;
                    if (!candidateStage || typeof candidateStage.then === 'function') {
                        return null;
                    }
                    this._resolvedDriverStage = candidateStage;
                    this.setDriverStageResolveState('resolved', { source: 'driver-async' });
                    if (typeof this.config?.setStage === 'function') {
                        try {
                            this.config.setStage(candidateStage);
                        }
                        catch { }
                    }
                    return candidateStage;
                })
                    .catch((error) => {
                    this.setDriverStageResolveState('rejected', {
                        source: 'driver-async',
                        error,
                    });
                    rawConsoleWarn?.('[HydraDelegate] Failed to resolve async driver stage; falling back to deferred stage lookup.', error);
                    return null;
                })
                    .finally(() => {
                    this._pendingDriverStagePromise = null;
                    if (this._driverStageResolveState === 'pending') {
                        this.setDriverStageResolveState('idle', { source: 'driver-async' });
                    }
                });
            }
            return null;
        }
        if (!stage)
            return null;
        this._resolvedDriverStage = stage;
        this.setDriverStageResolveState('resolved', { source: 'driver-sync' });
        if (typeof this.config?.setStage === 'function') {
            try {
                this.config.setStage(stage);
            }
            catch { }
        }
        return stage;
    }
    resolveMaterialIdForMesh(materialId, meshId) {
        const normalizedMaterialId = normalizeHydraPath(materialId);
        if (!normalizedMaterialId)
            return null;
        const candidates = [];
        const addCandidate = (candidatePath) => {
            const normalized = normalizeHydraPath(candidatePath);
            if (!normalized || candidates.includes(normalized))
                return;
            candidates.push(normalized);
        };
        addCandidate(normalizedMaterialId);
        const looksMarkerIndex = normalizedMaterialId.toLowerCase().indexOf('/looks/');
        const looksSuffix = looksMarkerIndex >= 0 ? normalizedMaterialId.slice(looksMarkerIndex) : '';
        const materialBasename = getPathBasename(normalizedMaterialId);
        const proto = parseProtoMeshIdentifier(meshId);
        const meshRootPath = proto?.linkPath ? getRootPathFromPrimPath(proto.linkPath) : null;
        if (meshRootPath) {
            if (looksSuffix)
                addCandidate(`${meshRootPath}${looksSuffix}`);
            if (materialBasename)
                addCandidate(`${meshRootPath}/Looks/${materialBasename}`);
            if (materialBasename)
                addCandidate(`${meshRootPath}/looks/${materialBasename}`);
        }
        const stagePath = String(this.getNormalizedStageSourcePath() || '');
        const stageFileName = stagePath.split('/').pop() || '';
        const stageRootStem = stageFileName.replace(/\.usd[a-z]?$/i, '');
        if (stageRootStem) {
            if (looksSuffix)
                addCandidate(`/${stageRootStem}${looksSuffix}`);
            if (materialBasename)
                addCandidate(`/${stageRootStem}/Looks/${materialBasename}`);
        }
        const stage = this.getStage();
        for (const candidate of candidates) {
            if (this.materials[candidate])
                return candidate;
            if (this._snapshotMaterialRecordById instanceof Map && this._snapshotMaterialRecordById.has(candidate)) {
                return candidate;
            }
            if (stage && this.safeGetPrimAtPath(stage, candidate)) {
                return candidate;
            }
        }
        return normalizedMaterialId;
    }
    getOrCreateMaterialById(materialId, meshId = null) {
        const normalizedMaterialId = normalizeHydraPath(materialId);
        if (!normalizedMaterialId)
            return null;
        const resolvedMaterialId = this.resolveMaterialIdForMesh(normalizedMaterialId, meshId) || normalizedMaterialId;
        const existingMaterial = this.materials[resolvedMaterialId] || this.materials[normalizedMaterialId];
        if (existingMaterial)
            return existingMaterial;
        const fallbackMaterial = this.createFallbackMaterialFromSnapshot(resolvedMaterialId)
            || (resolvedMaterialId !== normalizedMaterialId ? this.createFallbackMaterialFromSnapshot(normalizedMaterialId) : null)
            || this.createFallbackMaterialFromStage(resolvedMaterialId);
        if (!fallbackMaterial)
            return null;
        this.materials[resolvedMaterialId] = fallbackMaterial;
        if (resolvedMaterialId !== normalizedMaterialId) {
            this.materials[normalizedMaterialId] = fallbackMaterial;
        }
        return fallbackMaterial;
    }
    normalizeSnapshotMaterialRecords(rawRecords, options = {}) {
        const records = Array.isArray(rawRecords)
            ? rawRecords
            : (rawRecords && typeof rawRecords.length === 'number' ? Array.from(rawRecords) : []);
        const normalizedStageSourcePath = String(options?.stageSourcePath || this.getStageSourcePath() || '').trim().split('?')[0] || null;
        const normalizeScalar = (value, config = {}) => {
            const numeric = toFiniteNumber(value);
            if (numeric === undefined)
                return null;
            let normalized = numeric;
            if (config.clamp01)
                normalized = clamp01(normalized);
            if (Number.isFinite(config.min))
                normalized = Math.max(Number(config.min), normalized);
            if (Number.isFinite(config.max))
                normalized = Math.min(Number(config.max), normalized);
            return normalized;
        };
        const normalizeColor = (value) => {
            const color = toColorArray(value);
            if (!color)
                return null;
            return [Number(color[0] || 0), Number(color[1] || 0), Number(color[2] || 0)];
        };
        const normalizeColorSpace = (value) => {
            const normalized = String(value || '').trim();
            return normalized || null;
        };
        const normalizeColorSource = (value) => {
            const normalized = String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
            if (!normalized)
                return null;
            if (normalized === 'author' || normalized === 'authored' || normalized === 'shader') {
                return 'authored';
            }
            if (normalized === 'material-name' || normalized === 'materialname' || normalized === 'name') {
                return 'material-name';
            }
            if (normalized === 'display-color' || normalized === 'displaycolor') {
                return 'display-color';
            }
            return normalized;
        };
        const colorMatchesHex = (color, hex) => {
            if (!Array.isArray(color) || !Number.isFinite(hex))
                return false;
            const epsilon = 1 / 255 + 1e-4;
            return Math.abs(Number(color[0]) - (((hex >> 16) & 0xff) / 255)) <= epsilon
                && Math.abs(Number(color[1]) - (((hex >> 8) & 0xff) / 255)) <= epsilon
                && Math.abs(Number(color[2]) - ((hex & 0xff) / 255)) <= epsilon;
        };
        const normalizeVec2 = (value) => {
            const tuple = toFiniteVector2Tuple(value)
                || (() => {
                    const scalar = toFiniteNumber(value);
                    if (scalar === undefined)
                        return null;
                    return [scalar, scalar];
                })();
            if (!tuple)
                return null;
            return [Number(tuple[0] || 0), Number(tuple[1] || 0)];
        };
        const normalizeTexturePath = (value) => {
            const normalized = this.normalizeMaterialTexturePath(value);
            return normalized || null;
        };
        return records
            .map((rawRecord) => {
            if (!rawRecord || typeof rawRecord !== 'object')
                return null;
            const materialId = normalizeHydraPath(rawRecord.materialId || rawRecord.id || '');
            if (!materialId)
                return null;
            const name = String(rawRecord.name || materialId.split('/').filter(Boolean).pop() || materialId).trim();
            const authoredOrRawColor = normalizeColor(rawRecord.color);
            const rawColorSource = normalizeColorSource(rawRecord.colorSource);
            const colorSpace = rawColorSource === 'authored'
                ? 'linear'
                : normalizeColorSpace(rawRecord.colorSpace);
            const inferredColorHex = this.inferColorHexFromMaterialName(name);
            const inferredColor = Number.isFinite(inferredColorHex)
                ? [
                    ((inferredColorHex >> 16) & 0xff) / 255,
                    ((inferredColorHex >> 8) & 0xff) / 255,
                    (inferredColorHex & 0xff) / 255,
                ]
                : null;
            const hasShaderColorEvidence = Boolean(rawRecord.shaderPath
                || rawRecord.shaderName
                || rawRecord.shaderInfoId
                || rawRecord.isOmniPbr === true
                || rawRecord.colorSpace
                || rawRecord.roughness != null
                || rawRecord.metalness != null
                || rawRecord.opacity != null
                || rawRecord.mapPath);
            const resolvedColorSource = authoredOrRawColor
                ? (rawColorSource
                    || (colorMatchesHex(authoredOrRawColor, inferredColorHex) && !hasShaderColorEvidence
                        ? 'material-name'
                        : 'authored'))
                : (inferredColor ? 'material-name' : null);
            const authoredColor = authoredOrRawColor && resolvedColorSource !== 'material-name'
                ? authoredOrRawColor.slice(0, 3)
                : null;
            const normalizedRecord = {
                materialId,
                name,
                stageSourcePath: normalizedStageSourcePath,
                shaderPath: normalizeHydraPath(rawRecord.shaderPath || '') || null,
                shaderName: String(rawRecord.shaderName || '').trim() || null,
                shaderInfoId: String(rawRecord.shaderInfoId || '').trim() || null,
                isOmniPbr: rawRecord.isOmniPbr === true,
                opacityEnabled: typeof rawRecord.opacityEnabled === 'boolean' ? rawRecord.opacityEnabled : null,
                opacityTextureEnabled: typeof rawRecord.opacityTextureEnabled === 'boolean' ? rawRecord.opacityTextureEnabled : null,
                emissiveEnabled: typeof rawRecord.emissiveEnabled === 'boolean' ? rawRecord.emissiveEnabled : null,
                color: authoredOrRawColor || inferredColor,
                colorSpace,
                colorSource: resolvedColorSource,
                authoredColor,
                authoredColorSpace: authoredColor ? colorSpace : null,
                emissive: normalizeColor(rawRecord.emissive),
                emissiveColorSpace: normalizeColorSpace(rawRecord.emissiveColorSpace),
                specularColor: normalizeColor(rawRecord.specularColor),
                specularColorSpace: normalizeColorSpace(rawRecord.specularColorSpace),
                attenuationColor: normalizeColor(rawRecord.attenuationColor),
                attenuationColorSpace: normalizeColorSpace(rawRecord.attenuationColorSpace),
                sheenColor: normalizeColor(rawRecord.sheenColor),
                sheenColorSpace: normalizeColorSpace(rawRecord.sheenColorSpace),
                normalScale: normalizeVec2(rawRecord.normalScale),
                clearcoatNormalScale: normalizeVec2(rawRecord.clearcoatNormalScale),
                roughness: normalizeScalar(rawRecord.roughness, { clamp01: true }),
                metalness: normalizeScalar(rawRecord.metalness, { clamp01: true }),
                opacity: normalizeScalar(rawRecord.opacity, { clamp01: true }),
                alphaTest: normalizeScalar(rawRecord.alphaTest, { clamp01: true }),
                clearcoat: normalizeScalar(rawRecord.clearcoat, { clamp01: true }),
                clearcoatRoughness: normalizeScalar(rawRecord.clearcoatRoughness, { clamp01: true }),
                specularIntensity: normalizeScalar(rawRecord.specularIntensity, { clamp01: true }),
                transmission: normalizeScalar(rawRecord.transmission, { clamp01: true }),
                thickness: normalizeScalar(rawRecord.thickness, { min: 0 }),
                attenuationDistance: normalizeScalar(rawRecord.attenuationDistance, { min: 0 }),
                aoMapIntensity: normalizeScalar(rawRecord.aoMapIntensity, { clamp01: true }),
                sheen: normalizeScalar(rawRecord.sheen, { clamp01: true }),
                sheenRoughness: normalizeScalar(rawRecord.sheenRoughness, { clamp01: true }),
                iridescence: normalizeScalar(rawRecord.iridescence, { clamp01: true }),
                iridescenceIOR: normalizeScalar(rawRecord.iridescenceIOR, { min: 1 }),
                anisotropy: normalizeScalar(rawRecord.anisotropy, { clamp01: true }),
                anisotropyRotation: normalizeScalar(rawRecord.anisotropyRotation),
                emissiveIntensity: normalizeScalar(rawRecord.emissiveIntensity, { min: 0 }),
                ior: normalizeScalar(rawRecord.ior, { min: 1 }),
                mapPath: normalizeTexturePath(rawRecord.mapPath),
                emissiveMapPath: normalizeTexturePath(rawRecord.emissiveMapPath),
                roughnessMapPath: normalizeTexturePath(rawRecord.roughnessMapPath),
                metalnessMapPath: normalizeTexturePath(rawRecord.metalnessMapPath),
                normalMapPath: normalizeTexturePath(rawRecord.normalMapPath),
                aoMapPath: normalizeTexturePath(rawRecord.aoMapPath),
                alphaMapPath: normalizeTexturePath(rawRecord.alphaMapPath),
                clearcoatMapPath: normalizeTexturePath(rawRecord.clearcoatMapPath),
                clearcoatRoughnessMapPath: normalizeTexturePath(rawRecord.clearcoatRoughnessMapPath),
                clearcoatNormalMapPath: normalizeTexturePath(rawRecord.clearcoatNormalMapPath),
                specularColorMapPath: normalizeTexturePath(rawRecord.specularColorMapPath),
                specularIntensityMapPath: normalizeTexturePath(rawRecord.specularIntensityMapPath),
                transmissionMapPath: normalizeTexturePath(rawRecord.transmissionMapPath),
                thicknessMapPath: normalizeTexturePath(rawRecord.thicknessMapPath),
                sheenColorMapPath: normalizeTexturePath(rawRecord.sheenColorMapPath),
                sheenRoughnessMapPath: normalizeTexturePath(rawRecord.sheenRoughnessMapPath),
                anisotropyMapPath: normalizeTexturePath(rawRecord.anisotropyMapPath),
                iridescenceMapPath: normalizeTexturePath(rawRecord.iridescenceMapPath),
                iridescenceThicknessMapPath: normalizeTexturePath(rawRecord.iridescenceThicknessMapPath),
            };
            if (this.resolveSnapshotMaterialEmissionEnabled(normalizedRecord) === false) {
                normalizedRecord.emissiveEnabled = false;
                normalizedRecord.emissive = null;
                normalizedRecord.emissiveIntensity = null;
                normalizedRecord.emissiveMapPath = null;
            }
            if (normalizedRecord.roughness === null && normalizedRecord.isOmniPbr) {
                normalizedRecord.roughness = HYDRA_UNIFIED_MATERIAL_DEFAULTS.roughness;
            }
            return normalizedRecord;
        })
            .filter(Boolean);
    }
    ingestSnapshotMaterialRecords(rawRecords, options = {}) {
        const normalizedStageSourcePath = String(options?.stageSourcePath || this.getStageSourcePath() || '').trim().split('?')[0] || '__default__';
        const normalizedRecords = this.normalizeSnapshotMaterialRecords(rawRecords, {
            stageSourcePath: normalizedStageSourcePath,
        });
        if (!(this._snapshotMaterialRecordById instanceof Map)) {
            this._snapshotMaterialRecordById = new Map();
        }
        if (!(this._snapshotMaterialIdsByStageSource instanceof Map)) {
            this._snapshotMaterialIdsByStageSource = new Map();
        }
        if (!(this._snapshotFallbackMaterialCache instanceof Map)) {
            this._snapshotFallbackMaterialCache = new Map();
        }
        const previousIds = this._snapshotMaterialIdsByStageSource.get(normalizedStageSourcePath);
        if (options?.force === true && previousIds instanceof Set) {
            for (const materialId of previousIds) {
                this._snapshotMaterialRecordById.delete(materialId);
                this._snapshotFallbackMaterialCache.delete(materialId);
            }
        }
        const stageMaterialIds = new Set();
        for (const record of normalizedRecords) {
            const materialId = normalizeHydraPath(record?.materialId || '');
            if (!materialId)
                continue;
            this._snapshotMaterialRecordById.set(materialId, record);
            this._snapshotFallbackMaterialCache.delete(materialId);
            stageMaterialIds.add(materialId);
        }
        this._snapshotMaterialIdsByStageSource.set(normalizedStageSourcePath, stageMaterialIds);
        for (const materialId of stageMaterialIds) {
            if (this.materials[materialId])
                continue;
            const wrappedMaterial = this.createFallbackMaterialFromSnapshot(materialId);
            if (wrappedMaterial) {
                this.materials[materialId] = wrappedMaterial;
            }
        }
        return normalizedRecords;
    }
    resolveMaterialTexturePathCandidates(texturePath, stageSourcePath = null) {
        const normalizedTexturePath = this.normalizeMaterialTexturePath(texturePath);
        if (!normalizedTexturePath)
            return [];
        const candidates = [];
        const addCandidate = (candidate) => {
            const normalizedCandidate = this.normalizeMaterialTexturePath(candidate);
            if (normalizedCandidate && !candidates.includes(normalizedCandidate)) {
                candidates.push(normalizedCandidate);
            }
        };
        const normalizedStageSourcePath = String(stageSourcePath || this.getStageSourcePath?.() || '')
            .trim()
            .split('?')[0];
        if (normalizedStageSourcePath && normalizedStageSourcePath !== '__default__') {
            addCandidate(resolveUsdAssetPath(normalizedStageSourcePath, normalizedTexturePath));
        }
        addCandidate(normalizedTexturePath);
        return candidates;
    }
    async loadMaterialTexture(texturePath, options = {}) {
        const candidates = this.resolveMaterialTexturePathCandidates(
            texturePath,
            options?.stageSourcePath,
        );
        if (candidates.length === 0) {
            throw new Error('Missing OpenUSD material texture path.');
        }
        let lastError = null;
        for (const candidate of candidates) {
            try {
                return await this.registry.getTexture(candidate);
            }
            catch (error) {
                lastError = error;
            }
        }
        if (lastError && typeof lastError === 'object') {
            try {
                lastError.usdTextureCandidates = candidates.slice();
            }
            catch {
                // Preserve loader errors even when a registry freezes them.
            }
            throw lastError;
        }
        throw new Error(`Unable to load OpenUSD material texture from: ${candidates.join(', ')}`);
    }
    applySnapshotTextureInput(material, texturePath, materialProperty, options = {}) {
        const normalizedTexturePath = this.normalizeMaterialTexturePath(texturePath);
        if (!material || !normalizedTexturePath)
            return false;
        const texturePromise = typeof this.loadMaterialTexture === 'function'
            ? this.loadMaterialTexture(normalizedTexturePath, {
                stageSourcePath: options?.stageSourcePath,
            })
            : this.registry.getTexture(normalizedTexturePath);
        texturePromise.then((texture) => {
            const nextTexture = texture?.clone ? texture.clone() : texture;
            if (!nextTexture)
                return;
            if (typeof this.clearSnapshotTextureApplyFailure === 'function') {
                this.clearSnapshotTextureApplyFailure(material, normalizedTexturePath, materialProperty);
            }
            nextTexture.colorSpace = options.colorSpace || LinearSRGBColorSpace;
            nextTexture.needsUpdate = true;
            material[materialProperty] = nextTexture;
            if (typeof options.onAssigned === 'function') {
                options.onAssigned(nextTexture);
            }
            material.needsUpdate = true;
        }).catch((error) => {
            const warn = getRawConsoleMethod('warn');
            warn('[HydraDelegate] Failed to apply snapshot texture input.', {
                texturePath: normalizedTexturePath,
                materialProperty,
                materialName: String(material?.name || ''),
                textureCandidates: Array.isArray(error?.usdTextureCandidates)
                    ? error.usdTextureCandidates
                    : [normalizedTexturePath],
                error: error instanceof Error ? error.message : String(error || 'unknown-error'),
            });
            if (typeof this.recordSnapshotTextureApplyFailure === 'function') {
                this.recordSnapshotTextureApplyFailure(material, normalizedTexturePath, materialProperty, error);
            }
        });
        return true;
    }
    recordSnapshotTextureApplyFailure(material, texturePath, materialProperty, error) {
        const normalizedTexturePath = this.normalizeMaterialTexturePath(texturePath);
        if (!material || !normalizedTexturePath || !materialProperty)
            return null;
        if (!(this._snapshotTextureApplyFailures instanceof Map)) {
            this._snapshotTextureApplyFailures = new Map();
        }
        const errorText = String(error instanceof Error ? error.message : error || '').trim() || 'unknown-error';
        const materialName = String(material?.name || '').trim();
        const failureKey = `${materialName}|${materialProperty}|${normalizedTexturePath}`;
        const failure = {
            materialName,
            materialProperty,
            texturePath: normalizedTexturePath,
            error: errorText,
        };
        this._snapshotTextureApplyFailures.set(failureKey, failure);
        const userData = (material.userData && typeof material.userData === 'object')
            ? material.userData
            : (material.userData = {});
        const nextFailures = (userData.snapshotTextureApplyFailures && typeof userData.snapshotTextureApplyFailures === 'object')
            ? { ...userData.snapshotTextureApplyFailures }
            : {};
        nextFailures[materialProperty] = {
            texturePath: normalizedTexturePath,
            error: errorText,
        };
        userData.snapshotTextureApplyFailures = nextFailures;
        userData.snapshotTextureApplyFailed = true;
        return failure;
    }
    clearSnapshotTextureApplyFailure(material, texturePath, materialProperty) {
        const normalizedTexturePath = this.normalizeMaterialTexturePath(texturePath);
        if (!material || !normalizedTexturePath || !materialProperty)
            return;
        const materialName = String(material?.name || '').trim();
        if (this._snapshotTextureApplyFailures instanceof Map) {
            const failureKey = `${materialName}|${materialProperty}|${normalizedTexturePath}`;
            this._snapshotTextureApplyFailures.delete(failureKey);
        }
        const userData = material.userData;
        if (!userData || typeof userData !== 'object')
            return;
        const existingFailures = userData.snapshotTextureApplyFailures;
        if (!existingFailures || typeof existingFailures !== 'object')
            return;
        const nextFailures = { ...existingFailures };
        delete nextFailures[materialProperty];
        if (Object.keys(nextFailures).length > 0) {
            userData.snapshotTextureApplyFailures = nextFailures;
            userData.snapshotTextureApplyFailed = true;
            return;
        }
        delete userData.snapshotTextureApplyFailures;
        delete userData.snapshotTextureApplyFailed;
    }
    getSnapshotTextureApplyFailureSummary() {
        const failures = this._snapshotTextureApplyFailures instanceof Map
            ? Array.from(this._snapshotTextureApplyFailures.values())
            : [];
        failures.sort((left, right) => {
            const materialCompare = String(left?.materialName || '').localeCompare(String(right?.materialName || ''));
            if (materialCompare !== 0)
                return materialCompare;
            const propertyCompare = String(left?.materialProperty || '').localeCompare(String(right?.materialProperty || ''));
            if (propertyCompare !== 0)
                return propertyCompare;
            return String(left?.texturePath || '').localeCompare(String(right?.texturePath || ''));
        });
        return {
            count: failures.length,
            failures,
        };
    }
    setDriverStageResolveState(status, options = {}) {
        const normalizedStatus = status === 'pending' || status === 'resolved' || status === 'rejected'
            ? status
            : 'idle';
        const normalizedSource = String(options?.source || '').trim()
            || (normalizedStatus === 'idle' ? 'none' : 'unknown');
        const normalizedError = (() => {
            const rawError = options?.error;
            if (rawError instanceof Error) {
                const nextError = String(rawError.message || rawError).trim();
                return nextError || null;
            }
            const nextError = String(rawError || '').trim();
            return nextError || null;
        })();
        this._driverStageResolveState = normalizedStatus;
        this._driverStageResolveSource = normalizedSource;
        this._driverStageResolveError = normalizedError;
        this._driverStageResolveUpdatedAtMs = Date.now();
    }
    getDriverStageResolveSummary() {
        const hasResolvedStage = !!this._resolvedDriverStage;
        const rawStatus = String(this._driverStageResolveState || 'idle');
        const status = hasResolvedStage && rawStatus !== 'resolved'
            ? 'resolved'
            : rawStatus;
        const rawSource = String(this._driverStageResolveSource || '').trim();
        const source = hasResolvedStage && rawStatus !== 'resolved'
            ? 'driver-cache'
            : (rawSource || (status === 'idle' ? 'none' : 'unknown'));
        const rawError = String(this._driverStageResolveError || '').trim();
        return {
            status,
            source,
            error: rawError || null,
            hasResolvedStage,
            pending: !!this._pendingDriverStagePromise,
            updatedAtMs: Number.isFinite(this._driverStageResolveUpdatedAtMs)
                ? Number(this._driverStageResolveUpdatedAtMs)
                : null,
        };
    }
    applySnapshotMaterialRecord(material, record) {
        if (!material || !record || typeof record !== 'object')
            return;
        const assignColor = (recordField, materialField, options = {}) => {
            const color = toColorArray(record?.[recordField]);
            if (!color)
                return false;
            const colorSpaceFieldByRecordField = {
                color: 'colorSpace',
                emissive: 'emissiveColorSpace',
                specularColor: 'specularColorSpace',
                attenuationColor: 'attenuationColorSpace',
                sheenColor: 'sheenColorSpace',
            };
            const colorSpaceField = colorSpaceFieldByRecordField[recordField] || `${recordField}ColorSpace`;
            let nextColor = createHydraColorFromTuple(color, options.colorSpace || record?.[colorSpaceField] || null);
            const inferredHex = this.inferColorHexFromMaterialName(material?.name);
            if (options.treatAsSrgbWhenMatchingMaterialName && material?.name) {
                if (Number.isFinite(inferredHex)) {
                    const sr = ((inferredHex >> 16) & 0xff) / 255;
                    const sg = ((inferredHex >> 8) & 0xff) / 255;
                    const sb = (inferredHex & 0xff) / 255;
                    const epsilon = 1 / 255 + 1e-4;
                    if (Math.abs(color[0] - sr) <= epsilon && Math.abs(color[1] - sg) <= epsilon && Math.abs(color[2] - sb) <= epsilon) {
                        nextColor = new Color(inferredHex);
                    }
                }
            }
            material[materialField] = nextColor;
            return true;
        };
        const assignScalar = (recordField, materialField) => {
            const numeric = toFiniteNumber(record?.[recordField]);
            if (numeric === undefined)
                return false;
            material[materialField] = numeric;
            return true;
        };
        const assignVec2 = (recordField, materialField) => {
            const tuple = toFiniteVector2Tuple(record?.[recordField]);
            if (!tuple)
                return false;
            material[materialField] = new Vector2(tuple[0], tuple[1]);
            return true;
        };
        const applyTexture = (texturePath, materialProperty, options = {}) => this.applySnapshotTextureInput(
            material,
            texturePath,
            materialProperty,
            {
                ...options,
                stageSourcePath: record?.stageSourcePath,
            },
        );
        assignColor('color', 'color', {
            treatAsSrgbWhenMatchingMaterialName: this.shouldTreatNamedHexDiffuseAsSrgb(),
        });
        assignColor('specularColor', 'specularColor');
        assignColor('attenuationColor', 'attenuationColor');
        assignColor('sheenColor', 'sheenColor');
        const emissiveEnabled = this.resolveSnapshotMaterialEmissionEnabled(record);
        if (emissiveEnabled) {
            assignColor('emissive', 'emissive');
        }
        assignScalar('roughness', 'roughness');
        assignScalar('metalness', 'metalness');
        assignScalar('opacity', 'opacity');
        assignScalar('alphaTest', 'alphaTest');
        assignScalar('clearcoat', 'clearcoat');
        assignScalar('clearcoatRoughness', 'clearcoatRoughness');
        assignScalar('specularIntensity', 'specularIntensity');
        assignScalar('ior', 'ior');
        assignScalar('transmission', 'transmission');
        assignScalar('thickness', 'thickness');
        assignScalar('attenuationDistance', 'attenuationDistance');
        assignScalar('aoMapIntensity', 'aoMapIntensity');
        assignScalar('sheen', 'sheen');
        assignScalar('sheenRoughness', 'sheenRoughness');
        assignScalar('iridescence', 'iridescence');
        assignScalar('iridescenceIOR', 'iridescenceIOR');
        assignScalar('anisotropy', 'anisotropy');
        assignScalar('anisotropyRotation', 'anisotropyRotation');
        if (!emissiveEnabled) {
            material.emissive = new Color(0x000000);
            material.emissiveIntensity = 1;
        }
        else {
            assignScalar('emissiveIntensity', 'emissiveIntensity');
        }
        assignVec2('normalScale', 'normalScale');
        assignVec2('clearcoatNormalScale', 'clearcoatNormalScale');
        if (record?.opacityEnabled === false) {
            material.opacity = 1;
            material.transparent = false;
            material.alphaTest = 0;
        }
        else {
            const opacity = toFiniteNumber(record?.opacity);
            if (opacity !== undefined && opacity < 1) {
                material.transparent = true;
            }
            const alphaTest = toFiniteNumber(record?.alphaTest);
            if (alphaTest !== undefined && alphaTest > 0) {
                material.transparent = false;
            }
        }
        applyTexture(record?.mapPath, 'map', {
            colorSpace: SRGBColorSpace,
            onAssigned: () => {
                material.color = new Color(0xffffff);
            },
        });
        if (emissiveEnabled) {
            applyTexture(record?.emissiveMapPath, 'emissiveMap', {
                colorSpace: SRGBColorSpace,
                onAssigned: () => {
                    material.emissive = new Color(0xffffff);
                },
            });
        }
        applyTexture(record?.roughnessMapPath, 'roughnessMap', {
            onAssigned: () => {
                material.roughness = 1;
            },
        });
        applyTexture(record?.metalnessMapPath, 'metalnessMap', {
            onAssigned: () => {
                material.metalness = 1;
            },
        });
        applyTexture(record?.normalMapPath, 'normalMap');
        applyTexture(record?.aoMapPath, 'aoMap');
        if (record?.opacityEnabled !== false && record?.opacityTextureEnabled !== false) {
            applyTexture(record?.alphaMapPath, 'alphaMap', {
                onAssigned: () => {
                    if (!(material.alphaTest > 0))
                        material.transparent = true;
                },
            });
        }
        applyTexture(record?.clearcoatMapPath, 'clearcoatMap');
        applyTexture(record?.clearcoatRoughnessMapPath, 'clearcoatRoughnessMap');
        applyTexture(record?.clearcoatNormalMapPath, 'clearcoatNormalMap');
        applyTexture(record?.specularColorMapPath, 'specularColorMap', { colorSpace: SRGBColorSpace });
        applyTexture(record?.specularIntensityMapPath, 'specularIntensityMap');
        applyTexture(record?.transmissionMapPath, 'transmissionMap');
        applyTexture(record?.thicknessMapPath, 'thicknessMap');
        applyTexture(record?.sheenColorMapPath, 'sheenColorMap', { colorSpace: SRGBColorSpace });
        applyTexture(record?.sheenRoughnessMapPath, 'sheenRoughnessMap');
        applyTexture(record?.anisotropyMapPath, 'anisotropyMap');
        applyTexture(record?.iridescenceMapPath, 'iridescenceMap');
        applyTexture(record?.iridescenceThicknessMapPath, 'iridescenceThicknessMap');
        material.needsUpdate = true;
    }
    createFallbackMaterialFromSnapshot(materialPath) {
        const normalizedMaterialPath = normalizeHydraPath(materialPath);
        if (!normalizedMaterialPath)
            return null;
        if (!(this._snapshotMaterialRecordById instanceof Map))
            return null;
        if (!(this._snapshotFallbackMaterialCache instanceof Map)) {
            this._snapshotFallbackMaterialCache = new Map();
        }
        if (this._snapshotFallbackMaterialCache.has(normalizedMaterialPath)) {
            const cachedMaterial = this._snapshotFallbackMaterialCache.get(normalizedMaterialPath);
            if (cachedMaterial || !(this._snapshotMaterialRecordById instanceof Map) || !this._snapshotMaterialRecordById.has(normalizedMaterialPath)) {
                return cachedMaterial;
            }
            this._snapshotFallbackMaterialCache.delete(normalizedMaterialPath);
        }
        const record = this._snapshotMaterialRecordById.get(normalizedMaterialPath) || null;
        if (!record) {
            this._snapshotFallbackMaterialCache.set(normalizedMaterialPath, null);
            return null;
        }
        const materialName = String(record?.name || normalizedMaterialPath.split('/').filter(Boolean).pop() || normalizedMaterialPath).trim() || normalizedMaterialPath;
        const inferredColorHex = this.inferColorHexFromMaterialName(materialName);
        const usePhysicalMaterial = this.snapshotRecordRequiresPhysicalMaterial(record);
        const material = (usePhysicalMaterial
            ? createUnifiedHydraPhysicalMaterial({
                side: FrontSide,
                color: inferredColorHex ?? 0x888888,
                name: materialName,
            })
            : createUnifiedHydraStandardMaterial({
                side: FrontSide,
                color: inferredColorHex ?? 0x888888,
                name: materialName,
            }));
        this.applySnapshotMaterialRecord(material, record);
        const wrappedMaterial = {
            _id: normalizedMaterialPath,
            _nodes: {},
            _interface: this,
            _material: material,
            _snapshotRecord: record,
        };
        this._snapshotFallbackMaterialCache.set(normalizedMaterialPath, wrappedMaterial);
        return wrappedMaterial;
    }
    buildSnapshotMeshDescriptorIndex() {
        const snapshot = this.getCachedRobotSceneSnapshot?.();
        const descriptors = Array.isArray(snapshot?.render?.meshDescriptors)
            ? snapshot.render.meshDescriptors
            : [];
        const descriptorIndex = new Map();
        for (const descriptor of descriptors) {
            const meshId = normalizeHydraPath(descriptor?.meshId || '');
            if (!meshId || descriptorIndex.has(meshId))
                continue;
            descriptorIndex.set(meshId, descriptor);
        }
        return descriptorIndex;
    }
    getSnapshotMeshDescriptor(meshId, descriptorIndex = null) {
        const normalizedMeshId = normalizeHydraPath(meshId || '');
        if (!normalizedMeshId)
            return null;
        if (descriptorIndex instanceof Map) {
            return descriptorIndex.get(normalizedMeshId) || null;
        }
        return this.buildSnapshotMeshDescriptorIndex().get(normalizedMeshId) || null;
    }
    getSnapshotDirectMaterialIdForMeshId(meshId, descriptorIndex = null) {
        const descriptor = this.getSnapshotMeshDescriptor(meshId, descriptorIndex);
        const geometry = descriptor?.geometry && typeof descriptor.geometry === 'object'
            ? descriptor.geometry
            : null;
        return normalizeHydraPath(descriptor?.materialId || geometry?.materialId || '') || null;
    }
    getSnapshotGeomSubsetSectionsForMeshId(meshId, descriptorIndex = null) {
        const descriptor = this.getSnapshotMeshDescriptor(meshId, descriptorIndex);
        const geometry = descriptor?.geometry && typeof descriptor.geometry === 'object'
            ? descriptor.geometry
            : null;
        const rawSections = Array.isArray(geometry?.geomSubsetSections)
            ? geometry.geomSubsetSections
            : [];
        const normalizedSections = [];
        for (const rawSection of rawSections) {
            const start = Number(rawSection?.start);
            const length = Number(rawSection?.length);
            if (!Number.isFinite(start) || !Number.isFinite(length) || length <= 0)
                continue;
            normalizedSections.push({
                start: Math.max(0, Math.floor(start)),
                length: Math.max(0, Math.floor(length)),
                materialId: normalizeHydraPath(rawSection?.materialId || '') || '',
            });
        }
        return normalizedSections;
    }
    applySnapshotMaterialsToMeshes() {
        const summary = {
            boundCount: 0,
            subsetReboundCount: 0,
            inheritedCount: 0,
            subsetFailureCount: 0,
            inheritFailureCount: 0,
            subsetFailureMeshIds: [],
            inheritFailureMeshIds: [],
            textureFailureCount: Number(this.getSnapshotTextureApplyFailureSummary?.().count || 0),
        };
        const snapshotDescriptorIndex = this.buildSnapshotMeshDescriptorIndex?.() || new Map();
        for (const hydraMesh of Object.values(this.meshes || {})) {
            if (!hydraMesh || typeof hydraMesh !== 'object')
                continue;
            const meshId = normalizeHydraPath(hydraMesh._id || '');
            let pendingMaterialId = normalizeHydraPath(hydraMesh._pendingMaterialId || '');
            if (!pendingMaterialId && meshId) {
                pendingMaterialId = this.getSnapshotDirectMaterialIdForMeshId?.(meshId, snapshotDescriptorIndex) || null;
                if (pendingMaterialId) {
                    hydraMesh._pendingMaterialId = pendingMaterialId;
                }
            }
            const hasPendingGeomSubsetSections = Array.isArray(hydraMesh._pendingGeomSubsetSections)
                && hydraMesh._pendingGeomSubsetSections.length > 0;
            if (!hasPendingGeomSubsetSections && meshId) {
                const snapshotGeomSubsetSections = this.getSnapshotGeomSubsetSectionsForMeshId?.(meshId, snapshotDescriptorIndex) || [];
                if (snapshotGeomSubsetSections.length > 0) {
                    hydraMesh._pendingGeomSubsetSections = snapshotGeomSubsetSections;
                }
            }
            if (!pendingMaterialId)
                continue;
            const resolvedMaterial = this.materials?.[pendingMaterialId]?._material
                || this.getOrCreateMaterialById?.(pendingMaterialId, meshId || hydraMesh._id)?._material
                || null;
            if (!resolvedMaterial || !hydraMesh._mesh)
                continue;
            hydraMesh._mesh.material = resolvedMaterial;
            hydraMesh._pendingMaterialId = undefined;
            summary.boundCount += 1;
        }
        for (const hydraMesh of Object.values(this.meshes || {})) {
            if (!hydraMesh || typeof hydraMesh !== 'object')
                continue;
            try {
                if (hydraMesh.tryApplyPendingGeomSubsetMaterials?.() === true) {
                    summary.subsetReboundCount += 1;
                }
            }
            catch (error) {
                summary.subsetFailureCount += 1;
                if (hydraMesh?._id) {
                    summary.subsetFailureMeshIds.push(String(hydraMesh._id));
                }
                getRawConsoleMethod('error')('[HydraDelegate] Failed to apply pending geometry subset materials.', {
                    meshId: String(hydraMesh?._id || ''),
                    error: error instanceof Error ? error.message : String(error || 'unknown-error'),
                });
            }
        }
        this._preferredVisualMaterialByLinkCache?.clear?.();
        for (const hydraMesh of Object.values(this.meshes || {})) {
            if (!hydraMesh || typeof hydraMesh !== 'object')
                continue;
            try {
                if (hydraMesh.tryInheritVisualMaterialFromLink?.() === true) {
                    summary.inheritedCount += 1;
                }
            }
            catch (error) {
                summary.inheritFailureCount += 1;
                if (hydraMesh?._id) {
                    summary.inheritFailureMeshIds.push(String(hydraMesh._id));
                }
                getRawConsoleMethod('error')('[HydraDelegate] Failed to inherit visual material from link.', {
                    meshId: String(hydraMesh?._id || ''),
                    error: error instanceof Error ? error.message : String(error || 'unknown-error'),
                });
            }
        }
        return summary;
    }
    createFallbackMaterialFromStage(materialPath) {
        if (!materialPath)
            return null;
        if (this._stageFallbackMaterialCache.has(materialPath)) {
            return this._stageFallbackMaterialCache.get(materialPath);
        }
        const stage = this.getStage();
        if (!stage) {
            this._stageFallbackMaterialCache.set(materialPath, null);
            return null;
        }
        const materialPrim = this.safeGetPrimAtPath(stage, materialPath);
        if (!materialPrim) {
            this._stageFallbackMaterialCache.set(materialPath, null);
            return null;
        }
        const materialName = materialPath.split('/').filter(Boolean).pop() || materialPath;
        const inferredColorHex = this.inferColorHexFromMaterialName(materialName);
        const shaderPrim = this.findMaterialShaderPrim(stage, materialPath, materialName);
        const usePhysicalMaterial = this.stageShaderRequiresPhysicalMaterial?.(shaderPrim) === true;
        const material = (usePhysicalMaterial
            ? createUnifiedHydraPhysicalMaterial({
                side: FrontSide,
                color: inferredColorHex ?? 0x888888,
                name: materialName,
            })
            : createUnifiedHydraStandardMaterial({
                side: FrontSide,
                color: inferredColorHex ?? 0x888888,
                name: materialName,
            }));
        if (shaderPrim) {
            this.applyStageFallbackMaterialParameters(material, shaderPrim);
        }
        const wrappedMaterial = {
            _id: materialPath,
            _nodes: {},
            _interface: this,
            _material: material,
        };
        this._stageFallbackMaterialCache.set(materialPath, wrappedMaterial);
        return wrappedMaterial;
    }
}
