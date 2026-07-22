import { useCallback, useEffect, useRef, useState } from 'react';

const NUMBER_INPUT_SCRUB_PIXELS_PER_STEP = 4;

interface HorizontalNumberScrubOptions {
  applyStepDelta: (stepCount: number) => void;
  collapseInputSelection: () => void;
  onPointerDown: () => void;
  onPointerEnd: () => void;
}

/** Owns pointer capture and document selection state for drag-to-adjust number inputs. */
export function useHorizontalNumberScrub({
  applyStepDelta,
  collapseInputSelection,
  onPointerDown,
  onPointerEnd,
}: HorizontalNumberScrubOptions) {
  const [isScrubbing, setIsScrubbing] = useState(false);
  const isScrubbingRef = useRef(false);
  const scrubRef = useRef<{
    input: HTMLInputElement;
    lastStepOffset: number;
    pointerId: number;
    startX: number;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const previousBodyUserSelectRef = useRef<string | null>(null);

  const restoreBodySelection = useCallback(() => {
    if (previousBodyUserSelectRef.current === null) {
      return;
    }

    document.body.style.userSelect = previousBodyUserSelectRef.current;
    previousBodyUserSelectRef.current = null;
  }, []);

  const finishScrub = useCallback(
    (input?: HTMLInputElement, pointerId?: number) => {
      const activeScrub = scrubRef.current;
      if (!activeScrub || (pointerId !== undefined && activeScrub.pointerId !== pointerId)) {
        return;
      }

      const activeInput = input ?? activeScrub.input;
      if (activeInput.hasPointerCapture?.(activeScrub.pointerId)) {
        activeInput.releasePointerCapture(activeScrub.pointerId);
      }

      scrubRef.current = null;
      isScrubbingRef.current = false;
      restoreBodySelection();
      setIsScrubbing(false);
    },
    [restoreBodySelection],
  );

  useEffect(
    () => () => {
      scrubRef.current = null;
      isScrubbingRef.current = false;
      restoreBodySelection();
    },
    [restoreBodySelection],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLInputElement>) => {
      onPointerDown();
      if (event.button !== 0 || event.pointerType === 'touch') {
        return;
      }

      suppressClickRef.current = false;
      scrubRef.current = {
        input: event.currentTarget,
        lastStepOffset: 0,
        pointerId: event.pointerId,
        startX: event.clientX,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [onPointerDown],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLInputElement>) => {
      const activeScrub = scrubRef.current;
      if (!activeScrub || activeScrub.pointerId !== event.pointerId) {
        return;
      }

      const stepOffset = Math.trunc(
        (event.clientX - activeScrub.startX) / NUMBER_INPUT_SCRUB_PIXELS_PER_STEP,
      );
      if (stepOffset === activeScrub.lastStepOffset) {
        return;
      }

      if (!isScrubbingRef.current) {
        isScrubbingRef.current = true;
        previousBodyUserSelectRef.current = document.body.style.userSelect;
        document.body.style.userSelect = 'none';
        window.getSelection()?.removeAllRanges();
        collapseInputSelection();
        suppressClickRef.current = true;
        setIsScrubbing(true);
      }

      event.preventDefault();
      const stepDelta = stepOffset - activeScrub.lastStepOffset;
      activeScrub.lastStepOffset = stepOffset;
      applyStepDelta(stepDelta);
    },
    [applyStepDelta, collapseInputSelection],
  );

  const handlePointerEnd = useCallback(
    (event: React.PointerEvent<HTMLInputElement>) => {
      finishScrub(event.currentTarget, event.pointerId);
      onPointerEnd();
    },
    [finishScrub, onPointerEnd],
  );

  const handleClick = useCallback((event: React.MouseEvent<HTMLInputElement>) => {
    if (!suppressClickRef.current) {
      return;
    }

    event.preventDefault();
    suppressClickRef.current = false;
  }, []);

  return {
    isScrubbing,
    scrubInputProps: {
      'data-number-scrubbable': 'true',
      onClick: handleClick,
      onLostPointerCapture: handlePointerEnd,
      onPointerCancel: handlePointerEnd,
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerEnd,
    },
  };
}
