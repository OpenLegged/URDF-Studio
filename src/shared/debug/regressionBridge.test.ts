import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  getRegressionSnapshot,
  installRegressionDebugApi,
  setRegressionAppHandlers,
  setRegressionRuntimeRobot,
} from './regressionBridge';
import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  GeometryType,
  type RobotFile,
  type RobotState,
} from '@/types';
import { setRegressionPrimaryRuntimeRobot } from './regressionState';

test('getRegressionSnapshot tracks primary runtime identity revisions separately', () => {
  const firstRobot = new THREE.Group();
  firstRobot.name = 'first-runtime';
  const secondRobot = new THREE.Group();
  secondRobot.name = 'second-runtime';

  setRegressionPrimaryRuntimeRobot(null);
  const baselineRevision = getRegressionSnapshot().primaryRuntimeRevision;

  setRegressionPrimaryRuntimeRobot(firstRobot);
  const firstRevision = getRegressionSnapshot().primaryRuntimeRevision;
  setRegressionPrimaryRuntimeRobot(firstRobot);
  const repeatedRevision = getRegressionSnapshot().primaryRuntimeRevision;
  setRegressionPrimaryRuntimeRobot(secondRobot);
  const secondRevision = getRegressionSnapshot().primaryRuntimeRevision;

  assert.equal(firstRevision, baselineRevision + 1);
  assert.equal(repeatedRevision, firstRevision);
  assert.equal(secondRevision, firstRevision + 1);
  assert.equal(getRegressionSnapshot().primaryRuntime?.name, 'second-runtime');

  setRegressionPrimaryRuntimeRobot(null);
});

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

test('runtime material summary reports actual linear RGB, not hex-quantized reconstruction', () => {
  // A color whose exact float channels differ from anything the 8-bit hex
  // round-trip can express: setRGB stores the raw floats and colorLinear must
  // read them back verbatim, while getHexString quantizes through the sRGB
  // grid (a hex-derived reconstruction would lose up to 0.5/255 per channel).
  const robot = new THREE.Group();
  robot.name = 'linear_probe';
  const material = new THREE.MeshStandardMaterial();
  material.color.setRGB(0.627451, 0.627451, 0.627451);
  const visualMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  visualMesh.name = 'linear_visual';
  visualMesh.userData.parentLinkName = 'base';
  visualMesh.userData.isVisualMesh = true;
  robot.add(visualMesh);

  setRegressionRuntimeRobot(robot as Parameters<typeof setRegressionRuntimeRobot>[0]);

  try {
    const summary = getRegressionSnapshot().runtime?.visualMeshes?.[0]?.materials?.[0];
    assert.ok(summary);
    assert.deepEqual(summary.colorLinear, [0.627451, 0.627451, 0.627451]);
    // The hex path coexists and is quantized (#d0d0d0 ≠ exact 0.627451).
    assert.equal(summary.color, '#d0d0d0');
  } finally {
    setRegressionRuntimeRobot(null);
  }
});

test('getRegressionSnapshot includes runtime visual mesh shadow state', () => {  const robot = new THREE.Group();
  robot.name = 'shadow_robot';
  const visualMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: '#808080' }),
  );
  visualMesh.name = 'base_visual';
  visualMesh.userData.parentLinkName = 'base';
  visualMesh.userData.isVisualMesh = true;
  visualMesh.castShadow = true;
  visualMesh.receiveShadow = true;
  robot.add(visualMesh);

  setRegressionRuntimeRobot(robot as Parameters<typeof setRegressionRuntimeRobot>[0]);

  assert.deepEqual(getRegressionSnapshot().runtime?.visualMeshes, [
    {
      link: 'base',
      name: 'base_visual',
      visible: true,
      effectiveVisible: true,
      castShadow: true,
      receiveShadow: true,
      triangleCount: 12,
      isPlaceholder: false,
      missingMeshPath: null,
      materials: [
        {
          type: 'MeshStandardMaterial',
          name: null,
          hasTexture: false,
          color: '#808080',
          colorLinear: [0.21586050010324415, 0.21586050010324415, 0.21586050010324415],
          transparent: false,
          opacity: 1,
          roughness: 1,
          metalness: 0,
          hasNormalMap: false,
          hasRoughnessMap: false,
          hasMetalnessMap: false,
          vertexColors: false,
          textureArithmetic: null,
          baseColorTexture: null,
          normalTexture: null, roughnessTexture: null, metalnessTexture: null, aoTexture: null,
          normalScale: [1, 1], aoMapIntensity: 1, ior: null, transmission: null, thickness: null,
          specularIntensity: null, specularColorLinear: null,
          attenuationColorLinear: null, attenuationDistance: null,
        },
      ],
      // BoxGeometry carries a 24-vertex uv attribute; the summary captures
      // mesh-level UV and vertex-color diagnostics for material acceptance.
      uvCount: 24,
      uvSamples: [
        [0, 1],
        [1, 1],
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
        [0, 0],
        [1, 0],
      ],
      vertexColorsApplied: false,
      vertexColorCount: 0,
      vertexColorSamples: [],
    },
  ]);

  setRegressionRuntimeRobot(null);
});

test('getRegressionSnapshot includes visual material colors and mesh material groups', () => {
  setRegressionAppHandlers({
    getAvailableFiles: () => [],
    getSelectedFile: () => null,
    getUsdSceneSnapshot: () => null,
    getDocumentLoadState: () => ({
      status: 'ready',
      fileName: null,
      format: null,
      error: null,
    }),
    getRobotState: () => ({
      name: 'paint_demo',
      rootLinkId: 'link1',
      links: {
        link1: {
          ...DEFAULT_LINK,
          id: 'link1',
          name: 'link1',
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.MESH,
            meshPath: 'meshes/cube.obj',
            color: '#808080',
            authoredMaterials: [
              { name: 'base', color: '#808080' },
              { name: 'paint_link1_0_1', color: '#007aff', opacity: 0.75 },
            ],
            meshMaterialGroups: [{ meshKey: '0', start: 0, count: 6, materialIndex: 1 }],
          },
          visualBodies: [
            {
              ...DEFAULT_LINK.visual,
              name: 'accent',
              type: GeometryType.BOX,
              color: '#33aa44',
            },
          ],
        },
      },
      joints: {},
      selection: { type: null, id: null },
    }),
    getAssetDebugState: () => ({
      appAssetKeys: [],
      preparedUsdCacheKeysByFile: {},
    }),
    getInteractionState: () => ({
      selection: { type: null, id: null },
      hoveredSelection: { type: null, id: null },
    }),
    loadRobotByName: async () => ({
      loaded: false,
      selectedFile: null,
    }),
  });

  const link = getRegressionSnapshot().store?.links[0];

  assert.equal(link?.visual.color, '#808080');
  assert.deepEqual(link?.visual.authoredMaterials, [
    {
      name: 'base',
      color: '#808080',
      colorRgba: null,
      texture: null,
      opacity: null,
      roughness: null,
      metalness: null,
      emissive: null,
      emissiveIntensity: null,
      alphaTest: null,
    },
    {
      name: 'paint_link1_0_1',
      color: '#007aff',
      colorRgba: null,
      texture: null,
      opacity: 0.75,
      roughness: null,
      metalness: null,
      emissive: null,
      emissiveIntensity: null,
      alphaTest: null,
    },
  ]);
  assert.deepEqual(link?.visual.meshMaterialGroups, [
    { meshKey: '0', start: 0, count: 6, materialIndex: 1 },
  ]);
  assert.equal(link?.visualBodies[0]?.geometry.color, '#33aa44');

  setRegressionAppHandlers(null);
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
            normalDiagnostics: {
              normalSource: 'repairedAuthored',
              normalRepairCount: 6,
              normalFallbackCount: 0,
              postRepairLowDotCount: 0,
            },
            geometry: {
              geomSubsetSections: [
                { start: 0, length: 3, materialId: '/Robot/Looks/LegShell' },
              ],
            },
          },
          {
            meshId: '/Robot/base_link/collisions.proto_box_id0',
            resolvedPrimPath: '/Robot/base_link/collisions/box_0',
            sectionName: 'collisions',
            primType: 'cube',
          },
        ],
        materials: [
          {
            materialId: '/Robot/Looks/Black',
            name: 'material_______023',
            shaderName: 'UsdPreviewSurface',
            color: [0, 0, 0],
            colorSpace: 'srgb',
            colorSource: 'authored',
            authoredColor: [0, 0, 0],
            authoredColorSpace: 'srgb',
          },
          {
            materialId: '/Robot/Looks/DarkGray',
            name: 'material_______024',
            shaderName: 'UsdPreviewSurface',
            color: [0.035, 0.035, 0.035],
            colorSpace: 'srgb',
            colorSource: 'authored',
            authoredColor: [0.035, 0.035, 0.035],
            authoredColorSpace: 'srgb',
          },
          {
            materialId: '/Robot/Looks/LegShell',
            name: 'material_____________001',
            shaderName: 'UsdPreviewSurface',
            color: [0.671705, 0.692426, 0.77427],
            colorSpace: 'srgb',
            colorSource: 'authored',
            authoredColor: [0.671705, 0.692426, 0.77427],
            authoredColorSpace: 'srgb',
            mapPath: 'textures/leg_shell.png',
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
            materialId: '/Robot/Looks/Black',
            name: 'material_______023',
            type: 'UsdPreviewSurface',
            color: '#000000',
            colorTuple: [0, 0, 0],
            colorSource: 'authored',
            authoredColor: '#000000',
            authoredColorTuple: [0, 0, 0],
            emissive: null,
            textured: false,
            textureCount: 0,
            texturePaths: [],
          },
          {
            materialId: '/Robot/Looks/DarkGray',
            name: 'material_______024',
            type: 'UsdPreviewSurface',
            color: '#353535',
            colorTuple: [0.035, 0.035, 0.035],
            colorSource: 'authored',
            authoredColor: '#353535',
            authoredColorTuple: [0.035, 0.035, 0.035],
            emissive: null,
            textured: false,
            textureCount: 0,
            texturePaths: [],
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
            materialId: '/Robot/Looks/LegShell',
            name: 'material_____________001',
            type: 'UsdPreviewSurface',
            color: '#d6d9e4',
            colorTuple: [0.671705, 0.692426, 0.77427],
            colorSource: 'authored',
            authoredColor: '#d6d9e4',
            authoredColorTuple: [0.671705, 0.692426, 0.77427],
            emissive: null,
            textured: true,
            textureCount: 1,
            texturePaths: ['textures/leg_shell.png'],
          },
        ],
      },
    ],
  });

  assert.deepEqual(
    targetWindow.__URDF_STUDIO_DEBUG__?.getSelectedUsdSceneSummary?.()?.collisionSummary,
    {
      totalDescriptorCount: 1,
      linkCount: 1,
      links: [
        {
          linkPath: '/Robot/base_link',
          linkName: 'base_link',
          descriptorCount: 1,
          primitiveTypes: {
            cube: 1,
          },
        },
      ],
    },
  );

  assert.deepEqual(targetWindow.__URDF_STUDIO_DEBUG__?.getSelectedUsdNormalDiagnostics?.(), {
    available: true,
    fileName: 'robots/demo/demo.usd',
    meshDescriptorCount: 3,
    diagnosticsCount: 1,
    meshes: [
      {
        meshId: '/Robot/FL_thigh/visuals.proto_mesh_id0',
        resolvedPrimPath: '/Robot/FL_thigh/visuals/thigh/mesh',
        linkPath: '/Robot/FL_thigh',
        sectionName: 'visuals',
        normalDiagnostics: {
          normalSource: 'repairedAuthored',
          normalRepairCount: 6,
          normalFallbackCount: 0,
          postRepairLowDotCount: 0,
        },
      },
    ],
  });

  setRegressionAppHandlers(null);
});

test('regression debug API seeds fixture files through registered app handlers', () => {
  const availableFiles: Array<{ name: string; format: RobotFile['format'] }> = [];
  let resetCount = 0;

  setRegressionAppHandlers({
    getAvailableFiles: () =>
      availableFiles.map((file) => ({
        name: file.name,
        format: file.format,
        content: '',
      })),
    getSelectedFile: () => null,
    getUsdSceneSnapshot: () => null,
    getDocumentLoadState: () => ({
      status: 'idle',
      fileName: null,
      format: null,
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
      appAssetKeys: [],
      preparedUsdCacheKeysByFile: {},
    }),
    getInteractionState: () => ({
      selection: { type: null, id: null },
      hoveredSelection: { type: null, id: null },
    }),
    resetFixtureFiles: () => {
      resetCount += 1;
      availableFiles.length = 0;
    },
    seedFixtureFile: (file) => {
      availableFiles.push({ name: file.name, format: file.format });
      return { availableFileCount: availableFiles.length };
    },
    loadRobotByName: async () => ({
      loaded: false,
      selectedFile: null,
    }),
  });

  const targetWindow = {} as Window;
  installRegressionDebugApi(targetWindow);

  assert.deepEqual(targetWindow.__URDF_STUDIO_DEBUG__?.resetFixtureFiles(), {
    ok: true,
    availableFileCount: 0,
  });
  assert.deepEqual(
    targetWindow.__URDF_STUDIO_DEBUG__?.seedFixtureFile({
      name: '/unitree_model/Go2/usd/go2.usd',
      content: '#usda 1.0',
      format: 'usd',
      blobUrl: 'http://127.0.0.1/unitree_model/Go2/usd/go2.usd',
      addFileContent: true,
    }),
    {
      ok: true,
      availableFileCount: 1,
    },
  );
  assert.equal(resetCount, 1);
  assert.deepEqual(targetWindow.__URDF_STUDIO_DEBUG__?.getAvailableFiles(), [
    {
      name: '/unitree_model/Go2/usd/go2.usd',
      format: 'usd',
    },
  ]);

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
