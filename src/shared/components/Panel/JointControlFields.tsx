import React from 'react';

import type { EditableJointNumberField } from './jointControlFieldTypes';

const MAIN_VALUE_FIELD_WIDTH_CLASS_NAME = 'w-[2.35rem]';
const LIMIT_FIELD_BASE_CLASS_NAME =
  'flex h-4 items-center rounded border px-0.5 py-0 font-mono tabular-nums text-[9px] leading-none transition-colors';
const LIMIT_FIELD_COLUMN_WIDTH_CLASS_NAME = 'min-w-[2.35rem]';
const LIMIT_INPUT_WIDTH_CLASS_NAME = 'w-[2.35rem]';

interface JointValueFieldProps {
  displayValue: number;
  displayUnit: string;
  editor: EditableJointNumberField;
}

export const JointValueField: React.FC<JointValueFieldProps> = ({
  displayValue,
  displayUnit,
  editor,
}) => (
  <div className="flex h-full shrink-0 items-center justify-end gap-0.5 whitespace-nowrap">
    <div
      className={`flex items-center justify-end ${MAIN_VALUE_FIELD_WIDTH_CLASS_NAME}`}
      onClick={(event) => {
        event.stopPropagation();
        editor.beginEditing();
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        editor.beginEditing();
      }}
      role="button"
      tabIndex={-1}
    >
      {editor.isEditing ? (
        <input
          ref={editor.inputRef}
          type="text"
          value={editor.inputValue}
          onChange={(event) => editor.setInputValue(event.target.value)}
          onBlur={(event) => editor.commit(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              editor.commit(event.currentTarget.value);
              event.currentTarget.blur();
            }
          }}
          onClick={(event) => event.stopPropagation()}
          className="h-3.5 w-full rounded border border-border-strong bg-input-bg px-0.5 py-0 text-right text-[9px] leading-none font-mono tabular-nums text-text-primary outline-none focus:border-system-blue focus:ring-1 focus:ring-system-blue/20"
        />
      ) : (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            editor.beginEditing();
          }}
          className="w-full border-0 bg-transparent p-0 text-right"
        >
          <div className="flex h-3.5 w-full items-center justify-end whitespace-nowrap rounded border border-transparent px-0.5 py-0 text-right font-mono tabular-nums text-[9px] leading-none text-text-primary transition-colors hover:border-border-strong/70 hover:text-system-blue">
            {displayValue.toFixed(2)}
          </div>
        </button>
      )}
    </div>
    <span className="inline-flex h-3.5 min-w-[1.1rem] items-center text-left text-[9px] leading-none text-text-tertiary">
      {displayUnit}
    </span>
  </div>
);

function formatLimitDisplayValue(limitValue: number | undefined): string {
  return Number.isFinite(limitValue) ? Number(limitValue).toFixed(2) : '—';
}

interface AdvancedFieldProps {
  symbol: 'τ' | 'v';
  value: number | undefined;
  editor: EditableJointNumberField;
}

const AdvancedField: React.FC<AdvancedFieldProps> = ({ symbol, value, editor }) =>
  editor.isEditing ? (
    <div className="flex items-center gap-1.5 cursor-text group">
      <span className="inline-flex h-4 w-3 items-center justify-center font-serif text-[10px] italic leading-none text-text-tertiary">
        {symbol}
      </span>
      <input
        ref={editor.inputRef}
        type="text"
        value={editor.inputValue}
        onChange={(event) => editor.setInputValue(event.target.value)}
        onBlur={(event) => editor.commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            editor.commit(event.currentTarget.value);
          }
        }}
        onClick={(event) => event.stopPropagation()}
        className="h-4 w-10 rounded border border-border-strong bg-input-bg px-0.5 py-0 text-center text-[10px] leading-none font-mono text-text-primary outline-none focus:border-system-blue focus:ring-1 focus:ring-system-blue/20"
      />
    </div>
  ) : (
    <button
      type="button"
      className="flex items-center gap-1.5 cursor-text group border-0 bg-transparent p-0"
      onClick={(event) => {
        event.stopPropagation();
        editor.beginEditing();
      }}
    >
      <span className="inline-flex h-4 w-3 items-center justify-center font-serif text-[10px] italic leading-none text-text-tertiary">
        {symbol}
      </span>
      <span
        className={`flex h-4 w-10 items-center justify-center border-b border-transparent text-center text-[10px] text-text-secondary transition-colors group-hover:border-border-strong/80 group-hover:text-text-primary ${
          symbol === 'τ' ? 'leading-none' : ''
        }`}
      >
        {formatLimitDisplayValue(value)}
      </span>
    </button>
  );

interface JointAdvancedInputsProps {
  effort: number | undefined;
  velocity: number | undefined;
  effortEditor: EditableJointNumberField;
  velocityEditor: EditableJointNumberField;
}

export const JointAdvancedInputs: React.FC<JointAdvancedInputsProps> = ({
  effort,
  velocity,
  effortEditor,
  velocityEditor,
}) => (
  <div className="flex items-center gap-2 shrink-0">
    <AdvancedField symbol="τ" value={effort} editor={effortEditor} />
    <AdvancedField symbol="v" value={velocity} editor={velocityEditor} />
  </div>
);

interface JointLimitFieldProps {
  side: 'lower' | 'upper';
  hasFiniteLimits: boolean;
  displayValue: number;
  editor: EditableJointNumberField;
}

export const JointLimitField: React.FC<JointLimitFieldProps> = ({
  side,
  hasFiniteLimits,
  displayValue,
  editor,
}) => {
  const alignmentClassName = side === 'lower' ? 'justify-end' : 'justify-start';
  const textAlignmentClassName = side === 'lower' ? 'text-right' : 'text-left';
  const inputPositionClassName = side === 'lower' ? 'left-0' : 'right-0';
  const infinityLabel = side === 'lower' ? '−∞' : '∞';

  const beginEditing = (event: React.SyntheticEvent) => {
    if (!hasFiniteLimits) return;
    event.stopPropagation();
    editor.beginEditing();
  };

  return (
    <div
      className={`relative flex h-4 items-center ${alignmentClassName} ${LIMIT_FIELD_COLUMN_WIDTH_CLASS_NAME}`}
      onClick={beginEditing}
      onKeyDown={(event) => {
        if (
          !hasFiniteLimits ||
          event.target !== event.currentTarget ||
          (event.key !== 'Enter' && event.key !== ' ')
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        editor.beginEditing();
      }}
      role={hasFiniteLimits ? 'button' : undefined}
      tabIndex={hasFiniteLimits ? -1 : undefined}
    >
      {hasFiniteLimits && editor.isEditing ? (
        <input
          ref={editor.inputRef}
          type="text"
          value={editor.inputValue}
          onChange={(event) => editor.setInputValue(event.target.value)}
          onBlur={(event) => editor.commit(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              editor.commit(event.currentTarget.value);
            }
          }}
          className={`absolute ${inputPositionClassName} top-0 z-20 ${LIMIT_FIELD_BASE_CLASS_NAME} ${LIMIT_INPUT_WIDTH_CLASS_NAME} border-border-strong bg-input-bg ${textAlignmentClassName} text-text-primary outline-none focus:border-system-blue focus:ring-1 focus:ring-system-blue/20`}
        />
      ) : hasFiniteLimits ? (
        <button type="button" className="border-0 bg-transparent p-0" onClick={beginEditing}>
          <div
            className={`${LIMIT_FIELD_BASE_CLASS_NAME} w-fit cursor-text ${alignmentClassName} border-transparent ${textAlignmentClassName} text-text-tertiary hover:border-border-strong/70 hover:text-system-blue`}
          >
            {displayValue.toFixed(2)}
          </div>
        </button>
      ) : (
        <div
          className={`${LIMIT_FIELD_BASE_CLASS_NAME} w-fit cursor-text ${alignmentClassName} border-transparent ${textAlignmentClassName} text-text-tertiary hover:border-border-strong/70 hover:text-system-blue`}
        >
          {infinityLabel}
        </div>
      )}
    </div>
  );
};
