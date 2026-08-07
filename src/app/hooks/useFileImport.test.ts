import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { createDefaultWorkspace } from '@/core/robot';
import type { ProjectImportResult } from '@/features/file-io';
import { useAssetsStore } from '@/store/assetsStore';
import { useSelectionStore } from '@/store/selectionStore';
import { useWorkspaceStore } from '@/store/workspaceStore';

import { useFileImport } from './useFileImport.ts';

function createPreparedRobotPayload(fileName: string) {
  return {
    robotFiles: [
      {
        name: fileName,
        format: 'urdf' as const,
        content: '<robot name="atomic"><link name="base_link" /></robot>',
      },
    ],
    assetFiles: [],
    deferredAssetFiles: [],
    usdSourceFiles: [],
    libraryFiles: [],
    textFiles: [],
    preferredFileName: fileName,
    preResolvedImports: [],
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  assert.fail('Timed out waiting for async import state');
}

let dom: JSDOM;
let originalAlert: typeof globalThis.alert;
let originalFile: typeof globalThis.File;

before(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
  });
  originalAlert = globalThis.alert;
  originalFile = globalThis.File;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: dom.window.navigator,
  });
  Object.defineProperty(globalThis, 'File', { configurable: true, value: dom.window.File });
  Object.defineProperty(globalThis, 'alert', { configurable: true, value: () => {} });
});

after(async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  dom.window.close();
  Object.defineProperty(globalThis, 'alert', { configurable: true, value: originalAlert });
  Object.defineProperty(globalThis, 'File', { configurable: true, value: originalFile });
});

function createProjectResult(name = 'project workspace'): ProjectImportResult {
  const workspace = createDefaultWorkspace(name);
  workspace.components.component_1!.sourceFile = 'robot.urdf';
  return {
    manifest: {
      version: '3.0',
      metadata: { name, lastModified: '2026-07-09T00:00:00.000Z' },
      entries: {
        workspace: 'workspace/state.json',
        workspaceHistory: 'history/workspace.json',
        assets: 'assets/manifest.json',
        allFileContents: 'library/all-file-contents.json',
        motorLibrary: 'library/motor-library.json',
      },
    },
    workspace,
    workspaceHistory: {
      past: [],
      future: [],
      activity: [
        {
          id: 'project_activity',
          timestamp: '2026-07-09T00:00:00.000Z',
          label: 'Saved project state',
        },
      ],
    },
    componentSourceDrafts: {},
    assets: {
      assetUrls: { 'mesh.stl': 'blob:project-mesh' },
      availableFiles: [{ name: 'robot.urdf', format: 'urdf', content: '<robot />' }],
      allFileContents: { 'robot.urdf': '<robot />' },
      motorLibrary: {},
      selectedFileName: 'robot.urdf',
    },
    derivedCaches: { usdPreparedExportCaches: {} },
    warnings: [],
  };
}

function resetStores(): void {
  const transactionId = useWorkspaceStore.getState().transaction?.id;
  if (transactionId) {
    useWorkspaceStore.getState().cancelWorkspaceTransaction(transactionId);
  }
  useWorkspaceStore.getState().replaceWorkspace(createDefaultWorkspace('before'), {
    resetHistory: true,
  });
  useWorkspaceStore.setState({ history: { past: [], future: [], activity: [] } });
  useAssetsStore.setState({
    assets: { 'before.stl': 'https://example.invalid/before.stl' },
    availableFiles: [],
    selectedFile: null,
    allFileContents: {},
    motorLibrary: {},
    usdSceneSnapshots: {},
    usdPreparedExportCaches: {},
    componentSourceDrafts: {},
    documentLoadState: { status: 'idle', fileName: null, format: null, error: null },
  });
  useSelectionStore.setState({ selection: null });
}

function renderHook(options?: Parameters<typeof useFileImport>[0]) {
  let hookValue: ReturnType<typeof useFileImport> | null = null;
  const container = document.createElement('div');
  document.body.appendChild(container);
  function Probe() {
    hookValue = useFileImport(options);
    return null;
  }
  const root = createRoot(container);
  flushSync(() => root.render(React.createElement(Probe)));
  assert.ok(hookValue);
  return {
    hook: hookValue as ReturnType<typeof useFileImport>,
    cleanup: () => {
      flushSync(() => root.unmount());
      container.remove();
    },
  };
}

test('empty import is skipped without touching workspace', async () => {
  resetStores();
  const beforeWorkspace = structuredClone(useWorkspaceStore.getState().workspace);
  const rendered = renderHook();
  try {
    assert.deepEqual(await rendered.hook.handleImport([]), { status: 'skipped' });
    assert.deepEqual(useWorkspaceStore.getState().workspace, beforeWorkspace);
  } finally {
    rendered.cleanup();
  }
});

test('USP import restores canonical workspace/history/assets once', async () => {
  resetStores();
  const importedSelections: Array<string | null> = [];
  const result = createProjectResult();
  const rendered = renderHook({
    projectImporter: async () => result,
    onProjectImported: (file) => importedSelections.push(file?.name ?? null),
  });
  try {
    const input = new File(['project'], 'project.usp');
    assert.deepEqual(await rendered.hook.handleImport([input]), { status: 'completed' });
    assert.equal(useWorkspaceStore.getState().workspace.name, 'project workspace');
    assert.equal(useWorkspaceStore.getState().history.activity[0]?.label, 'Saved project state');
    assert.deepEqual(useAssetsStore.getState().assets, {
      'mesh.stl': 'blob:project-mesh',
    });
    assert.equal(useAssetsStore.getState().selectedFile?.name, 'robot.urdf');
    assert.deepEqual(importedSelections, ['robot.urdf']);
  } finally {
    rendered.cleanup();
  }
});

test('invalid project result leaves workspace/history/assets untouched', async () => {
  resetStores();
  const beforeWorkspace = structuredClone(useWorkspaceStore.getState().workspace);
  const beforeHistory = structuredClone(useWorkspaceStore.getState().history);
  const beforeAssets = structuredClone(useAssetsStore.getState().assets);
  const invalid = createProjectResult('invalid');
  invalid.workspace.components = {};
  const rendered = renderHook({ projectImporter: async () => invalid });
  try {
    assert.deepEqual(await rendered.hook.handleImport([new File(['bad'], 'bad.usp')]), {
      status: 'failed',
    });
    assert.deepEqual(useWorkspaceStore.getState().workspace, beforeWorkspace);
    assert.deepEqual(useWorkspaceStore.getState().history, beforeHistory);
    assert.deepEqual(useAssetsStore.getState().assets, beforeAssets);
  } finally {
    rendered.cleanup();
  }
});

test('project importer rejection leaves the live stores untouched', async () => {
  resetStores();
  const beforeWorkspace = structuredClone(useWorkspaceStore.getState().workspace);
  const beforeAssets = structuredClone(useAssetsStore.getState().assets);
  const rendered = renderHook({
    projectImporter: async () => {
      throw new Error('strict project validation failed');
    },
  });
  try {
    assert.deepEqual(await rendered.hook.handleImport([new File(['bad'], 'bad.usp')]), {
      status: 'failed',
    });
    assert.deepEqual(useWorkspaceStore.getState().workspace, beforeWorkspace);
    assert.deepEqual(useAssetsStore.getState().assets, beforeAssets);
  } finally {
    rendered.cleanup();
  }
});

test('standalone auto-open remains pending with its overlay until canonical load commits', async () => {
  resetStores();
  const overlayStates: Array<unknown> = [];
  let resolveLoad!: () => void;
  const loadPromise = new Promise<void>((resolve) => {
    resolveLoad = resolve;
  });
  let loadCalls = 0;
  const rendered = renderHook({
    prepareImportPayload: async () => createPreparedRobotPayload('atomic.urdf'),
    onImportPreparationStateChange: (state) => overlayStates.push(state),
    onLoadRobot: async () => {
      loadCalls += 1;
      await loadPromise;
    },
  });
  try {
    let settled = false;
    const importPromise = rendered.hook
      .handleImport([new File(['<robot />'], 'atomic.urdf')])
      .then((result) => {
        settled = true;
        return result;
      });
    await waitUntil(() => loadCalls === 1);
    assert.equal(settled, false);
    assert.notEqual(overlayStates.at(-1), null);

    resolveLoad();
    assert.deepEqual(await importPromise, { status: 'completed' });
    assert.equal(overlayStates.at(-1), null);
  } finally {
    rendered.cleanup();
  }
});

test('late standalone auto-open completion is skipped after a newer import generation', async () => {
  resetStores();
  let resolveFirstLoad!: () => void;
  const firstLoadPromise = new Promise<void>((resolve) => {
    resolveFirstLoad = resolve;
  });
  const loadCalls: string[] = [];
  const rendered = renderHook({
    prepareImportPayload: async ({ files }) => {
      const input = files[0];
      const fileName = input instanceof File ? input.name : (input?.file.name ?? 'robot.urdf');
      return createPreparedRobotPayload(fileName);
    },
    onLoadRobot: async (file) => {
      loadCalls.push(file.name);
      if (file.name === 'first.urdf') {
        await firstLoadPromise;
      }
    },
  });
  try {
    const firstImport = rendered.hook.handleImport([new File(['<robot />'], 'first.urdf')]);
    await waitUntil(() => loadCalls.includes('first.urdf'));
    assert.deepEqual(await rendered.hook.handleImport([new File(['<robot />'], 'second.urdf')]), {
      status: 'completed',
    });

    resolveFirstLoad();
    assert.deepEqual(await firstImport, { status: 'skipped' });
    assert.deepEqual(loadCalls, ['first.urdf', 'second.urdf']);
  } finally {
    rendered.cleanup();
  }
});

function seedSelectedAtomicRobot(): void {
  const atomicContent = '<robot name="atomic"><link name="base_link" /></robot>';
  const atomicFile = {
    name: 'atomic.urdf',
    content: atomicContent,
    format: 'urdf' as const,
  };
  useAssetsStore.setState({
    assets: {},
    availableFiles: [atomicFile],
    selectedFile: atomicFile,
    allFileContents: { 'atomic.urdf': atomicContent },
  });
}

test('handleImport with forceLoadRobot switches the canvas to the imported robot even when a file is already selected', async () => {
  resetStores();
  seedSelectedAtomicRobot();
  const loadedFiles: string[] = [];
  const rendered = renderHook({
    prepareImportPayload: async ({ files }) => {
      const input = files[0];
      const fileName = input instanceof File ? input.name : (input?.file.name ?? 'robot.urdf');
      return createPreparedRobotPayload(fileName);
    },
    onLoadRobot: async (file) => {
      loadedFiles.push(file.name);
    },
  });
  try {
    await rendered.hook.handleImport(
      [new File(['<robot name="second"><link name="base_link" /></robot>'], 'second.urdf')],
      { forceLoadRobot: true },
    );
    assert.deepEqual(loadedFiles, ['second.urdf']);
  } finally {
    rendered.cleanup();
  }
});

test('handleImport without forceLoadRobot preserves the current canvas when a file is already selected', async () => {
  resetStores();
  seedSelectedAtomicRobot();
  const loadedFiles: string[] = [];
  const rendered = renderHook({
    prepareImportPayload: async ({ files }) => {
      const input = files[0];
      const fileName = input instanceof File ? input.name : (input?.file.name ?? 'robot.urdf');
      return createPreparedRobotPayload(fileName);
    },
    onLoadRobot: async (file) => {
      loadedFiles.push(file.name);
    },
  });
  try {
    await rendered.hook.handleImport([
      new File(['<robot name="second"><link name="base_link" /></robot>'], 'second.urdf'),
    ]);
    assert.deepEqual(loadedFiles, []);
  } finally {
    rendered.cleanup();
  }
});
