import { PanelSelect, type SelectOption } from '@/shared/components/ui';
import { JointType } from '@/types';
import { BridgeInlineFieldRow } from './BridgeCreateFields';
import { BRIDGE_PANEL_SELECT_CLASS, BRIDGE_SELECT_CLASS } from './bridgeCreateModalStyles';

interface BridgeIdentityFieldsProps {
  nameInputId: string;
  jointTypeSelectId: string;
  nameLabel: string;
  typeLabel: string;
  name: string;
  namePlaceholder: string;
  suggestedName: string;
  jointType: JointType;
  jointTypeOptions: SelectOption[];
  compactLabelWidthClassName: string;
  usesInlineIdentityRow: boolean;
  topFieldGridClassName: string;
  onNameChange: (name: string) => void;
  onNameBlur: (suggestedName: string) => void;
  onJointTypeChange: (jointType: JointType) => void;
}

export function BridgeIdentityFields({
  nameInputId,
  jointTypeSelectId,
  nameLabel,
  typeLabel,
  name,
  namePlaceholder,
  suggestedName,
  jointType,
  jointTypeOptions,
  compactLabelWidthClassName,
  usesInlineIdentityRow,
  topFieldGridClassName,
  onNameChange,
  onNameBlur,
  onJointTypeChange,
}: BridgeIdentityFieldsProps) {
  const rowLayout = usesInlineIdentityRow ? 'contents' : 'row';

  return (
    <div data-bridge-row="identity" className={topFieldGridClassName}>
      <BridgeInlineFieldRow
        label={nameLabel}
        htmlFor={nameInputId}
        fieldKey="name"
        className="min-w-0"
        labelClassName={compactLabelWidthClassName}
        layout={rowLayout}
      >
        <input
          id={nameInputId}
          type="text"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          onBlur={() => onNameBlur(suggestedName)}
          placeholder={namePlaceholder}
          className={BRIDGE_SELECT_CLASS}
        />
      </BridgeInlineFieldRow>

      <BridgeInlineFieldRow
        label={typeLabel}
        htmlFor={jointTypeSelectId}
        fieldKey="type"
        className="min-w-0"
        labelClassName={compactLabelWidthClassName}
        layout={rowLayout}
      >
        <PanelSelect
          variant="property"
          id={jointTypeSelectId}
          options={jointTypeOptions}
          value={jointType}
          onChange={(event) => onJointTypeChange(event.target.value as JointType)}
          className={BRIDGE_PANEL_SELECT_CLASS}
        />
      </BridgeInlineFieldRow>
    </div>
  );
}
