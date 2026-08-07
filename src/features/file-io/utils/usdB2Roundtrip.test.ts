import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';

import { parseURDF } from '@/core/parsers/urdf/parser';
import { computeLinkWorldMatrices } from '@/core/robot/kinematics';
import { buildColladaRootNormalizationHints } from '@/core/loaders/colladaRootNormalization';
import { disposeColladaParseWorkerPoolClient } from '@/core/loaders/colladaParseWorkerBridge';
import {
  createSceneFromSerializedColladaData,
  parseColladaSceneData,
} from '@/core/loaders/colladaWorkerSceneData';
import type { RobotData, RobotState } from '@/types';
import { adaptUsdViewerSnapshotToRobotData } from '@/features/urdf-viewer/utils/usdViewerRobotAdapter';
import { ThreeRenderDelegateCore } from '@/features/urdf-viewer/runtime/hydra/render-delegate/ThreeRenderDelegateCore.js';
import { createUsdAssetRegistry } from './usdAssetRegistry';
import { exportRobotToUsd } from './usdExport';
import { buildUsdVisualSceneNode } from './usdSceneNodeFactory';

const B2_DESCRIPTION_ROOT = path.resolve('test/unitree_ros/robots/b2_description');
const B2_URDF_PATH = path.join(B2_DESCRIPTION_ROOT, 'urdf/b2_description.urdf');
const B2_USDA_ROOT = path.resolve('test/unitree_ros_usda/b2_description/urdf');
const B2_USDA_PATH = path.join(B2_USDA_ROOT, 'b2_description.usda');
const B2_USDA_BASE_PATH = path.join(B2_USDA_ROOT, 'configuration/b2_description_base.usda');
const B2_USDA_PHYSICS_PATH = path.join(B2_USDA_ROOT, 'configuration/b2_description_physics.usda');
const B2_USDA_SENSOR_PATH = path.join(B2_USDA_ROOT, 'configuration/b2_description_sensor.usda');

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;
globalThis.ProgressEvent = dom.window.ProgressEvent as typeof ProgressEvent;

type WorkerMessageHandler = (event: { data?: unknown; error?: unknown; message?: string }) => void;

class FakeColladaWorker {
  private readonly listeners = new Map<string, Set<WorkerMessageHandler>>();

  addEventListener(type: string, handler: WorkerMessageHandler): void {
    const handlers = this.listeners.get(type) ?? new Set<WorkerMessageHandler>();
    handlers.add(handler);
    this.listeners.set(type, handlers);
  }

  removeEventListener(type: string, handler: WorkerMessageHandler): void {
    this.listeners.get(type)?.delete(handler);
  }

  postMessage(message: unknown): void {
    const request = message as { type?: string; assetUrl?: string; requestId?: number };
    if (
      request?.type !== 'parse-collada' ||
      !request.assetUrl ||
      !Number.isFinite(request.requestId)
    ) {
      return;
    }

    const assetUrl = request.assetUrl;
    const requestId = request.requestId;
    void (async () => {
      try {
        const response = await fetch(assetUrl);
        if (!response.ok) {
          throw new Error(
            `Failed to fetch Collada asset: ${response.status} ${response.statusText}`,
          );
        }

        const colladaText = await response.text();
        const result = withSuppressedColladaConsole(() =>
          parseColladaSceneData(colladaText, assetUrl),
        );
        this.emitMessage({
          type: 'parse-collada-result',
          requestId,
          result,
        });
      } catch (error) {
        const workerError = error instanceof Error ? error : new Error(String(error));
        this.emitMessage({
          type: 'parse-collada-error',
          requestId: request.requestId,
          error: workerError.message,
        });
      }
    })();
  }

  terminate(): void {}

  private emitMessage(data: unknown): void {
    this.listeners.get('message')?.forEach((handler) => {
      handler({ data });
    });
  }
}

function withSuppressedColladaConsole<T>(run: () => T): T {
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const isColladaNoise = (value: unknown) => String(value || '').includes('THREE.ColladaLoader');

  console.log = (...args: unknown[]) => {
    if (!isColladaNoise(args[0])) {
      originalLog(...args);
    }
  };
  console.info = (...args: unknown[]) => {
    if (!isColladaNoise(args[0])) {
      originalInfo(...args);
    }
  };
  console.warn = (...args: unknown[]) => {
    if (!isColladaNoise(args[0])) {
      originalWarn(...args);
    }
  };

  try {
    return run();
  } finally {
    console.log = originalLog;
    console.info = originalInfo;
    console.warn = originalWarn;
  }
}

function loadB2RobotState(): RobotState {
  const source = fs.readFileSync(B2_URDF_PATH, 'utf8');
  const robot = parseURDF(source);
  assert.ok(robot, 'expected b2 URDF to parse');
  return robot;
}

function buildB2AssetMap(): Record<string, string> {
  const assets: Record<string, string> = {};
  const meshDirectory = path.join(B2_DESCRIPTION_ROOT, 'meshes');

  for (const fileName of fs.readdirSync(meshDirectory)) {
    const absolutePath = path.join(meshDirectory, fileName);
    if (!fs.statSync(absolutePath).isFile()) continue;

    const extension = path.extname(absolutePath).toLowerCase();
    const mimeType =
      extension === '.dae'
        ? 'text/xml'
        : extension === '.png'
          ? 'image/png'
          : extension === '.jpg' || extension === '.jpeg'
            ? 'image/jpeg'
            : 'application/octet-stream';
    const dataUrl = `data:${mimeType};base64,${fs.readFileSync(absolutePath).toString('base64')}`;

    [
      `package://b2_description/meshes/${fileName}`,
      `b2_description/meshes/${fileName}`,
      `meshes/${fileName}`,
      fileName,
    ].forEach((key) => {
      assets[key] = dataUrl;
    });
  }

  return assets;
}

async function withSuppressedColladaLogs<T>(run: () => Promise<T>): Promise<T> {
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const isColladaNoise = (value: unknown) => String(value || '').includes('THREE.ColladaLoader');

  console.log = (...args: unknown[]) => {
    if (!isColladaNoise(args[0])) {
      originalLog(...args);
    }
  };
  console.info = (...args: unknown[]) => {
    if (!isColladaNoise(args[0])) {
      originalInfo(...args);
    }
  };
  console.warn = (...args: unknown[]) => {
    if (!isColladaNoise(args[0])) {
      originalWarn(...args);
    }
  };

  try {
    return await run();
  } finally {
    console.log = originalLog;
    console.info = originalInfo;
    console.warn = originalWarn;
  }
}

function createRoundtripMetadataSnapshot(
  stageSourcePath: string,
  layers: {
    rootLayer: string;
    baseLayer: string;
    physicsLayer: string;
    sensorLayer: string;
  },
  runtimeMeshPrimPaths: {
    visualByMeshId?: Record<string, string>;
    collisionByMeshId?: Record<string, string>;
  } = {},
) {
  const previousWindow = globalThis.window;
  globalThis.window = { driver: null } as Window & typeof globalThis;

  try {
    const delegate = Object.create(ThreeRenderDelegateCore.prototype) as ThreeRenderDelegateCore & {
      meshes: Record<string, object>;
      getResolvedVisualTransformPrimPathForMeshId: (meshId: string) => string | null;
      getResolvedPrimPathForMeshId: (meshId: string) => string | null;
      getStage: () => {
        GetRootLayer(): { ExportToString(): string };
        GetUsedLayers(): Array<{ ExportToString(): string }>;
      };
    };

    delegate.meshes = Object.fromEntries([
      ...Object.keys(runtimeMeshPrimPaths.visualByMeshId || {}).map((meshId) => [meshId, {}]),
      ...Object.keys(runtimeMeshPrimPaths.collisionByMeshId || {}).map((meshId) => [meshId, {}]),
    ]);
    delegate._protoMeshMetadataByMeshId = new Map();
    delegate._robotMetadataSnapshotByStageSource = new Map();
    delegate._robotMetadataBuildPromisesByStageSource = new Map();
    delegate._nowPerfMs = () => 1234;
    delegate.getNormalizedStageSourcePath = () => stageSourcePath;
    delegate.getResolvedVisualTransformPrimPathForMeshId = (meshId: string) =>
      runtimeMeshPrimPaths.visualByMeshId?.[meshId] || null;
    delegate.getResolvedPrimPathForMeshId = (meshId: string) =>
      runtimeMeshPrimPaths.collisionByMeshId?.[meshId] || null;
    delegate.getStage = () => ({
      GetRootLayer() {
        return {
          ExportToString() {
            return layers.rootLayer;
          },
        };
      },
      GetUsedLayers() {
        return [
          {
            ExportToString() {
              return layers.baseLayer;
            },
          },
          {
            ExportToString() {
              return layers.physicsLayer;
            },
          },
          {
            ExportToString() {
              return layers.sensorLayer;
            },
          },
        ];
      },
    });

    return delegate.buildRobotMetadataSnapshotForStage(stageSourcePath, null);
  } finally {
    globalThis.window = previousWindow;
  }
}

function createViewerSnapshotFromMetadata(
  stageSourcePath: string,
  metadata: ReturnType<typeof createRoundtripMetadataSnapshot>,
) {
  return {
    stageSourcePath,
    stage: { defaultPrimPath: '/b2_description' },
    robotMetadataSnapshot: metadata,
    robotTree: {
      linkParentPairs: metadata.linkParentPairs,
      jointCatalogEntries: metadata.jointCatalogEntries,
      rootLinkPaths: [],
    },
    physics: {
      linkDynamicsEntries: metadata.linkDynamicsEntries,
    },
    render: {
      meshDescriptors: [],
      materials: [],
    },
  };
}

function buildWorldMatricesByLinkName(robot: RobotState): Record<string, number[]> {
  const linkWorldMatrices = computeLinkWorldMatrices(robot);
  return Object.fromEntries(
    Object.values(robot.links)
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((link) => {
        const matrix = linkWorldMatrices[link.id];
        assert.ok(matrix, `expected world matrix for link "${link.name}"`);
        return [link.name, matrix.elements.slice()];
      }),
  );
}

function extractUsdPrimBlock(source: string, marker: string): string {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `expected to find USD prim marker: ${marker}`);

  const openBraceIndex = source.indexOf('{', start);
  assert.notEqual(openBraceIndex, -1, `expected USD prim to contain an opening brace: ${marker}`);

  let depth = 0;
  let inString = false;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    const character = source[index];
    const previousCharacter = index > 0 ? source[index - 1] : '';

    if (character === '"' && previousCharacter !== '\\') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (character === '{') {
      depth += 1;
      continue;
    }

    if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  assert.fail(`expected USD prim block to close cleanly: ${marker}`);
}

function assertWorldTransformsMatch(label: string, source: RobotState, target: RobotState) {
  const sourceMatrices = buildWorldMatricesByLinkName(source);
  const targetMatrices = buildWorldMatricesByLinkName(target);

  assert.deepEqual(
    Object.keys(targetMatrices),
    Object.keys(sourceMatrices),
    `${label} should keep the same link set`,
  );

  for (const [linkName, sourceElements] of Object.entries(sourceMatrices)) {
    const targetElements = targetMatrices[linkName];
    assert.ok(targetElements, `${label} should keep world transform for ${linkName}`);

    const maxDelta = sourceElements.reduce((currentMax, sourceValue, index) => {
      return Math.max(currentMax, Math.abs(sourceValue - (targetElements[index] ?? 0)));
    }, 0);
    assert.ok(
      maxDelta <= 1e-5,
      `${label} should preserve link world transforms for ${linkName} (max delta ${maxDelta})`,
    );
  }
}

function toRobotState(robot: RobotData | RobotState): RobotState {
  if ('selection' in robot) {
    return robot;
  }

  return {
    ...robot,
    selection: { type: null, id: null },
  };
}

test('b2 USDA roundtrip preserves the full hierarchy and world transforms', () => {
  const robot = loadB2RobotState();
  const rootLayerText = fs.readFileSync(B2_USDA_PATH, 'utf8');
  const baseLayerText = fs.readFileSync(B2_USDA_BASE_PATH, 'utf8');
  const physicsLayerText = fs.readFileSync(B2_USDA_PHYSICS_PATH, 'utf8');
  const sensorLayerText = fs.readFileSync(B2_USDA_SENSOR_PATH, 'utf8');
  const stageSourcePath = '/test/unitree_ros_usda/b2_description/urdf/b2_description.usda';

  const metadata = createRoundtripMetadataSnapshot(stageSourcePath, {
    rootLayer: rootLayerText,
    baseLayer: baseLayerText,
    physicsLayer: physicsLayerText,
    sensorLayer: sensorLayerText,
  });

  assert.equal(metadata.source, 'usd-stage');
  assert.equal(metadata.jointCatalogEntries.length, Object.keys(robot.joints).length);
  assert.equal(metadata.linkParentPairs.length, Object.keys(robot.links).length - 1);

  const adapted = adaptUsdViewerSnapshotToRobotData(
    createViewerSnapshotFromMetadata(stageSourcePath, metadata),
  );

  assert.ok(adapted, 'expected B2 USD snapshot to adapt back into robot data');
  if (!adapted) {
    return;
  }

  assert.equal(Object.keys(adapted.robotData.links).length, Object.keys(robot.links).length);
  assert.equal(Object.keys(adapted.robotData.joints).length, Object.keys(robot.joints).length);
  assert.equal(adapted.robotData.rootLinkId, robot.rootLinkId);
  assert.equal(adapted.robotData.links.usd_scene_root, undefined);

  assertWorldTransformsMatch('B2 USD roundtrip', robot, toRobotState(adapted.robotData));
});

test('b2 USD export preserves Collada calf geometry placement while normalizing its cyclic root transform', async () => {
  const robot = loadB2RobotState();
  const calfVisual = robot.links.FL_calf?.visual;
  assert.ok(calfVisual, 'expected B2 FL calf visual');

  const calfMeshPath = path.join(B2_DESCRIPTION_ROOT, 'meshes/FL_calf.dae');
  const rawSceneData = parseColladaSceneData(fs.readFileSync(calfMeshPath, 'utf8'), calfMeshPath);
  const expectedScene = createSceneFromSerializedColladaData(rawSceneData);
  const expectedBounds = new THREE.Box3().setFromObject(expectedScene);

  const { registry } = createUsdAssetRegistry(buildB2AssetMap());
  const exportedNode = await buildUsdVisualSceneNode({
    visual: calfVisual,
    role: 'visual',
    registry,
    colladaRootNormalizationHints: buildColladaRootNormalizationHints(robot.links),
  });
  assert.ok(exportedNode, 'expected B2 FL calf visual to build for USD export');

  const exportedBounds = new THREE.Box3().setFromObject(exportedNode);
  const expectedCenter = expectedBounds.getCenter(new THREE.Vector3());
  const exportedCenter = exportedBounds.getCenter(new THREE.Vector3());
  const expectedSize = expectedBounds.getSize(new THREE.Vector3());
  const exportedSize = exportedBounds.getSize(new THREE.Vector3());

  assert.ok(
    exportedCenter.distanceTo(expectedCenter) <= 1e-6,
    `expected calf center ${expectedCenter.toArray()} after export normalization, got ${exportedCenter.toArray()}`,
  );
  assert.ok(
    exportedSize.distanceTo(expectedSize) <= 1e-6,
    `expected calf size ${expectedSize.toArray()} after export normalization, got ${exportedSize.toArray()}`,
  );
  assert.ok(exportedCenter.z < -0.1, 'expected B2 calf geometry to extend down the link Z axis');
});

test('b2 USD export preserves the mirrored RR hip Collada geometry', async () => {
  const robot = loadB2RobotState();
  const hipVisual = robot.links.RR_hip?.visual;
  assert.ok(hipVisual, 'expected B2 RR hip visual');

  const hipMeshPath = path.join(B2_DESCRIPTION_ROOT, 'meshes/RR_hip.dae');
  const rawSceneData = parseColladaSceneData(fs.readFileSync(hipMeshPath, 'utf8'), hipMeshPath);
  const expectedScene = createSceneFromSerializedColladaData(rawSceneData);
  const expectedBounds = new THREE.Box3().setFromObject(expectedScene);

  const { registry } = createUsdAssetRegistry(buildB2AssetMap());
  const exportedNode = await buildUsdVisualSceneNode({
    visual: hipVisual,
    role: 'visual',
    registry,
    colladaRootNormalizationHints: buildColladaRootNormalizationHints(robot.links),
  });
  assert.ok(exportedNode, 'expected B2 RR hip visual to build for USD export');

  const exportedBounds = new THREE.Box3().setFromObject(exportedNode);
  const expectedCenter = expectedBounds.getCenter(new THREE.Vector3());
  const exportedCenter = exportedBounds.getCenter(new THREE.Vector3());
  const expectedSize = expectedBounds.getSize(new THREE.Vector3());
  const exportedSize = exportedBounds.getSize(new THREE.Vector3());

  assert.ok(
    exportedCenter.distanceTo(expectedCenter) <= 1e-6,
    `expected RR hip center ${expectedCenter.toArray()}, got ${exportedCenter.toArray()}`,
  );
  assert.ok(
    exportedSize.distanceTo(expectedSize) <= 1e-6,
    `expected RR hip size ${expectedSize.toArray()}, got ${exportedSize.toArray()}`,
  );
  assert.ok(exportedCenter.x > 0, 'expected RR hip mesh to preserve its rear mirrored X offset');
  assert.ok(exportedCenter.y > 0, 'expected RR hip mesh to preserve its right-side Y offset');
});

test('b2 isaacsim USD export roundtrip preserves transforms and writes joint/material metadata', async () => {
  const robot = loadB2RobotState();
  const assets = buildB2AssetMap();
  const originalWorker = globalThis.Worker;

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: FakeColladaWorker,
  });

  try {
    const payload = await withSuppressedColladaLogs(() =>
      exportRobotToUsd({
        robot,
        exportName: 'b2_description',
        assets,
        layoutProfile: 'isaacsim',
      }),
    );

    const rootLayerText =
      (await payload.archiveFiles.get('b2_description/b2_description.usd')?.text()) || '';
    const baseLayerText =
      (await payload.archiveFiles
        .get('b2_description/configuration/b2_description_base.usd')
        ?.text()) || '';
    const physicsLayerText =
      (await payload.archiveFiles
        .get('b2_description/configuration/b2_description_physics.usd')
        ?.text()) || '';
    const sensorLayerText =
      (await payload.archiveFiles
        .get('b2_description/configuration/b2_description_sensor.usd')
        ?.text()) || '';

    assert.ok(rootLayerText, 'expected current B2 USD root layer to exist');
    assert.ok(baseLayerText, 'expected current B2 USD base layer to exist');
    assert.ok(physicsLayerText, 'expected current B2 USD physics layer to exist');
    assert.ok(sensorLayerText, 'expected current B2 USD sensor layer to exist');

    const baseLinkBlock = extractUsdPrimBlock(baseLayerText, 'def Xform "base_link"');
    const baseVisualBlock = extractUsdPrimBlock(baseLinkBlock, 'def Xform "visual_0"');
    const baseVisualMaterialBindings = Array.from(
      baseVisualBlock.matchAll(/rel material:binding = <\/b2_description\/Looks\/(Material_\d+)>/g),
      (match) => match[1],
    );

    assert.match(
      physicsLayerText,
      /custom quatf urdf:originQuatWxyz = \(/,
      'expected current B2 USD export to retain authored joint origin quaternions',
    );
    assert.match(
      baseLayerText,
      /rel material:binding = </,
      'expected current B2 USD export to retain material bindings',
    );
    assert.ok(
      Array.from(baseLayerText.matchAll(/def Material "Material_/g)).length >= 6,
      'expected current B2 USD export to preserve B2 multi-material mesh palettes instead of collapsing them to a few uniform preview materials',
    );
    assert.ok(
      baseVisualMaterialBindings.length >= 4,
      `expected B2 base_link visual to keep material subsets within one visual prim, got ${baseVisualMaterialBindings.length}`,
    );
    assert.ok(new Set(baseVisualMaterialBindings).size >= 4);
    assert.match(
      baseLayerText,
      /color3f inputs:diffuseColor = \(1, 1, 1\)/,
      'expected current B2 USD export to preserve the bright logo/submesh material color',
    );
    assert.match(
      baseLayerText,
      /color3f inputs:diffuseColor = \(0, 0, 0\)/,
      'expected current B2 USD export to preserve the dark shell/submesh material color',
    );

    const stageSourcePath = `/${payload.rootLayerPath}`;
    const metadata = createRoundtripMetadataSnapshot(stageSourcePath, {
      rootLayer: rootLayerText,
      baseLayer: baseLayerText,
      physicsLayer: physicsLayerText,
      sensorLayer: sensorLayerText,
    });

    const adapted = adaptUsdViewerSnapshotToRobotData(
      createViewerSnapshotFromMetadata(stageSourcePath, metadata),
    );

    assert.ok(adapted, 'expected current B2 USD export to adapt back into robot data');
    if (!adapted) {
      return;
    }

    assert.equal(Object.keys(adapted.robotData.links).length, Object.keys(robot.links).length);
    assert.equal(Object.keys(adapted.robotData.joints).length, Object.keys(robot.joints).length);
    assert.equal(adapted.robotData.rootLinkId, robot.rootLinkId);
    assert.equal(adapted.robotData.links.usd_scene_root, undefined);
    assertWorldTransformsMatch(
      'B2 current USD export roundtrip',
      robot,
      toRobotState(adapted.robotData),
    );
  } finally {
    disposeColladaParseWorkerPoolClient();
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      writable: true,
      value: originalWorker,
    });
  }
});

test('b2 roundtrip metadata does not promote visual_0 container scopes into fake links when reopening exported USD', async () => {
  const robot = loadB2RobotState();
  const assets = buildB2AssetMap();
  const originalWorker = globalThis.Worker;

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: FakeColladaWorker,
  });

  try {
    const payload = await withSuppressedColladaLogs(() =>
      exportRobotToUsd({
        robot,
        exportName: 'b2_description',
        assets,
        layoutProfile: 'isaacsim',
      }),
    );

    const rootLayerText =
      (await payload.archiveFiles.get('b2_description/b2_description.usd')?.text()) || '';
    const baseLayerText =
      (await payload.archiveFiles
        .get('b2_description/configuration/b2_description_base.usd')
        ?.text()) || '';
    const physicsLayerText =
      (await payload.archiveFiles
        .get('b2_description/configuration/b2_description_physics.usd')
        ?.text()) || '';
    const sensorLayerText =
      (await payload.archiveFiles
        .get('b2_description/configuration/b2_description_sensor.usd')
        ?.text()) || '';

    const stageSourcePath = `/${payload.rootLayerPath}`;
    const metadata = createRoundtripMetadataSnapshot(
      stageSourcePath,
      {
        rootLayer: rootLayerText,
        baseLayer: baseLayerText,
        physicsLayer: physicsLayerText,
        sensorLayer: sensorLayerText,
      },
      {
        visualByMeshId: {
          '/b2_description/base_link/visuals.proto_mesh_id0':
            '/b2_description/base_link/visuals/visual_0/mesh',
        },
      },
    );

    assert.equal(metadata.linkParentPairs.length, Object.keys(robot.links).length - 1);
    assert.equal(metadata.meshCountsByLinkPath['/b2_description/visual_0'], undefined);
    assert.ok(
      !metadata.linkParentPairs.some(
        ([childPath]: [string, string | null]) => childPath === '/b2_description/visual_0',
      ),
      'expected roundtrip metadata to keep visual_0 scoped under base_link instead of promoting it to a link',
    );

    const adapted = adaptUsdViewerSnapshotToRobotData(
      createViewerSnapshotFromMetadata(stageSourcePath, metadata),
    );

    assert.ok(adapted);
    if (!adapted) {
      return;
    }

    assert.equal(adapted.linkIdByPath['/b2_description/visual_0'], undefined);
    assert.equal(adapted.robotData.links.visual_0, undefined);
    assert.ok(
      !Object.keys(adapted.robotData.joints).some((jointId) => jointId === 'visual_0_fixed'),
      'expected reopened USD to omit visual_0_fixed helper joints',
    );
  } finally {
    disposeColladaParseWorkerPoolClient();
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      writable: true,
      value: originalWorker,
    });
  }
});
