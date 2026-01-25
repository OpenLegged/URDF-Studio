/**
 * Joint Axis Visualization Component
 * Displays joint axis arrows for revolute, continuous, and prismatic joints
 */

import React, { useMemo } from 'react';
import * as THREE from 'three';
import type { UrdfJoint } from '@/types';
import { JointType } from '@/types';

interface JointAxisProps {
  joint: UrdfJoint;
  scale?: number;
}

export const JointAxesVisual = React.memo(({
  joint,
  scale = 1.0
}: JointAxisProps) => {
  const { type, axis } = joint;

  const quaternion = useMemo(() => {
    const axisVec = new THREE.Vector3(axis.x, axis.y, axis.z).normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axisVec);
  }, [axis.x, axis.y, axis.z]);

  if (type === JointType.FIXED) return null;

  const color = "#d946ef";

  return (
    <group quaternion={quaternion} scale={[scale, scale, scale]}>
      <arrowHelper args={[new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), 0.35, color, 0.08, 0.05]} />
      {(type === JointType.REVOLUTE || type === JointType.CONTINUOUS) && (
        <group>
          <mesh>
            <torusGeometry args={[0.15, 0.005, 8, 32, type === JointType.REVOLUTE ? Math.PI * 1.5 : Math.PI * 2]} />
            <meshBasicMaterial color={color} />
          </mesh>
          <mesh position={[0.15, 0, 0]} rotation={[Math.PI / 2, 0, -Math.PI / 2]}>
            <coneGeometry args={[0.015, 0.04, 8]} />
            <meshBasicMaterial color={color} />
          </mesh>
        </group>
      )}
      {type === JointType.PRISMATIC && (
        <group>
          <arrowHelper args={[new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 0), 0.35, color, 0.08, 0.05]} />
        </group>
      )}
    </group>
  );
});

// Alias for backwards compatibility
export const JointAxis = JointAxesVisual;
