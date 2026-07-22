import { ArrowRight } from 'lucide-react';
import { Checkbox } from '@/shared/components/ui';
import { GeometryType, type InteractionSelection } from '@/types';
import type {
  CollisionOptimizationCandidate,
  CollisionTargetRef,
} from '../utils/collisionOptimization';
import { createCollisionOptimizationCandidateKey } from '../utils/collisionOptimization';

type CollisionSelection = InteractionSelection;

export interface CollisionOptimizationCandidateListLabels {
  clearAll: string;
  collisionIndex: string;
  component: string;
  jointPair: string;
  noCandidates: string;
  selectedCount: string;
}

interface CollisionOptimizationCandidateListProps {
  activeCandidateKey?: string | null;
  candidates: CollisionOptimizationCandidate[];
  checkedCandidateKeys: ReadonlySet<string>;
  selection?: CollisionSelection;
  labels: CollisionOptimizationCandidateListLabels;
  formatGeometryType: (type: GeometryType | null | undefined) => string;
  getStatusLabel: (candidate: CollisionOptimizationCandidate) => string;
  onActivateCandidate?: (candidateKey: string, candidate: CollisionOptimizationCandidate) => void;
  onSelectTarget?: (target: CollisionTargetRef) => void;
  onHoverTarget?: (target: CollisionTargetRef | null) => void;
  onToggleCandidate: (candidateKey: string) => void;
}

function isFocusedTarget(
  selection: CollisionSelection | undefined,
  target: CollisionTargetRef,
): boolean {
  return (
    selection?.type === 'link' &&
    selection.id === target.linkId &&
    selection.subType === 'collision' &&
    (selection.objectIndex ?? 0) === target.objectIndex
  );
}

function getPrimitiveMonogram(type: GeometryType | null | undefined): string {
  switch (type) {
    case GeometryType.CYLINDER:
      return 'CYL';
    case GeometryType.CAPSULE:
      return 'CAP';
    case GeometryType.BOX:
      return 'BOX';
    case GeometryType.PLANE:
      return 'PLN';
    case GeometryType.SPHERE:
      return 'SPH';
    case GeometryType.ELLIPSOID:
      return 'ELP';
    case GeometryType.HFIELD:
      return 'HFD';
    case GeometryType.SDF:
      return 'SDF';
    case GeometryType.MESH:
      return 'MSH';
    default:
      return '—';
  }
}

function getFlowSources(candidate: CollisionOptimizationCandidate): CollisionTargetRef[] {
  return candidate.secondaryTarget
    ? [candidate.target, candidate.secondaryTarget]
    : [candidate.target];
}

function FlowSourceChip({
  target,
  labels,
  isFocused,
}: {
  target: CollisionTargetRef;
  labels: CollisionOptimizationCandidateListLabels;
  isFocused: boolean;
}) {
  const toneClass = isFocused
    ? 'border-system-blue/35 bg-system-blue/10'
    : 'border-border-black bg-panel-bg';
  const slotLabel = target.isPrimary
    ? null
    : `${labels.collisionIndex} ${target.sequenceIndex + 1}`;

  return (
    <div
      className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border px-1.25 py-0.75 text-left ${toneClass}`}
    >
      <div className="flex h-6 w-6 items-center justify-center rounded-md border border-border-black bg-element-bg text-[9px] font-semibold tracking-[0.08em] text-text-secondary">
        {getPrimitiveMonogram(target.geometry.type)}
      </div>

      <div className="min-w-0 flex items-center gap-0.75">
        <span className="truncate text-[11px] font-semibold text-text-primary">
          {target.linkName}
        </span>
        {slotLabel ? (
          <span className="hidden shrink-0 rounded-full border border-border-black bg-element-bg px-1.5 py-0.5 text-[9px] font-medium text-text-tertiary @[340px]:inline">
            {slotLabel}
          </span>
        ) : null}
        {target.componentName ? (
          <span className="hidden truncate text-[9px] text-text-tertiary @[380px]:inline">
            {labels.component}: {target.componentName}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function CollisionOptimizationCandidateList({
  activeCandidateKey = null,
  candidates,
  checkedCandidateKeys,
  selection,
  labels,
  formatGeometryType,
  getStatusLabel,
  onActivateCandidate,
  onSelectTarget,
  onHoverTarget,
  onToggleCandidate,
}: CollisionOptimizationCandidateListProps) {
  if (candidates.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border-black bg-panel-bg px-3 py-4 text-center text-xs leading-relaxed text-text-secondary">
        {labels.noCandidates}
      </div>
    );
  }

  return (
    <div className="space-y-1 pr-0.5">
      {candidates.map((candidate) => {
        const candidateKey = createCollisionOptimizationCandidateKey(candidate);
        const isChecked = checkedCandidateKeys.has(candidateKey);
        const sources = getFlowSources(candidate);
        const effectiveType = candidate.suggestedType ?? candidate.currentType;
        const targetLabel = formatGeometryType(effectiveType);
        const currentLabel = formatGeometryType(candidate.currentType);
        const statusLabel = getStatusLabel(candidate);
        const isFocused = sources.some((target) => isFocusedTarget(selection, target));
        const isActive = activeCandidateKey === candidateKey;
        const toneClass = isActive
          ? 'border-system-blue/35 bg-system-blue/8 ring-1 ring-system-blue/15 hover:border-system-blue/45 hover:bg-system-blue/12'
          : isFocused
            ? 'border-system-blue/20 bg-system-blue/6 hover:border-system-blue/35 hover:bg-system-blue/10'
            : 'border-border-black bg-panel-bg hover:bg-element-hover';

        return (
          <div
            key={candidateKey}
            className={`rounded-lg border px-2 py-1.5 transition-colors ${toneClass}`}
          >
            <div className="flex items-center gap-1.5">
              <Checkbox
                checked={isChecked}
                onChange={() => {
                  if (!candidate.eligible) {
                    return;
                  }
                  onActivateCandidate?.(candidateKey, candidate);
                  onToggleCandidate(candidateKey);
                }}
                disabled={!candidate.eligible}
                ariaLabel={isChecked ? labels.clearAll : labels.selectedCount}
                className="mt-0.5 shrink-0"
              />

              <button
                type="button"
                aria-pressed={isActive}
                aria-label={`${sources.map((source) => source.linkName).join(' + ')}: ${currentLabel} → ${targetLabel}`}
                onClick={() => {
                  onActivateCandidate?.(candidateKey, candidate);
                  onSelectTarget?.(candidate.target);
                }}
                onMouseEnter={() => onHoverTarget?.(candidate.target)}
                onMouseLeave={() => onHoverTarget?.(null)}
                className="group flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden rounded-md text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
              >
                <div className="flex min-w-0 flex-1 items-center gap-0.75 overflow-hidden">
                  {sources.map((source, index) => (
                    <div
                      key={source.id}
                      className={`min-w-0 items-center gap-0.75 overflow-hidden ${
                        index === 0 ? 'flex' : 'hidden @[360px]:flex'
                      }`}
                    >
                      {index > 0 ? (
                        <span className="shrink-0 text-[11px] font-semibold text-text-tertiary">
                          +
                        </span>
                      ) : null}
                      <FlowSourceChip
                        target={source}
                        labels={labels}
                        isFocused={isFocusedTarget(selection, source)}
                      />
                    </div>
                  ))}
                  {sources.length > 1 ? (
                    <span className="shrink-0 rounded-full border border-border-black bg-element-bg px-1.5 py-0.5 text-[9px] font-semibold text-text-tertiary @[360px]:hidden">
                      +{sources.length - 1}
                    </span>
                  ) : null}
                </div>

                <ArrowRight className="h-3 w-3 shrink-0 text-text-tertiary" />

                <div className="min-w-0 flex-1 rounded-md border border-system-blue/20 bg-system-blue/8 px-1 py-1">
                  <div className="flex min-w-0 items-center justify-between gap-1">
                    <div className="min-w-0 flex items-center gap-1">
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-system-blue/25 bg-panel-bg px-1 text-[8px] font-semibold tracking-[0.08em] text-system-blue">
                        {getPrimitiveMonogram(effectiveType)}
                      </span>
                      <span className="hidden truncate text-[11px] font-semibold text-text-primary @[250px]:inline">
                        {targetLabel}
                      </span>
                    </div>

                    <span
                      className={`hidden shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-medium @[390px]:inline ${
                        candidate.eligible
                          ? 'border-system-blue/20 bg-panel-bg text-system-blue'
                          : 'border-border-black bg-panel-bg text-text-tertiary'
                      }`}
                    >
                      {candidate.secondaryTarget ? `${sources.length} Links` : statusLabel}
                    </span>
                  </div>
                </div>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default CollisionOptimizationCandidateList;
