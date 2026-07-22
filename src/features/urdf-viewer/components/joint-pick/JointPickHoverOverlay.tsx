import { memo, useEffect, useMemo, useRef } from 'react';
import { Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import type {
  ResolvedJointSnap,
  ResolvedJointSnapCandidate,
  ResolvedJointSnapRegion,
} from '../../utils/jointSnapResolver';
import { worldRadiusForPixels } from '../../utils/jointPickHoverProjection';

const REGION_RENDER_ORDER = 2500;
const MARKER_KINDS = new Set<ResolvedJointSnapCandidate['kind']>([
  'circleCenter',
  'cylinderAxis',
  'bboxCenter',
  'geometryCenter',
  'faceCenter',
  'vertex',
  'edgeMidpoint',
]);
const disableRaycast: THREE.Mesh['raycast'] = () => {};

interface ScreenSpaceSnapDotProps {
  name?: string;
  opacity?: number;
  point: THREE.Vector3;
  radiusPx?: number;
  tone: string;
  userData?: Record<string, unknown>;
}

export const ScreenSpaceSnapDot = memo(function ScreenSpaceSnapDot({
  name,
  opacity = 0.96,
  point,
  radiusPx = 5,
  tone,
  userData,
}: ScreenSpaceSnapDotProps) {
  const { camera, gl } = useThree();
  const meshRef = useRef<THREE.Mesh>(null);
  const scratchPointRef = useRef(new THREE.Vector3());

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }
    mesh.getWorldPosition(scratchPointRef.current);
    const radiusWorld = worldRadiusForPixels(
      scratchPointRef.current,
      camera,
      gl.domElement.clientHeight,
      radiusPx,
    );
    mesh.scale.setScalar(radiusWorld);
  });

  return (
    <mesh
      ref={meshRef}
      name={name}
      position={point}
      raycast={disableRaycast}
      renderOrder={REGION_RENDER_ORDER + 2}
      userData={{ excludeFromSceneBounds: true, isHelper: true, ...userData }}
    >
      <sphereGeometry args={[1, 14, 10]} />
      <meshBasicMaterial
        color={tone}
        depthTest={false}
        depthWrite={false}
        opacity={opacity}
        transparent
      />
    </mesh>
  );
});

interface JointPickHoverOverlayProps {
  chosenCandidateId: string;
  snap: ResolvedJointSnap;
  tone: string;
}

interface JointPickRegionSurfaceProps {
  region: ResolvedJointSnapRegion;
  tone: string;
}

const JointPickRegionSurface = memo(function JointPickRegionSurface({
  region,
  tone,
}: JointPickRegionSurfaceProps) {
  const geometry = useMemo(() => {
    const regionGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(region.trianglesWorld.length * 3);
    region.trianglesWorld.forEach((point, index) => {
      positions[index * 3] = point.x;
      positions[index * 3 + 1] = point.y;
      positions[index * 3 + 2] = point.z;
    });
    regionGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return regionGeometry;
  }, [region]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <group>
      {region.trianglesWorld.length >= 3 ? (
        <mesh
          name="__joint_pick_hover_region_fill__"
          geometry={geometry}
          raycast={disableRaycast}
          renderOrder={REGION_RENDER_ORDER}
          userData={{ excludeFromSceneBounds: true, isHelper: true }}
        >
          <meshBasicMaterial
            color={tone}
            depthTest
            depthWrite={false}
            opacity={0.16}
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
            side={THREE.DoubleSide}
            transparent
          />
        </mesh>
      ) : null}

      {region.boundaryLoops.map((loop) => (
        loop.pointsWorld.length >= 2 ? (
          <Line
            key={loop.id}
            name={`__joint_pick_hover_boundary__:${loop.id}`}
            points={[...loop.pointsWorld, loop.pointsWorld[0]]}
            color={tone}
            depthTest={false}
            depthWrite={false}
            lineWidth={loop.isHole ? 1.75 : 1.25}
            opacity={loop.isHole ? 0.95 : 0.78}
            renderOrder={REGION_RENDER_ORDER + 1}
            transparent
            userData={{
              excludeFromSceneBounds: true,
              isHelper: true,
              jointPickBoundaryIsHole: loop.isHole,
            }}
          />
        ) : null
      ))}
    </group>
  );
}, (previous, next) => previous.region.id === next.region.id && previous.tone === next.tone);

export const JointPickHoverOverlay = memo(function JointPickHoverOverlay({
  chosenCandidateId,
  snap,
  tone,
}: JointPickHoverOverlayProps) {

  const markerCandidates = useMemo(() => {
    const visible = snap.candidates.filter(
      (candidate) =>
        MARKER_KINDS.has(candidate.kind) || candidate.id === chosenCandidateId,
    );
    visible.sort((left, right) =>
      Number(right.id === chosenCandidateId) - Number(left.id === chosenCandidateId),
    );
    return visible.filter((candidate, index) =>
      visible.slice(0, index).every(
        (existing) => existing.pointWorld.distanceToSquared(candidate.pointWorld) > 1e-16,
      ),
    );
  }, [chosenCandidateId, snap.candidates]);

  return (
    <group
      name="__joint_pick_hover_region__"
      userData={{
        excludeFromSceneBounds: true,
        isHelper: true,
        jointPickCandidateCount: markerCandidates.length,
      }}
    >
      <JointPickRegionSurface region={snap.region} tone={tone} />

      {markerCandidates.map((candidate) => {
        const selected = candidate.id === chosenCandidateId;
        return (
          <ScreenSpaceSnapDot
            key={candidate.id}
            name={`__joint_pick_candidate__:${candidate.id}`}
            point={candidate.pointWorld}
            radiusPx={selected ? 7 : 4.25}
            tone={tone}
            opacity={selected ? 1 : 0.72}
            userData={{
              jointPickCandidateId: candidate.id,
              jointPickCandidateKind: candidate.kind,
              jointPickCandidateSelected: selected,
            }}
          />
        );
      })}
    </group>
  );
});
