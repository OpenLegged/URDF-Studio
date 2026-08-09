import React from 'react';
import { type ThreeEvent } from '@react-three/fiber';

import { GIZMO_ARC_RENDER_ORDER, THICK_ROTATE_ARC_RADIUS } from '../gizmoCore';
import {
  createFusionRotateFullRingGeometry,
  FUSION_ROTATE_E_RING_RADIUS,
} from '../fusionRotateGeometry';
import { useDisposableGeometry } from '../hooks/useDisposableGeometry';
import { PlainGizmoMaterial } from '../FusionTransformMaterials';
import { getVisualThicknessScale, getPickerThicknessScale } from '../FusionTransformControls.utils';
import type { FusionHandleName, FusionOwner } from '../FusionTransformControls.types';
import { ROTATE_E_RING_COLOR, ROTATE_E_RING_OPACITY } from '../FusionTransformControls.constants';

export function RotateScreenRingHandle({
  active,
  onPointerDown,
  onPointerOut,
  onPointerOver,
  thicknessScale,
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
  thicknessScale: number;
}) {
  const visualThicknessScale = getVisualThicknessScale(thicknessScale);
  const pickerThicknessScale = getPickerThicknessScale(thicknessScale);
  const eRingGeometry = useDisposableGeometry(
    () =>
      createFusionRotateFullRingGeometry(
        'Z',
        THICK_ROTATE_ARC_RADIUS * visualThicknessScale * 0.82,
        FUSION_ROTATE_E_RING_RADIUS,
      ),
    [visualThicknessScale],
  );
  const eRingPickerGeometry = useDisposableGeometry(
    () =>
      createFusionRotateFullRingGeometry(
        'Z',
        THICK_ROTATE_ARC_RADIUS * Math.max(2.9, pickerThicknessScale * 2.2),
        FUSION_ROTATE_E_RING_RADIUS,
      ),
    [pickerThicknessScale],
  );
  const handleProps = {
    onPointerDown: (event: ThreeEvent<PointerEvent>) => onPointerDown(event, 'rotate', 'E'),
    onPointerOut: (event: ThreeEvent<PointerEvent>) => onPointerOut(event, 'rotate', 'E'),
    onPointerOver: (event: ThreeEvent<PointerEvent>) => onPointerOver(event, 'rotate', 'E'),
    renderOrder: GIZMO_ARC_RENDER_ORDER + 6,
    userData: {
      isGizmo: true,
      urdfAxis: 'E',
      urdfOwner: 'rotate',
      urdfVisibleHandleTarget: true,
    },
  };

  return (
    <group
      name="fusion-rotate-e"
      userData={{
        urdfAxis: 'E',
        urdfHoverScaleTarget: true,
        urdfOwner: 'rotate',
        urdfRotateScreenRing: true,
      }}
    >
      <mesh {...handleProps} frustumCulled={false} geometry={eRingGeometry} name="rotate-e-ring">
        <PlainGizmoMaterial
          active={active}
          color={ROTATE_E_RING_COLOR}
          opacity={ROTATE_E_RING_OPACITY}
        />
      </mesh>
      <mesh
        {...handleProps}
        frustumCulled={false}
        geometry={eRingPickerGeometry}
        name="rotate-e-ring-picker"
        renderOrder={GIZMO_ARC_RENDER_ORDER + 9}
      >
        <PlainGizmoMaterial color={ROTATE_E_RING_COLOR} opacity={0} />
      </mesh>
    </group>
  );
}
