import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getRegressionSnapshot,
  installRegressionDebugApi,
  setRegressionAppHandlers,
  setRegressionRuntimeRobot,
} from './regressionBridge';
import { DEFAULT_JOINT, DEFAULT_LINK, type RobotState } from '@/types';

test('getRegressionSnapshot summarizes joint-only runtime proxies without requiring traverse()', () => {
  setRegressionRuntimeRobot({
    name: 'usd-runtime-proxy',
    joints: {
      arm_joint: {
        name: 'arm_joint',
        type: 'revolute',
        jointType: 'revolute',
        angle: Math.PI / 4,
        axis: [0, 0, 1],
        limit: {
          lower: -Math.PI / 2,
          upper: Math.PI / 2,
        },
      },
    },
  });

  const snapshot = getRegressionSnapshot();

  assert.equal(snapshot.runtime?.name, 'usd-runtime-proxy');
  assert.equal(snapshot.runtime?.linkCount, 0);
  assert.equal(snapshot.runtime?.jointCount, 1);
  assert.deepEqual(snapshot.runtime?.joints, [
    {
      name: 'arm_joint',
      type: 'revolute',
      angle: Math.PI / 4,
      axis: [0, 0, 1],
      limit: {
        lower: -Math.PI / 2,
        upper: Math.PI / 2,
      },
    },
  ]);

  setRegressionRuntimeRobot(null);
});

test('regression debug API summarizes USD visual materials from stored scene snapshots', () => {
  setRegressionAppHandlers({
    getAvailableFiles: () => [
      {
        name: 'robots/demo/demo.usd',
        format: 'usd',
        content: '#usda 1.0',
      },
    ],
    getSelectedFile: () => ({
      name: 'robots/demo/demo.usd',
      format: 'usd',
      content: '#usda 1.0',
    }),
    getUsdSceneSnapshot: () => ({
      stageSourcePath: 'robots/demo/demo.usd',
      stage: {
        defaultPrimPath: '/Robot',
      },
      robotTree: {
        rootLinkPaths: ['/Robot/base_link'],
      },
      render: {
        meshDescriptors: [
          {
            meshId: '/Robot/base_link/visuals.proto_mesh_id0',
            resolvedPrimPath: '/Robot/base_link/visuals/body',
            sectionName: 'visuals',
            geometry: {
              geomSubsetSections: [
                { start: 0, length: 3, materialId: '/Robot/Looks/Black' },
                { start: 3, length: 3, materialId: '/Robot/Looks/DarkGray' },
              ],
            },
          },
          {
            meshId: '/Robot/FL_thigh/visuals.proto_mesh_id0',
            resolvedPrimPath: '/Robot/FL_thigh/visuals/thigh/mesh',
            sectionName: 'visuals',
            geometry: {
              geomSubsetSections: [
                { start: 0, length: 3, materialId: '/Robot/Looks/LegShell' },
              ],
            },
          },
        ],
        materials: [
          {
            materialId: '/Robot/Looks/Black',
            name: 'material_______023',
            shaderName: 'UsdPreviewSurface',
            color: [0, 0, 0],
          },
          {
            materialId: '/Robot/Looks/DarkGray',
            name: 'material_______024',
            shaderName: 'UsdPreviewSurface',
            color: [0.035, 0.035, 0.035],
          },
          {
            materialId: '/Robot/Looks/LegShell',
            name: 'material_____________001',
            shaderName: 'UsdPreviewSurface',
            color: [0.671705, 0.692426, 0.77427],
          },
        ],
      },
    }),
    getDocumentLoadState: () => ({
      status: 'ready',
      fileName: 'robots/demo/demo.usd',
      format: 'usd',
      error: null,
    }),
    getRobotState: () => ({
      name: 'demo',
      rootLinkId: 'base_link',
      links: {},
      joints: {},
      selection: { type: null, id: null },
    }),
    getAssetDebugState: () => ({
      appAssetKeys: ['robots/demo/demo.usd'],
      preparedUsdCacheKeysByFile: {},
    }),
    getInteractionState: () => ({
      selection: { type: null, id: null },
      hoveredSelection: { type: null, id: null },
    }),
    loadRobotByName: async (fileName: string) => ({
      loaded: fileName === 'robots/demo/demo.usd',
      selectedFile: fileName,
    }),
  });

  const targetWindow = {} as Window;
  installRegressionDebugApi(targetWindow);

  const summary = targetWindow.__URDF_STUDIO_DEBUG__?.getSelectedUsdVisualMaterialSummary?.();
  assert.deepEqual(summary, {
    meshes: [
      {
        meshId: '/Robot/base_link/visuals.proto_mesh_id0',
        linkPath: '/Robot/base_link',
        overrideColor: null,
        hasOverrideMaterial: false,
        materials: [
          {
            name: 'material_______023',
            type: 'UsdPreviewSurface',
            color: '#000000',
            emissive: null,
          },
          {
            name: 'material_______024',
            type: 'UsdPreviewSurface',
            color: '#090909',
            emissive: null,
          },
        ],
      },
      {
        meshId: '/Robot/FL_thigh/visuals.proto_mesh_id0',
        linkPath: '/Robot/FL_thigh',
        overrideColor: null,
        hasOverrideMaterial: false,
        materials: [
          {
            name: 'material_____________001',
            type: 'UsdPreviewSurface',
            color: '#abb1c5',
            emissive: null,
          },
        ],
      },
    ],
  });

  setRegressionAppHandlers(null);
});

test('regression debug API waits for final USD handoff runtime before resolving bootstrap loads', async () => {
  const fileName = 'robots/demo/demo.usd';
  const targetWindow = {
    __usdStageLoadDebugHistory: [],
  } as unknown as Window & {
    __usdStageLoadDebugHistory: Array<Record<string, unknown>>;
  };
  let documentLoadState = {
    status: 'idle',
    fileName: null,
    format: null,
    error: null,
  } as {
    status: string;
    fileName: string | null;
    format: string | null;
    error: string | null;
  };

  setRegressionRuntimeRobot(null);
  setRegressionAppHandlers({
    getAvailableFiles: () => [
      {
        name: fileName,
        format: 'usd',
        content: '#usda 1.0',
      },
    ],
    getSelectedFile: () => ({
      name: fileName,
      format: 'usd',
      content: '#usda 1.0',
    }),
    getUsdSceneSnapshot: () => null,
    getDocumentLoadState: () => documentLoadState,
    getRobotState: () => ({
      name: 'demo',
      rootLinkId: 'base_link',
      links: {},
      joints: {},
      selection: { type: null, id: null },
    }),
    getAssetDebugState: () => ({
      appAssetKeys: [fileName],
      preparedUsdCacheKeysByFile: {},
    }),
    getInteractionState: () => ({
      selection: { type: null, id: null },
      hoveredSelection: { type: null, id: null },
    }),
    loadRobotByName: async (requestedFileName: string) => {
      documentLoadState = {
        status: 'loading',
        fileName: requestedFileName,
        format: 'usd',
        error: null,
      };
      targetWindow.__usdStageLoadDebugHistory.push({
        sourceFileName: requestedFileName,
        step: 'commit-worker-robot-data',
        status: 'resolved',
        timestamp: Date.now(),
        detail: {
          linkCount: 0,
          jointCount: 0,
        },
      });
      globalThis.setTimeout(() => {
        setRegressionRuntimeRobot({
          name: 'usd-runtime-proxy',
          links: {},
          joints: {},
        });
        targetWindow.__usdStageLoadDebugHistory.push({
          sourceFileName: requestedFileName,
          step: 'resolve-runtime-robot-data',
          status: 'resolved',
          timestamp: Date.now(),
          detail: {},
        });
        documentLoadState = {
          status: 'ready',
          fileName: requestedFileName,
          format: 'usd',
          error: null,
        };
      }, 20);

      return {
        loaded: true,
        selectedFile: requestedFileName,
      };
    },
  });

  installRegressionDebugApi(targetWindow);

  const result = await targetWindow.__URDF_STUDIO_DEBUG__?.loadRobotByName(fileName);

  assert.equal(result?.loaded, true);
  assert.equal(result?.snapshot.runtime?.name, 'usd-runtime-proxy');

  setRegressionRuntimeRobot(null);
  setRegressionAppHandlers(null);
});

test('regression debug API keeps waiting for slow USD hydration beyond twenty seconds', async () => {
  const fileName = 'robots/slow/slow.usda';
  const targetWindow = {
    __usdStageLoadDebugHistory: [],
  } as unknown as Window & {
    __usdStageLoadDebugHistory: Array<Record<string, unknown>>;
  };
  let logicalNow = 0;
  let documentLoadState = {
    status: 'idle',
    fileName: null,
    format: null,
    error: null,
  } as {
    status: string;
    fileName: string | null;
    format: string | null;
    error: string | null;
  };
  let robotState: RobotState = {
    name: 'previous_robot',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
    },
    joints: {},
    selection: { type: null, id: null },
  };
  const originalDateNow = Date.now;
  const originalSetTimeout = globalThis.setTimeout;

  Date.now = () => logicalNow;
  globalThis.setTimeout = ((callback: TimerHandler, timeout?: number, ...args: unknown[]) => {
    logicalNow += Number(timeout ?? 0);
    return originalSetTimeout(callback, 0, ...args);
  }) as typeof globalThis.setTimeout;

  try {
    setRegressionRuntimeRobot(null);
    setRegressionAppHandlers({
      getAvailableFiles: () => [
        {
          name: fileName,
          format: 'usd',
          content: '#usda 1.0',
        },
      ],
      getSelectedFile: () => ({
        name: fileName,
        format: 'usd',
        content: '#usda 1.0',
      }),
      getUsdSceneSnapshot: () => null,
      getDocumentLoadState: () => documentLoadState,
      getRobotState: () => robotState,
      getAssetDebugState: () => ({
        appAssetKeys: [fileName],
        preparedUsdCacheKeysByFile: {},
      }),
      getInteractionState: () => ({
        selection: { type: null, id: null },
        hoveredSelection: { type: null, id: null },
      }),
      loadRobotByName: async (requestedFileName: string) => {
        documentLoadState = {
          status: 'hydrating',
          fileName: requestedFileName,
          format: 'usd',
          error: null,
        };
        globalThis.setTimeout(() => {
          robotState = {
            name: 'slow_usd_robot',
            rootLinkId: 'base',
            links: {
              base: {
                ...DEFAULT_LINK,
                id: 'base',
                name: 'base',
              },
              thigh: {
                ...DEFAULT_LINK,
                id: 'thigh',
                name: 'thigh',
              },
            },
            joints: {
              hip: {
                ...DEFAULT_JOINT,
                id: 'hip',
                name: 'hip',
                parentLinkId: 'base',
                childLinkId: 'thigh',
                origin: {
                  xyz: { x: 0, y: 0, z: 0 },
                  rpy: { r: 0, p: 0, y: 0 },
                },
                axis: { x: 0, y: 0, z: 1 },
              },
            },
            selection: { type: null, id: null },
          };
          targetWindow.__usdStageLoadDebugHistory.push({
            sourceFileName: requestedFileName,
            step: 'commit-worker-robot-data',
            status: 'resolved',
            timestamp: Date.now(),
            detail: {
              linkCount: 2,
              jointCount: 1,
            },
          });
          documentLoadState = {
            status: 'ready',
            fileName: requestedFileName,
            format: 'usd',
            error: null,
          };
        }, 30_000);

        return {
          loaded: true,
          selectedFile: requestedFileName,
        };
      },
    });

    installRegressionDebugApi(targetWindow);

    const result = await targetWindow.__URDF_STUDIO_DEBUG__?.loadRobotByName(fileName);

    assert.equal(result?.loaded, true);
    assert.equal(result?.snapshot.store?.name, 'slow_usd_robot');
    assert.equal(result?.snapshot.store?.linkCount, 2);
    assert.equal(result?.snapshot.store?.jointCount, 1);
  } finally {
    Date.now = originalDateNow;
    globalThis.setTimeout = originalSetTimeout;
    setRegressionRuntimeRobot(null);
    setRegressionAppHandlers(null);
  }
});
