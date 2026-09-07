import * as THREE from 'three';
import type {
  SnapshotBackgroundStyle,
  SnapshotDetailLevel,
  SnapshotEnvironmentPreset,
  SnapshotGroundStyle,
  SnapshotShadowStyle,
} from './snapshotConfig';
import { SNAPSHOT_DETAIL_SHADOW_MAP_SIZE } from './snapshotConfig';
import { WORKSPACE_CANVAS_BACKGROUND } from './constants';

const SNAPSHOT_GRID_OBJECT_NAME = 'ReferenceGrid';
const SNAPSHOT_KEEP_HELPER_OBJECT_NAMES = new Set([
  'SnapshotGroundShadowPlane',
  'SnapshotContactShadows',
  'SnapshotReflectiveFloor',
]);

const SNAPSHOT_EXCLUDED_HELPER_OBJECT_NAMES = new Set([
  '__origin_axes__',
  '__joint_axis__',
  '__joint_axis_helper__',
  '__com_visual__',
  '__inertia_box__',
  '__inertia_visual__',
  '__link_axes_helper__',
  '__debug_joint_axes__',
  'Link Axes',
  'USD Joint Axes',
]);

type Cleanup = () => void;

type ThemeKey = 'light' | 'dark';

// Potsdamer Platz's dominant light faces away from the snapshot rig's
// shadow-casting key at the texture's native orientation.
const POTSDAMER_PLAZA_KEY_LIGHT_ALIGNMENT_Z = Math.PI;

export interface SnapshotBackgroundFill {
  kind: 'transparent' | 'solid' | 'linear-gradient';
  colors?: readonly [string, string];
}

export interface SnapshotEnvironmentPresetSettings {
  kind: 'inherit' | 'studio' | 'hdri';
  environmentIntensity: Record<ThemeKey, number>;
  environmentRotationZ: number;
}

export interface SnapshotEnvironmentPresetRenderSettings {
  ambientIntensityMultiplier: number;
  hemisphereIntensityMultiplier: number;
  mainIntensityMultiplier: number;
  fillIntensityMultiplier: number;
  rimIntensityMultiplier: number;
  cameraIntensityMultiplier: number;
  toneMappingExposureMultiplier: number;
  hemisphereSky: string | null;
  hemisphereGround: string | null;
  mainColor: string | null;
  rimColor: string | null;
}

export interface SnapshotGroundStyleSettings {
  contactShadowOpacity: number;
  contactShadowBlur: number;
  contactShadowResolution: number;
  contactShadowFar: number;
  reflectorStrength: number;
  reflectorBlur: [number, number];
  reflectorRoughness: number;
  reflectorMirror: number;
}

export interface SnapshotShadowStyleSettings {
  shadowMapType: THREE.ShadowMapType;
  blurSamples: number;
  mapSizeMultiplier: number;
  radius: number;
  bias: number;
  normalBias: number;
}

export const SNAPSHOT_ENVIRONMENT_PRESET_SETTINGS: Record<
  SnapshotEnvironmentPreset,
  SnapshotEnvironmentPresetSettings
> = {
  viewport: {
    kind: 'inherit',
    environmentIntensity: { light: 1, dark: 1 },
    environmentRotationZ: 0,
  },
  studio: {
    kind: 'studio',
    environmentIntensity: { light: 0.5, dark: 0.46 },
    environmentRotationZ: 0,
  },
  city: {
    kind: 'hdri',
    environmentIntensity: { light: 0.95, dark: 1.08 },
    environmentRotationZ: POTSDAMER_PLAZA_KEY_LIGHT_ALIGNMENT_Z,
  },
  contrast: {
    kind: 'hdri',
    environmentIntensity: { light: 1.18, dark: 1.26 },
    environmentRotationZ: POTSDAMER_PLAZA_KEY_LIGHT_ALIGNMENT_Z + 0.7,
  },
};

export const SNAPSHOT_ENVIRONMENT_PRESET_RENDER_SETTINGS: Record<
  SnapshotEnvironmentPreset,
  SnapshotEnvironmentPresetRenderSettings
> = {
  viewport: {
    ambientIntensityMultiplier: 1,
    hemisphereIntensityMultiplier: 1,
    mainIntensityMultiplier: 1,
    fillIntensityMultiplier: 1,
    rimIntensityMultiplier: 1,
    cameraIntensityMultiplier: 1,
    toneMappingExposureMultiplier: 1,
    hemisphereSky: null,
    hemisphereGround: null,
    mainColor: null,
    rimColor: null,
  },
  studio: {
    ambientIntensityMultiplier: 1.08,
    hemisphereIntensityMultiplier: 1.04,
    mainIntensityMultiplier: 0.94,
    fillIntensityMultiplier: 1.06,
    rimIntensityMultiplier: 0.92,
    cameraIntensityMultiplier: 0.95,
    toneMappingExposureMultiplier: 0.98,
    hemisphereSky: '#f7fbff',
    hemisphereGround: '#d6dde6',
    mainColor: '#fff8ed',
    rimColor: '#ffffff',
  },
  city: {
    ambientIntensityMultiplier: 0.92,
    hemisphereIntensityMultiplier: 1.08,
    mainIntensityMultiplier: 1.12,
    fillIntensityMultiplier: 1.14,
    rimIntensityMultiplier: 1.08,
    cameraIntensityMultiplier: 1,
    toneMappingExposureMultiplier: 1.02,
    hemisphereSky: '#e7f2ff',
    hemisphereGround: '#c9d4df',
    mainColor: '#f2f7ff',
    rimColor: '#d9e7ff',
  },
  contrast: {
    ambientIntensityMultiplier: 0.72,
    hemisphereIntensityMultiplier: 0.82,
    mainIntensityMultiplier: 1.24,
    fillIntensityMultiplier: 0.82,
    rimIntensityMultiplier: 1.42,
    cameraIntensityMultiplier: 1.08,
    toneMappingExposureMultiplier: 1.05,
    hemisphereSky: '#dfe8f6',
    hemisphereGround: '#b7c2cf',
    mainColor: '#fff1d6',
    rimColor: '#cfe1ff',
  },
};

export const SNAPSHOT_GROUND_STYLE_SETTINGS: Record<
  SnapshotGroundStyle,
  SnapshotGroundStyleSettings
> = {
  shadow: {
    contactShadowOpacity: 0,
    contactShadowBlur: 1.4,
    contactShadowResolution: 512,
    contactShadowFar: 10,
    reflectorStrength: 0,
    reflectorBlur: [320, 96],
    reflectorRoughness: 0.44,
    reflectorMirror: 0.18,
  },
  contact: {
    contactShadowOpacity: 0.72,
    contactShadowBlur: 2.1,
    contactShadowResolution: 768,
    contactShadowFar: 12,
    reflectorStrength: 0,
    reflectorBlur: [360, 108],
    reflectorRoughness: 0.5,
    reflectorMirror: 0.22,
  },
  reflective: {
    contactShadowOpacity: 0.5,
    contactShadowBlur: 1.3,
    contactShadowResolution: 896,
    contactShadowFar: 12,
    reflectorStrength: 1.24,
    reflectorBlur: [180, 42],
    reflectorRoughness: 0.16,
    reflectorMirror: 0.76,
  },
};

export const SNAPSHOT_SHADOW_STYLE_SETTINGS: Record<
  SnapshotShadowStyle,
  SnapshotShadowStyleSettings
> = {
  soft: {
    shadowMapType: THREE.VSMShadowMap,
    blurSamples: 10,
    mapSizeMultiplier: 0.85,
    radius: 0,
    bias: -0.00016,
    normalBias: 0.035,
  },
  balanced: {
    shadowMapType: THREE.PCFSoftShadowMap,
    blurSamples: 0,
    mapSizeMultiplier: 1,
    radius: 3.2,
    bias: -0.00012,
    normalBias: 0.02,
  },
  crisp: {
    shadowMapType: THREE.PCFShadowMap,
    blurSamples: 0,
    mapSizeMultiplier: 1.35,
    radius: 1.25,
    bias: -0.00008,
    normalBias: 0.012,
  },
};

function resolveSnapshotDirectionalLightRole(
  light: THREE.DirectionalLight,
): 'main' | 'fill' | 'rim' | 'camera' | 'other' {
  if (light.name === 'MainLight') {
    return 'main';
  }

  if (light.name === 'RimLight') {
    return 'rim';
  }

  if (light.name.startsWith('FillLight')) {
    return 'fill';
  }

  if (light.name.startsWith('Camera')) {
    return 'camera';
  }

  return 'other';
}

const SNAPSHOT_BACKGROUND_PRESET_FILL: Record<
  Exclude<SnapshotBackgroundStyle, 'viewport' | 'transparent'>,
  SnapshotBackgroundFill
> = {
  studio: {
    kind: 'linear-gradient',
    colors: ['#f7f9fc', '#dfe7f1'],
  },
  sky: {
    kind: 'linear-gradient',
    colors: ['#d8ecff', '#f6fbff'],
  },
  dark: {
    kind: 'linear-gradient',
    colors: ['#202733', '#0c1118'],
  },
};

function getObjectMaterials(object: THREE.Object3D) {
  const mesh = object as THREE.Mesh;
  if (!('material' in mesh) || !mesh.material) {
    return [] as THREE.Material[];
  }

  return Array.isArray(mesh.material) ? mesh.material.filter(Boolean) : [mesh.material];
}

function collectMaterialTextures(material: THREE.Material) {
  const textures = new Set<THREE.Texture>();

  Object.values(material).forEach((value) => {
    if (value instanceof THREE.Texture) {
      textures.add(value);
    }
  });

  return Array.from(textures);
}

function shouldHideSnapshotSceneObject(object: THREE.Object3D, options: { hideGrid: boolean }) {
  if (object.name === SNAPSHOT_GRID_OBJECT_NAME) {
    return options.hideGrid;
  }

  if (SNAPSHOT_KEEP_HELPER_OBJECT_NAMES.has(object.name)) {
    return false;
  }

  if (
    SNAPSHOT_EXCLUDED_HELPER_OBJECT_NAMES.has(object.name) ||
    typeof object.userData?.viewerHelperKind === 'string'
  ) {
    return true;
  }

  if (
    object.userData?.isCollision === true ||
    object.userData?.isCollisionMesh === true ||
    object.userData?.isCollisionGroup === true ||
    object.userData?.geometryRole === 'collision' ||
    (object as any).isURDFCollider === true
  ) {
    return true;
  }

  if (
    object.userData?.isSelectableHelper === true ||
    object.userData?.isGizmo === true ||
    object.userData?.isHelper === true
  ) {
    return true;
  }

  return false;
}

export function applySnapshotSceneVisibility(
  scene: THREE.Scene,
  options: { hideGrid: boolean },
): Cleanup {
  const hiddenObjects: Array<{ object: THREE.Object3D; visible: boolean }> = [];

  scene.traverse((object) => {
    if (!shouldHideSnapshotSceneObject(object, options)) {
      return;
    }

    hiddenObjects.push({ object, visible: object.visible });
    object.visible = false;
  });

  return () => {
    hiddenObjects.forEach(({ object, visible }) => {
      object.visible = visible;
    });
  };
}

export function applySnapshotBackgroundStyle(
  scene: THREE.Scene,
  gl: THREE.WebGLRenderer,
  backgroundStyle: SnapshotBackgroundStyle,
  theme: string = 'light',
): { restore: Cleanup; fill: SnapshotBackgroundFill } {
  const previousBackground = scene.background;
  const previousClearColor = gl.getClearColor(new THREE.Color()).clone();
  const previousClearAlpha = gl.getClearAlpha();

  let fill: SnapshotBackgroundFill;
  if (backgroundStyle === 'viewport') {
    const fallbackColor =
      theme === 'dark' ? WORKSPACE_CANVAS_BACKGROUND.dark : WORKSPACE_CANVAS_BACKGROUND.light;
    fill =
      scene.background instanceof THREE.Color
        ? {
            kind: 'solid',
            colors: [`#${scene.background.getHexString()}`, `#${scene.background.getHexString()}`],
          }
        : { kind: 'solid', colors: [fallbackColor, fallbackColor] };
  } else if (backgroundStyle === 'transparent') {
    fill = { kind: 'transparent' };
  } else {
    fill = SNAPSHOT_BACKGROUND_PRESET_FILL[backgroundStyle];
  }

  scene.background = null;
  gl.setClearColor(0x000000, 0);

  return {
    fill,
    restore: () => {
      scene.background = previousBackground;
      gl.setClearColor(previousClearColor, previousClearAlpha);
    },
  };
}

export function applySnapshotLightingPreset(
  scene: THREE.Scene,
  gl: THREE.WebGLRenderer,
  environmentPreset: SnapshotEnvironmentPreset,
): Cleanup {
  const preset = SNAPSHOT_ENVIRONMENT_PRESET_RENDER_SETTINGS[environmentPreset];
  if (environmentPreset === 'viewport') {
    return () => {};
  }

  const previousToneMappingExposure = gl.toneMappingExposure;
  const trackedAmbientLights: Array<{ light: THREE.AmbientLight; intensity: number }> = [];
  const trackedHemisphereLights: Array<{
    light: THREE.HemisphereLight;
    intensity: number;
    skyColor: THREE.Color;
    groundColor: THREE.Color;
  }> = [];
  const trackedDirectionalLights: Array<{
    light: THREE.DirectionalLight;
    intensity: number;
    color: THREE.Color;
  }> = [];

  scene.traverse((object) => {
    if (object instanceof THREE.AmbientLight) {
      trackedAmbientLights.push({
        light: object,
        intensity: object.intensity,
      });
      object.intensity *= preset.ambientIntensityMultiplier;
      return;
    }

    if (object instanceof THREE.HemisphereLight) {
      trackedHemisphereLights.push({
        light: object,
        intensity: object.intensity,
        skyColor: object.color.clone(),
        groundColor: object.groundColor.clone(),
      });
      object.intensity *= preset.hemisphereIntensityMultiplier;
      if (preset.hemisphereSky) {
        object.color.set(preset.hemisphereSky);
      }
      if (preset.hemisphereGround) {
        object.groundColor.set(preset.hemisphereGround);
      }
      return;
    }

    if (object instanceof THREE.DirectionalLight) {
      trackedDirectionalLights.push({
        light: object,
        intensity: object.intensity,
        color: object.color.clone(),
      });

      const role = resolveSnapshotDirectionalLightRole(object);
      if (role === 'main') {
        object.intensity *= preset.mainIntensityMultiplier;
        if (preset.mainColor) {
          object.color.set(preset.mainColor);
        }
        return;
      }

      if (role === 'fill') {
        object.intensity *= preset.fillIntensityMultiplier;
        return;
      }

      if (role === 'rim') {
        object.intensity *= preset.rimIntensityMultiplier;
        if (preset.rimColor) {
          object.color.set(preset.rimColor);
        }
        return;
      }

      if (role === 'camera') {
        object.intensity *= preset.cameraIntensityMultiplier;
      }
    }
  });

  gl.toneMappingExposure = previousToneMappingExposure * preset.toneMappingExposureMultiplier;

  return () => {
    trackedAmbientLights.forEach(({ light, intensity }) => {
      light.intensity = intensity;
    });

    trackedHemisphereLights.forEach(({ light, intensity, skyColor, groundColor }) => {
      light.intensity = intensity;
      light.color.copy(skyColor);
      light.groundColor.copy(groundColor);
    });

    trackedDirectionalLights.forEach(({ light, intensity, color }) => {
      light.intensity = intensity;
      light.color.copy(color);
    });

    gl.toneMappingExposure = previousToneMappingExposure;
  };
}

export function applySnapshotTextureQuality(
  scene: THREE.Scene,
  gl: THREE.WebGLRenderer,
  detailLevel: SnapshotDetailLevel,
): Cleanup {
  if (detailLevel === 'viewport') {
    return () => {};
  }

  const maxAnisotropy = gl.capabilities.getMaxAnisotropy();
  if (!Number.isFinite(maxAnisotropy) || maxAnisotropy <= 1) {
    return () => {};
  }

  const originalAnisotropy = new Map<THREE.Texture, number>();

  scene.traverse((object) => {
    getObjectMaterials(object).forEach((material) => {
      collectMaterialTextures(material).forEach((texture) => {
        if (originalAnisotropy.has(texture)) {
          return;
        }

        originalAnisotropy.set(texture, texture.anisotropy);
        texture.anisotropy = maxAnisotropy;
        texture.needsUpdate = true;
      });
    });
  });

  return () => {
    originalAnisotropy.forEach((anisotropy, texture) => {
      texture.anisotropy = anisotropy;
      texture.needsUpdate = true;
    });
  };
}

export function applySnapshotShadowQuality(
  scene: THREE.Scene,
  gl: THREE.WebGLRenderer,
  detailLevel: SnapshotDetailLevel,
  shadowStyle: SnapshotShadowStyle,
): Cleanup {
  const shadowStyleSettings = SNAPSHOT_SHADOW_STYLE_SETTINGS[shadowStyle];
  const requestedShadowMapSize = SNAPSHOT_DETAIL_SHADOW_MAP_SIZE[detailLevel];
  if (!requestedShadowMapSize || !gl.shadowMap.enabled) {
    return () => {};
  }
  const maxShadowMapSize = Number.isFinite(gl.capabilities.maxTextureSize)
    ? Math.max(256, Math.floor(gl.capabilities.maxTextureSize))
    : requestedShadowMapSize;
  const targetShadowMapSize = Math.min(
    Math.max(256, Math.round(requestedShadowMapSize * shadowStyleSettings.mapSizeMultiplier)),
    maxShadowMapSize,
  );

  const trackedLights: Array<{
    light: THREE.DirectionalLight;
    previousMapSize: THREE.Vector2;
    previousRadius: number;
    previousBias: number;
    previousNormalBias: number;
    previousBlurSamples: number | null;
  }> = [];
  const previousShadowMapType = gl.shadowMap.type;

  scene.traverse((object) => {
    if (!(object instanceof THREE.DirectionalLight) || !object.castShadow) {
      return;
    }

    trackedLights.push({
      light: object,
      previousMapSize: object.shadow.mapSize.clone(),
      previousRadius: object.shadow.radius,
      previousBias: object.shadow.bias,
      previousNormalBias: object.shadow.normalBias,
      previousBlurSamples:
        typeof (object.shadow as THREE.LightShadow & { blurSamples?: unknown }).blurSamples ===
        'number'
          ? (object.shadow as THREE.LightShadow & { blurSamples: number }).blurSamples
          : null,
    });

    object.shadow.map?.dispose();
    object.shadow.map = null;
    object.shadow.mapSize.set(targetShadowMapSize, targetShadowMapSize);
    object.shadow.radius = shadowStyleSettings.radius;
    object.shadow.bias = shadowStyleSettings.bias;
    object.shadow.normalBias = shadowStyleSettings.normalBias;
    if ('blurSamples' in object.shadow) {
      (object.shadow as THREE.LightShadow & { blurSamples: number }).blurSamples =
        shadowStyleSettings.blurSamples;
    }
    object.shadow.needsUpdate = true;
  });

  const previousAutoUpdate = gl.shadowMap.autoUpdate;
  gl.shadowMap.type = shadowStyleSettings.shadowMapType;
  gl.shadowMap.autoUpdate = true;
  gl.shadowMap.needsUpdate = true;

  return () => {
    trackedLights.forEach(
      ({
        light,
        previousMapSize,
        previousRadius,
        previousBias,
        previousNormalBias,
        previousBlurSamples,
      }) => {
        light.shadow.map?.dispose();
        light.shadow.map = null;
        light.shadow.mapSize.copy(previousMapSize);
        light.shadow.radius = previousRadius;
        light.shadow.bias = previousBias;
        light.shadow.normalBias = previousNormalBias;
        if ('blurSamples' in light.shadow) {
          (light.shadow as THREE.LightShadow & { blurSamples: number }).blurSamples =
            previousBlurSamples ?? 0;
        }
        light.shadow.needsUpdate = true;
      },
    );

    gl.shadowMap.type = previousShadowMapType;
    gl.shadowMap.autoUpdate = previousAutoUpdate;
    gl.shadowMap.needsUpdate = true;
  };
}
