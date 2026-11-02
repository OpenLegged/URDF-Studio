import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createComponentSourceDraft, createSingleComponentWorkspace } from '@/core/robot';
import { translations } from '@/shared/i18n';
import { useAssetsStore } from '@/store/assetsStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { DEFAULT_LINK, type RobotData, type RobotFile } from '@/types';
import { registerPendingHistoryFlusher } from '@/app/utils/pendingHistory';
import { useLibraryFileActions } from './useLibraryFileActions';

function robot(name: string): RobotData {
  return {
    name,
    rootLinkId: 'base',
    links: { base: { ...structuredClone(DEFAULT_LINK), id: 'base', name: 'base' } },
    joints: {},
  };
}

function renderLibraryActions(
  overrides: Partial<Parameters<typeof useLibraryFileActions>[0]> = {},
): ReturnType<typeof useLibraryFileActions> {
  let actions: ReturnType<typeof useLibraryFileActions> | null = null;
  function Probe() {
    const assets = useAssetsStore.getState();
    actions = useLibraryFileActions({
      availableFiles: assets.availableFiles,
      selectedFile: assets.selectedFile,
      assemblyState: useWorkspaceStore.getState().workspace,
      clearSelection: () => {},
      uploadAsset: () => {},
      openLibraryExportDialog: () => {},
      showToast: () => {},
      t: translations.en,
      ...overrides,
    });
    return null;
  }
  renderToStaticMarkup(React.createElement(Probe));
  assert.ok(actions);
  return actions as unknown as ReturnType<typeof useLibraryFileActions>;
}

test('deleting a shared library file batches component removal and clears only owned drafts', () => {
  const target: RobotFile = {
    name: 'library/shared.urdf',
    format: 'urdf',
    content: '<robot name="shared" />',
  };
  const survivorFile: RobotFile = {
    name: 'library/survivor.urdf',
    format: 'urdf',
    content: '<robot name="survivor" />',
  };
  const workspace = createSingleComponentWorkspace(robot('first'), {
    componentId: 'first',
    sourceFile: target.name,
  });
  workspace.components.second = createSingleComponentWorkspace(robot('second'), {
    componentId: 'second',
    sourceFile: target.name,
  }).components.second;
  workspace.components.survivor = createSingleComponentWorkspace(robot('survivor'), {
    componentId: 'survivor',
    sourceFile: survivorFile.name,
  }).components.survivor;
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  useWorkspaceStore.setState({ history: { past: [], future: [], activity: [] } });
  useAssetsStore.setState({
    availableFiles: [target, survivorFile],
    componentSourceDrafts: Object.fromEntries(
      Object.values(workspace.components).map((component) => [
        component.id,
        createComponentSourceDraft({
          componentId: component.id,
          format: 'urdf',
          content: `<robot name="${component.id}" />`,
          robot: component.robot,
        }),
      ]),
    ),
  });

  const toastMessages: string[] = [];
  const renderedActions = renderLibraryActions({
    showToast: (message) => toastMessages.push(message),
  });
  renderedActions.handleDeleteLibraryFile(target);

  assert.deepEqual(Object.keys(useWorkspaceStore.getState().workspace.components), ['survivor']);
  assert.equal(useWorkspaceStore.getState().history.past.length, 1);
  assert.deepEqual(Object.keys(useAssetsStore.getState().componentSourceDrafts), ['survivor']);
  assert.deepEqual(
    useAssetsStore.getState().availableFiles.map((file) => file.name),
    [survivorFile.name],
  );
  assert.deepEqual(toastMessages, []);
});

test('library deletion flushes a pending edit before its discrete asset mutation', () => {
  const target: RobotFile = {
    name: 'library/unowned.urdf',
    format: 'urdf',
    content: '<robot name="unowned" />',
  };
  const workspace = createSingleComponentWorkspace(robot('workspace'), {
    componentId: 'workspace',
    sourceFile: null,
  });
  const store = useWorkspaceStore.getState();
  store.replaceWorkspace(workspace, { resetHistory: true });
  useWorkspaceStore.setState({ history: { past: [], future: [], activity: [] } });
  useAssetsStore.setState({ availableFiles: [target], selectedFile: null });
  const pendingId = store.beginWorkspaceTransaction('Pending property edit');
  store.renameWorkspace('pending name', { operationId: pendingId });
  const unregister = registerPendingHistoryFlusher(() => {
    useWorkspaceStore.getState().commitWorkspaceTransaction(pendingId);
  });

  try {
    renderLibraryActions().handleDeleteLibraryFile(target);
  } finally {
    unregister();
  }

  assert.equal(useWorkspaceStore.getState().transaction, null);
  assert.equal(useWorkspaceStore.getState().workspace.name, 'pending name');
  assert.equal(useWorkspaceStore.getState().history.past.length, 1);
  assert.deepEqual(useAssetsStore.getState().availableFiles, []);
});

test('exclusive workspace work rejects library deletion before the asset store changes', () => {
  const target: RobotFile = {
    name: 'library/unowned.urdf',
    format: 'urdf',
    content: '<robot name="unowned" />',
  };
  const workspace = createSingleComponentWorkspace(robot('workspace'), {
    componentId: 'workspace',
    sourceFile: null,
  });
  const store = useWorkspaceStore.getState();
  store.replaceWorkspace(workspace, { resetHistory: true });
  useAssetsStore.setState({ availableFiles: [target], selectedFile: null });
  const exclusiveId = store.beginWorkspaceTransaction('USD hydration', { exclusive: true });

  assert.throws(
    () => renderLibraryActions().handleDeleteLibraryFile(target),
    /busy with an exclusive operation/i,
  );
  assert.deepEqual(useAssetsStore.getState().availableFiles, [target]);
  assert.equal(useWorkspaceStore.getState().transaction?.id, exclusiveId);
  useWorkspaceStore.getState().cancelWorkspaceTransaction(exclusiveId);
});

test('folder rename updates asset paths and component sources as one non-historical operation', () => {
  const target: RobotFile = {
    name: 'library/old/robot.urdf',
    format: 'urdf',
    content: '<robot name="robot" />',
  };
  const workspace = createSingleComponentWorkspace(robot('robot'), {
    componentId: 'robot',
    sourceFile: target.name,
  });
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  useWorkspaceStore.setState({ history: { past: [], future: [], activity: [] } });
  useAssetsStore.setState({
    availableFiles: [target],
    selectedFile: target,
    allFileContents: { [target.name]: target.content },
  });

  const toastMessages: string[] = [];
  const result = renderLibraryActions({
    showToast: (message) => toastMessages.push(message),
  }).handleRenameLibraryFolder('library/old', 'new');

  assert.deepEqual(result, { ok: true, nextPath: 'library/new' });
  assert.equal(
    useWorkspaceStore.getState().workspace.components.robot?.sourceFile,
    'library/new/robot.urdf',
  );
  assert.equal(useWorkspaceStore.getState().history.past.length, 0);
  assert.deepEqual(
    useAssetsStore.getState().availableFiles.map((file) => file.name),
    ['library/new/robot.urdf'],
  );
  assert.deepEqual(Object.keys(useAssetsStore.getState().allFileContents), [
    'library/new/robot.urdf',
  ]);
  assert.deepEqual(toastMessages, []);
});

test('folder rename rolls workspace source paths back when the asset rename fails', () => {
  const target: RobotFile = {
    name: 'library/old/robot.urdf',
    format: 'urdf',
    content: '<robot name="robot" />',
  };
  const conflict: RobotFile = {
    name: 'library/existing/other.urdf',
    format: 'urdf',
    content: '<robot name="other" />',
  };
  const workspace = createSingleComponentWorkspace(robot('robot'), {
    componentId: 'robot',
    sourceFile: target.name,
  });
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  useWorkspaceStore.setState({ history: { past: [], future: [], activity: [] } });
  useAssetsStore.setState({ availableFiles: [target, conflict], selectedFile: target });

  const result = renderLibraryActions().handleRenameLibraryFolder('library/old', 'existing');

  assert.deepEqual(result, { ok: false, reason: 'conflict' });
  assert.equal(useWorkspaceStore.getState().workspace.components.robot?.sourceFile, target.name);
  assert.equal(useWorkspaceStore.getState().transaction, null);
  assert.equal(useWorkspaceStore.getState().history.past.length, 0);
  assert.deepEqual(useAssetsStore.getState().availableFiles, [target, conflict]);
});

test('folder rename rolls the asset store back when workspace commit is rejected', () => {
  const target: RobotFile = {
    name: 'library/old/robot.urdf',
    format: 'urdf',
    content: '<robot name="robot" />',
  };
  const workspace = createSingleComponentWorkspace(robot('robot'), {
    componentId: 'robot',
    sourceFile: target.name,
  });
  const store = useWorkspaceStore.getState();
  store.replaceWorkspace(workspace, { resetHistory: true });
  useWorkspaceStore.setState({ history: { past: [], future: [], activity: [] } });
  useAssetsStore.setState({
    availableFiles: [target],
    selectedFile: target,
    allFileContents: { [target.name]: target.content },
  });
  const originalCommit = store.commitWorkspaceTransaction;
  useWorkspaceStore.setState({ commitWorkspaceTransaction: () => false });

  try {
    assert.throws(
      () => renderLibraryActions().handleRenameLibraryFolder('library/old', 'new'),
      /Failed to commit library folder rename/,
    );
  } finally {
    useWorkspaceStore.setState({ commitWorkspaceTransaction: originalCommit });
  }

  assert.equal(useWorkspaceStore.getState().workspace.components.robot?.sourceFile, target.name);
  assert.equal(useWorkspaceStore.getState().transaction, null);
  assert.deepEqual(
    useAssetsStore.getState().availableFiles.map((file) => file.name),
    [target.name],
  );
  assert.deepEqual(Object.keys(useAssetsStore.getState().allFileContents), [target.name]);
});

test('library file deletion rolls assets back and does not revoke blobs when workspace commit is rejected', () => {
  const target: RobotFile = {
    name: 'library/owned.urdf',
    format: 'urdf',
    content: '<robot name="owned" />',
  };
  const workspace = createSingleComponentWorkspace(robot('owned'), {
    componentId: 'owned',
    sourceFile: target.name,
  });
  const store = useWorkspaceStore.getState();
  store.replaceWorkspace(workspace, { resetHistory: true });
  useWorkspaceStore.setState({ history: { past: [], future: [], activity: [] } });
  useAssetsStore.setState({
    availableFiles: [target],
    selectedFile: target,
    assets: { [target.name]: 'blob:owned-urdf' },
  });

  const revokedUrls: string[] = [];
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  const originalCommit = store.commitWorkspaceTransaction;
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: (url: string) => {
      revokedUrls.push(url);
    },
  });
  useWorkspaceStore.setState({ commitWorkspaceTransaction: () => false });

  try {
    assert.throws(
      () => renderLibraryActions().handleDeleteLibraryFile(target),
      /Failed to commit library file removal/,
    );
  } finally {
    useWorkspaceStore.setState({ commitWorkspaceTransaction: originalCommit });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: originalRevokeObjectUrl,
    });
  }

  assert.ok(useWorkspaceStore.getState().workspace.components.owned);
  assert.equal(useWorkspaceStore.getState().transaction, null);
  assert.deepEqual(useAssetsStore.getState().availableFiles, [target]);
  assert.deepEqual(useAssetsStore.getState().assets, { [target.name]: 'blob:owned-urdf' });
  assert.deepEqual(revokedUrls, []);
});

test('delete-all with an edit-locked component toasts the conflict and deletes nothing', () => {
  const target: RobotFile = {
    name: 'library/locked.urdf',
    format: 'urdf',
    content: '<robot name="locked" />',
  };
  const survivorFile: RobotFile = {
    name: 'library/free.urdf',
    format: 'urdf',
    content: '<robot name="free" />',
  };
  const workspace = createSingleComponentWorkspace(robot('locked'), {
    componentId: 'locked',
    sourceFile: target.name,
  });
  workspace.components.free = createSingleComponentWorkspace(robot('free'), {
    componentId: 'free',
    sourceFile: survivorFile.name,
  }).components.free;
  workspace.components.locked.editorLocked = true;
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  useWorkspaceStore.setState({ history: { past: [], future: [], activity: [] } });
  useAssetsStore.setState({ availableFiles: [target, survivorFile], selectedFile: null });

  const toastMessages: string[] = [];
  const renderedActions = renderLibraryActions({
    showToast: (message) => toastMessages.push(message),
  });
  renderedActions.handleDeleteAllLibraryFiles();

  assert.equal(toastMessages.length, 1);
  assert.match(toastMessages[0], /unlock them before deleting/);
  assert.match(toastMessages[0], /locked/);
  assert.deepEqual(
    useAssetsStore.getState().availableFiles.map((file) => file.name),
    [target.name, survivorFile.name],
  );
  assert.deepEqual(Object.keys(useWorkspaceStore.getState().workspace.components).sort(), [
    'free',
    'locked',
  ]);
  assert.equal(useWorkspaceStore.getState().history.past.length, 0);
  assert.equal(useWorkspaceStore.getState().transaction, null);

  // The guard is scoped to related components: deleting the unlocked file
  // still works while the locked component stays.
  renderedActions.handleDeleteLibraryFile(survivorFile);
  assert.equal(toastMessages.length, 1);
  assert.deepEqual(
    useAssetsStore.getState().availableFiles.map((file) => file.name),
    [target.name],
  );
  assert.deepEqual(Object.keys(useWorkspaceStore.getState().workspace.components), ['locked']);
});

test('deleting a library file blocked by a link-locked component toasts instead of throwing', () => {
  const target: RobotFile = {
    name: 'library/link-locked.urdf',
    format: 'urdf',
    content: '<robot name="link-locked" />',
  };
  const workspace = createSingleComponentWorkspace(robot('link-locked'), {
    componentId: 'link-locked',
    sourceFile: target.name,
  });
  workspace.components['link-locked'].robot.links.base.editorLocked = true;
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  useWorkspaceStore.setState({ history: { past: [], future: [], activity: [] } });
  useAssetsStore.setState({ availableFiles: [target], selectedFile: null });

  const toastMessages: string[] = [];
  renderLibraryActions({
    showToast: (message) => toastMessages.push(message),
  }).handleDeleteLibraryFile(target);

  assert.equal(toastMessages.length, 1);
  assert.match(toastMessages[0], /unlock them before deleting/);
  assert.deepEqual(useAssetsStore.getState().availableFiles, [target]);
  assert.ok(useWorkspaceStore.getState().workspace.components['link-locked']);
  assert.equal(useWorkspaceStore.getState().transaction, null);
  assert.equal(useWorkspaceStore.getState().history.past.length, 0);
});

test('folder rename blocked by an edit-locked component toasts the conflict and renames nothing', () => {
  const target: RobotFile = {
    name: 'library/old/robot.urdf',
    format: 'urdf',
    content: '<robot name="robot" />',
  };
  const workspace = createSingleComponentWorkspace(robot('robot'), {
    componentId: 'robot',
    sourceFile: target.name,
  });
  workspace.components.robot.editorLocked = true;
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  useWorkspaceStore.setState({ history: { past: [], future: [], activity: [] } });
  useAssetsStore.setState({
    availableFiles: [target],
    selectedFile: target,
    allFileContents: { [target.name]: target.content },
  });

  const toastMessages: string[] = [];
  const result = renderLibraryActions({
    showToast: (message) => toastMessages.push(message),
  }).handleRenameLibraryFolder('library/old', 'new');

  assert.deepEqual(result, { ok: false, reason: 'locked' });
  assert.equal(toastMessages.length, 1);
  assert.match(toastMessages[0], /unlock them before renaming/);
  assert.equal(
    useWorkspaceStore.getState().workspace.components.robot?.sourceFile,
    target.name,
  );
  assert.deepEqual(
    useAssetsStore.getState().availableFiles.map((file) => file.name),
    [target.name],
  );
  assert.deepEqual(Object.keys(useAssetsStore.getState().allFileContents), [target.name]);
  assert.equal(useWorkspaceStore.getState().transaction, null);
  assert.equal(useWorkspaceStore.getState().history.past.length, 0);
});

test('the lock-conflict toast inserts component names containing dollar patterns literally', () => {
  const target: RobotFile = {
    name: 'library/dollar.urdf',
    format: 'urdf',
    content: '<robot name="dollar" />',
  };
  const workspace = createSingleComponentWorkspace(robot('dollar'), {
    componentId: 'dollar',
    sourceFile: target.name,
  });
  workspace.components.dollar.editorLocked = true;
  workspace.components.dollar.name = 'Arm$&Joint';
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  useWorkspaceStore.setState({ history: { past: [], future: [], activity: [] } });
  useAssetsStore.setState({ availableFiles: [target], selectedFile: null });

  const toastMessages: string[] = [];
  renderLibraryActions({
    showToast: (message) => toastMessages.push(message),
  }).handleDeleteAllLibraryFiles();

  assert.equal(toastMessages.length, 1);
  assert.ok(toastMessages[0].includes('Arm$&Joint'));
  assert.ok(!toastMessages[0].includes('{names}'));
  assert.deepEqual(useAssetsStore.getState().availableFiles, [target]);
});

function renderSiblingFolderActions(lockedId: 'plain' | 'query') {
  const plain: RobotFile = {
    name: 'set/a/locked.urdf',
    format: 'urdf',
    content: '<robot name="plain" />',
  };
  const query: RobotFile = {
    name: 'set/a?view/free.urdf',
    format: 'urdf',
    content: '<robot name="query" />',
  };
  const workspace = createSingleComponentWorkspace(robot('plain'), {
    componentId: 'plain',
    sourceFile: plain.name,
  });
  workspace.components.query = createSingleComponentWorkspace(robot('query'), {
    componentId: 'query',
    sourceFile: query.name,
  }).components.query;
  workspace.components[lockedId].robot.links.base.editorLocked = true;
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  useAssetsStore.setState({
    availableFiles: [plain, query],
    selectedFile: query,
    allFileContents: { [plain.name]: plain.content, [query.name]: query.content },
  });

  const messages: string[] = [];
  const actions = renderLibraryActions({ showToast: (message) => messages.push(message) });
  return { plain, query, actions, messages };
}

test('deleting a folder with a literal question mark preserves its locked sibling', () => {
  const { plain, actions, messages } = renderSiblingFolderActions('plain');
  actions.handleDeleteLibraryFolder('set/a?view');

  const assets = useAssetsStore.getState();
  assert.deepEqual(assets.availableFiles, [plain]);
  assert.deepEqual(assets.allFileContents, { [plain.name]: plain.content });
  assert.equal(assets.selectedFile, null);
  const { components } = useWorkspaceStore.getState().workspace;
  assert.deepEqual(Object.keys(components), ['plain']);
  assert.equal(components.plain.sourceFile, plain.name);
  assert.deepEqual(messages, []);
});

test('renaming a folder with a literal question mark updates only its own source paths', () => {
  const { plain, query, actions, messages } = renderSiblingFolderActions('plain');
  const result = actions.handleRenameLibraryFolder('set/a?view', 'new');

  assert.deepEqual(result, { ok: true, nextPath: 'set/new' });
  const nextQuery = { ...query, name: 'set/new/free.urdf' };
  const assets = useAssetsStore.getState();
  assert.deepEqual(assets.availableFiles, [plain, nextQuery]);
  assert.deepEqual(assets.allFileContents, {
    [plain.name]: plain.content,
    [nextQuery.name]: query.content,
  });
  assert.deepEqual(assets.selectedFile, nextQuery);
  const { components } = useWorkspaceStore.getState().workspace;
  assert.equal(components.plain.sourceFile, plain.name);
  assert.equal(components.query.sourceFile, nextQuery.name);
  assert.deepEqual(messages, []);
});

test('a link lock in a folder with a literal question mark blocks deletion and renaming', () => {
  const { plain, query, actions, messages } = renderSiblingFolderActions('query');
  actions.handleDeleteLibraryFolder('set/a?view');
  assert.deepEqual(messages, [
    translations.en.assetLibraryDeleteLockedConflict.replace('{names}', 'query'),
  ]);
  const result = actions.handleRenameLibraryFolder('set/a?view', 'new');
  assert.deepEqual(result, { ok: false, reason: 'locked' });
  assert.deepEqual(messages, [
    translations.en.assetLibraryDeleteLockedConflict.replace('{names}', 'query'),
    translations.en.assetLibraryRenameLockedConflict.replace('{names}', 'query'),
  ]);
  const assets = useAssetsStore.getState();
  assert.deepEqual(assets.availableFiles, [plain, query]);
  assert.deepEqual(assets.allFileContents, {
    [plain.name]: plain.content,
    [query.name]: query.content,
  });
  assert.deepEqual(assets.selectedFile, query);
  const workspace = useWorkspaceStore.getState();
  assert.equal(workspace.workspace.components.plain.sourceFile, plain.name);
  assert.equal(workspace.workspace.components.query.sourceFile, query.name);
  assert.equal(workspace.transaction, null);
  assert.equal(workspace.history.past.length, 0);
});
