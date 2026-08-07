import * as THREE from 'three';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { runWithShadowMapUpdatesPaused } from './shadowMapRefresh';

export type SemanticOutlineIntent = 'hover' | 'selection';

export interface SemanticOutlineComposer {
  readonly outlinePass: OutlinePass;
  setCamera: (camera: THREE.Camera) => void;
  setIntent: (intent: SemanticOutlineIntent) => void;
  setSize: (width: number, height: number, pixelRatio: number) => void;
  setTargets: (targets: readonly THREE.Object3D[]) => void;
  render: () => void;
  renderOverlay: () => void;
  dispose: () => void;
}

const HOVER_VISIBLE_COLOR = new THREE.Color('#fde047');
const HOVER_HIDDEN_COLOR = new THREE.Color('#fde047');
const SELECTION_VISIBLE_COLOR = new THREE.Color('#fbbf24');
const SELECTION_HIDDEN_COLOR = new THREE.Color('#fbbf24');
// Flex uses 0.78 over a dark canvas; the light workspace needs more opacity to
// retain comparable visual weight without changing the semantic source color.
const HOVER_OPACITY = 0.9;
const SELECTION_OPACITY = 0.98;
const OUTLINE_SAMPLE_COUNT = 4;
const OUTLINE_EDGE_STRENGTH = 14;
const OUTLINE_EDGE_THICKNESS = 3;

type OutlinePassRenderArguments = [
  renderer: THREE.WebGLRenderer,
  writeBuffer: THREE.WebGLRenderTarget,
  readBuffer: THREE.WebGLRenderTarget | null,
  deltaTime: number,
  maskActive: boolean,
];

type OutlinePassRender = (
  this: OutlinePass,
  ...args: OutlinePassRenderArguments
) => void;

// OutlinePass accepts null at runtime to draw its transparent overlay into the
// default framebuffer, but the upstream declaration narrows readBuffer to a
// WebGLRenderTarget. Keep that interop mismatch inside this adapter.
const renderOutlinePass = OutlinePass.prototype.render as OutlinePassRender;

export function createSemanticOutlineComposer({
  renderer,
  scene,
  camera,
  width,
  height,
  pixelRatio,
}: {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  width: number;
  height: number;
  pixelRatio: number;
}): SemanticOutlineComposer {
  const outlinePass = new OutlinePass(
    new THREE.Vector2(
      Math.max(1, width * pixelRatio),
      Math.max(1, height * pixelRatio),
    ),
    scene,
    camera,
  );
  const scratchRenderTarget = new THREE.WebGLRenderTarget(1, 1);

  // OutlinePass normally detects edges at half resolution. That optimization
  // makes diagonal semantic outlines visibly stair-step even though the main
  // canvas uses MSAA. Keep edge detection at the framebuffer resolution and
  // multisample the two geometry masks that establish the silhouette.
  outlinePass.downSampleRatio = 1;
  const outlineSampleCount = Math.min(
    OUTLINE_SAMPLE_COUNT,
    renderer.capabilities.maxSamples,
  );
  outlinePass.renderTargetMaskBuffer.samples = outlineSampleCount;
  outlinePass.renderTargetDepthBuffer.samples = outlineSampleCount;

  // OutlinePass defaults to additive blending, which washes yellow into white
  // on the light workspace background. Normal alpha blending keeps the semantic
  // color legible without touching the selected mesh material.
  outlinePass.overlayMaterial.blending = THREE.NormalBlending;
  outlinePass.overlayMaterial.toneMapped = false;
  outlinePass.overlayMaterial.uniforms.semanticOpacity = { value: HOVER_OPACITY };
  outlinePass.overlayMaterial.fragmentShader = outlinePass.overlayMaterial.fragmentShader
    .replace(
      'uniform bool usePatternTexture;',
      'uniform bool usePatternTexture;\nuniform float semanticOpacity;',
    )
    .replace(
      'gl_FragColor = finalColor;',
      [
        'float semanticCoverage = clamp(finalColor.a, 0.0, 1.0);',
        'vec3 semanticColor = finalColor.rgb / max(finalColor.a, 0.00001);',
        'gl_FragColor = vec4(semanticColor, semanticCoverage * semanticOpacity);',
        '#include <colorspace_fragment>',
      ].join('\n'),
    );
  outlinePass.overlayMaterial.needsUpdate = true;
  // At full resolution this produces a two-pixel core plus a soft AA fringe.
  outlinePass.edgeStrength = OUTLINE_EDGE_STRENGTH;
  outlinePass.edgeGlow = 0;
  outlinePass.edgeThickness = OUTLINE_EDGE_THICKNESS;
  outlinePass.pulsePeriod = 0;
  outlinePass.visibleEdgeColor.copy(HOVER_VISIBLE_COLOR);
  outlinePass.hiddenEdgeColor.copy(HOVER_HIDDEN_COLOR);

  const setSize = (nextWidth: number, nextHeight: number, nextPixelRatio: number) => {
    const effectivePixelRatio = Math.max(0.5, nextPixelRatio);
    const effectiveWidth = Math.max(1, Math.round(nextWidth * effectivePixelRatio));
    const effectiveHeight = Math.max(1, Math.round(nextHeight * effectivePixelRatio));
    outlinePass.resolution.set(effectiveWidth, effectiveHeight);
    outlinePass.setSize(effectiveWidth, effectiveHeight);
  };
  setSize(width, height, pixelRatio);

  const renderOverlay = () => {
    const previousRenderTarget = renderer.getRenderTarget();
    try {
      // OutlinePass hides selected and non-selected meshes in two auxiliary
      // scene renders. Updating shadows there would persist an incomplete
      // map that becomes visible on the next interaction frame.
      runWithShadowMapUpdatesPaused(renderer, () => {
        renderOutlinePass.call(
          outlinePass,
          renderer,
          scratchRenderTarget,
          previousRenderTarget,
          0,
          false,
        );
      });
    } finally {
      renderer.setRenderTarget(previousRenderTarget);
    }
  };

  return {
    outlinePass,
    setCamera(nextCamera) {
      outlinePass.renderCamera = nextCamera;
    },
    setIntent(intent) {
      outlinePass.overlayMaterial.uniforms.semanticOpacity.value =
        intent === 'selection' ? SELECTION_OPACITY : HOVER_OPACITY;
      outlinePass.visibleEdgeColor.copy(
        intent === 'selection' ? SELECTION_VISIBLE_COLOR : HOVER_VISIBLE_COLOR,
      );
      outlinePass.hiddenEdgeColor.copy(
        intent === 'selection' ? SELECTION_HIDDEN_COLOR : HOVER_HIDDEN_COLOR,
      );
    },
    setSize,
    setTargets(targets) {
      outlinePass.selectedObjects = targets.filter(
        (target): target is THREE.Object3D => Boolean(target?.parent && target.visible),
      );
    },
    render() {
      renderer.render(scene, outlinePass.renderCamera);
      renderOverlay();
    },
    renderOverlay,
    dispose() {
      outlinePass.dispose();
      scratchRenderTarget.dispose();
    },
  };
}
