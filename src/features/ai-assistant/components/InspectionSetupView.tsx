import { Check, ChevronDown, Edit3, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { RobotState } from '@/types';
import type { Language, TranslationKeys } from '@/shared/i18n';
import { Dialog } from '@/shared/components/ui/Dialog';
import {
  INSPECTION_PROFILE_DEFINITIONS,
  getInspectionProfileLayerName,
  getInspectionProfileName,
  type InspectionProfileDefinition,
  type InspectionProfileLayer,
} from '../config/inspectionProfiles';
import { isInspectionItemApplicable } from '../utils/inspectionApplicability';
import {
  buildInspectionItemScopeSummaries,
  buildInspectionProfileScopeSummaries,
  buildInspectionSelectionDeviation,
  type InspectionItemScopeRelation,
  type InspectionProfileScopeSummary,
} from '../utils/inspectionAdvancedScopeViewModel';
import type { NormalInspectionPlanOverride } from '../utils/inspectionNormalPlan';
import {
  cloneSelectedInspectionProfiles,
  countSelectedInspectionProfileItems,
  countSelectedInspectionProfiles,
  type SelectedInspectionProfiles,
} from '../utils/inspectionProfileSelection';

interface InspectionSetupViewProps {
  robot: RobotState;
  lang: Language;
  t: TranslationKeys;
  override: NormalInspectionPlanOverride;
  selectedProfiles: SelectedInspectionProfiles;
  recommendedProfiles: SelectedInspectionProfiles;
  onSelectedProfilesChange: (selectedProfiles: SelectedInspectionProfiles) => void;
  onToggleItem: (profileId: string, itemId: string) => void;
  onFocusProfile: (profileId: string) => void;
  onRestoreRecommendation: () => void;
  onRestoreProfileRecommendation: (profileId: string) => void;
}

const PROFILE_LAYER_ORDER: InspectionProfileLayer[] = [
  'base',
  'morph',
  'format',
  'target',
  'workflow',
];

function getRelationLabel(relation: InspectionItemScopeRelation, t: TranslationKeys) {
  if (relation === 'recommended_included') return t.inspectionRecommendedIncluded;
  if (relation === 'user_added') return t.inspectionUserAddedToRecommendation;
  if (relation === 'user_removed') return t.inspectionUserRemovedFromRecommendation;
  if (relation === 'unavailable') return t.inspectionUnavailableForModel;
  return t.inspectionNotRecommended;
}

function getPlanEditorItemStatusLabel(
  relation: InspectionItemScopeRelation,
  t: TranslationKeys,
) {
  return relation === 'not_recommended' ? t.inspectionSkipped : getRelationLabel(relation, t);
}

function getProfileStatusLabel(summary: InspectionProfileScopeSummary, t: TranslationKeys) {
  if (summary.relation === 'user_added') return t.inspectionUserAddedToRecommendation;
  if (summary.relation === 'user_removed') return t.inspectionUserRemovedFromRecommendation;
  if (summary.relation === 'partial') return t.inspectionAdjusted;
  return t.inspectionRecommendedIncluded;
}

function groupProfilesByLayer(profiles: InspectionProfileDefinition[]) {
  return PROFILE_LAYER_ORDER.map((layer) => ({
    layer,
    profiles: profiles.filter((profile) => profile.layer === layer),
  })).filter((group) => group.profiles.length > 0);
}

function InspectionPlanEditorDialog({
  isOpen,
  robot,
  lang,
  t,
  selectedProfiles,
  recommendedProfiles,
  applicabilityOverride,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  robot: RobotState;
  lang: Language;
  t: TranslationKeys;
  selectedProfiles: SelectedInspectionProfiles;
  recommendedProfiles: SelectedInspectionProfiles;
  applicabilityOverride: Parameters<typeof isInspectionItemApplicable>[3];
  onClose: () => void;
  onConfirm: (selectedProfiles: SelectedInspectionProfiles) => void;
}) {
  const [draftProfiles, setDraftProfiles] = useState<SelectedInspectionProfiles>(() =>
    cloneSelectedInspectionProfiles(selectedProfiles),
  );

  useEffect(() => {
    if (isOpen) {
      setDraftProfiles(cloneSelectedInspectionProfiles(selectedProfiles));
    }
  }, [isOpen, selectedProfiles]);

  const profileSummaries = useMemo(
    () =>
      buildInspectionProfileScopeSummaries(
        draftProfiles,
        recommendedProfiles,
        (profileId, itemId) =>
          isInspectionItemApplicable(robot, profileId, itemId, applicabilityOverride),
      ),
    [applicabilityOverride, draftProfiles, recommendedProfiles, robot],
  );
  const profileSummaryById = useMemo(
    () => new Map(profileSummaries.map((summary) => [summary.profileId, summary])),
    [profileSummaries],
  );
  const selectedItemCount = countSelectedInspectionProfileItems(draftProfiles);
  const selectedProfileCount = countSelectedInspectionProfiles(draftProfiles);

  const toggleProfile = (profile: InspectionProfileDefinition) => {
    setDraftProfiles((current) => {
      const next = cloneSelectedInspectionProfiles(current);
      const currentItems = next[profile.id] ?? new Set<string>();

      next[profile.id] =
        currentItems.size > 0 ? new Set<string>() : new Set(profile.items.map((item) => item.id));
      return next;
    });
  };

  const toggleItem = (profile: InspectionProfileDefinition, itemId: string) => {
    setDraftProfiles((current) => {
      const next = cloneSelectedInspectionProfiles(current);
      const currentItems = new Set(next[profile.id] ?? []);

      if (currentItems.has(itemId)) {
        currentItems.delete(itemId);
      } else {
        currentItems.add(itemId);
      }

      next[profile.id] = currentItems;
      return next;
    });
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t.inspectionPlanEditorTitle}
      width="w-[min(760px,calc(100vw-64px))]"
      zIndexClassName="z-[260]"
      closeLabel={t.close}
      className="max-h-[76vh]"
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="text-[12px] font-medium text-text-secondary">
            {t.inspectionSelectedChecks.replace('{count}', String(selectedItemCount))} ·{' '}
            {t.inspectionSelectedCategories}: {selectedProfileCount}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-inspection-plan-editor-cancel
              onClick={onClose}
              className="h-8 rounded-lg border border-border-black bg-panel-bg px-3 text-[12px] font-medium text-text-secondary transition-colors hover:bg-element-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
            >
              {t.cancel}
            </button>
            <button
              type="button"
              data-inspection-plan-editor-confirm
              onClick={() => onConfirm(cloneSelectedInspectionProfiles(draftProfiles))}
              className="h-8 rounded-lg bg-system-blue-solid px-3 text-[12px] font-semibold text-white shadow-sm transition-colors hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
            >
              {t.confirm}
            </button>
          </div>
        </div>
      }
    >
      <div data-inspection-plan-editor="true" className="space-y-3">
        {groupProfilesByLayer(INSPECTION_PROFILE_DEFINITIONS).map(({ layer, profiles }) => {
          const selectedInLayer = profiles.filter(
            (profile) => (draftProfiles[profile.id]?.size ?? 0) > 0,
          ).length;

          return (
            <details
              key={layer}
              open
              data-inspection-plan-editor-layer={layer}
              className="rounded-xl border border-border-black bg-element-bg"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30">
                <div className="flex min-w-0 items-center gap-2">
                  <ChevronDown className="h-3.5 w-3.5 text-text-tertiary" />
                  <span className="text-[13px] font-semibold text-text-primary">
                    {getInspectionProfileLayerName(layer, lang)}
                  </span>
                </div>
                <span className="rounded-md border border-border-black bg-panel-bg px-2 py-0.5 text-[10px] font-semibold text-text-secondary">
                  {selectedInLayer}/{profiles.length}
                </span>
              </summary>

              <div className="space-y-2 border-t border-border-black p-3">
                {profiles.map((profile) => {
                  const selectedItems = draftProfiles[profile.id] ?? new Set<string>();
                  const summary = profileSummaryById.get(profile.id);
                  const itemSummaries = buildInspectionItemScopeSummaries(
                    profile.id,
                    draftProfiles,
                    recommendedProfiles,
                    (profileId, itemId) =>
                      isInspectionItemApplicable(robot, profileId, itemId, applicabilityOverride),
                  );
                  const itemSummaryById = new Map(
                    itemSummaries.map((itemSummary) => [itemSummary.itemId, itemSummary]),
                  );

                  return (
                    <section
                      key={profile.id}
                      data-inspection-plan-editor-profile={profile.id}
                      className="rounded-xl border border-border-black bg-panel-bg p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-[13px] font-semibold text-text-primary">
                            {getInspectionProfileName(profile.id, lang)}
                          </h3>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-medium text-text-tertiary">
                            <span>{profile.id}</span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {selectedItems.size}/{profile.items.length}
                            </span>
                            {summary && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{getProfileStatusLabel(summary, t)}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          data-inspection-plan-editor-profile-toggle={profile.id}
                          aria-pressed={selectedItems.size > 0}
                          onClick={() => toggleProfile(profile)}
                          className={`shrink-0 rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 ${
                            selectedItems.size > 0
                              ? 'border-system-blue/30 bg-system-blue/10 text-system-blue hover:bg-system-blue/15'
                              : 'border-border-black bg-element-bg text-text-secondary hover:border-system-blue/30 hover:text-system-blue'
                          }`}
                        >
                          {selectedItems.size > 0 ? t.inspectionIncluded : t.inspectionSkipped}
                        </button>
                      </div>

                      <div className="mt-3 grid gap-2 lg:grid-cols-2">
                        {profile.items.map((item) => {
                          const isSelected = selectedItems.has(item.id);
                          const itemSummary = itemSummaryById.get(item.id);
                          const relationLabel = getPlanEditorItemStatusLabel(
                            itemSummary?.relation ?? 'not_recommended',
                            t,
                          );

                          return (
                            <button
                              key={item.id}
                              type="button"
                              data-inspection-plan-editor-item={`${profile.id}:${item.id}`}
                              aria-pressed={isSelected}
                              onClick={() => toggleItem(profile, item.id)}
                              className={`min-w-0 rounded-lg border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 ${
                                isSelected
                                  ? 'border-system-blue/25 bg-system-blue/10 text-text-primary'
                                  : 'border-border-black bg-element-bg text-text-secondary hover:border-system-blue/30'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-[12px] font-semibold">
                                    {lang === 'zh' ? item.nameZh : item.name}
                                  </div>
                                  <div className="mt-1 text-[10px] font-medium text-text-tertiary">
                                    {relationLabel}
                                  </div>
                                </div>
                                {isSelected && (
                                  <Check className="h-3.5 w-3.5 shrink-0 text-system-blue" />
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    </Dialog>
  );
}

export function InspectionSetupView({
  robot,
  lang,
  t,
  override,
  selectedProfiles,
  recommendedProfiles,
  onSelectedProfilesChange,
  onToggleItem,
  onFocusProfile,
  onRestoreRecommendation,
  onRestoreProfileRecommendation,
}: InspectionSetupViewProps) {
  const [isPlanEditorOpen, setIsPlanEditorOpen] = useState(false);
  const [expandedProfileIds, setExpandedProfileIds] = useState<Set<string>>(() => new Set());
  const defaultProfile = INSPECTION_PROFILE_DEFINITIONS[0];
  if (!defaultProfile) {
    return null;
  }

  const totalSelectedCount = INSPECTION_PROFILE_DEFINITIONS.reduce(
    (sum, profile) => sum + (selectedProfiles[profile.id]?.size ?? 0),
    0,
  );
  const selectedProfileCount = INSPECTION_PROFILE_DEFINITIONS.filter(
    (profile) => (selectedProfiles[profile.id]?.size ?? 0) > 0,
  ).length;
  const profileSummaries = buildInspectionProfileScopeSummaries(
    selectedProfiles,
    recommendedProfiles,
  );
  const deviation = buildInspectionSelectionDeviation(selectedProfiles, recommendedProfiles);
  const deviationSummary = t.inspectionRecommendationDeviationSummary.replace(
    '{count}',
    String(deviation.totalChangedItemCount),
  );
  const currentProfileSummaries = profileSummaries.filter(
    (summary) => summary.selectedItemCount > 0,
  );
  const currentProfileSummaryGroups = PROFILE_LAYER_ORDER.map((layer) => ({
    layer,
    summaries: currentProfileSummaries.filter((summary) => summary.layer === layer),
  })).filter((group) => group.summaries.length > 0);
  const handleConfirmPlanEditor = (nextProfiles: SelectedInspectionProfiles) => {
    onSelectedProfilesChange(nextProfiles);
    onFocusProfile(
      INSPECTION_PROFILE_DEFINITIONS.find((profile) => (nextProfiles[profile.id]?.size ?? 0) > 0)
        ?.id ?? defaultProfile.id,
    );
    setIsPlanEditorOpen(false);
  };
  const handleRestoreCurrentPlan = () => {
    onRestoreRecommendation();
    setIsPlanEditorOpen(false);
  };
  const selectedProfileSummaryText = `${selectedProfileCount}/${INSPECTION_PROFILE_DEFINITIONS.length}`;
  const hasCurrentProfiles = currentProfileSummaries.length > 0;
  const currentPlanLayerCount = currentProfileSummaryGroups.length;
  const currentPlanLayerSummary = currentPlanLayerCount > 0 ? `${currentPlanLayerCount}` : '0';
  const applicabilityOverride = {
    sourceFormat: override.sourceFormat,
    robotTypes: override.robotType ? [override.robotType] : undefined,
  };

  return (
    <section
      data-inspection-review-details="true"
      className="flex flex-none flex-col gap-4"
    >
      <section
        className="flex flex-none flex-col rounded-2xl border border-border-black bg-panel-bg shadow-sm"
      >
        <div className="flex flex-col gap-3 border-b border-border-black px-4 py-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-text-primary">
                {t.inspectionPlanOrchestration}
              </h2>
              {deviation.totalChangedItemCount > 0 && (
                <span
                  data-inspection-current-plan-custom-state="true"
                  className="rounded-md border border-warning-border bg-warning-soft px-2 py-0.5 text-[10px] font-semibold text-warning"
                >
                  {deviationSummary}
                </span>
              )}
            </div>
            <p className="mt-1 text-[12px] leading-5 text-text-secondary">
              {t.inspectionPlanOrchestrationDescription}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              data-inspection-current-plan-edit
              onClick={() => setIsPlanEditorOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-black bg-element-bg px-3 text-[11px] font-semibold text-text-secondary transition-colors hover:bg-element-hover hover:text-system-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
            >
              <Edit3 className="h-3.5 w-3.5" />
              {t.edit}
            </button>
            <button
              type="button"
              onClick={handleRestoreCurrentPlan}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-system-blue/25 bg-element-bg px-3 text-[11px] font-semibold text-system-blue transition-colors hover:bg-system-blue/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t.inspectionRestoreBaseline}
            </button>
          </div>
        </div>

        <div
          data-inspection-current-plan-viewport="true"
          className="p-4"
        >
          <section
            data-inspection-current-plan="true"
            className="flex min-h-0 flex-col rounded-xl border border-border-black bg-element-bg p-3"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-text-primary">
                  {t.inspectionCurrentPlan}
                </h3>
                <p className="mt-1 text-[11px] leading-4 text-text-tertiary">
                  {t.inspectionCurrentPlanDescription}
                </p>
              </div>
              <span className="rounded-md border border-system-blue/20 bg-system-blue/10 px-2 py-0.5 text-[10px] font-semibold text-system-blue">
                {selectedProfileSummaryText}
              </span>
            </div>
            <div className="mb-3 flex flex-wrap gap-2 text-[10px] font-medium text-text-tertiary">
              <span className="rounded-md border border-border-black bg-panel-bg px-2 py-0.5">
                {t.inspectionSelectedChecks.replace('{count}', String(totalSelectedCount))}
              </span>
              <span className="rounded-md border border-border-black bg-panel-bg px-2 py-0.5">
                {t.inspectionSelectedCategories}: {selectedProfileCount}
              </span>
              <span className="rounded-md border border-border-black bg-panel-bg px-2 py-0.5">
                {t.inspectionPlanLayers}: {currentPlanLayerSummary}
              </span>
            </div>
            <div
              data-inspection-current-plan-scroll="true"
              className="pr-1"
            >
              {hasCurrentProfiles ? (
                <div className="space-y-3">
                  {currentProfileSummaryGroups.map(({ layer, summaries }) => (
                    <section
                      key={layer}
                      data-inspection-current-plan-layer={layer}
                      className="rounded-xl border border-border-black bg-panel-bg p-2"
                    >
                      <div
                        data-inspection-current-plan-layer-header={layer}
                        className="mb-2 px-1"
                      >
                        <h4 className="truncate text-[12px] font-semibold text-text-primary">
                          {getInspectionProfileLayerName(layer, lang)}
                        </h4>
                      </div>
                      <div className="grid gap-2">
                        {summaries.map((summary) => {
                          const isCustom =
                            summary.relation === 'partial' ||
                            summary.relation === 'user_added' ||
                            summary.relation === 'user_removed';
                          const isExpanded = expandedProfileIds.has(summary.profileId);
                          const profile = INSPECTION_PROFILE_DEFINITIONS.find(
                            (candidate) => candidate.id === summary.profileId,
                          );
                          const selectedItems = selectedProfiles[summary.profileId] ?? new Set();
                          if (!profile) return null;

                          return (
                            <section
                              key={summary.profileId}
                              data-inspection-current-plan-profile={summary.profileId}
                              className={`overflow-hidden rounded-xl border transition-colors ${
                                isExpanded
                                  ? 'border-system-blue/40 bg-system-blue/5 shadow-sm'
                                  : isCustom
                                    ? 'border-warning-border bg-warning-soft'
                                    : 'border-border-black bg-element-bg'
                              }`}
                            >
                              <button
                                type="button"
                                data-inspection-current-plan-profile-toggle={summary.profileId}
                                aria-expanded={isExpanded}
                                onClick={() => {
                                  setExpandedProfileIds((current) => {
                                    const next = new Set(current);
                                    if (next.has(summary.profileId)) {
                                      next.delete(summary.profileId);
                                    } else {
                                      next.add(summary.profileId);
                                    }
                                    return next;
                                  });
                                  if (!isExpanded) onFocusProfile(summary.profileId);
                                }}
                                className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-system-blue/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-system-blue/30"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-[12px] font-semibold text-text-primary">
                                    {getInspectionProfileName(summary.profileId, lang)}
                                  </div>
                                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-medium text-text-tertiary">
                                    <span>{getInspectionProfileLayerName(summary.layer, lang)}</span>
                                    <span aria-hidden="true">•</span>
                                    <span>
                                      {summary.selectedItemCount}/{summary.totalItemCount}
                                    </span>
                                    <span aria-hidden="true">•</span>
                                    <span>{getProfileStatusLabel(summary, t)}</span>
                                  </div>
                                </div>
                                <ChevronDown
                                  aria-hidden="true"
                                  className={`h-4 w-4 shrink-0 text-text-tertiary transition-transform ${
                                    isExpanded ? 'rotate-180 text-system-blue' : ''
                                  }`}
                                />
                              </button>

                              {isExpanded && (
                                <div
                                  data-inspection-current-plan-profile-details={summary.profileId}
                                  className="border-t border-border-black p-3"
                                >
                                  <div className="mb-3 flex justify-end">
                                    <button
                                      type="button"
                                      onClick={() => onRestoreProfileRecommendation(summary.profileId)}
                                      className="h-7 rounded-lg border border-system-blue/25 bg-panel-bg px-2 text-[11px] font-semibold text-system-blue transition-colors hover:bg-system-blue/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
                                    >
                                      {t.inspectionRestoreProfileRecommendation}
                                    </button>
                                  </div>
                                  <div className="grid gap-3 lg:grid-cols-2">
                                    {profile.items.map((item) => {
                                      const isSelected = selectedItems.has(item.id);
                                      const itemName = lang === 'zh' ? item.nameZh : item.name;
                                      const itemDescription =
                                        lang === 'zh' ? item.descriptionZh : item.description;

                                      return (
                                        <button
                                          type="button"
                                          key={item.id}
                                          data-inspection-setup-item-anchor={`${profile.id}:${item.id}`}
                                          data-inspection-setup-item-badge={`${profile.id}:${item.id}`}
                                          aria-pressed={isSelected}
                                          onClick={() => onToggleItem(profile.id, item.id)}
                                          className={`w-full rounded-xl border p-3 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 ${
                                            isSelected
                                              ? 'border-system-blue/25 bg-panel-bg hover:border-system-blue/40 hover:bg-system-blue/5'
                                              : 'border-border-black bg-panel-bg/70 hover:border-system-blue/30 hover:bg-element-hover'
                                          }`}
                                        >
                                          <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                              <h5 className="text-sm font-semibold text-text-primary">
                                                {itemName}
                                              </h5>
                                            </div>
                                            <span
                                              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-semibold transition-colors ${
                                                isSelected
                                                  ? 'border-system-blue/30 bg-system-blue/10 text-system-blue hover:bg-system-blue/15'
                                                  : 'border-border-black bg-panel-bg text-text-tertiary hover:border-system-blue/30 hover:text-text-secondary'
                                              }`}
                                            >
                                              <span
                                                aria-hidden="true"
                                                className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded border ${
                                                  isSelected
                                                    ? 'border-system-blue bg-system-blue text-white'
                                                    : 'border-border-black bg-panel-bg'
                                                }`}
                                              >
                                                {isSelected && <Check className="h-2.5 w-2.5" />}
                                              </span>
                                              {isSelected
                                                ? t.inspectionIncluded
                                                : t.inspectionSkipped}
                                            </span>
                                          </div>
                                          <p className="mt-2 text-[12px] leading-5 text-text-secondary">
                                            {itemDescription}
                                          </p>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </section>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-danger-border bg-danger-soft px-3 py-2 text-[12px] text-danger">
                  {t.inspectionNoChecksSelected}
                </div>
              )}
            </div>
          </section>

        </div>
      </section>

      <InspectionPlanEditorDialog
        isOpen={isPlanEditorOpen}
        robot={robot}
        lang={lang}
        t={t}
        selectedProfiles={selectedProfiles}
        recommendedProfiles={recommendedProfiles}
        applicabilityOverride={applicabilityOverride}
        onClose={() => setIsPlanEditorOpen(false)}
        onConfirm={handleConfirmPlanEditor}
      />
    </section>
  );
}

export default InspectionSetupView;
