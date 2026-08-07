export const LIGHTING_CONFIG = {
  ambientIntensity: 0.04,
  hemisphereIntensity: 0.3,
  hemisphereSky: '#f4f7ff',
  hemisphereGround: '#151c26',
  mainLightColor: '#fffaf2',
  mainLightIntensity: 1.35,
  mainLightPosition: [8, -10, 14] as [number, number, number],
  fillLightColor: '#bfd7ff',
  leftFillIntensity: 0.3,
  leftFillPosition: [-10, -4, 7] as [number, number, number],
  leftSideIntensity: 0.03,
  leftSidePosition: [-7, 2, 6] as [number, number, number],
  rightFillIntensity: 0.03,
  rightFillPosition: [7, -2, 5] as [number, number, number],
  rimLightColor: '#e8f0ff',
  rimLightIntensity: 0.22,
  rimLightPosition: [-4, 10, 12] as [number, number, number],
  cameraKeyIntensityLight: 0.06,
  cameraKeyIntensityDark: 0.05,
  cameraKeyPriorityIntensityLight: 0.08,
  cameraKeyPriorityIntensityDark: 0.06,
  cameraFillIntensityLight: 0.018,
  cameraFillIntensityDark: 0.015,
  cameraSoftFrontIntensityLight: 0.03,
  cameraSoftFrontIntensityDark: 0.025,
} as const;

export const GROUND_SHADOW_STYLE = {
  light: {
    color: '#000000',
    opacity: 0.045,
  },
  dark: {
    color: '#000000',
    opacity: 0.2,
  },
} as const;

export const GROUND_SHADOW_RENDER_ORDER = -110;
export const GROUND_SHADOW_Z_OFFSET = -0.0015;

export function resolveCameraFollowLightingStyle(theme: 'light' | 'dark') {
  return {
    ambientIntensity: theme === 'light' ? 0.03 : 0.02,
    hemisphereIntensity: theme === 'light' ? 0.3 : 0.28,
    staticDirectionalScale: theme === 'light' ? 1 : 0.96,
    rimDirectionalScale: 1,
    mainLightIntensity: LIGHTING_CONFIG.mainLightIntensity * (theme === 'light' ? 1 : 0.96),
    cameraKeyIntensity:
      theme === 'light'
        ? LIGHTING_CONFIG.cameraKeyPriorityIntensityLight
        : LIGHTING_CONFIG.cameraKeyPriorityIntensityDark,
    cameraFillIntensity:
      theme === 'light'
        ? LIGHTING_CONFIG.cameraFillIntensityLight
        : LIGHTING_CONFIG.cameraFillIntensityDark,
    cameraSoftFrontIntensity:
      theme === 'light'
        ? LIGHTING_CONFIG.cameraSoftFrontIntensityLight
        : LIGHTING_CONFIG.cameraSoftFrontIntensityDark,
    toneMappingExposure: theme === 'light' ? 0.98 : 1,
  } as const;
}

export const STUDIO_ENVIRONMENT_INTENSITY = {
  viewer: {
    light: 0.31,
    dark: 0.29,
  },
  workspace: {
    light: 0.42,
    dark: 0.4,
  },
} as const;

export const WORKSPACE_CANVAS_BACKGROUND = {
  light: '#f3f4f6',
  dark: '#1f1f1f',
} as const;

// Match robot_viewer's +Z presentation while preserving URDF Studio's internal Z-up world.
export const WORKSPACE_DEFAULT_CAMERA_POSITION: [number, number, number] = [2.6, -2.6, 4.6];
export const WORKSPACE_DEFAULT_CAMERA_UP: [number, number, number] = [0, 0, 1];
export const WORKSPACE_DEFAULT_CAMERA_FOV = 68;

// Orthographic projection defaults. R3F's <Canvas camera> prop always creates
// a PerspectiveCamera, so the orthographic camera is provided by drei's
// <OrthographicCamera makeDefault> inside the canvas. drei sizes the camera
// frustum to the viewport pixel dimensions, and `zoom` is the world-unit
// scale: at zoom Z, one world unit spans Z pixels. The perspective default
// camera ends up ~1.4 m from the framed target with FOV 68, exposing roughly
// ±0.9 m vertically; matching that on a ~720px-tall viewport needs zoom ≈
// 360/0.9 ≈ 400. Users refine framing with orbit zoom afterwards.
export const WORKSPACE_DEFAULT_CAMERA_ORTHOGRAPHIC_ZOOM = 400;
export const WORKSPACE_DEFAULT_CAMERA_ORTHOGRAPHIC_FRUSTUM = {
  left: -10,
  right: 10,
  top: 10,
  bottom: -10,
} as const;
