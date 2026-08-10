import test from 'node:test';
import assert from 'node:assert/strict';

import { useAssetsStore } from './assetsStore.ts';

function createUsdSceneSnapshot(stageSourcePath: string) {
  return {
    stageSourcePath,
    render: {
      meshDescriptors: [],
    },
  };
}

function createPreparedUsdExportCache(stageSourcePath: string) {
  return {
    stageSourcePath,
    robotData: {
      name: 'prepared_robot',
      rootLinkId: 'base_link',
      links: {},
      joints: {},
    },
    meshFiles: {},
  };
}

function resetAssetsStore() {
  const state = useAssetsStore.getState();
  state.clearAssets();
  state.clearRobotLibrary();
  state.clearUsdSceneSnapshots();
  state.clearUsdBakedScenes();
  state.clearUsdPreparedExportCaches();
  state.setAvailableFiles([]);
  state.setSelectedFile(null);
  state.resetDocumentLoadState();
  state.setAllFileContents({});
  state.clearComponentSourceDrafts();
}

test('removeRobotFile clears matching USD scene snapshot cache', () => {
  resetAssetsStore();

  const state = useAssetsStore.getState();
  state.setAvailableFiles([
    {
      name: 'robots/demo/demo.usd',
      content: '',
      format: 'usd',
    },
  ]);

  state.setUsdSceneSnapshot(
    '/robots/demo/demo.usd',
    createUsdSceneSnapshot('/robots/demo/demo.usd'),
  );
  assert.ok(state.getUsdSceneSnapshot('robots/demo/demo.usd'));

  state.removeRobotFile('robots/demo/demo.usd');

  assert.equal(useAssetsStore.getState().getUsdSceneSnapshot('robots/demo/demo.usd'), null);
});

test('clearRobotLibrary clears all USD scene snapshot caches', () => {
  resetAssetsStore();

  const state = useAssetsStore.getState();
  state.setAvailableFiles([
    {
      name: 'robots/demo/demo.usd',
      content: '',
      format: 'usd',
    },
    {
      name: 'robots/alt/alt.usd',
      content: '',
      format: 'usd',
    },
  ]);

  state.setUsdSceneSnapshot(
    '/robots/demo/demo.usd',
    createUsdSceneSnapshot('/robots/demo/demo.usd'),
  );
  state.setUsdSceneSnapshot('/robots/alt/alt.usd', createUsdSceneSnapshot('/robots/alt/alt.usd'));

  assert.ok(state.getUsdSceneSnapshot('robots/demo/demo.usd'));
  assert.ok(state.getUsdSceneSnapshot('robots/alt/alt.usd'));

  state.clearRobotLibrary();

  assert.equal(useAssetsStore.getState().getUsdSceneSnapshot('robots/demo/demo.usd'), null);
  assert.equal(useAssetsStore.getState().getUsdSceneSnapshot('robots/alt/alt.usd'), null);
});

test('removeRobotFile clears matching prepared USD export cache', () => {
  resetAssetsStore();

  const state = useAssetsStore.getState();
  state.setAvailableFiles([
    {
      name: 'robots/demo/demo.usd',
      content: '',
      format: 'usd',
    },
  ]);

  state.setUsdPreparedExportCache(
    '/robots/demo/demo.usd',
    createPreparedUsdExportCache('/robots/demo/demo.usd'),
  );
  assert.ok(state.getUsdPreparedExportCache('robots/demo/demo.usd'));

  state.removeRobotFile('robots/demo/demo.usd');

  assert.equal(useAssetsStore.getState().getUsdPreparedExportCache('robots/demo/demo.usd'), null);
});

test('USD cache lookups normalize virtual and library path variants', () => {
  resetAssetsStore();

  const state = useAssetsStore.getState();
  state.setUsdSceneSnapshot(
    '/robots//demo/../demo/demo.usd?v=1',
    createUsdSceneSnapshot('/robots/demo/demo.usd'),
  );
  state.setUsdPreparedExportCache(
    'robots\\demo\\.\\demo.usd?v=1',
    createPreparedUsdExportCache('/robots/demo/demo.usd'),
  );

  assert.ok(state.getUsdSceneSnapshot('robots/demo/demo.usd'));
  assert.ok(state.getUsdSceneSnapshot('/robots/demo/demo.usd?other=1'));
  assert.ok(state.getUsdPreparedExportCache('robots/demo/demo.usd'));
  assert.ok(state.getUsdPreparedExportCache('/robots//demo/demo.usd?other=1'));
});

test('USD baked scene accessors share storage with legacy scene snapshot accessors', () => {
  resetAssetsStore();

  const state = useAssetsStore.getState();
  state.setUsdBakedScene('/robots/demo/demo.usd', createUsdSceneSnapshot('/robots/demo/demo.usd'));

  assert.ok(state.getUsdBakedScene('robots/demo/demo.usd'));
  assert.ok(state.getUsdSceneSnapshot('robots/demo/demo.usd'));

  state.setUsdSceneSnapshot('/robots/alt/alt.usd', createUsdSceneSnapshot('/robots/alt/alt.usd'));

  assert.ok(useAssetsStore.getState().getUsdBakedScene('robots/alt/alt.usd'));

  useAssetsStore.getState().clearUsdBakedScenes();

  assert.equal(useAssetsStore.getState().getUsdBakedScene('robots/demo/demo.usd'), null);
  assert.equal(useAssetsStore.getState().getUsdSceneSnapshot('robots/alt/alt.usd'), null);
});

test('clearRobotLibrary clears all prepared USD export caches', () => {
  resetAssetsStore();

  const state = useAssetsStore.getState();
  state.setAvailableFiles([
    {
      name: 'robots/demo/demo.usd',
      content: '',
      format: 'usd',
    },
    {
      name: 'robots/alt/alt.usd',
      content: '',
      format: 'usd',
    },
  ]);

  state.setUsdPreparedExportCache(
    '/robots/demo/demo.usd',
    createPreparedUsdExportCache('/robots/demo/demo.usd'),
  );
  state.setUsdPreparedExportCache(
    '/robots/alt/alt.usd',
    createPreparedUsdExportCache('/robots/alt/alt.usd'),
  );

  assert.ok(state.getUsdPreparedExportCache('robots/demo/demo.usd'));
  assert.ok(state.getUsdPreparedExportCache('robots/alt/alt.usd'));

  state.clearRobotLibrary();

  assert.equal(useAssetsStore.getState().getUsdPreparedExportCache('robots/demo/demo.usd'), null);
  assert.equal(useAssetsStore.getState().getUsdPreparedExportCache('robots/alt/alt.usd'), null);
});

test('removeRobotFile resets document load state for the removed file', () => {
  resetAssetsStore();

  const state = useAssetsStore.getState();
  state.setAvailableFiles([
    {
      name: 'robots/demo/demo.usd',
      content: '',
      format: 'usd',
    },
  ]);
  state.setSelectedFile({
    name: 'robots/demo/demo.usd',
    content: '',
    format: 'usd',
  });
  state.setDocumentLoadState({
    status: 'hydrating',
    fileName: 'robots/demo/demo.usd',
    format: 'usd',
    error: null,
  });

  state.removeRobotFile('robots/demo/demo.usd');

  assert.deepEqual(useAssetsStore.getState().documentLoadState, {
    status: 'idle',
    fileName: null,
    format: null,
    error: null,
  });
});

test('setSelectedFile null resets document load state', () => {
  resetAssetsStore();

  const state = useAssetsStore.getState();
  state.setSelectedFile({
    name: 'robots/demo/demo.usd',
    content: '',
    format: 'usd',
  });
  state.setDocumentLoadState({
    status: 'ready',
    fileName: 'robots/demo/demo.usd',
    format: 'usd',
    error: null,
  });

  state.setSelectedFile(null);

  assert.deepEqual(useAssetsStore.getState().documentLoadState, {
    status: 'idle',
    fileName: null,
    format: null,
    error: null,
  });
});

test('renameRobotFolder renames file, asset, selection, and USD cache paths together', () => {
  resetAssetsStore();

  const state = useAssetsStore.getState();
  state.setAvailableFiles([
    {
      name: 'robots/demo/robot.urdf',
      content: '<robot />',
      format: 'urdf',
    },
    {
      name: 'robots/demo/demo.usd',
      content: '',
      format: 'usd',
    },
  ]);
  state.setAssets({
    'robots/demo/meshes/base.stl': 'blob:mesh',
  });
  state.setAllFileContents({
    'robots/demo/robot.urdf': '<robot />',
  });
  state.setSelectedFile({
    name: 'robots/demo/demo.usd',
    content: '',
    format: 'usd',
  });
  state.setDocumentLoadState({
    status: 'ready',
    fileName: 'robots/demo/demo.usd',
    format: 'usd',
    error: null,
  });
  state.setUsdSceneSnapshot('robots/demo/demo.usd', createUsdSceneSnapshot('robots/demo/demo.usd'));
  state.setUsdPreparedExportCache(
    'robots/demo/demo.usd',
    createPreparedUsdExportCache('robots/demo/demo.usd'),
  );

  const result = state.renameRobotFolder('robots/demo', 'renamed-demo');
  assert.deepEqual(result, { ok: true, nextPath: 'robots/renamed-demo' });

  const nextState = useAssetsStore.getState();
  assert.deepEqual(nextState.availableFiles.map((file) => file.name).sort(), [
    'robots/renamed-demo/demo.usd',
    'robots/renamed-demo/robot.urdf',
  ]);
  assert.deepEqual(Object.keys(nextState.assets), ['robots/renamed-demo/meshes/base.stl']);
  assert.deepEqual(Object.keys(nextState.allFileContents), ['robots/renamed-demo/robot.urdf']);
  assert.equal(nextState.selectedFile?.name, 'robots/renamed-demo/demo.usd');
  assert.deepEqual(nextState.documentLoadState, {
    status: 'ready',
    fileName: 'robots/renamed-demo/demo.usd',
    format: 'usd',
    error: null,
  });
  assert.ok(nextState.getUsdSceneSnapshot('robots/renamed-demo/demo.usd'));
  assert.ok(nextState.getUsdPreparedExportCache('robots/renamed-demo/demo.usd'));
  assert.equal(nextState.getUsdSceneSnapshot('robots/demo/demo.usd'), null);
  assert.equal(nextState.getUsdPreparedExportCache('robots/demo/demo.usd'), null);
});

test('renameRobotFolder rejects conflicting target folders', () => {
  resetAssetsStore();

  const state = useAssetsStore.getState();
  state.setAvailableFiles([
    {
      name: 'robots/demo/robot.urdf',
      content: '<robot />',
      format: 'urdf',
    },
    {
      name: 'robots/existing/other.urdf',
      content: '<robot />',
      format: 'urdf',
    },
  ]);

  const result = state.renameRobotFolder('robots/demo', 'existing');
  assert.deepEqual(result, { ok: false, reason: 'conflict' });
  assert.deepEqual(
    useAssetsStore
      .getState()
      .availableFiles.map((file) => file.name)
      .sort(),
    ['robots/demo/robot.urdf', 'robots/existing/other.urdf'],
  );
});

test('library mutation plans can apply without revoking and roll back to the previous assets state', () => {
  resetAssetsStore();

  const revokedUrls: string[] = [];
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: (url: string) => {
      revokedUrls.push(url);
    },
  });

  try {
    const state = useAssetsStore.getState();
    state.setAvailableFiles([
      {
        name: 'robots/demo/demo.usd',
        content: '',
        format: 'usd',
      },
    ]);
    state.setAssets({
      'robots/demo/demo.usd': 'blob:demo-usd',
      'robots/demo/texture.png': 'blob:texture',
    });

    const plan = useAssetsStore.getState().createRemoveRobotFilePlan('robots/demo/demo.usd');
    assert.ok(plan);
    assert.deepEqual(plan.orphanBlobUrls, ['blob:demo-usd']);

    assert.equal(
      useAssetsStore.getState().applyLibraryMutationPlan(plan, { revokeOrphans: false }),
      true,
    );
    assert.deepEqual(useAssetsStore.getState().availableFiles, []);
    assert.deepEqual(useAssetsStore.getState().assets, {
      'robots/demo/texture.png': 'blob:texture',
    });
    assert.deepEqual(revokedUrls, []);

    useAssetsStore.getState().restoreLibraryMutationState(plan.previousState);
    assert.deepEqual(
      useAssetsStore.getState().availableFiles.map((file) => file.name),
      ['robots/demo/demo.usd'],
    );
    assert.deepEqual(useAssetsStore.getState().assets, {
      'robots/demo/demo.usd': 'blob:demo-usd',
      'robots/demo/texture.png': 'blob:texture',
    });

    useAssetsStore.getState().revokeLibraryMutationPlanOrphans(plan);
    assert.deepEqual(revokedUrls, ['blob:demo-usd']);
  } finally {
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: originalRevokeObjectUrl,
    });
  }
});

test('renameRobotFolder keeps retained blob URLs out of the orphan list', () => {
  resetAssetsStore();

  const revokedUrls: string[] = [];
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: (url: string) => {
      revokedUrls.push(url);
    },
  });

  try {
    const state = useAssetsStore.getState();
    state.setAvailableFiles([
      {
        name: 'robots/demo/robot.urdf',
        content: '<robot />',
        format: 'urdf',
      },
    ]);
    state.setAssets({
      'robots/demo/meshes/base.stl': 'blob:mesh',
      'aliases/base.stl': 'blob:mesh',
    });

    const { result, plan } = useAssetsStore
      .getState()
      .createRenameRobotFolderPlan('robots/demo', 'renamed-demo');
    assert.deepEqual(result, { ok: true, nextPath: 'robots/renamed-demo' });
    assert.ok(plan);
    assert.deepEqual(plan.orphanBlobUrls, []);

    const renameResult = useAssetsStore.getState().renameRobotFolder('robots/demo', 'renamed-demo');
    assert.deepEqual(renameResult, { ok: true, nextPath: 'robots/renamed-demo' });
    assert.deepEqual(revokedUrls, []);
    assert.deepEqual(useAssetsStore.getState().assets, {
      'robots/renamed-demo/meshes/base.stl': 'blob:mesh',
      'aliases/base.stl': 'blob:mesh',
    });
  } finally {
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: originalRevokeObjectUrl,
    });
  }
});

test('removeRobotFolder preserves same-URL aliases owned outside the removed folder', () => {
  resetAssetsStore();
  const state = useAssetsStore.getState();
  state.setAvailableFiles([{
    name: 'robots/demo/robot.urdf',
    content: '<robot />',
    format: 'urdf',
  }]);
  state.setAssets({
    'robots/demo/meshes/base.stl': 'blob:shared-mesh',
    'robots/kept/meshes/base.stl': 'blob:shared-mesh',
  });

  const plan = useAssetsStore.getState().createRemoveRobotFolderPlan('robots/demo');
  assert.ok(plan);
  assert.deepEqual(plan.orphanBlobUrls, []);
  assert.deepEqual(plan.nextState.assets, {
    'robots/kept/meshes/base.stl': 'blob:shared-mesh',
  });
});

test('setMotorLibrary rejects empty motor library payloads instead of silently restoring defaults', () => {
  resetAssetsStore();

  const state = useAssetsStore.getState();

  assert.throws(() => state.setMotorLibrary({}), /Empty library payload/);
});

test('setMotorLibrary merges custom brands without losing built-in motors', () => {
  resetAssetsStore();

  const state = useAssetsStore.getState();
  state.setMotorLibrary({
    Unitree: [
      {
        name: 'Go1-M8010-6',
        armature: 0.000111842,
        velocity: 30.1,
        effort: 23.7,
      },
      {
        name: 'Unitree-Custom-X',
        armature: 0.001,
        velocity: 20,
        effort: 40,
      },
    ],
    'My Lab': [
      {
        name: 'LAB-MOTOR-01',
        armature: 0.002,
        velocity: 18,
        effort: 32,
      },
    ],
  });

  const nextLibrary = useAssetsStore.getState().motorLibrary;

  assert.ok(nextLibrary.Unitree.some((motor) => motor.name === 'Go1-M8010-6'));
  assert.ok(nextLibrary.Unitree.some((motor) => motor.name === 'Unitree-Custom-X'));
  assert.ok(nextLibrary['My Lab']?.some((motor) => motor.name === 'LAB-MOTOR-01'));
});
