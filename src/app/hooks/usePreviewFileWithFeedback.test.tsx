import test from 'node:test';
import assert from 'node:assert/strict';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { resolveRobotFileData } from '@/core/parsers/importRobotFile';
import { useAssetsStore } from '@/store';
import type { DocumentLoadState } from '@/store/assetsStore';
import type { RobotData, RobotFile } from '@/types';

import { buildPreResolvedImportContentSignature } from '../utils/preResolvedImportSignature.ts';
import {
  clearPreResolvedRobotImportCache,
  primePreResolvedRobotImports,
} from '../utils/preResolvedRobotImportCache.ts';
import { usePreviewFileWithFeedback } from './usePreviewFileWithFeedback.ts';

function restoreGlobalProperty<T extends keyof typeof globalThis>(
  key: T,
  originalValue: (typeof globalThis)[T] | undefined,
) {
  if (originalValue === undefined) {
    delete globalThis[key];
    return;
  }

  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: originalValue,
  });
}

function installDomEnvironment() {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalSVGElement = globalThis.SVGElement;
  const originalNode = globalThis.Node;
  const originalMutationObserver = globalThis.MutationObserver;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const originalDomParser = globalThis.DOMParser;

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
  });

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: dom.window,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: dom.window.document,
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: dom.window.navigator,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    writable: true,
    value: dom.window.HTMLElement,
  });
  Object.defineProperty(globalThis, 'SVGElement', {
    configurable: true,
    writable: true,
    value: dom.window.SVGElement,
  });
  Object.defineProperty(globalThis, 'Node', {
    configurable: true,
    writable: true,
    value: dom.window.Node,
  });
  Object.defineProperty(globalThis, 'MutationObserver', {
    configurable: true,
    writable: true,
    value: dom.window.MutationObserver,
  });
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    writable: true,
    value: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
  });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    writable: true,
    value: (handle: number) => clearTimeout(handle),
  });
  Object.defineProperty(globalThis, 'DOMParser', {
    configurable: true,
    writable: true,
    value: dom.window.DOMParser,
  });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    writable: true,
    value: true,
  });

  return {
    restore() {
      dom.window.close();
      restoreGlobalProperty('window', originalWindow);
      restoreGlobalProperty('document', originalDocument);
      restoreGlobalProperty('navigator', originalNavigator);
      restoreGlobalProperty('HTMLElement', originalHTMLElement);
      restoreGlobalProperty('SVGElement', originalSVGElement);
      restoreGlobalProperty('Node', originalNode);
      restoreGlobalProperty('MutationObserver', originalMutationObserver);
      restoreGlobalProperty('requestAnimationFrame', originalRequestAnimationFrame);
      restoreGlobalProperty('cancelAnimationFrame', originalCancelAnimationFrame);
      restoreGlobalProperty('DOMParser', originalDomParser);
      delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    },
  };
}

function createRobotFile(name = 'robots/demo.urdf'): RobotFile {
  return {
    name,
    format: 'urdf',
    content: '<robot name="demo"><link name="base_link" /></robot>',
  };
}

function renderHook(options: {
  allFileContents: Record<string, string>;
  assemblyComponentFileNames?: ReadonlySet<string>;
  assets: Record<string, string>;
  availableFiles: RobotFile[];
  getUsdPreparedExportCache: (path: string) => { robotData?: RobotData } | null;
  handlePreviewFile: (file: RobotFile) => void;
  labels: {
    failedToParseFormat: string;
    importPackageAssetBundleHint: string;
    usdPreviewRequiresOpen: string;
    xacroSourceOnlyPreviewHint: string;
  };
  setDocumentLoadState: (state: DocumentLoadState) => void;
  showToast: (message: string, type?: 'info' | 'success') => void;
}) {
  let hookValue: ReturnType<typeof usePreviewFileWithFeedback> | null = null as ReturnType<
    typeof usePreviewFileWithFeedback
  > | null;
  const container = document.createElement('div');
  document.body.appendChild(container);

  function Probe() {
    hookValue = usePreviewFileWithFeedback(options);
    return null;
  }

  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(Probe));
  });

  assert.ok(hookValue, 'hook should render');

  return {
    get hook() {
      assert.ok(hookValue, 'hook should stay mounted');
      return hookValue;
    },
    cleanup() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

test('usePreviewFileWithFeedback hands the preview loading overlay off to the viewer after a successful parse', async () => {
  const domEnvironment = installDomEnvironment();
  const robotFile = createRobotFile();
  const documentLoadStates: DocumentLoadState[] = [];
  const previewRequests: string[] = [];
  const toastMessages: string[] = [];

  useAssetsStore.getState().resetDocumentLoadState();
  clearPreResolvedRobotImportCache();

  const resolved = resolveRobotFileData(robotFile);
  assert.equal(resolved.status, 'ready');
  if (resolved.status !== 'ready') {
    assert.fail('Expected preview fixture to parse');
  }
  resolved.robotData.inspectionContext = {
    ...resolved.robotData.inspectionContext,
    sourceFormat: 'urdf',
    recovery: {
      diagnostics: [],
      diagnosticCounts: { error: 0, warning: 2, info: 0 },
      recoveredItemCount: 2,
      omittedDiagnosticCount: 2,
    },
  };

  primePreResolvedRobotImports([
    {
      fileName: robotFile.name,
      format: robotFile.format,
      contentSignature: buildPreResolvedImportContentSignature(robotFile.content),
      result: resolved,
    },
  ]);

  const rendered = renderHook({
    allFileContents: {
      [robotFile.name]: robotFile.content,
    },
    assets: {},
    availableFiles: [robotFile],
    getUsdPreparedExportCache: () => null,
    handlePreviewFile: (file) => {
      previewRequests.push(file.name);
    },
    labels: {
      failedToParseFormat: 'Failed to parse {format}',
      importPackageAssetBundleHint: 'Missing assets: {assets}',
      usdPreviewRequiresOpen: 'Open the USD file first',
      xacroSourceOnlyPreviewHint: 'Source-only preview unavailable',
    },
    setDocumentLoadState: (state) => {
      documentLoadStates.push(state);
      useAssetsStore.getState().setDocumentLoadState(state);
    },
    showToast: (message) => {
      toastMessages.push(message);
    },
  });

  try {
    await act(async () => {
      rendered.hook.handlePreviewFileWithFeedback(robotFile);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    assert.deepEqual(previewRequests, [robotFile.name]);
    assert.deepEqual(toastMessages, []);
    assert.equal(documentLoadStates.length >= 3, true);
    // After import resolves, the overlay stays in 'loading' at the import-complete
    // percentage (40% for non-USD). The viewer's mesh-streaming + onLoad events
    // are responsible for the final 'ready' transition.
    assert.deepEqual(documentLoadStates.at(-1), {
      status: 'loading',
      fileName: robotFile.name,
      format: robotFile.format,
      error: null,
      phase: 'preparing-scene',
      message: null,
      progressMode: 'percent',
      progressPercent: 40,
      loadedCount: null,
      totalCount: null,
    });
  } finally {
    rendered.cleanup();
    clearPreResolvedRobotImportCache();
    useAssetsStore.getState().resetDocumentLoadState();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    domEnvironment.restore();
  }
});

test('usePreviewFileWithFeedback suppresses asset warning when file is already an assembly component', async () => {
  const domEnvironment = installDomEnvironment();

  const meshUrdfFile: RobotFile = {
    name: 'mujoco_menagerie-main/agilex_piper/piper.urdf',
    format: 'urdf',
    content: `<robot name="piper">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="package://mujoco_menagerie-main/agilex_piper/meshes/assets/base_link.stl" />
      </geometry>
    </visual>
  </link>
</robot>`,
  };

  const documentLoadStates: DocumentLoadState[] = [];
  const toastMessages: string[] = [];
  const previewRequests: string[] = [];

  useAssetsStore.getState().resetDocumentLoadState();
  clearPreResolvedRobotImportCache();

  primePreResolvedRobotImports([
    {
      fileName: meshUrdfFile.name,
      format: meshUrdfFile.format,
      contentSignature: buildPreResolvedImportContentSignature(meshUrdfFile.content),
      result: resolveRobotFileData(meshUrdfFile),
    },
  ]);

  const assemblyComponentFileNames = new Set([meshUrdfFile.name]);

  const rendered = renderHook({
    allFileContents: { [meshUrdfFile.name]: meshUrdfFile.content },
    assemblyComponentFileNames,
    assets: {},
    availableFiles: [meshUrdfFile],
    getUsdPreparedExportCache: () => null,
    handlePreviewFile: (file) => {
      previewRequests.push(file.name);
    },
    labels: {
      failedToParseFormat: 'Failed to parse {format}',
      importPackageAssetBundleHint: 'Missing assets: {assets}',
      usdPreviewRequiresOpen: 'Open the USD file first',
      xacroSourceOnlyPreviewHint: 'Source-only preview unavailable',
    },
    setDocumentLoadState: (state) => {
      documentLoadStates.push(state);
      useAssetsStore.getState().setDocumentLoadState(state);
    },
    showToast: (message) => {
      toastMessages.push(message);
    },
  });

  try {
    await act(async () => {
      rendered.hook.handlePreviewFileWithFeedback(meshUrdfFile);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    assert.deepEqual(previewRequests, [meshUrdfFile.name]);
    assert.equal(
      toastMessages.every((msg) => !msg.includes('Missing assets')),
      true,
      'should not show asset warning for files already in the assembly',
    );
  } finally {
    rendered.cleanup();
    clearPreResolvedRobotImportCache();
    useAssetsStore.getState().resetDocumentLoadState();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    domEnvironment.restore();
  }
});
