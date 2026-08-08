import { useCallback, useRef, useState } from 'react';
import {
  createJointPanelStore,
  type JointPanelActiveJointOptions,
} from '@/shared/utils/jointPanelStore';

/** Owns the imperative joint-panel store and its synchronized callback refs. */
export function useJointPanelState() {
  const jointPanelStoreRef = useRef(createJointPanelStore());
  const jointAnglesRef = useRef<Record<string, number>>(
    jointPanelStoreRef.current.getSnapshot().jointAngles,
  );
  const activeJointRef = useRef<string | null>(
    jointPanelStoreRef.current.getSnapshot().activeJoint,
  );
  const suppressNextPanelAutoScrollRef = useRef(false);
  const [angleUnit, setAngleUnit] = useState<'rad' | 'deg'>('rad');

  const syncJointAngleSnapshot = useCallback(() => {
    jointAnglesRef.current = jointPanelStoreRef.current.getSnapshot().jointAngles;
  }, []);

  const syncActiveJointSnapshot = useCallback(() => {
    activeJointRef.current = jointPanelStoreRef.current.getSnapshot().activeJoint;
  }, []);

  const patchJointPanelAngles = useCallback(
    (nextJointAngles: Record<string, number>) => {
      const changed = jointPanelStoreRef.current.patchJointAngles(nextJointAngles);
      if (changed) {
        syncJointAngleSnapshot();
      }
      return changed;
    },
    [syncJointAngleSnapshot],
  );

  const replaceJointPanelAngles = useCallback(
    (nextJointAngles: Record<string, number>) => {
      const changed = jointPanelStoreRef.current.replaceJointAngles(nextJointAngles);
      syncJointAngleSnapshot();
      return changed;
    },
    [syncJointAngleSnapshot],
  );

  const setPanelActiveJoint = useCallback(
    (jointName: string | null, options?: JointPanelActiveJointOptions) => {
      if (options?.suppressNextAutoScroll) {
        suppressNextPanelAutoScrollRef.current = true;
      }

      const shouldSuppressAutoScroll =
        jointName !== null &&
        options?.autoScroll === undefined &&
        suppressNextPanelAutoScrollRef.current;
      const changed = jointPanelStoreRef.current.setActiveJoint(
        jointName,
        shouldSuppressAutoScroll ? { ...options, autoScroll: false } : options,
      );

      if (shouldSuppressAutoScroll) {
        suppressNextPanelAutoScrollRef.current = false;
      }

      syncActiveJointSnapshot();
      return changed;
    },
    [syncActiveJointSnapshot],
  );

  return {
    activeJointRef,
    angleUnit,
    jointAnglesRef,
    jointPanelStore: jointPanelStoreRef.current,
    patchJointPanelAngles,
    replaceJointPanelAngles,
    setAngleUnit,
    setPanelActiveJoint,
  };
}
