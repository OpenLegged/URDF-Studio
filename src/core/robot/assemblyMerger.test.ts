import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  GeometryType,
  JointType,
  type AssemblyState,
  type RobotData,
} from '@/types';
import { mergeAssembly } from './assemblyMerger.ts';
import { computeLinkWorldMatrices, createOriginMatrix } from './kinematics.ts';

function createAssemblyState(): AssemblyState {
  return {
    name: 'merge-test',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    components: {
      comp_left: {
        id: 'comp_left',
        name: 'left',
        sourceFile: 'robots/left.urdf',
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { r: 0, p: 0, y: 0 },
        },
        visible: true,
        robot: {
          name: 'left_robot',
          rootLinkId: 'base_link',
          links: {
            base_link: {
              ...DEFAULT_LINK,
              id: 'base_link',
              name: 'left_base_link',
            },
            child_link: {
              ...DEFAULT_LINK,
              id: 'child_link',
              name: 'left_child_link',
            },
          },
          joints: {
            joint: {
              ...DEFAULT_JOINT,
              id: 'joint',
              name: 'left_joint',
              type: JointType.FIXED,
              parentLinkId: 'base_link',
              childLinkId: 'child_link',
            },
          },
        },
      },
      comp_right: {
        id: 'comp_right',
        name: 'right',
        sourceFile: 'robots/right.urdf',
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { r: 0, p: 0, y: 0 },
        },
        visible: true,
        robot: {
          name: 'right_robot',
          rootLinkId: 'base_link',
          links: {
            base_link: {
              ...DEFAULT_LINK,
              id: 'base_link',
              name: 'right_base_link',
            },
          },
          joints: {},
        },
      },
    },
    bridges: {
      bridge_join: {
        id: 'bridge_join',
        name: 'bridge_join',
        parentComponentId: 'comp_left',
        parentLinkId: 'base_link',
        childComponentId: 'comp_right',
        childLinkId: 'base_link',
        joint: {
          ...DEFAULT_JOINT,
          id: 'bridge_join',
          name: 'bridge_join',
          type: JointType.FIXED,
          parentLinkId: 'base_link',
          childLinkId: 'base_link',
        },
      },
    },
  };
}

function createSingleLinkComponent(componentId: string, name: string) {
  const rootLinkId = 'base_link';

  return {
    id: componentId,
    name,
    sourceFile: `robots/${name}.urdf`,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    visible: true,
    robot: {
      name: `${name}_robot`,
      rootLinkId,
      links: {
        [rootLinkId]: {
          ...DEFAULT_LINK,
          id: rootLinkId,
          name: `${name}_base_link`,
        },
      },
      joints: {},
    },
  };
}

function createDynamicChainComponent(componentId: string, name: string) {
  const baseLinkId = 'base_link';
  const elbowLinkId = 'elbow_link';
  const toolLinkId = 'tool_link';
  const sensorLinkId = 'sensor_link';
  const shoulderJointId = 'shoulder_joint';
  const wristSlideJointId = 'wrist_slide_joint';
  const sensorMountJointId = 'sensor_mount_joint';

  return {
    id: componentId,
    name,
    sourceFile: `robots/${name}.urdf`,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    visible: true,
    robot: {
      name: `${name}_robot`,
      rootLinkId: baseLinkId,
      links: {
        [baseLinkId]: {
          ...DEFAULT_LINK,
          id: baseLinkId,
          name: `${name}_base_link`,
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.BOX,
            dimensions: { x: 0.4, y: 0.2, z: 0.1 },
            origin: {
              xyz: { x: 0.15, y: -0.05, z: 0.02 },
              rpy: { r: 0.1, p: 0, y: -0.15 },
            },
          },
        },
        [elbowLinkId]: {
          ...DEFAULT_LINK,
          id: elbowLinkId,
          name: `${name}_elbow_link`,
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.CYLINDER,
            dimensions: { x: 0.08, y: 0.35, z: 0.08 },
            origin: {
              xyz: { x: -0.08, y: 0.12, z: 0.04 },
              rpy: { r: 0, p: 0.2, y: 0.05 },
            },
          },
        },
        [toolLinkId]: {
          ...DEFAULT_LINK,
          id: toolLinkId,
          name: `${name}_tool_link`,
        },
        [sensorLinkId]: {
          ...DEFAULT_LINK,
          id: sensorLinkId,
          name: `${name}_sensor_link`,
        },
      },
      joints: {
        [shoulderJointId]: {
          ...DEFAULT_JOINT,
          id: shoulderJointId,
          name: shoulderJointId,
          type: JointType.REVOLUTE,
          parentLinkId: baseLinkId,
          childLinkId: elbowLinkId,
          origin: {
            xyz: { x: 0.75, y: -0.5, z: 0.25 },
            rpy: { r: 0.1, p: -0.2, y: 0.3 },
          },
          axis: { x: 0, y: 0, z: 1 },
          limit: { lower: -1.2, upper: 1.6, effort: 20, velocity: 4 },
          safetyController: {
            softLowerLimit: -0.8,
            softUpperLimit: 1.1,
            kPosition: 12,
            kVelocity: 3.5,
          },
          angle: 0.4,
        },
        [wristSlideJointId]: {
          ...DEFAULT_JOINT,
          id: wristSlideJointId,
          name: wristSlideJointId,
          type: JointType.PRISMATIC,
          parentLinkId: elbowLinkId,
          childLinkId: toolLinkId,
          origin: {
            xyz: { x: 0.1, y: 0.2, z: 0.3 },
            rpy: { r: -0.15, p: 0.25, y: -0.35 },
          },
          axis: { x: 1, y: 0, z: 0 },
          limit: { lower: -0.1, upper: 0.5, effort: 12, velocity: 2 },
          safetyController: {
            softLowerLimit: -0.04,
            softUpperLimit: 0.2,
            kPosition: 5,
            kVelocity: 1.5,
          },
          angle: 0.2,
        },
        [sensorMountJointId]: {
          ...DEFAULT_JOINT,
          id: sensorMountJointId,
          name: sensorMountJointId,
          type: JointType.FIXED,
          parentLinkId: baseLinkId,
          childLinkId: sensorLinkId,
          origin: {
            xyz: { x: -0.2, y: 0.4, z: 0.1 },
            rpy: { r: 0.05, p: 0.1, y: -0.2 },
          },
        },
      },
    },
  };
}

function createUnsupportedDynamicComponent(componentId: string, name: string) {
  const baseLinkId = 'base_link';
  const toolLinkId = 'tool_link';
  const jointId = 'ball_joint';

  return {
    id: componentId,
    name,
    sourceFile: `robots/${name}.urdf`,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    visible: true,
    robot: {
      name: `${name}_robot`,
      rootLinkId: baseLinkId,
      links: {
        [baseLinkId]: {
          ...DEFAULT_LINK,
          id: baseLinkId,
          name: `${name}_base_link`,
        },
        [toolLinkId]: {
          ...DEFAULT_LINK,
          id: toolLinkId,
          name: `${name}_tool_link`,
        },
      },
      joints: {
        [jointId]: {
          ...DEFAULT_JOINT,
          id: jointId,
          name: jointId,
          type: JointType.BALL,
          parentLinkId: baseLinkId,
          childLinkId: toolLinkId,
          origin: {
            xyz: { x: 0.4, y: 0, z: 0 },
            rpy: { r: 0, p: 0.2, y: 0 },
          },
        },
      },
    },
  };
}

function createFloatingRootComponent(componentId: string, name: string) {
  const worldLinkId = 'world';
  const thoraxLinkId = 'thorax_link';
  const wingMountLinkId = 'wing_mount_link';
  const wingTipLinkId = 'wing_tip_link';
  const sensorLinkId = 'sensor_link';
  const floatingJointId = 'free_joint';
  const wingMountJointId = 'wing_mount_joint';
  const wingPitchJointId = 'wing_pitch_joint';
  const sensorJointId = 'sensor_joint';

  return {
    id: componentId,
    name,
    sourceFile: `robots/${name}.xml`,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    visible: true,
    robot: {
      name: `${name}_robot`,
      rootLinkId: worldLinkId,
      links: {
        [worldLinkId]: {
          ...DEFAULT_LINK,
          id: worldLinkId,
          name: `${name}_world`,
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.NONE,
            dimensions: { x: 0, y: 0, z: 0 },
          },
          collision: {
            ...DEFAULT_LINK.collision,
            type: GeometryType.NONE,
            dimensions: { x: 0, y: 0, z: 0 },
          },
        },
        [thoraxLinkId]: {
          ...DEFAULT_LINK,
          id: thoraxLinkId,
          name: `${name}_thorax`,
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.BOX,
            dimensions: { x: 0.12, y: 0.08, z: 0.05 },
            origin: {
              xyz: { x: 0.03, y: -0.01, z: 0.02 },
              rpy: { r: 0.1, p: -0.2, y: 0.15 },
            },
          },
        },
        [wingMountLinkId]: {
          ...DEFAULT_LINK,
          id: wingMountLinkId,
          name: `${name}_wing_mount`,
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.CYLINDER,
            dimensions: { x: 0.01, y: 0.08, z: 0.01 },
            origin: {
              xyz: { x: 0.01, y: 0.03, z: 0 },
              rpy: { r: 0.25, p: 0.05, y: -0.1 },
            },
          },
        },
        [wingTipLinkId]: {
          ...DEFAULT_LINK,
          id: wingTipLinkId,
          name: `${name}_wing_tip`,
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.BOX,
            dimensions: { x: 0.18, y: 0.03, z: 0.002 },
            origin: {
              xyz: { x: 0.08, y: 0.01, z: 0 },
              rpy: { r: 0.02, p: -0.03, y: 0.2 },
            },
          },
        },
        [sensorLinkId]: {
          ...DEFAULT_LINK,
          id: sensorLinkId,
          name: `${name}_sensor`,
        },
      },
      joints: {
        [floatingJointId]: {
          ...DEFAULT_JOINT,
          id: floatingJointId,
          name: floatingJointId,
          type: JointType.FLOATING,
          parentLinkId: worldLinkId,
          childLinkId: thoraxLinkId,
          origin: {
            xyz: { x: 0.2, y: -0.1, z: 0.35 },
            rpy: { r: 0.18, p: -0.22, y: 0.31 },
          },
          axis: undefined,
          limit: undefined,
        },
        [wingMountJointId]: {
          ...DEFAULT_JOINT,
          id: wingMountJointId,
          name: wingMountJointId,
          type: JointType.FIXED,
          parentLinkId: thoraxLinkId,
          childLinkId: wingMountLinkId,
          origin: {
            xyz: { x: 0.04, y: 0.16, z: 0.03 },
            rpy: { r: 0.12, p: 0.08, y: -0.05 },
          },
          axis: undefined,
          limit: undefined,
        },
        [wingPitchJointId]: {
          ...DEFAULT_JOINT,
          id: wingPitchJointId,
          name: wingPitchJointId,
          type: JointType.REVOLUTE,
          parentLinkId: wingMountLinkId,
          childLinkId: wingTipLinkId,
          origin: {
            xyz: { x: 0.05, y: 0.02, z: 0.01 },
            rpy: { r: -0.08, p: 0.04, y: 0.21 },
          },
          axis: { x: 0, y: 1, z: 0 },
          limit: { lower: -1.1, upper: 0.9, effort: 3, velocity: 12 },
          angle: 0.37,
        },
        [sensorJointId]: {
          ...DEFAULT_JOINT,
          id: sensorJointId,
          name: sensorJointId,
          type: JointType.FIXED,
          parentLinkId: thoraxLinkId,
          childLinkId: sensorLinkId,
          origin: {
            xyz: { x: -0.03, y: -0.09, z: 0.02 },
            rpy: { r: 0.04, p: -0.06, y: 0.09 },
          },
          axis: undefined,
          limit: undefined,
        },
      },
    },
  };
}

function getRelativeLinkMatrix(
  robot: RobotData,
  referenceLinkId: string,
  linkId: string,
): THREE.Matrix4 {
  const linkWorldMatrices = computeLinkWorldMatrices(robot);
  const referenceMatrix = linkWorldMatrices[referenceLinkId];
  const linkMatrix = linkWorldMatrices[linkId];
  assert.ok(referenceMatrix, `expected reference matrix for ${referenceLinkId}`);
  assert.ok(linkMatrix, `expected link matrix for ${linkId}`);

  return referenceMatrix.clone().invert().multiply(linkMatrix);
}

function getRelativeVisualMatrix(
  robot: RobotData,
  referenceLinkId: string,
  linkId: string,
): THREE.Matrix4 {
  const linkWorldMatrices = computeLinkWorldMatrices(robot);
  const referenceMatrix = linkWorldMatrices[referenceLinkId];
  const linkMatrix = linkWorldMatrices[linkId];
  const visualOrigin = robot.links[linkId]?.visual.origin;
  assert.ok(referenceMatrix, `expected reference matrix for ${referenceLinkId}`);
  assert.ok(linkMatrix, `expected link matrix for ${linkId}`);
  assert.ok(visualOrigin, `expected visual origin for ${linkId}`);

  return referenceMatrix
    .clone()
    .invert()
    .multiply(linkMatrix)
    .multiply(createOriginMatrix(visualOrigin));
}

function assertMatrixClose(
  actualMatrix: THREE.Matrix4,
  expectedMatrix: THREE.Matrix4,
  message: string,
) {
  const maxDelta = actualMatrix.elements.reduce((delta, value, index) => {
    return Math.max(delta, Math.abs(value - expectedMatrix.elements[index]!));
  }, 0);

  assert.ok(maxDelta < 1e-6, `${message}; max delta was ${maxDelta}`);
}

test('mergeAssembly projects source-local component entities and synthesizes bridge joints', () => {
  const assemblyState = createAssemblyState();

  const merged = mergeAssembly(assemblyState);

  assert.notEqual(
    merged.links.comp_left_base_link,
    assemblyState.components.comp_left.robot.links.base_link,
  );
  assert.notEqual(
    merged.joints.comp_left_joint,
    assemblyState.components.comp_left.robot.joints.joint,
  );
  assert.equal(assemblyState.components.comp_left.robot.rootLinkId, 'base_link');
  assert.equal(assemblyState.components.comp_right.robot.rootLinkId, 'base_link');
  assert.notEqual(merged.joints.bridge_join, assemblyState.bridges.bridge_join.joint);
  assert.equal(merged.joints.bridge_join.parentLinkId, 'comp_left_base_link');
  assert.equal(merged.joints.bridge_join.childLinkId, 'comp_right_base_link');
});

test('mergeAssembly reroots a dynamic child subtree when a bridge targets a non-root child link', () => {
  const parentComponent = createSingleLinkComponent('comp_parent', 'parent');
  const childComponent = createDynamicChainComponent('comp_child', 'child');
  const originalChildRobot = structuredClone(childComponent.robot);

  const assemblyState: AssemblyState = {
    name: 'reroot-fixed-merge',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    components: {
      [parentComponent.id]: parentComponent,
      [childComponent.id]: childComponent,
    },
    bridges: {
      bridge_attach_tool: {
        id: 'bridge_attach_tool',
        name: 'bridge_attach_tool',
        parentComponentId: parentComponent.id,
        parentLinkId: 'base_link',
        childComponentId: childComponent.id,
        childLinkId: 'tool_link',
        joint: {
          ...DEFAULT_JOINT,
          id: 'bridge_attach_tool',
          name: 'bridge_attach_tool',
          type: JointType.FIXED,
          parentLinkId: 'base_link',
          childLinkId: 'tool_link',
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
      },
    },
  };

  const merged = mergeAssembly(assemblyState);
  const incomingToolJoints = Object.values(merged.joints).filter(
    (joint) => joint.childLinkId === 'comp_child_tool_link',
  );

  assert.equal(incomingToolJoints.length, 1);
  assert.equal(incomingToolJoints[0]?.id, 'bridge_attach_tool');
  assert.equal(merged.rootLinkId, 'comp_parent_base_link');
  assert.deepEqual(merged.joints.comp_child_shoulder_joint.axis, { x: 0, y: 0, z: -1 });
  assert.deepEqual(merged.joints.comp_child_wrist_slide_joint.axis, { x: -1, y: 0, z: 0 });
  assert.deepEqual(merged.joints.comp_child_shoulder_joint.limit, {
    lower: originalChildRobot.joints.shoulder_joint.limit?.lower ?? 0,
    upper: originalChildRobot.joints.shoulder_joint.limit?.upper ?? 0,
    effort: originalChildRobot.joints.shoulder_joint.limit?.effort ?? 0,
    velocity: originalChildRobot.joints.shoulder_joint.limit?.velocity ?? 0,
  });
  assert.deepEqual(merged.joints.comp_child_wrist_slide_joint.limit, {
    lower: originalChildRobot.joints.wrist_slide_joint.limit?.lower ?? 0,
    upper: originalChildRobot.joints.wrist_slide_joint.limit?.upper ?? 0,
    effort: originalChildRobot.joints.wrist_slide_joint.limit?.effort ?? 0,
    velocity: originalChildRobot.joints.wrist_slide_joint.limit?.velocity ?? 0,
  });
  assert.deepEqual(merged.joints.comp_child_shoulder_joint.safetyController, {
    softLowerLimit: originalChildRobot.joints.shoulder_joint.safetyController?.softLowerLimit,
    softUpperLimit: originalChildRobot.joints.shoulder_joint.safetyController?.softUpperLimit,
    kPosition: originalChildRobot.joints.shoulder_joint.safetyController?.kPosition,
    kVelocity: originalChildRobot.joints.shoulder_joint.safetyController?.kVelocity,
  });
  assert.deepEqual(merged.joints.comp_child_wrist_slide_joint.safetyController, {
    softLowerLimit: originalChildRobot.joints.wrist_slide_joint.safetyController?.softLowerLimit,
    softUpperLimit: originalChildRobot.joints.wrist_slide_joint.safetyController?.softUpperLimit,
    kPosition: originalChildRobot.joints.wrist_slide_joint.safetyController?.kPosition,
    kVelocity: originalChildRobot.joints.wrist_slide_joint.safetyController?.kVelocity,
  });
  assert.ok(
    (merged.joints.comp_child_wrist_slide_joint.angle ?? 0) >=
      (merged.joints.comp_child_wrist_slide_joint.limit?.lower ?? Number.NEGATIVE_INFINITY) &&
      (merged.joints.comp_child_wrist_slide_joint.angle ?? 0) <=
        (merged.joints.comp_child_wrist_slide_joint.limit?.upper ?? Number.POSITIVE_INFINITY),
    'the rerooted prismatic joint angle should stay inside the preserved source range',
  );

  assert.equal(merged.joints.comp_child_wrist_slide_joint.parentLinkId, 'comp_child_tool_link');
  assert.equal(merged.joints.comp_child_wrist_slide_joint.childLinkId, 'comp_child_elbow_link');
  assert.equal(merged.joints.comp_child_shoulder_joint.parentLinkId, 'comp_child_elbow_link');
  assert.equal(merged.joints.comp_child_shoulder_joint.childLinkId, 'comp_child_base_link');

  assertMatrixClose(
    getRelativeLinkMatrix(merged, 'comp_child_tool_link', 'comp_child_tool_link'),
    getRelativeLinkMatrix(originalChildRobot, 'tool_link', 'tool_link'),
    'tool link should stay at the reroot origin',
  );
  assertMatrixClose(
    getRelativeLinkMatrix(merged, 'comp_child_tool_link', 'comp_child_sensor_link'),
    getRelativeLinkMatrix(originalChildRobot, 'tool_link', 'sensor_link'),
    'off-path branch links should stay attached at the same physical pose',
  );
  assertMatrixClose(
    getRelativeVisualMatrix(merged, 'comp_child_tool_link', 'comp_child_base_link'),
    getRelativeVisualMatrix(originalChildRobot, 'tool_link', 'base_link'),
    'path link visuals should keep their physical placement after frame rewrites',
  );
  assertMatrixClose(
    getRelativeVisualMatrix(merged, 'comp_child_tool_link', 'comp_child_elbow_link'),
    getRelativeVisualMatrix(originalChildRobot, 'tool_link', 'elbow_link'),
    'intermediate link visuals should keep their physical placement after frame rewrites',
  );

  assert.equal(childComponent.robot.rootLinkId, originalChildRobot.rootLinkId);
  assert.equal(
    childComponent.robot.joints.shoulder_joint.parentLinkId,
    originalChildRobot.joints.shoulder_joint.parentLinkId,
  );
  assert.equal(
    childComponent.robot.joints.shoulder_joint.childLinkId,
    originalChildRobot.joints.shoulder_joint.childLinkId,
  );
});

test('mergeAssembly reroots a floating-root child subtree when a bridge targets a descendant link', () => {
  const parentComponent = createSingleLinkComponent('comp_parent', 'parent');
  const childComponent = createFloatingRootComponent('comp_child', 'fruitfly');
  const originalChildRobot = structuredClone(childComponent.robot);

  const assemblyState: AssemblyState = {
    name: 'reroot-floating-merge',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    components: {
      [parentComponent.id]: parentComponent,
      [childComponent.id]: childComponent,
    },
    bridges: {
      bridge_attach_wing: {
        id: 'bridge_attach_wing',
        name: 'bridge_attach_wing',
        parentComponentId: parentComponent.id,
        parentLinkId: 'base_link',
        childComponentId: childComponent.id,
        childLinkId: 'wing_tip_link',
        joint: {
          ...DEFAULT_JOINT,
          id: 'bridge_attach_wing',
          name: 'bridge_attach_wing',
          type: JointType.FIXED,
          parentLinkId: 'base_link',
          childLinkId: 'wing_tip_link',
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
      },
    },
  };

  const merged = mergeAssembly(assemblyState);
  const incomingWingTipJoints = Object.values(merged.joints).filter(
    (joint) => joint.childLinkId === 'comp_child_wing_tip_link',
  );

  assert.equal(incomingWingTipJoints.length, 1);
  assert.equal(incomingWingTipJoints[0]?.id, 'bridge_attach_wing');
  assert.equal(merged.rootLinkId, 'comp_parent_base_link');
  assert.equal(merged.joints.comp_child_free_joint.parentLinkId, 'comp_child_thorax_link');
  assert.equal(merged.joints.comp_child_free_joint.childLinkId, 'comp_child_world');
  assert.deepEqual(merged.joints.comp_child_wing_pitch_joint.axis, { x: 0, y: -1, z: 0 });
  assert.deepEqual(merged.joints.comp_child_wing_pitch_joint.limit, {
    lower: originalChildRobot.joints.wing_pitch_joint.limit?.lower ?? 0,
    upper: originalChildRobot.joints.wing_pitch_joint.limit?.upper ?? 0,
    effort: originalChildRobot.joints.wing_pitch_joint.limit?.effort ?? 0,
    velocity: originalChildRobot.joints.wing_pitch_joint.limit?.velocity ?? 0,
  });

  assertMatrixClose(
    getRelativeLinkMatrix(merged, 'comp_child_wing_tip_link', 'comp_child_wing_tip_link'),
    getRelativeLinkMatrix(originalChildRobot, 'wing_tip_link', 'wing_tip_link'),
    'wing tip should stay at the reroot origin',
  );
  assertMatrixClose(
    getRelativeLinkMatrix(merged, 'comp_child_wing_tip_link', 'comp_child_sensor_link'),
    getRelativeLinkMatrix(originalChildRobot, 'wing_tip_link', 'sensor_link'),
    'off-path sensor links should keep the same pose relative to the attached wing tip',
  );
  assertMatrixClose(
    getRelativeVisualMatrix(merged, 'comp_child_wing_tip_link', 'comp_child_wing_mount_link'),
    getRelativeVisualMatrix(originalChildRobot, 'wing_tip_link', 'wing_mount_link'),
    'wing mount visuals should keep their physical placement after floating-root rerooting',
  );
  assertMatrixClose(
    getRelativeVisualMatrix(merged, 'comp_child_wing_tip_link', 'comp_child_thorax_link'),
    getRelativeVisualMatrix(originalChildRobot, 'wing_tip_link', 'thorax_link'),
    'thorax visuals should keep their physical placement after floating-root rerooting',
  );
});

test('mergeAssembly fails fast when rerooting would need to reverse an unsupported joint type', () => {
  const parentComponent = createSingleLinkComponent('comp_parent', 'parent');
  const childComponent = createUnsupportedDynamicComponent('comp_child', 'child');

  const assemblyState: AssemblyState = {
    name: 'reroot-dynamic-merge',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    components: {
      [parentComponent.id]: parentComponent,
      [childComponent.id]: childComponent,
    },
    bridges: {
      bridge_attach_tool: {
        id: 'bridge_attach_tool',
        name: 'bridge_attach_tool',
        parentComponentId: parentComponent.id,
        parentLinkId: 'base_link',
        childComponentId: childComponent.id,
        childLinkId: 'tool_link',
        joint: {
          ...DEFAULT_JOINT,
          id: 'bridge_attach_tool',
          name: 'bridge_attach_tool',
          type: JointType.FIXED,
          parentLinkId: 'base_link',
          childLinkId: 'tool_link',
        },
      },
    },
  };

  assert.throws(
    () => mergeAssembly(assemblyState),
    /Cannot reroot assembly component "comp_child" through unsupported joint "comp_child_ball_joint" of type "ball"/,
  );
});

test('mergeAssembly fails fast when a visible bridge references a missing link', () => {
  const parentComponent = createSingleLinkComponent('comp_parent', 'parent');
  const childComponent = createSingleLinkComponent('comp_child', 'child');

  const assemblyState: AssemblyState = {
    name: 'missing-bridge-link',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    components: {
      [parentComponent.id]: parentComponent,
      [childComponent.id]: childComponent,
    },
    bridges: {
      bridge_attach_missing: {
        id: 'bridge_attach_missing',
        name: 'bridge_attach_missing',
        parentComponentId: parentComponent.id,
        parentLinkId: 'base_link',
        childComponentId: childComponent.id,
        childLinkId: 'missing_link',
        joint: {
          ...DEFAULT_JOINT,
          id: 'bridge_attach_missing',
          name: 'bridge_attach_missing',
          type: JointType.FIXED,
          parentLinkId: 'base_link',
          childLinkId: 'missing_link',
        },
      },
    },
  };

  assert.throws(
    () => mergeAssembly(assemblyState),
    /Cannot project component "comp_child" because bridge child link "missing_link" does not exist/,
  );
});

test('mergeAssembly fails fast when a link would end up with multiple parent joints', () => {
  const leftParentComponent = createSingleLinkComponent('comp_left', 'left');
  const rightParentComponent = createSingleLinkComponent('comp_right', 'right');
  const childComponent = createSingleLinkComponent('comp_child', 'child');

  const assemblyState: AssemblyState = {
    name: 'duplicate-parent-merge',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    components: {
      [leftParentComponent.id]: leftParentComponent,
      [rightParentComponent.id]: rightParentComponent,
      [childComponent.id]: childComponent,
    },
    bridges: {
      bridge_left_child: {
        id: 'bridge_left_child',
        name: 'bridge_left_child',
        parentComponentId: leftParentComponent.id,
        parentLinkId: 'base_link',
        childComponentId: childComponent.id,
        childLinkId: 'base_link',
        joint: {
          ...DEFAULT_JOINT,
          id: 'bridge_left_child',
          name: 'bridge_left_child',
          type: JointType.FIXED,
          parentLinkId: 'base_link',
          childLinkId: 'base_link',
        },
      },
      bridge_right_child: {
        id: 'bridge_right_child',
        name: 'bridge_right_child',
        parentComponentId: rightParentComponent.id,
        parentLinkId: 'base_link',
        childComponentId: childComponent.id,
        childLinkId: 'base_link',
        joint: {
          ...DEFAULT_JOINT,
          id: 'bridge_right_child',
          name: 'bridge_right_child',
          type: JointType.FIXED,
          parentLinkId: 'base_link',
          childLinkId: 'base_link',
        },
      },
    },
  };

  assert.throws(
    () => mergeAssembly(assemblyState),
    /Cannot merge assembly "duplicate-parent-merge" because link "comp_child_base_link" would have multiple parent joints: bridge_left_child, bridge_right_child/,
  );
});

test('mergeAssembly converts a cyclic bridge into a closed-loop constraint while preserving a rooted tree', () => {
  const leftComponent = createSingleLinkComponent('comp_left', 'left');
  const rightComponent = createSingleLinkComponent('comp_right', 'right');

  const assemblyState: AssemblyState = {
    name: 'cyclic-assembly-merge',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    components: {
      [leftComponent.id]: leftComponent,
      [rightComponent.id]: rightComponent,
    },
    bridges: {
      bridge_left_right: {
        id: 'bridge_left_right',
        name: 'bridge_left_right',
        parentComponentId: leftComponent.id,
        parentLinkId: 'base_link',
        childComponentId: rightComponent.id,
        childLinkId: 'base_link',
        joint: {
          ...DEFAULT_JOINT,
          id: 'bridge_left_right',
          name: 'bridge_left_right',
          type: JointType.FIXED,
          parentLinkId: 'base_link',
          childLinkId: 'base_link',
          origin: {
            xyz: { x: 1, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
      },
      bridge_right_left: {
        id: 'bridge_right_left',
        name: 'bridge_right_left',
        parentComponentId: rightComponent.id,
        parentLinkId: 'base_link',
        childComponentId: leftComponent.id,
        childLinkId: 'base_link',
        joint: {
          ...DEFAULT_JOINT,
          id: 'bridge_right_left',
          name: 'bridge_right_left',
          type: JointType.FIXED,
          parentLinkId: 'base_link',
          childLinkId: 'base_link',
          origin: {
            xyz: { x: -1, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
      },
    },
  };

  const merged = mergeAssembly(assemblyState);

  assert.equal(merged.rootLinkId, 'comp_left_base_link');
  assert.ok(merged.joints.bridge_left_right);
  assert.equal(merged.joints.bridge_right_left, undefined);
  assert.ok(merged.closedLoopConstraints);
  assert.equal(merged.closedLoopConstraints?.length, 1);
  assert.deepEqual(merged.closedLoopConstraints?.[0], {
    id: 'bridge_right_left',
    type: 'joint',
    jointType: JointType.FIXED,
    axis: DEFAULT_JOINT.axis,
    limit: DEFAULT_JOINT.limit,
    origin: {
      xyz: { x: -1, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: 0 },
    },
    linkAId: 'comp_right_base_link',
    linkBId: 'comp_left_base_link',
    anchorLocalA: { x: -1, y: 0, z: 0 },
    anchorLocalB: { x: 0, y: 0, z: 0 },
    anchorWorld: { x: 0, y: 0, z: 0 },
    source: undefined,
  });
});

test('mergeAssembly converts a movable cyclic bridge into a joint closed-loop constraint', () => {
  const leftComponent = createSingleLinkComponent('comp_left', 'left');
  const rightComponent = createSingleLinkComponent('comp_right', 'right');

  const assemblyState: AssemblyState = {
    name: 'movable-cyclic-motion-bridge',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    components: {
      [leftComponent.id]: leftComponent,
      [rightComponent.id]: rightComponent,
    },
    bridges: {
      bridge_left_right: {
        id: 'bridge_left_right',
        name: 'bridge_left_right',
        parentComponentId: leftComponent.id,
        parentLinkId: 'base_link',
        childComponentId: rightComponent.id,
        childLinkId: 'base_link',
        joint: {
          ...DEFAULT_JOINT,
          id: 'bridge_left_right',
          name: 'bridge_left_right',
          type: JointType.FIXED,
          parentLinkId: 'base_link',
          childLinkId: 'base_link',
        },
      },
      bridge_right_left: {
        id: 'bridge_right_left',
        name: 'bridge_right_left',
        parentComponentId: rightComponent.id,
        parentLinkId: 'base_link',
        childComponentId: leftComponent.id,
        childLinkId: 'base_link',
        joint: {
          ...DEFAULT_JOINT,
          id: 'bridge_right_left',
          name: 'bridge_right_left',
          type: JointType.REVOLUTE,
          parentLinkId: 'base_link',
          childLinkId: 'base_link',
        },
      },
    },
  };

  const merged = mergeAssembly(assemblyState);

  assert.equal(merged.joints['bridge_left_right']?.type, JointType.FIXED);
  const cyclicConstraint = merged.closedLoopConstraints?.find(
    (constraint) => constraint.id === 'bridge_right_left',
  );
  assert.ok(
    cyclicConstraint,
    'expected the movable cyclic bridge to become a closed-loop constraint',
  );
  assert.equal(cyclicConstraint.type, 'joint');
  assert.equal(cyclicConstraint.jointType, JointType.REVOLUTE);
});

for (const jointType of [JointType.FIXED, JointType.REVOLUTE, JointType.CONTINUOUS, JointType.PRISMATIC]) {
  test(`mergeAssembly preserves a same-component ${jointType} closed-loop bridge`, () => {
    const chainComponent = createDynamicChainComponent('comp_chain', 'chain');

    const assemblyState: AssemblyState = {
      name: 'self-loop-bridge',
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { r: 0, p: 0, y: 0 },
      },
      components: {
        [chainComponent.id]: chainComponent,
      },
      bridges: {
        bridge_self_loop: {
          id: 'bridge_self_loop',
          name: 'bridge_self_loop',
          parentComponentId: chainComponent.id,
          parentLinkId: 'base_link',
          childComponentId: chainComponent.id,
          childLinkId: 'tool_link',
          joint: {
            ...DEFAULT_JOINT,
            id: 'bridge_self_loop',
            name: 'bridge_self_loop',
            type: jointType,
            parentLinkId: 'base_link',
            childLinkId: 'tool_link',
            axis: { x: 0, y: 0, z: 1 },
            limit: { lower: -1, upper: 1, effort: 10, velocity: 5 },
          },
        },
      },
    };

    const merged = mergeAssembly(assemblyState);

    // The self-loop must not enter the structural joint map.
    assert.equal(merged.joints['bridge_self_loop'], undefined);

    const selfLoopConstraint = merged.closedLoopConstraints?.find(
      (constraint) => constraint.id === 'bridge_self_loop',
    );
    assert.ok(
      selfLoopConstraint,
      'expected the self-loop bridge to become a closed-loop constraint',
    );
    assert.equal(selfLoopConstraint.type, 'joint');
    assert.equal(selfLoopConstraint.jointType, jointType);
    assert.equal(selfLoopConstraint.linkAId, 'comp_chain_base_link');
    assert.equal(selfLoopConstraint.linkBId, 'comp_chain_tool_link');
    assert.deepEqual(selfLoopConstraint.axis, { x: 0, y: 0, z: 1 });
    assert.equal(selfLoopConstraint.limit?.lower, -1);
    assert.equal(selfLoopConstraint.limit?.upper, 1);
    assert.deepEqual(selfLoopConstraint.origin, assemblyState.bridges.bridge_self_loop.joint.origin);
  });
}
