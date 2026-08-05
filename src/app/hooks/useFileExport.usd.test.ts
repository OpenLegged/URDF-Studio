import test from 'node:test';
import assert from 'node:assert/strict';

import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

import { useFileExport } from './useFileExport.ts';
import { disposeUsdBinaryArchiveWorker } from '../utils/usdBinaryArchiveWorkerBridge.ts';
import { useAssetsStore, useUIStore } from '@/store';
import {
  installExportTestRobot,
  installExportTestWorkspace,
  resetExportTestWorkspace,
} from './file-export/exportTestWorkspace.ts';
import { createSingleComponentWorkspace } from '@/core/robot';
import { useWorkspaceStore } from '@/store/workspaceStore';
import {
  GeometryType,
  type RobotFile,
  type RobotState,
  type UsdPreparedExportCache,
} from '@/types';
import type { ExportDialogConfig, ExportProgressState } from '@/features/file-io';
import { disposeUsdExportWorker } from '@/features/file-io';
import { serializeUsdExportResultForWorker } from '@/features/file-io/utils/usdExportWorkerTransfer';

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
  const originalBlob = globalThis.Blob;
  const originalFile = globalThis.File;
  const originalFileReader = globalThis.FileReader;
  const originalMutationObserver = globalThis.MutationObserver;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

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
  Object.defineProperty(globalThis, 'Blob', {
    configurable: true,
    writable: true,
    value: dom.window.Blob,
  });
  Object.defineProperty(globalThis, 'File', {
    configurable: true,
    writable: true,
    value: dom.window.File,
  });
  Object.defineProperty(globalThis, 'FileReader', {
    configurable: true,
    writable: true,
    value: dom.window.FileReader,
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

  return {
    restore() {
      dom.window.close();
      restoreGlobalProperty('window', originalWindow);
      restoreGlobalProperty('document', originalDocument);
      restoreGlobalProperty('navigator', originalNavigator);
      restoreGlobalProperty('HTMLElement', originalHTMLElement);
      restoreGlobalProperty('SVGElement', originalSVGElement);
      restoreGlobalProperty('Node', originalNode);
      restoreGlobalProperty('Blob', originalBlob);
      restoreGlobalProperty('File', originalFile);
      restoreGlobalProperty('FileReader', originalFileReader);
      restoreGlobalProperty('MutationObserver', originalMutationObserver);
      restoreGlobalProperty('requestAnimationFrame', originalRequestAnimationFrame);
      restoreGlobalProperty('cancelAnimationFrame', originalCancelAnimationFrame);
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
      return 'blob:usd-export-test';
    },
  });

  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: () => {},
  });

  return {
    get appendedAnchor() {
      return appendedAnchor;
    },
    get capturedBlob() {
      return capturedBlob;
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

function readBlobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer();
  }

  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
        return;
      }
      reject(new Error('Failed to read test blob as ArrayBuffer.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read test blob.'));
    reader.readAsArrayBuffer(blob);
  });
}

function installLiveStageExportMock(
  implementation: Window['exportLoadedStageSnapshot'],
) {
  assert.ok(implementation);
  const targetWindow = window as typeof window & {
    exportLoadedStageSnapshot?: Window['exportLoadedStageSnapshot'];
  };
  const originalHandler = targetWindow.exportLoadedStageSnapshot;
  let callCount = 0;

  targetWindow.exportLoadedStageSnapshot = async (options?: Record<string, unknown>) => {
    callCount += 1;
    return implementation(options);
  };

  return {
    get callCount() {
      return callCount;
    },
    restore() {
      if (originalHandler) {
        targetWindow.exportLoadedStageSnapshot = originalHandler;
        return;
      }
      delete targetWindow.exportLoadedStageSnapshot;
    },
  };
}

type WorkerEventHandler = (event: { data?: unknown; error?: unknown; message?: string }) => void;

function installUsdExportPipelineWorkerMock() {
  const originalWorker = globalThis.Worker;
  let usdExportRequestCount = 0;
  let usdBinaryRequestCount = 0;

  class FakeUsdExportPipelineWorker {
    private readonly listeners = new Map<string, Set<WorkerEventHandler>>();

    constructor(private readonly scriptUrl: string | URL) {}

    addEventListener(type: string, handler: WorkerEventHandler): void {
      const handlers = this.listeners.get(type) ?? new Set<WorkerEventHandler>();
      handlers.add(handler);
      this.listeners.set(type, handlers);
    }

    removeEventListener(type: string, handler: WorkerEventHandler): void {
      this.listeners.get(type)?.delete(handler);
    }

    postMessage(message: any): void {
      const scriptUrl = String(this.scriptUrl);

      if (scriptUrl.includes('usdExport.worker')) {
        if (message?.type !== 'export-robot-to-usd') {
          return;
        }

        usdExportRequestCount += 1;
        queueMicrotask(async () => {
          const exportName = String(message.payload?.exportName || 'worker_bot');
          const fileFormat = String(message.payload?.fileFormat || 'usd');
          const layoutProfile = String(message.payload?.layoutProfile || 'legacy');
          const extension = fileFormat === 'usda' ? 'usda' : 'usd';
          const rootLayerPath =
            layoutProfile === 'isaacsim'
              ? `${exportName}/${exportName}.${extension}`
              : `${exportName}/usd/${exportName}.${extension}`;
          const serialized = await serializeUsdExportResultForWorker({
            content: '#usda 1.0\n',
            downloadFileName: `${exportName}.${extension}`,
            archiveFileName: `${exportName}_${extension}.zip`,
            rootLayerPath,
            archiveFiles: new Map<string, Blob>([
              [rootLayerPath, new Blob(['#usda 1.0\n'], { type: 'text/plain;charset=utf-8' })],
            ]),
          });

          this.listeners.get('message')?.forEach((handler) => {
            handler({
              data: {
                type: 'export-robot-to-usd-progress',
                requestId: message.requestId,
                progress: {
                  phase: 'links',
                  completed: 1,
                  total: 1,
                  label: 'base_link',
                },
              },
            });
          });
          this.listeners.get('message')?.forEach((handler) => {
            handler({
              data: {
                type: 'export-robot-to-usd-result',
                requestId: message.requestId,
                result: serialized.payload,
              },
            });
          });
        });
        return;
      }

      if (scriptUrl.includes('usdBinaryArchive.worker')) {
        if (message?.type !== 'convert-usd-archive-files-to-binary') {
          return;
        }

        usdBinaryRequestCount += 1;
        queueMicrotask(() => {
          const archiveFiles = Array.isArray(message.archiveFiles?.files)
            ? message.archiveFiles.files
            : [];
          const firstFilePath = String(archiveFiles[0]?.path || 'worker_bot/usd/worker_bot.usd');
          const binaryArchiveFiles = archiveFiles.map((file: any) =>
            String(file.path || '').toLowerCase().endsWith('.usd')
              ? {
                  ...file,
                  mimeType: 'application/octet-stream',
                  bytes: new TextEncoder().encode('PXR-USDCMOCK').buffer,
                }
              : file,
          );

          this.listeners.get('message')?.forEach((handler) => {
            handler({
              data: {
                type: 'convert-usd-archive-files-to-binary-progress',
                requestId: message.requestId,
                current: archiveFiles.length > 0 ? 1 : 0,
                total: archiveFiles.length,
                filePath: firstFilePath,
              },
            });
          });
          this.listeners.get('message')?.forEach((handler) => {
            handler({
              data: {
                type: 'convert-usd-archive-files-to-binary-result',
                requestId: message.requestId,
                result: { files: binaryArchiveFiles },
              },
            });
          });
        });
      }
    }

    terminate(): void {}
  }

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: FakeUsdExportPipelineWorker as unknown as typeof Worker,
  });

  return {
    get usdBinaryRequestCount() {
      return usdBinaryRequestCount;
    },
    get usdExportRequestCount() {
      return usdExportRequestCount;
    },
    restore() {
      disposeUsdExportWorker();
      disposeUsdBinaryArchiveWorker();
      restoreGlobalProperty('Worker', originalWorker);
    },
  };
}

function createUsdExportConfig(
  usdOverrides: Partial<ExportDialogConfig['usd']> = {},
): ExportDialogConfig {
  return {
    format: 'usd',
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
    },
    usd: {
      fileFormat: 'usd',
      compressMeshes: true,
      meshQuality: 50,
      ...usdOverrides,
    },
  };
}

function createCurrentRobot(meshPath = 'base_link_visual_0.obj'): RobotState {
  return {
    name: 'edited_worker_bot',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#ffffff',
          meshPath,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#cccccc',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
  };
}

function createPreparedUsdExportCache(
  stageSourcePath: string,
  meshPath = 'base_link_visual_0.obj',
): UsdPreparedExportCache {
  return {
    stageSourcePath,
    robotData: {
      name: 'prepared_worker_bot',
      rootLinkId: 'base_link',
      links: {
        base_link: {
          id: 'base_link',
          name: 'base_link',
          visible: true,
          visual: {
            type: GeometryType.MESH,
            dimensions: { x: 1, y: 1, z: 1 },
            color: '#ffffff',
            meshPath,
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
          collision: {
            type: GeometryType.NONE,
            dimensions: { x: 0, y: 0, z: 0 },
            color: '#cccccc',
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
          inertial: {
            mass: 1,
            origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
            inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
          },
        },
      },
      joints: {},
    },
    meshFiles: {
      [meshPath]: new Blob(['o cached_mesh\nv 0 0 0\nf 1 1 1\n'], {
        type: 'text/plain;charset=utf-8',
      }),
    },
  };
}

test('useFileExport routes USD exports through usd export worker and binary archive worker', async () => {
  resetStoresToBaseline();
  const domEnvironment = installDomEnvironment();
  const downloadMocks = installDownloadMocks();
  const workerMocks = installUsdExportPipelineWorkerMock();

  try {
    const selectedFile: RobotFile = {
      name: 'robots/demo/demo.usd',
      format: 'usd',
      content: '#usda 1.0\n',
    };

    useUIStore.setState({
      lang: 'en',
      appMode: 'editor',
    });

    useAssetsStore.getState().setAvailableFiles([selectedFile]);
    useAssetsStore.getState().setSelectedFile(selectedFile);
    useAssetsStore.getState().setAllFileContents({
      [selectedFile.name]: selectedFile.content,
    });
    useAssetsStore.getState().setDocumentLoadState({
      status: 'ready',
      fileName: selectedFile.name,
      format: 'usd',
      error: null,
    });
    useAssetsStore
      .getState()
      .setUsdPreparedExportCache(
        '/robots/demo/demo.usd',
        createPreparedUsdExportCache('/robots/demo/demo.usd'),
      );

    installExportTestRobot(createCurrentRobot());

    const rendered = renderHook();
    const progressEvents: ExportProgressState[] = [];

    try {
      const result = await rendered.hook.handleExportWithConfig(
        createUsdExportConfig(),
        { type: 'current' },
        {
          onProgress: (progress) => progressEvents.push(progress),
        },
      );

      assert.deepEqual(result, {
        partial: false,
        warnings: [],
        issues: [],
      });
      assert.equal(workerMocks.usdExportRequestCount, 1);
      assert.equal(workerMocks.usdBinaryRequestCount, 1);
      assert.ok(progressEvents.some((event) => event.currentStep === 2));
      assert.ok(progressEvents.some((event) => event.currentStep === 3));
      assert.ok(progressEvents.some((event) => event.currentStep === 4));
      assert.ok(downloadMocks.clicked);
      assert.ok(downloadMocks.appendedAnchor);
      assert.equal(downloadMocks.appendedAnchor?.download, 'demo_usd.zip');
      assert.ok(downloadMocks.capturedBlob);

      const archive = await JSZip.loadAsync(await readBlobArrayBuffer(downloadMocks.capturedBlob));
      const rootLayerPath = Object.keys(archive.files).find((path) => path.endsWith('.usd'));
      assert.ok(rootLayerPath, 'expected a binary .usd root layer in the archive');
      const rootLayer = archive.file(rootLayerPath);
      assert.ok(rootLayer);
      assert.equal(await rootLayer.async('string'), 'PXR-USDCMOCK');
    } finally {
      rendered.cleanup();
    }
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 0));
    workerMocks.restore();
    downloadMocks.restore();
    domEnvironment.restore();
  }
});

test('useFileExport skips binary USD conversion when exporting authored USDA layers', async () => {
  resetStoresToBaseline();
  const domEnvironment = installDomEnvironment();
  const downloadMocks = installDownloadMocks();
  const workerMocks = installUsdExportPipelineWorkerMock();

  try {
    const selectedFile: RobotFile = {
      name: 'robots/demo/demo.usd',
      format: 'usd',
      content: '#usda 1.0\n',
    };

    useUIStore.setState({
      lang: 'en',
      appMode: 'editor',
    });

    useAssetsStore.getState().setAvailableFiles([selectedFile]);
    useAssetsStore.getState().setSelectedFile(selectedFile);
    useAssetsStore.getState().setAllFileContents({
      [selectedFile.name]: selectedFile.content,
    });
    useAssetsStore.getState().setDocumentLoadState({
      status: 'ready',
      fileName: selectedFile.name,
      format: 'usd',
      error: null,
    });
    useAssetsStore
      .getState()
      .setUsdPreparedExportCache(
        '/robots/demo/demo.usd',
        createPreparedUsdExportCache('/robots/demo/demo.usd'),
      );

    installExportTestRobot(createCurrentRobot());

    const rendered = renderHook();

    try {
      const result = await rendered.hook.handleExportWithConfig(
        createUsdExportConfig({ fileFormat: 'usda' }),
        { type: 'current' },
      );

      assert.deepEqual(result, {
        partial: false,
        warnings: [],
        issues: [],
      });
      assert.equal(workerMocks.usdExportRequestCount, 1);
      assert.equal(workerMocks.usdBinaryRequestCount, 0);
      assert.ok(downloadMocks.clicked);
      assert.equal(downloadMocks.appendedAnchor?.download, 'demo_usda.zip');
      assert.ok(downloadMocks.capturedBlob);
    } finally {
      rendered.cleanup();
    }
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 0));
    workerMocks.restore();
    downloadMocks.restore();
    domEnvironment.restore();
  }
});

test('useFileExport prefers prepared USD bundle export over the viewer runtime export handler', async () => {
  resetStoresToBaseline();
  const domEnvironment = installDomEnvironment();
  const downloadMocks = installDownloadMocks();
  const workerMocks = installUsdExportPipelineWorkerMock();

  try {
    const liveStageExport = installLiveStageExportMock(async () => ({
      ok: true,
      content: '#usda 1.0\n',
    }));

    try {
      const selectedFile: RobotFile = {
        name: 'robots/demo/demo.usd',
        format: 'usd',
        content: '#usda 1.0\n',
      };

      useUIStore.setState({
        lang: 'en',
        appMode: 'editor',
      });

      useAssetsStore.getState().setAvailableFiles([selectedFile]);
      useAssetsStore.getState().setSelectedFile(selectedFile);
      useAssetsStore.getState().setAllFileContents({
        [selectedFile.name]: selectedFile.content,
      });
      useAssetsStore.getState().setDocumentLoadState({
        status: 'ready',
        fileName: selectedFile.name,
        format: 'usd',
        error: null,
      });
      useAssetsStore
        .getState()
        .setUsdPreparedExportCache(
          '/robots/demo/demo.usd',
          createPreparedUsdExportCache('/robots/demo/demo.usd'),
        );

      installExportTestRobot(createCurrentRobot());

      const rendered = renderHook();

      try {
        const result = await rendered.hook.handleExportWithConfig(createUsdExportConfig(), {
          type: 'current',
        });

        assert.deepEqual(result, {
          partial: false,
          warnings: [],
          issues: [],
        });
        assert.equal(workerMocks.usdExportRequestCount, 1);
        assert.equal(workerMocks.usdBinaryRequestCount, 1);
        assert.equal(liveStageExport.callCount, 0);
        assert.ok(downloadMocks.clicked);
        assert.equal(downloadMocks.appendedAnchor?.download, 'demo_usd.zip');
        assert.ok(downloadMocks.capturedBlob);
      } finally {
        rendered.cleanup();
      }
    } finally {
      liveStageExport.restore();
    }
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 0));
    workerMocks.restore();
    downloadMocks.restore();
    domEnvironment.restore();
  }
});

test('useFileExport rejects current USD export when only the viewer runtime export handler is available', async () => {
  resetStoresToBaseline();
  const domEnvironment = installDomEnvironment();
  const downloadMocks = installDownloadMocks();
  const workerMocks = installUsdExportPipelineWorkerMock();

  try {
    const liveStageExport = installLiveStageExportMock(async () => ({
      ok: true,
      content: '#usda 1.0\n',
    }));

    try {
      const selectedFile: RobotFile = {
        name: 'robots/demo/demo.usd',
        format: 'usd',
        content: '#usda 1.0\n',
      };

      useUIStore.setState({
        lang: 'en',
        appMode: 'editor',
      });

      useAssetsStore.getState().setAvailableFiles([selectedFile]);
      useAssetsStore.getState().setSelectedFile(selectedFile);
      useAssetsStore.getState().setAllFileContents({
        [selectedFile.name]: selectedFile.content,
      });
      useAssetsStore.getState().setDocumentLoadState({
        status: 'ready',
        fileName: selectedFile.name,
        format: 'usd',
        error: null,
      });

      installExportTestRobot(createCurrentRobot());

      const rendered = renderHook();

      try {
        await assert.rejects(
          rendered.hook.handleExportWithConfig(createUsdExportConfig(), {
            type: 'current',
          }),
          /USD export is not ready yet/i,
        );
        assert.equal(workerMocks.usdExportRequestCount, 0);
        assert.equal(workerMocks.usdBinaryRequestCount, 0);
        assert.equal(liveStageExport.callCount, 0);
        assert.equal(downloadMocks.clicked, false);
        assert.equal(downloadMocks.capturedBlob, null);
      } finally {
        rendered.cleanup();
      }
    } finally {
      liveStageExport.restore();
    }
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 0));
    workerMocks.restore();
    downloadMocks.restore();
    domEnvironment.restore();
  }
});

test('missing USD prepared cache does not block canonical URDF projection export', async () => {
  resetStoresToBaseline();
  const domEnvironment = installDomEnvironment();
  const downloadMocks = installDownloadMocks();
  try {
    const selectedFile: RobotFile = {
      name: 'robots/demo/demo.usd',
      format: 'usd',
      content: '#usda 1.0\n',
    };
    useAssetsStore.getState().setAvailableFiles([selectedFile]);
    useAssetsStore.getState().setSelectedFile(selectedFile);
    installExportTestRobot(createCurrentRobot());
    const rendered = renderHook();
    try {
      const config = createUsdExportConfig();
      config.format = 'urdf';
      const result = await rendered.hook.handleExportWithConfig(config);
      assert.deepEqual(result, { partial: false, warnings: [], issues: [] });
      assert.equal(downloadMocks.clicked, true);
      assert.equal(downloadMocks.appendedAnchor?.download, 'demo_urdf.zip');
    } finally {
      rendered.cleanup();
    }
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 0));
    downloadMocks.restore();
    domEnvironment.restore();
  }
});

test('hidden USD component without cache does not block visible workspace USD export', async () => {
  resetStoresToBaseline();
  const domEnvironment = installDomEnvironment();
  const downloadMocks = installDownloadMocks();
  const workerMocks = installUsdExportPipelineWorkerMock();
  try {
    const visibleFile: RobotFile = {
      name: 'robots/visible.urdf',
      format: 'urdf',
      content: '<robot name="visible"><link name="base_link" /></robot>',
    };
    const hiddenUsdFile: RobotFile = {
      name: 'robots/hidden.usd',
      format: 'usd',
      content: '#usda 1.0\n',
    };
    useAssetsStore.getState().setAvailableFiles([visibleFile, hiddenUsdFile]);
    useAssetsStore.getState().setSelectedFile(visibleFile);
    installExportTestRobot(createCurrentRobot());
    const workspace = structuredClone(useWorkspaceStore.getState().workspace);
    workspace.components.hidden = createSingleComponentWorkspace(
      createPreparedUsdExportCache(hiddenUsdFile.name).robotData,
      {
        componentId: 'hidden',
        sourceFile: hiddenUsdFile.name,
        visible: false,
      },
    ).components.hidden;
    installExportTestWorkspace(workspace);

    const rendered = renderHook();
    try {
      const result = await rendered.hook.handleExportWithConfig(createUsdExportConfig());
      assert.deepEqual(result, { partial: false, warnings: [], issues: [] });
      assert.equal(workerMocks.usdExportRequestCount, 1);
      assert.equal(downloadMocks.clicked, true);
    } finally {
      rendered.cleanup();
    }
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 0));
    workerMocks.restore();
    downloadMocks.restore();
    domEnvironment.restore();
  }
});

test('library USD export uses its own prepared cache independent of current workspace', async () => {
  resetStoresToBaseline();
  const domEnvironment = installDomEnvironment();
  const downloadMocks = installDownloadMocks();
  const workerMocks = installUsdExportPipelineWorkerMock();
  try {
    const libraryFile: RobotFile = {
      name: 'library/standalone.usd',
      format: 'usd',
      content: '#usda 1.0\n',
    };
    useAssetsStore.getState().setAvailableFiles([libraryFile]);
    useAssetsStore.getState().setUsdPreparedExportCache(
      libraryFile.name,
      createPreparedUsdExportCache(libraryFile.name),
    );
    installExportTestRobot(createCurrentRobot());
    const rendered = renderHook();
    try {
      const result = await rendered.hook.handleExportWithConfig(
        createUsdExportConfig(),
        { type: 'library-file', file: libraryFile },
      );
      assert.deepEqual(result, { partial: false, warnings: [], issues: [] });
      assert.equal(workerMocks.usdExportRequestCount, 1);
      assert.equal(downloadMocks.appendedAnchor?.download, 'standalone_usd.zip');
    } finally {
      rendered.cleanup();
    }
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 0));
    workerMocks.restore();
    downloadMocks.restore();
    domEnvironment.restore();
  }
});

test('useFileExport fails fast before starting workers when USD worker export encounters unsupported mesh formats', async () => {
  resetStoresToBaseline();
  const domEnvironment = installDomEnvironment();
  const downloadMocks = installDownloadMocks();
  const workerMocks = installUsdExportPipelineWorkerMock();

  try {
    const selectedFile: RobotFile = {
      name: 'robots/demo/demo.usd',
      format: 'usd',
      content: '#usda 1.0\n',
    };

    useUIStore.setState({
      lang: 'en',
      appMode: 'editor',
    });

    useAssetsStore.getState().setAvailableFiles([selectedFile]);
    useAssetsStore.getState().setSelectedFile(selectedFile);
    useAssetsStore.getState().setAllFileContents({
      [selectedFile.name]: selectedFile.content,
    });
    useAssetsStore.getState().setDocumentLoadState({
      status: 'ready',
      fileName: selectedFile.name,
      format: 'usd',
      error: null,
    });
    useAssetsStore
      .getState()
      .setUsdPreparedExportCache(
        '/robots/demo/demo.usd',
        createPreparedUsdExportCache('/robots/demo/demo.usd', 'meshes/base_link.fbx'),
      );

    installExportTestRobot(createCurrentRobot('meshes/base_link.fbx'));

    const rendered = renderHook();

    try {
      await assert.rejects(
        rendered.hook.handleExportWithConfig(createUsdExportConfig(), { type: 'current' }),
        /USD export worker currently supports OBJ\/STL\/DAE\/GLTF\/GLB mesh assets only/i,
      );

      assert.equal(workerMocks.usdExportRequestCount, 0);
      assert.equal(workerMocks.usdBinaryRequestCount, 0);
      assert.equal(downloadMocks.clicked, false);
      assert.equal(downloadMocks.capturedBlob, null);
    } finally {
      rendered.cleanup();
    }
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 0));
    workerMocks.restore();
    downloadMocks.restore();
    domEnvironment.restore();
  }
});
