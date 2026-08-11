import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LINK,
  type AssemblyComponent,
  type AssemblyState,
  type AssemblyTransform,
  type RobotClosedLoopConstraint,
  type RobotData,
  type RobotState,
} from '@/types';
import {
  assertAssemblyUrdfExportSupported,
  assertUrdfExportSupported,
  buildAssemblyExportName,
  createBoxFaceTextureFallbackWarnings,
  resolveDisconnectedWorkspaceUrdfAction,
} from './urdfSupport';

const replaceTemplate = (template: string, replacements: Record<string, string | number>) =>
  Object.entries(replacements).reduce(
    (acc, [key, value]) => acc.replace(`{${key}}`, String(value)),
    template,
  );

const robotData: RobotData = {
  name: 'robot',
  links: {
    base: {
      ...DEFAULT_LINK,
      id: 'base',
      name: 'base',
    },
  },
  joints: {},
  rootLinkId: 'base',
};

function createTransform(): AssemblyTransform {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { r: 0, p: 0, y: 0 },
  };
}

function createComponent(
  id: string,
  name: string,
  sourceFile: string,
  robot: RobotData = robotData,
  visible = true,
): AssemblyComponent {
  return {
    id,
    name,
    sourceFile,
    robot,
    transform: createTransform(),
    visible,
  };
}

const closedLoopConstraint: RobotClosedLoopConstraint = {
  id: 'c',
  linkAId: 'a',
  linkBId: 'b',
  type: 'connect',
  anchorWorld: { x: 0, y: 0, z: 0 },
  anchorLocalA: { x: 0, y: 0, z: 0 },
  anchorLocalB: { x: 0, y: 0, z: 0 },
};

const labels = {
  sdf: 'sdf warning {count}',
  urdf: 'urdf warning {count}',
  xacro: 'xacro warning {count}',
};

test('createBoxFaceTextureFallbackWarnings returns replacements and omits zero counts', () => {
  const zero = createBoxFaceTextureFallbackWarnings('urdf', 0, replaceTemplate, labels);
  assert.deepStrictEqual(zero, []);

  const message = createBoxFaceTextureFallbackWarnings('xacro', 2, replaceTemplate, labels);
  assert.deepStrictEqual(message, ['xacro warning 2']);
});

test('assertUrdfExportSupported skips when no closed loops and throws when they exist', () => {
  assert.doesNotThrow(() =>
    assertUrdfExportSupported(
      { name: 'robot', closedLoopConstraints: [], joints: {} },
      undefined,
      replaceTemplate,
      'Label {name} {count}',
    ),
  );

  const robotWithConstraint: Pick<RobotState, 'name' | 'closedLoopConstraints' | 'joints'> = {
    name: 'robotA',
    closedLoopConstraints: [closedLoopConstraint],
    joints: {},
  };

  assert.throws(
    () =>
      assertUrdfExportSupported(
        robotWithConstraint,
        'next',
        replaceTemplate,
        'Label {name} {count}',
      ),
    /next/,
  );
});

test('assertAssemblyUrdfExportSupported throws when any component has a constraint', () => {
  const assembly: AssemblyState = {
    name: 'assembly',
    transform: createTransform(),
    components: {
      comp: createComponent(
        'comp',
        'Component',
        'file',
        {
          ...robotData,
          closedLoopConstraints: [{ ...closedLoopConstraint, id: 'c2' }],
        },
      ),
    },
    bridges: {},
  };

  assert.throws(
    () => assertAssemblyUrdfExportSupported(assembly, replaceTemplate, 'Label {name} {count}'),
    /Component/,
  );
});

test('buildAssemblyExportName derives workspace export names from component names', () => {
  const assembly: AssemblyState = {
    name: 'assembly',
    transform: createTransform(),
    components: {
      comp_t1: createComponent('comp_t1', 't1', 't1.xml'),
      comp_piper: createComponent('comp_piper', 'piper', 'piper.xml'),
      comp_hidden: createComponent('comp_hidden', 'hidden', 'hidden.xml', robotData, false),
    },
    bridges: {},
  };

  assert.equal(buildAssemblyExportName(assembly), 't1_piper_hidden');
});

test('resolveDisconnectedWorkspaceUrdfAction only fires for current URDF targets with disconnected components', () => {
  const assembly: AssemblyState = {
    name: 'assembly',
    transform: createTransform(),
    components: {
      c1: createComponent('c1', 'C1', 'a'),
      c2: createComponent('c2', 'C2', 'b'),
    },
    bridges: {},
  };

  const action = resolveDisconnectedWorkspaceUrdfAction(
    { type: 'current' },
    { format: 'urdf' },
    assembly,
  );
  assert.strictEqual(action?.type, 'disconnected-workspace-urdf');
  assert.strictEqual(action?.componentCount, 2);
  assert.strictEqual(action?.exportName, 'C1_C2');

  const noAction = resolveDisconnectedWorkspaceUrdfAction(
    { type: 'current' },
    { format: 'sdf' },
    assembly,
  );
  assert.strictEqual(noAction, null);
});
