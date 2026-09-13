import { isLinearJointType, normalizeJointTypeValue } from '@/shared/utils/jointUnits';
import type { ToolMode } from '@/shared/components/3d/robot/types';

export type JointInteractionTransformMode = Extract<
  ToolMode,
  'select' | 'translate' | 'rotate' | 'universal'
>;

export type JointInteractionControlMode = 'translate' | 'rotate';

export function resolveJointInteractionControlMode(
  transformMode: JointInteractionTransformMode,
  jointType: string | null | undefined,
): JointInteractionControlMode | null {
  if (transformMode === 'select') {
    return null;
  }

  if (isLinearJointType(jointType)) {
    return 'translate';
  }

  const normalizedJointType = normalizeJointTypeValue(jointType);
  if (normalizedJointType === 'revolute' || normalizedJointType === 'continuous') {
    return 'rotate';
  }

  return null;
}
