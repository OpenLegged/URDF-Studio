import { useCallback, useEffect, useRef, useState } from 'react';

import { normalizeJointLimitOrder } from '@/core/robot';
import {
  fromJointDisplayValue,
  hasEffectivelyFiniteJointLimits,
  supportsFiniteJointLimits,
  type JointAngleUnit,
} from '@/shared/utils/jointUnits';
import type { EditableJointNumberField } from './jointControlFieldTypes';
import type { JointControlItemJoint, JointControlItemProps } from './jointControlItemTypes';
import { useFocusInputWhenEditing } from './useFocusInputWhenEditing';

interface JointLimitDraft {
  lower?: number;
  upper?: number;
  effort?: number;
  velocity?: number;
}

interface UseJointLimitEditingOptions {
  joint: JointControlItemJoint;
  jointType: string;
  name: string;
  value: number;
  angleUnit: JointAngleUnit;
  handleJointAngleChange: JointControlItemProps['handleJointAngleChange'];
  handleJointChangeCommit: JointControlItemProps['handleJointChangeCommit'];
  onUpdate: JointControlItemProps['onUpdate'];
}

interface JointLimitEditingResult {
  localLimits: JointLimitDraft;
  orderedLimits: JointLimitDraft;
  hasFiniteLimits: boolean;
  lowerEditor: EditableJointNumberField;
  upperEditor: EditableJointNumberField;
  effortEditor: EditableJointNumberField;
  velocityEditor: EditableJointNumberField;
}

function formatLimitInputValue(limitValue: number | undefined): string {
  return Number.isFinite(limitValue) ? Number(limitValue).toFixed(2) : '';
}

function createJointLimitDraft(limit: JointLimitDraft): JointLimitDraft {
  return normalizeJointLimitOrder({
    lower: limit?.lower,
    upper: limit?.upper,
    effort: limit?.effort,
    velocity: limit?.velocity,
  });
}

function buildFiniteLimitPatch(limits: JointLimitDraft): JointLimitDraft {
  return {
    ...(typeof limits.lower === 'number' && Number.isFinite(limits.lower)
      ? { lower: limits.lower }
      : {}),
    ...(typeof limits.upper === 'number' && Number.isFinite(limits.upper)
      ? { upper: limits.upper }
      : {}),
    ...(typeof limits.effort === 'number' && Number.isFinite(limits.effort)
      ? { effort: limits.effort }
      : {}),
    ...(typeof limits.velocity === 'number' && Number.isFinite(limits.velocity)
      ? { velocity: limits.velocity }
      : {}),
  };
}

/** Owns authored limit drafts, clamping side effects, and commit-on-outside-click editing. */
export function useJointLimitEditing({
  joint,
  jointType,
  name,
  value,
  angleUnit,
  handleJointAngleChange,
  handleJointChangeCommit,
  onUpdate,
}: UseJointLimitEditingOptions): JointLimitEditingResult {
  const limit = joint.limit;
  const [localLimits, setLocalLimits] = useState<JointLimitDraft>(() =>
    createJointLimitDraft({
      lower: limit?.lower,
      upper: limit?.upper,
      effort: limit?.effort,
      velocity: limit?.velocity,
    }),
  );

  useEffect(() => {
    setLocalLimits(
      createJointLimitDraft({
        lower: limit?.lower,
        upper: limit?.upper,
        effort: limit?.effort,
        velocity: limit?.velocity,
      }),
    );
  }, [joint.id, limit?.lower, limit?.upper, limit?.effort, limit?.velocity]);

  const orderedLimits = normalizeJointLimitOrder(localLimits);
  const hasFiniteLimits =
    supportsFiniteJointLimits(jointType) && hasEffectivelyFiniteJointLimits(orderedLimits);

  const [isEditingLower, setIsEditingLower] = useState(false);
  const [isEditingUpper, setIsEditingUpper] = useState(false);
  const [isEditingEffort, setIsEditingEffort] = useState(false);
  const [isEditingVelocity, setIsEditingVelocity] = useState(false);
  const lowerInputRef = useRef<HTMLInputElement>(null);
  const upperInputRef = useRef<HTMLInputElement>(null);
  const effortInputRef = useRef<HTMLInputElement>(null);
  const velocityInputRef = useRef<HTMLInputElement>(null);
  const [lowerInput, setLowerInput] = useState(formatLimitInputValue(orderedLimits.lower));
  const [upperInput, setUpperInput] = useState(formatLimitInputValue(orderedLimits.upper));
  const [effortInput, setEffortInput] = useState(formatLimitInputValue(localLimits.effort));
  const [velocityInput, setVelocityInput] = useState(formatLimitInputValue(localLimits.velocity));

  useFocusInputWhenEditing(lowerInputRef, isEditingLower);
  useFocusInputWhenEditing(upperInputRef, isEditingUpper);
  useFocusInputWhenEditing(effortInputRef, isEditingEffort);
  useFocusInputWhenEditing(velocityInputRef, isEditingVelocity);

  useEffect(() => {
    if (!isEditingLower) setLowerInput(formatLimitInputValue(orderedLimits.lower));
  }, [orderedLimits.lower, isEditingLower]);

  useEffect(() => {
    if (!isEditingUpper) setUpperInput(formatLimitInputValue(orderedLimits.upper));
  }, [orderedLimits.upper, isEditingUpper]);

  useEffect(() => {
    if (!isEditingEffort) setEffortInput(formatLimitInputValue(localLimits.effort));
  }, [localLimits.effort, isEditingEffort]);

  useEffect(() => {
    if (!isEditingVelocity) setVelocityInput(formatLimitInputValue(localLimits.velocity));
  }, [localLimits.velocity, isEditingVelocity]);

  const updateLimit = useCallback(
    (key: 'lower' | 'upper' | 'effort' | 'velocity', nextValue: number) => {
      const newLimits: JointLimitDraft = normalizeJointLimitOrder({
        ...localLimits,
        [key]: nextValue,
      });
      setLocalLimits(newLimits);

      if ((key === 'lower' || key === 'upper') && hasEffectivelyFiniteJointLimits(newLimits)) {
        const clampedValue = Math.min(Math.max(value, newLimits.lower), newLimits.upper);
        if (Math.abs(clampedValue - value) > 1e-9) {
          handleJointAngleChange(name, clampedValue);
          handleJointChangeCommit(name, clampedValue);
        }
      }

      const jointId = name || (joint.id == null ? '' : String(joint.id));
      if (!jointId) {
        return;
      }

      onUpdate?.('joint', jointId, { limit: buildFiniteLimitPatch(newLimits) });
    },
    [handleJointAngleChange, handleJointChangeCommit, joint.id, localLimits, name, onUpdate, value],
  );

  const commitLower = useCallback(
    (input: string) => {
      if (!hasFiniteLimits) {
        setIsEditingLower(false);
        return;
      }

      const parsedValue = parseFloat(input);
      if (!Number.isNaN(parsedValue)) {
        updateLimit('lower', fromJointDisplayValue(parsedValue, jointType, angleUnit));
      }
      setIsEditingLower(false);
    },
    [angleUnit, hasFiniteLimits, jointType, updateLimit],
  );

  const commitUpper = useCallback(
    (input: string) => {
      if (!hasFiniteLimits) {
        setIsEditingUpper(false);
        return;
      }

      const parsedValue = parseFloat(input);
      if (!Number.isNaN(parsedValue)) {
        updateLimit('upper', fromJointDisplayValue(parsedValue, jointType, angleUnit));
      }
      setIsEditingUpper(false);
    },
    [angleUnit, hasFiniteLimits, jointType, updateLimit],
  );

  const commitEffort = useCallback(
    (input: string) => {
      const parsedValue = parseFloat(input);
      if (!Number.isNaN(parsedValue)) {
        updateLimit('effort', parsedValue);
      }
      setIsEditingEffort(false);
    },
    [updateLimit],
  );

  const commitVelocity = useCallback(
    (input: string) => {
      const parsedValue = parseFloat(input);
      if (!Number.isNaN(parsedValue)) {
        updateLimit('velocity', parsedValue);
      }
      setIsEditingVelocity(false);
    },
    [updateLimit],
  );

  const commitOpenEditors = useCallback(() => {
    if (isEditingLower) commitLower(lowerInputRef.current?.value ?? lowerInput);
    if (isEditingUpper) commitUpper(upperInputRef.current?.value ?? upperInput);
    if (isEditingEffort) commitEffort(effortInputRef.current?.value ?? effortInput);
    if (isEditingVelocity) commitVelocity(velocityInputRef.current?.value ?? velocityInput);
  }, [
    commitEffort,
    commitLower,
    commitUpper,
    commitVelocity,
    effortInput,
    isEditingEffort,
    isEditingLower,
    isEditingUpper,
    isEditingVelocity,
    lowerInput,
    upperInput,
    velocityInput,
  ]);

  useEffect(() => {
    if (!isEditingLower && !isEditingUpper && !isEditingEffort && !isEditingVelocity) {
      return;
    }

    const handlePointerDownCapture = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;

      const activeInputs = [
        isEditingLower ? lowerInputRef.current : null,
        isEditingUpper ? upperInputRef.current : null,
        isEditingEffort ? effortInputRef.current : null,
        isEditingVelocity ? velocityInputRef.current : null,
      ].filter((input): input is HTMLInputElement => input instanceof HTMLInputElement);

      if (!activeInputs.some((input) => input.contains(target))) {
        commitOpenEditors();
      }
    };

    document.addEventListener('pointerdown', handlePointerDownCapture, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDownCapture, true);
    };
  }, [commitOpenEditors, isEditingEffort, isEditingLower, isEditingUpper, isEditingVelocity]);

  return {
    localLimits,
    orderedLimits,
    hasFiniteLimits,
    lowerEditor: {
      inputRef: lowerInputRef,
      inputValue: lowerInput,
      setInputValue: setLowerInput,
      isEditing: isEditingLower,
      beginEditing: () => setIsEditingLower(true),
      commit: commitLower,
    },
    upperEditor: {
      inputRef: upperInputRef,
      inputValue: upperInput,
      setInputValue: setUpperInput,
      isEditing: isEditingUpper,
      beginEditing: () => setIsEditingUpper(true),
      commit: commitUpper,
    },
    effortEditor: {
      inputRef: effortInputRef,
      inputValue: effortInput,
      setInputValue: setEffortInput,
      isEditing: isEditingEffort,
      beginEditing: () => setIsEditingEffort(true),
      commit: commitEffort,
    },
    velocityEditor: {
      inputRef: velocityInputRef,
      inputValue: velocityInput,
      setInputValue: setVelocityInput,
      isEditing: isEditingVelocity,
      beginEditing: () => setIsEditingVelocity(true),
      commit: commitVelocity,
    },
  };
}
