/**
 * Center of Mass Indicator Component
 * Displays a checkerboard sphere at the center of mass position
 */

import React from 'react';
import { Html } from '@react-three/drei';
import type { UrdfLink } from '@/types';

interface CenterOfMassProps {
  link: UrdfLink;
}

export const LinkCenterOfMass = React.memo(({ link }: CenterOfMassProps) => {
  const inertial = link.inertial;
  if (!inertial || inertial.mass <= 0) return null;

  const origin = inertial.origin || { xyz: { x: 0, y: 0, z: 0 } };
  const pos = origin.xyz || { x: 0, y: 0, z: 0 };
  const radius = 0.015;

  return (
    <group position={[pos.x, pos.y, pos.z]}>
      {/* 8 octants forming a sphere */}
      <mesh rotation={[0, 0, 0]}>
        <sphereGeometry args={[radius, 16, 16, 0, Math.PI / 2, 0, Math.PI / 2]} />
        <meshBasicMaterial color="#000000" />
      </mesh>
      <mesh rotation={[0, Math.PI / 2, 0]}>
        <sphereGeometry args={[radius, 16, 16, 0, Math.PI / 2, 0, Math.PI / 2]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <mesh rotation={[0, Math.PI, 0]}>
        <sphereGeometry args={[radius, 16, 16, 0, Math.PI / 2, 0, Math.PI / 2]} />
        <meshBasicMaterial color="#000000" />
      </mesh>
      <mesh rotation={[0, -Math.PI / 2, 0]}>
        <sphereGeometry args={[radius, 16, 16, 0, Math.PI / 2, 0, Math.PI / 2]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>

      <mesh rotation={[Math.PI, 0, 0]}>
        <sphereGeometry args={[radius, 16, 16, 0, Math.PI / 2, 0, Math.PI / 2]} />
        <meshBasicMaterial color="#000000" />
      </mesh>
      <mesh rotation={[Math.PI, Math.PI / 2, 0]}>
        <sphereGeometry args={[radius, 16, 16, 0, Math.PI / 2, 0, Math.PI / 2]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <mesh rotation={[Math.PI, Math.PI, 0]}>
        <sphereGeometry args={[radius, 16, 16, 0, Math.PI / 2, 0, Math.PI / 2]} />
        <meshBasicMaterial color="#000000" />
      </mesh>
      <mesh rotation={[Math.PI, -Math.PI / 2, 0]}>
        <sphereGeometry args={[radius, 16, 16, 0, Math.PI / 2, 0, Math.PI / 2]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>

      <Html position={[0.03, 0.03, 0]} style={{ pointerEvents: 'none' }}>
        <div className="text-[8px] text-red-400 bg-black/60 px-1 rounded whitespace-nowrap">
          CoM
        </div>
      </Html>
    </group>
  );
});

// Alias for backwards compatibility
export const CenterOfMass = LinkCenterOfMass;
