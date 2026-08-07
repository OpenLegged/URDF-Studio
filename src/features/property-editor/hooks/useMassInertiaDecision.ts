/**
 * Mass-inertia decision hook — the "user changed mass → ask or auto-apply →
 * show floating notice" state machine, extracted from LinkProperties so it is
 * independently testable. No UI rendering.
 *
 * Boundary: feature hook (property-editor). Imports React +
 * @/shared/utils/inertialDerived + @/store/uiStore (types only) + @/types.
 * Store access (preferredBehavior / persistPreferredBehavior) and
 * notice-message building are injected as params so the hook stays a pure
 * state machine with no store/UI coupling — matching useNumberInputController.
 *
 * 不变量：preferredBehavior === 'ask' 时开确认弹窗（pendingMassInertiaDecision），
 * 由用户在 SegmentedControl 选 reestimate / preserve 后 handleConfirmMassInertiaDecision
 * 落地；非 'ask' 时直接按记忆行为 applyMassChange。落 地后 showFloatingMassInertiaNotice
 * 展示 5s 浮层。remember=true 时把所选 behavior 持久化到 uiStore，后续同 type 改动自动应用。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UrdfLink } from '@/types';
import type { WorkspaceLinkPropertyPatch } from '@/store/workspace/types';
import type { MassInertiaChangeBehavior } from '@/store/uiStore';
import { scaleInertiaTensorForMassChange } from '@/shared/utils/inertialDerived';

export type ResolvedMassInertiaBehavior = Exclude<MassInertiaChangeBehavior, 'ask'>;

export interface PendingMassInertiaDecision {
  linkSnapshot: UrdfLink;
  nextMass: number;
  scaledEstimate: ReturnType<typeof scaleInertiaTensorForMassChange>;
}

export interface FloatingMassInertiaNotice {
  message: string;
  tone: 'info' | 'success';
}

export interface UseMassInertiaDecisionParams {
  linkSnapshot: UrdfLink;
  currentMass: number;
  inertial: NonNullable<UrdfLink['inertial']>;
  preferredBehavior: MassInertiaChangeBehavior;
  persistPreferredBehavior: (behavior: ResolvedMassInertiaBehavior) => void;
  applyInertialUpdate: (
    linkId: string,
    inertial: WorkspaceLinkPropertyPatch['inertial'],
  ) => void;
  buildNotice: (
    linkName: string,
    nextMass: number,
    behavior: ResolvedMassInertiaBehavior,
    scaledEstimate: ReturnType<typeof scaleInertiaTensorForMassChange>,
  ) => FloatingMassInertiaNotice;
}

export interface UseMassInertiaDecisionResult {
  pendingMassInertiaDecision: PendingMassInertiaDecision | null;
  selectedMassInertiaBehavior: ResolvedMassInertiaBehavior;
  setSelectedMassInertiaBehavior: (value: ResolvedMassInertiaBehavior) => void;
  rememberMassInertiaBehavior: boolean;
  setRememberMassInertiaBehavior: (value: boolean) => void;
  setPendingMassInertiaDecision: (value: PendingMassInertiaDecision | null) => void;
  floatingMassInertiaNotice: FloatingMassInertiaNotice | null;
  handleMassChange: (nextMass: number) => void;
  handleConfirmMassInertiaDecision: () => void;
}

const MASS_INERTIA_NOTICE_TIMEOUT_MS = 5000;

export const useMassInertiaDecision = ({
  linkSnapshot,
  currentMass,
  inertial,
  preferredBehavior,
  persistPreferredBehavior,
  applyInertialUpdate,
  buildNotice,
}: UseMassInertiaDecisionParams): UseMassInertiaDecisionResult => {
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingMassInertiaDecision, setPendingMassInertiaDecision] =
    useState<PendingMassInertiaDecision | null>(null);
  const [selectedMassInertiaBehavior, setSelectedMassInertiaBehavior] =
    useState<ResolvedMassInertiaBehavior>('reestimate');
  const [rememberMassInertiaBehavior, setRememberMassInertiaBehavior] = useState(false);
  const [floatingMassInertiaNotice, setFloatingMassInertiaNotice] =
    useState<FloatingMassInertiaNotice | null>(null);

  const showFloatingMassInertiaNotice = useCallback((notice: FloatingMassInertiaNotice) => {
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
    }

    setFloatingMassInertiaNotice(notice);
    noticeTimerRef.current = setTimeout(() => {
      setFloatingMassInertiaNotice(null);
      noticeTimerRef.current = null;
    }, MASS_INERTIA_NOTICE_TIMEOUT_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  // Reset transient decision state when the selected link changes.
  useEffect(() => {
    setPendingMassInertiaDecision(null);
    setRememberMassInertiaBehavior(false);
    setSelectedMassInertiaBehavior('reestimate');
  }, [linkSnapshot.id]);

  const applyMassChange = useCallback(
    (
      linkSnapshotArg: UrdfLink,
      nextMass: number,
      behavior: ResolvedMassInertiaBehavior,
      scaledEstimate: ReturnType<typeof scaleInertiaTensorForMassChange>,
      options?: { remember?: boolean },
    ) => {
      const nextInertial = {
        mass: nextMass,
        ...(behavior === 'reestimate' && scaledEstimate ? { inertia: scaledEstimate.inertia } : {}),
      };

      applyInertialUpdate(linkSnapshotArg.id, nextInertial);

      if (options?.remember) {
        persistPreferredBehavior(behavior);
      }

      showFloatingMassInertiaNotice(
        buildNotice(linkSnapshotArg.name, nextMass, behavior, scaledEstimate),
      );
    },
    [applyInertialUpdate, buildNotice, persistPreferredBehavior, showFloatingMassInertiaNotice],
  );

  const handleMassChange = useCallback(
    (nextMass: number) => {
      if (Math.abs(nextMass - currentMass) <= 1e-12) {
        return;
      }

      const scaledEstimate = scaleInertiaTensorForMassChange(inertial, nextMass);

      if (preferredBehavior === 'ask') {
        setPendingMassInertiaDecision({
          linkSnapshot,
          nextMass,
          scaledEstimate,
        });
        setSelectedMassInertiaBehavior(scaledEstimate ? 'reestimate' : 'preserve');
        setRememberMassInertiaBehavior(false);
        return;
      }

      applyMassChange(linkSnapshot, nextMass, preferredBehavior, scaledEstimate);
    },
    [applyMassChange, currentMass, inertial, linkSnapshot, preferredBehavior],
  );

  const handleConfirmMassInertiaDecision = useCallback(() => {
    if (!pendingMassInertiaDecision) {
      return;
    }

    applyMassChange(
      pendingMassInertiaDecision.linkSnapshot,
      pendingMassInertiaDecision.nextMass,
      selectedMassInertiaBehavior,
      pendingMassInertiaDecision.scaledEstimate,
      {
        remember: rememberMassInertiaBehavior,
      },
    );
    setPendingMassInertiaDecision(null);
    setRememberMassInertiaBehavior(false);
  }, [
    applyMassChange,
    pendingMassInertiaDecision,
    rememberMassInertiaBehavior,
    selectedMassInertiaBehavior,
  ]);

  return {
    pendingMassInertiaDecision,
    selectedMassInertiaBehavior,
    setSelectedMassInertiaBehavior,
    rememberMassInertiaBehavior,
    setRememberMassInertiaBehavior,
    setPendingMassInertiaDecision,
    floatingMassInertiaNotice,
    handleMassChange,
    handleConfirmMassInertiaDecision,
  };
};
