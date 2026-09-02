import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TextureRegistry,
  detectTextureMimeTypeFromBytes,
  inferTextureMimeTypeFromPath,
} from './TextureRegistry.js';

function installWindowMock() {
  const originalWindow = globalThis.window;
  globalThis.window = {
    location: {
      search: '',
    },
  };

  return () => {
    if (originalWindow === undefined) {
      delete globalThis.window;
      return;
    }
    globalThis.window = originalWindow;
  };
}

function installObjectUrlMocks() {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const createdUrls = [];
  const createdBlobs = [];
  const revokedUrls = [];

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: (blob) => {
      const nextUrl = `blob:texture-${createdUrls.length + 1}`;
      createdUrls.push(nextUrl);
      createdBlobs.push(blob);
      return nextUrl;
    },
  });

  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: (url) => {
      revokedUrls.push(String(url || ''));
    },
  });

  return {
    createdUrls,
    createdBlobs,
    revokedUrls,
    restore: () => {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        writable: true,
        value: originalCreateObjectURL,
      });
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        writable: true,
        value: originalRevokeObjectURL,
      });
    },
  };
}

function createTextureRegistryForTest(bytes = Uint8Array.from([1, 2, 3, 4])) {
  return new TextureRegistry({
    paths: {},
    driver: () => ({
      getFile: (_resourcePath, callback) => {
        callback(bytes);
      },
    }),
  });
}

test('detectTextureMimeTypeFromBytes identifies common texture signatures', () => {
  assert.equal(
    detectTextureMimeTypeFromBytes(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/png',
  );
  assert.equal(
    detectTextureMimeTypeFromBytes(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])),
    'image/jpeg',
  );
  assert.equal(
    detectTextureMimeTypeFromBytes(Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    ])),
    'image/webp',
  );
  assert.equal(detectTextureMimeTypeFromBytes(Uint8Array.from([1, 2, 3, 4])), undefined);
});

test('inferTextureMimeTypeFromPath handles case-insensitive extensions', () => {
  assert.equal(inferTextureMimeTypeFromPath('textures/base.PNG'), 'image/png');
  assert.equal(inferTextureMimeTypeFromPath('textures/base.JPEG'), 'image/jpeg');
  assert.equal(inferTextureMimeTypeFromPath('textures/base.webp'), 'image/webp');
  assert.equal(inferTextureMimeTypeFromPath('textures/base.bin'), undefined);
});

test('TextureRegistry corrects a JPEG texture mislabeled with a PNG extension', async () => {
  const restoreWindow = installWindowMock();
  const objectUrls = installObjectUrlMocks();
  try {
    const registry = createTextureRegistryForTest(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]));
    registry.loader = {
      load(url, onLoad) {
        onLoad({ loadedFrom: url });
      },
    };

    await registry.getTexture('textures/base_color.png');

    assert.equal(objectUrls.createdBlobs[0]?.type, 'image/jpeg');
    assert.equal(registry.getTextureLoadSnapshot().mimeCorrected, 1);
    assert.equal(registry.getTextureLoadSnapshot().recent[0]?.mimeCorrected, true);
  } finally {
    objectUrls.restore();
    restoreWindow();
  }
});

test('TextureRegistry normalizes worker ImageBitmaps through OffscreenCanvas', async () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalOffscreenCanvas = globalThis.OffscreenCanvas;
  const objectUrls = installObjectUrlMocks();
  let drawCount = 0;
  let closeCount = 0;
  class FakeOffscreenCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return {
        drawImage() {
          drawCount += 1;
        },
      };
    }
  }
  globalThis.createImageBitmap = async () => ({
    width: 8,
    height: 4,
    close() {
      closeCount += 1;
    },
  });
  globalThis.OffscreenCanvas = FakeOffscreenCanvas;
  try {
    const registry = createTextureRegistryForTest(
      Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]),
    );
    const texture = await registry.getTexture('textures/base_color.png');

    assert.equal(texture.isTexture, true);
    assert.equal(texture.image.width, 8);
    assert.equal(texture.image.height, 4);
    assert.equal(texture.flipY, true);
    assert.equal(drawCount, 1);
    assert.equal(closeCount, 1);
  } finally {
    if (originalCreateImageBitmap === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = originalCreateImageBitmap;
    if (originalOffscreenCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = originalOffscreenCanvas;
    objectUrls.restore();
  }
});

test('TextureRegistry revokes blob object URL after successful texture load', async () => {
  const restoreWindow = installWindowMock();
  const objectUrls = installObjectUrlMocks();
  try {
    const registry = createTextureRegistryForTest();
    registry.loader = {
      load(url, onLoad) {
        onLoad({ loadedFrom: url });
      },
    };

    const texture = await registry.getTexture('textures/base_color.png');

    assert.equal(texture.name, 'textures/base_color.png');
    assert.deepEqual(objectUrls.createdUrls, ['blob:texture-1']);
    assert.deepEqual(objectUrls.revokedUrls, ['blob:texture-1']);
  } finally {
    objectUrls.restore();
    restoreWindow();
  }
});

test('TextureRegistry revokes blob object URL after failed texture load', async () => {
  const restoreWindow = installWindowMock();
  const objectUrls = installObjectUrlMocks();
  try {
    const registry = createTextureRegistryForTest();
    registry.loader = {
      load(_url, _onLoad, _onProgress, onError) {
        onError(new Error('texture decode failed'));
      },
    };

    await assert.rejects(
      registry.getTexture('textures/base_color.png'),
      /texture decode failed/,
    );

    assert.deepEqual(objectUrls.createdUrls, ['blob:texture-1']);
    assert.deepEqual(objectUrls.revokedUrls, ['blob:texture-1']);
  } finally {
    objectUrls.restore();
    restoreWindow();
  }
});
