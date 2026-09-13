import type { ComponentProps } from 'react';
import { Html } from '@react-three/drei';
import type { Object3D } from 'three';
import { VIEWER_CORNER_OVERLAY_CLASS_NAME } from '@/shared/components/3d/scene/viewerOverlaySafeArea';
import { LoadingHud as ViewerLoadingHud } from '@/shared/components/3d/LoadingHud';

type ViewerLoadingHudOverlayProps = Pick<
  ComponentProps<typeof ViewerLoadingHud>,
  'title' | 'detail' | 'progress' | 'progressMode' | 'statusLabel' | 'stageLabel' | 'delayMs'
>;

const calculateFullscreenHtmlPosition = (
  _object: Object3D,
  _camera: unknown,
  size: { width: number; height: number },
): number[] => [size.width / 2, size.height / 2];

export function ViewerLoadingHudOverlay(props: ViewerLoadingHudOverlayProps) {
  return (
    <Html
      fullscreen
      calculatePosition={calculateFullscreenHtmlPosition}
      className={VIEWER_CORNER_OVERLAY_CLASS_NAME}
    >
      <ViewerLoadingHud {...props} />
    </Html>
  );
}
