import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { DEFAULT_LINK, JointType, type InteractionSelection, type RobotData } from '@/types';
import { createOriginMatrix } from '@/core/robot/kinematics';
import type { ViewerRobotDataResolution } from '@/lib/robot-parser/usd/viewerRobotData';
import {
  buildUsdOriginPreviewLinkWorldOverrides,
  resolveUsdOriginTransformTarget,
} from './usdOriginTransform.ts';

function createResolution(): ViewerRobotDataResolution {
  const robotData: RobotData = {
    name: 'demo',
    rootLinkId: 'base_link',
    materials: {},
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
      arm_link: {
        ...DEFAULT_LINK,
        id: 'arm_link',
        name: 'arm_link',
      },
      tool_link: {
        ...DEFAULT_LINK,
        id: 'tool_link',
        name: 'tool_link',
      },
    },
    joints: {
      shoulder_joint: {
        id: 'shoulder_joint',
        name: 'shoulder_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'arm_link',
        axis: { x: 0, y: 0, z: 1 },
        origin: {
          xyz: { x: 1, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        limit: { lower: -Math.PI, upper: Math.PI, effort: 1, velocity: 1 },
        dynamics: { damping: 0, friction: 0 },
        hardware: { armature: 0, motorType: '', motorId: '', motorDirection: 1 },
      },
      wrist_joint: {
        id: 'wrist_joint',
        name: 'wrist_joint',
        type: JointType.FIXED,
        parentLinkId: 'arm_link',
        childLinkId: 'tool_link',
        origin: {
          xyz: { x: 0, y: 1, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        dynamics: { damping: 0, friction: 0 },
        hardware: { armature: 0, motorType: '', motorId: '', motorDirection: 1 },
      },
    },
  };

  return {
    robotData,
    stageSourcePath: '/robots/demo.usda',
    linkIdByPath: {
      '/Robot/base_link': 'base_link',
      '/Robot/arm_link': 'arm_link',
      '/Robot/tool_link': 'tool_link',
    },
    linkPathById: {
      base_link: '/Robot/base_link',
      arm_link: '/Robot/arm_link',
      tool_link: '/Robot/tool_link',
    },
    jointPathById: {
      shoulder_joint: '/Robot/shoulder_joint',
      wrist_joint: '/Robot/wrist_joint',
    },
    childLinkPathByJointId: {
      shoulder_joint: '/Robot/arm_link',
      wrist_joint: '/Robot/tool_link',
    },
    parentLinkPathByJointId: {
      shoulder_joint: '/Robot/base_link',
      wrist_joint: '/Robot/arm_link',
    },
  };
}

function assertMatrixClose(actual: THREE.Matrix4 | undefined, expected: THREE.Matrix4, message: string) {
  assert.ok(actual, `${message}: expected matrix to exist`);
  const actualElements = actual!.elements;
  const expectedElements = expected.elements;
  expectedElements.forEach((value, index) => {
    assert.ok(
      Math.abs(actualElements[index] - value) < 1e-6,
      `${message}: element ${index} expected ${value} but got ${actualElements[index]}`,
    );
  });
}

test('resolveUsdOriginTransformTarget maps an origin-axes link selection to its parent joint', () => {
  const selection: InteractionSelection = {
    type: 'link',
    id: 'arm_link',
    helperKind: 'origin-axes',
  };

  const target = resolveUsdOriginTransformTarget(selection, createResolution());

  assert.ok(target);
  assert.equal(target?.jointId, 'shoulder_joint');
  assert.equal(target?.childLinkId, 'arm_link');
  assert.equal(target?.childLinkPath, '/Robot/arm_link');
  assert.equal(target?.parentLinkPath, '/Robot/base_link');
});

test('buildUsdOriginPreviewLinkWorldOverrides moves the selected child subtree in runtime stage space', () => {
  const resolution = createResolution();
  const stageOffset = new THREE.Matrix4().makeTranslation(5, 2, 0);
  const baseWorld = stageOffset.clone();
  const armWorld = stageOffset.clone().multiply(
    createOriginMatrix(resolution.robotData.joints.shoulder_joint.origin),
  );
  const toolWorld = armWorld.clone().multiply(
    createOriginMatrix(resolution.robotData.joints.wrist_joint.origin),
  );

  const runtimeMatrices = new Map<string, THREE.Matrix4>([
    ['/Robot/base_link', baseWorld],
    ['/Robot/arm_link', armWorld],
    ['/Robot/tool_link', toolWorld],
  ]);

  const overrides = buildUsdOriginPreviewLinkWorldOverrides({
    resolution,
    jointId: 'shoulder_joint',
    nextOrigin: {
      xyz: { x: 2, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: Math.PI / 2 },
    },
    linkWorldMatrixResolver: (linkPath) => runtimeMatrices.get(linkPath)?.clone() ?? null,
  });

  assert.ok(overrides);
  assert.equal(overrides?.has('/Robot/base_link'), false, 'root link should stay untouched');

  const expectedArmWorld = stageOffset.clone().multiply(
    createOriginMatrix({
      xyz: { x: 2, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: Math.PI / 2 },
    }),
  );
  const expectedToolWorld = expectedArmWorld.clone().multiply(
    createOriginMatrix(resolution.robotData.joints.wrist_joint.origin),
  );

  assertMatrixClose(overrides?.get('/Robot/arm_link'), expectedArmWorld, 'arm link world matrix');
  assertMatrixClose(overrides?.get('/Robot/tool_link'), expectedToolWorld, 'tool link world matrix');
});
