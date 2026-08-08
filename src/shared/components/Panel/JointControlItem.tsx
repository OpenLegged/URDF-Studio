import React, { useCallback, useEffect, useRef, useState } from 'react';

import { JointType } from '@/types';
import { createJointDragStoreSync } from '@/shared/utils/jointDragStoreSync';
import { getJointType } from '@/shared/utils/jointTypes';
import {
  fromJointDisplayValue,
  getJointSliderStep,
  getJointValueUnitLabel,
  isAngularJointType,
  normalizeJointTypeValue,
  toJointDisplayValue,
} from '@/shared/utils/jointUnits';
import { JointAdvancedInputs, JointLimitField, JointValueField } from './JointControlFields';
import type { EditableJointNumberField } from './jointControlFieldTypes';
import {
  JOINT_PANEL_STORE_SYNC_INTERVAL_MS,
  type JointControlItemProps,
  type SliderDragBounds,
  type SliderDragSource,
} from './jointControlItemTypes';
import { snapSliderValue } from './jointSliderMath';
import { useFocusInputWhenEditing } from './useFocusInputWhenEditing';
import { useJointLimitEditing } from './useJointLimitEditing';

export type { JointControlItemProps } from './jointControlItemTypes';

const JointControlItemComponent: React.FC<JointControlItemProps> = ({
  name,
  joint,
  displayName,
  value,
  angleUnit,
  isActive,
  shouldAutoScroll = false,
  setActiveJoint,
  handleJointAngleChange,
  handleJointChangeCommit,
  setIsDragging,
  onSelect,
  isAdvanced = false,
  ignoreLimits = false,
  onUpdate,
  compact = false,
  dragSyncIntervalMs = JOINT_PANEL_STORE_SYNC_INTERVAL_MS,
  throttleDragSync = true,
  dragSyncMode,
}) => {
  const resolvedDisplayName = displayName?.trim() || joint?.name?.trim() || name;
  const jointType = getJointType(joint);
  const usesAngularUnits = isAngularJointType(jointType);
  const isContinuousJoint = normalizeJointTypeValue(jointType) === JointType.CONTINUOUS;
  const itemRef = useRef<HTMLDivElement>(null);
  const continuousPreviewValueRef = useRef(value);
  const isSliderDraggingRef = useRef(false);
  const sliderDragSourceRef = useRef<SliderDragSource | null>(null);
  const sliderStoreSync = React.useMemo(
    () =>
      createJointDragStoreSync({
        onDragChange: handleJointAngleChange,
        onDragCommit: handleJointChangeCommit,
        // Callers choose how often expensive runtime/store sync runs; local feedback stays immediate.
        throttleChanges: throttleDragSync,
        intervalMs: dragSyncIntervalMs,
        syncMode: dragSyncMode,
      }),
    [
      dragSyncIntervalMs,
      dragSyncMode,
      handleJointAngleChange,
      handleJointChangeCommit,
      throttleDragSync,
    ],
  );
  const {
    localLimits,
    orderedLimits,
    hasFiniteLimits,
    lowerEditor,
    upperEditor,
    effortEditor,
    velocityEditor,
  } = useJointLimitEditing({
    joint,
    jointType,
    name,
    value,
    angleUnit,
    handleJointAngleChange,
    handleJointChangeCommit,
    onUpdate,
  });

  useEffect(() => {
    if (shouldAutoScroll && itemRef.current) {
      itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [resolvedDisplayName, shouldAutoScroll]);

  const [continuousSliderAnchor, setContinuousSliderAnchor] = useState(value);
  const continuousSliderAnchorRef = useRef(value);
  const [sliderPreviewValue, setSliderPreviewValue] = useState(value);
  const [isSliderDragging, setIsSliderDragging] = useState(false);
  const [isSliderThumbHovered, setIsSliderThumbHovered] = useState(false);
  const [isPanelHovered, setIsPanelHovered] = useState(false);
  const sliderShellRef = useRef<HTMLDivElement>(null);
  const sliderDragBoundsRef = useRef<SliderDragBounds | null>(null);
  const sliderThumbDiameter = compact ? 16 : 18;
  const sliderThumbHalf = sliderThumbDiameter / 2;

  const syncContinuousSliderAnchor = useCallback((nextAnchor: number) => {
    continuousSliderAnchorRef.current = nextAnchor;
    setContinuousSliderAnchor(nextAnchor);
  }, []);

  const displayValue = toJointDisplayValue(sliderPreviewValue, jointType, angleUnit);
  const displayMin =
    hasFiniteLimits && typeof orderedLimits.lower === 'number'
      ? toJointDisplayValue(orderedLimits.lower, jointType, angleUnit)
      : Number.NEGATIVE_INFINITY;
  const displayMax =
    hasFiniteLimits && typeof orderedLimits.upper === 'number'
      ? toJointDisplayValue(orderedLimits.upper, jointType, angleUnit)
      : Number.POSITIVE_INFINITY;
  const displayUnit = getJointValueUnitLabel(jointType, angleUnit);
  const step = getJointSliderStep(jointType, angleUnit);
  const continuousSliderWindow = angleUnit === 'deg' ? 180 : Math.PI;
  const sliderValue = isContinuousJoint
    ? toJointDisplayValue(sliderPreviewValue - continuousSliderAnchor, jointType, angleUnit)
    : displayValue;
  // Limit override frees slider travel while authored bounds remain visible and editable.
  const sliderBoundedByLimits = hasFiniteLimits && !ignoreLimits;
  // Keep the override window stable under the pointer by anchoring it to authored limits.
  const limitOverrideMargin = usesAngularUnits
    ? angleUnit === 'deg'
      ? 360
      : Math.PI * 2
    : Math.max(Math.abs(displayMax - displayMin), 1);
  const sliderMin = isContinuousJoint
    ? -continuousSliderWindow
    : sliderBoundedByLimits
      ? Math.min(displayMin, displayValue)
      : hasFiniteLimits
        ? displayMin - limitOverrideMargin
        : displayValue - (angleUnit === 'deg' && usesAngularUnits ? 180 : Math.PI);
  const sliderMax = isContinuousJoint
    ? continuousSliderWindow
    : sliderBoundedByLimits
      ? Math.max(displayMax, displayValue)
      : hasFiniteLimits
        ? displayMax + limitOverrideMargin
        : displayValue + (angleUnit === 'deg' && usesAngularUnits ? 180 : Math.PI);

  const latestValuesRef = useRef({
    sliderMin,
    sliderMax,
    step,
    isContinuousJoint,
    jointType,
    angleUnit,
    name,
    isSliderDragging,
  });

  useEffect(() => {
    latestValuesRef.current = {
      sliderMin,
      sliderMax,
      step,
      isContinuousJoint,
      jointType,
      angleUnit,
      name,
      isSliderDragging,
    };
  });

  const sliderRange = sliderMax - sliderMin;
  const sliderPercentage = sliderRange > 0 ? ((sliderValue - sliderMin) / sliderRange) * 100 : 0;
  const clampedSliderPercentage = Math.min(Math.max(sliderPercentage, 0), 100);

  const [inputValue, setInputValue] = useState(displayValue.toFixed(2));
  const [isEditingValue, setIsEditingValue] = useState(false);
  const valueInputRef = useRef<HTMLInputElement>(null);
  useFocusInputWhenEditing(valueInputRef, isEditingValue);

  useEffect(() => {
    if (isSliderDraggingRef.current) {
      return;
    }

    setSliderPreviewValue(value);
    continuousPreviewValueRef.current = value;

    if (isContinuousJoint) {
      syncContinuousSliderAnchor(value);
    }
  }, [isContinuousJoint, syncContinuousSliderAnchor, value]);

  useEffect(
    () => () => {
      sliderDragBoundsRef.current = null;
      if (isSliderDraggingRef.current) {
        setIsDragging?.(false);
      }
      sliderStoreSync.dispose();
    },
    [setIsDragging, sliderStoreSync],
  );

  const handleSliderChangeStart = useCallback(
    (source: SliderDragSource) => {
      if (isSliderDraggingRef.current) {
        return;
      }

      isSliderDraggingRef.current = true;
      sliderDragSourceRef.current = source;
      setIsSliderDragging(true);
      setIsDragging?.(true);
      setActiveJoint(name, { autoScroll: false });
      onSelect?.('joint', name);
      setSliderPreviewValue(value);
      continuousPreviewValueRef.current = value;

      if (isContinuousJoint) {
        syncContinuousSliderAnchor(value);
      }
    },
    [
      isActive,
      isContinuousJoint,
      name,
      onSelect,
      setActiveJoint,
      setIsDragging,
      syncContinuousSliderAnchor,
      value,
    ],
  );

  const handleSliderChangeEnd = useCallback(() => {
    if (!isSliderDraggingRef.current) {
      return;
    }

    const committedValue = continuousPreviewValueRef.current;
    isSliderDraggingRef.current = false;
    sliderDragSourceRef.current = null;
    sliderDragBoundsRef.current = null;
    setIsSliderDragging(false);
    setIsDragging?.(false);

    if (isContinuousJoint) {
      syncContinuousSliderAnchor(committedValue);
    }

    sliderStoreSync.commit(name, committedValue);
  }, [isContinuousJoint, name, setIsDragging, sliderStoreSync, syncContinuousSliderAnchor]);

  const handleSliderInput = useCallback(
    (nextSliderValue: number) => {
      const {
        isContinuousJoint: currentIsContinuousJoint,
        jointType: currentJointType,
        angleUnit: currentAngleUnit,
        name: currentName,
      } = latestValuesRef.current;
      const nextValue = currentIsContinuousJoint
        ? continuousSliderAnchorRef.current +
          fromJointDisplayValue(nextSliderValue, currentJointType, currentAngleUnit)
        : fromJointDisplayValue(nextSliderValue, currentJointType, currentAngleUnit);

      if (Math.abs(nextValue - continuousPreviewValueRef.current) <= 1e-6) {
        return;
      }

      setSliderPreviewValue(nextValue);
      continuousPreviewValueRef.current = nextValue;
      sliderStoreSync.emit(currentName, nextValue);
    },
    [sliderStoreSync],
  );

  const readSliderDragBounds = useCallback((): SliderDragBounds | null => {
    const sliderShell = sliderShellRef.current;
    if (!sliderShell) {
      return null;
    }

    const rect = sliderShell.getBoundingClientRect();
    if (rect.width <= 0) {
      return null;
    }

    return { left: rect.left, width: rect.width };
  }, []);

  const updateSliderValueFromClientX = useCallback(
    (clientX: number) => {
      const bounds = sliderDragBoundsRef.current ?? readSliderDragBounds();
      if (!bounds) {
        return;
      }

      const {
        sliderMin: currentMin,
        sliderMax: currentMax,
        step: currentStep,
      } = latestValuesRef.current;
      const ratio = Math.min(Math.max((clientX - bounds.left) / bounds.width, 0), 1);
      const rawSliderValue = currentMin + ratio * (currentMax - currentMin);
      handleSliderInput(snapSliderValue(rawSliderValue, currentMin, currentMax, currentStep));
    },
    [handleSliderInput, readSliderDragBounds],
  );

  const handleSliderShellDragStart = useCallback(
    (clientX: number, pointerId?: number) => {
      handleSliderChangeStart('slider-shell');
      sliderDragBoundsRef.current = readSliderDragBounds();
      updateSliderValueFromClientX(clientX);

      if (pointerId !== undefined && sliderShellRef.current?.setPointerCapture) {
        try {
          sliderShellRef.current.setPointerCapture(pointerId);
        } catch {
          // Pointer capture is an optimization; window listeners still complete the drag.
        }
      }
    },
    [handleSliderChangeStart, readSliderDragBounds, updateSliderValueFromClientX],
  );

  const updateSliderThumbHover = useCallback(
    (clientX: number, clientY: number) => {
      const sliderShell = sliderShellRef.current;
      if (!sliderShell) {
        setIsSliderThumbHovered(false);
        return;
      }

      const rect = sliderShell.getBoundingClientRect();
      const thumbCenterX = rect.left + (clampedSliderPercentage / 100) * rect.width;
      const thumbCenterY = rect.top + rect.height / 2;
      const withinX = Math.abs(clientX - thumbCenterX) <= sliderThumbHalf + 7;
      const withinY = Math.abs(clientY - thumbCenterY) <= sliderThumbHalf + 10;
      setIsSliderThumbHovered(withinX && withinY);
    },
    [clampedSliderPercentage, sliderThumbHalf],
  );

  useEffect(() => {
    if (!isSliderDragging) {
      return;
    }

    const handleWindowPointerMove = (event: PointerEvent) => {
      if (sliderDragSourceRef.current === 'slider-shell') {
        updateSliderValueFromClientX(event.clientX);
      }
    };
    const handleWindowPointerUp = () => handleSliderChangeEnd();

    window.addEventListener('pointermove', handleWindowPointerMove, { passive: true });
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerUp);
    window.addEventListener('blur', handleWindowPointerUp);

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerUp);
      window.removeEventListener('blur', handleWindowPointerUp);
    };
  }, [handleSliderChangeEnd, isSliderDragging, updateSliderValueFromClientX]);

  useEffect(() => {
    const currentParsed = parseFloat(inputValue);
    const isDifferent =
      Number.isNaN(currentParsed) || Math.abs(currentParsed - displayValue) > 0.0001;
    if (!isEditingValue && isDifferent) {
      setInputValue(displayValue.toFixed(2));
    }
  }, [displayValue, inputValue, isEditingValue]);

  const commitValue = useCallback(
    (input: string) => {
      const parsedValue = parseFloat(input);
      if (!Number.isNaN(parsedValue)) {
        handleJointChangeCommit(name, fromJointDisplayValue(parsedValue, jointType, angleUnit));
      }
      setIsEditingValue(false);
    },
    [angleUnit, handleJointChangeCommit, jointType, name],
  );

  useEffect(() => {
    if (!isEditingValue) {
      return;
    }

    const handlePointerDownCapture = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || valueInputRef.current?.contains(target)) {
        return;
      }
      commitValue(valueInputRef.current?.value ?? inputValue);
    };

    document.addEventListener('pointerdown', handlePointerDownCapture, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDownCapture, true);
    };
  }, [commitValue, inputValue, isEditingValue]);

  const cardSpacingClassName = compact
    ? 'space-y-0.5 rounded-md px-1 py-1'
    : 'space-y-1 rounded-lg px-1 py-1.5';
  const rowHeightClassName = compact ? 'h-5' : 'h-6';
  const sliderInputHeightClassName = compact ? 'h-6' : 'h-7';
  const sliderTrackHeightClassName = compact ? 'h-1' : 'h-[5px]';
  const sliderThumbSizeClassName = compact ? 'h-4 w-4' : 'h-[18px] w-[18px]';
  const selectCurrentJoint = useCallback(() => {
    setActiveJoint(name, { autoScroll: false });
    onSelect?.('joint', name);
  }, [name, onSelect, setActiveJoint]);
  const handleCardKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) {
        return;
      }

      event.preventDefault();
      selectCurrentJoint();
    },
    [selectCurrentJoint],
  );
  const valueEditor: EditableJointNumberField = {
    inputRef: valueInputRef,
    inputValue,
    setInputValue,
    isEditing: isEditingValue,
    beginEditing: () => setIsEditingValue(true),
    commit: commitValue,
  };

  return (
    <div
      ref={itemRef}
      data-panel-hovered={isPanelHovered ? 'true' : 'false'}
      onClick={selectCurrentJoint}
      onKeyDown={handleCardKeyDown}
      onMouseEnter={() => setIsPanelHovered(true)}
      onMouseLeave={() => setIsPanelHovered(false)}
      role="button"
      aria-label={resolvedDisplayName}
      tabIndex={0}
      className={`cursor-pointer border transition-colors ${cardSpacingClassName} ${
        isActive
          ? 'border-system-blue/20 bg-system-blue/10 dark:border-system-blue/30 dark:bg-system-blue/18'
          : isPanelHovered
            ? 'border-border-black/60 bg-element-hover/80'
            : 'border-transparent bg-transparent'
      }`}
    >
      <div className={`flex ${rowHeightClassName} items-center justify-between gap-1`}>
        <span
          className={`text-[11px] font-medium truncate min-w-0 ${
            isActive
              ? 'text-system-blue'
              : isPanelHovered
                ? 'text-text-primary'
                : 'text-text-secondary'
          } flex-1`}
          title={resolvedDisplayName}
        >
          {resolvedDisplayName}
        </span>

        {!isAdvanced ? (
          <JointValueField
            displayValue={displayValue}
            displayUnit={displayUnit}
            editor={valueEditor}
          />
        ) : null}
      </div>

      {isAdvanced ? (
        <div className={`flex ${rowHeightClassName} items-center justify-between gap-1`}>
          <JointAdvancedInputs
            effort={localLimits.effort}
            velocity={localLimits.velocity}
            effortEditor={effortEditor}
            velocityEditor={velocityEditor}
          />
          <JointValueField
            displayValue={displayValue}
            displayUnit={displayUnit}
            editor={valueEditor}
          />
        </div>
      ) : null}

      <div className="grid grid-cols-[max-content_minmax(0,1fr)_max-content] items-center gap-1">
        <JointLimitField
          side="lower"
          hasFiniteLimits={hasFiniteLimits}
          displayValue={displayMin}
          editor={lowerEditor}
        />

        <div
          ref={sliderShellRef}
          className="relative flex min-w-0 items-center"
          data-testid="joint-slider-shell"
          role="slider"
          aria-label={`${resolvedDisplayName} slider`}
          aria-valuemin={sliderMin}
          aria-valuemax={sliderMax}
          aria-valuenow={sliderValue}
          tabIndex={-1}
          onKeyDown={(event) => event.stopPropagation()}
          onPointerEnter={(event) => updateSliderThumbHover(event.clientX, event.clientY)}
          onPointerMove={(event) => {
            if (!isSliderDraggingRef.current) {
              updateSliderThumbHover(event.clientX, event.clientY);
            }
          }}
          onPointerLeave={() => setIsSliderThumbHovered(false)}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            handleSliderShellDragStart(event.clientX, event.pointerId);
          }}
        >
          <div
            className={`pointer-events-none absolute inset-x-0 top-1/2 ${sliderTrackHeightClassName} -translate-y-1/2 overflow-hidden rounded-full bg-slider-track`}
          >
            <div
              data-testid="joint-slider-fill"
              className="h-full bg-slider-accent"
              style={{ width: `${clampedSliderPercentage}%` }}
            />
          </div>
          <button
            type="button"
            data-testid="joint-slider-thumb"
            data-hovered={isSliderThumbHovered ? 'true' : 'false'}
            aria-label={`${resolvedDisplayName} slider thumb`}
            tabIndex={-1}
            className={`absolute top-1/2 z-20 ${sliderThumbSizeClassName} -translate-y-1/2 rounded-full border p-0 transition-[transform,box-shadow] duration-150 ease-out ${
              isSliderDragging
                ? 'scale-110 ring-4 ring-system-blue/15'
                : isSliderThumbHovered
                  ? 'scale-[1.08] ring-2 ring-system-blue/10'
                  : 'scale-100'
            }`}
            style={{
              left: `calc(${clampedSliderPercentage}% - ${sliderThumbHalf}px)`,
              backgroundColor: 'var(--ui-slider-thumb-bg)',
              borderColor: 'var(--ui-slider-thumb-border)',
              boxShadow: isSliderDragging
                ? 'var(--ui-slider-thumb-shadow-active)'
                : isSliderThumbHovered
                  ? 'var(--ui-slider-thumb-shadow-hover)'
                  : 'var(--ui-slider-thumb-shadow)',
            }}
            onPointerEnter={(event) => updateSliderThumbHover(event.clientX, event.clientY)}
            onPointerMove={(event) => {
              if (!isSliderDraggingRef.current) {
                updateSliderThumbHover(event.clientX, event.clientY);
              }
            }}
            onPointerLeave={() => setIsSliderThumbHovered(false)}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              handleSliderShellDragStart(event.clientX, event.pointerId);
            }}
          />
          <input
            type="range"
            min={sliderMin}
            max={sliderMax}
            step={step}
            value={sliderValue}
            onInput={(event) => {
              handleSliderInput(parseFloat(event.currentTarget.value));
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
              handleSliderChangeStart('native-input');
            }}
            onPointerUp={(event) => {
              event.stopPropagation();
              handleSliderChangeEnd();
            }}
            onClick={(event) => event.stopPropagation()}
            className={`relative z-10 block ${sliderInputHeightClassName} w-full cursor-pointer appearance-none bg-transparent opacity-0`}
            style={{ accentColor: 'var(--ui-slider-accent)' }}
          />
        </div>

        <JointLimitField
          side="upper"
          hasFiniteLimits={hasFiniteLimits}
          displayValue={displayMax}
          editor={upperEditor}
        />
      </div>
    </div>
  );
};

export const JointControlItem = React.memo(JointControlItemComponent);
