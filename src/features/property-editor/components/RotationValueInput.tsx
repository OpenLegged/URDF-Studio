import React, { useEffect, useMemo, useState } from 'react';
import { SegmentedControl } from '@/shared/components/ui';
import { useUIStore, type Language } from '@/store/uiStore';
import { translations } from '@/shared/i18n';
import { MAX_PROPERTY_DECIMALS } from '@/core/utils/numberPrecision';
import {
  AxisNumberGridInput,
  InlineNumberInput,
  PROPERTY_EDITOR_INLINE_AXIS_LABEL_CLASS,
  PROPERTY_EDITOR_SUBLABEL_CLASS,
} from './FormControls';
import {
  eulerDegreesToRadians,
  eulerRadiansToDegrees,
  eulerRadiansToQuaternion,
  formatRadiansForDisplay,
  normalizeQuaternionValue,
  parseRadiansDisplayValue,
  quaternionToEulerRadians,
  type EulerRadiansValue,
  type QuaternionValue,
} from '../utils/rotationFormat';

const DEGREE_STEP = 1;
// 度数最多保留 6 位小数(与长宽高/位置一致):显示与提交均支持 6 位精度并去掉尾随 0
const DEGREE_PRECISION = 6;
const RADIAN_STEP = 0.1;
const RADIAN_PRECISION = 4;
const QUATERNION_STEP = 0.001;
const QUATERNION_PRECISION = 4;
const FULL_ROTATION_DEGREES = 360;
const HALF_ROTATION_DEGREES = 180;

const formatTemplateValue = (template: string, value: string): string =>
  template.replace('{value}', value);

type EulerAxisKey = keyof EulerRadiansValue;

interface QuickRotateAction {
  buttonLabel: string;
  ariaLabelSuffix: string;
  deltaRadians: number;
}

interface QuickRotateAxisOption {
  key: EulerAxisKey;
  label: string;
  axisLabel: string;
  hasQuickStep: boolean;
  badgeClassName: string;
  accentTextClassName: string;
  buttonClassName: string;
}

interface QuaternionAxisOption {
  key: keyof QuaternionValue;
  label: string;
}

function normalizeDegreesAngle(value: number): number {
  let normalized =
    ((value % FULL_ROTATION_DEGREES) + FULL_ROTATION_DEGREES) % FULL_ROTATION_DEGREES;
  if (normalized > HALF_ROTATION_DEGREES) {
    normalized -= FULL_ROTATION_DEGREES;
  }
  return Object.is(normalized, -0) ? 0 : normalized;
}

function normalizeRadiansAngle(value: number): number {
  const fullRotationRadians = Math.PI * 2;
  let normalized = ((value % fullRotationRadians) + fullRotationRadians) % fullRotationRadians;
  if (normalized > Math.PI) {
    normalized -= fullRotationRadians;
  }
  return Object.is(normalized, -0) ? 0 : normalized;
}

interface RotationValueInputProps {
  value: EulerRadiansValue;
  onChange: (nextValue: EulerRadiansValue) => void;
  lang: Language;
  label?: string;
  showLabel?: boolean;
  showFrameHint?: boolean;
  compact?: boolean;
  axisLabelPlacement?: 'stacked' | 'inline';
  holdRepeatIntervalMs?: number;
  quickStepDegrees?: number;
  quickStepAxes?: Array<keyof EulerRadiansValue>;
}

export const RotationValueInput: React.FC<RotationValueInputProps> = ({
  value,
  onChange,
  lang,
  label,
  showLabel = true,
  showFrameHint = true,
  compact = false,
  axisLabelPlacement = 'inline',
  holdRepeatIntervalMs,
  quickStepDegrees,
  quickStepAxes = ['r', 'p', 'y'],
}) => {
  const t = translations[lang];
  const rotationDisplayMode = useUIStore((state) => state.rotationDisplayMode);
  const setRotationDisplayMode = useUIStore((state) => state.setRotationDisplayMode);
  const displayEulerRadians = useMemo(() => value, [value.p, value.r, value.y]);

  const eulerDegrees = useMemo(
    () => eulerRadiansToDegrees(displayEulerRadians),
    [displayEulerRadians.p, displayEulerRadians.r, displayEulerRadians.y],
  );

  const [quaternionValue, setQuaternionValue] = useState<QuaternionValue>(() =>
    eulerRadiansToQuaternion(value),
  );

  useEffect(() => {
    setQuaternionValue(eulerRadiansToQuaternion(value));
  }, [value.p, value.r, value.y]);

  const handleDegreeChange = (nextValue: Partial<EulerRadiansValue>) => {
    onChange(
      eulerDegreesToRadians({
        r: nextValue.r ?? eulerDegrees.r,
        p: nextValue.p ?? eulerDegrees.p,
        y: nextValue.y ?? eulerDegrees.y,
      }),
    );
  };

  const handleQuaternionChange = (nextValue: Partial<QuaternionValue>) => {
    const normalizedQuaternion = normalizeQuaternionValue({
      x: nextValue.x ?? quaternionValue.x,
      y: nextValue.y ?? quaternionValue.y,
      z: nextValue.z ?? quaternionValue.z,
      w: nextValue.w ?? quaternionValue.w,
    });

    setQuaternionValue(normalizedQuaternion);
    onChange(quaternionToEulerRadians(normalizedQuaternion));
  };

  const quickRotateAxisOptions: QuickRotateAxisOption[] = [
    {
      key: 'r',
      label: t.roll,
      axisLabel: 'X',
      hasQuickStep: quickStepDegrees !== undefined && quickStepAxes.includes('r'),
      badgeClassName: 'border-danger-border/40 bg-danger-soft/35',
      accentTextClassName: 'text-danger-hover',
      buttonClassName: 'hover:text-danger-hover focus-visible:ring-danger/20',
    },
    {
      key: 'p',
      label: t.pitch,
      axisLabel: 'Y',
      hasQuickStep: quickStepDegrees !== undefined && quickStepAxes.includes('p'),
      badgeClassName:
        'border-emerald-200/60 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20',
      accentTextClassName: 'text-emerald-700 dark:text-emerald-300',
      buttonClassName:
        'hover:text-emerald-700 dark:hover:text-emerald-300 focus-visible:ring-emerald-400/20',
    },
    {
      key: 'y',
      label: t.yaw,
      axisLabel: 'Z',
      hasQuickStep: quickStepDegrees !== undefined && quickStepAxes.includes('y'),
      badgeClassName: 'border-system-blue/20 bg-system-blue/10',
      accentTextClassName: 'text-system-blue',
      buttonClassName: 'hover:text-system-blue focus-visible:ring-system-blue/20',
    },
  ];
  const quaternionAxisOptions: QuaternionAxisOption[] = [
    { key: 'x', label: 'X' },
    { key: 'y', label: 'Y' },
    { key: 'z', label: 'Z' },
    { key: 'w', label: 'W' },
  ];
  const quickStepRadians =
    quickStepDegrees !== undefined
      ? (quickStepDegrees * Math.PI) / HALF_ROTATION_DEGREES
      : undefined;
  const quickStepRadiansLabel =
    quickStepRadians !== undefined ? formatRadiansForDisplay(quickStepRadians) : null;
  const usesRadianQuickSteps = rotationDisplayMode === 'euler_rad';

  const quickRotateActions: QuickRotateAction[] =
    quickStepDegrees !== undefined
      ? [
          {
            buttonLabel:
              usesRadianQuickSteps && quickStepRadiansLabel
                ? `-${quickStepRadiansLabel}`
                : `-${quickStepDegrees}`,
            ariaLabelSuffix:
              usesRadianQuickSteps && quickStepRadiansLabel
                ? formatTemplateValue(t.decreaseValue, quickStepRadiansLabel)
                : formatTemplateValue(t.decreaseValue, `${quickStepDegrees}°`),
            deltaRadians:
              usesRadianQuickSteps && quickStepRadians !== undefined
                ? -quickStepRadians
                : (-quickStepDegrees * Math.PI) / HALF_ROTATION_DEGREES,
          },
          {
            buttonLabel:
              usesRadianQuickSteps && quickStepRadiansLabel
                ? `+${quickStepRadiansLabel}`
                : `+${quickStepDegrees}`,
            ariaLabelSuffix:
              usesRadianQuickSteps && quickStepRadiansLabel
                ? formatTemplateValue(t.increaseValue, quickStepRadiansLabel)
                : formatTemplateValue(t.increaseValue, `${quickStepDegrees}°`),
            deltaRadians:
              usesRadianQuickSteps && quickStepRadians !== undefined
                ? quickStepRadians
                : (quickStepDegrees * Math.PI) / HALF_ROTATION_DEGREES,
          },
        ]
      : [];

  const shouldRenderQuickRotateRows =
    (rotationDisplayMode === 'euler_deg' || rotationDisplayMode === 'euler_rad') &&
    quickStepDegrees !== undefined;

  const handleQuickRotate = (axis: EulerAxisKey, action: QuickRotateAction) => {
    if (quickStepDegrees === undefined) {
      return;
    }

    if (rotationDisplayMode === 'euler_rad') {
      const nextRadians = normalizeRadiansAngle(displayEulerRadians[axis] + action.deltaRadians);
      onChange({
        r: axis === 'r' ? nextRadians : displayEulerRadians.r,
        p: axis === 'p' ? nextRadians : displayEulerRadians.p,
        y: axis === 'y' ? nextRadians : displayEulerRadians.y,
      });
      return;
    }

    const currentDegrees = eulerDegrees[axis];
    const nextDegrees = normalizeDegreesAngle(
      currentDegrees + (action.deltaRadians * HALF_ROTATION_DEGREES) / Math.PI,
    );

    onChange(
      eulerDegreesToRadians({
        r: axis === 'r' ? nextDegrees : eulerDegrees.r,
        p: axis === 'p' ? nextDegrees : eulerDegrees.p,
        y: axis === 'y' ? nextDegrees : eulerDegrees.y,
      }),
    );
  };

  return (
    <div className="space-y-1">
      {showLabel ? (
        <div className="flex items-center">
          <span className={PROPERTY_EDITOR_SUBLABEL_CLASS}>{label ?? t.rotation}</span>
        </div>
      ) : null}
      <SegmentedControl
        options={[
          { value: 'euler_deg', label: t.eulerDegrees },
          { value: 'euler_rad', label: t.eulerRadians },
          { value: 'quaternion', label: t.quaternion },
        ]}
        value={rotationDisplayMode}
        onChange={setRotationDisplayMode}
        size="xs"
        className="w-full [&>button]:min-h-[22px] [&>button]:flex-1 [&>button]:!gap-0.5 [&>button]:!px-1.5 [&>button]:!py-0 [&>button]:!text-[9px]"
      />
      {showFrameHint ? (
        <div className="text-[9px] leading-4 text-text-tertiary">{t.urdfFrame}</div>
      ) : null}

      {shouldRenderQuickRotateRows ? (
        <div className="space-y-1">
          {quickRotateAxisOptions.map((axis) => (
            <div
              key={axis.key}
              className="flex min-w-0 flex-nowrap items-center gap-1 rounded-lg border border-border-black/70 bg-panel-bg/85 px-1 py-1 transition-colors hover:border-border-strong hover:bg-element-hover"
            >
              <div className="flex min-w-[3.1rem] shrink-0 items-center gap-1">
                <span
                  className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border text-[9px] font-bold ${axis.badgeClassName} ${axis.accentTextClassName}`}
                >
                  {axis.axisLabel}
                </span>
                <span
                  className={`min-w-0 shrink truncate text-[10px] font-semibold ${axis.accentTextClassName}`}
                  title={axis.label}
                >
                  {axis.label}
                </span>
              </div>
              <div className="min-w-0 basis-0 flex-1">
                <InlineNumberInput
                  label={axis.label}
                  value={
                    rotationDisplayMode === 'euler_rad'
                      ? displayEulerRadians[axis.key]
                      : eulerDegrees[axis.key]
                  }
                  onChange={(nextValue) =>
                    rotationDisplayMode === 'euler_rad'
                      ? onChange({
                          r: axis.key === 'r' ? nextValue : displayEulerRadians.r,
                          p: axis.key === 'p' ? nextValue : displayEulerRadians.p,
                          y: axis.key === 'y' ? nextValue : displayEulerRadians.y,
                        })
                      : handleDegreeChange({ [axis.key]: nextValue } as Partial<EulerRadiansValue>)
                  }
                  compact={compact}
                  step={rotationDisplayMode === 'euler_rad' ? RADIAN_STEP : DEGREE_STEP}
                  precision={
                    rotationDisplayMode === 'euler_rad' ? RADIAN_PRECISION : DEGREE_PRECISION
                  }
                  commitPrecision={
                    rotationDisplayMode === 'euler_rad' ? MAX_PROPERTY_DECIMALS : undefined
                  }
                  trimTrailingZeros
                  formatDisplayValue={
                    rotationDisplayMode === 'euler_rad' ? formatRadiansForDisplay : undefined
                  }
                  parseDisplayValue={
                    rotationDisplayMode === 'euler_rad' ? parseRadiansDisplayValue : undefined
                  }
                  repeatIntervalMs={holdRepeatIntervalMs}
                />
              </div>
              {axis.hasQuickStep ? (
                <div className="grid h-[22px] w-[4.5rem] shrink-0 grid-cols-2 overflow-hidden rounded-md border border-border-black/60 bg-element-bg/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  {quickRotateActions.map((action) => (
                    <button
                      key={`${axis.key}-${action.ariaLabelSuffix}`}
                      type="button"
                      onClick={() => handleQuickRotate(axis.key, action)}
                      aria-label={`${axis.label} ${action.ariaLabelSuffix}`}
                      title={`${axis.label} ${action.ariaLabelSuffix}`}
                      className={`inline-flex min-w-0 items-center justify-center px-1 text-[9px] font-semibold leading-none whitespace-nowrap text-text-secondary transition-colors hover:bg-element-hover/80 focus:outline-none focus-visible:ring-2 ${axis.buttonClassName} ${
                        action.deltaRadians > 0 ? 'border-l border-border-black/60' : ''
                      }`}
                    >
                      {action.buttonLabel}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : rotationDisplayMode === 'euler_deg' ? (
        <AxisNumberGridInput
          value={eulerDegrees}
          onChange={handleDegreeChange}
          labels={[t.roll, t.pitch, t.yaw]}
          keys={['r', 'p', 'y'] as const}
          compact={compact}
          labelPlacement={axisLabelPlacement}
          step={DEGREE_STEP}
          precision={DEGREE_PRECISION}
          repeatIntervalMs={holdRepeatIntervalMs}
        />
      ) : rotationDisplayMode === 'euler_rad' ? (
        <AxisNumberGridInput
          value={displayEulerRadians}
          onChange={(nextValue) =>
            onChange({
              r: nextValue.r ?? displayEulerRadians.r,
              p: nextValue.p ?? displayEulerRadians.p,
              y: nextValue.y ?? displayEulerRadians.y,
            })
          }
          labels={[t.roll, t.pitch, t.yaw]}
          keys={['r', 'p', 'y'] as const}
          compact={compact}
          labelPlacement={axisLabelPlacement}
          step={RADIAN_STEP}
          precision={RADIAN_PRECISION}
          commitPrecision={MAX_PROPERTY_DECIMALS}
          formatDisplayValue={formatRadiansForDisplay}
          parseDisplayValue={parseRadiansDisplayValue}
          repeatIntervalMs={holdRepeatIntervalMs}
        />
      ) : axisLabelPlacement === 'inline' ? (
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          {quaternionAxisOptions.map((axis) => (
            <div key={axis.key} className="flex min-w-0 items-center gap-1.5">
              <span
                className={`${PROPERTY_EDITOR_INLINE_AXIS_LABEL_CLASS} min-w-0 w-2 shrink truncate text-center`}
                title={axis.label}
              >
                {axis.label}
              </span>
              <div className="min-w-0 flex-1">
                <InlineNumberInput
                  label={`Quaternion ${axis.label}`}
                  value={quaternionValue[axis.key]}
                  onChange={(nextValue) =>
                    handleQuaternionChange({ [axis.key]: nextValue } as Partial<QuaternionValue>)
                  }
                  compact={compact}
                  step={QUATERNION_STEP}
                  precision={QUATERNION_PRECISION}
                  repeatIntervalMs={holdRepeatIntervalMs}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <AxisNumberGridInput
          value={quaternionValue}
          onChange={(nextValue) => handleQuaternionChange(nextValue)}
          labels={quaternionAxisOptions.map((axis) => axis.label)}
          keys={['x', 'y', 'z', 'w'] as const}
          compact={compact}
          labelPlacement={axisLabelPlacement}
          step={QUATERNION_STEP}
          precision={QUATERNION_PRECISION}
          repeatIntervalMs={holdRepeatIntervalMs}
        />
      )}
    </div>
  );
};
