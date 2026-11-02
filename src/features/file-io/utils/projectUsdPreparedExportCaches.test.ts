import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

import { GeometryType, type UsdPreparedExportCache } from '@/types';
import { PROJECT_USD_PREPARED_EXPORT_CACHES_FILE } from './projectArchive';
import {
  buildUsdPreparedExportCacheEntries,
  readUsdPreparedExportCaches,
  writeUsdPreparedExportCaches,
} from './projectUsdPreparedExportCaches';

function createPreparedCache(stageSourcePath: string): UsdPreparedExportCache {
  return {
    stageSourcePath,
    robotData: {
      name: 'usd_robot',
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
            meshPath: 'base_link_visual_0.obj',
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
      materials: {
        blue: { color: '#0088ff' },
      },
      closedLoopConstraints: [],
    },
    meshFiles: {
      'base_link_visual_0.obj': new Blob(
        ['o mesh\nv 0 0 0\nf 1 1 1\n'],
        { type: 'text/plain;charset=utf-8' },
      ),
    },
  };
}

test('write/read USD prepared export caches roundtrip through project zip', async () => {
  const zip = new JSZip();
  const caches = {
    'robots/demo/demo.usd': createPreparedCache('/robots/demo/demo.usd'),
    'robots/alt/alt.usd': createPreparedCache('/robots/alt/alt.usd'),
  };

  await writeUsdPreparedExportCaches(zip, caches);

  const manifestContent = await zip.file(PROJECT_USD_PREPARED_EXPORT_CACHES_FILE)?.async('string');
  assert.ok(manifestContent);

  const roundtripZip = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }));
  const restored = await readUsdPreparedExportCaches(roundtripZip);

  assert.deepEqual(Object.keys(restored).sort(), ['robots/alt/alt.usd', 'robots/demo/demo.usd']);
  assert.deepEqual(restored['robots/demo/demo.usd'].robotData.materials, caches['robots/demo/demo.usd'].robotData.materials);
  assert.deepEqual(
    restored['robots/demo/demo.usd'].robotData.closedLoopConstraints,
    caches['robots/demo/demo.usd'].robotData.closedLoopConstraints,
  );

  const restoredMesh = restored['robots/demo/demo.usd'].meshFiles['base_link_visual_0.obj'];
  assert.ok(restoredMesh);
  assert.equal(
    await restoredMesh.text(),
    await caches['robots/demo/demo.usd'].meshFiles['base_link_visual_0.obj'].text(),
  );
});

test('project zip keeps two USD prepared caches in a folder with a literal question mark', async () => {
  const paths = ['robots/demo?view/left.usda', 'robots/demo?view/right.usdc'];
  const caches = Object.fromEntries(paths.map((path) => [path, createPreparedCache(`/${path}`)]));
  const zip = new JSZip();
  await writeUsdPreparedExportCaches(zip, caches);

  const reopened = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }));
  const restored = await readUsdPreparedExportCaches(reopened);
  assert.deepEqual(Object.keys(restored).sort(), paths);
  for (const path of paths) {
    assert.equal(restored[path].stageSourcePath, `/${path}`);
  }
});

test('USD prepared cache JSON normalizes typed material arrays for roundtrip', async () => {
  const zip = new JSZip();
  const cache = createPreparedCache('/robots/demo/demo.usd');
  cache.robotData.materials!.blue!.usdMaterial = {
    color: new Float32Array([0.25, 0.5, 0.75]),
  };

  await writeUsdPreparedExportCaches(zip, { 'robots/demo/demo.usd': cache });
  const restored = await readUsdPreparedExportCaches(zip);

  assert.deepEqual(
    restored['robots/demo/demo.usd']!.robotData.materials!.blue!.usdMaterial!.color,
    [0.25, 0.5, 0.75],
  );
});

test('writeUsdPreparedExportCaches skips manifest creation when no caches exist', async () => {
  const zip = new JSZip();
  await writeUsdPreparedExportCaches(zip, {});

  assert.equal(zip.file(PROJECT_USD_PREPARED_EXPORT_CACHES_FILE), null);
  assert.deepEqual(await readUsdPreparedExportCaches(zip), {});
});

test('buildUsdPreparedExportCacheEntries preserves mesh blobs for deferred archive compression', async () => {
  const caches = {
    'robots/demo/demo.usd': createPreparedCache('/robots/demo/demo.usd'),
  };

  const archiveEntries = await buildUsdPreparedExportCacheEntries(caches);
  const meshEntry = archiveEntries.get(
    'workspace/usd-prepared-export-caches/cache-1/meshes/base_link_visual_0.obj',
  );

  assert.ok(meshEntry instanceof Blob, 'expected prepared export mesh entry to remain a Blob');
  assert.equal(
    await meshEntry.text(),
    await caches['robots/demo/demo.usd'].meshFiles['base_link_visual_0.obj'].text(),
  );
});

test('readUsdPreparedExportCaches fails fast on missing referenced cache data', async () => {
  const zip = new JSZip();
  await writeUsdPreparedExportCaches(zip, {
    'robots/demo/demo.usd': createPreparedCache('/robots/demo/demo.usd'),
  });
  const manifest = JSON.parse(
    await zip.file(PROJECT_USD_PREPARED_EXPORT_CACHES_FILE)!.async('string'),
  ) as Array<{ cacheFile: string }>;
  zip.remove(manifest[0].cacheFile);

  await assert.rejects(
    readUsdPreparedExportCaches(zip, PROJECT_USD_PREPARED_EXPORT_CACHES_FILE),
    /missing required USD prepared cache/i,
  );
});

test('readUsdPreparedExportCaches rejects malformed cache manifests', async () => {
  const zip = new JSZip();
  zip.file(PROJECT_USD_PREPARED_EXPORT_CACHES_FILE, JSON.stringify([
    {
      stageSourcePath: '/robots/demo/demo.usd',
      cacheFile: '../cache.json',
    },
  ]));

  await assert.rejects(
    readUsdPreparedExportCaches(zip, PROJECT_USD_PREPARED_EXPORT_CACHES_FILE),
    /cacheFile path.*invalid/i,
  );
});

test('readUsdPreparedExportCaches rejects malformed nested RobotData before restoring a cache', async () => {
  const zip = new JSZip();
  await writeUsdPreparedExportCaches(zip, {
    'robots/demo/demo.usd': createPreparedCache('/robots/demo/demo.usd'),
  });
  const manifest = JSON.parse(
    await zip.file(PROJECT_USD_PREPARED_EXPORT_CACHES_FILE)!.async('string'),
  ) as Array<{ cacheFile: string }>;
  const cacheFile = manifest[0]!.cacheFile;
  const payload = JSON.parse(await zip.file(cacheFile)!.async('string')) as {
    robotData: {
      links: Record<string, { visual: { authoredMaterials?: unknown } }>;
    };
  };
  payload.robotData.links.base_link!.visual.authoredMaterials = {};
  zip.file(cacheFile, JSON.stringify(payload));

  await assert.rejects(
    readUsdPreparedExportCaches(zip, PROJECT_USD_PREPARED_EXPORT_CACHES_FILE),
    /robotData\.links\.base_link\.visual\.authoredMaterials/i,
  );
});
