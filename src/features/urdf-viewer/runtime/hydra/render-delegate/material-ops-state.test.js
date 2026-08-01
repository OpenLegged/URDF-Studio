import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Color, MeshPhysicalMaterial, SRGBColorSpace, Texture } from 'three';

import { ThreeRenderDelegateMaterialOps } from './ThreeRenderDelegateMaterialOps.js';
import { ThreeRenderDelegateInterface } from './ThreeRenderDelegateInterface.js';

const {
    applySnapshotMaterialsToMeshes,
    applySnapshotMaterialRecord,
    normalizeSnapshotMaterialRecords,
    resolveSnapshotMaterialEmissionEnabled,
    applySnapshotTextureInput,
    getSnapshotTextureApplyFailureSummary,
    recordSnapshotTextureApplyFailure,
    clearSnapshotTextureApplyFailure,
    getStage,
    setDriverStageResolveState,
    getDriverStageResolveSummary,
} = ThreeRenderDelegateMaterialOps.prototype;
const {
    applyStageFallbackMaterialParameters,
    warmupRobotSceneSnapshotFromDriver,
    getLastRobotSceneWarmupSummary,
    getProtoDataBlob,
    prefetchPrimOverrideDataFromDriver,
} = ThreeRenderDelegateInterface.prototype;

const materialOpsPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    './ThreeRenderDelegateMaterialOps.js',
);

function createMaterialOpsContext({
    materials = {},
    meshes = {},
} = {}) {
    return {
        meshes,
        materials,
        _preferredVisualMaterialByLinkCache: new Map(),
        registry: {
            getTexture() {
                return Promise.reject(new Error('missing-texture'));
            },
        },
        normalizeMaterialTexturePath(value) {
            return typeof value === 'string' ? value.trim() || null : null;
        },
        getSnapshotTextureApplyFailureSummary,
        recordSnapshotTextureApplyFailure,
        clearSnapshotTextureApplyFailure,
    };
}

function createShaderPrim(attributes) {
    return {
        GetAttribute(name) {
            if (!attributes.has(name)) {
                return null;
            }
            return {
                Get() {
                    return attributes.get(name);
                },
            };
        },
    };
}

function createStageFallbackContext() {
    const delegate = Object.create(ThreeRenderDelegateInterface.prototype);
    delegate.registry = {
        getTexture() {
            return Promise.reject(new Error('missing-texture'));
        },
    };
    delegate.config = {};
    return delegate;
}

function createStageFallbackTextureContext() {
    const delegate = createStageFallbackContext();
    delegate.registry = {
        getTexture(texturePath) {
            const texture = new Texture();
            texture.name = texturePath;
            return Promise.resolve(texture);
        },
    };
    return delegate;
}

test('applySnapshotMaterialsToMeshes records subset and inherit failures instead of swallowing them', () => {
    const meshId = '/robot/base_link/visuals.proto_mesh_id0';
    const hydraMesh = {
        _id: meshId,
        _pendingMaterialId: null,
        _pendingGeomSubsetSections: null,
        _mesh: { material: null },
        tryApplyPendingGeomSubsetMaterials() {
            throw new Error('subset-apply-failed');
        },
        tryInheritVisualMaterialFromLink() {
            throw new Error('inherit-material-failed');
        },
    };
    const context = createMaterialOpsContext({
        meshes: {
            [meshId]: hydraMesh,
        },
    });

    const summary = applySnapshotMaterialsToMeshes.call(context);

    assert.equal(summary.subsetFailureCount, 1);
    assert.equal(summary.inheritFailureCount, 1);
    assert.deepEqual(summary.subsetFailureMeshIds, [meshId]);
    assert.deepEqual(summary.inheritFailureMeshIds, [meshId]);
});

test('applySnapshotMaterialsToMeshes logs subset and inherit failures to console', async () => {
    const source = await readFile(materialOpsPath, 'utf8');

    assert.match(source, /Failed to apply pending geometry subset materials/);
    assert.match(source, /Failed to inherit visual material from link/);
});

test('applySnapshotTextureInput records explicit texture apply failures', async () => {
    const material = new MeshPhysicalMaterial({ name: 'test-material' });
    const context = createMaterialOpsContext();

    assert.equal(
        applySnapshotTextureInput.call(context, material, '/textures/missing.png', 'map'),
        true,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    const summary = getSnapshotTextureApplyFailureSummary.call(context);

    assert.equal(summary.count, 1);
    assert.deepEqual(summary.failures, [
        {
            materialName: 'test-material',
            materialProperty: 'map',
            texturePath: '/textures/missing.png',
            error: 'missing-texture',
        },
    ]);
    assert.equal(material.userData.snapshotTextureApplyFailed, true);
    assert.deepEqual(material.userData.snapshotTextureApplyFailures.map, {
        texturePath: '/textures/missing.png',
        error: 'missing-texture',
    });
});

test('applySnapshotTextureInput clears prior texture failure once assignment succeeds', async () => {
    const material = new MeshPhysicalMaterial({ name: 'recovering-material' });
    let shouldFail = true;
    const context = {
        ...createMaterialOpsContext(),
        registry: {
            getTexture() {
                if (shouldFail) {
                    return Promise.reject(new Error('temporary-miss'));
                }
                return Promise.resolve({
                    clone() {
                        return {
                            needsUpdate: false,
                            colorSpace: null,
                        };
                    },
                });
            },
        },
    };

    assert.equal(
        applySnapshotTextureInput.call(context, material, '/textures/recover.png', 'map'),
        true,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(getSnapshotTextureApplyFailureSummary.call(context).count, 1);

    shouldFail = false;
    assert.equal(
        applySnapshotTextureInput.call(context, material, '/textures/recover.png', 'map'),
        true,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const summary = getSnapshotTextureApplyFailureSummary.call(context);
    assert.equal(summary.count, 0);
    assert.equal(material.userData.snapshotTextureApplyFailed, undefined);
    assert.equal(material.userData.snapshotTextureApplyFailures, undefined);
});

test('applyStageFallbackMaterialParameters ignores OmniPBR default white emission unless enabled', () => {
    const material = new MeshPhysicalMaterial({ color: 0x000000 });
    const context = createStageFallbackContext();
    const shaderPrim = createShaderPrim(
        new Map([
            ['info:id', 'OmniPBR'],
            ['inputs:diffuse_color_constant', [0, 0, 0]],
            ['inputs:emissive_color_constant', [1, 1, 1]],
        ]),
    );

    applyStageFallbackMaterialParameters.call(context, material, shaderPrim);

    assert.equal(material.color.getHexString(), '000000');
    assert.equal(material.emissive.getHexString(), '000000');
});

test('applyStageFallbackMaterialParameters trusts authored white over numeric material names', () => {
    const material = new MeshPhysicalMaterial({ color: 0x000000, name: 'material_100100100' });
    const context = createStageFallbackContext();
    const shaderPrim = createShaderPrim(
        new Map([
            ['info:mdl:sourceAsset:subIdentifier', 'OmniPBR'],
            ['inputs:diffuse_color_constant', [1, 1, 1]],
        ]),
    );

    applyStageFallbackMaterialParameters.call(context, material, shaderPrim);

    assert.equal(material.color.getHexString(), 'ffffff');
});

test('applyStageFallbackMaterialParameters resolves Isaac Sim texture aliases and packed ORM channels', async () => {
    const material = new MeshPhysicalMaterial();
    const context = createStageFallbackTextureContext();
    const shaderPrim = createShaderPrim(
        new Map([
            ['inputs:diffuse_texture', 'textures/base.png'],
            ['inputs:reflectionroughness_texture', 'textures/roughness.png'],
            ['inputs:emissive_mask_texture', 'textures/emissive.png'],
            ['inputs:detail_normalmap_texture', 'textures/detail-normal.png'],
            ['inputs:ORM_texture', 'textures/orm.png'],
        ]),
    );

    applyStageFallbackMaterialParameters.call(context, material, shaderPrim);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(material.map?.name, 'textures/base.png');
    assert.equal(material.roughnessMap?.name, 'textures/roughness.png');
    assert.equal(material.metalnessMap?.name, 'textures/orm.png');
    assert.equal(material.aoMap?.name, 'textures/orm.png');
    assert.equal(material.emissiveMap?.name, 'textures/emissive.png');
    assert.equal(material.normalMap?.name, 'textures/detail-normal.png');
});

test('applyStageFallbackMaterialParameters keeps dedicated maps ahead of enabled ORM fallback', async () => {
    const material = new MeshPhysicalMaterial();
    const context = createStageFallbackTextureContext();
    const shaderPrim = createShaderPrim(
        new Map([
            ['inputs:roughness_texture', 'textures/roughness.png'],
            ['inputs:metallic_texture', 'textures/metallic.png'],
            ['inputs:ao_texture', 'textures/ao.png'],
            ['inputs:ORM_texture', 'textures/orm.png'],
            ['inputs:enable_ORM_texture', true],
        ]),
    );

    applyStageFallbackMaterialParameters.call(context, material, shaderPrim);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(material.roughnessMap?.name, 'textures/roughness.png');
    assert.equal(material.metalnessMap?.name, 'textures/metallic.png');
    assert.equal(material.aoMap?.name, 'textures/ao.png');
});

test('applyStageFallbackMaterialParameters ignores disabled ORM texture input', async () => {
    const material = new MeshPhysicalMaterial();
    const context = createStageFallbackTextureContext();
    const shaderPrim = createShaderPrim(
        new Map([
            ['inputs:ORM_texture', 'textures/orm.png'],
            ['inputs:enable_ORM_texture', false],
        ]),
    );

    applyStageFallbackMaterialParameters.call(context, material, shaderPrim);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(material.roughnessMap, null);
    assert.equal(material.metalnessMap, null);
    assert.equal(material.aoMap, null);
});

test('applySnapshotMaterialRecord ignores OmniPBR default white emission unless enabled', () => {
    const material = new MeshPhysicalMaterial({ color: 0x000000, emissive: 0x000000 });
    const context = {
        ...createMaterialOpsContext(),
        inferColorHexFromMaterialName() {
            return null;
        },
        shouldTreatNamedHexDiffuseAsSrgb() {
            return false;
        },
        resolveSnapshotMaterialEmissionEnabled,
        applySnapshotTextureInput,
    };

    applySnapshotMaterialRecord.call(context, material, {
        isOmniPbr: true,
        color: [0, 0, 0],
        emissive: [1, 1, 1],
    });

    assert.equal(material.color.getHexString(), '000000');
    assert.equal(material.emissive.getHexString(), '000000');
});

test('applySnapshotMaterialRecord trusts snapshot white over numeric material names', () => {
    const material = new MeshPhysicalMaterial({
        color: 0x000000,
        emissive: 0x000000,
        name: 'material_100100100',
    });
    const context = {
        ...createMaterialOpsContext(),
        inferColorHexFromMaterialName: ThreeRenderDelegateInterface.prototype.inferColorHexFromMaterialName,
        shouldTreatNamedHexDiffuseAsSrgb() {
            return false;
        },
        resolveSnapshotMaterialEmissionEnabled,
        applySnapshotTextureInput,
    };

    applySnapshotMaterialRecord.call(context, material, {
        isOmniPbr: true,
        color: [1, 1, 1],
    });

    assert.equal(material.color.getHexString(), 'ffffff');
});

test('applySnapshotMaterialRecord respects snapshot diffuse color space metadata', () => {
    const material = new MeshPhysicalMaterial({
        color: 0x000000,
        emissive: 0x000000,
        name: 'authored_mid_gray',
    });
    const context = {
        ...createMaterialOpsContext(),
        inferColorHexFromMaterialName() {
            return null;
        },
        shouldTreatNamedHexDiffuseAsSrgb() {
            return false;
        },
        resolveSnapshotMaterialEmissionEnabled,
        applySnapshotTextureInput,
    };
    const expected = new Color().setRGB(0.5, 0.5, 0.5, SRGBColorSpace).getHexString();

    applySnapshotMaterialRecord.call(context, material, {
        color: [0.5, 0.5, 0.5],
        colorSpace: 'srgb',
    });

    assert.equal(material.color.getHexString(), expected);
});

test('normalizeSnapshotMaterialRecords treats authored USD scalar colors as linear', () => {
    const context = {
        ...createMaterialOpsContext(),
        getStageSourcePath() {
            return '/tmp/go2w.usd';
        },
        inferColorHexFromMaterialName: ThreeRenderDelegateInterface.prototype.inferColorHexFromMaterialName,
        resolveSnapshotMaterialEmissionEnabled,
    };

    const records = normalizeSnapshotMaterialRecords.call(context, [
        {
            materialId: '/go2w_description/Looks/material_______005',
            name: 'material_______005',
            color: [0.073235, 0.073235, 0.073235],
            colorSpace: 'srgb',
            colorSource: 'authored',
            isOmniPbr: true,
        },
    ]);

    assert.deepEqual(records[0].color, [0.073235, 0.073235, 0.073235]);
    assert.deepEqual(records[0].authoredColor, [0.073235, 0.073235, 0.073235]);
    assert.equal(records[0].colorSource, 'authored');
    assert.equal(records[0].colorSpace, 'linear');
    assert.equal(records[0].authoredColorSpace, 'linear');
});

test('normalizeSnapshotMaterialRecords uses numeric material-name color only without authored color', () => {
    const context = {
        ...createMaterialOpsContext(),
        getStageSourcePath() {
            return '/tmp/generic.usd';
        },
        inferColorHexFromMaterialName: ThreeRenderDelegateInterface.prototype.inferColorHexFromMaterialName,
        resolveSnapshotMaterialEmissionEnabled,
    };

    const records = normalizeSnapshotMaterialRecords.call(context, [
        {
            materialId: '/robot/Looks/material_100100100',
            name: 'material_100100100',
        },
    ]);

    assert.deepEqual(records[0].color, [100 / 255, 100 / 255, 100 / 255]);
    assert.equal(records[0].colorSource, 'material-name');
    assert.equal(records[0].authoredColor, null);
});

test('getStage records async driver stage resolution failures explicitly', async () => {
    const context = {
        _resolvedDriverStage: null,
        _pendingDriverStagePromise: null,
        _driverStageResolveState: 'idle',
        _driverStageResolveSource: 'none',
        _driverStageResolveError: null,
        _driverStageResolveUpdatedAtMs: null,
        config: {
            driver() {
                return {
                    GetStage() {
                        return Promise.reject(new Error('async-stage-failed'));
                    },
                };
            },
        },
        allowDriverStageLookup: true,
        deferDriverStageLookupInSyncHotPath: false,
        isHydraSyncHotPathActive() {
            return false;
        },
        setDriverStageResolveState,
        getDriverStageResolveSummary,
    };

    assert.equal(getStage.call(context), null);
    assert.equal(getDriverStageResolveSummary.call(context).status, 'pending');

    const pendingPromise = context._pendingDriverStagePromise;
    assert.ok(pendingPromise);
    await pendingPromise;

    const summary = getDriverStageResolveSummary.call(context);
    assert.equal(summary.status, 'rejected');
    assert.equal(summary.source, 'driver-async');
    assert.equal(summary.error, 'async-stage-failed');
    assert.equal(summary.pending, false);
});

test('warmupRobotSceneSnapshotFromDriver exposes driver stage diagnostics in the cached summary', () => {
    const context = {
        config: {},
        _runtimeBridgeCacheStageKey: null,
        _robotSceneSnapshotByStageSource: new Map(),
        _lastRobotSceneWarmupSummary: null,
        getStageSourcePath() {
            return '/robots/test.usd';
        },
        getRobotSceneSnapshotFromDriver() {
            return {
                source: 'robot-scene-snapshot',
                rawSnapshot: {},
            };
        },
        normalizeRobotSceneSnapshot() {
            return {
                stageSourcePath: '/robots/test.usd',
                render: {},
                robotMetadataSnapshot: {
                    jointCatalogEntries: [],
                    linkDynamicsEntries: [],
                },
            };
        },
        hydratePendingProtoMeshes() {
            return {
                attemptedCount: 1,
                completedCount: 1,
                pendingCount: 0,
            };
        },
        applySnapshotMaterialsToMeshes() {
            return {
                boundCount: 0,
                inheritedCount: 0,
                subsetFailureCount: 2,
                inheritFailureCount: 1,
                textureFailureCount: 3,
            };
        },
        emitRobotSceneSnapshotReady() { },
        getDriverStageResolveSummary() {
            return {
                status: 'rejected',
                source: 'driver-async',
                error: 'async-stage-failed',
                pending: false,
            };
        },
    };

    const summary = warmupRobotSceneSnapshotFromDriver.call(context, { GetRobotSceneSnapshot() { return {}; } });

    assert.equal(summary.driverStageResolveStatus, 'rejected');
    assert.equal(summary.driverStageResolveSource, 'driver-async');
    assert.equal(summary.driverStageResolveError, 'async-stage-failed');
    assert.equal(summary.snapshotMaterialSubsetFailureCount, 2);
    assert.equal(summary.snapshotMaterialInheritFailureCount, 1);
    assert.equal(summary.snapshotTextureFailureCount, 3);
    assert.deepEqual(getLastRobotSceneWarmupSummary.call(context), summary);
});

test('warmupRobotSceneSnapshotFromDriver prefers packed blob snapshot transport', () => {
    let usedBlobNormalizer = false;
    const context = {
        config: {},
        _runtimeBridgeCacheStageKey: null,
        _robotSceneSnapshotByStageSource: new Map(),
        _lastRobotSceneWarmupSummary: null,
        getStageSourcePath() {
            return '/robots/blob.usd';
        },
        getRobotSceneSnapshotFromDriver: ThreeRenderDelegateInterface.prototype.getRobotSceneSnapshotFromDriver,
        normalizeRobotSceneSnapshotBlob(rawSnapshot) {
            usedBlobNormalizer = rawSnapshot?.format === 'robot-scene-snapshot-blob-v1';
            return {
                stageSourcePath: '/robots/blob.usd',
                render: {},
                robotMetadataSnapshot: {
                    jointCatalogEntries: [{ jointName: 'j0' }],
                    linkDynamicsEntries: [],
                },
            };
        },
        hydratePendingProtoMeshes() {
            return {
                attemptedCount: 0,
                completedCount: 0,
                pendingCount: 0,
            };
        },
        applySnapshotMaterialsToMeshes() {
            return {
                boundCount: 0,
                inheritedCount: 0,
                subsetFailureCount: 0,
                inheritFailureCount: 0,
                textureFailureCount: 0,
            };
        },
        emitRobotSceneSnapshotReady() { },
        getDriverStageResolveSummary() {
            return {
                status: 'idle',
                source: 'none',
                error: null,
                pending: false,
            };
        },
    };

    const summary = warmupRobotSceneSnapshotFromDriver.call(context, {
        GetRobotSceneSnapshotBlob() {
            return {
                format: 'robot-scene-snapshot-blob-v1',
                snapshot: {},
            };
        },
        GetRobotSceneSnapshot() {
            throw new Error('legacy snapshot should not be used');
        },
    });

    assert.equal(summary.driverSnapshotSource, 'robot-scene-snapshot-blob');
    assert.equal(summary.robotMetadataJointCount, 1);
    assert.equal(usedBlobNormalizer, true);
});

test('warmupRobotSceneSnapshotFromDriver prefers the WASM full-load payload', () => {
    let usedFullPayloadNormalizer = false;
    let blobFallbackCalled = false;
    const context = {
        config: {},
        _runtimeBridgeCacheStageKey: null,
        _robotSceneSnapshotByStageSource: new Map(),
        _fullLoadPayloadReadyByStageSource: new Set(),
        _driverFallbackCallCounts: {},
        _lastRobotSceneWarmupSummary: null,
        getStageSourcePath() {
            return '/robots/full.usd';
        },
        getRobotSceneSnapshotFromDriver: ThreeRenderDelegateInterface.prototype.getRobotSceneSnapshotFromDriver,
        normalizeRobotSceneSnapshotBlob(rawSnapshot) {
            usedFullPayloadNormalizer = rawSnapshot?.format === 'usd-full-load-payload-v1';
            return {
                stageSourcePath: '/robots/full.usd',
                fullLoadPayload: true,
                render: {},
                robotMetadataSnapshot: {
                    jointCatalogEntries: [{ jointName: 'j0' }],
                    linkDynamicsEntries: [{ linkName: 'base' }],
                },
            };
        },
        hydratePendingProtoMeshes() {
            return {
                attemptedCount: 0,
                completedCount: 0,
                pendingCount: 0,
            };
        },
        applySnapshotMaterialsToMeshes() {
            return {
                boundCount: 0,
                inheritedCount: 0,
                subsetFailureCount: 0,
                inheritFailureCount: 0,
                textureFailureCount: 0,
            };
        },
        emitRobotSceneSnapshotReady() { },
        getDriverStageResolveSummary() {
            return {
                status: 'idle',
                source: 'none',
                error: null,
                pending: false,
            };
        },
    };

    const summary = warmupRobotSceneSnapshotFromDriver.call(context, {
        GetFullLoadPayload(_runtimeLinkPaths, _stageSourcePath, options) {
            assert.equal(options.completeBeforeReady, true);
            assert.equal(options.includePackedBuffers, true);
            return {
                format: 'usd-full-load-payload-v1',
                snapshot: {},
            };
        },
        GetRobotSceneSnapshotBlob() {
            blobFallbackCalled = true;
            return {
                format: 'robot-scene-snapshot-blob-v1',
                snapshot: {},
            };
        },
    });

    assert.equal(summary.driverSnapshotSource, 'full-load-payload');
    assert.equal(summary.fullLoadPayloadUsed, true);
    assert.equal(summary.robotMetadataJointCount, 1);
    assert.equal(summary.robotMetadataDynamicsCount, 1);
    assert.equal(usedFullPayloadNormalizer, true);
    assert.equal(blobFallbackCalled, false);
    assert.equal(context._driverFallbackCallCounts.fullLoadPayload, 1);
    assert.equal(context._fullLoadPayloadReadyByStageSource.has('/robots/full.usd'), true);
});

test('getProtoDataBlob records misses so missing proto paths do not repeatedly cross the driver bridge', () => {
    let singleFetchCount = 0;
    const context = {
        config: {
            driver() {
                return {
                    GetProtoDataBlob() {
                        singleFetchCount += 1;
                        return null;
                    },
                };
            },
        },
        strictOneShotSceneLoad: false,
        autoBatchProtoBlobsOnFirstAccess: false,
        _protoDataBlobBatchCache: new Map(),
        _protoDataBlobMissCache: new Set(),
        _driverFallbackCallCounts: {},
        hasResolvedRobotSceneSnapshot() {
            return false;
        },
        normalizeProtoDataBlob() {
            return null;
        },
    };

    const firstResult = getProtoDataBlob.call(context, '/Robot/base/visuals.proto_mesh_id0');
    const secondResult = getProtoDataBlob.call(context, '/Robot/base/visuals.proto_mesh_id0');

    assert.equal(firstResult, null);
    assert.equal(secondResult, null);
    assert.equal(singleFetchCount, 1);
    assert.equal(context._driverFallbackCallCounts.protoDataBlob, 1);
    assert.equal(context._protoDataBlobMissCache.has('/Robot/base/visuals.proto_mesh_id0'), true);
});

test('prefetchPrimOverrideDataFromDriver stays cache-only after a one-shot scene snapshot', () => {
    let batchFetchCount = 0;
    const context = {
        config: {},
        strictOneShotSceneLoad: true,
        allowPostReadyDriverDelta: false,
        _primOverrideDataCache: new Map([
            ['/Robot/base/visuals/base/mesh', { resolvedPrimPath: '/Robot/base/visuals/base/mesh' }],
        ]),
        _primOverrideDataMissCache: new Set(),
        hasResolvedRobotSceneSnapshot() {
            return true;
        },
        normalizePrimOverrideData(rawData) {
            return rawData || null;
        },
    };

    const summary = prefetchPrimOverrideDataFromDriver.call(
        context,
        {
            GetPrimOverrideDataMap() {
                batchFetchCount += 1;
                return {};
            },
        },
        ['/Robot/base/visuals/base/mesh', '/Robot/base/missing'],
    );

    assert.equal(summary.source, 'cache-only-after-snapshot');
    assert.equal(summary.count, 1);
    assert.equal(batchFetchCount, 0);
});
