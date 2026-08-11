/// <reference lib="webworker" />

import * as THREE from 'three';

import type { RobotFile, UsdSceneSnapshot } from '@/types';
import { UsdFsHelper } from '../../../features/urdf-viewer/runtime/viewer/usd-fs.js';
import { loadUsdStage } from '../../../features/urdf-viewer/runtime/viewer/usd-loader-runtime';
import { loadVirtualFile } from '../../../features/urdf-viewer/runtime/viewer/upload-workflow.js';
import { applyMeshVisibilityFilters } from '../../../features/urdf-viewer/runtime/viewer/visibility.js';
import { adaptUsdViewerSnapshotToRobotData } from './usdViewerRobotAdapter';
import { setUsdBindingsBaseUrl } from './usdBindingsAssetPaths';
import { prepareUsdStageOpenDataCore } from './usdStageOpenPreparationCore';
import { normalizeUsdSceneSnapshotToMeters } from './usdStageUnits';
import { assertUsdSceneSnapshotIntegrity } from './usdSceneSnapshotIntegrity';
import { createEmbeddedUsdViewerLoadParams } from './usdViewerRenderParams';
import { toVirtualUsdPath } from './usdPreloadSources';
import {
  disposeUsdDriver,
  ensureUsdWasmRuntimeFromModules,
  type UsdWasmRuntime,
} from './usdWasmRuntime';
import type { ViewerRobotDataResolution } from './viewerRobotData';

interface ParseSceneRequest {
  type: 'parse-scene';
  requestId: number;
  content: string;
  fileName: string;
  availableFiles: Array<Pick<RobotFile, 'name' | 'content' | 'blobUrl' | 'format'>>;
  assets: Record<string, string>;
  sourceBlobUrl?: string;
  wasmBaseUrl?: string;
}

interface CancelSceneRequest {
  type: 'cancel';
  requestId: number;
}

interface UsdWorkerRenderInterface {
  dispose?: () => void;
  warmupRobotSceneSnapshotFromDriver?: (driver: unknown, options?: unknown) => void;
  getCachedRobotSceneSnapshot?: (path?: string | null) => unknown;
}

let scene: THREE.Scene;
let usdRoot: THREE.Group;
let renderer: THREE.WebGLRenderer;
let initialized = false;
let parseQueue: Promise<void> = Promise.resolve();
const queuedRequestIds = new Set<number>();
const cancelledRequestIds = new Set<number>();

function initializeSceneGraph(): void {
  const canvas = new OffscreenCanvas(256, 256);
  scene = new THREE.Scene();
  usdRoot = new THREE.Group();
  usdRoot.name = 'USD Runtime Worker Root';
  scene.add(usdRoot);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  const scope = globalThis as Record<string, unknown>;
  scope.window = globalThis;
  scope.scene = scene;
  scope.usdRoot = usdRoot;
  scope.camera = camera;
  scope.renderer = renderer;
  scope._controls = { target: new THREE.Vector3(), update: () => false };
  initialized = true;
}

function writeUsdBytesToVirtualPath(
  runtime: UsdWasmRuntime,
  virtualPath: string,
  bytes: Uint8Array,
): boolean {
  if (!runtime.usdFsHelper.canOperateOnUsdFilesystem()) return false;
  const normalized = toVirtualUsdPath(virtualPath);
  const lastSlash = normalized.lastIndexOf('/');
  const directory = lastSlash >= 0 ? normalized.slice(0, lastSlash + 1) : '/';
  if (typeof runtime.USD.FS_createPath !== 'function') return false;
  if (typeof runtime.USD.FS_writeFile !== 'function') return false;
  runtime.USD.FS_createPath('', directory, true, true);
  try {
    runtime.USD.FS_writeFile(normalized, bytes);
    runtime.usdFsHelper.trackVirtualFilePath?.(normalized);
    return runtime.usdFsHelper.hasVirtualFilePath(normalized);
  } catch {
    return false;
  }
}

function toUint8(bytes: unknown): Uint8Array | null {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  return null;
}

function collectSnapshotTransferables(snapshot: UsdSceneSnapshot): Transferable[] {
  const buffers = snapshot.buffers;
  const candidates = [
    buffers?.positions,
    buffers?.indices,
    buffers?.normals,
    buffers?.uvs,
    buffers?.transforms,
  ];
  const result = new Set<ArrayBuffer>();
  candidates.forEach((candidate) => {
    if (ArrayBuffer.isView(candidate) && candidate.buffer instanceof ArrayBuffer) {
      result.add(candidate.buffer);
    }
  });
  return Array.from(result);
}

function disposeWorkerStage(runtime: UsdWasmRuntime, driver: unknown): void {
  const scope = globalThis as Record<string, unknown>;
  const renderInterface = scope.renderInterface as UsdWorkerRenderInterface | undefined;
  renderInterface?.dispose?.();
  disposeUsdDriver(runtime, driver);
  usdRoot.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.filter(Boolean).forEach((material) => material.dispose());
  });
  usdRoot.clear();
  runtime.usdFsHelper.clearStageFiles(usdRoot);
  scope.renderInterface = undefined;
  scope.driver = undefined;
  scope.usdStage = undefined;
}

async function parseSceneInWorker(request: ParseSceneRequest): Promise<{
  resolution: ViewerRobotDataResolution;
  snapshot: UsdSceneSnapshot;
}> {
  const isRequestActive = () => !cancelledRequestIds.has(request.requestId);
  const assertRequestActive = () => {
    if (!isRequestActive()) {
      throw new DOMException('USD runtime load aborted', 'AbortError');
    }
  };
  if (!initialized) initializeSceneGraph();
  setUsdBindingsBaseUrl(request.wasmBaseUrl ?? null);
  const runtime = await ensureUsdWasmRuntimeFromModules({
    UsdFsHelper,
    loadVirtualFile,
    loadUsdStage,
    applyMeshVisibilityFilters,
  });

  const sourceFile: Pick<RobotFile, 'name' | 'content' | 'blobUrl'> = {
    name: request.fileName,
    content: request.content,
    blobUrl:
      request.sourceBlobUrl ??
      request.assets[request.fileName] ??
      request.assets[toVirtualUsdPath(request.fileName)],
  };
  const prepared = await prepareUsdStageOpenDataCore(
    sourceFile,
    request.availableFiles,
    request.assets,
  );
  assertRequestActive();
  for (const entry of prepared.preloadFiles) {
    assertRequestActive();
    const bytes = toUint8(entry.bytes);
    if (bytes) writeUsdBytesToVirtualPath(runtime, entry.path, bytes);
  }

  const params = createEmbeddedUsdViewerLoadParams(runtime.threadCount, {
    preferWorkerResolvedRobotData: true,
    dependenciesPreloadedToVirtualFs: true,
    // A USD can be a complete, renderable scene without articulation or
    // dynamics metadata. The baked snapshot remains strict; the adapter below
    // owns synthesizing a canonical single-root runtime for that scene.
    allowIncompleteWorkerRobotMetadata: true,
  });

  let driver: unknown = null;
  try {
    const loadState = await runtime.loadUsdStage({
      USD: runtime.USD,
      usdFsHelper: runtime.usdFsHelper,
      displayName: request.fileName,
      pathToLoad: prepared.stageSourcePath,
      params,
      isLoadActive: isRequestActive,
      onResolvedFilename: () => {},
      applyMeshFilters: () => {},
      rebuildLinkAxes: () => {},
      renderFrame: () => {},
      onProgress: (progress) => {
        if (!isRequestActive()) return;
        workerScope.postMessage({
          type: 'progress',
          requestId: request.requestId,
          progress,
        });
      },
    });
    assertRequestActive();
    driver = loadState?.driver ?? null;
    if (!loadState?.ready || loadState.drawFailed) {
      throw new Error(
        `USD stage did not become ready (${loadState?.drawFailureReason || 'unknown failure'})`,
      );
    }

    const scope = globalThis as Record<string, unknown>;
    const renderInterface = scope.renderInterface as UsdWorkerRenderInterface | undefined;
    if (!renderInterface) {
      throw new Error('USD runtime did not create a render interface');
    }
    renderInterface.warmupRobotSceneSnapshotFromDriver?.(driver, {
      stageSourcePath: prepared.stageSourcePath,
      force: true,
      emitRobotMetadataEvent: true,
    });
    const rawSnapshot = renderInterface.getCachedRobotSceneSnapshot?.(prepared.stageSourcePath);
    const snapshot = normalizeUsdSceneSnapshotToMeters(
      rawSnapshot && typeof rawSnapshot === 'object' ? (rawSnapshot as UsdSceneSnapshot) : null,
    );
    if (!snapshot) {
      throw new Error('USD stage returned no baked scene snapshot');
    }

    const resolution = adaptUsdViewerSnapshotToRobotData(snapshot, {
      fileName: request.fileName,
    });
    if (!resolution) {
      throw new Error('USD scene contains no resolvable robot or scene hierarchy');
    }
    assertUsdSceneSnapshotIntegrity(snapshot, resolution);
    resolution.usdBakedScene = snapshot;
    resolution.usdSceneSnapshot = snapshot;
    return { resolution, snapshot };
  } finally {
    disposeWorkerStage(runtime, driver);
  }
}

declare const self: DedicatedWorkerGlobalScope;
const workerScope = self;

workerScope.onmessage = (event: MessageEvent<ParseSceneRequest | CancelSceneRequest>) => {
  const request = event.data;
  if (request.type === 'cancel') {
    if (queuedRequestIds.has(request.requestId)) {
      cancelledRequestIds.add(request.requestId);
    }
    return;
  }
  if (request.type !== 'parse-scene') return;

  queuedRequestIds.add(request.requestId);
  parseQueue = parseQueue
    .catch(() => {})
    .then(async () => {
      try {
        if (cancelledRequestIds.has(request.requestId)) return;
        const result = await parseSceneInWorker(request);
        if (cancelledRequestIds.has(request.requestId)) return;
        workerScope.postMessage(
          {
            type: 'scene',
            requestId: request.requestId,
            resolution: result.resolution,
            snapshot: result.snapshot,
          },
          collectSnapshotTransferables(result.snapshot),
        );
      } catch (error) {
        if (cancelledRequestIds.has(request.requestId)) return;
        workerScope.postMessage({
          type: 'error',
          requestId: request.requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        queuedRequestIds.delete(request.requestId);
        cancelledRequestIds.delete(request.requestId);
      }
    });
};
