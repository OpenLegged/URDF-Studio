import test from 'node:test';
import assert from 'node:assert/strict';
import { Float32BufferAttribute, Group, MeshPhysicalMaterial } from 'three';

import { isCoplanarOffsetMaterial } from '../../../../../core/loaders/coplanarMaterialOffset.ts';
import { ThreeRenderDelegateMaterialOps } from './ThreeRenderDelegateMaterialOps.js';
import { HydraMesh } from './HydraMesh.js';

const {
    applySnapshotMaterialsToMeshes,
    buildSnapshotMeshDescriptorIndex,
    getSnapshotMeshDescriptor,
    getSnapshotDirectMaterialIdForMeshId,
    getSnapshotGeomSubsetSectionsForMeshId,
} = ThreeRenderDelegateMaterialOps.prototype;

function createTestContext({
    materials = {},
    meshId = '/robot/base_link/visuals.proto_mesh_id0',
    mesh = null,
    descriptors = [],
} = {}) {
    return {
        meshes: {
            [meshId]: mesh,
        },
        materials,
        _preferredVisualMaterialByLinkCache: new Map(),
        getCachedRobotSceneSnapshot() {
            return {
                render: {
                    meshDescriptors: descriptors,
                },
            };
        },
        getOrCreateMaterialById(materialId) {
            return this.materials?.[materialId] || null;
        },
        buildSnapshotMeshDescriptorIndex,
        getSnapshotMeshDescriptor,
        getSnapshotDirectMaterialIdForMeshId,
        getSnapshotGeomSubsetSectionsForMeshId,
    };
}

test('applySnapshotMaterialsToMeshes binds direct material from snapshot descriptor when pending id is missing', () => {
    const meshId = '/robot/base_link/visuals.proto_mesh_id0';
    const materialId = '/robot/Looks/base_link';
    const expectedMaterial = new MeshPhysicalMaterial({ name: 'base_link' });
    const hydraMesh = {
        _id: meshId,
        _pendingMaterialId: null,
        _pendingGeomSubsetSections: null,
        _mesh: { material: null },
        tryApplyPendingGeomSubsetMaterials() {
            return false;
        },
        tryInheritVisualMaterialFromLink() {
            return false;
        },
    };
    const context = createTestContext({
        meshId,
        mesh: hydraMesh,
        materials: {
            [materialId]: { _material: expectedMaterial },
        },
        descriptors: [
            {
                meshId,
                geometry: {
                    materialId,
                    geomSubsetSections: [],
                },
            },
        ],
    });

    const summary = applySnapshotMaterialsToMeshes.call(context);

    assert.equal(hydraMesh._mesh.material, expectedMaterial);
    assert.equal(hydraMesh._pendingMaterialId, undefined);
    assert.equal(summary.boundCount, 1);
});

test('applySnapshotMaterialsToMeshes seeds missing geom subset sections from snapshot descriptor', () => {
    const meshId = '/robot/base_link/visuals.proto_mesh_id0';
    const sectionMaterialId = '/robot/Looks/paint';
    let appliedSections = null;
    const hydraMesh = {
        _id: meshId,
        _pendingMaterialId: null,
        _pendingGeomSubsetSections: null,
        _mesh: { material: null },
        tryApplyPendingGeomSubsetMaterials() {
            appliedSections = Array.isArray(this._pendingGeomSubsetSections)
                ? this._pendingGeomSubsetSections.map((section) => ({ ...section }))
                : null;
            this._pendingGeomSubsetSections = null;
            return Array.isArray(appliedSections) && appliedSections.length > 0;
        },
        tryInheritVisualMaterialFromLink() {
            return false;
        },
    };
    const context = createTestContext({
        meshId,
        mesh: hydraMesh,
        descriptors: [
            {
                meshId,
                geometry: {
                    materialId: null,
                    geomSubsetSections: [
                        {
                            start: 0,
                            length: 12,
                            materialId: sectionMaterialId,
                        },
                    ],
                },
            },
        ],
    });

    const summary = applySnapshotMaterialsToMeshes.call(context);

    assert.deepEqual(appliedSections, [
        {
            start: 0,
            length: 12,
            materialId: sectionMaterialId,
        },
    ]);
    assert.equal(summary.subsetReboundCount, 1);
});

test('HydraMesh.tryApplyPendingGeomSubsetMaterials applies subset materials without throwing', () => {
    const materialA = new MeshPhysicalMaterial({ name: 'mat-a' });
    const materialB = new MeshPhysicalMaterial({ name: 'mat-b' });
    const hydraInterface = {
        config: {
            usdRoot: new Group(),
        },
        materials: {
            '/robot/Looks/mat-a': { _material: materialA },
            '/robot/Looks/mat-b': { _material: materialB },
        },
        resolveMaterialIdForMesh(materialId) {
            return materialId;
        },
        getOrCreateMaterialById(materialId) {
            return this.materials[materialId] || null;
        },
        getPreferredVisualMaterialForLink() {
            return null;
        },
        _preferredVisualMaterialByLinkCache: new Map(),
    };
    const hydraMesh = new HydraMesh('mesh', '/robot/base_link/visuals.proto_mesh_id0', hydraInterface);
    hydraMesh._geometry.setAttribute('position', new Float32BufferAttribute([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
        0, 0, 1,
        1, 0, 1,
        0, 1, 1,
    ], 3));
    hydraMesh._geometry.setIndex([0, 1, 2, 3, 4, 5]);
    hydraMesh._mesh.geometry = hydraMesh._geometry;
    hydraMesh._pendingGeomSubsetSections = [
        { start: 0, length: 3, materialId: '/robot/Looks/mat-a' },
        { start: 3, length: 3, materialId: '/robot/Looks/mat-b' },
    ];

    assert.doesNotThrow(() => hydraMesh.tryApplyPendingGeomSubsetMaterials());
    assert.equal(hydraMesh._pendingGeomSubsetSections, null);
    assert.equal(hydraMesh._geometry.groups.length, 2);
    assert.deepEqual(hydraMesh._mesh.material.map((material) => material.name), ['mat-a', 'mat-b']);
});

test('HydraMesh applies composed USD visibility to its render object', () => {
    const hydraMesh = new HydraMesh('mesh', '/Root/GroundPlane/CollisionMesh', {
        config: { usdRoot: new Group() },
    });

    hydraMesh.setVisible(false);
    assert.equal(hydraMesh._mesh.visible, false);

    hydraMesh.setVisible(0);
    assert.equal(hydraMesh._mesh.visible, false);

    hydraMesh.setVisible(true);
    assert.equal(hydraMesh._mesh.visible, true);
});

test('HydraMesh.tryApplyPendingGeomSubsetMaterials offsets repeated overlapping subset materials idempotently', () => {
    const materialA = new MeshPhysicalMaterial({ name: 'subset-anchor' });
    const materialB = new MeshPhysicalMaterial({ name: 'subset-overlay' });
    const hydraInterface = {
        config: {
            usdRoot: new Group(),
        },
        materials: {
            '/robot/Looks/subset-anchor': { _material: materialA },
            '/robot/Looks/subset-overlay': { _material: materialB },
        },
        resolveMaterialIdForMesh(materialId) {
            return materialId;
        },
        getOrCreateMaterialById(materialId) {
            return this.materials[materialId] || null;
        },
        getPreferredVisualMaterialForLink() {
            return null;
        },
        _preferredVisualMaterialByLinkCache: new Map(),
    };
    const hydraMesh = new HydraMesh('mesh', '/robot/base_link/visuals.proto_mesh_id0', hydraInterface);
    hydraMesh._geometry.setAttribute('position', new Float32BufferAttribute([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
    ], 3));
    hydraMesh._geometry.setIndex([0, 1, 2, 0, 1, 2]);
    hydraMesh._mesh.geometry = hydraMesh._geometry;

    const subsetSections = [
        { start: 0, length: 3, materialId: '/robot/Looks/subset-anchor' },
        { start: 3, length: 3, materialId: '/robot/Looks/subset-overlay' },
    ];

    hydraMesh._pendingGeomSubsetSections = subsetSections.map((section) => ({ ...section }));
    assert.equal(hydraMesh.tryApplyPendingGeomSubsetMaterials(), true);

    let resolvedMaterials = Array.isArray(hydraMesh._mesh.material)
        ? hydraMesh._mesh.material
        : [hydraMesh._mesh.material];
    assert.equal(resolvedMaterials.filter((material) => isCoplanarOffsetMaterial(material)).length, 1);

    hydraMesh._pendingGeomSubsetSections = subsetSections.map((section) => ({ ...section }));
    assert.equal(hydraMesh.tryApplyPendingGeomSubsetMaterials(), true);

    resolvedMaterials = Array.isArray(hydraMesh._mesh.material)
        ? hydraMesh._mesh.material
        : [hydraMesh._mesh.material];
    assert.equal(resolvedMaterials.filter((material) => isCoplanarOffsetMaterial(material)).length, 1);
});

test('HydraMesh.tryApplyProtoDataBlobFastPath replaces stale expanded normals with authored proto normals', () => {
    const hydraInterface = {
        config: {
            usdRoot: new Group(),
        },
        materials: {},
        resolveMaterialIdForMesh(materialId) {
            return materialId;
        },
        getOrCreateMaterialById(materialId) {
            return this.materials[materialId] || null;
        },
        getPreferredVisualMaterialForLink() {
            return null;
        },
        getProtoDataBlob() {
            return {
                valid: true,
                transform: Float32Array.from([
                    1, 0, 0, 0,
                    0, 1, 0, 0,
                    0, 0, 1, 0,
                    0, 0, 0, 1,
                ]),
                numVertices: 4,
                points: Float32Array.from([
                    0, 0, 0,
                    1, 0, 0,
                    1, 1, 0,
                    0, 1, 0,
                ]),
                numIndices: 6,
                indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
                normalsDimension: 3,
                numNormals: 4,
                normals: Float32Array.from([
                    1, 0, 0,
                    0, 1, 0,
                    0, 0, 1,
                    -1, 0, 0,
                ]),
                uvDimension: 2,
                numUVs: 6,
                uv: Float32Array.from([
                    0, 0,
                    1, 0,
                    1, 1,
                    0, 0,
                    1, 1,
                    0, 1,
                ]),
                materialId: '',
                geomSubsetSections: [],
            };
        },
        _preferredVisualMaterialByLinkCache: new Map(),
    };
    const hydraMesh = new HydraMesh('mesh', '/robot/base_link/visuals.proto_mesh_id0', hydraInterface);
    hydraMesh._geometry.setAttribute('normal', new Float32BufferAttribute(Float32Array.from([
        0, 0, -1,
        0, 0, -1,
        0, 0, -1,
        0, 0, -1,
        0, 0, -1,
        0, 0, -1,
    ]), 3));

    hydraMesh.tryApplyProtoDataBlobFastPath();
    const positionAttribute = hydraMesh._geometry.getAttribute('position');
    const normalAttribute = hydraMesh._geometry.getAttribute('normal');

    assert.equal(hydraMesh._geometry.getIndex(), null);
    assert.equal(positionAttribute.count, 6);
    assert.equal(normalAttribute.count, 6);
    assert.deepEqual(Array.from(normalAttribute.array), [
        1, 0, 0,
        0, 1, 0,
        0, 0, 1,
        1, 0, 0,
        0, 0, 1,
        -1, 0, 0,
    ]);
});

test('HydraMesh.tryApplyProtoDataBlobFastPath prefers indexed smooth normals when expanded authored normals are materially worse', () => {
    const hydraInterface = {
        config: {
            usdRoot: new Group(),
        },
        materials: {},
        resolveMaterialIdForMesh(materialId) {
            return materialId;
        },
        getOrCreateMaterialById(materialId) {
            return this.materials[materialId] || null;
        },
        getPreferredVisualMaterialForLink() {
            return null;
        },
        getProtoDataBlob() {
            return {
                valid: true,
                transform: Float32Array.from([
                    1, 0, 0, 0,
                    0, 1, 0, 0,
                    0, 0, 1, 0,
                    0, 0, 0, 1,
                ]),
                numVertices: 4,
                points: Float32Array.from([
                    0, 0, 0,
                    1, 0, 0,
                    1, 1, 0,
                    0, 1, 0,
                ]),
                numIndices: 6,
                indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
                normalsDimension: 3,
                numNormals: 4,
                normals: Float32Array.from([
                    0, 0, 1,
                    0, 0, 1,
                    0, 0, 0,
                    0, 0, 1,
                ]),
                uvDimension: 2,
                numUVs: 6,
                uv: Float32Array.from([
                    0, 0,
                    1, 0,
                    1, 1,
                    0, 0,
                    1, 1,
                    0, 1,
                ]),
                materialId: '',
                geomSubsetSections: [],
            };
        },
        _preferredVisualMaterialByLinkCache: new Map(),
    };
    const hydraMesh = new HydraMesh('mesh', '/robot/base_link/visuals.proto_mesh_id0', hydraInterface);

    hydraMesh.tryApplyProtoDataBlobFastPath();
    const normalAttribute = hydraMesh._geometry.getAttribute('normal');

    assert.deepEqual(Array.from(normalAttribute.array), [
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
    ]);
});

test('HydraMesh.tryApplyProtoDataBlobFastPath keeps triangulated polygon indices for expanded USD face corners', () => {
    const hydraInterface = {
        config: {
            usdRoot: new Group(),
        },
        materials: {},
        resolveMaterialIdForMesh(materialId) {
            return materialId;
        },
        getOrCreateMaterialById(materialId) {
            return this.materials[materialId] || null;
        },
        getPreferredVisualMaterialForLink() {
            return null;
        },
        getResolvedPrimPathForMeshId() {
            return '/b2_description/FL_calf/visuals/FL_calf/mesh';
        },
        getStage() {
            return {};
        },
        safeGetPrimAtPath() {
            return {
                GetAttribute(name) {
                    if (name === 'faceVertexCounts') {
                        return {
                            Get() {
                                return Uint32Array.from([4]);
                            },
                        };
                    }
                    return null;
                },
            };
        },
        getProtoDataBlob() {
            return {
                valid: true,
                transform: Float32Array.from([
                    1, 0, 0, 0,
                    0, 1, 0, 0,
                    0, 0, 1, 0,
                    0, 0, 0, 1,
                ]),
                numVertices: 4,
                points: Float32Array.from([
                    0, 0, 0,
                    1, 0, 0,
                    1, 1, 0,
                    0, 1, 0,
                ]),
                numIndices: 4,
                indices: Uint32Array.from([0, 1, 2, 3]),
                normalsDimension: 3,
                numNormals: 4,
                normals: Float32Array.from([
                    0, 0, 1,
                    0, 0, 1,
                    0, 0, 1,
                    0, 0, 1,
                ]),
                uvDimension: 2,
                numUVs: 4,
                uv: Float32Array.from([
                    0, 0,
                    1, 0,
                    1, 1,
                    0, 1,
                ]),
                materialId: '',
                geomSubsetSections: [],
            };
        },
        _preferredVisualMaterialByLinkCache: new Map(),
    };
    const hydraMesh = new HydraMesh('mesh', '/b2_description/FL_calf/visuals.proto_mesh_id0', hydraInterface);

    hydraMesh.tryApplyProtoDataBlobFastPath();

    const indexAttribute = hydraMesh._geometry.getIndex();
    assert.ok(indexAttribute);
    assert.equal(indexAttribute.count, 6);
    assert.deepEqual(Array.from(indexAttribute.array), [0, 1, 2, 0, 2, 3]);
    assert.equal(hydraMesh._geometry.getAttribute('position').count, 4);
    assert.equal(hydraMesh._geometry.getAttribute('normal').count, 4);
    assert.equal(hydraMesh._geometry.getAttribute('uv').count, 4);
});

test('HydraMesh.updateNormals replaces invalid normals on non-indexed geometry', () => {
    const hydraInterface = {
        config: {
            usdRoot: new Group(),
        },
        materials: {},
        resolveMaterialIdForMesh(materialId) {
            return materialId;
        },
        getOrCreateMaterialById(materialId) {
            return this.materials[materialId] || null;
        },
        getPreferredVisualMaterialForLink() {
            return null;
        },
        _preferredVisualMaterialByLinkCache: new Map(),
    };
    const hydraMesh = new HydraMesh('mesh', '/robot/base_link/visuals.proto_mesh_id0', hydraInterface);
    hydraMesh._geometry.setAttribute('position', new Float32BufferAttribute(Float32Array.from([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
        0, 0, 0,
        0, 1, 0,
        0, 0, 1,
    ]), 3));
    hydraMesh._geometry.setAttribute('normal', new Float32BufferAttribute(new Float32Array(18), 3));
    hydraMesh._indices = undefined;

    hydraMesh.updateNormals(Float32Array.from([
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
        1, 0, 0,
        1, 0, 0,
        1, 0, 0,
    ]));

    assert.deepEqual(Array.from(hydraMesh._geometry.getAttribute('normal').array), [
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
        1, 0, 0,
        1, 0, 0,
        1, 0, 0,
    ]);
});

test('HydraMesh.sanitizeNormalsIfNeeded does not replace authored normals with a worse rebuilt shared-normal field', () => {
    const hydraInterface = {
        config: {
            usdRoot: new Group(),
        },
        materials: {},
        resolveMaterialIdForMesh(materialId) {
            return materialId;
        },
        getOrCreateMaterialById(materialId) {
            return this.materials[materialId] || null;
        },
        getPreferredVisualMaterialForLink() {
            return null;
        },
        _preferredVisualMaterialByLinkCache: new Map(),
    };
    const hydraMesh = new HydraMesh('mesh', '/robot/base_link/visuals.proto_mesh_id0', hydraInterface);
    hydraMesh._geometry.setAttribute('position', new Float32BufferAttribute(Float32Array.from([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
        0, 0, 0,
        0, 1, 0,
        1, 0, 0,
    ]), 3));
    hydraMesh._geometry.setAttribute('normal', new Float32BufferAttribute(Float32Array.from([
        0, 0, 0,
        0, 0, 1,
        0, 0, 1,
        0, 0, -1,
        0, 0, -1,
        0, 0, -1,
    ]), 3));
    hydraMesh._expandedSharedVertexIndices = Uint32Array.from([0, 1, 2, 0, 2, 1]);
    hydraMesh._needsNormalSanitization = true;

    hydraMesh.sanitizeNormalsIfNeeded();

    assert.deepEqual(Array.from(hydraMesh._geometry.getAttribute('normal').array), [
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
        0, 0, -1,
        0, 0, -1,
        0, 0, -1,
    ]);
});
