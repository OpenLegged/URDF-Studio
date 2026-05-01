import test from 'node:test';
import assert from 'node:assert/strict';
import { Color, SRGBColorSpace, Texture } from 'three';

import { HydraMaterial } from './HydraMaterial.js';

function createTextureSource(onCloneDispose) {
    const sourceTexture = new Texture();
    sourceTexture.clone = () => {
        const clonedTexture = new Texture();
        clonedTexture.dispose = () => {
            onCloneDispose();
        };
        return clonedTexture;
    };
    return sourceTexture;
}

function buildMaterialNetworkUpdate(texturePath) {
    return [{
        networkId: '/Robot/Looks/TestNetwork',
        nodes: [
            {
                path: '/Robot/Looks/TestNetwork/PreviewSurface',
                parameters: {
                    roughness: 0.41,
                    metallic: 0.09,
                },
            },
            {
                path: '/Robot/Looks/TestNetwork/AlbedoTexture',
                parameters: {
                    resolvedPath: texturePath,
                },
            },
        ],
        relationships: [
            {
                inputId: '/Robot/Looks/TestNetwork/AlbedoTexture',
                outputId: '/Robot/Looks/TestNetwork/PreviewSurface',
                outputName: 'diffuseColor',
            },
        ],
    }];
}

function assertColorClose(actual, expected, epsilon = 1e-6) {
    assert.ok(Math.abs(actual.r - expected.r) <= epsilon, `expected r=${actual.r} to be close to ${expected.r}`);
    assert.ok(Math.abs(actual.g - expected.g) <= epsilon, `expected g=${actual.g} to be close to ${expected.g}`);
    assert.ok(Math.abs(actual.b - expected.b) <= epsilon, `expected b=${actual.b} to be close to ${expected.b}`);
}

test('HydraMaterial.applyNetworkUpdate reuses owned materials and disposes superseded texture clones', async () => {
    let firstCloneDisposeCount = 0;
    let secondCloneDisposeCount = 0;

    const firstSourceTexture = createTextureSource(() => {
        firstCloneDisposeCount += 1;
    });
    const secondSourceTexture = createTextureSource(() => {
        secondCloneDisposeCount += 1;
    });

    let activeSourceTexture = firstSourceTexture;
    const hydraInterface = {
        registry: {
            async getTexture() {
                return activeSourceTexture;
            },
        },
        createFallbackMaterialFromStage() {
            return null;
        },
    };

    const hydraMaterial = new HydraMaterial('/Robot/Looks/TestMaterial', hydraInterface);

    await hydraMaterial.applyNetworkUpdate(buildMaterialNetworkUpdate('/textures/albedo-a.png'));

    const firstMaterial = hydraMaterial._material;
    const firstAssignedMap = firstMaterial.map;

    assert.ok(firstAssignedMap, 'expected first network update to assign a cloned texture');

    activeSourceTexture = secondSourceTexture;
    await hydraMaterial.applyNetworkUpdate(buildMaterialNetworkUpdate('/textures/albedo-b.png'));

    assert.equal(hydraMaterial._material, firstMaterial);
    assert.notEqual(hydraMaterial._material.map, firstAssignedMap);
    assert.equal(firstCloneDisposeCount, 1);
    assert.equal(secondCloneDisposeCount, 0);
});

test('HydraMaterial applies authored preview-surface scalar colors as raw linear values', async () => {
    const hydraInterface = {
        registry: {
            async getTexture() {
                return null;
            },
        },
        createFallbackMaterialFromStage() {
            return null;
        },
    };

    const hydraMaterial = new HydraMaterial('/Robot/Looks/TestMaterial', hydraInterface);

    await hydraMaterial.applyNetworkUpdate([{
        networkId: '/Robot/Looks/TestNetwork',
        nodes: [
            {
                path: '/Robot/Looks/TestNetwork/PreviewSurface',
                parameters: {
                    baseColor: [1, 0.5, 0.2],
                    emissiveColor: [0.25, 0.5, 0.75],
                },
            },
        ],
        relationships: [],
    }]);

    const expectedBaseColor = new Color().setRGB(1, 0.5, 0.2);
    const expectedEmissiveColor = new Color().setRGB(0.25, 0.5, 0.75);

    assert.equal(hydraMaterial._material.isMeshStandardMaterial, true);
    assert.notEqual(hydraMaterial._material.isMeshPhysicalMaterial, true);
    assertColorClose(hydraMaterial._material.color, expectedBaseColor);
    assertColorClose(hydraMaterial._material.emissive, expectedEmissiveColor);
});

test('HydraMaterial upgrades to MeshPhysicalMaterial when physical-only inputs are authored', async () => {
    const hydraInterface = {
        registry: {
            async getTexture() {
                return null;
            },
        },
        createFallbackMaterialFromStage() {
            return null;
        },
    };

    const hydraMaterial = new HydraMaterial('/Robot/Looks/TestPhysicalMaterial', hydraInterface);

    await hydraMaterial.applyNetworkUpdate([{
        networkId: '/Robot/Looks/TestNetwork',
        nodes: [
            {
                path: '/Robot/Looks/TestNetwork/PreviewSurface',
                parameters: {
                    baseColor: [1, 0.5, 0.2],
                    clearcoat: 0.3,
                },
            },
        ],
        relationships: [],
    }]);

    assert.equal(hydraMaterial._material.isMeshPhysicalMaterial, true);
    assert.equal(hydraMaterial._material.clearcoat, 0.3);
});
