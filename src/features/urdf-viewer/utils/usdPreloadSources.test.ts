import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildUsdBundlePreloadEntries,
  collectUsdStageOpenRelevantVirtualPaths,
  createUsdPreloadSource,
  extractUsdLayerReferencesFromText,
  inferUsdBundleVirtualDirectory,
  isUsdPathWithinBundleDirectory,
  resolveUsdLayerReferencePath,
  resolveUsdBlobUrl,
} from '@/lib/robot-parser/usd/usdPreloadSources';

test('resolveUsdBlobUrl falls back to the assets map when binary USD placeholders lose blobUrl', () => {
  const resolved = resolveUsdBlobUrl('Go2/usd/configuration/go2_description_base.usd', undefined, {
    'Go2/usd/configuration/go2_description_base.usd': 'blob:go2-base',
  });

  assert.equal(resolved, 'blob:go2-base');
});

test('resolveUsdBlobUrl supports leading-slash virtual paths', () => {
  const resolved = resolveUsdBlobUrl('/Go2 (1)/usd/go2.usd', undefined, {
    'Go2 (1)/usd/go2.usd': 'blob:go2-root',
  });

  assert.equal(resolved, 'blob:go2-root');
});

test('createUsdPreloadSource prefers a blob-backed source over empty text content', () => {
  const preloadSource = createUsdPreloadSource(
    {
      name: 'Go2/usd/go2.usd',
      content: '',
      blobUrl: undefined,
    },
    {
      'Go2/usd/go2.usd': 'blob:go2-root',
    },
  );

  assert.equal(preloadSource.kind, 'blob-url');
});

test('createUsdPreloadSource falls back to text content for textual USDA files', () => {
  const preloadSource = createUsdPreloadSource(
    {
      name: 'robot.usda',
      content: '#usda 1.0',
      blobUrl: undefined,
    },
    {},
  );

  assert.equal(preloadSource.kind, 'text-content');
});

test('createUsdPreloadSource prefers inline text content for textual USD files even when blob URLs exist', () => {
  const preloadSource = createUsdPreloadSource(
    {
      name: 'unitree_model/B2/usd/b2.usd',
      content: '#usda 1.0',
      blobUrl: 'blob:b2-root',
    },
    {
      'unitree_model/B2/usd/b2.usd': 'blob:b2-root',
    },
  );

  assert.equal(preloadSource.kind, 'text-content');
});

test('createUsdPreloadSource keeps binary .usd payloads blob-backed even when content is populated', () => {
  const preloadSource = createUsdPreloadSource(
    {
      name: 'unitree_model/B2/usd/configuration/b2_description_base.usd',
      content: 'PXR-USDC\u0000\u0000binary-payload',
      blobUrl: 'blob:b2-base',
    },
    {
      'unitree_model/B2/usd/configuration/b2_description_base.usd': 'blob:b2-base',
    },
  );

  assert.equal(preloadSource.kind, 'blob-url');
});

test('inferUsdBundleVirtualDirectory scopes to the package root before /usd/ when available', () => {
  const bundleDirectory = inferUsdBundleVirtualDirectory('robots/unitree/go2/usd/go2.usd');

  assert.equal(bundleDirectory, '/robots/unitree/go2/');
});

test('isUsdPathWithinBundleDirectory includes only files from the same USD package directory', () => {
  const bundleDirectory = inferUsdBundleVirtualDirectory('Go2/usd/go2.usd');

  assert.equal(
    isUsdPathWithinBundleDirectory(
      'Go2/usd/configuration/go2_description_base.usd',
      bundleDirectory,
    ),
    true,
  );
  assert.equal(isUsdPathWithinBundleDirectory('Go2/meshes/base_link.STL', bundleDirectory), true);
  assert.equal(isUsdPathWithinBundleDirectory('H1/usd/h1.usd', bundleDirectory), false);
  assert.equal(
    isUsdPathWithinBundleDirectory('/configuration/go2_description_base.usd', bundleDirectory),
    false,
  );
});

test('extractUsdLayerReferencesFromText keeps only USD layer references', () => {
  assert.deepEqual(
    extractUsdLayerReferencesFromText(`
      #usda 1.0
      (
        subLayers = [
          @./configuration/go2_description_base.usd@,
          @./configuration/go2_description_sensor.usda@,
          @./textures/body.png@
        ]
      )
    `),
    ['./configuration/go2_description_base.usd', './configuration/go2_description_sensor.usda'],
  );
});

test('resolveUsdLayerReferencePath resolves relative layer paths from the current USD file', () => {
  assert.equal(
    resolveUsdLayerReferencePath(
      '/robots/go2/usd/go2.usd',
      './configuration/go2_description_base.usd',
    ),
    '/robots/go2/usd/configuration/go2_description_base.usd',
  );
  assert.equal(
    resolveUsdLayerReferencePath(
      '/robots/go2/usd/configuration/go2_description_base.usd',
      '../go2.usd',
    ),
    '/robots/go2/usd/go2.usd',
  );
});

test('collectUsdStageOpenRelevantVirtualPaths keeps the selected root layer, its references, and critical config sidecars', () => {
  assert.deepEqual(
    collectUsdStageOpenRelevantVirtualPaths(
      {
        name: 'robots/go2/usd/go2.usd',
        content: '#usda 1.0\n(\n  subLayers = [@./configuration/go2_description_base.usd@]\n)\n',
        blobUrl: undefined,
      },
      [
        {
          name: 'robots/go2/usd/go2.usd',
          content: '#usda 1.0\n(\n  subLayers = [@./configuration/go2_description_base.usd@]\n)\n',
          blobUrl: undefined,
          format: 'usd',
        },
        {
          name: 'robots/go2/usd/configuration/go2_description_base.usd',
          content: '#usda 1.0\n(\n  subLayers = [@./go2_description_sensor.usd@]\n)\n',
          blobUrl: undefined,
          format: 'usd',
        },
        {
          name: 'robots/go2/usd/configuration/go2_description_sensor.usd',
          content: '',
          blobUrl: undefined,
          format: 'usd',
        },
        {
          name: 'robots/go2/usd/go2_alt.usd',
          content: '#usda 1.0',
          blobUrl: undefined,
          format: 'usd',
        },
      ],
    ),
    [
      '/robots/go2/usd/go2.usd',
      '/robots/go2/usd/configuration/go2_description_base.usd',
      '/robots/go2/usd/configuration/go2_description_physics.usd',
      '/robots/go2/usd/configuration/go2_description_sensor.usd',
    ],
  );
});

test('collectUsdStageOpenRelevantVirtualPaths still keeps critical sidecars for binary .usd roots', () => {
  assert.deepEqual(
    collectUsdStageOpenRelevantVirtualPaths(
      {
        name: 'unitree_model/B2/usd/b2.usd',
        content: 'PXR-USDC\u0000\u0000binary-root',
        blobUrl: 'blob:b2-root',
      },
      [
        {
          name: 'unitree_model/B2/usd/b2.usd',
          content: 'PXR-USDC\u0000\u0000binary-root',
          blobUrl: 'blob:b2-root',
          format: 'usd',
        },
        {
          name: 'unitree_model/B2/usd/configuration/b2_description_base.usd',
          content: '',
          blobUrl: 'blob:b2-base',
          format: 'usd',
        },
        {
          name: 'unitree_model/B2/usd/configuration/b2_description_physics.usd',
          content: '',
          blobUrl: 'blob:b2-physics',
          format: 'usd',
        },
        {
          name: 'unitree_model/B2/usd/configuration/b2_description_sensor.usd',
          content: '',
          blobUrl: 'blob:b2-sensor',
          format: 'usd',
        },
      ],
    ),
    [
      '/unitree_model/B2/usd/b2.usd',
      '/unitree_model/B2/usd/configuration/b2_description_base.usd',
      '/unitree_model/B2/usd/configuration/b2_description_physics.usd',
      '/unitree_model/B2/usd/configuration/b2_description_sensor.usd',
    ],
  );
});

test('buildUsdBundlePreloadEntries preloads referenced layers and supported bundle textures', () => {
  const preloadEntries = buildUsdBundlePreloadEntries(
    {
      name: 'Go2/usd/go2.usd',
      content: '#usda 1.0\n(\n  subLayers = [@./configuration/go2_description_base.usd@]\n)\n',
      blobUrl: undefined,
    },
    [
      {
        name: 'Go2/usd/go2.usd',
        content: '#usda 1.0\n(\n  subLayers = [@./configuration/go2_description_base.usd@]\n)\n',
        blobUrl: undefined,
        format: 'usd',
      },
      {
        name: 'Go2/usd/configuration/go2_description_base.usd',
        content: '',
        blobUrl: undefined,
        format: 'usd',
      },
      {
        name: 'Go2/meshes/base_link.stl',
        content: '',
        blobUrl: undefined,
        format: 'mesh',
      },
      {
        name: 'Go2/usd/go2_alt.usd',
        content: '#usda 1.0',
        blobUrl: undefined,
        format: 'usd',
      },
      {
        name: 'H1/usd/h1.usd',
        content: '',
        blobUrl: undefined,
        format: 'usd',
      },
    ],
    {
      'Go2/usd/go2.usd': 'blob:go2-root',
      'Go2/usd/configuration/go2_description_base.usd': 'blob:go2-base',
      'Go2/textures/body.png': 'blob:go2-texture',
      'H1/textures/body.png': 'blob:h1-texture',
    },
  );

  assert.deepEqual(
    preloadEntries.map((entry) => entry.path),
    [
      '/Go2/textures/body.png',
      '/Go2/usd/configuration/go2_description_base.usd',
      '/Go2/usd/go2.usd',
    ],
  );
});

test('scene projection can preload the complete artifact closure hidden behind binary USDC layers', () => {
  const preloadEntries = buildUsdBundlePreloadEntries(
    {
      name: 'Simple_Room/scene.usda',
      content: '#usda 1.0\n( references = @./SimpleRoom/simple_room.usd@ )',
      blobUrl: undefined,
    },
    [
      {
        name: 'Simple_Room/scene.usda',
        content: '#usda 1.0\n( references = @./SimpleRoom/simple_room.usd@ )',
        blobUrl: undefined,
        format: 'usd',
      },
      {
        name: 'Simple_Room/SimpleRoom/simple_room.usd',
        content: 'PXR-USDC\u0000binary-root',
        blobUrl: 'blob:simple-room-root',
        format: 'usd',
      },
      {
        name: 'Simple_Room/Props/SM_TowelRoom01.usd',
        content: 'PXR-USDC\u0000binary-prop',
        blobUrl: 'blob:towel-room',
        format: 'usd',
      },
      {
        name: 'Simple_Room/Props/Textures/TowelRoom_BaseColor.png',
        content: '',
        blobUrl: 'blob:towel-room-texture',
        format: 'asset',
      },
    ],
    {
      'Simple_Room/SimpleRoom/simple_room.usd': 'blob:simple-room-root',
      'Simple_Room/Props/SM_TowelRoom01.usd': 'blob:towel-room',
      'Simple_Room/Props/Textures/TowelRoom_BaseColor.png': 'blob:towel-room-texture',
    },
    { includeAllAvailableFiles: true },
  );

  assert.deepEqual(
    preloadEntries.map((entry) => entry.path).sort(),
    [
      '/Simple_Room/Props/SM_TowelRoom01.usd',
      '/Simple_Room/Props/Textures/TowelRoom_BaseColor.png',
      '/Simple_Room/SimpleRoom/simple_room.usd',
      '/Simple_Room/scene.usda',
    ],
  );
});
