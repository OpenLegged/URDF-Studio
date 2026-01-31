/**
 * Shared Scene Utilities
 * Used by both Visualizer.tsx and URDFViewer.tsx
 */

import React, { useRef, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { Grid } from '@react-three/drei';
import * as THREE from 'three';

// Helper component to trigger re-render on pointer move for hover detection (frameloop="demand")
// Optimized to reduce unnecessary invalidations and CPU usage
export const HoverInvalidator = () => {
  const { gl, invalidate } = useThree();
  const isOrbitDragging = useRef(false);
  const lastMoveTime = useRef(0);
  const invalidateThrottle = 50; // Throttle to 20 FPS for hover updates

  useEffect(() => {
    const handlePointerMove = () => {
      // Skip invalidation during orbit dragging to improve performance
      if (isOrbitDragging.current) return;

      // Throttle invalidate calls to reduce CPU usage
      const now = Date.now();
      if (now - lastMoveTime.current > invalidateThrottle) {
        lastMoveTime.current = now;
        invalidate();
      }
    };

    const handlePointerDown = () => {
      isOrbitDragging.current = true;
    };

    const handlePointerUp = () => {
      isOrbitDragging.current = false;
      invalidate();
    };

    gl.domElement.addEventListener('pointermove', handlePointerMove, { passive: true });
    gl.domElement.addEventListener('pointerdown', handlePointerDown);
    gl.domElement.addEventListener('pointerup', handlePointerUp);
    gl.domElement.addEventListener('pointerleave', handlePointerUp);

    return () => {
      gl.domElement.removeEventListener('pointermove', handlePointerMove);
      gl.domElement.removeEventListener('pointerdown', handlePointerDown);
      gl.domElement.removeEventListener('pointerup', handlePointerUp);
      gl.domElement.removeEventListener('pointerleave', handlePointerUp);
    };
  }, [gl, invalidate]);

  return null;
};

// Snapshot Manager for high-res capture without gizmos
export const SnapshotManager = ({
  actionRef,
  robotName
}: {
  actionRef?: React.MutableRefObject<(() => void) | null>;
  robotName: string;
}) => {
  const { gl, scene, camera } = useThree();

  useEffect(() => {
    if (!actionRef) return;

    actionRef.current = () => {
      // 1. Hide Gizmos, Grid and Helpers
      const hiddenObjects: THREE.Object3D[] = [];
      scene.traverse((obj) => {
        if (obj.userData.isGizmo ||
          obj.name === 'ReferenceGrid' ||
          obj.type.includes('Grid') ||
          obj.type.includes('Helper') ||
          obj.type === 'AxesHelper' ||
          (obj as any).isTransformControls) {
          if (obj.visible) {
            obj.visible = false;
            hiddenObjects.push(obj);
          }
        }
      });

      // 2. Clear background for transparency
      const originalBackground = scene.background;
      scene.background = null;

      // 3. High Res Render
      const originalPixelRatio = gl.getPixelRatio();
      gl.setPixelRatio(4); // 4x Super Sampling

      gl.render(scene, camera);
      const dataUrl = gl.domElement.toDataURL('image/png', 1.0);

      // 4. Restore
      gl.setPixelRatio(originalPixelRatio);
      scene.background = originalBackground;
      hiddenObjects.forEach(obj => obj.visible = true);
      gl.render(scene, camera);

      // 5. Download
      const link = document.createElement('a');
      link.download = `${robotName}_snapshot.png`;
      link.href = dataUrl;
      link.click();
    };

    return () => {
      if (actionRef) actionRef.current = null;
    };
  }, [gl, scene, camera, robotName, actionRef]);

  return null;
};

// ============================================================
// SCENE LIGHTING CONFIGURATION
// 5-Point Lighting System for comprehensive robot illumination
// ============================================================
export const LIGHTING_CONFIG = {
  // Ambient: base global illumination (prevents pure black)
  ambientIntensity: 0.4,

  // Hemisphere: sky/ground color blend for natural ambient
  hemisphereIntensity: 0.35,
  hemisphereSky: '#ffffff',
  hemisphereGround: '#888888',

  // Main front light: front-right, reduced intensity to avoid overexposure
  mainLightIntensity: 0.4,
  mainLightPosition: [5, 5, 5] as [number, number, number],

  // Left front fill light: left-front to balance main light
  leftFillIntensity: 0.4,
  leftFillPosition: [-5, 5, 5] as [number, number, number],

  // Pure left side light: directly from left to illuminate left side
  leftSideIntensity: 0.35,
  leftSidePosition: [-6, 3, 0] as [number, number, number],

  // Right side fill light
  rightFillIntensity: 0.25,
  rightFillPosition: [5, 3, -3] as [number, number, number],

  // Back rim light: edge highlighting
  rimLightIntensity: 0.3,
  rimLightPosition: [0, 5, -5] as [number, number, number],
} as const;

// Scene lighting setup for Z-up coordinate system
// 5-Point lighting for comprehensive robot illumination
export function SceneLighting({ theme }: { theme?: 'light' | 'dark' }) {
  const { scene, gl } = useThree();

  useEffect(() => {
    // Enable high-quality soft shadows
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
    scene.receiveShadow = true;

    // Configure tone mapping: ACESFilmicToneMapping for realistic color reproduction
    // Prevents overexposure on white parts while revealing detail in dark areas
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = theme === 'light' ? 1.0 : 1.1; // Reduced exposure for light mode

    // Ensure proper sRGB output color space
    gl.outputColorSpace = THREE.SRGBColorSpace;

    console.log(`[SceneLighting] Configured: ACESFilmic tone mapping, exposure ${gl.toneMappingExposure}, sRGB output`);
  }, [scene, gl, theme]);

  return (
    <>
      {/* Ambient light - base global fill (prevents pure black shadows) */}
      <ambientLight intensity={theme === 'light' ? 0.6 : LIGHTING_CONFIG.ambientIntensity} color="#ffffff" />

      {/* Hemisphere light - critical for 360° visibility
          White sky + grey ground ensures bottom surfaces are visible */}
      <hemisphereLight
        args={[
          LIGHTING_CONFIG.hemisphereSky,
          theme === 'light' ? '#ffffff' : LIGHTING_CONFIG.hemisphereGround,
          theme === 'light' ? 0.4 : LIGHTING_CONFIG.hemisphereIntensity
        ]}
        position={[0, 1, 0]}
      />

      {/* 1. Main front light - right-front 45° with shadows */}
      <directionalLight
        position={LIGHTING_CONFIG.mainLightPosition}
        intensity={theme === 'light' ? 0.5 : LIGHTING_CONFIG.mainLightIntensity}
        color="#ffffff"
        castShadow={theme !== 'light'} // Disable shadows in light mode to fix artifacts
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={50}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
        shadow-bias={-0.0001}
        shadow-normalBias={0.02}
      />

      {/* 2. Left front fill light */}
      <directionalLight
        position={LIGHTING_CONFIG.leftFillPosition}
        intensity={LIGHTING_CONFIG.leftFillIntensity}
        color="#ffffff"
        castShadow={false}
      />

      {/* 3. Pure left side light - directly illuminates left side */}
      <directionalLight
        position={LIGHTING_CONFIG.leftSidePosition}
        intensity={LIGHTING_CONFIG.leftSideIntensity}
        color="#ffffff"
        castShadow={false}
      />

      {/* 4. Right side fill light */}
      <directionalLight
        position={LIGHTING_CONFIG.rightFillPosition}
        intensity={LIGHTING_CONFIG.rightFillIntensity}
        color="#ffffff"
        castShadow={false}
      />

      {/* 5. Back rim light - edge highlighting */}
      <directionalLight
        position={LIGHTING_CONFIG.rimLightPosition}
        intensity={LIGHTING_CONFIG.rimLightIntensity}
        color="#ffffff"
        castShadow={false}
      />
    </>
  );
}

// ============================================================
// REFERENCE GRID WITH LOW RENDER ORDER
// Ensures grid renders before transparent collision meshes
// ============================================================
interface ReferenceGridProps {
  theme: 'light' | 'dark';
}

export function ReferenceGrid({ theme }: ReferenceGridProps) {
  const gridRef = useRef<THREE.Object3D>(null);

  useEffect(() => {
    if (gridRef.current) {
      // Set low renderOrder so grid renders before collision meshes (renderOrder=999)
      gridRef.current.renderOrder = -100;
      // Traverse children to set renderOrder on all grid materials
      gridRef.current.traverse((child) => {
        if ((child as any).isMesh || (child as any).isLine) {
          child.renderOrder = -100;
          if ((child as any).material) {
            const mat = (child as any).material;
            // Grid should write to depth buffer but render early
            mat.depthWrite = true;
            mat.depthTest = true;
          }
        }
      });
    }
  }, []);

  return (
    <Grid
      ref={gridRef as any}
      name="ReferenceGrid"
      infiniteGrid
      fadeDistance={100}
      sectionSize={1}
      cellSize={0.1}
      sectionThickness={1.5}
      cellThickness={0.5}
      cellColor={theme === 'light' ? '#e2e8f0' : '#444444'}
      sectionColor={theme === 'light' ? '#cbd5e1' : '#555555'}
      rotation={[Math.PI / 2, 0, 0]}
      position={[0, 0, -0.001]}
      receiveShadow={false}
    />
  );
}
