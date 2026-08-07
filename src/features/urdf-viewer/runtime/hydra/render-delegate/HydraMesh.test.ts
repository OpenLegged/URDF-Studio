import test from 'node:test';
import assert from 'node:assert/strict';
import { BackSide, BoxGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, FrontSide, Group, MeshPhysicalMaterial, Vector3 } from 'three';

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
    meshes: {} as Record<string, HydraMesh>,
    materials: {} as Record<string, { _material: MeshPhysicalMaterial }>,
    _preferredVisualMaterialByLinkCache: new Map(),
    resolveMaterialIdForMesh(materialId: string) {
        return materialId;
    },
    getOrCreateMaterialById(materialId: string) {
        return this.materials[materialId] || null;
    },
    getPreferredVisualMaterialForLink() {
        return null;
    },
});

function countLowDotTriangleNormals(positions: ArrayLike<number>, normals: ArrayLike<number>, minDot = 0.2) {
    const vertexCount = Math.min(Math.floor(positions.length / 3), Math.floor(normals.length / 3));
    let lowDotCount = 0;
    for (let vertexIndex = 0; vertexIndex + 2 < vertexCount; vertexIndex += 3) {
        const p0 = vertexIndex * 3;
        const p1 = (vertexIndex + 1) * 3;
        const p2 = (vertexIndex + 2) * 3;
        const ux = positions[p1] - positions[p0];
        const uy = positions[p1 + 1] - positions[p0 + 1];
        const uz = positions[p1 + 2] - positions[p0 + 2];
        const vx = positions[p2] - positions[p0];
        const vy = positions[p2 + 1] - positions[p0 + 1];
        const vz = positions[p2 + 2] - positions[p0 + 2];
        const nx = (uy * vz) - (uz * vy);
        const ny = (uz * vx) - (ux * vz);
        const nz = (ux * vy) - (uy * vx);
        const faceLenSq = nx * nx + ny * ny + nz * nz;
        if (!Number.isFinite(faceLenSq) || faceLenSq <= 0) {
            continue;
        }
        const invFaceLen = 1 / Math.sqrt(faceLenSq);
        const faceX = nx * invFaceLen;
        const faceY = ny * invFaceLen;
        const faceZ = nz * invFaceLen;
        for (let corner = 0; corner < 3; corner += 1) {
            const normalBase = (vertexIndex + corner) * 3;
            const normalX = normals[normalBase];
            const normalY = normals[normalBase + 1];
            const normalZ = normals[normalBase + 2];
            const normalLenSq = normalX * normalX + normalY * normalY + normalZ * normalZ;
            if (!Number.isFinite(normalLenSq) || normalLenSq <= 0) {
                lowDotCount += 1;
                continue;
            }
            const invNormalLen = 1 / Math.sqrt(normalLenSq);
            const dot = (normalX * invNormalLen * faceX)
                + (normalY * invNormalLen * faceY)
                + (normalZ * invNormalLen * faceZ);
            if (dot < minDot) {
                lowDotCount += 1;
            }
        }
    }
    return lowDotCount;
}

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

test('HydraMesh does not infer front-sided rendering from open mesh normals', () => {
    const hydraMesh = new HydraMesh(
        'Mesh',
        '/robot/open_panel/mesh',
        createHydraInterfaceStub(),
    ) as any;
    const material = Array.isArray(hydraMesh._mesh.material)
        ? hydraMesh._mesh.material[0]
        : hydraMesh._mesh.material;

    hydraMesh._primType = 'mesh';
    hydraMesh._normals = new Float32Array([
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
    ]);
    hydraMesh._applySurfaceState();

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

    const assignedMaterial = Array.isArray(hydraMesh._mesh.material)
        ? hydraMesh._mesh.material[0]
        : hydraMesh._mesh.material;
    assert.notEqual(assignedMaterial, replacementMaterial);
    assert.equal(assignedMaterial.side, DoubleSide);
    assert.equal(replacementMaterial.side, FrontSide);
    assert.equal(replacementMaterial.version, initialVersion);
});

test('HydraMesh keeps per-mesh sidedness from mutating shared registry materials', () => {
    const sharedMaterial = new MeshPhysicalMaterial({ name: 'shared', color: 0xffffff });
    const hydraInterface = createHydraInterfaceStub();
    hydraInterface.materials['/Looks/Shared'] = {
        _material: sharedMaterial,
    };

    const doubleSidedMesh = new HydraMesh('Mesh', '/robot/left/mesh', hydraInterface);
    const frontSidedMesh = new HydraMesh('Mesh', '/robot/right/mesh', hydraInterface);

    doubleSidedMesh.setDoubleSided(true);
    frontSidedMesh.setDoubleSided(false);
    doubleSidedMesh.setMaterial('/Looks/Shared');
    frontSidedMesh.setMaterial('/Looks/Shared');

    const doubleSidedMaterial = Array.isArray(doubleSidedMesh._mesh.material)
        ? doubleSidedMesh._mesh.material[0]
        : doubleSidedMesh._mesh.material;
    const frontSidedMaterial = Array.isArray(frontSidedMesh._mesh.material)
        ? frontSidedMesh._mesh.material[0]
        : frontSidedMesh._mesh.material;

    assert.notEqual(doubleSidedMaterial, sharedMaterial);
    assert.equal(doubleSidedMaterial.side, DoubleSide);
    assert.equal(frontSidedMaterial, sharedMaterial);
    assert.equal(frontSidedMaterial.side, FrontSide);
    assert.equal(sharedMaterial.side, FrontSide);
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
    const expectedColors = [1, 0.5, 0.2, 0.25, 0.5, 0.75];
    assert.ok(hydraMesh._colors);
    const colors = hydraMesh._colors;
    assert.equal(colors.length, expectedColors.length);
    for (let index = 0; index < expectedColors.length; index += 1) {
        assert.ok(
            Math.abs(colors[index] - expectedColors[index]) <= 1e-6,
            `expected color[${index}]=${colors[index]} to be close to ${expectedColors[index]}`,
        );
    }
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
    (outerMesh as any).restackSiblingVisualProtoMeshes('/go2_description/base_link');
    (innerMesh as any).restackSiblingVisualProtoMeshes('/go2_description/base_link');

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
        material: assignedMaterials[group.materialIndex ?? 0]?.name ?? null,
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
        material: assignedMaterials[group.materialIndex ?? 0]?.name ?? null,
    }));

    assert.deepEqual(groupSummary, [
        { start: 0, count: 6, material: 'primary_shell' },
        { start: 6, count: 6, material: 'accent_shell' },
        { start: 12, count: 6, material: 'accent_shell' },
        { start: 18, count: 18, material: 'accent_shell' },
    ]);
});

test('HydraMesh repairs valid but near-sideways face-varying normals before rendering', () => {
    const hydraMesh = new HydraMesh('Mesh', '/b2_description/FR_calf/visuals.proto_mesh_id0', createHydraInterfaceStub());

    hydraMesh._geometry.setAttribute(
        'position',
        new Float32BufferAttribute([
            0, 0, 0,
            1, 0, 0,
            0, 1, 0,
        ], 3),
    );
    hydraMesh._geometry.setAttribute(
        'normal',
        new Float32BufferAttribute([
            1, 0, 0,
            0, 0, 1,
            0, 0, 1,
        ], 3),
    );
    hydraMesh._needsNormalSanitization = true;

    hydraMesh.sanitizeNormalsIfNeeded();

    const repairedNormals = hydraMesh._geometry.getAttribute('normal')?.array;
    assert.ok(repairedNormals);
    assert.equal(repairedNormals[0], 0);
    assert.equal(repairedNormals[1], 0);
    assert.equal(repairedNormals[2], 1);
});

test('HydraMesh accepts expanded proto triangles after dropping stale shared indices and repairs their normals', () => {
    const hydraMesh = new HydraMesh('Mesh', '/b2_description/FR_calf/visuals.proto_mesh_id0', createHydraInterfaceStub());
    const points = new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
        1, 0, 0,
        1, 1, 0,
        0, 1, 0,
    ]);
    const staleSharedVertexIndices = new Uint32Array([0, 1, 2, 1, 3, 2]);
    const sidewaysNormals = new Float32Array([
        1, 0, 0,
        1, 0, 0,
        1, 0, 0,
        1, 0, 0,
        1, 0, 0,
        1, 0, 0,
    ]);

    const applied = hydraMesh.tryApplyProtoDataBlobFastPath({
        allowForceRefreshRetry: false,
        replaceExistingGeometry: true,
        blobOverride: {
            valid: true,
            transform: new Float32Array([
                1, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                0, 0, 0, 1,
            ]),
            numVertices: 6,
            points,
            numIndices: 6,
            indices: staleSharedVertexIndices,
            numNormals: 6,
            normals: sidewaysNormals,
            normalsDimension: 3,
            numUVs: 0,
            uvDimension: 0,
            normalDiagnostics: {
                normalSource: 'generatedVertexExpanded',
            },
        },
    });

    assert.equal(applied, true);
    assert.equal(hydraMesh._geometry.getIndex(), null);
    hydraMesh.sanitizeNormalsIfNeeded();

    const renderedPositions = hydraMesh._geometry.getAttribute('position')?.array;
    const renderedNormals = hydraMesh._geometry.getAttribute('normal')?.array;
    assert.ok(renderedPositions);
    assert.ok(renderedNormals);
    assert.equal(countLowDotTriangleNormals(points, sidewaysNormals), 6);
    assert.equal(countLowDotTriangleNormals(renderedPositions, renderedNormals), 0);
});

test('HydraMesh applies render-ready non-indexed proto buffers without JS topology inference', () => {
    const hydraMesh = new HydraMesh('Mesh', '/b2_description/FR_calf/visuals.proto_mesh_id0', createHydraInterfaceStub());
    const points = new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
        1, 0, 0,
        1, 1, 0,
        0, 1, 0,
    ]);
    const finalNormals = new Float32Array([
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
    ]);
    const finalUvs = new Float32Array([
        0, 0,
        1, 0,
        0, 1,
        1, 0,
        1, 1,
        0, 1,
    ]);

    const applied = hydraMesh.tryApplyProtoDataBlobFastPath({
        allowForceRefreshRetry: false,
        replaceExistingGeometry: true,
        blobOverride: {
            valid: true,
            renderReady: true,
            topologyMode: 'nonIndexed',
            transform: new Float32Array([
                1, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                0, 0, 0, 1,
            ]),
            numVertices: 6,
            points,
            numIndices: 6,
            indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
            numNormals: 6,
            normals: finalNormals,
            normalsDimension: 3,
            numUVs: 6,
            uv: finalUvs,
            uvDimension: 2,
            normalDiagnostics: {
                normalSource: 'generatedVertex',
                normalRepairCount: 0,
                normalFallbackCount: 0,
                postRepairLowDotCount: 0,
            },
        },
    });

    assert.equal(applied, true);
    assert.equal(hydraMesh._geometry.getIndex(), null);
    assert.deepEqual(Array.from(hydraMesh._geometry.getAttribute('position').array), Array.from(points));
    assert.deepEqual(Array.from(hydraMesh._geometry.getAttribute('normal').array), Array.from(finalNormals));
    assert.deepEqual(Array.from(hydraMesh._geometry.getAttribute('uv').array), Array.from(finalUvs));
    assert.equal(hydraMesh._expandedSharedVertexIndices, undefined);
});

test('HydraMesh preserves valid indexed proto geometry with unused trailing vertices', () => {
    const hydraMesh = new HydraMesh('Mesh', '/robot/indexed/visuals.proto_mesh_id0', createHydraInterfaceStub());
    const points = new Float32Array([
        0, 0, 0,
        1, 0, 0,
        1, 1, 0,
        0, 1, 0,
        10, 10, 0,
        11, 10, 0,
    ]);
    const indices = new Uint32Array([0, 1, 2, 2, 3, 0]);

    const applied = hydraMesh.tryApplyProtoDataBlobFastPath({
        allowForceRefreshRetry: false,
        replaceExistingGeometry: true,
        blobOverride: {
            valid: true,
            transform: new Float32Array([
                1, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                0, 0, 0, 1,
            ]),
            numVertices: 6,
            points,
            numIndices: 6,
            indices,
            numNormals: 0,
            normalsDimension: 3,
            numUVs: 0,
            uvDimension: 0,
        },
    });

    const renderedIndex = hydraMesh._geometry.getIndex();
    assert.equal(applied, true);
    assert.ok(renderedIndex);
    assert.deepEqual(Array.from(renderedIndex.array), Array.from(indices));
    assert.equal(hydraMesh._expandedSharedVertexIndices, undefined);
});

test('HydraMesh completes collision proto sync from baked scene data even while strict scene bake is pending', () => {
    const hydraInterface = createHydraInterfaceStub() as any;
    hydraInterface.strictOneShotSceneLoad = true;
    hydraInterface.shouldDeferProtoStageSyncUntilSceneSnapshot = () => true;
    hydraInterface._finalStageOverrideBatchCache = new Map([
        [
            '/Robot/base_link/collisions.proto_box_id0',
            {
                valid: true,
                meshId: '/Robot/base_link/collisions.proto_box_id0',
                sectionName: 'collisions',
                primType: 'cube',
                size: 1,
                worldTransformElements: [
                    1, 0, 0, 0,
                    0, 1, 0, 0,
                    0, 0, 1, 0,
                    0, 0, 0, 1,
                ],
            },
        ],
    ]);
    hydraInterface.getCollisionProtoOverride = (meshId: string) =>
        hydraInterface._finalStageOverrideBatchCache.get(meshId) ?? null;
    hydraInterface.getResolvedPrimPathForMeshId = () => null;
    hydraInterface.getCollisionLocalXformOverride = () => null;
    hydraInterface.getWorldTransformForPrimPath = () => null;

    const hydraMesh = new HydraMesh(
        'Mesh',
        '/Robot/base_link/collisions.proto_box_id0',
        hydraInterface,
    );

    hydraMesh.applyProtoStageSync({ allowDeferredFinalBatch: false });

    assert.equal(hydraMesh._hasCompletedProtoSync, true);
    assert.equal(hydraMesh._appliedCollisionOverride, true);
    assert.ok(hydraMesh._geometry.getAttribute('position')?.count > 0);
});

test('HydraMesh applies USD primitive descriptor types to matching Three.js geometry classes', () => {
    const cubeMesh = new HydraMesh(
        'Mesh',
        '/Robot/base_link/collisions.proto_box_id0',
        createHydraInterfaceStub(),
    );
    const cylinderMesh = new HydraMesh(
        'Mesh',
        '/Robot/base_link/collisions.proto_cylinder_id0',
        createHydraInterfaceStub(),
    );

    assert.equal(
        cubeMesh.applyPrimitiveGeometryFromDescriptor('cube', {
            extentSize: [0.2, 0.4, 1.2],
        }),
        true,
    );
    assert.equal(
        cylinderMesh.applyPrimitiveGeometryFromDescriptor('cylinder', {
            radius: 0.08,
            height: 0.7,
            axis: 'Z',
        }),
        true,
    );

    assert.equal(cubeMesh._geometry instanceof BoxGeometry, true);
    assert.equal(cylinderMesh._geometry instanceof CylinderGeometry, true);
});

test('HydraMesh does not generate JS primitive fallback geometry for strict USD proto meshes', () => {
    const hydraInterface = createHydraInterfaceStub() as any;
    hydraInterface.strictOneShotSceneLoad = true;
    hydraInterface.shouldDeferProtoStageSyncUntilSceneSnapshot = () => false;
    hydraInterface.getCollisionProtoOverride = () => null;
    hydraInterface.getResolvedPrimPathForMeshId = () => null;
    hydraInterface.getCollisionOverridePrimPath = () => null;
    hydraInterface.getVisualColorOverride = () => null;
    hydraInterface.getCollisionLocalXformOverride = () => null;
    hydraInterface.getWorldTransformForPrimPath = () => null;
    hydraInterface.getSafeFallbackTransformForMeshId = () => null;
    hydraInterface.getVisualWorldTransformFromUrdfTruth = () => null;
    hydraInterface.getCollisionWorldTransformFromUrdfTruth = () => null;
    hydraInterface.getRepresentativeVisualTransformForMeshId = () => null;

    const hydraMesh = new HydraMesh(
        'Mesh',
        '/Robot/base_link/collisions.proto_box_id0',
        hydraInterface,
    );

    hydraMesh.commit();

    assert.equal(hydraMesh._hasGeneratedPrimitiveFallback, false);
    assert.equal(hydraMesh._geometry.getAttribute('position'), undefined);
    assert.equal(hydraMesh._hasCompletedProtoSync, false);
});

test('HydraMesh does not generate fixed-size fallback cylinders while collision dimensions are pending', () => {
    const hydraInterface = createHydraInterfaceStub() as any;
    hydraInterface.strictOneShotSceneLoad = false;
    hydraInterface.getCollisionProtoOverride = () => null;
    hydraInterface.getResolvedPrimPathForMeshId = () => null;
    hydraInterface.getCollisionOverridePrimPath = () => null;

    const hydraMesh = new HydraMesh(
        'Mesh',
        '/Robot/RR_hip/collisions.proto_cylinder_id0',
        hydraInterface,
    );

    hydraMesh.ensurePrimitiveFallbackGeometry();

    assert.equal(hydraMesh._geometry.getAttribute('position'), undefined);
    assert.equal(hydraMesh._hasGeneratedPrimitiveFallback, false);

    hydraInterface.getCollisionProtoOverride = () => ({
        valid: true,
        primType: 'cylinder',
        radius: 0.5,
        height: 1,
        axis: 'Z',
    });
    hydraInterface.getCollisionPrimitiveGeometryOverride = () => ({
        radius: 0.07,
        height: 0.05,
        axis: 'Z',
    });
    hydraInterface.getCollisionLocalXformOverride = () => null;
    hydraInterface.getWorldTransformForPrimPath = () => null;

    hydraMesh.ensurePrimitiveFallbackGeometry();

    assert.equal(hydraMesh._geometry instanceof CylinderGeometry, true);
    assert.equal(hydraMesh._hasGeneratedPrimitiveFallback, true);
    assert.equal(hydraMesh._appliedCollisionOverride, true);
    hydraMesh._geometry.computeBoundingBox();
    const size = hydraMesh._geometry.boundingBox!.getSize(new Vector3());
    assert.ok(Math.abs(size.x - 0.14) < 1e-6);
    assert.ok(Math.abs(size.y - 0.14) < 1e-6);
    assert.ok(Math.abs(size.z - 0.05) < 1e-6);
});

test('HydraMesh strict baked primitive overrides require authored size evidence', () => {
    const cases = [
        ['cube', 'box'],
        ['sphere', 'sphere'],
        ['cylinder', 'cylinder'],
        ['capsule', 'capsule'],
    ] as const;

    for (const [primType, protoType] of cases) {
        const meshId = `/Robot/base_link/collisions.proto_${protoType}_id0`;
        const hydraInterface = createHydraInterfaceStub() as any;
        hydraInterface.strictOneShotSceneLoad = true;
        hydraInterface._finalStageOverrideBatchCache = new Map([
            [
                meshId,
                {
                    valid: true,
                    meshId,
                    sectionName: 'collisions',
                    primType,
                    worldTransformElements: [
                        1, 0, 0, 0,
                        0, 1, 0, 0,
                        0, 0, 1, 0,
                        0, 0, 0, 1,
                    ],
                },
            ],
        ]);
        hydraInterface.getCollisionLocalXformOverride = () => null;
        hydraInterface.getWorldTransformForPrimPath = () => null;

        const hydraMesh = new HydraMesh('Mesh', meshId, hydraInterface);

        hydraMesh.ensurePrimitiveFallbackGeometry();

        assert.equal(
            hydraMesh._geometry.getAttribute('position'),
            undefined,
            `${primType} should not synthesize geometry without descriptor dimensions`,
        );
        assert.equal(hydraMesh._appliedCollisionOverride, false, `${primType} should not apply collision override`);
        assert.equal(hydraMesh._hasCompletedProtoSync, false, `${primType} should keep proto sync pending`);
    }
});
