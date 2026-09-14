import { getUsdTextureArithmeticSummary } from '../../../../../core/utils/usdTextureArithmetic.ts';
import { captureUsdMaterialTextureInputs } from '../../../../../core/utils/usdTextureInput.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ClampToEdgeWrapping, Color, MeshPhysicalMaterial, NoColorSpace, RepeatWrapping, SRGBColorSpace, Texture } from 'three';

import { ThreeRenderDelegateMaterialOps } from './ThreeRenderDelegateMaterialOps.js';
import { ThreeRenderDelegateInterface } from './ThreeRenderDelegateInterface.js';

const {
    applySnapshotMaterialsToMeshes,
    applySnapshotMaterialRecord,
    normalizeSnapshotMaterialRecords,
    resolveSnapshotMaterialEmissionEnabled,
    applySnapshotTextureInput,
    resolveMaterialTexturePathCandidates,
    loadMaterialTexture,
    getSnapshotTextureApplyFailureSummary,
    recordSnapshotTextureApplyFailure,
    clearSnapshotTextureApplyFailure,
    getStage,
    setDriverStageResolveState,
    getDriverStageResolveSummary,
} = ThreeRenderDelegateMaterialOps.prototype;
const {
    applyStageFallbackMaterialParameters,
    resolveMaterialTexturePath,
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

test('material textures resolve relative to the entry USD layer before raw-path fallback', async () => {
    const attempts = [];
    const expectedTexture = { name: 'parquet-color' };
    const context = {
        ...createMaterialOpsContext(),
        resolveMaterialTexturePathCandidates,
        getStageSourcePath() {
            return '/Simple_Room/simple_room.usd';
        },
        registry: {
            getTexture(resourcePath) {
                attempts.push(resourcePath);
                if (resourcePath === '/Simple_Room/Materials/Textures/Parquet_Color.png') {
                    return Promise.resolve(expectedTexture);
                }
                return Promise.reject(new Error(`unknown:${resourcePath}`));
            },
        },
    };

    const texture = await loadMaterialTexture.call(
        context,
        'Materials/Textures/Parquet_Color.png',
    );

    assert.equal(texture, expectedTexture);
    assert.deepEqual(attempts, [
        '/Simple_Room/Materials/Textures/Parquet_Color.png',
    ]);
});

test('material texture loading keeps raw virtual paths as a compatibility fallback', async () => {
    const attempts = [];
    const context = {
        ...createMaterialOpsContext(),
        resolveMaterialTexturePathCandidates,
        getStageSourcePath() {
            return '/Scenes/room.usd';
        },
        registry: {
            getTexture(resourcePath) {
                attempts.push(resourcePath);
                if (resourcePath === 'shared/wood.png') {
                    return Promise.resolve({ name: 'legacy-raw-path' });
                }
                return Promise.reject(new Error(`unknown:${resourcePath}`));
            },
        },
    };

    const texture = await loadMaterialTexture.call(context, 'shared/wood.png');

    assert.equal(texture.name, 'legacy-raw-path');
    assert.deepEqual(attempts, [
        '/Scenes/shared/wood.png',
        'shared/wood.png',
    ]);
});

test('material texture candidates recover paths relative to referenced USD layers', () => {
    const context = {
        normalizeMaterialTexturePath(value) {
            return String(value || '').trim().replace(/^\.\//, '') || null;
        },
        getStageSourcePath() {
            return '/model.usd';
        },
        registry: {
            allPaths: [
                '/resource/material.usd',
                '/resource/img/wood.png',
            ],
        },
    };

    const candidates = resolveMaterialTexturePathCandidates.call(context, 'img/wood.png');

    assert.deepEqual(candidates, [
        '/img/wood.png',
        '/resource/img/wood.png',
        'img/wood.png',
    ]);
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

test('applyStageFallbackMaterialParameters approximates OmniGlass MDL inputs', () => {
    const material = new MeshPhysicalMaterial();
    const context = createStageFallbackContext();
    const shaderPrim = createShaderPrim(
        new Map([
            ['info:mdl:sourceAsset', 'OmniGlass.mdl'],
            ['inputs:enable_opacity', true],
            ['inputs:cutout_opacity', 0.8],
            ['inputs:glass_color', [0.25, 0.5, 0.75]],
        ]),
    );

    applyStageFallbackMaterialParameters.call(context, material, shaderPrim);

    assert.equal(material.userData.usdIsOmniGlass, true);
    assert.equal(material.opacity, 0.8);
    assert.equal(material.transparent, true);
    assert.equal(material.transmission, 1);
    assert.equal(material.roughness, 0);
    assert.equal(material.ior, 1.491);
    assert.equal(material.color.getHexString(), '89bce1');
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

test('resolveMaterialTexturePath follows a conventional UsdPreviewSurface diffuse texture shader', () => {
    const materialPath = '/root/materials/wood';
    const textureShaderPrim = createShaderPrim(new Map([
        ['inputs:file', { resolvedPath: 'resource/img/wood.jpg' }],
    ]));
    const stage = {};
    const context = createStageFallbackContext();
    context.getStage = () => stage;
    context.safeGetPrimAtPath = (candidateStage, primPath) => (
        candidateStage === stage && primPath === `${materialPath}/diffuseTexture`
            ? textureShaderPrim
            : null
    );
    const surfaceShaderPrim = createShaderPrim(new Map());

    const texturePath = resolveMaterialTexturePath.call(
        context,
        surfaceShaderPrim,
        ['inputs:diffuseColor'],
        { materialPath, materialProperty: 'map' },
    );

    assert.equal(texturePath, 'resource/img/wood.jpg');
});

test('applyStageFallbackMaterialParameters applies a connected UsdPreviewSurface diffuse texture', async () => {
    const materialPath = '/root/materials/wood';
    const material = new MeshPhysicalMaterial({ color: 0x123456 });
    const textureShaderPrim = createShaderPrim(new Map([
        ['inputs:file', { resolvedPath: 'resource/img/wood.jpg' }],
    ]));
    const stage = {};
    const context = createStageFallbackTextureContext();
    context.getStage = () => stage;
    context.safeGetPrimAtPath = (candidateStage, primPath) => (
        candidateStage === stage && primPath === `${materialPath}/diffuseTexture`
            ? textureShaderPrim
            : null
    );
    const surfaceShaderPrim = createShaderPrim(new Map());

    applyStageFallbackMaterialParameters.call(context, material, surfaceShaderPrim, { materialPath });

    assert.equal(material.userData.usdPendingTexturePaths.map, 'resource/img/wood.jpg');
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(material.map?.name, 'resource/img/wood.jpg');
    assert.equal(material.color.getHexString(), 'ffffff');
    assert.equal(material.userData.usdMaterialPath, materialPath);
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

test('normalizeSnapshotMaterialRecords applies OmniGlass physical defaults', () => {
    const context = createMaterialOpsContext();
    context.getStageSourcePath = () => '/scene.usd';
    context.inferColorHexFromMaterialName = () => null;
    context.resolveSnapshotMaterialEmissionEnabled = resolveSnapshotMaterialEmissionEnabled;

    const [record] = normalizeSnapshotMaterialRecords.call(context, [{
        materialId: '/root/Looks/glass',
        shaderInfoId: 'OmniGlass',
        opacity: 0.8,
    }]);

    assert.equal(record.isOmniGlass, true);
    assert.equal(record.opacity, 0.8);
    assert.equal(record.roughness, 0);
    assert.equal(record.ior, 1.491);
    assert.equal(record.transmission, 1);
    assert.equal(record.emissiveEnabled, false);
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

test('normalizeSnapshotMaterialRecords preserves native textureInputs per slot', () => {
    const context = {
        ...createMaterialOpsContext(),
        getStageSourcePath() {
            return '/scene.usd';
        },
        inferColorHexFromMaterialName: () => null,
        resolveSnapshotMaterialEmissionEnabled,
    };

    const [record] = normalizeSnapshotMaterialRecords.call(context, [{
        materialId: '/root/materials/mat_62',
        mapPath: 'img/bc7ddf166a9a9658c247b3c086960790.png',
        textureInputs: {
            mapPath: {
                uvTransform: [39.370079, 0, 0, 0, 39.370079, 0, 0, 0, 1],
                uvPrimvar: 'st',
                wrapS: 'repeat',
                wrapT: 'repeat',
            },
        },
    }]);

    assert.deepEqual(record.textureInputs.mapPath.uvTransform, [39.370079, 0, 0, 0, 39.370079, 0, 0, 0, 1]);
    assert.equal(record.textureInputs.mapPath.uvPrimvar, 'st');
    assert.equal(record.textureInputs.mapPath.wrapS, 'repeat');
    assert.equal(record.textureInputs.mapPath.wrapT, 'repeat');
});

test('normalizeSnapshotMaterialRecords drops textureInputs for missing texture paths and disabled emissive', () => {
    const context = {
        ...createMaterialOpsContext(),
        getStageSourcePath() {
            return '/scene.usd';
        },
        inferColorHexFromMaterialName: () => null,
        resolveSnapshotMaterialEmissionEnabled,
    };

    const records = normalizeSnapshotMaterialRecords.call(context, [
        {
            materialId: '/root/materials/mat_a',
            textureInputs: {
                mapPath: { uvTransform: [2, 0, 0, 0, 2, 0, 0, 0, 1] },
            },
        },
        {
            materialId: '/root/materials/mat_b',
            emissiveEnabled: false,
            mapPath: 'img/a.png',
            emissiveMapPath: 'img/b.png',
            textureInputs: {
                mapPath: { uvTransform: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
                emissiveMapPath: { uvTransform: [2, 0, 0, 0, 2, 0, 0, 0, 1] },
            },
        },
    ]);

    assert.equal(records[0].textureInputs, null);
    assert.equal(records[1].textureInputs.emissiveMapPath, undefined);
    assert.deepEqual(records[1].textureInputs.mapPath.uvTransform, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
});

test('snapshot sampling metadata survives serialization before and after the texture loads', async () => {
    const material = new MeshPhysicalMaterial();
    let finishLoad;
    const registryTexture = new Texture();
    const context = {
        ...createMaterialOpsContext(),
        registry: { getTexture: () => new Promise((resolve) => { finishLoad = resolve; }) },
    };
    const input = {
        uvTransform: [0, 2, 0, -1, 0, 0, 0.25, 0.5, 1],
        uvPrimvar: 'st1', wrapS: 'black', wrapT: 'repeat',
        sourceColorSpace: 'auto', resolvedColorSpace: 'raw',
        sourceOutput: 'rgb', sampleScale: [0.2, 0.3, 0.4, 1],
    };
    applySnapshotTextureInput.call(context, material, 'img/checker.png', 'map', {
        textureInputs: { mapPath: input },
    });
    assert.equal(material.map, null);
    assert.equal(material.userData.usdPendingTexturePaths.map, 'img/checker.png');
    assert.deepEqual(captureUsdMaterialTextureInputs(material), { mapPath: input });
    finishLoad(registryTexture);
    await Promise.all(context._pendingSnapshotTextureLoads);
    assert.deepEqual(captureUsdMaterialTextureInputs(material), { mapPath: input });
    assert.deepEqual(captureUsdMaterialTextureInputs(material.clone()), { mapPath: input });
});

test('applySnapshotTextureInput applies per-slot uv transform, wrap, and sRGB fallback to the cloned texture', async () => {
    const registryTexture = new Texture();
    registryTexture.wrapS = ClampToEdgeWrapping;
    registryTexture.colorSpace = NoColorSpace;
    const material = new MeshPhysicalMaterial({ name: 'mat_62' });
    const context = {
        ...createMaterialOpsContext(),
        registry: {
            getTexture() {
                return Promise.resolve(registryTexture);
            },
        },
    };

    assert.equal(
        applySnapshotTextureInput.call(
            context,
            material,
            'img/bc7ddf166a9a9658c247b3c086960790.png',
            'map',
            {
                colorSpace: SRGBColorSpace,
                textureInputs: {
                    mapPath: {
                        uvTransform: [39.370079, 0, 0, 0, 39.370079, 0, 0, 0, 1],
                        uvPrimvar: 'st',
                        wrapS: 'repeat',
                        wrapT: 'repeat',
                    },
                },
            },
        ),
        true,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    const assignedMap = material.map;
    assert.notEqual(assignedMap, registryTexture);
    assert.equal(assignedMap.matrixAutoUpdate, false);
    assert.deepEqual(assignedMap.matrix.elements, [39.370079, 0, 0, 0, 39.370079, 0, 0, 0, 1]);
    assert.equal(assignedMap.wrapS, RepeatWrapping);
    assert.equal(assignedMap.wrapT, RepeatWrapping);
    // Color slot with absent authored token keeps the USD auto sRGB fallback.
    assert.equal(assignedMap.colorSpace, SRGBColorSpace);
    // The shared registry texture is untouched.
    assert.equal(registryTexture.matrixAutoUpdate, true);
    assert.equal(registryTexture.wrapS, ClampToEdgeWrapping);
});

test('applySnapshotTextureInput keeps an authored identity matrix authoritative over clone state', async () => {
    const registryTexture = new Texture();
    registryTexture.repeat.set(8, 4);
    registryTexture.matrixAutoUpdate = true;
    registryTexture.matrix.setUvTransform(0.25, 0.5, 2, 2, Math.PI / 8, 0.5, 0.5);
    const material = new MeshPhysicalMaterial({ name: 'mat_identity' });
    const context = {
        ...createMaterialOpsContext(),
        registry: {
            getTexture() {
                return Promise.resolve(registryTexture);
            },
        },
    };

    applySnapshotTextureInput.call(context, material, 'img/identity.png', 'map', {
        textureInputs: {
            mapPath: { uvTransform: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
        },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const assignedMap = material.map;
    assert.equal(assignedMap.matrixAutoUpdate, false);
    assert.deepEqual(assignedMap.matrix.elements, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
});

test('applySnapshotTextureInput maps material property to the correct slot record', async () => {
    const sharedTexture = new Texture();
    let lastAssigned = null;
    const material = new MeshPhysicalMaterial({ name: 'mat_slots' });
    const context = {
        ...createMaterialOpsContext(),
        registry: {
            getTexture() {
                return Promise.resolve(sharedTexture);
            },
        },
    };

    applySnapshotTextureInput.call(context, material, 'img/orm.png', 'roughnessMap', {
        textureInputs: {
            roughnessMapPath: { uvTransform: [3, 0, 0, 0, 5, 0, 0, 0, 1] },
            mapPath: { uvTransform: [9, 0, 0, 0, 9, 0, 0, 0, 1] },
        },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    lastAssigned = material.roughnessMap;
    assert.deepEqual(lastAssigned.matrix.elements, [3, 0, 0, 0, 5, 0, 0, 0, 1]);
});

test('snapshot texture assignment installs actual RGB sample arithmetic on the live material', async () => {
    const context = createMaterialOpsContext();
    const texture = new Texture();
    context.registry.getTexture = async () => texture;
    const material = new MeshPhysicalMaterial();
    applySnapshotTextureInput.call(context, material, 'wardrobe.png', 'map', {
        textureInputs: { mapPath: { sourceOutput: 'rgb', sampleBias: [0.001, 0.02, 0.01, 0] } },
    });
    await new Promise((resolve) => setImmediate(resolve));
    const shader = { uniforms: {}, vertexShader: '', fragmentShader: '#include <map_fragment>' };
    material.onBeforeCompile(shader, {});
    assert.equal(getUsdTextureArithmeticSummary(material)?.compiled, true);
    assert.deepEqual(shader.uniforms.usdMapSampleBias.value.toArray(), [0.001, 0.02, 0.01, 0]);
    assert.notEqual(material.map, texture);
    assert.deepEqual(texture.userData, {});
});

test('native MDL preset diagnostics retain partial status and effective linear color', () => {
    const context = createMaterialOpsContext();
    context.getStageSourcePath = () => '/scene.usd';
    context.inferColorHexFromMaterialName = () => 0xffffff;
    context.resolveSnapshotMaterialEmissionEnabled = resolveSnapshotMaterialEmissionEnabled;
    const mdlPreset = {
        family: 'OmniPBR', status: 'partial', sourceAsset: 'Materials/Aluminum.mdl',
        subIdentifier: 'Aluminum',
        inputs: { diffuse_color_constant: [0.4, 0.5, 0.6], roughness_texture: { assetPath: 'orm.png', sourceColorSpace: 'raw' } },
        unsupportedInputs: ['connected_diffuse_color'],
    };
    const [record] = normalizeSnapshotMaterialRecords.call(context, [{
        materialId: '/Looks/white', color: [0.4, 0.5, 0.6], colorSource: 'mdl-preset',
        colorSpace: 'srgb', mdlPreset,
    }]);
    assert.deepEqual(record.mdlPreset, mdlPreset);
    assert.notEqual(record.mdlPreset.inputs, mdlPreset.inputs);
    assert.equal(record.mdlPreset.status, 'partial');
    assert.equal(record.colorSource, 'mdl-preset');
    assert.equal(record.colorSpace, 'linear');
    assert.deepEqual(record.color, [0.4, 0.5, 0.6]);
});

test('invalid MDL diagnostic payload cannot masquerade as a resolved preset', () => {
    const context = createMaterialOpsContext();
    context.getStageSourcePath = () => '/scene.usd';
    context.inferColorHexFromMaterialName = () => null;
    context.resolveSnapshotMaterialEmissionEnabled = resolveSnapshotMaterialEmissionEnabled;
    const [record] = normalizeSnapshotMaterialRecords.call(context, [{
        materialId: '/Looks/unsupported',
        mdlPreset: { family: 'OmniPBR', status: 'resolved', sourceAsset: 'Materials/Example.mdl', subIdentifier: 'Example', inputs: { roughness: Infinity }, unsupportedInputs: [] },
    }]);
    assert.equal(record.mdlPreset, null);
});


test('snapshot fallback factory retains dielectric Fresnel parameters on real physical materials', () => {
    const context = createStageFallbackContext();
    const ior = (1 + Math.sqrt(0.08)) / (1 - Math.sqrt(0.08));
    for (const intensity of [0, 0.5]) {
        const materialPath = `/Looks/Dielectric_${intensity}`;
        context._snapshotMaterialRecordById = new Map([[materialPath, {
            materialId: materialPath, color: [0.2, 0.3, 0.4], roughness: 0.25, metalness: 0,
            ior, specularIntensity: intensity, specularColor: [1, 0.8, 0.4],
        }]]);
        const wrapped = context.createFallbackMaterialFromSnapshot(materialPath);
        assert.ok(wrapped._material instanceof MeshPhysicalMaterial);
        const material = wrapped._material;
        assert.equal(material.ior, ior);
        assert.equal(material.specularIntensity, intensity);
        assert.deepEqual(material.specularColor.toArray(), [1, 0.8, 0.4]);
        const f0 = ((material.ior - 1) / (material.ior + 1)) ** 2 * material.specularIntensity;
        assert.ok(Math.abs(f0 - 0.08 * intensity) < 1e-12);
        assert.equal(context.createFallbackMaterialFromSnapshot(materialPath), wrapped);
        material.dispose();
    }
});
