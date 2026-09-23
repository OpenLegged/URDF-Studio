/**
 * MeshPreview - Inline 3D preview for mesh files in the property editor
 * Shows a small Canvas with the selected mesh, with centered orbit inspection.
 */
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { MeshAssetNode } from '@/shared/components/3d';
import { findAssetByPath } from '@/core/loaders/meshLoader';
import { computeVisibleMeshBounds } from '@/shared/utils/threeBounds';
import { DEFAULT_MESH_PREVIEW_COLOR } from '@/types/constants';
import { useMeshPreviewVisibility } from '../hooks/useMeshPreviewVisibility';

interface MeshPreviewProps {
  meshPath: string;
  assets: Record<string, string>;
  normalizeColladaRoot?: boolean;
  notFoundText?: string;
}

const PREVIEW_CAMERA_DIRECTION = new THREE.Vector3(0.3, 0.25, 0.92).normalize();
const PREVIEW_WORLD_UP = new THREE.Vector3(0, 1, 0);
const PREVIEW_FIT_PADDING = 1.12;
const PREVIEW_MIN_RADIUS = 0.05;

export interface MeshPreviewFrame {
  center: THREE.Vector3;
  contentOffset: THREE.Vector3;
  cameraPosition: THREE.Vector3;
  near: number;
  far: number;
  minDistance: number;
  maxDistance: number;
}

function resolvePreviewAspect(rawAspect: number): number {
  return Number.isFinite(rawAspect) && rawAspect > 0 ? rawAspect : 1;
}

function resolvePreviewAxes(direction: THREE.Vector3) {
  const right = new THREE.Vector3().crossVectors(direction, PREVIEW_WORLD_UP);
  if (right.lengthSq() < 1e-8) {
    right.set(1, 0, 0);
  } else {
    right.normalize();
  }

  const up = new THREE.Vector3().crossVectors(right, direction).normalize();
  return { right, up };
}

export function resolveMeshPreviewFrame(
  bounds: THREE.Box3,
  aspect: number,
  fovDegrees = 45,
): MeshPreviewFrame | null {
  if (bounds.isEmpty()) {
    return null;
  }

  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(bounds.getBoundingSphere(new THREE.Sphere()).radius, PREVIEW_MIN_RADIUS);
  const safeAspect = resolvePreviewAspect(aspect);
  const safeFov = THREE.MathUtils.clamp(fovDegrees, 1, 175);
  const verticalHalfFov = THREE.MathUtils.degToRad(safeFov) * 0.5;
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * safeAspect);
  const narrowHalfFov = Math.min(verticalHalfFov, horizontalHalfFov);
  const sphereDistance = radius / Math.sin(narrowHalfFov);
  const direction = PREVIEW_CAMERA_DIRECTION.clone();
  const { right, up } = resolvePreviewAxes(direction);
  const halfSize = size.multiplyScalar(0.5);
  const projectedUp =
    Math.abs(up.x) * halfSize.x + Math.abs(up.y) * halfSize.y + Math.abs(up.z) * halfSize.z;
  const projectedRight =
    Math.abs(right.x) * halfSize.x +
    Math.abs(right.y) * halfSize.y +
    Math.abs(right.z) * halfSize.z;
  const distance = Math.max(
    projectedUp / Math.tan(verticalHalfFov),
    projectedRight / Math.tan(horizontalHalfFov),
    sphereDistance,
    0.25,
  ) * PREVIEW_FIT_PADDING;

  return {
    center,
    contentOffset: center.clone().multiplyScalar(-1),
    cameraPosition: direction.multiplyScalar(distance),
    near: Math.max(radius * 0.01, 0.001),
    far: Math.max(distance + radius * 4, radius * 8, 10),
    minDistance: Math.max(radius * 0.05, 0.001),
    maxDistance: Math.max(distance * 4, radius * 12, 2),
  };
}

function MeshPreviewCameraFrame({
  contentRef,
  controlsRef,
  resetKey,
}: {
  contentRef: React.RefObject<THREE.Group | null>;
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
  resetKey: string;
}) {
  const { camera, gl, invalidate } = useThree();
  const fittedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    fittedKeyRef.current = null;
    const content = contentRef.current;
    if (content) {
      content.position.set(0, 0, 0);
      content.updateMatrixWorld(true);
    }
    invalidate();
  }, [contentRef, invalidate, resetKey]);

  useFrame((state) => {
    if (state.frameloop === 'never') {
      return;
    }
    if (fittedKeyRef.current === resetKey) {
      return;
    }

    const content = contentRef.current;
    if (!content || !(camera instanceof THREE.PerspectiveCamera)) {
      return;
    }

    const bounds = computeVisibleMeshBounds(content);
    if (!bounds || bounds.isEmpty()) {
      return;
    }

    const aspect = gl.domElement.clientWidth / gl.domElement.clientHeight;
    const frame = resolveMeshPreviewFrame(bounds, aspect, camera.fov);
    if (!frame) {
      return;
    }

    const localCenter = frame.center.clone();
    content.parent?.worldToLocal(localCenter);
    content.position.copy(localCenter.multiplyScalar(-1));
    content.updateMatrixWorld(true);

    camera.position.copy(frame.cameraPosition);
    camera.near = frame.near;
    camera.far = frame.far;
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();

    const controls = controlsRef.current;
    if (controls) {
      controls.target.set(0, 0, 0);
      controls.minDistance = frame.minDistance;
      controls.maxDistance = frame.maxDistance;
      controls.update();
    }

    fittedKeyRef.current = resetKey;
    invalidate();
  });

  return null;
}

/** Render the appropriate mesh based on file extension */
function MeshContent({
  meshPath,
  assets,
  normalizeColladaRoot = false,
  onResolved,
}: {
  meshPath: string;
  assets: Record<string, string>;
  normalizeColladaRoot?: boolean;
  onResolved?: () => void;
}) {
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: DEFAULT_MESH_PREVIEW_COLOR,
        metalness: 0.1,
        roughness: 0.6,
      }),
    [],
  );
  useEffect(
    () => () => {
      material.dispose();
    },
    [material],
  );

  return (
    <MeshAssetNode
      meshPath={meshPath}
      assets={assets}
      material={material}
      color={DEFAULT_MESH_PREVIEW_COLOR}
      normalizeRoot={normalizeColladaRoot}
      preserveOriginalMaterial
      onResolved={onResolved}
      unknownContent={
        <mesh>
          <boxGeometry args={[0.1, 0.1, 0.1]} />
          <meshStandardMaterial color="gray" wireframe />
        </mesh>
      }
    />
  );
}

function MeshPreviewScene({
  meshPath,
  assets,
  normalizeColladaRoot,
  autoRotate,
  onUserInteractionStart,
}: {
  meshPath: string;
  assets: Record<string, string>;
  normalizeColladaRoot: boolean;
  autoRotate: boolean;
  onUserInteractionStart: () => void;
}) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const rotatingGroupRef = useRef<THREE.Group | null>(null);
  const contentRef = useRef<THREE.Group | null>(null);
  const [resolvedEpoch, setResolvedEpoch] = useState(0);
  const resetKey = `${meshPath}:${normalizeColladaRoot ? 'normalized' : 'raw'}:${resolvedEpoch}`;
  const handleResolved = useCallback(() => {
    setResolvedEpoch((epoch) => epoch + 1);
  }, []);

  useEffect(() => {
    setResolvedEpoch(0);
    if (rotatingGroupRef.current) {
      rotatingGroupRef.current.rotation.set(0, 0, 0);
    }
  }, [meshPath, normalizeColladaRoot]);

  useFrame((state, delta) => {
    // R3F can flush an already queued frame after switching to "never";
    // its manual-clock delta must not advance the hidden preview.
    if (state.frameloop === 'never' || !autoRotate || !rotatingGroupRef.current) {
      return;
    }

    rotatingGroupRef.current.rotation.y += delta * 0.45;
  });

  return (
    <>
      <group ref={rotatingGroupRef}>
        <group ref={contentRef}>
          <MeshContent
            meshPath={meshPath}
            assets={assets}
            normalizeColladaRoot={normalizeColladaRoot}
            onResolved={handleResolved}
          />
        </group>
      </group>
      <MeshPreviewCameraFrame
        contentRef={contentRef}
        controlsRef={controlsRef}
        resetKey={resetKey}
      />
      <OrbitControls
        ref={controlsRef}
        enableDamping={false}
        enablePan={false}
        enableRotate
        enableZoom
        rotateSpeed={0.8}
        zoomSpeed={0.8}
        minDistance={0.001}
        maxDistance={100}
        onStart={onUserInteractionStart}
      />
    </>
  );
}

function LoadingFallback() {
  return (
    <mesh>
      <boxGeometry args={[0.05, 0.05, 0.05]} />
      <meshStandardMaterial color="#aaa" wireframe />
    </mesh>
  );
}

export const MeshPreview: React.FC<MeshPreviewProps> = React.memo(
  ({ meshPath, assets, normalizeColladaRoot = false, notFoundText = 'Mesh not found' }) => {
    const assetUrl = findAssetByPath(meshPath, assets);
    const previewKey = `${meshPath}:${assetUrl ?? 'missing'}:${
      normalizeColladaRoot ? 'normalized' : 'raw'
    }`;
    const [autoRotatePaused, setAutoRotatePaused] = useState(false);
    const { previewRef, isVisible } = useMeshPreviewVisibility();
    const visibleFrameloop = autoRotatePaused ? 'demand' : 'always';
    const handleUserInteractionStart = useCallback(() => {
      setAutoRotatePaused(true);
    }, []);

    useEffect(() => {
      setAutoRotatePaused(false);
    }, [previewKey]);

    if (!assetUrl) {
      return (
        <div className="flex h-[112px] items-center justify-center rounded border border-border-black bg-element-bg">
          <span className="text-[10px] text-text-tertiary">{notFoundText}</span>
        </div>
      );
    }

	    return (
	      <div
	        ref={previewRef}
	        data-testid="property-mesh-preview"
	        className="h-[112px] select-none overflow-hidden rounded border border-border-black bg-gradient-to-b from-element-bg to-panel-bg"
	      >
        <Canvas
          // R3F restarts its clock when leaving "never", so hidden time does
          // not become a large rotation delta when the preview reappears.
          frameloop={isVisible ? visibleFrameloop : 'never'}
          camera={{ fov: 45, near: 0.001, far: 100, position: [0.5, 0.3, 0.5] }}
          gl={{ antialias: true, alpha: true }}
	          style={{ touchAction: 'pan-y' }}
        >
          <ambientLight intensity={0.6} />
          <directionalLight position={[2, 3, 2]} intensity={0.8} />
          <directionalLight position={[-1, -1, -1]} intensity={0.3} />
          <Suspense fallback={<LoadingFallback />}>
            <MeshPreviewScene
              meshPath={meshPath}
              assets={assets}
              normalizeColladaRoot={normalizeColladaRoot}
              autoRotate={isVisible && !autoRotatePaused}
              onUserInteractionStart={handleUserInteractionStart}
            />
          </Suspense>
        </Canvas>
      </div>
    );
  },
);
