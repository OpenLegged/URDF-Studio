import React from 'react';
import { ArrowRight, MousePointerClick } from 'lucide-react';
import { Checkbox, PanelSegmentedControl } from '@/shared/components/ui';
import { GeometryType } from '@/types';
import type {
  CollisionOptimizationCandidate,
  CollisionTargetRef,
} from '../utils/collisionOptimization';

export interface CollisionOptimizationStrategyPanelLabels {
  current: string;
  includeCandidate: string;
  reason: string;
  selectCandidateHint: string;
  selectedCandidate: string;
  status: string;
  suggested: string;
}

interface CollisionOptimizationStrategyPanelProps {
  activeCandidate: CollisionOptimizationCandidate | null;
  activeCandidateKey?: string | null;
  getCandidateOverrideOptions: (candidate: CollisionOptimizationCandidate) => GeometryType[];
  getReasonLabel: (candidate: CollisionOptimizationCandidate) => string | null;
  getStatusLabel: (candidate: CollisionOptimizationCandidate) => string;
  isChecked: boolean;
  labels: CollisionOptimizationStrategyPanelLabels;
  onSelectTarget?: (target: CollisionTargetRef) => void;
  onHoverTarget?: (target: CollisionTargetRef | null) => void;
  onSetCandidateOverride: (
    candidate: CollisionOptimizationCandidate,
    nextType: GeometryType,
  ) => void;
  onToggleCandidate?: (candidateKey: string) => void;
  formatGeometryType: (type: GeometryType | null | undefined) => string;
  strategyField?: {
    desc?: string;
    label: string;
  } | null;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[11px] font-semibold tracking-[0.02em] text-text-tertiary">
      {children}
    </div>
  );
}

function TargetPill({
  target,
  onHoverTarget,
  onSelectTarget,
}: {
  target: CollisionTargetRef;
  onHoverTarget?: (target: CollisionTargetRef | null) => void;
  onSelectTarget?: (target: CollisionTargetRef) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelectTarget?.(target)}
      onMouseEnter={() => onHoverTarget?.(target)}
      onMouseLeave={() => onHoverTarget?.(null)}
      className="rounded-full border border-border-black bg-panel-bg px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-element-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
    >
      {target.linkName}
      {target.componentName ? (
        <span className="text-text-tertiary"> · {target.componentName}</span>
      ) : null}
    </button>
  );
}

export function CollisionOptimizationStrategyPanel({
  activeCandidate,
  activeCandidateKey = null,
  getCandidateOverrideOptions,
  getReasonLabel,
  getStatusLabel,
  isChecked,
  labels,
  onSelectTarget,
  onHoverTarget,
  onSetCandidateOverride,
  onToggleCandidate,
  formatGeometryType,
  strategyField = null,
}: CollisionOptimizationStrategyPanelProps) {
  return (
    <div className="rounded-lg border border-border-black bg-element-bg px-2 py-2">
      <SectionLabel>{labels.selectedCandidate}</SectionLabel>

      {!activeCandidate || !activeCandidateKey ? (
        <div className="flex min-h-28 items-center justify-center rounded-lg border border-dashed border-border-black bg-panel-bg px-3 py-4 text-center text-[11px] leading-relaxed text-text-secondary">
          <div>
            <MousePointerClick className="mx-auto mb-1.5 h-4.5 w-4.5 text-text-tertiary" />
            {labels.selectCandidateHint}
          </div>
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-system-blue/20 bg-system-blue/8 px-2 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-text-secondary">
                  <span>{labels.current}</span>
                  <span className="rounded-full border border-border-black bg-panel-bg px-2 py-0.5 text-[11px] font-medium text-text-primary">
                    {formatGeometryType(activeCandidate.currentType)}
                  </span>
                  <ArrowRight className="h-3 w-3 text-text-tertiary" />
                  <span className="rounded-full border border-system-blue/20 bg-panel-bg px-2 py-0.5 text-[11px] font-medium text-system-blue">
                    {formatGeometryType(
                      activeCandidate.suggestedType ?? activeCandidate.currentType,
                    )}
                  </span>
                </div>

                <div className="mt-1 flex flex-wrap gap-1">
                  <TargetPill
                    target={activeCandidate.target}
                    onHoverTarget={onHoverTarget}
                    onSelectTarget={onSelectTarget}
                  />
                  {activeCandidate.secondaryTarget ? (
                    <TargetPill
                      target={activeCandidate.secondaryTarget}
                      onHoverTarget={onHoverTarget}
                      onSelectTarget={onSelectTarget}
                    />
                  ) : null}
                </div>
              </div>

              <Checkbox
                checked={isChecked}
                onChange={() => onToggleCandidate?.(activeCandidateKey)}
                disabled={!activeCandidate.eligible}
                ariaLabel={labels.includeCandidate}
                label={
                  <span className="text-[11px] font-medium text-text-primary">
                    {labels.includeCandidate}
                  </span>
                }
                className="shrink-0"
              />
            </div>

            <div className="mt-2 space-y-1 rounded-md border border-border-black bg-panel-bg px-1.75 py-1.25">
              <div className="flex items-start gap-1.5 text-[11px]">
                <span className="w-10 shrink-0 text-text-tertiary">{labels.status}</span>
                <span className="font-medium text-text-primary">
                  {getStatusLabel(activeCandidate)}
                </span>
              </div>
              <div className="flex items-start gap-1.5 text-[11px]">
                <span className="w-10 shrink-0 text-text-tertiary">{labels.reason}</span>
                <span className="leading-snug text-text-primary">
                  {getReasonLabel(activeCandidate) ?? '-'}
                </span>
              </div>
            </div>
          </div>

          {strategyField && getCandidateOverrideOptions(activeCandidate).length > 1 ? (
            <div className="mt-1.5 rounded-lg border border-border-black bg-panel-bg px-2 py-2">
              <div className="text-xs font-medium leading-tight text-text-primary">
                {strategyField.label}
              </div>
              {strategyField.desc ? (
                <div className="mt-1 text-[11px] leading-snug text-text-tertiary">
                  {strategyField.desc}
                </div>
              ) : null}

              <div className="mt-1.5 flex flex-wrap gap-1">
                <PanelSegmentedControl
                  value={activeCandidate.suggestedType ?? activeCandidate.currentType}
                  onChange={(type) => onSetCandidateOverride(activeCandidate, type)}
                  options={getCandidateOverrideOptions(activeCandidate).map((type) => ({
                    value: type,
                    label: formatGeometryType(type),
                  }))}
                  stretch
                  ariaLabel={strategyField.label}
                  className="w-full"
                  itemClassName="min-h-8 min-w-0 flex-1 px-2 py-1.5 text-[11px] font-semibold @[320px]:px-2.5"
                />
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export default CollisionOptimizationStrategyPanel;
