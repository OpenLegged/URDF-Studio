import React from 'react';
import { type ThreeEvent } from '@react-three/fiber';

import { GIZMO_ARC_RENDER_ORDER } from '../gizmoCore';
import type { FusionTranslatePlaneName } from '../fusionTranslatePlane';
import {
  FUSION_TRANSLATE_PLANE_PICKER_SCALE,
  createFusionTranslatePlaneGeometry,
  createFusionTranslatePlaneOutlineGeometry,
  getFusionTranslatePlaneNormalAxis,
} from '../fusionTranslatePlane';
import { useDisposableGeometry } from '../hooks/useDisposableGeometry';
import { PlainGizmoMaterial } from '../FusionTransformMaterials';
import type { FusionHandleName, FusionOwner } from '../FusionTransformControls.types';
import {
  ACTIVE_AXIS_COLOR,
  AXIS_COLORS,
  TRANSLATE_PLANE_ACTIVE_OPACITY,
  TRANSLATE_PLANE_OPACITY,
} from '../FusionTransformControls.constants';

export function TranslatePlaneHandle({
  active,
  onPointerDown,
  onPointerOut,
  onPointerOver,
  plane,
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
  plane: FusionTranslatePlaneName;
}) {
  const fillGeometry = useDisposableGeometry(
    () => createFusionTranslatePlaneGeometry({ plane }),
    [plane],
  );
  const outlineGeometry = useDisposableGeometry(
    () => createFusionTranslatePlaneOutlineGeometry({ plane }),
    [plane],
  );
  const pickerGeometry = useDisposableGeometry(
    () =>
      createFusionTranslatePlaneGeometry({
        plane,
        scale: FUSION_TRANSLATE_PLANE_PICKER_SCALE,
      }),
    [plane],
  );
  const color = AXIS_COLORS[getFusionTranslatePlaneNormalAxis(plane)];
  const planeName = plane.toLowerCase();
  const handleProps = {
    onPointerDown: (event: ThreeEvent<PointerEvent>) => onPointerDown(event, 'translate', plane),
    onPointerOut: (event: ThreeEvent<PointerEvent>) => onPointerOut(event, 'translate', plane),
    onPointerOver: (event: ThreeEvent<PointerEvent>) => onPointerOver(event, 'translate', plane),
    renderOrder: GIZMO_ARC_RENDER_ORDER + 4,
    userData: {
      isGizmo: true,
      urdfAxis: plane,
      urdfOwner: 'translate',
      urdfVisibleHandleTarget: true,
    },
  };

  return (
    <group
      name={`fusion-translate-plane-${planeName}`}
      userData={{ urdfAxis: plane, urdfHoverScaleTarget: true, urdfOwner: 'translate' }}
    >
      <mesh
        {...handleProps}
        frustumCulled={false}
        geometry={fillGeometry}
        name={`translate-plane-${planeName}`}
      >
        <PlainGizmoMaterial
          active={active}
          color={color}
          opacity={active ? TRANSLATE_PLANE_ACTIVE_OPACITY : TRANSLATE_PLANE_OPACITY}
        />
      </mesh>
      <lineSegments
        frustumCulled={false}
        geometry={outlineGeometry}
        name={`translate-plane-outline-${planeName}`}
        raycast={() => null}
        renderOrder={GIZMO_ARC_RENDER_ORDER + 5}
      >
        <lineBasicMaterial
          color={active ? ACTIVE_AXIS_COLOR : color}
          depthTest={false}
          depthWrite={false}
          opacity={active ? 0.96 : 0.72}
          toneMapped={false}
          transparent
        />
      </lineSegments>
      <mesh
        {...handleProps}
        frustumCulled={false}
        geometry={pickerGeometry}
        name={`translate-plane-picker-${planeName}`}
        renderOrder={GIZMO_ARC_RENDER_ORDER + 9}
      >
        <PlainGizmoMaterial color={color} opacity={0} />
      </mesh>
    </group>
  );
}
