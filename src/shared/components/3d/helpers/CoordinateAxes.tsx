import { ignoreRaycast } from '@/shared/utils/three/ignoreRaycast';

/**
 * Coordinate Axes Component
 * Displays XYZ coordinate axes with adjustable thickness and size
 */

interface CoordinateAxesProps {
  size?: number;
  profile?: CoordinateAxesProfile;
  position?: [number, number, number];
  depthTest?: boolean;
  depthWrite?: boolean;
  renderOrder?: number;
  opacity?: number;
  interactive?: boolean;
  hovered?: boolean;
  selected?: boolean;
  onClick?: (e: any) => void;
}

export type CoordinateAxesProfile = 'standard' | 'slim';

export interface CoordinateAxesDimensions {
  axisLength: number;
  headLength: number;
  headRadius: number;
  shaftRadius: number;
}

/**
 * Resolves the visible dimensions for a coordinate-axes profile.
 * `standard` intentionally preserves the legacy sizing exactly.
 */
export function resolveCoordinateAxesDimensions(
  size: number,
  profile: CoordinateAxesProfile = 'standard',
  isActive = false,
): CoordinateAxesDimensions {
  const axisLength = size * (isActive ? 1.04 : 1);
  if (profile === 'slim') {
    const shaftRadius = Math.max(size * 0.03, 0.0012) * (isActive ? 1.35 : 1);
    return {
      axisLength,
      headLength: Math.max(size * 0.14, shaftRadius * 3) * (isActive ? 1.08 : 1),
      headRadius: Math.max(size * 0.065, 0.0026) * (isActive ? 1.06 : 1),
      shaftRadius,
    };
  }

  const shaftRadius = Math.max(size * 0.05, 0.0055) * (isActive ? 1.35 : 1);
  return {
    axisLength,
    headLength: Math.max(size * 0.22, shaftRadius * 4.5) * (isActive ? 1.08 : 1),
    headRadius: Math.max(shaftRadius * 2.6, 0.012) * (isActive ? 1.06 : 1),
    shaftRadius,
  };
}

export const ThickerAxes = ({
  size = 0.1,
  profile = 'standard',
  position = [0, 0, 0],
  depthTest = true,
  depthWrite,
  renderOrder = 0,
  opacity = 1,
  interactive,
  hovered = false,
  selected = false,
  onClick,
}: CoordinateAxesProps) => {
  const isActive = hovered || selected;
  const isInteractive = interactive ?? Boolean(onClick);
  const effectiveOpacity = isActive ? Math.max(opacity, selected ? 1 : 0.96) : opacity;
  const effectiveDepthTest = isActive ? false : depthTest;
  const resolvedDepthWrite = depthWrite ?? (depthTest && effectiveOpacity >= 1);
  const effectiveDepthWrite = isActive ? false : resolvedDepthWrite;
  const effectiveRenderOrder = isActive ? Math.max(renderOrder, 10020) : renderOrder;
  const {
    axisLength,
    headLength: headSize,
    headRadius,
    shaftRadius: thickness,
  } = resolveCoordinateAxesDimensions(size, profile, isActive);
  const pickRadius = Math.max(headRadius * 1.08, thickness * 2.2);
  const pickCenterRadius = Math.max(thickness * 1.8, 0.01);
  const pickLength = axisLength + headSize * 0.3;
  const transparent = effectiveOpacity < 1;

  const xColor = isActive ? '#f87171' : '#ef4444';
  const yColor = isActive ? '#4ade80' : '#22c55e';
  const zColor = isActive ? '#60a5fa' : '#3b82f6';
  const centerColor = selected ? '#f59e0b' : '#fb923c';

  return (
    <group position={position} onClick={onClick}>
      {isInteractive && (
        <>
          <mesh renderOrder={10020}>
            <sphereGeometry args={[pickCenterRadius, 12, 12]} />
            <meshBasicMaterial colorWrite={false} depthWrite={false} depthTest={false} />
          </mesh>
          <mesh
            rotation={[0, 0, -Math.PI / 2]}
            position={[axisLength / 2, 0, 0]}
            renderOrder={10020}
          >
            <cylinderGeometry args={[pickRadius, pickRadius, pickLength, 10]} />
            <meshBasicMaterial colorWrite={false} depthWrite={false} depthTest={false} />
          </mesh>
          <mesh position={[0, axisLength / 2, 0]} renderOrder={10020}>
            <cylinderGeometry args={[pickRadius, pickRadius, pickLength, 10]} />
            <meshBasicMaterial colorWrite={false} depthWrite={false} depthTest={false} />
          </mesh>
          <mesh
            rotation={[Math.PI / 2, 0, 0]}
            position={[0, 0, axisLength / 2]}
            renderOrder={10020}
          >
            <cylinderGeometry args={[pickRadius, pickRadius, pickLength, 10]} />
            <meshBasicMaterial colorWrite={false} depthWrite={false} depthTest={false} />
          </mesh>
        </>
      )}

      {isActive && (
        <mesh renderOrder={effectiveRenderOrder} raycast={ignoreRaycast}>
          <sphereGeometry
            args={[
              Math.max(thickness * 1.6, profile === 'slim' ? 0.003 : 0.014),
              12,
              12,
            ]}
          />
          <meshBasicMaterial
            color={centerColor}
            depthTest={effectiveDepthTest}
            depthWrite={effectiveDepthWrite}
            toneMapped={false}
            transparent
            opacity={selected ? 1 : 0.96}
          />
        </mesh>
      )}

      {/* X Axis - Red */}
      <mesh
        rotation={[0, 0, -Math.PI / 2]}
        position={[axisLength / 2, 0, 0]}
        renderOrder={effectiveRenderOrder}
        raycast={isInteractive ? undefined : ignoreRaycast}
      >
        <cylinderGeometry args={[thickness, thickness, axisLength, 12]} />
        <meshBasicMaterial
          color={xColor}
          depthTest={effectiveDepthTest}
          depthWrite={effectiveDepthWrite}
          toneMapped={false}
          transparent={transparent}
          opacity={effectiveOpacity}
        />
      </mesh>
      <mesh
        rotation={[0, 0, -Math.PI / 2]}
        position={[axisLength, 0, 0]}
        renderOrder={effectiveRenderOrder}
        raycast={isInteractive ? undefined : ignoreRaycast}
      >
        <coneGeometry args={[headRadius, headSize, 12]} />
        <meshBasicMaterial
          color={xColor}
          depthTest={effectiveDepthTest}
          depthWrite={effectiveDepthWrite}
          toneMapped={false}
          transparent={transparent}
          opacity={effectiveOpacity}
        />
      </mesh>

      {/* Y Axis - Green */}
      <mesh
        position={[0, axisLength / 2, 0]}
        renderOrder={effectiveRenderOrder}
        raycast={isInteractive ? undefined : ignoreRaycast}
      >
        <cylinderGeometry args={[thickness, thickness, axisLength, 12]} />
        <meshBasicMaterial
          color={yColor}
          depthTest={effectiveDepthTest}
          depthWrite={effectiveDepthWrite}
          toneMapped={false}
          transparent={transparent}
          opacity={effectiveOpacity}
        />
      </mesh>
      <mesh
        position={[0, axisLength, 0]}
        renderOrder={effectiveRenderOrder}
        raycast={isInteractive ? undefined : ignoreRaycast}
      >
        <coneGeometry args={[headRadius, headSize, 12]} />
        <meshBasicMaterial
          color={yColor}
          depthTest={effectiveDepthTest}
          depthWrite={effectiveDepthWrite}
          toneMapped={false}
          transparent={transparent}
          opacity={effectiveOpacity}
        />
      </mesh>

      {/* Z Axis - Blue */}
      <mesh
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, axisLength / 2]}
        renderOrder={effectiveRenderOrder}
        raycast={isInteractive ? undefined : ignoreRaycast}
      >
        <cylinderGeometry args={[thickness, thickness, axisLength, 12]} />
        <meshBasicMaterial
          color={zColor}
          depthTest={effectiveDepthTest}
          depthWrite={effectiveDepthWrite}
          toneMapped={false}
          transparent={transparent}
          opacity={effectiveOpacity}
        />
      </mesh>
      <mesh
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, axisLength]}
        renderOrder={effectiveRenderOrder}
        raycast={isInteractive ? undefined : ignoreRaycast}
      >
        <coneGeometry args={[headRadius, headSize, 12]} />
        <meshBasicMaterial
          color={zColor}
          depthTest={effectiveDepthTest}
          depthWrite={effectiveDepthWrite}
          toneMapped={false}
          transparent={transparent}
          opacity={effectiveOpacity}
        />
      </mesh>
    </group>
  );
};

interface WorldOriginAxesProps {
  size?: number;
  lift?: number;
  opacity?: number;
  renderOrder?: number;
}

export const WorldOriginAxes = ({
  size = 0.1,
  lift = 0.002,
  opacity = 1,
  renderOrder = 10,
}: WorldOriginAxesProps) => (
  <group userData={{ isHelper: true, excludeFromSceneBounds: true }}>
    <ThickerAxes
      size={size}
      position={[0, 0, lift]}
      depthTest
      depthWrite={opacity >= 1}
      renderOrder={renderOrder}
      opacity={opacity}
    />
  </group>
);

// Alias for backwards compatibility
export const CoordinateAxes = ThickerAxes;
