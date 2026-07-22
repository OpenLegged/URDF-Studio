import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { createZUpRoomEnvironment } from './zUpRoomEnvironment';

type SceneWithEnvironmentIntensity = THREE.Scene & {
  environmentIntensity?: number;
};

type DisposableObject3D = THREE.Object3D & {
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[];
};

export function NeutralStudioEnvironment({
  enabled = true,
  intensity = 0.35,
}: {
  enabled?: boolean;
  intensity?: number;
}) {
  const { scene, gl, invalidate } = useThree();

  useEffect(() => {
    if (!enabled) return;

    const previousEnvironment = scene.environment;
    const sceneWithEnvironmentIntensity = scene as SceneWithEnvironmentIntensity;
    const previousEnvironmentIntensity = sceneWithEnvironmentIntensity.environmentIntensity;
    const pmremGenerator = new THREE.PMREMGenerator(gl);
    const envScene = createZUpRoomEnvironment();
    const renderTarget = pmremGenerator.fromScene(envScene, 0.04);

    scene.environment = renderTarget.texture;
    invalidate();

    return () => {
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
      invalidate();
    };
  }, [enabled, gl, invalidate, scene]);

  useEffect(() => {
    if (!enabled) return;

    const sceneWithEnvironmentIntensity = scene as SceneWithEnvironmentIntensity;
    if (sceneWithEnvironmentIntensity.environmentIntensity === intensity) return;

    sceneWithEnvironmentIntensity.environmentIntensity = intensity;
    invalidate();
  }, [enabled, gl, intensity, invalidate, scene]);

  return null;
}
