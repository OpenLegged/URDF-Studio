import React from 'react';
import {
  CheckCheck,
  CheckSquare2,
  Link2,
  Loader2,
  MousePointerClick,
  Unlink,
  X,
} from 'lucide-react';
import { IconButton, SegmentedControl } from '@/shared/components/ui';
import { GeometryType, type InteractionSelection } from '@/types';
import type {
  CollisionOptimizationAnalysis,
  CollisionOptimizationCandidate,
  CollisionOptimizationManualMergePair,
  CollisionOptimizationScope,
  CollisionOptimizationSource,
  CollisionTargetRef,
} from '../utils/collisionOptimization';
import {
  CollisionOptimizationCandidateList,
  type CollisionOptimizationCandidateListLabels,
} from './CollisionOptimizationCandidateList';
import {
  CollisionOptimizationPlanarGraph,
  type CollisionOptimizationPlanarGraphConnectionState,
  type CollisionOptimizationPlanarGraphLabels,
} from './CollisionOptimizationPlanarGraph';

type CollisionSelection = InteractionSelection;

export type CollisionOptimizationCandidatesViewMode = 'list' | 'graph';

export interface CollisionOptimizationCandidatesPanelLabels {
  analyzing: string;
  clearAll: string;
  clearManualPairs: string;
  eligible: string;
  noCandidates: string;
  noSelectedCollision: string;
  scopeAll: string;
  scopeMesh: string;
  scopePrimitive: string;
  scopeSelected: string;
  selectAll: string;
  selectedCount: string;
  title: string;
  viewGraph: string;
  viewList: string;
}

export interface CollisionOptimizationCandidatesPanelProps {
  id?: string;
  activeCandidateKey?: string | null;
  source: CollisionOptimizationSource;
  analysis: CollisionOptimizationAnalysis | null;
  candidates: CollisionOptimizationCandidate[];
  selection?: CollisionSelection;
  scope: CollisionOptimizationScope;
  viewMode: CollisionOptimizationCandidatesViewMode;
  checkedCandidateKeys: ReadonlySet<string>;
  eligibleCount: number;
  activeSelectionCount: number;
  isAnalyzing: boolean;
  isSelectedScopeWithoutSelection: boolean;
  manualMergePairs: CollisionOptimizationManualMergePair[];
  manualConnection?: CollisionOptimizationPlanarGraphConnectionState | null;
  labels: CollisionOptimizationCandidatesPanelLabels;
  listLabels: CollisionOptimizationCandidateListLabels;
  graphLabels: CollisionOptimizationPlanarGraphLabels;
  formatGeometryType: (type: GeometryType | null | undefined) => string;
  getStatusLabel: (candidate: CollisionOptimizationCandidate) => string;
  canCreateManualPair: (sourceTargetId: string, targetTargetId: string) => boolean;
  onActivateCandidate?: (candidateKey: string, candidate: CollisionOptimizationCandidate) => void;
  onScopeChange: (scope: CollisionOptimizationScope) => void;
  onViewModeChange: (mode: CollisionOptimizationCandidatesViewMode) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onClearManualPairs: () => void;
  onToggleCandidate: (candidateKey: string) => void;
  onSelectTarget?: (target: CollisionTargetRef) => void;
  onHoverTarget?: (target: CollisionTargetRef | null) => void;
  onManualConnectionStart?: (target: CollisionTargetRef) => void;
  onManualConnectionMove?: (pointer: { x: number; y: number }) => void;
  onManualConnectionEnd?: (target: CollisionTargetRef | null) => void;
  onManualConnectionCancel?: () => void;
}

export function CollisionOptimizationCandidatesPanel({
  id,
  activeCandidateKey = null,
  source,
  analysis,
  candidates,
  selection,
  scope,
  viewMode,
  checkedCandidateKeys,
  eligibleCount,
  activeSelectionCount,
  isAnalyzing,
  isSelectedScopeWithoutSelection,
  manualMergePairs,
  manualConnection = null,
  labels,
  listLabels,
  graphLabels,
  formatGeometryType,
  getStatusLabel,
  canCreateManualPair,
  onActivateCandidate,
  onScopeChange,
  onViewModeChange,
  onSelectAll,
  onClearAll,
  onClearManualPairs,
  onToggleCandidate,
  onSelectTarget,
  onHoverTarget,
  onManualConnectionStart,
  onManualConnectionMove,
  onManualConnectionEnd,
  onManualConnectionCancel,
}: CollisionOptimizationCandidatesPanelProps) {
  return (
    <div
      id={id}
      data-collision-optimization-panel="candidates"
      className="@container flex min-h-0 flex-col overflow-hidden rounded-lg border border-border-black bg-element-bg"
    >
      <div className="shrink-0 border-b border-border-black bg-panel-bg px-1.75 py-1.25">
        <div className="space-y-1.25">
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="min-w-0 flex flex-1 items-center gap-1.5">
              <div className="shrink-0 text-xs font-semibold text-text-primary">{labels.title}</div>
              <div
                aria-label={`${labels.eligible} ${eligibleCount}, ${labels.selectedCount} ${activeSelectionCount}`}
                className={`inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] tabular-nums ${
                  activeSelectionCount > 0
                    ? 'border-system-blue/20 bg-system-blue/10 text-system-blue'
                    : 'border-border-black bg-element-bg text-text-tertiary'
                }`}
              >
                <span className="hidden @[320px]:inline">{labels.eligible}</span>
                <span>{eligibleCount}</span>
                <span className="text-text-tertiary">·</span>
                <CheckSquare2 className="h-2.5 w-2.5 shrink-0" />
                <span className="hidden @[320px]:inline">{labels.selectedCount}</span>
                <span>{activeSelectionCount}</span>
              </div>
              {manualMergePairs.length > 0 ? (
                <span
                  title={labels.clearManualPairs}
                  className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border-black bg-element-bg px-2 py-0.5 text-[11px] text-text-tertiary"
                >
                  <Link2 className="h-2.5 w-2.5" />
                  {manualMergePairs.length}
                </span>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-0.5">
              <IconButton
                size="xs"
                title={labels.selectAll}
                aria-label={labels.selectAll}
                onClick={onSelectAll}
              >
                <CheckCheck className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton
                size="xs"
                title={labels.clearAll}
                aria-label={labels.clearAll}
                onClick={onClearAll}
              >
                <X className="h-3.5 w-3.5" />
              </IconButton>
              {manualMergePairs.length > 0 ? (
                <IconButton
                  size="xs"
                  title={labels.clearManualPairs}
                  aria-label={labels.clearManualPairs}
                  onClick={onClearManualPairs}
                >
                  <Unlink className="h-3.5 w-3.5" />
                </IconButton>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-1 @[360px]:grid-cols-[minmax(0,1fr)_minmax(8rem,0.58fr)]">
            <SegmentedControl<CollisionOptimizationScope>
              size="xs"
              value={scope}
              onChange={onScopeChange}
              ariaLabel={labels.title}
              className="w-full"
              itemClassName="text-[11px]"
              options={[
                { value: 'all', label: labels.scopeAll },
                { value: 'mesh', label: labels.scopeMesh },
                { value: 'primitive', label: labels.scopePrimitive },
                { value: 'selected', label: labels.scopeSelected },
              ]}
            />

            <SegmentedControl<CollisionOptimizationCandidatesViewMode>
              size="xs"
              value={viewMode}
              onChange={onViewModeChange}
              ariaLabel={`${labels.viewList} / ${labels.viewGraph}`}
              className="w-full"
              itemClassName="text-[11px]"
              options={[
                { value: 'list', label: labels.viewList },
                { value: 'graph', label: labels.viewGraph },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-0.75">
        {isAnalyzing ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 text-xs text-text-tertiary">
            <Loader2 className="h-4.5 w-4.5 animate-spin" />
            <span>{labels.analyzing}</span>
          </div>
        ) : isSelectedScopeWithoutSelection ? (
          <div className="flex h-full items-center justify-center">
            <div className="rounded-lg border border-dashed border-border-black bg-panel-bg px-3 py-4 text-center text-[11px] leading-relaxed text-text-secondary">
              <MousePointerClick className="mx-auto mb-1.5 h-4.5 w-4.5 text-text-tertiary" />
              {labels.noSelectedCollision}
            </div>
          </div>
        ) : candidates.length === 0 || !analysis ? (
          <div className="flex h-full items-center justify-center">
            <div className="rounded-lg border border-dashed border-border-black bg-panel-bg px-3 py-4 text-center text-[11px] leading-relaxed text-text-secondary">
              {labels.noCandidates}
            </div>
          </div>
        ) : viewMode === 'graph' ? (
          <CollisionOptimizationPlanarGraph
            source={source}
            analysis={analysis}
            candidates={candidates}
            selection={selection}
            checkedCandidateKeys={checkedCandidateKeys}
            manualMergePairs={manualMergePairs}
            manualConnection={manualConnection}
            labels={graphLabels}
            formatGeometryType={formatGeometryType}
            canCreateManualPair={canCreateManualPair}
            onToggleCandidate={onToggleCandidate}
            onSelectTarget={onSelectTarget}
            onManualConnectionStart={onManualConnectionStart}
            onManualConnectionMove={onManualConnectionMove}
            onManualConnectionEnd={onManualConnectionEnd}
            onManualConnectionCancel={onManualConnectionCancel}
          />
        ) : (
          <div className="h-full overflow-y-auto">
            <CollisionOptimizationCandidateList
              activeCandidateKey={activeCandidateKey}
              candidates={candidates}
              checkedCandidateKeys={checkedCandidateKeys}
              selection={selection}
              labels={listLabels}
              formatGeometryType={formatGeometryType}
              getStatusLabel={getStatusLabel}
              onActivateCandidate={onActivateCandidate}
              onSelectTarget={onSelectTarget}
              onHoverTarget={onHoverTarget}
              onToggleCandidate={onToggleCandidate}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default CollisionOptimizationCandidatesPanel;
