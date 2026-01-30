/**
 * Inertia Box Visualization Component
 * Displays a semi-transparent box representing the inertia of a link
 */

import React from 'react';
import * as THREE from 'three';
import type { UrdfLink } from '@/types';
import { MathUtils as DataUtils } from '@/shared/utils/math';

interface InertiaBoxProps {
  link: UrdfLink;
}

export const InertiaBox = React.memo(({ link }: InertiaBoxProps) => {
  const inertial = link.inertial;
  if (!inertial) return null;

  const boxData = DataUtils.computeInertiaBox(inertial);
  if (!boxData) return null;

  const { width, height, depth, rotation } = boxData;

  const origin = inertial.origin || { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } };
  const pos = origin.xyz || { x: 0, y: 0, z: 0 };

  const originRot = new THREE.Euler(
    origin.rpy?.r || 0,
    origin.rpy?.p || 0,
    origin.rpy?.y || 0,
    'XYZ'
  );
  const originQuat = new THREE.Quaternion().setFromEuler(originRot);
  const finalQuat = originQuat.multiply(rotation);
  const finalEuler = new THREE.Euler().setFromQuaternion(finalQuat);

  return (
    <group position={[pos.x, pos.y, pos.z]} rotation={finalEuler}>
      <mesh renderOrder={9999}>
        <boxGeometry args={[width, height, depth]} />
        <meshPhongMaterial
          color={0x4a9eff}
          transparent
          opacity={0.35}
          depthWrite={false}
          depthTest={false}
          shininess={50}
        />
      </mesh>
    </group>
  );
});
