import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';

import { useFileExport } from './useFileExport.ts';
import { disposeRobotImportWorker } from './robotImportWorkerBridge.ts';
import { useAssetsStore, useUIStore } from '@/store';
import {
  installExportTestRobot,
  resetExportTestWorkspace,
} from './file-export/exportTestWorkspace.ts';
import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  GeometryType,
  JointType,
  type RobotFile,
} from '@/types';
import type { ExportDialogConfig } from '@/features/file-io';
import { parseMJCF, resolveRobotFileData } from '@/core/parsers';

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
  const originalDOMParser = globalThis.DOMParser;

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
      restoreGlobalProperty('DOMParser', originalDOMParser);
    },
  };
}

function renderHook() {
  let hookValue: ReturnType<typeof useFileExport> | null = null as ReturnType<typeof useFileExport> | null;
  const container = document.createElement('div');
  document.body.appendChild(container);

  function Probe() {
    hookValue = useFileExport();
    return null;
  }

  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(Probe));
  });
  assert.ok(hookValue, 'hook should render');
  const hook = hookValue as ReturnType<typeof useFileExport>;
  return {
    hook,
    cleanup() {
      flushSync(() => {
        root.unmount();
      });
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    },
  };
}

function resetStoresToBaseline() {
  useUIStore.setState({
    lang: 'en',
    appMode: 'editor',
  });

  useAssetsStore.setState({
    assets: {},
    availableFiles: [],
    usdSceneSnapshots: {},
    usdPreparedExportCaches: {},
    selectedFile: null,
    documentLoadState: {
      status: 'idle',
      fileName: null,
      format: null,
      error: null,
    },
    allFileContents: {},
    motorLibrary: {},
    componentSourceDrafts: {},
  });

  resetExportTestWorkspace();
}

function installDownloadMocks() {
  const originalCreateElement = document.createElement.bind(document);
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  let capturedBlob: Blob | null = null as Blob | null;
  let clicked = false;
  let appendedAnchor: HTMLAnchorElement | null = null as HTMLAnchorElement | null;

  Object.defineProperty(document, 'createElement', {
    configurable: true,
    writable: true,
    value: (tagName: string, options?: ElementCreationOptions) => {
      const element = originalCreateElement(tagName, options);
      if (tagName.toLowerCase() === 'a') {
        appendedAnchor = element as HTMLAnchorElement;
        Object.defineProperty(element, 'click', {
          configurable: true,
          writable: true,
          value: () => {
            clicked = true;
          },
        });
      }
      return element;
    },
  });

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: (blob: Blob) => {
      capturedBlob = blob;
      return 'blob:sdf-export-test';
    },
  });

  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: () => {},
  });

  return {
    get capturedBlob() {
      return capturedBlob;
    },
    get appendedAnchor() {
      return appendedAnchor;
    },
    get clicked() {
      return clicked;
    },
    restore() {
      Object.defineProperty(document, 'createElement', {
        configurable: true,
        writable: true,
        value: originalCreateElement,
      });

      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        writable: true,
        value: originalCreateObjectURL,
      });

      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        writable: true,
        value: originalRevokeObjectURL,
      });
    },
  };
}

type WorkerEventHandler = (event: { data?: unknown; error?: unknown; message?: string }) => void;

function installRobotImportWorkerMock() {
  const originalWorker = globalThis.Worker;
  let resolveRequestCount = 0;

  class FakeRobotImportWorker {
    private readonly listeners = new Map<string, Set<WorkerEventHandler>>();

    private readonly contextSnapshots = new Map<string, {
      availableFiles?: RobotFile[];
      assets?: Record<string, string>;
      allFileContents?: Record<string, string>;
    }>();

    addEventListener(type: string, handler: WorkerEventHandler): void {
      const handlers = this.listeners.get(type) ?? new Set<WorkerEventHandler>();
      handlers.add(handler);
      this.listeners.set(type, handlers);
    }

    removeEventListener(type: string, handler: WorkerEventHandler): void {
      this.listeners.get(type)?.delete(handler);
    }

    postMessage(message: any): void {
      if (message?.type === 'sync-context') {
        this.contextSnapshots.set(message.contextId, message.context ?? {});
        return;
      }

      if (message?.type !== 'resolve-robot-file') {
        return;
      }

      resolveRequestCount += 1;
      const context = message.contextId
        ? this.contextSnapshots.get(message.contextId)
        : undefined;
      const options = {
        ...context,
        ...message.options,
        availableFiles: message.options?.availableFiles ?? context?.availableFiles,
        assets: message.options?.assets ?? context?.assets,
        allFileContents: message.options?.allFileContents ?? context?.allFileContents,
      };

      queueMicrotask(() => {
        const result = resolveRobotFileData(message.file, options);
        this.listeners.get('message')?.forEach((handler) => {
          handler({
            data: {
              type: 'resolve-robot-file-result',
              requestId: message.requestId,
              result,
            },
          });
        });
      });
    }

    terminate(): void {}
  }

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: FakeRobotImportWorker as unknown as typeof Worker,
  });

  return {
    get resolveRequestCount() {
      return resolveRequestCount;
    },
    restore() {
      disposeRobotImportWorker();
      restoreGlobalProperty('Worker', originalWorker);
    },
  };
}

function createExportConfig(
  sdfOverrides: Partial<ExportDialogConfig['sdf']> = {},
): ExportDialogConfig {
  return {
    format: 'sdf',
    includeSkeleton: false,
    mjcf: {
      meshdir: 'meshes/',
      addFloatBase: false,
      preferSharedMeshReuse: true,
      includeActuators: true,
      actuatorType: 'position',
      includeMeshes: false,
      meshFormat: 'auto',
      compressSTL: false,
      stlQuality: 50,
    },
    urdf: {
      includeExtended: false,
      includeBOM: false,
      useRelativePaths: true,
      preferSourceVisualMeshes: true,
      includeMeshes: false,
      meshFormat: 'auto',
      compressSTL: false,
      stlQuality: 50,
    },
    xacro: {
      includeGazeboControl: true,
      rosVersion: 'ros2',
      gazeboBackend: 'classic',
      rosHardwareInterface: 'effort',
      useRelativePaths: true,
      includeMeshes: false,
      meshFormat: 'auto',
      compressSTL: false,
      stlQuality: 50,
    },
    sdf: {
      includeMeshes: false,
      meshFormat: 'auto',
      compressSTL: false,
      stlQuality: 50,
      ...sdfOverrides,
    },
    usd: {
      fileFormat: 'usd',
      compressMeshes: true,
      meshQuality: 50,
    },
  };
}

function loadArchiveModelSdf(archive: JSZip): Promise<string> {
  const modelPath = Object.keys(archive.files).find((path) => path.endsWith('/model.sdf'));
  assert.ok(modelPath, 'expected a model.sdf file in the archive');
  const modelFile = archive.file(modelPath);
  assert.ok(modelFile, 'expected model.sdf to be readable');
  return modelFile.async('string');
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

test('useFileExport packages the current robot as a Gazebo-style SDF zip', async () => {
  resetStoresToBaseline();
  const domEnvironment = installDomEnvironment();

  installExportTestRobot({
    name: 'demo_sdf_export',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 2, z: 3 },
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 2, z: 3 },
        },
      },
      tip_link: {
        ...DEFAULT_LINK,
        id: 'tip_link',
        name: 'tip_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.CYLINDER,
          dimensions: { x: 0.1, y: 0.4, z: 0.1 },
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.CYLINDER,
          dimensions: { x: 0.1, y: 0.4, z: 0.1 },
        },
      },
    },
    joints: {
      tip_joint: {
        ...DEFAULT_JOINT,
        id: 'tip_joint',
        name: 'tip_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'tip_link',
        origin: {
          xyz: { x: 0, y: 0, z: 1 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        axis: { x: 0, y: 0, z: 1 },
        limit: {
          lower: -1.57,
          upper: 1.57,
          effort: 10,
          velocity: 2,
        },
      },
    },
  });

  const downloadMocks = installDownloadMocks();
  const rendered = renderHook();

  try {
    await rendered.hook.handleExportWithConfig(createExportConfig());

    assert.equal(downloadMocks.clicked, true, 'expected the SDF archive to be downloaded');
    assert.match(downloadMocks.appendedAnchor?.download ?? '', /_sdf\.zip$/);
    assert.ok(downloadMocks.capturedBlob, 'expected a zip blob to be generated');

    const archive = await JSZip.loadAsync(await downloadMocks.capturedBlob.arrayBuffer());
    const modelSdf = await loadArchiveModelSdf(archive);
    const modelConfigPath = Object.keys(archive.files).find((path) => path.endsWith('/model.config'));

    assert.ok(modelConfigPath, 'expected a model.config file in the archive');
    assert.match(modelSdf, /<model name="demo_sdf_export">/);
    assert.match(modelSdf, /<joint name="tip_joint" type="revolute">/);

    const importResult = resolveRobotFileData({
      name: 'demo_sdf_export/model.sdf',
      format: 'sdf',
      content: modelSdf,
    });

    assert.equal(importResult.status, 'ready');
    if (importResult.status !== 'ready') {
      assert.fail('expected exported SDF to import successfully');
    }
    assert.equal(importResult.robotData.name, 'demo_sdf_export');
    assert.ok(importResult.robotData.joints.tip_joint);
  } finally {
    rendered.cleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
    downloadMocks.restore();
    domEnvironment.restore();
    resetStoresToBaseline();
  }
});

test('useFileExport preserves imported MJCF visual colors when exporting the current robot as SDF', async () => {
  resetStoresToBaseline();
  const domEnvironment = installDomEnvironment();
  const sourceXml = fs.readFileSync('test/mujoco_menagerie-main/booster_t1/t1.xml', 'utf8');
  const robot = parseMJCF(sourceXml);
  assert.ok(robot, 'expected booster_t1 MJCF fixture to parse');
  assert.equal(robot.links.Trunk.visual.color, '#c2c2c2');
  assert.equal(robot.links.H1.visual.color, '#666666');

  installExportTestRobot(robot);

  const downloadMocks = installDownloadMocks();
  const rendered = renderHook();

  try {
    await rendered.hook.handleExportWithConfig(createExportConfig());

    assert.equal(downloadMocks.clicked, true, 'expected the SDF archive to be downloaded');
    assert.ok(downloadMocks.capturedBlob, 'expected a zip blob to be generated');

    const archive = await JSZip.loadAsync(await downloadMocks.capturedBlob.arrayBuffer());
    const modelSdf = await loadArchiveModelSdf(archive);

    assert.equal(countMatches(modelSdf, /<material>/g), 24);
    assert.equal(countMatches(modelSdf, /<ambient>/g), 24);
    assert.equal(countMatches(modelSdf, /<diffuse>/g), 24);
    assert.match(modelSdf, /<ambient>0\.76078824 0\.76078824 0\.76078824 1\.00000000<\/ambient>/);
    assert.match(modelSdf, /<diffuse>0\.40000392 0\.40000392 0\.40000392 1\.00000000<\/diffuse>/);

    const importResult = resolveRobotFileData({
      name: 'T1/model.sdf',
      format: 'sdf',
      content: modelSdf,
    });

    assert.equal(importResult.status, 'ready');
    if (importResult.status !== 'ready') {
      assert.fail('expected exported T1 SDF to import successfully');
    }
    assert.equal(importResult.robotData.links.Trunk.visual.color, '#c2c2c2');
    assert.equal(importResult.robotData.links.H1.visual.color, '#666666');
    assert.equal(importResult.robotData.materials?.Trunk?.color, '#c2c2c2');
  } finally {
    rendered.cleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
    downloadMocks.restore();
    domEnvironment.restore();
    resetStoresToBaseline();
  }
});

test('useFileExport exports library SDF files through the same dialog workflow', async () => {
  resetStoresToBaseline();
  const domEnvironment = installDomEnvironment();
  const workerMock = installRobotImportWorkerMock();

  const sourceFile: RobotFile = {
    name: 'robots/demo/model.sdf',
    format: 'sdf',
    content: `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="library_sdf">
    <link name="base_link">
      <visual name="body">
        <geometry>
          <box>
            <size>1 1 1</size>
          </box>
        </geometry>
      </visual>
    </link>
  </model>
</sdf>`,
  };

  useAssetsStore.getState().setAvailableFiles([sourceFile]);

  const downloadMocks = installDownloadMocks();
  const rendered = renderHook();

  try {
    await rendered.hook.handleExportWithConfig(createExportConfig(), {
      type: 'library-file',
      file: sourceFile,
    });

    assert.equal(downloadMocks.clicked, true, 'expected the library SDF archive to be downloaded');
    assert.match(downloadMocks.appendedAnchor?.download ?? '', /^model_sdf\.zip$/);
    assert.ok(downloadMocks.capturedBlob, 'expected a zip blob to be generated');

    const archive = await JSZip.loadAsync(await downloadMocks.capturedBlob.arrayBuffer());
    const modelSdf = await loadArchiveModelSdf(archive);

    assert.match(modelSdf, /<model name="library_sdf">/);

    const importResult = resolveRobotFileData({
      name: 'model/model.sdf',
      format: 'sdf',
      content: modelSdf,
    });

    assert.equal(importResult.status, 'ready');
    if (importResult.status !== 'ready') {
      assert.fail('expected exported library SDF to import successfully');
    }
    assert.equal(importResult.robotData.name, 'library_sdf');
  } finally {
    rendered.cleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
    downloadMocks.restore();
    workerMock.restore();
    domEnvironment.restore();
    resetStoresToBaseline();
  }
});

test('useFileExport exports library SDF files through the import worker path when Worker is available', async () => {
  resetStoresToBaseline();
  const domEnvironment = installDomEnvironment();
  const workerMock = installRobotImportWorkerMock();

  const sourceFile: RobotFile = {
    name: 'robots/demo/worker-model.sdf',
    format: 'sdf',
    content: `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="worker_library_sdf">
    <link name="base_link">
      <visual name="body">
        <geometry>
          <box>
            <size>1 1 1</size>
          </box>
        </geometry>
      </visual>
    </link>
  </model>
</sdf>`,
  };

  useAssetsStore.getState().setAvailableFiles([sourceFile]);

  const downloadMocks = installDownloadMocks();
  const rendered = renderHook();

  try {
    await rendered.hook.handleExportWithConfig(createExportConfig(), {
      type: 'library-file',
      file: sourceFile,
    });

    assert.equal(workerMock.resolveRequestCount, 1, 'expected the worker path to resolve the library file');
    assert.equal(downloadMocks.clicked, true, 'expected the library SDF archive to be downloaded');
    assert.ok(downloadMocks.capturedBlob, 'expected a zip blob to be generated');

    const archive = await JSZip.loadAsync(await downloadMocks.capturedBlob.arrayBuffer());
    const modelSdf = await loadArchiveModelSdf(archive);

    assert.match(modelSdf, /<model name="worker_library_sdf">/);
  } finally {
    rendered.cleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
    downloadMocks.restore();
    workerMock.restore();
    domEnvironment.restore();
    resetStoresToBaseline();
  }
});
