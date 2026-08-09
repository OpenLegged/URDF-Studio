import { CompactSwitch, PanelSegmentedControl, PanelSelect } from '@/shared/components/ui';
import {
  type SnapshotAspectRatioPreset,
  type SnapshotCaptureOptions,
} from '@/shared/components/3d/scene/snapshotConfig';
import type { TranslationKeys } from '@/shared/i18n';

import type { SnapshotCaptureChoiceModel } from './snapshotCaptureForm';

const PANEL_SECTION_CLASS_NAME =
  'rounded-lg border border-border-black bg-panel-bg px-2.5 py-1.5 shadow-sm';
const FIELD_ROW_CLASS_NAME = 'grid grid-cols-[68px_minmax(0,1fr)] items-center gap-1.5';
const FIELD_LABEL_CLASS_NAME = 'truncate text-[9px] font-medium text-text-secondary';
const SNAPSHOT_SEGMENTED_CLASS_NAME = 'w-full !min-h-[24px] !rounded-md';
const SNAPSHOT_SEGMENTED_ITEM_CLASS_NAME = '!h-[21px] px-1.5 text-[10px]';

interface SnapshotSettingsPaneProps {
  t: TranslationKeys;
  isCapturing: boolean;
  isCompactLayout: boolean;
  options: SnapshotCaptureOptions;
  resolutionPreset: string;
  compressionControlValue: number;
  supportsLossyCompression: boolean;
  choiceModel: SnapshotCaptureChoiceModel;
  updateOptions: (patch: Partial<SnapshotCaptureOptions>) => void;
}

function SnapshotSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={PANEL_SECTION_CLASS_NAME}>
      <div className="mb-1 text-[9px] font-semibold text-text-tertiary">{title}</div>
      {children}
    </div>
  );
}

function SnapshotField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={FIELD_ROW_CLASS_NAME}>
      <div className={FIELD_LABEL_CLASS_NAME}>{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function SnapshotSettingsPane({
  t,
  isCapturing,
  isCompactLayout,
  options,
  resolutionPreset,
  compressionControlValue,
  supportsLossyCompression,
  choiceModel,
  updateOptions,
}: SnapshotSettingsPaneProps) {
  const {
    aspectRatioPreset,
    backgroundStyle,
    detailLevel,
    environmentPreset,
    groundStyle,
    hideGrid,
    imageFormat,
    shadowStyle,
  } = options;
  const {
    antialiasOptions,
    aspectRatioOptions,
    backgroundOptions,
    compactLabels,
    compressionOptions,
    environmentOptions,
    formatOptions,
    groundOptions,
    resolutionOptions,
    shadowOptions,
  } = choiceModel;
  const settingsGridClassName = isCompactLayout
    ? 'grid grid-cols-1 gap-y-1'
    : 'grid grid-cols-2 gap-x-2.5 gap-y-1';

  return (
    <>
      <SnapshotSection title={compactLabels.output}>
        <div className={settingsGridClassName}>
          <SnapshotField label={compactLabels.resolution}>
            <PanelSelect
              variant="snapshot"
              value={resolutionPreset}
              options={resolutionOptions}
              disabled={isCapturing}
              onChange={(event) => updateOptions({ longEdgePx: Number(event.target.value) })}
            />
          </SnapshotField>
          <SnapshotField label={compactLabels.aspect}>
            <PanelSelect
              variant="snapshot"
              value={aspectRatioPreset}
              options={aspectRatioOptions}
              disabled={isCapturing}
              onChange={(event) =>
                updateOptions({
                  aspectRatioPreset: event.target.value as SnapshotAspectRatioPreset,
                })
              }
            />
          </SnapshotField>
          <SnapshotField label={compactLabels.format}>
            <PanelSelect
              variant="snapshot"
              value={imageFormat}
              options={formatOptions}
              disabled={isCapturing}
              onChange={(event) =>
                updateOptions({
                  imageFormat: event.target.value as SnapshotCaptureOptions['imageFormat'],
                })
              }
            />
          </SnapshotField>
          <SnapshotField label={compactLabels.aa}>
            <PanelSegmentedControl
              value={detailLevel}
              options={antialiasOptions}
              disabled={isCapturing}
              className={SNAPSHOT_SEGMENTED_CLASS_NAME}
              itemClassName={SNAPSHOT_SEGMENTED_ITEM_CLASS_NAME}
              stretch
              onChange={(value) =>
                updateOptions({
                  detailLevel: value as SnapshotCaptureOptions['detailLevel'],
                })
              }
            />
          </SnapshotField>
          <SnapshotField label={compactLabels.quality}>
            <PanelSegmentedControl
              value={compressionControlValue}
              options={compressionOptions}
              disabled={isCapturing}
              className={SNAPSHOT_SEGMENTED_CLASS_NAME}
              itemClassName={SNAPSHOT_SEGMENTED_ITEM_CLASS_NAME}
              stretch
              onChange={(value) => {
                if (typeof value !== 'number') {
                  return;
                }
                if (supportsLossyCompression) {
                  updateOptions({ imageQuality: value });
                } else {
                  updateOptions({
                    pngOptimizeLevel: value as SnapshotCaptureOptions['pngOptimizeLevel'],
                  });
                }
              }}
            />
          </SnapshotField>
        </div>
      </SnapshotSection>

      <SnapshotSection title={compactLabels.scene}>
        <div className={settingsGridClassName}>
          <SnapshotField label={compactLabels.lighting}>
            <PanelSelect
              variant="snapshot"
              value={environmentPreset}
              options={environmentOptions}
              disabled={isCapturing}
              onChange={(event) =>
                updateOptions({
                  environmentPreset: event.target
                    .value as SnapshotCaptureOptions['environmentPreset'],
                })
              }
            />
          </SnapshotField>
          <SnapshotField label={compactLabels.background}>
            <PanelSelect
              variant="snapshot"
              value={backgroundStyle}
              options={backgroundOptions}
              disabled={isCapturing}
              onChange={(event) =>
                updateOptions({
                  backgroundStyle: event.target.value as SnapshotCaptureOptions['backgroundStyle'],
                })
              }
            />
          </SnapshotField>
          <SnapshotField label={compactLabels.shadow}>
            <PanelSelect
              variant="snapshot"
              value={shadowStyle}
              options={shadowOptions}
              disabled={isCapturing}
              onChange={(event) =>
                updateOptions({
                  shadowStyle: event.target.value as SnapshotCaptureOptions['shadowStyle'],
                })
              }
            />
          </SnapshotField>
          <SnapshotField label={compactLabels.ground}>
            <PanelSelect
              variant="snapshot"
              value={groundStyle}
              options={groundOptions}
              disabled={isCapturing}
              onChange={(event) =>
                updateOptions({
                  groundStyle: event.target.value as SnapshotCaptureOptions['groundStyle'],
                })
              }
            />
          </SnapshotField>
          <SnapshotField label={compactLabels.grid}>
            <CompactSwitch
              checked={!hideGrid}
              onChange={(checked) => updateOptions({ hideGrid: !checked })}
              disabled={isCapturing}
              ariaLabel={t.snapshotHideGrid}
              className="w-full justify-start"
            />
          </SnapshotField>
        </div>
      </SnapshotSection>
    </>
  );
}
