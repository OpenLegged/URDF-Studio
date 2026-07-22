import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Theme } from '@/types';
import { LIGHTING_CONFIG, resolveCameraFollowLightingStyle } from './constants';
import { useWorkspaceCanvasInteractionState } from './interactionQuality';
import { useSnapshotRenderActive } from './SnapshotRenderContext';
import { resolveEffectiveTheme } from './themeUtils';

interface SceneLightingProps {
  theme?: Theme;
  cameraFollowPrimary?: boolean;
  enableShadows?: boolean;
  shadowMapSize?: number;
}

export function SceneLighting({
  theme = 'system',
  cameraFollowPrimary = false,
  enableShadows = true,
  shadowMapSize,
}: SceneLightingProps) {
  const { scene, gl, invalidate } = useThree();
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as
    | (THREE.EventDispatcher & { addEventListener: (...args: never[]) => void })
    | null;
  const cameraKeyLightRef = useRef<THREE.DirectionalLight>(null);
  const cameraSoftFrontLightRef = useRef<THREE.DirectionalLight>(null);
  const cameraFillRightLightRef = useRef<THREE.DirectionalLight>(null);
  const cameraFillLeftLightRef = useRef<THREE.DirectionalLight>(null);
  const cameraDirectionRef = useRef(new THREE.Vector3());
  const cameraTargetRef = useRef(new THREE.Vector3());
  const cameraRightRef = useRef(new THREE.Vector3());
  const cameraUpRef = useRef(new THREE.Vector3());
  const lastCameraPositionRef = useRef(new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN));
  const lastCameraQuaternionRef = useRef(
    new THREE.Quaternion(Number.NaN, Number.NaN, Number.NaN, Number.NaN),
  );

  const effectiveTheme = resolveEffectiveTheme(theme);
  const snapshotRenderActive = useSnapshotRenderActive();
  const isInteracting = useWorkspaceCanvasInteractionState();
  const cameraFollowStyle = resolveCameraFollowLightingStyle(effectiveTheme);
  const shouldUseShadows =
    snapshotRenderActive || (enableShadows && (cameraFollowPrimary || effectiveTheme !== 'light'));
  const resolvedShadowMapSize = shadowMapSize ?? (cameraFollowPrimary ? 1024 : 768);
  const staticDirectionalScale = cameraFollowPrimary ? cameraFollowStyle.staticDirectionalScale : 1;
  const rimDirectionalScale = cameraFollowPrimary
    ? cameraFollowStyle.rimDirectionalScale
    : staticDirectionalScale;
  const ambientIntensity = cameraFollowPrimary
    ? cameraFollowStyle.ambientIntensity
    : effectiveTheme === 'light'
      ? LIGHTING_CONFIG.ambientIntensity * 1.5
      : LIGHTING_CONFIG.ambientIntensity;
  const hemisphereIntensity = cameraFollowPrimary
    ? cameraFollowStyle.hemisphereIntensity
    : effectiveTheme === 'light'
      ? LIGHTING_CONFIG.hemisphereIntensity * 1.1
      : LIGHTING_CONFIG.hemisphereIntensity;
  const cameraKeyIntensity = cameraFollowPrimary
    ? cameraFollowStyle.cameraKeyIntensity
    : effectiveTheme === 'light'
      ? LIGHTING_CONFIG.cameraKeyIntensityLight
      : LIGHTING_CONFIG.cameraKeyIntensityDark;
  const cameraFillIntensity = cameraFollowPrimary ? cameraFollowStyle.cameraFillIntensity : 0;
  const cameraSoftFrontIntensity = cameraFollowPrimary
    ? cameraFollowStyle.cameraSoftFrontIntensity
    : 0;

  useEffect(() => {
    gl.shadowMap.enabled = shouldUseShadows;
    if (shouldUseShadows) {
      gl.shadowMap.type = THREE.PCFSoftShadowMap;
      // Snapshot rendering needs a normal auto-updating pass; interactive
      // rendering's autoUpdate is owned by the interaction effect below.
      gl.shadowMap.autoUpdate = snapshotRenderActive;
    } else {
      gl.shadowMap.autoUpdate = false;
    }

    scene.receiveShadow = true;
    gl.toneMapping = cameraFollowPrimary ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = cameraFollowPrimary
      ? cameraFollowStyle.toneMappingExposure
      : effectiveTheme === 'light'
        ? 1.08
        : 1.1;
    gl.outputColorSpace = THREE.SRGBColorSpace;
  }, [
    cameraFollowPrimary,
    cameraFollowStyle.toneMappingExposure,
    effectiveTheme,
    gl,
    scene,
    shouldUseShadows,
    snapshotRenderActive,
  ]);

  // Joint/link dragging changes the scene every demanded frame. Reusing the
  // last shadow map during that short interaction avoids a second full scene
  // render; the settled frame below refreshes the shadow immediately afterward.
  useEffect(() => {
    if (!shouldUseShadows || snapshotRenderActive) {
      return;
    }

    gl.shadowMap.autoUpdate = !isInteracting;
    if (!isInteracting) {
      invalidate();
    }
  }, [gl, invalidate, isInteracting, shouldUseShadows, snapshotRenderActive]);

  useEffect(() => {
    const keyLight = cameraKeyLightRef.current;
    const softFrontLight = cameraSoftFrontLightRef.current;
    const fillRightLight = cameraFillRightLightRef.current;
    const fillLeftLight = cameraFillLeftLightRef.current;
    if (!keyLight || !softFrontLight || !fillRightLight || !fillLeftLight) return;

    scene.add(keyLight.target);
    scene.add(softFrontLight.target);
    scene.add(fillRightLight.target);
    scene.add(fillLeftLight.target);

    return () => {
      scene.remove(keyLight.target);
      scene.remove(softFrontLight.target);
      scene.remove(fillRightLight.target);
      scene.remove(fillLeftLight.target);
    };
  }, [scene]);

  // Camera-following lights update only when the camera actually moves.
  // Previously this ran in useFrame on every demanded frame; now we listen to
  // OrbitControls 'change' which fires on rotate/pan/zoom + damping ticks +
  // programmatic controls.update() — covering every path the camera moves.
  useEffect(() => {
    const updateCameraLights = () => {
      const keyLight = cameraKeyLightRef.current;
      const softFrontLight = cameraSoftFrontLightRef.current;
      const fillRightLight = cameraFillRightLightRef.current;
      const fillLeftLight = cameraFillLeftLightRef.current;
      if (!keyLight || !softFrontLight || !fillRightLight || !fillLeftLight) return;

      if (
        lastCameraPositionRef.current.equals(camera.position) &&
        lastCameraQuaternionRef.current.equals(camera.quaternion)
      ) {
        return;
      }

      lastCameraPositionRef.current.copy(camera.position);
      lastCameraQuaternionRef.current.copy(camera.quaternion);

      camera.getWorldDirection(cameraDirectionRef.current);
      cameraTargetRef.current.copy(camera.position).addScaledVector(cameraDirectionRef.current, 10);

      keyLight.position.copy(camera.position);
      keyLight.target.position.copy(cameraTargetRef.current);
      keyLight.target.updateMatrixWorld();

      softFrontLight.position
        .copy(camera.position)
        .addScaledVector(cameraUpRef.current.set(0, 1, 0).applyQuaternion(camera.quaternion), 1.0);
      softFrontLight.position.addScaledVector(cameraDirectionRef.current, 0.35);
      softFrontLight.target.position.copy(cameraTargetRef.current);
      softFrontLight.target.updateMatrixWorld();

      cameraRightRef.current.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
      cameraUpRef.current.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();

      fillRightLight.position
        .copy(camera.position)
        .addScaledVector(cameraRightRef.current, 2.8)
        .addScaledVector(cameraUpRef.current, 1.7)
        .addScaledVector(cameraDirectionRef.current, 0.6);
      fillRightLight.target.position.copy(cameraTargetRef.current);
      fillRightLight.target.updateMatrixWorld();

      fillLeftLight.position
        .copy(camera.position)
        .addScaledVector(cameraRightRef.current, -2.8)
        .addScaledVector(cameraUpRef.current, 1.7)
        .addScaledVector(cameraDirectionRef.current, 0.6);
      fillLeftLight.target.position.copy(cameraTargetRef.current);
      fillLeftLight.target.updateMatrixWorld();
    };

    updateCameraLights();

    if (!controls || typeof controls.addEventListener !== 'function') {
      return;
    }
    const handler = updateCameraLights as never;
    controls.addEventListener('change' as never, handler);
    return () => {
      controls.removeEventListener?.('change' as never, handler);
    };
  }, [camera, controls]);

  return (
    <>
      <ambientLight intensity={ambientIntensity} color="#ffffff" />

      <hemisphereLight
        args={[
          LIGHTING_CONFIG.hemisphereSky,
          LIGHTING_CONFIG.hemisphereGround,
          hemisphereIntensity,
        ]}
        position={[0, 0, 1]}
      />

      <directionalLight
        name="MainLight"
        position={LIGHTING_CONFIG.mainLightPosition}
        intensity={
          cameraFollowPrimary
            ? cameraFollowStyle.mainLightIntensity
            : LIGHTING_CONFIG.mainLightIntensity * staticDirectionalScale
        }
        color={LIGHTING_CONFIG.mainLightColor}
        castShadow={shouldUseShadows}
        shadow-mapSize-width={resolvedShadowMapSize}
        shadow-mapSize-height={resolvedShadowMapSize}
        shadow-camera-far={50}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
        shadow-bias={-0.0001}
        shadow-normalBias={0.005}
      />

      <directionalLight
        name="FillLightLeft"
        position={LIGHTING_CONFIG.leftFillPosition}
        intensity={LIGHTING_CONFIG.leftFillIntensity * staticDirectionalScale}
        color={LIGHTING_CONFIG.fillLightColor}
        castShadow={false}
      />

      <directionalLight
        name="FillLightLeftSide"
        position={LIGHTING_CONFIG.leftSidePosition}
        intensity={LIGHTING_CONFIG.leftSideIntensity * staticDirectionalScale}
        color={LIGHTING_CONFIG.fillLightColor}
        castShadow={false}
      />

      <directionalLight
        name="FillLightRight"
        position={LIGHTING_CONFIG.rightFillPosition}
        intensity={LIGHTING_CONFIG.rightFillIntensity * staticDirectionalScale}
        color={LIGHTING_CONFIG.fillLightColor}
        castShadow={false}
      />

      <directionalLight
        name="RimLight"
        position={LIGHTING_CONFIG.rimLightPosition}
        intensity={LIGHTING_CONFIG.rimLightIntensity * rimDirectionalScale}
        color={LIGHTING_CONFIG.rimLightColor}
        castShadow={false}
      />

      <directionalLight
        ref={cameraKeyLightRef}
        name="CameraKeyLight"
        position={[0, 0, 0]}
        intensity={cameraKeyIntensity}
        color={LIGHTING_CONFIG.mainLightColor}
        castShadow={false}
      />
      <directionalLight
        ref={cameraSoftFrontLightRef}
        name="CameraSoftFrontLight"
        position={[0, 0, 0]}
        intensity={cameraSoftFrontIntensity}
        color={LIGHTING_CONFIG.fillLightColor}
        castShadow={false}
      />
      <directionalLight
        ref={cameraFillRightLightRef}
        name="CameraFillLightRight"
        position={[0, 0, 0]}
        intensity={cameraFillIntensity}
        color={LIGHTING_CONFIG.fillLightColor}
        castShadow={false}
      />
      <directionalLight
        ref={cameraFillLeftLightRef}
        name="CameraFillLightLeft"
        position={[0, 0, 0]}
        intensity={cameraFillIntensity}
        color={LIGHTING_CONFIG.fillLightColor}
        castShadow={false}
      />
    </>
  );
}
