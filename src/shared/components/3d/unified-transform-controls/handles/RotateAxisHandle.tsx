import React from 'react';
import { type ThreeEvent } from '@react-three/fiber';

import { GIZMO_ARC_RENDER_ORDER, THICK_ROTATE_ARC_RADIUS } from '../gizmoCore';
import {
  createFusionRotateFullRingGeometry,
  createFusionRotateFrontArcGeometry,
} from '../fusionRotateGeometry';
import { useDisposableGeometry } from '../hooks/useDisposableGeometry';
import { GizmoMaterial, RotateRingMaterial, PlainGizmoMaterial } from '../FusionTransformMaterials';
import { getVisualThicknessScale, getPickerThicknessScale } from '../FusionTransformControls.utils';
import type { AxisName, FusionHandleName, FusionOwner } from '../FusionTransformControls.types';
import { AXIS_COLORS, ROTATE_FRONT_ARC_OPACITY } from '../FusionTransformControls.constants';

export function RotateAxisHandle({
  active,
  axis,
  onPointerDown,
  onPointerOut,
  onPointerOver,
  thicknessScale,
}: {
  active: boolean;
  axis: AxisName;
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
  const guideGeometry = useDisposableGeometry(
    () =>
      createFusionRotateFullRingGeometry(
        axis,
        THICK_ROTATE_ARC_RADIUS * visualThicknessScale * 0.32,
      ),
    [axis, visualThicknessScale],
  );
  const frontArcGeometry = useDisposableGeometry(
    () =>
      createFusionRotateFrontArcGeometry(
        axis,
        THICK_ROTATE_ARC_RADIUS * visualThicknessScale * 0.52,
      ),
    [axis, visualThicknessScale],
  );
  const fullRingPickerGeometry = useDisposableGeometry(
    () =>
      createFusionRotateFullRingGeometry(
        axis,
        THICK_ROTATE_ARC_RADIUS * Math.max(2.65, pickerThicknessScale * 2.1),
      ),
    [axis, pickerThicknessScale],
  );

  const frontArcHandleProps = {
    onPointerDown: (event: ThreeEvent<PointerEvent>) => onPointerDown(event, 'rotate', axis),
    onPointerOut: (event: ThreeEvent<PointerEvent>) => onPointerOut(event, 'rotate', axis),
    onPointerOver: (event: ThreeEvent<PointerEvent>) => onPointerOver(event, 'rotate', axis),
    renderOrder: GIZMO_ARC_RENDER_ORDER + 5,
    userData: {
      isGizmo: true,
      urdfAxis: axis,
      urdfOwner: 'rotate',
      urdfVisibleHandleTarget: true,
    },
  };

  return (
    <group
      name={`fusion-rotate-${axis.toLowerCase()}`}
      userData={{ urdfAxis: axis, urdfHoverScaleTarget: true, urdfOwner: 'rotate' }}
    >
      <mesh
        frustumCulled={false}
        geometry={guideGeometry}
        name={`rotate-guide-ring-${axis.toLowerCase()}`}
        raycast={() => null}
        renderOrder={GIZMO_ARC_RENDER_ORDER + 1}
        userData={{
          urdfAxis: axis,
          urdfOwner: 'rotate',
        }}
      >
        <RotateRingMaterial active={active} axis={axis} />
      </mesh>
      <group userData={{ urdfRotateFrontArcAxis: axis }}>
        <mesh
          {...frontArcHandleProps}
          frustumCulled={false}
          geometry={frontArcGeometry}
          name={`rotate-front-arc-${axis.toLowerCase()}`}
          renderOrder={GIZMO_ARC_RENDER_ORDER + 5}
        >
          <GizmoMaterial active={active} axis={axis} opacity={ROTATE_FRONT_ARC_OPACITY} />
        </mesh>
        <mesh
          {...frontArcHandleProps}
          frustumCulled={false}
          geometry={fullRingPickerGeometry}
          name={`rotate-full-ring-picker-${axis.toLowerCase()}`}
          renderOrder={GIZMO_ARC_RENDER_ORDER + 8}
        >
          <PlainGizmoMaterial color={AXIS_COLORS[axis]} opacity={0} />
        </mesh>
      </group>
    </group>
  );
}
