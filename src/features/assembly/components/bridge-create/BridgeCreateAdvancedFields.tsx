import type { TranslationKeys } from '@/shared/i18n';
import { SegmentedControl } from '@/shared/components/ui';
import type { JointQuaternion } from '@/types';
import {
  BridgeAxisSpinnerField,
  BridgeQuickRotateButtonGroup,
  BridgeSection,
  BridgeSpinnerField,
} from './BridgeCreateFields';
import type { BridgeEulerAxisKey, BridgeRotationDisplayMode } from './bridgeCreateModalTypes';

export interface BridgeRotationAxisField {
  key: BridgeEulerAxisKey;
  label: string;
  value: number;
  onChange: (value: number) => void;
}

interface BridgeOriginFieldsProps {
  title: string;
  originX: number;
  originY: number;
  originZ: number;
  onOriginXChange: (value: number) => void;
  onOriginYChange: (value: number) => void;
  onOriginZChange: (value: number) => void;
}

export function BridgeOriginFields({
  title,
  originX,
  originY,
  originZ,
  onOriginXChange,
  onOriginYChange,
  onOriginZChange,
}: BridgeOriginFieldsProps) {
  return (
    <BridgeSection title={title}>
      <div data-bridge-row="origin" className="space-y-1">
        <BridgeAxisSpinnerField
          axis="x"
          fieldKey="origin-x"
          label="X"
          value={originX}
          step={0.01}
          precision={4}
          onChange={onOriginXChange}
          className="min-w-0"
        />
        <BridgeAxisSpinnerField
          axis="y"
          fieldKey="origin-y"
          label="Y"
          value={originY}
          step={0.01}
          precision={4}
          onChange={onOriginYChange}
          className="min-w-0"
        />
        <BridgeAxisSpinnerField
          axis="z"
          fieldKey="origin-z"
          label="Z"
          value={originZ}
          step={0.01}
          precision={4}
          onChange={onOriginZChange}
          className="min-w-0"
        />
      </div>
    </BridgeSection>
  );
}

interface BridgeRotationFieldsProps {
  t: TranslationKeys;
  rotationDisplayMode: BridgeRotationDisplayMode;
  setRotationDisplayMode: (mode: BridgeRotationDisplayMode) => void;
  usesCadInspectorLayout: boolean;
  quaternionFieldGridClassName: string;
  eulerFieldGridClassName: string;
  quaternion: JointQuaternion;
  applyQuaternionRotation: (quaternion: JointQuaternion) => void;
  rotationAxisFields: BridgeRotationAxisField[];
  quickRotateAriaLabelSuffix: { decrease: string; increase: string };
  quickRotateButtonText: { decrease: string; increase: string };
  handleQuickRotate: (axis: BridgeEulerAxisKey, direction: -1 | 1) => void;
}

export function BridgeRotationFields({
  t,
  rotationDisplayMode,
  setRotationDisplayMode,
  usesCadInspectorLayout,
  quaternionFieldGridClassName,
  eulerFieldGridClassName,
  quaternion,
  applyQuaternionRotation,
  rotationAxisFields,
  quickRotateAriaLabelSuffix,
  quickRotateButtonText,
  handleQuickRotate,
}: BridgeRotationFieldsProps) {
  return (
    <BridgeSection title={t.rotation}>
      <SegmentedControl
        options={[
          { value: 'euler_deg', label: t.eulerDegrees },
          { value: 'euler_rad', label: t.eulerRadians },
          { value: 'quaternion', label: t.quaternion },
        ]}
        value={rotationDisplayMode}
        onChange={setRotationDisplayMode}
        size="xs"
        className="w-full [&>button]:min-h-6 [&>button]:flex-1 [&>button]:!gap-0.5 [&>button]:!px-1.5 [&>button]:!py-0 [&>button]:!text-[9px]"
      />

      {rotationDisplayMode === 'quaternion' ? (
        <div className={`mt-1.5 ${quaternionFieldGridClassName}`}>
          <BridgeSpinnerField
            fieldKey="quat-x"
            label="X"
            value={quaternion.x}
            step={0.001}
            precision={4}
            onChange={(value) => applyQuaternionRotation({ ...quaternion, x: value })}
            className="min-w-0"
          />
          <BridgeSpinnerField
            fieldKey="quat-y"
            label="Y"
            value={quaternion.y}
            step={0.001}
            precision={4}
            onChange={(value) => applyQuaternionRotation({ ...quaternion, y: value })}
            className="min-w-0"
          />
          <BridgeSpinnerField
            fieldKey="quat-z"
            label="Z"
            value={quaternion.z}
            step={0.001}
            precision={4}
            onChange={(value) => applyQuaternionRotation({ ...quaternion, z: value })}
            className="min-w-0"
          />
          <BridgeSpinnerField
            fieldKey="quat-w"
            label="W"
            value={quaternion.w}
            step={0.001}
            precision={4}
            onChange={(value) => applyQuaternionRotation({ ...quaternion, w: value })}
            className="min-w-0"
          />
        </div>
      ) : usesCadInspectorLayout ? (
        <div className={`mt-1.5 ${eulerFieldGridClassName}`}>
          {rotationAxisFields.map((field) => (
            <div key={field.key} className="min-w-0 space-y-1">
              <BridgeSpinnerField
                fieldKey={`rot-${field.key}`}
                label={field.label}
                value={field.value}
                step={rotationDisplayMode === 'euler_rad' ? 0.1 : 1}
                precision={rotationDisplayMode === 'euler_rad' ? 4 : 2}
                onChange={field.onChange}
                className="min-w-0"
              />
              <BridgeQuickRotateButtonGroup
                label={field.label}
                decreaseLabel={quickRotateAriaLabelSuffix.decrease}
                increaseLabel={quickRotateAriaLabelSuffix.increase}
                decreaseText={quickRotateButtonText.decrease}
                increaseText={quickRotateButtonText.increase}
                onDecrease={() => handleQuickRotate(field.key, -1)}
                onIncrease={() => handleQuickRotate(field.key, 1)}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-1.5 space-y-1">
          {rotationAxisFields.map((field) => (
            <div
              key={field.key}
              className="grid grid-cols-[minmax(0,1fr)_3.5rem] items-center gap-1"
            >
              <BridgeSpinnerField
                inline
                label={field.label}
                value={field.value}
                step={rotationDisplayMode === 'euler_rad' ? 0.1 : 1}
                precision={rotationDisplayMode === 'euler_rad' ? 4 : 2}
                onChange={field.onChange}
                className="gap-1.5"
                labelClassName="w-[34px]"
              />
              <BridgeQuickRotateButtonGroup
                label={field.label}
                decreaseLabel={quickRotateAriaLabelSuffix.decrease}
                increaseLabel={quickRotateAriaLabelSuffix.increase}
                decreaseText={quickRotateButtonText.decrease}
                increaseText={quickRotateButtonText.increase}
                onDecrease={() => handleQuickRotate(field.key, -1)}
                onIncrease={() => handleQuickRotate(field.key, 1)}
              />
            </div>
          ))}
        </div>
      )}
    </BridgeSection>
  );
}

interface BridgeJointFieldsProps {
  t: TranslationKeys;
  axisX: number;
  axisY: number;
  axisZ: number;
  setAxisX: (value: number) => void;
  setAxisY: (value: number) => void;
  setAxisZ: (value: number) => void;
  axisLabelWidthClassName: string;
  jointSupportsPositionLimits: boolean;
  usesCadInspectorLayout: boolean;
  limitsGridClassName: string;
  positionLowerLabel: string;
  positionUpperLabel: string;
  limitLower: number;
  limitUpper: number;
  limitEffort: number;
  limitVelocity: number;
  setLimitLower: (value: number) => void;
  setLimitUpper: (value: number) => void;
  setLimitEffort: (value: number) => void;
  setLimitVelocity: (value: number) => void;
  compactPositionLimitLabelClassName: string;
  compactLimitLabelClassName: string;
}

export function BridgeJointFields({
  t,
  axisX,
  axisY,
  axisZ,
  setAxisX,
  setAxisY,
  setAxisZ,
  axisLabelWidthClassName,
  jointSupportsPositionLimits,
  usesCadInspectorLayout,
  limitsGridClassName,
  positionLowerLabel,
  positionUpperLabel,
  limitLower,
  limitUpper,
  limitEffort,
  limitVelocity,
  setLimitLower,
  setLimitUpper,
  setLimitEffort,
  setLimitVelocity,
  compactPositionLimitLabelClassName,
  compactLimitLabelClassName,
}: BridgeJointFieldsProps) {
  return (
    <>
      <BridgeSection
        title={t.axisRotation}
        collapsible
        collapsedSummary={`(${axisX}, ${axisY}, ${axisZ})`}
      >
        <div data-bridge-row="axis" className="space-y-1">
          <BridgeSpinnerField
            inline
            fieldKey="axis-x"
            label="X"
            value={axisX}
            step={0.01}
            precision={4}
            onChange={setAxisX}
            className="min-w-0"
            labelClassName={axisLabelWidthClassName}
          />
          <BridgeSpinnerField
            inline
            fieldKey="axis-y"
            label="Y"
            value={axisY}
            step={0.01}
            precision={4}
            onChange={setAxisY}
            className="min-w-0"
            labelClassName={axisLabelWidthClassName}
          />
          <BridgeSpinnerField
            inline
            fieldKey="axis-z"
            label="Z"
            value={axisZ}
            step={0.01}
            precision={4}
            onChange={setAxisZ}
            className="min-w-0"
            labelClassName={axisLabelWidthClassName}
          />
        </div>
      </BridgeSection>

      <BridgeSection
        title={t.limits}
        collapsible
        collapsedSummary={
          jointSupportsPositionLimits
            ? `[${limitLower}, ${limitUpper}]`
            : `E=${limitEffort} V=${limitVelocity}`
        }
      >
        <div className={limitsGridClassName}>
          {jointSupportsPositionLimits && usesCadInspectorLayout ? (
            <>
              <BridgeSpinnerField
                fieldKey="limit-lower"
                label={positionLowerLabel}
                value={limitLower}
                step={0.01}
                precision={4}
                onChange={setLimitLower}
                className="min-w-0"
              />
              <BridgeSpinnerField
                fieldKey="limit-upper"
                label={positionUpperLabel}
                value={limitUpper}
                step={0.01}
                precision={4}
                onChange={setLimitUpper}
                className="min-w-0"
              />
            </>
          ) : jointSupportsPositionLimits ? (
            <>
              <BridgeSpinnerField
                inline
                label={positionLowerLabel}
                value={limitLower}
                step={0.01}
                precision={4}
                onChange={setLimitLower}
                className="gap-1.5"
                labelClassName={compactPositionLimitLabelClassName}
              />
              <BridgeSpinnerField
                inline
                label={positionUpperLabel}
                value={limitUpper}
                step={0.01}
                precision={4}
                onChange={setLimitUpper}
                className="gap-1.5"
                labelClassName={compactPositionLimitLabelClassName}
              />
            </>
          ) : null}
          {usesCadInspectorLayout ? (
            <>
              <BridgeSpinnerField
                fieldKey="limit-effort"
                label={t.effort}
                value={limitEffort}
                step={1}
                precision={2}
                min={0}
                onChange={setLimitEffort}
                className="min-w-0"
              />
              <BridgeSpinnerField
                fieldKey="limit-velocity"
                label={t.velocity}
                value={limitVelocity}
                step={0.1}
                precision={3}
                min={0}
                onChange={setLimitVelocity}
                className="min-w-0"
              />
            </>
          ) : (
            <>
              <BridgeSpinnerField
                inline
                label={t.effort}
                value={limitEffort}
                step={1}
                precision={2}
                min={0}
                onChange={setLimitEffort}
                className="gap-1.5"
                labelClassName={compactLimitLabelClassName}
              />
              <BridgeSpinnerField
                inline
                label={t.velocity}
                value={limitVelocity}
                step={0.1}
                precision={3}
                min={0}
                onChange={setLimitVelocity}
                className="gap-1.5"
                labelClassName={compactLimitLabelClassName}
              />
            </>
          )}
        </div>
      </BridgeSection>
    </>
  );
}
