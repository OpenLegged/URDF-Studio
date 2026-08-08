import React, { useMemo } from 'react';

import { createRotateGuideRingGeometry } from '../FusionTransformControls.utils';
import type { AxisName } from '../FusionTransformControls.types';
import { ACTIVE_AXIS_COLOR } from '../FusionTransformControls.constants';

export function RotateGuideRing({ axis }: { axis: AxisName }) {
  const guideGeometry = useMemo(() => createRotateGuideRingGeometry(axis), [axis]);

  return (
    <group name={`fusion-rotate-guide-${axis.toLowerCase()}`}>
      <lineSegments
        frustumCulled={false}
        geometry={guideGeometry}
        name={`rotate-guide-ring-${axis.toLowerCase()}`}
        raycast={() => null}
        userData={{ isGizmo: true }}
      >
        <lineBasicMaterial
          color={ACTIVE_AXIS_COLOR}
          depthTest={false}
          depthWrite={false}
          opacity={0.56}
          toneMapped={false}
          transparent
        />
      </lineSegments>
    </group>
  );
}
