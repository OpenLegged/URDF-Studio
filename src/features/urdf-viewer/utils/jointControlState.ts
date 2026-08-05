import { resolveViewerJointAngleValue } from '../../../shared/utils/jointPanelState.ts';

type JointControlStateJoint = {
  name?: string;
  angle?: number;
  jointValue?: number;
  setJointValue?: (angle: number) => void;
};

interface ResolveInitialJointControlStateOptions<TJoint extends JointControlStateJoint> {
  joints: Record<string, TJoint> | null | undefined;
  previousAngles: Record<string, number>;
  preservePreviousAngles: boolean;
  isControllableJoint: (joint: TJoint) => boolean;
}

export interface InitialJointControlState {
  currentAngles: Record<string, number>;
}

export function resolveInitialJointControlState<TJoint extends JointControlStateJoint>({
  joints,
  previousAngles,
  preservePreviousAngles,
  isControllableJoint,
}: ResolveInitialJointControlStateOptions<TJoint>): InitialJointControlState {
  const currentAngles: Record<string, number> = {};
  const retainedAngles = preservePreviousAngles ? previousAngles : {};

  if (!joints) {
    return { currentAngles };
  }

  Object.entries(joints).forEach(([jointKey, joint]) => {
    if (!isControllableJoint(joint)) {
      return;
    }

    const retainedAngle = resolveViewerJointAngleValue(retainedAngles, jointKey, joint, Number.NaN);
    if (Number.isFinite(retainedAngle)) {
      currentAngles[jointKey] = retainedAngle;
      joint.setJointValue?.(retainedAngle);
      return;
    }

    currentAngles[jointKey] = resolveViewerJointAngleValue({}, jointKey, joint, 0);
  });

  return { currentAngles };
}
