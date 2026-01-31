import React, { memo, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { Theme } from '@/types';
import { SceneLighting, SnapshotManager, ReferenceGrid } from '@/shared/components/3d';

interface VisualizerCanvasProps {
  theme: Theme;
  snapshotAction?: React.MutableRefObject<(() => void) | null>;
  robotName?: string;
  children: React.ReactNode;
}

/**
 * VisualizerCanvas - Wraps the Three.js Canvas with standard scene setup
 *
 * Features:
 * - Configures Canvas with shadows, tone mapping, and camera
 * - Sets up OrbitControls with Z-up orientation
 * - Provides scene lighting and environment
 * - Renders reference grid and gizmo
 * - Manages snapshot functionality
 */
export const VisualizerCanvas = memo(function VisualizerCanvas({
  theme,
  snapshotAction,
  robotName = 'robot',
  children,
}: VisualizerCanvasProps) {
  return (
    <Canvas
      shadows
      frameloop="demand"
      camera={{ position: [2, 2, 2], up: [0, 0, 1], fov: 60 }}
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.0,
        preserveDrawingBuffer: true,
      }}
    >
      <color attach="background" args={[theme === 'light' ? '#f8f9fa' : '#000000']} />
      <Suspense fallback={null}>
        <OrbitControls makeDefault enableDamping={false} />
        <SceneLighting theme={theme} />
        <Environment files="/potsdamer_platz_1k.hdr" environmentIntensity={1.2} />
        <SnapshotManager actionRef={snapshotAction} robotName={robotName} />

        {/* Render robot and controls passed as children */}
        {children}

        {/* Reference Grid */}
        <ReferenceGrid theme={theme} />

        {/* Axis Gizmo */}
        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <GizmoViewport
            axisColors={['#ef4444', '#22c55e', '#3b82f6']}
            labelColor={theme === 'light' ? '#0f172a' : 'white'}
          />
        </GizmoHelper>
      </Suspense>
    </Canvas>
  );
});
