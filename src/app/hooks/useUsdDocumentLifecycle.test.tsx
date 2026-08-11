import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { createSingleComponentWorkspace } from '@/core/robot';
import { useAssetsStore } from '@/store/assetsStore';
import { useSelectionStore } from '@/store/selectionStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import {
  DEFAULT_LINK,
  type RobotData,
  type RobotFile,
} from '@/types';
import type { startUsdRobotStateHydration } from '@/app/utils/usdRobotStateHydration';
import {
  cancelPendingUsdWorkspaceLoad,
  commitResolvedRobotLoad,
  getPendingUsdWorkspaceLoad,
} from '@/app/utils/commitResolvedRobotLoad';

import { useUsdDocumentLifecycle } from './useUsdDocumentLifecycle.ts';

function createRobot(name: string): RobotData {
  return {
    name,
    rootLinkId: 'base',
    links: {
      base: { ...structuredClone(DEFAULT_LINK), id: 'base', name: 'base' },
    },
    joints: {},
  };
}

function createFile(name: string, format: RobotFile['format']): RobotFile {
  return { name, format, content: format === 'usd' ? '#usda 1.0' : '<robot />' };
}

function beginUsd(file: RobotFile) {
  return commitResolvedRobotLoad({
    currentAppMode: 'editor',
    file,
    importResult: { status: 'needs_hydration', format: 'usd' },
    previousDocumentLoadState: structuredClone(
      useAssetsStore.getState().documentLoadState,
    ),
    setAppMode: () => {},
  });
}

function installDom() {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    HTMLElement: globalThis.HTMLElement,
  };
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
  });
  const assignGlobal = (key: keyof typeof previous, value: unknown) => {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  };
  assignGlobal('window', dom.window);
  assignGlobal('document', dom.window.document);
  assignGlobal('navigator', dom.window.navigator);
  assignGlobal('HTMLElement', dom.window.HTMLElement);
  return () => {
    dom.window.close();
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) {
        delete (globalThis as Record<string, unknown>)[key];
        return;
      }
      Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value,
      });
    });
  };
}

async function flushEffects() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function renderLifecycle({
  startHydration,
  onToast = () => {},
  onClearOverlay = () => {},
}: {
  startHydration: typeof startUsdRobotStateHydration;
  onToast?: (message: string, type?: 'info' | 'success') => void;
  onClearOverlay?: () => void;
}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  function Probe() {
    useUsdDocumentLifecycle({
      clearAssemblyComponentPreparationOverlay: onClearOverlay,
      isSelectedUsdHydrating: true,
      labels: {
        failedToParseFormat: 'Failed {format}',
      },
      previewFile: null,
      selectedFile: useAssetsStore.getState().selectedFile,
      setDocumentLoadState: useAssetsStore.getState().setDocumentLoadState,
      showToast: onToast,
      startHydration,
      updateProModeRoundtripBaseline: () => {},
    });
    return null;
  }
  flushSync(() => root.render(React.createElement(Probe)));
  return () => {
    flushSync(() => root.unmount());
    container.remove();
  };
}

beforeEach(() => {
  const pending = getPendingUsdWorkspaceLoad();
  if (pending) cancelPendingUsdWorkspaceLoad(pending.operationId);
  const baselineFile = createFile('baseline.urdf', 'urdf');
  useWorkspaceStore.getState().replaceWorkspace(
    createSingleComponentWorkspace(createRobot('baseline'), {
      componentId: 'baseline',
      sourceFile: baselineFile.name,
    }),
    { resetHistory: true },
  );
  useAssetsStore.setState({
    selectedFile: baselineFile,
    availableFiles: [baselineFile],
    documentLoadState: {
      status: 'ready',
      fileName: baselineFile.name,
      format: baselineFile.format,
      error: null,
      phase: 'ready',
    },
    usdPreparedExportCaches: {},
    usdSceneSnapshots: {},
  });
  useSelectionStore.setState({
    selection: { entity: { type: 'component', componentId: 'baseline' } },
  });
});

test('synchronous hydration start failure rolls back the complete document session', async () => {
  const restoreDom = installDom();
  const file = createFile('broken-start.usd', 'usd');
  const selectedBefore = useAssetsStore.getState().selectedFile;
  const documentBefore = structuredClone(useAssetsStore.getState().documentLoadState);
  beginUsd(file);
  useAssetsStore.getState().setDocumentLoadState({
    status: 'hydrating', fileName: file.name, format: 'usd', error: null,
  });
  const toasts: string[] = [];
  let overlayClears = 0;
  try {
    const cleanup = renderLifecycle({
      startHydration: (() => {
        throw new Error('cannot start worker');
      }) as typeof startUsdRobotStateHydration,
      onToast: (message) => toasts.push(message),
      onClearOverlay: () => { overlayClears += 1; },
    });
    await flushEffects();

    assert.equal(getPendingUsdWorkspaceLoad(), null);
    assert.equal(useAssetsStore.getState().selectedFile, selectedBefore);
    assert.deepEqual(useAssetsStore.getState().documentLoadState, documentBefore);
    assert.deepEqual(toasts, ['cannot start worker']);
    assert.equal(overlayClears, 1);
    cleanup();
    await flushEffects();
  } finally {
    restoreDom();
  }
});

test('asynchronous hydration rejection restores old selection/document without an error shell', async () => {
  const restoreDom = installDom();
  const file = createFile('broken-async.usd', 'usd');
  const selectionBefore = useSelectionStore.getState().selection;
  const documentBefore = structuredClone(useAssetsStore.getState().documentLoadState);
  beginUsd(file);
  useAssetsStore.getState().setDocumentLoadState({
    status: 'hydrating', fileName: file.name, format: 'usd', error: null,
  });
  let rejectHydration!: (reason: Error) => void;
  const promise = new Promise<never>((_resolve, reject) => {
    rejectHydration = reject;
  });
  let cleanupCalls = 0;
  const toasts: string[] = [];
  try {
    const cleanup = renderLifecycle({
      startHydration: (() => ({
        promise,
        cleanup: () => { cleanupCalls += 1; },
      })) as typeof startUsdRobotStateHydration,
      onToast: (message) => toasts.push(message),
    });
    await flushEffects();
    rejectHydration(new Error('worker rejected'));
    await flushEffects();

    assert.equal(getPendingUsdWorkspaceLoad(), null);
    assert.deepEqual(useAssetsStore.getState().documentLoadState, documentBefore);
    assert.deepEqual(useSelectionStore.getState().selection, selectionBefore);
    assert.deepEqual(toasts, ['worker rejected']);
    cleanup();
    await flushEffects();
    assert.equal(cleanupCalls, 1);
  } finally {
    restoreDom();
  }
});

test('late hydration completion after a newer open is dropped without cache pollution', async () => {
  const restoreDom = installDom();
  const oldFile = createFile('old.usd', 'usd');
  beginUsd(oldFile);
  useAssetsStore.getState().setDocumentLoadState({
    status: 'hydrating', fileName: oldFile.name, format: 'usd', error: null,
  });
  let resolveHydration!: (value: unknown) => void;
  const promise = new Promise((resolve) => {
    resolveHydration = resolve;
  });
  let cleanupCalls = 0;
  try {
    const cleanup = renderLifecycle({
      startHydration: (() => ({
        promise,
        cleanup: () => { cleanupCalls += 1; },
      })) as typeof startUsdRobotStateHydration,
    });
    await flushEffects();

    const newFile = createFile('new.urdf', 'urdf');
    commitResolvedRobotLoad({
      currentAppMode: 'editor',
      file: newFile,
      importResult: {
        status: 'ready',
        format: 'urdf',
        robotData: createRobot('new robot'),
        resolvedUrdfContent: null,
        resolvedUrdfSourceFilePath: null,
      },
      setAppMode: () => {},
    });
    resolveHydration({
      robotData: createRobot('late robot'),
      preparedCache: null,
      resolution: { stageSourcePath: oldFile.name },
      bakedScene: null,
    });
    await flushEffects();

    assert.equal(useWorkspaceStore.getState().workspace.name, 'new robot');
    assert.deepEqual(useAssetsStore.getState().usdPreparedExportCaches, {});
    assert.ok(cleanupCalls >= 1);
    cleanup();
    await flushEffects();
  } finally {
    restoreDom();
  }
});
