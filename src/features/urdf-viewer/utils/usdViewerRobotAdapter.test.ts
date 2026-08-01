import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { computeLinkWorldMatrices } from '@/core/robot/kinematics';
import { DEFAULT_LINK, GeometryType, JointType } from '../../../types/index.ts';
import { adaptUsdViewerSnapshotToRobotData } from './usdViewerRobotAdapter';

test('adapts usd-viewer robot scene snapshot into URDF Studio RobotData', () => {
  const jointYawRadians = Math.PI / 2;
  const result = adaptUsdViewerSnapshotToRobotData(
    {
      stageSourcePath: '/robots/unitree/simple_cube.usdz',
      stage: {
        defaultPrimPath: '/Robot',
      },
      robotTree: {
        linkParentPairs: [
          ['/Robot/base_link', null],
          ['/Robot/link1', '/Robot/base_link'],
        ],
        rootLinkPaths: ['/Robot/base_link'],
      },
      robotMetadataSnapshot: {
        stageSourcePath: '/robots/unitree/simple_cube.usdz',
        linkParentPairs: [
          ['/Robot/base_link', null],
          ['/Robot/link1', '/Robot/base_link'],
        ],
        jointCatalogEntries: [
          {
            linkPath: '/Robot/link1',
            parentLinkPath: '/Robot/base_link',
            jointName: 'joint_link1',
            jointTypeName: 'revolute',
            axisToken: 'Y',
            axisLocal: [0, 0, -1],
            lowerLimitDeg: -90,
            upperLimitDeg: 90,
            angleDeg: 30,
            driveDamping: 0.15,
            driveMaxForce: 8,
            localPivotInLink: [1, 2, 3],
            originXyz: [4, 5, 6],
            originQuatWxyz: [Math.cos(jointYawRadians / 2), 0, 0, Math.sin(jointYawRadians / 2)],
          },
        ],
        linkDynamicsEntries: [
          {
            linkPath: '/Robot/link1',
            mass: 1.25,
            centerOfMassLocal: [0.1, 0.2, 0.3],
            diagonalInertia: [1, 2, 3],
            principalAxesLocalWxyz: [Math.cos(Math.PI / 4), 0, 0, Math.sin(Math.PI / 4)],
          },
        ],
        meshCountsByLinkPath: {
          '/Robot/base_link': {
            visualMeshCount: 1,
            collisionMeshCount: 1,
            collisionPrimitiveCounts: {
              box: 1,
            },
          },
          '/Robot/link1': {
            visualMeshCount: 1,
            collisionMeshCount: 2,
            collisionPrimitiveCounts: {
              capsule: 2,
            },
          },
        },
      },
      render: {
        meshDescriptors: [
          {
            meshId: '/Robot/base_link/collisions.proto_box_id0',
            sectionName: 'collisions',
            resolvedPrimPath: '/Robot/base_link/collisions/box_0',
            primType: 'cube',
            size: 1,
            extentSize: [0.4, 0.5, 0.6],
          },
          {
            meshId: '/Robot/link1/collisions.proto_capsule_id0',
            sectionName: 'collisions',
            resolvedPrimPath: '/Robot/link1/collisions/capsule_0',
            primType: 'capsule',
            axis: 'Y',
            radius: 0.1,
            height: 0.8,
            extentSize: [0.2, 0.8, 0.2],
          },
          {
            meshId: '/Robot/link1/collisions.proto_capsule_id1',
            sectionName: 'collisions',
            resolvedPrimPath: '/Robot/link1/collisions/capsule_1',
            primType: 'capsule',
            axis: 'Z',
            radius: 0.15,
            height: 1.0,
            extentSize: [0.3, 0.3, 1.0],
          },
        ],
      },
    },
    {
      fileName: 'simple_cube.usdz',
    },
  );

  assert.ok(result);
  assert.equal(result.robotData.name, 'Robot');
  assert.equal(result.robotData.rootLinkId, 'base_link');
  assert.equal(result.linkIdByPath['/Robot/base_link'], 'base_link');
  assert.equal(result.linkPathById.base_link, '/Robot/base_link');

  const baseLink = result.robotData.links.base_link;
  const link1 = result.robotData.links.link1;
  assert.ok(baseLink);
  assert.ok(link1);
  assert.ok(baseLink.inertial);

  assert.equal(baseLink.visual.type, GeometryType.MESH);
  assert.equal(baseLink.visual.meshPath, undefined);
  assert.equal(baseLink.collision.type, GeometryType.BOX);
  assert.deepEqual(baseLink.collision.dimensions, { x: 0.4, y: 0.5, z: 0.6 });
  assert.equal(
    baseLink.inertial.mass,
    0,
    'USD links without authored MassAPI should not inherit the editor default mass',
  );
  assert.deepEqual(
    baseLink.inertial.inertia,
    { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
    'USD links without dynamics metadata should not inherit the editor default inertia',
  );
  assert.equal(link1.collision.type, GeometryType.CAPSULE);
  assert.deepEqual(link1.collision.dimensions, { x: 0.1, y: 0.8, z: 0 });
  assert.equal(link1.visual.meshPath, undefined);
  assert.equal(link1.collision.meshPath, undefined);
  assert.equal(link1.collisionBodies?.length, 1);
  assert.deepEqual(link1.collisionBodies?.[0]?.dimensions, { x: 0.15, y: 1.0, z: 0 });
  assert.equal(link1.collisionBodies?.[0]?.meshPath, undefined);
  assert.ok(link1.inertial);
  assert.equal(link1.inertial.mass, 1.25);
  assert.deepEqual(link1.inertial.origin?.xyz, { x: 0.1, y: 0.2, z: 0.3 });
  assert.ok(Math.abs((link1.inertial.origin?.rpy.y || 0) - Math.PI / 2) < 1e-6);
  assert.deepEqual(link1.inertial.inertia, {
    ixx: 1,
    ixy: 0,
    ixz: 0,
    iyy: 2,
    iyz: 0,
    izz: 3,
  });

  const joint = Object.values(result.robotData.joints).find(
    (candidate) => candidate.name === 'joint_link1',
  );
  assert.ok(joint);
  assert.equal(joint.type, JointType.REVOLUTE);
  assert.equal(joint.parentLinkId, 'base_link');
  assert.equal(joint.childLinkId, 'link1');
  assert.deepEqual(joint.axis, { x: 0, y: 0, z: -1 });
  assert.ok(joint.limit);
  assert.equal(joint.limit.lower, -Math.PI / 2);
  assert.equal(joint.limit.upper, Math.PI / 2);
  assert.ok(Math.abs((joint.angle ?? Number.NaN) - Math.PI / 6) < 1e-6);
  assert.equal(joint.limit.effort, 8);
  assert.equal(joint.dynamics.damping, 0.15);
  assert.deepEqual(joint.origin.xyz, { x: 4, y: 5, z: 6 });
  assert.ok(Math.abs(joint.origin.rpy.y - jointYawRadians) < 1e-6);
  assert.equal(result.childLinkPathByJointId[joint.id], '/Robot/link1');
  assert.equal(result.parentLinkPathByJointId[joint.id], '/Robot/base_link');
});

test('adapts USD visual materials and extra visuals into RobotState-maintained links/materials', () => {
  const result = adaptUsdViewerSnapshotToRobotData(
    {
      stageSourcePath: '/robots/unitree/g1.usd',
      stage: {
        defaultPrimPath: '/Robot',
      },
      robotTree: {
        linkParentPairs: [['/Robot/torso_link', null]],
        rootLinkPaths: ['/Robot/torso_link'],
      },
      robotMetadataSnapshot: {
        stageSourcePath: '/robots/unitree/g1.usd',
        linkParentPairs: [['/Robot/torso_link', null]],
        jointCatalogEntries: [],
        meshCountsByLinkPath: {
          '/Robot/torso_link': {
            visualMeshCount: 2,
            collisionMeshCount: 1,
            collisionPrimitiveCounts: {
              box: 1,
            },
          },
        },
      },
      render: {
        meshDescriptors: [
          {
            meshId: '/Robot/torso_link/visuals.proto_mesh_id0',
            sectionName: 'visuals',
            resolvedPrimPath: '/Robot/torso_link/visuals/torso_link',
            primType: 'mesh',
            materialId: '/Looks/Torso',
          },
          {
            meshId: '/Robot/torso_link/visuals.proto_mesh_id1',
            sectionName: 'visuals',
            resolvedPrimPath: '/Robot/torso_link/visuals/head_link',
            primType: 'mesh',
            materialId: '/Looks/Head',
          },
        ],
        materials: [
          {
            materialId: '/Looks/Torso',
            color: [0.2, 0.3, 0.4, 1],
          },
          {
            materialId: '/Looks/Head',
            color: [0.9, 0.9, 0.9, 1],
          },
        ],
      },
    },
    {
      fileName: 'g1.usd',
    },
  );

  assert.ok(result);
  assert.equal(result.robotData.links.torso_link.visual.color, '#7c95aa');
  assert.equal(result.robotData.links.torso_link.collision.type, GeometryType.BOX);
  assert.equal(result.robotData.materials?.torso_link?.color, '#7c95aa');

  const extraLink = Object.values(result.robotData.links).find((link) => link.id !== 'torso_link');
  const extraJoint = Object.values(result.robotData.joints).find(
    (joint) => joint.childLinkId === extraLink?.id,
  );

  assert.ok(extraLink);
  assert.equal(extraLink.visual.type, GeometryType.MESH);
  assert.equal(extraLink.visual.color, '#f3f3f3');
  assert.equal(extraLink.inertial?.mass, 0);
  assert.ok(extraJoint);
  assert.equal(extraJoint?.type, JointType.FIXED);
  assert.equal(extraJoint?.parentLinkId, 'torso_link');
  assert.equal(result.robotData.materials?.[extraLink.id]?.color, '#f3f3f3');
});

test('maps authored USD physics schema joint type names back onto URDF joint types', () => {
  const result = adaptUsdViewerSnapshotToRobotData(
    {
      stageSourcePath: '/robots/unitree/fixed_helper.usd',
      stage: {
        defaultPrimPath: '/Robot',
      },
      robotTree: {
        linkParentPairs: [
          ['/Robot/base_link', null],
          ['/Robot/head_link', '/Robot/base_link'],
        ],
        rootLinkPaths: ['/Robot/base_link'],
      },
      robotMetadataSnapshot: {
        stageSourcePath: '/robots/unitree/fixed_helper.usd',
        linkParentPairs: [
          ['/Robot/base_link', null],
          ['/Robot/head_link', '/Robot/base_link'],
        ],
        jointCatalogEntries: [
          {
            linkPath: '/Robot/head_link',
            parentLinkPath: '/Robot/base_link',
            jointName: 'joint_head',
            jointTypeName: 'PhysicsFixedJoint',
            axisToken: 'X',
            axisLocal: [1, 0, 0],
            lowerLimitDeg: 0,
            upperLimitDeg: 0,
            originXyz: [0, 0, 0.1],
            originQuatWxyz: [1, 0, 0, 0],
          },
        ],
        meshCountsByLinkPath: {
          '/Robot/base_link': {
            visualMeshCount: 1,
            collisionMeshCount: 0,
            collisionPrimitiveCounts: {},
          },
          '/Robot/head_link': {
            visualMeshCount: 1,
            collisionMeshCount: 0,
            collisionPrimitiveCounts: {},
          },
        },
      },
    },
    {
      fileName: 'fixed_helper.usd',
    },
  );

  assert.ok(result);

  const joint = Object.values(result.robotData.joints).find(
    (candidate) => candidate.name === 'joint_head',
  );
  assert.ok(joint);
  assert.equal(joint.type, JointType.FIXED);
});

test('maps unsupported generic UsdPhysics joint type names to floating joints', () => {
  for (const jointTypeName of [
    'PhysicsJoint',
    'UsdPhysicsJoint',
    'PhysicsD6Joint',
    'D6Joint',
    'PhysicsDistanceJoint',
  ]) {
    const result = adaptUsdViewerSnapshotToRobotData(
      {
        stageSourcePath: `/robots/newton/${jointTypeName}.usd`,
        stage: {
          defaultPrimPath: '/Robot',
        },
        robotTree: {
          linkParentPairs: [
            ['/Robot/base_link', null],
            ['/Robot/body_link', '/Robot/base_link'],
          ],
          rootLinkPaths: ['/Robot/base_link'],
        },
        robotMetadataSnapshot: {
          stageSourcePath: `/robots/newton/${jointTypeName}.usd`,
          linkParentPairs: [
            ['/Robot/base_link', null],
            ['/Robot/body_link', '/Robot/base_link'],
          ],
          jointCatalogEntries: [
            {
              linkPath: '/Robot/body_link',
              parentLinkPath: '/Robot/base_link',
              jointName: `joint_${jointTypeName}`,
              jointTypeName,
              axisToken: 'X',
              originXyz: [0, 0, 0],
              originQuatWxyz: [1, 0, 0, 0],
              ...(jointTypeName === 'PhysicsJoint'
                ? {
                    usdPhysicsJointTypeName: 'PhysicsJoint',
                    usdLimitAxes: {
                      rotX: { low: -180, high: 180 },
                      rotY: { low: 0, high: 0 },
                      rotZ: { low: 0, high: 0 },
                      transX: { low: 0, high: 0 },
                      transY: { low: 0, high: 0 },
                      transZ: { low: 0, high: 0 },
                    },
                    usdDriveAxes: {
                      rotX: {
                        type: 'force',
                        stiffness: 0.04,
                        damping: 0.002,
                        targetPosition: 0,
                        targetVelocity: 0,
                      },
                    },
                  }
                : {}),
            },
          ],
          meshCountsByLinkPath: {
            '/Robot/base_link': {
              visualMeshCount: 1,
              collisionMeshCount: 0,
              collisionPrimitiveCounts: {},
            },
            '/Robot/body_link': {
              visualMeshCount: 1,
              collisionMeshCount: 0,
              collisionPrimitiveCounts: {},
            },
          },
        },
      },
      {
        fileName: `${jointTypeName}.usd`,
      },
    );

    assert.ok(result);

    const joint = Object.values(result.robotData.joints).find(
      (candidate) => candidate.name === `joint_${jointTypeName}`,
    );
    assert.ok(joint, `expected ${jointTypeName} joint to import`);
    assert.equal(joint.type, JointType.FLOATING);

    if (jointTypeName === 'PhysicsJoint') {
      assert.equal(joint.usdPhysics?.jointTypeName, 'PhysicsJoint');
      assert.deepEqual(joint.usdPhysics?.limitAxes?.rotX, { low: -180, high: 180 });
      assert.deepEqual(joint.usdPhysics?.limitAxes?.transZ, { low: 0, high: 0 });
      assert.equal(joint.usdPhysics?.driveAxes?.rotX?.type, 'force');
      assert.equal(joint.usdPhysics?.driveAxes?.rotX?.stiffness, 0.04);
      assert.equal(joint.usdPhysics?.driveAxes?.rotX?.damping, 0.002);
      assert.equal(joint.usdPhysics?.driveAxes?.rotX?.targetPosition, 0);
      assert.equal(joint.usdPhysics?.driveAxes?.rotX?.targetVelocity, 0);
    }
  }
});

test('preserves USD physics child joint frame rotations for IsaacSim-authored fixed links', () => {
  const childFrame = [Math.SQRT1_2, 0, Math.SQRT1_2, 0];
  const result = adaptUsdViewerSnapshotToRobotData(
    {
      stageSourcePath: '/robots/unitree/go2_description.usda',
      stage: {
        defaultPrimPath: '/go2_description',
      },
      robotTree: {
        linkParentPairs: [
          ['/go2_description/base', null],
          ['/go2_description/FL_foot', '/go2_description/base'],
        ],
        rootLinkPaths: ['/go2_description/base'],
      },
      robotMetadataSnapshot: {
        stageSourcePath: '/robots/unitree/go2_description.usda',
        linkParentPairs: [
          ['/go2_description/base', null],
          ['/go2_description/FL_foot', '/go2_description/base'],
        ],
        jointCatalogEntries: [
          {
            linkPath: '/go2_description/FL_foot',
            parentLinkPath: '/go2_description/base',
            jointName: 'FL_foot_joint',
            jointTypeName: 'PhysicsFixedJoint',
            axisToken: 'X',
            axisLocal: [1, 0, 0],
            originXyz: [0, 0, -0.213],
            originQuatWxyz: [1, 0, 0, 0],
            localPos0: [0, 0, -0.213],
            localRot0Wxyz: childFrame,
            localPos1: [0, 0, 0],
            localRot1Wxyz: childFrame,
          },
        ],
        meshCountsByLinkPath: {
          '/go2_description/base': {
            visualMeshCount: 1,
            collisionMeshCount: 0,
            collisionPrimitiveCounts: {},
          },
          '/go2_description/FL_foot': {
            visualMeshCount: 1,
            collisionMeshCount: 0,
            collisionPrimitiveCounts: {},
          },
        },
      },
    },
    {
      fileName: 'go2_description.usda',
    },
  );

  assert.ok(result);
  const joint = Object.values(result.robotData.joints).find(
    (candidate) => candidate.name === 'FL_foot_joint',
  );
  assert.ok(joint);
  assert.deepEqual(joint.usdPhysics?.localPos0, { x: 0, y: 0, z: -0.213 });
  assert.deepEqual(joint.usdPhysics?.localRot1Wxyz, childFrame);
  assert.deepEqual(joint.usdPhysics?.localRot0Wxyz, childFrame);
  assert.deepEqual(joint.usdPhysics?.localPos1, { x: 0, y: 0, z: 0 });
});

test('uses USD Physics originXyz as localPos0 when native metadata omits the raw parent frame', () => {
  const result = adaptUsdViewerSnapshotToRobotData(
    {
      stageSourcePath: '/robots/unitree/g1_29dof_rev_1_0.usda',
      stage: {
        defaultPrimPath: '/g1_29dof_rev_1_0',
      },
      robotTree: {
        linkParentPairs: [
          ['/g1_29dof_rev_1_0/torso_link', null],
          ['/g1_29dof_rev_1_0/head_link', '/g1_29dof_rev_1_0/torso_link'],
        ],
        rootLinkPaths: ['/g1_29dof_rev_1_0/torso_link'],
      },
      robotMetadataSnapshot: {
        stageSourcePath: '/robots/unitree/g1_29dof_rev_1_0.usda',
        linkParentPairs: [
          ['/g1_29dof_rev_1_0/torso_link', null],
          ['/g1_29dof_rev_1_0/head_link', '/g1_29dof_rev_1_0/torso_link'],
        ],
        jointCatalogEntries: [
          {
            linkPath: '/g1_29dof_rev_1_0/head_link',
            parentLinkPath: '/g1_29dof_rev_1_0/torso_link',
            jointName: 'head_joint',
            jointTypeName: 'PhysicsFixedJoint',
            axisToken: 'X',
            axisLocal: [1, 0, 0],
            originXyz: [0.0039635, 0, -0.044],
            originQuatWxyz: [1, 0, 0, 0],
          },
        ],
        meshCountsByLinkPath: {},
      },
    },
    {
      fileName: 'g1_29dof_rev_1_0.usda',
    },
  );

  assert.ok(result);
  const joint = Object.values(result.robotData.joints).find(
    (candidate) => candidate.name === 'head_joint',
  );
  assert.ok(joint);
  assert.deepEqual(joint.origin.xyz, { x: 0.0039635, y: 0, z: -0.044 });
  assert.deepEqual(joint.usdPhysics?.localPos0, { x: 0.0039635, y: 0, z: -0.044 });
});

test('uses native USD Physics localPos0 as the joint origin when originXyz is absent', () => {
  const result = adaptUsdViewerSnapshotToRobotData(
    {
      stageSourcePath: '/robots/unitree/g1_29dof_rev_1_0.usda',
      stage: {
        defaultPrimPath: '/g1_29dof_rev_1_0',
      },
      robotTree: {
        linkParentPairs: [
          ['/g1_29dof_rev_1_0/torso_link', null],
          ['/g1_29dof_rev_1_0/head_link', '/g1_29dof_rev_1_0/torso_link'],
        ],
        rootLinkPaths: ['/g1_29dof_rev_1_0/torso_link'],
      },
      robotMetadataSnapshot: {
        stageSourcePath: '/robots/unitree/g1_29dof_rev_1_0.usda',
        linkParentPairs: [
          ['/g1_29dof_rev_1_0/torso_link', null],
          ['/g1_29dof_rev_1_0/head_link', '/g1_29dof_rev_1_0/torso_link'],
        ],
        jointCatalogEntries: [
          {
            linkPath: '/g1_29dof_rev_1_0/head_link',
            parentLinkPath: '/g1_29dof_rev_1_0/torso_link',
            jointName: 'head_joint',
            jointTypeName: 'PhysicsFixedJoint',
            axisToken: 'X',
            axisLocal: [1, 0, 0],
            localPos0: [0.0039635, 0, -0.044],
            localRot0Wxyz: [1, 0, 0, 0],
            localPos1: [0, 0, 0],
            localRot1Wxyz: [1, 0, 0, 0],
          },
        ],
        meshCountsByLinkPath: {},
      },
    },
    {
      fileName: 'g1_29dof_rev_1_0.usda',
    },
  );

  assert.ok(result);
  const joint = Object.values(result.robotData.joints).find(
    (candidate) => candidate.name === 'head_joint',
  );
  assert.ok(joint);
  assert.deepEqual(joint.origin.xyz, { x: 0.0039635, y: 0, z: -0.044 });
  assert.deepEqual(joint.usdPhysics?.localPos0, { x: 0.0039635, y: 0, z: -0.044 });
});

test('uses USD Physics child joint frame when deriving store joint origin', () => {
  const result = adaptUsdViewerSnapshotToRobotData(
    {
      stageSourcePath: '/robots/universal_robots/ur10_instanceable.usd',
      stage: {
        defaultPrimPath: '/ur10',
      },
      robotTree: {
        linkParentPairs: [
          ['/ur10/wrist_3_link', null],
          ['/ur10/ee_link', '/ur10/wrist_3_link'],
        ],
        rootLinkPaths: ['/ur10/wrist_3_link'],
      },
      robotMetadataSnapshot: {
        stageSourcePath: '/robots/universal_robots/ur10_instanceable.usd',
        linkParentPairs: [
          ['/ur10/wrist_3_link', null],
          ['/ur10/ee_link', '/ur10/wrist_3_link'],
        ],
        jointCatalogEntries: [
          {
            linkPath: '/ur10/ee_link',
            parentLinkPath: '/ur10/wrist_3_link',
            jointName: 'ee_fixed_joint',
            jointTypeName: 'PhysicsFixedJoint',
            axisToken: 'X',
            axisLocal: [1, 0, 0],
            localPos0: [0, 0, 0],
            localRot0Wxyz: [1, 0, 0, 0],
            localPos1: [-0.09219998866319656, 0, 0],
            localRot1Wxyz: [-0.5, 0.5, 0.5, 0.5],
          },
        ],
        meshCountsByLinkPath: {},
      },
    },
    {
      fileName: 'ur10_instanceable.usd',
    },
  );

  assert.ok(result);
  const joint = Object.values(result.robotData.joints).find(
    (candidate) => candidate.name === 'ee_fixed_joint',
  );
  assert.ok(joint);
  assert.deepEqual(joint.usdPhysics?.localPos1, { x: -0.09219998866319656, y: 0, z: 0 });

  const matrices = computeLinkWorldMatrices(result.robotData);
  const eePosition = new THREE.Vector3().setFromMatrixPosition(matrices.ee_link);
  assert.ok(Math.abs(eePosition.y - 0.09219998866319656) < 1e-9);
});

test('ignores USDA internal mesh libraries when robot link metadata is present', () => {
  const result = adaptUsdViewerSnapshotToRobotData(
    {
      stageSourcePath: '/unitree_ros/b2_description/urdf/b2_description.usda',
      stage: {
        defaultPrimPath: '/b2_description',
      },
      robotTree: {
        linkParentPairs: [
          ['/b2_description/__MeshLibrary', null],
          ['/b2_description/base_link', null],
          ['/b2_description/FL_hip', '/b2_description/base_link'],
        ],
        rootLinkPaths: ['/b2_description/__MeshLibrary', '/b2_description/base_link'],
      },
      robotMetadataSnapshot: {
        stageSourcePath: '/unitree_ros/b2_description/urdf/b2_description.usda',
        source: 'usd-stage-worker',
        linkParentPairs: [
          ['/b2_description/__MeshLibrary', null],
          ['/b2_description/base_link', null],
          ['/b2_description/FL_hip', '/b2_description/base_link'],
        ],
        jointCatalogEntries: [
          {
            linkPath: '/b2_description/FL_hip',
            parentLinkPath: '/b2_description/base_link',
            jointName: 'FL_hip_joint',
            jointTypeName: 'revolute',
            axisToken: 'X',
            axisLocal: [1, 0, 0],
            lowerLimitDeg: -90,
            upperLimitDeg: 90,
            originXyz: [0, 0, 0],
            originQuatWxyz: [1, 0, 0, 0],
          },
        ],
        meshCountsByLinkPath: {
          '/b2_description/__MeshLibrary': {
            visualMeshCount: 24,
            collisionMeshCount: 0,
            collisionPrimitiveCounts: {},
          },
          '/b2_description/base_link': {
            visualMeshCount: 1,
            collisionMeshCount: 1,
            collisionPrimitiveCounts: { box: 1 },
          },
          '/b2_description/FL_hip': {
            visualMeshCount: 1,
            collisionMeshCount: 0,
            collisionPrimitiveCounts: {},
          },
        },
      },
      render: {
        meshDescriptors: [
          {
            meshId: '/b2_description/__MeshLibrary/body_mesh',
            sectionName: 'visuals',
            resolvedPrimPath: '/b2_description/__MeshLibrary/body_mesh',
            primType: 'mesh',
          },
          {
            meshId: '/b2_description/base_link/visuals.proto_mesh_id0',
            sectionName: 'visuals',
            resolvedPrimPath: '/b2_description/base_link/visuals/body',
            primType: 'mesh',
          },
        ],
      },
    },
    {
      fileName: 'b2_description.usda',
    },
  );

  assert.ok(result);
  assert.equal(result.robotData.rootLinkId, 'base_link');
  assert.equal(result.linkIdByPath['/b2_description/__MeshLibrary'], undefined);
  assert.equal(result.linkIdByPath['/b2_description/base_link'], 'base_link');
  assert.equal(result.linkIdByPath['/b2_description/FL_hip'], 'FL_hip');
  assert.deepEqual(Object.keys(result.robotData.links).sort(), ['FL_hip', 'base_link']);
  assert.equal(result.robotData.joints.FL_hip_joint?.parentLinkId, 'base_link');
  assert.equal(result.robotData.joints.FL_hip_joint?.childLinkId, 'FL_hip');
});

test('does not expose USDA internal mesh libraries as the RobotState root when no robot metadata was recovered', () => {
  const result = adaptUsdViewerSnapshotToRobotData(
    {
      stageSourcePath: '/unitree_ros/go2_description/urdf/go2_description.usda',
      stage: {
        defaultPrimPath: '/go2_description',
      },
      robotTree: {
        linkParentPairs: [],
        rootLinkPaths: ['/go2_description/__MeshLibrary'],
      },
      robotMetadataSnapshot: {
        stageSourcePath: '/unitree_ros/go2_description/urdf/go2_description.usda',
        source: 'usd-stage-cpp',
        linkParentPairs: [],
        jointCatalogEntries: [],
        meshCountsByLinkPath: {},
      },
      render: {
        meshDescriptors: [
          {
            meshId: '/go2_description/__MeshLibrary/Geometry_6',
            sectionName: 'visuals',
            resolvedPrimPath: '/go2_description/__MeshLibrary/Geometry_6',
            primType: 'mesh',
          },
        ],
      },
    },
    {
      fileName: 'go2_description.usda',
    },
  );

  assert.ok(result);
  assert.equal(result.robotData.rootLinkId, 'go2_description');
  assert.equal(result.linkIdByPath['/go2_description'], 'go2_description');
  assert.equal(result.linkIdByPath['/go2_description/__MeshLibrary'], undefined);
  assert.deepEqual(Object.keys(result.robotData.links), ['go2_description']);
  assert.equal(result.robotData.links.go2_description.visual.type, GeometryType.NONE);
});

test('adapts generic mesh-only CAD USD assemblies into a browseable hierarchy rooted at the default prim', () => {
  const result = adaptUsdViewerSnapshotToRobotData(
    {
      stageSourcePath: '/robots/cad/7SO101.usdc',
      stage: {
        defaultPrimPath: '/_7SO101',
      },
      robotTree: {
        linkParentPairs: [],
        jointCatalogEntries: [],
        rootLinkPaths: [],
      },
      robotMetadataSnapshot: {
        stageSourcePath: '/robots/cad/7SO101.usdc',
        source: 'mesh-only',
        linkParentPairs: [],
        jointCatalogEntries: [],
        linkDynamicsEntries: [],
        meshCountsByLinkPath: {},
      },
      render: {
        meshDescriptors: [
          {
            meshId: '/_7SO101/MeshInstance/实体1',
            sectionName: 'visuals',
            resolvedPrimPath: '/_7SO101/MeshInstance',
            primType: 'mesh',
          },
          {
            meshId: '/_7SO101/MeshInstance_1/实体1',
            sectionName: 'visuals',
            resolvedPrimPath: '/_7SO101/MeshInstance_1',
            primType: 'mesh',
          },
        ],
      },
    },
    {
      fileName: '7SO101.usdc',
    },
  );

  assert.ok(result);
  const rootLinkId = result.linkIdByPath['/_7SO101'];
  const firstChildId = result.linkIdByPath['/_7SO101/MeshInstance'];
  const secondChildId = result.linkIdByPath['/_7SO101/MeshInstance_1'];

  assert.equal(result.robotData.rootLinkId, rootLinkId);
  assert.ok(rootLinkId);
  assert.ok(firstChildId);
  assert.ok(secondChildId);
  assert.equal(result.robotData.links[rootLinkId]?.visual.type, GeometryType.NONE);
  assert.equal(result.robotData.links[firstChildId]?.visual.type, GeometryType.MESH);
  assert.equal(result.robotData.links[secondChildId]?.visual.type, GeometryType.MESH);
  assert.equal(Object.keys(result.robotData.links).length, 3);
  assert.equal(Object.keys(result.robotData.joints).length, 2);
  assert.deepEqual(
    Object.values(result.robotData.joints)
      .map((joint) => joint.parentLinkId)
      .sort((left, right) => left.localeCompare(right)),
    [rootLinkId, rootLinkId],
  );
  assert.deepEqual(
    Object.values(result.robotData.joints)
      .map((joint) => joint.childLinkId)
      .sort((left, right) => left.localeCompare(right)),
    [firstChildId, secondChildId].sort((left, right) => left.localeCompare(right)),
  );
});

test('keeps generic scene fallback meshes grouped at the synthetic default-prim link', () => {
  const result = adaptUsdViewerSnapshotToRobotData(
    {
      stageSourcePath: '/lab/scene.usd',
      stage: {
        defaultPrimPath: '/World',
      },
      robotTree: {
        linkParentPairs: [
          ['/World/Environment/Mesh0/Visuals/id1', '/World'],
          ['/World/Environment/Mesh1/Visuals/id2', '/World'],
        ],
        jointCatalogEntries: [],
        rootLinkPaths: ['/World'],
      },
      robotMetadataSnapshot: {
        stageSourcePath: '/lab/scene.usd',
        source: 'mesh-only',
        linkParentPairs: [
          ['/World/Environment/Mesh0/Visuals/id1', '/World'],
          ['/World/Environment/Mesh1/Visuals/id2', '/World'],
        ],
        jointCatalogEntries: [],
        linkDynamicsEntries: [],
        meshCountsByLinkPath: {
          '/World/Environment/Mesh0/Visuals/id1': {
            visualMeshCount: 1,
            collisionMeshCount: 0,
          },
          '/World/Environment/Mesh1/Visuals/id2': {
            visualMeshCount: 1,
            collisionMeshCount: 0,
          },
        },
      },
      render: {
        meshDescriptors: [
          {
            meshId: '/World/visuals.proto_mesh_id0',
            sectionName: 'visuals',
            resolvedPrimPath: '/World/Environment/Mesh0/Visuals/id1',
            primType: 'mesh',
          },
          {
            meshId: '/World/visuals.proto_mesh_id1',
            sectionName: 'visuals',
            resolvedPrimPath: '/World/Environment/Mesh1/Visuals/id2',
            primType: 'mesh',
          },
        ],
      },
    },
    {
      fileName: 'scene.usd',
    },
  );

  assert.ok(result);
  assert.equal(result.robotData.rootLinkId, 'World');
  assert.deepEqual(Object.keys(result.robotData.links), ['World']);
  assert.deepEqual(Object.keys(result.robotData.joints), []);
  assert.equal(result.robotData.links.World.visual.usdMeshDescriptors?.length, 2);
});

test('keeps authored visual and collision slots grouped when a single USD visual scope expands into multiple mesh descriptors', () => {
  const result = adaptUsdViewerSnapshotToRobotData(
    {
      stageSourcePath: '/robots/unitree/b2_roundtrip.usd',
      stage: {
        defaultPrimPath: '/Robot',
      },
      robotTree: {
        linkParentPairs: [['/Robot/base_link', null]],
        rootLinkPaths: ['/Robot/base_link'],
      },
      render: {
        meshDescriptors: [
          {
            meshId: '/Robot/base_link/visuals.proto_mesh_id0',
            sectionName: 'visuals',
            resolvedPrimPath: '/Robot/base_link/visuals/visual_0/Scene/ros_body1',
            primType: 'mesh',
            materialId: '/Looks/Base',
            extentSize: [1.2, 0.5, 0.4],
          },
          {
            meshId: '/Robot/base_link/visuals.proto_mesh_id1',
            sectionName: 'visuals',
            resolvedPrimPath: '/Robot/base_link/visuals/visual_0/Scene/ros_body1_1',
            primType: 'mesh',
            materialId: '/Looks/Base',
            extentSize: [1.2, 0.5, 0.4],
          },
          {
            meshId: '/Robot/base_link/collisions.proto_mesh_id0',
            sectionName: 'collisions',
            resolvedPrimPath: '/Robot/base_link/collisions/collision_0/Scene/collider',
            primType: 'mesh',
            extentSize: [1.1, 0.45, 0.35],
          },
          {
            meshId: '/Robot/base_link/collisions.proto_mesh_id1',
            sectionName: 'collisions',
            resolvedPrimPath: '/Robot/base_link/collisions/collision_0/Scene/collider_1',
            primType: 'mesh',
            extentSize: [1.1, 0.45, 0.35],
          },
        ],
        materials: [
          {
            materialId: '/Looks/Base',
            color: [0.2, 0.25, 0.3, 1],
          },
        ],
      },
    },
    {
      fileName: 'b2_roundtrip.usd',
    },
  );

  assert.ok(result);
  assert.deepEqual(Object.keys(result.robotData.links), ['base_link']);
  assert.deepEqual(Object.keys(result.robotData.joints), []);
  assert.equal(result.robotData.rootLinkId, 'base_link');
  assert.equal(result.robotData.links.base_link.visual.type, GeometryType.MESH);
  assert.equal(result.robotData.links.base_link.visual.meshPath, undefined);
  assert.deepEqual(
    result.robotData.links.base_link.visual.usdMeshDescriptors?.map((descriptor) => descriptor.resolvedPrimPath),
    [
      '/Robot/base_link/visuals/visual_0/Scene/ros_body1',
      '/Robot/base_link/visuals/visual_0/Scene/ros_body1_1',
    ],
  );
  assert.equal(result.robotData.links.base_link.collision.type, GeometryType.MESH);
  assert.deepEqual(result.robotData.links.base_link.collision.dimensions, {
    x: 1,
    y: 1,
    z: 1,
  });
  assert.deepEqual(
    result.robotData.links.base_link.collision.usdMeshDescriptors?.map((descriptor) => descriptor.resolvedPrimPath),
    [
      '/Robot/base_link/collisions/collision_0/Scene/collider',
      '/Robot/base_link/collisions/collision_0/Scene/collider_1',
    ],
  );
  assert.equal(result.robotData.links.base_link.collisionBodies?.length ?? 0, 0);
  assert.equal(result.robotData.materials?.base_link?.color, '#7c8995');
});

test('preserves multiple authored materials when one USD visual scope emits multiple mesh descriptors', () => {
  const result = adaptUsdViewerSnapshotToRobotData(
    {
      stageSourcePath: '/robots/unitree/go2_multi_material.usd',
      stage: {
        defaultPrimPath: '/Robot',
      },
      robotTree: {
        linkParentPairs: [['/Robot/base_link', null]],
        rootLinkPaths: ['/Robot/base_link'],
      },
      robotMetadataSnapshot: {
        stageSourcePath: '/robots/unitree/go2_multi_material.usd',
        linkParentPairs: [['/Robot/base_link', null]],
        jointCatalogEntries: [],
        meshCountsByLinkPath: {
          '/Robot/base_link': {
            visualMeshCount: 2,
            collisionMeshCount: 0,
          },
        },
      },
      render: {
        meshDescriptors: [
          {
            meshId: '/Robot/base_link/visuals.proto_mesh_id0',
            sectionName: 'visuals',
            resolvedPrimPath: '/Robot/base_link/visuals/visual_0/Scene/body_shell',
            primType: 'mesh',
            materialId: '/Looks/Body',
          },
          {
            meshId: '/Robot/base_link/visuals.proto_mesh_id1',
            sectionName: 'visuals',
            resolvedPrimPath: '/Robot/base_link/visuals/visual_0/Scene/trim_shell',
            primType: 'mesh',
            materialId: '/Looks/Trim',
          },
        ],
        materials: [
          {
            materialId: '/Looks/Body',
            color: [1, 0, 0, 1],
          },
          {
            materialId: '/Looks/Trim',
            color: [0, 1, 0, 1],
          },
        ],
      },
    },
    {
      fileName: 'go2_multi_material.usd',
    },
  );

  assert.ok(result);
  assert.equal(result.robotData.links.base_link.visual.color, DEFAULT_LINK.visual.color);
  assert.equal(result.robotData.links.base_link.visual.materialSource, 'named');
  assert.deepEqual(
    result.robotData.links.base_link.visual.authoredMaterials?.map((material) => material.color),
    ['#ff0000', '#00ff00'],
  );
  assert.equal(result.robotData.materials?.base_link, undefined);
});

test('preserves multiple authored materials from USD geom subset sections on a single link', () => {
  const result = adaptUsdViewerSnapshotToRobotData(
    {
      stageSourcePath: '/robots/unitree/go2_subset_materials.usd',
      stage: {
        defaultPrimPath: '/Robot',
      },
      robotTree: {
        linkParentPairs: [['/Robot/base_link', null]],
        rootLinkPaths: ['/Robot/base_link'],
      },
      robotMetadataSnapshot: {
        stageSourcePath: '/robots/unitree/go2_subset_materials.usd',
        linkParentPairs: [['/Robot/base_link', null]],
        jointCatalogEntries: [],
        meshCountsByLinkPath: {
          '/Robot/base_link': {
            visualMeshCount: 1,
            collisionMeshCount: 0,
          },
        },
      },
      render: {
        meshDescriptors: [
          {
            meshId: '/Robot/base_link/visuals.proto_mesh_id0',
            sectionName: 'visuals',
            resolvedPrimPath: '/Robot/base_link/visuals/mesh_0',
            primType: 'mesh',
            geometry: {
              geomSubsetSections: [
                { start: 0, length: 3, materialId: '/Looks/Body' },
                { start: 3, length: 3, materialId: '/Looks/Trim' },
              ],
            },
          },
        ],
        materials: [
          {
            materialId: '/Looks/Body',
            colorSpace: 'srgb',
            color: [0.1, 0.2, 0.3, 1],
          },
          {
            materialId: '/Looks/Trim',
            colorSpace: 'srgb',
            color: [0.8, 0.8, 0.8, 1],
          },
        ],
      },
    },
    {
      fileName: 'go2_subset_materials.usd',
    },
  );

  assert.ok(result);
  assert.equal(result.robotData.links.base_link.visual.color, DEFAULT_LINK.visual.color);
  assert.equal(result.robotData.links.base_link.visual.materialSource, 'named');
  assert.deepEqual(
    result.robotData.links.base_link.visual.authoredMaterials?.map((material) => material.color),
    ['#1a334d', '#cccccc'],
  );
  assert.equal(result.robotData.materials?.base_link, undefined);
});

test('keeps synthetic displayColor material records in raw linear color space', () => {
  const result = adaptUsdViewerSnapshotToRobotData(
    {
      stageSourcePath: '/robots/unitree/display_color.usd',
      stage: {
        defaultPrimPath: '/Robot',
      },
      robotTree: {
        linkParentPairs: [['/Robot/base_link', null]],
        rootLinkPaths: ['/Robot/base_link'],
      },
      robotMetadataSnapshot: {
        stageSourcePath: '/robots/unitree/display_color.usd',
        linkParentPairs: [['/Robot/base_link', null]],
        jointCatalogEntries: [],
        meshCountsByLinkPath: {
          '/Robot/base_link': {
            visualMeshCount: 1,
            collisionMeshCount: 0,
          },
        },
      },
      render: {
        meshDescriptors: [
          {
            meshId: '/Robot/base_link/visuals.proto_mesh_id0',
            sectionName: 'visuals',
            resolvedPrimPath: '/Robot/base_link/visuals/mesh_0',
            primType: 'mesh',
            materialId: '/__viewer_snapshot_materials__/displayColor_19334D_FF',
          },
        ],
        materials: [
          {
            materialId: '/__viewer_snapshot_materials__/displayColor_19334D_FF',
            name: 'displayColor_19334D',
            color: [0.1, 0.2, 0.3, 1],
          },
        ],
      },
    },
    {
      fileName: 'display_color.usd',
    },
  );

  assert.ok(result);
  assert.equal(result.robotData.links.base_link.visual.color, '#597c95');
});

test('does not preserve disabled OmniPBR default white emission as authored USD emissive material', () => {
  const result = adaptUsdViewerSnapshotToRobotData(
    {
      stageSourcePath: '/robots/unitree/b2.usd',
      stage: {
        defaultPrimPath: '/b2_description',
      },
      robotTree: {
        linkParentPairs: [['/b2_description/base_link', null]],
        rootLinkPaths: ['/b2_description/base_link'],
      },
      robotMetadataSnapshot: {
        stageSourcePath: '/robots/unitree/b2.usd',
        linkParentPairs: [['/b2_description/base_link', null]],
        jointCatalogEntries: [],
        meshCountsByLinkPath: {
          '/b2_description/base_link': {
            visualMeshCount: 1,
            collisionMeshCount: 0,
          },
        },
      },
      render: {
        meshDescriptors: [
          {
            meshId: '/b2_description/base_link/visuals.proto_mesh_id0',
            sectionName: 'visuals',
            resolvedPrimPath: '/b2_description/base_link/visuals/base_link/mesh',
            primType: 'mesh',
            geometry: {
              geomSubsetSections: [
                { start: 0, length: 3, materialId: '/b2_description/Looks/material_______023' },
                { start: 3, length: 3, materialId: '/b2_description/Looks/material_______024' },
              ],
            },
          },
        ],
        materials: [
          {
            materialId: '/b2_description/Looks/material_______023',
            name: 'material_______023',
            isOmniPbr: true,
            emissiveEnabled: false,
            colorSpace: 'srgb',
            colorSource: 'authored',
            emissiveColorSpace: 'srgb',
            color: [0, 0, 0],
            emissive: [1, 1, 1],
            emissiveIntensity: 10000,
          },
          {
            materialId: '/b2_description/Looks/material_______024',
            name: 'material_______024',
            isOmniPbr: true,
            emissiveEnabled: false,
            colorSpace: 'srgb',
            colorSource: 'authored',
            emissiveColorSpace: 'srgb',
            color: [0.002853, 0.002853, 0.002853],
            emissive: [1, 1, 1],
            emissiveIntensity: 10000,
          },
        ],
      },
    },
    {
      fileName: 'b2.usd',
    },
  );

  assert.ok(result);
  assert.deepEqual(
    result.robotData.links.base_link.visual.authoredMaterials?.map((material) => ({
      color: material.color,
      emissive: material.emissive,
      emissiveIntensity: material.emissiveIntensity,
    })),
    [
      { color: '#000000', emissive: undefined, emissiveIntensity: undefined },
      { color: '#090909', emissive: undefined, emissiveIntensity: undefined },
    ],
  );
});

test('keeps USD mesh descriptors as mesh visuals when no mesh asset path exists', () => {
  const result = adaptUsdViewerSnapshotToRobotData(
    {
      stageSourcePath: '/robots/unitree/buffer_box.usd',
      stage: {
        defaultPrimPath: '/Robot',
      },
      robotTree: {
        linkParentPairs: [['/Robot/base_link', null]],
        rootLinkPaths: ['/Robot/base_link'],
      },
      robotMetadataSnapshot: {
        stageSourcePath: '/robots/unitree/buffer_box.usd',
        linkParentPairs: [['/Robot/base_link', null]],
        jointCatalogEntries: [],
        meshCountsByLinkPath: {
          '/Robot/base_link': {
            visualMeshCount: 1,
            collisionMeshCount: 0,
          },
        },
      },
      render: {
        meshDescriptors: [
          {
            meshId: '/Robot/base_link/visuals.proto_mesh_id0',
            sectionName: 'visuals',
            resolvedPrimPath: '/Robot/base_link/visuals/mesh_0',
            primType: 'mesh',
            ranges: {
              positions: {
                offset: 0,
                count: 6,
                stride: 3,
              },
            },
          },
        ],
      },
      buffers: {
        positions: [-0.5, -1, -0.25, 1.0, 2.0, 1.75],
      },
    },
    {
      fileName: 'buffer_box.usd',
    },
  );

  assert.ok(result);
  assert.equal(result.robotData.links.base_link.visual.type, GeometryType.MESH);
  assert.equal(result.robotData.links.base_link.visual.meshPath, undefined);
});

test('maps folded semantic child visual and collision prims back onto existing child links', () => {
  const result = adaptUsdViewerSnapshotToRobotData(
    {
      stageSourcePath: '/robots/unitree/folded_child.usd',
      stage: {
        defaultPrimPath: '/Robot',
      },
      robotTree: {
        linkParentPairs: [
          ['/Robot/torso_link', null],
          ['/Robot/head_link', '/Robot/torso_link'],
        ],
        rootLinkPaths: ['/Robot/torso_link'],
      },
      render: {
        meshDescriptors: [
          {
            meshId: '/Robot/torso_link/visuals.proto_mesh_id0',
            sectionName: 'visuals',
            resolvedPrimPath: '/Robot/torso_link/visuals/torso_link/mesh',
            primType: 'mesh',
            materialId: '/Looks/Torso',
          },
          {
            meshId: '/Robot/torso_link/visuals.proto_mesh_id1',
            sectionName: 'visuals',
            resolvedPrimPath: '/Robot/torso_link/visuals/head_link/mesh',
            primType: 'mesh',
            materialId: '/Looks/Head',
          },
          {
            meshId: '/Robot/torso_link/collisions.proto_mesh_id0',
            sectionName: 'collisions',
            resolvedPrimPath: '/Robot/torso_link/collisions/torso_link/mesh',
            primType: 'mesh',
          },
          {
            meshId: '/Robot/torso_link/collisions.proto_mesh_id1',
            sectionName: 'collisions',
            resolvedPrimPath: '/Robot/torso_link/collisions/head_link/mesh',
            primType: 'mesh',
          },
        ],
        materials: [
          {
            materialId: '/Looks/Torso',
            color: [0.2, 0.3, 0.4, 1],
          },
          {
            materialId: '/Looks/Head',
            color: [0.9, 0.9, 0.9, 1],
          },
        ],
      },
    },
    {
      fileName: 'folded_child.usd',
    },
  );

  assert.ok(result);
  assert.deepEqual(Object.keys(result.robotData.links).sort(), ['head_link', 'torso_link']);
  assert.equal(result.robotData.links.torso_link.visual.type, GeometryType.MESH);
  assert.equal(result.robotData.links.torso_link.collision.type, GeometryType.MESH);
  assert.equal(result.robotData.links.head_link.visual.type, GeometryType.MESH);
  assert.equal(result.robotData.links.head_link.collision.type, GeometryType.MESH);
  assert.equal(result.robotData.materials?.torso_link?.color, '#7c95aa');
  assert.equal(result.robotData.materials?.head_link?.color, '#f3f3f3');
  assert.equal(
    Object.values(result.robotData.joints).filter((joint) => joint.childLinkId === 'head_link')
      .length,
    1,
  );
});

test('promotes collision geometry into a visual proxy for collision-only USD snapshots', () => {
  const result = adaptUsdViewerSnapshotToRobotData(
    {
      stageSourcePath: '/robots/unitree/b2_collision_only.usda',
      stage: {
        defaultPrimPath: '/b2_description',
      },
      robotTree: {
        linkParentPairs: [['/b2_description/base_link', null]],
        rootLinkPaths: ['/b2_description/base_link'],
      },
      robotMetadataSnapshot: {
        stageSourcePath: '/robots/unitree/b2_collision_only.usda',
        linkParentPairs: [['/b2_description/base_link', null]],
        jointCatalogEntries: [],
        meshCountsByLinkPath: {
          '/b2_description/base_link': {
            visualMeshCount: 0,
            collisionMeshCount: 1,
            collisionPrimitiveCounts: {
              box: 1,
            },
          },
        },
      },
      render: {
        meshDescriptors: [
          {
            meshId: '/b2_description/base_link/collisions.proto_box_id0',
            sectionName: 'collisions',
            resolvedPrimPath: '/b2_description/base_link/collisions/mesh_0/box',
            primType: 'cube',
            extentSize: [0.5, 0.28, 0.15],
          },
        ],
      },
    },
    {
      fileName: 'b2_collision_only.usda',
    },
  );

  assert.ok(result);
  assert.equal(result.robotData.links.base_link.visual.type, GeometryType.BOX);
  assert.deepEqual(result.robotData.links.base_link.visual.dimensions, {
    x: 0.5,
    y: 0.28,
    z: 0.15,
  });
  assert.equal(result.robotData.links.base_link.collision.type, GeometryType.BOX);
});

test('uses direct UsdPhysics primitive geometry metadata when Hydra mesh descriptors are absent', () => {
  const result = adaptUsdViewerSnapshotToRobotData(
    {
      stageSourcePath: '/robots/newton/cartpole.usda',
      stage: {
        defaultPrimPath: '/cartPole',
      },
      robotTree: {
        linkParentPairs: [['/cartPole/rail', null]],
        rootLinkPaths: ['/cartPole/rail'],
      },
      robotMetadataSnapshot: {
        stageSourcePath: '/robots/newton/cartpole.usda',
        linkParentPairs: [['/cartPole/rail', null]],
        jointCatalogEntries: [],
        meshCountsByLinkPath: {
          '/cartPole/rail': {
            visualMeshCount: 0,
            collisionMeshCount: 1,
            collisionPrimitiveCounts: {
              box: 1,
            },
            collisionPrimitiveGeometries: [
              {
                primitiveType: 'cube',
                dimensions: [0.03, 8, 0.03],
              },
            ],
          },
        },
      },
      render: {
        meshDescriptors: [],
      },
    },
    {
      fileName: 'cartpole.usda',
    },
  );

  assert.ok(result);
  assert.equal(result.robotData.links.rail.collision.type, GeometryType.BOX);
  assert.deepEqual(result.robotData.links.rail.collision.dimensions, {
    x: 0.03,
    y: 8,
    z: 0.03,
  });
  assert.equal(result.robotData.links.rail.visual.type, GeometryType.BOX);
  assert.deepEqual(result.robotData.links.rail.visual.dimensions, {
    x: 0.03,
    y: 8,
    z: 0.03,
  });
});
