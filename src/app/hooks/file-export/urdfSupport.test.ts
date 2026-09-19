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
  stripClosedLoopConstraintsForUrdfExport,
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

test('assertUrdfExportSupported tolerates closed loops; stripping handles them instead', () => {
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

  // Closed loops no longer throw: URDF export cuts them and warns.
  assert.doesNotThrow(() =>
    assertUrdfExportSupported(
      robotWithConstraint,
      'next',
      replaceTemplate,
      'Label {name} {count}',
    ),
  );
});

test('stripClosedLoopConstraintsForUrdfExport cuts loops and returns a warning', () => {
  const toRobotState = (overrides: Partial<RobotState>): RobotState => ({
    ...robotData,
    selection: { type: null, id: null },
    ...overrides,
  });

  const untouched = stripClosedLoopConstraintsForUrdfExport(
    toRobotState({ name: 'plain' }),
    replaceTemplate,
    'Stripped {count} loop(s) from {name}',
  );
  assert.equal(untouched.warning, null);
  assert.equal(untouched.robot.closedLoopConstraints, undefined);

  const looped = stripClosedLoopConstraintsForUrdfExport(
    toRobotState({
      name: 'robotA',
      closedLoopConstraints: [closedLoopConstraint, { ...closedLoopConstraint, id: 'c2' }],
    }),
    replaceTemplate,
    'Stripped {count} loop(s) from {name}',
  );
  assert.ok(looped.warning);
  assert.match(looped.warning, /robotA/);
  assert.match(looped.warning, /2/);
  assert.equal(looped.robot.closedLoopConstraints, undefined);
  assert.equal(looped.robot.name, 'robotA');
});

test('assertAssemblyUrdfExportSupported tolerates components with closed loops', () => {
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

  // Assembly-level URDF export no longer throws for closed loops; the bundle
  // path strips them per component and reports warnings.
  assert.doesNotThrow(() =>
    assertAssemblyUrdfExportSupported(assembly, replaceTemplate, 'Label {name} {count}'),
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
