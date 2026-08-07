import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_JOINT, DEFAULT_LINK, type AssemblyState } from '@/types';
import {
  isEntityEditorLocked,
  resolveRobotLinkEditorLock,
} from './editorLock.ts';
import { createAssemblySceneProjection } from './assemblySceneProjection.ts';
import { validateCanonicalWorkspace } from './canonicalWorkspace.ts';

function createWorkspace(): AssemblyState {
  return {
    name: 'locked-workspace',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    components: {
      robot: {
        id: 'robot',
        name: 'robot',
        sourceFile: null,
        visible: true,
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { r: 0, p: 0, y: 0 },
        },
        robot: {
          name: 'robot',
          rootLinkId: 'base_link',
          links: {
            base_link: { ...structuredClone(DEFAULT_LINK), id: 'base_link' },
            arm_link: {
              ...structuredClone(DEFAULT_LINK),
              id: 'arm_link',
              editorLocked: true,
            },
            tool_link: { ...structuredClone(DEFAULT_LINK), id: 'tool_link' },
          },
          joints: {
            shoulder: {
              ...structuredClone(DEFAULT_JOINT),
              id: 'shoulder',
              parentLinkId: 'base_link',
              childLinkId: 'arm_link',
            },
            wrist: {
              ...structuredClone(DEFAULT_JOINT),
              id: 'wrist',
              parentLinkId: 'arm_link',
              childLinkId: 'tool_link',
            },
          },
        },
      },
    },
    bridges: {},
  };
}

test('editor locks inherit through a link subtree and protect its joints', () => {
  const workspace = createWorkspace();
  const robot = workspace.components.robot.robot;

  assert.deepEqual(resolveRobotLinkEditorLock(robot, 'arm_link'), {
    locked: true,
    source: 'self',
    sourceLinkId: 'arm_link',
  });
  assert.deepEqual(resolveRobotLinkEditorLock(robot, 'tool_link'), {
    locked: true,
    source: 'ancestor',
    sourceLinkId: 'arm_link',
  });
  assert.equal(isEntityEditorLocked(workspace, {
    type: 'joint',
    componentId: 'robot',
    entityId: 'shoulder',
  }), true);
  assert.equal(isEntityEditorLocked(workspace, {
    type: 'joint',
    componentId: 'robot',
    entityId: 'wrist',
  }), true);
  assert.equal(isEntityEditorLocked(workspace, {
    type: 'link',
    componentId: 'robot',
    entityId: 'base_link',
  }), false);

  workspace.components.robot.editorLocked = true;
  assert.equal(isEntityEditorLocked(workspace, {
    type: 'link',
    componentId: 'robot',
    entityId: 'base_link',
  }), true);
});

test('canonical persistence and scene projection preserve effective editor locks', () => {
  const workspace = createWorkspace();
  assert.equal(validateCanonicalWorkspace(workspace).valid, true);

  const linkProjection = createAssemblySceneProjection(workspace);
  assert.equal(linkProjection.robotData.links.arm_link?.editorLocked, true);
  assert.equal(linkProjection.robotData.links.tool_link?.editorLocked, true);
  assert.equal(linkProjection.robotData.links.base_link?.editorLocked, undefined);

  workspace.components.robot.editorLocked = true;
  const componentProjection = createAssemblySceneProjection(workspace);
  assert.equal(componentProjection.robotData.links.base_link?.editorLocked, true);
  assert.equal(componentProjection.robotData.links.arm_link?.editorLocked, true);
  assert.equal(componentProjection.robotData.links.tool_link?.editorLocked, true);
});
