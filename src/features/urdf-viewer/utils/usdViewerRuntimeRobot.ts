import { JointType } from '@/types';
import {
  unwrapContinuousJointAngle,
  wrapContinuousJointAngle,
} from '@/shared/utils/continuousJointAngle';
import type { ViewerRobotDataResolution } from './viewerRobotData';
import {
  degreesToRadians,
  resolveUsdRuntimeJointLimitsRadians,
  type UsdRuntimeJointInfoLike,
} from './usdRuntimeJointInfo';

type LinkRotationControllerLike = {
  apply: (renderInterface?: unknown, options?: Record<string, unknown>) => unknown;
  getJointInfoForLink?: (linkPath: string) => UsdRuntimeJointInfoLike | null | undefined;
  setJointAngleForLink: (
    linkPath: string,
    angleDeg: number,
    options?: { emitSelectionChanged?: boolean },
  ) => UsdRuntimeJointInfoLike | null | undefined;
};

export interface CreateUsdViewerRuntimeRobotOptions {
  flushDecorationRefresh?: () => void;
  linkRotationController: LinkRotationControllerLike;
  requestRender?: () => void;
  resolution: ViewerRobotDataResolution;
  scheduleDecorationRefresh?: () => void;
}

export function createUsdViewerRuntimeRobot({
  flushDecorationRefresh,
  linkRotationController,
  requestRender,
  resolution,
  scheduleDecorationRefresh,
}: CreateUsdViewerRuntimeRobotOptions) {
  const joints = Object.fromEntries(
    Object.entries(resolution.robotData.joints).map(([jointId, joint]) => {
      const childLinkPath = resolution.childLinkPathByJointId[jointId] || '';
      const jointInfo = childLinkPath
        ? linkRotationController.getJointInfoForLink?.(childLinkPath)
        : null;
      const resolvedLimits = resolveUsdRuntimeJointLimitsRadians(jointInfo, joint.limit);
      const runtimeJointAngle = degreesToRadians(jointInfo?.angleDeg);
      const hasAuthoredJointAngle =
        typeof joint.angle === 'number' && Number.isFinite(joint.angle);
      const initialJointAngle = hasAuthoredJointAngle ? joint.angle : 0;
      const runtimeJoint = {
        id: jointId,
        name: joint.name || jointId,
        type: joint.type,
        jointType: joint.type,
        parentLinkId: joint.parentLinkId,
        child: { name: joint.childLinkId },
        parent: { name: joint.parentLinkId },
        ignoreLimits: false,
        limit: {
          ...joint.limit,
          ...resolvedLimits,
        },
        angle: initialJointAngle,
        setJointValue(nextValue: number) {
          const numericValue = Number(nextValue);
          if (!Number.isFinite(numericValue)) {
            return;
          }

          const previousAngle = Number(this.angle);
          let resolvedAngle = numericValue;
          const controllerAngle =
            joint.type === JointType.CONTINUOUS
              ? wrapContinuousJointAngle(numericValue)
              : numericValue;

          if (childLinkPath && joint.type !== JointType.FIXED) {
            if (Number.isFinite(previousAngle) && Math.abs(previousAngle - numericValue) <= 1e-8) {
              return;
            }

            const updatedJointInfo = linkRotationController.setJointAngleForLink(
              childLinkPath,
              (controllerAngle * 180) / Math.PI,
              { emitSelectionChanged: false },
            );
            const runtimeResolvedAngle = degreesToRadians(updatedJointInfo?.angleDeg);
            resolvedAngle =
              joint.type === JointType.CONTINUOUS
                ? runtimeResolvedAngle !== undefined
                  ? unwrapContinuousJointAngle(runtimeResolvedAngle, numericValue)
                  : numericValue
                : (runtimeResolvedAngle ?? numericValue);
            requestRender?.();
            scheduleDecorationRefresh?.();
          }

          this.angle = resolvedAngle;
        },
        finalizeJointValue() {
          flushDecorationRefresh?.();
        },
      };

      // Only authored RobotData angles should drive the USD runtime back to a different pose.
      if (
        childLinkPath &&
        joint.type !== JointType.FIXED &&
        hasAuthoredJointAngle &&
        runtimeJointAngle !== undefined &&
        Math.abs(runtimeJointAngle - initialJointAngle) > 1e-8
      ) {
        linkRotationController.setJointAngleForLink(
          childLinkPath,
          (initialJointAngle * 180) / Math.PI,
          { emitSelectionChanged: false },
        );
        requestRender?.();
        scheduleDecorationRefresh?.();
      }

      return [jointId, runtimeJoint];
    }),
  );

  return {
    joints,
  };
}
