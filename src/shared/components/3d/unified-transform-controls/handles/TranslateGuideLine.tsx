import React, { useMemo } from 'react';

import { createGuideLineGeometry } from '../FusionTransformControls.utils';
import type { AxisName } from '../FusionTransformControls.types';
import { ACTIVE_AXIS_COLOR } from '../FusionTransformControls.constants';

export function TranslateGuideLine({ axis }: { axis: AxisName }) {
  const geometry = useMemo(() => createGuideLineGeometry(axis), [axis]);

  return (
    <lineSegments frustumCulled={false} geometry={geometry} raycast={() => null}>
      <lineBasicMaterial
        color={ACTIVE_AXIS_COLOR}
        depthTest={false}
        depthWrite={false}
        opacity={0.75}
        toneMapped={false}
        transparent
      />
    </lineSegments>
  );
}
