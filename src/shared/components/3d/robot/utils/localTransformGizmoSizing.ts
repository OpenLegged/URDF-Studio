import { VISUALIZER_UNIFIED_GIZMO_SIZE } from '@/shared/components/3d/unified-transform-controls/gizmoCore';

export type LocalTransformGizmoKind = 'collision' | 'joint' | 'origin';

export interface LocalTransformGizmoSizing {
  translateSize: number;
  rotateSize: number;
  thicknessScale: number;
  showRotateFreeHandles: boolean;
}

const LOCAL_TRANSFORM_GIZMO_SCALE = {
  collision: {
    rotate: 0.46,
    showRotateFreeHandles: true,
    thickness: 1.05,
    translate: 0.56,
  },
  joint: {
    rotate: 0.57,
    showRotateFreeHandles: false,
    thickness: 1.15,
    translate: 0.68,
  },
  origin: {
    rotate: 0.46,
    showRotateFreeHandles: true,
    thickness: 1.2,
    translate: 0.56,
  },
} as const satisfies Record<
  LocalTransformGizmoKind,
  {
    rotate: number;
    showRotateFreeHandles: boolean;
    thickness: number;
    translate: number;
  }
>;

export function resolveLocalTransformGizmoSizing(
  kind: LocalTransformGizmoKind,
): LocalTransformGizmoSizing {
  const scale = LOCAL_TRANSFORM_GIZMO_SCALE[kind];
  return {
    rotateSize: VISUALIZER_UNIFIED_GIZMO_SIZE * scale.rotate,
    showRotateFreeHandles: scale.showRotateFreeHandles,
    thicknessScale: scale.thickness,
    translateSize: VISUALIZER_UNIFIED_GIZMO_SIZE * scale.translate,
  };
}
