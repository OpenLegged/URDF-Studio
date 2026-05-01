import test from 'node:test';
import assert from 'node:assert/strict';
import { BackSide, BoxGeometry, Color, DoubleSide, FrontSide, Group, MeshPhysicalMaterial } from 'three';

import { isCoplanarOffsetMaterial } from '../../../../../core/loaders/coplanarMaterialOffset.ts';
import { HydraMesh } from './HydraMesh.js';

function assertColorClose(actual: Color, expected: Color, epsilon = 1e-6) {
    assert.ok(Math.abs(actual.r - expected.r) <= epsilon, `expected r=${actual.r} to be close to ${expected.r}`);
    assert.ok(Math.abs(actual.g - expected.g) <= epsilon, `expected g=${actual.g} to be close to ${expected.g}`);
    assert.ok(Math.abs(actual.b - expected.b) <= epsilon, `expected b=${actual.b} to be close to ${expected.b}`);
}

const createHydraInterfaceStub = () => ({
    config: {
        usdRoot: new Group(),
    },
    meshes: {},
    materials: {},
    _preferredVisualMaterialByLinkCache: new Map(),
    resolveMaterialIdForMesh(materialId) {
        return materialId;
    },
    getOrCreateMaterialById(materialId) {
        return this.materials[materialId] || null;
    },
    getPreferredVisualMaterialForLink() {
        return null;
    },
});

test('HydraMesh defaults to double-sided USD surfaces and honors explicit sidedness updates', () => {
    const hydraMesh = new HydraMesh('Mesh', '/robot/base_link/mesh', createHydraInterfaceStub());
    const material = Array.isArray(hydraMesh._mesh.material)
        ? hydraMesh._mesh.material[0]
        : hydraMesh._mesh.material;

    assert.ok(material);
    assert.equal(material.isMeshStandardMaterial, true);
    assert.notEqual(material.isMeshPhysicalMaterial, true);
    assert.equal(material.side, DoubleSide);

    hydraMesh.setCullStyle('default');
    assert.equal(material.side, DoubleSide);

    hydraMesh.setDoubleSided(false);
    assert.equal(material.side, FrontSide);

    hydraMesh.setDoubleSided(true);
    assert.equal(material.side, DoubleSide);

    hydraMesh.setCullStyle('front');
    assert.equal(material.side, BackSide);

    hydraMesh.setCullStyle('backUnlessDoubleSided');
    assert.equal(material.side, DoubleSide);

    hydraMesh.setDoubleSided(false);
    assert.equal(material.side, FrontSide);

    hydraMesh.setCullStyle('nothing');
    assert.equal(material.side, DoubleSide);
});

test('HydraMesh reapplies sidedness when setMaterial replaces the assigned material', () => {
    const hydraInterface = createHydraInterfaceStub();
    const replacementMaterial = new MeshPhysicalMaterial({ name: 'replacement', color: 0xffffff });
    hydraInterface.materials['/Looks/Replacement'] = {
        _material: replacementMaterial,
    };

    const hydraMesh = new HydraMesh('Mesh', '/robot/base_link/mesh', hydraInterface);
    hydraMesh.setDoubleSided(true);
    const initialVersion = replacementMaterial.version;
    assert.equal(replacementMaterial.side, FrontSide);

    hydraMesh.setMaterial('/Looks/Replacement');

    assert.equal(replacementMaterial.side, DoubleSide);
    assert.ok(replacementMaterial.version > initialVersion);
});

test('HydraMesh preserves USD displayColor constant values as raw linear colors', () => {
    const hydraMesh = new HydraMesh('Mesh', '/robot/base_link/mesh', createHydraInterfaceStub());
    const material = Array.isArray(hydraMesh._mesh.material)
        ? hydraMesh._mesh.material[0]
        : hydraMesh._mesh.material;

    hydraMesh.setDisplayColor([1, 0.5, 0.2], 'constant');

    const expectedColor = new Color().setRGB(1, 0.5, 0.2);
    assert.ok(material);
    assert.equal(material.vertexColors, false);
    assertColorClose(material.color, expectedColor);
});

test('HydraMesh preserves USD displayColor vertex values as raw linear colors', () => {
    const hydraMesh = new HydraMesh('Mesh', '/robot/base_link/mesh', createHydraInterfaceStub());
    const material = Array.isArray(hydraMesh._mesh.material)
        ? hydraMesh._mesh.material[0]
        : hydraMesh._mesh.material;

    hydraMesh.setDisplayColor(new Float32Array([1, 0.5, 0.2, 0.25, 0.5, 0.75]), 'vertex');

    assert.ok(material);
    assert.equal(material.vertexColors, true);
    assert.deepEqual(Array.from(hydraMesh._colors), [1, 0.5, 0.2, 0.25, 0.5, 0.75]);
});

test('HydraMesh stabilizes coincident visual proto meshes on the same link', () => {
    const hydraInterface = createHydraInterfaceStub();
    hydraInterface.materials['/Looks/Inner'] = {
        _material: new MeshPhysicalMaterial({ name: 'inner_shell', color: 0xffffff }),
    };
    hydraInterface.materials['/Looks/Outer'] = {
        _material: new MeshPhysicalMaterial({ name: 'outer_shell', color: 0x111111 }),
    };

    const innerMesh = new HydraMesh('Mesh', '/Robot/base_link/visuals.proto_mesh_id0', hydraInterface);
    const outerMesh = new HydraMesh('Mesh', '/Robot/base_link/visuals.proto_mesh_id1', hydraInterface);
    hydraInterface.meshes[innerMesh._id] = innerMesh;
    hydraInterface.meshes[outerMesh._id] = outerMesh;

    innerMesh._mesh.geometry = new BoxGeometry(1, 1, 1);
    outerMesh._mesh.geometry = new BoxGeometry(1, 1, 1);
    outerMesh._mesh.scale.setScalar(1.02);
    innerMesh._mesh.updateMatrixWorld(true);
    outerMesh._mesh.updateMatrixWorld(true);

    innerMesh.setMaterial('/Looks/Inner');
    outerMesh.setMaterial('/Looks/Outer');

    const resolvedInnerMaterial = Array.isArray(innerMesh._mesh.material)
        ? innerMesh._mesh.material[0]
        : innerMesh._mesh.material;
    const resolvedOuterMaterial = Array.isArray(outerMesh._mesh.material)
        ? outerMesh._mesh.material[0]
        : outerMesh._mesh.material;

    assert.equal(innerMesh._mesh.renderOrder, 0);
    assert.equal(outerMesh._mesh.renderOrder, 1);
    assert.equal(resolvedInnerMaterial?.polygonOffset, false);
    assert.equal(resolvedOuterMaterial?.polygonOffset, true);
});

test('HydraMesh restacks repeated Unitree-style visual shells idempotently', () => {
    const hydraInterface = createHydraInterfaceStub();
    hydraInterface.materials['/Looks/Inner'] = {
        _material: new MeshPhysicalMaterial({ name: 'unitree_inner', color: 0xffffff }),
    };
    hydraInterface.materials['/Looks/Outer'] = {
        _material: new MeshPhysicalMaterial({ name: 'unitree_outer', color: 0x111111 }),
    };

    const innerMesh = new HydraMesh('Mesh', '/go2_description/base_link/visuals.proto_mesh_id0', hydraInterface);
    const outerMesh = new HydraMesh('Mesh', '/go2_description/base_link/visuals.proto_mesh_id1', hydraInterface);
    hydraInterface.meshes[innerMesh._id] = innerMesh;
    hydraInterface.meshes[outerMesh._id] = outerMesh;

    innerMesh._mesh.geometry = new BoxGeometry(1, 1, 1);
    outerMesh._mesh.geometry = new BoxGeometry(1, 1, 1);
    outerMesh._mesh.scale.setScalar(1.02);
    innerMesh._mesh.updateMatrixWorld(true);
    outerMesh._mesh.updateMatrixWorld(true);

    innerMesh.setMaterial('/Looks/Inner');
    outerMesh.setMaterial('/Looks/Outer');
    outerMesh.restackSiblingVisualProtoMeshes('/go2_description/base_link');
    innerMesh.restackSiblingVisualProtoMeshes('/go2_description/base_link');

    const resolvedInnerMaterial = Array.isArray(innerMesh._mesh.material)
        ? innerMesh._mesh.material[0]
        : innerMesh._mesh.material;
    const resolvedOuterMaterial = Array.isArray(outerMesh._mesh.material)
        ? outerMesh._mesh.material[0]
        : outerMesh._mesh.material;

    assert.equal(innerMesh._mesh.renderOrder, 0);
    assert.equal(outerMesh._mesh.renderOrder, 1);
    assert.equal(isCoplanarOffsetMaterial(resolvedInnerMaterial), false);
    assert.equal(isCoplanarOffsetMaterial(resolvedOuterMaterial), true);
});

test('HydraMesh preserves uncovered geometry ranges when geom subsets leave gaps', () => {
    const hydraInterface = createHydraInterfaceStub();
    hydraInterface.materials['/Looks/Base'] = {
        _material: new MeshPhysicalMaterial({ name: 'base_shell', color: 0xf0f0f0 }),
    };
    hydraInterface.materials['/Looks/Subset'] = {
        _material: new MeshPhysicalMaterial({ name: 'subset_shell', color: 0x222222 }),
    };

    const hydraMesh = new HydraMesh('Mesh', '/b2_description/FL_thigh/visuals.proto_mesh_id0', hydraInterface);
    hydraMesh.replaceGeometry(new BoxGeometry(1, 1, 1));
    hydraMesh.setMaterial('/Looks/Base');
    hydraMesh.setGeomSubsetMaterial([
        { start: 0, length: 6, materialId: '/Looks/Subset' },
        { start: 12, length: 6, materialId: '/Looks/Subset' },
    ]);

    const assignedMaterials = Array.isArray(hydraMesh._mesh.material)
        ? hydraMesh._mesh.material
        : [hydraMesh._mesh.material];
    const groupSummary = hydraMesh._geometry.groups.map((group) => ({
        start: group.start,
        count: group.count,
        material: assignedMaterials[group.materialIndex]?.name ?? null,
    }));

    assert.deepEqual(groupSummary, [
        { start: 0, count: 6, material: 'subset_shell' },
        { start: 6, count: 6, material: 'base_shell' },
        { start: 12, count: 6, material: 'subset_shell' },
        { start: 18, count: 18, material: 'base_shell' },
    ]);
});

test('HydraMesh prefers the next resolved subset material for uncovered visual gaps when no mesh-level base material exists', () => {
    const hydraInterface = createHydraInterfaceStub();
    hydraInterface.materials['/Looks/Primary'] = {
        _material: new MeshPhysicalMaterial({ name: 'primary_shell', color: 0xf0f0f0 }),
    };
    hydraInterface.materials['/Looks/Accent'] = {
        _material: new MeshPhysicalMaterial({ name: 'accent_shell', color: 0x222222 }),
    };

    const hydraMesh = new HydraMesh('Mesh', '/b2_description/FL_thigh/visuals.proto_mesh_id0', hydraInterface);
    hydraMesh.replaceGeometry(new BoxGeometry(1, 1, 1));
    hydraMesh.setGeomSubsetMaterial([
        { start: 0, length: 6, materialId: '/Looks/Primary' },
        { start: 12, length: 6, materialId: '/Looks/Accent' },
    ]);

    const assignedMaterials = Array.isArray(hydraMesh._mesh.material)
        ? hydraMesh._mesh.material
        : [hydraMesh._mesh.material];
    const groupSummary = hydraMesh._geometry.groups.map((group) => ({
        start: group.start,
        count: group.count,
        material: assignedMaterials[group.materialIndex]?.name ?? null,
    }));

    assert.deepEqual(groupSummary, [
        { start: 0, count: 6, material: 'primary_shell' },
        { start: 6, count: 6, material: 'accent_shell' },
        { start: 12, count: 6, material: 'accent_shell' },
        { start: 18, count: 18, material: 'accent_shell' },
    ]);
});
