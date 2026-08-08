import React from 'react';
import { type ThreeEvent } from '@react-three/fiber';

import { GIZMO_ARC_RENDER_ORDER } from '../gizmoCore';
import { FUSION_ROTATE_TRACKBALL_RADIUS } from '../fusionRotateGeometry';
import { PlainGizmoMaterial } from '../FusionTransformMaterials';
import type { FusionHandleName, FusionOwner } from '../FusionTransformControls.types';
import {
  ROTATE_TRACKBALL_COLOR,
  ROTATE_TRACKBALL_OPACITY,
} from '../FusionTransformControls.constants';

export function RotateTrackballHandle({
  active,
  onPointerDown,
  onPointerOut,
  onPointerOver,
}: {
  active: boolean;
  onPointerDown: (
    event: ThreeEvent<PointerEvent>,
    owner: FusionOwner,
    axis: FusionHandleName,
  ) => void;
  onPointerOut: (
    event: ThreeEvent<PointerEvent>,
    owner: FusionOwner,
    axis: FusionHandleName,
  ) => void;
  onPointerOver: (
    event: ThreeEvent<PointerEvent>,
    owner: FusionOwner,
    axis: FusionHandleName,
  ) => void;
}) {
  const handleProps = {
    onPointerDown: (event: ThreeEvent<PointerEvent>) => onPointerDown(event, 'rotate', 'XYZE'),
    onPointerOut: (event: ThreeEvent<PointerEvent>) => onPointerOut(event, 'rotate', 'XYZE'),
    onPointerOver: (event: ThreeEvent<PointerEvent>) => onPointerOver(event, 'rotate', 'XYZE'),
    renderOrder: GIZMO_ARC_RENDER_ORDER + 7,
    userData: {
      isGizmo: true,
      urdfAxis: 'XYZE',
      urdfOwner: 'rotate',
      urdfVisibleHandleTarget: true,
    },
  };

  return (
    <group
      name="fusion-rotate-trackball"
      userData={{ urdfAxis: 'XYZE', urdfHoverScaleTarget: true, urdfOwner: 'rotate' }}
    >
      <mesh {...handleProps} frustumCulled={false} name="rotate-trackball">
        <sphereGeometry args={[FUSION_ROTATE_TRACKBALL_RADIUS, 32, 18]} />
        <PlainGizmoMaterial
          active={active}
          color={ROTATE_TRACKBALL_COLOR}
          opacity={ROTATE_TRACKBALL_OPACITY}
        />
      </mesh>
    </group>
  );
}
