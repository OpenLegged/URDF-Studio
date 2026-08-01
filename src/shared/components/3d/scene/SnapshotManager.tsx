import { useEffect, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { useEnvironment } from '@react-three/drei';
import * as THREE from 'three';
import type { RefObject } from 'react';
import type { Theme } from '@/types';
import {
  buildSnapshotFileName,
  createSnapshotCaptureAbortError,
  getSnapshotMimeType,
  isSnapshotCaptureAbortError,
  normalizeSnapshotCaptureOptions,
  resolveSnapshotAspectRatio,
  resolveSnapshotLongEdgeDimensions,
  SNAPSHOT_DETAIL_SUPERSAMPLE_SCALE,
  type SnapshotCaptureAction,
  type SnapshotCaptureOptions,
  type SnapshotCaptureProgress,
  type SnapshotCaptureRequest,
  type SnapshotCaptureRunControls,
  type SnapshotPreviewAction,
  throwIfSnapshotCaptureAborted,
} from './snapshotConfig';
import { resolveSnapshotPreviewCaptureOptions } from './snapshotPreviewConfig';
import { optimizePngBuffer } from '@/core/image-compressor';
import { logRegressionError } from '@/shared/debug/consoleDiagnostics';
import {
  applySnapshotBackgroundStyle,
  applySnapshotLightingPreset,
  applySnapshotSceneVisibility,
  applySnapshotShadowQuality,
  applySnapshotTextureQuality,
  type SnapshotBackgroundFill,
} from './snapshotSceneQuality';
import { SnapshotExportLook } from './SnapshotExportLook';
import { useSnapshotRenderContext } from './SnapshotRenderContext';
import {
  clampSnapshotRenderPlanToPixelBudget,
  resolveSnapshotRenderPlan,
  resolveSnapshotRenderTargetSamples,
  resolveSnapshotTiledRenderPlan,
} from './snapshotResolution';
import {
  applyWorkspaceCameraSnapshot,
  resolveWorkspaceCameraRenderViewOffset,
  type WorkspaceCameraRenderViewOffset,
  type WorkspaceCameraVisibleViewport,
} from '../workspace/workspaceCameraSnapshot';

const SNAPSHOT_RENDER_TARGET_SAMPLES = {
  viewport: 4,
  high: 8,
  ultra: 8,
} as const;

const SNAPSHOT_INTERNAL_RENDER_PIXEL_BUDGET = {
  viewport: 16_000_000,
  high: 33_000_000,
  ultra: 48_000_000,
} as const;

const SNAPSHOT_TILED_RENDER_SCALE_THRESHOLD = 0.95;

const SNAPSHOT_HDR_PRELOAD_FILE = '/potsdamer_platz_1k.hdr';

let snapshotHdrPreloadPromise: Promise<void> | null = null;

type SnapshotTileCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;
type SnapshotCameraView = NonNullable<THREE.PerspectiveCamera['view']>;

function isSnapshotTileCamera(camera: THREE.Camera): camera is SnapshotTileCamera {
  return camera instanceof THREE.PerspectiveCamera || camera instanceof THREE.OrthographicCamera;
}

function cloneSnapshotCameraView(camera: SnapshotTileCamera): SnapshotCameraView | null {
  return camera.view ? { ...camera.view } : null;
}

function restoreSnapshotCameraView(camera: SnapshotTileCamera, view: SnapshotCameraView | null) {
  if (view?.enabled) {
    camera.setViewOffset(
      view.fullWidth,
      view.fullHeight,
      view.offsetX,
      view.offsetY,
      view.width,
      view.height,
    );
  } else {
    camera.clearViewOffset();
  }
  camera.updateProjectionMatrix();
}

function setSnapshotCameraViewOffset(
  camera: SnapshotTileCamera,
  viewOffset: WorkspaceCameraRenderViewOffset,
) {
  camera.setViewOffset(
    viewOffset.fullWidth,
    viewOffset.fullHeight,
    viewOffset.offsetX,
    viewOffset.offsetY,
    viewOffset.width,
    viewOffset.height,
  );
  camera.updateProjectionMatrix();
}

function applySnapshotCameraVisibleViewport(
  camera: THREE.Camera,
  visibleViewport: WorkspaceCameraVisibleViewport | null | undefined,
  renderWidth: number,
  renderHeight: number,
) {
  if (!isSnapshotTileCamera(camera)) {
    return null;
  }

  const viewOffset = resolveWorkspaceCameraRenderViewOffset(
    visibleViewport,
    renderWidth,
    renderHeight,
  );
  if (!viewOffset) {
    return null;
  }

  const previousView = cloneSnapshotCameraView(camera);
  setSnapshotCameraViewOffset(camera, viewOffset);
  return () => restoreSnapshotCameraView(camera, previousView);
}

function ensureSnapshotHdrPreloaded(): Promise<void> {
  if (!snapshotHdrPreloadPromise) {
    snapshotHdrPreloadPromise = Promise.resolve().then(() => {
      useEnvironment.preload({ files: SNAPSHOT_HDR_PRELOAD_FILE });
    });
  }

  return snapshotHdrPreloadPromise;
}

interface SnapshotManagerProps {
  actionRef?: RefObject<SnapshotCaptureAction | null>;
  onSnapshotActionChange?: (action: SnapshotCaptureAction | null) => void;
  previewActionRef?: RefObject<SnapshotPreviewAction | null>;
  onPreviewActionChange?: (action: SnapshotPreviewAction | null) => void;
  robotName: string;
  theme: Theme;
  groundOffset?: number;
}

export const SnapshotManager = ({
  actionRef,
  onSnapshotActionChange,
  previewActionRef,
  onPreviewActionChange,
  robotName,
  theme,
  groundOffset = 0,
}: SnapshotManagerProps) => {
  const { gl, get, invalidate } = useThree();
  const pendingCaptureRef = useRef<number | null>(null);
  const [activeSnapshotOptions, setActiveSnapshotOptions] = useState<ReturnType<
    typeof normalizeSnapshotCaptureOptions
  > | null>(null);
  const { setSnapshotRenderActive } = useSnapshotRenderContext();

  useEffect(() => {
    if (!actionRef && !onSnapshotActionChange && !previewActionRef && !onPreviewActionChange) {
      return;
    }

    const cloneSnapshotCamera = (camera: THREE.Camera) => {
      const snapshotCamera = camera.clone();
      snapshotCamera.layers.mask = camera.layers.mask;
      snapshotCamera.matrixAutoUpdate = camera.matrixAutoUpdate;
      snapshotCamera.matrix.copy(camera.matrix);
      snapshotCamera.matrixWorld.copy(camera.matrixWorld);
      snapshotCamera.matrixWorldInverse.copy(camera.matrixWorldInverse);
      snapshotCamera.projectionMatrix.copy(camera.projectionMatrix);
      snapshotCamera.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
      snapshotCamera.updateMatrixWorld(true);
      return snapshotCamera;
    };

    const clearPendingFrames = () => {
      if (pendingCaptureRef.current !== null) {
        cancelAnimationFrame(pendingCaptureRef.current);
        pendingCaptureRef.current = null;
      }
    };

    const clampProgress = (progress: number) =>
      Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));

    const emitCaptureProgress = (
      onProgress: SnapshotCaptureRequest['onProgress'] | undefined,
      phase: SnapshotCaptureProgress['phase'],
      progress: number,
    ) => {
      onProgress?.({
        phase,
        progress: clampProgress(progress),
      });
    };

    const waitAnimationFrame = (signal?: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        throwIfSnapshotCaptureAborted(signal);

        let settled = false;
        function cleanup() {
          signal?.removeEventListener('abort', handleAbort);
        }

        function handleAbort() {
          if (settled) {
            return;
          }

          settled = true;
          clearPendingFrames();
          cleanup();
          reject(createSnapshotCaptureAbortError());
        }

        signal?.addEventListener('abort', handleAbort, { once: true });
        pendingCaptureRef.current = requestAnimationFrame(() => {
          pendingCaptureRef.current = null;
          if (settled) {
            return;
          }

          settled = true;
          cleanup();
          try {
            throwIfSnapshotCaptureAborted(signal);
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });

    const waitFrames = async (
      count: number,
      signal?: AbortSignal,
      onProgress?: SnapshotCaptureRequest['onProgress'],
    ) => {
      for (let index = 0; index < count; index += 1) {
        throwIfSnapshotCaptureAborted(signal);
        emitCaptureProgress(onProgress, 'warming-up', 0.12 + (index / Math.max(1, count)) * 0.18);
        invalidate();
        await waitAnimationFrame(signal);
      }
      emitCaptureProgress(onProgress, 'warming-up', 0.3);
    };

    const resolveSnapshotSize = (
      longEdgePx: number,
      visibleViewport?: WorkspaceCameraVisibleViewport | null,
      targetAspectRatio?: number | null,
    ) => {
      const drawingBufferSize = gl.getDrawingBufferSize(new THREE.Vector2());
      const pixelRatio = gl.getPixelRatio();
      const fixedAspectDimensions = targetAspectRatio
        ? resolveSnapshotLongEdgeDimensions(longEdgePx, targetAspectRatio)
        : null;
      const baseWidth = fixedAspectDimensions
        ? fixedAspectDimensions.width
        : visibleViewport
          ? Math.max(1, Math.round(visibleViewport.width * pixelRatio))
          : Math.max(1, Math.round(drawingBufferSize.x || 1));
      const baseHeight = fixedAspectDimensions
        ? fixedAspectDimensions.height
        : visibleViewport
          ? Math.max(1, Math.round(visibleViewport.height * pixelRatio))
          : Math.max(1, Math.round(drawingBufferSize.y || 1));
      const context = gl.getContext();

      return resolveSnapshotRenderPlan({
        baseWidth,
        baseHeight,
        basePixelRatio: pixelRatio,
        targetLongEdge: longEdgePx,
        maxRenderbufferSize: context.getParameter(context.MAX_RENDERBUFFER_SIZE),
        maxTextureSize: context.getParameter(context.MAX_TEXTURE_SIZE),
      });
    };

    const resolveSnapshotWarmupFrameCount = (
      options: ReturnType<typeof normalizeSnapshotCaptureOptions>,
    ) => {
      let frameCount = options.environmentPreset === 'viewport' ? 2 : 3;
      if (options.groundStyle === 'reflective') {
        frameCount = Math.max(frameCount, 4);
      }
      return frameCount;
    };

    const resolveSnapshotRenderPixelBudget = (
      options: ReturnType<typeof normalizeSnapshotCaptureOptions>,
    ) => {
      return SNAPSHOT_INTERNAL_RENDER_PIXEL_BUDGET[options.detailLevel];
    };

    const canvasToBlob = async (
      canvas: HTMLCanvasElement,
      options: SnapshotCaptureOptions,
      signal?: AbortSignal,
    ) => {
      throwIfSnapshotCaptureAborted(signal);
      const mimeType = getSnapshotMimeType(options.imageFormat);
      const quality =
        mimeType === 'image/png'
          ? undefined
          : Math.min(1, Math.max(0.6, options.imageQuality / 100));

      if (canvas.toBlob) {
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(
                  new Error(
                    `[Snapshot] Failed to generate ${options.imageFormat.toUpperCase()} blob.`,
                  ),
                );
                return;
              }

              resolve(blob);
            },
            mimeType,
            quality,
          );
        });
        throwIfSnapshotCaptureAborted(signal);
        return blob;
      }

      const dataUrl = canvas.toDataURL(mimeType, quality);
      throwIfSnapshotCaptureAborted(signal);
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      throwIfSnapshotCaptureAborted(signal);
      return blob;
    };

    // Losslessly re-compress PNG exports with oxipng (in a worker). Canvas-encoded
    // PNGs are not well optimized, so this typically trims a meaningful chunk of
    // bytes. Only runs for the downloaded export — the live preview stays fast and
    // unoptimized. Any failure degrades gracefully to the original PNG.
    const optimizePngBlobForExport = async (
      blob: Blob,
      options: SnapshotCaptureOptions,
      signal?: AbortSignal,
    ) => {
      if (options.imageFormat !== 'png') {
        return blob;
      }

      try {
        throwIfSnapshotCaptureAborted(signal);
        const sourceBuffer = await blob.arrayBuffer();
        throwIfSnapshotCaptureAborted(signal);
        const optimizedBuffer = await optimizePngBuffer(sourceBuffer, {
          level: options.pngOptimizeLevel,
          signal,
        });
        throwIfSnapshotCaptureAborted(signal);
        return new Blob([optimizedBuffer], { type: 'image/png' });
      } catch (error) {
        if (isSnapshotCaptureAbortError(error) || signal?.aborted) {
          throw error;
        }
        logRegressionError('[Snapshot] PNG optimization failed; exporting unoptimized PNG.', error);
        return blob;
      }
    };

    const downloadCanvas = async (
      canvas: HTMLCanvasElement,
      options: SnapshotCaptureOptions,
      controls: SnapshotCaptureRunControls,
    ) => {
      const { onProgress, signal } = controls;
      const filename = buildSnapshotFileName(robotName, options.imageFormat);

      const triggerDownload = (href: string) => {
        const link = document.createElement('a');
        link.href = href;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      };

      throwIfSnapshotCaptureAborted(signal);
      emitCaptureProgress(onProgress, 'encoding', 0.78);
      const encodedBlob = await canvasToBlob(canvas, options, signal);
      emitCaptureProgress(
        onProgress,
        options.imageFormat === 'png' ? 'optimizing' : 'downloading',
        options.imageFormat === 'png' ? 0.86 : 0.94,
      );
      const blob = await optimizePngBlobForExport(encodedBlob, options, signal);
      throwIfSnapshotCaptureAborted(signal);
      emitCaptureProgress(onProgress, 'downloading', 0.97);
      const url = URL.createObjectURL(blob);
      try {
        throwIfSnapshotCaptureAborted(signal);
        triggerDownload(url);
        emitCaptureProgress(onProgress, 'complete', 1);
      } finally {
        URL.revokeObjectURL(url);
      }
    };

    const buildCanvasFromPixelBuffer = (pixelBuffer: Uint8Array, width: number, height: number) => {
      const captureCanvas = document.createElement('canvas');
      captureCanvas.width = width;
      captureCanvas.height = height;
      const ctx = captureCanvas.getContext('2d');

      if (!ctx) {
        return captureCanvas;
      }

      const imageData = ctx.createImageData(width, height);
      const rowStride = width * 4;

      for (let sourceRow = 0; sourceRow < height; sourceRow += 1) {
        const destinationRow = height - sourceRow - 1;
        const sourceOffset = sourceRow * rowStride;
        const destinationOffset = destinationRow * rowStride;
        imageData.data.set(
          pixelBuffer.subarray(sourceOffset, sourceOffset + rowStride),
          destinationOffset,
        );
      }

      ctx.putImageData(imageData, 0, 0);
      return captureCanvas;
    };

    const readRenderTargetToCanvas = (
      renderTarget: THREE.WebGLRenderTarget,
      width: number,
      height: number,
    ) => {
      const pixelBuffer = new Uint8Array(width * height * 4);
      gl.readRenderTargetPixels(renderTarget, 0, 0, width, height, pixelBuffer);
      return buildCanvasFromPixelBuffer(pixelBuffer, width, height);
    };

    const renderSceneToCanvas = ({
      scene,
      camera,
      width,
      height,
      requestedSamples,
    }: {
      scene: THREE.Scene;
      camera: THREE.Camera;
      width: number;
      height: number;
      requestedSamples: number;
    }) => {
      const renderTarget = new THREE.WebGLRenderTarget(width, height, {
        type: THREE.UnsignedByteType,
        depthBuffer: true,
        stencilBuffer: false,
      });
      renderTarget.texture.colorSpace = THREE.SRGBColorSpace;
      renderTarget.samples = resolveSnapshotRenderTargetSamples({
        width,
        height,
        requestedSamples,
        maxSupportedSamples: gl.capabilities.maxSamples,
      });

      const previousRenderTarget = gl.getRenderTarget();
      const previousAutoClear = gl.autoClear;

      try {
        gl.autoClear = true;
        gl.setRenderTarget(renderTarget);
        gl.render(scene, camera);
        return readRenderTargetToCanvas(renderTarget, width, height);
      } finally {
        gl.setRenderTarget(previousRenderTarget);
        gl.autoClear = previousAutoClear;
        renderTarget.dispose();
      }
    };

    const fillCanvasBackground = (
      ctx: CanvasRenderingContext2D,
      targetWidth: number,
      targetHeight: number,
      backgroundFill: SnapshotBackgroundFill,
    ) => {
      if (backgroundFill.kind === 'solid' && backgroundFill.colors?.[0]) {
        ctx.fillStyle = backgroundFill.colors[0];
        ctx.fillRect(0, 0, targetWidth, targetHeight);
      } else if (backgroundFill.kind === 'linear-gradient' && backgroundFill.colors) {
        const gradient = ctx.createLinearGradient(0, 0, 0, targetHeight);
        gradient.addColorStop(0, backgroundFill.colors[0]);
        gradient.addColorStop(1, backgroundFill.colors[1]);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, targetWidth, targetHeight);
      }
    };

    const createExportCanvas = (
      sourceCanvas: HTMLCanvasElement,
      targetWidth: number,
      targetHeight: number,
      backgroundFill: SnapshotBackgroundFill,
    ) => {
      const needsResize =
        sourceCanvas.width !== targetWidth || sourceCanvas.height !== targetHeight;
      if (backgroundFill.kind === 'transparent' && !needsResize) {
        return sourceCanvas;
      }

      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = targetWidth;
      exportCanvas.height = targetHeight;
      const ctx = exportCanvas.getContext('2d');

      if (!ctx) {
        return sourceCanvas;
      }

      fillCanvasBackground(ctx, targetWidth, targetHeight, backgroundFill);

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);
      return exportCanvas;
    };

    const renderSceneToTiledCanvas = ({
      scene,
      camera,
      outputWidth,
      outputHeight,
      supersampleScale,
      requestedSamples,
      backgroundFill,
      visibleViewport,
      signal,
      onProgress,
    }: {
      scene: THREE.Scene;
      camera: SnapshotTileCamera;
      outputWidth: number;
      outputHeight: number;
      supersampleScale: number;
      requestedSamples: number;
      backgroundFill: SnapshotBackgroundFill;
      visibleViewport?: WorkspaceCameraVisibleViewport | null;
      signal?: AbortSignal;
      onProgress?: SnapshotCaptureRequest['onProgress'];
    }) => {
      const context = gl.getContext();
      const tiledPlan = resolveSnapshotTiledRenderPlan({
        outputWidth,
        outputHeight,
        supersampleScale,
        maxRenderbufferSize: context.getParameter(context.MAX_RENDERBUFFER_SIZE),
        maxTextureSize: context.getParameter(context.MAX_TEXTURE_SIZE),
      });
      const captureCanvas = document.createElement('canvas');
      captureCanvas.width = tiledPlan.outputWidth;
      captureCanvas.height = tiledPlan.outputHeight;
      const ctx = captureCanvas.getContext('2d');

      if (!ctx) {
        return captureCanvas;
      }

      fillCanvasBackground(ctx, tiledPlan.outputWidth, tiledPlan.outputHeight, backgroundFill);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const visibleViewOffset = resolveWorkspaceCameraRenderViewOffset(
        visibleViewport,
        tiledPlan.fullRenderWidth,
        tiledPlan.fullRenderHeight,
      );
      const previousView = cloneSnapshotCameraView(camera);

      try {
        tiledPlan.tiles.forEach((tile, tileIndex) => {
          throwIfSnapshotCaptureAborted(signal);
          camera.setViewOffset(
            visibleViewOffset?.fullWidth ?? tiledPlan.fullRenderWidth,
            visibleViewOffset?.fullHeight ?? tiledPlan.fullRenderHeight,
            (visibleViewOffset?.offsetX ?? 0) + tile.renderX,
            (visibleViewOffset?.offsetY ?? 0) + tile.renderY,
            tile.renderWidth,
            tile.renderHeight,
          );
          camera.updateProjectionMatrix();

          const tileCanvas = renderSceneToCanvas({
            scene,
            camera,
            width: tile.renderWidth,
            height: tile.renderHeight,
            requestedSamples,
          });

          ctx.drawImage(
            tileCanvas,
            0,
            0,
            tile.renderWidth,
            tile.renderHeight,
            tile.outputX,
            tile.outputY,
            tile.outputWidth,
            tile.outputHeight,
          );
          emitCaptureProgress(
            onProgress,
            'rendering',
            0.34 + ((tileIndex + 1) / Math.max(1, tiledPlan.tiles.length)) * 0.38,
          );
        });
      } finally {
        restoreSnapshotCameraView(camera, previousView);
      }

      return captureCanvas;
    };

    const renderSnapshotCanvas = async (
      snapshotOptions: SnapshotCaptureOptions,
      frozenCamera?: THREE.Camera,
      controls: SnapshotCaptureRunControls = {},
    ) => {
      const { onProgress, signal } = controls;
      throwIfSnapshotCaptureAborted(signal);
      emitCaptureProgress(onProgress, 'preparing', 0.08);
      const viewportAspectRatio =
        snapshotOptions.cameraSnapshot?.visibleViewport?.aspectRatio ??
        snapshotOptions.cameraSnapshot?.aspectRatio ??
        null;
      const outputAspectRatio = resolveSnapshotAspectRatio(
        snapshotOptions.aspectRatioPreset,
        viewportAspectRatio,
      );
      const usesViewportAspectRatio = snapshotOptions.aspectRatioPreset === 'viewport';
      const visibleViewport = usesViewportAspectRatio
        ? (snapshotOptions.cameraSnapshot?.visibleViewport ?? null)
        : null;
      const fixedAspectRatio = usesViewportAspectRatio ? null : outputAspectRatio;
      const outputPlan = resolveSnapshotSize(
        snapshotOptions.longEdgePx,
        visibleViewport,
        fixedAspectRatio,
      );
      const supersampleScale = SNAPSHOT_DETAIL_SUPERSAMPLE_SCALE[snapshotOptions.detailLevel];
      const renderPlan = clampSnapshotRenderPlanToPixelBudget(
        resolveSnapshotSize(
          Math.round(snapshotOptions.longEdgePx * supersampleScale),
          visibleViewport,
          fixedAspectRatio,
        ),
        resolveSnapshotRenderPixelBudget(snapshotOptions),
      );
      let restoreSceneVisibility: (() => void) | null = null;
      let restoreTextureQuality: (() => void) | null = null;
      let restoreShadowQuality: (() => void) | null = null;
      let restoreLightingPreset: (() => void) | null = null;
      let restoreBackgroundStyle: (() => void) | null = null;
      let backgroundFill: SnapshotBackgroundFill = { kind: 'transparent' };

      try {
        throwIfSnapshotCaptureAborted(signal);
        const { scene: latestScene, camera: liveCamera } = get();
        const captureCamera = frozenCamera ?? cloneSnapshotCamera(liveCamera);
        if (snapshotOptions.cameraSnapshot) {
          applyWorkspaceCameraSnapshot(captureCamera, undefined, snapshotOptions.cameraSnapshot);
        }
        if (!usesViewportAspectRatio && captureCamera instanceof THREE.PerspectiveCamera) {
          captureCamera.aspect = outputAspectRatio;
          captureCamera.updateProjectionMatrix();
        }
        const backgroundState = applySnapshotBackgroundStyle(
          latestScene,
          gl,
          snapshotOptions.backgroundStyle,
          theme,
        );
        restoreBackgroundStyle = backgroundState.restore;
        backgroundFill = backgroundState.fill;
        restoreSceneVisibility = applySnapshotSceneVisibility(latestScene, {
          hideGrid: snapshotOptions.hideGrid,
        });
        restoreTextureQuality = applySnapshotTextureQuality(
          latestScene,
          gl,
          snapshotOptions.detailLevel,
        );
        restoreLightingPreset = applySnapshotLightingPreset(
          latestScene,
          gl,
          snapshotOptions.environmentPreset,
        );
        restoreShadowQuality = applySnapshotShadowQuality(
          latestScene,
          gl,
          snapshotOptions.detailLevel,
          snapshotOptions.shadowStyle,
        );

        const originalRenderTarget = gl.getRenderTarget();
        const originalViewport = gl.getViewport(new THREE.Vector4());
        const originalScissor = gl.getScissor(new THREE.Vector4());
        const originalScissorTest = gl.getScissorTest();
        let capturedCanvas: HTMLCanvasElement;
        let capturedAtOutputSize = false;
        let restoreCameraViewOffset: (() => void) | null = null;

        try {
          throwIfSnapshotCaptureAborted(signal);
          emitCaptureProgress(onProgress, 'rendering', 0.34);
          const desiredRenderWidth = Math.max(
            1,
            Math.round(outputPlan.targetWidth * supersampleScale),
          );
          const desiredRenderHeight = Math.max(
            1,
            Math.round(outputPlan.targetHeight * supersampleScale),
          );
          const effectiveSupersampleRatio = Math.min(
            renderPlan.targetWidth / desiredRenderWidth,
            renderPlan.targetHeight / desiredRenderHeight,
          );
          const shouldUseTiledSupersampling =
            supersampleScale > 1 &&
            isSnapshotTileCamera(captureCamera) &&
            effectiveSupersampleRatio < SNAPSHOT_TILED_RENDER_SCALE_THRESHOLD;

          if (shouldUseTiledSupersampling) {
            capturedCanvas = renderSceneToTiledCanvas({
              scene: latestScene,
              camera: captureCamera,
              outputWidth: outputPlan.targetWidth,
              outputHeight: outputPlan.targetHeight,
              supersampleScale,
              requestedSamples: SNAPSHOT_RENDER_TARGET_SAMPLES[snapshotOptions.detailLevel],
              backgroundFill,
              visibleViewport,
              signal,
              onProgress,
            });
            capturedAtOutputSize = true;
          } else {
            throwIfSnapshotCaptureAborted(signal);
            restoreCameraViewOffset = applySnapshotCameraVisibleViewport(
              captureCamera,
              visibleViewport,
              renderPlan.targetWidth,
              renderPlan.targetHeight,
            );
            capturedCanvas = renderSceneToCanvas({
              scene: latestScene,
              camera: captureCamera,
              width: renderPlan.targetWidth,
              height: renderPlan.targetHeight,
              requestedSamples: SNAPSHOT_RENDER_TARGET_SAMPLES[snapshotOptions.detailLevel],
            });
            emitCaptureProgress(onProgress, 'rendering', 0.72);
          }
        } finally {
          restoreCameraViewOffset?.();
          gl.setRenderTarget(originalRenderTarget);
          gl.setViewport(originalViewport);
          gl.setScissor(originalScissor);
          gl.setScissorTest(originalScissorTest);
        }

        restoreShadowQuality();
        restoreShadowQuality = null;
        restoreLightingPreset?.();
        restoreLightingPreset = null;
        restoreTextureQuality();
        restoreTextureQuality = null;
        restoreSceneVisibility();
        restoreSceneVisibility = null;
        restoreBackgroundStyle();
        restoreBackgroundStyle = null;
        throwIfSnapshotCaptureAborted(signal);
        if (!capturedAtOutputSize) {
          emitCaptureProgress(onProgress, 'encoding', 0.74);
          capturedCanvas = createExportCanvas(
            capturedCanvas,
            outputPlan.targetWidth,
            outputPlan.targetHeight,
            backgroundFill,
          );
        }
        invalidate();
        emitCaptureProgress(onProgress, 'encoding', 0.76);
        return {
          canvas: capturedCanvas,
          width: outputPlan.targetWidth,
          height: outputPlan.targetHeight,
          options: snapshotOptions,
        };
      } catch (error) {
        restoreBackgroundStyle?.();
        restoreShadowQuality?.();
        restoreLightingPreset?.();
        restoreTextureQuality?.();
        restoreSceneVisibility?.();
        invalidate();
        throw error;
      }
    };

    const runSnapshotCapture = async (
      requestedOptions: Parameters<SnapshotCaptureAction>[0],
      resolveOptions: (options?: Partial<SnapshotCaptureOptions> | null) => SnapshotCaptureOptions,
    ) => {
      const snapshotOptions = resolveOptions(requestedOptions);
      const controls: SnapshotCaptureRunControls = {
        signal: requestedOptions?.signal,
        onProgress: requestedOptions?.onProgress,
      };
      const frozenCamera = cloneSnapshotCamera(get().camera);
      throwIfSnapshotCaptureAborted(controls.signal);
      emitCaptureProgress(controls.onProgress, 'preparing', 0.04);
      await ensureSnapshotHdrPreloaded();
      throwIfSnapshotCaptureAborted(controls.signal);
      clearPendingFrames();
      setSnapshotRenderActive(true);
      setActiveSnapshotOptions(snapshotOptions);
      invalidate();

      try {
        await waitFrames(
          resolveSnapshotWarmupFrameCount(snapshotOptions),
          controls.signal,
          controls.onProgress,
        );
        return await renderSnapshotCanvas(snapshotOptions, frozenCamera, controls);
      } finally {
        setActiveSnapshotOptions(null);
        setSnapshotRenderActive(false);
        invalidate();
      }
    };

    const captureAction: SnapshotCaptureAction = async (requestedOptions) => {
      const capture = await runSnapshotCapture(requestedOptions, normalizeSnapshotCaptureOptions);
      await downloadCanvas(capture.canvas, capture.options, {
        signal: requestedOptions?.signal,
        onProgress: requestedOptions?.onProgress,
      });
    };

    if (actionRef) {
      actionRef.current = captureAction;
    }
    onSnapshotActionChange?.(captureAction);

    const previewAction: SnapshotPreviewAction = async (requestedOptions) => {
      const capture = await runSnapshotCapture(
        requestedOptions,
        resolveSnapshotPreviewCaptureOptions,
      );
      return {
        blob: await canvasToBlob(capture.canvas, capture.options),
        width: capture.width,
        height: capture.height,
        options: capture.options,
      };
    };

    if (previewActionRef) {
      previewActionRef.current = previewAction;
    }
    onPreviewActionChange?.(previewAction);

    return () => {
      clearPendingFrames();
      setSnapshotRenderActive(false);
      if (actionRef) {
        actionRef.current = null;
      }
      onSnapshotActionChange?.(null);
      if (previewActionRef) {
        previewActionRef.current = null;
      }
      onPreviewActionChange?.(null);
    };
  }, [
    actionRef,
    get,
    gl,
    invalidate,
    onSnapshotActionChange,
    onPreviewActionChange,
    previewActionRef,
    robotName,
    setSnapshotRenderActive,
    theme,
  ]);

  return activeSnapshotOptions ? (
    <SnapshotExportLook options={activeSnapshotOptions} theme={theme} groundOffset={groundOffset} />
  ) : null;
};
