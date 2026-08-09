import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_JOINT, DEFAULT_LINK, JointType, type AssemblyState } from '@/types';

import { resolveIgnoreJointLimitsScopeKey } from './useIgnoreJointLimitsScopeReset';

function createWorkspace(
  componentId: string,
  options: { sourceFile?: string; robotName?: string } = {},
): AssemblyState {
  return {
    name: 'scope-test',
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { r: 0, p: 0, y: 0 } },
    bridges: {},
    components: {
      [componentId]: {
        id: componentId,
        name: 'robot',
        sourceFile: options.sourceFile ?? null,
        transform: { position: { x: 0, y: 0, z: 0 }, rotation: { r: 0, p: 0, y: 0 } },
        visible: true,
        robot: {
          name: options.robotName ?? 'robot',
          rootLinkId: 'base',
          links: { base: { ...DEFAULT_LINK, id: 'base', name: 'base' } },
          joints: {
            hip: {
              ...DEFAULT_JOINT,
              id: 'hip',
              name: 'hip',
              type: JointType.REVOLUTE,
              parentLinkId: 'base',
              childLinkId: 'base',
            },
          },
        },
      },
    },
  };
}

test('scope key stays stable while the same model stays active', () => {
  const workspace = createWorkspace('comp', { sourceFile: 'a.urdf' });

  assert.equal(
    resolveIgnoreJointLimitsScopeKey(workspace, 'comp'),
    resolveIgnoreJointLimitsScopeKey(createWorkspace('comp', { sourceFile: 'a.urdf' }), 'comp'),
  );
});

test('scope key changes when the active component or its source changes', () => {
  const first = resolveIgnoreJointLimitsScopeKey(
    createWorkspace('comp', { sourceFile: 'a.urdf' }),
    'comp',
  );

  assert.notEqual(
    first,
    resolveIgnoreJointLimitsScopeKey(createWorkspace('comp', { sourceFile: 'b.urdf' }), 'comp'),
  );
  assert.notEqual(
    first,
    resolveIgnoreJointLimitsScopeKey(createWorkspace('other', { sourceFile: 'a.urdf' }), 'other'),
  );
});

test('scope key falls back to the robot name when no source file exists', () => {
  assert.equal(
    resolveIgnoreJointLimitsScopeKey(createWorkspace('comp', { robotName: 'inline' }), 'comp'),
    'comp:inline',
  );
});

test('scope key is null without an active or existing component', () => {
  const workspace = createWorkspace('comp');

  assert.equal(resolveIgnoreJointLimitsScopeKey(workspace, null), null);
  assert.equal(resolveIgnoreJointLimitsScopeKey(workspace, 'missing'), null);
});
