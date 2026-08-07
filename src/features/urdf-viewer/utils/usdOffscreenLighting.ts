import * as THREE from 'three';
import { createZUpRoomEnvironment } from '@/shared/components/3d/scene/zUpRoomEnvironment';
import {
  GROUND_SHADOW_RENDER_ORDER,
  GROUND_SHADOW_STYLE,
  GROUND_SHADOW_Z_OFFSET,
  LIGHTING_CONFIG,
  resolveCameraFollowLightingStyle,
  STUDIO_ENVIRONMENT_INTENSITY,
} from '../../../shared/components/3d/scene/constants.ts';

type SceneWithEnvironmentIntensity = THREE.Scene & {
  environmentIntensity?: number;
};

type DisposableObject3D = THREE.Object3D & {
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[];
};

const OFFSCREEN_CAMERA_FOLLOW_LAYOUT = Object.freeze({
  targetDistance: 10,
  softFrontUpOffset: 1.0,
  softFrontForwardOffset: 0.35,
  fillRightOffset: 2.8,
  fillUpOffset: 1.7,
  fillForwardOffset: 0.6,
});

export interface UsdOffscreenLightRig {
  ambientLight: THREE.AmbientLight;
  hemisphereLight: THREE.HemisphereLight;
  mainLight: THREE.DirectionalLight;
  fillLightLeft: THREE.DirectionalLight;
  fillLightLeftSide: THREE.DirectionalLight;
  fillLightRight: THREE.DirectionalLight;
  rimLight: THREE.DirectionalLight;
  cameraKeyLight: THREE.DirectionalLight;
  cameraSoftFrontLight: THREE.DirectionalLight;
  cameraFillRightLight: THREE.DirectionalLight;
  cameraFillLeftLight: THREE.DirectionalLight;
  lights: THREE.Light[];
  targets: THREE.Object3D[];
  cameraDirection: THREE.Vector3;
  cameraTarget: THREE.Vector3;
  cameraRight: THREE.Vector3;
  cameraUp: THREE.Vector3;
}

export interface UsdOffscreenStudioEnvironmentHandle {
  setIntensity: (intensity: number) => void;
  dispose: () => void;
}

export function createUsdOffscreenGroundShadowPlane(theme: 'light' | 'dark' = 'light'): THREE.Mesh {
  const shadowStyle = GROUND_SHADOW_STYLE[theme];
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.ShadowMaterial({
      color: new THREE.Color(shadowStyle.color),
      opacity: shadowStyle.opacity,
    }),
  );

  plane.name = 'GroundShadowPlane';
  plane.receiveShadow = true;
  plane.castShadow = false;
  plane.renderOrder = GROUND_SHADOW_RENDER_ORDER;
  plane.userData = {
    ...(plane.userData ?? {}),
    isHelper: true,
    isSelectableHelper: false,
  };

  return plane;
}

export function syncUsdOffscreenGroundShadowPlane(
  plane: THREE.Object3D | null | undefined,
  groundPlaneOffset: number,
): void {
  if (!plane) {
    return;
  }

  plane.position.set(0, 0, groundPlaneOffset + GROUND_SHADOW_Z_OFFSET);
  plane.updateMatrixWorld(true);
}

export function applyUsdOffscreenGroundShadowTheme(
  plane: THREE.Mesh | null | undefined,
  theme: 'light' | 'dark',
): void {
  if (!plane) {
    return;
  }

  const shadowStyle = GROUND_SHADOW_STYLE[theme];
  const material = plane.material;
  if (!(material instanceof THREE.ShadowMaterial)) {
    return;
  }

  material.color.set(shadowStyle.color);
  material.opacity = shadowStyle.opacity;
  material.needsUpdate = true;
}

function createDirectionalLight(
  name: string,
  color: THREE.ColorRepresentation,
  intensity: number,
  position: readonly [number, number, number],
): THREE.DirectionalLight {
  const light = new THREE.DirectionalLight(color, intensity);
  light.name = name;
  light.position.fromArray(position as [number, number, number]);
  return light;
}

export function createUsdOffscreenLightRig(
  scene: THREE.Scene,
  theme: 'light' | 'dark' = 'light',
): UsdOffscreenLightRig {
  const cameraFollowStyle = resolveCameraFollowLightingStyle(theme);
  const ambientLight = new THREE.AmbientLight(0xffffff, cameraFollowStyle.ambientIntensity);
  ambientLight.name = 'OffscreenViewerAmbientLight';

  const hemisphereLight = new THREE.HemisphereLight(
    LIGHTING_CONFIG.hemisphereSky,
    LIGHTING_CONFIG.hemisphereGround,
    cameraFollowStyle.hemisphereIntensity,
  );
  hemisphereLight.name = 'OffscreenViewerHemisphereLight';
  hemisphereLight.position.set(0, 0, 1);

  const mainLight = createDirectionalLight(
    'OffscreenViewerMainLight',
    LIGHTING_CONFIG.mainLightColor,
    cameraFollowStyle.mainLightIntensity,
    LIGHTING_CONFIG.mainLightPosition,
  );
  mainLight.castShadow = true;
  mainLight.shadow.mapSize.set(1024, 1024);
  mainLight.shadow.camera.near = 0.5;
  mainLight.shadow.camera.far = 50;
  mainLight.shadow.camera.left = -10;
  mainLight.shadow.camera.right = 10;
  mainLight.shadow.camera.top = 10;
  mainLight.shadow.camera.bottom = -10;
  mainLight.shadow.bias = -0.0001;
  mainLight.shadow.normalBias = 0.005;

  const fillLightLeft = createDirectionalLight(
    'OffscreenViewerFillLightLeft',
    LIGHTING_CONFIG.fillLightColor,
    LIGHTING_CONFIG.leftFillIntensity * cameraFollowStyle.staticDirectionalScale,
    LIGHTING_CONFIG.leftFillPosition,
  );

  const fillLightLeftSide = createDirectionalLight(
    'OffscreenViewerFillLightLeftSide',
    LIGHTING_CONFIG.fillLightColor,
    LIGHTING_CONFIG.leftSideIntensity * cameraFollowStyle.staticDirectionalScale,
    LIGHTING_CONFIG.leftSidePosition,
  );

  const fillLightRight = createDirectionalLight(
    'OffscreenViewerFillLightRight',
    LIGHTING_CONFIG.fillLightColor,
    LIGHTING_CONFIG.rightFillIntensity * cameraFollowStyle.staticDirectionalScale,
    LIGHTING_CONFIG.rightFillPosition,
  );

  const rimLight = createDirectionalLight(
    'OffscreenViewerRimLight',
    LIGHTING_CONFIG.rimLightColor,
    LIGHTING_CONFIG.rimLightIntensity * cameraFollowStyle.rimDirectionalScale,
    LIGHTING_CONFIG.rimLightPosition,
  );

  const cameraKeyLight = createDirectionalLight(
    'OffscreenViewerCameraKeyLight',
    LIGHTING_CONFIG.mainLightColor,
    cameraFollowStyle.cameraKeyIntensity,
    [0, 0, 0],
  );

  const cameraSoftFrontLight = createDirectionalLight(
    'OffscreenViewerCameraSoftFrontLight',
    LIGHTING_CONFIG.fillLightColor,
    cameraFollowStyle.cameraSoftFrontIntensity,
    [0, 0, 0],
  );

  const cameraFillRightLight = createDirectionalLight(
    'OffscreenViewerCameraFillLightRight',
    LIGHTING_CONFIG.fillLightColor,
    cameraFollowStyle.cameraFillIntensity,
    [0, 0, 0],
  );

  const cameraFillLeftLight = createDirectionalLight(
    'OffscreenViewerCameraFillLightLeft',
    LIGHTING_CONFIG.fillLightColor,
    cameraFollowStyle.cameraFillIntensity,
    [0, 0, 0],
  );

  const lights: THREE.Light[] = [
    ambientLight,
    hemisphereLight,
    mainLight,
    fillLightLeft,
    fillLightLeftSide,
    fillLightRight,
    rimLight,
    cameraKeyLight,
    cameraSoftFrontLight,
    cameraFillRightLight,
    cameraFillLeftLight,
  ];

  const targets = [
    cameraKeyLight.target,
    cameraSoftFrontLight.target,
    cameraFillRightLight.target,
    cameraFillLeftLight.target,
  ];

  lights.forEach((light) => scene.add(light));
  targets.forEach((target) => scene.add(target));

  return {
    ambientLight,
    hemisphereLight,
    mainLight,
    fillLightLeft,
    fillLightLeftSide,
    fillLightRight,
    rimLight,
    cameraKeyLight,
    cameraSoftFrontLight,
    cameraFillRightLight,
    cameraFillLeftLight,
    lights,
    targets,
    cameraDirection: new THREE.Vector3(),
    cameraTarget: new THREE.Vector3(),
    cameraRight: new THREE.Vector3(),
    cameraUp: new THREE.Vector3(),
  };
}

export function syncUsdOffscreenLightRigWithCamera(
  rig: UsdOffscreenLightRig,
  camera: THREE.Camera,
): void {
  camera.getWorldDirection(rig.cameraDirection);
  rig.cameraTarget
    .copy(camera.position)
    .addScaledVector(rig.cameraDirection, OFFSCREEN_CAMERA_FOLLOW_LAYOUT.targetDistance);

  rig.cameraKeyLight.position.copy(camera.position);
  rig.cameraKeyLight.target.position.copy(rig.cameraTarget);
  rig.cameraKeyLight.target.updateMatrixWorld();

  rig.cameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
  rig.cameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();

  rig.cameraSoftFrontLight.position
    .copy(camera.position)
    .addScaledVector(rig.cameraUp, OFFSCREEN_CAMERA_FOLLOW_LAYOUT.softFrontUpOffset)
    .addScaledVector(rig.cameraDirection, OFFSCREEN_CAMERA_FOLLOW_LAYOUT.softFrontForwardOffset);
  rig.cameraSoftFrontLight.target.position.copy(rig.cameraTarget);
  rig.cameraSoftFrontLight.target.updateMatrixWorld();

  rig.cameraFillRightLight.position
    .copy(camera.position)
    .addScaledVector(rig.cameraRight, OFFSCREEN_CAMERA_FOLLOW_LAYOUT.fillRightOffset)
    .addScaledVector(rig.cameraUp, OFFSCREEN_CAMERA_FOLLOW_LAYOUT.fillUpOffset)
    .addScaledVector(rig.cameraDirection, OFFSCREEN_CAMERA_FOLLOW_LAYOUT.fillForwardOffset);
  rig.cameraFillRightLight.target.position.copy(rig.cameraTarget);
  rig.cameraFillRightLight.target.updateMatrixWorld();

  rig.cameraFillLeftLight.position
    .copy(camera.position)
    .addScaledVector(rig.cameraRight, -OFFSCREEN_CAMERA_FOLLOW_LAYOUT.fillRightOffset)
    .addScaledVector(rig.cameraUp, OFFSCREEN_CAMERA_FOLLOW_LAYOUT.fillUpOffset)
    .addScaledVector(rig.cameraDirection, OFFSCREEN_CAMERA_FOLLOW_LAYOUT.fillForwardOffset);
  rig.cameraFillLeftLight.target.position.copy(rig.cameraTarget);
  rig.cameraFillLeftLight.target.updateMatrixWorld();
}

export function disposeUsdOffscreenLightRig(
  scene: THREE.Scene | null | undefined,
  rig: UsdOffscreenLightRig | null | undefined,
): void {
  if (!scene || !rig) {
    return;
  }

  rig.lights.forEach((light) => scene.remove(light));
  rig.targets.forEach((target) => scene.remove(target));
}

export function createUsdOffscreenStudioEnvironment(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  theme: 'light' | 'dark' = 'light',
): UsdOffscreenStudioEnvironmentHandle {
  const sceneWithEnvironmentIntensity = scene as SceneWithEnvironmentIntensity;
  const previousEnvironment = scene.environment;
  const previousEnvironmentIntensity = sceneWithEnvironmentIntensity.environmentIntensity;
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const envScene = createZUpRoomEnvironment();
  const renderTarget = pmremGenerator.fromScene(envScene, 0.04);

  scene.environment = renderTarget.texture;
  sceneWithEnvironmentIntensity.environmentIntensity = STUDIO_ENVIRONMENT_INTENSITY.viewer[theme];

  return {
    setIntensity: (intensity: number) => {
      sceneWithEnvironmentIntensity.environmentIntensity = intensity;
    },
    dispose: () => {
      scene.environment = previousEnvironment;
      sceneWithEnvironmentIntensity.environmentIntensity = previousEnvironmentIntensity;
      renderTarget.dispose();
      envScene.traverse((child) => {
        const disposableChild = child as DisposableObject3D;
        disposableChild.geometry?.dispose();
        if (Array.isArray(disposableChild.material)) {
          disposableChild.material.forEach((material) => material.dispose());
        } else {
          disposableChild.material?.dispose();
        }
      });
      pmremGenerator.dispose();
    },
  };
}
