import test from 'node:test';
import assert from 'node:assert/strict';

import { ThreeRenderDelegateCore } from './ThreeRenderDelegateCore.js';

const exportedRootLayerText = `#usda 1.0
(
    defaultPrim = "Robot"
    upAxis = "Z"
    metersPerUnit = 1
    subLayers = [
        @configuration/two_link_robot_description_base.usd@,
        @configuration/two_link_robot_description_physics.usd@,
        @configuration/two_link_robot_description_sensor.usd@,
    ]
)
`;

const exportedBaseLayerText = `#usda 1.0
(
    defaultPrim = "Robot"
    upAxis = "Z"
    metersPerUnit = 1
)

def Xform "Robot"
{
    def Xform "base_link"
    {
        def Xform "visuals"
        {
            def Cube "visual_0"
            {
            }
        }

        def Xform "collisions"
        {
            def Cube "collision_0"
            {
                uniform token purpose = "guide"
            }
        }

        def Xform "link1"
        {
            double3 xformOp:translate = (1, 2, 3)
            quatf xformOp:orient = (0.707107, 0, 0, 0.707107)
            uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:orient"]

            def Xform "visuals"
            {
                def Cylinder "visual_0"
                {
                }
            }

            def Xform "collisions"
            {
                def Sphere "collision_0"
                {
                    uniform token purpose = "guide"
                }
            }
        }
    }
}
`;

const exportedPhysicsLayerText = `#usda 1.0
(
    defaultPrim = "Robot"
)

over "Robot"
{
    prepend apiSchemas = ["PhysicsArticulationRootAPI"]

    over "base_link"
    {
        prepend apiSchemas = ["PhysicsRigidBodyAPI", "PhysicsMassAPI"]
        float physics:mass = 2
        float3 physics:centerOfMass = (0.01, 0.02, 0.03)
        float3 physics:diagonalInertia = (0.1, 0.2, 0.3)
        quatf physics:principalAxes = (1, 0, 0, 0)

        over "collisions"
        {
            over "collision_0"
            {
                bool physics:collisionEnabled = true
            }
        }

        over "link1"
        {
            prepend apiSchemas = ["PhysicsRigidBodyAPI", "PhysicsMassAPI"]
            float physics:mass = 1.25
            float3 physics:centerOfMass = (0.1, 0.2, 0.3)
            float3 physics:diagonalInertia = (1, 2, 3)
            quatf physics:principalAxes = (1, 0, 0, 0)

            over "collisions"
            {
                over "collision_0"
                {
                    bool physics:collisionEnabled = true
                }
            }
        }
    }
}

def Scope "joints"
{
    def PhysicsRevoluteJoint "joint_link1"
    {
        rel physics:body0 = </Robot/base_link>
        rel physics:body1 = </Robot/base_link/link1>
        uniform token physics:axis = "Z"
        custom float3 urdf:axisLocal = (0, 0, -1)
        float physics:lowerLimit = -90
        float physics:upperLimit = 60
        point3f physics:localPos0 = (1, 2, 3)
        quatf physics:localRot0 = (0.707107, 0, 0, 0.707107)
        point3f physics:localPos1 = (0, 0, 0)
        quatf physics:localRot1 = (1, 0, 0, 0)
    }
}
`;

const exportedTinyDynamicsPhysicsLayerText = `#usda 1.0
(
    defaultPrim = "Robot"
)

over "Robot"
{
    prepend apiSchemas = ["PhysicsArticulationRootAPI"]

    over "base_link"
    {
        prepend apiSchemas = ["PhysicsRigidBodyAPI", "PhysicsMassAPI"]
        float physics:mass = 2
        float3 physics:centerOfMass = (0.01, 0.02, 0.03)
        float3 physics:diagonalInertia = (0.1, 0.2, 0.3)
        quatf physics:principalAxes = (1, 0, 0, 0)

        over "collisions"
        {
            over "collision_0"
            {
                bool physics:collisionEnabled = true
            }
        }

        over "link1"
        {
            prepend apiSchemas = ["PhysicsRigidBodyAPI", "PhysicsMassAPI"]
            float physics:mass = 4.19e-15
            float3 physics:centerOfMass = (1e-27, -2e-27, -1.307861e-11)
            float3 physics:diagonalInertia = (1.094396e-28, 2.287836e-28, 3.417764e-28)
            quatf physics:principalAxes = (1, 0, 0, 0)

            over "collisions"
            {
                over "collision_0"
                {
                    bool physics:collisionEnabled = true
                }
            }
        }
    }
}

def Scope "joints"
{
    def PhysicsRevoluteJoint "joint_link1"
    {
        rel physics:body0 = </Robot/base_link>
        rel physics:body1 = </Robot/base_link/link1>
        uniform token physics:axis = "Z"
        custom float3 urdf:axisLocal = (0, 0, -1)
        float physics:lowerLimit = -90
        float physics:upperLimit = 60
        point3f physics:localPos0 = (1, 2, 3)
        quatf physics:localRot0 = (0.707107, 0, 0, 0.707107)
        point3f physics:localPos1 = (0, 0, 0)
        quatf physics:localRot1 = (1, 0, 0, 0)
    }
}
`;

const exportedSensorLayerText = `#usda 1.0
(
    defaultPrim = "Sensors"
)

def Xform "Sensors"
{
}
`;

function createLayer(text) {
    return {
        ExportToString() {
            return text;
        },
    };
}

function createFallbackMetadataDelegate(physicsLayerText = exportedPhysicsLayerText, stageSourcePath = '/robots/two_link_robot.usd') {
    const delegate = Object.create(ThreeRenderDelegateCore.prototype);
    delegate.meshes = {
        '/Robot/base_link/visuals.proto_mesh_id0': {},
        '/Robot/base_link/collisions.proto_box_id0': {},
        '/Robot/base_link/link1/visuals.proto_cylinder_id0': {},
        '/Robot/base_link/link1/collisions.proto_sphere_id0': {},
    };
    delegate._protoMeshMetadataByMeshId = new Map();
    delegate._robotMetadataSnapshotByStageSource = new Map();
    delegate._robotMetadataBuildPromisesByStageSource = new Map();
    delegate._nowPerfMs = () => 1234;
    delegate.getNormalizedStageSourcePath = () => stageSourcePath;
    delegate.getStage = () => ({
        GetRootLayer() {
            return createLayer(exportedRootLayerText);
        },
        GetUsedLayers() {
            return [
                createLayer(exportedBaseLayerText),
                createLayer(physicsLayerText),
                createLayer(exportedSensorLayerText),
            ];
        },
    });
    return delegate;
}

function createTruthHierarchyDelegate() {
    const delegate = Object.create(ThreeRenderDelegateCore.prototype);
    delegate.meshes = {
        '/Robot/base_link/visuals.proto_mesh_id0': {},
        '/Robot/base_link/FL_hip/visuals.proto_mesh_id0': {},
        '/Robot/base_link/FL_hip/FL_thigh/visuals.proto_mesh_id0': {},
    };
    delegate._protoMeshMetadataByMeshId = new Map();
    delegate._robotMetadataSnapshotByStageSource = new Map();
    delegate._robotMetadataBuildPromisesByStageSource = new Map();
    delegate._nowPerfMs = () => 1234;
    delegate.getNormalizedStageSourcePath = () => '/robots/unitree_b2.usd';
    delegate.getStage = () => null;
    return delegate;
}

test('buildRobotMetadataSnapshotForStage exposes missing driver metadata instead of reconstructing from exported stage layers', () => {
    const previousWindow = globalThis.window;
    globalThis.window = { driver: null };

    try {
        const delegate = createFallbackMetadataDelegate();
        delegate.getStageMetadataLayerTexts = () => {
            throw new Error('stage text metadata fallback should not run');
        };
        const snapshot = delegate.buildRobotMetadataSnapshotForStage('/robots/two_link_robot.usd', null);

        assert.ok(snapshot);
        assert.equal(snapshot.source, 'mesh-only');
        assert.equal(snapshot.stale, true);
        assert.ok(snapshot.errorFlags.includes('usd-driver-metadata-missing'));
        assert.deepEqual(snapshot.linkParentPairs, []);
        assert.deepEqual(snapshot.jointCatalogEntries, []);
        assert.deepEqual(snapshot.linkDynamicsEntries, []);

        assert.deepEqual(snapshot.meshCountsByLinkPath, {
            '/Robot/base_link': {
                visualMeshCount: 1,
                collisionMeshCount: 1,
                collisionPrimitiveCounts: { box: 1 },
            },
            '/Robot/base_link/link1': {
                visualMeshCount: 1,
                collisionMeshCount: 1,
                collisionPrimitiveCounts: { sphere: 1 },
            },
        });
    }
    finally {
        globalThis.window = previousWindow;
    }
});

test('buildRobotMetadataSnapshotForStage reuses cached stale mesh-only metadata for repeated imports without driver metadata', () => {
    const previousWindow = globalThis.window;
    globalThis.window = { driver: null };

    try {
        const delegate = createFallbackMetadataDelegate();
        delegate.getStageMetadataLayerTexts = () => {
            throw new Error('stage text metadata fallback should not run');
        };
        const firstSnapshot = delegate.buildRobotMetadataSnapshotForStage('/robots/two_link_robot.usd', null);
        const secondSnapshot = delegate.buildRobotMetadataSnapshotForStage('/robots/two_link_robot.usd', null);

        assert.ok(firstSnapshot);
        assert.equal(firstSnapshot.source, 'mesh-only');
        assert.equal(firstSnapshot.stale, true);
        assert.strictEqual(
            secondSnapshot,
            firstSnapshot,
            'expected repeated imports without driver metadata to reuse the cached stale snapshot',
        );
    }
    finally {
        globalThis.window = previousWindow;
    }
});

test('getStageMetadataLayerTexts stops reopening identical relative-path layer texts before recursion blows the stack', () => {
    const delegate = Object.create(ThreeRenderDelegateCore.prototype);
    delegate.safeExportLayerText = (layer) => layer?.ExportToString?.() || '';
    delegate.safeOpenUsdStage = (stagePath) => ({
        GetRootLayer() {
            return {
                identifier: stagePath,
                ExportToString() {
                    return exportedRootLayerText;
                },
            };
        },
    });

    const stage = {
        GetRootLayer() {
            return {
                identifier: 'unitree_model/B2/usd/b2.usd',
                ExportToString() {
                    return exportedRootLayerText;
                },
            };
        },
        GetUsedLayers() {
            return [];
        },
    };

    assert.doesNotThrow(() => {
        const layerTexts = delegate.getStageMetadataLayerTexts(stage, 'unitree_model/B2/usd/b2.usd');
        assert.deepEqual(layerTexts, [exportedRootLayerText.trim()]);
    });
});

test('stage text helper parsing skips large base layers before exporting their text', () => {
    const delegate = Object.create(ThreeRenderDelegateCore.prototype);
    delegate.stageSourcePath = '/robots/two_link_robot.usd';
    delegate._robotSceneSnapshotByStageSource = new Map();
    delegate._guideCollisionRefMapByStageSource = new Map();
    delegate._stageLayerTextParseCacheByStageSource = new Map();
    let exportedBaseLayer = false;

    delegate.getStage = () => ({
        GetRootLayer() {
            return {
                identifier: '/robots/two_link_robot.usd',
                ExportToString() {
                    return exportedRootLayerText;
                },
            };
        },
        GetUsedLayers() {
            return [
                {
                    identifier: '/robots/configuration/two_link_robot_description_base.usda',
                    ExportToString() {
                        exportedBaseLayer = true;
                        throw new Error('large base layer should not be exported');
                    },
                },
            ];
        },
    });

    const guideMap = delegate.getGuideCollisionReferenceMapForCurrentStage();

    assert.ok(guideMap instanceof Map);
    assert.equal(exportedBaseLayer, false);
});

test('stage text helper parsing reuses cached layer text across helper lookups', () => {
    const delegate = Object.create(ThreeRenderDelegateCore.prototype);
    delegate.stageSourcePath = '/robots/cached_stage.usd';
    delegate._robotSceneSnapshotByStageSource = new Map();
    delegate._guideCollisionRefMapByStageSource = new Map();
    delegate._visualSemanticChildMapByStageSource = new Map();
    delegate._xformOpFallbackMapByStageSource = new Map();
    delegate._stageLayerTextParseCacheByStageSource = new Map();
    let exportCount = 0;

    delegate.getStage = () => ({
        GetRootLayer() {
            return {
                identifier: '/robots/cached_stage.usd',
                ExportToString() {
                    exportCount += 1;
                    return exportedBaseLayerText;
                },
            };
        },
        GetUsedLayers() {
            return [];
        },
    });

    const visualMap = delegate.getVisualSemanticChildMapForCurrentStage();
    const guideMap = delegate.getGuideCollisionReferenceMapForCurrentStage();
    const xformMap = delegate.getXformOpFallbackMapForCurrentStage();

    assert.ok(visualMap instanceof Map);
    assert.ok(guideMap instanceof Map);
    assert.ok(xformMap instanceof Map);
    assert.equal(exportCount, 1);
});

test('buildRobotMetadataSnapshotForStage does not preserve tiny link dynamics from stage text without driver metadata', () => {
    const previousWindow = globalThis.window;
    globalThis.window = { driver: null };

    try {
        const delegate = createFallbackMetadataDelegate(
            exportedTinyDynamicsPhysicsLayerText,
            '/robots/two_link_robot_tiny_dynamics.usd',
        );
        delegate.getStageMetadataLayerTexts = () => {
            throw new Error('stage text metadata fallback should not run');
        };
        const snapshot = delegate.buildRobotMetadataSnapshotForStage('/robots/two_link_robot_tiny_dynamics.usd', null);

        assert.ok(snapshot);
        assert.equal(snapshot.source, 'mesh-only');
        assert.equal(snapshot.stale, true);
        assert.ok(snapshot.errorFlags.includes('usd-driver-metadata-missing'));
        assert.deepEqual(snapshot.linkDynamicsEntries, []);
    }
    finally {
        globalThis.window = previousWindow;
    }
});

test('buildRobotMetadataSnapshotForStage backfills missing joint origins from physics joint records returned by the driver', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        driver: {
            GetRobotMetadataSnapshot(sortedLinkPaths, stageSourcePath) {
                assert.deepEqual(sortedLinkPaths, [
                    '/Robot/base_link',
                    '/Robot/base_link/link1',
                ]);
                assert.equal(stageSourcePath, '/robots/two_link_robot.usd');
                return {
                    stageSourcePath,
                    source: 'usd-stage-cpp',
                    linkParentPairs: [
                        ['/Robot/base_link/link1', '/Robot/base_link'],
                    ],
                    jointCatalogEntries: [
                        {
                            linkPath: '/Robot/base_link/link1',
                            parentLinkPath: '/Robot/base_link',
                            jointName: 'joint_link1',
                            jointTypeName: 'revolute',
                            axisToken: 'Z',
                            localPivotInLink: [0, 0, 0],
                        },
                    ],
                    linkDynamicsEntries: [],
                };
            },
            GetPhysicsJointRecords() {
                return [
                    {
                        jointPath: '/Robot/joints/joint_link1',
                        jointName: 'joint_link1',
                        jointTypeName: 'PhysicsRevoluteJoint',
                        body0Path: '/Robot/base_link',
                        body1Path: '/Robot/base_link/link1',
                        axisToken: 'Z',
                        localPos0: [1, 2, 3],
                        localRot0Wxyz: [0.707107, 0, 0, 0.707107],
                        localPos1: [0, 0, 0],
                        localRot1Wxyz: [1, 0, 0, 0],
                        lowerLimitDeg: -90,
                        upperLimitDeg: 60,
                    },
                ];
            },
        },
    };

    try {
        const delegate = createFallbackMetadataDelegate();
        delegate.getStage = () => null;

        const snapshot = delegate.buildRobotMetadataSnapshotForStage('/robots/two_link_robot.usd', null);
        assert.ok(snapshot);
        assert.equal(snapshot.source, 'usd-stage-cpp');
        assert.equal(snapshot.jointCatalogEntries.length, 1);

        const joint = snapshot.jointCatalogEntries[0];
        assert.deepEqual(joint.originXyz, [1, 2, 3]);
        assert.deepEqual(joint.originQuatWxyz.map((value) => Number(value.toFixed(6))), [0.707107, 0, 0, 0.707107]);
    }
    finally {
        globalThis.window = previousWindow;
    }
});

test('buildRobotMetadataSnapshotForStage maps generic UsdPhysics driver joint records to floating metadata', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        driver: {
            GetRobotMetadataSnapshot(sortedLinkPaths, stageSourcePath) {
                assert.deepEqual(sortedLinkPaths, [
                    '/Robot/base_link',
                    '/Robot/base_link/link1',
                ]);
                assert.equal(stageSourcePath, '/robots/two_link_robot.usd');
                return {
                    stageSourcePath,
                    source: 'usd-stage-cpp',
                    linkParentPairs: [],
                    jointCatalogEntries: [],
                    linkDynamicsEntries: [],
                };
            },
            GetPhysicsJointRecords() {
                return [
                    {
                        jointPath: '/Robot/joints/joint_link1',
                        jointName: 'joint_link1',
                        jointTypeName: 'PhysicsJoint',
                        body0Path: '/Robot/base_link',
                        body1Path: '/Robot/base_link/link1',
                        axisToken: 'X',
                    },
                ];
            },
        },
    };

    try {
        const delegate = createFallbackMetadataDelegate();
        const snapshot = delegate.buildRobotMetadataSnapshotForStage('/robots/two_link_robot.usd', null);
        assert.ok(snapshot);
        assert.deepEqual(snapshot.linkParentPairs, [
            ['/Robot/base_link/link1', '/Robot/base_link'],
        ]);
        assert.equal(snapshot.jointCatalogEntries.length, 1);

        const joint = snapshot.jointCatalogEntries[0];
        assert.equal(joint.jointType, 'floating');
        assert.equal(joint.jointTypeName, 'PhysicsJoint');
        assert.equal(joint.lowerLimitDeg, 0);
        assert.equal(joint.upperLimitDeg, 0);
    }
    finally {
        globalThis.window = previousWindow;
    }
});

test('buildRobotMetadataSnapshotForStage recovers Newton direct physics collision primitives without Hydra meshes', () => {
    const previousWindow = globalThis.window;
    const newtonCartpoleLayerText = `#usda 1.0
(
    defaultPrim = "cartPole"
)

def Xform "cartPole"
{
    def Xform "rail" (
        prepend apiSchemas = ["PhysicsRigidBodyAPI"]
    )
    {
        def Cube "rail" (
            prepend apiSchemas = ["PhysicsCollisionAPI"]
        )
        {
            double size = 1
            float3 xformOp:scale = (0.03, 8, 0.03)
        }
    }

    def Xform "cart" (
        prepend apiSchemas = ["PhysicsRigidBodyAPI", "PhysicsMassAPI"]
    )
    {
        float3 xformOp:scale = (0.2, 0.25, 0.2)

        def Cube "cart" (
            prepend apiSchemas = ["PhysicsCollisionAPI"]
        )
        {
            double size = 1
        }
    }

    def Xform "pole1" (
        prepend apiSchemas = ["PhysicsRigidBodyAPI", "PhysicsMassAPI"]
    )
    {
        float3 xformOp:scale = (0.04, 0.06, 1)

        def Cube "pole1" (
            prepend apiSchemas = ["PhysicsCollisionAPI"]
        )
        {
            double size = 1
        }
    }
}
`;
    globalThis.window = {
        driver: {
            GetRobotMetadataSnapshot(sortedLinkPaths, stageSourcePath) {
                assert.ok(sortedLinkPaths.includes('/cartPole/rail'));
                assert.ok(sortedLinkPaths.includes('/cartPole/cart'));
                assert.ok(sortedLinkPaths.includes('/cartPole/pole1'));
                assert.equal(stageSourcePath, '/robots/newton/cartpole.usda');
                return {
                    stageSourcePath,
                    source: 'usd-stage-cpp',
                    linkParentPairs: [
                        ['/cartPole/rail', null],
                        ['/cartPole/cart', '/cartPole/rail'],
                        ['/cartPole/pole1', '/cartPole/cart'],
                    ],
                    jointCatalogEntries: [
                        {
                            linkPath: '/cartPole/cart',
                            parentLinkPath: '/cartPole/rail',
                            jointName: 'railCartJoint',
                            jointTypeName: 'PhysicsPrismaticJoint',
                            axisToken: 'Y',
                        },
                        {
                            linkPath: '/cartPole/pole1',
                            parentLinkPath: '/cartPole/cart',
                            jointName: 'cartPoleJoint',
                            jointTypeName: 'PhysicsRevoluteJoint',
                            axisToken: 'X',
                        },
                    ],
                    linkDynamicsEntries: [],
                };
            },
            GetPhysicsJointRecords() {
                return [
                    {
                        jointPath: '/cartPole/rootJoint',
                        jointName: 'rootJoint',
                        jointTypeName: 'PhysicsFixedJoint',
                        body1Path: '/cartPole/rail',
                    },
                    {
                        jointPath: '/cartPole/railCartJoint',
                        jointName: 'railCartJoint',
                        jointTypeName: 'PhysicsPrismaticJoint',
                        body0Path: '/cartPole/rail',
                        body1Path: '/cartPole/cart',
                    },
                    {
                        jointPath: '/cartPole/cartPoleJoint',
                        jointName: 'cartPoleJoint',
                        jointTypeName: 'PhysicsRevoluteJoint',
                        body0Path: '/cartPole/cart',
                        body1Path: '/cartPole/pole1',
                    },
                ];
            },
        },
    };

    try {
        const delegate = Object.create(ThreeRenderDelegateCore.prototype);
        delegate.meshes = {};
        delegate._protoMeshMetadataByMeshId = new Map();
        delegate._robotMetadataSnapshotByStageSource = new Map();
        delegate._robotMetadataBuildPromisesByStageSource = new Map();
        delegate._nowPerfMs = () => 1234;
        delegate.getNormalizedStageSourcePath = () => '/robots/newton/cartpole.usda';
        delegate.getStage = () => ({
            GetRootLayer() {
                return createLayer(newtonCartpoleLayerText);
            },
            GetUsedLayers() {
                return [];
            },
        });

        const snapshot = delegate.buildRobotMetadataSnapshotForStage('/robots/newton/cartpole.usda', null);

        assert.ok(snapshot);
        assert.equal(snapshot.source, 'usd-stage-cpp');
        assert.deepEqual(snapshot.meshCountsByLinkPath, {
            '/cartPole/cart': {
                visualMeshCount: 0,
                collisionMeshCount: 1,
                collisionPrimitiveCounts: { box: 1 },
                collisionPrimitiveGeometries: [
                    {
                        primitiveType: 'cube',
                        dimensions: [0.2, 0.25, 0.2],
                    },
                ],
            },
            '/cartPole/pole1': {
                visualMeshCount: 0,
                collisionMeshCount: 1,
                collisionPrimitiveCounts: { box: 1 },
                collisionPrimitiveGeometries: [
                    {
                        primitiveType: 'cube',
                        dimensions: [0.04, 0.06, 1],
                    },
                ],
            },
            '/cartPole/rail': {
                visualMeshCount: 0,
                collisionMeshCount: 1,
                collisionPrimitiveCounts: { box: 1 },
                collisionPrimitiveGeometries: [
                    {
                        primitiveType: 'cube',
                        dimensions: [0.03, 8, 0.03],
                    },
                ],
            },
        });
    }
    finally {
        globalThis.window = previousWindow;
    }
});

test('buildRobotMetadataSnapshotForStage derives joint origin quaternions from localRot0/localRot1 when authored USD origin data is missing', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        driver: {
            GetRobotMetadataSnapshot(sortedLinkPaths, stageSourcePath) {
                assert.deepEqual(sortedLinkPaths, [
                    '/Robot/base_link',
                    '/Robot/base_link/lidar_link',
                ]);
                assert.equal(stageSourcePath, '/robots/fixed_joint_rotation.usd');
                return {
                    stageSourcePath,
                    source: 'usd-stage-cpp',
                    linkParentPairs: [
                        ['/Robot/base_link/lidar_link', '/Robot/base_link'],
                    ],
                    jointCatalogEntries: [
                        {
                            linkPath: '/Robot/base_link/lidar_link',
                            parentLinkPath: '/Robot/base_link',
                            jointName: 'joint_lidar',
                            jointTypeName: 'fixed',
                            axisToken: 'X',
                            localPivotInLink: [0, 0, 0],
                        },
                    ],
                    linkDynamicsEntries: [],
                };
            },
            GetPhysicsJointRecords() {
                return [
                    {
                        jointPath: '/Robot/joints/joint_lidar',
                        jointName: 'joint_lidar',
                        jointTypeName: 'PhysicsFixedJoint',
                        body0Path: '/Robot/base_link',
                        body1Path: '/Robot/base_link/lidar_link',
                        axisToken: 'X',
                        localPos0: [0, 0, 0.05],
                        localRot0Wxyz: [0.707107, 0, 0.707107, 0],
                        localPos1: [0, 0, 0],
                        localRot1Wxyz: [0.707107, 0, 0.707107, 0],
                    },
                ];
            },
        },
    };

    try {
        const delegate = Object.create(ThreeRenderDelegateCore.prototype);
        delegate.meshes = {
            '/Robot/base_link/visuals.proto_mesh_id0': {},
        };
        delegate._protoMeshMetadataByMeshId = new Map();
        delegate._robotMetadataSnapshotByStageSource = new Map();
        delegate._robotMetadataBuildPromisesByStageSource = new Map();
        delegate._nowPerfMs = () => 1234;
        delegate.getNormalizedStageSourcePath = () => '/robots/fixed_joint_rotation.usd';
        delegate.getStage = () => null;

        const snapshot = delegate.buildRobotMetadataSnapshotForStage('/robots/fixed_joint_rotation.usd', null);
        assert.ok(snapshot);
        assert.equal(snapshot.jointCatalogEntries.length, 1);

        const joint = snapshot.jointCatalogEntries[0];
        assert.deepEqual(joint.originXyz, [0, 0, 0.05]);
        assert.deepEqual(joint.originQuatWxyz.map((value) => Number(value.toFixed(6))), [1, 0, 0, 0]);
    }
    finally {
        globalThis.window = previousWindow;
    }
});

test('buildRobotMetadataSnapshotForStage resolves truth-backed parent links against real ancestor paths', () => {
    const delegate = createTruthHierarchyDelegate();
    const truth = {
        jointByChildLinkName: new Map([
            ['FL_hip', {
                jointName: 'FL_hip_joint',
                jointType: 'revolute',
                parentLinkName: 'base_link',
                axisLocal: [1, 0, 0],
                lowerLimitDeg: -45,
                upperLimitDeg: 45,
                originXyz: [0.2, 0.1, 0],
                originQuatWxyz: [1, 0, 0, 0],
            }],
            ['FL_thigh', {
                jointName: 'FL_thigh_joint',
                jointType: 'revolute',
                parentLinkName: 'FL_hip',
                axisLocal: [0, 1, 0],
                lowerLimitDeg: -90,
                upperLimitDeg: 90,
                originXyz: [0, 0, -0.3],
                originQuatWxyz: [1, 0, 0, 0],
            }],
        ]),
        inertialByLinkName: new Map(),
    };

    const snapshot = delegate.buildRobotMetadataSnapshotForStage('/robots/unitree_b2.usd', truth);
    assert.ok(snapshot);
    assert.equal(snapshot.source, 'urdf-truth');

    const hipJoint = snapshot.jointCatalogEntries.find((entry) => entry.linkPath === '/Robot/base_link/FL_hip');
    const thighJoint = snapshot.jointCatalogEntries.find((entry) => entry.linkPath === '/Robot/base_link/FL_hip/FL_thigh');

    assert.ok(hipJoint);
    assert.ok(thighJoint);
    assert.equal(hipJoint.parentLinkPath, '/Robot/base_link');
    assert.equal(thighJoint.parentLinkPath, '/Robot/base_link/FL_hip');
    assert.ok(snapshot.linkParentPairs.some(([childPath, parentPath]) => childPath === '/Robot/base_link/FL_hip/FL_thigh' && parentPath === '/Robot/base_link/FL_hip'));
});

test('buildRobotMetadataSnapshotForStage prefers URDF truth instead of stage text metadata when driver metadata is missing', () => {
    const previousWindow = globalThis.window;
    globalThis.window = { driver: null };

    try {
        const delegate = createFallbackMetadataDelegate();
        const truth = {
            jointByChildLinkName: new Map([
                ['link1', {
                    jointName: 'truth_joint_link1',
                    jointType: 'fixed',
                    parentLinkName: 'base_link',
                    axisLocal: [1, 0, 0],
                    lowerLimitDeg: 0,
                    upperLimitDeg: 0,
                    originXyz: [9, 9, 9],
                    originQuatWxyz: [1, 0, 0, 0],
                }],
            ]),
            inertialByLinkName: new Map([
                ['link1', {
                    mass: 99,
                    centerOfMassLocal: [9, 9, 9],
                    diagonalInertia: [9, 9, 9],
                    principalAxesLocalWxyz: [1, 0, 0, 0],
                }],
            ]),
        };

        const snapshot = delegate.buildRobotMetadataSnapshotForStage('/robots/two_link_robot.usd', truth);
        assert.ok(snapshot);
        assert.equal(snapshot.source, 'urdf-truth');
        assert.equal(snapshot.stale, true);
        assert.ok(snapshot.errorFlags.includes('usd-driver-metadata-missing'));

        const joint = snapshot.jointCatalogEntries.find((entry) => entry.linkPath === '/Robot/base_link/link1');
        assert.ok(joint);
        assert.equal(joint.jointName, 'truth_joint_link1');
        assert.equal(joint.jointType, 'fixed');
        assert.deepEqual(joint.axisLocal, [1, 0, 0]);
        assert.deepEqual(joint.originXyz, [9, 9, 9]);

        const dynamics = snapshot.linkDynamicsEntries.find((entry) => entry.linkPath === '/Robot/base_link/link1');
        assert.ok(dynamics);
        assert.equal(dynamics.mass, 99);
        assert.deepEqual(dynamics.centerOfMassLocal, [9, 9, 9]);
        assert.deepEqual(dynamics.diagonalInertia, [9, 9, 9]);
    }
    finally {
        globalThis.window = previousWindow;
    }
});

test('buildRobotMetadataSnapshotForStage seeds helper links from driver joint records even when they have no render meshes', () => {
    const previousWindow = globalThis.window;
    let receivedSortedLinkPaths = null;
    globalThis.window = {
        driver: {
            GetRobotMetadataSnapshot(sortedLinkPaths, stageSourcePath) {
                receivedSortedLinkPaths = Array.from(sortedLinkPaths || []);
                assert.equal(stageSourcePath, '/robots/helper_links.usd');
                return {
                    stageSourcePath,
                    source: 'usd-stage-cpp',
                    linkParentPairs: [],
                    jointCatalogEntries: [],
                    linkDynamicsEntries: [],
                };
            },
            GetPhysicsJointRecords() {
                return [
                    {
                        jointPath: '/Robot/joints/joint_imu',
                        jointName: 'joint_imu',
                        jointTypeName: 'PhysicsFixedJoint',
                        body0Path: '/Robot/base_link',
                        body1Path: '/Robot/base_link/imu_link',
                        axisToken: 'X',
                        localPos0: [0, 0, 0.05],
                        localRot0Wxyz: [1, 0, 0, 0],
                        localPos1: [0, 0, 0],
                        localRot1Wxyz: [1, 0, 0, 0],
                    },
                ];
            },
        },
    };

    try {
        const delegate = Object.create(ThreeRenderDelegateCore.prototype);
        delegate.meshes = {
            '/Robot/base_link/visuals.proto_mesh_id0': {},
        };
        delegate._protoMeshMetadataByMeshId = new Map();
        delegate._robotMetadataSnapshotByStageSource = new Map();
        delegate._robotMetadataBuildPromisesByStageSource = new Map();
        delegate._nowPerfMs = () => 1234;
        delegate.getNormalizedStageSourcePath = () => '/robots/helper_links.usd';
        delegate.getStage = () => null;

        const snapshot = delegate.buildRobotMetadataSnapshotForStage('/robots/helper_links.usd', null);
        assert.ok(snapshot);
        assert.deepEqual(receivedSortedLinkPaths, [
            '/Robot/base_link',
            '/Robot/base_link/imu_link',
        ]);
        assert.ok(snapshot.linkParentPairs.some(([childPath, parentPath]) => childPath === '/Robot/base_link/imu_link' && parentPath === '/Robot/base_link'));
        assert.ok(snapshot.jointCatalogEntries.some((entry) => entry.linkPath === '/Robot/base_link/imu_link'));
    }
    finally {
        globalThis.window = previousWindow;
    }
});

test('buildRobotMetadataSnapshotForStage seeds meshless physics links from stage text before driver snapshot build', () => {
    const previousWindow = globalThis.window;
    let receivedSortedLinkPaths = null;
    globalThis.window = {
        driver: {
            GetRootLayerText() {
                return `#usda 1.0
def Xform "Robot"
{
    over "base_link"
    {
        over "rotor" (
            prepend apiSchemas = ["PhysicsRigidBodyAPI", "PhysicsMassAPI"]
        )
        {
            float physics:mass = 0.089
            float3 physics:centerOfMass = (0, 0, 0)
            float3 physics:diagonalInertia = (0.00006, 0.000112, 0.00006)
            quatf physics:principalAxes = (1, 0, 0, 0)
        }
    }
}

def Scope "joints"
{
    def PhysicsFixedJoint "rotor_joint"
    {
        rel physics:body0 = </Robot/base_link>
        rel physics:body1 = </Robot/base_link/rotor>
        custom string urdf:jointType = "fixed"
        point3f physics:localPos0 = (0, -0.03235, 0)
        point3f physics:localPos1 = (0, 0, 0)
        quatf physics:localRot0 = (1, 0, 0, 0)
        quatf physics:localRot1 = (1, 0, 0, 0)
    }
}
`;
            },
            GetPhysicsJointRecords() {
                return [];
            },
            GetPhysicsLinkDynamicsRecords() {
                return [];
            },
            GetRobotMetadataSnapshot(sortedLinkPaths, stageSourcePath) {
                receivedSortedLinkPaths = Array.from(sortedLinkPaths || []);
                assert.equal(stageSourcePath, '/robots/meshless_stage_text_links.usd');
                return {
                    stageSourcePath,
                    source: 'usd-stage-cpp',
                    linkParentPairs: [
                        ['/Robot/base_link', null],
                        ['/Robot/base_link/rotor', '/Robot/base_link'],
                    ],
                    jointCatalogEntries: [{
                        jointPath: '/Robot/joints/rotor_joint',
                        jointName: 'rotor_joint',
                        jointTypeName: 'PhysicsFixedJoint',
                        linkPath: '/Robot/base_link/rotor',
                        parentLinkPath: '/Robot/base_link',
                    }],
                    linkDynamicsEntries: [{
                        linkPath: '/Robot/base_link/rotor',
                        mass: 0.089,
                        centerOfMassLocal: [0, 0, 0],
                        diagonalInertia: [0.00006, 0.000112, 0.00006],
                        principalAxesLocalWxyz: [1, 0, 0, 0],
                    }],
                    meshCountsByLinkPath: {},
                };
            },
        },
    };

    try {
        const delegate = Object.create(ThreeRenderDelegateCore.prototype);
        delegate.meshes = {
            '/Robot/base_link/visuals.proto_mesh_id0': {},
        };
        delegate._protoMeshMetadataByMeshId = new Map();
        delegate._robotMetadataSnapshotByStageSource = new Map();
        delegate._robotMetadataBuildPromisesByStageSource = new Map();
        delegate._nowPerfMs = () => 1234;
        delegate.getNormalizedStageSourcePath = () => '/robots/meshless_stage_text_links.usd';
        delegate.getStage = () => null;

        const snapshot = delegate.buildRobotMetadataSnapshotForStage('/robots/meshless_stage_text_links.usd', null);
        assert.ok(snapshot);
        assert.deepEqual(receivedSortedLinkPaths, [
            '/Robot/base_link',
            '/Robot/base_link/rotor',
        ]);
        assert.ok(snapshot.jointCatalogEntries.some((entry) => entry.linkPath === '/Robot/base_link/rotor'));
        assert.ok(snapshot.linkDynamicsEntries.some((entry) => entry.linkPath === '/Robot/base_link/rotor' && entry.mass === 0.089));
    }
    finally {
        globalThis.window = previousWindow;
    }
});

test('buildRobotMetadataSnapshotForStage does not promote folded collision-only semantic child links from stage text without driver metadata', () => {
    const previousWindow = globalThis.window;
    globalThis.window = { driver: null };

    try {
        const delegate = Object.create(ThreeRenderDelegateCore.prototype);
        delegate.meshes = {
            '/Robot/FL_calf/collisions.proto_mesh_id0': {},
            '/Robot/FL_calf/collisions.proto_mesh_id1': {},
        };
        delegate._protoMeshMetadataByMeshId = new Map();
        delegate._robotMetadataSnapshotByStageSource = new Map();
        delegate._robotMetadataBuildPromisesByStageSource = new Map();
        delegate._nowPerfMs = () => 1234;
        delegate.getNormalizedStageSourcePath = () => '/robots/go2_folded_collision.usd';
        delegate.getResolvedPrimPathForMeshId = (meshId) => (
            meshId === '/Robot/FL_calf/collisions.proto_mesh_id0'
                ? '/Robot/FL_calf/collisions/FL_calf/mesh'
                : '/Robot/FL_calf/collisions/FL_calflower/mesh'
        );
        delegate.getStage = () => ({
            GetRootLayer() {
                return createLayer(`#usda 1.0
(
    defaultPrim = "Robot"
)

def Scope "colliders"
{
    def Xform "FL_calf"
    {
        def Xform "collision_0"
        {
            def Mesh "mesh"
            {
            }
        }
    }

    def Xform "FL_calflower"
    {
        def Xform "collision_0"
        {
            def Mesh "mesh"
            {
            }
        }
    }
}
`);
            },
            GetUsedLayers() {
                return [];
            },
        });

        const snapshot = delegate.buildRobotMetadataSnapshotForStage('/robots/go2_folded_collision.usd', null);

        assert.ok(snapshot);
        assert.equal(snapshot.source, 'mesh-only');
        assert.equal(snapshot.stale, true);
        assert.ok(snapshot.errorFlags.includes('usd-driver-metadata-missing'));
        assert.deepEqual(snapshot.linkParentPairs, []);
        assert.deepEqual(snapshot.meshCountsByLinkPath, {
            '/Robot/FL_calf': {
                visualMeshCount: 0,
                collisionMeshCount: 2,
                collisionPrimitiveCounts: { mesh: 2 },
            },
        });
    }
    finally {
        globalThis.window = previousWindow;
    }
});

test('buildRobotMetadataSnapshotForStage keeps visual_0-style roundtrip container scopes on the owning link', () => {
    const previousWindow = globalThis.window;
    globalThis.window = { driver: null };

    try {
        const delegate = Object.create(ThreeRenderDelegateCore.prototype);
        delegate.meshes = {
            '/Robot/base_link/visuals.proto_mesh_id0': {},
            '/Robot/base_link/collisions.proto_box_id0': {},
        };
        delegate._protoMeshMetadataByMeshId = new Map();
        delegate._robotMetadataSnapshotByStageSource = new Map();
        delegate._robotMetadataBuildPromisesByStageSource = new Map();
        delegate._nowPerfMs = () => 1234;
        delegate.getNormalizedStageSourcePath = () => '/robots/base_link_roundtrip.usd';
        delegate.getResolvedVisualTransformPrimPathForMeshId = () => '/Robot/base_link/visuals/visual_0/mesh';
        delegate.getResolvedPrimPathForMeshId = () => '/Robot/base_link/collisions/collision_0/cube';
        delegate.getStage = () => ({
            GetRootLayer() {
                return createLayer(`#usda 1.0
(
    defaultPrim = "Robot"
)

def Xform "Robot"
{
    def Xform "base_link"
    {
        def Xform "visuals"
        {
            def Xform "visual_0"
            {
                def Mesh "mesh"
                {
                }
            }
        }

        def Xform "collisions"
        {
            def Xform "collision_0"
            {
                def Cube "cube"
                {
                    uniform token purpose = "guide"
                }
            }
        }
    }
}
`);
            },
            GetUsedLayers() {
                return [];
            },
        });

        const snapshot = delegate.buildRobotMetadataSnapshotForStage('/robots/base_link_roundtrip.usd', null);

        assert.ok(snapshot);
        assert.deepEqual(snapshot.linkParentPairs, []);
        assert.equal(snapshot.meshCountsByLinkPath['/Robot/visual_0'], undefined);
        assert.deepEqual(snapshot.meshCountsByLinkPath, {
            '/Robot/base_link': {
                visualMeshCount: 1,
                collisionMeshCount: 1,
                collisionPrimitiveCounts: { box: 1 },
            },
        });
    }
    finally {
        globalThis.window = previousWindow;
    }
});

test('startRobotMetadataWarmupForStage refreshes cached scene snapshots with resolved metadata', async () => {
    const delegate = Object.create(ThreeRenderDelegateCore.prototype);
    delegate._robotMetadataSnapshotByStageSource = new Map();
    delegate._robotMetadataBuildPromisesByStageSource = new Map();
    delegate._robotSceneSnapshotByStageSource = new Map([
        ['/robots/helper_links.usd', {
            stageSourcePath: '/robots/helper_links.usd',
            robotTree: {
                linkParentPairs: [['/Robot/base_link', null]],
                jointCatalogEntries: [],
                rootLinkPaths: ['/Robot/base_link'],
            },
            physics: {
                linkDynamicsEntries: [],
            },
            robotMetadataSnapshot: {
                stageSourcePath: '/robots/helper_links.usd',
                generatedAtMs: 1,
                source: 'robot-scene-snapshot',
                linkParentPairs: [['/Robot/base_link', null]],
                jointCatalogEntries: [],
                linkDynamicsEntries: [],
                meshCountsByLinkPath: {},
            },
        }],
    ]);
    delegate._nowPerfMs = () => 456;
    delegate.getNormalizedStageSourcePath = () => '/robots/helper_links.usd';
    delegate.buildRobotMetadataSnapshotForStage = () => ({
        stageSourcePath: '/robots/helper_links.usd',
        generatedAtMs: 456,
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
    delegate.emitRobotMetadataSnapshotReady = () => {};
    let emittedSceneSnapshot = null;
    delegate.emitRobotSceneSnapshotReady = (snapshot) => {
        emittedSceneSnapshot = snapshot;
    };

    const snapshot = await delegate.startRobotMetadataWarmupForStage('/robots/helper_links.usd', {
        force: true,
        skipIdleWait: true,
    });

    assert.ok(snapshot);
    assert.equal(snapshot.jointCatalogEntries.length, 1);
    const cachedSceneSnapshot = delegate._robotSceneSnapshotByStageSource.get('/robots/helper_links.usd');
    assert.ok(cachedSceneSnapshot);
    assert.ok(cachedSceneSnapshot.robotTree.linkParentPairs.some(([childPath, parentPath]) => childPath === '/Robot/base_link/imu_link' && parentPath === '/Robot/base_link'));
    assert.equal(cachedSceneSnapshot.robotMetadataSnapshot.jointCatalogEntries.length, 1);
    assert.equal(emittedSceneSnapshot?.robotMetadataSnapshot?.jointCatalogEntries?.length, 1);
});

test('buildRobotMetadataSnapshotForStage marks metadata stale when driver physics record reads fail', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
        driver: {
            GetRobotMetadataSnapshot() {
                return {
                    stageSourcePath: '/robots/two_link_robot.usd',
                    source: 'usd-stage-cpp',
                    linkParentPairs: [],
                    jointCatalogEntries: [],
                    linkDynamicsEntries: [],
                };
            },
            GetPhysicsJointRecords() {
                throw new Error('joint-record-fetch-failed');
            },
            GetPhysicsLinkDynamicsRecords() {
                throw new Error('link-dynamics-fetch-failed');
            },
        },
    };

    try {
        const delegate = createFallbackMetadataDelegate();
        delegate.getStage = () => null;

        const snapshot = delegate.buildRobotMetadataSnapshotForStage('/robots/two_link_robot.usd', null);

        assert.ok(snapshot);
        assert.equal(snapshot.stale, true);
        assert.deepEqual(
            snapshot.errorFlags,
            [
                'physics-joint-records-unavailable',
                'physics-link-dynamics-unavailable',
                'usd-driver-metadata-missing',
            ],
        );
    }
    finally {
        globalThis.window = previousWindow;
    }
});

test('tryBuildRobotMetadataSnapshotFromDriver logs driver metadata snapshot failures to console', () => {
    const previousWindow = globalThis.window;
    const originalConsoleError = console.error;
    const loggedErrors = [];
    globalThis.window = {
        driver: {
            GetRobotMetadataSnapshot() {
                throw new Error('driver-metadata-snapshot-failed');
            },
        },
    };
    console.error = (...args) => {
        loggedErrors.push(args);
    };

    try {
        const delegate = createFallbackMetadataDelegate();

        const snapshot = delegate.tryBuildRobotMetadataSnapshotFromDriver(
            '/robots/two_link_robot.usd',
            ['/Robot/base_link'],
            {},
        );

        assert.equal(snapshot, null);
    }
    finally {
        console.error = originalConsoleError;
        globalThis.window = previousWindow;
    }

    assert.equal(loggedErrors.length, 1);
    assert.match(String(loggedErrors[0]?.[0] || ''), /Failed to build robot metadata snapshot from USD driver/);
    assert.equal(loggedErrors[0]?.[1]?.stageSourcePath, '/robots/two_link_robot.usd');
    assert.match(String(loggedErrors[0]?.[1]?.error || ''), /driver-metadata-snapshot-failed/);
});

test('startRobotMetadataWarmupForStage annotates stale metadata when URDF truth load fails', async () => {
    const delegate = Object.create(ThreeRenderDelegateCore.prototype);
    delegate._robotMetadataSnapshotByStageSource = new Map();
    delegate._robotMetadataBuildPromisesByStageSource = new Map();
    delegate._robotSceneSnapshotByStageSource = new Map();
    delegate._nowPerfMs = () => 456;
    delegate.getNormalizedStageSourcePath = () => '/robots/helper_links.usd';
    delegate.shouldAllowUrdfHttpFallback = () => true;
    delegate.buildRobotMetadataSnapshotForStage = () => ({
        stageSourcePath: '/robots/helper_links.usd',
        generatedAtMs: 456,
        source: 'usd-stage-cpp',
        linkParentPairs: [['/Robot/base_link', null]],
        jointCatalogEntries: [],
        linkDynamicsEntries: [],
        meshCountsByLinkPath: {},
    });
    delegate.startUrdfTruthLoadForStage = () => Promise.reject(new Error('truth-load-failed'));
    delegate.emitRobotMetadataSnapshotReady = () => {};
    delegate.emitRobotSceneSnapshotReady = () => {};

    const snapshot = await delegate.startRobotMetadataWarmupForStage('/robots/helper_links.usd', {
        force: true,
        skipIdleWait: true,
    });

    assert.ok(snapshot);
    assert.equal(snapshot.stale, true);
    assert.deepEqual(snapshot.errorFlags, ['urdf-truth-load-failed']);
    assert.match(String(snapshot.truthLoadError || ''), /truth-load-failed/);
});

test('safeOpenUsdStage does not cache failed opens as a permanent null result', () => {
    const previousWindow = globalThis.window;
    let openAttempts = 0;
    const recoveredStage = { stage: true };

    globalThis.window = {
        USD: {
            UsdStage: {
                Open(stagePath) {
                    openAttempts += 1;
                    assert.equal(stagePath, '/robots/retryable.usd');
                    if (openAttempts === 1) {
                        throw new Error('transient-open-failure');
                    }
                    return recoveredStage;
                },
            },
        },
    };

    try {
        const delegate = Object.create(ThreeRenderDelegateCore.prototype);

        assert.equal(delegate.safeOpenUsdStage('/robots/retryable.usd'), null);
        assert.equal(delegate.safeOpenUsdStage('/robots/retryable.usd'), recoveredStage);
        assert.equal(openAttempts, 2);
    }
    finally {
        globalThis.window = previousWindow;
    }
});


test('disabled stage text fallback keeps driver metadata without exporting large root layers', () => {
    const previousWindow = globalThis.window;
    let layerExportCount = 0;
    globalThis.window = { driver: {
        GetRootLayerText() { layerExportCount += 1; return exportedRootLayerText; },
        GetPhysicsJointRecords: () => [],
        GetPhysicsLinkDynamicsRecords: () => [],
        GetRobotMetadataSnapshot: () => ({
            source: 'usd-stage-cpp',
            linkParentPairs: [['/Robot/base_link/link1', '/Robot/base_link']],
            jointCatalogEntries: [{
                linkPath: '/Robot/base_link/link1', parentLinkPath: '/Robot/base_link',
                jointName: 'handle', jointTypeName: 'revolute', axisToken: 'Z',
            }],
            linkDynamicsEntries: [],
        }),
    } };
    try {
        const delegate = createFallbackMetadataDelegate();
        delegate.disableStageLayerTextFallbacks = true;
        const snapshot = delegate.buildRobotMetadataSnapshotForStage('/robots/two_link_robot.usd', null);
        assert.equal(layerExportCount, 0);
        assert.equal(snapshot.source, 'usd-stage-cpp');
        assert.equal(snapshot.jointCatalogEntries[0].jointName, 'handle');
    } finally {
        globalThis.window = previousWindow;
    }
});
