#!/usr/bin/env node

/**
 * MuJoCo/MJCF snapshot preview browser regression test.
 *
 * Covers the snapshot dialog's live preview for direct MJCF files and scene
 * files with includes. The assertions focus on the user-visible failures:
 * an empty preview canvas and a preview frame/canvas overflowing its card.
 */

import { setTimeout as delay } from 'node:timers/promises';
import zlib from 'node:zlib';

import {
  createSession,
  createTestSuite,
  assert,
  assertEqual,
  assertGreaterThan,
  importModel,
  waitForReady,
  writeReport,
  printSummary,
} from './helpers/mjcf-helpers.mjs';

const MODELS = [
  { label: 'Go2 direct MJCF', dir: 'unitree_go2', file: 'go2.xml', requireVisualMeshes: true },
  { label: 'Go2 scene include', dir: 'unitree_go2', file: 'scene.xml', requireVisualMeshes: true },
];

const SNAPSHOT_PREVIEW_TIMEOUT_MS = 45_000;
const RECT_EPSILON = 1.5;
const REQUIRED_VISUAL_MESHES = 10;
const MIN_HIGH_DPI_BACKING_RATIO = 1.45;
const MIN_CAMERA_DRAG_DELTA = 1e-4;
const MIN_CAMERA_PAN_DELTA = 1e-4;
const MIN_CAMERA_ZOOM_DISTANCE_DELTA = 1e-4;
const MAX_CAMERA_ASPECT_CHANGE_DELTA = 1e-5;
const MAX_MAIN_CAMERA_DELTA = 1e-8;
const MIN_PREVIEW_SCREENSHOT_LUMA_RANGE = 20;
const MIN_PREVIEW_SCREENSHOT_LUMA_STD_DEV = 2;
const MAX_PREVIEW_DRAG_RENDER_P95_MS = 50;

function basename(value) {
  return (
    String(value ?? '')
      .split('/')
      .filter(Boolean)
      .pop() ?? ''
  );
}

function rectInside(outer, inner, epsilon = RECT_EPSILON) {
  if (!outer || !inner) return false;
  return (
    inner.left >= outer.left - epsilon &&
    inner.right <= outer.right + epsilon &&
    inner.top >= outer.top - epsilon &&
    inner.bottom <= outer.bottom + epsilon
  );
}

async function readLoadState(page) {
  return page.evaluate(() => {
    const api = window.__URDF_STUDIO_DEBUG__;
    const snapshot = api?.getRegressionSnapshot?.() ?? null;
    const runtime = snapshot?.primaryRuntime ?? snapshot?.runtime ?? null;
    return {
      selectedFile: snapshot?.selectedFile ?? null,
      document: api?.getDocumentLoadState?.() ?? null,
      runtime: runtime
        ? {
            linkCount: Number(runtime.linkCount ?? 0),
            jointCount: Number(runtime.jointCount ?? 0),
            visualMeshCount: Number(runtime.visualMeshCount ?? 0),
            collisionMeshCount: Number(runtime.collisionMeshCount ?? 0),
          }
        : null,
    };
  });
}

async function waitForModelRuntime(page, { requireVisualMeshes }) {
  await page.waitForFunction(
    (needsVisualMeshes, requiredVisualMeshes) => {
      const api = window.__URDF_STUDIO_DEBUG__;
      const snapshot = api?.getRegressionSnapshot?.() ?? null;
      const runtime = snapshot?.primaryRuntime ?? snapshot?.runtime ?? null;
      const linkCount = Number(runtime?.linkCount ?? 0);
      const visualMeshCount = Number(runtime?.visualMeshCount ?? 0);
      return linkCount > 0 && (!needsVisualMeshes || visualMeshCount >= requiredVisualMeshes);
    },
    { timeout: SNAPSHOT_PREVIEW_TIMEOUT_MS },
    Boolean(requireVisualMeshes),
    REQUIRED_VISUAL_MESHES,
  );
}

async function openSnapshotDialog(page) {
  await page.evaluate(() => {
    globalThis.__URDF_STUDIO_FIND_SNAPSHOT_BUTTON__ = () => {
      const buttons = [...document.querySelectorAll('button')];
      const buttonStates = buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        const style = window.getComputedStyle(button);
        const text = button.textContent ?? '';
        const label = button.getAttribute('aria-label') ?? '';
        const title = button.getAttribute('title') ?? '';
        const matches = /Snapshot|快照/i.test(`${text} ${label} ${title}`);
        const visible =
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none';
        return {
          button,
          matches,
          visible,
          disabled: button.disabled,
          text: text.trim(),
          label,
          title,
        };
      });
      return {
        button: buttonStates.find((state) => state.matches && state.visible && !state.disabled)
          ?.button,
        moreButton: buttonStates.find(
          (state) =>
            /More|更多/i.test(`${state.text} ${state.label} ${state.title}`) &&
            state.visible &&
            !state.disabled,
        )?.button,
        buttonStates: buttonStates
          .filter((state) => state.matches)
          .map(({ button: _button, ...state }) => state),
      };
    };
  });

  let lastButtonStates = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.waitForFunction(
      () => {
        const result = globalThis.__URDF_STUDIO_FIND_SNAPSHOT_BUTTON__?.();
        return Boolean(result.button || result.moreButton);
      },
      { timeout: SNAPSHOT_PREVIEW_TIMEOUT_MS },
    );
    await page.evaluate(() => {
      const { button, moreButton } =
        globalThis.__URDF_STUDIO_FIND_SNAPSHOT_BUTTON__?.() ?? {};
      if (!button && moreButton instanceof HTMLButtonElement) {
        moreButton.click();
      }
    });
    await delay(150);
    await page.waitForFunction(
      () => {
        return Boolean(globalThis.__URDF_STUDIO_FIND_SNAPSHOT_BUTTON__?.().button);
      },
      { timeout: SNAPSHOT_PREVIEW_TIMEOUT_MS },
    );
    const result = await page.evaluate(() => {
      const { button, buttonStates } =
        globalThis.__URDF_STUDIO_FIND_SNAPSHOT_BUTTON__?.() ?? { buttonStates: [] };
      if (!(button instanceof HTMLButtonElement)) {
        return { clicked: false, buttonStates };
      }
      button.scrollIntoView({ block: 'center', inline: 'center' });
      button.click();
      return { clicked: true, buttonStates };
    });
    lastButtonStates = result.buttonStates ?? [];

    if (!result.clicked) {
      await delay(500);
      continue;
    }

    const opened = await page
      .waitForSelector('[data-testid="snapshot-preview-card"]', {
        timeout: Math.min(SNAPSHOT_PREVIEW_TIMEOUT_MS, 10_000),
      })
      .then(() => true)
      .catch(() => false);
    if (opened) {
      break;
    }
    if (attempt === 3) {
      throw new Error(
        `Snapshot dialog did not open. Button states: ${JSON.stringify(lastButtonStates)}`,
      );
    }
  }

  const waitForSnapshotPreviewReady = () =>
    page.waitForFunction(
      () => {
        const card = document.querySelector('[data-testid="snapshot-preview-card"]');
        const frame = document.querySelector('[data-testid="snapshot-preview-frame"]');
        const canvasHost = document.querySelector('[data-testid="snapshot-preview-canvas"]');
        const canvas = document.querySelector('[data-testid="snapshot-preview-canvas"] canvas');
        if (!card || !frame || !(canvas instanceof HTMLCanvasElement)) {
          return false;
        }

        const frameRect = frame.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        const statusText = card.textContent ?? '';
        const ready = /Preview ready|预览已就绪/.test(statusText);
        const runtimeRevision =
          canvasHost instanceof HTMLElement ? Number(canvasHost.dataset.runtimeRevision ?? 0) : 0;
        const interactive =
          canvasHost instanceof HTMLElement
            ? canvasHost.dataset.previewInteractive === 'true'
            : false;
        return (
          ready &&
          interactive &&
          runtimeRevision > 0 &&
          frameRect.width >= 120 &&
          frameRect.height >= 100 &&
          canvasRect.width >= 120 &&
          canvasRect.height >= 100 &&
          canvas.width > 0 &&
          canvas.height > 0
        );
      },
      { timeout: SNAPSHOT_PREVIEW_TIMEOUT_MS },
    );

  await waitForSnapshotPreviewReady();
  await delay(1_200);
  await waitForSnapshotPreviewReady();
}

async function closeSnapshotDialog(page) {
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')];
    const closeButton =
      buttons.find((button) => /Close|关闭/i.test(button.getAttribute('aria-label') ?? '')) ??
      buttons.find((button) => (button.textContent ?? '').trim() === '×');
    if (closeButton instanceof HTMLButtonElement) {
      closeButton.click();
    }
  });
  await page
    .waitForSelector('[data-testid="snapshot-preview-card"]', {
      hidden: true,
      timeout: 5_000,
    })
    .catch(() => undefined);
}

async function readSnapshotPreviewLayout(page) {
  return page.evaluate(() => {
    const readRect = (element) => {
      if (!(element instanceof Element)) return null;
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };

    const readBox = (selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        return null;
      }
      const style = window.getComputedStyle(element);
      return {
        rect: readRect(element),
        clientWidth: element.clientWidth,
        clientHeight: element.clientHeight,
        scrollWidth: element.scrollWidth,
        scrollHeight: element.scrollHeight,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        runtimeLoaded: element.dataset.runtimeLoaded ?? null,
        runtimeRevision: Number(element.dataset.runtimeRevision ?? 0),
        interactive: element.dataset.previewInteractive ?? null,
        text: element.textContent ?? '',
      };
    };

    const canvas = document.querySelector('[data-testid="snapshot-preview-canvas"] canvas');
    const canvasRect = readRect(canvas);
    let sample = null;

    if (
      canvas instanceof HTMLCanvasElement &&
      canvasRect &&
      canvas.width > 0 &&
      canvas.height > 0
    ) {
      try {
        const sampleCanvas = document.createElement('canvas');
        const sampleSize = 48;
        sampleCanvas.width = sampleSize;
        sampleCanvas.height = sampleSize;
        const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
        if (context) {
          context.drawImage(canvas, 0, 0, sampleSize, sampleSize);
          const pixels = context.getImageData(0, 0, sampleSize, sampleSize).data;
          let min = 255;
          let max = 0;
          let sum = 0;
          const lumas = [];
          for (let index = 0; index < pixels.length; index += 4) {
            const r = pixels[index] ?? 0;
            const g = pixels[index + 1] ?? 0;
            const b = pixels[index + 2] ?? 0;
            const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            lumas.push(luma);
            sum += luma;
            min = Math.min(min, luma);
            max = Math.max(max, luma);
          }
          const mean = sum / Math.max(1, lumas.length);
          const variance =
            lumas.reduce((total, luma) => total + (luma - mean) ** 2, 0) /
            Math.max(1, lumas.length);
          sample = {
            lumaRange: max - min,
            lumaStdDev: Math.sqrt(variance),
          };
        }
      } catch (error) {
        sample = {
          readError: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return {
      card: readBox('[data-testid="snapshot-preview-card"]'),
      shell: readBox('[data-testid="snapshot-preview-frame-shell"]'),
      frame: readBox('[data-testid="snapshot-preview-frame"]'),
      canvasHost: readBox('[data-testid="snapshot-preview-canvas"]'),
      canvas:
      canvas instanceof HTMLCanvasElement
          ? {
              rect: canvasRect,
              width: canvas.width,
              height: canvas.height,
              backingScaleX:
                canvasRect && canvasRect.width > 0 ? canvas.width / canvasRect.width : 0,
              backingScaleY:
                canvasRect && canvasRect.height > 0 ? canvas.height / canvasRect.height : 0,
            }
          : null,
      devicePixelRatio: window.devicePixelRatio || 1,
      sample,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    };
  });
}

async function readSnapshotPreviewOrbitState(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="snapshot-preview-canvas"] canvas');
    const scene = window.scene;
    const state = scene?.__r3f?.root?.getState?.() ?? null;
    const controls = state?.controls ?? null;
    const camera = state?.camera ?? null;
    const vector = (value) =>
      value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)
        ? [value.x, value.y, value.z]
        : null;

    return {
      hasR3fState: Boolean(state),
      rootCanvasIsPreview: Boolean(
        canvas instanceof HTMLCanvasElement && state?.gl?.domElement === canvas,
      ),
      controlsEnabled: controls?.enabled ?? null,
      controlsEnablePan: controls?.enablePan ?? null,
      controlsEnableRotate: controls?.enableRotate ?? null,
      controlsEnableZoom: controls?.enableZoom ?? null,
      controlsScreenSpacePanning: controls?.screenSpacePanning ?? null,
      controlsMouseButtons: controls?.mouseButtons ?? null,
      controlsTouches: controls?.touches ?? null,
      controlsDomIsCanvas: Boolean(
        canvas instanceof HTMLCanvasElement && controls?.domElement === canvas,
      ),
      cameraPosition: vector(camera?.position),
      cameraAspect:
        camera && Number.isFinite(camera.aspect) ? Number(camera.aspect) : null,
      target: vector(controls?.target),
      distance:
        camera?.position && controls?.target && typeof camera.position.distanceTo === 'function'
          ? camera.position.distanceTo(controls.target)
          : null,
    };
  });
}

async function installSnapshotPreviewRenderProbe(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="snapshot-preview-canvas"] canvas');
    const state = window.scene?.__r3f?.root?.getState?.() ?? null;
    const gl = state?.gl ?? null;

    if (
      !(canvas instanceof HTMLCanvasElement) ||
      gl?.domElement !== canvas ||
      typeof gl.render !== 'function'
    ) {
      return {
        installed: false,
        rootCanvasIsPreview: Boolean(
          canvas instanceof HTMLCanvasElement && state?.gl?.domElement === canvas,
        ),
        count: 0,
      };
    }

    if (!gl.__snapshotPreviewRenderProbe) {
      const originalRender = gl.render.bind(gl);
      const probe = {
        count: 0,
        times: [],
        durations: [],
        originalRender,
      };
      gl.render = (...args) => {
        const startedAt = performance.now();
        probe.count += 1;
        probe.times.push(startedAt);
        if (probe.times.length > 400) {
          probe.times.shift();
        }
        try {
          return originalRender(...args);
        } finally {
          probe.durations.push(performance.now() - startedAt);
          if (probe.durations.length > 400) {
            probe.durations.shift();
          }
        }
      };
      gl.__snapshotPreviewRenderProbe = probe;
    }

    return {
      installed: true,
      rootCanvasIsPreview: true,
      count: Number(gl.__snapshotPreviewRenderProbe.count ?? 0),
      timesLength: Number(gl.__snapshotPreviewRenderProbe.times?.length ?? 0),
      durationsLength: Number(gl.__snapshotPreviewRenderProbe.durations?.length ?? 0),
    };
  });
}

async function readSnapshotPreviewRenderProbe(page, durationStartIndex = 0) {
  return page.evaluate((rawDurationStartIndex) => {
    const canvas = document.querySelector('[data-testid="snapshot-preview-canvas"] canvas');
    const state = window.scene?.__r3f?.root?.getState?.() ?? null;
    const gl = state?.gl ?? null;
    const probe = gl?.__snapshotPreviewRenderProbe ?? null;
    const durationStartIndex = Math.max(0, Number(rawDurationStartIndex) || 0);
    const durations = Array.isArray(probe?.durations)
      ? probe.durations.slice(durationStartIndex).map(Number).filter(Number.isFinite)
      : [];
    const sortedDurations = [...durations].sort((left, right) => left - right);
    const durationSum = durations.reduce((total, value) => total + value, 0);

    return {
      installed: Boolean(probe),
      rootCanvasIsPreview: Boolean(
        canvas instanceof HTMLCanvasElement && state?.gl?.domElement === canvas,
      ),
      count: Number(probe?.count ?? 0),
      timesLength: Number(probe?.times?.length ?? 0),
      durationsLength: Number(probe?.durations?.length ?? 0),
      durationStats: {
        count: durations.length,
        averageMs: durations.length > 0 ? durationSum / durations.length : 0,
        maxMs: durations.length > 0 ? Math.max(...durations) : 0,
        p95Ms:
          sortedDurations.length > 0
            ? sortedDurations[
                Math.min(sortedDurations.length - 1, Math.floor(sortedDurations.length * 0.95))
              ]
            : 0,
      },
    };
  }, durationStartIndex);
}

function maxVectorDelta(before, after) {
  if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) {
    return 0;
  }

  return before.reduce(
    (maxDelta, value, index) => Math.max(maxDelta, Math.abs(Number(after[index]) - Number(value))),
    0,
  );
}

async function rememberMainWorkspaceRoot(page) {
  return page.evaluate(() => {
    const mainCanvas = [...document.querySelectorAll('canvas')].find(
      (canvas) => !canvas.closest('[data-testid="snapshot-preview-canvas"]'),
    );
    const currentRoot = window.scene?.__r3f?.root ?? null;
    const currentState = currentRoot?.getState?.() ?? null;

    if (
      mainCanvas instanceof HTMLCanvasElement &&
      currentRoot &&
      currentState?.gl?.domElement === mainCanvas
    ) {
      window.__SNAPSHOT_PREVIEW_MAIN_R3F_ROOT__ = currentRoot;
      return true;
    }

    const storedRoot = window.__SNAPSHOT_PREVIEW_MAIN_R3F_ROOT__ ?? null;
    const storedState = storedRoot?.getState?.() ?? null;
    return Boolean(
      mainCanvas instanceof HTMLCanvasElement && storedState?.gl?.domElement === mainCanvas,
    );
  });
}

async function readMainWorkspaceOrbitState(page) {
  return page.evaluate(() => {
    const root = window.__SNAPSHOT_PREVIEW_MAIN_R3F_ROOT__ ?? null;
    const state = root?.getState?.() ?? null;
    const controls = state?.controls ?? null;
    const camera = state?.camera ?? null;
    const vector = (value) =>
      value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)
        ? [value.x, value.y, value.z]
        : null;

    return {
      hasR3fState: Boolean(state),
      canvasConnected: Boolean(state?.gl?.domElement?.isConnected),
      cameraPosition: vector(camera?.position),
      target: vector(controls?.target),
      distance:
        camera?.position && controls?.target && typeof camera.position.distanceTo === 'function'
          ? camera.position.distanceTo(controls.target)
          : null,
    };
  });
}

function paethPredictor(left, up, upLeft) {
  const prediction = left + up - upLeft;
  const distanceLeft = Math.abs(prediction - left);
  const distanceUp = Math.abs(prediction - up);
  const distanceUpLeft = Math.abs(prediction - upLeft);

  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) {
    return left;
  }
  return distanceUp <= distanceUpLeft ? up : upLeft;
}

function decodePngScreenshot(bufferLike) {
  const buffer = Buffer.from(bufferLike);
  const signature = buffer.subarray(0, 8);
  if (!signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error('Screenshot is not a PNG image.');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let bitDepth = 0;
  const idatChunks = [];

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = buffer.subarray(dataStart, dataEnd);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }

    offset = dataEnd + 4;
  }

  if (bitDepth !== 8) {
    throw new Error(`Unsupported screenshot PNG bit depth: ${bitDepth}`);
  }

  const channelsByColorType = {
    0: 1,
    2: 3,
    4: 2,
    6: 4,
  };
  const channels = channelsByColorType[colorType];
  if (!channels) {
    throw new Error(`Unsupported screenshot PNG color type: ${colorType}`);
  }

  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const stride = width * channels;
  const pixels = new Uint8Array(height * stride);
  let sourceOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    const rowStart = y * stride;
    const previousRowStart = rowStart - stride;

    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[sourceOffset + x];
      const left = x >= channels ? pixels[rowStart + x - channels] : 0;
      const up = y > 0 ? pixels[previousRowStart + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[previousRowStart + x - channels] : 0;
      let value = raw;

      if (filter === 1) {
        value = raw + left;
      } else if (filter === 2) {
        value = raw + up;
      } else if (filter === 3) {
        value = raw + Math.floor((left + up) / 2);
      } else if (filter === 4) {
        value = raw + paethPredictor(left, up, upLeft);
      } else if (filter !== 0) {
        throw new Error(`Unsupported screenshot PNG filter: ${filter}`);
      }

      pixels[rowStart + x] = value & 0xff;
    }

    sourceOffset += stride;
  }

  return {
    width,
    height,
    channels,
    pixels,
  };
}

function analyzePngScreenshot(buffer) {
  const { width, height, channels, pixels } = decodePngScreenshot(buffer);
  let min = 255;
  let max = 0;
  let sum = 0;
  let sumSquares = 0;
  let darkPixelCount = 0;
  const totalPixels = width * height;

  for (let index = 0; index < pixels.length; index += channels) {
    const r = pixels[index] ?? 0;
    const g = channels >= 3 ? (pixels[index + 1] ?? r) : r;
    const b = channels >= 3 ? (pixels[index + 2] ?? r) : r;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    min = Math.min(min, luma);
    max = Math.max(max, luma);
    sum += luma;
    sumSquares += luma * luma;
    if (luma < 245) {
      darkPixelCount += 1;
    }
  }

  const mean = sum / Math.max(1, totalPixels);
  const variance = sumSquares / Math.max(1, totalPixels) - mean * mean;

  return {
    width,
    height,
    lumaRange: max - min,
    lumaStdDev: Math.sqrt(Math.max(0, variance)),
    meanLuma: mean,
    darkPixelCount,
    totalPixels,
  };
}

async function captureSnapshotPreviewScreenshotSample(page) {
  const capture = await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="snapshot-preview-canvas"] canvas');
    if (!(canvas instanceof HTMLCanvasElement)) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    const visibleLeft = Math.max(0, rect.left);
    const visibleTop = Math.max(0, rect.top);
    const visibleRight = Math.min(window.innerWidth, rect.right);
    const visibleBottom = Math.min(window.innerHeight, rect.bottom);

    if (
      visibleRight - visibleLeft < 24 ||
      visibleBottom - visibleTop < 24 ||
      canvas.width <= 0 ||
      canvas.height <= 0
    ) {
      return null;
    }

    try {
      const sceneRoot = window.scene?.__r3f?.root ?? null;
      const state = sceneRoot?.getState?.() ?? null;
      if (state?.gl?.domElement === canvas && state.scene && state.camera) {
        state.controls?.update?.();
        state.scene.updateMatrixWorld?.(true);
        state.camera.updateMatrixWorld?.(true);
        state.invalidate?.();
        state.gl.render(state.scene, state.camera);
      }

      return {
        rect: {
          left: visibleLeft,
          top: visibleTop,
          right: visibleRight,
          bottom: visibleBottom,
          width: visibleRight - visibleLeft,
          height: visibleBottom - visibleTop,
        },
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  if (!capture) {
    return {
      error: 'snapshot preview frame is not visible enough to sample',
    };
  }
  if (capture.error) {
    return {
      error: `snapshot preview canvas could not be sampled: ${capture.error}`,
    };
  }

  const buffer = await page.screenshot({
    type: 'png',
    captureBeyondViewport: false,
    clip: {
      x: capture.rect.left,
      y: capture.rect.top,
      width: capture.rect.width,
      height: capture.rect.height,
    },
  });

  return {
    clip: capture.rect,
    ...analyzePngScreenshot(buffer),
  };
}

async function evaluateSnapshotPreviewCanvas(page, evaluator) {
  const canvas = await page.$('[data-testid="snapshot-preview-canvas"] canvas');
  if (!canvas) {
    throw new Error('Snapshot preview canvas was not found.');
  }
  try {
    return await canvas.evaluate(evaluator);
  } finally {
    await canvas.dispose();
  }
}

async function measureSnapshotPreviewDrag(page) {
  const before = await readSnapshotPreviewOrbitState(page);
  const renderBefore = await installSnapshotPreviewRenderProbe(page);
  const drag = await evaluateSnapshotPreviewCanvas(
    page,
    (canvas) => {
      const rect = canvas.getBoundingClientRect();
      const visibleLeft = Math.max(0, rect.left);
      const visibleTop = Math.max(0, rect.top);
      const visibleRight = Math.min(window.innerWidth, rect.right);
      const visibleBottom = Math.min(window.innerHeight, rect.bottom);
      const visibleWidth = Math.max(0, visibleRight - visibleLeft);
      const visibleHeight = Math.max(0, visibleBottom - visibleTop);
      const margin = 8;
      const startX = visibleLeft + visibleWidth * 0.5;
      const startY = visibleTop + visibleHeight * 0.5;
      const maxDeltaX = Math.max(0, visibleRight - startX - margin);
      const maxDownDeltaY = Math.max(0, visibleBottom - startY - margin);
      const maxUpDeltaY = Math.max(0, startY - visibleTop - margin);
      const deltaX = Math.min(110, rect.width * 0.35, Math.max(16, maxDeltaX));
      const preferredDeltaY = Math.min(85, rect.height * 0.3, Math.max(0, maxDownDeltaY));
      const fallbackDeltaY = -Math.min(85, rect.height * 0.3, Math.max(0, maxUpDeltaY));
      const deltaY = preferredDeltaY >= 16 ? preferredDeltaY : fallbackDeltaY;

      return {
        x: startX,
        y: startY,
        endX: Math.min(visibleRight - margin, Math.max(visibleLeft + margin, startX + deltaX)),
        endY: Math.min(visibleBottom - margin, Math.max(visibleTop + margin, startY + deltaY)),
        width: rect.width,
        height: rect.height,
        visibleWidth,
        visibleHeight,
      };
    },
  );
  const probePromise = page.evaluate(
    (durationMs) =>
      new Promise((resolve) => {
        const frames = [];
        const start = performance.now();
        let last = start;

        const step = (now) => {
          frames.push(now - last);
          last = now;
          if (now - start >= durationMs) {
            const sorted = [...frames].sort((left, right) => left - right);
            const sum = frames.reduce((total, value) => total + value, 0);
            const percentile = (ratio) =>
              sorted.length === 0
                ? 0
                : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
            resolve({
              frameCount: frames.length,
              averageFrameMs: frames.length > 0 ? sum / frames.length : 0,
              maxFrameMs: frames.length > 0 ? Math.max(...frames) : 0,
              p95FrameMs: percentile(0.95),
              longFrameCount: frames.filter((value) => value > 50).length,
            });
            return;
          }
          requestAnimationFrame(step);
        };

        requestAnimationFrame(step);
      }),
    900,
  );
  await delay(50);
  await page.mouse.move(drag.x, drag.y);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(drag.endX, drag.endY, { steps: 28 });
  await page.mouse.up({ button: 'left' });
  await delay(120);
  const after = await readSnapshotPreviewOrbitState(page);
  const renderAfter = await readSnapshotPreviewRenderProbe(page, renderBefore.durationsLength ?? 0);
  const metrics = await probePromise;

  return {
    ...metrics,
    drag,
    before,
    after,
    renderBefore,
    renderAfter,
    renderCountDelta: Math.max(0, Number(renderAfter.count ?? 0) - Number(renderBefore.count ?? 0)),
    cameraPositionDelta: maxVectorDelta(before.cameraPosition, after.cameraPosition),
    targetDelta: maxVectorDelta(before.target, after.target),
  };
}

async function measureSnapshotPreviewPan(page) {
  const before = await readSnapshotPreviewOrbitState(page);
  const drag = await evaluateSnapshotPreviewCanvas(page, (canvas) => {
    const rect = canvas.getBoundingClientRect();
    const visibleLeft = Math.max(0, rect.left);
    const visibleTop = Math.max(0, rect.top);
    const visibleRight = Math.min(window.innerWidth, rect.right);
    const visibleBottom = Math.min(window.innerHeight, rect.bottom);
    const visibleWidth = Math.max(0, visibleRight - visibleLeft);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);
    const margin = 8;
    const startX = visibleLeft + visibleWidth * 0.5;
    const startY = visibleTop + visibleHeight * 0.5;
    const deltaX = Math.min(90, rect.width * 0.3, Math.max(16, visibleRight - startX - margin));

    return {
      x: startX,
      y: startY,
      endX: Math.min(visibleRight - margin, Math.max(visibleLeft + margin, startX + deltaX)),
      endY: Math.min(visibleBottom - margin, Math.max(visibleTop + margin, startY)),
    };
  });

  await delay(50);
  await page.mouse.move(drag.x, drag.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(drag.endX, drag.endY, { steps: 24 });
  await page.mouse.up({ button: 'right' });
  await delay(180);
  const after = await readSnapshotPreviewOrbitState(page);

  return {
    drag,
    before,
    after,
    cameraPositionDelta: maxVectorDelta(before.cameraPosition, after.cameraPosition),
    targetDelta: maxVectorDelta(before.target, after.target),
    distanceDelta: Number(after.distance ?? 0) - Number(before.distance ?? 0),
  };
}

async function measureSnapshotPreviewZoom(page) {
  const before = await readSnapshotPreviewOrbitState(page);
  const point = await evaluateSnapshotPreviewCanvas(page, (canvas) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(window.innerWidth - 8, Math.max(8, rect.left + rect.width * 0.5)),
      y: Math.min(window.innerHeight - 8, Math.max(8, rect.top + rect.height * 0.5)),
    };
  });

  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel({ deltaY: -450 });
  await delay(220);
  const after = await readSnapshotPreviewOrbitState(page);

  return {
    point,
    before,
    after,
    cameraPositionDelta: maxVectorDelta(before.cameraPosition, after.cameraPosition),
    targetDelta: maxVectorDelta(before.target, after.target),
    distanceDelta: Number(after.distance ?? 0) - Number(before.distance ?? 0),
  };
}

async function setSnapshotAspectPreset(page, preset) {
  await page.evaluate((nextPreset) => {
    const selects = [...document.querySelectorAll('select')];
    const aspectSelect = selects.find((select) => {
      const values = [...select.options].map((option) => option.value);
      return (
        values.includes('viewport') &&
        values.includes('16:9') &&
        values.includes('4:3') &&
        values.includes('1:1') &&
        values.includes('3:4') &&
        values.includes('9:16')
      );
    });

    if (!(aspectSelect instanceof HTMLSelectElement)) {
      throw new Error('Snapshot aspect ratio select not found.');
    }

    aspectSelect.value = nextPreset;
    aspectSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }, preset);

  await page.waitForFunction(
    (nextPreset) => {
      const selects = [...document.querySelectorAll('select')];
      const aspectSelect = selects.find((select) => {
        const values = [...select.options].map((option) => option.value);
        return (
          values.includes('viewport') &&
          values.includes('16:9') &&
          values.includes('4:3') &&
          values.includes('1:1') &&
          values.includes('3:4') &&
          values.includes('9:16')
        );
      });
      return aspectSelect instanceof HTMLSelectElement && aspectSelect.value === nextPreset;
    },
    { timeout: 5_000 },
    preset,
  );
  await delay(350);
}

async function setSnapshotSelectValue(page, nextValue, requiredOptionValues) {
  await page.evaluate(
    ({ value, optionValues }) => {
      const selects = [...document.querySelectorAll('select')];
      const targetSelect = selects.find((select) => {
        const values = [...select.options].map((option) => option.value);
        return optionValues.every((optionValue) => values.includes(optionValue));
      });

      if (!(targetSelect instanceof HTMLSelectElement)) {
        throw new Error(`Snapshot select not found for options: ${optionValues.join(', ')}`);
      }

      targetSelect.value = value;
      targetSelect.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { value: nextValue, optionValues: requiredOptionValues },
  );

  await page.waitForFunction(
    ({ value, optionValues }) => {
      const selects = [...document.querySelectorAll('select')];
      const targetSelect = selects.find((select) => {
        const values = [...select.options].map((option) => option.value);
        return optionValues.every((optionValue) => values.includes(optionValue));
      });
      return targetSelect instanceof HTMLSelectElement && targetSelect.value === value;
    },
    { timeout: 5_000 },
    { value: nextValue, optionValues: requiredOptionValues },
  );
  await delay(450);
}

async function setSnapshotGridVisible(page, visible) {
  await page.evaluate((nextVisible) => {
    const switches = [...document.querySelectorAll('[role="switch"]')];
    const gridSwitch = switches.find((element) => {
      const label = element.getAttribute('aria-label') ?? '';
      return /grid|网格/i.test(label);
    });

    if (!(gridSwitch instanceof HTMLButtonElement)) {
      throw new Error('Snapshot grid switch not found.');
    }

    const checked = gridSwitch.getAttribute('aria-checked') === 'true';
    if (checked !== nextVisible) {
      gridSwitch.click();
    }
  }, visible);

  await page.waitForFunction(
    (nextVisible) => {
      const switches = [...document.querySelectorAll('[role="switch"]')];
      const gridSwitch = switches.find((element) => {
        const label = element.getAttribute('aria-label') ?? '';
        return /grid|网格/i.test(label);
      });
      return (
        gridSwitch instanceof HTMLButtonElement &&
        (gridSwitch.getAttribute('aria-checked') === 'true') === nextVisible
      );
    },
    { timeout: 5_000 },
    visible,
  );
  await delay(350);
}

async function measureSnapshotPreviewAspectChange(page, preset = '1:1') {
  const before = await readSnapshotPreviewOrbitState(page);
  await setSnapshotAspectPreset(page, preset);
  const after = await readSnapshotPreviewOrbitState(page);
  const screenshotSample = await captureSnapshotPreviewScreenshotSample(page);

  return {
    preset,
    before,
    after,
    screenshotSample,
    cameraPositionDelta: maxVectorDelta(before.cameraPosition, after.cameraPosition),
    targetDelta: maxVectorDelta(before.target, after.target),
  };
}

async function readSnapshotPreviewLookState(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="snapshot-preview-canvas"] canvas');
    const canvasSurface = canvas?.closest('[role="button"]');
    const sceneRoot = window.scene?.__r3f?.root ?? null;
    const state = sceneRoot?.getState?.() ?? null;
    const scene = state?.scene ?? null;
    const gl = state?.gl ?? null;
    const background = scene?.background;
    const sceneBackgroundHex =
      background && background.isColor === true && typeof background.getHexString === 'function'
        ? `#${background.getHexString()}`
        : null;
    const surfaceBackground =
      canvasSurface instanceof HTMLElement
        ? window.getComputedStyle(canvasSurface).backgroundColor
        : '';
    const surfaceRgb = surfaceBackground.match(
      /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i,
    );
    const surfaceBackgroundHex = surfaceRgb
      ? `#${surfaceRgb.slice(1, 4).map((value) => Number(value).toString(16).padStart(2, '0')).join('')}`
      : null;

    return {
      rootCanvasIsPreview: Boolean(
        canvas instanceof HTMLCanvasElement && state?.gl?.domElement === canvas,
      ),
      backgroundHex: sceneBackgroundHex ?? surfaceBackgroundHex,
      shadowEnabled: Boolean(gl?.shadowMap?.enabled),
      shadowType: Number(gl?.shadowMap?.type ?? Number.NaN),
      toneMappingExposure: Number(gl?.toneMappingExposure ?? Number.NaN),
      hasSnapshotGroundShadowPlane: Boolean(scene?.getObjectByName?.('SnapshotGroundShadowPlane')),
      hasSnapshotContactShadows: Boolean(scene?.getObjectByName?.('SnapshotContactShadows')),
      hasSnapshotReflectiveFloor: Boolean(scene?.getObjectByName?.('SnapshotReflectiveFloor')),
      hasReferenceGrid: Boolean(scene?.getObjectByName?.('ReferenceGrid')),
    };
  });
}

async function waitForSnapshotPreviewLook(page, condition, args = {}) {
  await page.waitForFunction(
    ({ conditionName, conditionArgs }) => {
      const canvas = document.querySelector('[data-testid="snapshot-preview-canvas"] canvas');
      const canvasSurface = canvas?.closest('[role="button"]');
      const sceneRoot = window.scene?.__r3f?.root ?? null;
      const state = sceneRoot?.getState?.() ?? null;
      const scene = state?.scene ?? null;
      const gl = state?.gl ?? null;
      const background = scene?.background;
      const sceneBackgroundHex =
        background && background.isColor === true && typeof background.getHexString === 'function'
          ? `#${background.getHexString()}`
          : null;
      const surfaceBackground =
        canvasSurface instanceof HTMLElement
          ? window.getComputedStyle(canvasSurface).backgroundColor
          : '';
      const surfaceRgb = surfaceBackground.match(
        /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i,
      );
      const surfaceBackgroundHex = surfaceRgb
        ? `#${surfaceRgb.slice(1, 4).map((value) => Number(value).toString(16).padStart(2, '0')).join('')}`
        : null;
      const snapshot = {
        rootCanvasIsPreview: Boolean(
          canvas instanceof HTMLCanvasElement && state?.gl?.domElement === canvas,
        ),
        backgroundHex: sceneBackgroundHex ?? surfaceBackgroundHex,
        shadowEnabled: Boolean(gl?.shadowMap?.enabled),
        shadowType: Number(gl?.shadowMap?.type ?? Number.NaN),
        toneMappingExposure: Number(gl?.toneMappingExposure ?? Number.NaN),
        hasSnapshotGroundShadowPlane: Boolean(
          scene?.getObjectByName?.('SnapshotGroundShadowPlane'),
        ),
        hasSnapshotContactShadows: Boolean(scene?.getObjectByName?.('SnapshotContactShadows')),
        hasSnapshotReflectiveFloor: Boolean(scene?.getObjectByName?.('SnapshotReflectiveFloor')),
        hasReferenceGrid: Boolean(scene?.getObjectByName?.('ReferenceGrid')),
      };
      switch (conditionName) {
        case 'dark-background':
          return snapshot.rootCanvasIsPreview && snapshot.backgroundHex === '#111827';
        case 'exposure-changed':
          return Math.abs(snapshot.toneMappingExposure - conditionArgs.initialExposure) > 0.001;
        case 'shadow-profile-changed':
          return snapshot.shadowEnabled && snapshot.shadowType !== conditionArgs.initialShadowType;
        case 'reflective-floor':
          return snapshot.hasSnapshotReflectiveFloor === true;
        case 'contact-shadows':
          return snapshot.hasSnapshotContactShadows === true &&
            snapshot.hasSnapshotReflectiveFloor === false;
        case 'grid-hidden':
          return snapshot.hasReferenceGrid === false;
        default:
          return false;
      }
    },
    { timeout: 10_000 },
    { conditionName: condition, conditionArgs: args },
  );
}

async function measureSnapshotPreviewSceneSettings(page) {
  const initialLook = await readSnapshotPreviewLookState(page);
  const initialScreenshotSample = await captureSnapshotPreviewScreenshotSample(page);

  await setSnapshotSelectValue(page, 'dark', ['viewport', 'studio', 'sky', 'dark']);
  await waitForSnapshotPreviewLook(page, 'dark-background');
  const darkLook = await readSnapshotPreviewLookState(page);
  const darkScreenshotSample = await captureSnapshotPreviewScreenshotSample(page);

  await setSnapshotSelectValue(page, 'contrast', ['viewport', 'studio', 'city', 'contrast']);
  await waitForSnapshotPreviewLook(
    page,
    'exposure-changed',
    { initialExposure: initialLook.toneMappingExposure },
  );
  const contrastLook = await readSnapshotPreviewLookState(page);

  await setSnapshotSelectValue(page, 'crisp', ['soft', 'balanced', 'crisp']);
  await waitForSnapshotPreviewLook(
    page,
    'shadow-profile-changed',
    { initialShadowType: initialLook.shadowType },
  );
  const crispShadowLook = await readSnapshotPreviewLookState(page);

  await setSnapshotSelectValue(page, 'reflective', ['shadow', 'contact', 'reflective']);
  await waitForSnapshotPreviewLook(page, 'reflective-floor');
  const reflectiveLook = await readSnapshotPreviewLookState(page);

  await setSnapshotSelectValue(page, 'contact', ['shadow', 'contact', 'reflective']);
  await waitForSnapshotPreviewLook(page, 'contact-shadows');
  const contactLook = await readSnapshotPreviewLookState(page);

  await setSnapshotGridVisible(page, false);
  await waitForSnapshotPreviewLook(page, 'grid-hidden');
  const gridHiddenLook = await readSnapshotPreviewLookState(page);

  const postSettingsDragMetrics = await measureSnapshotPreviewDrag(page);

  return {
    initialLook,
    initialScreenshotSample,
    darkLook,
    darkScreenshotSample,
    contrastLook,
    crispShadowLook,
    reflectiveLook,
    contactLook,
    gridHiddenLook,
    postSettingsDragMetrics,
  };
}

function assertPreviewScreenshotHasContent(suite, scenarioLabel, sample) {
  assert(
    suite,
    !sample?.error,
    `${scenarioLabel}: preview screenshot can be sampled${sample?.error ? ` (${sample.error})` : ''}`,
  );
  assertGreaterThan(
    suite,
    sample?.lumaRange ?? 0,
    MIN_PREVIEW_SCREENSHOT_LUMA_RANGE,
    `${scenarioLabel}: preview screenshot is not a flat blank frame`,
  );
  assertGreaterThan(
    suite,
    sample?.lumaStdDev ?? 0,
    MIN_PREVIEW_SCREENSHOT_LUMA_STD_DEV,
    `${scenarioLabel}: preview screenshot contains rendered scene detail`,
  );
}

function assertPreviewLayout(suite, scenarioLabel, layout) {
  const cardRect = layout.card?.rect;
  const shellRect = layout.shell?.rect;
  const frameRect = layout.frame?.rect;
  const canvasHostRect = layout.canvasHost?.rect;
  const canvasRect = layout.canvas?.rect;

  assert(suite, Boolean(cardRect), `${scenarioLabel}: preview card exists`);
  assert(suite, Boolean(shellRect), `${scenarioLabel}: preview frame shell exists`);
  assert(suite, Boolean(frameRect), `${scenarioLabel}: preview frame exists`);
  assert(suite, Boolean(canvasHostRect), `${scenarioLabel}: preview canvas host exists`);
  assert(suite, Boolean(canvasRect), `${scenarioLabel}: preview WebGL canvas exists`);

  assertGreaterThan(suite, frameRect?.width ?? 0, 120, `${scenarioLabel}: frame width is usable`);
  assertGreaterThan(suite, frameRect?.height ?? 0, 100, `${scenarioLabel}: frame height is usable`);
  assertGreaterThan(
    suite,
    canvasRect?.width ?? 0,
    120,
    `${scenarioLabel}: canvas CSS width is usable`,
  );
  assertGreaterThan(
    suite,
    canvasRect?.height ?? 0,
    100,
    `${scenarioLabel}: canvas CSS height is usable`,
  );
  assertGreaterThan(
    suite,
    layout.canvas?.width ?? 0,
    120,
    `${scenarioLabel}: canvas backing width is usable`,
  );
  assertGreaterThan(
    suite,
    layout.canvas?.height ?? 0,
    100,
    `${scenarioLabel}: canvas backing height is usable`,
  );
  assertGreaterThan(
    suite,
    layout.canvas?.backingScaleX ?? 0,
    MIN_HIGH_DPI_BACKING_RATIO,
    `${scenarioLabel}: canvas backing width uses high-DPI rendering`,
  );
  assertGreaterThan(
    suite,
    layout.canvas?.backingScaleY ?? 0,
    MIN_HIGH_DPI_BACKING_RATIO,
    `${scenarioLabel}: canvas backing height uses high-DPI rendering`,
  );

  assert(
    suite,
    rectInside(cardRect, shellRect),
    `${scenarioLabel}: frame shell stays inside preview card`,
  );
  assert(
    suite,
    rectInside(cardRect, frameRect),
    `${scenarioLabel}: frame stays inside preview card`,
  );
  assert(
    suite,
    rectInside(frameRect, canvasHostRect),
    `${scenarioLabel}: canvas host stays inside frame`,
  );
  assert(
    suite,
    rectInside(frameRect, canvasRect),
    `${scenarioLabel}: WebGL canvas stays inside frame`,
  );
  assertGreaterThan(
    suite,
    layout.canvasHost?.runtimeRevision ?? 0,
    0,
    `${scenarioLabel}: preview runtime loaded a robot`,
  );
  assert(
    suite,
    (layout.card?.scrollWidth ?? 0) <= (layout.card?.clientWidth ?? 0) + RECT_EPSILON,
    `${scenarioLabel}: preview card has no horizontal overflow`,
  );
  assert(
    suite,
    (layout.frame?.scrollWidth ?? 0) <= (layout.frame?.clientWidth ?? 0) + RECT_EPSILON,
    `${scenarioLabel}: preview frame has no horizontal overflow`,
  );
  assert(
    suite,
    /Preview ready|预览已就绪/.test(layout.card?.text ?? ''),
    `${scenarioLabel}: preview reports ready`,
  );
  assertEqual(
    suite,
    layout.canvasHost?.interactive,
    'true',
    `${scenarioLabel}: preview orbit is enabled only after runtime is ready`,
  );
}

async function validateSnapshotPreview(
  suite,
  page,
  scenarioLabel,
  report,
  { validateSceneSettings = false } = {},
) {
  const rememberedMainRoot = await rememberMainWorkspaceRoot(page);
  await openSnapshotDialog(page);
  const mainBefore = await readMainWorkspaceOrbitState(page);
  const layout = await readSnapshotPreviewLayout(page);
  const initialScreenshotSample = await captureSnapshotPreviewScreenshotSample(page);
  const dragMetrics = await measureSnapshotPreviewDrag(page);
  const panMetrics = await measureSnapshotPreviewPan(page);
  const zoomMetrics = await measureSnapshotPreviewZoom(page);
  const aspectChangeMetrics = await measureSnapshotPreviewAspectChange(page, '1:1');
  const sceneSettingMetrics = validateSceneSettings
    ? await measureSnapshotPreviewSceneSettings(page)
    : null;
  const mainAfter = await readMainWorkspaceOrbitState(page);
  report.previews.push({
    label: scenarioLabel,
    mainIsolation: {
      rememberedMainRoot,
      before: mainBefore,
      after: mainAfter,
      cameraPositionDelta: maxVectorDelta(mainBefore.cameraPosition, mainAfter.cameraPosition),
      targetDelta: maxVectorDelta(mainBefore.target, mainAfter.target),
    },
    viewport: layout.viewport,
    card: layout.card?.rect ?? null,
    shell: layout.shell?.rect ?? null,
    frame: layout.frame?.rect ?? null,
    canvasHost: {
      rect: layout.canvasHost?.rect ?? null,
      runtimeLoaded: layout.canvasHost?.runtimeLoaded ?? null,
      runtimeRevision: layout.canvasHost?.runtimeRevision ?? null,
    },
    canvas: layout.canvas ?? null,
    devicePixelRatio: layout.devicePixelRatio,
    sample: layout.sample,
    initialScreenshotSample,
    dragMetrics,
    panMetrics,
    zoomMetrics,
    aspectChangeMetrics,
    sceneSettingMetrics,
  });
  assert(suite, rememberedMainRoot, `${scenarioLabel}: remembers the main workspace camera root`);
  assert(
    suite,
    mainBefore?.hasR3fState && mainBefore?.canvasConnected,
    `${scenarioLabel}: main workspace camera state is available before preview edits`,
  );
  assertPreviewLayout(suite, scenarioLabel, layout);
  assertPreviewScreenshotHasContent(
    suite,
    `${scenarioLabel}: initial live preview`,
    initialScreenshotSample,
  );
  assert(suite, dragMetrics.before?.hasR3fState, `${scenarioLabel}: preview exposes R3F state`);
  assert(
    suite,
    dragMetrics.before?.rootCanvasIsPreview,
    `${scenarioLabel}: debug scene state belongs to the preview canvas`,
  );
  assert(
    suite,
    dragMetrics.before?.controlsDomIsCanvas,
    `${scenarioLabel}: preview orbit controls listen on the preview canvas`,
  );
  assertEqual(
    suite,
    dragMetrics.before?.controlsEnabled,
    true,
    `${scenarioLabel}: preview orbit controls are enabled before drag`,
  );
  assertEqual(
    suite,
    dragMetrics.before?.controlsEnablePan,
    true,
    `${scenarioLabel}: preview supports panning`,
  );
  assertEqual(
    suite,
    dragMetrics.before?.controlsEnableZoom,
    true,
    `${scenarioLabel}: preview supports zooming`,
  );
  assertEqual(
    suite,
    dragMetrics.before?.controlsEnableRotate,
    true,
    `${scenarioLabel}: preview supports orbit rotation`,
  );
  assertEqual(
    suite,
    dragMetrics.before?.controlsScreenSpacePanning,
    true,
    `${scenarioLabel}: preview panning follows screen axes`,
  );
  assertGreaterThan(
    suite,
    Math.max(dragMetrics.cameraPositionDelta, dragMetrics.targetDelta),
    MIN_CAMERA_DRAG_DELTA,
    `${scenarioLabel}: preview drag changes the orbit camera`,
  );
  assert(
    suite,
    dragMetrics.renderBefore?.installed && dragMetrics.renderBefore?.rootCanvasIsPreview,
    `${scenarioLabel}: preview drag render probe is attached to the preview canvas`,
  );
  assertGreaterThan(
    suite,
    dragMetrics.renderCountDelta,
    0,
    `${scenarioLabel}: preview drag repaints the WebGL canvas`,
  );
  assertGreaterThan(
    suite,
    dragMetrics.renderAfter?.durationStats?.count ?? 0,
    0,
    `${scenarioLabel}: preview drag measures WebGL render duration`,
  );
  assert(
    suite,
    (dragMetrics.renderAfter?.durationStats?.p95Ms ?? Number.POSITIVE_INFINITY) <=
      MAX_PREVIEW_DRAG_RENDER_P95_MS,
    `${scenarioLabel}: preview drag render stays responsive (p95 ${
      dragMetrics.renderAfter?.durationStats?.p95Ms ?? 'n/a'
    }ms)`,
  );
  assertGreaterThan(
    suite,
    panMetrics.targetDelta,
    MIN_CAMERA_PAN_DELTA,
    `${scenarioLabel}: preview right-drag pans the camera target`,
  );
  assertGreaterThan(
    suite,
    panMetrics.cameraPositionDelta,
    MIN_CAMERA_PAN_DELTA,
    `${scenarioLabel}: preview right-drag pans the camera position`,
  );
  assertGreaterThan(
    suite,
    Math.abs(zoomMetrics.distanceDelta),
    MIN_CAMERA_ZOOM_DISTANCE_DELTA,
    `${scenarioLabel}: preview wheel zoom changes camera distance`,
  );
  assert(
    suite,
    Math.max(aspectChangeMetrics.cameraPositionDelta, aspectChangeMetrics.targetDelta) <=
      MAX_CAMERA_ASPECT_CHANGE_DELTA,
    `${scenarioLabel}: aspect changes preserve the preview camera (${JSON.stringify({
      cameraPositionDelta: aspectChangeMetrics.cameraPositionDelta,
      targetDelta: aspectChangeMetrics.targetDelta,
    })})`,
  );
  const mainCameraDelta = Math.max(
    maxVectorDelta(mainBefore.cameraPosition, mainAfter.cameraPosition),
    maxVectorDelta(mainBefore.target, mainAfter.target),
  );
  assert(
    suite,
    mainAfter?.hasR3fState && mainAfter?.canvasConnected && mainCameraDelta <= MAX_MAIN_CAMERA_DELTA,
    `${scenarioLabel}: preview camera edits do not move the main workspace camera (${mainCameraDelta})`,
  );
  assertPreviewScreenshotHasContent(
    suite,
    `${scenarioLabel}: live preview after aspect change`,
    aspectChangeMetrics.screenshotSample,
  );
  if (sceneSettingMetrics) {
    assertEqual(
      suite,
      sceneSettingMetrics.darkLook.backgroundHex,
      '#111827',
      `${scenarioLabel}: dark background setting reaches live preview`,
    );
    assertGreaterThan(
      suite,
      Math.abs(
        (sceneSettingMetrics.initialScreenshotSample?.meanLuma ?? 0) -
          (sceneSettingMetrics.darkScreenshotSample?.meanLuma ?? 0),
      ),
      4,
      `${scenarioLabel}: background setting visibly changes live preview pixels`,
    );
    assertGreaterThan(
      suite,
      Math.abs(
        sceneSettingMetrics.contrastLook.toneMappingExposure -
          sceneSettingMetrics.initialLook.toneMappingExposure,
      ),
      0.001,
      `${scenarioLabel}: lighting preset changes live preview renderer exposure`,
    );
    assert(
      suite,
      sceneSettingMetrics.crispShadowLook.shadowEnabled &&
        sceneSettingMetrics.crispShadowLook.shadowType !==
          sceneSettingMetrics.initialLook.shadowType,
      `${scenarioLabel}: shadow style changes live preview shadow renderer`,
    );
    assert(
      suite,
      sceneSettingMetrics.reflectiveLook.hasSnapshotReflectiveFloor,
      `${scenarioLabel}: reflective ground setting reaches live preview`,
    );
    assert(
      suite,
      sceneSettingMetrics.contactLook.hasSnapshotContactShadows &&
        !sceneSettingMetrics.contactLook.hasSnapshotReflectiveFloor,
      `${scenarioLabel}: contact ground setting replaces reflective preview floor`,
    );
    assert(
      suite,
      !sceneSettingMetrics.gridHiddenLook.hasReferenceGrid,
      `${scenarioLabel}: grid toggle hides the live preview grid`,
    );
    assertGreaterThan(
      suite,
      Math.max(
        sceneSettingMetrics.postSettingsDragMetrics.cameraPositionDelta,
        sceneSettingMetrics.postSettingsDragMetrics.targetDelta,
      ),
      MIN_CAMERA_DRAG_DELTA,
      `${scenarioLabel}: preview remains draggable after scene setting changes`,
    );
    assertGreaterThan(
      suite,
      sceneSettingMetrics.postSettingsDragMetrics.renderCountDelta,
      0,
      `${scenarioLabel}: preview drag repaints after scene setting changes`,
    );
    assert(
      suite,
      (sceneSettingMetrics.postSettingsDragMetrics.renderAfter?.durationStats?.p95Ms ??
        Number.POSITIVE_INFINITY) <= MAX_PREVIEW_DRAG_RENDER_P95_MS,
      `${scenarioLabel}: preview drag render stays responsive after scene setting changes (p95 ${
        sceneSettingMetrics.postSettingsDragMetrics.renderAfter?.durationStats?.p95Ms ?? 'n/a'
      }ms)`,
    );
  }
  // This is cleanup after every behavioral assertion has completed. Compact
  // layout changes can remount the select while React is processing the reset,
  // so a missed best-effort reset must not turn a healthy preview into a test
  // failure; closing the dialog restores the next session from canonical state.
  await setSnapshotAspectPreset(page, 'viewport').catch(() => undefined);
  await closeSnapshotDialog(page);
}

async function main() {
  const suite = createTestSuite('MuJoCo Snapshot Preview');
  const session = await createSession();
  const report = { models: [], previews: [] };

  try {
    const { page } = session;
    await page.setViewport({ width: 1280, height: 760, deviceScaleFactor: 2 });

    for (const model of MODELS) {
      console.log(`\n-- ${model.dir}/${model.file} --`);
      const loadedName = await importModel(page, model.dir, model.file);
      await waitForReady(page);
      await waitForModelRuntime(page, model);
      const loadState = await readLoadState(page);

      assertEqual(
        suite,
        loadState.selectedFile?.format,
        'mjcf',
        `${model.label}: selected file format is mjcf`,
      );
      assertEqual(
        suite,
        basename(loadState.selectedFile?.name),
        model.file,
        `${model.label}: selected file tracks imported XML`,
      );
      assertEqual(
        suite,
        loadState.document?.format,
        'mjcf',
        `${model.label}: document load format is mjcf`,
      );
      assertGreaterThan(
        suite,
        loadState.runtime?.linkCount ?? 0,
        0,
        `${model.label}: runtime has links`,
      );
      if (model.requireVisualMeshes) {
        assertGreaterThan(
          suite,
          loadState.runtime?.visualMeshCount ?? 0,
          REQUIRED_VISUAL_MESHES - 1,
          `${model.label}: runtime has visual meshes`,
        );
      }

      report.models.push({
        model,
        loadedName,
        selectedFile: loadState.selectedFile,
        document: loadState.document,
        runtime: loadState.runtime,
      });

      await validateSnapshotPreview(suite, page, `${model.label} desktop`, report, {
        validateSceneSettings: model.file === 'go2.xml',
      });
    }

    await page.setViewport({ width: 390, height: 680, deviceScaleFactor: 2 });
    await delay(300);
    await validateSnapshotPreview(suite, page, 'Go2 scene include compact viewport', report);

    const errs = session.errors();
    report.errors = errs;
    assert(suite, errs.page.length === 0, `no page errors (${errs.page.length})`);
  } catch (error) {
    report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
    assert(
      suite,
      false,
      `unexpected error: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await session.cleanup();
  }

  await writeReport('mujoco_snapshot_preview', report);
  process.exitCode = printSummary(suite) ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
