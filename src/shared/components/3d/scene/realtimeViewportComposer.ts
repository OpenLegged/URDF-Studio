import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';

import { runWithShadowMapUpdatesPaused } from './shadowMapRefresh';

export const REALTIME_GTAO_PIXEL_RATIO_CAP = 1.5;
export const REALTIME_GTAO_MAX_PIXELS = 2_500_000;

export const REALTIME_GTAO_CONFIG = {
  blendIntensity: 0.78,
  radius: 0.18,
  thickness: 1.2,
  samples: 12,
  screenSpaceRadius: true,
  denoise: {
    lumaPhi: 8,
    depthPhi: 2,
    normalPhi: 3,
    radius: 4,
    rings: 2,
    samples: 12,
  },
} as const;

export const REALTIME_POSTPROCESSING_PASS_ORDER = [
  'RenderPass',
  'GTAOPass',
  'SMAAPass',
  'OutputPass',
] as const;

const MINIMUM_GTAO_PIXEL_RATIO = 0.5;
const LINEAR_DEPTH_OVERRIDE = '#undef USE_LOGARITHMIC_DEPTH_BUFFER';

interface RealtimePostprocessingPixelRatioInput {
  width: number;
  height: number;
  rendererPixelRatio: number;
  pixelRatioCap?: number;
  maxPixels?: number;
}

export interface RealtimeViewportDiagnostics {
  pixelRatio: number;
  targetWidth: number;
  targetHeight: number;
}

export interface RealtimeViewportComposer {
  render: (deltaTime?: number) => void;
  setSize: (width: number, height: number, rendererPixelRatio: number) => void;
  getDiagnostics: () => RealtimeViewportDiagnostics;
  dispose: () => void;
}

export function shouldRenderRealtimeAmbientOcclusion({
  composerAvailable,
  isInteracting,
  snapshotRenderActive,
}: {
  composerAvailable: boolean;
  isInteracting: boolean;
  snapshotRenderActive: boolean;
}): boolean {
  return composerAvailable && !isInteracting && !snapshotRenderActive;
}

function resolvePositiveFinite(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function resolveRealtimePostprocessingPixelRatio({
  width,
  height,
  rendererPixelRatio,
  pixelRatioCap = REALTIME_GTAO_PIXEL_RATIO_CAP,
  maxPixels = REALTIME_GTAO_MAX_PIXELS,
}: RealtimePostprocessingPixelRatioInput): number {
  const safeWidth = resolvePositiveFinite(width, 1);
  const safeHeight = resolvePositiveFinite(height, 1);
  const safeRendererPixelRatio = resolvePositiveFinite(rendererPixelRatio, 1);
  const safePixelRatioCap = resolvePositiveFinite(
    pixelRatioCap,
    REALTIME_GTAO_PIXEL_RATIO_CAP,
  );
  const safeMaxPixels = resolvePositiveFinite(maxPixels, REALTIME_GTAO_MAX_PIXELS);
  const budgetPixelRatio = Math.sqrt(safeMaxPixels / (safeWidth * safeHeight));
  const minimumPixelRatio = Math.min(
    MINIMUM_GTAO_PIXEL_RATIO,
    safeRendererPixelRatio,
    safePixelRatioCap,
  );

  return Math.max(
    minimumPixelRatio,
    Math.min(safeRendererPixelRatio, safePixelRatioCap, budgetPixelRatio),
  );
}

/**
 * The main canvas deliberately uses logarithmic depth to protect very large or
 * densely nested robot scenes. GTAO reconstructs positions from ordinary
 * projection depth, so only its private normal/depth buffer must opt out.
 */
export function disableLogarithmicDepthBuffer(shaderSource: string): string {
  return `${LINEAR_DEPTH_OVERRIDE}\n${shaderSource}`;
}

class ShadowSafeGtaoPass extends GTAOPass {
  override render(...args: [
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ]): void {
    const [renderer] = args;
    runWithShadowMapUpdatesPaused(renderer, () => {
      super.render(...args);
    });
  }
}

export function createRealtimeViewportComposer({
  renderer,
  scene,
  camera,
  width,
  height,
  rendererPixelRatio,
}: {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  width: number;
  height: number;
  rendererPixelRatio: number;
}): RealtimeViewportComposer {
  // Supplying a tiny target avoids allocating a full-renderer-DPR buffer before
  // the controlled pixel ratio is applied below.
  const initialRenderTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    depthBuffer: true,
    stencilBuffer: false,
  });
  initialRenderTarget.texture.name = 'RealtimeViewportComposer.beauty';

  const composer = new EffectComposer(renderer, initialRenderTarget);
  const renderPass = new RenderPass(scene, camera);
  const gtaoPass = new ShadowSafeGtaoPass(scene, camera, 1, 1);
  const smaaPass = new SMAAPass();
  const outputPass = new OutputPass();

  gtaoPass.output = GTAOPass.OUTPUT.Default;
  gtaoPass.blendIntensity = REALTIME_GTAO_CONFIG.blendIntensity;
  gtaoPass.updateGtaoMaterial({
    radius: REALTIME_GTAO_CONFIG.radius,
    thickness: REALTIME_GTAO_CONFIG.thickness,
    samples: REALTIME_GTAO_CONFIG.samples,
    screenSpaceRadius: REALTIME_GTAO_CONFIG.screenSpaceRadius,
  });
  gtaoPass.updatePdMaterial(REALTIME_GTAO_CONFIG.denoise);

  gtaoPass.normalMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = disableLogarithmicDepthBuffer(shader.vertexShader);
    shader.fragmentShader = disableLogarithmicDepthBuffer(shader.fragmentShader);
  };
  gtaoPass.normalMaterial.customProgramCacheKey = () => 'gtao-linear-depth-buffer-v1';
  gtaoPass.normalMaterial.needsUpdate = true;

  composer.addPass(renderPass);
  composer.addPass(gtaoPass);
  composer.addPass(smaaPass);
  composer.addPass(outputPass);

  let logicalWidth = 1;
  let logicalHeight = 1;
  let effectivePixelRatio = renderer.getPixelRatio();
  let disposed = false;

  const setSize = (
    nextWidth: number,
    nextHeight: number,
    nextRendererPixelRatio: number,
  ): void => {
    const resolvedWidth = resolvePositiveFinite(nextWidth, 1);
    const resolvedHeight = resolvePositiveFinite(nextHeight, 1);
    const resolvedPixelRatio = resolveRealtimePostprocessingPixelRatio({
      width: resolvedWidth,
      height: resolvedHeight,
      rendererPixelRatio: nextRendererPixelRatio,
    });
    const pixelRatioChanged = resolvedPixelRatio !== effectivePixelRatio;
    const sizeChanged = resolvedWidth !== logicalWidth || resolvedHeight !== logicalHeight;

    logicalWidth = resolvedWidth;
    logicalHeight = resolvedHeight;
    effectivePixelRatio = resolvedPixelRatio;
    if (pixelRatioChanged) {
      composer.setPixelRatio(effectivePixelRatio);
    }
    if (sizeChanged) {
      composer.setSize(logicalWidth, logicalHeight);
    }
  };

  setSize(width, height, rendererPixelRatio);

  return {
    render(deltaTime = 0) {
      if (!disposed) {
        composer.render(deltaTime);
      }
    },
    setSize,
    getDiagnostics() {
      return {
        pixelRatio: effectivePixelRatio,
        targetWidth: Math.max(1, Math.round(logicalWidth * effectivePixelRatio)),
        targetHeight: Math.max(1, Math.round(logicalHeight * effectivePixelRatio)),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;

      gtaoPass.dispose();
      // GTAOPass r181 omits these two materials from its own dispose().
      gtaoPass.gtaoMaterial.dispose();
      gtaoPass.blendMaterial.dispose();
      smaaPass.dispose();
      outputPass.dispose();
      composer.dispose();
    },
  };
}
