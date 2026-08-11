import test from 'node:test';
import assert from 'node:assert/strict';

import { WORKSPACE_DEFAULT_CAMERA_POSITION } from '../../../shared/components/3d/scene/constants.ts';

import {
  createEmbeddedUsdViewerLoadParams,
  resolveEmbeddedUsdViewerLoadProfile,
  shouldPreferSlicedEmbeddedUsdLoad,
} from '@/lib/robot-parser/usd/usdViewerRenderParams';

test('createEmbeddedUsdViewerLoadParams keeps USD auto-fit aligned with the workspace camera defaults', () => {
  const params = createEmbeddedUsdViewerLoadParams(4);

  assert.equal(params.get('threads'), '4');
  assert.equal(params.get('fastLoad'), '1');
  assert.equal(params.get('nonBlockingLoad'), '0');
  assert.equal(params.get('aggressiveInitialDraw'), '1');
  assert.equal(params.get('strictOneShot'), '1');
  assert.equal(params.get('yieldDuringLoad'), '0');
  assert.equal(params.get('resolveRobotMetadataBeforeReady'), '1');
  assert.equal(params.get('requireCompleteRobotMetadata'), '1');
  assert.equal(params.get('skipSensorPayloadsOnOpen'), '0');
  assert.equal(params.get('includeSensorDependency'), '1');
  assert.equal(params.get('warmupRuntimeBridge'), '1');
  assert.equal(params.has('drawBurstRenderEveryDraw'), false);
  assert.equal(params.has('initialDrawYieldMs'), false);
  assert.equal(params.has('disableCameraAutoFit'), false);
  assert.equal(params.get('cameraX'), String(WORKSPACE_DEFAULT_CAMERA_POSITION[0]));
  assert.equal(params.get('cameraY'), String(WORKSPACE_DEFAULT_CAMERA_POSITION[1]));
  assert.equal(params.get('cameraZ'), String(WORKSPACE_DEFAULT_CAMERA_POSITION[2]));
});

test('createEmbeddedUsdViewerLoadParams prioritizes fast interactive readiness for embedded USD loads', () => {
  const params = createEmbeddedUsdViewerLoadParams(4);

  assert.equal(params.get('nonBlockingLoad'), '0');
  assert.equal(params.get('strictOneShot'), '1');
  assert.equal(params.get('aggressiveInitialDraw'), '1');
  assert.equal(params.get('yieldDuringLoad'), '0');
  assert.equal(params.get('resolveRobotMetadataBeforeReady'), '1');
  assert.equal(params.get('requireCompleteRobotMetadata'), '1');
  assert.equal(params.get('skipSensorPayloadsOnOpen'), '0');
  assert.equal(params.get('includeSensorDependency'), '1');
  assert.equal(params.get('warmupRuntimeBridge'), '1');
  assert.equal(params.has('autoLoadDependencies'), false);
  assert.equal(params.has('initialDrawYieldMs'), false);
});

test('createEmbeddedUsdViewerLoadParams keeps worker bootstrap strict while using direct scene snapshots', () => {
  const params = createEmbeddedUsdViewerLoadParams(4, {
    preferWorkerResolvedRobotData: true,
  });

  assert.equal(params.get('nonBlockingLoad'), '0');
  assert.equal(params.get('aggressiveInitialDraw'), '0');
  assert.equal(params.get('strictOneShot'), '1');
  assert.equal(params.get('yieldDuringLoad'), '0');
  assert.equal(params.get('resolveRobotMetadataBeforeReady'), '1');
  assert.equal(params.get('requireCompleteRobotMetadata'), '1');
  assert.equal(params.get('skipSensorPayloadsOnOpen'), '0');
  assert.equal(params.get('includeSensorDependency'), '1');
  assert.equal(params.get('warmupRuntimeBridge'), '1');
  assert.equal(params.get('robotSceneSnapshotBeforeDraw'), '1');
  assert.equal(params.get('skipHydraFullDrawForRobotSceneSnapshot'), '1');
  assert.equal(params.get('skipHydraPopulateForRobotSceneSnapshot'), '0');
  assert.equal(params.get('disableStageLayerTextFallbacks'), '1');
  assert.equal(params.has('initialDrawBurst'), false);
});

test('createEmbeddedUsdViewerLoadParams can relax only robot metadata for synthetic worker roots', () => {
  const params = createEmbeddedUsdViewerLoadParams(4, {
    preferWorkerResolvedRobotData: true,
    allowIncompleteWorkerRobotMetadata: true,
  });

  assert.equal(params.get('nonBlockingLoad'), '0');
  assert.equal(params.get('aggressiveInitialDraw'), '0');
  assert.equal(params.get('strictOneShot'), '1');
  assert.equal(params.get('yieldDuringLoad'), '0');
  assert.equal(params.get('resolveRobotMetadataBeforeReady'), '0');
  assert.equal(params.get('requireCompleteRobotMetadata'), '0');
  assert.equal(params.get('skipSensorPayloadsOnOpen'), '0');
  assert.equal(params.get('includeSensorDependency'), '1');
  assert.equal(params.get('warmupRuntimeBridge'), '1');
  assert.equal(params.get('robotSceneSnapshotBeforeDraw'), '1');
  assert.equal(params.get('skipHydraFullDrawForRobotSceneSnapshot'), '1');
  assert.equal(params.get('skipHydraPopulateForRobotSceneSnapshot'), '0');
  assert.equal(params.get('disableStageLayerTextFallbacks'), '1');
  assert.equal(params.has('initialDrawBurst'), false);
});

test('createEmbeddedUsdViewerLoadParams can force Hydra composition for generic stages', () => {
  const params = createEmbeddedUsdViewerLoadParams(4, {
    preferWorkerResolvedRobotData: true,
    forceHydraFullDraw: true,
  });

  assert.equal(params.get('aggressiveInitialDraw'), '1');
  assert.equal(params.get('robotSceneSnapshotBeforeDraw'), '0');
  assert.equal(params.get('skipHydraFullDrawForRobotSceneSnapshot'), '0');
  assert.equal(params.get('skipHydraPopulateForRobotSceneSnapshot'), '0');
  assert.equal(params.get('allowPartialMeshHydration'), '1');
});

test('resolveEmbeddedUsdViewerLoadProfile keeps large pure .usd interactive loads distinct from worker bootstrap loads', () => {
  assert.equal(resolveEmbeddedUsdViewerLoadProfile(), 'default-embedded');
  assert.equal(
    resolveEmbeddedUsdViewerLoadProfile({
      preferSlicedMainThreadLoadForLargePureUsd: true,
    }),
    'large-pure-usd-sliced',
  );
  assert.equal(
    resolveEmbeddedUsdViewerLoadProfile({
      preferWorkerResolvedRobotData: true,
    }),
    'worker-bootstrap',
  );
});

test('createEmbeddedUsdViewerLoadParams keeps large pure .usd roots strict until hydration completes', () => {
  const params = createEmbeddedUsdViewerLoadParams(4, {
    preferSlicedMainThreadLoadForLargePureUsd: true,
  });

  assert.equal(params.get('nonBlockingLoad'), '0');
  assert.equal(params.get('aggressiveInitialDraw'), '1');
  assert.equal(params.get('strictOneShot'), '1');
  assert.equal(params.get('yieldDuringLoad'), '0');
  assert.equal(params.get('resolveRobotMetadataBeforeReady'), '1');
  assert.equal(params.get('requireCompleteRobotMetadata'), '1');
  assert.equal(params.get('skipSensorPayloadsOnOpen'), '0');
  assert.equal(params.get('includeSensorDependency'), '1');
  assert.equal(params.get('warmupRuntimeBridge'), '1');
});

test('shouldPreferSlicedEmbeddedUsdLoad includes multi-layer USDA roots', () => {
  assert.equal(
    shouldPreferSlicedEmbeddedUsdLoad({
      sourceFileName: 'go2_description/urdf/go2_description.usda',
      preloadFileCount: 5,
      criticalDependencyCount: 4,
    }),
    true,
  );
  assert.equal(
    shouldPreferSlicedEmbeddedUsdLoad({
      sourceFileName: 'go2_description/urdf/go2_description.usda',
      preloadFileCount: 1,
      criticalDependencyCount: 0,
    }),
    false,
  );
  assert.equal(
    shouldPreferSlicedEmbeddedUsdLoad({
      sourceFileName: 'robot/mesh.obj',
      preloadFileCount: 5,
      criticalDependencyCount: 4,
    }),
    false,
  );
});

test('createEmbeddedUsdViewerLoadParams can skip vendored dependency preload when stage files are already in WASM FS', () => {
  const params = createEmbeddedUsdViewerLoadParams(4, {
    dependenciesPreloadedToVirtualFs: true,
  });

  assert.equal(params.get('dependenciesPreloadedToVirtualFs'), '1');
  assert.equal(params.get('autoLoadDependencies'), '0');
});
