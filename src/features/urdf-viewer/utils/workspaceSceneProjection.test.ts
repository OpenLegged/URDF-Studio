import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  computeLinkWorldMatrices,
  createAssemblyScenePlacement,
  createAssemblySceneProjection,
} from '@/core/robot';
import { buildAssemblyTransformMatrix } from '@/core/robot/assemblyBridgeAlignment';
import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  JointType,
  entityRefKey,
  type AssemblyState,
  type AssemblyTransform,
  type EntityRef,
  type RobotData,
  type WorkspaceSelection,
} from '@/types';

import {
  EMPTY_RENDERER_SELECTION,
  groupProjectedJointMotionByComponent,
  projectJointPreviewToWorkspaceTargets,
  projectRendererJointMotionToWorkspaceTargets,
  projectWorkspaceJointMotionToRenderer,
  projectWorkspaceSelectionToRenderer,
  projectJointPreviewToWorkspaceComponents,
  resolveRendererSelectionToWorkspace,
  resolveWorkspaceFocusTarget,
} from './workspaceSceneProjection';

function assertMatrixClose(
  actual: THREE.Matrix4,
  expected: THREE.Matrix4,
  message?: string,
): void {
  actual.elements.forEach((value, index) => {
    assert.ok(
      Math.abs(value - expected.elements[index]!) <= 1e-9,
      message ?? `matrix element ${index} differs: ${value} vs ${expected.elements[index]}`,
    );
  });
}

function transform(x = 0, y = 0, z = 0): AssemblyTransform {
  return {
    position: { x, y, z },
    rotation: { r: x / 10, p: y / 10, y: z / 10 },
  };
}

function robot(name: string, rootId = 'base', jointId = 'hinge'): RobotData {
  const childId = 'tip';
  return {
    name,
    rootLinkId: rootId,
    links: {
      [rootId]: { ...structuredClone(DEFAULT_LINK), id: rootId, name: rootId },
      [childId]: { ...structuredClone(DEFAULT_LINK), id: childId, name: childId },
    },
    joints: {
      [jointId]: {
        ...structuredClone(DEFAULT_JOINT),
        id: jointId,
        name: jointId,
        type: JointType.REVOLUTE,
        parentLinkId: rootId,
        childLinkId: childId,
      },
    },
  };
}

function component(id: string, value: RobotData, placement = transform()) {
  return {
    id,
    name: id,
    sourceFile: `${id}.urdf`,
    robot: value,
    transform: placement,
    visible: true,
  };
}

function workspace(components: AssemblyState['components']): AssemblyState {
  return {
    name: 'workspace',
    transform: transform(10, 20, 30),
    components,
    bridges: {},
  };
}

test('selection projection roundtrips explicit refs and carries renderer details', () => {
  const state = workspace({ arm: component('arm', robot('arm')) });
  const projection = createAssemblySceneProjection(state);
  const selection: WorkspaceSelection = {
    entity: { type: 'link', componentId: 'arm', entityId: 'base' },
    subType: 'collision',
    objectIndex: 2,
    helperKind: 'origin-axes',
    highlightObjectId: 7,
  };

  const rendererSelection = projectWorkspaceSelectionToRenderer(projection, selection);
  assert.deepEqual(rendererSelection, {
    type: 'link',
    id: 'base',
    subType: 'collision',
    objectIndex: 2,
    helperKind: 'origin-axes',
    highlightObjectId: 7,
  });
  assert.deepEqual(resolveRendererSelectionToWorkspace(projection, rendererSelection), selection);
});

test('selection projection maps bridge joints only at the renderer boundary', () => {
  const state = workspace({
    left: component('left', robot('left')),
    right: component('right', robot('right')),
  });
  state.bridges.bridge = {
    id: 'bridge',
    name: 'bridge',
    parentComponentId: 'left',
    parentLinkId: 'tip',
    childComponentId: 'right',
    childLinkId: 'base',
    joint: {
      ...structuredClone(DEFAULT_JOINT),
      id: 'bridge',
      name: 'bridge',
      type: JointType.FIXED,
      parentLinkId: 'tip',
      childLinkId: 'base',
    },
  };
  const projection = createAssemblySceneProjection(state);
  const canonical: WorkspaceSelection = { entity: { type: 'bridge', bridgeId: 'bridge' } };
  const renderer = projectWorkspaceSelectionToRenderer(projection, canonical);

  assert.equal(renderer.type, 'joint');
  assert.deepEqual(resolveRendererSelectionToWorkspace(projection, renderer), canonical);
});

test('direct tendon hits resolve through their collision-safe EntityRef id', () => {
  const value = robot('tendon-owner');
  value.inspectionContext = {
    sourceFormat: 'mjcf',
    mjcf: {
      siteCount: 0,
      tendonCount: 1,
      tendonActuatorCount: 0,
      bodiesWithSites: [],
      tendons: [
        {
          name: 'base',
          type: 'fixed',
          attachmentRefs: ['hinge'],
          attachments: [{ type: 'joint', ref: 'hinge' }],
          actuatorNames: [],
        },
      ],
    },
  };
  const projection = createAssemblySceneProjection(
    workspace({ arm: component('arm', value) }),
  );
  const canonical: WorkspaceSelection = {
    entity: { type: 'tendon', componentId: 'arm', entityId: 'base' },
  };
  const projectedName = projection.robotData.inspectionContext?.mjcf?.tendons[0]?.name;

  assert.equal(projectedName, 'base__tendon');
  assert.deepEqual(projectWorkspaceSelectionToRenderer(projection, canonical), {
    type: 'tendon',
    id: projectedName,
  });
  assert.deepEqual(
    resolveRendererSelectionToWorkspace(projection, {
      type: 'tendon',
      id: projectedName ?? null,
    }),
    canonical,
  );
});

test('selection resolution never guesses owners from prefixed text', () => {
  const state = workspace({
    a: component('a', robot('a', 'b_c')),
    a_b: component('a_b', robot('a_b', 'c')),
  });
  const projection = createAssemblySceneProjection(state);
  const firstRef: EntityRef = { type: 'link', componentId: 'a', entityId: 'b_c' };
  const secondRef: EntityRef = { type: 'link', componentId: 'a_b', entityId: 'c' };
  const firstId = projection.entityRefKeyToGlobal.get(entityRefKey(firstRef));
  const secondId = projection.entityRefKeyToGlobal.get(entityRefKey(secondRef));

  assert.ok(firstId);
  assert.ok(secondId);
  assert.notEqual(firstId, secondId);
  assert.deepEqual(
    resolveRendererSelectionToWorkspace(projection, { type: 'link', id: firstId! }),
    { entity: firstRef },
  );
  assert.deepEqual(
    resolveRendererSelectionToWorkspace(projection, { type: 'link', id: secondId! }),
    { entity: secondRef },
  );
  assert.equal(
    resolveRendererSelectionToWorkspace(projection, { type: 'link', id: 'a_b_c_extra' }),
    null,
  );
  assert.equal(
    resolveRendererSelectionToWorkspace(projection, { type: 'joint', id: firstId! }),
    null,
  );
});

test('runtime joint motion groups same-name joints by their explicit component owners', () => {
  const state = workspace({
    left: component('left', robot('left')),
    right: component('right', robot('right')),
  });
  const projection = createAssemblySceneProjection(state);
  const leftGlobal = projection.entityRefKeyToGlobal.get(
    entityRefKey({ type: 'joint', componentId: 'left', entityId: 'hinge' }),
  )!;
  const rightGlobal = projection.entityRefKeyToGlobal.get(
    entityRefKey({ type: 'joint', componentId: 'right', entityId: 'hinge' }),
  )!;

  assert.deepEqual(
    groupProjectedJointMotionByComponent(projection, {
      jointAngles: {
        [leftGlobal]: 0.25,
        [rightGlobal]: -0.5,
        hinge: 999,
        __workspace_component_root_joint__left: 999,
      },
      jointQuaternions: {
        [rightGlobal]: { x: 0, y: 0, z: 0.5, w: 0.5 },
      },
    }),
    [
      {
        componentId: 'left',
        jointAngles: { hinge: 0.25 },
        jointQuaternions: {},
      },
      {
        componentId: 'right',
        jointAngles: { hinge: -0.5 },
        jointQuaternions: { hinge: { x: 0, y: 0, z: 0.5, w: 0.5 } },
      },
    ],
  );

  assert.deepEqual(
    projectJointPreviewToWorkspaceComponents(projection, {
      activeJointId: rightGlobal,
      jointAngles: { [leftGlobal]: 0.25, [rightGlobal]: -0.5, hinge: 999 },
      jointQuaternions: {
        [rightGlobal]: { x: 0, y: 0, z: 0.5, w: 0.5 },
      },
      jointOrigins: {},
    }),
    {
      left: {
        activeJointId: null,
        jointAngles: { hinge: 0.25 },
        jointQuaternions: {},
        jointOrigins: {},
      },
      right: {
        activeJointId: 'hinge',
        jointAngles: { hinge: -0.5 },
        jointQuaternions: { hinge: { x: 0, y: 0, z: 0.5, w: 0.5 } },
        jointOrigins: {},
      },
    },
  );
});

test('renderer joint motion projects component and bridge joints to canonical flat targets', () => {
  const state = workspace({
    left: component('left', robot('left')),
    right: component('right', robot('right')),
  });
  state.bridges.bridge = {
    id: 'bridge',
    name: 'bridge',
    parentComponentId: 'left',
    parentLinkId: 'tip',
    childComponentId: 'right',
    childLinkId: 'base',
    joint: {
      ...structuredClone(DEFAULT_JOINT),
      id: 'bridge',
      name: 'bridge',
      type: JointType.REVOLUTE,
      parentLinkId: 'tip',
      childLinkId: 'base',
    },
  };
  const projection = createAssemblySceneProjection(state);
  const leftGlobal = projection.entityRefKeyToGlobal.get(
    entityRefKey({ type: 'joint', componentId: 'left', entityId: 'hinge' }),
  )!;
  const bridgeGlobal = projection.entityRefKeyToGlobal.get(
    entityRefKey({ type: 'bridge', bridgeId: 'bridge' }),
  )!;
  const bridgeQuaternion = { x: 0, y: 0, z: 0.25, w: 0.75 };

  assert.deepEqual(
    projectRendererJointMotionToWorkspaceTargets(projection, {
      jointAngles: {
        [leftGlobal]: 0.2,
        [bridgeGlobal]: -0.4,
        __workspace_component_root_joint__left: 42,
        foreign: 99,
      },
      jointQuaternions: {
        [bridgeGlobal]: bridgeQuaternion,
        foreign: { x: 1, y: 0, z: 0, w: 0 },
      },
    }),
    [
      {
        ref: { type: 'joint', componentId: 'left', entityId: 'hinge' },
        angle: 0.2,
      },
      {
        ref: { type: 'bridge', bridgeId: 'bridge' },
        angle: -0.4,
        quaternion: bridgeQuaternion,
      },
    ],
  );
});

test('joint preview projects bridge angle, quaternion, origin, and active ownership', () => {
  const state = workspace({
    left: component('left', robot('left')),
    right: component('right', robot('right')),
  });
  state.bridges.bridge = {
    id: 'bridge',
    name: 'bridge',
    parentComponentId: 'left',
    parentLinkId: 'tip',
    childComponentId: 'right',
    childLinkId: 'base',
    joint: {
      ...structuredClone(DEFAULT_JOINT),
      id: 'bridge',
      name: 'bridge',
      type: JointType.REVOLUTE,
      parentLinkId: 'tip',
      childLinkId: 'base',
    },
  };
  const projection = createAssemblySceneProjection(state);
  const leftGlobal = projection.entityRefKeyToGlobal.get(
    entityRefKey({ type: 'joint', componentId: 'left', entityId: 'hinge' }),
  )!;
  const bridgeGlobal = projection.entityRefKeyToGlobal.get(
    entityRefKey({ type: 'bridge', bridgeId: 'bridge' }),
  )!;
  const bridgeOrigin = {
    xyz: { x: 1, y: 2, z: 3 },
    rpy: { r: 0.1, p: 0.2, y: 0.3 },
  };

  assert.deepEqual(
    projectJointPreviewToWorkspaceTargets(projection, {
      activeJointId: bridgeGlobal,
      jointAngles: { [leftGlobal]: 0.25, [bridgeGlobal]: -0.5, foreign: 10 },
      jointQuaternions: {
        [bridgeGlobal]: { x: 0, y: 0, z: 0.5, w: 0.5 },
      },
      jointOrigins: { [bridgeGlobal]: bridgeOrigin },
    }),
    [
      {
        ref: { type: 'joint', componentId: 'left', entityId: 'hinge' },
        active: false,
        angle: 0.25,
      },
      {
        ref: { type: 'bridge', bridgeId: 'bridge' },
        active: true,
        angle: -0.5,
        quaternion: { x: 0, y: 0, z: 0.5, w: 0.5 },
        origin: bridgeOrigin,
      },
    ],
  );
});

test('direct placement keeps projection robot identity and separates both root transforms', () => {
  const state = workspace({ arm: component('arm', robot('arm'), transform(1, 2, 3)) });
  const before = structuredClone(state);
  const projection = createAssemblySceneProjection(state);
  const placement = createAssemblyScenePlacement(state, projection);

  assert.equal(placement.renderStrategy, 'direct-component');
  assert.equal(placement.robotData, projection.robotData);
  assert.deepEqual(placement.assemblyTransform, state.transform);
  assert.deepEqual(placement.directComponentTransform, state.components.arm!.transform);
  assert.equal(placement.directComponentId, 'arm');
  assert.equal(placement.componentTransformTargets.size, 0);
  assertMatrixClose(
    buildAssemblyTransformMatrix(placement.assemblyTransform).multiply(
      buildAssemblyTransformMatrix(placement.directComponentTransform),
    ),
    buildAssemblyTransformMatrix(state.transform).multiply(
      buildAssemblyTransformMatrix(state.components.arm!.transform),
    ),
  );
  assert.deepEqual(state, before);
});

test('assembled placement applies component transforms once through synthetic root joints', () => {
  const state = workspace({
    left: component('left', robot('left'), transform(1, 0, 0)),
    right: component('right', robot('right'), transform(2, 0, 0)),
  });
  const before = structuredClone(state);
  const projection = createAssemblySceneProjection(state);
  const placement = createAssemblyScenePlacement(state, projection);

  assert.equal(placement.renderStrategy, 'assembled-scene');
  assert.deepEqual(placement.assemblyTransform, state.transform);
  assert.equal(placement.directComponentTransform, null);
  assert.equal(placement.componentTransformTargets.size, 2);
  for (const [componentId, expectedX] of [
    ['left', 1],
    ['right', 2],
  ] as const) {
    const target = placement.componentTransformTargets.get(componentId);
    assert.equal(target?.kind, 'component-root');
    const joint = placement.robotData.joints[target!.runtimeJointId];
    assert.ok(joint);
    assert.equal(joint.origin.xyz.x, expectedX);
    assert.equal(joint.parentLinkId, placement.robotData.rootLinkId);

    const rootLinkId = projection.componentRootTargets.get(componentId)!.rootLinkId;
    const sceneWorld = computeLinkWorldMatrices(placement.robotData)[rootLinkId]!;
    const finalWorld = buildAssemblyTransformMatrix(placement.assemblyTransform).multiply(
      sceneWorld.clone(),
    );
    const expectedWorld = buildAssemblyTransformMatrix(state.transform).multiply(
      buildAssemblyTransformMatrix(state.components[componentId]!.transform),
    );
    assertMatrixClose(finalWorld, expectedWorld);
  }
  assert.deepEqual(state, before);
  assert.equal(projection.robotData.links[placement.robotData.rootLinkId], undefined);
  assert.equal(projection.globalToEntityRef.has(placement.robotData.rootLinkId), false);
  for (const target of placement.componentTransformTargets.values()) {
    if (target.kind === 'component-root') {
      assert.equal(projection.globalToEntityRef.has(target.runtimeJointId), false);
    }
  }
});

test('assembled bridge placement targets the projected bridge without duplicating child transform', () => {
  const state = workspace({
    parent: component('parent', robot('parent'), transform(4, 0, 0)),
    child: component('child', robot('child'), transform(9, 0, 0)),
  });
  state.bridges.mount = {
    id: 'mount',
    name: 'mount',
    parentComponentId: 'parent',
    parentLinkId: 'tip',
    childComponentId: 'child',
    childLinkId: 'base',
    joint: {
      ...structuredClone(DEFAULT_JOINT),
      id: 'mount',
      name: 'mount',
      type: JointType.FIXED,
      parentLinkId: 'tip',
      childLinkId: 'base',
    },
  };
  const projection = createAssemblySceneProjection(state);
  const placement = createAssemblyScenePlacement(state, projection);
  const parentTarget = placement.componentTransformTargets.get('parent');
  const childTarget = placement.componentTransformTargets.get('child');

  assert.equal(parentTarget?.kind, 'component-root');
  assert.equal(childTarget?.kind, 'bridge');
  assert.equal(childTarget?.bridgeId, 'mount');
  assert.equal(childTarget?.runtimeJointId, projectWorkspaceSelectionToRenderer(projection, {
    entity: { type: 'bridge', bridgeId: 'mount' },
  }).id);
  assert.equal(
    Object.values(placement.robotData.joints).filter(
      (joint) => joint.origin.xyz.x === state.components.child!.transform.position.x,
    ).length,
    0,
  );

  const childRootLinkId = projection.componentRootTargets.get('child')!.rootLinkId;
  const childWorld = buildAssemblyTransformMatrix(placement.assemblyTransform).multiply(
    computeLinkWorldMatrices(placement.robotData)[childRootLinkId]!.clone(),
  );
  const stateWithDifferentChildTransform = structuredClone(state);
  stateWithDifferentChildTransform.components.child!.transform = transform(99, 88, 77);
  const changedProjection = createAssemblySceneProjection(stateWithDifferentChildTransform);
  const changedPlacement = createAssemblyScenePlacement(
    stateWithDifferentChildTransform,
    changedProjection,
  );
  const changedChildRootLinkId = changedProjection.componentRootTargets.get('child')!.rootLinkId;
  const changedChildWorld = buildAssemblyTransformMatrix(
    changedPlacement.assemblyTransform,
  ).multiply(computeLinkWorldMatrices(changedPlacement.robotData)[changedChildRootLinkId]!.clone());
  assertMatrixClose(
    changedChildWorld,
    childWorld,
    'bridged child component.transform must not be applied on top of its bridge origin',
  );
});

test('assembled placement ignores cyclic constraint bridges when resolving runtime transform targets', () => {
  const state = workspace({
    a: component('a', robot('a')),
    b: component('b', robot('b')),
    c: component('c', robot('c')),
  });
  const fixedBridge = (
    id: string,
    parentComponentId: string,
    childComponentId: string,
  ): AssemblyState['bridges'][string] => ({
    id,
    name: id,
    parentComponentId,
    parentLinkId: 'tip',
    childComponentId,
    childLinkId: 'base',
    joint: {
      ...structuredClone(DEFAULT_JOINT),
      id,
      name: id,
      type: JointType.FIXED,
      parentLinkId: 'tip',
      childLinkId: 'base',
    },
  });
  state.bridges = {
    ab: fixedBridge('ab', 'a', 'b'),
    bc: fixedBridge('bc', 'b', 'c'),
    ca: fixedBridge('ca', 'c', 'a'),
  };
  const projection = createAssemblySceneProjection(state);
  const placement = createAssemblyScenePlacement(state, projection);

  assert.ok(placement.robotData.joints.ab);
  assert.ok(placement.robotData.joints.bc);
  assert.equal(placement.robotData.joints.ca, undefined);
  assert.equal(placement.componentTransformTargets.get('a')?.kind, 'component-root');
  assert.deepEqual(placement.componentTransformTargets.get('b'), {
    kind: 'bridge',
    componentId: 'b',
    bridgeId: 'ab',
    runtimeJointId: 'ab',
  });
  assert.deepEqual(placement.componentTransformTargets.get('c'), {
    kind: 'bridge',
    componentId: 'c',
    bridgeId: 'bc',
    runtimeJointId: 'bc',
  });
});

test('synthetic scene roots are collision-safe, massless, and excluded from entity maps', () => {
  const state = workspace({
    parent: component('parent', robot('parent')),
    child: component('child', robot('child')),
  });
  state.bridges.__workspace_scene_root__ = {
    id: '__workspace_scene_root__',
    name: 'reserved',
    parentComponentId: 'parent',
    parentLinkId: 'tip',
    childComponentId: 'child',
    childLinkId: 'base',
    joint: {
      ...structuredClone(DEFAULT_JOINT),
      id: '__workspace_scene_root__',
      name: 'reserved',
      type: JointType.FIXED,
      parentLinkId: 'tip',
      childLinkId: 'base',
    },
  };
  const projection = createAssemblySceneProjection(state);
  const placement = createAssemblyScenePlacement(state, projection);
  const syntheticRoot = placement.robotData.links[placement.robotData.rootLinkId]!;

  assert.notEqual(placement.robotData.rootLinkId, '__workspace_scene_root__');
  assert.ok(placement.robotData.joints.__workspace_scene_root__);
  assert.ok(syntheticRoot.inertial);
  assert.equal(syntheticRoot.inertial.mass, 0);
  assert.deepEqual(syntheticRoot.inertial.inertia, {
    ixx: 0,
    ixy: 0,
    ixz: 0,
    iyy: 0,
    iyz: 0,
    izz: 0,
  });
  assert.equal(projection.globalToEntityRef.has(placement.robotData.rootLinkId), false);
});

test('strategy switching preserves canonical state and component world placement', () => {
  const state = workspace({ arm: component('arm', robot('arm'), transform(1, 2, 3)) });
  const before = structuredClone(state);
  const directProjection = createAssemblySceneProjection(state);
  const directPlacement = createAssemblyScenePlacement(state, directProjection);
  const directWorld = buildAssemblyTransformMatrix(directPlacement.assemblyTransform).multiply(
    buildAssemblyTransformMatrix(directPlacement.directComponentTransform),
  );

  const assembledState = structuredClone(state);
  assembledState.components.tool = component('tool', robot('tool'), transform(-4, 5, 6));
  const assembledBefore = structuredClone(assembledState);
  const assembledProjection = createAssemblySceneProjection(assembledState);
  const assembledPlacement = createAssemblyScenePlacement(assembledState, assembledProjection);
  const armRootLinkId = assembledProjection.componentRootTargets.get('arm')!.rootLinkId;
  const assembledWorld = buildAssemblyTransformMatrix(
    assembledPlacement.assemblyTransform,
  ).multiply(computeLinkWorldMatrices(assembledPlacement.robotData)[armRootLinkId]!.clone());

  assert.equal(directProjection.renderStrategy, 'direct-component');
  assert.equal(assembledProjection.renderStrategy, 'assembled-scene');
  assertMatrixClose(assembledWorld, directWorld);
  assert.deepEqual(state, before);
  assert.deepEqual(assembledState, assembledBefore);
});

test('focus resolution uses projection mappings and component root targets', () => {
  const state = workspace({ arm: component('arm', robot('arm')) });
  const projection = createAssemblySceneProjection(state);
  const placement = createAssemblyScenePlacement(state, projection);

  assert.equal(resolveWorkspaceFocusTarget(projection, placement, { type: 'assembly' }), 'base');
  assert.equal(
    resolveWorkspaceFocusTarget(projection, placement, {
      type: 'component',
      componentId: 'arm',
    }),
    'base',
  );
  assert.equal(
    resolveWorkspaceFocusTarget(projection, placement, {
      type: 'joint',
      componentId: 'arm',
      entityId: 'hinge',
    }),
    'hinge',
  );
  assert.equal(
    resolveWorkspaceFocusTarget(projection, placement, {
      type: 'link',
      componentId: 'missing',
      entityId: 'base',
    }),
    null,
  );
  assert.deepEqual(projectWorkspaceSelectionToRenderer(projection, null), EMPTY_RENDERER_SELECTION);
});

test('assembly focus resolves to the placed root for a multi-root scene', () => {
  const state = workspace({
    left: component('left', robot('left')),
    right: component('right', robot('right')),
  });
  const projection = createAssemblySceneProjection(state);
  const placement = createAssemblyScenePlacement(state, projection);
  const focusTarget = resolveWorkspaceFocusTarget(projection, placement, { type: 'assembly' });

  assert.equal(focusTarget, placement.robotData.rootLinkId);
  assert.notEqual(focusTarget, projection.robotData.rootLinkId);
  assert.equal(projection.globalToEntityRef.has(focusTarget!), false);
});

test('transient joint motion projects onto stable collision-safe renderer ids', () => {
  const state = workspace({
    left: component('left', robot('left', 'base', 'hinge')),
    right: component('right', robot('right', 'base', 'hinge')),
  });
  const projection = createAssemblySceneProjection(state);
  state.components.left!.robot.joints.hinge!.angle = 0.25;
  state.components.right!.robot.joints.hinge!.angle = -0.5;
  state.components.right!.robot.joints.hinge!.quaternion = { x: 0, y: 0, z: 0.2, w: 0.98 };

  const projected = projectWorkspaceJointMotionToRenderer(state, projection);
  const leftId = projection.entityRefKeyToGlobal.get(entityRefKey({
    type: 'joint',
    componentId: 'left',
    entityId: 'hinge',
  }))!;
  const rightId = projection.entityRefKeyToGlobal.get(entityRefKey({
    type: 'joint',
    componentId: 'right',
    entityId: 'hinge',
  }))!;

  assert.notEqual(leftId, rightId);
  assert.deepEqual(projected.jointAngles, { [leftId]: 0.25, [rightId]: -0.5 });
  assert.deepEqual(projected.jointMotion[rightId], {
    angle: -0.5,
    quaternion: { x: 0, y: 0, z: 0.2, w: 0.98 },
  });
  assert.equal(projection.robotData.joints[leftId]?.angle, undefined);
});
