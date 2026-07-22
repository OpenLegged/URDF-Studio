import test from 'node:test';
import assert from 'node:assert/strict';

import { GeometryType, JointType, type RobotState } from '@/types';
import {
  buildUsdLinkPathMaps,
  buildUsdPhysicsLayerContent,
  buildUsdRobotLayerContent,
  buildUsdRootLayerContent,
  buildUsdSensorLayerContent,
  createUsdArchivePackage,
} from './usdPackageLayers.ts';

const createLayeredRobot = (): RobotState => {
  return {
    name: 'demo_robot',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    joints: {
      child_joint: {
        id: 'child_joint',
        name: 'child_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'child_link',
        origin: { xyz: { x: 0.1, y: 0.2, z: 0.3 }, rpy: { r: 0, p: 0, y: Math.PI / 4 } },
        axis: { x: 0, y: 1, z: 0 },
        angle: 0,
        limit: { lower: -Math.PI / 6, upper: Math.PI / 3, effort: 10, velocity: 3 },
        dynamics: { damping: 0.2, friction: 0 },
        hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
      },
    },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#ffffff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#000000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
      },
      child_link: {
        id: 'child_link',
        name: 'child_link',
        visible: true,
        visual: {
          type: GeometryType.CYLINDER,
          dimensions: { x: 0.1, y: 0.5, z: 0 },
          color: '#00ff00',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.MESH,
          meshPath: 'meshes/collision.stl',
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1.5,
          origin: { xyz: { x: 0.01, y: 0.02, z: 0.03 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 0.4, ixy: 0, ixz: 0, iyy: 0.5, iyz: 0, izz: 0.6 },
        },
      },
    },
    materials: {},
  };
};

const createMjcfFloatingRootRobot = (): RobotState => {
  return {
    name: 'mjcf_go2_like',
    rootLinkId: 'world',
    selection: { type: null, id: null },
    joints: {
      joint_0: {
        id: 'joint_0',
        name: 'joint_0',
        type: JointType.FLOATING,
        parentLinkId: 'world',
        childLinkId: 'base',
        origin: { xyz: { x: 0, y: 0, z: 0.445 }, rpy: { r: 0, p: 0, y: 0 } },
        axis: { x: 0, y: 0, z: 1 },
        angle: 0,
        dynamics: { damping: 2, friction: 0.2 },
        hardware: { armature: 0.01, motorType: 'None', motorId: '', motorDirection: 1 },
      },
      hip_joint: {
        id: 'hip_joint',
        name: 'hip_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'base',
        childLinkId: 'hip',
        origin: { xyz: { x: 0.19, y: 0.0465, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        axis: { x: 1, y: 0, z: 0 },
        angle: 0,
        limit: { lower: -1, upper: 1, effort: 12, velocity: 4 },
        dynamics: { damping: 0.2, friction: 0 },
        hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
      },
    },
    links: {
      world: {
        id: 'world',
        name: 'world',
        visible: true,
        visual: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 0,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
        },
      },
      base: {
        id: 'base',
        name: 'base',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 0.4, y: 0.2, z: 0.1 },
          color: '#ffffff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.BOX,
          dimensions: { x: 0.4, y: 0.2, z: 0.1 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 6.9,
          origin: { xyz: { x: 0.02, y: 0, z: -0.005 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 0.1, ixy: 0, ixz: 0, iyy: 0.09, iyz: 0, izz: 0.02 },
        },
      },
      hip: {
        id: 'hip',
        name: 'hip',
        visible: true,
        visual: {
          type: GeometryType.CYLINDER,
          dimensions: { x: 0.05, y: 0.08, z: 0 },
          color: '#00ff00',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.CYLINDER,
          dimensions: { x: 0.05, y: 0.08, z: 0 },
          color: '#00ff00',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 0.67,
          origin: { xyz: { x: -0.005, y: 0.002, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 0.0008, ixy: 0, ixz: 0, iyy: 0.0006, iyz: 0, izz: 0.0005 },
        },
      },
    },
    materials: {},
    inspectionContext: {
      sourceFormat: 'mjcf',
      mjcf: {
        siteCount: 0,
        tendonCount: 0,
        tendonActuatorCount: 0,
        bodiesWithSites: [],
        tendons: [],
      },
    },
  };
};

test('usd package layers serialize root and sensor configuration prims', () => {
  const rootLayer = buildUsdRootLayerContent('demo_robot_description', 'demo_robot_description');
  const sensorLayer = buildUsdSensorLayerContent('demo_robot_description');

  assert.match(rootLayer, /defaultPrim = "demo_robot_description"/);
  assert.match(rootLayer, /string "urdfStudio:roundtripMetadata" = "1"/);
  assert.match(rootLayer, /prepend references = @configuration\/demo_robot_description_base\.usd@/);
  assert.match(rootLayer, /prepend payload = @configuration\/demo_robot_description_physics\.usd@/);
  assert.match(rootLayer, /prepend payload = @configuration\/demo_robot_description_sensor\.usd@/);
  assert.match(sensorLayer, /def Xform "demo_robot_description"/);
});

test('isaacsim usd package layers add a Robot variant and robot sidecar references', () => {
  const robot = createLayeredRobot();
  const pathMaps = buildUsdLinkPathMaps(robot, 'demo_robot', {
    layoutProfile: 'isaacsim',
  });
  const robotLayer = buildUsdRobotLayerContent(robot, pathMaps, 'demo_robot', {
    layoutProfile: 'isaacsim',
  });
  const rootLayer = buildUsdRootLayerContent('demo_robot', 'demo_robot', {
    layoutProfile: 'isaacsim',
    fileFormat: 'usda',
  });

  assert.match(rootLayer, /string Robot = "Robot"/);
  assert.match(rootLayer, /string "urdfStudio:roundtripMetadata" = "1"/);
  assert.match(rootLayer, /prepend variantSets = \["Physics", "Sensor", "Robot"\]/);
  assert.match(rootLayer, /prepend payload = @configuration\/demo_robot_robot\.usda@/);
  assert.match(robotLayer, /prepend apiSchemas = \["IsaacRobotAPI"\]/);
  assert.match(robotLayer, /prepend rel isaac:physics:robotLinks = \[/);
  assert.match(robotLayer, /<\/demo_robot\/base_link>/);
  assert.match(robotLayer, /<\/demo_robot\/child_link>/);
  assert.doesNotMatch(robotLayer, /<\/demo_robot\/base_link\/child_link>/);
  assert.match(robotLayer, /prepend rel isaac:physics:robotJoints = \[/);
  assert.match(robotLayer, /prepend apiSchemas = \["IsaacLinkAPI"\]/);
  assert.match(robotLayer, /prepend apiSchemas = \["IsaacJointAPI"\]/);
});

test('usd package layers serialize articulation, joint paths, and mesh collision overrides', () => {
  const robot = createLayeredRobot();
  const pathMaps = buildUsdLinkPathMaps(robot, 'demo_robot_description');
  const physicsLayer = buildUsdPhysicsLayerContent(
    robot,
    pathMaps,
    'demo_robot_description',
    'demo_robot_description',
  );

  assert.match(physicsLayer, /subLayers = \[\n\s+@demo_robot_description_base\.usd@\n\s+\]/);
  assert.match(physicsLayer, /prepend apiSchemas = \["PhysicsArticulationRootAPI"\]/);
  assert.match(physicsLayer, /rel physics:body0 = <\/demo_robot_description\/base_link>/);
  assert.match(
    physicsLayer,
    /rel physics:body1 = <\/demo_robot_description\/base_link\/child_link>/,
  );
  assert.match(physicsLayer, /uniform token physics:axis = "Y"/);
  assert.match(physicsLayer, /custom float3 urdf:axisLocal = \(0, 1, 0\)/);
  assert.match(physicsLayer, /float physics:lowerLimit = -30/);
  assert.match(physicsLayer, /float physics:upperLimit = 60/);
  assert.match(physicsLayer, /prepend apiSchemas = \["PhysicsDriveAPI:angular"\]/);
  assert.match(physicsLayer, /uniform token drive:angular:physics:type = "force"/);
  assert.match(physicsLayer, /float drive:angular:physics:damping = 0\.2/);
  assert.match(physicsLayer, /float drive:angular:physics:maxForce = 10/);
  assert.match(
    physicsLayer,
    /over "collision_0" \(\n\s+prepend apiSchemas = \["PhysicsCollisionAPI", "PhysicsMeshCollisionAPI"\]\n\s*\)\n\s+\{/,
  );
  assert.match(physicsLayer, /bool physics:collisionEnabled = true/);
  assert.match(physicsLayer, /uniform token physics:approximation = "convexHull"/);
});

test('usd package layers omit incomplete optional position bounds', () => {
  const robot = createLayeredRobot();
  robot.joints.child_joint.limit = { effort: 10, velocity: 3 };
  const pathMaps = buildUsdLinkPathMaps(robot, 'demo_robot_description');
  const physicsLayer = buildUsdPhysicsLayerContent(
    robot,
    pathMaps,
    'demo_robot_description',
    'demo_robot_description',
  );

  assert.doesNotMatch(physicsLayer, /physics:(?:lower|upper)Limit/);
  assert.doesNotMatch(physicsLayer, /(?:undefined|NaN|Infinity)/);
  assert.match(physicsLayer, /float drive:angular:physics:maxForce = 10/);
});

test('usd package layers preserve authored generic UsdPhysics D6 joints without fixed-joint fallback', () => {
  const robot = createLayeredRobot();
  robot.joints.child_joint = {
    ...robot.joints.child_joint,
    id: 'd6_joint',
    name: 'D6',
    type: JointType.FLOATING,
    usdPhysics: {
      jointTypeName: 'PhysicsJoint',
      limitAxes: {
        rotX: { low: -180, high: 180 },
        rotY: { low: 0, high: 0 },
        rotZ: { low: 0, high: 0 },
        transX: { low: 0, high: 0 },
        transY: { low: 0, high: 0 },
        transZ: { low: 0, high: 0 },
      },
      driveAxes: {
        rotX: {
          type: 'force',
          stiffness: 0.04,
          damping: 0.002,
          targetPosition: 0,
          targetVelocity: 0,
        },
      },
    },
  };
  const pathMaps = buildUsdLinkPathMaps(robot, 'demo_robot_description');
  const physicsLayer = buildUsdPhysicsLayerContent(
    robot,
    pathMaps,
    'demo_robot_description',
    'demo_robot_description',
  );

  assert.match(physicsLayer, /def PhysicsJoint "d6_joint"/);
  assert.doesNotMatch(physicsLayer, /def PhysicsFixedJoint "d6_joint"/);
  assert.match(
    physicsLayer,
    /prepend apiSchemas = \["PhysicsLimitAPI:transX", "PhysicsLimitAPI:transY", "PhysicsLimitAPI:transZ", "PhysicsLimitAPI:rotX", "PhysicsLimitAPI:rotY", "PhysicsLimitAPI:rotZ", "PhysicsDriveAPI:rotX"\]/,
  );
  assert.match(physicsLayer, /float limit:rotX:physics:low = -180/);
  assert.match(physicsLayer, /float limit:rotX:physics:high = 180/);
  assert.match(physicsLayer, /float limit:transZ:physics:low = 0/);
  assert.match(physicsLayer, /float limit:transZ:physics:high = 0/);
  assert.match(physicsLayer, /uniform token drive:rotX:physics:type = "force"/);
  assert.match(physicsLayer, /float drive:rotX:physics:stiffness = 0\.04/);
  assert.match(physicsLayer, /float drive:rotX:physics:damping = 0\.002/);
});

test('isaacsim usd package layers flatten link prim paths for physics bodies', () => {
  const robot = createLayeredRobot();
  const pathMaps = buildUsdLinkPathMaps(robot, 'demo_robot', {
    layoutProfile: 'isaacsim',
  });
  const physicsLayer = buildUsdPhysicsLayerContent(robot, pathMaps, 'demo_robot', 'demo_robot', {
    layoutProfile: 'isaacsim',
    fileFormat: 'usda',
  });

  assert.match(physicsLayer, /rel physics:body0 = <\/demo_robot\/base_link>/);
  assert.match(physicsLayer, /rel physics:body1 = <\/demo_robot\/child_link>/);
  assert.doesNotMatch(physicsLayer, /rel physics:body1 = <\/demo_robot\/base_link\/child_link>/);
  assert.match(
    physicsLayer,
    /def PhysicsScene "physicsScene" \(\n\s+prepend apiSchemas = \["PhysxSceneAPI"\]\n\s*\)\n\{/,
  );
  assert.match(physicsLayer, /uniform token physxScene:broadphaseType = "MBP"/);
  assert.match(physicsLayer, /bool physxScene:enableCCD = true/);
  assert.match(physicsLayer, /bool physxScene:enableGPUDynamics = false/);
  assert.match(physicsLayer, /bool physxScene:enableStabilization = true/);
  assert.match(physicsLayer, /uniform token physxScene:solverType = "TGS"/);
  assert.match(
    physicsLayer,
    /over "base_link" \(\n\s+prepend apiSchemas = \["PhysicsRigidBodyAPI", "PhysicsArticulationRootAPI", "PhysxArticulationAPI"\]\n\s*\)\n\s+\{/,
  );
  assert.match(physicsLayer, /bool physxArticulation:enabledSelfCollisions = true/);
  assert.match(physicsLayer, /int physxArticulation:solverPositionIterationCount = 32/);
  assert.match(physicsLayer, /int physxArticulation:solverVelocityIterationCount = 1/);
  assert.match(
    physicsLayer,
    /prepend apiSchemas = \["PhysicsJointStateAPI:angular", "PhysxJointAPI", "PhysicsDriveAPI:angular", "IsaacJointAPI"\]/,
  );
  assert.match(physicsLayer, /float drive:angular:physics:stiffness = 625/);
  assert.match(physicsLayer, /float drive:angular:physics:damping = 0\.25/);
  assert.match(physicsLayer, /float drive:angular:physics:targetPosition = 0/);
  assert.match(physicsLayer, /float physxJoint:maxJointVelocity = 171\.887/);
  assert.match(
    physicsLayer,
    /over "child_link" \(\n\s+prepend apiSchemas = \["PhysicsRigidBodyAPI", "PhysicsMassAPI"\]\n\s*\)\n\s+\{/,
  );
});

test('isaacsim usd package layers provide IsaacLab default drive gains when source dynamics are absent', () => {
  const robot = createLayeredRobot();
  robot.joints.child_joint.dynamics = { damping: 0, friction: 0 };
  const pathMaps = buildUsdLinkPathMaps(robot, 'demo_robot', {
    layoutProfile: 'isaacsim',
  });
  const physicsLayer = buildUsdPhysicsLayerContent(robot, pathMaps, 'demo_robot', 'demo_robot', {
    layoutProfile: 'isaacsim',
    fileFormat: 'usda',
  });

  assert.match(
    physicsLayer,
    /prepend apiSchemas = \["PhysicsJointStateAPI:angular", "PhysxJointAPI", "PhysicsDriveAPI:angular", "IsaacJointAPI"\]/,
  );
  assert.match(physicsLayer, /float drive:angular:physics:stiffness = 625/);
  assert.match(physicsLayer, /float drive:angular:physics:damping = 0\.25/);
});

test('isaacsim usd package layers author the articulation root on the root link instead of the package root', () => {
  const robot = createLayeredRobot();
  robot.links.base_link.inertial = {
    mass: 4.2,
    origin: { xyz: { x: 0.01, y: -0.02, z: 0.03 }, rpy: { r: 0, p: 0, y: 0 } },
    inertia: { ixx: 0.8, ixy: 0, ixz: 0, iyy: 0.9, iyz: 0, izz: 1.1 },
  };

  const pathMaps = buildUsdLinkPathMaps(robot, 'demo_robot', {
    layoutProfile: 'isaacsim',
  });
  const physicsLayer = buildUsdPhysicsLayerContent(robot, pathMaps, 'demo_robot', 'demo_robot', {
    layoutProfile: 'isaacsim',
    fileFormat: 'usda',
  });

  assert.doesNotMatch(
    physicsLayer,
    /over "demo_robot" \(\n\s+prepend apiSchemas = \["PhysicsArticulationRootAPI"\]\n\s*\)\n\s+\{/,
  );
  assert.match(
    physicsLayer,
    /over "base_link" \(\n\s+prepend apiSchemas = \["PhysicsRigidBodyAPI", "PhysicsMassAPI", "PhysicsArticulationRootAPI", "PhysxArticulationAPI"\]\n\s*\)\n\s+\{/,
  );
});

test('isaacsim mjcf package layers omit an empty floating world anchor from robot and physics catalogs', () => {
  const robot = createMjcfFloatingRootRobot();
  const pathMaps = buildUsdLinkPathMaps(robot, 'mjcf_go2', {
    layoutProfile: 'isaacsim',
  });
  const physicsLayer = buildUsdPhysicsLayerContent(robot, pathMaps, 'mjcf_go2', 'mjcf_go2', {
    layoutProfile: 'isaacsim',
    fileFormat: 'usda',
  });
  const robotLayer = buildUsdRobotLayerContent(robot, pathMaps, 'mjcf_go2', {
    layoutProfile: 'isaacsim',
  });

  assert.doesNotMatch(
    physicsLayer,
    /over "world" \(\n\s+prepend apiSchemas = \["PhysicsRigidBodyAPI"/,
  );
  assert.doesNotMatch(physicsLayer, /def PhysicsFixedJoint "joint_0"/);
  assert.match(
    physicsLayer,
    /over "base" \(\n\s+prepend apiSchemas = \["PhysicsRigidBodyAPI", "PhysicsMassAPI", "PhysicsArticulationRootAPI", "PhysxArticulationAPI"\]\n\s*\)\n\s+\{/,
  );

  assert.doesNotMatch(robotLayer, /<\/mjcf_go2\/world>/);
  assert.doesNotMatch(robotLayer, /<\/mjcf_go2\/joints\/joint_0>/);
  assert.match(robotLayer, /<\/mjcf_go2\/base>/);
  assert.match(robotLayer, /<\/mjcf_go2\/hip>/);
  assert.match(robotLayer, /<\/mjcf_go2\/joints\/hip_joint>/);
});

test('usd package layers omit centerOfMass when inertial origin is not authored', () => {
  const robot = createLayeredRobot();
  if (robot.links.child_link.inertial) {
    robot.links.child_link.inertial.origin = undefined;
  }

  const pathMaps = buildUsdLinkPathMaps(robot, 'demo_robot_description');
  const physicsLayer = buildUsdPhysicsLayerContent(
    robot,
    pathMaps,
    'demo_robot_description',
    'demo_robot_description',
  );

  assert.match(physicsLayer, /float physics:mass = 1\.5/);
  assert.doesNotMatch(physicsLayer, /float3 physics:centerOfMass =/);
  assert.match(physicsLayer, /float3 physics:diagonalInertia =/);
});

test('usd package layers package root and configuration files under stable usd paths', async () => {
  const archive = createUsdArchivePackage(
    'demo_robot',
    {
      rootLayerContent: 'root',
      baseLayerContent: 'base',
      physicsLayerContent: 'physics',
      sensorLayerContent: 'sensor',
    },
    new Map([['assets/checker.png', new Blob(['texture'], { type: 'image/png' })]]),
  );

  assert.equal(archive.archiveFileName, 'demo_robot_usd.zip');
  assert.equal(archive.rootLayerPath, 'demo_robot/usd/demo_robot.usd');
  assert.deepEqual(Array.from(archive.archiveFiles.keys()).sort(), [
    'demo_robot/usd/assets/checker.png',
    'demo_robot/usd/configuration/demo_robot_description_base.usd',
    'demo_robot/usd/configuration/demo_robot_description_physics.usd',
    'demo_robot/usd/configuration/demo_robot_description_sensor.usd',
    'demo_robot/usd/demo_robot.usd',
  ]);

  assert.equal(await archive.archiveFiles.get('demo_robot/usd/demo_robot.usd')?.text(), 'root');
  assert.equal(
    await archive.archiveFiles
      .get('demo_robot/usd/configuration/demo_robot_description_base.usd')
      ?.text(),
    'base',
  );
});

test('isaacsim usd package layers place the root file beside configuration sidecars', async () => {
  const archive = createUsdArchivePackage(
    'demo_robot',
    {
      rootLayerContent: 'root',
      baseLayerContent: 'base',
      physicsLayerContent: 'physics',
      sensorLayerContent: 'sensor',
      robotLayerContent: 'robot',
    },
    new Map([['assets/checker.png', new Blob(['texture'], { type: 'image/png' })]]),
    {
      layoutProfile: 'isaacsim',
      fileFormat: 'usda',
    },
  );

  assert.equal(archive.archiveFileName, 'demo_robot_usda.zip');
  assert.equal(archive.rootLayerPath, 'demo_robot/demo_robot.usda');
  assert.deepEqual(Array.from(archive.archiveFiles.keys()).sort(), [
    'demo_robot/assets/checker.png',
    'demo_robot/configuration/demo_robot_base.usda',
    'demo_robot/configuration/demo_robot_physics.usda',
    'demo_robot/configuration/demo_robot_robot.usda',
    'demo_robot/configuration/demo_robot_sensor.usda',
    'demo_robot/demo_robot.usda',
  ]);
  assert.equal(
    await archive.archiveFiles.get('demo_robot/configuration/demo_robot_robot.usda')?.text(),
    'robot',
  );
});
