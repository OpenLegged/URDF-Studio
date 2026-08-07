import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { parseURDF } from '@/core/parsers';
import { createComponentSourceDraft, createSingleComponentWorkspace } from '@/core/robot';
import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  JointType,
  type AssemblyState,
  type RobotData,
  type RobotFile,
} from '@/types';
import {
  buildCanonicalWorkspaceSourceDocuments,
  buildSourceCodeDocuments,
} from './sourceCodeDocuments.ts';
import type { SourceCodeDocumentChangeTarget } from './sourceCodeDocuments.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;

function componentTargetId(target: SourceCodeDocumentChangeTarget | undefined): string | null {
  return target?.kind === 'component' ? target.componentId : null;
}

function robot(name: string): RobotData {
  return {
    name,
    rootLinkId: 'base',
    links: { base: { ...structuredClone(DEFAULT_LINK), id: 'base', name: 'base' } },
    joints: {},
  };
}

function sharedSourceWorkspace(): AssemblyState {
  const workspace = createSingleComponentWorkspace(robot('left_robot'), {
    componentId: 'left',
    componentName: 'Left instance',
    sourceFile: 'library/shared.xml',
  });
  workspace.components.right = createSingleComponentWorkspace(robot('right_robot'), {
    componentId: 'right',
    componentName: 'Right instance',
    sourceFile: 'library/shared.xml',
  }).components.right;
  return workspace;
}

test('primary source apply target always carries explicit component ownership', () => {
  const activeSourceFile: RobotFile = {
    name: 'robots/arm.urdf',
    format: 'urdf',
    content: '<robot name="arm"/>',
  };
  const documents = buildSourceCodeDocuments({
    componentId: 'arm-instance',
    activeSourceFile,
    sourceCodeContent: activeSourceFile.content,
    sourceCodeDocumentFlavor: 'urdf',
    availableFiles: [activeSourceFile],
    allFileContents: {},
  });

  assert.deepEqual(documents[0].changeTarget, {
    kind: 'component',
    componentId: 'arm-instance',
    name: 'robots/arm.urdf',
    format: 'urdf',
  });
});

test('related include documents are read-only and cannot route an unowned apply', () => {
  const activeSourceFile: RobotFile = {
    name: 'robots/scene.xml',
    format: 'mjcf',
    content: '<mujoco model="scene"><include file="body.xml"/></mujoco>',
  };
  const documents = buildSourceCodeDocuments({
    componentId: 'scene-instance',
    activeSourceFile,
    sourceCodeContent: activeSourceFile.content,
    sourceCodeDocumentFlavor: 'mjcf',
    availableFiles: [
      activeSourceFile,
      { name: 'robots/body.xml', format: 'mjcf', content: '<mujoco model="body"/>' },
    ],
    allFileContents: {},
  });

  assert.equal(documents.length, 2);
  assert.equal(documents[1].readOnly, true);
  assert.equal(documents[1].changeTarget, undefined);
});

test('canonical source contract routes a matching single-component draft explicitly', () => {
  const workspace = createSingleComponentWorkspace(robot('arm'), {
    componentId: 'arm-instance',
    sourceFile: 'library/arm.urdf',
  });
  const content = '<robot name="arm-draft" />';
  const result = buildCanonicalWorkspaceSourceDocuments({
    workspace,
    activeComponentId: 'arm-instance',
    componentSourceDrafts: {
      'arm-instance': createComponentSourceDraft({
        componentId: 'arm-instance',
        format: 'urdf',
        content,
        robot: workspace.components['arm-instance'].robot,
      }),
    },
    availableFiles: [{
      name: 'library/arm.urdf',
      format: 'urdf',
      content: '<robot name="immutable-template" />',
    }],
    allFileContents: {},
  });

  assert.equal(result.mode, 'component');
  assert.equal(result.content, content);
  assert.equal(result.directComponentDocument, result.documents[0]);
  assert.equal(result.documents[0].readOnly, false);
  assert.equal(componentTargetId(result.documents[0].changeTarget), 'arm-instance');
});

test('editor locks make owned source drafts read-only so raw text cannot bypass them', () => {
  const workspace = createSingleComponentWorkspace(robot('arm'), {
    componentId: 'arm-instance',
    sourceFile: 'library/arm.urdf',
  });
  workspace.components['arm-instance'].robot.links.base!.editorLocked = true;
  const draft = createComponentSourceDraft({
    componentId: 'arm-instance',
    format: 'urdf',
    content: '<robot name="arm-draft" />',
    robot: workspace.components['arm-instance'].robot,
  });

  const result = buildCanonicalWorkspaceSourceDocuments({
    workspace,
    activeComponentId: 'arm-instance',
    componentSourceDrafts: { 'arm-instance': draft },
    availableFiles: [{
      name: 'library/arm.urdf',
      format: 'urdf',
      content: draft.content,
    }],
    allFileContents: {},
  });

  assert.equal(result.documents[0].readOnly, true);
  assert.equal(result.documents[0].changeTarget, undefined);
});

test('disconnected component instances each expose an isolated editable tab', () => {
  const workspace = sharedSourceWorkspace();
  const drafts = {
    left: createComponentSourceDraft({
      componentId: 'left',
      format: 'mjcf',
      content: '<mujoco model="left_draft"/>',
      robot: workspace.components.left.robot,
    }),
    right: createComponentSourceDraft({
      componentId: 'right',
      format: 'mjcf',
      content: '<mujoco model="right_draft"/>',
      robot: workspace.components.right.robot,
    }),
  };
  const common = {
    workspace,
    componentSourceDrafts: drafts,
    availableFiles: [{
      name: 'library/shared.xml',
      format: 'mjcf' as const,
      content: '<mujoco model="immutable-template"/>',
    }],
    allFileContents: {},
  };
  const left = buildCanonicalWorkspaceSourceDocuments({
    ...common,
    activeComponentId: 'left',
  });
  const right = buildCanonicalWorkspaceSourceDocuments({
    ...common,
    activeComponentId: 'right',
  });

  // Multiple robots without a bridge each get their own editable tab; no merge.
  assert.equal(left.mode, 'component');
  assert.equal(left.documents.length, 2);
  assert.ok(left.documents.every((document) => document.readOnly === false));
  assert.equal(left.directComponentDocument?.content, '<mujoco model="left_draft"/>');
  assert.equal(componentTargetId(left.directComponentDocument?.changeTarget), 'left');
  assert.equal(right.directComponentDocument?.content, '<mujoco model="right_draft"/>');
  assert.equal(componentTargetId(right.directComponentDocument?.changeTarget), 'right');
});

test('stale single-component drafts remain editable while missing drafts use a read-only projection', () => {
  const workspace = createSingleComponentWorkspace(robot('left_robot'), {
    componentId: 'left',
    sourceFile: 'library/shared.xml',
  });
  const staleDraft = createComponentSourceDraft({
    componentId: 'left',
    format: 'mjcf',
    content: '<mujoco model="stale"/>',
    robot: workspace.components.left.robot,
  });
  workspace.components.left.robot.name = 'semantic-edit';

  const libraryTemplate = '<mujoco model="immutable-template" />';
  const staleResult = buildCanonicalWorkspaceSourceDocuments({
    workspace,
    activeComponentId: 'left',
    componentSourceDrafts: { left: staleDraft },
    availableFiles: [{
      name: 'library/shared.xml',
      format: 'mjcf',
      content: libraryTemplate,
    }],
    allFileContents: {},
  });
  assert.equal(staleResult.mode, 'component');
  assert.equal(staleResult.content, staleDraft.content);
  assert.equal(staleResult.documents[0].readOnly, false);
  assert.equal(staleResult.directComponentDocument, staleResult.documents[0]);
  assert.equal(componentTargetId(staleResult.documents[0].changeTarget), 'left');

  const missingResult = buildCanonicalWorkspaceSourceDocuments({
    workspace,
    activeComponentId: 'left',
    componentSourceDrafts: {},
    availableFiles: [{
      name: 'library/shared.xml',
      format: 'mjcf',
      content: libraryTemplate,
    }],
    allFileContents: {},
  });
  assert.equal(missingResult.mode, 'component');
  assert.equal(missingResult.documents[0].readOnly, true);
  assert.equal(missingResult.directComponentDocument, null);
  assert.notEqual(missingResult.content, libraryTemplate);
  assert.match(missingResult.content, /semantic-edit/);
});

test('multi-component and bridged workspaces expose a transformed read-only projection', () => {
  const workspace = sharedSourceWorkspace();
  workspace.name = 'transformed_assembly';
  workspace.transform.position.x = 5;
  workspace.components.right.transform.position.x = 2;
  workspace.bridges.mount = {
    id: 'mount',
    name: 'mount',
    parentComponentId: 'left',
    parentLinkId: 'base',
    childComponentId: 'right',
    childLinkId: 'base',
    joint: {
      ...structuredClone(DEFAULT_JOINT),
      id: 'mount',
      name: 'mount',
      type: JointType.FIXED,
      parentLinkId: 'base',
      childLinkId: 'base',
      origin: {
        xyz: { x: 3, y: 0, z: 0 },
        rpy: { r: 0, p: 0, y: 0 },
      },
    },
  };
  const result = buildCanonicalWorkspaceSourceDocuments({
    workspace,
    activeComponentId: 'left',
    componentSourceDrafts: {},
    availableFiles: [],
    allFileContents: {},
  });
  const parsed = parseURDF(result.content);
  assert.ok(parsed);
  assert.equal(result.mode, 'assembly');
  assert.equal(result.documents[0].readOnly, true);
  assert.ok(Object.values(parsed.joints).some((joint) => joint.origin.xyz.x === 5));
  assert.ok(Object.values(parsed.joints).some((joint) => joint.origin.xyz.x === 3));
});

test('bridged urdf components graft into one editable group tab preserving the master source', () => {
  const workspace = sharedSourceWorkspace();
  workspace.name = 'bridged_assembly';
  workspace.bridges.mount = {
    id: 'mount',
    name: 'mount',
    parentComponentId: 'left',
    parentLinkId: 'base',
    childComponentId: 'right',
    childLinkId: 'base',
    joint: {
      ...structuredClone(DEFAULT_JOINT),
      id: 'mount',
      name: 'mount',
      type: JointType.FIXED,
      parentLinkId: 'base',
      childLinkId: 'base',
    },
  };
  const masterText = '<?xml version="1.0"?>\n<robot name="left_robot">\n  <link name="base" />\n</robot>\n';
  const result = buildCanonicalWorkspaceSourceDocuments({
    workspace,
    activeComponentId: 'left',
    componentSourceDrafts: {
      left: createComponentSourceDraft({
        componentId: 'left',
        format: 'urdf',
        content: masterText,
        robot: workspace.components.left.robot,
      }),
      right: createComponentSourceDraft({
        componentId: 'right',
        format: 'urdf',
        content: '<robot name="right_robot"><link name="base"/></robot>',
        robot: workspace.components.right.robot,
      }),
    },
    availableFiles: [],
    allFileContents: {},
  });

  assert.equal(result.mode, 'assembly');
  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0].readOnly, false);
  const target = result.documents[0].changeTarget;
  assert.equal(target?.kind, 'group');
  if (target?.kind === 'group') {
    assert.equal(target.rootComponentId, 'left');
    assert.deepEqual(target.groupComponentIds, ['left', 'right']);
    assert.equal(target.provenance.masterComponentId, 'left');
    assert.equal(target.provenance.linkOwnerByName.get('Right_instance__base')?.componentId, 'right');
  }
  // Master URDF text is preserved verbatim at the top of the flattened document.
  assert.ok(result.content.startsWith('<?xml version="1.0"?>\n<robot name="left_robot">'));
  assert.ok(result.content.includes('  <link name="base" />'));
  // The slave's colliding "base" link is namespaced by its component name.
  assert.match(result.content, /name="Right_instance__base"/);
  // The bridge joint is injected and the result parses as a single robot.
  assert.match(result.content, /<joint name="mount"/);
  assert.ok(parseURDF(result.content));
});

test('USD direct source resources remain read-only with an explicit format signal', () => {
  const workspace = createSingleComponentWorkspace(robot('usd_robot'), {
    componentId: 'usd-instance',
    sourceFile: 'library/robot.usd',
  });
  const result = buildCanonicalWorkspaceSourceDocuments({
    workspace,
    activeComponentId: 'usd-instance',
    componentSourceDrafts: {
      'usd-instance': createComponentSourceDraft({
        componentId: 'usd-instance',
        format: 'usd',
        content: '#usda 1.0',
        robot: workspace.components['usd-instance'].robot,
      }),
    },
    availableFiles: [{
      name: 'library/robot.usd',
      format: 'usd',
      content: '#usda 1.0',
    }],
    allFileContents: {},
  });
  assert.equal(result.documentFlavor, 'usd');
  assert.equal(result.directComponentDocument?.documentFlavor, 'usd');
  assert.equal(result.directComponentDocument?.readOnly, true);
  assert.equal(result.directComponentDocument?.changeTarget, undefined);
});
