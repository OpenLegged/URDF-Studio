/**
 * Joint Axis Visualization Component
 * Displays joint axis arrows for revolute, continuous, and prismatic joints
 */

import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { UrdfJoint } from '@/types';
import { JointType } from '@/types';
import { ignoreRaycast } from '@/shared/utils/three/ignoreRaycast';
import {
  jointRotationArrowHeadPosition,
  jointRotationArrowHeadQuaternion,
} from '@/shared/utils/three/jointRotationIndicator';

const RING_RADIUS = 0.15;

interface JointAxisProps {
  joint: UrdfJoint;
  scale?: number;
  hovered?: boolean;
  selected?: boolean;
}

export const JointAxesVisual = React.memo(
  ({ joint, scale = 1.0, hovered = false, selected = false }: JointAxisProps) => {
    const { type } = joint;
    const axis = joint.axis ?? { x: 0, y: 0, z: 1 };
    const groupRef = useRef<THREE.Group | null>(null);
    const isActive = hovered || selected;

    const quaternion = useMemo(() => {
      const axisVec = new THREE.Vector3(axis.x, axis.y, axis.z).normalize();
      return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axisVec);
    }, [axis.x, axis.y, axis.z]);

    const rotationArc = type === JointType.REVOLUTE ? Math.PI * 1.5 : Math.PI * 2;
    const rotationArrowHead = useMemo(
      () => ({
        position: jointRotationArrowHeadPosition(rotationArc, RING_RADIUS),
        quaternion: jointRotationArrowHeadQuaternion(rotationArc),
      }),
      [rotationArc],
    );

    useEffect(() => {
      const group = groupRef.current;
      if (!group) {
        return;
      }

      group.traverse((object) => {
        object.renderOrder = 10020;

        const material = (
          object as THREE.Object3D & {
            material?: THREE.Material | THREE.Material[];
          }
        ).material;
        const materials = Array.isArray(material) ? material : material ? [material] : [];

        for (const entry of materials) {
          entry.depthTest = false;
          entry.depthWrite = false;
          entry.transparent = true;
          entry.opacity = isActive ? 1 : 0.92;
          entry.needsUpdate = true;
        }
      });
    }, [isActive]);

    if (type === JointType.FIXED || type === JointType.BALL) return null;

    const axisColor = selected ? '#fca5a5' : hovered ? '#f87171' : '#ef4444';
    const ringColor = selected ? '#86efac' : hovered ? '#4ade80' : '#22c55e';
    const centerGlowColor = selected ? '#fde047' : hovered ? '#facc15' : '#eab308';

    const shaftGlowOpacity = selected ? 0.42 : hovered ? 0.34 : 0;
    const centerGlowOpacity = selected ? 0.55 : hovered ? 0.42 : 0;
    const torusOpacity = selected ? 1 : hovered ? 0.98 : 0.82;
    const torusThickness = selected ? 0.01 : hovered ? 0.009 : 0.0055;
    const pickCylinderRadius = 0.045;
    const pickSphereRadius = 0.032;
    const pickTorusThickness = 0.016;

    return (
      <group ref={groupRef} quaternion={quaternion} scale={[scale, scale, scale]}>
        {/* Invisible pick volumes widen the hit window so thin helper lines do not lose hover to nearby geometry. */}
        <mesh position={[0, 0, 0.175]} rotation={[Math.PI / 2, 0, 0]} renderOrder={10020}>
          <cylinderGeometry args={[pickCylinderRadius, pickCylinderRadius, 0.35, 8]} />
          <meshBasicMaterial colorWrite={false} depthWrite={false} depthTest={false} />
        </mesh>
        <mesh renderOrder={10020}>
          <sphereGeometry args={[pickSphereRadius, 12, 12]} />
          <meshBasicMaterial colorWrite={false} depthWrite={false} depthTest={false} />
        </mesh>
        {isActive && (
          <>
            <mesh
              position={[0, 0, 0.175]}
              rotation={[Math.PI / 2, 0, 0]}
              renderOrder={10021}
              raycast={ignoreRaycast}
            >
              <cylinderGeometry args={[torusThickness * 0.85, torusThickness * 0.85, 0.35, 10]} />
              <meshBasicMaterial
                color={axisColor}
                transparent
                opacity={shaftGlowOpacity}
                depthWrite={false}
                depthTest={false}
              />
            </mesh>
            <mesh renderOrder={10021} raycast={ignoreRaycast}>
              <sphereGeometry args={[torusThickness * 1.8, 12, 12]} />
              <meshBasicMaterial
                color={centerGlowColor}
                transparent
                opacity={centerGlowOpacity}
                depthWrite={false}
                depthTest={false}
              />
            </mesh>
          </>
        )}
        <arrowHelper
          key={`joint-axis-forward-${joint.id}-${axisColor}`}
          args={[
            new THREE.Vector3(0, 0, 1),
            new THREE.Vector3(0, 0, 0),
            0.35,
            axisColor,
            0.08,
            0.05,
          ]}
        />
        {(type === JointType.REVOLUTE || type === JointType.CONTINUOUS) && (
          <group>
            <mesh renderOrder={10020}>
              <torusGeometry args={[RING_RADIUS, pickTorusThickness, 8, 32, rotationArc]} />
              <meshBasicMaterial colorWrite={false} depthWrite={false} depthTest={false} />
            </mesh>
            <mesh renderOrder={10020}>
              <torusGeometry args={[RING_RADIUS, torusThickness, 8, 32, rotationArc]} />
              <meshBasicMaterial
                color={ringColor}
                transparent
                opacity={torusOpacity}
                depthWrite={false}
                depthTest={false}
              />
            </mesh>
            <mesh
              position={rotationArrowHead.position}
              quaternion={rotationArrowHead.quaternion}
              renderOrder={10020}
            >
              <coneGeometry args={[0.015, 0.04, 8]} />
              <meshBasicMaterial
                color={ringColor}
                transparent
                opacity={torusOpacity}
                depthWrite={false}
                depthTest={false}
              />
            </mesh>
          </group>
        )}
        {type === JointType.PRISMATIC && (
          <group>
            <arrowHelper
              key={`joint-axis-reverse-${joint.id}-${axisColor}`}
              args={[
                new THREE.Vector3(0, 0, -1),
                new THREE.Vector3(0, 0, 0),
                0.35,
                axisColor,
                0.08,
                0.05,
              ]}
            />
          </group>
        )}
      </group>
    );
  },
);

// Alias for backwards compatibility
export const JointAxis = JointAxesVisual;
