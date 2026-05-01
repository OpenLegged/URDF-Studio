import test from 'node:test';
import assert from 'node:assert/strict';
import { Color, MeshPhysicalMaterial, Texture } from 'three';

import * as SharedBasic from './shared-basic.js';
import {
    parseColliderEntriesFromLayerText,
    parseUrdfMaterialMetadataFromLayerText,
    parseVisualSemanticChildNamesFromLayerText,
} from './shared-basic.js';
import { ThreeRenderDelegateInterface } from './ThreeRenderDelegateInterface.js';

const exportedBaseLayerText = `#usda 1.0
def Xform "Robot"
{
    def Xform "base_link"
    {
        def Xform "visuals"
        {
            def Xform "gripper"
            {
                custom string urdf:materialColor = "#12ab34"
                custom string urdf:materialTexture = "textures/base_color.png"
                def Mesh "mesh"
                {
                }
            }
        }
        def Xform "collisions"
        {
            def Xform "collision_0"
            {
                uniform token purpose = "guide"
                def Cube "cube"
                {
                }
            }
        }
        def Xform "arm_link"
        {
            def Xform "visuals"
            {
                def Xform "camera"
                {
                    custom string urdf:materialColor = "#abcdef"
                    def Mesh "mesh"
                    {
                    }
                }
            }
            def Xform "collisions"
            {
                def Xform "collision_1"
                {
                    uniform token purpose = "guide"
                    def Cylinder "cylinder"
                    {
                    }
                }
            }
        }
    }
}`;

const exportedStandardMaterialBindingLayerText = `#usda 1.0
def Xform "Robot"
{
    def Scope "Looks"
    {
        def Material "Mat_0"
        {
        }
        def Material "Mat_1"
        {
        }
        def Material "Mat_2"
        {
        }
    }
    def Xform "base_link"
    {
        def Xform "visuals"
        {
            def Xform "visual_0"
            {
                def Mesh "mesh"
                {
                    def GeomSubset "subset_0" (
                        prepend apiSchemas = ["MaterialBindingAPI"]
                    )
                    {
                        token elementType = "face"
                        token familyName = "materialBind"
                        int[] indices = [0, 1, 2, 3, 7, 8]
                        rel material:binding = </Robot/Looks/Mat_0>
                    }
                    def GeomSubset "subset_1" (
                        prepend apiSchemas = ["MaterialBindingAPI"]
                    )
                    {
                        token elementType = "face"
                        token familyName = "materialBind"
                        int[] indices = [4, 5, 6]
                        rel material:binding = </Robot/Looks/Mat_1>
                    }
                }
            }
            def Xform "visual_1"
            {
                rel material:binding = </Robot/Looks/Mat_2>
                def Mesh "mesh"
                {
                }
            }
        }
    }
}`;

const exportedReferencedStandardMaterialBindingRootLayerText = `#usda 1.0
def Xform "Robot" (
    prepend references = @configuration/b2_description_base.usd@
)
{
}`;

const unitreeReferencedMeshLibraryLayerText = `#usda 1.0
def Xform "go2_description"
{
    def Scope "__MeshLibrary"
    {
        def Mesh "Geometry_6"
        {
        }
    }
    def Scope "Looks"
    {
        def Material "Material_0"
        {
        }
        def Material "Material_6"
        {
        }
    }
    def Xform "FR_calf"
    {
        def Xform "visuals"
        {
            def Xform "visual_0"
            {
                def Mesh "mesh" (
                    prepend references = </go2_description/__MeshLibrary/Geometry_6>
                )
                {
                    def GeomSubset "subset_0" (
                        prepend apiSchemas = ["MaterialBindingAPI"]
                    )
                    {
                        token elementType = "face"
                        token familyName = "materialBind"
                        int[] indices = [0, 1, 2, 3]
                        rel material:binding = </go2_description/Looks/Material_6>
                    }
                    def GeomSubset "subset_1" (
                        prepend apiSchemas = ["MaterialBindingAPI"]
                    )
                    {
                        token elementType = "face"
                        token familyName = "materialBind"
                        int[] indices = [4, 5, 6]
                        rel material:binding = </go2_description/Looks/Material_0>
                    }
                }
            }
        }
    }
}`;

const unitreeReferencedMeshLibraryWithLibraryDefaultLayerText = `#usda 1.0
def Xform "go2_description"
{
    def Scope "__MeshLibrary"
    {
        def Mesh "Geometry_6"
        {
            rel material:binding = </go2_description/Looks/LibraryDefault>
        }
    }
    def Scope "Looks"
    {
        def Material "LibraryDefault"
        {
        }
        def Material "Material_6"
        {
        }
    }
    def Xform "FR_calf"
    {
        def Xform "visuals"
        {
            def Xform "visual_0"
            {
                def Mesh "mesh" (
                    prepend references = </go2_description/__MeshLibrary/Geometry_6>
                )
                {
                    def GeomSubset "subset_0" (
                        prepend apiSchemas = ["MaterialBindingAPI"]
                    )
                    {
                        token elementType = "face"
                        token familyName = "materialBind"
                        int[] indices = [0, 1, 2, 3]
                        rel material:binding = </go2_description/Looks/Material_6>
                    }
                }
            }
        }
    }
}`;

test('parseVisualSemanticChildNamesFromLayerText finds semantic children across nested link-local scopes', () => {
    const result = parseVisualSemanticChildNamesFromLayerText(exportedBaseLayerText);

    assert.deepEqual(result.get('base_link'), ['gripper']);
    assert.deepEqual(result.get('arm_link'), ['camera']);
});

test('parseColliderEntriesFromLayerText finds collider entries across nested link-local scopes', () => {
    const result = parseColliderEntriesFromLayerText(exportedBaseLayerText);

    assert.deepEqual(result.get('base_link'), [{ entryName: 'collision_0', referencePath: null }]);
    assert.deepEqual(result.get('arm_link'), [{ entryName: 'collision_1', referencePath: null }]);
});

test('parseUrdfMaterialMetadataFromLayerText extracts URDF export material metadata for nested visual prims', () => {
    const result = parseUrdfMaterialMetadataFromLayerText(exportedBaseLayerText);

    assert.deepEqual(result.get('/Robot/base_link/visuals/gripper'), {
        color: '#12ab34',
        texture: 'textures/base_color.png',
    });
    assert.deepEqual(result.get('/Robot/base_link/arm_link/visuals/camera'), {
        color: '#abcdef',
    });
});

test('parseUsdMaterialBindingsFromLayerText extracts direct bindings and compresses GeomSubset face runs', () => {
    assert.equal(typeof SharedBasic.parseUsdMaterialBindingsFromLayerText, 'function');

    const result = SharedBasic.parseUsdMaterialBindingsFromLayerText(
        exportedStandardMaterialBindingLayerText,
    );

    assert.ok(result instanceof Map);
    assert.deepEqual(result.get('/Robot/base_link/visuals/visual_0/mesh'), {
        materialId: null,
        geomSubsetSections: [
            { start: 0, length: 4, materialId: '/Robot/Looks/Mat_0' },
            { start: 4, length: 3, materialId: '/Robot/Looks/Mat_1' },
            { start: 7, length: 2, materialId: '/Robot/Looks/Mat_0' },
        ],
    });
    assert.deepEqual(result.get('/Robot/base_link/visuals/visual_1'), {
        materialId: '/Robot/Looks/Mat_2',
        geomSubsetSections: [],
    });
});

test('parseUsdMaterialBindingsFromLayerText aliases authored GeomSubset bindings to referenced mesh library targets', () => {
    const result = SharedBasic.parseUsdMaterialBindingsFromLayerText(
        unitreeReferencedMeshLibraryLayerText,
    );

    const expectedBinding = {
        materialId: null,
        geomSubsetSections: [
            { start: 0, length: 4, materialId: '/go2_description/Looks/Material_6' },
            { start: 4, length: 3, materialId: '/go2_description/Looks/Material_0' },
        ],
    };
    assert.deepEqual(result.get('/go2_description/FR_calf/visuals/visual_0/mesh'), expectedBinding);
    assert.deepEqual(result.get('/go2_description/__MeshLibrary/Geometry_6'), expectedBinding);
});

test('parseUsdMaterialBindingsFromLayerText preserves mesh library direct bindings while aliasing authored GeomSubsets', () => {
    const result = SharedBasic.parseUsdMaterialBindingsFromLayerText(
        unitreeReferencedMeshLibraryWithLibraryDefaultLayerText,
    );

    assert.deepEqual(result.get('/go2_description/FR_calf/visuals/visual_0/mesh'), {
        materialId: null,
        geomSubsetSections: [
            { start: 0, length: 4, materialId: '/go2_description/Looks/Material_6' },
        ],
    });
    assert.deepEqual(result.get('/go2_description/__MeshLibrary/Geometry_6'), {
        materialId: '/go2_description/Looks/LibraryDefault',
        geomSubsetSections: [
            { start: 0, length: 4, materialId: '/go2_description/Looks/Material_6' },
        ],
    });
});

test('normalizeRobotSceneSnapshot restores Unitree authored GeomSubset materials for mesh library descriptors', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        location: { search: '' },
    };
    try {
        const delegate = new ThreeRenderDelegateInterface({
            stage: () => ({
                GetRootLayer: () => ({
                    ExportToString: () => unitreeReferencedMeshLibraryLayerText,
                }),
                GetUsedLayers: () => [],
                GetDefaultPrim: () => ({
                    GetPath: () => ({ pathString: '/go2_description' }),
                }),
            }),
            driver: () => null,
            allowDriverStageLookup: false,
        });

        const snapshot = delegate.normalizeRobotSceneSnapshot({
            generatedAtMs: 1,
            stage: {
                stageSourcePath: '/tmp/go2_description.usda',
                defaultPrimPath: '/go2_description',
            },
            robotTree: {
                linkParentPairs: [['/go2_description/FR_calf', null]],
                jointCatalogEntries: [],
                rootLinkPaths: ['/go2_description/FR_calf'],
            },
            physics: {
                linkDynamicsEntries: [],
            },
            render: {
                meshDescriptors: [{
                    meshId: '/go2_description/__MeshLibrary/Geometry_6',
                    resolvedPrimPath: '/go2_description/__MeshLibrary/Geometry_6',
                    sectionName: 'visuals',
                    primType: 'mesh',
                }],
                materials: [{
                    materialId: '/go2_description/Looks/Material_0',
                    name: 'Material_0',
                }, {
                    materialId: '/go2_description/Looks/Material_6',
                    name: 'Material_6',
                }],
            },
        }, {
            stageSourcePath: '/tmp/go2_description.usda',
        });

        assert.ok(snapshot);
        assert.deepEqual(snapshot.render.meshDescriptors[0].geometry.geomSubsetSections, [
            { start: 0, length: 4, materialId: '/go2_description/Looks/Material_6' },
            { start: 4, length: 3, materialId: '/go2_description/Looks/Material_0' },
        ]);
        assert.equal(snapshot.render.meshDescriptors[0].materialId, null);
        assert.equal(snapshot.render.meshDescriptors[0].geometry.materialId, null);
    }
    finally {
        globalThis.window = previousWindow;
    }
});

test('normalizeRobotSceneSnapshot synthesizes fallback material records from exported URDF metadata', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        location: { search: '' },
    };
    try {
        const delegate = new ThreeRenderDelegateInterface({
            stage: () => ({
                GetRootLayer: () => ({
                    ExportToString: () => exportedBaseLayerText,
                }),
                GetUsedLayers: () => [],
                GetDefaultPrim: () => ({
                    GetPath: () => ({ pathString: '/Robot' }),
                }),
            }),
            driver: () => null,
            allowDriverStageLookup: false,
        });
        delegate.createFallbackMaterialFromSnapshot = (materialId) => ({ materialId });

        const snapshot = delegate.normalizeRobotSceneSnapshot({
            generatedAtMs: 1,
            stage: {
                stageSourcePath: '/tmp/roundtrip.usda',
                defaultPrimPath: '/Robot',
            },
            robotTree: {
                linkParentPairs: [['/Robot/base_link', null]],
                jointCatalogEntries: [],
                rootLinkPaths: ['/Robot/base_link'],
            },
            physics: {
                linkDynamicsEntries: [],
            },
            render: {
                meshDescriptors: [{
                    meshId: '/Robot/base_link/visuals/gripper/mesh.proto_mesh_id0',
                    resolvedPrimPath: '/Robot/base_link/visuals/gripper/mesh',
                    sectionName: 'visuals',
                    primType: 'mesh',
                }],
                materials: [],
            },
        }, {
            stageSourcePath: '/tmp/roundtrip.usda',
        });

        assert.ok(snapshot);
        assert.equal(snapshot.render.materials.length, 1);
        assert.equal(snapshot.render.meshDescriptors[0].materialId, '/Robot/base_link/visuals/gripper/__urdf_material');

        const fallbackMaterial = snapshot.render.materials[0];
        const expectedColor = new Color('#12ab34');
        assert.equal(fallbackMaterial.materialId, '/Robot/base_link/visuals/gripper/__urdf_material');
        assert.equal(fallbackMaterial.mapPath, 'textures/base_color.png');
        assert.ok(Array.isArray(fallbackMaterial.color));
        assert.ok(Math.abs(fallbackMaterial.color[0] - expectedColor.r) < 1e-6);
        assert.ok(Math.abs(fallbackMaterial.color[1] - expectedColor.g) < 1e-6);
        assert.ok(Math.abs(fallbackMaterial.color[2] - expectedColor.b) < 1e-6);
    }
    finally {
        globalThis.window = previousWindow;
    }
});

test('normalizeRobotSceneSnapshot restores standard USD material bindings and GeomSubset sections for exported roundtrip layers', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        location: { search: '' },
    };
    try {
        const delegate = new ThreeRenderDelegateInterface({
            stage: () => ({
                GetRootLayer: () => ({
                    ExportToString: () => exportedStandardMaterialBindingLayerText,
                }),
                GetUsedLayers: () => [],
                GetDefaultPrim: () => ({
                    GetPath: () => ({ pathString: '/Robot' }),
                }),
            }),
            driver: () => null,
            allowDriverStageLookup: false,
        });

        const snapshot = delegate.normalizeRobotSceneSnapshot({
            generatedAtMs: 1,
            stage: {
                stageSourcePath: '/tmp/roundtrip-standard-materials.usda',
                defaultPrimPath: '/Robot',
            },
            robotTree: {
                linkParentPairs: [['/Robot/base_link', null]],
                jointCatalogEntries: [],
                rootLinkPaths: ['/Robot/base_link'],
            },
            physics: {
                linkDynamicsEntries: [],
            },
            render: {
                meshDescriptors: [{
                    meshId: '/Robot/base_link/visuals/visual_0/mesh',
                    resolvedPrimPath: '/Robot/base_link/visuals/visual_0/mesh',
                    sectionName: 'visuals',
                    primType: 'mesh',
                }, {
                    meshId: '/Robot/base_link/visuals/visual_1/mesh',
                    resolvedPrimPath: '/Robot/base_link/visuals/visual_1/mesh',
                    sectionName: 'visuals',
                    primType: 'mesh',
                }],
                materials: [{
                    materialId: '/Robot/Looks/Mat_0',
                    name: 'Mat_0',
                }, {
                    materialId: '/Robot/Looks/Mat_1',
                    name: 'Mat_1',
                }, {
                    materialId: '/Robot/Looks/Mat_2',
                    name: 'Mat_2',
                }],
            },
        }, {
            stageSourcePath: '/tmp/roundtrip-standard-materials.usda',
        });

        assert.ok(snapshot);
        assert.deepEqual(snapshot.render.meshDescriptors[0].geometry.geomSubsetSections, [
            { start: 0, length: 4, materialId: '/Robot/Looks/Mat_0' },
            { start: 4, length: 3, materialId: '/Robot/Looks/Mat_1' },
            { start: 7, length: 2, materialId: '/Robot/Looks/Mat_0' },
        ]);
        assert.equal(snapshot.render.meshDescriptors[0].materialId, null);
        assert.equal(snapshot.render.meshDescriptors[0].geometry.materialId, null);
        assert.equal(snapshot.render.meshDescriptors[1].materialId, '/Robot/Looks/Mat_2');
        assert.equal(snapshot.render.meshDescriptors[1].geometry.materialId, '/Robot/Looks/Mat_2');
    }
    finally {
        globalThis.window = previousWindow;
    }
});

test('normalizeRobotSceneSnapshot restores standard USD material bindings from referenced configuration layers when used layers are unavailable', () => {
    const previousWindow = globalThis.window;
    const rootStagePath = '/tmp/b2_description.usd';
    const referencedStagePath = '/tmp/configuration/b2_description_base.usd';
    globalThis.window = {
        location: { search: '' },
        USD: {
            UsdStage: {
                Open: (stagePath) => {
                    if (stagePath !== referencedStagePath) {
                        return null;
                    }
                    return {
                        GetRootLayer: () => ({
                            ExportToString: () => exportedStandardMaterialBindingLayerText,
                            identifier: stagePath,
                        }),
                    };
                },
            },
        },
    };
    try {
        const delegate = new ThreeRenderDelegateInterface({
            stage: () => ({
                GetRootLayer: () => ({
                    ExportToString: () => exportedReferencedStandardMaterialBindingRootLayerText,
                    identifier: 'blob:http://127.0.0.1:4173/fake-roundtrip-root',
                }),
                GetUsedLayers: () => [],
                GetDefaultPrim: () => ({
                    GetPath: () => ({ pathString: '/Robot' }),
                }),
            }),
            driver: () => null,
            allowDriverStageLookup: false,
        });

        const snapshot = delegate.normalizeRobotSceneSnapshot({
            generatedAtMs: 1,
            stage: {
                stageSourcePath: rootStagePath,
                defaultPrimPath: '/Robot',
            },
            robotTree: {
                linkParentPairs: [['/Robot/base_link', null]],
                jointCatalogEntries: [],
                rootLinkPaths: ['/Robot/base_link'],
            },
            physics: {
                linkDynamicsEntries: [],
            },
            render: {
                meshDescriptors: [{
                    meshId: '/Robot/base_link/visuals/visual_0/mesh',
                    resolvedPrimPath: '/Robot/base_link/visuals/visual_0/mesh',
                    sectionName: 'visuals',
                    primType: 'mesh',
                }, {
                    meshId: '/Robot/base_link/visuals/visual_1/mesh',
                    resolvedPrimPath: '/Robot/base_link/visuals/visual_1/mesh',
                    sectionName: 'visuals',
                    primType: 'mesh',
                }],
                materials: [{
                    materialId: '/Robot/Looks/Mat_0',
                    name: 'Mat_0',
                }, {
                    materialId: '/Robot/Looks/Mat_1',
                    name: 'Mat_1',
                }, {
                    materialId: '/Robot/Looks/Mat_2',
                    name: 'Mat_2',
                }],
            },
        }, {
            stageSourcePath: rootStagePath,
        });

        assert.ok(snapshot);
        assert.deepEqual(snapshot.render.meshDescriptors[0].geometry.geomSubsetSections, [
            { start: 0, length: 4, materialId: '/Robot/Looks/Mat_0' },
            { start: 4, length: 3, materialId: '/Robot/Looks/Mat_1' },
            { start: 7, length: 2, materialId: '/Robot/Looks/Mat_0' },
        ]);
        assert.equal(snapshot.render.meshDescriptors[0].materialId, null);
        assert.equal(snapshot.render.meshDescriptors[0].geometry.materialId, null);
        assert.equal(snapshot.render.meshDescriptors[1].materialId, '/Robot/Looks/Mat_2');
        assert.equal(snapshot.render.meshDescriptors[1].geometry.materialId, '/Robot/Looks/Mat_2');
    }
    finally {
        globalThis.window = previousWindow;
    }
});

test('normalizeRobotSceneSnapshot restores standard USD material bindings from the loaded stage layer stack', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        location: { search: '' },
    };
    try {
        const rootStagePath = '/tmp/b2_description.viewer_roundtrip.usd';
        const referencedStagePath = '/tmp/configuration/b2_description_base.usd';
        const layerStack = {
            size: () => 2,
            get: (index) => {
                if (index === 0) {
                    return {
                        ExportToString: () => exportedReferencedStandardMaterialBindingRootLayerText,
                        identifier: 'blob:http://127.0.0.1:4173/fake-roundtrip-root',
                    };
                }
                if (index === 1) {
                    return {
                        ExportToString: () => exportedStandardMaterialBindingLayerText,
                        identifier: referencedStagePath,
                    };
                }
                return null;
            },
        };
        const delegate = new ThreeRenderDelegateInterface({
            stage: () => ({
                GetRootLayer: () => ({
                    ExportToString: () => exportedReferencedStandardMaterialBindingRootLayerText,
                    identifier: 'blob:http://127.0.0.1:4173/fake-roundtrip-root',
                }),
                GetLayerStack: () => layerStack,
                GetUsedLayers: () => [],
                GetDefaultPrim: () => ({
                    GetPath: () => ({ pathString: '/Robot' }),
                }),
            }),
            driver: () => null,
            allowDriverStageLookup: false,
        });

        const snapshot = delegate.normalizeRobotSceneSnapshot({
            generatedAtMs: 1,
            stage: {
                stageSourcePath: rootStagePath,
                defaultPrimPath: '/Robot',
            },
            robotTree: {
                linkParentPairs: [['/Robot/base_link', null]],
                jointCatalogEntries: [],
                rootLinkPaths: ['/Robot/base_link'],
            },
            physics: {
                linkDynamicsEntries: [],
            },
            render: {
                meshDescriptors: [{
                    meshId: '/Robot/base_link/visuals/visual_0/mesh',
                    resolvedPrimPath: '/Robot/base_link/visuals/visual_0/mesh',
                    sectionName: 'visuals',
                    primType: 'mesh',
                }, {
                    meshId: '/Robot/base_link/visuals/visual_1/mesh',
                    resolvedPrimPath: '/Robot/base_link/visuals/visual_1/mesh',
                    sectionName: 'visuals',
                    primType: 'mesh',
                }],
                materials: [{
                    materialId: '/Robot/Looks/Mat_0',
                    name: 'Mat_0',
                }, {
                    materialId: '/Robot/Looks/Mat_1',
                    name: 'Mat_1',
                }, {
                    materialId: '/Robot/Looks/Mat_2',
                    name: 'Mat_2',
                }],
            },
        }, {
            stageSourcePath: rootStagePath,
        });

        assert.ok(snapshot);
        assert.deepEqual(snapshot.render.meshDescriptors[0].geometry.geomSubsetSections, [
            { start: 0, length: 4, materialId: '/Robot/Looks/Mat_0' },
            { start: 4, length: 3, materialId: '/Robot/Looks/Mat_1' },
            { start: 7, length: 2, materialId: '/Robot/Looks/Mat_0' },
        ]);
        assert.equal(snapshot.render.meshDescriptors[1].materialId, '/Robot/Looks/Mat_2');
        assert.equal(snapshot.render.meshDescriptors[1].geometry.materialId, '/Robot/Looks/Mat_2');
    }
    finally {
        globalThis.window = previousWindow;
    }
});

test('normalizeRobotSceneSnapshot restores standard USD material bindings by reopening the current stage path when the live stage handle is unavailable', () => {
    const previousWindow = globalThis.window;
    const rootStagePath = '/tmp/b2_description.viewer_roundtrip.usd';
    const referencedStagePath = '/tmp/configuration/b2_description_base.usd';
    globalThis.window = {
        location: { search: '' },
        USD: {
            UsdStage: {
                Open: (stagePath) => {
                    if (stagePath === rootStagePath) {
                        return {
                            GetRootLayer: () => ({
                                ExportToString: () => exportedReferencedStandardMaterialBindingRootLayerText,
                                identifier: rootStagePath,
                            }),
                            GetUsedLayers: () => [],
                        };
                    }
                    if (stagePath === referencedStagePath) {
                        return {
                            GetRootLayer: () => ({
                                ExportToString: () => exportedStandardMaterialBindingLayerText,
                                identifier: referencedStagePath,
                            }),
                            GetUsedLayers: () => [],
                        };
                    }
                    return null;
                },
            },
        },
    };
    try {
        const delegate = new ThreeRenderDelegateInterface({
            stage: () => null,
            driver: () => null,
            allowDriverStageLookup: false,
        });

        const snapshot = delegate.normalizeRobotSceneSnapshot({
            generatedAtMs: 1,
            stage: {
                stageSourcePath: rootStagePath,
                defaultPrimPath: '/Robot',
            },
            robotTree: {
                linkParentPairs: [['/Robot/base_link', null]],
                jointCatalogEntries: [],
                rootLinkPaths: ['/Robot/base_link'],
            },
            physics: {
                linkDynamicsEntries: [],
            },
            render: {
                meshDescriptors: [{
                    meshId: '/Robot/base_link/visuals/visual_0/mesh',
                    resolvedPrimPath: '/Robot/base_link/visuals/visual_0/mesh',
                    sectionName: 'visuals',
                    primType: 'mesh',
                }, {
                    meshId: '/Robot/base_link/visuals/visual_1/mesh',
                    resolvedPrimPath: '/Robot/base_link/visuals/visual_1/mesh',
                    sectionName: 'visuals',
                    primType: 'mesh',
                }],
                materials: [{
                    materialId: '/Robot/Looks/Mat_0',
                    name: 'Mat_0',
                }, {
                    materialId: '/Robot/Looks/Mat_1',
                    name: 'Mat_1',
                }, {
                    materialId: '/Robot/Looks/Mat_2',
                    name: 'Mat_2',
                }],
            },
        }, {
            stageSourcePath: rootStagePath,
        });

        assert.ok(snapshot);
        assert.deepEqual(snapshot.render.meshDescriptors[0].geometry.geomSubsetSections, [
            { start: 0, length: 4, materialId: '/Robot/Looks/Mat_0' },
            { start: 4, length: 3, materialId: '/Robot/Looks/Mat_1' },
            { start: 7, length: 2, materialId: '/Robot/Looks/Mat_0' },
        ]);
        assert.equal(snapshot.render.meshDescriptors[1].materialId, '/Robot/Looks/Mat_2');
        assert.equal(snapshot.render.meshDescriptors[1].geometry.materialId, '/Robot/Looks/Mat_2');
    }
    finally {
        globalThis.window = previousWindow;
    }
});

test('normalizeRobotSceneSnapshot caches parsed material recovery data for repeated isaacsim roundtrip loads', () => {
    const previousWindow = globalThis.window;
    const rootStagePath = '/tmp/b2_description.usd';
    const referencedStagePath = '/tmp/configuration/b2_description_base.usd';
    globalThis.window = {
        location: { search: '' },
    };
    try {
        const layerStack = {
            size: () => 2,
            get: (index) => {
                if (index === 0) {
                    return {
                        ExportToString: () => exportedReferencedStandardMaterialBindingRootLayerText,
                        identifier: rootStagePath,
                    };
                }
                if (index === 1) {
                    return {
                        ExportToString: () => exportedStandardMaterialBindingLayerText,
                        identifier: referencedStagePath,
                    };
                }
                return null;
            },
        };
        const delegate = new ThreeRenderDelegateInterface({
            stage: () => ({
                GetRootLayer: () => ({
                    ExportToString: () => exportedReferencedStandardMaterialBindingRootLayerText,
                    identifier: rootStagePath,
                }),
                GetLayerStack: () => layerStack,
                GetUsedLayers: () => [],
                GetDefaultPrim: () => ({
                    GetPath: () => ({ pathString: '/Robot' }),
                }),
            }),
            driver: () => null,
            allowDriverStageLookup: false,
        });
        const rawSnapshot = {
            generatedAtMs: 1,
            stage: {
                stageSourcePath: rootStagePath,
                defaultPrimPath: '/Robot',
            },
            robotTree: {
                linkParentPairs: [['/Robot/base_link', null]],
                jointCatalogEntries: [],
                rootLinkPaths: ['/Robot/base_link'],
            },
            physics: {
                linkDynamicsEntries: [],
            },
            render: {
                meshDescriptors: [{
                    meshId: '/Robot/base_link/visuals/visual_0/mesh',
                    resolvedPrimPath: '/Robot/base_link/visuals/visual_0/mesh',
                    sectionName: 'visuals',
                    primType: 'mesh',
                }, {
                    meshId: '/Robot/base_link/visuals/visual_1/mesh',
                    resolvedPrimPath: '/Robot/base_link/visuals/visual_1/mesh',
                    sectionName: 'visuals',
                    primType: 'mesh',
                }],
                materials: [{
                    materialId: '/Robot/Looks/Mat_0',
                    name: 'Mat_0',
                }, {
                    materialId: '/Robot/Looks/Mat_1',
                    name: 'Mat_1',
                }, {
                    materialId: '/Robot/Looks/Mat_2',
                    name: 'Mat_2',
                }],
            },
        };

        const firstSnapshot = delegate.normalizeRobotSceneSnapshot(rawSnapshot, {
            stageSourcePath: rootStagePath,
        });
        assert.ok(firstSnapshot);
        const cacheEntry = delegate._roundtripMaterialRecoveryByStageSource?.get(rootStagePath);
        assert.ok(cacheEntry, 'expected repeated isaacsim roundtrip loads to cache parsed stage recovery data');
        assert.ok(cacheEntry.urdfMaterialMetadataByPrimPath instanceof Map);
        assert.ok(cacheEntry.usdMaterialBindingsByPrimPath instanceof Map);

        const secondSnapshot = delegate.normalizeRobotSceneSnapshot(rawSnapshot, {
            stageSourcePath: rootStagePath,
        });
        assert.ok(secondSnapshot);
        assert.strictEqual(
            delegate._roundtripMaterialRecoveryByStageSource.get(rootStagePath),
            cacheEntry,
            'expected repeated isaacsim roundtrip loads to reuse the cached parsed stage recovery data',
        );
        assert.deepEqual(secondSnapshot.render.meshDescriptors[0].geometry.geomSubsetSections, [
            { start: 0, length: 4, materialId: '/Robot/Looks/Mat_0' },
            { start: 4, length: 3, materialId: '/Robot/Looks/Mat_1' },
            { start: 7, length: 2, materialId: '/Robot/Looks/Mat_0' },
        ]);
        assert.equal(secondSnapshot.render.meshDescriptors[1].materialId, '/Robot/Looks/Mat_2');
        assert.equal(secondSnapshot.render.meshDescriptors[1].geometry.materialId, '/Robot/Looks/Mat_2');
    }
    finally {
        globalThis.window = previousWindow;
    }
});

test('normalizeRobotSceneSnapshot synthesizes mesh descriptors from proto blobs when driver omits descriptors', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        location: { search: '' },
    };
    try {
        const delegate = new ThreeRenderDelegateInterface({
            stage: () => ({
                GetRootLayer: () => ({
                    ExportToString: () => '#usda 1.0\n',
                }),
                GetUsedLayers: () => [],
                GetDefaultPrim: () => ({
                    GetPath: () => ({ pathString: '/Robot' }),
                }),
            }),
            driver: () => null,
            allowDriverStageLookup: false,
        });
        delegate.getResolvedVisualTransformPrimPathForMeshId = (meshId) => (
            meshId === '/Robot/base_link/visuals.proto_mesh_id0'
                ? '/Robot/base_link/visuals/mesh'
                : null
        );

        const snapshot = delegate.normalizeRobotSceneSnapshot({
            generatedAtMs: 1,
            stage: {
                stageSourcePath: '/tmp/runtime-proto-blob.usda',
                defaultPrimPath: '/Robot',
            },
            robotTree: {
                linkParentPairs: [['/Robot/base_link', null]],
                jointCatalogEntries: [],
                rootLinkPaths: ['/Robot/base_link'],
            },
            physics: {
                linkDynamicsEntries: [],
            },
            render: {
                meshDescriptors: [],
                materials: [{
                    materialId: '/Robot/Looks/base_link',
                    name: 'base_link',
                }],
                protoDataBlobs: {
                    '/Robot/base_link/visuals.proto_mesh_id0': {
                        valid: true,
                        numVertices: 3,
                        points: Float32Array.from([
                            0, 0, 0,
                            1, 0, 0,
                            0, 1, 0,
                        ]),
                        numIndices: 3,
                        indices: Uint32Array.from([0, 1, 2]),
                        numNormals: 3,
                        normalsDimension: 3,
                        normals: Float32Array.from([
                            0, 0, 1,
                            0, 0, 1,
                            0, 0, 1,
                        ]),
                        numUVs: 3,
                        uvDimension: 2,
                        uv: Float32Array.from([
                            0, 0,
                            1, 0,
                            0, 1,
                        ]),
                        transform: Float32Array.from([
                            1, 0, 0, 0,
                            0, 1, 0, 0,
                            0, 0, 1, 0,
                            0, 0, 0, 1,
                        ]),
                        materialId: '/Robot/Looks/base_link',
                    },
                },
            },
        }, {
            stageSourcePath: '/tmp/runtime-proto-blob.usda',
        });

        assert.ok(snapshot);
        assert.equal(snapshot.render.meshDescriptors.length, 1);
        assert.equal(snapshot.render.meshDescriptors[0].meshId, '/Robot/base_link/visuals.proto_mesh_id0');
        assert.equal(snapshot.render.meshDescriptors[0].resolvedPrimPath, '/Robot/base_link/visuals/mesh');
        assert.equal(snapshot.render.meshDescriptors[0].sectionName, 'visuals');
        assert.equal(snapshot.render.meshDescriptors[0].primType, 'mesh');
        assert.equal(snapshot.render.meshDescriptors[0].geometry.numVertices, 3);
        assert.equal(snapshot.render.meshDescriptors[0].geometry.materialId, '/Robot/Looks/base_link');
        assert.equal(snapshot.render.meshDescriptors[0].ranges.positions.count, 9);
        assert.equal(snapshot.render.meshDescriptors[0].ranges.indices.count, 3);
        assert.equal(snapshot.render.protoBlobCount, 1);
        assert.equal(snapshot.buffers.positions.length, 9);
        assert.equal(snapshot.buffers.indices.length, 3);
    }
    finally {
        globalThis.window = previousWindow;
    }
});

test('normalizeRobotSceneSnapshot synthesizes mesh descriptors from live Hydra meshes when snapshot payload is incomplete', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        location: { search: '' },
    };
    try {
        const delegate = new ThreeRenderDelegateInterface({
            stage: () => ({
                GetRootLayer: () => ({
                    ExportToString: () => '#usda 1.0\n',
                }),
                GetUsedLayers: () => [],
                GetDefaultPrim: () => ({
                    GetPath: () => ({ pathString: '/Robot' }),
                }),
            }),
            driver: () => null,
            allowDriverStageLookup: false,
        });
        delegate.getResolvedVisualTransformPrimPathForMeshId = (meshId) => (
            meshId === '/Robot/base_link/visuals.proto_mesh_id0'
                ? '/Robot/base_link/visuals/mesh'
                : null
        );
        delegate.meshes = {
            '/Robot/base_link/visuals.proto_mesh_id0': {
                _id: '/Robot/base_link/visuals.proto_mesh_id0',
                _pendingMaterialId: '/Robot/Looks/base_link',
                _mesh: {
                    updateWorldMatrix() {},
                    matrixWorld: {
                        elements: [
                            1, 0, 0, 0,
                            0, 1, 0, 0,
                            0, 0, 1, 0,
                            0, 0, 0, 1,
                        ],
                    },
                    geometry: {
                        getAttribute(name) {
                            if (name === 'position') {
                                return {
                                    count: 3,
                                    itemSize: 3,
                                    array: Float32Array.from([
                                        0, 0, 0,
                                        0, 1, 0,
                                        0, 0, 1,
                                    ]),
                                };
                            }
                            if (name === 'normal') {
                                return {
                                    count: 3,
                                    itemSize: 3,
                                    array: Float32Array.from([
                                        1, 0, 0,
                                        1, 0, 0,
                                        1, 0, 0,
                                    ]),
                                };
                            }
                            if (name === 'uv') {
                                return {
                                    count: 3,
                                    itemSize: 2,
                                    array: Float32Array.from([
                                        0, 0,
                                        1, 0,
                                        0, 1,
                                    ]),
                                };
                            }
                            return null;
                        },
                        getIndex() {
                            return {
                                count: 3,
                                array: Uint16Array.from([0, 1, 2]),
                            };
                        },
                    },
                },
            },
        };

        const snapshot = delegate.normalizeRobotSceneSnapshot({
            generatedAtMs: 1,
            stage: {
                stageSourcePath: '/tmp/runtime-live-mesh.usda',
                defaultPrimPath: '/Robot',
            },
            robotTree: {
                linkParentPairs: [['/Robot/base_link', null]],
                jointCatalogEntries: [],
                rootLinkPaths: ['/Robot/base_link'],
            },
            physics: {
                linkDynamicsEntries: [],
            },
            render: {
                meshDescriptors: [],
                materials: [{
                    materialId: '/Robot/Looks/base_link',
                    name: 'base_link',
                }],
                meshDescriptorFormat: 'packed-v2',
                meshDescriptorHeaders: Int32Array.from([]),
                meshDescriptorScalars: Float32Array.from([]),
                meshDescriptorGeomSubsetSections: {},
            },
            buffers: {
                positions: Float32Array.from([]),
                indices: Uint32Array.from([]),
                normals: Float32Array.from([]),
                uvs: Float32Array.from([]),
                transforms: Float32Array.from([]),
                rangesByMeshId: {},
            },
        }, {
            stageSourcePath: '/tmp/runtime-live-mesh.usda',
        });

        assert.ok(snapshot);
        assert.equal(snapshot.render.meshDescriptors.length, 1);
        assert.equal(snapshot.render.meshDescriptors[0].meshId, '/Robot/base_link/visuals.proto_mesh_id0');
        assert.equal(snapshot.render.meshDescriptors[0].resolvedPrimPath, '/Robot/base_link/visuals/mesh');
        assert.equal(snapshot.render.meshDescriptors[0].sectionName, 'visuals');
        assert.equal(snapshot.render.meshDescriptors[0].geometry.numVertices, 3);
        assert.equal(snapshot.render.meshDescriptors[0].geometry.materialId, '/Robot/Looks/base_link');
        assert.equal(snapshot.render.meshDescriptors[0].ranges.positions.count, 9);
        assert.equal(snapshot.render.meshDescriptors[0].ranges.indices.count, 3);
        assert.equal(snapshot.render.protoBlobCount, 1);
        assert.equal(snapshot.buffers.positions.length, 9);
        assert.equal(snapshot.buffers.indices.length, 3);
    }
    finally {
        globalThis.window = previousWindow;
    }
});

test('normalizeRobotSceneSnapshot synthesizes mesh descriptors for generic CAD-style mesh instance paths', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        location: { search: '' },
    };
    try {
        const delegate = new ThreeRenderDelegateInterface({
            stage: () => ({
                GetRootLayer: () => ({
                    ExportToString: () => '#usda 1.0\n',
                }),
                GetUsedLayers: () => [],
                GetDefaultPrim: () => ({
                    GetPath: () => ({ pathString: '/_7SO101' }),
                }),
            }),
            driver: () => null,
            allowDriverStageLookup: false,
        });
        delegate.getResolvedVisualTransformPrimPathForMeshId = (meshId) => (
            meshId === '/_7SO101/MeshInstance/实体1'
                ? '/_7SO101/MeshInstance'
                : null
        );

        const snapshot = delegate.normalizeRobotSceneSnapshot({
            generatedAtMs: 1,
            stage: {
                stageSourcePath: '/tmp/7SO101.usdc',
                defaultPrimPath: '/_7SO101',
            },
            robotTree: {
                linkParentPairs: [],
                jointCatalogEntries: [],
                rootLinkPaths: [],
            },
            physics: {
                linkDynamicsEntries: [],
            },
            render: {
                meshDescriptors: [],
                materials: [],
                protoDataBlobs: {
                    '/_7SO101/MeshInstance/实体1': {
                        valid: true,
                        numVertices: 3,
                        points: Float32Array.from([
                            0, 0, 0,
                            1, 0, 0,
                            0, 1, 0,
                        ]),
                        numIndices: 3,
                        indices: Uint32Array.from([0, 1, 2]),
                        numNormals: 3,
                        normalsDimension: 3,
                        normals: Float32Array.from([
                            0, 0, 1,
                            0, 0, 1,
                            0, 0, 1,
                        ]),
                        numUVs: 0,
                        uvDimension: 2,
                        uv: Float32Array.from([]),
                        transform: Float32Array.from([
                            1, 0, 0, 0,
                            0, 1, 0, 0,
                            0, 0, 1, 0,
                            0, 0, 0, 1,
                        ]),
                    },
                },
            },
        }, {
            stageSourcePath: '/tmp/7SO101.usdc',
        });

        assert.ok(snapshot);
        assert.equal(snapshot.render.meshDescriptors.length, 1);
        assert.equal(snapshot.render.meshDescriptors[0].meshId, '/_7SO101/MeshInstance/实体1');
        assert.equal(snapshot.render.meshDescriptors[0].resolvedPrimPath, '/_7SO101/MeshInstance');
        assert.equal(snapshot.render.meshDescriptors[0].sectionName, 'visuals');
        assert.equal(snapshot.render.meshDescriptors[0].primType, 'mesh');
        assert.equal(snapshot.render.meshDescriptors[0].geometry.numVertices, 3);
        assert.equal(snapshot.render.protoBlobCount, 1);
    }
    finally {
        globalThis.window = previousWindow;
    }
});

test('normalizeRobotSceneSnapshot serializes preferred live visual materials by link path', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        location: { search: '' },
    };
    try {
        const delegate = new ThreeRenderDelegateInterface({
            stage: () => ({
                GetRootLayer: () => ({
                    ExportToString: () => '#usda 1.0\n',
                }),
                GetUsedLayers: () => [],
                GetDefaultPrim: () => ({
                    GetPath: () => ({ pathString: '/Robot' }),
                }),
            }),
            driver: () => null,
            allowDriverStageLookup: false,
        });
        const preferredMaterial = new MeshPhysicalMaterial({
            color: new Color('#d6d9e4'),
            roughness: 0.28,
            metalness: 0.63,
            emissive: new Color('#223344'),
            emissiveIntensity: 1.4,
            opacity: 0.85,
            transparent: true,
            transmission: 0.18,
            thickness: 0.12,
            ior: 1.45,
            clearcoat: 0.22,
            clearcoatRoughness: 0.41,
        });
        preferredMaterial.name = 'Body';
        preferredMaterial.map = new Texture();
        preferredMaterial.map.name = 'textures/body_basecolor.png';
        preferredMaterial.roughnessMap = new Texture();
        preferredMaterial.roughnessMap.name = 'textures/body_roughness.png';
        preferredMaterial.normalMap = new Texture();
        preferredMaterial.normalMap.name = 'textures/body_normal.png';
        preferredMaterial.alphaMap = new Texture();
        preferredMaterial.alphaMap.name = 'textures/body_opacity.png';
        delegate.getPreferredVisualMaterialForLink = (linkPath) => (
            linkPath === '/Robot/base_link'
                ? preferredMaterial
                : null
        );

        const snapshot = delegate.normalizeRobotSceneSnapshot({
            generatedAtMs: 1,
            stage: {
                stageSourcePath: '/tmp/preferred-material.usda',
                defaultPrimPath: '/Robot',
            },
            robotTree: {
                linkParentPairs: [['/Robot/base_link', null]],
                jointCatalogEntries: [],
                rootLinkPaths: ['/Robot/base_link'],
            },
            physics: {
                linkDynamicsEntries: [],
            },
            render: {
                meshDescriptors: [{
                    meshId: '/Robot/base_link/visuals.proto_mesh_id0',
                    resolvedPrimPath: '/Robot/base_link/visuals/base_link',
                    sectionName: 'visuals',
                    primType: 'mesh',
                }],
                materials: [],
            },
        }, {
            stageSourcePath: '/tmp/preferred-material.usda',
        });

        assert.ok(snapshot.render.preferredVisualMaterialsByLinkPath);
        const preferredRecord = snapshot.render.preferredVisualMaterialsByLinkPath['/Robot/base_link'];
        assert.equal(preferredRecord.name, 'Body');
        assert.ok(Array.isArray(preferredRecord.color));
        const expectedColor = new Color('#d6d9e4');
        assert.ok(Math.abs(preferredRecord.color[0] - expectedColor.r) < 1e-6);
        assert.ok(Math.abs(preferredRecord.color[1] - expectedColor.g) < 1e-6);
        assert.ok(Math.abs(preferredRecord.color[2] - expectedColor.b) < 1e-6);
        assert.equal(preferredRecord.opacity, 0.85);
        assert.equal(preferredRecord.roughness, 0.28);
        assert.equal(preferredRecord.metalness, 0.63);
        assert.ok(Array.isArray(preferredRecord.emissive));
        assert.equal(preferredRecord.emissiveIntensity, 1.4);
        assert.equal(preferredRecord.transmission, 0.18);
        assert.equal(preferredRecord.thickness, 0.12);
        assert.equal(preferredRecord.ior, 1.45);
        assert.equal(preferredRecord.clearcoat, 0.22);
        assert.equal(preferredRecord.clearcoatRoughness, 0.41);
        assert.equal(preferredRecord.mapPath, 'textures/body_basecolor.png');
        assert.equal(preferredRecord.roughnessMapPath, 'textures/body_roughness.png');
        assert.equal(preferredRecord.normalMapPath, 'textures/body_normal.png');
        assert.equal(preferredRecord.alphaMapPath, 'textures/body_opacity.png');
    }
    finally {
        globalThis.window = previousWindow;
    }
});

test('normalizeRobotSceneSnapshot enriches sparse raw material records with stage-authored fallback parameters', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        location: { search: '' },
    };
    try {
        const delegate = new ThreeRenderDelegateInterface({
            stage: () => ({
                GetRootLayer: () => ({
                    ExportToString: () => '#usda 1.0\n',
                }),
                GetUsedLayers: () => [],
                GetDefaultPrim: () => ({
                    GetPath: () => ({ pathString: '/Robot' }),
                }),
            }),
            driver: () => null,
            allowDriverStageLookup: false,
        });
        const stageFallbackMaterial = new MeshPhysicalMaterial({
            color: new Color('#90a4b8'),
            emissive: new Color('#102030'),
            emissiveIntensity: 1.6,
            roughness: 0.33,
            metalness: 0.72,
            opacity: 0.84,
            transparent: true,
            clearcoat: 0.18,
            clearcoatRoughness: 0.42,
        });
        stageFallbackMaterial.name = 'BodyPaint';
        delegate.createFallbackMaterialFromStage = (materialId) => ({
            _id: materialId,
            _nodes: {},
            _interface: delegate,
            _material: stageFallbackMaterial,
        });

        const snapshot = delegate.normalizeRobotSceneSnapshot({
            generatedAtMs: 1,
            stage: {
                stageSourcePath: '/tmp/sparse-material.usda',
                defaultPrimPath: '/Robot',
            },
            robotTree: {
                linkParentPairs: [['/Robot/base_link', null]],
                jointCatalogEntries: [],
                rootLinkPaths: ['/Robot/base_link'],
            },
            physics: {
                linkDynamicsEntries: [],
            },
            render: {
                meshDescriptors: [{
                    meshId: '/Robot/base_link/visuals.proto_mesh_id0',
                    resolvedPrimPath: '/Robot/base_link/visuals/base_link',
                    sectionName: 'visuals',
                    primType: 'mesh',
                    materialId: '/Robot/Looks/body',
                    geometry: {
                        materialId: '/Robot/Looks/body',
                        geomSubsetSections: [],
                    },
                }],
                materials: [{
                    materialId: '/Robot/Looks/body',
                    name: 'BodyPaint',
                }],
            },
        }, {
            stageSourcePath: '/tmp/sparse-material.usda',
        });

        assert.ok(snapshot);
        assert.equal(snapshot.render.materials.length, 1);
        const materialRecord = snapshot.render.materials[0];
        const expectedColor = new Color('#90a4b8');
        const expectedEmissive = new Color('#102030');
        assert.equal(materialRecord.materialId, '/Robot/Looks/body');
        assert.equal(materialRecord.name, 'BodyPaint');
        assert.ok(Array.isArray(materialRecord.color));
        assert.ok(Math.abs(materialRecord.color[0] - expectedColor.r) < 1e-6);
        assert.ok(Math.abs(materialRecord.color[1] - expectedColor.g) < 1e-6);
        assert.ok(Math.abs(materialRecord.color[2] - expectedColor.b) < 1e-6);
        assert.ok(Array.isArray(materialRecord.emissive));
        assert.ok(Math.abs(materialRecord.emissive[0] - expectedEmissive.r) < 1e-6);
        assert.ok(Math.abs(materialRecord.emissive[1] - expectedEmissive.g) < 1e-6);
        assert.ok(Math.abs(materialRecord.emissive[2] - expectedEmissive.b) < 1e-6);
        assert.equal(materialRecord.roughness, 0.33);
        assert.equal(materialRecord.metalness, 0.72);
        assert.equal(materialRecord.opacity, 0.84);
        assert.equal(materialRecord.clearcoat, 0.18);
        assert.equal(materialRecord.clearcoatRoughness, 0.42);
        assert.equal(materialRecord.emissiveIntensity, 1.6);
    }
    finally {
        globalThis.window = previousWindow;
    }
});

test('normalizeRobotSceneSnapshot prefers richer stage-built metadata over incomplete raw scene metadata', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        location: { search: '' },
    };
    try {
        const delegate = new ThreeRenderDelegateInterface({
            stage: () => ({
                GetRootLayer: () => ({
                    ExportToString: () => '#usda 1.0\n',
                }),
                GetUsedLayers: () => [],
                GetDefaultPrim: () => ({
                    GetPath: () => ({ pathString: '/Robot' }),
                }),
            }),
            driver: () => null,
            allowDriverStageLookup: false,
        });
        delegate.buildRobotMetadataSnapshotForStage = () => ({
            stageSourcePath: '/tmp/b2-helper-links.usda',
            generatedAtMs: 2,
            source: 'usd-stage-cpp',
            linkParentPairs: [
                ['/Robot/base_link', null],
                ['/Robot/base_link/imu_link', '/Robot/base_link'],
            ],
            jointCatalogEntries: [{
                jointPath: '/Robot/joints/joint_imu',
                jointName: 'joint_imu',
                jointTypeName: 'PhysicsFixedJoint',
                linkPath: '/Robot/base_link/imu_link',
                parentLinkPath: '/Robot/base_link',
                originXyz: [0, 0, 0.05],
                originQuatWxyz: [1, 0, 0, 0],
                axis: [1, 0, 0],
            }],
            linkDynamicsEntries: [],
            meshCountsByLinkPath: {},
        });

        const snapshot = delegate.normalizeRobotSceneSnapshot({
            generatedAtMs: 1,
            stage: {
                stageSourcePath: '/tmp/b2-helper-links.usda',
                defaultPrimPath: '/Robot',
            },
            robotTree: {
                linkParentPairs: [['/Robot/base_link', null]],
                jointCatalogEntries: [],
                rootLinkPaths: ['/Robot/base_link'],
            },
            physics: {
                linkDynamicsEntries: [],
            },
            robotMetadataSnapshot: {
                stageSourcePath: '/tmp/b2-helper-links.usda',
                generatedAtMs: 1,
                source: 'robot-scene-snapshot',
                linkParentPairs: [['/Robot/base_link', null]],
                jointCatalogEntries: [],
                linkDynamicsEntries: [],
                meshCountsByLinkPath: {},
            },
            render: {
                meshDescriptors: [],
                materials: [],
            },
        }, {
            stageSourcePath: '/tmp/b2-helper-links.usda',
        });

        assert.ok(snapshot);
        assert.equal(snapshot.robotMetadataSnapshot.jointCatalogEntries.length, 1);
        assert.ok(snapshot.robotTree.linkParentPairs.some(([childPath, parentPath]) => childPath === '/Robot/base_link/imu_link' && parentPath === '/Robot/base_link'));
        assert.equal(delegate.getCachedRobotMetadataSnapshot('/tmp/b2-helper-links.usda')?.jointCatalogEntries?.length, 1);
    }
    finally {
        globalThis.window = previousWindow;
    }
});
