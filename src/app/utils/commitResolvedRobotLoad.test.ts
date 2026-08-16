import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { createSingleComponentWorkspace } from '@/core/robot';
import { useAssetsStore, type DocumentLoadState } from '@/store/assetsStore';
import { useSelectionStore } from '@/store/selectionStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  JointType,
  type RobotData,
  type RobotFile,
} from '@/types';

import {
  cancelPendingUsdWorkspaceLoad,
  commitResolvedRobotLoad,
  completePendingUsdWorkspaceLoad,
  getPendingUsdWorkspaceLoad,
} from './commitResolvedRobotLoad.ts';

function createRobot(name: string): RobotData {
  return {
    name,
    rootLinkId: 'base_link',
    links: {
      base_link: { ...structuredClone(DEFAULT_LINK), id: 'base_link', name: 'base_link' },
      tool_link: { ...structuredClone(DEFAULT_LINK), id: 'tool_link', name: 'tool_link' },
    },
    joints: {
      wrist: {
        ...structuredClone(DEFAULT_JOINT),
        id: 'wrist',
        name: 'wrist',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'tool_link',
      },
    },
  };
}

function createFile(name: string, format: RobotFile['format']): RobotFile {
  return { name, format, content: `<${format}>${name}</${format}>` };
}

function commitReady(
  file: RobotFile,
  robot = createRobot(`${file.format}_robot`),
  intent: 'replace' | 'append' = 'replace',
) {
  return commitResolvedRobotLoad({
    currentAppMode: 'editor',
    file,
    importResult: {
      status: 'ready',
      format: file.format,
      robotData: robot,
      resolvedUrdfContent: file.format === 'xacro' ? '<robot />' : null,
      resolvedUrdfSourceFilePath: null,
    },
    intent,
    setAppMode: () => {},
  });
}

function beginUsd(
  file: RobotFile,
  intent: 'replace' | 'append' = 'replace',
  options: {
    markWorkspaceBaselineSaved?: () => void;
    onViewerReload?: () => void;
    previousDocumentLoadState?: DocumentLoadState;
  } = {},
) {
  return commitResolvedRobotLoad({
    currentAppMode: 'editor',
    file,
    importResult: { status: 'needs_hydration', format: 'usd' },
    intent,
    markWorkspaceBaselineSaved: options.markWorkspaceBaselineSaved,
    onViewerReload: options.onViewerReload,
    previousDocumentLoadState: options.previousDocumentLoadState,
    setAppMode: () => {},
  });
}

beforeEach(() => {
  const pending = getPendingUsdWorkspaceLoad();
  if (pending) {
    cancelPendingUsdWorkspaceLoad(pending.operationId);
  }
  const transactionId = useWorkspaceStore.getState().transaction?.id;
  if (transactionId) {
    useWorkspaceStore.getState().cancelWorkspaceTransaction(transactionId);
  }
  useWorkspaceStore.getState().replaceWorkspace(
    createSingleComponentWorkspace(createRobot('baseline'), {
      componentId: 'baseline_component',
      sourceFile: 'baseline.urdf',
    }),
    { resetHistory: true },
  );
  useWorkspaceStore.setState({ history: { past: [], future: [], activity: [] } });
  useAssetsStore.setState({
    selectedFile: createFile('baseline.urdf', 'urdf'),
    documentLoadState: {
      status: 'ready',
      fileName: 'baseline.urdf',
      format: 'urdf',
      error: null,
      phase: 'ready',
      progressPercent: 100,
    },
    componentSourceDrafts: {},
  });
  useSelectionStore.setState({
    selection: { entity: { type: 'component', componentId: 'baseline_component' } },
  });
});

for (const format of ['urdf', 'mjcf', 'sdf', 'xacro', 'usd'] as const) {
  test(`ready ${format.toUpperCase()} open wraps RobotData as one canonical component`, () => {
    const file = createFile(`robots/demo.${format}`, format);
    const outcome = commitReady(file);

    assert.equal(outcome.status, 'committed');
    const state = useWorkspaceStore.getState();
    assert.deepEqual(Object.keys(state.workspace.components), ['component_1']);
    assert.equal(state.workspace.components.component_1!.sourceFile, file.name);
    assert.equal(state.workspace.components.component_1!.robot.name, `${format}_robot`);
    assert.deepEqual(Object.keys(state.workspace.components.component_1!.robot.links), [
      'base_link',
      'tool_link',
    ]);
    assert.equal(useAssetsStore.getState().selectedFile?.name, file.name);
    assert.equal(useSelectionStore.getState().selection, null);
    assert.equal(
      useAssetsStore.getState().componentSourceDrafts.component_1?.componentId,
      'component_1',
    );
  });
}

test('opening replaces while Add appends isolated same-source instances', () => {
  const file = createFile('shared/robot.urdf', 'urdf');
  commitReady(file, createRobot('first'));
  assert.deepEqual(Object.keys(useAssetsStore.getState().componentSourceDrafts), ['component_1']);
  commitReady(file, createRobot('second'), 'append');
  commitReady(file, createRobot('third'), 'append');

  const state = useWorkspaceStore.getState();
  const components = Object.values(state.workspace.components);
  assert.equal(components.length, 3);
  assert.deepEqual(components.map((component) => component.sourceFile), [
    file.name,
    file.name,
    file.name,
  ]);
  assert.equal(new Set(components.map((component) => component.id)).size, 3);
  const drafts = useAssetsStore.getState().componentSourceDrafts;
  assert.equal(Object.keys(drafts).length, 3);
  components.forEach((component) => {
    assert.equal(drafts[component.id]?.componentId, component.id);
    assert.equal(drafts[component.id]?.content, file.content);
  });

  const appended = components[1]!;
  state.updateLink(
    { type: 'link', componentId: appended.id, entityId: 'tool_link' },
    { name: 'isolated tool' },
  );
  assert.equal(
    useWorkspaceStore.getState().workspace.components.component_1!.robot.links.tool_link!.name,
    'tool_link',
  );

  const replacement = createFile('replacement.urdf', 'urdf');
  commitReady(replacement, createRobot('replacement'));
  assert.deepEqual(Object.keys(useAssetsStore.getState().componentSourceDrafts), ['component_1']);
  assert.equal(
    useAssetsStore.getState().componentSourceDrafts.component_1?.content,
    replacement.content,
  );
});

test('direct opening the already selected source replaces a multi-component workspace', () => {
  const file = createFile('shared/robot.urdf', 'urdf');
  commitReady(file, createRobot('first'));
  commitReady(file, createRobot('second'), 'append');
  commitReady(file, createRobot('third'), 'append');
  assert.equal(Object.keys(useWorkspaceStore.getState().workspace.components).length, 3);
  assert.equal(useAssetsStore.getState().selectedFile?.name, file.name);

  const outcome = commitReady(file, createRobot('reopened'), 'replace');

  assert.equal(outcome.status, 'committed');
  const workspace = useWorkspaceStore.getState().workspace;
  assert.deepEqual(Object.keys(workspace.components), ['component_1']);
  assert.equal(workspace.components.component_1!.robot.name, 'reopened');
  assert.equal(workspace.components.component_1!.sourceFile, file.name);
});

test('Add flushes an ordinary pending property transaction without losing its edit', () => {
  const store = useWorkspaceStore.getState();
  const operationId = store.beginWorkspaceTransaction('Pending property edit');
  assert.equal(
    store.renameWorkspace('edited before add', { operationId }),
    true,
  );

  commitReady(createFile('added.urdf', 'urdf'), createRobot('added'), 'append');

  const state = useWorkspaceStore.getState();
  assert.equal(state.transaction, null);
  assert.equal(state.workspace.name, 'edited before add');
  assert.equal(Object.keys(state.workspace.components).length, 2);
  assert.equal(state.history.past.length, 2);
  assert.equal(state.history.activity[0]?.label, 'Pending property edit');
});

test('opening a new file commits an ordinary pending edit before replacing workspace', () => {
  const store = useWorkspaceStore.getState();
  const operationId = store.beginWorkspaceTransaction('Pending property before open');
  assert.equal(store.renameWorkspace('latest before open', { operationId }), true);

  commitReady(createFile('replacement.urdf', 'urdf'), createRobot('replacement'));

  const state = useWorkspaceStore.getState();
  assert.equal(state.transaction, null);
  assert.equal(state.workspace.name, 'replacement');
  assert.equal(state.history.past.at(-1)?.name, 'latest before open');
  assert.ok(
    state.history.activity.some((entry) => entry.label === 'Pending property before open'),
  );
});

test('USD direct open keeps the previous workspace until exact completion and blocks edits', () => {
  const file = createFile('scene.usd', 'usd');
  const before = structuredClone(useWorkspaceStore.getState().workspace);
  const selectedBefore = useAssetsStore.getState().selectedFile;
  let viewerReloadCount = 0;
  let baselineCount = 0;
  const outcome = beginUsd(file, 'replace', {
    markWorkspaceBaselineSaved: () => {
      baselineCount += 1;
    },
    onViewerReload: () => {
      viewerReloadCount += 1;
    },
  });
  assert.equal(outcome.status, 'hydration-pending');
  if (outcome.status !== 'hydration-pending') return;

  const pending = outcome.operation;
  assert.deepEqual(useAssetsStore.getState().componentSourceDrafts, {});
  assert.deepEqual(useWorkspaceStore.getState().workspace, before);
  assert.equal(useAssetsStore.getState().selectedFile, selectedBefore);
  assert.equal(viewerReloadCount, 0);
  assert.equal(baselineCount, 0);
  assert.equal(useWorkspaceStore.getState().transaction?.exclusive, true);
  assert.equal(useWorkspaceStore.getState().renameWorkspace('blocked'), false);
  assert.equal(useWorkspaceStore.getState().undo(), false);
  assert.throws(
    () => commitReady(createFile('add.urdf', 'urdf'), createRobot('add'), 'append'),
    /busy/i,
  );

  const completion = completePendingUsdWorkspaceLoad(
    pending.operationId,
    file,
    createRobot('hydrated_usd'),
  );
  assert.equal(completion.status, 'committed');
  assert.equal(useWorkspaceStore.getState().transaction, null);
  assert.equal(useWorkspaceStore.getState().workspace.name, 'hydrated_usd');
  assert.equal(useAssetsStore.getState().selectedFile?.name, file.name);
  assert.equal(baselineCount, 1);
  assert.equal(useWorkspaceStore.getState().history.past.length, 1);
  assert.equal(
    useAssetsStore.getState().componentSourceDrafts.component_1?.format,
    'usd',
  );
});

test('USD Add commits once with its reserved component and source', () => {
  const source = createFile('shared/scene.usd', 'usd');
  let baselineCount = 0;
  const outcome = beginUsd(source, 'append', {
    markWorkspaceBaselineSaved: () => {
      baselineCount += 1;
    },
  });
  assert.equal(outcome.status, 'hydration-pending');
  if (outcome.status !== 'hydration-pending') return;

  const completion = completePendingUsdWorkspaceLoad(
    outcome.operation.operationId,
    source,
    createRobot('usd instance'),
  );
  assert.equal(completion.status, 'committed');
  if (completion.status !== 'committed') return;
  const state = useWorkspaceStore.getState();
  assert.equal(Object.keys(state.workspace.components).length, 2);
  assert.equal(completion.component.id, outcome.operation.componentId);
  assert.equal(completion.component.sourceFile, source.name);
  assert.equal(state.activeComponentId, completion.component.id);
  assert.equal(state.history.past.length, 1);
  assert.equal(baselineCount, 0);
});

test('USD cancellation restores workspace/document selection and late completion drops', () => {
  const file = createFile('cancel.usd', 'usd');
  const workspaceBefore = structuredClone(useWorkspaceStore.getState().workspace);
  const selectedBefore = useAssetsStore.getState().selectedFile;
  const documentBefore = structuredClone(useAssetsStore.getState().documentLoadState);
  const selectionBefore = useSelectionStore.getState().selection;
  const outcome = beginUsd(file);
  assert.equal(outcome.status, 'hydration-pending');
  if (outcome.status !== 'hydration-pending') return;

  useAssetsStore.setState({
    documentLoadState: {
      status: 'hydrating',
      fileName: file.name,
      format: 'usd',
      error: null,
      phase: 'checking-path',
    },
  });

  assert.equal(
    cancelPendingUsdWorkspaceLoad(outcome.operation.operationId, {
      restoreDocumentSession: true,
    }),
    true,
  );
  assert.deepEqual(useWorkspaceStore.getState().workspace, workspaceBefore);
  assert.equal(useAssetsStore.getState().selectedFile, selectedBefore);
  assert.deepEqual(useAssetsStore.getState().documentLoadState, documentBefore);
  assert.deepEqual(useSelectionStore.getState().selection, selectionBefore);
  assert.deepEqual(
    completePendingUsdWorkspaceLoad(
      outcome.operation.operationId,
      file,
      createRobot('late'),
    ),
    { status: 'stale' },
  );
});

test('a newer direct open cancels an old USD operation and rejects its late result', () => {
  const oldFile = createFile('old.usd', 'usd');
  const pending = beginUsd(oldFile);
  assert.equal(pending.status, 'hydration-pending');
  if (pending.status !== 'hydration-pending') return;

  useAssetsStore.setState({
    documentLoadState: {
      status: 'hydrating',
      fileName: oldFile.name,
      format: 'usd',
      error: null,
    },
  });

  commitReady(createFile('new.urdf', 'urdf'), createRobot('new robot'));
  assert.deepEqual(
    completePendingUsdWorkspaceLoad(
      pending.operation.operationId,
      oldFile,
      createRobot('late old robot'),
    ),
    { status: 'stale' },
  );
  assert.equal(useWorkspaceStore.getState().workspace.name, 'new robot');
  assert.equal(useAssetsStore.getState().selectedFile?.name, 'new.urdf');
});

test('USD completion failure cancels the transaction and restores its before snapshot', () => {
  const file = createFile('broken.usd', 'usd');
  const before = structuredClone(useWorkspaceStore.getState().workspace);
  const pending = beginUsd(file, 'append');
  assert.equal(pending.status, 'hydration-pending');
  if (pending.status !== 'hydration-pending') return;
  const documentBefore = structuredClone(
    pending.operation.previousDocumentLoadState,
  );
  useAssetsStore.setState({
    documentLoadState: {
      status: 'hydrating',
      fileName: file.name,
      format: 'usd',
      error: null,
    },
  });

  const originalAppend = useWorkspaceStore.getState().appendComponent;
  useWorkspaceStore.setState({
    appendComponent: (seed, options) => {
      originalAppend(seed, options);
      throw new Error('simulated USD commit failure');
    },
  });
  try {
    assert.throws(
      () => completePendingUsdWorkspaceLoad(
        pending.operation.operationId,
        file,
        createRobot('partial'),
      ),
      /simulated USD commit failure/,
    );
  } finally {
    useWorkspaceStore.setState({ appendComponent: originalAppend });
  }
  assert.equal(useWorkspaceStore.getState().transaction, null);
  assert.deepEqual(useWorkspaceStore.getState().workspace, before);
  assert.deepEqual(useAssetsStore.getState().documentLoadState, documentBefore);
  assert.equal(useWorkspaceStore.getState().history.past.length, 0);
});
