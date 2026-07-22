import React, { useRef, useState, useEffect, useCallback } from 'react';
import { JointType } from '@/types';
import { normalizeJointLimitOrder } from '@/core/robot';
import { createJointDragStoreSync } from '@/shared/utils/jointDragStoreSync';
import { getJointType } from '@/shared/utils/jointTypes';
import {
  fromJointDisplayValue,
  getJointSliderStep,
  getJointValueUnitLabel,
  hasEffectivelyFiniteJointLimits,
  isAngularJointType,
  normalizeJointTypeValue,
  supportsFiniteJointLimits,
  toJointDisplayValue,
} from '@/shared/utils/jointUnits';
import {
  JOINT_PANEL_STORE_SYNC_INTERVAL_MS,
  type JointControlItemProps,
  type SliderDragBounds,
  type SliderDragSource,
} from './jointControlItemTypes';
import { snapSliderValue } from './jointSliderMath';
import { useFocusInputWhenEditing } from './useFocusInputWhenEditing';

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
  onUpdate,
  compact = false,
  dragSyncIntervalMs = JOINT_PANEL_STORE_SYNC_INTERVAL_MS,
  throttleDragSync = true,
  dragSyncMode,
}) => {
  const resolvedDisplayName = displayName?.trim() || joint?.name?.trim() || name;
  const jointType = getJointType(joint);
  const limit = joint.limit;
  const usesAngularUnits = isAngularJointType(jointType);
  const supportsAdjustableLimits = supportsFiniteJointLimits(jointType);
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
        // Callers choose how often expensive runtime/store sync runs; local slider feedback stays immediate.
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

  const [localLimits, setLocalLimits] = useState(() =>
    normalizeJointLimitOrder({
      lower: limit?.lower,
      upper: limit?.upper,
      effort: limit?.effort,
      velocity: limit?.velocity,
    }),
  );

  useEffect(() => {
    setLocalLimits(
      normalizeJointLimitOrder({
        lower: limit?.lower,
        upper: limit?.upper,
        effort: limit?.effort,
        velocity: limit?.velocity,
      }),
    );
  }, [joint.id, limit?.lower, limit?.upper, limit?.effort, limit?.velocity]);

  const orderedLocalLimits = React.useMemo(
    () => normalizeJointLimitOrder(localLimits),
    [localLimits],
  );
  const hasFiniteLimits =
    supportsAdjustableLimits && hasEffectivelyFiniteJointLimits(orderedLocalLimits);

  const formatLimitInputValue = (limitValue: number | undefined) =>
    Number.isFinite(limitValue) ? Number(limitValue).toFixed(2) : '';
  const formatLimitDisplayValue = (limitValue: number | undefined) =>
    Number.isFinite(limitValue) ? Number(limitValue).toFixed(2) : '—';

  const updateLimit = useCallback(
    (key: 'lower' | 'upper' | 'effort' | 'velocity', val: number) => {
      const newLimits = normalizeJointLimitOrder({ ...localLimits, [key]: val });
      setLocalLimits(newLimits);

      if ((key === 'lower' || key === 'upper') && hasEffectivelyFiniteJointLimits(newLimits)) {
        const clampedValue = Math.min(Math.max(value, newLimits.lower), newLimits.upper);
        if (Math.abs(clampedValue - value) > 1e-9) {
          handleJointAngleChange(name, clampedValue);
          handleJointChangeCommit(name, clampedValue);
        }
      }

      const jointId = name || (joint.id == null ? '' : String(joint.id));
      if (jointId) {
        const finiteLimits = {
          ...(typeof newLimits.lower === 'number' && Number.isFinite(newLimits.lower)
            ? { lower: newLimits.lower }
            : {}),
          ...(typeof newLimits.upper === 'number' && Number.isFinite(newLimits.upper)
            ? { upper: newLimits.upper }
            : {}),
          ...(typeof newLimits.effort === 'number' && Number.isFinite(newLimits.effort)
            ? { effort: newLimits.effort }
            : {}),
          ...(typeof newLimits.velocity === 'number' && Number.isFinite(newLimits.velocity)
            ? { velocity: newLimits.velocity }
            : {}),
        };
        onUpdate?.('joint', jointId, {
          limit: finiteLimits,
        });
      }
    },
    [
      handleJointAngleChange,
      handleJointChangeCommit,
      joint,
      localLimits,
      name,
      onUpdate,
      value,
    ],
  );

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
  const displayMin = hasFiniteLimits
    ? toJointDisplayValue(orderedLocalLimits.lower, jointType, angleUnit)
    : Number.NEGATIVE_INFINITY;
  const displayMax = hasFiniteLimits
    ? toJointDisplayValue(orderedLocalLimits.upper, jointType, angleUnit)
    : Number.POSITIVE_INFINITY;
  const displayUnit = getJointValueUnitLabel(jointType, angleUnit);
  const step = getJointSliderStep(jointType, angleUnit);
  const continuousSliderWindow = angleUnit === 'deg' ? 180 : Math.PI;
  const sliderValue = isContinuousJoint
    ? toJointDisplayValue(sliderPreviewValue - continuousSliderAnchor, jointType, angleUnit)
    : displayValue;
  const sliderMin = isContinuousJoint
    ? -continuousSliderWindow
    : hasFiniteLimits
      ? Math.min(displayMin, displayValue)
      : displayValue - (angleUnit === 'deg' && usesAngularUnits ? 180 : Math.PI);
  const sliderMax = isContinuousJoint
    ? continuousSliderWindow
    : hasFiniteLimits
      ? Math.max(displayMax, displayValue)
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

  const [isEditingLower, setIsEditingLower] = useState(false);
  const [isEditingUpper, setIsEditingUpper] = useState(false);
  const [isEditingEffort, setIsEditingEffort] = useState(false);
  const [isEditingVelocity, setIsEditingVelocity] = useState(false);
  const lowerInputRef = useRef<HTMLInputElement>(null);
  const upperInputRef = useRef<HTMLInputElement>(null);
  const effortInputRef = useRef<HTMLInputElement>(null);
  const velocityInputRef = useRef<HTMLInputElement>(null);

  useFocusInputWhenEditing(valueInputRef, isEditingValue);
  useFocusInputWhenEditing(lowerInputRef, isEditingLower);
  useFocusInputWhenEditing(upperInputRef, isEditingUpper);
  useFocusInputWhenEditing(effortInputRef, isEditingEffort);
  useFocusInputWhenEditing(velocityInputRef, isEditingVelocity);

  const [lowerInput, setLowerInput] = useState(formatLimitInputValue(orderedLocalLimits.lower));
  const [upperInput, setUpperInput] = useState(formatLimitInputValue(orderedLocalLimits.upper));

  const [effortInput, setEffortInput] = useState(formatLimitInputValue(localLimits.effort));
  const [velocityInput, setVelocityInput] = useState(formatLimitInputValue(localLimits.velocity));

  useEffect(() => {
    if (!isEditingLower) setLowerInput(formatLimitInputValue(orderedLocalLimits.lower));
  }, [orderedLocalLimits.lower, isEditingLower]);

  useEffect(() => {
    if (!isEditingUpper) setUpperInput(formatLimitInputValue(orderedLocalLimits.upper));
  }, [orderedLocalLimits.upper, isEditingUpper]);

  useEffect(() => {
    if (!isEditingEffort) setEffortInput(formatLimitInputValue(localLimits.effort));
  }, [localLimits.effort, isEditingEffort]);

  useEffect(() => {
    if (!isEditingVelocity) setVelocityInput(formatLimitInputValue(localLimits.velocity));
  }, [localLimits.velocity, isEditingVelocity]);

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

    return {
      left: rect.left,
      width: rect.width,
    };
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
          // Ignore if pointer capture fails
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
      if (sliderDragSourceRef.current !== 'slider-shell') {
        return;
      }

      updateSliderValueFromClientX(event.clientX);
    };

    const handleWindowPointerUp = () => {
      handleSliderChangeEnd();
    };

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
    const isDifferent = isNaN(currentParsed) || Math.abs(currentParsed - displayValue) > 0.0001;

    if (!isEditingValue && isDifferent) {
      setInputValue(displayValue.toFixed(2));
    }
  }, [displayValue, isEditingValue]);

  const commitChange = useCallback(
    (valStr: string) => {
      const val = parseFloat(valStr);
      if (!isNaN(val)) {
        handleJointChangeCommit(name, fromJointDisplayValue(val, jointType, angleUnit));
      }
      setIsEditingValue(false);
    },
    [angleUnit, handleJointChangeCommit, jointType, name],
  );

  const handleLimitCommit = useCallback(
    (type: 'lower' | 'upper', valStr: string) => {
      if (!hasFiniteLimits) {
        if (type === 'lower') setIsEditingLower(false);
        if (type === 'upper') setIsEditingUpper(false);
        return;
      }

      const val = parseFloat(valStr);
      if (!isNaN(val)) {
        updateLimit(type, fromJointDisplayValue(val, jointType, angleUnit));
      }
      if (type === 'lower') setIsEditingLower(false);
      if (type === 'upper') setIsEditingUpper(false);
    },
    [angleUnit, hasFiniteLimits, jointType, updateLimit],
  );

  const handleAdvancedCommit = useCallback(
    (type: 'effort' | 'velocity', valStr: string) => {
      const val = parseFloat(valStr);
      if (!isNaN(val)) {
        updateLimit(type, val);
      }
      if (type === 'effort') setIsEditingEffort(false);
      if (type === 'velocity') setIsEditingVelocity(false);
    },
    [updateLimit],
  );

  const commitOpenEditors = useCallback(() => {
    if (isEditingValue) commitChange(valueInputRef.current?.value ?? inputValue);
    if (isEditingLower) handleLimitCommit('lower', lowerInputRef.current?.value ?? lowerInput);
    if (isEditingUpper) handleLimitCommit('upper', upperInputRef.current?.value ?? upperInput);
    if (isEditingEffort) {
      handleAdvancedCommit('effort', effortInputRef.current?.value ?? effortInput);
    }
    if (isEditingVelocity) {
      handleAdvancedCommit('velocity', velocityInputRef.current?.value ?? velocityInput);
    }
  }, [
    commitChange,
    effortInput,
    handleAdvancedCommit,
    handleLimitCommit,
    inputValue,
    isEditingEffort,
    isEditingLower,
    isEditingUpper,
    isEditingValue,
    isEditingVelocity,
    lowerInput,
    upperInput,
    velocityInput,
  ]);

  useEffect(() => {
    if (
      !isEditingValue &&
      !isEditingLower &&
      !isEditingUpper &&
      !isEditingEffort &&
      !isEditingVelocity
    ) {
      return;
    }

    const handlePointerDownCapture = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;

      const activeInputs = [
        isEditingValue ? valueInputRef.current : null,
        isEditingLower ? lowerInputRef.current : null,
        isEditingUpper ? upperInputRef.current : null,
        isEditingEffort ? effortInputRef.current : null,
        isEditingVelocity ? velocityInputRef.current : null,
      ].filter((input): input is HTMLInputElement => input instanceof HTMLInputElement);

      if (activeInputs.some((input) => input.contains(target))) {
        return;
      }

      commitOpenEditors();
    };

    document.addEventListener('pointerdown', handlePointerDownCapture, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDownCapture, true);
    };
  }, [
    commitOpenEditors,
    isEditingEffort,
    isEditingLower,
    isEditingUpper,
    isEditingValue,
    isEditingVelocity,
  ]);

  const mainValueFieldWidthClassName = 'w-[2.35rem]';
  const limitFieldBaseClassName =
    'flex h-4 items-center rounded border px-0.5 py-0 font-mono tabular-nums text-[9px] leading-none transition-colors';
  const limitFieldColumnWidthClassName = 'min-w-[2.35rem]';
  const limitInputWidthClassName = 'w-[2.35rem]';
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
      if (event.target !== event.currentTarget) {
        return;
      }

      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }

      event.preventDefault();
      selectCurrentJoint();
    },
    [selectCurrentJoint],
  );

  const renderValueDisplay = () => (
    <div className="flex h-full shrink-0 items-center justify-end gap-0.5 whitespace-nowrap">
      <div
        className={`flex items-center justify-end ${mainValueFieldWidthClassName}`}
        onClick={(e) => {
          e.stopPropagation();
          setIsEditingValue(true);
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          setIsEditingValue(true);
        }}
        role="button"
        tabIndex={-1}
      >
        {isEditingValue ? (
          <input
            ref={valueInputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onBlur={(e) => commitChange(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commitChange(e.currentTarget.value);
                e.currentTarget.blur();
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="h-3.5 w-full rounded border border-border-strong bg-input-bg px-0.5 py-0 text-right text-[9px] leading-none font-mono tabular-nums text-text-primary outline-none focus:border-system-blue focus:ring-1 focus:ring-system-blue/20"
          />
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsEditingValue(true);
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

  const renderAdvancedInputs = () => (
    <div className="flex items-center gap-2 shrink-0">
      {isEditingEffort ? (
        <div className="flex items-center gap-1.5 cursor-text group">
          <span className="inline-flex h-4 w-3 items-center justify-center font-serif text-[10px] italic leading-none text-text-tertiary">
            τ
          </span>
          <input
            ref={effortInputRef}
            type="text"
            value={effortInput}
            onChange={(e) => setEffortInput(e.target.value)}
            onBlur={(e) => handleAdvancedCommit('effort', e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleAdvancedCommit('effort', e.currentTarget.value);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-10 rounded border border-border-strong bg-input-bg px-0.5 py-0 text-center text-[10px] leading-none font-mono text-text-primary outline-none focus:border-system-blue focus:ring-1 focus:ring-system-blue/20"
          />
        </div>
      ) : (
        <button
          type="button"
          className="flex items-center gap-1.5 cursor-text group border-0 bg-transparent p-0"
          onClick={(e) => {
            e.stopPropagation();
            setIsEditingEffort(true);
          }}
        >
          <span className="inline-flex h-4 w-3 items-center justify-center font-serif text-[10px] italic leading-none text-text-tertiary">
            τ
          </span>
          <span className="flex h-4 w-10 items-center justify-center border-b border-transparent text-center text-[10px] leading-none text-text-secondary transition-colors group-hover:border-border-strong/80 group-hover:text-text-primary">
            {formatLimitDisplayValue(localLimits.effort)}
          </span>
        </button>
      )}
      {isEditingVelocity ? (
        <div className="flex items-center gap-1.5 cursor-text group">
          <span className="inline-flex h-4 w-3 items-center justify-center font-serif text-[10px] italic leading-none text-text-tertiary">
            v
          </span>
          <input
            ref={velocityInputRef}
            type="text"
            value={velocityInput}
            onChange={(e) => setVelocityInput(e.target.value)}
            onBlur={(e) => handleAdvancedCommit('velocity', e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleAdvancedCommit('velocity', e.currentTarget.value);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-10 rounded border border-border-strong bg-input-bg px-0.5 py-0 text-center text-[10px] leading-none font-mono text-text-primary outline-none focus:border-system-blue focus:ring-1 focus:ring-system-blue/20"
          />
        </div>
      ) : (
        <button
          type="button"
          className="flex items-center gap-1.5 cursor-text group border-0 bg-transparent p-0"
          onClick={(e) => {
            e.stopPropagation();
            setIsEditingVelocity(true);
          }}
        >
          <span className="inline-flex h-4 w-3 items-center justify-center font-serif text-[10px] italic leading-none text-text-tertiary">
            v
          </span>
          <span className="flex h-4 w-10 items-center justify-center border-b border-transparent text-center text-[10px] text-text-secondary transition-colors group-hover:border-border-strong/80 group-hover:text-text-primary">
            {formatLimitDisplayValue(localLimits.velocity)}
          </span>
        </button>
      )}
    </div>
  );

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

        {!isAdvanced && renderValueDisplay()}
      </div>

      {isAdvanced && (
        <div className={`flex ${rowHeightClassName} items-center justify-between gap-1`}>
          {renderAdvancedInputs()}
          {renderValueDisplay()}
        </div>
      )}

      <div className="grid grid-cols-[max-content_minmax(0,1fr)_max-content] items-center gap-1">
        <div
          className={`relative flex h-4 items-center justify-end ${limitFieldColumnWidthClassName}`}
          onClick={(e) => {
            if (!hasFiniteLimits) return;
            e.stopPropagation();
            setIsEditingLower(true);
          }}
          onKeyDown={(e) => {
            if (
              !hasFiniteLimits ||
              e.target !== e.currentTarget ||
              (e.key !== 'Enter' && e.key !== ' ')
            ) {
              return;
            }
            e.preventDefault();
            e.stopPropagation();
            setIsEditingLower(true);
          }}
          role={hasFiniteLimits ? 'button' : undefined}
          tabIndex={hasFiniteLimits ? -1 : undefined}
        >
          {hasFiniteLimits && isEditingLower ? (
            <input
              ref={lowerInputRef}
              type="text"
              value={lowerInput}
              onChange={(e) => setLowerInput(e.target.value)}
              onBlur={(e) => handleLimitCommit('lower', e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleLimitCommit('lower', e.currentTarget.value);
              }}
              className={`absolute left-0 top-0 z-20 ${limitFieldBaseClassName} ${limitInputWidthClassName} border-border-strong bg-input-bg text-right text-text-primary outline-none focus:border-system-blue focus:ring-1 focus:ring-system-blue/20`}
            />
          ) : hasFiniteLimits ? (
            <button
              type="button"
              className="border-0 bg-transparent p-0"
              onClick={(e) => {
                e.stopPropagation();
                setIsEditingLower(true);
              }}
            >
              <div
                className={`${limitFieldBaseClassName} w-fit cursor-text justify-end border-transparent text-right text-text-tertiary hover:border-border-strong/70 hover:text-system-blue`}
              >
                {displayMin.toFixed(2)}
              </div>
            </button>
          ) : (
            <div
              className={`${limitFieldBaseClassName} w-fit cursor-text justify-end border-transparent text-right text-text-tertiary hover:border-border-strong/70 hover:text-system-blue`}
            >
              −∞
            </div>
          )}
        </div>

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
            onInput={(e) => {
              handleSliderInput(parseFloat((e.target as HTMLInputElement).value));
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              handleSliderChangeStart('native-input');
            }}
            onPointerUp={(e) => {
              e.stopPropagation();
              handleSliderChangeEnd();
            }}
            onClick={(e) => e.stopPropagation()}
            className={`relative z-10 block ${sliderInputHeightClassName} w-full cursor-pointer appearance-none bg-transparent opacity-0`}
            style={{ accentColor: 'var(--ui-slider-accent)' }}
          />
        </div>

        <div
          className={`relative flex h-4 items-center justify-start ${limitFieldColumnWidthClassName}`}
          onClick={(e) => {
            if (!hasFiniteLimits) return;
            e.stopPropagation();
            setIsEditingUpper(true);
          }}
          onKeyDown={(e) => {
            if (
              !hasFiniteLimits ||
              e.target !== e.currentTarget ||
              (e.key !== 'Enter' && e.key !== ' ')
            ) {
              return;
            }
            e.preventDefault();
            e.stopPropagation();
            setIsEditingUpper(true);
          }}
          role={hasFiniteLimits ? 'button' : undefined}
          tabIndex={hasFiniteLimits ? -1 : undefined}
        >
          {hasFiniteLimits && isEditingUpper ? (
            <input
              ref={upperInputRef}
              type="text"
              value={upperInput}
              onChange={(e) => setUpperInput(e.target.value)}
              onBlur={(e) => handleLimitCommit('upper', e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleLimitCommit('upper', e.currentTarget.value);
              }}
              className={`absolute right-0 top-0 z-20 ${limitFieldBaseClassName} ${limitInputWidthClassName} border-border-strong bg-input-bg text-left text-text-primary outline-none focus:border-system-blue focus:ring-1 focus:ring-system-blue/20`}
            />
          ) : hasFiniteLimits ? (
            <button
              type="button"
              className="border-0 bg-transparent p-0"
              onClick={(e) => {
                e.stopPropagation();
                setIsEditingUpper(true);
              }}
            >
              <div
                className={`${limitFieldBaseClassName} w-fit cursor-text justify-start border-transparent text-left text-text-tertiary hover:border-border-strong/70 hover:text-system-blue`}
              >
                {displayMax.toFixed(2)}
              </div>
            </button>
          ) : (
            <div
              className={`${limitFieldBaseClassName} w-fit cursor-text justify-start border-transparent text-left text-text-tertiary hover:border-border-strong/70 hover:text-system-blue`}
            >
              ∞
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const JointControlItem = React.memo(JointControlItemComponent);
