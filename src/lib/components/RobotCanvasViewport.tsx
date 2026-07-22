import { memo, type ReactNode, type RefObject } from 'react';
import * as THREE from 'three';

import type { Language } from '../../shared/i18n';
import {
  STUDIO_ENVIRONMENT_INTENSITY,
  WorkspaceCanvas,
  type SnapshotCaptureAction,
} from '../../shared/components/3d';

interface RobotCanvasViewportProps {
  children: ReactNode;
  groundOffset?: number;
  lang: Language;
  onOrbitEnd?: () => void;
  onOrbitStart?: () => void;
  onPointerMissed?: () => void;
  orbitEnabled: boolean;
  resolvedTheme?: 'light' | 'dark';
  robotName?: string;
  showUsageGuide?: boolean;
  snapshotAction?: RefObject<SnapshotCaptureAction | null>;
}

/** Store-free viewport used by the public RobotCanvas package boundary. */
export const RobotCanvasViewport = memo(function RobotCanvasViewport({
  children,
  groundOffset = 0,
  lang,
  onOrbitEnd,
  onOrbitStart,
  onPointerMissed,
  orbitEnabled,
  resolvedTheme = 'light',
  robotName = 'robot',
  showUsageGuide = true,
  snapshotAction,
}: RobotCanvasViewportProps) {
  return (
    <WorkspaceCanvas
      theme={resolvedTheme}
      lang={lang}
      className="relative h-full w-full"
      snapshotAction={snapshotAction}
      robotName={robotName}
      onPointerMissed={onPointerMissed}
      environment="studio"
      environmentIntensityByTheme={STUDIO_ENVIRONMENT_INTENSITY.viewer}
      groundOffset={groundOffset}
      toneMapping={THREE.NeutralToneMapping}
      toneMappingExposure={1}
      cameraFollowPrimary
      orbitControlsProps={{
        enabled: orbitEnabled,
        onStart: onOrbitStart,
        onEnd: onOrbitEnd,
      }}
      showUsageGuide={showUsageGuide}
    >
      {children}
    </WorkspaceCanvas>
  );
});
