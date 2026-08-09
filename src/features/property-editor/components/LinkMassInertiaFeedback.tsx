import React from 'react';
import { createPortal } from 'react-dom';

import { MAX_PROPERTY_DECIMALS, formatNumberWithMaxDecimals } from '@/core/utils/numberPrecision';
import { Button, Checkbox, Dialog, SegmentedControl } from '@/shared/components/ui';
import { translations } from '@/shared/i18n';
import {
  scaleInertiaTensorForMassChange,
  type InertiaTensorComponents,
} from '@/shared/utils/inertialDerived';
import type {
  FloatingMassInertiaNotice,
  ResolvedMassInertiaBehavior,
  UseMassInertiaDecisionResult,
} from '../hooks/useMassInertiaDecision';

function fillTemplate(template: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, value),
    template,
  );
}

function formatReadonlyNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'N/A';
  }

  return formatNumberWithMaxDecimals(value, MAX_PROPERTY_DECIMALS);
}

function formatInertiaTensorSummary(inertia: InertiaTensorComponents): string {
  const diagonalSummary = `ixx=${formatReadonlyNumber(inertia.ixx)}, iyy=${formatReadonlyNumber(
    inertia.iyy,
  )}, izz=${formatReadonlyNumber(inertia.izz)}`;
  const hasOffDiagonalTerms = [inertia.ixy, inertia.ixz, inertia.iyz].some(
    (value) => Math.abs(value) > 1e-9,
  );

  if (!hasOffDiagonalTerms) {
    return diagonalSummary;
  }

  return `${diagonalSummary}; ixy=${formatReadonlyNumber(inertia.ixy)}, ixz=${formatReadonlyNumber(
    inertia.ixz,
  )}, iyz=${formatReadonlyNumber(inertia.iyz)}`;
}

interface BuildMassInertiaNoticeOptions {
  t: (typeof translations)['en'];
  linkName: string;
  nextMass: number;
  behavior: ResolvedMassInertiaBehavior;
  scaledEstimate: ReturnType<typeof scaleInertiaTensorForMassChange>;
}

export function buildMassInertiaNotice({
  t,
  linkName,
  nextMass,
  behavior,
  scaledEstimate,
}: BuildMassInertiaNoticeOptions): FloatingMassInertiaNotice {
  if (behavior === 'reestimate' && scaledEstimate) {
    return {
      message: fillTemplate(t.massChangeInertiaReestimatedNotice, {
        name: linkName,
        tensor: formatInertiaTensorSummary(scaledEstimate.inertia),
      }),
      tone: 'success',
    };
  }

  if (behavior === 'reestimate') {
    return {
      message: fillTemplate(t.massChangeInertiaFallbackNotice, { name: linkName }),
      tone: 'info',
    };
  }

  return {
    message: fillTemplate(t.massChangeInertiaPreservedNotice, {
      name: linkName,
      mass: formatNumberWithMaxDecimals(nextMass, MAX_PROPERTY_DECIMALS),
    }),
    tone: 'info',
  };
}

type MassInertiaFeedbackDecision = Pick<
  UseMassInertiaDecisionResult,
  | 'pendingMassInertiaDecision'
  | 'selectedMassInertiaBehavior'
  | 'setSelectedMassInertiaBehavior'
  | 'rememberMassInertiaBehavior'
  | 'setRememberMassInertiaBehavior'
  | 'setPendingMassInertiaDecision'
  | 'floatingMassInertiaNotice'
  | 'handleConfirmMassInertiaDecision'
>;

interface LinkMassInertiaFeedbackProps {
  decision: MassInertiaFeedbackDecision;
  t: (typeof translations)['en'];
}

/** Renders confirmation and transient feedback for the mass/inertia state machine. */
export const LinkMassInertiaFeedback: React.FC<LinkMassInertiaFeedbackProps> = ({
  decision,
  t,
}) => {
  const {
    pendingMassInertiaDecision,
    selectedMassInertiaBehavior,
    setSelectedMassInertiaBehavior,
    rememberMassInertiaBehavior,
    setRememberMassInertiaBehavior,
    setPendingMassInertiaDecision,
    floatingMassInertiaNotice,
    handleConfirmMassInertiaDecision,
  } = decision;
  const closeDecision = () => {
    setPendingMassInertiaDecision(null);
    setRememberMassInertiaBehavior(false);
  };

  return (
    <>
      <Dialog
        isOpen={Boolean(pendingMassInertiaDecision)}
        onClose={closeDecision}
        title={t.massChangeInertiaDialogTitle}
        width="w-[520px]"
        zIndexClassName="z-[260]"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" onClick={closeDecision}>
              {t.cancel}
            </Button>
            <Button type="button" onClick={handleConfirmMassInertiaDecision}>
              {t.confirm}
            </Button>
          </div>
        }
      >
        {pendingMassInertiaDecision ? (
          <div className="space-y-3">
            <p className="text-sm leading-6 text-text-secondary">
              {fillTemplate(t.massChangeInertiaDialogMessage, {
                name: pendingMassInertiaDecision.linkSnapshot.name,
                mass: formatNumberWithMaxDecimals(
                  pendingMassInertiaDecision.nextMass,
                  MAX_PROPERTY_DECIMALS,
                ),
              })}
            </p>
            <div className="space-y-2">
              <SegmentedControl<ResolvedMassInertiaBehavior>
                size="sm"
                value={selectedMassInertiaBehavior}
                onChange={setSelectedMassInertiaBehavior}
                options={[
                  { value: 'preserve', label: t.massChangeInertiaKeep },
                  {
                    value: 'reestimate',
                    label: t.massChangeInertiaReestimate,
                    disabled: !pendingMassInertiaDecision.scaledEstimate,
                  },
                ]}
              />
              <div className="rounded-xl border border-border-black bg-element-bg/60 px-3 py-2.5">
                <div className="text-xs font-semibold text-text-primary">
                  {selectedMassInertiaBehavior === 'preserve'
                    ? t.massChangeInertiaKeepDescription
                    : t.massChangeInertiaReestimateDescription}
                </div>
                {selectedMassInertiaBehavior === 'reestimate' &&
                !pendingMassInertiaDecision.scaledEstimate ? (
                  <div className="mt-1.5 text-[11px] leading-5 text-danger">
                    {t.massChangeInertiaReestimateUnavailable}
                  </div>
                ) : null}
              </div>
            </div>
            <Checkbox
              checked={rememberMassInertiaBehavior}
              onChange={setRememberMassInertiaBehavior}
              label={t.massChangeInertiaRememberChoice}
            />
          </div>
        ) : null}
      </Dialog>

      {floatingMassInertiaNotice && typeof document !== 'undefined' && document.body
        ? createPortal(
            <div className="pointer-events-none fixed left-1/2 top-20 z-[200] flex max-w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 animate-in fade-in slide-in-from-top-4 duration-300">
              <div className="flex items-start gap-2.5 rounded-[1.75rem] border border-border-black bg-panel-bg px-3.5 py-2.5 shadow-2xl dark:shadow-black/40">
                <div
                  className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                    floatingMassInertiaNotice.tone === 'success'
                      ? 'bg-emerald-500'
                      : 'bg-system-blue'
                  }`}
                />
                <div className="text-xs font-semibold leading-5 text-text-primary">
                  {floatingMassInertiaNotice.message}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
};
