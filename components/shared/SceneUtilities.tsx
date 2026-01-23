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
  ambientIntensity: 0.5,

  // Hemisphere: sky/ground color blend for natural ambient
  // Key for ensuring bottom surfaces are visible
  hemisphereIntensity: 0.6,
  hemisphereSky: '#ffffff',    // Pure white sky
  hemisphereGround: '#888888', // Light grey ground

  // Main front light: right-front at 45°, moderate intensity
  mainLightIntensity: 0.8,
  mainLightPosition: [5, 5, 5] as [number, number, number],

  // Left side fill light: eliminates left side shadows
  leftFillIntensity: 0.5,
  leftFillPosition: [-5, 5, 5] as [number, number, number],

  // Right side fill light: balance with left
  rightFillIntensity: 0.4,
  rightFillPosition: [5, 3, -3] as [number, number, number],

  // Back rim light: edge highlighting for separation from background
  rimLightIntensity: 0.5,
  rimLightPosition: [0, 5, -5] as [number, number, number],
} as const;

// Scene lighting setup for Z-up coordinate system
// 5-Point lighting for comprehensive robot illumination
export function SceneLighting() {
  const { scene, gl } = useThree();

  useEffect(() => {
    // Enable high-quality soft shadows
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
    scene.receiveShadow = true;

    // Configure tone mapping: ACESFilmicToneMapping for realistic color reproduction
    // Prevents overexposure on white parts while revealing detail in dark areas
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.1; // Slightly above 1.0 for good brightness

    // Ensure proper sRGB output color space
    gl.outputColorSpace = THREE.SRGBColorSpace;

    console.log('[SceneLighting] Configured: ACESFilmic tone mapping, exposure 1.1, sRGB output');
  }, [scene, gl]);

  return (
    <>
      {/* Ambient light - base global fill (prevents pure black shadows) */}
      <ambientLight intensity={LIGHTING_CONFIG.ambientIntensity} color="#ffffff" />

      {/* Hemisphere light - critical for 360° visibility
          White sky + grey ground ensures bottom surfaces are visible */}
      <hemisphereLight
        args={[
          LIGHTING_CONFIG.hemisphereSky,
          LIGHTING_CONFIG.hemisphereGround,
          LIGHTING_CONFIG.hemisphereIntensity
        ]}
        position={[0, 1, 0]}
      />

      {/* 1. Main front light - right-front 45° with shadows */}
      <directionalLight
        position={LIGHTING_CONFIG.mainLightPosition}
        intensity={LIGHTING_CONFIG.mainLightIntensity}
        color="#ffffff"
        castShadow
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

      {/* 2. Left side fill light - eliminates left side dark shadows */}
      <directionalLight
        position={LIGHTING_CONFIG.leftFillPosition}
        intensity={LIGHTING_CONFIG.leftFillIntensity}
        color="#ffffff"
        castShadow={false}
      />

      {/* 3. Right side fill light - balance with left for even coverage */}
      <directionalLight
        position={LIGHTING_CONFIG.rightFillPosition}
        intensity={LIGHTING_CONFIG.rightFillIntensity}
        color="#ffffff"
        castShadow={false}
      />

      {/* 4. Back rim light - edge highlighting for model separation */}
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
      cellColor={theme === 'light' ? '#cbd5e1' : '#444444'}
      sectionColor={theme === 'light' ? '#94a3b8' : '#555555'}
      rotation={[Math.PI / 2, 0, 0]}
      position={[0, 0, -0.001]}
    />
  );
}
