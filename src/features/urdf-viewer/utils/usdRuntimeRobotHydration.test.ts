import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';

import { DEFAULT_JOINT, DEFAULT_LINK, GeometryType, JointType } from '@/types';
import { createOriginMatrix } from '@/core/robot/kinematics';
import type { ViewerRobotDataResolution } from './viewerRobotData';
import { hydrateUsdViewerRobotResolutionFromRuntime } from './usdRuntimeRobotHydration.ts';
import { createUsdViewerRuntimeRobot } from './usdViewerRuntimeRobot.ts';

function composeMatrix(
  position: { x: number; y: number; z: number },
  rotation: { r: number; p: number; y: number } = { r: 0, p: 0, y: 0 },
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(position.x, position.y, position.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation.r, rotation.p, rotation.y, 'ZYX')),
    new THREE.Vector3(1, 1, 1),
  );
}

function assertMatrixClose(
  actualOrigin: Parameters<typeof createOriginMatrix>[0],
  expectedMatrix: THREE.Matrix4,
  message: string,
): void {
  const actualMatrix = createOriginMatrix(actualOrigin);
  const actualElements = actualMatrix.elements;
  const expectedElements = expectedMatrix.elements;

  actualElements.forEach((value, index) => {
    assert.ok(
      Math.abs(value - expectedElements[index]) < 1e-6,
      `${message} (element ${index}): expected ${expectedElements[index]}, got ${value}`,
    );
  });
}

test('hydrateUsdViewerRobotResolutionFromRuntime syncs runtime link and mesh transforms into exportable robot data', () => {
  const baseWorld = composeMatrix({ x: 0, y: 0, z: 0 });
  const childWorld = composeMatrix({ x: 1, y: 2, z: 3 }, { r: 0.05, p: 0.1, y: 0.15 });
  const visualPrimaryWorld = childWorld
    .clone()
    .multiply(composeMatrix({ x: 0.4, y: 0.5, z: 0.6 }, { r: 0.02, p: 0.03, y: 0.04 }));
  const visualAttachmentWorld = childWorld
    .clone()
    .multiply(composeMatrix({ x: -0.2, y: 0.3, z: 0.7 }, { r: 0.1, p: 0, y: 0 }));
  const collisionPrimaryWorld = childWorld
    .clone()
    .multiply(composeMatrix({ x: 0.1, y: 0.2, z: 0.3 }, { r: 0, p: 0.08, y: 0 }));
  const collisionSecondaryWorld = childWorld
    .clone()
    .multiply(composeMatrix({ x: 0.5, y: 0.6, z: 0.7 }, { r: 0, p: 0, y: 0.2 }));

  const resolution: ViewerRobotDataResolution = {
    stageSourcePath: '/robots/demo/runtime.usd',
    linkIdByPath: {
      '/Robot/base_link': 'base_link',
      '/Robot/arm_link': 'arm_link',
    },
    linkPathById: {
      base_link: '/Robot/base_link',
      arm_link: '/Robot/arm_link',
    },
    jointPathById: {
      arm_joint: '/Robot/joints/arm_joint',
    },
    childLinkPathByJointId: {
      arm_joint: '/Robot/arm_link',
      fixed_arm_cap: '/Robot/arm_link',
    },
    parentLinkPathByJointId: {
      arm_joint: '/Robot/base_link',
      fixed_arm_cap: '/Robot/arm_link',
    },
    robotData: {
      name: 'runtime_robot',
      rootLinkId: 'base_link',
      links: {
        base_link: {
          ...DEFAULT_LINK,
          id: 'base_link',
          name: 'base_link',
          visible: true,
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.NONE,
          },
          collision: {
            ...DEFAULT_LINK.collision,
            type: GeometryType.NONE,
          },
        },
        arm_link: {
          ...DEFAULT_LINK,
          id: 'arm_link',
          name: 'arm_link',
          visible: true,
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.MESH,
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
          collision: {
            ...DEFAULT_LINK.collision,
            type: GeometryType.MESH,
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
          collisionBodies: [
            {
              ...DEFAULT_LINK.collision,
              type: GeometryType.MESH,
              origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
            },
          ],
        },
        arm_cap: {
          ...DEFAULT_LINK,
          id: 'arm_cap',
          name: 'arm_cap',
          visible: true,
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.MESH,
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
          collision: {
            ...DEFAULT_LINK.collision,
            type: GeometryType.NONE,
          },
          inertial: {
            ...DEFAULT_LINK.inertial,
            mass: 0,
          },
        },
      },
      joints: {
        arm_joint: {
          ...DEFAULT_JOINT,
          id: 'arm_joint',
          name: 'arm_joint',
          type: JointType.REVOLUTE,
          parentLinkId: 'base_link',
          childLinkId: 'arm_link',
          origin: { xyz: { x: 0.25, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          axis: { x: 0, y: 0, z: 1 },
        },
        fixed_arm_cap: {
          ...DEFAULT_JOINT,
          id: 'fixed_arm_cap',
          name: 'fixed_arm_cap',
          type: JointType.FIXED,
          parentLinkId: 'arm_link',
          childLinkId: 'arm_cap',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          axis: { x: 0, y: 0, z: 1 },
        },
      },
    },
  };

  const snapshot = {
    render: {
      meshDescriptors: [
        {
          meshId: '/Robot/arm_link/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/arm_link/visuals/mesh_0',
        },
        {
          meshId: '/Robot/arm_link/visuals.proto_mesh_id1',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/arm_link/visuals/gripper',
        },
        {
          meshId: '/Robot/arm_link/collisions.proto_mesh_id0',
          sectionName: 'collisions',
          resolvedPrimPath: '/Robot/arm_link/collisions/mesh_0',
        },
        {
          meshId: '/Robot/arm_link/collisions.proto_mesh_id1',
          sectionName: 'collisions',
          resolvedPrimPath: '/Robot/arm_link/collisions/mesh_1',
        },
      ],
    },
  };

  const hydrated = hydrateUsdViewerRobotResolutionFromRuntime(resolution, snapshot as any, {
    getPreferredLinkWorldTransform: (linkPath: string) => {
      if (linkPath === '/Robot/base_link') return baseWorld.clone();
      if (linkPath === '/Robot/arm_link') return childWorld.clone();
      return null;
    },
    getWorldTransformForPrimPath: (primPath: string) => {
      if (primPath === '/Robot/arm_link/visuals/mesh_0') return visualPrimaryWorld.clone();
      if (primPath === '/Robot/arm_link/visuals/gripper') return visualAttachmentWorld.clone();
      if (primPath === '/Robot/arm_link/collisions/mesh_0') return collisionPrimaryWorld.clone();
      if (primPath === '/Robot/arm_link/collisions/mesh_1') return collisionSecondaryWorld.clone();
      return null;
    },
  });

  assert.notEqual(hydrated, resolution);
  assert.notEqual(hydrated.robotData, resolution.robotData);

  assertMatrixClose(
    hydrated.robotData.joints.arm_joint.origin,
    baseWorld.clone().invert().multiply(childWorld.clone()),
    'joint origin should match runtime child link transform',
  );
  assertMatrixClose(
    hydrated.robotData.links.arm_link.visual.origin,
    childWorld.clone().invert().multiply(visualPrimaryWorld.clone()),
    'primary visual origin should match runtime visual prim transform',
  );
  assertMatrixClose(
    hydrated.robotData.links.arm_link.collision.origin,
    childWorld.clone().invert().multiply(collisionPrimaryWorld.clone()),
    'primary collision origin should match runtime collision prim transform',
  );
  assertMatrixClose(
    hydrated.robotData.links.arm_link.collisionBodies?.[0]?.origin,
    childWorld.clone().invert().multiply(collisionSecondaryWorld.clone()),
    'secondary collision origin should match runtime collision prim transform',
  );
  assertMatrixClose(
    hydrated.robotData.links.arm_cap.visual.origin,
    childWorld.clone().invert().multiply(visualAttachmentWorld.clone()),
    'attachment visual origin should map onto the fixed visual child link',
  );
});

test('hydrateUsdViewerRobotResolutionFromRuntime repositions inertial origin when the runtime link frame moves', () => {
  const baseWorld = composeMatrix({ x: 0, y: 0, z: 0 });
  const previousJointOrigin = {
    xyz: { x: 0.25, y: -0.15, z: 0.4 },
    rpy: { r: 0.03, p: -0.02, y: 0.01 },
  };
  const previousJointMatrix = composeMatrix(previousJointOrigin.xyz, previousJointOrigin.rpy);
  const runtimeChildWorld = composeMatrix(
    { x: 1.2, y: 2.1, z: -0.7 },
    { r: 0.08, p: 0.04, y: -0.12 },
  );

  const inertialOrigin = {
    xyz: { x: 0.35, y: -0.25, z: 0.5 },
    rpy: { r: 0.02, p: 0.06, y: -0.03 },
  };

  const resolution: ViewerRobotDataResolution = {
    stageSourcePath: '/robots/demo/runtime_inertial.usd',
    linkIdByPath: {
      '/Robot/base_link': 'base_link',
      '/Robot/arm_link': 'arm_link',
    },
    linkPathById: {
      base_link: '/Robot/base_link',
      arm_link: '/Robot/arm_link',
    },
    jointPathById: {
      arm_joint: '/Robot/joints/arm_joint',
    },
    childLinkPathByJointId: {
      arm_joint: '/Robot/arm_link',
    },
    parentLinkPathByJointId: {
      arm_joint: '/Robot/base_link',
    },
    robotData: {
      name: 'runtime_inertial',
      rootLinkId: 'base_link',
      links: {
        base_link: {
          ...DEFAULT_LINK,
          id: 'base_link',
          name: 'base_link',
          visible: true,
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.NONE,
          },
          collision: {
            ...DEFAULT_LINK.collision,
            type: GeometryType.NONE,
          },
        },
        arm_link: {
          ...DEFAULT_LINK,
          id: 'arm_link',
          name: 'arm_link',
          visible: true,
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.NONE,
          },
          collision: {
            ...DEFAULT_LINK.collision,
            type: GeometryType.NONE,
          },
          inertial: {
            ...DEFAULT_LINK.inertial,
            mass: 4.2,
            origin: inertialOrigin,
          },
        },
      },
      joints: {
        arm_joint: {
          ...DEFAULT_JOINT,
          id: 'arm_joint',
          name: 'arm_joint',
          type: JointType.FIXED,
          parentLinkId: 'base_link',
          childLinkId: 'arm_link',
          origin: previousJointOrigin,
          axis: { x: 0, y: 0, z: 1 },
        },
      },
    },
  };

  const hydrated = hydrateUsdViewerRobotResolutionFromRuntime(resolution, null, {
    getPreferredLinkWorldTransform: (linkPath: string) => {
      if (linkPath === '/Robot/base_link') return baseWorld.clone();
      if (linkPath === '/Robot/arm_link') return runtimeChildWorld.clone();
      return null;
    },
    getWorldTransformForPrimPath: () => null,
  });

  assertMatrixClose(
    hydrated.robotData.joints.arm_joint.origin,
    baseWorld.clone().invert().multiply(runtimeChildWorld.clone()),
    'joint origin should match the runtime child link transform',
  );
  assertMatrixClose(
    hydrated.robotData.links.arm_link.inertial.origin,
    runtimeChildWorld
      .clone()
      .invert()
      .multiply(previousJointMatrix.clone())
      .multiply(createOriginMatrix(inertialOrigin)),
    'inertial origin should stay attached to the link when the link frame is realigned to runtime data',
  );
});

test('hydrateUsdViewerRobotResolutionFromRuntime keeps grouped mesh descriptors collapsed within a single authored scope', () => {
  const baseWorld = composeMatrix({ x: 0, y: 0, z: 0 });
  const primaryVisualWorld = baseWorld
    .clone()
    .multiply(composeMatrix({ x: 0.2, y: 0.1, z: 0.3 }, { r: 0.01, p: 0.02, y: 0.03 }));
  const primaryCollisionWorld = baseWorld
    .clone()
    .multiply(composeMatrix({ x: 0.12, y: -0.08, z: 0.18 }, { r: 0.02, p: 0.01, y: -0.03 }));

  const resolution: ViewerRobotDataResolution = {
    stageSourcePath: '/robots/demo/grouped_scope.usd',
    linkIdByPath: {
      '/Robot/base_link': 'base_link',
    },
    linkPathById: {
      base_link: '/Robot/base_link',
    },
    jointPathById: {},
    childLinkPathByJointId: {},
    parentLinkPathByJointId: {},
    robotData: {
      name: 'grouped_scope',
      rootLinkId: 'base_link',
      links: {
        base_link: {
          ...DEFAULT_LINK,
          id: 'base_link',
          name: 'base_link',
          visible: true,
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.MESH,
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
          collision: {
            ...DEFAULT_LINK.collision,
            type: GeometryType.MESH,
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
        },
      },
      joints: {},
    },
  };

  const snapshot = {
    render: {
      meshDescriptors: [
        {
          meshId: '/Robot/base_link/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/base_link/visuals/visual_0/Scene/ros_body1',
        },
        {
          meshId: '/Robot/base_link/visuals.proto_mesh_id1',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/base_link/visuals/visual_0/Scene/ros_body1_1',
        },
        {
          meshId: '/Robot/base_link/collisions.proto_mesh_id0',
          sectionName: 'collisions',
          resolvedPrimPath: '/Robot/base_link/collisions/collision_0/Scene/collider',
        },
        {
          meshId: '/Robot/base_link/collisions.proto_mesh_id1',
          sectionName: 'collisions',
          resolvedPrimPath: '/Robot/base_link/collisions/collision_0/Scene/collider_1',
        },
      ],
    },
  };

  const hydrated = hydrateUsdViewerRobotResolutionFromRuntime(resolution, snapshot as any, {
    getPreferredLinkWorldTransform: (linkPath: string) =>
      linkPath === '/Robot/base_link' ? baseWorld.clone() : null,
    getWorldTransformForPrimPath: (primPath: string) => {
      if (primPath === '/Robot/base_link/visuals/visual_0/Scene/ros_body1')
        return primaryVisualWorld.clone();
      if (primPath === '/Robot/base_link/visuals/visual_0/Scene/ros_body1_1')
        return primaryVisualWorld.clone();
      if (primPath === '/Robot/base_link/collisions/collision_0/Scene/collider')
        return primaryCollisionWorld.clone();
      if (primPath === '/Robot/base_link/collisions/collision_0/Scene/collider_1')
        return primaryCollisionWorld.clone();
      return null;
    },
  });

  assert.ok(hydrated);
  assertMatrixClose(
    hydrated.robotData.links.base_link.visual.origin,
    baseWorld.clone().invert().multiply(primaryVisualWorld.clone()),
    'primary visual origin should stay relative to the authored link frame',
  );
  assertMatrixClose(
    hydrated.robotData.links.base_link.collision.origin,
    baseWorld.clone().invert().multiply(primaryCollisionWorld.clone()),
    'primary collision origin should stay relative to the authored link frame',
  );
  assert.equal(hydrated.robotData.links.base_link.collisionBodies?.length ?? 0, 0);
  assert.equal(Object.keys(hydrated.robotData.links).length, 1);
  assert.equal(Object.keys(hydrated.robotData.joints).length, 0);
});

test('hydrateUsdViewerRobotResolutionFromRuntime synthesizes attachment visuals and collision bodies for extra authored groups', () => {
  const baseWorld = composeMatrix({ x: 1.5, y: -0.5, z: 0.25 }, { r: 0.02, p: -0.03, y: 0.04 });
  const primaryVisualWorld = baseWorld
    .clone()
    .multiply(composeMatrix({ x: 0.2, y: 0.1, z: 0.3 }, { r: 0.01, p: 0.02, y: 0.03 }));
  const extraVisualWorld = baseWorld
    .clone()
    .multiply(composeMatrix({ x: -0.35, y: 0.45, z: 0.6 }, { r: 0.04, p: -0.01, y: 0.05 }));
  const primaryCollisionWorld = baseWorld
    .clone()
    .multiply(composeMatrix({ x: 0.12, y: -0.08, z: 0.18 }, { r: 0.02, p: 0.01, y: -0.03 }));
  const extraCollisionWorld = baseWorld
    .clone()
    .multiply(composeMatrix({ x: -0.22, y: 0.16, z: 0.42 }, { r: -0.01, p: 0.03, y: 0.04 }));

  const resolution: ViewerRobotDataResolution = {
    stageSourcePath: '/robots/demo/grouped_scope.usd',
    linkIdByPath: {
      '/Robot/base_link': 'base_link',
    },
    linkPathById: {
      base_link: '/Robot/base_link',
    },
    jointPathById: {},
    childLinkPathByJointId: {},
    parentLinkPathByJointId: {},
    robotData: {
      name: 'grouped_scope',
      rootLinkId: 'base_link',
      links: {
        base_link: {
          ...DEFAULT_LINK,
          id: 'base_link',
          name: 'base_link',
          visible: true,
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.MESH,
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
          collision: {
            ...DEFAULT_LINK.collision,
            type: GeometryType.MESH,
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
        },
      },
      joints: {},
    },
  };

  const snapshot = {
    render: {
      meshDescriptors: [
        {
          meshId: '/Robot/base_link/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/base_link/visuals/visual_0/Scene/ros_body1',
        },
        {
          meshId: '/Robot/base_link/visuals.proto_mesh_id1',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/base_link/visuals/visual_1/Scene/ros_body1_1',
        },
        {
          meshId: '/Robot/base_link/collisions.proto_mesh_id0',
          sectionName: 'collisions',
          resolvedPrimPath: '/Robot/base_link/collisions/collision_0/Scene/collider',
        },
        {
          meshId: '/Robot/base_link/collisions.proto_mesh_id1',
          sectionName: 'collisions',
          resolvedPrimPath: '/Robot/base_link/collisions/collision_1/Scene/collider_1',
        },
      ],
    },
  };

  const hydrated = hydrateUsdViewerRobotResolutionFromRuntime(resolution, snapshot as any, {
    getPreferredLinkWorldTransform: (linkPath: string) =>
      linkPath === '/Robot/base_link' ? baseWorld.clone() : null,
    getWorldTransformForPrimPath: (primPath: string) => {
      if (primPath === '/Robot/base_link/visuals/visual_0/Scene/ros_body1')
        return primaryVisualWorld.clone();
      if (primPath === '/Robot/base_link/visuals/visual_1/Scene/ros_body1_1')
        return extraVisualWorld.clone();
      if (primPath === '/Robot/base_link/collisions/collision_0/Scene/collider')
        return primaryCollisionWorld.clone();
      if (primPath === '/Robot/base_link/collisions/collision_1/Scene/collider_1')
        return extraCollisionWorld.clone();
      return null;
    },
  });

  assert.ok(hydrated);
  assertMatrixClose(
    hydrated.robotData.links.base_link.visual.origin,
    baseWorld.clone().invert().multiply(primaryVisualWorld.clone()),
    'primary visual origin should stay relative to the authored link frame',
  );
  assertMatrixClose(
    hydrated.robotData.links.base_link.collision.origin,
    baseWorld.clone().invert().multiply(primaryCollisionWorld.clone()),
    'primary collision origin should stay relative to the authored link frame',
  );
  assert.equal(hydrated.robotData.links.base_link.collisionBodies?.length ?? 0, 1);
  assertMatrixClose(
    hydrated.robotData.links.base_link.collisionBodies?.[0]?.origin,
    baseWorld.clone().invert().multiply(extraCollisionWorld.clone()),
    'extra collision descriptor should hydrate onto a synthetic collision body',
  );

  const attachmentLink = Object.values(hydrated.robotData.links).find(
    (link) =>
      link.id !== 'base_link' &&
      link.visual.type === GeometryType.MESH &&
      (link.inertial?.mass || 0) === 0,
  );
  assert.ok(
    attachmentLink,
    'expected a synthetic visual attachment link for the extra authored group',
  );
  const attachmentJoint = Object.values(hydrated.robotData.joints).find(
    (joint) => joint.childLinkId === attachmentLink?.id,
  );
  assert.ok(
    attachmentJoint,
    'expected a fixed joint anchoring the synthetic visual attachment link',
  );
  assert.equal(attachmentJoint?.type, JointType.FIXED);
  assert.equal(attachmentJoint?.parentLinkId, 'base_link');
  assert.equal(hydrated.childLinkPathByJointId[attachmentJoint!.id], '/Robot/base_link');
  assert.equal(hydrated.parentLinkPathByJointId[attachmentJoint!.id], '/Robot/base_link');
  assertMatrixClose(
    attachmentLink!.visual.origin,
    baseWorld.clone().invert().multiply(extraVisualWorld.clone()),
    'extra visual descriptor should hydrate onto the synthetic attachment link instead of collapsing to the parent origin',
  );
});

test('hydrateUsdViewerRobotResolutionFromRuntime preserves the B2 leg mesh basis when the runtime link frame is identity', () => {
  const thighLinkWorld = composeMatrix({
    x: 0.32850000262260437,
    y: 0.19172999262809753,
    z: 0,
  });
  const thighVisualWorld = composeMatrix(
    {
      x: 0.32850000262260437,
      y: 0.19172999262809753,
      z: 0,
    },
    {
      r: Math.PI / 2,
      p: 0,
      y: 0,
    },
  );

  const resolution: ViewerRobotDataResolution = {
    stageSourcePath: '/robots/unitree/b2.usd',
    linkIdByPath: {
      '/b2_description/FL_thigh': 'FL_thigh',
    },
    linkPathById: {
      FL_thigh: '/b2_description/FL_thigh',
    },
    jointPathById: {},
    childLinkPathByJointId: {},
    parentLinkPathByJointId: {},
    robotData: {
      name: 'b2',
      rootLinkId: 'FL_thigh',
      links: {
        FL_thigh: {
          ...DEFAULT_LINK,
          id: 'FL_thigh',
          name: 'FL_thigh',
          visible: true,
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.MESH,
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
          collision: {
            ...DEFAULT_LINK.collision,
            type: GeometryType.NONE,
          },
        },
      },
      joints: {},
    },
  };

  const snapshot = {
    render: {
      meshDescriptors: [
        {
          meshId: '/b2_description/FL_thigh/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/b2_description/FL_thigh/visuals/FL_thigh/mesh',
        },
      ],
    },
  };

  const hydrated = hydrateUsdViewerRobotResolutionFromRuntime(resolution, snapshot as any, {
    getPreferredLinkWorldTransform: (linkPath: string) => {
      if (linkPath === '/b2_description/FL_thigh') {
        return thighLinkWorld.clone();
      }
      return null;
    },
    getWorldTransformForPrimPath: (primPath: string) => {
      if (primPath === '/b2_description/FL_thigh/visuals/FL_thigh/mesh') {
        return thighVisualWorld.clone();
      }
      return null;
    },
  });

  assertMatrixClose(
    hydrated.robotData.links.FL_thigh.visual.origin,
    thighLinkWorld.clone().invert().multiply(thighVisualWorld.clone()),
    'B2 thigh visual origin should retain the mesh-local RotX(90deg) basis',
  );
});

test('hydrateUsdViewerRobotResolutionFromRuntime composes authored approximation offsets with runtime prim transforms', () => {
  const baseWorld = composeMatrix({ x: 0, y: 0, z: 0 });
  const childWorld = composeMatrix({ x: 1, y: -2, z: 3 }, { r: 0.02, p: -0.04, y: 0.06 });
  const visualPrimWorld = childWorld
    .clone()
    .multiply(composeMatrix({ x: 0.5, y: 0.25, z: -0.75 }, { r: 0.1, p: 0.05, y: -0.02 }));
  const collisionPrimWorld = childWorld
    .clone()
    .multiply(composeMatrix({ x: -0.3, y: 0.4, z: 0.2 }, { r: -0.03, p: 0.08, y: 0.11 }));

  const authoredVisualOrigin = {
    xyz: { x: 0.2, y: -0.1, z: 0.35 },
    rpy: { r: 0, p: 0.12, y: 0 },
  };
  const authoredCollisionOrigin = {
    xyz: { x: -0.15, y: 0.05, z: 0.1 },
    rpy: { r: 0.07, p: 0, y: -0.09 },
  };

  const resolution: ViewerRobotDataResolution = {
    stageSourcePath: '/robots/demo/approx_box.usd',
    linkIdByPath: {
      '/Robot/base_link': 'base_link',
      '/Robot/arm_link': 'arm_link',
    },
    linkPathById: {
      base_link: '/Robot/base_link',
      arm_link: '/Robot/arm_link',
    },
    jointPathById: {
      arm_joint: '/Robot/joints/arm_joint',
    },
    childLinkPathByJointId: {
      arm_joint: '/Robot/arm_link',
    },
    parentLinkPathByJointId: {
      arm_joint: '/Robot/base_link',
    },
    robotData: {
      name: 'approx_box_robot',
      rootLinkId: 'base_link',
      links: {
        base_link: {
          ...DEFAULT_LINK,
          id: 'base_link',
          name: 'base_link',
          visible: true,
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.NONE,
          },
          collision: {
            ...DEFAULT_LINK.collision,
            type: GeometryType.NONE,
          },
        },
        arm_link: {
          ...DEFAULT_LINK,
          id: 'arm_link',
          name: 'arm_link',
          visible: true,
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.BOX,
            origin: authoredVisualOrigin,
          },
          collision: {
            ...DEFAULT_LINK.collision,
            type: GeometryType.BOX,
            origin: authoredCollisionOrigin,
          },
        },
      },
      joints: {
        arm_joint: {
          ...DEFAULT_JOINT,
          id: 'arm_joint',
          name: 'arm_joint',
          type: JointType.FIXED,
          parentLinkId: 'base_link',
          childLinkId: 'arm_link',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          axis: { x: 0, y: 0, z: 1 },
        },
      },
    },
  };

  const snapshot = {
    render: {
      meshDescriptors: [
        {
          meshId: '/Robot/arm_link/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/arm_link/visuals/mesh_0',
        },
        {
          meshId: '/Robot/arm_link/collisions.proto_mesh_id0',
          sectionName: 'collisions',
          resolvedPrimPath: '/Robot/arm_link/collisions/mesh_0',
        },
      ],
    },
  };

  const hydrated = hydrateUsdViewerRobotResolutionFromRuntime(resolution, snapshot as any, {
    getPreferredLinkWorldTransform: (linkPath: string) => {
      if (linkPath === '/Robot/base_link') return baseWorld.clone();
      if (linkPath === '/Robot/arm_link') return childWorld.clone();
      return null;
    },
    getWorldTransformForPrimPath: (primPath: string) => {
      if (primPath === '/Robot/arm_link/visuals/mesh_0') return visualPrimWorld.clone();
      if (primPath === '/Robot/arm_link/collisions/mesh_0') return collisionPrimWorld.clone();
      return null;
    },
  });

  assert.ok(hydrated);
  assertMatrixClose(
    hydrated.robotData.links.arm_link.visual.origin,
    childWorld
      .clone()
      .invert()
      .multiply(visualPrimWorld.clone())
      .multiply(createOriginMatrix(authoredVisualOrigin)),
    'visual origin should preserve authored approximation center offsets',
  );
  assertMatrixClose(
    hydrated.robotData.links.arm_link.collision.origin,
    childWorld
      .clone()
      .invert()
      .multiply(collisionPrimWorld.clone())
      .multiply(createOriginMatrix(authoredCollisionOrigin)),
    'collision origin should preserve authored approximation center offsets',
  );
});

test('hydrateUsdViewerRobotResolutionFromRuntime preserves authored root world transforms via a synthetic world root', () => {
  const rootWorld = composeMatrix({ x: 0.35, y: -0.4, z: 0.8 }, { r: 0.11, p: -0.07, y: 0.23 });

  const resolution: ViewerRobotDataResolution = {
    stageSourcePath: '/robots/demo/root_pose.usd',
    linkIdByPath: {
      '/Robot/base_link': 'base_link',
    },
    linkPathById: {
      base_link: '/Robot/base_link',
    },
    jointPathById: {},
    childLinkPathByJointId: {},
    parentLinkPathByJointId: {},
    robotData: {
      name: 'root_pose_robot',
      rootLinkId: 'base_link',
      links: {
        base_link: {
          ...DEFAULT_LINK,
          id: 'base_link',
          name: 'base_link',
          visible: true,
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.NONE,
          },
          collision: {
            ...DEFAULT_LINK.collision,
            type: GeometryType.NONE,
          },
        },
      },
      joints: {},
    },
  };

  const hydrated = hydrateUsdViewerRobotResolutionFromRuntime(resolution, null, {
    getPreferredLinkWorldTransform: (linkPath: string) =>
      linkPath === '/Robot/base_link' ? rootWorld.clone() : null,
    getWorldTransformForPrimPath: () => null,
  });

  assert.ok(hydrated);
  assert.equal(hydrated.robotData.rootLinkId, 'world');

  const worldLink = hydrated.robotData.links.world;
  assert.ok(worldLink);
  assert.equal(worldLink.name, 'world');
  assert.equal(worldLink.visual.type, GeometryType.NONE);
  assert.equal(worldLink.collision.type, GeometryType.NONE);
  assert.equal(worldLink.inertial?.mass, 0);

  const rootAnchorJoint = Object.values(hydrated.robotData.joints).find(
    (joint) =>
      joint.parentLinkId === 'world' &&
      joint.childLinkId === 'base_link' &&
      joint.type === JointType.FIXED,
  );

  assert.ok(rootAnchorJoint, 'expected a synthetic fixed joint from world to base_link');
  assertMatrixClose(
    rootAnchorJoint.origin,
    rootWorld,
    'synthetic root joint should preserve the authored root world transform',
  );
});

test('hydrateUsdViewerRobotResolutionFromRuntime maps folded semantic child prims onto their real child links', () => {
  const torsoWorld = composeMatrix({ x: 1, y: 2, z: 3 }, { r: 0.01, p: 0.02, y: 0.03 });
  const headWorld = torsoWorld
    .clone()
    .multiply(composeMatrix({ x: 0.5, y: -0.25, z: 0.75 }, { r: 0.04, p: 0.05, y: 0.06 }));
  const torsoVisualWorld = torsoWorld
    .clone()
    .multiply(composeMatrix({ x: 0.1, y: 0.2, z: 0.3 }, { r: 0.07, p: 0.08, y: 0.09 }));
  const headVisualWorld = headWorld
    .clone()
    .multiply(composeMatrix({ x: -0.4, y: 0.3, z: 0.2 }, { r: -0.02, p: 0.01, y: 0.03 }));
  const torsoCollisionWorld = torsoWorld
    .clone()
    .multiply(composeMatrix({ x: 0.15, y: -0.05, z: 0.25 }, { r: 0, p: 0.04, y: 0.02 }));
  const headCollisionWorld = headWorld
    .clone()
    .multiply(composeMatrix({ x: 0.05, y: 0.06, z: -0.07 }, { r: 0.03, p: -0.01, y: 0.02 }));

  const resolution: ViewerRobotDataResolution = {
    stageSourcePath: '/robots/demo/folded_child.usd',
    linkIdByPath: {
      '/Robot/torso_link': 'torso_link',
      '/Robot/head_link': 'head_link',
    },
    linkPathById: {
      torso_link: '/Robot/torso_link',
      head_link: '/Robot/head_link',
    },
    jointPathById: {},
    childLinkPathByJointId: {
      head_fixed: '/Robot/head_link',
    },
    parentLinkPathByJointId: {
      head_fixed: '/Robot/torso_link',
    },
    robotData: {
      name: 'folded_child',
      rootLinkId: 'torso_link',
      links: {
        torso_link: {
          ...DEFAULT_LINK,
          id: 'torso_link',
          name: 'torso_link',
          visible: true,
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.MESH,
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
          collision: {
            ...DEFAULT_LINK.collision,
            type: GeometryType.MESH,
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
        },
        head_link: {
          ...DEFAULT_LINK,
          id: 'head_link',
          name: 'head_link',
          visible: true,
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.MESH,
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
          collision: {
            ...DEFAULT_LINK.collision,
            type: GeometryType.MESH,
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
        },
      },
      joints: {
        head_fixed: {
          ...DEFAULT_JOINT,
          id: 'head_fixed',
          name: 'head_fixed',
          type: JointType.FIXED,
          parentLinkId: 'torso_link',
          childLinkId: 'head_link',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          axis: { x: 0, y: 0, z: 1 },
        },
      },
    },
  };

  const snapshot = {
    render: {
      meshDescriptors: [
        {
          meshId: '/Robot/torso_link/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/torso_link/visuals/torso_link/mesh',
        },
        {
          meshId: '/Robot/torso_link/visuals.proto_mesh_id1',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/torso_link/visuals/head_link/mesh',
        },
        {
          meshId: '/Robot/torso_link/collisions.proto_mesh_id0',
          sectionName: 'collisions',
          resolvedPrimPath: '/Robot/torso_link/collisions/torso_link/mesh',
        },
        {
          meshId: '/Robot/torso_link/collisions.proto_mesh_id1',
          sectionName: 'collisions',
          resolvedPrimPath: '/Robot/torso_link/collisions/head_link/mesh',
        },
      ],
    },
  };

  const hydrated = hydrateUsdViewerRobotResolutionFromRuntime(resolution, snapshot as any, {
    getPreferredLinkWorldTransform: (linkPath: string) => {
      if (linkPath === '/Robot/torso_link') return torsoWorld.clone();
      if (linkPath === '/Robot/head_link') return headWorld.clone();
      return null;
    },
    getWorldTransformForPrimPath: (primPath: string) => {
      if (primPath === '/Robot/torso_link/visuals/torso_link/mesh') return torsoVisualWorld.clone();
      if (primPath === '/Robot/torso_link/visuals/head_link/mesh') return headVisualWorld.clone();
      if (primPath === '/Robot/torso_link/collisions/torso_link/mesh')
        return torsoCollisionWorld.clone();
      if (primPath === '/Robot/torso_link/collisions/head_link/mesh')
        return headCollisionWorld.clone();
      return null;
    },
  });

  assertMatrixClose(
    hydrated.robotData.links.torso_link.visual.origin,
    torsoWorld.clone().invert().multiply(torsoVisualWorld.clone()),
    'torso visual origin should stay relative to torso link',
  );
  assertMatrixClose(
    hydrated.robotData.links.head_link.visual.origin,
    headWorld.clone().invert().multiply(headVisualWorld.clone()),
    'folded child visual origin should be resolved relative to the semantic child link',
  );
  assertMatrixClose(
    hydrated.robotData.links.torso_link.collision.origin,
    torsoWorld.clone().invert().multiply(torsoCollisionWorld.clone()),
    'torso collision origin should stay relative to torso link',
  );
  assertMatrixClose(
    hydrated.robotData.links.head_link.collision.origin,
    headWorld.clone().invert().multiply(headCollisionWorld.clone()),
    'folded child collision origin should be resolved relative to the semantic child link',
  );
});

test('hydrateUsdViewerRobotResolutionFromRuntime falls back to RobotData kinematics when runtime link transforms are unavailable', () => {
  const childJointOrigin = {
    xyz: { x: 0.6, y: -0.4, z: 0.8 },
    rpy: { r: 0.02, p: 0.03, y: 0.04 },
  };
  const childLinkWorld = composeMatrix(childJointOrigin.xyz, childJointOrigin.rpy);
  const visualWorld = childLinkWorld
    .clone()
    .multiply(composeMatrix({ x: 0.1, y: 0.2, z: 0.3 }, { r: 0.05, p: -0.02, y: 0.01 }));
  const collisionWorld = childLinkWorld
    .clone()
    .multiply(composeMatrix({ x: -0.2, y: 0.15, z: 0.05 }, { r: 0.03, p: 0.04, y: -0.01 }));

  const resolution: ViewerRobotDataResolution = {
    stageSourcePath: '/robots/demo/kinematic_fallback.usd',
    linkIdByPath: {
      '/Robot/base_link': 'base_link',
      '/Robot/child_link': 'child_link',
    },
    linkPathById: {
      base_link: '/Robot/base_link',
      child_link: '/Robot/child_link',
    },
    jointPathById: {},
    childLinkPathByJointId: {
      child_joint: '/Robot/child_link',
    },
    parentLinkPathByJointId: {
      child_joint: '/Robot/base_link',
    },
    robotData: {
      name: 'kinematic_fallback',
      rootLinkId: 'base_link',
      links: {
        base_link: {
          ...DEFAULT_LINK,
          id: 'base_link',
          name: 'base_link',
          visible: true,
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.NONE,
          },
          collision: {
            ...DEFAULT_LINK.collision,
            type: GeometryType.NONE,
          },
        },
        child_link: {
          ...DEFAULT_LINK,
          id: 'child_link',
          name: 'child_link',
          visible: true,
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.MESH,
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
          collision: {
            ...DEFAULT_LINK.collision,
            type: GeometryType.MESH,
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
        },
      },
      joints: {
        child_joint: {
          ...DEFAULT_JOINT,
          id: 'child_joint',
          name: 'child_joint',
          type: JointType.FIXED,
          parentLinkId: 'base_link',
          childLinkId: 'child_link',
          origin: childJointOrigin,
          axis: { x: 0, y: 0, z: 1 },
        },
      },
    },
  };

  const snapshot = {
    render: {
      meshDescriptors: [
        {
          meshId: '/Robot/child_link/visuals.proto_mesh_id0',
          sectionName: 'visuals',
          resolvedPrimPath: '/Robot/child_link/visuals/mesh_0',
        },
        {
          meshId: '/Robot/child_link/collisions.proto_mesh_id0',
          sectionName: 'collisions',
          resolvedPrimPath: '/Robot/child_link/collisions/mesh_0',
        },
      ],
    },
  };

  const hydrated = hydrateUsdViewerRobotResolutionFromRuntime(resolution, snapshot as any, {
    getPreferredLinkWorldTransform: () => null,
    getWorldTransformForPrimPath: (primPath: string) => {
      if (primPath === '/Robot/child_link/visuals/mesh_0') return visualWorld.clone();
      if (primPath === '/Robot/child_link/collisions/mesh_0') return collisionWorld.clone();
      return null;
    },
  });

  assertMatrixClose(
    hydrated.robotData.links.child_link.visual.origin,
    childLinkWorld.clone().invert().multiply(visualWorld.clone()),
    'visual origin should fall back to the current RobotData link frame when runtime link matrices are absent',
  );
  assertMatrixClose(
    hydrated.robotData.links.child_link.collision.origin,
    childLinkWorld.clone().invert().multiply(collisionWorld.clone()),
    'collision origin should fall back to the current RobotData link frame when runtime link matrices are absent',
  );
});

test('hydrateUsdViewerRobotResolutionFromRuntime writes runtime joint angles into RobotState', () => {
  const resolution: ViewerRobotDataResolution = {
    stageSourcePath: '/robots/demo/joint_angles.usd',
    linkIdByPath: {
      '/Robot/base_link': 'base_link',
      '/Robot/leg_link': 'leg_link',
    },
    linkPathById: {
      base_link: '/Robot/base_link',
      leg_link: '/Robot/leg_link',
    },
    jointPathById: {
      leg_joint: '/Robot/joints/leg_joint',
    },
    childLinkPathByJointId: {
      leg_joint: '/Robot/leg_link',
    },
    parentLinkPathByJointId: {
      leg_joint: '/Robot/base_link',
    },
    robotData: {
      name: 'joint_angles',
      rootLinkId: 'base_link',
      links: {
        base_link: {
          ...DEFAULT_LINK,
          id: 'base_link',
          name: 'base_link',
        },
        leg_link: {
          ...DEFAULT_LINK,
          id: 'leg_link',
          name: 'leg_link',
        },
      },
      joints: {
        leg_joint: {
          ...DEFAULT_JOINT,
          id: 'leg_joint',
          name: 'leg_joint',
          type: JointType.REVOLUTE,
          parentLinkId: 'base_link',
          childLinkId: 'leg_link',
          axis: { x: 0, y: 1, z: 0 },
        },
      },
    },
  };

  const hydrated = hydrateUsdViewerRobotResolutionFromRuntime(resolution, null, {
    getPreferredLinkWorldTransform: () => null,
    getWorldTransformForPrimPath: () => null,
    getJointInfoForLink: (linkPath: string) =>
      linkPath === '/Robot/leg_link' ? { angleDeg: 45 } : null,
  });

  assert.ok(hydrated);
  assert.equal(hydrated.robotData.joints.leg_joint?.angle, Math.PI / 4);
});

test('hydrated USD RobotState joint angles drive the next runtime initialization', () => {
  const resolution: ViewerRobotDataResolution = {
    stageSourcePath: '/robots/demo/joint_angle_round_trip.usd',
    linkIdByPath: {
      '/Robot/base_link': 'base_link',
      '/Robot/leg_link': 'leg_link',
    },
    linkPathById: {
      base_link: '/Robot/base_link',
      leg_link: '/Robot/leg_link',
    },
    jointPathById: {
      leg_joint: '/Robot/joints/leg_joint',
    },
    childLinkPathByJointId: {
      leg_joint: '/Robot/leg_link',
    },
    parentLinkPathByJointId: {
      leg_joint: '/Robot/base_link',
    },
    robotData: {
      name: 'joint_angle_round_trip',
      rootLinkId: 'base_link',
      links: {
        base_link: {
          ...DEFAULT_LINK,
          id: 'base_link',
          name: 'base_link',
        },
        leg_link: {
          ...DEFAULT_LINK,
          id: 'leg_link',
          name: 'leg_link',
        },
      },
      joints: {
        leg_joint: {
          ...DEFAULT_JOINT,
          id: 'leg_joint',
          name: 'leg_joint',
          type: JointType.REVOLUTE,
          parentLinkId: 'base_link',
          childLinkId: 'leg_link',
          axis: { x: 0, y: 1, z: 0 },
        },
      },
    },
  };

  const hydrated = hydrateUsdViewerRobotResolutionFromRuntime(resolution, null, {
    getPreferredLinkWorldTransform: () => null,
    getWorldTransformForPrimPath: () => null,
    getJointInfoForLink: (linkPath: string) =>
      linkPath === '/Robot/leg_link' ? { angleDeg: 45 } : null,
  });
  assert.ok(hydrated);

  const appliedAngles: Array<{ linkPath: string; angleDeg: number }> = [];
  createUsdViewerRuntimeRobot({
    resolution: hydrated,
    linkRotationController: {
      apply: () => {},
      getJointInfoForLink: () => ({
        angleDeg: 0,
        lowerLimitDeg: -90,
        upperLimitDeg: 90,
      }),
      setJointAngleForLink: (linkPath: string, angleDeg: number) => {
        appliedAngles.push({ linkPath, angleDeg });
        return {
          angleDeg,
          lowerLimitDeg: -90,
          upperLimitDeg: 90,
        };
      },
    },
  });

  assert.deepEqual(appliedAngles, [{ linkPath: '/Robot/leg_link', angleDeg: 45 }]);
});
