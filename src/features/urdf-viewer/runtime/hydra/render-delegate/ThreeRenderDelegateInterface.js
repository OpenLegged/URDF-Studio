// @ts-nocheck
import { Color, LinearSRGBColorSpace, Matrix4, SRGBColorSpace, Vector2, } from 'three';
import * as Shared from './shared.js';
import { ThreeRenderDelegateMaterialOps } from './ThreeRenderDelegateMaterialOps.js';
import { HydraInstancer } from './HydraInstancer.js';
import { HydraMaterial } from './HydraMaterial.js';
import { HydraMesh } from './HydraMesh.js';
import { getDefaultMaterial } from './default-material-state.js';
import { createHydraColorFromTuple, HYDRA_UNIFIED_MATERIAL_DEFAULTS } from './material-defaults.js';
const { buildProtoPrimPathCandidates, clamp01, createMatrixFromXformOp, debugInstancer, debugMaterials, debugMeshes, debugPrims, debugTextures, defaultGrayComponent, disableMaterials, disableTextures, extractPrimPathFromMaterialBindingWarning, extractReferencePrimTargets, extractScopeBodyText, extractUsdAssetReferencesFromLayerText, getActiveMaterialBindingWarningOwner, getAngleInRadians, getCollisionGeometryTypeFromUrdfElement, getExpectedPrimTypesForCollisionProto, getExpectedPrimTypesForProtoType, getMatrixMaxElementDelta, getPathBasename, getPathWithoutRoot, getRawConsoleMethod, getRootPathFromPrimPath, getSafePrimTypeName, hasNonZeroTranslation, hydraCallbackErrorCounts, installMaterialBindingApiWarningInterceptor, isIdentityQuaternion, isLikelyDefaultGrayMaterial, isLikelyInverseTransform, isMaterialBindingApiWarningMessage, isMatrixApproximatelyIdentity, isNonZero, isPotentiallyLargeBaseAssetPath, logHydraCallbackError, materialBindingRepairMaxLayerTextLength, materialBindingWarningHandlers, maxHydraCallbackErrorLogsPerMethod, nearlyEqual, normalizeHydraPath, normalizeUsdPathToken, parseGuideCollisionReferencesFromLayerText, parseProtoMeshIdentifier, parseUrdfMaterialMetadataFromLayerText, parseUrdfTruthFromText, parseUsdMaterialBindingsFromLayerText, parseUsdReferenceTargetsByPrimPathFromLayerText, parseVector3Text, parseXformOpFallbacksFromLayerText, rawConsoleError, rawConsoleWarn, registerMaterialBindingApiWarningHandler, remapRootPathIfNeeded, resolveUrdfTruthFileNameForStagePath, resolveUsdAssetPath, setActiveMaterialBindingWarningOwner, shouldAllowLargeBaseAssetScan, stringifyConsoleArgs, toArrayLike, toColorArray, toFiniteNumber, toFiniteQuaternionWxyzTuple, toFiniteVector2Tuple, toFiniteVector3Tuple, toMatrixFromUrdfOrigin, toQuaternionWxyzFromRpy, transformEpsilon, wrapHydraCallbackObject } = Shared;
const { parseColliderEntriesFromLayerText } = Shared;
const COLLISION_SEGMENT_PATTERN = /(?:^|\/)coll(?:isions?|iders?)(?:$|[/.])/i;
function normalizeDescriptorSectionName(sectionName) {
    const normalized = String(sectionName || '').trim().toLowerCase();
    if (normalized === 'visual') {
        return 'visuals';
    }
    if (normalized === 'collision' || normalized === 'collider' || normalized === 'colliders') {
        return 'collisions';
    }
    return normalized;
}
function normalizeNormalDiagnostics(source) {
    if (!source || typeof source !== 'object') {
        return null;
    }
    const candidate = source.normalDiagnostics && typeof source.normalDiagnostics === 'object'
        ? source.normalDiagnostics
        : (source.normalDiagnostic && typeof source.normalDiagnostic === 'object'
            ? source.normalDiagnostic
            : source);
    const normalizeCount = (value) => {
        const numeric = Number(value);
        return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : null;
    };
    const normalSource = String(candidate.normalSource || '').trim();
    const normalRepairCount = normalizeCount(candidate.normalRepairCount);
    const normalFallbackCount = normalizeCount(candidate.normalFallbackCount);
    const postRepairLowDotCount = normalizeCount(candidate.postRepairLowDotCount);
    const diagnostics = {
        ...(normalSource ? { normalSource } : {}),
        ...(normalRepairCount !== null ? { normalRepairCount } : {}),
        ...(normalFallbackCount !== null ? { normalFallbackCount } : {}),
        ...(postRepairLowDotCount !== null ? { postRepairLowDotCount } : {}),
    };
    return Object.keys(diagnostics).length > 0 ? diagnostics : null;
}
function normalizeTopologyMode(value) {
    const normalized = String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
    if (normalized === 'nonindexed' || normalized === 'nonindex') {
        return 'nonIndexed';
    }
    if (normalized === 'indexed' || normalized === 'index') {
        return 'indexed';
    }
    return null;
}
function parseColorAndOpacityFromHexString(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        return { color: null, opacity: null };
    }
    const normalized = raw.startsWith('#') ? raw.slice(1) : raw;
    let rgbHex = normalized;
    let opacity = null;
    if (/^[0-9a-f]{4}$/i.test(normalized)) {
        rgbHex = `${normalized[0]}${normalized[0]}${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}`;
        opacity = parseInt(`${normalized[3]}${normalized[3]}`, 16) / 255;
    }
    else if (/^[0-9a-f]{8}$/i.test(normalized)) {
        rgbHex = normalized.slice(0, 6);
        opacity = parseInt(normalized.slice(6, 8), 16) / 255;
    }
    try {
        const color = new Color(`#${rgbHex}`);
        return {
            color: [color.r, color.g, color.b],
            opacity: Number.isFinite(opacity) ? opacity : null,
        };
    }
    catch {
        return { color: null, opacity: null };
    }
}
function getDescriptorLinkPath(descriptor) {
    const meshId = normalizeHydraPath(descriptor?.meshId || '');
    const proto = meshId ? parseProtoMeshIdentifier(meshId) : null;
    if (proto?.linkPath) {
        return normalizeHydraPath(proto.linkPath);
    }
    const candidates = [
        normalizeHydraPath(descriptor?.resolvedPrimPath || ''),
        meshId,
    ];
    for (const candidate of candidates) {
        if (!candidate) {
            continue;
        }
        const authoredPathMatch = candidate.match(/^(.*?)(?:\/(?:visuals?|coll(?:isions?|iders?)))(?:$|[/.])/i);
        if (authoredPathMatch?.[1]) {
            return normalizeHydraPath(authoredPathMatch[1]);
        }
    }
    return '';
}
function hasMaterialRecordValue(value) {
    if (value === null || value === undefined) {
        return false;
    }
    if (typeof value === 'string') {
        return value.trim().length > 0;
    }
    if (Array.isArray(value)) {
        return value.length > 0;
    }
    if (ArrayBuffer.isView(value)) {
        return value.byteLength > 0;
    }
    return true;
}
function mergeSnapshotMaterialRecordWithFallback(record, fallbackRecord) {
    if (!record || typeof record !== 'object') {
        return fallbackRecord && typeof fallbackRecord === 'object' ? { ...fallbackRecord } : record;
    }
    if (!fallbackRecord || typeof fallbackRecord !== 'object') {
        return record;
    }
    const mergedRecord = { ...record };
    if (fallbackRecord.emissiveEnabled === false) {
        mergedRecord.emissiveEnabled = false;
        delete mergedRecord.emissive;
        delete mergedRecord.emissiveIntensity;
        delete mergedRecord.emissiveMapPath;
    }
    if (fallbackRecord.isOmniPbr === true && mergedRecord.isOmniPbr !== true) {
        mergedRecord.isOmniPbr = true;
    }
    for (const [key, value] of Object.entries(fallbackRecord)) {
        if (key === 'materialId' || key === 'id') {
            continue;
        }
        if (!hasMaterialRecordValue(mergedRecord[key]) && hasMaterialRecordValue(value)) {
            mergedRecord[key] = Array.isArray(value) ? value.slice() : value;
        }
    }
    return mergedRecord;
}
function serializePreferredMaterialRecord(material) {
    if (!material || typeof material !== 'object') {
        return null;
    }
    const materialUserData = material.userData && typeof material.userData === 'object'
        ? material.userData
        : {};
    const materialEmissiveEnabled = typeof material.emissiveEnabled === 'boolean'
        ? material.emissiveEnabled
        : (typeof materialUserData.usdEmissiveEnabled === 'boolean'
            ? materialUserData.usdEmissiveEnabled
            : null);
    const materialIsOmniPbr = material.isOmniPbr === true || materialUserData.usdIsOmniPbr === true;
    const normalizeTexturePath = (texture) => {
        const normalized = String(texture?.userData?.usdSourcePath || texture?.name || '').trim();
        return normalized || null;
    };
    const normalizeScalar = (value, options = {}) => {
        const numeric = toFiniteNumber(value);
        if (numeric === undefined)
            return null;
        let nextValue = numeric;
        if (typeof options.min === 'number') {
            nextValue = Math.max(options.min, nextValue);
        }
        if (options.clamp01) {
            nextValue = clamp01(nextValue);
        }
        return nextValue;
    };
    const normalizeColor = (value) => {
        const tuple = toColorArray(value);
        return tuple ? [tuple[0], tuple[1], tuple[2]] : null;
    };
    const normalizeVec2 = (value) => {
        const tuple = toFiniteVector2Tuple(value);
        return tuple ? [tuple[0], tuple[1]] : null;
    };
    const record = {
        ...(String(material.name || '').trim() ? { name: String(material.name || '').trim() } : {}),
        ...(materialIsOmniPbr ? { isOmniPbr: true } : {}),
        ...(materialEmissiveEnabled !== null ? { emissiveEnabled: materialEmissiveEnabled } : {}),
        ...(normalizeColor(material.color) ? { color: normalizeColor(material.color) } : {}),
        ...(materialEmissiveEnabled !== false && normalizeColor(material.emissive)
            ? { emissive: normalizeColor(material.emissive) }
            : {}),
        ...(normalizeColor(material.specularColor) ? { specularColor: normalizeColor(material.specularColor) } : {}),
        ...(normalizeColor(material.attenuationColor) ? { attenuationColor: normalizeColor(material.attenuationColor) } : {}),
        ...(normalizeColor(material.sheenColor) ? { sheenColor: normalizeColor(material.sheenColor) } : {}),
        ...(normalizeVec2(material.normalScale) ? { normalScale: normalizeVec2(material.normalScale) } : {}),
        ...(normalizeVec2(material.clearcoatNormalScale) ? { clearcoatNormalScale: normalizeVec2(material.clearcoatNormalScale) } : {}),
        ...(normalizeScalar(material.roughness, { clamp01: true }) !== null ? { roughness: normalizeScalar(material.roughness, { clamp01: true }) } : {}),
        ...(normalizeScalar(material.metalness, { clamp01: true }) !== null ? { metalness: normalizeScalar(material.metalness, { clamp01: true }) } : {}),
        ...(normalizeScalar(material.opacity, { clamp01: true }) !== null ? { opacity: normalizeScalar(material.opacity, { clamp01: true }) } : {}),
        ...(normalizeScalar(material.alphaTest, { clamp01: true }) !== null ? { alphaTest: normalizeScalar(material.alphaTest, { clamp01: true }) } : {}),
        ...(normalizeScalar(material.clearcoat, { clamp01: true }) !== null ? { clearcoat: normalizeScalar(material.clearcoat, { clamp01: true }) } : {}),
        ...(normalizeScalar(material.clearcoatRoughness, { clamp01: true }) !== null ? { clearcoatRoughness: normalizeScalar(material.clearcoatRoughness, { clamp01: true }) } : {}),
        ...(normalizeScalar(material.specularIntensity, { clamp01: true }) !== null ? { specularIntensity: normalizeScalar(material.specularIntensity, { clamp01: true }) } : {}),
        ...(normalizeScalar(material.transmission, { clamp01: true }) !== null ? { transmission: normalizeScalar(material.transmission, { clamp01: true }) } : {}),
        ...(normalizeScalar(material.thickness, { min: 0 }) !== null ? { thickness: normalizeScalar(material.thickness, { min: 0 }) } : {}),
        ...(normalizeScalar(material.attenuationDistance, { min: 0 }) !== null ? { attenuationDistance: normalizeScalar(material.attenuationDistance, { min: 0 }) } : {}),
        ...(normalizeScalar(material.aoMapIntensity, { clamp01: true }) !== null ? { aoMapIntensity: normalizeScalar(material.aoMapIntensity, { clamp01: true }) } : {}),
        ...(normalizeScalar(material.sheen, { clamp01: true }) !== null ? { sheen: normalizeScalar(material.sheen, { clamp01: true }) } : {}),
        ...(normalizeScalar(material.sheenRoughness, { clamp01: true }) !== null ? { sheenRoughness: normalizeScalar(material.sheenRoughness, { clamp01: true }) } : {}),
        ...(normalizeScalar(material.iridescence, { clamp01: true }) !== null ? { iridescence: normalizeScalar(material.iridescence, { clamp01: true }) } : {}),
        ...(normalizeScalar(material.iridescenceIOR, { min: 1 }) !== null ? { iridescenceIOR: normalizeScalar(material.iridescenceIOR, { min: 1 }) } : {}),
        ...(normalizeScalar(material.anisotropy, { clamp01: true }) !== null ? { anisotropy: normalizeScalar(material.anisotropy, { clamp01: true }) } : {}),
        ...(normalizeScalar(material.anisotropyRotation) !== null ? { anisotropyRotation: normalizeScalar(material.anisotropyRotation) } : {}),
        ...(materialEmissiveEnabled !== false && normalizeScalar(material.emissiveIntensity, { min: 0 }) !== null ? { emissiveIntensity: normalizeScalar(material.emissiveIntensity, { min: 0 }) } : {}),
        ...(normalizeScalar(material.ior, { min: 1 }) !== null ? { ior: normalizeScalar(material.ior, { min: 1 }) } : {}),
        ...(normalizeTexturePath(material.map) ? { mapPath: normalizeTexturePath(material.map) } : {}),
        ...(materialEmissiveEnabled !== false && normalizeTexturePath(material.emissiveMap) ? { emissiveMapPath: normalizeTexturePath(material.emissiveMap) } : {}),
        ...(normalizeTexturePath(material.roughnessMap) ? { roughnessMapPath: normalizeTexturePath(material.roughnessMap) } : {}),
        ...(normalizeTexturePath(material.metalnessMap) ? { metalnessMapPath: normalizeTexturePath(material.metalnessMap) } : {}),
        ...(normalizeTexturePath(material.normalMap) ? { normalMapPath: normalizeTexturePath(material.normalMap) } : {}),
        ...(normalizeTexturePath(material.aoMap) ? { aoMapPath: normalizeTexturePath(material.aoMap) } : {}),
        ...(normalizeTexturePath(material.alphaMap) ? { alphaMapPath: normalizeTexturePath(material.alphaMap) } : {}),
        ...(normalizeTexturePath(material.clearcoatMap) ? { clearcoatMapPath: normalizeTexturePath(material.clearcoatMap) } : {}),
        ...(normalizeTexturePath(material.clearcoatRoughnessMap) ? { clearcoatRoughnessMapPath: normalizeTexturePath(material.clearcoatRoughnessMap) } : {}),
        ...(normalizeTexturePath(material.clearcoatNormalMap) ? { clearcoatNormalMapPath: normalizeTexturePath(material.clearcoatNormalMap) } : {}),
        ...(normalizeTexturePath(material.specularColorMap) ? { specularColorMapPath: normalizeTexturePath(material.specularColorMap) } : {}),
        ...(normalizeTexturePath(material.specularIntensityMap) ? { specularIntensityMapPath: normalizeTexturePath(material.specularIntensityMap) } : {}),
        ...(normalizeTexturePath(material.transmissionMap) ? { transmissionMapPath: normalizeTexturePath(material.transmissionMap) } : {}),
        ...(normalizeTexturePath(material.thicknessMap) ? { thicknessMapPath: normalizeTexturePath(material.thicknessMap) } : {}),
        ...(normalizeTexturePath(material.sheenColorMap) ? { sheenColorMapPath: normalizeTexturePath(material.sheenColorMap) } : {}),
        ...(normalizeTexturePath(material.sheenRoughnessMap) ? { sheenRoughnessMapPath: normalizeTexturePath(material.sheenRoughnessMap) } : {}),
        ...(normalizeTexturePath(material.anisotropyMap) ? { anisotropyMapPath: normalizeTexturePath(material.anisotropyMap) } : {}),
        ...(normalizeTexturePath(material.iridescenceMap) ? { iridescenceMapPath: normalizeTexturePath(material.iridescenceMap) } : {}),
        ...(normalizeTexturePath(material.iridescenceThicknessMap) ? { iridescenceThicknessMapPath: normalizeTexturePath(material.iridescenceThicknessMap) } : {}),
    };
    if (!Object.values(record).some((value) => value !== null && value !== undefined)) {
        return null;
    }
    return record;
}
function mergeUrdfMaterialMetadataMaps(targetMap, nextMap) {
    if (!(targetMap instanceof Map) || !(nextMap instanceof Map)) {
        return;
    }
    for (const [primPath, rawMetadata] of nextMap.entries()) {
        const normalizedPrimPath = normalizeHydraPath(primPath || '');
        if (!normalizedPrimPath || !rawMetadata || typeof rawMetadata !== 'object') {
            continue;
        }
        const existingMetadata = targetMap.get(normalizedPrimPath) || {};
        const color = String(rawMetadata.color || '').trim();
        const texture = String(rawMetadata.texture || '').trim();
        if (color && !existingMetadata.color) {
            existingMetadata.color = color;
        }
        if (texture && !existingMetadata.texture) {
            existingMetadata.texture = texture;
        }
        if (existingMetadata.color || existingMetadata.texture) {
            targetMap.set(normalizedPrimPath, existingMetadata);
        }
    }
}
function normalizeUsdMaterialBindingStrength(value) {
    const normalized = String(value || '').trim();
    if (/^strongerThanDescendants$/i.test(normalized)) {
        return 'strongerThanDescendants';
    }
    if (/^weakerThanDescendants$/i.test(normalized)) {
        return 'weakerThanDescendants';
    }
    return '';
}
function getUsdMaterialBindingStrengthFromEntry(entry) {
    return normalizeUsdMaterialBindingStrength(entry?.bindingStrength || entry?.bindMaterialAs || '');
}
function attachUsdMaterialBindingStrength(entry, bindingStrength) {
    const normalizedStrength = normalizeUsdMaterialBindingStrength(bindingStrength);
    if (!entry || typeof entry !== 'object' || !normalizedStrength) {
        return entry;
    }
    Object.defineProperty(entry, 'bindingStrength', {
        value: normalizedStrength,
        enumerable: false,
        configurable: true,
    });
    Object.defineProperty(entry, 'bindMaterialAs', {
        value: normalizedStrength,
        enumerable: false,
        configurable: true,
    });
    return entry;
}
function mergeUsdMaterialBindingMaps(targetMap, nextMap) {
    if (!(targetMap instanceof Map) || !(nextMap instanceof Map)) {
        return;
    }
    for (const [primPath, rawEntry] of nextMap.entries()) {
        const normalizedPrimPath = normalizeHydraPath(primPath || '');
        if (!normalizedPrimPath || !rawEntry || typeof rawEntry !== 'object') {
            continue;
        }
        const existingEntry = targetMap.get(normalizedPrimPath) || {
            materialId: null,
            geomSubsetSections: [],
        };
        const nextMaterialId = normalizeHydraPath(rawEntry.materialId || '') || null;
        const nextBindingStrength = getUsdMaterialBindingStrengthFromEntry(rawEntry);
        const existingBindingStrength = getUsdMaterialBindingStrengthFromEntry(existingEntry);
        const shouldOverrideMaterialId = nextBindingStrength === 'strongerThanDescendants'
            && existingBindingStrength !== 'strongerThanDescendants';
        if (nextMaterialId && (!existingEntry.materialId || shouldOverrideMaterialId)) {
            existingEntry.materialId = nextMaterialId;
            attachUsdMaterialBindingStrength(existingEntry, nextBindingStrength);
        }
        const mergedSections = Array.isArray(existingEntry.geomSubsetSections)
            ? existingEntry.geomSubsetSections.slice()
            : [];
        const knownSectionKeys = new Set(mergedSections.map((section) => `${section.start}:${section.length}:${section.materialId}`));
        const rawSections = Array.isArray(rawEntry.geomSubsetSections)
            ? rawEntry.geomSubsetSections
            : [];
        for (const rawSection of rawSections) {
            const start = Number(rawSection?.start);
            const length = Number(rawSection?.length);
            const materialId = normalizeHydraPath(rawSection?.materialId || '') || '';
            if (!Number.isFinite(start) || !Number.isFinite(length) || length <= 0 || !materialId) {
                continue;
            }
            const normalizedSection = {
                start: Math.max(0, Math.floor(start)),
                length: Math.max(0, Math.floor(length)),
                materialId,
            };
            const sectionKey = `${normalizedSection.start}:${normalizedSection.length}:${normalizedSection.materialId}`;
            if (knownSectionKeys.has(sectionKey)) {
                continue;
            }
            knownSectionKeys.add(sectionKey);
            mergedSections.push(normalizedSection);
        }
        mergedSections.sort((left, right) => {
            if (left.start !== right.start) {
                return left.start - right.start;
            }
            if (left.length !== right.length) {
                return left.length - right.length;
            }
            return String(left.materialId || '').localeCompare(String(right.materialId || ''));
        });
        if (existingEntry.materialId || mergedSections.length > 0) {
            const storedEntry = {
                materialId: existingEntry.materialId || null,
                geomSubsetSections: mergedSections,
            };
            attachUsdMaterialBindingStrength(storedEntry, getUsdMaterialBindingStrengthFromEntry(existingEntry));
            targetMap.set(normalizedPrimPath, storedEntry);
        }
    }
}
function findUrdfMaterialMetadataForDescriptor(materialMetadataByPrimPath, descriptor) {
    if (!(materialMetadataByPrimPath instanceof Map) || !descriptor || typeof descriptor !== 'object') {
        return null;
    }
    const candidates = [
        normalizeHydraPath(descriptor.resolvedPrimPath || ''),
        normalizeHydraPath(descriptor.meshId || ''),
    ].filter(Boolean);
    for (const candidatePath of candidates) {
        let currentPath = candidatePath;
        while (currentPath) {
            const metadata = materialMetadataByPrimPath.get(currentPath);
            if (metadata && (metadata.color || metadata.texture)) {
                return {
                    metadataPath: currentPath,
                    metadata,
                };
            }
            const lastSlashIndex = currentPath.lastIndexOf('/');
            if (lastSlashIndex <= 0) {
                break;
            }
            currentPath = currentPath.slice(0, lastSlashIndex);
        }
    }
    return null;
}
function findUsdMaterialBindingForDescriptor(materialBindingsByPrimPath, descriptor) {
    if (!(materialBindingsByPrimPath instanceof Map) || !descriptor || typeof descriptor !== 'object') {
        return null;
    }
    const candidatePaths = [
        normalizeHydraPath(descriptor.resolvedPrimPath || ''),
        normalizeHydraPath(descriptor.meshId || ''),
    ].filter(Boolean);
    const exactMatch = candidatePaths
        .map((candidatePath) => materialBindingsByPrimPath.get(candidatePath))
        .find((entry) => entry && typeof entry === 'object');
    let materialId = normalizeHydraPath(exactMatch?.materialId || '') || null;
    let bindingStrength = getUsdMaterialBindingStrengthFromEntry(exactMatch);
    const geomSubsetSections = Array.isArray(exactMatch?.geomSubsetSections)
        ? exactMatch.geomSubsetSections
            .map((section) => {
            const start = Number(section?.start);
            const length = Number(section?.length);
            const sectionMaterialId = normalizeHydraPath(section?.materialId || '') || '';
            if (!Number.isFinite(start) || !Number.isFinite(length) || length <= 0 || !sectionMaterialId) {
                return null;
            }
            return {
                start: Math.max(0, Math.floor(start)),
                length: Math.max(0, Math.floor(length)),
                materialId: sectionMaterialId,
            };
        })
            .filter(Boolean)
        : [];
    if (!materialId) {
        for (const candidatePath of candidatePaths) {
            let currentPath = candidatePath;
            while (currentPath) {
                const entry = materialBindingsByPrimPath.get(currentPath);
                const candidateMaterialId = normalizeHydraPath(entry?.materialId || '') || null;
                if (candidateMaterialId) {
                    materialId = candidateMaterialId;
                    bindingStrength = getUsdMaterialBindingStrengthFromEntry(entry);
                    break;
                }
                const lastSlashIndex = currentPath.lastIndexOf('/');
                if (lastSlashIndex <= 0) {
                    break;
                }
                currentPath = currentPath.slice(0, lastSlashIndex);
            }
            if (materialId) {
                break;
            }
        }
    }
    if (!materialId && geomSubsetSections.length === 0) {
        return null;
    }
    return {
        materialId,
        geomSubsetSections,
        bindingStrength,
    };
}
function getRoundtripMaterialRecoveryCacheKey(stageSourcePath) {
    const normalizedStageSourcePath = String(stageSourcePath || '').trim().split('?')[0];
    return normalizedStageSourcePath || '__unknown_stage__';
}
function buildStageLayerTextSignature(stageLayerTexts) {
    if (!Array.isArray(stageLayerTexts) || stageLayerTexts.length === 0) {
        return '0';
    }
    return stageLayerTexts
        .map((layerText, index) => {
        const normalizedText = typeof layerText === 'string' ? layerText : '';
        return [
            index,
            normalizedText.length,
            normalizedText.slice(0, 32),
            normalizedText.slice(-32),
        ].join(':');
    })
        .join('|');
}
function getParsedRoundtripMaterialRecovery(delegate, stageSourcePath, stageLayerTexts, { includeUsdMaterialBindings = false } = {}) {
    const cacheMap = delegate._roundtripMaterialRecoveryByStageSource instanceof Map
        ? delegate._roundtripMaterialRecoveryByStageSource
        : (() => {
            const nextMap = new Map();
            delegate._roundtripMaterialRecoveryByStageSource = nextMap;
            return nextMap;
        })();
    const cacheKey = getRoundtripMaterialRecoveryCacheKey(stageSourcePath);
    const normalizedLayerTexts = Array.isArray(stageLayerTexts)
        ? stageLayerTexts
            .filter((layerText) => typeof layerText === 'string' && layerText.length > 0)
        : [];
    const layerTextSignature = buildStageLayerTextSignature(normalizedLayerTexts);
    const existingEntry = cacheMap.get(cacheKey) || null;
    if (existingEntry
        && existingEntry.layerTextSignature === layerTextSignature
        && (!includeUsdMaterialBindings || existingEntry.usdMaterialBindingsByPrimPath instanceof Map)) {
        return existingEntry;
    }
    const nextEntry = {
        layerTextSignature,
        urdfMaterialMetadataByPrimPath: new Map(),
        usdMaterialBindingsByPrimPath: includeUsdMaterialBindings ? new Map() : null,
    };
    for (const layerText of normalizedLayerTexts) {
        mergeUrdfMaterialMetadataMaps(nextEntry.urdfMaterialMetadataByPrimPath, parseUrdfMaterialMetadataFromLayerText(layerText));
        if (includeUsdMaterialBindings && nextEntry.usdMaterialBindingsByPrimPath instanceof Map) {
            mergeUsdMaterialBindingMaps(nextEntry.usdMaterialBindingsByPrimPath, parseUsdMaterialBindingsFromLayerText(layerText));
        }
    }
    cacheMap.set(cacheKey, nextEntry);
    return nextEntry;
}
export class ThreeRenderDelegateInterface extends ThreeRenderDelegateMaterialOps {
    stageShaderRequiresPhysicalMaterial(shaderPrim) {
        if (!shaderPrim)
            return false;
        const candidateAttributeNames = [
            'inputs:clearcoat',
            'inputs:coat',
            'inputs:coat_weight',
            'inputs:clearcoatRoughness',
            'inputs:clearcoat_roughness',
            'inputs:coat_roughness',
            'inputs:clearcoatNormalScale',
            'inputs:clearcoat_normal_scale',
            'inputs:specular',
            'inputs:specular_constant',
            'inputs:specularIntensity',
            'inputs:specular_intensity',
            'inputs:specularColor',
            'inputs:specular_color',
            'inputs:ior',
            'inputs:indexOfRefraction',
            'inputs:index_of_refraction',
            'inputs:transmission',
            'inputs:transmission_weight',
            'inputs:thickness',
            'inputs:thickness_constant',
            'inputs:attenuationDistance',
            'inputs:attenuation_distance',
            'inputs:attenuationColor',
            'inputs:attenuation_color',
            'inputs:sheen',
            'inputs:sheen_weight',
            'inputs:sheenColor',
            'inputs:sheen_color',
            'inputs:sheenRoughness',
            'inputs:sheen_roughness',
            'inputs:iridescence',
            'inputs:iridescence_weight',
            'inputs:iridescenceIOR',
            'inputs:iridescence_ior',
            'inputs:anisotropy',
            'inputs:anisotropy_level',
            'inputs:anisotropyRotation',
            'inputs:anisotropy_rotation',
            'inputs:clearcoat_texture',
            'inputs:clearcoatRoughness_texture',
            'inputs:clearcoat_roughness_texture',
            'inputs:clearcoatNormal_texture',
            'inputs:clearcoat_normal_texture',
            'inputs:specularColor_texture',
            'inputs:specular_color_texture',
            'inputs:specular_texture',
            'inputs:specularIntensity_texture',
            'inputs:specular_intensity_texture',
            'inputs:transmission_texture',
            'inputs:transmission_weight_texture',
            'inputs:thickness_texture',
            'inputs:thickness_constant_texture',
            'inputs:sheenColor_texture',
            'inputs:sheen_color_texture',
            'inputs:sheenRoughness_texture',
            'inputs:sheen_roughness_texture',
            'inputs:anisotropy_texture',
            'inputs:iridescence_texture',
            'inputs:iridescence_weight_texture',
            'inputs:iridescenceThickness_texture',
            'inputs:iridescence_thickness_texture',
        ];
        return candidateAttributeNames.some((attributeName) => this.readPrimAttribute(shaderPrim, [attributeName]) !== undefined);
    }
    applyStageFallbackMaterialParameters(material, shaderPrim) {
        if (!material || !shaderPrim)
            return;
        const treatNamedHexDiffuseAsSrgb = this.shouldTreatNamedHexDiffuseAsSrgb();
        const isOmniPbrShader = this.isLikelyOmniPbrShaderPrim(shaderPrim);
        const emissiveEnabled = this.readPrimBooleanAttribute(shaderPrim, [
            'inputs:enable_emission',
            'inputs:enableEmission',
        ]);
        const effectiveEmissiveEnabled = emissiveEnabled === true
            ? true
            : (emissiveEnabled === false ? false : !isOmniPbrShader);
        if (material.userData && typeof material.userData === 'object') {
            if (isOmniPbrShader) {
                material.userData.usdIsOmniPbr = true;
            }
            if (emissiveEnabled !== undefined || isOmniPbrShader) {
                material.userData.usdEmissiveEnabled = effectiveEmissiveEnabled;
            }
        }
        const opacityEnabled = this.readPrimBooleanAttribute(shaderPrim, [
            'inputs:enable_opacity',
            'inputs:enableOpacity',
        ]);
        const opacityTextureEnabled = this.readPrimBooleanAttribute(shaderPrim, [
            'inputs:enable_opacity_texture',
            'inputs:enableOpacityTexture',
        ]);
        this.applyStageFallbackColorInput(material, shaderPrim, [
            'inputs:diffuseColor',
            'inputs:diffuse_color_constant',
            'inputs:diffuse_color',
            'inputs:baseColor',
            'inputs:base_color',
            'inputs:base_color_constant',
            'inputs:albedo',
            'inputs:albedo_constant',
        ], 'color', {
            treatAsSrgbWhenMatchingMaterialName: treatNamedHexDiffuseAsSrgb,
        });
        const roughnessAssigned = this.applyStageFallbackScalarInput(material, shaderPrim, [
            'inputs:roughness',
            'inputs:roughness_constant',
            'inputs:reflection_roughness',
            'inputs:reflection_roughness_constant',
            'inputs:specular_roughness',
        ], 'roughness', { clamp01: true });
        if (!roughnessAssigned && isOmniPbrShader) {
            // OmniPBR often omits explicit roughness attributes in exported USD.
            // Fall back to the shared viewer matte profile so USD matches URDF/MJCF better.
            material.roughness = HYDRA_UNIFIED_MATERIAL_DEFAULTS.roughness;
        }
        this.applyStageFallbackScalarInput(material, shaderPrim, [
            'inputs:metallic',
            'inputs:metallic_constant',
            'inputs:metalness',
            'inputs:metalness_constant',
        ], 'metalness', { clamp01: true });
        this.applyStageFallbackScalarInput(material, shaderPrim, [
            'inputs:opacity',
            'inputs:opacity_constant',
        ], 'opacity', {
            clamp01: true,
            onAssigned: (value) => {
                if (value < 1)
                    material.transparent = true;
            },
        });
        this.applyStageFallbackScalarInput(material, shaderPrim, [
            'inputs:opacityThreshold',
            'inputs:opacity_threshold',
            'inputs:alphaCutoff',
            'inputs:alpha_cutoff',
        ], 'alphaTest', {
            clamp01: true,
            onAssigned: (value) => {
                if (value > 0)
                    material.transparent = false;
            },
        });
        if (opacityEnabled === false) {
            material.opacity = 1;
            material.transparent = false;
            material.alphaTest = 0;
        }
        this.applyStageFallbackScalarInput(material, shaderPrim, [
            'inputs:clearcoat',
            'inputs:coat',
            'inputs:coat_weight',
        ], 'clearcoat', { clamp01: true });
        this.applyStageFallbackScalarInput(material, shaderPrim, [
            'inputs:clearcoatRoughness',
            'inputs:clearcoat_roughness',
            'inputs:coat_roughness',
        ], 'clearcoatRoughness', { clamp01: true });
        this.applyStageFallbackScalarInput(material, shaderPrim, [
            'inputs:ior',
            'inputs:indexOfRefraction',
            'inputs:index_of_refraction',
        ], 'ior', { min: 1 });
        this.applyStageFallbackScalarInput(material, shaderPrim, [
            'inputs:specular',
            'inputs:specular_constant',
            'inputs:specularIntensity',
            'inputs:specular_intensity',
        ], 'specularIntensity', { clamp01: true });
        this.applyStageFallbackScalarInput(material, shaderPrim, [
            'inputs:transmission',
            'inputs:transmission_weight',
        ], 'transmission', { clamp01: true });
        this.applyStageFallbackScalarInput(material, shaderPrim, [
            'inputs:thickness',
            'inputs:thickness_constant',
        ], 'thickness', { min: 0 });
        this.applyStageFallbackScalarInput(material, shaderPrim, [
            'inputs:attenuationDistance',
            'inputs:attenuation_distance',
        ], 'attenuationDistance', { min: 0 });
        this.applyStageFallbackScalarInput(material, shaderPrim, [
            'inputs:ao_strength',
            'inputs:occlusion_strength',
            'inputs:occlusion',
        ], 'aoMapIntensity', { clamp01: true });
        this.applyStageFallbackScalarInput(material, shaderPrim, [
            'inputs:sheen',
            'inputs:sheen_weight',
        ], 'sheen', { clamp01: true });
        this.applyStageFallbackScalarInput(material, shaderPrim, [
            'inputs:sheenRoughness',
            'inputs:sheen_roughness',
        ], 'sheenRoughness', { clamp01: true });
        this.applyStageFallbackScalarInput(material, shaderPrim, [
            'inputs:iridescence',
            'inputs:iridescence_weight',
        ], 'iridescence', { clamp01: true });
        this.applyStageFallbackScalarInput(material, shaderPrim, [
            'inputs:iridescenceIOR',
            'inputs:iridescence_ior',
        ], 'iridescenceIOR', { min: 1 });
        this.applyStageFallbackScalarInput(material, shaderPrim, [
            'inputs:anisotropy',
            'inputs:anisotropy_level',
        ], 'anisotropy', { clamp01: true });
        this.applyStageFallbackScalarInput(material, shaderPrim, [
            'inputs:anisotropyRotation',
            'inputs:anisotropy_rotation',
        ], 'anisotropyRotation');
        this.applyStageFallbackColorInput(material, shaderPrim, [
            'inputs:specularColor',
            'inputs:specular_color',
        ], 'specularColor');
        this.applyStageFallbackColorInput(material, shaderPrim, [
            'inputs:attenuationColor',
            'inputs:attenuation_color',
        ], 'attenuationColor');
        this.applyStageFallbackColorInput(material, shaderPrim, [
            'inputs:sheenColor',
            'inputs:sheen_color',
        ], 'sheenColor');
        const emissiveColor = this.applyStageFallbackColorInput(material, shaderPrim, [
            'inputs:emissiveColor',
            'inputs:emissive_color',
            'inputs:emissive_color_constant',
        ], 'emissive', {
            requireValue: effectiveEmissiveEnabled,
        });
        if (emissiveColor && !effectiveEmissiveEnabled) {
            material.emissive = new Color(0x000000);
        }
        if (!effectiveEmissiveEnabled) {
            material.emissive = new Color(0x000000);
            material.emissiveIntensity = 1;
        }
        else {
            this.applyStageFallbackScalarInput(material, shaderPrim, [
                'inputs:emissive_intensity',
            ], 'emissiveIntensity', { min: 0 });
        }
        const normalScaleValue = this.readPrimAttribute(shaderPrim, [
            'inputs:normalScale',
            'inputs:normal_scale',
        ]);
        const normalScaleTuple = toFiniteVector2Tuple(normalScaleValue)
            || (() => {
                const scalar = toFiniteNumber(normalScaleValue);
                if (scalar === undefined)
                    return null;
                return [scalar, scalar];
            })();
        if (normalScaleTuple) {
            material.normalScale = new Vector2(normalScaleTuple[0], normalScaleTuple[1]);
        }
        const clearcoatNormalScaleValue = this.readPrimAttribute(shaderPrim, [
            'inputs:clearcoatNormalScale',
            'inputs:clearcoat_normal_scale',
        ]);
        const clearcoatNormalScaleTuple = toFiniteVector2Tuple(clearcoatNormalScaleValue)
            || (() => {
                const scalar = toFiniteNumber(clearcoatNormalScaleValue);
                if (scalar === undefined)
                    return null;
                return [scalar, scalar];
            })();
        if (clearcoatNormalScaleTuple) {
            material.clearcoatNormalScale = new Vector2(clearcoatNormalScaleTuple[0], clearcoatNormalScaleTuple[1]);
        }
        this.applyStageFallbackTextureInput(material, shaderPrim, [
            'inputs:diffuseColor_texture',
            'inputs:diffuse_color_texture',
            'inputs:baseColor_texture',
            'inputs:base_color_texture',
            'inputs:albedo_texture',
        ], 'map', {
            colorSpace: SRGBColorSpace,
            onAssigned: () => {
                material.color = new Color(0xffffff);
            },
        });
        if (effectiveEmissiveEnabled) {
            this.applyStageFallbackTextureInput(material, shaderPrim, [
                'inputs:emissiveColor_texture',
                'inputs:emissive_color_texture',
                'inputs:emissive_texture',
            ], 'emissiveMap', {
                colorSpace: SRGBColorSpace,
                onAssigned: () => {
                    material.emissive = new Color(0xffffff);
                },
            });
        }
        this.applyStageFallbackTextureInput(material, shaderPrim, [
            'inputs:roughness_texture',
            'inputs:reflection_roughness_texture',
            'inputs:specular_roughness_texture',
        ], 'roughnessMap', {
            onAssigned: () => {
                material.roughness = 1;
            },
        });
        this.applyStageFallbackTextureInput(material, shaderPrim, [
            'inputs:metallic_texture',
            'inputs:metalness_texture',
        ], 'metalnessMap', {
            onAssigned: () => {
                material.metalness = 1;
            },
        });
        this.applyStageFallbackTextureInput(material, shaderPrim, [
            'inputs:normal_texture',
            'inputs:normalmap_texture',
            'inputs:normal_map_texture',
        ], 'normalMap');
        this.applyStageFallbackTextureInput(material, shaderPrim, [
            'inputs:occlusion_texture',
            'inputs:occlusion_map',
            'inputs:ao_texture',
        ], 'aoMap');
        if (opacityEnabled !== false && opacityTextureEnabled !== false) {
            this.applyStageFallbackTextureInput(material, shaderPrim, [
                'inputs:opacity_texture',
                'inputs:opacity_mask_texture',
                'inputs:opacityMask_texture',
            ], 'alphaMap', {
                onAssigned: () => {
                    if (!(material.alphaTest > 0))
                        material.transparent = true;
                },
            });
        }
        this.applyStageFallbackTextureInput(material, shaderPrim, [
            'inputs:clearcoat_texture',
            'inputs:coat_texture',
        ], 'clearcoatMap');
        this.applyStageFallbackTextureInput(material, shaderPrim, [
            'inputs:clearcoatRoughness_texture',
            'inputs:clearcoat_roughness_texture',
            'inputs:coat_roughness_texture',
        ], 'clearcoatRoughnessMap');
        this.applyStageFallbackTextureInput(material, shaderPrim, [
            'inputs:clearcoatNormal_texture',
            'inputs:clearcoat_normal_texture',
        ], 'clearcoatNormalMap');
        this.applyStageFallbackTextureInput(material, shaderPrim, [
            'inputs:specularColor_texture',
            'inputs:specular_color_texture',
        ], 'specularColorMap', {
            colorSpace: SRGBColorSpace,
        });
        this.applyStageFallbackTextureInput(material, shaderPrim, [
            'inputs:specular_texture',
            'inputs:specular_intensity_texture',
        ], 'specularIntensityMap');
        this.applyStageFallbackTextureInput(material, shaderPrim, [
            'inputs:transmission_texture',
            'inputs:transmission_weight_texture',
        ], 'transmissionMap');
        this.applyStageFallbackTextureInput(material, shaderPrim, [
            'inputs:thickness_texture',
        ], 'thicknessMap');
        this.applyStageFallbackTextureInput(material, shaderPrim, [
            'inputs:sheenColor_texture',
            'inputs:sheen_color_texture',
        ], 'sheenColorMap', {
            colorSpace: SRGBColorSpace,
        });
        this.applyStageFallbackTextureInput(material, shaderPrim, [
            'inputs:sheenRoughness_texture',
            'inputs:sheen_roughness_texture',
        ], 'sheenRoughnessMap');
        this.applyStageFallbackTextureInput(material, shaderPrim, [
            'inputs:anisotropy_texture',
        ], 'anisotropyMap');
        this.applyStageFallbackTextureInput(material, shaderPrim, [
            'inputs:iridescence_texture',
            'inputs:iridescence_weight_texture',
        ], 'iridescenceMap');
        this.applyStageFallbackTextureInput(material, shaderPrim, [
            'inputs:iridescenceThickness_texture',
            'inputs:iridescence_thickness_texture',
        ], 'iridescenceThicknessMap');
    }
    applyStageFallbackScalarInput(material, shaderPrim, attributeNames, materialProperty, options = {}) {
        const value = this.readPrimAttribute(shaderPrim, attributeNames);
        const numericValue = toFiniteNumber(value);
        if (numericValue === undefined)
            return false;
        let normalizedValue = numericValue;
        if (options.clamp01)
            normalizedValue = clamp01(normalizedValue);
        if (Number.isFinite(options.min))
            normalizedValue = Math.max(Number(options.min), normalizedValue);
        if (Number.isFinite(options.max))
            normalizedValue = Math.min(Number(options.max), normalizedValue);
        material[materialProperty] = normalizedValue;
        if (typeof options.onAssigned === 'function') {
            options.onAssigned(normalizedValue);
        }
        return true;
    }
    applyStageFallbackColorInput(material, shaderPrim, attributeNames, materialProperty, options = {}) {
        const value = this.readPrimAttribute(shaderPrim, attributeNames);
        const color = toColorArray(value);
        if (!color)
            return null;
        if (options.requireValue === false)
            return color;
        let nextColor = createHydraColorFromTuple(color, options.colorSpace || null);
        const inferredHex = this.inferColorHexFromMaterialName(material?.name);
        if (options.treatAsSrgbWhenMatchingMaterialName && material?.name) {
            if (Number.isFinite(inferredHex)) {
                const sr = ((inferredHex >> 16) & 0xff) / 255;
                const sg = ((inferredHex >> 8) & 0xff) / 255;
                const sb = (inferredHex & 0xff) / 255;
                const colorEpsilon = 1 / 255 + 1e-4;
                const matchesNamedSrgbColor = Math.abs(color[0] - sr) <= colorEpsilon
                    && Math.abs(color[1] - sg) <= colorEpsilon
                    && Math.abs(color[2] - sb) <= colorEpsilon;
                if (matchesNamedSrgbColor) {
                    nextColor = new Color(inferredHex);
                }
            }
        }
        material[materialProperty] = nextColor;
        return color;
    }
    applyStageFallbackTextureInput(material, shaderPrim, attributeNames, materialProperty, options = {}) {
        const texturePath = this.resolveMaterialTexturePath(shaderPrim, attributeNames);
        if (!texturePath)
            return false;
        this.registry.getTexture(texturePath).then((texture) => {
            const nextTexture = texture?.clone ? texture.clone() : texture;
            if (!nextTexture)
                return;
            nextTexture.colorSpace = options.colorSpace || LinearSRGBColorSpace;
            nextTexture.needsUpdate = true;
            material[materialProperty] = nextTexture;
            if (typeof options.onAssigned === 'function') {
                options.onAssigned(nextTexture);
            }
            material.needsUpdate = true;
        }).catch((error) => {
            const warn = getRawConsoleMethod('warn');
            warn('[HydraDelegate] Failed to apply stage fallback texture input.', {
                texturePath,
                materialProperty,
                materialName: String(material?.name || ''),
                error: error instanceof Error ? error.message : String(error || 'unknown-error'),
            });
        });
        return true;
    }
    safeGetPrimAtPath(stage, path) {
        if (!stage || !path)
            return null;
        const normalizedPath = normalizeHydraPath(path);
        if (!normalizedPath)
            return null;
        if (this._primPathExistenceCache.has(normalizedPath)) {
            if (this._primPathExistenceCache.get(normalizedPath) === false) {
                return null;
            }
        }
        else if (this._knownPrimPathSetPrimed === true && this._knownPrimPathSet instanceof Set) {
            if (!this._knownPrimPathSet.has(normalizedPath)) {
                this._primPathExistenceCache.set(normalizedPath, false);
                return null;
            }
        }
        else if (this._knownPrimPathSetPrimed !== true) {
            const allowOnDemandPrimPathBatch = this.autoBatchPrimTransformsOnFirstAccess === true
                || this.autoBatchProtoBlobsOnFirstAccess === true
                || this.autoBatchCollisionProtoOverridesOnFirstAccess === true
                || this.autoBatchVisualProtoOverridesOnFirstAccess === true;
            if (allowOnDemandPrimPathBatch) {
                const driver = this.config?.driver?.();
                if (driver) {
                    try {
                        this.prefetchPrimPathSetFromDriver(driver, { force: false });
                    }
                    catch {
                        // Keep fallback path resilient.
                    }
                }
            }
            if (this._knownPrimPathSetPrimed === true && this._knownPrimPathSet instanceof Set && !this._knownPrimPathSet.has(normalizedPath)) {
                this._primPathExistenceCache.set(normalizedPath, false);
                return null;
            }
        }
        try {
            const prim = stage.GetPrimAtPath(normalizedPath);
            if (!prim) {
                this._primPathExistenceCache.set(normalizedPath, false);
                return null;
            }
            this._primPathExistenceCache.set(normalizedPath, true);
            if (this._knownPrimPathSet instanceof Set) {
                this._knownPrimPathSet.add(normalizedPath);
            }
            return prim;
        }
        catch {
            this._primPathExistenceCache.set(normalizedPath, false);
            return null;
        }
    }
    findMaterialShaderPrim(stage, materialPath, materialName) {
        const candidateNames = [];
        const addCandidate = (name) => {
            if (!name || candidateNames.includes(name))
                return;
            candidateNames.push(name);
        };
        addCandidate('Shader');
        addCandidate(this.getPreferredShaderName(materialName));
        addCandidate(materialName);
        addCandidate('PreviewSurface');
        addCandidate('UsdPreviewSurface');
        addCandidate('surfaceShader');
        addCandidate('Surface');
        addCandidate('PBRShader');
        addCandidate('MtlxStandardSurface');
        addCandidate('mtlxstandard_surface');
        addCandidate('ND_standard_surface_surfaceshader');
        for (const candidateName of candidateNames) {
            const shaderPath = `${materialPath}/${candidateName}`;
            const shaderPrim = this.safeGetPrimAtPath(stage, shaderPath);
            if (!shaderPrim)
                continue;
            if (this.isUsableMaterialShaderPrim(shaderPrim)) {
                return shaderPrim;
            }
        }
        return null;
    }
    isUsableMaterialShaderPrim(shaderPrim) {
        if (!shaderPrim)
            return false;
        const shaderType = getSafePrimTypeName(shaderPrim);
        if (shaderType === 'shader')
            return true;
        if (shaderType && shaderType !== 'shader')
            return false;
        let propertyNames = [];
        try {
            propertyNames = shaderPrim.GetPropertyNames?.() || [];
        }
        catch {
            propertyNames = [];
        }
        if (!Array.isArray(propertyNames) && propertyNames && typeof propertyNames[Symbol.iterator] === 'function') {
            propertyNames = Array.from(propertyNames);
        }
        if (!Array.isArray(propertyNames) || propertyNames.length === 0)
            return false;
        return propertyNames.some((name) => name === 'info:id' ||
            name.startsWith('inputs:') ||
            name.startsWith('outputs:'));
    }
    getPreferredShaderName(materialName) {
        if (!materialName)
            return 'Shader';
        const lowered = materialName.toLowerCase();
        if (lowered === 'material_dark' || lowered === 'material_white')
            return 'Shader';
        if (/^material_[0-9]{9}$/i.test(materialName))
            return 'Shader';
        return materialName;
    }
    inferColorHexFromMaterialName(materialName) {
        const normalized = String(materialName || '').trim();
        if (!normalized)
            return null;
        const basename = normalized.split('/').filter(Boolean).pop() || normalized;
        const decimalRgbMatch = basename.match(/^material_(\d{3})(\d{3})(\d{3})$/i);
        if (decimalRgbMatch) {
            const red = Number.parseInt(decimalRgbMatch[1], 10);
            const green = Number.parseInt(decimalRgbMatch[2], 10);
            const blue = Number.parseInt(decimalRgbMatch[3], 10);
            const isValidTriplet = [red, green, blue].every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 255);
            if (isValidTriplet) {
                return (red << 16) | (green << 8) | blue;
            }
        }
        const match = normalized.match(/([0-9a-f]{6})$/i);
        if (!match)
            return null;
        const parsed = Number.parseInt(match[1], 16);
        if (!Number.isFinite(parsed))
            return null;
        return parsed;
    }
    readPrimAttribute(prim, attributeNames) {
        if (!prim || !Array.isArray(attributeNames))
            return undefined;
        for (const attributeName of attributeNames) {
            let value = undefined;
            try {
                value = prim.GetAttribute(attributeName)?.Get();
            }
            catch {
                value = undefined;
            }
            if (value !== undefined && value !== null)
                return value;
        }
        return undefined;
    }
    readPrimBooleanAttribute(prim, attributeNames) {
        const value = this.readPrimAttribute(prim, attributeNames);
        if (typeof value === 'boolean')
            return value;
        const numeric = toFiniteNumber(value);
        if (numeric !== undefined)
            return numeric !== 0;
        if (value === null || value === undefined)
            return undefined;
        const normalized = String(value || '').trim().toLowerCase();
        if (!normalized)
            return undefined;
        if (normalized === 'true' || normalized === 'yes' || normalized === 'on')
            return true;
        if (normalized === 'false' || normalized === 'no' || normalized === 'off')
            return false;
        return undefined;
    }
    isLikelyOmniPbrShaderPrim(shaderPrim) {
        if (!shaderPrim)
            return false;
        const signatures = [
            this.readPrimAttribute(shaderPrim, ['info:id']),
            this.readPrimAttribute(shaderPrim, ['info:mdl:sourceAsset:subIdentifier']),
            this.readPrimAttribute(shaderPrim, ['info:mdl:sourceAsset']),
        ];
        return signatures.some((value) => String(value || '').toLowerCase().includes('omnipbr'));
    }
    normalizeMaterialTexturePath(pathValue) {
        if (pathValue === null || pathValue === undefined)
            return null;
        const text = String(pathValue || '').trim();
        if (!text)
            return null;
        const withoutAssetDelimiters = text.replace(/^@+/, '').replace(/@+$/, '');
        const normalizedPath = withoutAssetDelimiters.replace(/\\/g, '/');
        if (!normalizedPath)
            return null;
        return normalizedPath.replace('./', '');
    }
    extractMaterialTexturePath(texturePathValue) {
        if (!texturePathValue)
            return null;
        if (typeof texturePathValue === 'string') {
            return this.normalizeMaterialTexturePath(texturePathValue);
        }
        const objectPath = texturePathValue?.resolvedPath || texturePathValue?.path || texturePathValue?.assetPath;
        if (typeof objectPath === 'string' && objectPath.length > 0) {
            return this.normalizeMaterialTexturePath(objectPath);
        }
        try {
            if (typeof texturePathValue.GetResolvedPath === 'function') {
                const resolvedPath = texturePathValue.GetResolvedPath();
                if (typeof resolvedPath === 'string' && resolvedPath.length > 0) {
                    return this.normalizeMaterialTexturePath(resolvedPath);
                }
            }
        }
        catch { }
        try {
            if (typeof texturePathValue.GetAssetPath === 'function') {
                const assetPath = texturePathValue.GetAssetPath();
                if (typeof assetPath === 'string' && assetPath.length > 0) {
                    return this.normalizeMaterialTexturePath(assetPath);
                }
            }
        }
        catch { }
        return null;
    }
    resolveMaterialTexturePath(shaderPrim, attributeNames = null) {
        const candidateAttributeNames = Array.isArray(attributeNames) && attributeNames.length > 0
            ? attributeNames
            : [
                'inputs:diffuseColor_texture',
                'inputs:diffuse_color_texture',
                'inputs:albedo_texture',
                'inputs:base_color_texture',
            ];
        const texturePathValue = this.readPrimAttribute(shaderPrim, candidateAttributeNames);
        if (!texturePathValue)
            return null;
        return this.extractMaterialTexturePath(texturePathValue);
    }
    getNamedNonDefaultMaterial(materialValue) {
        const materials = Array.isArray(materialValue) ? materialValue : [materialValue];
        let fallbackMaterial = null;
        for (const material of materials) {
            if (!material || material === getDefaultMaterial())
                continue;
            if (isLikelyDefaultGrayMaterial(material))
                continue;
            const materialName = String(material.name || '').trim();
            const hasExplicitName = materialName.length > 0 && materialName !== 'DefaultMaterial';
            if (hasExplicitName)
                return material;
            if (!fallbackMaterial)
                fallbackMaterial = material;
        }
        return fallbackMaterial;
    }
    getPreferredVisualMaterialForLink(linkPath, requestingMeshId = null) {
        if (!linkPath)
            return null;
        if (this._preferredVisualMaterialByLinkCache.has(linkPath)) {
            return this._preferredVisualMaterialByLinkCache.get(linkPath) || null;
        }
        const prefix = `${linkPath}/visuals.proto_`;
        let preferredMaterial = null;
        let bestScore = -1;
        for (const [meshId, mesh] of Object.entries(this.meshes)) {
            if (!meshId || !meshId.startsWith(prefix) || meshId === requestingMeshId)
                continue;
            const candidateMaterial = this.getNamedNonDefaultMaterial(mesh?._mesh?.material);
            if (!candidateMaterial)
                continue;
            let score = 0;
            if (meshId.endsWith('/visuals.proto_mesh_id0'))
                score += 100;
            else if (meshId.includes('/visuals.proto_mesh_id'))
                score += 80;
            else if (meshId.includes('/visuals.proto_'))
                score += 40;
            const materialName = String(candidateMaterial.name || '').trim();
            if (materialName.length > 0 && materialName !== 'DefaultMaterial')
                score += 20;
            if (score > bestScore) {
                preferredMaterial = candidateMaterial;
                bestScore = score;
            }
        }
        if (preferredMaterial) {
            this._preferredVisualMaterialByLinkCache.set(linkPath, preferredMaterial);
        }
        return preferredMaterial || null;
    }
    runStageTruthAlignmentDiagnostics() {
        if (this._hasRunStageTruthAlignmentDiagnostics)
            return;
        this._hasRunStageTruthAlignmentDiagnostics = true;
        const diagnosticsEnabled = globalThis?.__HYDRA_DEBUG_STAGE_ALIGNMENT__ === true;
        if (!diagnosticsEnabled)
            return;
        const linkPaths = new Set();
        for (const meshId of Object.keys(this.meshes)) {
            const proto = parseProtoMeshIdentifier(meshId);
            if (!proto?.linkPath)
                continue;
            linkPaths.add(proto.linkPath);
        }
        if (linkPaths.size === 0)
            return;
        const mismatches = [];
        const sampledLinkPaths = Array.from(linkPaths).sort().slice(0, 24);
        for (const linkPath of sampledLinkPaths) {
            const stageMatrix = this.getWorldTransformForPrimPath(linkPath);
            if (!stageMatrix)
                continue;
            const meshMatrix = this.getRepresentativeVisualTransformForLinkPath(linkPath)
                || this.meshes[`${linkPath}/visuals.proto_mesh_id0`]?._mesh?.matrix
                || null;
            if (!meshMatrix)
                continue;
            let maxElementDelta = 0;
            for (let elementIndex = 0; elementIndex < 16; elementIndex++) {
                const delta = Math.abs((meshMatrix.elements[elementIndex] || 0) - (stageMatrix.elements[elementIndex] || 0));
                if (delta > maxElementDelta)
                    maxElementDelta = delta;
            }
            if (maxElementDelta > transformEpsilon) {
                mismatches.push(`${linkPath} (maxΔ=${maxElementDelta.toExponential(2)})`);
            }
        }
        void mismatches;
    }
    getRepresentativeVisualTransformForMeshId(meshId) {
        if (!meshId || !meshId.includes('.proto_'))
            return null;
        const proto = this._protoMeshMetadataByMeshId.get(meshId) || parseProtoMeshIdentifier(meshId);
        if (!proto || !proto.linkPath)
            return null;
        return this.getRepresentativeVisualTransformForLinkPath(proto.linkPath);
    }
    registerMeshLinkPathIndex(meshId) {
        if (!meshId || !meshId.includes('.proto_'))
            return null;
        const proto = parseProtoMeshIdentifier(meshId);
        if (!proto?.linkPath)
            return null;
        this._protoMeshMetadataByMeshId.set(meshId, proto);
        const meshMatrix = this.meshes[meshId]?._mesh?.matrix || null;
        const indexedMeshId = this._meshIdByLinkPath.get(proto.linkPath);
        if (!indexedMeshId || !this.meshes[indexedMeshId] || this.matrixHasNonIdentityRotation(meshMatrix)) {
            this._meshIdByLinkPath.set(proto.linkPath, meshId);
        }
        const indexedVisualMeshId = this._visualMeshIdByLinkPath.get(proto.linkPath);
        if (proto.sectionName === 'visuals' && (!indexedVisualMeshId || !this.meshes[indexedVisualMeshId])) {
            this._visualMeshIdByLinkPath.set(proto.linkPath, meshId);
        }
        return proto;
    }
    matrixHasNonIdentityRotation(matrix) {
        if (!matrix)
            return false;
        const position = this._decomposeScratchPosition;
        const quaternion = this._decomposeScratchQuaternion;
        const scale = this._decomposeScratchScale;
        matrix.decompose(position, quaternion, scale);
        return !isIdentityQuaternion(quaternion);
    }
    updateRepresentativeVisualTransformIndex(meshId, matrix) {
        if (!meshId || !meshId.includes('.proto_'))
            return;
        const proto = this._protoMeshMetadataByMeshId.get(meshId) || this.registerMeshLinkPathIndex(meshId);
        if (!proto?.linkPath)
            return;
        const indexedMeshId = this._meshIdByLinkPath.get(proto.linkPath);
        if (!indexedMeshId || !this.meshes[indexedMeshId]) {
            this._meshIdByLinkPath.set(proto.linkPath, meshId);
        }
        if (proto.sectionName === 'visuals') {
            const currentVisualMeshId = this._visualMeshIdByLinkPath.get(proto.linkPath);
            if (!currentVisualMeshId || !this.meshes[currentVisualMeshId] || this.matrixHasNonIdentityRotation(matrix)) {
                this._visualMeshIdByLinkPath.set(proto.linkPath, meshId);
            }
        }
        this._linkVisualTransformCache.delete(proto.linkPath);
    }
    getRepresentativeVisualTransformForLinkPath(linkPath) {
        if (!linkPath)
            return null;
        if (this._linkVisualTransformCache.has(linkPath)) {
            const cached = this._linkVisualTransformCache.get(linkPath);
            return cached ? cached.clone() : null;
        }
        const visualMeshId = this._visualMeshIdByLinkPath.get(linkPath);
        const fallbackMeshId = this._meshIdByLinkPath.get(linkPath);
        const visualMatrix = visualMeshId
            ? this.meshes[visualMeshId]?._mesh?.matrix
            : null;
        const fallbackMatrix = fallbackMeshId
            ? this.meshes[fallbackMeshId]?._mesh?.matrix
            : null;
        let bestMatrix = visualMatrix || null;
        let bestMatrixHasRotation = this.matrixHasNonIdentityRotation(bestMatrix);
        if ((!bestMatrix || !bestMatrixHasRotation) && fallbackMatrix) {
            const fallbackHasRotation = this.matrixHasNonIdentityRotation(fallbackMatrix);
            if (!bestMatrix || !bestMatrixHasRotation || fallbackHasRotation) {
                bestMatrix = fallbackMatrix;
                bestMatrixHasRotation = fallbackHasRotation;
            }
        }
        if (!bestMatrix) {
            const directVisualId = `${linkPath}/visuals.proto_mesh_id0`;
            bestMatrix = this.meshes[directVisualId]?._mesh?.matrix || null;
            if (bestMatrix) {
                this._visualMeshIdByLinkPath.set(linkPath, directVisualId);
                this._meshIdByLinkPath.set(linkPath, directVisualId);
            }
        }
        this._linkVisualTransformCache.set(linkPath, bestMatrix ? bestMatrix.clone() : null);
        return bestMatrix ? bestMatrix.clone() : null;
    }
    getFallbackTransformForMeshId(meshId) {
        if (!meshId || !meshId.includes('.proto_'))
            return null;
        if (this._meshFallbackCache.has(meshId)) {
            const cached = this._meshFallbackCache.get(meshId);
            return cached ? cached.clone() : null;
        }
        const pathEnd = meshId.indexOf('.proto_');
        const primPath = meshId.substring(0, pathEnd);
        const fallback = this.getWorldTransformForPrimPath(primPath);
        this._meshFallbackCache.set(meshId, fallback ? fallback.clone() : null);
        return fallback;
    }
    getSafeFallbackTransformForMeshId(meshId) {
        try {
            return this.getFallbackTransformForMeshId(meshId);
        }
        catch {
            return null;
        }
    }
    matrixFromWasmTransform(rawMatrix) {
        const rawValues = (rawMatrix && (Array.isArray(rawMatrix)
            || ArrayBuffer.isView(rawMatrix)
            || typeof rawMatrix.length === "number"))
            ? rawMatrix
            : toArrayLike(rawMatrix);
        if (!rawValues || Number(rawValues.length) < 16)
            return null;
        const m00 = Number(rawValues[0]);
        const m01 = Number(rawValues[1]);
        const m02 = Number(rawValues[2]);
        const m03 = Number(rawValues[3]);
        const m10 = Number(rawValues[4]);
        const m11 = Number(rawValues[5]);
        const m12 = Number(rawValues[6]);
        const m13 = Number(rawValues[7]);
        const m20 = Number(rawValues[8]);
        const m21 = Number(rawValues[9]);
        const m22 = Number(rawValues[10]);
        const m23 = Number(rawValues[11]);
        const m30 = Number(rawValues[12]);
        const m31 = Number(rawValues[13]);
        const m32 = Number(rawValues[14]);
        const m33 = Number(rawValues[15]);
        if (!Number.isFinite(m00) || !Number.isFinite(m01) || !Number.isFinite(m02) || !Number.isFinite(m03)
            || !Number.isFinite(m10) || !Number.isFinite(m11) || !Number.isFinite(m12) || !Number.isFinite(m13)
            || !Number.isFinite(m20) || !Number.isFinite(m21) || !Number.isFinite(m22) || !Number.isFinite(m23)
            || !Number.isFinite(m30) || !Number.isFinite(m31) || !Number.isFinite(m32) || !Number.isFinite(m33))
            return null;
        // USD bindings expose row-major matrix values; Three.js Matrix4 expects
        // column-major storage internally, so transpose once after assignment.
        const matrix = new Matrix4();
        matrix.set(m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33);
        matrix.transpose();
        return matrix;
    }
    normalizeProtoDataBlob(rawBlob) {
        if (!rawBlob || typeof rawBlob !== 'object')
            return null;
        if (rawBlob.valid !== true)
            return null;
        const toNonNegativeInt = (value) => {
            const numeric = Number(value);
            if (!Number.isFinite(numeric) || numeric < 0)
                return 0;
            return Math.floor(numeric);
        };
        const toAlignedPtr = (value) => {
            const numeric = Number(value);
            if (!Number.isFinite(numeric) || numeric <= 0)
                return 0;
            const ptr = Math.floor(numeric);
            return (ptr % 4) === 0 ? ptr : 0;
        };
        const keepTypedArrayView = (value) => {
            if (!value || typeof value.length !== 'number')
                return undefined;
            return ArrayBuffer.isView(value) ? value : undefined;
        };
        const keepSmallArrayLike = (value, maxLength) => {
            if (!value || typeof value.length !== 'number')
                return undefined;
            if (ArrayBuffer.isView(value))
                return value;
            const length = Number(value.length);
            if (!Number.isFinite(length) || length <= 0 || length > maxLength)
                return undefined;
            return value;
        };
        const normalizeGeomSubsetSections = (value) => {
            if (!value || typeof value.length !== 'number')
                return [];
            const out = [];
            const length = Number(value.length);
            const safeLength = Number.isFinite(length) && length > 0 ? Math.floor(length) : 0;
            for (let index = 0; index < safeLength; index += 1) {
                const rawSection = value[index];
                const start = Number(rawSection?.start);
                const sectionLength = Number(rawSection?.length);
                if (!Number.isFinite(start) || !Number.isFinite(sectionLength) || sectionLength <= 0)
                    continue;
                out.push({
                    start: Math.max(0, Math.floor(start)),
                    length: Math.max(0, Math.floor(sectionLength)),
                    materialId: typeof rawSection?.materialId === 'string'
                        ? normalizeHydraPath(rawSection.materialId)
                        : '',
                });
            }
            return out;
        };
        // Return a plain JS object with pointer/count metadata.
        // This prevents accidental high-frequency proxy reads on large payloads.
        return {
            valid: true,
            numVertices: toNonNegativeInt(rawBlob.numVertices),
            numIndices: toNonNegativeInt(rawBlob.numIndices),
            numUVs: toNonNegativeInt(rawBlob.numUVs),
            uvDimension: toNonNegativeInt(rawBlob.uvDimension),
            pointsPtr: toAlignedPtr(rawBlob.pointsPtr),
            indicesPtr: toAlignedPtr(rawBlob.indicesPtr),
            uvPtr: toAlignedPtr(rawBlob.uvPtr),
            transformPtr: toAlignedPtr(rawBlob.transformPtr),
            normalsPtr: toAlignedPtr(rawBlob.normalsPtr),
            numNormals: toNonNegativeInt(rawBlob.numNormals),
            normalsDimension: toNonNegativeInt(rawBlob.normalsDimension),
            renderReady: rawBlob.renderReady === true,
            topologyMode: normalizeTopologyMode(rawBlob.topologyMode)
                || (toNonNegativeInt(rawBlob.numIndices) > 0 ? 'indexed' : 'nonIndexed'),
            uvSource: typeof rawBlob.uvSource === 'string'
                ? String(rawBlob.uvSource || '').trim()
                : '',
            materialId: typeof rawBlob.materialId === 'string'
                ? normalizeHydraPath(rawBlob.materialId)
                : '',
            points: keepTypedArrayView(rawBlob.points),
            indices: keepTypedArrayView(rawBlob.indices),
            uv: keepTypedArrayView(rawBlob.uv),
            normals: keepTypedArrayView(rawBlob.normals),
            transform: keepSmallArrayLike(rawBlob.transform, 32),
            geomSubsetSections: normalizeGeomSubsetSections(rawBlob.geomSubsetSections),
            ...(normalizeNormalDiagnostics(rawBlob)
                ? { normalDiagnostics: normalizeNormalDiagnostics(rawBlob) }
                : {}),
        };
    }
    normalizeCollisionProtoOverride(rawOverride) {
        if (!rawOverride || typeof rawOverride !== 'object')
            return null;
        if (rawOverride.valid !== true)
            return null;
        const normalizeFiniteNumber = (value) => {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : undefined;
        };
        const normalizeAxis = (value) => {
            const normalized = String(value || '').trim().toUpperCase();
            if (normalized === 'X' || normalized === 'Y' || normalized === 'Z')
                return normalized;
            return 'Z';
        };
        const normalizeExtentSize = (value) => {
            if (!value || typeof value.length !== 'number' || Number(value.length) < 3)
                return null;
            const x = normalizeFiniteNumber(value[0]);
            const y = normalizeFiniteNumber(value[1]);
            const z = normalizeFiniteNumber(value[2]);
            if (x === undefined || y === undefined || z === undefined)
                return null;
            return [Math.max(0, x), Math.max(0, y), Math.max(0, z)];
        };
        const worldTransform = this.matrixFromWasmTransform(rawOverride.worldTransform) || null;
        if (!worldTransform)
            return null;
        const primType = String(rawOverride.primType || '').trim().toLowerCase();
        if (!primType)
            return null;
        const meshPayload = primType === 'mesh'
            ? (this.normalizeProtoDataBlob(rawOverride.meshPayload || rawOverride) || null)
            : null;
        return {
            valid: true,
            meshId: normalizeHydraPath(rawOverride.meshId || ''),
            resolvedPrimPath: normalizeHydraPath(rawOverride.resolvedPrimPath || ''),
            primType,
            axis: normalizeAxis(rawOverride.axis),
            size: normalizeFiniteNumber(rawOverride.size),
            radius: normalizeFiniteNumber(rawOverride.radius),
            height: normalizeFiniteNumber(rawOverride.height),
            extentSize: normalizeExtentSize(rawOverride.extentSize),
            worldTransform,
            worldTransformElements: (rawOverride.worldTransform
                && (Array.isArray(rawOverride.worldTransform)
                    || ArrayBuffer.isView(rawOverride.worldTransform)
                    || typeof rawOverride.worldTransform.length === 'number'))
                ? rawOverride.worldTransform
                : undefined,
            meshPayload: meshPayload || undefined,
        };
    }
    normalizeVisualProtoOverride(rawOverride) {
        return this.normalizeCollisionProtoOverride(rawOverride);
    }
    cacheResolvedWorldTransformFromOverride(overridePayload) {
        const resolvedPath = normalizeHydraPath(overridePayload?.resolvedPrimPath || '');
        const worldTransform = overridePayload?.worldTransform;
        if (!resolvedPath || !resolvedPath.startsWith('/'))
            return;
        if (!worldTransform || typeof worldTransform.clone !== 'function')
            return;
        this._worldXformCache?.set?.(resolvedPath, worldTransform.clone());
    }
    normalizePrimOverrideData(rawData) {
        if (!rawData || typeof rawData !== 'object')
            return null;
        if (rawData.valid !== true)
            return null;
        const normalizeFiniteNumber = (value) => {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : undefined;
        };
        const normalizeAxis = (value) => {
            const normalized = String(value || '').trim().toUpperCase();
            if (normalized === 'X' || normalized === 'Y' || normalized === 'Z')
                return normalized;
            return 'Z';
        };
        const normalizeExtentSize = (value) => {
            if (!value || typeof value.length !== 'number' || Number(value.length) < 3)
                return null;
            const x = normalizeFiniteNumber(value[0]);
            const y = normalizeFiniteNumber(value[1]);
            const z = normalizeFiniteNumber(value[2]);
            if (x === undefined || y === undefined || z === undefined)
                return null;
            return [Math.max(0, x), Math.max(0, y), Math.max(0, z)];
        };
        const worldTransform = this.matrixFromWasmTransform(rawData.worldTransform) || null;
        if (!worldTransform)
            return null;
        const primType = String(rawData.primType || '').trim().toLowerCase();
        if (!primType)
            return null;
        const meshPayload = primType === 'mesh'
            ? (this.normalizeProtoDataBlob(rawData.meshPayload || rawData) || null)
            : null;
        return {
            valid: true,
            resolvedPrimPath: normalizeHydraPath(rawData.resolvedPrimPath || ''),
            primType,
            axis: normalizeAxis(rawData.axis),
            size: normalizeFiniteNumber(rawData.size),
            radius: normalizeFiniteNumber(rawData.radius),
            height: normalizeFiniteNumber(rawData.height),
            extentSize: normalizeExtentSize(rawData.extentSize),
            worldTransform,
            worldTransformElements: (rawData.worldTransform
                && (Array.isArray(rawData.worldTransform)
                    || ArrayBuffer.isView(rawData.worldTransform)
                    || typeof rawData.worldTransform.length === 'number'))
                ? rawData.worldTransform
                : undefined,
            meshPayload: meshPayload || undefined,
        };
    }
    prefetchProtoDataBlobsFromDriver(driver, options = {}) {
        const forceRefresh = options?.force === true;
        const resolvedDriver = driver || this.config?.driver?.();
        if (!resolvedDriver)
            return { count: 0, source: "none" };
        if (this._protoDataBlobBatchPrimed === true && !forceRefresh) {
            const cachedCount = Number(this._protoDataBlobBatchCache?.size || 0);
            if (cachedCount > 0) {
                return { count: cachedCount, source: "cache" };
            }
        }
        this._protoDataBlobBatchPrimed = true;
        this._protoDataBlobBatchCache?.clear?.();
        this._protoDataBlobMissCache?.clear?.();
        if (typeof resolvedDriver.GetAllProtoDataBlobs !== 'function') {
            return { count: 0, source: "single-only" };
        }
        let payload = null;
        try {
            payload = resolvedDriver.GetAllProtoDataBlobs();
        }
        catch {
            return { count: 0, source: "error" };
        }
        if (!payload || typeof payload !== 'object') {
            return { count: 0, source: "empty" };
        }
        let loaded = 0;
        for (const [protoPath, rawBlob] of Object.entries(payload)) {
            if (!protoPath || !protoPath.startsWith('/'))
                continue;
            const normalizedBlob = this.normalizeProtoDataBlob(rawBlob);
            if (!normalizedBlob)
                continue;
            this._protoDataBlobBatchCache.set(protoPath, normalizedBlob);
            loaded += 1;
        }
        return { count: loaded, source: forceRefresh ? "batch-refresh" : "batch" };
    }
    prefetchProtoMeshOverridesFromDriver(driver, options = {}) {
        const forceRefresh = options?.force === true;
        const resolvedDriver = driver || this.config?.driver?.();
        if (!resolvedDriver) {
            return {
                count: 0,
                collisionCount: 0,
                visualCount: 0,
                primOverrideCount: 0,
                source: "none",
            };
        }
        if (this._collisionProtoOverrideBatchPrimed === true
            && this._visualProtoOverrideBatchPrimed === true
            && !forceRefresh) {
            const cachedCollisionCount = Number(this._collisionProtoOverrideCache?.size || 0);
            const cachedVisualCount = Number(this._visualProtoOverrideCache?.size || 0);
            if (cachedCollisionCount > 0 || cachedVisualCount > 0) {
                return {
                    count: cachedCollisionCount + cachedVisualCount,
                    collisionCount: cachedCollisionCount,
                    visualCount: cachedVisualCount,
                    primOverrideCount: 0,
                    source: "cache",
                };
            }
        }
        this._collisionProtoOverrideBatchPrimed = true;
        this._visualProtoOverrideBatchPrimed = true;
        this._collisionProtoOverrideCache?.clear?.();
        this._collisionProtoOverrideMissCache?.clear?.();
        this._visualProtoOverrideCache?.clear?.();
        this._visualProtoOverrideMissCache?.clear?.();
        if (forceRefresh) {
            this._primOverrideDataCache?.clear?.();
            this._primOverrideDataMissCache?.clear?.();
            this._resolvedProtoPrimPathCache?.clear?.();
            this._resolvedVisualPrimPathCache?.clear?.();
        }
        if (typeof resolvedDriver.GetProtoMeshOverrides !== 'function') {
            return {
                count: 0,
                collisionCount: 0,
                visualCount: 0,
                primOverrideCount: 0,
                source: "single-only",
            };
        }
        let payload = null;
        try {
            payload = resolvedDriver.GetProtoMeshOverrides();
        }
        catch {
            return {
                count: 0,
                collisionCount: 0,
                visualCount: 0,
                primOverrideCount: 0,
                source: "error",
            };
        }
        if (!payload || typeof payload !== 'object') {
            return {
                count: 0,
                collisionCount: 0,
                visualCount: 0,
                primOverrideCount: 0,
                source: "empty",
            };
        }
        const collisionPayload = (payload.collision && typeof payload.collision === 'object')
            ? payload.collision
            : {};
        const visualPayload = (payload.visual && typeof payload.visual === 'object')
            ? payload.visual
            : {};
        const primOverridePaths = new Set();
        let collisionCount = 0;
        let visualCount = 0;
        const ingestOverride = (rawMeshId, rawOverride, sectionName) => {
            if (!rawMeshId || !String(rawMeshId).includes('.proto_'))
                return;
            const normalizedOverride = sectionName === 'collisions'
                ? this.normalizeCollisionProtoOverride(rawOverride)
                : this.normalizeVisualProtoOverride(rawOverride);
            if (!normalizedOverride)
                return;
            const normalizedMeshId = normalizeHydraPath(normalizedOverride.meshId || rawMeshId);
            if (!normalizedMeshId || !normalizedMeshId.includes('.proto_'))
                return;
            normalizedOverride.meshId = normalizedMeshId;
            if (sectionName === 'collisions') {
                this._collisionProtoOverrideCache.set(normalizedMeshId, normalizedOverride);
                this._collisionProtoOverrideMissCache?.delete?.(normalizedMeshId);
                collisionCount += 1;
            }
            else if (sectionName === 'visuals') {
                this._visualProtoOverrideCache.set(normalizedMeshId, normalizedOverride);
                this._visualProtoOverrideMissCache?.delete?.(normalizedMeshId);
                visualCount += 1;
            }
            else {
                return;
            }
            this.cacheResolvedWorldTransformFromOverride(normalizedOverride);
            const resolvedPrimPath = normalizeHydraPath(normalizedOverride.resolvedPrimPath || '');
            if (resolvedPrimPath) {
                if (sectionName === 'collisions') {
                    this._resolvedProtoPrimPathCache.set(normalizedMeshId, resolvedPrimPath);
                }
                else {
                    this._resolvedVisualPrimPathCache.set(normalizedMeshId, resolvedPrimPath);
                }
            }
            const normalizedPrimOverride = this.normalizePrimOverrideData(rawOverride);
            if (!normalizedPrimOverride)
                return;
            const normalizedPrimPath = normalizeHydraPath(normalizedPrimOverride.resolvedPrimPath || '');
            if (!normalizedPrimPath)
                return;
            this._primOverrideDataCache.set(normalizedPrimPath, normalizedPrimOverride);
            this._primOverrideDataMissCache?.delete?.(normalizedPrimPath);
            primOverridePaths.add(normalizedPrimPath);
        };
        for (const [meshId, rawOverride] of Object.entries(collisionPayload)) {
            ingestOverride(meshId, rawOverride, 'collisions');
        }
        for (const [meshId, rawOverride] of Object.entries(visualPayload)) {
            ingestOverride(meshId, rawOverride, 'visuals');
        }
        return {
            count: collisionCount + visualCount,
            collisionCount,
            visualCount,
            primOverrideCount: primOverridePaths.size,
            source: forceRefresh ? "batch-refresh" : "batch",
        };
    }
    prefetchFinalStageOverrideBatchFromDriver(driver, options = {}) {
        const forceRefresh = options?.force === true;
        const resolvedDriver = driver || this.config?.driver?.();
        if (!resolvedDriver) {
            return {
                count: 0,
                collisionCount: 0,
                visualCount: 0,
                protoMeshCount: Number(this._finalStageOverrideBatchProtoMeshCount || 0),
                source: "none",
                entries: this._finalStageOverrideBatchCache,
            };
        }
        if (this._finalStageOverrideBatchPrimed === true && !forceRefresh) {
            const cachedCount = Number(this._finalStageOverrideBatchCache?.size || 0);
            if (cachedCount > 0) {
                return {
                    count: cachedCount,
                    collisionCount: Number(this._collisionProtoOverrideCache?.size || 0),
                    visualCount: Number(this._visualProtoOverrideCache?.size || 0),
                    protoMeshCount: Number(this._finalStageOverrideBatchProtoMeshCount || 0),
                    source: "cache",
                    entries: this._finalStageOverrideBatchCache,
                };
            }
        }
        if (forceRefresh) {
            this._collisionProtoOverrideCache?.clear?.();
            this._collisionProtoOverrideMissCache?.clear?.();
            this._visualProtoOverrideCache?.clear?.();
            this._visualProtoOverrideMissCache?.clear?.();
            this._primOverrideDataCache?.clear?.();
            this._primOverrideDataMissCache?.clear?.();
            this._resolvedProtoPrimPathCache?.clear?.();
            this._resolvedVisualPrimPathCache?.clear?.();
            this._finalStageOverrideBatchProtoMeshCount = 0;
        }
        this._finalStageOverrideBatchPrimed = true;
        this._finalStageOverrideBatchCache?.clear?.();
        if (typeof resolvedDriver.GetFinalStageOverrideBatch !== 'function') {
            return {
                count: 0,
                collisionCount: 0,
                visualCount: 0,
                protoMeshCount: 0,
                source: "single-only",
                entries: this._finalStageOverrideBatchCache,
            };
        }
        let payload = null;
        try {
            payload = resolvedDriver.GetFinalStageOverrideBatch();
        }
        catch {
            return {
                count: 0,
                collisionCount: 0,
                visualCount: 0,
                protoMeshCount: 0,
                source: "error",
                entries: this._finalStageOverrideBatchCache,
            };
        }
        if (!payload || typeof payload !== 'object') {
            this._finalStageOverrideBatchProtoMeshCount = 0;
            return {
                count: 0,
                collisionCount: 0,
                visualCount: 0,
                protoMeshCount: 0,
                source: "empty",
                entries: this._finalStageOverrideBatchCache,
            };
        }
        const payloadProtoMeshCount = Number(payload.protoMeshCount);
        this._finalStageOverrideBatchProtoMeshCount = Number.isFinite(payloadProtoMeshCount)
            ? Math.max(0, Math.floor(payloadProtoMeshCount))
            : 0;
        const rawEntries = (payload.entries && typeof payload.entries === 'object')
            ? payload.entries
            : {};
        let collisionCount = 0;
        let visualCount = 0;
        const primOverridePaths = new Set();
        for (const [meshId, rawOverride] of Object.entries(rawEntries)) {
            const normalizedMeshId = normalizeHydraPath(meshId);
            if (!normalizedMeshId || !normalizedMeshId.includes('.proto_'))
                continue;
            const sectionName = String(rawOverride?.sectionName || '').toLowerCase();
            const normalizedOverride = sectionName === 'visuals'
                ? this.normalizeVisualProtoOverride(rawOverride)
                : this.normalizeCollisionProtoOverride(rawOverride);
            if (!normalizedOverride)
                continue;
            normalizedOverride.meshId = normalizeHydraPath(normalizedOverride.meshId || normalizedMeshId);
            normalizedOverride.sectionName = sectionName || (normalizedOverride?.meshId?.includes('/visuals.proto_') ? 'visuals' : 'collisions');
            normalizedOverride.applyGeometry = rawOverride?.applyGeometry === true || normalizedOverride.sectionName === 'collisions';
            const dirtyMaskValue = Number(rawOverride?.dirtyMask);
            normalizedOverride.dirtyMask = Number.isFinite(dirtyMaskValue) ? Math.max(0, Math.floor(dirtyMaskValue)) : 0;
            if (!normalizedOverride.worldTransformElements) {
                normalizedOverride.worldTransformElements = rawOverride?.worldTransform;
            }
            const cacheMeshId = normalizeHydraPath(normalizedOverride.meshId || normalizedMeshId) || normalizedMeshId;
            this._finalStageOverrideBatchCache.set(cacheMeshId, normalizedOverride);
            this.cacheResolvedWorldTransformFromOverride(normalizedOverride);
            const resolvedPrimPath = normalizeHydraPath(normalizedOverride.resolvedPrimPath || '');
            if (resolvedPrimPath) {
                const normalizedPrimOverride = this.normalizePrimOverrideData(rawOverride);
                if (normalizedPrimOverride) {
                    this._primOverrideDataCache.set(resolvedPrimPath, normalizedPrimOverride);
                    this._primOverrideDataMissCache?.delete?.(resolvedPrimPath);
                    primOverridePaths.add(resolvedPrimPath);
                }
            }
            if (normalizedOverride.sectionName === 'visuals') {
                this._visualProtoOverrideCache.set(cacheMeshId, normalizedOverride);
                this._visualProtoOverrideMissCache?.delete?.(cacheMeshId);
                if (resolvedPrimPath)
                    this._resolvedVisualPrimPathCache.set(cacheMeshId, resolvedPrimPath);
                visualCount += 1;
            }
            else {
                this._collisionProtoOverrideCache.set(cacheMeshId, normalizedOverride);
                this._collisionProtoOverrideMissCache?.delete?.(cacheMeshId);
                if (resolvedPrimPath)
                    this._resolvedProtoPrimPathCache.set(cacheMeshId, resolvedPrimPath);
                collisionCount += 1;
            }
        }
        this._collisionProtoOverrideBatchPrimed = true;
        this._visualProtoOverrideBatchPrimed = true;
        return {
            count: Number(this._finalStageOverrideBatchCache?.size || (collisionCount + visualCount)),
            collisionCount,
            visualCount,
            protoMeshCount: Number(this._finalStageOverrideBatchProtoMeshCount || 0),
            primOverrideCount: primOverridePaths.size,
            source: forceRefresh ? "batch-refresh" : "batch",
            entries: this._finalStageOverrideBatchCache,
        };
    }
    ingestFinalStageOverrideSnapshotDescriptors(rawDescriptors, options = {}) {
        const forceRefresh = options?.force === true;
        const descriptors = Array.isArray(rawDescriptors)
            ? rawDescriptors
            : (rawDescriptors && typeof rawDescriptors.length === 'number' ? Array.from(rawDescriptors) : []);
        if (forceRefresh) {
            this._collisionProtoOverrideCache?.clear?.();
            this._collisionProtoOverrideMissCache?.clear?.();
            this._visualProtoOverrideCache?.clear?.();
            this._visualProtoOverrideMissCache?.clear?.();
            this._primOverrideDataCache?.clear?.();
            this._primOverrideDataMissCache?.clear?.();
            this._resolvedProtoPrimPathCache?.clear?.();
            this._resolvedVisualPrimPathCache?.clear?.();
            this._finalStageOverrideBatchProtoMeshCount = 0;
        }
        this._finalStageOverrideBatchPrimed = true;
        this._finalStageOverrideBatchCache?.clear?.();
        if (descriptors.length <= 0) {
            this._collisionProtoOverrideBatchPrimed = true;
            this._visualProtoOverrideBatchPrimed = true;
            this._finalStageOverrideBatchProtoMeshCount = 0;
            return {
                count: 0,
                collisionCount: 0,
                visualCount: 0,
                protoMeshCount: 0,
                primOverrideCount: 0,
                source: 'empty',
                entries: this._finalStageOverrideBatchCache,
            };
        }
        let collisionCount = 0;
        let visualCount = 0;
        let protoMeshCount = 0;
        const primOverridePaths = new Set();
        for (const rawDescriptor of descriptors) {
            const normalizedMeshId = normalizeHydraPath(rawDescriptor?.meshId || '');
            if (!normalizedMeshId || !normalizedMeshId.includes('.proto_'))
                continue;
            protoMeshCount += 1;
            const sectionName = String(rawDescriptor?.sectionName || '').toLowerCase();
            const normalizedOverride = sectionName === 'visuals'
                ? this.normalizeVisualProtoOverride(rawDescriptor)
                : this.normalizeCollisionProtoOverride(rawDescriptor);
            if (!normalizedOverride)
                continue;
            normalizedOverride.meshId = normalizeHydraPath(normalizedOverride.meshId || normalizedMeshId) || normalizedMeshId;
            normalizedOverride.sectionName = sectionName || (normalizedOverride?.meshId?.includes('/visuals.proto_') ? 'visuals' : 'collisions');
            normalizedOverride.applyGeometry = rawDescriptor?.applyGeometry === true || normalizedOverride.sectionName === 'collisions';
            const dirtyMaskValue = Number(rawDescriptor?.dirtyMask);
            normalizedOverride.dirtyMask = Number.isFinite(dirtyMaskValue) ? Math.max(0, Math.floor(dirtyMaskValue)) : 0;
            if (!normalizedOverride.worldTransformElements) {
                normalizedOverride.worldTransformElements = rawDescriptor?.worldTransform;
            }
            const cacheMeshId = normalizeHydraPath(normalizedOverride.meshId || normalizedMeshId) || normalizedMeshId;
            this._finalStageOverrideBatchCache.set(cacheMeshId, normalizedOverride);
            this.cacheResolvedWorldTransformFromOverride(normalizedOverride);
            const resolvedPrimPath = normalizeHydraPath(normalizedOverride.resolvedPrimPath || '');
            if (resolvedPrimPath) {
                const normalizedPrimOverride = this.normalizePrimOverrideData(rawDescriptor);
                if (normalizedPrimOverride) {
                    this._primOverrideDataCache.set(resolvedPrimPath, normalizedPrimOverride);
                    primOverridePaths.add(resolvedPrimPath);
                }
            }
            if (normalizedOverride.sectionName === 'visuals') {
                this._visualProtoOverrideCache.set(cacheMeshId, normalizedOverride);
                if (resolvedPrimPath)
                    this._resolvedVisualPrimPathCache.set(cacheMeshId, resolvedPrimPath);
                visualCount += 1;
            }
            else {
                this._collisionProtoOverrideCache.set(cacheMeshId, normalizedOverride);
                if (resolvedPrimPath)
                    this._resolvedProtoPrimPathCache.set(cacheMeshId, resolvedPrimPath);
                collisionCount += 1;
            }
        }
        this._collisionProtoOverrideBatchPrimed = true;
        this._visualProtoOverrideBatchPrimed = true;
        this._finalStageOverrideBatchProtoMeshCount = protoMeshCount;
        return {
            count: Number(this._finalStageOverrideBatchCache?.size || (collisionCount + visualCount)),
            collisionCount,
            visualCount,
            protoMeshCount,
            primOverrideCount: primOverridePaths.size,
            source: forceRefresh ? 'snapshot-refresh' : 'snapshot',
            entries: this._finalStageOverrideBatchCache,
        };
    }
    hasResolvedRobotSceneSnapshot(stageSourcePath = null) {
        const normalizedStagePath = String(stageSourcePath
            || this.getStageSourcePath?.()
            || '').trim().split('?')[0];
        if (!normalizedStagePath || typeof this.getCachedRobotSceneSnapshot !== 'function')
            return false;
        try {
            return !!this.getCachedRobotSceneSnapshot(normalizedStagePath);
        }
        catch {
            return false;
        }
    }
    shouldDeferProtoStageSyncUntilSceneSnapshot(stageSourcePath = null) {
        return this.strictOneShotSceneLoad === true
            && !this.hasResolvedRobotSceneSnapshot(stageSourcePath);
    }
    _resolveWasmHeaps() {
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
                    heapF32: heapF32 || null,
                    heapU32: heapU32 || null,
                };
            }
        }
        const fallback = candidates.find((candidate) => candidate && typeof candidate === 'object') || null;
        return {
            heapF32: fallback?.HEAPF32 || null,
            heapU32: fallback?.HEAPU32 || null,
        };
    }
    _readHeapFloat32View(ptrValue, countValue) {
        const heap = this._resolveWasmHeaps().heapF32;
        if (!heap || !heap.buffer)
            return null;
        const ptr = Number(ptrValue);
        const count = Number(countValue);
        if (!Number.isFinite(ptr) || !Number.isFinite(count))
            return null;
        if (ptr <= 0 || count <= 0)
            return null;
        const ptrInt = Math.floor(ptr);
        const countInt = Math.floor(count);
        if ((ptrInt % 4) !== 0)
            return null;
        const start = ptrInt >>> 2;
        const end = start + countInt;
        if (start < 0 || end > heap.length)
            return null;
        return heap.subarray(start, end);
    }
    _readHeapUint32View(ptrValue, countValue) {
        const heap = this._resolveWasmHeaps().heapU32;
        if (!heap || !heap.buffer)
            return null;
        const ptr = Number(ptrValue);
        const count = Number(countValue);
        if (!Number.isFinite(ptr) || !Number.isFinite(count))
            return null;
        if (ptr <= 0 || count <= 0)
            return null;
        const ptrInt = Math.floor(ptr);
        const countInt = Math.floor(count);
        if ((ptrInt % 4) !== 0)
            return null;
        const start = ptrInt >>> 2;
        const end = start + countInt;
        if (start < 0 || end > heap.length)
            return null;
        return heap.subarray(start, end);
    }
    pullRprimDeltaBatchFromDriver(driver = null) {
        const resolvedDriver = driver || this.config?.driver?.();
        const summary = {
            ok: false,
            source: "none",
            count: 0,
            applied: 0,
            meshIds: new Set(),
        };
        if (this.strictOneShotSceneLoad === true
            && this.allowPostReadyDriverDelta !== true
            && this.hasResolvedRobotSceneSnapshot?.()) {
            summary.ok = true;
            summary.source = "cache-only-after-snapshot";
            return summary;
        }
        if (!resolvedDriver || typeof resolvedDriver.GetRprimDeltaBatch !== 'function') {
            return summary;
        }
        let payload = null;
        try {
            if (this._driverFallbackCallCounts) {
                this._driverFallbackCallCounts.rprimDeltaBatch = Number(this._driverFallbackCallCounts.rprimDeltaBatch || 0) + 1;
            }
            payload = resolvedDriver.GetRprimDeltaBatch();
        }
        catch {
            summary.source = "error";
            return summary;
        }
        summary.ok = true;
        if (!payload || typeof payload !== 'object') {
            summary.source = "empty";
            return summary;
        }
        const rawEntries = (payload.entries && typeof payload.entries === 'object')
            ? payload.entries
            : {};
        summary.source = "batch";
        summary.count = Number(payload.count || Object.keys(rawEntries).length || 0);
        const toObjectArray = (value) => {
            if (Array.isArray(value))
                return value;
            if (!value || typeof value !== 'object')
                return [];
            if (typeof value.length === 'number') {
                const length = Number(value.length);
                const safeLength = Number.isFinite(length) && length > 0 ? Math.floor(length) : 0;
                const out = [];
                for (let index = 0; index < safeLength; index++) {
                    out.push(value[index]);
                }
                return out;
            }
            const fallback = toArrayLike(value);
            if (!fallback || typeof fallback.length !== 'number')
                return [];
            const out = [];
            const length = Number(fallback.length);
            const safeLength = Number.isFinite(length) && length > 0 ? Math.floor(length) : 0;
            for (let index = 0; index < safeLength; index++) {
                out.push(fallback[index]);
            }
            return out;
        };
        for (const [rawMeshId, rawDelta] of Object.entries(rawEntries)) {
            const meshId = normalizeHydraPath(rawMeshId);
            if (!meshId)
                continue;
            const hydraMesh = this.meshes[meshId];
            if (!hydraMesh || typeof hydraMesh.applyUpdates !== 'function')
                continue;
            if (!rawDelta || typeof rawDelta !== 'object')
                continue;
            const skipHydraPayloadReadForProto = (this.preferProtoBlobOverHydraPayload === true
                && meshId.includes('.proto_'));
            const updates = {};
            let hasUpdates = false;
            const materialId = normalizeHydraPath(rawDelta.materialId);
            if (materialId) {
                updates.materialId = materialId;
                hasUpdates = true;
            }
            const rawSections = toObjectArray(rawDelta.geomSubsetSections);
            if (rawSections.length > 0) {
                const normalizedSections = [];
                for (const rawSection of rawSections) {
                    const start = Number(rawSection?.start);
                    const length = Number(rawSection?.length);
                    if (!Number.isFinite(start) || !Number.isFinite(length) || length <= 0)
                        continue;
                    normalizedSections.push({
                        start: Math.max(0, Math.floor(start)),
                        length: Math.max(0, Math.floor(length)),
                        materialId: normalizeHydraPath(rawSection?.materialId || ''),
                    });
                }
                if (normalizedSections.length > 0) {
                    updates.geomSubsetSections = normalizedSections;
                    hasUpdates = true;
                }
            }
            if (!skipHydraPayloadReadForProto) {
                const points = this._readHeapFloat32View(rawDelta.pointsPtr, rawDelta.pointsCount);
                if (points && points.length > 0) {
                    updates.points = points;
                    hasUpdates = true;
                }
                const indices = this._readHeapUint32View(rawDelta.indicesPtr, rawDelta.indicesCount);
                if (indices && indices.length > 0) {
                    updates.indices = indices;
                    hasUpdates = true;
                }
                const normals = this._readHeapFloat32View(rawDelta.normalsPtr, rawDelta.normalsCount);
                if (normals && normals.length > 0) {
                    updates.normals = normals;
                    hasUpdates = true;
                }
                const transform = this._readHeapFloat32View(rawDelta.transformPtr, rawDelta.transformCount);
                if (transform && transform.length >= 16) {
                    updates.transform = transform.subarray(0, 16);
                    hasUpdates = true;
                }
                const rawPrimvars = toObjectArray(rawDelta.primvars);
                if (rawPrimvars.length > 0) {
                    const primvars = [];
                    for (const rawPrimvar of rawPrimvars) {
                        const name = String(rawPrimvar?.name || '').trim();
                        if (!name)
                            continue;
                        const dimension = Number(rawPrimvar?.dimension);
                        if (!Number.isFinite(dimension) || dimension <= 0)
                            continue;
                        const data = this._readHeapFloat32View(rawPrimvar?.dataPtr, rawPrimvar?.dataCount);
                        if (!data || data.length <= 0)
                            continue;
                        const interpolation = String(rawPrimvar?.interpolation || 'vertex').trim().toLowerCase() || 'vertex';
                        primvars.push({
                            name,
                            data,
                            dimension: Math.max(1, Math.floor(dimension)),
                            interpolation,
                        });
                    }
                    if (primvars.length > 0) {
                        updates.primvars = primvars;
                        hasUpdates = true;
                    }
                }
            }
            if (!hasUpdates)
                continue;
            hydraMesh.applyUpdates(updates);
            summary.meshIds.add(meshId);
            summary.applied += 1;
        }
        return summary;
    }
    prefetchCollisionProtoOverridesFromDriver(driver, options = {}) {
        const forceRefresh = options?.force === true;
        const resolvedDriver = driver || this.config?.driver?.();
        if (!resolvedDriver)
            return { count: 0, source: "none" };
        if (this._collisionProtoOverrideBatchPrimed === true && !forceRefresh) {
            const cachedCount = Number(this._collisionProtoOverrideCache?.size || 0);
            if (cachedCount > 0) {
                return { count: cachedCount, source: "cache" };
            }
        }
        this._collisionProtoOverrideBatchPrimed = true;
        this._collisionProtoOverrideCache?.clear?.();
        this._collisionProtoOverrideMissCache?.clear?.();
        if (typeof resolvedDriver.GetCollisionProtoOverrides !== 'function') {
            return { count: 0, source: "single-only" };
        }
        let payload = null;
        try {
            payload = resolvedDriver.GetCollisionProtoOverrides();
        }
        catch {
            return { count: 0, source: "error" };
        }
        if (!payload || typeof payload !== 'object') {
            return { count: 0, source: "empty" };
        }
        let loaded = 0;
        for (const [meshId, rawOverride] of Object.entries(payload)) {
            if (!meshId || !meshId.includes('.proto_'))
                continue;
            const normalizedOverride = this.normalizeCollisionProtoOverride(rawOverride);
            if (!normalizedOverride)
                continue;
            this._collisionProtoOverrideCache.set(meshId, normalizedOverride);
            this._collisionProtoOverrideMissCache?.delete?.(meshId);
            this.cacheResolvedWorldTransformFromOverride(normalizedOverride);
            loaded += 1;
        }
        return {
            count: loaded,
            source: forceRefresh ? "batch-refresh" : "batch",
        };
    }
    prefetchVisualProtoOverridesFromDriver(driver, options = {}) {
        const forceRefresh = options?.force === true;
        const resolvedDriver = driver || this.config?.driver?.();
        if (!resolvedDriver)
            return { count: 0, source: "none" };
        if (this._visualProtoOverrideBatchPrimed === true && !forceRefresh) {
            const cachedCount = Number(this._visualProtoOverrideCache?.size || 0);
            if (cachedCount > 0) {
                return { count: cachedCount, source: "cache" };
            }
        }
        this._visualProtoOverrideBatchPrimed = true;
        this._visualProtoOverrideCache?.clear?.();
        this._visualProtoOverrideMissCache?.clear?.();
        if (typeof resolvedDriver.GetVisualProtoOverrides !== 'function') {
            return { count: 0, source: "single-only" };
        }
        let payload = null;
        try {
            payload = resolvedDriver.GetVisualProtoOverrides();
        }
        catch {
            return { count: 0, source: "error" };
        }
        if (!payload || typeof payload !== 'object') {
            return { count: 0, source: "empty" };
        }
        let loaded = 0;
        for (const [meshId, rawOverride] of Object.entries(payload)) {
            if (!meshId || !meshId.includes('.proto_'))
                continue;
            const normalizedOverride = this.normalizeVisualProtoOverride(rawOverride);
            if (!normalizedOverride)
                continue;
            this._visualProtoOverrideCache.set(meshId, normalizedOverride);
            this._visualProtoOverrideMissCache?.delete?.(meshId);
            this.cacheResolvedWorldTransformFromOverride(normalizedOverride);
            loaded += 1;
        }
        return {
            count: loaded,
            source: forceRefresh ? "batch-refresh" : "batch",
        };
    }
    prefetchPrimOverrideDataFromDriver(driver, primPaths = [], options = {}) {
        const forceRefresh = options?.force === true;
        const resolvedDriver = driver || this.config?.driver?.();
        if (!resolvedDriver)
            return { count: 0, source: "none" };
        const normalizedPaths = [];
        const seenPaths = new Set();
        const ingestPath = (pathValue) => {
            const normalizedPath = normalizeHydraPath(pathValue);
            if (!normalizedPath || !normalizedPath.startsWith('/'))
                return;
            if (seenPaths.has(normalizedPath))
                return;
            seenPaths.add(normalizedPath);
            normalizedPaths.push(normalizedPath);
        };
        if (Array.isArray(primPaths) || ArrayBuffer.isView(primPaths) || typeof primPaths?.length === 'number') {
            const length = Number(primPaths?.length);
            const safeLength = Number.isFinite(length) && length >= 0 ? Math.floor(length) : 0;
            for (let index = 0; index < safeLength; index++) {
                ingestPath(primPaths[index]);
            }
        }
        else if (primPaths && typeof primPaths[Symbol.iterator] === 'function') {
            for (const pathValue of primPaths) {
                ingestPath(pathValue);
            }
        }
        if (normalizedPaths.length === 0)
            return { count: 0, source: "empty" };
        if (forceRefresh) {
            for (const primPath of normalizedPaths) {
                this._primOverrideDataCache.delete(primPath);
                this._primOverrideDataMissCache?.delete?.(primPath);
            }
        }
        const cachedCount = normalizedPaths.filter((primPath) => this._primOverrideDataCache.has(primPath)).length;
        if (this.strictOneShotSceneLoad === true
            && this.allowPostReadyDriverDelta !== true
            && this.hasResolvedRobotSceneSnapshot?.()) {
            return { count: cachedCount, source: "cache-only-after-snapshot" };
        }
        const requestPaths = normalizedPaths.filter((primPath) => forceRefresh
            || (!this._primOverrideDataCache.has(primPath)
                && !this._primOverrideDataMissCache?.has?.(primPath)));
        if (requestPaths.length === 0) {
            return { count: cachedCount, source: "cache" };
        }
        if (typeof resolvedDriver.GetPrimOverrideDataMap === 'function') {
            let payload = null;
            try {
                payload = resolvedDriver.GetPrimOverrideDataMap(requestPaths);
            }
            catch {
                payload = null;
            }
            if (payload && typeof payload === 'object') {
                let loaded = 0;
                const loadedPaths = new Set();
                for (const [primPath, rawData] of Object.entries(payload)) {
                    const normalizedPath = normalizeHydraPath(primPath);
                    if (!normalizedPath || !normalizedPath.startsWith('/'))
                        continue;
                    const normalizedData = this.normalizePrimOverrideData(rawData);
                    if (!normalizedData)
                        continue;
                    this._primOverrideDataCache.set(normalizedPath, normalizedData);
                    this._primOverrideDataMissCache?.delete?.(normalizedPath);
                    loadedPaths.add(normalizedPath);
                    loaded += 1;
                }
                for (const primPath of requestPaths) {
                    if (!loadedPaths.has(primPath) && !forceRefresh) {
                        this._primOverrideDataMissCache?.add?.(primPath);
                    }
                }
                return {
                    count: cachedCount + loaded,
                    source: forceRefresh ? "batch-refresh" : "batch",
                };
            }
        }
        let loaded = cachedCount;
        for (const primPath of requestPaths) {
            const normalizedData = this.getPrimOverrideData(primPath);
            if (!normalizedData)
                continue;
            loaded += 1;
        }
        return { count: loaded, source: "single" };
    }
    prefetchPrimPathSetFromDriver(driver, options = {}) {
        const forceRefresh = options?.force === true;
        if (!driver || typeof driver.GetPrimPathSet !== 'function') {
            return { count: 0, source: "none" };
        }
        if (this._knownPrimPathSetPrimed === true && this._knownPrimPathSet instanceof Set && !forceRefresh) {
            return { count: Number(this._knownPrimPathSet.size || 0), source: "cache" };
        }
        let payload = null;
        try {
            payload = driver.GetPrimPathSet();
        }
        catch {
            return { count: 0, source: "error" };
        }
        if (!payload) {
            this._knownPrimPathSet = new Set();
            this._knownPrimPathSetPrimed = true;
            return { count: 0, source: "empty" };
        }
        const nextPathSet = new Set();
        const ingestPath = (pathValue) => {
            const normalizedPath = normalizeHydraPath(pathValue);
            if (!normalizedPath || !normalizedPath.startsWith('/'))
                return;
            nextPathSet.add(normalizedPath);
        };
        if (Array.isArray(payload) || ArrayBuffer.isView(payload) || typeof payload.length === 'number') {
            const length = Number(payload.length);
            const safeLength = Number.isFinite(length) && length >= 0 ? Math.floor(length) : 0;
            for (let index = 0; index < safeLength; index++) {
                ingestPath(payload[index]);
            }
        }
        else if (typeof payload[Symbol.iterator] === 'function') {
            for (const pathValue of payload) {
                ingestPath(pathValue);
            }
        }
        this._knownPrimPathSet = nextPathSet;
        this._knownPrimPathSetPrimed = true;
        // Keep the path existence cache bounded to currently known stage paths.
        for (const cachedPath of Array.from(this._primPathExistenceCache.keys())) {
            if (!nextPathSet.has(cachedPath)) {
                this._primPathExistenceCache.delete(cachedPath);
            }
        }
        for (const knownPath of nextPathSet) {
            if (!this._primPathExistenceCache.has(knownPath))
                continue;
            if (this._primPathExistenceCache.get(knownPath) === false) {
                this._primPathExistenceCache.set(knownPath, true);
            }
        }
        return {
            count: nextPathSet.size,
            source: forceRefresh ? "batch-refresh" : "batch",
        };
    }
    normalizeRobotSceneSnapshotBlob(rawPayload, options = {}) {
        if (!rawPayload || typeof rawPayload !== 'object')
            return null;
        const format = String(rawPayload.format || '').trim();
        const isRobotSceneSnapshotBlob = format === 'robot-scene-snapshot-blob-v1';
        const isFullLoadPayload = format === 'usd-full-load-payload-v1'
            || format === 'full-load-payload';
        if (!isRobotSceneSnapshotBlob && !isFullLoadPayload)
            return this.normalizeRobotSceneSnapshot(rawPayload, options);
        const rawSnapshot = rawPayload.snapshot && typeof rawPayload.snapshot === 'object'
            ? rawPayload.snapshot
            : null;
        if (!rawSnapshot)
            return null;
        const normalized = this.normalizeRobotSceneSnapshot(rawSnapshot, {
            ...options,
            transportFormat: format,
            fullLoadPayload: isFullLoadPayload,
        });
        if (normalized) {
            normalized.transportFormat = format;
            normalized.fullLoadPayload = isFullLoadPayload;
        }
        if (normalized && rawPayload.nativeProfile && typeof rawPayload.nativeProfile === 'object') {
            normalized.nativeProfile = rawPayload.nativeProfile;
        }
        if (normalized && rawPayload.driverInitProfile && typeof rawPayload.driverInitProfile === 'object') {
            normalized.driverInitProfile = rawPayload.driverInitProfile;
        }
        return normalized;
    }
    normalizeRobotSceneSnapshot(rawSnapshot, options = {}) {
        const rawSnapshotFormat = String(rawSnapshot?.format || '').trim();
        if (rawSnapshotFormat === 'robot-scene-snapshot-blob-v1'
            || rawSnapshotFormat === 'usd-full-load-payload-v1'
            || rawSnapshotFormat === 'full-load-payload') {
            return this.normalizeRobotSceneSnapshotBlob(rawSnapshot, options);
        }
        if (!rawSnapshot || typeof rawSnapshot !== 'object')
            return null;
        const toPlainArray = (value) => (Array.isArray(value)
            ? value.slice()
            : (value && typeof value.length === 'number' ? Array.from(value) : []));
        const toPlainObject = (value) => (value && typeof value === 'object'
            ? Object.fromEntries(Object.entries(value))
            : {});
        const copyFloat32 = (value) => {
            if (!value || typeof value.length !== 'number')
                return new Float32Array(0);
            if (ArrayBuffer.isView(value))
                return Float32Array.from(value);
            return Float32Array.from(Array.from(value));
        };
        const useFloat32 = (value) => (value instanceof Float32Array
            ? value
            : copyFloat32(value));
        const copyUint32 = (value) => {
            if (!value || typeof value.length !== 'number')
                return new Uint32Array(0);
            if (ArrayBuffer.isView(value))
                return Uint32Array.from(value);
            return Uint32Array.from(Array.from(value));
        };
        const useUint32 = (value) => (value instanceof Uint32Array
            ? value
            : copyUint32(value));
        const copyInt32 = (value) => {
            if (!value || typeof value.length !== 'number')
                return new Int32Array(0);
            if (ArrayBuffer.isView(value))
                return Int32Array.from(value);
            return Int32Array.from(Array.from(value));
        };
        const useInt32 = (value) => (value instanceof Int32Array
            ? value
            : copyInt32(value));
        const readFloatPayload = (payload, directField, ptrField, count) => {
            const directValue = payload?.[directField];
            if (directValue && typeof directValue.length === 'number') {
                return copyFloat32(directValue);
            }
            const heapView = this._readHeapFloat32View(payload?.[ptrField], count);
            return heapView ? Float32Array.from(heapView) : new Float32Array(0);
        };
        const readUintPayload = (payload, directField, ptrField, count) => {
            const directValue = payload?.[directField];
            if (directValue && typeof directValue.length === 'number') {
                return copyUint32(directValue);
            }
            const heapView = this._readHeapUint32View(payload?.[ptrField], count);
            return heapView ? Uint32Array.from(heapView) : new Uint32Array(0);
        };
        const rawStage = rawSnapshot.stage && typeof rawSnapshot.stage === 'object'
            ? rawSnapshot.stage
            : {};
        const renderPayload = rawSnapshot.render && typeof rawSnapshot.render === 'object'
            ? rawSnapshot.render
            : rawSnapshot;
        const resolvedStageSourcePath = String(options?.stageSourcePath
            || rawStage.stageSourcePath
            || rawSnapshot.stageSourcePath
            || this.getStageSourcePath()
            || '').trim().split('?')[0];
        if (resolvedStageSourcePath) {
            this._runtimeBridgeCacheStageKey = resolvedStageSourcePath;
        }
        const robotMetadataRaw = rawSnapshot.robotMetadataSnapshot && typeof rawSnapshot.robotMetadataSnapshot === 'object'
            ? rawSnapshot.robotMetadataSnapshot
            : {
                stageSourcePath: resolvedStageSourcePath || null,
                generatedAtMs: Number(rawSnapshot.generatedAtMs || Date.now()),
                source: 'robot-scene-snapshot',
                linkParentPairs: rawSnapshot.robotTree?.linkParentPairs || [],
                jointCatalogEntries: rawSnapshot.robotTree?.jointCatalogEntries || [],
                linkDynamicsEntries: rawSnapshot.physics?.linkDynamicsEntries || [],
                meshCountsByLinkPath: {},
            };
        const forceRefresh = options?.force === true;
        let rawMeshDescriptors = toPlainArray(renderPayload.meshDescriptors);
        const rawBuffers = rawSnapshot.buffers && typeof rawSnapshot.buffers === 'object'
            ? rawSnapshot.buffers
            : {};
        const packedDescriptorFormat = String(renderPayload?.meshDescriptorFormat || '').trim().toLowerCase();
        const packedRangesByMeshId = rawBuffers.rangesByMeshId && typeof rawBuffers.rangesByMeshId === 'object'
            ? rawBuffers.rangesByMeshId
            : null;
        const packedGeomSubsetSectionsByMeshId = renderPayload.meshDescriptorGeomSubsetSections
            && typeof renderPayload.meshDescriptorGeomSubsetSections === 'object'
            ? renderPayload.meshDescriptorGeomSubsetSections
            : null;
        const packedNormalDiagnosticsByMeshId = renderPayload.meshDescriptorNormalDiagnostics
            && typeof renderPayload.meshDescriptorNormalDiagnostics === 'object'
            ? renderPayload.meshDescriptorNormalDiagnostics
            : (renderPayload.meshDescriptorDiagnostics
                && typeof renderPayload.meshDescriptorDiagnostics === 'object'
                ? renderPayload.meshDescriptorDiagnostics
                : (renderPayload.normalDiagnosticsByMeshId
                    && typeof renderPayload.normalDiagnosticsByMeshId === 'object'
                    ? renderPayload.normalDiagnosticsByMeshId
                    : null));
        const packedDescriptorHeaderLength = Number(renderPayload?.meshDescriptorHeaders?.length || 0);
        const packedDescriptorScalarLength = Number(renderPayload?.meshDescriptorScalars?.length || 0);
        const hasPackedDescriptorRecords = packedDescriptorFormat === 'packed-v2'
            && packedDescriptorHeaderLength > 0
            && packedDescriptorScalarLength > 0;
        const normalizeBufferRange = (rawRange, fallbackStride = 1) => {
            if (!rawRange || typeof rawRange !== 'object')
                return null;
            const offset = Number(rawRange.offset);
            const count = Number(rawRange.count);
            if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(count) || count <= 0)
                return null;
            const stride = Number(rawRange.stride);
            return {
                offset: Math.max(0, Math.floor(offset)),
                count: Math.max(0, Math.floor(count)),
                stride: Number.isFinite(stride) && stride > 0 ? Math.floor(stride) : fallbackStride,
            };
        };
        const normalizeMeshRanges = (rawRanges) => {
            if (!rawRanges || typeof rawRanges !== 'object')
                return null;
            const positions = normalizeBufferRange(rawRanges.positions, 3);
            const indices = normalizeBufferRange(rawRanges.indices, 1);
            const normals = normalizeBufferRange(rawRanges.normals, 3);
            const uvs = normalizeBufferRange(rawRanges.uvs, 2);
            const transform = normalizeBufferRange(rawRanges.transform, 16);
            if (!positions && !indices && !normals && !uvs && !transform)
                return null;
            return { positions, indices, normals, uvs, transform };
        };
        const hasPackedRangeRecords = !!packedRangesByMeshId
            && Object.values(packedRangesByMeshId).some((rawRanges) => !!normalizeMeshRanges(rawRanges));
        const hasPackedMeshBuffers = hasPackedDescriptorRecords || hasPackedRangeRecords;
        const normalizeGeomSubsetSections = (value) => {
            if (!value || typeof value.length !== 'number')
                return [];
            const out = [];
            const safeLength = Math.max(0, Math.floor(Number(value.length) || 0));
            for (let index = 0; index < safeLength; index += 1) {
                const rawSection = value[index];
                const start = Number(rawSection?.start);
                const length = Number(rawSection?.length);
                if (!Number.isFinite(start) || !Number.isFinite(length) || length <= 0)
                    continue;
                out.push({
                    start: Math.max(0, Math.floor(start)),
                    length: Math.max(0, Math.floor(length)),
                    materialId: normalizeHydraPath(rawSection?.materialId || '') || '',
                });
            }
            return out;
        };
        const normalizeGeometrySummary = (rawGeometry, fallbackBlob = null) => {
            const source = rawGeometry && typeof rawGeometry === 'object'
                ? rawGeometry
                : fallbackBlob;
            if (!source || typeof source !== 'object')
                return null;
            const materialId = normalizeHydraPath(source.materialId || '');
            const normalDiagnostics = normalizeNormalDiagnostics(source);
            return {
                numVertices: Number(source.numVertices || 0),
                numIndices: Number(source.numIndices || 0),
                numNormals: Number(source.numNormals || 0),
                numUVs: Number(source.numUVs || 0),
                uvDimension: Number(source.uvDimension || 0),
                normalsDimension: Number(source.normalsDimension || 0),
                renderReady: source.renderReady === true,
                topologyMode: normalizeTopologyMode(source.topologyMode)
                    || (Number(source.numIndices || 0) > 0 ? 'indexed' : 'nonIndexed'),
                uvSource: typeof source.uvSource === 'string'
                    ? String(source.uvSource || '').trim()
                    : '',
                materialId: materialId || null,
                geomSubsetSections: normalizeGeomSubsetSections(source.geomSubsetSections),
                ...(normalDiagnostics ? { normalDiagnostics } : {}),
            };
        };
        const normalizeFiniteNumber = (value) => {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : null;
        };
        const normalizeDescriptorAxis = (value) => {
            const normalized = String(value || '').trim().toUpperCase();
            if (normalized === 'X' || normalized === 'Y' || normalized === 'Z') {
                return normalized;
            }
            return null;
        };
        const normalizeDescriptorExtentSize = (value) => {
            if (!value || typeof value.length !== 'number' || Number(value.length) < 3) {
                return null;
            }
            const x = normalizeFiniteNumber(value[0]);
            const y = normalizeFiniteNumber(value[1]);
            const z = normalizeFiniteNumber(value[2]);
            if (x === null || y === null || z === null) {
                return null;
            }
            return [
                Math.max(0, x),
                Math.max(0, y),
                Math.max(0, z),
            ];
        };
        const normalizeDescriptorPrimitiveSummary = (rawDescriptor) => ({
            axis: normalizeDescriptorAxis(rawDescriptor?.axis),
            size: normalizeFiniteNumber(rawDescriptor?.size),
            radius: normalizeFiniteNumber(rawDescriptor?.radius),
            height: normalizeFiniteNumber(rawDescriptor?.height),
            extentSize: normalizeDescriptorExtentSize(rawDescriptor?.extentSize),
        });
        const parseLegacyRuntimeMeshDescriptor = (meshId) => {
            const normalizedMeshPath = normalizeHydraPath(meshId || '');
            if (!normalizedMeshPath || !normalizedMeshPath.startsWith('/'))
                return null;
            const sectionMatch = normalizedMeshPath.match(/^(.*)\/(visuals|collisions)(?:([/.])(.*))?$/i);
            if (!sectionMatch)
                return null;
            const sectionName = normalizeDescriptorSectionName(sectionMatch[2]);
            const suffix = String(sectionMatch[4] || '').trim().toLowerCase();
            const inferPrimType = () => {
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
            return {
                meshId: normalizedMeshPath,
                sectionName,
                primType: inferPrimType(),
            };
        };
        const getRuntimeDescriptorSeed = (meshId) => {
            const normalizedMeshId = normalizeHydraPath(meshId || '');
            if (!normalizedMeshId || this.shouldSuppressSyntheticTopLevelMesh?.(normalizedMeshId))
                return null;
            const parsedProto = parseProtoMeshIdentifier(normalizedMeshId);
            if (parsedProto?.linkPath) {
                return {
                    meshId: normalizedMeshId,
                    sectionName: normalizeDescriptorSectionName(parsedProto.sectionName || ''),
                    primType: String(parsedProto.protoType || '').trim().toLowerCase() || null,
                };
            }
            const legacyDescriptor = parseLegacyRuntimeMeshDescriptor(normalizedMeshId);
            if (legacyDescriptor) {
                return legacyDescriptor;
            }
            const resolvedPrimPath = normalizeHydraPath(this.getResolvedVisualTransformPrimPathForMeshId?.(normalizedMeshId)
                || this.getResolvedPrimPathForMeshId?.(normalizedMeshId)
                || '');
            const activeStageRootPrimPath = this.getActiveStageRootPrimPath?.();
            const genericPrimPath = resolvedPrimPath || normalizedMeshId;
            if (genericPrimPath
                && (!activeStageRootPrimPath
                    || genericPrimPath === activeStageRootPrimPath
                    || genericPrimPath.startsWith(`${activeStageRootPrimPath}/`))) {
                return {
                    meshId: normalizedMeshId,
                    sectionName: 'visuals',
                    primType: 'mesh',
                };
            }
            return null;
        };
        const copyTypedFloatArray = (value) => {
            if (!value || typeof value.length !== 'number')
                return new Float32Array(0);
            return ArrayBuffer.isView(value)
                ? Float32Array.from(value)
                : Float32Array.from(Array.from(value));
        };
        const copyTypedUintArray = (value) => {
            if (!value || typeof value.length !== 'number')
                return new Uint32Array(0);
            return ArrayBuffer.isView(value)
                ? Uint32Array.from(value)
                : Uint32Array.from(Array.from(value));
        };
        const normalizeGeomSubsetSectionRecords = (value) => {
            if (!value || typeof value.length !== 'number')
                return [];
            const out = [];
            const safeLength = Math.max(0, Math.floor(Number(value.length) || 0));
            for (let index = 0; index < safeLength; index += 1) {
                const rawSection = value[index];
                const start = Number(rawSection?.start);
                const length = Number(rawSection?.length);
                if (!Number.isFinite(start) || !Number.isFinite(length) || length <= 0)
                    continue;
                out.push({
                    start: Math.max(0, Math.floor(start)),
                    length: Math.max(0, Math.floor(length)),
                    materialId: normalizeHydraPath(rawSection?.materialId || '') || '',
                });
            }
            return out;
        };
        const createPackedProtoPayloadEntry = (normalizedBlob) => {
            if (!normalizedBlob)
                return null;
            return {
                payload: normalizedBlob,
                positions: readFloatPayload(normalizedBlob, 'points', 'pointsPtr', Number(normalizedBlob.numVertices || 0) * 3),
                indices: readUintPayload(normalizedBlob, 'indices', 'indicesPtr', Number(normalizedBlob.numIndices || 0)),
                normals: readFloatPayload(normalizedBlob, 'normals', 'normalsPtr', Number(normalizedBlob.numNormals || 0) * Math.max(1, Number(normalizedBlob.normalsDimension || 3))),
                uvs: readFloatPayload(normalizedBlob, 'uv', 'uvPtr', Number(normalizedBlob.numUVs || 0) * Math.max(1, Number(normalizedBlob.uvDimension || 2))),
                transform: readFloatPayload(normalizedBlob, 'transform', 'transformPtr', 16),
            };
        };
        const extractPackedProtoPayloadEntryFromLiveMesh = (meshId) => {
            const normalizedMeshId = normalizeHydraPath(meshId || '');
            if (!normalizedMeshId)
                return null;
            const hydraMesh = this.meshes?.[normalizedMeshId];
            const threeMesh = hydraMesh?._mesh || null;
            const geometry = threeMesh?.geometry || hydraMesh?._geometry || null;
            const positionAttribute = geometry?.getAttribute?.('position');
            if (!positionAttribute?.array || Number(positionAttribute.count || 0) <= 0)
                return null;
            const normalAttribute = geometry?.getAttribute?.('normal') || null;
            const uvAttribute = geometry?.getAttribute?.('uv') || null;
            const indexAttribute = geometry?.getIndex?.() || null;
            try {
                threeMesh?.updateWorldMatrix?.(true, false);
            }
            catch { }
            const transformElements = threeMesh?.matrixWorld?.elements || threeMesh?.matrix?.elements || null;
            const normalizedBlob = this.normalizeProtoDataBlob({
                valid: true,
                numVertices: Math.max(0, Math.floor(Number(positionAttribute.count || 0))),
                points: copyTypedFloatArray(positionAttribute.array),
                numIndices: indexAttribute?.array && typeof indexAttribute.array.length === 'number'
                    ? Math.max(0, Math.floor(Number(indexAttribute.count || indexAttribute.array.length || 0)))
                    : 0,
                indices: copyTypedUintArray(indexAttribute?.array),
                numNormals: normalAttribute?.array && typeof normalAttribute.array.length === 'number'
                    ? Math.max(0, Math.floor(Number(normalAttribute.count || 0)))
                    : 0,
                normalsDimension: Math.max(0, Math.floor(Number(normalAttribute?.itemSize || 0))),
                normals: copyTypedFloatArray(normalAttribute?.array),
                numUVs: uvAttribute?.array && typeof uvAttribute.array.length === 'number'
                    ? Math.max(0, Math.floor(Number(uvAttribute.count || 0)))
                    : 0,
                uvDimension: Math.max(0, Math.floor(Number(uvAttribute?.itemSize || 0))),
                uv: copyTypedFloatArray(uvAttribute?.array),
                transform: transformElements && typeof transformElements.length === 'number'
                    ? copyTypedFloatArray(Array.from(transformElements).slice(0, 16))
                    : undefined,
                materialId: normalizeHydraPath(hydraMesh?._pendingMaterialId || '') || '',
                geomSubsetSections: normalizeGeomSubsetSectionRecords(hydraMesh?._pendingGeomSubsetSections),
            });
            return createPackedProtoPayloadEntry(normalizedBlob);
        };
        const getRuntimeProtoOverrideForMesh = (meshId, sectionName) => {
            if (!meshId || !meshId.includes('.proto_'))
                return null;
            if (sectionName === 'visuals') {
                return this.getVisualProtoOverride?.(meshId) || null;
            }
            if (sectionName === 'collisions') {
                return this.getCollisionProtoOverride?.(meshId) || null;
            }
            return null;
        };
        const getRuntimeResolvedPrimPathForMesh = (meshId, sectionName, overridePayload = null) => {
            const overridePath = normalizeHydraPath(overridePayload?.resolvedPrimPath || '');
            if (overridePath)
                return overridePath;
            if (sectionName === 'visuals') {
                return normalizeHydraPath(this.getResolvedVisualTransformPrimPathForMeshId?.(meshId)
                    || this.getResolvedPrimPathForMeshId?.(meshId)
                    || meshId);
            }
            return normalizeHydraPath(this.getResolvedPrimPathForMeshId?.(meshId) || meshId);
        };
        const synthesizeRawMeshDescriptorFromRuntime = (meshId, protoPayloadByKey) => {
            const seed = getRuntimeDescriptorSeed(meshId);
            if (!seed)
                return null;
            const overridePayload = getRuntimeProtoOverrideForMesh(seed.meshId, seed.sectionName);
            const normalizedBlob = protoPayloadByKey.get(seed.meshId)?.payload
                || this.normalizeProtoDataBlob(overridePayload?.meshPayload || null)
                || null;
            return {
                valid: true,
                meshId: seed.meshId,
                sectionName: seed.sectionName,
                resolvedPrimPath: getRuntimeResolvedPrimPathForMesh(seed.meshId, seed.sectionName, overridePayload) || null,
                primType: String(overridePayload?.primType || seed.primType || (normalizedBlob ? 'mesh' : '')).trim().toLowerCase() || null,
                axis: normalizeDescriptorAxis(overridePayload?.axis),
                size: normalizeFiniteNumber(overridePayload?.size),
                radius: normalizeFiniteNumber(overridePayload?.radius),
                height: normalizeFiniteNumber(overridePayload?.height),
                extentSize: normalizeDescriptorExtentSize(overridePayload?.extentSize),
                geometry: normalizeGeometrySummary(null, normalizedBlob),
                ranges: null,
            };
        };
        const sliceFloatPool = (pool, range) => {
            if (!range || !pool || typeof pool.subarray !== 'function')
                return new Float32Array(0);
            const start = Math.max(0, Math.floor(Number(range.offset) || 0));
            const count = Math.max(0, Math.floor(Number(range.count) || 0));
            if (count <= 0 || start >= pool.length)
                return new Float32Array(0);
            const end = Math.min(pool.length, start + count);
            return pool.subarray(start, end);
        };
        const sliceUintPool = (pool, range) => {
            if (!range || !pool || typeof pool.subarray !== 'function')
                return new Uint32Array(0);
            const start = Math.max(0, Math.floor(Number(range.offset) || 0));
            const count = Math.max(0, Math.floor(Number(range.count) || 0));
            if (count <= 0 || start >= pool.length)
                return new Uint32Array(0);
            const end = Math.min(pool.length, start + count);
            return pool.subarray(start, end);
        };
        let positionPool = new Float32Array(0);
        let indexPool = new Uint32Array(0);
        let normalPool = new Float32Array(0);
        let uvPool = new Float32Array(0);
        let transformPool = new Float32Array(0);
        let bufferRangesByMeshId = {};
        let normalizedMeshDescriptors = [];
        let stageLayerTexts = null;
        const getStageLayerTexts = () => {
            if (stageLayerTexts) {
                return stageLayerTexts;
            }
            const stage = this.getStage?.();
            stageLayerTexts = this.getStageMetadataLayerTexts(stage || null, resolvedStageSourcePath);
            return stageLayerTexts;
        };
        const cloneMeshRanges = (ranges) => normalizeMeshRanges(ranges) || null;
        const descriptorHasMeshPayload = (descriptor) => {
            const ranges = normalizeMeshRanges(descriptor?.ranges) || null;
            const geometry = descriptor?.geometry && typeof descriptor.geometry === 'object'
                ? descriptor.geometry
                : null;
            return Boolean(
                Number(geometry?.numVertices || 0) > 0 ||
                Number(geometry?.numIndices || 0) > 0 ||
                Number(ranges?.positions?.count || 0) > 0 ||
                Number(ranges?.indices?.count || 0) > 0
            );
        };
        const mergeReferencedMeshGeometry = (targetGeometry, sourceGeometry) => {
            const target = targetGeometry && typeof targetGeometry === 'object'
                ? targetGeometry
                : {};
            const source = sourceGeometry && typeof sourceGeometry === 'object'
                ? sourceGeometry
                : {};
            if (Object.keys(source).length === 0 && Object.keys(target).length === 0) {
                return null;
            }
            const pickCount = (key) => {
                const targetValue = Number(target[key] || 0);
                const sourceValue = Number(source[key] || 0);
                return targetValue > 0 ? targetValue : sourceValue;
            };
            const pickText = (key) => String(target[key] || source[key] || '').trim();
            const targetGeomSubsetSections = normalizeGeomSubsetSections(target.geomSubsetSections);
            const sourceGeomSubsetSections = normalizeGeomSubsetSections(source.geomSubsetSections);
            const materialId =
                normalizeHydraPath(target.materialId || '') ||
                normalizeHydraPath(source.materialId || '') ||
                null;
            return {
                ...source,
                ...target,
                numVertices: pickCount('numVertices'),
                numIndices: pickCount('numIndices'),
                numNormals: pickCount('numNormals'),
                numUVs: pickCount('numUVs'),
                uvDimension: pickCount('uvDimension'),
                normalsDimension: pickCount('normalsDimension'),
                renderReady: target.renderReady === true || source.renderReady === true,
                topologyMode:
                    normalizeTopologyMode(target.topologyMode) ||
                    normalizeTopologyMode(source.topologyMode) ||
                    (pickCount('numIndices') > 0 ? 'indexed' : null),
                uvSource: pickText('uvSource'),
                materialId,
                geomSubsetSections: targetGeomSubsetSections.length > 0
                    ? targetGeomSubsetSections
                    : sourceGeomSubsetSections,
            };
        };
        const buildReferencedMeshLibraryPayloadAliases = () => {
            const aliases = new Map();
            for (const layerText of getStageLayerTexts()) {
                const referencesByPrimPath = parseUsdReferenceTargetsByPrimPathFromLayerText?.(layerText);
                if (!(referencesByPrimPath instanceof Map)) {
                    continue;
                }
                for (const [rawPrimPath, rawTargets] of referencesByPrimPath.entries()) {
                    const primPath = normalizeHydraPath(rawPrimPath);
                    if (!primPath) {
                        continue;
                    }
                    const target = toPlainArray(rawTargets)
                        .map((entry) => normalizeHydraPath(entry))
                        .find((entry) => entry.includes('/__MeshLibrary/'));
                    if (target) {
                        aliases.set(primPath, target);
                    }
                }
            }
            return aliases;
        };
        const appendFloatPayloadToPool = (pool, values) => {
            const source = values && typeof values.length === 'number'
                ? Float32Array.from(values)
                : new Float32Array(0);
            if (source.length <= 0) {
                return { pool, range: null };
            }
            const offset = pool.length;
            const nextPool = new Float32Array(pool.length + source.length);
            nextPool.set(pool, 0);
            nextPool.set(source, offset);
            return {
                pool: nextPool,
                range: { offset, count: source.length },
            };
        };
        const appendUintPayloadToPool = (pool, values) => {
            const source = values && typeof values.length === 'number'
                ? Uint32Array.from(values)
                : new Uint32Array(0);
            if (source.length <= 0) {
                return { pool, range: null };
            }
            const offset = pool.length;
            const nextPool = new Uint32Array(pool.length + source.length);
            nextPool.set(pool, 0);
            nextPool.set(source, offset);
            return {
                pool: nextPool,
                range: { offset, count: source.length },
            };
        };
        const appendReferencedPayloadEntryToSnapshotBuffers = (meshId, packedEntry) => {
            if (!meshId || !packedEntry?.payload) {
                return null;
            }
            const existingRanges = normalizeMeshRanges(bufferRangesByMeshId[meshId]);
            if (existingRanges && Number(existingRanges.positions?.count || 0) > 0) {
                return {
                    ranges: existingRanges,
                    geometry: normalizeGeometrySummary(null, packedEntry.payload),
                };
            }

            const positionsAppend = appendFloatPayloadToPool(positionPool, packedEntry.positions);
            positionPool = positionsAppend.pool;
            const indicesAppend = appendUintPayloadToPool(indexPool, packedEntry.indices);
            indexPool = indicesAppend.pool;
            const normalsAppend = appendFloatPayloadToPool(normalPool, packedEntry.normals);
            normalPool = normalsAppend.pool;
            const uvsAppend = appendFloatPayloadToPool(uvPool, packedEntry.uvs);
            uvPool = uvsAppend.pool;
            const transformsAppend = appendFloatPayloadToPool(transformPool, packedEntry.transform);
            transformPool = transformsAppend.pool;

            const ranges = {
                positions: positionsAppend.range
                    ? { ...positionsAppend.range, stride: 3 }
                    : null,
                indices: indicesAppend.range
                    ? { ...indicesAppend.range, stride: 1 }
                    : null,
                normals: normalsAppend.range
                    ? {
                        ...normalsAppend.range,
                        stride: Math.max(1, Number(packedEntry.payload.normalsDimension || 3)),
                    }
                    : null,
                uvs: uvsAppend.range
                    ? {
                        ...uvsAppend.range,
                        stride: Math.max(1, Number(packedEntry.payload.uvDimension || 2)),
                    }
                    : null,
                transform: transformsAppend.range
                    ? { ...transformsAppend.range, stride: 16 }
                    : null,
            };
            const normalizedRanges = normalizeMeshRanges(ranges);
            if (!normalizedRanges) {
                return null;
            }
            bufferRangesByMeshId[meshId] = normalizedRanges;
            return {
                ranges: normalizedRanges,
                geometry: normalizeGeometrySummary(null, packedEntry.payload),
                normalDiagnostics: normalizeNormalDiagnostics(packedEntry.payload),
            };
        };
        const attachReferencedMeshLibraryPayloads = () => {
            if (!Array.isArray(normalizedMeshDescriptors) || normalizedMeshDescriptors.length === 0) {
                return;
            }
            const needsReferencedPayloads = normalizedMeshDescriptors.some((descriptor) => {
                if (descriptorHasMeshPayload(descriptor)) {
                    return false;
                }
                return normalizeDescriptorSectionName(descriptor?.sectionName) === 'visuals';
            });
            if (!needsReferencedPayloads) {
                return;
            }
            const referenceAliasByPrimPath = buildReferencedMeshLibraryPayloadAliases();
            if (referenceAliasByPrimPath.size === 0) {
                return;
            }
            const descriptorByMeshId = new Map();
            normalizedMeshDescriptors.forEach((descriptor) => {
                const meshId = normalizeHydraPath(descriptor?.meshId || '');
                if (meshId) {
                    descriptorByMeshId.set(meshId, descriptor);
                }
            });
            normalizedMeshDescriptors = normalizedMeshDescriptors.map((descriptor) => {
                if (descriptorHasMeshPayload(descriptor)) {
                    return descriptor;
                }
                if (normalizeDescriptorSectionName(descriptor?.sectionName) !== 'visuals') {
                    return descriptor;
                }
                const meshId = normalizeHydraPath(descriptor?.meshId || '');
                const resolvedPrimPath = normalizeHydraPath(descriptor?.resolvedPrimPath || '');
                const referencedMeshId =
                    referenceAliasByPrimPath.get(resolvedPrimPath) ||
                    referenceAliasByPrimPath.get(meshId) ||
                    '';
                if (!referencedMeshId) {
                    return descriptor;
                }
                const sourceDescriptor = descriptorByMeshId.get(referencedMeshId);
                let sourceRanges = cloneMeshRanges(sourceDescriptor?.ranges);
                let sourceGeometry = sourceDescriptor?.geometry;
                let sourceNormalDiagnostics = normalizeNormalDiagnostics(sourceDescriptor);
                if (!descriptorHasMeshPayload(sourceDescriptor)) {
                    const livePackedEntry = extractPackedProtoPayloadEntryFromLiveMesh(referencedMeshId);
                    const appendedPayload = appendReferencedPayloadEntryToSnapshotBuffers(
                        referencedMeshId,
                        livePackedEntry,
                    );
                    sourceRanges = appendedPayload?.ranges || sourceRanges;
                    sourceGeometry = appendedPayload?.geometry || sourceGeometry;
                    sourceNormalDiagnostics = appendedPayload?.normalDiagnostics || sourceNormalDiagnostics;
                }
                if (!sourceRanges && !sourceGeometry) {
                    return descriptor;
                }
                const nextRanges = cloneMeshRanges(descriptor?.ranges) || sourceRanges;
                if (meshId && nextRanges) {
                    bufferRangesByMeshId[meshId] = nextRanges;
                }
                return {
                    ...descriptor,
                    ranges: nextRanges,
                    renderReady: descriptor?.renderReady === true || sourceDescriptor?.renderReady === true,
                    topologyMode:
                        normalizeTopologyMode(descriptor?.topologyMode) ||
                        normalizeTopologyMode(sourceDescriptor?.topologyMode),
                    geometry: mergeReferencedMeshGeometry(
                        descriptor?.geometry,
                        sourceGeometry,
                    ),
                    ...(normalizeNormalDiagnostics(descriptor) ||
                    sourceNormalDiagnostics
                        ? {
                            normalDiagnostics:
                                normalizeNormalDiagnostics(descriptor) ||
                                sourceNormalDiagnostics,
                        }
                        : {}),
                };
            });
        };
        if (hasPackedDescriptorRecords) {
            positionPool = useFloat32(rawBuffers.positions);
            indexPool = useUint32(rawBuffers.indices);
            normalPool = useFloat32(rawBuffers.normals);
            uvPool = useFloat32(rawBuffers.uvs);
            transformPool = useFloat32(rawBuffers.transforms);
            const packedDescriptorStrings = toPlainArray(renderPayload.meshDescriptorStrings)
                .map((value) => String(value || ''));
            const packedDescriptorHeaders = useInt32(renderPayload.meshDescriptorHeaders);
            const packedDescriptorScalars = useFloat32(renderPayload.meshDescriptorScalars);
            const headerStride = Math.max(1, Math.floor(Number(renderPayload.meshDescriptorHeaderStride || 30)));
            const scalarStride = Math.max(1, Math.floor(Number(renderPayload.meshDescriptorScalarStride || 6)));
            const readPackedString = (rawIndex) => {
                const index = Number(rawIndex);
                if (!Number.isFinite(index))
                    return '';
                const normalizedIndex = Math.floor(index);
                if (normalizedIndex < 0 || normalizedIndex >= packedDescriptorStrings.length)
                    return '';
                return packedDescriptorStrings[normalizedIndex] || '';
            };
            const readPackedRange = (headerBase, offsetIndex, countIndex, strideIndex, fallbackStride) => {
                const offset = Number(packedDescriptorHeaders[headerBase + offsetIndex]);
                const count = Number(packedDescriptorHeaders[headerBase + countIndex]);
                const stride = Number(packedDescriptorHeaders[headerBase + strideIndex]);
                return normalizeBufferRange({ offset, count, stride }, fallbackStride);
            };
            const readPackedScalar = (scalarBase, index) => {
                const value = Number(packedDescriptorScalars[scalarBase + index]);
                return Number.isFinite(value) ? value : undefined;
            };
            const makeFloatView = (pool, range) => (range
                ? pool.subarray(range.offset, range.offset + range.count)
                : new Float32Array(0));
            const makeUintView = (pool, range) => (range
                ? pool.subarray(range.offset, range.offset + range.count)
                : new Uint32Array(0));
            const descriptorCount = Math.min(Math.floor(packedDescriptorHeaders.length / headerStride), Math.floor(packedDescriptorScalars.length / scalarStride));
            rawMeshDescriptors = [];
            for (let descriptorIndex = 0; descriptorIndex < descriptorCount; descriptorIndex += 1) {
                const headerBase = descriptorIndex * headerStride;
                const scalarBase = descriptorIndex * scalarStride;
                const meshId = readPackedString(packedDescriptorHeaders[headerBase + 0]);
                const sectionName = readPackedString(packedDescriptorHeaders[headerBase + 1]);
                const resolvedPrimPath = readPackedString(packedDescriptorHeaders[headerBase + 2]);
                const primType = readPackedString(packedDescriptorHeaders[headerBase + 3]);
                const axis = readPackedString(packedDescriptorHeaders[headerBase + 4]);
                const materialId = normalizeHydraPath(readPackedString(packedDescriptorHeaders[headerBase + 5])) || null;
                const geomSubsetSections = normalizeGeomSubsetSections(packedGeomSubsetSectionsByMeshId && meshId
                    ? packedGeomSubsetSectionsByMeshId[meshId]
                    : null);
                const normalDiagnostics = normalizeNormalDiagnostics(packedNormalDiagnosticsByMeshId && meshId
                    ? packedNormalDiagnosticsByMeshId[meshId]
                    : null);
                const valid = Number(packedDescriptorHeaders[headerBase + 6]) === 1;
                const applyGeometry = Number(packedDescriptorHeaders[headerBase + 7]) === 1;
                const dirtyMask = Math.max(0, Math.floor(Number(packedDescriptorHeaders[headerBase + 8]) || 0));
                const ranges = {
                    positions: readPackedRange(headerBase, 9, 10, 11, 3),
                    indices: readPackedRange(headerBase, 12, 13, 14, 1),
                    normals: readPackedRange(headerBase, 15, 16, 17, 3),
                    uvs: readPackedRange(headerBase, 18, 19, 20, 2),
                    transform: readPackedRange(headerBase, 21, 22, 23, 16),
                };
                const normalizedRanges = normalizeMeshRanges(ranges);
                const geometry = {
                    numVertices: Math.max(0, Math.floor(Number(packedDescriptorHeaders[headerBase + 24]) || 0)),
                    numIndices: Math.max(0, Math.floor(Number(packedDescriptorHeaders[headerBase + 25]) || 0)),
                    numNormals: Math.max(0, Math.floor(Number(packedDescriptorHeaders[headerBase + 26]) || 0)),
                    numUVs: Math.max(0, Math.floor(Number(packedDescriptorHeaders[headerBase + 27]) || 0)),
                    uvDimension: Math.max(0, Math.floor(Number(packedDescriptorHeaders[headerBase + 28]) || 0)),
                    normalsDimension: Math.max(0, Math.floor(Number(packedDescriptorHeaders[headerBase + 29]) || 0)),
                    renderReady: true,
                    topologyMode: Math.max(0, Math.floor(Number(packedDescriptorHeaders[headerBase + 25]) || 0)) > 0
                        ? 'indexed'
                        : 'nonIndexed',
                    materialId,
                    geomSubsetSections,
                    ...(normalDiagnostics ? { normalDiagnostics } : {}),
                };
                const extentValues = [
                    readPackedScalar(scalarBase, 3),
                    readPackedScalar(scalarBase, 4),
                    readPackedScalar(scalarBase, 5),
                ];
                const extentSize = extentValues.every((value) => Number.isFinite(value))
                    ? extentValues.map((value) => Math.max(0, Number(value)))
                    : undefined;
                const meshPayload = primType === 'mesh'
                    ? {
                        valid,
                        numVertices: geometry.numVertices,
                        numIndices: geometry.numIndices,
                        numNormals: geometry.numNormals,
                        numUVs: geometry.numUVs,
                        uvDimension: geometry.uvDimension,
                        normalsDimension: geometry.normalsDimension,
                        renderReady: geometry.renderReady === true,
                        topologyMode: normalizeTopologyMode(geometry.topologyMode)
                            || (geometry.numIndices > 0 ? 'indexed' : 'nonIndexed'),
                        uvSource: geometry.uvSource || '',
                        materialId: geometry.materialId,
                        geomSubsetSections: geometry.geomSubsetSections,
                        points: makeFloatView(positionPool, normalizedRanges?.positions || null),
                        indices: makeUintView(indexPool, normalizedRanges?.indices || null),
                        normals: makeFloatView(normalPool, normalizedRanges?.normals || null),
                        uv: makeFloatView(uvPool, normalizedRanges?.uvs || null),
                        transform: makeFloatView(transformPool, normalizedRanges?.transform || null),
                        ...(normalDiagnostics ? { normalDiagnostics } : {}),
                    }
                    : undefined;
                const worldTransform = normalizedRanges?.transform
                    ? makeFloatView(transformPool, normalizedRanges.transform)
                    : undefined;
                rawMeshDescriptors.push({
                    valid,
                    meshId,
                    sectionName,
                    resolvedPrimPath,
                    primType,
                    axis,
                    size: readPackedScalar(scalarBase, 0),
                    radius: readPackedScalar(scalarBase, 1),
                    height: readPackedScalar(scalarBase, 2),
                    extentSize,
                    worldTransform,
                    applyGeometry,
                    dirtyMask,
                    ranges: normalizedRanges,
                    geometry,
                    meshPayload,
                    ...(normalDiagnostics ? { normalDiagnostics } : {}),
                });
                const normalizedMeshId = normalizeHydraPath(meshId || '');
                if (normalizedMeshId && normalizedRanges) {
                    bufferRangesByMeshId[normalizedMeshId] = normalizedRanges;
                }
            }
        }
        const primPathSummary = renderPayload.primPathSet !== undefined
            ? (this.prefetchPrimPathSetFromDriver({ GetPrimPathSet: () => renderPayload.primPathSet }, { force: forceRefresh }) || { count: 0, source: 'none' })
            : { count: 0, source: 'none' };
        const transformSummary = renderPayload.primTransforms !== undefined
            ? (this.prefetchPrimTransformsFromDriver({ GetPrimTransforms: () => renderPayload.primTransforms }, { force: forceRefresh }) || { world: 0, local: 0, total: 0, source: 'none' })
            : { world: 0, local: 0, total: 0, source: 'none' };
        let protoBlobSummary = renderPayload.protoDataBlobs !== undefined && !hasPackedMeshBuffers
            ? (this.prefetchProtoDataBlobsFromDriver({ GetAllProtoDataBlobs: () => renderPayload.protoDataBlobs }, { force: forceRefresh }) || { count: 0, source: 'none' })
            : { count: 0, source: hasPackedMeshBuffers ? 'packed-buffers' : 'none' };
        const descriptorHasProtoOverride = rawMeshDescriptors.some((descriptor) => String(descriptor?.meshId || '').includes('.proto_'));
        const finalOverrideSummary = descriptorHasProtoOverride
            ? (this.ingestFinalStageOverrideSnapshotDescriptors(rawMeshDescriptors, { force: forceRefresh }) || {
                count: 0,
                collisionCount: 0,
                visualCount: 0,
                primOverrideCount: 0,
                source: 'none',
            })
            : renderPayload.finalStageOverrideBatch !== undefined
                ? (this.prefetchFinalStageOverrideBatchFromDriver({ GetFinalStageOverrideBatch: () => renderPayload.finalStageOverrideBatch }, { force: forceRefresh }) || {
                    count: 0,
                    collisionCount: 0,
                    visualCount: 0,
                    primOverrideCount: 0,
                    source: 'none',
                })
                : {
                    count: 0,
                    collisionCount: 0,
                    visualCount: 0,
                    primOverrideCount: 0,
                    source: 'none',
                };
        const robotMetadataSummary = this.ingestRobotMetadataSnapshotFromBootstrapPayload(robotMetadataRaw, {
            stageSourcePath: resolvedStageSourcePath,
            emitEvent: options?.emitRobotMetadataEvent === true,
            allowEmptySnapshot: true,
        }) || { ready: false, jointCount: 0, dynamicsCount: 0, source: 'none' };
        if (hasPackedMeshBuffers) {
            if (!hasPackedDescriptorRecords) {
                positionPool = useFloat32(rawBuffers.positions);
                indexPool = useUint32(rawBuffers.indices);
                normalPool = useFloat32(rawBuffers.normals);
                uvPool = useFloat32(rawBuffers.uvs);
                transformPool = useFloat32(rawBuffers.transforms);
                for (const [rawMeshId, rawRanges] of Object.entries(packedRangesByMeshId || {})) {
                    const meshId = normalizeHydraPath(rawMeshId);
                    const normalizedRanges = normalizeMeshRanges(rawRanges);
                    if (!meshId || !normalizedRanges)
                        continue;
                    bufferRangesByMeshId[meshId] = normalizedRanges;
                }
            }
            normalizedMeshDescriptors = rawMeshDescriptors.map((rawDescriptor) => {
                const meshId = normalizeHydraPath(rawDescriptor?.meshId || '');
                const resolvedPrimPath = normalizeHydraPath(rawDescriptor?.resolvedPrimPath || '');
                const normalDiagnostics = normalizeNormalDiagnostics(rawDescriptor)
                    || normalizeNormalDiagnostics(rawDescriptor?.geometry);
                return {
                    meshId: meshId || null,
                    sectionName: String(rawDescriptor?.sectionName || '').trim() || null,
                    resolvedPrimPath: resolvedPrimPath || null,
                    primType: String(rawDescriptor?.primType || '').trim() || null,
                    ...normalizeDescriptorPrimitiveSummary(rawDescriptor),
                    applyGeometry: rawDescriptor?.applyGeometry === true,
                    dirtyMask: Number(rawDescriptor?.dirtyMask || 0),
                    ranges: normalizeMeshRanges(rawDescriptor?.ranges) || (meshId ? (bufferRangesByMeshId[meshId] || null) : null),
                    geometry: normalizeGeometrySummary(rawDescriptor?.geometry, null),
                    renderReady: rawDescriptor?.renderReady === true || rawDescriptor?.geometry?.renderReady === true,
                    topologyMode: normalizeTopologyMode(rawDescriptor?.topologyMode)
                        || normalizeTopologyMode(rawDescriptor?.geometry?.topologyMode),
                    ...(normalDiagnostics ? { normalDiagnostics } : {}),
                };
            });
            if (protoBlobSummary.count <= 0) {
                protoBlobSummary = {
                    count: Object.keys(bufferRangesByMeshId).length,
                    source: 'packed-buffers',
                };
            }
        }
        else {
            const protoPayloadByKey = new Map();
            const rawProtoDataBlobs = renderPayload.protoDataBlobs && typeof renderPayload.protoDataBlobs === 'object'
                ? renderPayload.protoDataBlobs
                : {};
            for (const [rawKey, rawBlob] of Object.entries(rawProtoDataBlobs)) {
                const normalizedKey = normalizeHydraPath(rawKey);
                if (!normalizedKey)
                    continue;
                const normalizedBlob = this.normalizeProtoDataBlob(rawBlob);
                const packedEntry = createPackedProtoPayloadEntry(normalizedBlob);
                if (!packedEntry)
                    continue;
                protoPayloadByKey.set(normalizedKey, packedEntry);
            }
            for (const rawDescriptor of rawMeshDescriptors) {
                const meshId = normalizeHydraPath(rawDescriptor?.meshId || '');
                if (!meshId || protoPayloadByKey.has(meshId) || !rawDescriptor?.meshPayload)
                    continue;
                const normalizedBlob = this.normalizeProtoDataBlob(rawDescriptor.meshPayload);
                const packedEntry = createPackedProtoPayloadEntry(normalizedBlob);
                if (!packedEntry)
                    continue;
                protoPayloadByKey.set(meshId, packedEntry);
            }
            const descriptorMeshIds = new Set(rawMeshDescriptors
                .map((rawDescriptor) => normalizeHydraPath(rawDescriptor?.meshId || ''))
                .filter(Boolean));
            const runtimeCandidateMeshIds = new Set([
                ...descriptorMeshIds,
                ...protoPayloadByKey.keys(),
                ...Object.keys(this.meshes || {}).map((meshId) => normalizeHydraPath(meshId || '')).filter(Boolean),
            ]);
            for (const meshId of Array.from(runtimeCandidateMeshIds).sort((left, right) => left.localeCompare(right))) {
                if (!meshId || this.shouldSuppressSyntheticTopLevelMesh?.(meshId))
                    continue;
                if (!protoPayloadByKey.has(meshId)) {
                    const fetchedPackedEntry = createPackedProtoPayloadEntry(this.getProtoDataBlob?.(meshId, {
                        forceRefresh: forceRefresh,
                    }) || null);
                    const livePackedEntry = fetchedPackedEntry || extractPackedProtoPayloadEntryFromLiveMesh(meshId);
                    if (livePackedEntry) {
                        protoPayloadByKey.set(meshId, livePackedEntry);
                    }
                }
                if (!descriptorMeshIds.has(meshId)) {
                    const syntheticDescriptor = synthesizeRawMeshDescriptorFromRuntime(meshId, protoPayloadByKey);
                    if (syntheticDescriptor) {
                        rawMeshDescriptors.push(syntheticDescriptor);
                        descriptorMeshIds.add(meshId);
                    }
                }
            }
            const pooledEntries = Array.from(protoPayloadByKey.entries());
            if (protoBlobSummary.count <= 0 && pooledEntries.length > 0) {
                protoBlobSummary = {
                    count: pooledEntries.length,
                    source: 'runtime-fallback',
                };
            }
            let totalPositionCount = 0;
            let totalIndexCount = 0;
            let totalNormalCount = 0;
            let totalUvCount = 0;
            let totalTransformCount = 0;
            for (const [, packed] of pooledEntries) {
                totalPositionCount += Number(packed.positions?.length || 0);
                totalIndexCount += Number(packed.indices?.length || 0);
                totalNormalCount += Number(packed.normals?.length || 0);
                totalUvCount += Number(packed.uvs?.length || 0);
                totalTransformCount += Number(packed.transform?.length || 0);
            }
            positionPool = new Float32Array(totalPositionCount);
            indexPool = new Uint32Array(totalIndexCount);
            normalPool = new Float32Array(totalNormalCount);
            uvPool = new Float32Array(totalUvCount);
            transformPool = new Float32Array(totalTransformCount);
            bufferRangesByMeshId = {};
            let positionOffset = 0;
            let indexOffset = 0;
            let normalOffset = 0;
            let uvOffset = 0;
            let transformOffset = 0;
            for (const [meshId, packed] of pooledEntries) {
                const positions = packed.positions || new Float32Array(0);
                const indices = packed.indices || new Uint32Array(0);
                const normals = packed.normals || new Float32Array(0);
                const uvs = packed.uvs || new Float32Array(0);
                const transform = packed.transform || new Float32Array(0);
                if (positions.length > 0)
                    positionPool.set(positions, positionOffset);
                if (indices.length > 0)
                    indexPool.set(indices, indexOffset);
                if (normals.length > 0)
                    normalPool.set(normals, normalOffset);
                if (uvs.length > 0)
                    uvPool.set(uvs, uvOffset);
                if (transform.length > 0)
                    transformPool.set(transform, transformOffset);
                bufferRangesByMeshId[meshId] = {
                    positions: positions.length > 0 ? { offset: positionOffset, count: positions.length, stride: 3 } : null,
                    indices: indices.length > 0 ? { offset: indexOffset, count: indices.length, stride: 1 } : null,
                    normals: normals.length > 0 ? {
                        offset: normalOffset,
                        count: normals.length,
                        stride: Math.max(1, Number(packed.payload?.normalsDimension || 3)),
                    } : null,
                    uvs: uvs.length > 0 ? {
                        offset: uvOffset,
                        count: uvs.length,
                        stride: Math.max(1, Number(packed.payload?.uvDimension || 2)),
                    } : null,
                    transform: transform.length > 0 ? { offset: transformOffset, count: transform.length, stride: 16 } : null,
                };
                positionOffset += positions.length;
                indexOffset += indices.length;
                normalOffset += normals.length;
                uvOffset += uvs.length;
                transformOffset += transform.length;
            }
            normalizedMeshDescriptors = rawMeshDescriptors.map((rawDescriptor) => {
                const meshId = normalizeHydraPath(rawDescriptor?.meshId || '');
                const resolvedPrimPath = normalizeHydraPath(rawDescriptor?.resolvedPrimPath || '');
                const normalizedBlob = meshId ? protoPayloadByKey.get(meshId)?.payload || null : null;
                const normalDiagnostics = normalizeNormalDiagnostics(rawDescriptor)
                    || normalizeNormalDiagnostics(normalizedBlob)
                    || normalizeNormalDiagnostics(rawDescriptor?.geometry);
                return {
                    meshId: meshId || null,
                    sectionName: String(rawDescriptor?.sectionName || '').trim() || null,
                    resolvedPrimPath: resolvedPrimPath || null,
                    primType: String(rawDescriptor?.primType || '').trim() || null,
                    ...normalizeDescriptorPrimitiveSummary(rawDescriptor),
                    applyGeometry: rawDescriptor?.applyGeometry === true,
                    dirtyMask: Number(rawDescriptor?.dirtyMask || 0),
                    ranges: meshId ? (bufferRangesByMeshId[meshId] || null) : null,
                    renderReady: rawDescriptor?.renderReady === true || normalizedBlob?.renderReady === true,
                    topologyMode: normalizeTopologyMode(rawDescriptor?.topologyMode)
                        || normalizeTopologyMode(normalizedBlob?.topologyMode),
                    geometry: normalizedBlob ? {
                        numVertices: Number(normalizedBlob.numVertices || 0),
                        numIndices: Number(normalizedBlob.numIndices || 0),
                        numNormals: Number(normalizedBlob.numNormals || 0),
                        numUVs: Number(normalizedBlob.numUVs || 0),
                        uvDimension: Number(normalizedBlob.uvDimension || 0),
                        normalsDimension: Number(normalizedBlob.normalsDimension || 0),
                        renderReady: normalizedBlob.renderReady === true,
                        topologyMode: normalizeTopologyMode(normalizedBlob.topologyMode)
                            || (Number(normalizedBlob.numIndices || 0) > 0 ? 'indexed' : 'nonIndexed'),
                        uvSource: typeof normalizedBlob.uvSource === 'string'
                            ? String(normalizedBlob.uvSource || '').trim()
                            : '',
                        materialId: normalizeHydraPath(normalizedBlob.materialId || '') || null,
                        geomSubsetSections: Array.isArray(normalizedBlob.geomSubsetSections)
                            ? normalizedBlob.geomSubsetSections
                            : [],
                        ...(normalDiagnostics ? { normalDiagnostics } : {}),
                    } : null,
                    ...(normalDiagnostics ? { normalDiagnostics } : {}),
                };
            });
        }
        attachReferencedMeshLibraryPayloads();
        if (hasPackedMeshBuffers) {
            this._protoDataBlobBatchCache?.clear?.();
            this._protoDataBlobMissCache?.clear?.();
            let packedBlobCount = 0;
            for (const descriptor of normalizedMeshDescriptors) {
                const meshId = normalizeHydraPath(descriptor?.meshId || '');
                if (!meshId || !meshId.includes('.proto_'))
                    continue;
                const ranges = normalizeMeshRanges(descriptor?.ranges) || null;
                const geometry = descriptor?.geometry && typeof descriptor.geometry === 'object'
                    ? descriptor.geometry
                    : {};
                const normalizedBlob = this.normalizeProtoDataBlob({
                    valid: true,
                    numVertices: Number(geometry?.numVertices || 0),
                    numIndices: Number(geometry?.numIndices || 0),
                    numNormals: Number(geometry?.numNormals || 0),
                    numUVs: Number(geometry?.numUVs || 0),
                    uvDimension: Number(geometry?.uvDimension || 0),
                    normalsDimension: Number(geometry?.normalsDimension || 0),
                    renderReady: geometry?.renderReady === true || hasPackedDescriptorRecords,
                    topologyMode: normalizeTopologyMode(geometry?.topologyMode)
                        || (Number(geometry?.numIndices || 0) > 0 ? 'indexed' : 'nonIndexed'),
                    uvSource: typeof geometry?.uvSource === 'string'
                        ? String(geometry.uvSource || '').trim()
                        : '',
                    materialId: normalizeHydraPath(geometry?.materialId || '') || '',
                    points: sliceFloatPool(positionPool, ranges?.positions || null),
                    indices: sliceUintPool(indexPool, ranges?.indices || null),
                    normals: sliceFloatPool(normalPool, ranges?.normals || null),
                    uv: sliceFloatPool(uvPool, ranges?.uvs || null),
                    transform: sliceFloatPool(transformPool, ranges?.transform || null),
                    geomSubsetSections: Array.isArray(geometry?.geomSubsetSections)
                        ? geometry.geomSubsetSections
                        : [],
                    ...(normalizeNormalDiagnostics(descriptor)
                        || normalizeNormalDiagnostics(geometry)
                        ? {
                            normalDiagnostics: normalizeNormalDiagnostics(descriptor)
                                || normalizeNormalDiagnostics(geometry),
                        }
                        : {}),
                });
                if (!normalizedBlob)
                    continue;
                this._protoDataBlobBatchCache.set(meshId, normalizedBlob);
                packedBlobCount += 1;
            }
            this._protoDataBlobBatchPrimed = true;
            if (protoBlobSummary.count <= 0) {
                protoBlobSummary = {
                    count: packedBlobCount,
                    source: 'packed-buffers',
                };
            }
        }
        const hasCollisionPrimitiveDescriptors = normalizedMeshDescriptors.some((descriptor) => {
            if (normalizeDescriptorSectionName(descriptor?.sectionName) !== 'collisions')
                return false;
            const proto = parseProtoMeshIdentifier(descriptor?.meshId || '');
            const primitiveType = String(proto?.protoType || descriptor?.primType || '').trim().toLowerCase();
            return ['box', 'cube', 'sphere', 'cylinder', 'capsule'].includes(primitiveType);
        });
        if (hasCollisionPrimitiveDescriptors) {
            const authoredColliderEntriesByLinkName = new Map();
            for (const layerText of getStageLayerTexts()) {
                const parsedEntries = parseColliderEntriesFromLayerText(layerText);
                if (!(parsedEntries instanceof Map))
                    continue;
                for (const [linkName, entries] of parsedEntries.entries()) {
                    if (Array.isArray(entries) && entries.length > 0) {
                        authoredColliderEntriesByLinkName.set(String(linkName || '').trim(), entries);
                    }
                }
            }
            if (authoredColliderEntriesByLinkName.size > 0) {
                normalizedMeshDescriptors = normalizedMeshDescriptors.map((descriptor) => {
                    if (normalizeDescriptorSectionName(descriptor?.sectionName) !== 'collisions')
                        return descriptor;
                    const proto = parseProtoMeshIdentifier(descriptor?.meshId || '');
                    const linkName = String(proto?.linkName || getPathBasename(getDescriptorLinkPath(descriptor)) || '').trim();
                    const protoType = String(proto?.protoType || descriptor?.primType || '').trim().toLowerCase();
                    const expectedType = protoType === 'box' ? 'cube' : protoType;
                    const entries = authoredColliderEntriesByLinkName.get(linkName) || [];
                    const typedEntries = entries.filter((entry) => {
                        const entryType = String(entry?.primitiveType || entry?.primitiveGeometry?.primitiveType || '').toLowerCase();
                        return (entryType === 'box' ? 'cube' : entryType) === expectedType;
                    });
                    const entryIndex = Number.isFinite(Number(proto?.protoIndex)) ? Math.max(0, Number(proto.protoIndex)) : 0;
                    const indexedEntryName = `collision_${entryIndex}`;
                    const indexedEntry = entries.find((entry) => {
                        if (String(entry?.entryName || '').trim() !== indexedEntryName)
                            return false;
                        const entryType = String(entry?.primitiveType || entry?.primitiveGeometry?.primitiveType || '').toLowerCase();
                        return (entryType === 'box' ? 'cube' : entryType) === expectedType;
                    });
                    const geometry = indexedEntry?.primitiveGeometry || typedEntries[entryIndex]?.primitiveGeometry || null;
                    const dimensions = Array.isArray(geometry?.dimensions)
                        ? geometry.dimensions.map((value) => Math.abs(Number(value)))
                        : null;
                    if (!dimensions || dimensions.length < 3 || dimensions.some((value) => !Number.isFinite(value)))
                        return descriptor;
                    if (expectedType === 'cube') {
                        return { ...descriptor, extentSize: dimensions.slice(0, 3) };
                    }
                    if (expectedType === 'sphere') {
                        return { ...descriptor, radius: Math.max(...dimensions.slice(0, 3)) * 0.5 };
                    }
                    if (expectedType === 'cylinder' || expectedType === 'capsule') {
                        return {
                            ...descriptor,
                            radius: Math.max(dimensions[0], dimensions[1]) * 0.5,
                            height: dimensions[2],
                            axis: 'Z',
                        };
                    }
                    return descriptor;
                });
            }
        }
        let snapshotMaterialRecords = toPlainArray(renderPayload.materials);
        const requiresStandardMaterialBindingRecovery = normalizedMeshDescriptors.some((descriptor) => {
            if (normalizeDescriptorSectionName(descriptor?.sectionName) !== 'visuals') {
                return false;
            }
            const existingMaterialId = normalizeHydraPath(descriptor?.materialId || descriptor?.geometry?.materialId || '');
            const existingGeomSubsetSections = Array.isArray(descriptor?.geometry?.geomSubsetSections)
                ? descriptor.geometry.geomSubsetSections
                : [];
            return !existingMaterialId && existingGeomSubsetSections.length === 0;
        });
        const parsedRoundtripMaterialRecovery = requiresStandardMaterialBindingRecovery
            ? getParsedRoundtripMaterialRecovery(this, resolvedStageSourcePath, getStageLayerTexts(), {
                includeUsdMaterialBindings: true,
            })
            : {
                urdfMaterialMetadataByPrimPath: new Map(),
                usdMaterialBindingsByPrimPath: new Map(),
            };
        const urdfMaterialMetadataByPrimPath = parsedRoundtripMaterialRecovery.urdfMaterialMetadataByPrimPath instanceof Map
            ? parsedRoundtripMaterialRecovery.urdfMaterialMetadataByPrimPath
            : new Map();
        const usdMaterialBindingsByPrimPath = parsedRoundtripMaterialRecovery.usdMaterialBindingsByPrimPath instanceof Map
            ? parsedRoundtripMaterialRecovery.usdMaterialBindingsByPrimPath
            : new Map();
        if (usdMaterialBindingsByPrimPath.size > 0 && normalizedMeshDescriptors.length > 0) {
            normalizedMeshDescriptors = normalizedMeshDescriptors.map((descriptor) => {
                const sectionName = normalizeDescriptorSectionName(descriptor?.sectionName);
                if (sectionName !== 'visuals') {
                    return descriptor;
                }
                const existingMaterialId = normalizeHydraPath(descriptor?.materialId || descriptor?.geometry?.materialId || '') || null;
                const existingGeomSubsetSections = normalizeGeomSubsetSections(descriptor?.geometry?.geomSubsetSections);
                if (existingMaterialId && existingGeomSubsetSections.length > 0) {
                    return descriptor;
                }
                const materialBindingMatch = findUsdMaterialBindingForDescriptor(
                    usdMaterialBindingsByPrimPath,
                    descriptor,
                );
                if (!materialBindingMatch) {
                    return descriptor;
                }
                const nextGeomSubsetSections = existingGeomSubsetSections.length > 0
                    ? existingGeomSubsetSections
                    : materialBindingMatch.geomSubsetSections;
                const recoveredMaterialId = normalizeHydraPath(materialBindingMatch.materialId || '') || null;
                const shouldPreferRecoveredMaterial =
                    recoveredMaterialId &&
                        materialBindingMatch.bindingStrength === 'strongerThanDescendants';
                const targetMaterialId = shouldPreferRecoveredMaterial
                    ? recoveredMaterialId
                    : (existingMaterialId || recoveredMaterialId || null);
                const nextGeometry = descriptor?.geometry && typeof descriptor.geometry === 'object'
                    ? {
                        ...descriptor.geometry,
                        materialId: shouldPreferRecoveredMaterial
                            ? targetMaterialId
                            : (descriptor.geometry?.materialId || targetMaterialId),
                        geomSubsetSections: nextGeomSubsetSections,
                    }
                    : {
                        materialId: targetMaterialId,
                        geomSubsetSections: nextGeomSubsetSections,
                    };
                return {
                    ...descriptor,
                    materialId: shouldPreferRecoveredMaterial
                        ? targetMaterialId
                        : (descriptor?.materialId || targetMaterialId),
                    geometry: nextGeometry,
                };
            });
        }
        if (urdfMaterialMetadataByPrimPath.size > 0 && normalizedMeshDescriptors.length > 0) {
            const knownMaterialIds = new Set(snapshotMaterialRecords
                .map((record) => normalizeHydraPath(record?.materialId || record?.id || ''))
                .filter(Boolean));
            const fallbackMaterialRecords = [];
            normalizedMeshDescriptors = normalizedMeshDescriptors.map((descriptor) => {
                const sectionName = normalizeDescriptorSectionName(descriptor?.sectionName);
                if (sectionName !== 'visuals') {
                    return descriptor;
                }
                const materialMetadataMatch = findUrdfMaterialMetadataForDescriptor(urdfMaterialMetadataByPrimPath, descriptor);
                if (!materialMetadataMatch) {
                    return descriptor;
                }
                const existingMaterialId = normalizeHydraPath(descriptor?.materialId || descriptor?.geometry?.materialId || '');
                const targetMaterialId = existingMaterialId || normalizeHydraPath(`${materialMetadataMatch.metadataPath}/__urdf_material`);
                if (!targetMaterialId) {
                    return descriptor;
                }
                if (!knownMaterialIds.has(targetMaterialId)) {
                    const { color, opacity } = parseColorAndOpacityFromHexString(materialMetadataMatch.metadata.color);
                    const mapPath = String(materialMetadataMatch.metadata.texture || '').trim() || null;
                    if (color || mapPath) {
                        fallbackMaterialRecords.push({
                            materialId: targetMaterialId,
                            name: getPathBasename(materialMetadataMatch.metadataPath) || getPathBasename(targetMaterialId) || 'urdf_material',
                            ...(color ? { color } : {}),
                            ...(opacity !== null ? { opacity } : {}),
                            ...(mapPath ? { mapPath } : {}),
                        });
                        knownMaterialIds.add(targetMaterialId);
                    }
                }
                if (existingMaterialId) {
                    return descriptor;
                }
                const nextGeometry = descriptor?.geometry && typeof descriptor.geometry === 'object'
                    ? {
                        ...descriptor.geometry,
                        materialId: descriptor.geometry?.materialId || targetMaterialId,
                    }
                    : { materialId: targetMaterialId };
                return {
                    ...descriptor,
                    materialId: targetMaterialId,
                    geometry: nextGeometry,
                };
            });
            if (fallbackMaterialRecords.length > 0) {
                snapshotMaterialRecords = snapshotMaterialRecords.concat(fallbackMaterialRecords);
            }
        }
        const snapshotMaterialRecordHasRenderableData = (record) => {
            if (!record || typeof record !== 'object') {
                return false;
            }
            return [
                'color',
                'emissive',
                'specularColor',
                'mapPath',
                'emissiveMapPath',
                'roughnessMapPath',
                'metalnessMapPath',
                'normalMapPath',
                'aoMapPath',
                'alphaMapPath',
            ].some((key) => hasMaterialRecordValue(record[key]));
        };
        snapshotMaterialRecords = snapshotMaterialRecords.map((record) => {
            const materialId = normalizeHydraPath(record?.materialId || record?.id || '');
            if (!materialId) {
                return record;
            }
            if (snapshotMaterialRecordHasRenderableData(record)) {
                return record;
            }
            const fallbackStageMaterial = this.createFallbackMaterialFromStage(materialId);
            const fallbackRecord = serializePreferredMaterialRecord(fallbackStageMaterial?._material || null);
            if (!fallbackRecord) {
                return record;
            }
            return mergeSnapshotMaterialRecordWithFallback(record, {
                materialId,
                ...fallbackRecord,
            });
        });
        const normalizedMaterials = this.ingestSnapshotMaterialRecords(snapshotMaterialRecords, {
            stageSourcePath: resolvedStageSourcePath,
            force: forceRefresh,
        });
        const normalizeRobotMetadataSnapshotCandidate = (snapshot) => {
            if (!snapshot || typeof snapshot !== 'object') {
                return null;
            }
            const errorFlags = toPlainArray(snapshot.errorFlags)
                .map((entry) => String(entry || '').trim())
                .filter((entry) => entry.length > 0);
            const truthLoadError = String(snapshot.truthLoadError || '').trim() || null;
            const stale = snapshot.stale === true || errorFlags.length > 0 || !!truthLoadError;
            return {
                stageSourcePath: String(snapshot.stageSourcePath || resolvedStageSourcePath || '').trim() || null,
                generatedAtMs: Number(snapshot.generatedAtMs || rawSnapshot.generatedAtMs || Date.now()),
                source: String(snapshot.source || robotMetadataSummary.source || 'robot-scene-snapshot'),
                linkParentPairs: toPlainArray(snapshot.linkParentPairs),
                jointCatalogEntries: toPlainArray(snapshot.jointCatalogEntries),
                linkDynamicsEntries: toPlainArray(snapshot.linkDynamicsEntries),
                meshCountsByLinkPath: toPlainObject(snapshot.meshCountsByLinkPath),
                ...(stale ? { stale: true } : {}),
                ...(errorFlags.length > 0 ? { errorFlags } : {}),
                ...(truthLoadError ? { truthLoadError } : {}),
            };
        };
        const getRobotMetadataSnapshotScore = (snapshot) => {
            if (!snapshot || typeof snapshot !== 'object') {
                return -1;
            }
            return Number(snapshot.linkParentPairs?.length || 0)
                + Number(snapshot.jointCatalogEntries?.length || 0)
                + Number(snapshot.linkDynamicsEntries?.length || 0);
        };
        const rawRobotMetadataSnapshot = normalizeRobotMetadataSnapshotCandidate({
            stageSourcePath: resolvedStageSourcePath || null,
            generatedAtMs: Number(robotMetadataRaw.generatedAtMs || rawSnapshot.generatedAtMs || Date.now()),
            source: String(robotMetadataRaw.source || robotMetadataSummary.source || 'robot-scene-snapshot'),
            linkParentPairs: toPlainArray(robotMetadataRaw.linkParentPairs),
            jointCatalogEntries: toPlainArray(robotMetadataRaw.jointCatalogEntries),
            linkDynamicsEntries: toPlainArray(robotMetadataRaw.linkDynamicsEntries),
            meshCountsByLinkPath: toPlainObject(robotMetadataRaw.meshCountsByLinkPath),
            stale: robotMetadataRaw.stale === true,
            errorFlags: toPlainArray(robotMetadataRaw.errorFlags),
            truthLoadError: robotMetadataRaw.truthLoadError,
        });
        const cachedRobotMetadataSnapshot = normalizeRobotMetadataSnapshotCandidate(
            this.getCachedRobotMetadataSnapshot(resolvedStageSourcePath),
        );
        let stageRobotMetadataSnapshot = null;
        const rawMetadataHasCompleteDriverData = rawRobotMetadataSnapshot
            && rawRobotMetadataSnapshot.stale !== true
            && (Number(rawRobotMetadataSnapshot.jointCatalogEntries?.length || 0) > 0
                || Number(rawRobotMetadataSnapshot.linkDynamicsEntries?.length || 0) > 0);
        if (!rawMetadataHasCompleteDriverData && typeof this.buildRobotMetadataSnapshotForStage === 'function') {
            try {
                stageRobotMetadataSnapshot = normalizeRobotMetadataSnapshotCandidate(
                    this.buildRobotMetadataSnapshotForStage(resolvedStageSourcePath, null),
                );
            }
            catch {
                stageRobotMetadataSnapshot = null;
            }
        }
        const normalizedRobotMetadataSnapshot = [
            cachedRobotMetadataSnapshot,
            stageRobotMetadataSnapshot,
            rawRobotMetadataSnapshot,
        ].reduce((bestSnapshot, candidateSnapshot) => {
            if (!candidateSnapshot) {
                return bestSnapshot;
            }
            if (!bestSnapshot) {
                return candidateSnapshot;
            }

            const bestScore = getRobotMetadataSnapshotScore(bestSnapshot);
            const candidateScore = getRobotMetadataSnapshotScore(candidateSnapshot);
            if (candidateScore > bestScore) {
                return candidateSnapshot;
            }

            if (candidateScore === bestScore
                && String(candidateSnapshot.source || '').includes('usd-stage')
                && !String(bestSnapshot.source || '').includes('usd-stage')) {
                return candidateSnapshot;
            }

            return bestSnapshot;
        }, rawRobotMetadataSnapshot);
        if (resolvedStageSourcePath && normalizedRobotMetadataSnapshot) {
            this._robotMetadataSnapshotByStageSource?.set?.(resolvedStageSourcePath, normalizedRobotMetadataSnapshot);
        }
        const normalizedStage = {
            stageSourcePath: resolvedStageSourcePath || null,
            rootLayerIdentifier: rawStage.rootLayerIdentifier || null,
            defaultPrimPath: rawStage.defaultPrimPath || null,
            upAxis: rawStage.upAxis || null,
            startTimeCode: Number(rawStage.startTimeCode || 0),
            endTimeCode: Number(rawStage.endTimeCode || 0),
            timeCodesPerSecond: Number(rawStage.timeCodesPerSecond || 0),
            framesPerSecond: Number(rawStage.framesPerSecond || 0),
            metersPerUnit: Number(rawStage.metersPerUnit || 0),
        };

        // Extract authoredXformOps and layerInfo for USD-free rendering
        const authoredXformOpsByPrimPath = {};
        const layerInfo = {
            rootLayerPath: null,
            usedLayerPaths: [],
            layerTextByPath: {}
        };

        const stage = this.getStage?.();
        if (stage && typeof stage.GetPrimAtPath === 'function') {
            // Extract xformOp info for all mesh descriptors
            const processedPrimPaths = new Set();
            for (const descriptor of normalizedMeshDescriptors) {
                const primPath = descriptor.resolvedPrimPath || descriptor.primPath;
                if (!primPath || processedPrimPaths.has(primPath)) continue;
                processedPrimPaths.add(primPath);

                try {
                    const prim = stage.GetPrimAtPath(primPath);
                    if (!prim || typeof prim.GetAttribute !== 'function') continue;

                    // Get xformOpOrder
                    let xformOrder = [];
                    const xformOpOrderAttr = prim.GetAttribute('xformOpOrder');
                    if (xformOpOrderAttr) {
                        try {
                            xformOrder = xformOpOrderAttr.Get() || [];
                            if (!Array.isArray(xformOrder) && xformOrder && typeof xformOrder[Symbol.iterator] === 'function') {
                                xformOrder = Array.from(xformOrder);
                            }
                        } catch {}
                    }

                    // Check for authored ops
                    const normalizedOrder = Array.isArray(xformOrder)
                        ? xformOrder.map((entry) => normalizeHydraPath(entry)).filter(Boolean)
                        : [];
                    const hasAuthoredOps = normalizedOrder.some((entry) =>
                        entry === '!resetXformStack!' || entry.startsWith('xformOp:')
                    );
                    const resetsXformStack = normalizedOrder.some((entry) =>
                        normalizeHydraPath(entry) === '!resetXformStack!'
                    );

                    authoredXformOpsByPrimPath[primPath] = {
                        hasAuthoredOps,
                        resetsXformStack,
                        xformOpOrder: normalizedOrder.length > 0 ? normalizedOrder : undefined
                    };
                } catch {}
            }

            // Extract layer info
            try {
                if (typeof stage.GetRootLayer === 'function') {
                    const rootLayer = stage.GetRootLayer();
                    if (rootLayer && typeof rootLayer.GetIdentifier === 'function') {
                        layerInfo.rootLayerPath = rootLayer.GetIdentifier() || null;
                    }
                }
                if (typeof stage.GetUsedLayers === 'function') {
                    const usedLayers = stage.GetUsedLayers(false);
                    if (Array.isArray(usedLayers) || (usedLayers && typeof usedLayers[Symbol.iterator] === 'function')) {
                        const layers = Array.isArray(usedLayers) ? usedLayers : Array.from(usedLayers);
                        layerInfo.usedLayerPaths = layers
                            .filter((layer) => layer && typeof layer.GetIdentifier === 'function')
                            .map((layer) => layer.GetIdentifier() || '')
                            .filter(Boolean);
                    }
                }
            } catch {}
        }

        const preferredVisualMaterialsByLinkPath = {};
        const visualLinkPaths = new Set();
        for (const descriptor of normalizedMeshDescriptors) {
            if (normalizeDescriptorSectionName(descriptor?.sectionName) !== 'visuals') {
                continue;
            }
            const linkPath = getDescriptorLinkPath(descriptor);
            if (linkPath) {
                visualLinkPaths.add(linkPath);
            }
        }
        for (const linkPath of Array.from(visualLinkPaths).sort()) {
            const preferredMaterial = this.getPreferredVisualMaterialForLink(linkPath);
            const preferredRecord = serializePreferredMaterialRecord(preferredMaterial);
            if (preferredRecord) {
                preferredVisualMaterialsByLinkPath[linkPath] = preferredRecord;
            }
        }
        return {
            generatedAtMs: Number(rawSnapshot.generatedAtMs || Date.now()),
            source: 'robot-scene-snapshot',
            nativeSnapshotSource: String(rawSnapshot.snapshotSource || '').trim() || null,
            transportFormat: String(options?.transportFormat || '').trim() || null,
            fullLoadPayload: options?.fullLoadPayload === true,
            nativeProfile: rawSnapshot.nativeProfile && typeof rawSnapshot.nativeProfile === 'object'
                ? rawSnapshot.nativeProfile
                : null,
            driverInitProfile: rawSnapshot.driverInitProfile && typeof rawSnapshot.driverInitProfile === 'object'
                ? rawSnapshot.driverInitProfile
                : null,
            stageSourcePath: resolvedStageSourcePath || null,
            stage: normalizedStage,
            robotTree: {
                linkParentPairs: Array.isArray(normalizedRobotMetadataSnapshot.linkParentPairs)
                    ? normalizedRobotMetadataSnapshot.linkParentPairs
                    : [],
                jointCatalogEntries: Array.isArray(normalizedRobotMetadataSnapshot.jointCatalogEntries)
                    ? normalizedRobotMetadataSnapshot.jointCatalogEntries
                    : [],
                rootLinkPaths: toPlainArray(rawSnapshot.robotTree?.rootLinkPaths),
            },
            physics: {
                linkDynamicsEntries: Array.isArray(normalizedRobotMetadataSnapshot.linkDynamicsEntries)
                    ? normalizedRobotMetadataSnapshot.linkDynamicsEntries
                    : [],
            },
            render: {
                primPathCount: Number(primPathSummary.count || this._knownPrimPathSet?.size || 0),
                primTransformCount: Number(transformSummary.total || 0),
                protoBlobCount: Number(protoBlobSummary.count || 0),
                finalStageOverrideCount: Number(finalOverrideSummary.count || 0),
                collisionOverrideCount: Number(finalOverrideSummary.collisionCount || 0),
                visualOverrideCount: Number(finalOverrideSummary.visualCount || 0),
                primOverrideCount: Number(finalOverrideSummary.primOverrideCount || 0),
                materialCount: Number(normalizedMaterials?.length || 0),
                meshDescriptors: normalizedMeshDescriptors,
                materials: normalizedMaterials,
                ...(Object.keys(preferredVisualMaterialsByLinkPath).length > 0
                    ? { preferredVisualMaterialsByLinkPath }
                    : {}),
            },
            buffers: {
                positions: positionPool,
                indices: indexPool,
                normals: normalPool,
                uvs: uvPool,
                transforms: transformPool,
                rangesByMeshId: bufferRangesByMeshId,
            },
            robotMetadataSnapshot: normalizedRobotMetadataSnapshot,
            authoredXformOpsByPrimPath: Object.keys(authoredXformOpsByPrimPath).length > 0
                ? authoredXformOpsByPrimPath
                : null,
            layerInfo: (layerInfo.rootLayerPath || layerInfo.usedLayerPaths.length > 0)
                ? layerInfo
                : null,
        };
    }
    warmupRobotSceneSnapshotFromDriver(driver, options = {}) {
        const forceRefresh = options?.force === true;
        const resolvedDriver = driver || this.config?.driver?.();
        const nowMs = () => {
            try {
                if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
                    return performance.now();
                }
            }
            catch { }
            return Date.now();
        };
        const warmupStartedAtMs = nowMs();
        const summary = {
            source: 'none',
            used: false,
            sceneSnapshotReady: false,
            primPathCount: 0,
            transformTotalCount: 0,
            protoBlobCount: 0,
            collisionOverrideCount: 0,
            visualOverrideCount: 0,
            primOverrideCount: 0,
            robotMetadataJointCount: 0,
            robotMetadataDynamicsCount: 0,
            meshDescriptorCount: 0,
            fullLoadPayloadUsed: false,
            driverSnapshotSource: 'none',
            hydratedProtoMeshAttemptedCount: 0,
            hydratedProtoMeshPendingCount: 0,
            driverStageResolveStatus: 'idle',
            driverStageResolveSource: 'none',
            driverStageResolveError: null,
            driverStageResolvePending: false,
            snapshotFetchMs: 0,
            snapshotNormalizeMs: 0,
            snapshotHydrateMs: 0,
            snapshotMaterialApplyMs: 0,
            snapshotEmitMs: 0,
            totalMs: 0,
        };
        const finalizeSummary = () => {
            const driverStageResolveSummary = this.getDriverStageResolveSummary?.() || null;
            summary.driverStageResolveStatus = String(driverStageResolveSummary?.status || 'idle');
            summary.driverStageResolveSource = String(driverStageResolveSummary?.source || 'none');
            summary.driverStageResolveError = String(driverStageResolveSummary?.error || '').trim() || null;
            summary.driverStageResolvePending = driverStageResolveSummary?.pending === true;
            summary.totalMs = nowMs() - warmupStartedAtMs;
            this._lastRobotSceneWarmupSummary = { ...summary };
            return summary;
        };
        if (!resolvedDriver)
            return finalizeSummary();
        const stageSourcePath = String(options?.stageSourcePath || this.getStageSourcePath() || '').trim().split('?')[0];
        const snapshotFetchStartedAtMs = nowMs();
        const snapshotResult = this.getRobotSceneSnapshotFromDriver(resolvedDriver, {
            stageSourcePath,
        });
        summary.snapshotFetchMs = nowMs() - snapshotFetchStartedAtMs;
        summary.driverSnapshotSource = String(snapshotResult?.source || 'none');
        const rawSnapshot = snapshotResult?.rawSnapshot || null;
        if (!rawSnapshot || typeof rawSnapshot !== 'object') {
            summary.source = String(summary.driverSnapshotSource || 'empty');
            return finalizeSummary();
        }
        const normalizeSnapshot = (summary.driverSnapshotSource === 'robot-scene-snapshot-blob'
            || summary.driverSnapshotSource === 'full-load-payload')
            && typeof this.normalizeRobotSceneSnapshotBlob === 'function'
            ? this.normalizeRobotSceneSnapshotBlob
            : this.normalizeRobotSceneSnapshot;
        const snapshotNormalizeStartedAtMs = nowMs();
        const normalizedSnapshot = normalizeSnapshot.call(this, rawSnapshot, {
            force: forceRefresh,
            stageSourcePath,
            emitRobotMetadataEvent: options?.emitRobotMetadataEvent === true,
        });
        summary.snapshotNormalizeMs = nowMs() - snapshotNormalizeStartedAtMs;
        if (!normalizedSnapshot) {
            summary.source = 'normalize-failed';
            return finalizeSummary();
        }
        const cacheKey = String(normalizedSnapshot.stageSourcePath || stageSourcePath || '').trim().split('?')[0];
        if (cacheKey) {
            this._runtimeBridgeCacheStageKey = cacheKey;
            this._robotSceneSnapshotByStageSource.set(cacheKey, normalizedSnapshot);
            if (normalizedSnapshot.fullLoadPayload === true || summary.driverSnapshotSource === 'full-load-payload') {
                this._fullLoadPayloadReadyByStageSource?.add?.(cacheKey);
            }
        }
        const snapshotHydrateStartedAtMs = nowMs();
        const hydrateSummary = this.hydratePendingProtoMeshes({ allowDeferredFinalBatch: false });
        summary.snapshotHydrateMs = nowMs() - snapshotHydrateStartedAtMs;
        const snapshotMaterialApplyStartedAtMs = nowMs();
        const materialApplySummary = this.applySnapshotMaterialsToMeshes();
        summary.snapshotMaterialApplyMs = nowMs() - snapshotMaterialApplyStartedAtMs;
        const snapshotEmitStartedAtMs = nowMs();
        this.emitRobotSceneSnapshotReady(normalizedSnapshot);
        summary.snapshotEmitMs = nowMs() - snapshotEmitStartedAtMs;
        summary.source = 'scene-snapshot';
        summary.used = true;
        summary.sceneSnapshotReady = true;
        summary.primPathCount = Number(normalizedSnapshot.render?.primPathCount || 0);
        summary.transformTotalCount = Number(normalizedSnapshot.render?.primTransformCount || 0);
        summary.protoBlobCount = Number(normalizedSnapshot.render?.protoBlobCount || 0);
        summary.collisionOverrideCount = Number(normalizedSnapshot.render?.collisionOverrideCount || 0);
        summary.visualOverrideCount = Number(normalizedSnapshot.render?.visualOverrideCount || 0);
        summary.primOverrideCount = Number(normalizedSnapshot.render?.primOverrideCount || 0);
        summary.robotMetadataJointCount = Number(normalizedSnapshot.robotMetadataSnapshot?.jointCatalogEntries?.length || 0);
        summary.robotMetadataDynamicsCount = Number(normalizedSnapshot.robotMetadataSnapshot?.linkDynamicsEntries?.length || 0);
        summary.meshDescriptorCount = Number(normalizedSnapshot.render?.meshDescriptors?.length || 0);
        summary.fullLoadPayloadUsed = normalizedSnapshot.fullLoadPayload === true
            || summary.driverSnapshotSource === 'full-load-payload';
        summary.nativeSnapshotSource = String(normalizedSnapshot.nativeSnapshotSource || 'none');
        summary.hydratedProtoMeshAttemptedCount = Number(hydrateSummary?.attemptedCount || 0);
        summary.hydratedProtoMeshCount = Number(hydrateSummary?.completedCount || 0);
        summary.hydratedProtoMeshPendingCount = Number(hydrateSummary?.pendingCount || 0);
        summary.snapshotMaterialBindCount = Number(materialApplySummary?.boundCount || 0);
        summary.snapshotMaterialInheritCount = Number(materialApplySummary?.inheritedCount || 0);
        summary.snapshotMaterialSubsetFailureCount = Number(materialApplySummary?.subsetFailureCount || 0);
        summary.snapshotMaterialInheritFailureCount = Number(materialApplySummary?.inheritFailureCount || 0);
        summary.snapshotTextureFailureCount = Number(materialApplySummary?.textureFailureCount || 0);
        return finalizeSummary();
    }
    getLastRobotSceneWarmupSummary() {
        return this._lastRobotSceneWarmupSummary
            ? { ...this._lastRobotSceneWarmupSummary }
            : null;
    }
    getRobotSceneSnapshotFromDriver(driver, options = {}) {
        const resolvedDriver = driver || this.config?.driver?.();
        const stageSourcePath = String(options?.stageSourcePath || this.getStageSourcePath() || '').trim().split('?')[0];
        const runtimeLinkPaths = Array.isArray(options?.runtimeLinkPaths)
            ? options.runtimeLinkPaths
            : [];
        const supportsFullLoadPayload = typeof resolvedDriver?.GetFullLoadPayload === 'function';
        if (supportsFullLoadPayload) {
            try {
                if (this._driverFallbackCallCounts) {
                    this._driverFallbackCallCounts.fullLoadPayload = Number(this._driverFallbackCallCounts.fullLoadPayload || 0) + 1;
                }
                const rawSnapshot = resolvedDriver.GetFullLoadPayload(runtimeLinkPaths, stageSourcePath, {
                    completeBeforeReady: true,
                    includePackedBuffers: true,
                });
                if (rawSnapshot && typeof rawSnapshot === 'object') {
                    return {
                        source: 'full-load-payload',
                        rawSnapshot,
                        stageSourcePath,
                        runtimeLinkPaths,
                    };
                }
            }
            catch { }
        }
        const supportsRobotSceneSnapshotBlob = typeof resolvedDriver?.GetRobotSceneSnapshotBlob === 'function';
        if (supportsRobotSceneSnapshotBlob) {
            try {
                if (this._driverFallbackCallCounts) {
                    this._driverFallbackCallCounts.robotSceneSnapshotBlob = Number(this._driverFallbackCallCounts.robotSceneSnapshotBlob || 0) + 1;
                }
                const rawSnapshot = resolvedDriver.GetRobotSceneSnapshotBlob(runtimeLinkPaths, stageSourcePath);
                if (rawSnapshot && typeof rawSnapshot === 'object') {
                    return {
                        source: 'robot-scene-snapshot-blob',
                        rawSnapshot,
                        stageSourcePath,
                        runtimeLinkPaths,
                    };
                }
            }
            catch { }
        }
        const supportsRobotSceneSnapshot = typeof resolvedDriver?.GetRobotSceneSnapshot === 'function';
        if (supportsRobotSceneSnapshot) {
            try {
                if (this._driverFallbackCallCounts) {
                    this._driverFallbackCallCounts.robotSceneSnapshot = Number(this._driverFallbackCallCounts.robotSceneSnapshot || 0) + 1;
                }
                const rawSnapshot = resolvedDriver.GetRobotSceneSnapshot(runtimeLinkPaths, stageSourcePath);
                if (rawSnapshot && typeof rawSnapshot === 'object') {
                    return {
                        source: 'robot-scene-snapshot',
                        rawSnapshot,
                        stageSourcePath,
                        runtimeLinkPaths,
                    };
                }
            }
            catch { }
        }
        return {
            source: supportsFullLoadPayload || supportsRobotSceneSnapshotBlob || supportsRobotSceneSnapshot
                ? 'empty-robot-scene-snapshot'
                : 'unsupported',
            rawSnapshot: null,
            stageSourcePath,
            runtimeLinkPaths,
        };
    }
    hydratePendingProtoMeshes(options = {}) {
        const summary = {
            totalProtoMeshCount: 0,
            attemptedCount: 0,
            completedCount: 0,
            pendingCount: 0,
        };
        for (const hydraMesh of Object.values(this.meshes || {})) {
            if (!hydraMesh || typeof hydraMesh !== 'object')
                continue;
            if (!String(hydraMesh._id || '').includes('.proto_'))
                continue;
            summary.totalProtoMeshCount += 1;
            if (hydraMesh._hasCompletedProtoSync === true)
                continue;
            summary.attemptedCount += 1;
            try {
                hydraMesh.applyProtoStageSync?.({
                    allowDeferredFinalBatch: options?.allowDeferredFinalBatch === true,
                });
                hydraMesh.sanitizeNormalsIfNeeded?.();
                if (hydraMesh._hasCompletedProtoSync === true) {
                    summary.completedCount += 1;
                }
                else {
                    summary.pendingCount += 1;
                }
            }
            catch {
                summary.pendingCount += 1;
                // Keep one-shot warmup resilient even if a single proto mesh fails.
            }
        }
        return summary;
    }
    hydratePendingResolvedPrimMeshes(options = {}) {
        const summary = {
            totalMeshCount: 0,
            attemptedCount: 0,
            completedCount: 0,
            pendingCount: 0,
            prefetchedPrimOverrideCount: 0,
        };
        const pendingMeshIds = [];
        for (const hydraMesh of Object.values(this.meshes || {})) {
            if (!hydraMesh || typeof hydraMesh !== 'object')
                continue;
            const meshId = normalizeHydraPath(hydraMesh._id || '');
            if (!meshId || !meshId.startsWith('/'))
                continue;
            if (meshId.includes('.proto_'))
                continue;
            const geometry = hydraMesh?._mesh?.geometry || hydraMesh?._geometry || null;
            const positionCount = Number(geometry?.getAttribute?.('position')?.count || 0);
            if (positionCount > 0)
                continue;
            summary.totalMeshCount += 1;
            pendingMeshIds.push(meshId);
        }
        if (pendingMeshIds.length <= 0) {
            return summary;
        }
        const driver = options?.driver || this.config?.driver?.();
        const prefetchSummary = this.prefetchPrimOverrideDataFromDriver(driver, pendingMeshIds, {
            force: options?.force === true,
        });
        summary.prefetchedPrimOverrideCount = Number(prefetchSummary?.count || 0);
        for (const meshId of pendingMeshIds) {
            const hydraMesh = this.meshes?.[meshId];
            if (!hydraMesh || typeof hydraMesh !== 'object')
                continue;
            summary.attemptedCount += 1;
            try {
                hydraMesh.applyResolvedPrimGeometryAndTransform?.(meshId);
                hydraMesh.sanitizeNormalsIfNeeded?.();
            }
            catch {
                summary.pendingCount += 1;
                continue;
            }
            const geometry = hydraMesh?._mesh?.geometry || hydraMesh?._geometry || null;
            const positionCount = Number(geometry?.getAttribute?.('position')?.count || 0);
            if (positionCount > 0) {
                summary.completedCount += 1;
            }
            else {
                summary.pendingCount += 1;
            }
        }
        return summary;
    }
    ingestRobotMetadataSnapshotFromBootstrapPayload(rawSnapshot, options = {}) {
        if (!rawSnapshot || typeof rawSnapshot !== 'object') {
            return {
                source: "none",
                ready: false,
                jointCount: 0,
                dynamicsCount: 0,
            };
        }
        const toPlainArray = (value) => (Array.isArray(value)
            ? value.slice()
            : (value && typeof value.length === 'number' ? Array.from(value) : []));
        const toPlainObject = (value) => {
            if (!value || typeof value !== 'object')
                return {};
            return Object.fromEntries(Object.entries(value));
        };
        const toErrorFlags = (value) => toPlainArray(value)
            .map((entry) => String(entry || '').trim())
            .filter((entry) => entry.length > 0);
        const toErrorText = (value) => {
            const normalized = String(value || '').trim();
            return normalized || null;
        };
        const resolvedStageSourcePath = String(options?.stageSourcePath
            || rawSnapshot.stageSourcePath
            || this.getStageSourcePath()
            || '').trim().split('?')[0];
        const generatedAtMs = Number(rawSnapshot.generatedAtMs);
        const errorFlags = toErrorFlags(rawSnapshot.errorFlags);
        const truthLoadError = toErrorText(rawSnapshot.truthLoadError);
        const stale = rawSnapshot.stale === true || errorFlags.length > 0 || !!truthLoadError;
        const normalizedSnapshot = {
            stageSourcePath: resolvedStageSourcePath || null,
            generatedAtMs: Number.isFinite(generatedAtMs) ? generatedAtMs : Date.now(),
            source: String(rawSnapshot.source || 'usd-stage-cpp') || 'usd-stage-cpp',
            linkParentPairs: toPlainArray(rawSnapshot.linkParentPairs),
            jointCatalogEntries: toPlainArray(rawSnapshot.jointCatalogEntries),
            linkDynamicsEntries: toPlainArray(rawSnapshot.linkDynamicsEntries),
            meshCountsByLinkPath: toPlainObject(rawSnapshot.meshCountsByLinkPath),
            ...(stale ? { stale: true } : {}),
            ...(errorFlags.length > 0 ? { errorFlags } : {}),
            ...(truthLoadError ? { truthLoadError } : {}),
        };
        const jointCount = normalizedSnapshot.jointCatalogEntries.length;
        const dynamicsCount = normalizedSnapshot.linkDynamicsEntries.length;
        const hasMetadata = jointCount > 0 || dynamicsCount > 0;
        if (!normalizedSnapshot.stageSourcePath) {
            return {
                source: "empty",
                ready: hasMetadata,
                jointCount,
                dynamicsCount,
            };
        }
        if (!hasMetadata && options?.allowEmptySnapshot !== true) {
            // Driver-init bootstrap can run before runtime link paths are fully
            // discovered. Avoid caching empty metadata snapshots, otherwise later
            // warmup calls may incorrectly treat metadata as already ready.
            return {
                source: "empty",
                ready: false,
                jointCount,
                dynamicsCount,
            };
        }
        this._robotMetadataSnapshotByStageSource.set(normalizedSnapshot.stageSourcePath, normalizedSnapshot);
        if (options?.emitEvent === true && typeof this.emitRobotMetadataSnapshotReady === 'function') {
            try {
                this.emitRobotMetadataSnapshotReady(normalizedSnapshot);
            }
            catch { }
        }
        return {
            source: "bootstrap",
            ready: hasMetadata,
            jointCount,
            dynamicsCount,
        };
    }
    getProtoDataBlob(protoPath, options = {}) {
        if (!protoPath || !protoPath.startsWith('/'))
            return null;
        if (!this.config?.driver || typeof this.config.driver !== 'function')
            return null;
        const forceRefresh = options?.forceRefresh === true || options?.force === true;
        const strictOneShotSceneLoad = this.strictOneShotSceneLoad === true;
        const hasSceneSnapshot = this.hasResolvedRobotSceneSnapshot();
        const driver = this.config.driver();
        if (!driver || typeof driver.GetProtoDataBlob !== 'function')
            return null;
        // Hot path: prefer cache hit or single-proto fetch. Avoid forcing
        // GetAllProtoDataBlobs() here, which can create large first-sync stalls.
        const cached = this._protoDataBlobBatchCache.get(protoPath);
        if (cached && (!forceRefresh || strictOneShotSceneLoad))
            return cached;
        if (!forceRefresh && this._protoDataBlobMissCache?.has?.(protoPath))
            return null;
        if (strictOneShotSceneLoad)
            return cached || null;
        if (hasSceneSnapshot)
            return null;
        if (!forceRefresh && this.autoBatchProtoBlobsOnFirstAccess === true && this._protoDataBlobBatchPrimed !== true) {
            try {
                this.prefetchProtoDataBlobsFromDriver(driver, { force: false });
                const batchCached = this._protoDataBlobBatchCache.get(protoPath);
                if (batchCached)
                    return batchCached;
            }
            catch {
                // Fall through to per-proto fallback.
            }
        }
        try {
            if (this._driverFallbackCallCounts) {
                this._driverFallbackCallCounts.protoDataBlob = Number(this._driverFallbackCallCounts.protoDataBlob || 0) + 1;
            }
            const blob = driver.GetProtoDataBlob(protoPath);
            const normalizedBlob = this.normalizeProtoDataBlob(blob);
            if (!normalizedBlob) {
                if (forceRefresh) {
                    this._protoDataBlobBatchCache.delete(protoPath);
                    this._protoDataBlobMissCache?.delete?.(protoPath);
                }
                else {
                    this._protoDataBlobMissCache?.add?.(protoPath);
                }
                return null;
            }
            this._protoDataBlobBatchCache.set(protoPath, normalizedBlob);
            this._protoDataBlobMissCache?.delete?.(protoPath);
            return normalizedBlob;
        }
        catch {
            if (!forceRefresh) {
                this._protoDataBlobMissCache?.add?.(protoPath);
            }
            return null;
        }
    }
    getCollisionProtoOverride(meshId) {
        if (!meshId || !meshId.includes('.proto_'))
            return null;
        if (!this.config?.driver || typeof this.config.driver !== 'function')
            return null;
        if (this._collisionProtoOverrideCache.has(meshId)) {
            const cached = this._collisionProtoOverrideCache.get(meshId);
            return cached || null;
        }
        if (this._collisionProtoOverrideMissCache?.has?.(meshId))
            return null;
        if (this.strictOneShotSceneLoad === true)
            return null;
        const hasSceneSnapshot = this.hasResolvedRobotSceneSnapshot();
        const driver = this.config.driver();
        if (!driver)
            return null;
        if (hasSceneSnapshot)
            return null;
        if (this.autoBatchCollisionProtoOverridesOnFirstAccess === true && this._collisionProtoOverrideBatchPrimed !== true) {
            try {
                this.prefetchProtoMeshOverridesFromDriver(driver, { force: false });
                const batchCached = this._collisionProtoOverrideCache.get(meshId);
                if (batchCached)
                    return batchCached;
            }
            catch {
                try {
                    this.prefetchCollisionProtoOverridesFromDriver(driver, { force: false });
                    const batchCached = this._collisionProtoOverrideCache.get(meshId);
                    if (batchCached)
                        return batchCached;
                }
                catch {
                    // Fall through to per-mesh fetch.
                }
            }
        }
        if (typeof driver.GetCollisionProtoOverride !== 'function')
            return null;
        try {
            if (this._driverFallbackCallCounts) {
                this._driverFallbackCallCounts.collisionProtoOverride = Number(this._driverFallbackCallCounts.collisionProtoOverride || 0) + 1;
            }
            const rawOverride = driver.GetCollisionProtoOverride(meshId);
            const normalizedOverride = this.normalizeCollisionProtoOverride(rawOverride);
            if (!normalizedOverride) {
                this._collisionProtoOverrideMissCache?.add?.(meshId);
                return null;
            }
            this._collisionProtoOverrideCache.set(meshId, normalizedOverride);
            this._collisionProtoOverrideMissCache?.delete?.(meshId);
            this.cacheResolvedWorldTransformFromOverride(normalizedOverride);
            return normalizedOverride;
        }
        catch {
            this._collisionProtoOverrideMissCache?.add?.(meshId);
            return null;
        }
    }
    getVisualProtoOverride(meshId) {
        if (!meshId || !meshId.includes('.proto_'))
            return null;
        if (!this.config?.driver || typeof this.config.driver !== 'function')
            return null;
        if (this._visualProtoOverrideCache.has(meshId)) {
            const cached = this._visualProtoOverrideCache.get(meshId);
            return cached || null;
        }
        if (this._visualProtoOverrideMissCache?.has?.(meshId))
            return null;
        if (this.strictOneShotSceneLoad === true)
            return null;
        const hasSceneSnapshot = this.hasResolvedRobotSceneSnapshot();
        const driver = this.config.driver();
        if (!driver)
            return null;
        if (hasSceneSnapshot)
            return null;
        if (this.autoBatchVisualProtoOverridesOnFirstAccess === true && this._visualProtoOverrideBatchPrimed !== true) {
            try {
                this.prefetchProtoMeshOverridesFromDriver(driver, { force: false });
                const batchCached = this._visualProtoOverrideCache.get(meshId);
                if (batchCached)
                    return batchCached;
            }
            catch {
                try {
                    this.prefetchVisualProtoOverridesFromDriver(driver, { force: false });
                    const batchCached = this._visualProtoOverrideCache.get(meshId);
                    if (batchCached)
                        return batchCached;
                }
                catch {
                    // Fall through to per-mesh fetch.
                }
            }
        }
        if (typeof driver.GetVisualProtoOverride !== 'function')
            return null;
        try {
            if (this._driverFallbackCallCounts) {
                this._driverFallbackCallCounts.visualProtoOverride = Number(this._driverFallbackCallCounts.visualProtoOverride || 0) + 1;
            }
            const rawOverride = driver.GetVisualProtoOverride(meshId);
            const normalizedOverride = this.normalizeVisualProtoOverride(rawOverride);
            if (!normalizedOverride) {
                this._visualProtoOverrideMissCache?.add?.(meshId);
                return null;
            }
            this._visualProtoOverrideCache.set(meshId, normalizedOverride);
            this._visualProtoOverrideMissCache?.delete?.(meshId);
            this.cacheResolvedWorldTransformFromOverride(normalizedOverride);
            return normalizedOverride;
        }
        catch {
            this._visualProtoOverrideMissCache?.add?.(meshId);
            return null;
        }
    }
    getPrimOverrideData(primPath) {
        const normalizedPath = normalizeHydraPath(primPath);
        if (!normalizedPath || !normalizedPath.startsWith('/'))
            return null;
        if (!this.config?.driver || typeof this.config.driver !== 'function')
            return null;
        if (this._primOverrideDataCache.has(normalizedPath)) {
            const cached = this._primOverrideDataCache.get(normalizedPath);
            return cached || null;
        }
        if (this._primOverrideDataMissCache?.has?.(normalizedPath))
            return null;
        if (this.strictOneShotSceneLoad === true)
            return null;
        const driver = this.config.driver();
        if (!driver || typeof driver.GetPrimOverrideData !== 'function')
            return null;
        try {
            if (this._driverFallbackCallCounts) {
                this._driverFallbackCallCounts.primOverrideData = Number(this._driverFallbackCallCounts.primOverrideData || 0) + 1;
            }
            const rawData = driver.GetPrimOverrideData(normalizedPath);
            const normalizedData = this.normalizePrimOverrideData(rawData);
            if (!normalizedData) {
                this._primOverrideDataMissCache?.add?.(normalizedPath);
                return null;
            }
            this._primOverrideDataCache.set(normalizedPath, normalizedData);
            this._primOverrideDataMissCache?.delete?.(normalizedPath);
            return normalizedData;
        }
        catch {
            this._primOverrideDataMissCache?.add?.(normalizedPath);
            return null;
        }
    }
    prefetchPrimTransformsFromDriver(driver, options = {}) {
        const forceRefresh = options?.force === true;
        if (!driver || typeof driver.GetPrimTransforms !== 'function') {
            return { world: 0, local: 0, total: 0, source: "none" };
        }
        if (this._primTransformBatchPrimed === true && !forceRefresh) {
            const world = Number(this._worldXformCache?.size || 0);
            const local = Number(this._localXformCache?.size || 0);
            const primPathCount = Number(this._knownPrimPathSet?.size || 0);
            return { world, local, total: Math.max(world, local, primPathCount), source: "cache" };
        }
        this._primTransformBatchPrimed = true;
        let payload = null;
        try {
            payload = driver.GetPrimTransforms();
        }
        catch {
            return { world: 0, local: 0, total: 0, source: "error" };
        }
        if (!payload || typeof payload !== 'object') {
            return { world: 0, local: 0, total: 0, source: "empty" };
        }
        const clearTransformCaches = () => {
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
            this._meshFallbackCache.clear();
            this._linkVisualTransformCache.clear();
            this._urdfLinkWorldTransformCacheByStageSource.clear();
        };
        const syncKnownPrimPathCache = (nextPathSet) => {
            this._knownPrimPathSet = nextPathSet;
            this._knownPrimPathSetPrimed = true;
            for (const cachedPath of Array.from(this._primPathExistenceCache.keys())) {
                if (!nextPathSet.has(cachedPath)) {
                    this._primPathExistenceCache.delete(cachedPath);
                }
            }
            for (const knownPath of nextPathSet) {
                if (!this._primPathExistenceCache.has(knownPath))
                    continue;
                if (this._primPathExistenceCache.get(knownPath) === false) {
                    this._primPathExistenceCache.set(knownPath, true);
                }
            }
        };
        const packedFormat = String(payload?.format || '').trim().toLowerCase();
        if (packedFormat !== 'packed-v1') {
            return { world: 0, local: 0, total: 0, source: 'unsupported-format' };
        }
        const rawPaths = payload.paths;
        const worldValues = payload.world;
        const localValues = payload.local;
        const strideRaw = Number(payload.stride);
        const stride = Number.isFinite(strideRaw) && strideRaw >= 16 ? Math.floor(strideRaw) : 16;
        const pathLength = Number(rawPaths?.length);
        const safePathLength = Number.isFinite(pathLength) && pathLength >= 0 ? Math.floor(pathLength) : 0;
        if (!(worldValues instanceof Float32Array) || !(localValues instanceof Float32Array) || safePathLength <= 0) {
            return { world: 0, local: 0, total: 0, source: 'malformed-packed' };
        }
        clearTransformCaches();
        const nextPathSet = new Set();
        let world = 0;
        let local = 0;
        for (let index = 0; index < safePathLength; index += 1) {
            const primPath = normalizeHydraPath(rawPaths[index]);
            if (!primPath || !primPath.startsWith('/'))
                continue;
            nextPathSet.add(primPath);
            const worldOffset = index * stride;
            if (worldOffset + 16 <= worldValues.length) {
                const matrix = this.matrixFromWasmTransform(worldValues.subarray(worldOffset, worldOffset + 16));
                if (matrix) {
                    this._worldXformCache.set(primPath, matrix);
                    if (this._worldXformCacheSourceByPath instanceof Map) {
                        this._worldXformCacheSourceByPath.set(primPath, 'driver');
                    }
                    world += 1;
                }
            }
            const localOffset = index * stride;
            if (localOffset + 16 <= localValues.length) {
                const matrix = this.matrixFromWasmTransform(localValues.subarray(localOffset, localOffset + 16));
                if (matrix) {
                    this._localXformCache.set(primPath, matrix);
                    local += 1;
                }
            }
        }
        syncKnownPrimPathCache(nextPathSet);
        const collisionContainerRegex = /\/collisions\/mesh_\d+$/i;
        const collisionPrimitiveLeafNames = ['mesh', 'collision_mesh', 'visual_mesh', 'cube', 'sphere', 'cylinder', 'capsule'];
        for (const containerPath of Array.from(this._worldXformCache.keys())) {
            if (!collisionContainerRegex.test(containerPath))
                continue;
            for (const primitiveLeafName of collisionPrimitiveLeafNames) {
                const primitivePath = `${containerPath}/${primitiveLeafName}`;
                const primitiveWorld = this._worldXformCache.get(primitivePath);
                if (!primitiveWorld)
                    continue;
                this._worldXformCache.set(containerPath, primitiveWorld.clone());
                if (this._worldXformCacheSourceByPath instanceof Map) {
                    this._worldXformCacheSourceByPath.set(containerPath, 'driver');
                }
                break;
            }
        }
        const total = Number(payload.count);
        return {
            world,
            local,
            total: Number.isFinite(total) && total > 0 ? total : Math.max(world, local, nextPathSet.size),
            source: forceRefresh ? 'packed-refresh' : 'packed',
        };
    }
    getWorldTransformForPrimPath(primPath, options = {}) {
        if (!this || typeof this !== 'object')
            return null;
        if (!primPath || !primPath.startsWith('/'))
            return null;
        const shouldClone = options?.clone !== false;
        const hasSceneSnapshot = this.hasResolvedRobotSceneSnapshot();
        if (!hasSceneSnapshot && this.strictOneShotSceneLoad !== true && this.autoBatchPrimTransformsOnFirstAccess === true && this._primTransformBatchPrimed !== true) {
            const driver = this.config?.driver?.();
            if (driver) {
                try {
                    this.prefetchPrimTransformsFromDriver(driver, { force: false });
                }
                catch {
                    // Keep fallback path resilient.
                }
            }
        }
        const cachedWorld = this._worldXformCache.has(primPath)
            ? (this._worldXformCache.get(primPath) || null)
            : null;
        const cachedWorldSource = (this._worldXformCacheSourceByPath instanceof Map)
            ? String(this._worldXformCacheSourceByPath.get(primPath) || '')
            : '';
        const cachedWorldFromDriver = cachedWorld && cachedWorldSource === 'driver';
        if (cachedWorld && !cachedWorldFromDriver) {
            return shouldClone ? cachedWorld.clone() : cachedWorld;
        }
        if (this.strictOneShotSceneLoad === true && !hasSceneSnapshot) {
            if (!cachedWorld)
                return null;
            return shouldClone ? cachedWorld.clone() : cachedWorld;
        }
        const stage = hasSceneSnapshot ? null : this.getStage();
        if (!stage && !hasSceneSnapshot) {
            if (!cachedWorld)
                return null;
            return shouldClone ? cachedWorld.clone() : cachedWorld;
        }
        const pathSegments = primPath.split('/').filter(Boolean);
        const worldMatrix = new Matrix4().identity();
        let currentPath = '';
        let hasTransform = false;
        for (const pathSegment of pathSegments) {
            currentPath += '/' + pathSegment;
            const localMatrix = this.getLocalTransformForPrimPath(stage, currentPath, {
                clone: false,
                allowStageFallback: !hasSceneSnapshot,
            });
            if (!localMatrix)
                continue;
            const resetsXformStack = this.getLocalTransformResetsXformStack(stage, currentPath, {
                allowStageFallback: !hasSceneSnapshot,
            });
            if (resetsXformStack) {
                worldMatrix.copy(localMatrix);
            }
            else {
                worldMatrix.multiply(localMatrix);
            }
            hasTransform = true;
        }
        // For prims with no explicit transform, keep identity so parent chain still
        // resolves deterministically.
        const recomposedWorld = hasTransform ? worldMatrix : new Matrix4().identity();
        const leafHasAuthoredLocalOps = this.hasAuthoredLocalXformOpsForPrimPath(stage, primPath);
        // Driver-batched world transforms can be inconsistent with local xform-chain
        // composition on some stages. Prefer recomposed results for authored prims,
        // but keep driver values for leaves with no authored xform ops (e.g. some
        // instance-proxy meshes whose extra transform lives in prototype data).
        let resolvedWorld = recomposedWorld;
        if (cachedWorld && cachedWorldFromDriver) {
            const maxDelta = getMatrixMaxElementDelta(cachedWorld, recomposedWorld);
            if (Number.isFinite(maxDelta) && maxDelta <= transformEpsilon) {
                resolvedWorld = cachedWorld;
            }
            else if (leafHasAuthoredLocalOps !== true) {
                resolvedWorld = cachedWorld;
            }
        }
        const cachedResult = resolvedWorld.clone();
        this._worldXformCache.set(primPath, cachedResult);
        if (this._worldXformCacheSourceByPath instanceof Map) {
            this._worldXformCacheSourceByPath.set(primPath, 'computed');
        }
        return shouldClone ? cachedResult.clone() : cachedResult;
    }
    hasAuthoredLocalXformOpsForPrimPath(stage, primPath) {
        if (!primPath || !primPath.startsWith('/'))
            return false;
        if (this._localXformAuthoredOpsCache instanceof Map && this._localXformAuthoredOpsCache.has(primPath)) {
            return this._localXformAuthoredOpsCache.get(primPath) === true;
        }

        // First try to get data from snapshot (USD-free path)
        const snapshot = this.getCachedRobotSceneSnapshot?.();
        if (snapshot?.authoredXformOpsByPrimPath) {
            const normalizedPath = normalizeHydraPath(primPath);
            const xformInfo = snapshot.authoredXformOpsByPrimPath[normalizedPath];
            if (xformInfo && typeof xformInfo.hasAuthoredOps === 'boolean') {
                this._localXformAuthoredOpsCache.set(primPath, xformInfo.hasAuthoredOps);
                return xformInfo.hasAuthoredOps;
            }
        }

        // Fallback to USD stage if snapshot doesn't have the data
        if (!stage || typeof stage.GetPrimAtPath !== 'function') {
            if (this._localXformAuthoredOpsCache instanceof Map) {
                this._localXformAuthoredOpsCache.set(primPath, false);
            }
            return false;
        }
        let hasAuthoredOps = false;
        try {
            const prim = stage.GetPrimAtPath(primPath);
            if (!prim || typeof prim.GetAttribute !== 'function') {
                hasAuthoredOps = false;
            }
            else {
                let xformOrder = [];
                const xformOpOrderAttr = prim.GetAttribute('xformOpOrder');
                if (xformOpOrderAttr) {
                    try {
                        xformOrder = xformOpOrderAttr.Get() || [];
                    }
                    catch {
                        xformOrder = [];
                    }
                }
                if (!Array.isArray(xformOrder) && xformOrder && typeof xformOrder[Symbol.iterator] === 'function') {
                    xformOrder = Array.from(xformOrder);
                }
                if (Array.isArray(xformOrder)) {
                    const normalizedOrder = xformOrder
                        .map((entry) => normalizeHydraPath(entry))
                        .filter((entry) => !!entry);
                    hasAuthoredOps = normalizedOrder.some((entry) => entry === '!resetXformStack!' || entry.startsWith('xformOp:'));
                }
                if (!hasAuthoredOps) {
                    let propertyNames = [];
                    try {
                        propertyNames = prim.GetPropertyNames?.() || [];
                    }
                    catch {
                        propertyNames = [];
                    }
                    propertyNames = Array.isArray(propertyNames) ? propertyNames : Array.from(propertyNames || []);
                    hasAuthoredOps = propertyNames
                        .map((name) => normalizeHydraPath(name))
                        .some((name) => !!name && name.startsWith('xformOp:') && name !== 'xformOpOrder');
                }
                if (!hasAuthoredOps && this.enableXformOpFallbackFromLayerText === true) {
                    const fallbackOpNames = this.getFallbackXformOpNamesForPrimPath(primPath);
                    hasAuthoredOps = Array.isArray(fallbackOpNames) && fallbackOpNames.length > 0;
                }
            }
        }
        catch {
            hasAuthoredOps = false;
        }
        if (this._localXformAuthoredOpsCache instanceof Map) {
            this._localXformAuthoredOpsCache.set(primPath, hasAuthoredOps === true);
        }
        return hasAuthoredOps === true;
    }
    getLocalTransformResetsXformStack(stage, primPath, options = {}) {
        if (this._localXformResetsStackCache instanceof Map && this._localXformResetsStackCache.has(primPath)) {
            return this._localXformResetsStackCache.get(primPath) === true;
        }

        // First try to get data from snapshot (USD-free path)
        const snapshot = this.getCachedRobotSceneSnapshot?.();
        if (snapshot?.authoredXformOpsByPrimPath) {
            const normalizedPath = normalizeHydraPath(primPath);
            const xformInfo = snapshot.authoredXformOpsByPrimPath[normalizedPath];
            if (xformInfo && typeof xformInfo.resetsXformStack === 'boolean') {
                this._localXformResetsStackCache.set(primPath, xformInfo.resetsXformStack);
                return xformInfo.resetsXformStack;
            }
        }

        // Fallback to USD stage if snapshot doesn't have the data
        const allowStageFallback = options?.allowStageFallback !== false;
        if (!allowStageFallback || !stage || typeof stage.GetPrimAtPath !== 'function') {
            if (this._localXformResetsStackCache instanceof Map) {
                this._localXformResetsStackCache.set(primPath, false);
            }
            return false;
        }
        let resetsXformStack = false;
        try {
            const prim = stage.GetPrimAtPath(primPath);
            const xformOpOrderAttr = prim?.GetAttribute?.('xformOpOrder');
            if (xformOpOrderAttr) {
                let xformOrder = [];
                try {
                    xformOrder = xformOpOrderAttr.Get() || [];
                }
                catch {
                    xformOrder = [];
                }
                if (!Array.isArray(xformOrder) && xformOrder && typeof xformOrder[Symbol.iterator] === 'function') {
                    xformOrder = Array.from(xformOrder);
                }
                if (Array.isArray(xformOrder)) {
                    resetsXformStack = xformOrder.some((entry) => normalizeHydraPath(entry) === '!resetXformStack!');
                }
            }
        }
        catch {
            resetsXformStack = false;
        }
        if (this._localXformResetsStackCache instanceof Map) {
            this._localXformResetsStackCache.set(primPath, resetsXformStack);
        }
        return resetsXformStack;
    }
    getLocalTransformForPrimPath(stage, primPath, options = {}) {
        if (!this || typeof this !== 'object')
            return null;
        const shouldClone = options?.clone !== false;
        const allowStageFallback = options?.allowStageFallback !== false;
        if (this._localXformCache.has(primPath)) {
            const cached = this._localXformCache.get(primPath);
            if (!cached)
                return null;
            return shouldClone ? cached.clone() : cached;
        }
        if (!allowStageFallback || !stage || typeof stage.GetPrimAtPath !== 'function') {
            return null;
        }
        let prim = null;
        try {
            prim = stage.GetPrimAtPath(primPath);
        }
        catch {
            this._localXformCache.set(primPath, null);
            if (this._localXformResetsStackCache instanceof Map) {
                this._localXformResetsStackCache.set(primPath, false);
            }
            return null;
        }
        if (!prim) {
            this._localXformCache.set(primPath, null);
            if (this._localXformResetsStackCache instanceof Map) {
                this._localXformResetsStackCache.set(primPath, false);
            }
            return null;
        }
        if (typeof prim.GetAttribute !== 'function') {
            this._localXformCache.set(primPath, null);
            if (this._localXformResetsStackCache instanceof Map) {
                this._localXformResetsStackCache.set(primPath, false);
            }
            return null;
        }
        const allowLayerTextXformFallback = this.enableXformOpFallbackFromLayerText === true;
        let xformOrder = [];
        const xformOpOrderAttr = prim.GetAttribute('xformOpOrder');
        if (xformOpOrderAttr) {
            try {
                xformOrder = xformOpOrderAttr.Get() || [];
            }
            catch {
            }
        }
        if (!Array.isArray(xformOrder) && xformOrder && typeof xformOrder[Symbol.iterator] === 'function') {
            xformOrder = Array.from(xformOrder);
        }
        if (Array.isArray(xformOrder)) {
            xformOrder = xformOrder
                .map((entry) => normalizeHydraPath(entry))
                .filter((entry) => !!entry);
        }
        if (!Array.isArray(xformOrder) || xformOrder.length === 0) {
            let fallbackOps = [];
            try {
                fallbackOps = prim.GetPropertyNames?.() || [];
            }
            catch {
                fallbackOps = [];
            }
            fallbackOps = Array.isArray(fallbackOps) ? fallbackOps : Array.from(fallbackOps || []);
            fallbackOps = fallbackOps
                .map((name) => normalizeHydraPath(name))
                .filter((name) => !!name && name.startsWith('xformOp:') && name !== 'xformOpOrder');
            xformOrder = fallbackOps;
        }
        if (xformOrder.length === 0 && allowLayerTextXformFallback) {
            const fallbackOpNames = this.getFallbackXformOpNamesForPrimPath(primPath);
            if (Array.isArray(fallbackOpNames) && fallbackOpNames.length > 0) {
                xformOrder = fallbackOpNames
                    .map((entry) => normalizeHydraPath(entry))
                    .filter((entry) => !!entry && entry.startsWith('xformOp:'));
            }
        }
        if (xformOrder.length === 0) {
            // Return identity matrix for prims with no explicit transform (like primitive geometry nodes)
            // This allows parent transforms to be properly applied through the hierarchy
            const identityMatrix = new Matrix4().identity();
            this._localXformCache.set(primPath, identityMatrix);
            if (this._localXformResetsStackCache instanceof Map) {
                this._localXformResetsStackCache.set(primPath, false);
            }
            return shouldClone ? identityMatrix.clone() : identityMatrix;
        }
        const localMatrix = new Matrix4().identity();
        let hasTransform = false;
        let resetsXformStack = false;
        const invertPrefix = '!invert!';
        for (const rawOpName of xformOrder) {
            const opToken = normalizeHydraPath(rawOpName);
            if (!opToken)
                continue;
            if (opToken === '!resetXformStack!') {
                localMatrix.identity();
                resetsXformStack = true;
                hasTransform = true;
                continue;
            }
            let opName = opToken;
            let invert = false;
            if (opName.startsWith(invertPrefix)) {
                invert = true;
                opName = opName.substring(invertPrefix.length);
            }
            let opValue = undefined;
            let opReadError = null;
            try {
                opValue = prim.GetAttribute(opName)?.Get();
            }
            catch (error) {
                opReadError = error;
                opValue = allowLayerTextXformFallback
                    ? this.getFallbackXformOpValueForPrimPath(primPath, opName)
                    : undefined;
            }
            if (opValue === undefined || opValue === null) {
                const errorText = String(opReadError || '');
                const isQuatReadFailure = (opName.startsWith('xformOp:orient')
                    && errorText.includes('BindingError')
                    && errorText.includes('GfQuat'));
                if (isQuatReadFailure) {
                    // Quat reads can fail in WASM bindings for some prims. Try fast root-layer
                    // fallback first, then URDF collision fallback, and escalate to full layer
                    // scan only when necessary.
                    if (typeof this.getRootLayerFallbackXformOpValueForPrimPath === 'function') {
                        opValue = this.getRootLayerFallbackXformOpValueForPrimPath(primPath, opName);
                    }
                    if ((opValue === undefined || opValue === null) && typeof this.getUrdfFallbackXformOpValueForPrimPath === 'function') {
                        opValue = this.getUrdfFallbackXformOpValueForPrimPath(primPath, opName);
                    }
                    if (opValue === undefined || opValue === null) {
                        opValue = this.getFallbackXformOpValueForPrimPath(primPath, opName);
                    }
                }
            }
            if ((opValue === undefined || opValue === null) && allowLayerTextXformFallback) {
                opValue = this.getFallbackXformOpValueForPrimPath(primPath, opName);
            }
            if (opValue === undefined || opValue === null)
                continue;
            const opMatrix = createMatrixFromXformOp(opName, opValue);
            if (!opMatrix)
                continue;
            if (invert)
                opMatrix.invert();
            localMatrix.multiply(opMatrix);
            hasTransform = true;
        }
        const result = hasTransform ? localMatrix : null;
        const cachedResult = result ? result.clone() : null;
        this._localXformCache.set(primPath, cachedResult);
        if (this._localXformResetsStackCache instanceof Map) {
            this._localXformResetsStackCache.set(primPath, resetsXformStack === true);
        }
        if (!cachedResult)
            return null;
        return shouldClone ? cachedResult.clone() : cachedResult;
    }
    /**
     * Render Prims. See webRenderDelegate.h and webRenderDelegate.cpp
     * @param {string} typeId // translated from TfToken
     * @param {string} id // SdfPath.GetAsString()
     * @param {*} instancerId
     * @returns
     */
    createNoopRPrim() {
        const noop = () => { };
        return new Proxy({}, {
            get() {
                return noop;
            },
        });
    }
    createRPrim(typeId, id, instancerId) {
        const normalizedId = normalizeHydraPath(id);
        const normalizedInstancerId = normalizeHydraPath(instancerId);
        if (!normalizedInstancerId && this.shouldSuppressSyntheticTopLevelMesh?.(normalizedId) === true) {
            return this.createNoopRPrim();
        }
        const loweredId = String(normalizedId || '').toLowerCase();
        const isCollisionPrim = COLLISION_SEGMENT_PATTERN.test(loweredId);
        if (this.loadVisualPrims === false && !isCollisionPrim) {
            return this.createNoopRPrim();
        }
        if (!isCollisionPrim && Number.isFinite(this.maxVisualPrims) && this.maxVisualPrims >= 0) {
            if ((this.loadedVisualPrimCount || 0) >= this.maxVisualPrims) {
                return this.createNoopRPrim();
            }
            this.loadedVisualPrimCount = (this.loadedVisualPrimCount || 0) + 1;
        }
        if (this.loadCollisionPrims === false && !normalizedInstancerId) {
            if (isCollisionPrim) {
                return this.createNoopRPrim();
            }
        }
        let mesh = new HydraMesh(typeId, normalizedId, this, normalizedInstancerId);
        if (normalizedInstancerId) {
            // This is a prototype for an instancer. Hide it by default.
            // The instancer will manage the display of instances.
            mesh._mesh.visible = false;
            mesh.isPrototype = true;
        }
        this.meshes[normalizedId] = mesh;
        this._meshMutationVersion = Number(this._meshMutationVersion || 0) + 1;
        this._stageOverrideProtoMeshCache = null;
        this.registerMeshLinkPathIndex(normalizedId);
        this.updateRepresentativeVisualTransformIndex(normalizedId, mesh?._mesh?.matrix);
        return wrapHydraCallbackObject(mesh, "RPrim");
    }
    createBPrim(typeId, id) {
        /*let mesh = new HydraMesh(id, this);
        this.meshes[id] = mesh;
        return mesh;*/
    }
    createInstancer(typeId, id) {
        const normalizedId = normalizeHydraPath(id);
        let instancer = new HydraInstancer(normalizedId, this);
        this.instancers[normalizedId] = instancer;
        return wrapHydraCallbackObject(instancer, "Instancer");
    }
    createSPrim(typeId, id) {
        const normalizedId = normalizeHydraPath(id);
        if (typeId === 'material') {
            if (this.loadVisualPrims === false) {
                return undefined;
            }
            let material = new HydraMaterial(normalizedId, this);
            this.materials[normalizedId] = material;
            return wrapHydraCallbackObject(material, "SPrimMaterial");
        }
        else if (typeId === 'skeleton') {
            let skeleton = new HydraSkeleton(normalizedId, this);
            this.skeletons[normalizedId] = skeleton;
            return wrapHydraCallbackObject(skeleton, "SPrimSkeleton");
        }
        else {
            return undefined;
        }
    }
    CommitResources() {
        const phaseInstrumentationEnabled = this.isHydraPhaseInstrumentationEnabled?.() === true;
        const commitStartedAtMs = phaseInstrumentationEnabled ? this._nowPerfMs?.() : 0;
        const activeDrawSeq = Number(this._hydraPhasePerfState?.activeDraw?.seq || this._hydraPhasePerfState?.drawSeq || 0);
        const commitStartMark = phaseInstrumentationEnabled
            ? `hydra.phase.commit.${activeDrawSeq}.start`
            : '';
        const commitProfile = phaseInstrumentationEnabled
            ? {
                meshCount: 0,
                meshTotalMs: 0,
                pendingMaterialMs: 0,
                primitiveFallbackMs: 0,
                normalFallbackMs: 0,
                visualColorMs: 0,
                inheritMaterialMs: 0,
                protoSyncMs: 0,
            }
            : null;
        if (phaseInstrumentationEnabled && commitStartMark) {
            this._markPerf?.(commitStartMark);
        }
        const hasSyncHotPathGuard = typeof this.enterHydraSyncHotPath === 'function'
            && typeof this.leaveHydraSyncHotPath === 'function';
        const resolvedDriver = typeof this.config?.driver === 'function'
            ? this.config.driver()
            : null;
        const shouldPrimeFinalStageOverrides = (this.preferFinalStageOverrideBatchInProtoSync === true
            && !this.hasResolvedRobotSceneSnapshot()
            && !!resolvedDriver
            && typeof this.prefetchFinalStageOverrideBatchFromDriver === 'function'
            && (this.autoBatchCollisionProtoOverridesOnFirstAccess === true
                || this.autoBatchVisualProtoOverridesOnFirstAccess === true)
            && this._finalStageOverrideBatchPrimed !== true
            && Object.keys(this.meshes || {}).some((meshId) => String(meshId).includes('.proto_')));
        if (shouldPrimeFinalStageOverrides) {
            try {
                this.prefetchFinalStageOverrideBatchFromDriver(resolvedDriver, { force: false });
            }
            catch { }
        }
        const deltaBatchSummary = this.pullRprimDeltaBatchFromDriver?.(resolvedDriver) || null;
        const shouldUseDirtyMeshCommit = deltaBatchSummary?.ok === true;
        const dirtyMeshIds = shouldUseDirtyMeshCommit
            ? new Set(deltaBatchSummary?.meshIds || [])
            : null;
        if (dirtyMeshIds) {
            for (const [meshId, hydraMesh] of Object.entries(this.meshes || {})) {
                if (!hydraMesh)
                    continue;
                if (hydraMesh?._pendingMaterialId) {
                    dirtyMeshIds.add(meshId);
                    continue;
                }
                if (meshId.includes(".proto_") && hydraMesh?._hasCompletedProtoSync !== true) {
                    dirtyMeshIds.add(meshId);
                }
            }
        }
        if (hasSyncHotPathGuard) {
            this.enterHydraSyncHotPath();
        }
        try {
            if (dirtyMeshIds) {
                for (const meshId of dirtyMeshIds) {
                    const hydraMesh = this.meshes[meshId];
                    if (!hydraMesh)
                        continue;
                    hydraMesh.commit(commitProfile);
                }
            }
            else {
                for (const id in this.meshes) {
                    const hydraMesh = this.meshes[id];
                    hydraMesh.commit(commitProfile);
                }
            }
            for (const id in this.instancers) {
                const instancer = this.instancers[id];
                instancer.commit();
            }
        }
        finally {
            if (hasSyncHotPathGuard) {
                this.leaveHydraSyncHotPath();
            }
        }
        if (phaseInstrumentationEnabled) {
            const commitEndedAtMs = this._nowPerfMs?.() || commitStartedAtMs;
            const commitMs = Math.max(0, Number(commitEndedAtMs) - Number(commitStartedAtMs || commitEndedAtMs));
            const commitEndMark = `hydra.phase.commit.${activeDrawSeq}.end`;
            this._markPerf?.(commitEndMark);
            this._measurePerf?.(`hydra.phase.commit.${activeDrawSeq}`, commitStartMark, commitEndMark);
            this.recordHydraCommitPhase?.(commitMs);
            void commitMs;
        }
    }
}
