import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  JointType,
  type AssemblyComponent,
  type AssemblyState,
  type RobotData,
} from '@/types';

import {
  buildExportableAssemblyRobotData,
  IDENTITY_ASSEMBLY_TRANSFORM,
  isAssemblyComponentIndividuallyTransformable,
} from './assemblyTransforms.ts';
import { createAssemblySceneProjection } from './assemblySceneProjection.ts';
import { createAssemblyScenePlacement } from './assemblyScenePlacement.ts';
import { buildAssemblyTransformMatrix } from './assemblyBridgeAlignment.ts';
import { computeLinkWorldMatrices } from './kinematics.ts';

function assertMatrixElementsClose(actual: number[], expected: number[]): void {
  actual.forEach((value, index) => {
    assert.ok(Math.abs(value - expected[index]!) <= 1e-9);
  });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach((entry) => {
      deepFreeze(entry);
    });
  }

  return value;
}

function createRobotData(rootId: string, rootName: string): RobotData {
  return {
    name: rootName,
    rootLinkId: rootId,
    links: {
      [rootId]: {
        ...DEFAULT_LINK,
        id: rootId,
        name: rootName,
      },
    },
    joints: {},
  };
}

function createComponent(id: string, name: string, sourceFile: string): AssemblyComponent {
  const rootId = 'base_link';
  return {
    id,
    name,
    sourceFile,
    robot: createRobotData(rootId, name),
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    visible: true,
  };
}

function createAssemblyState(): AssemblyState {
  return {
    name: 'demo_workspace',
    transform: {
      position: { x: 10, y: -2, z: 3 },
      rotation: { r: 0, p: 0, y: Math.PI / 4 },
    },
    components: {
      comp_left: {
        ...createComponent('comp_left', 'left_arm', 'robots/left_arm.urdf'),
        transform: {
          position: { x: 2, y: 0, z: 0 },
          rotation: { r: 0, p: 0, y: Math.PI / 2 },
        },
      },
      comp_right: createComponent('comp_right', 'right_arm', 'robots/right_arm.urdf'),
    },
    bridges: {},
  };
}

test('identity assembly transform is deeply immutable', () => {
  assert.equal(Object.isFrozen(IDENTITY_ASSEMBLY_TRANSFORM), true);
  assert.equal(Object.isFrozen(IDENTITY_ASSEMBLY_TRANSFORM.position), true);
  assert.equal(Object.isFrozen(IDENTITY_ASSEMBLY_TRANSFORM.rotation), true);
  assert.throws(() => {
    IDENTITY_ASSEMBLY_TRANSFORM.position.x = 1;
  }, TypeError);
});

test('isAssemblyComponentIndividuallyTransformable only allows isolated components', () => {
  const assembly = createAssemblyState();

  assert.equal(isAssemblyComponentIndividuallyTransformable(assembly, 'comp_left'), true);
  assert.equal(isAssemblyComponentIndividuallyTransformable(assembly, 'comp_right'), true);

  assembly.bridges.bridge_main = {
    id: 'bridge_main',
    name: 'bridge_main',
    parentComponentId: 'comp_left',
    parentLinkId: 'base_link',
    childComponentId: 'comp_right',
    childLinkId: 'base_link',
    joint: {
      ...DEFAULT_JOINT,
      id: 'bridge_main_joint',
      name: 'bridge_main_joint',
      type: JointType.FIXED,
      parentLinkId: 'base_link',
      childLinkId: 'base_link',
    },
  };

  assert.equal(isAssemblyComponentIndividuallyTransformable(assembly, 'comp_left'), false);
  assert.equal(isAssemblyComponentIndividuallyTransformable(assembly, 'comp_right'), false);

  assembly.bridges.bridge_main.childComponentId = 'comp_left';
  assert.equal(isAssemblyComponentIndividuallyTransformable(assembly, 'comp_left'), true,
    'an internal closed loop does not tie the component to another component');
  assert.equal(isAssemblyComponentIndividuallyTransformable(assembly, 'comp_right'), true);
});

test('buildExportableAssemblyRobotData wraps isolated components and the whole assembly with fixed joints', () => {
  const assembly = createAssemblyState();

  const exportRobot = buildExportableAssemblyRobotData(assembly);

  assert.ok(exportRobot.links.__assembly_root, 'expected an assembly root wrapper');
  assert.ok(exportRobot.links.comp_left_base_link);
  assert.ok(exportRobot.links.comp_right_base_link);
  assert.equal(exportRobot.rootLinkId, '__assembly_root');

  const assemblyWrapperJoint = exportRobot.joints.__assembly_root_joint_demo_workspace;
  assert.ok(assemblyWrapperJoint, 'expected one export-only assembly wrapper joint');
  assert.ok(assembly.transform);
  assert.deepEqual(assemblyWrapperJoint.origin.xyz, assembly.transform.position);
  assert.deepEqual(assemblyWrapperJoint.origin.rpy, assembly.transform.rotation);

  const componentWrapperJoint =
    exportRobot.joints.__workspace_component_root_joint__comp_left;
  assert.ok(
    componentWrapperJoint,
    'expected component wrapper joint for isolated component transform',
  );
  assert.equal(componentWrapperJoint.childLinkId, 'comp_left_base_link');
  assert.deepEqual(
    componentWrapperJoint.origin.xyz,
    assembly.components.comp_left.transform?.position,
  );
  assert.deepEqual(
    componentWrapperJoint.origin.rpy,
    assembly.components.comp_left.transform?.rotation,
  );

  assert.equal(
    exportRobot.joints.__workspace_component_root_joint__comp_right.childLinkId,
    'comp_right_base_link',
    'components without explicit transform should still be attached under the assembly root',
  );

  const projection = createAssemblySceneProjection(assembly);
  const placement = createAssemblyScenePlacement(assembly, projection);
  const exportWorld = computeLinkWorldMatrices(exportRobot);
  const placementWorld = computeLinkWorldMatrices(placement.robotData);
  projection.componentRootTargets.forEach((target) => {
    const expected = buildAssemblyTransformMatrix(assembly.transform).multiply(
      placementWorld[target.rootLinkId]!.clone(),
    );
    assertMatrixElementsClose(exportWorld[target.rootLinkId]!.elements, expected.elements);
  });
});

test('buildExportableAssemblyRobotData unwraps an identity single-component workspace for export', () => {
  const assembly: AssemblyState = {
    name: 'a2',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    components: {
      comp_a2: {
        id: 'comp_a2',
        name: 'a2',
        sourceFile: 'test/unitree_ros/robots/a2_description/a2.xml',
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { r: 0, p: 0, y: 0 },
        },
        visible: true,
        robot: {
          name: 'a2',
          rootLinkId: 'world',
          links: {
            world: {
              ...DEFAULT_LINK,
              id: 'world',
              name: 'world',
            },
            base_link: {
              ...DEFAULT_LINK,
              id: 'base_link',
              name: 'base_link',
            },
          },
          joints: {
            floating_base_joint: {
              ...DEFAULT_JOINT,
              id: 'floating_base_joint',
              name: 'floating_base_joint',
              parentLinkId: 'world',
              childLinkId: 'base_link',
              type: JointType.FLOATING,
              mimic: {
                joint: 'reference_joint',
                multiplier: 1,
                offset: 0,
              },
            },
          },
          materials: {
            base_link: {
              color: '#cad1ee',
            },
          },
          inspectionContext: {
            sourceFormat: 'mjcf',
          },
        },
      },
    },
    bridges: {},
  };

  const exportRobot = buildExportableAssemblyRobotData(assembly);

  assert.equal(exportRobot.name, 'a2');
  assert.equal(exportRobot.rootLinkId, 'world');
  assert.deepEqual(Object.keys(exportRobot.links).sort(), ['base_link', 'world']);
  assert.equal(exportRobot.links.world.name, 'world');
  assert.equal(exportRobot.links.base_link.name, 'base_link');
  assert.deepEqual(Object.keys(exportRobot.joints), ['floating_base_joint']);
  assert.equal(exportRobot.joints.floating_base_joint.parentLinkId, 'world');
  assert.equal(exportRobot.joints.floating_base_joint.childLinkId, 'base_link');
  assert.equal(exportRobot.joints.floating_base_joint.name, 'floating_base_joint');
  assert.equal(exportRobot.joints.floating_base_joint.mimic?.joint, 'reference_joint');
  assert.deepEqual(exportRobot.materials, {
    base_link: {
      color: '#cad1ee',
    },
  });
  assert.equal(exportRobot.inspectionContext?.sourceFormat, 'mjcf');
  assert.equal(
    Object.keys(exportRobot.links).some((linkId) => linkId.startsWith('comp_a2_')),
    false,
  );
});

test('buildExportableAssemblyRobotData projects duplicate and separator-heavy source-local ids', () => {
  const assembly: AssemblyState = {
    name: 'two_instances',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    components: {
      a: {
        ...createComponent('a', 'first', 'robots/shared.urdf'),
        robot: createRobotData('b_c', 'first root'),
      },
      a_b: {
        ...createComponent('a_b', 'second', 'robots/shared.urdf'),
        robot: createRobotData('c', 'second root'),
      },
    },
    bridges: {},
  };
  const sourceSnapshot = structuredClone(assembly);

  const exportRobot = buildExportableAssemblyRobotData(assembly);

  assert.deepEqual(Object.keys(exportRobot.links).sort(), [
    '__workspace_scene_root__',
    'a_b_c',
    'a_b_c__link',
  ]);
  assert.equal(exportRobot.links.a_b_c?.name, 'a_b_c');
  assert.equal(exportRobot.links.a_b_c__link?.name, 'a_b_c__link');
  assert.deepEqual(assembly, sourceSnapshot);
});

test('buildExportableAssemblyRobotData does not apply component wrappers to bridged components', () => {
  const assembly = createAssemblyState();
  assembly.bridges.bridge_main = {
    id: 'bridge_main',
    name: 'bridge_main',
    parentComponentId: 'comp_left',
    parentLinkId: 'base_link',
    childComponentId: 'comp_right',
    childLinkId: 'base_link',
    joint: {
      ...DEFAULT_JOINT,
      id: 'bridge_main_joint',
      name: 'bridge_main_joint',
      type: JointType.FIXED,
      parentLinkId: 'base_link',
      childLinkId: 'base_link',
    },
  };

  const exportRobot = buildExportableAssemblyRobotData(assembly);

  assert.equal(
    'comp_left___assembly_component_joint_comp_left' in exportRobot.joints,
    false,
    'connected components should not keep an individual wrapper joint',
  );
  assert.equal(
    'comp_right___assembly_component_joint_comp_right' in exportRobot.joints,
    false,
    'connected components should not keep an individual wrapper joint',
  );
});

test('buildExportableAssemblyRobotData does not mutate frozen assembly component state', () => {
  const assembly = deepFreeze(createAssemblyState());

  const exportRobot = buildExportableAssemblyRobotData(assembly);

  assert.equal(assembly.components.comp_left.robot.rootLinkId, 'base_link');
  assert.equal(
    assembly.components.comp_left.robot.links.__assembly_component_root_comp_left,
    undefined,
    'the source assembly component should stay untouched',
  );
  assert.ok(
    exportRobot.links.__workspace_scene_root__,
    'the export result should reuse the scene placement root',
  );
  assert.ok(
    exportRobot.joints.__workspace_component_root_joint__comp_left,
    'the export result should reuse the scene placement joint',
  );
});

test('buildExportableAssemblyRobotData disambiguates reserved synthetic ids without overwriting source entities', () => {
  const assembly = createAssemblyState();
  assembly.transform = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { r: 0, p: 0, y: 0 },
  };
  assembly.components = { comp_left: assembly.components.comp_left };
  const component = assembly.components.comp_left;
  const reservedLinkId = '__assembly_component_root_comp_left';
  const reservedJointId = '__assembly_component_joint_comp_left';
  component.robot.links[reservedLinkId] = {
    ...structuredClone(DEFAULT_LINK),
    id: reservedLinkId,
    name: 'authored reserved link',
  };
  component.robot.joints[reservedJointId] = {
    ...structuredClone(DEFAULT_JOINT),
    id: reservedJointId,
    name: 'authored reserved joint',
    parentLinkId: 'base_link',
    childLinkId: reservedLinkId,
  };
  const sourceSnapshot = structuredClone(assembly);

  const exportRobot = buildExportableAssemblyRobotData(assembly);

  assert.equal(
    exportRobot.links[reservedLinkId]?.name,
    'authored reserved link',
  );
  assert.ok(exportRobot.links[`${reservedLinkId}__link`]);
  assert.equal(
    exportRobot.joints[reservedJointId]?.name,
    'authored reserved joint',
  );
  assert.ok(exportRobot.joints[`${reservedJointId}__joint`]);
  assert.deepEqual(assembly, sourceSnapshot);
});
