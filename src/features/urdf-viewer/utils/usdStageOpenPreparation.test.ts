import test from 'node:test';
import assert from 'node:assert/strict';

import { clearPreparedUsdStageOpenCache } from './preparedUsdStageOpenCache.ts';
import {
  buildCriticalUsdDependencyPaths,
  prepareUsdStageOpenDataCore,
  resolveUsdStageOpenPreparationConcurrency,
} from './usdStageOpenPreparationCore.ts';

test.afterEach(() => {
  clearPreparedUsdStageOpenCache();
});

test('buildCriticalUsdDependencyPaths infers configuration sublayers for Unitree roots', () => {
  assert.deepEqual(buildCriticalUsdDependencyPaths('/Go2/usd/go2.usd'), [
    '/Go2/usd/configuration/go2_description_base.usd',
    '/Go2/usd/configuration/go2_description_physics.usd',
    '/Go2/usd/configuration/go2_description_sensor.usd',
  ]);
});

test('buildCriticalUsdDependencyPaths prefers robot config for h1_2_handless', () => {
  assert.deepEqual(buildCriticalUsdDependencyPaths('/robots/h1_2_handless/usd/h1_2_handless.usd'), [
    '/robots/h1_2_handless/usd/configuration/h1_2_handless_base.usd',
    '/robots/h1_2_handless/usd/configuration/h1_2_handless_physics.usd',
    '/robots/h1_2_handless/usd/configuration/h1_2_handless_robot.usd',
  ]);
});

test('buildCriticalUsdDependencyPaths preserves usda configuration layers for Isaac-style roots', () => {
  assert.deepEqual(
    buildCriticalUsdDependencyPaths(
      '/test/unitree_ros_usda/go2_description/urdf/go2_description.usda',
    ),
    [
      '/test/unitree_ros_usda/go2_description/urdf/configuration/go2_description_base.usda',
      '/test/unitree_ros_usda/go2_description/urdf/configuration/go2_description_physics.usda',
      '/test/unitree_ros_usda/go2_description/urdf/configuration/go2_description_sensor.usda',
      '/test/unitree_ros_usda/go2_description/urdf/configuration/go2_description_robot.usda',
    ],
  );
});

test('resolveUsdStageOpenPreparationConcurrency caps worker preload fan-out at 10', () => {
  assert.equal(resolveUsdStageOpenPreparationConcurrency(64), 10);
  assert.equal(resolveUsdStageOpenPreparationConcurrency(1), 2);
});

test('prepareUsdStageOpenDataCore materializes preload blobs and keeps optional failures soft', async () => {
  const originalFetch = globalThis.fetch;
  const fetchCalls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fetchCalls.push(url);

    if (url === 'blob:go2-root') {
      return new Response(new Blob(['root-binary'], { type: 'application/octet-stream' }), {
        status: 200,
      });
    }

    if (url === 'blob:go2-base') {
      return new Response(new Blob(['base-binary'], { type: 'application/octet-stream' }), {
        status: 200,
      });
    }

    return new Response('missing', { status: 404 });
  }) as typeof fetch;

  try {
    const result = await prepareUsdStageOpenDataCore(
      {
        name: 'Go2/usd/go2.usd',
        content:
          '#usda 1.0\n(\n  subLayers = [@./configuration/go2_description_base.usd@, @./configuration/go2_description_sensor.usd@]\n)\n',
        blobUrl: undefined,
      },
      [
        {
          name: 'Go2/usd/go2.usd',
          content:
            '#usda 1.0\n(\n  subLayers = [@./configuration/go2_description_base.usd@, @./configuration/go2_description_sensor.usd@]\n)\n',
          blobUrl: undefined,
          format: 'usd',
        },
        {
          name: 'Go2/usd/configuration/go2_description_base.usd',
          content: '',
          blobUrl: undefined,
          format: 'usd',
        },
      ],
      {
        'Go2/usd/configuration/go2_description_base.usd': 'blob:go2-base',
        'Go2/usd/configuration/go2_description_sensor.usd': 'blob:missing-texture',
        'Go2/textures/body.png': 'blob:go2-texture',
      },
    );

    assert.equal(result.stageSourcePath, '/Go2/usd/go2.usd');
    assert.deepEqual(result.criticalDependencyPaths, [
      '/Go2/usd/configuration/go2_description_base.usd',
      '/Go2/usd/configuration/go2_description_physics.usd',
      '/Go2/usd/configuration/go2_description_sensor.usd',
    ]);
    assert.deepEqual(
      result.preloadFiles.map((entry) => ({
        path: entry.path,
        hasBlob: !!entry.blob,
        hasError: !!entry.error,
      })),
      [
        { path: '/Go2/usd/configuration/go2_description_base.usd', hasBlob: true, hasError: false },
        {
          path: '/Go2/usd/configuration/go2_description_sensor.usd',
          hasBlob: false,
          hasError: true,
        },
        { path: '/Go2/usd/go2.usd', hasBlob: true, hasError: false },
      ],
    );
    assert.deepEqual(fetchCalls.sort(), ['blob:go2-base', 'blob:missing-texture']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('prepareUsdStageOpenDataCore keeps Isaac-style USDA sidecars as critical dependencies', async () => {
  const result = await prepareUsdStageOpenDataCore(
    {
      name: 'test/unitree_ros_usda/go2_description/urdf/go2_description.usda',
      content: '#usda 1.0\n',
      blobUrl: undefined,
    },
    [
      {
        name: 'test/unitree_ros_usda/go2_description/urdf/go2_description.usda',
        content: '#usda 1.0\n',
        blobUrl: undefined,
        format: 'usd',
      },
      {
        name: 'test/unitree_ros_usda/go2_description/urdf/configuration/go2_description_base.usda',
        content: '#usda 1.0\n',
        blobUrl: undefined,
        format: 'usd',
      },
      {
        name: 'test/unitree_ros_usda/go2_description/urdf/configuration/go2_description_physics.usda',
        content: '#usda 1.0\n',
        blobUrl: undefined,
        format: 'usd',
      },
      {
        name: 'test/unitree_ros_usda/go2_description/urdf/configuration/go2_description_sensor.usda',
        content: '#usda 1.0\n',
        blobUrl: undefined,
        format: 'usd',
      },
      {
        name: 'test/unitree_ros_usda/go2_description/urdf/configuration/go2_description_robot.usda',
        content: '#usda 1.0\n',
        blobUrl: undefined,
        format: 'usd',
      },
    ],
    {},
  );

  assert.equal(
    result.stageSourcePath,
    '/test/unitree_ros_usda/go2_description/urdf/go2_description.usda',
  );
  assert.deepEqual(result.criticalDependencyPaths, [
    '/test/unitree_ros_usda/go2_description/urdf/configuration/go2_description_base.usda',
    '/test/unitree_ros_usda/go2_description/urdf/configuration/go2_description_physics.usda',
    '/test/unitree_ros_usda/go2_description/urdf/configuration/go2_description_sensor.usda',
    '/test/unitree_ros_usda/go2_description/urdf/configuration/go2_description_robot.usda',
  ]);
});

test('prepareUsdStageOpenDataCore normalizes invisible top-level visuals scopes for instanceable USDA references', async () => {
  const baseLayerSource = `#usda 1.0
def Xform "b2_description"
{
    def Xform "base_link"
    {
        def Xform "visuals" (
            instanceable = true
            prepend references = </visuals/base_link>
        )
        {
        }
    }
}

def Scope "visuals"
{
    token visibility = "invisible"

    def Xform "base_link"
    {
        def Xform "mesh_0"
        {
            uniform token purpose = "guide"
        }
    }
}
`;

  const result = await prepareUsdStageOpenDataCore(
    {
      name: 'test/unitree_ros_usda/b2_description_mujoco/xml/b2_description.usda',
      content: '#usda 1.0\n',
      blobUrl: undefined,
    },
    [
      {
        name: 'test/unitree_ros_usda/b2_description_mujoco/xml/b2_description.usda',
        content: '#usda 1.0\n',
        blobUrl: undefined,
        format: 'usd',
      },
      {
        name: 'test/unitree_ros_usda/b2_description_mujoco/xml/configuration/b2_description_base.usda',
        content: baseLayerSource,
        blobUrl: undefined,
        format: 'usd',
      },
    ],
    {},
  );

  const baseLayerEntry = result.preloadFiles.find(
    (entry) =>
      entry.path ===
      '/test/unitree_ros_usda/b2_description_mujoco/xml/configuration/b2_description_base.usda',
  );

  assert.ok(baseLayerEntry?.bytes instanceof Uint8Array);

  const normalizedSource = new TextDecoder().decode(baseLayerEntry!.bytes!);
  assert.match(normalizedSource, /token visibility = "inherited"/);
  assert.match(normalizedSource, /uniform token purpose = "render"/);
  assert.doesNotMatch(normalizedSource, /token visibility = "invisible"/);
  assert.doesNotMatch(normalizedSource, /token purpose = "guide"/);
});

test('prepareUsdStageOpenDataCore normalizes textual .usd sidecars with USDA content', async () => {
  const baseLayerSource = `#usda 1.0
def Xform "demo"
{
    def Xform "base_link"
    {
        def Xform "visuals" (
            instanceable = true
            prepend references = </visuals/base_link>
        )
        {
        }
    }
}

def Scope "visuals"
{
    token visibility = "invisible"

    def Xform "base_link"
    {
        def Xform "mesh_0"
        {
            uniform token purpose = "guide"
        }
    }
}
`;

  const result = await prepareUsdStageOpenDataCore(
    {
      name: 'robots/demo/usd/demo.usd',
      content: '#usda 1.0\n(\n  subLayers = [@./configuration/demo_base.usd@]\n)\n',
      blobUrl: undefined,
    },
    [
      {
        name: 'robots/demo/usd/demo.usd',
        content: '#usda 1.0\n(\n  subLayers = [@./configuration/demo_base.usd@]\n)\n',
        blobUrl: undefined,
        format: 'usd',
      },
      {
        name: 'robots/demo/usd/configuration/demo_base.usd',
        content: baseLayerSource,
        blobUrl: undefined,
        format: 'usd',
      },
    ],
    {},
  );

  const baseLayerEntry = result.preloadFiles.find(
    (entry) => entry.path === '/robots/demo/usd/configuration/demo_base.usd',
  );

  assert.ok(baseLayerEntry?.bytes instanceof Uint8Array);

  const normalizedSource = new TextDecoder().decode(baseLayerEntry!.bytes!);
  assert.match(normalizedSource, /token visibility = "inherited"/);
  assert.match(normalizedSource, /uniform token purpose = "render"/);
  assert.doesNotMatch(normalizedSource, /token visibility = "invisible"/);
  assert.doesNotMatch(normalizedSource, /token purpose = "guide"/);
});

test('prepareUsdStageOpenDataCore skips full USDA text decoding when normalization triggers are absent', async () => {
  const originalBlobText = Blob.prototype.text;
  let textDecodeCount = 0;

  Blob.prototype.text = async function patchedBlobText(this: Blob): Promise<string> {
    textDecodeCount += 1;
    return await originalBlobText.call(this);
  };

  try {
    const result = await prepareUsdStageOpenDataCore(
      {
        name: 'robots/demo/usd/root.usd',
        content: '#usda 1.0\n(\n  subLayers = [@./configuration/demo_base.usda@]\n)\n',
        blobUrl: undefined,
      },
      [
        {
          name: 'robots/demo/usd/root.usd',
          content: '#usda 1.0\n(\n  subLayers = [@./configuration/demo_base.usda@]\n)\n',
          blobUrl: undefined,
          format: 'usd',
        },
        {
          name: 'robots/demo/usd/configuration/demo_base.usda',
          content: `#usda 1.0
def Scope "visuals"
{
    token visibility = "invisible"
}
`,
          blobUrl: undefined,
          format: 'usd',
        },
      ],
      {},
    );

    const baseLayerEntry = result.preloadFiles.find(
      (entry) => entry.path === '/robots/demo/usd/configuration/demo_base.usda',
    );

    assert.ok(baseLayerEntry?.bytes instanceof Uint8Array);
    assert.equal(textDecodeCount, 0);
  } finally {
    Blob.prototype.text = originalBlobText;
  }
});

test('prepareUsdStageOpenDataCore reuses normalized USDA sidecars across different root stages', async () => {
  const originalFetch = globalThis.fetch;
  let baseFetchCount = 0;
  const sharedBaseLayerSource = `#usda 1.0
def Xform "Robot"
{
    def Xform "base_link"
    {
        def Xform "visuals" (
            instanceable = true
            prepend references = </visuals/base_link>
        )
        {
        }
    }
}

def Scope "visuals"
{
    token visibility = "invisible"

    def Xform "base_link"
    {
        def Xform "mesh_0"
        {
            uniform token purpose = "guide"
        }
    }
}
`;

  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'blob:shared-base-layer') {
        baseFetchCount += 1;
        return new Response(sharedBaseLayerSource, { status: 200 });
      }
      return new Response('missing', { status: 404 });
    }) as typeof fetch;

    const firstResult = await prepareUsdStageOpenDataCore(
      {
        name: 'robots/demo/usd/root_a.usd',
        content: '#usda 1.0\n(\n  subLayers = [@./configuration/shared_base.usda@]\n)\n',
        blobUrl: undefined,
      },
      [
        {
          name: 'robots/demo/usd/root_a.usd',
          content: '#usda 1.0\n(\n  subLayers = [@./configuration/shared_base.usda@]\n)\n',
          blobUrl: undefined,
          format: 'usd',
        },
        {
          name: 'robots/demo/usd/configuration/shared_base.usda',
          content: '',
          blobUrl: undefined,
          format: 'usd',
        },
      ],
      {
        'robots/demo/usd/configuration/shared_base.usda': 'blob:shared-base-layer',
      },
    );

    const secondResult = await prepareUsdStageOpenDataCore(
      {
        name: 'robots/demo/usd/root_b.usd',
        content: '#usda 1.0\n(\n  subLayers = [@./configuration/shared_base.usda@]\n)\n',
        blobUrl: undefined,
      },
      [
        {
          name: 'robots/demo/usd/root_b.usd',
          content: '#usda 1.0\n(\n  subLayers = [@./configuration/shared_base.usda@]\n)\n',
          blobUrl: undefined,
          format: 'usd',
        },
        {
          name: 'robots/demo/usd/configuration/shared_base.usda',
          content: '',
          blobUrl: undefined,
          format: 'usd',
        },
      ],
      {
        'robots/demo/usd/configuration/shared_base.usda': 'blob:shared-base-layer',
      },
    );

    assert.ok(
      firstResult.preloadFiles.some(
        (entry) =>
          entry.path === '/robots/demo/usd/configuration/shared_base.usda' &&
          entry.bytes instanceof Uint8Array,
      ),
    );
    assert.ok(
      secondResult.preloadFiles.some(
        (entry) =>
          entry.path === '/robots/demo/usd/configuration/shared_base.usda' &&
          entry.bytes instanceof Uint8Array,
      ),
    );
    assert.equal(baseFetchCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
