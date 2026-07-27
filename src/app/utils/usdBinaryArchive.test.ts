import test from 'node:test';
import assert from 'node:assert/strict';

import {
  convertUsdArchiveFilesToBinary,
  type BinaryReadyUsdRuntime,
} from './usdBinaryArchive.ts';

type FakeFsData = Uint8Array;

function createFakeUsdRuntime(
  options: {
    disableLayerExport?: boolean;
    failLayerExport?: boolean;
    failStageExport?: boolean;
  } = {},
) {
  const files = new Map<string, FakeFsData>();
  const layerFindOrOpenCalls: unknown[][] = [];
  const layerExportCalls: unknown[][] = [];
  const stageExportCalls: unknown[][] = [];
  const stageOpenCalls: unknown[][] = [];

  const runtime = {
    USD: {
      FS_createPath: () => {},
      FS_writeFile: (filePath: string, data: string | ArrayLike<number> | ArrayBufferView) => {
        if (typeof data === 'string') {
          files.set(filePath, new TextEncoder().encode(data));
          return;
        }

        const view = ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
          : new Uint8Array(Array.from(data));
        files.set(filePath, view);
      },
      FS_readFile: (filePath: string) => files.get(filePath) ?? new Uint8Array(),
      FS_unlink: (filePath: string) => {
        files.delete(filePath);
      },
      flushPendingDeletes: () => {},
      SdfLayer: {
        FindOrOpen: (...args: unknown[]) => {
          layerFindOrOpenCalls.push(args);
          const [sourcePath] = args as [string];
          const sourceData = files.get(sourcePath);
          if (!sourceData) {
            return null;
          }

          if (options.disableLayerExport) {
            return {};
          }

          return {
            Export: (...exportArgs: unknown[]) => {
              layerExportCalls.push(exportArgs);
              if (options.failLayerExport) {
                throw new Error('layer export rejected');
              }
              const [targetPath] = exportArgs as [string];
              const nextData = new Uint8Array(sourceData.length + 12);
              nextData.set(new TextEncoder().encode('PXR-USDCROOT'));
              nextData.set(sourceData, 12);
              files.set(targetPath, nextData);
              return true;
            },
            delete: () => {},
          };
        },
      },
      UsdStage: {
        Open: (sourcePath: string) => {
          stageOpenCalls.push([sourcePath]);
          const sourceData = files.get(sourcePath);
          if (!sourceData) {
            return null;
          }

          return {
            Export: (...args: unknown[]) => {
              stageExportCalls.push(args);
              if (options.failStageExport) {
                throw new Error('stage export rejected');
              }
              const [targetPath] = args as [string];
              const nextData = new Uint8Array(sourceData.length + 12);
              nextData.set(new TextEncoder().encode('PXR-USDCFLAT'));
              nextData.set(sourceData, 12);
              files.set(targetPath, nextData);
            },
            delete: () => {},
          };
        },
      },
    },
  };

  return {
    runtime,
    layerFindOrOpenCalls,
    layerExportCalls,
    stageOpenCalls,
    stageExportCalls,
  };
}

test('convertUsdArchiveFilesToBinary exports each USD layer directly and leaves non-USD assets untouched', async () => {
  const previousDocument = globalThis.document;
  (globalThis as typeof globalThis & { document?: Document & object }).document =
    {} as unknown as Document & object;

  try {
    const usdLayer = new Blob(['#usda 1.0\n'], { type: 'text/plain;charset=utf-8' });
    const textureBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'application/octet-stream' });
    const archiveFiles = new Map<string, Blob>([
      ['robot/usd/robot.usd', usdLayer],
      ['robot/usd/assets/checker.png', textureBlob],
    ]);
    const progress: string[] = [];
    const {
      runtime,
      layerFindOrOpenCalls,
      layerExportCalls,
      stageOpenCalls,
      stageExportCalls,
    } = createFakeUsdRuntime();

    const converted = await convertUsdArchiveFilesToBinary(archiveFiles, {
      onProgress: ({ filePath }: { filePath: string }) => progress.push(filePath),
      loadRuntime: async () => runtime as unknown as BinaryReadyUsdRuntime,
    });

    assert.deepEqual(progress, ['robot/usd/robot.usd']);
    assert.equal(await converted.get('robot/usd/robot.usd')?.text(), 'PXR-USDCROOT#usda 1.0\n');
    assert.equal(converted.get('robot/usd/assets/checker.png'), textureBlob);
    assert.equal(stageOpenCalls.length, 0);
    assert.equal(stageExportCalls.length, 0);
    assert.equal(layerFindOrOpenCalls.length, 1);
    assert.equal(String(layerFindOrOpenCalls[0]?.[0]).endsWith('/robot/usd/robot.usd'), true);
    assert.deepEqual(layerFindOrOpenCalls[0]?.[1], {});
    assert.equal(layerExportCalls.length, 1);
    assert.equal(String(layerExportCalls[0]?.[0]).endsWith('/robot/usd/robot.usd'), true);
    assert.equal(layerExportCalls[0]?.[1], '');
    assert.deepEqual(layerExportCalls[0]?.[2], { format: 'usdc' });
  } finally {
    if (previousDocument === undefined) {
      Reflect.deleteProperty(globalThis, 'document');
    } else {
      (globalThis as typeof globalThis & { document?: object }).document = previousDocument;
    }
  }
});

test('convertUsdArchiveFilesToBinary preserves a layered archive and emits USDC magic for every USD sidecar', async () => {
  const previousDocument = globalThis.document;
  (globalThis as typeof globalThis & { document?: Document & object }).document =
    {} as unknown as Document & object;

  try {
    const layerPaths = [
      'robot/robot.usd',
      'robot/configuration/robot_base.usd',
      'robot/configuration/robot_physics.usd',
      'robot/configuration/robot_sensor.usd',
      'robot/configuration/robot_robot.usd',
    ];
    const textureBlob = new Blob([new Uint8Array([137, 80, 78, 71])], {
      type: 'image/png',
    });
    const archiveFiles = new Map<string, Blob>([
      ...layerPaths.map(
        (filePath, index) =>
          [filePath, new Blob([`#usda 1.0\n# layer ${index}\n`])] as const,
      ),
      ['robot/assets/body.png', textureBlob],
    ]);
    const { runtime, layerExportCalls } = createFakeUsdRuntime();

    const converted = await convertUsdArchiveFilesToBinary(archiveFiles, {
      loadRuntime: async () => runtime as unknown as BinaryReadyUsdRuntime,
    });

    assert.deepEqual(
      Array.from(converted.keys()).sort(),
      Array.from(archiveFiles.keys()).sort(),
    );
    assert.equal(layerExportCalls.length, layerPaths.length);
    for (const filePath of layerPaths) {
      const bytes = new Uint8Array(await converted.get(filePath)!.arrayBuffer());
      assert.equal(new TextDecoder('latin1').decode(bytes.slice(0, 8)), 'PXR-USDC');
    }
    assert.equal(converted.get('robot/assets/body.png'), textureBlob);
  } finally {
    if (previousDocument === undefined) {
      Reflect.deleteProperty(globalThis, 'document');
    } else {
      (globalThis as typeof globalThis & { document?: object }).document = previousDocument;
    }
  }
});

test('convertUsdArchiveFilesToBinary leaves explicitly authored USDA paths unchanged', async () => {
  const previousDocument = globalThis.document;
  (globalThis as typeof globalThis & { document?: Document & object }).document =
    {} as unknown as Document & object;

  try {
    const usdaLayer = new Blob(['#usda 1.0\n'], { type: 'text/plain;charset=utf-8' });
    const { runtime, layerExportCalls } = createFakeUsdRuntime();
    const converted = await convertUsdArchiveFilesToBinary(
      new Map([['robot/robot.usda', usdaLayer]]),
      {
        loadRuntime: async () => runtime as unknown as BinaryReadyUsdRuntime,
      },
    );

    assert.equal(converted.get('robot/robot.usda'), usdaLayer);
    assert.equal(layerExportCalls.length, 0);
  } finally {
    if (previousDocument === undefined) {
      Reflect.deleteProperty(globalThis, 'document');
    } else {
      (globalThis as typeof globalThis & { document?: object }).document = previousDocument;
    }
  }
});

test('convertUsdArchiveFilesToBinary preserves failed SdfLayer export causes', async () => {
  const previousDocument = globalThis.document;
  (globalThis as typeof globalThis & { document?: Document & object }).document =
    {} as unknown as Document & object;

  try {
    const usdLayer = new Blob(['#usda 1.0\n'], { type: 'text/plain;charset=utf-8' });
    const archiveFiles = new Map<string, Blob>([['robot/usd/robot.usd', usdLayer]]);
    const { runtime } = createFakeUsdRuntime({
      failLayerExport: true,
    });

    await assert.rejects(
      () =>
        convertUsdArchiveFilesToBinary(archiveFiles, {
          loadRuntime: async () => runtime as unknown as BinaryReadyUsdRuntime,
        }),
      (error: unknown) => {
        assert.match(String(error), /layer export rejected/);
        return true;
      },
    );
  } finally {
    if (previousDocument === undefined) {
      Reflect.deleteProperty(globalThis, 'document');
    } else {
      (globalThis as typeof globalThis & { document?: object }).document = previousDocument;
    }
  }
});

test('convertUsdArchiveFilesToBinary does not fall back to composed stage export', async () => {
  const previousDocument = globalThis.document;
  (globalThis as typeof globalThis & { document?: Document & object }).document =
    {} as unknown as Document & object;

  try {
    const usdLayer = new Blob(['#usda 1.0\n'], { type: 'text/plain;charset=utf-8' });
    const archiveFiles = new Map<string, Blob>([['robot/usd/robot.usd', usdLayer]]);
    const {
      runtime,
      layerExportCalls,
      stageOpenCalls,
      stageExportCalls,
    } = createFakeUsdRuntime({
      disableLayerExport: true,
    });

    await assert.rejects(
      () =>
        convertUsdArchiveFilesToBinary(archiveFiles, {
          loadRuntime: async () => runtime as unknown as BinaryReadyUsdRuntime,
        }),
      /SdfLayer\.FindOrOpen\/Export/i,
    );

    assert.equal(layerExportCalls.length, 0);
    assert.equal(stageOpenCalls.length, 0);
    assert.equal(stageExportCalls.length, 0);
  } finally {
    if (previousDocument === undefined) {
      Reflect.deleteProperty(globalThis, 'document');
    } else {
      (globalThis as typeof globalThis & { document?: object }).document = previousDocument;
    }
  }
});
