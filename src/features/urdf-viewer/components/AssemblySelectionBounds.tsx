import { memo, useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react';
import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Line2, LineSegments2 } from 'three-stdlib';
import { HELPER_RENDER_ORDER } from '@/shared/components/3d/unified-transform-controls/gizmoCore';
import { computeVisibleMeshBounds } from '@/shared/utils/threeBounds';

const DEFAULT_SELECTION_BOUNDS_COLOR = '#fbbf24';
const DEFAULT_SELECTION_BOUNDS_LINE_WIDTH = 2;
const INITIAL_SELECTION_BOUNDS_POINTS: ReadonlyArray<[number, number, number]> = Array.from(
  { length: 24 },
  (): [number, number, number] => [0, 0, 0],
);

interface AssemblySelectionBoundsProps {
  boundsInvalidatedRef?: MutableRefObject<boolean>;
  object: THREE.Object3D | null;
  color?: string;
  onBoundsChange?: (bounds: THREE.Box3) => void;
}

function getBoxLinePositions(bounds: THREE.Box3): number[] {
  const { min, max } = bounds;
  return [
    min.x,
    min.y,
    min.z,
    max.x,
    min.y,
    min.z,
    max.x,
    min.y,
    min.z,
    max.x,
    max.y,
    min.z,
    max.x,
    max.y,
    min.z,
    min.x,
    max.y,
    min.z,
    min.x,
    max.y,
    min.z,
    min.x,
    min.y,
    min.z,
    min.x,
    min.y,
    max.z,
    max.x,
    min.y,
    max.z,
    max.x,
    min.y,
    max.z,
    max.x,
    max.y,
    max.z,
    max.x,
    max.y,
    max.z,
    min.x,
    max.y,
    max.z,
    min.x,
    max.y,
    max.z,
    min.x,
    min.y,
    max.z,
    min.x,
    min.y,
    min.z,
    min.x,
    min.y,
    max.z,
    max.x,
    min.y,
    min.z,
    max.x,
    min.y,
    max.z,
    max.x,
    max.y,
    min.z,
    max.x,
    max.y,
    max.z,
    min.x,
    max.y,
    min.z,
    min.x,
    max.y,
    max.z,
  ];
}

export const AssemblySelectionBounds = memo(function AssemblySelectionBounds({
  boundsInvalidatedRef,
  object,
  color = DEFAULT_SELECTION_BOUNDS_COLOR,
  onBoundsChange,
}: AssemblySelectionBoundsProps) {
  const lineRef = useRef<Line2 | LineSegments2>(null);
  const needsRefreshRef = useRef(true);

  useEffect(() => {
    needsRefreshRef.current = true;
  }, [object]);

  useLayoutEffect(() => {
    if (lineRef.current) {
      lineRef.current.visible = false;
    }
  }, [object]);

  useFrame(() => {
    const line = lineRef.current;
    if (!line) {
      return;
    }
    line.material.visible = true;

    if (!object) {
      line.visible = false;
      return;
    }

    if (!needsRefreshRef.current && !boundsInvalidatedRef?.current) {
      return;
    }

    needsRefreshRef.current = false;
    if (boundsInvalidatedRef) {
      boundsInvalidatedRef.current = false;
    }

    // Computing visible bounds walks the selected hierarchy. Camera orbiting
    // does not alter that hierarchy, so only refresh after the selected object
    // changes instead of paying an O(scene) traversal on every render frame.
    const visibleBounds = computeVisibleMeshBounds(object, {
      includeInvisible: false,
    });

    if (!visibleBounds || visibleBounds.isEmpty()) {
      line.visible = false;
      // A streamed model can expose its root before the first mesh is attached.
      // Keep retrying only until the first valid bounds are available.
      needsRefreshRef.current = true;
      return;
    }

    line.geometry.setPositions(getBoxLinePositions(visibleBounds));
    line.computeLineDistances();
    line.visible = true;
    line.updateMatrixWorld(true);
    onBoundsChange?.(visibleBounds);
  }, 1100);

  return (
    <Line
      ref={lineRef}
      name="AssemblySelectionBounds"
      points={INITIAL_SELECTION_BOUNDS_POINTS}
      segments
      color={color}
      lineWidth={DEFAULT_SELECTION_BOUNDS_LINE_WIDTH}
      depthTest
      depthWrite={false}
      transparent
      opacity={0.95}
      toneMapped={false}
      frustumCulled={false}
      renderOrder={HELPER_RENDER_ORDER}
      userData={{
        isHelper: true,
        excludeFromSceneBounds: true,
      }}
    />
  );
});
