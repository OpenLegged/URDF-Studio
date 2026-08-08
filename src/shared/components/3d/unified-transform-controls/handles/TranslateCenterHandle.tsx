import React from 'react';
import { type ThreeEvent } from '@react-three/fiber';

import { GIZMO_ARC_RENDER_ORDER } from '../gizmoCore';
import {
  FUSION_TRANSLATE_CENTER_PICKER_RADIUS,
  FUSION_TRANSLATE_CENTER_RADIUS,
} from '../fusionTranslatePlane';
import { PlainGizmoMaterial } from '../FusionTransformMaterials';
import type { FusionHandleName, FusionOwner } from '../FusionTransformControls.types';
import {
  TRANSLATE_CENTER_COLOR,
  TRANSLATE_CENTER_OPACITY,
} from '../FusionTransformControls.constants';

export function TranslateCenterHandle({
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
    onPointerDown: (event: ThreeEvent<PointerEvent>) => onPointerDown(event, 'translate', 'XYZ'),
    onPointerOut: (event: ThreeEvent<PointerEvent>) => onPointerOut(event, 'translate', 'XYZ'),
    onPointerOver: (event: ThreeEvent<PointerEvent>) => onPointerOver(event, 'translate', 'XYZ'),
    renderOrder: GIZMO_ARC_RENDER_ORDER + 7,
    userData: {
      isGizmo: true,
      urdfAxis: 'XYZ',
      urdfOwner: 'translate',
      urdfVisibleHandleTarget: true,
    },
  };

  return (
    <group
      name="fusion-translate-center"
      userData={{ urdfAxis: 'XYZ', urdfHoverScaleTarget: true, urdfOwner: 'translate' }}
    >
      <mesh {...handleProps} frustumCulled={false} name="translate-center">
        <sphereGeometry args={[FUSION_TRANSLATE_CENTER_RADIUS, 28, 16]} />
        <PlainGizmoMaterial
          active={active}
          color={TRANSLATE_CENTER_COLOR}
          opacity={TRANSLATE_CENTER_OPACITY}
        />
      </mesh>
      <mesh
        {...handleProps}
        frustumCulled={false}
        name="translate-center-picker"
        renderOrder={GIZMO_ARC_RENDER_ORDER + 9}
      >
        <sphereGeometry args={[FUSION_TRANSLATE_CENTER_PICKER_RADIUS, 18, 12]} />
        <PlainGizmoMaterial color={TRANSLATE_CENTER_COLOR} opacity={0} />
      </mesh>
    </group>
  );
}
