/**
 * Terrain heightmap multi-texture elevation-based blending.
 *
 * Uses `onBeforeCompile` on `MeshStandardMaterial` to inject custom GLSL that
 * blends up to 4 diffuse textures based on vertex elevation (displaced Z).
 *
 * Gazebo SDF heightmap blend convention:
 *   N textures, N-1 blend zones.
 *   Below min_height[0]: 100% texture 0
 *   min_height[0] .. min_height[0]+fade_dist[0]: smooth blend 0 -> 1
 *   ...and so on for each zone.
 *   Each texture tiles at its own `size` (repeat count per world unit).
 */

import * as THREE from 'three';
import type { SdfHeightmapBlend, SdfHeightmapTexture } from '@/types';

const MAX_TEXTURE_LAYERS = 4;

/** Uniforms shared between the material and its onBeforeCompile shader. */
export interface TerrainBlendUniforms {
  uNumTextures: { value: number };
  uPlaneSize: { value: THREE.Vector2 };
  uTextureSizes: { value: number[] };
  uBlendMinHeights: { value: number[] };
  uBlendFadeDists: { value: number[] };
  uTerrainDiffuse0: { value: THREE.Texture | null };
  uTerrainDiffuse1: { value: THREE.Texture | null };
  uTerrainDiffuse2: { value: THREE.Texture | null };
  uTerrainDiffuse3: { value: THREE.Texture | null };
}

/**
 * Creates a `MeshStandardMaterial` with an elevation-based multi-texture
 * blending shader injected via `onBeforeCompile`.
 *
 * The returned material starts with no textures assigned. Callers must load
 * textures asynchronously and write them into the returned `uniforms` object,
 * then set `material.needsUpdate = true` to trigger a recompile.
 */
export function createTerrainBlendMaterial(
  textures: SdfHeightmapTexture[],
  blends: SdfHeightmapBlend[],
  planeWidth: number,
  planeHeight: number,
): { material: THREE.MeshStandardMaterial; uniforms: TerrainBlendUniforms } {
  const numTextures = Math.min(textures.length, MAX_TEXTURE_LAYERS);
  const textureSizes = textures.slice(0, numTextures).map((t) => t.size ?? 1);

  // Blend params: pad to MAX_TEXTURE_LAYERS - 1
  const minHeights = blends.map((b) => b.minHeight);
  const fadeDists = blends.map((b) => b.fadeDist);
  while (minHeights.length < MAX_TEXTURE_LAYERS - 1) minHeights.push(0);
  while (fadeDists.length < MAX_TEXTURE_LAYERS - 1) fadeDists.push(0);

  const uniforms: TerrainBlendUniforms = {
    uNumTextures: { value: numTextures as unknown as number }, // stored as float in shader
    uPlaneSize: { value: new THREE.Vector2(planeWidth, planeHeight) },
    uTextureSizes: { value: textureSizes },
    uBlendMinHeights: { value: minHeights },
    uBlendFadeDists: { value: fadeDists },
    uTerrainDiffuse0: { value: null },
    uTerrainDiffuse1: { value: null },
    uTerrainDiffuse2: { value: null },
    uTerrainDiffuse3: { value: null },
  };

  // Force UV pipeline so vUv varying is declared in the shader.
  // Without this, vUv is undefined when the material has no map/normalMap/etc.
  const dummyMap = new THREE.DataTexture(
    new Uint8Array([255, 255, 255, 255]),
    1,
    1,
    THREE.RGBAFormat,
  );
  dummyMap.needsUpdate = true;

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    roughness: 0.85,
    metalness: 0.0,
    map: dummyMap,
  });
  material.userData.__urdfStudioTextureUniforms = uniforms;

  material.onBeforeCompile = (shader) => {
    // Merge our uniforms into the shader
    shader.uniforms = { ...shader.uniforms, ...uniforms };

    // ---- Vertex shader: pass elevation as varying ----
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `
      #include <common>
      varying float vTerrainElevation;
      `,
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      vTerrainElevation = transformed.z;
      `,
    );

    // ---- Fragment shader: elevation-based blending ----
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `
      #include <common>
      uniform float uNumTextures;
      uniform vec2 uPlaneSize;
      uniform float uTextureSizes[${MAX_TEXTURE_LAYERS}];
      uniform float uBlendMinHeights[${MAX_TEXTURE_LAYERS - 1}];
      uniform float uBlendFadeDists[${MAX_TEXTURE_LAYERS - 1}];
      uniform sampler2D uTerrainDiffuse0;
      uniform sampler2D uTerrainDiffuse1;
      uniform sampler2D uTerrainDiffuse2;
      uniform sampler2D uTerrainDiffuse3;
      varying float vTerrainElevation;
      `,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `
      // Elevation-based multi-texture blending
      vec2 baseUv = vMapUv;

      // Compute continuous layer index (0.0 = texture 0, 1.0 = texture 1, ...)
      float _tbLayer = 0.0;
      for (int _i = 0; _i < ${MAX_TEXTURE_LAYERS - 1}; _i++) {
          if (_i >= int(uNumTextures) - 1) break;
          float _h = uBlendMinHeights[_i];
          float _fd = uBlendFadeDists[_i];
          if (_fd > 0.0) {
              _tbLayer += smoothstep(_h, _h + _fd, vTerrainElevation);
          } else if (vTerrainElevation >= _h) {
              _tbLayer += 1.0;
          }
      }

      // Determine the two adjacent texture layers to blend
      float _tbIdx = floor(_tbLayer);
      float _tbFrac = fract(_tbLayer);
      float _tbIdx0 = min(_tbIdx, uNumTextures - 1.0);
      float _tbIdx1 = min(_tbIdx + 1.0, uNumTextures - 1.0);

      // Sample the two texture layers (sampler2D requires constant index in GLSL ES)
      vec4 _tbCol0 = vec4(0.0);
      vec4 _tbCol1 = vec4(0.0);

      if (_tbIdx0 < 0.5) {
          _tbCol0 = texture2D(uTerrainDiffuse0, baseUv * uPlaneSize / max(uTextureSizes[0], 0.001));
      } else if (_tbIdx0 < 1.5) {
          _tbCol0 = texture2D(uTerrainDiffuse1, baseUv * uPlaneSize / max(uTextureSizes[1], 0.001));
      } else if (_tbIdx0 < 2.5) {
          _tbCol0 = texture2D(uTerrainDiffuse2, baseUv * uPlaneSize / max(uTextureSizes[2], 0.001));
      } else {
          _tbCol0 = texture2D(uTerrainDiffuse3, baseUv * uPlaneSize / max(uTextureSizes[3], 0.001));
      }

      if (_tbIdx1 < 0.5) {
          _tbCol1 = texture2D(uTerrainDiffuse0, baseUv * uPlaneSize / max(uTextureSizes[0], 0.001));
      } else if (_tbIdx1 < 1.5) {
          _tbCol1 = texture2D(uTerrainDiffuse1, baseUv * uPlaneSize / max(uTextureSizes[1], 0.001));
      } else if (_tbIdx1 < 2.5) {
          _tbCol1 = texture2D(uTerrainDiffuse2, baseUv * uPlaneSize / max(uTextureSizes[2], 0.001));
      } else {
          _tbCol1 = texture2D(uTerrainDiffuse3, baseUv * uPlaneSize / max(uTextureSizes[3], 0.001));
      }

      diffuseColor.rgb = mix(_tbCol0.rgb, _tbCol1.rgb, _tbFrac);
      `,
    );
  };

  return { material, uniforms };
}

/** Loads all diffuse textures from the SdfHeightmapTexture array. */
export function loadTexturesForBlending(
  textures: SdfHeightmapTexture[],
  manager?: THREE.LoadingManager,
): Promise<THREE.Texture[]> {
  const diffusePaths = textures
    .slice(0, MAX_TEXTURE_LAYERS)
    .map((t) => t.diffuse)
    .filter((p): p is string => Boolean(p));

  if (diffusePaths.length === 0) {
    return Promise.resolve([]);
  }

  const loader = new THREE.TextureLoader(manager);
  const promises = diffusePaths.map(
    (path) =>
      new Promise<THREE.Texture>((resolve, reject) => {
        loader.load(
          path,
          (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            resolve(tex);
          },
          undefined,
          (err) => reject(err),
        );
      }),
  );

  return Promise.all(promises);
}
