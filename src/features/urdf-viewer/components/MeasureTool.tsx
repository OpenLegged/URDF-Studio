import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { MeasureToolProps } from '../types';
import {
  appendMeasurePoint,
  applyMeasurePick,
  clearActiveMeasureGroup,
  createMeasureTarget,
  getActiveMeasureGroup,
  getMeasureStateMeasurements,
  setMeasureHoverTarget,
  undoMeasureState,
} from '../utils/measurements';
import { resolveRobotMeasureTargetFromSelection } from '../utils/measureTargetResolvers';
import {
} from '../utils/measureLabelDrag';
import { throttle } from '@/shared/utils';
import {
  MeasurementItem,
  MeasurePreviewItem,
  MeasureTargetMarker,
} from './MeasureToolMarkers';
import {
  areSameTarget,
  EMPTY_MEASURE_SELECTION,
  getSelectionSignature,
  MEASURE_POINT_CLICK_DRAG_THRESHOLD_PX,
  MEASURE_POINT_ENDPOINT_COLOR,
  MEASURE_POINT_MOVE_THRESHOLD_PX,
  MEASURE_POINT_THROTTLE_MS,
  MEASURE_POINTER_IGNORE_SELECTORS,
  MEASURE_SELECTION_COLORS,
} from '../utils/measureToolPresentation';


export const MeasureTool: React.FC<MeasureToolProps> = ({
  active,
  robot,
  robotLinks,
  measureState,
  setMeasureState,
  measureAnchorMode,
  showDecomposition,
  deleteTooltip = 'Click to delete this measurement',
  measureTargetResolverRef,
  selection = EMPTY_MEASURE_SELECTION,
  hoveredSelection = EMPTY_MEASURE_SELECTION,
}) => {
  const { camera, gl } = useThree();
  const [hoveredMeasurementId, setHoveredMeasurementId] = useState<string | null>(null);
  const lastSelectionSignatureRef = useRef('none');
  const lastHoverSignatureRef = useRef('none');
  const wasActiveRef = useRef(active);
  const isPointMode = measureState.mode === 'point';
  // Latest measure state for the throttled point-mode pointer handlers (avoids stale closures).
  const measureStateRef = useRef(measureState);
  useEffect(() => {
    measureStateRef.current = measureState;
  }, [measureState]);
  const resolveMeasureTarget = useCallback(
    (nextSelection = selection, fallbackSelection = hoveredSelection) =>
      measureTargetResolverRef?.current?.(nextSelection, fallbackSelection, measureAnchorMode) ??
      resolveRobotMeasureTargetFromSelection(
        robot,
        robotLinks,
        nextSelection,
        fallbackSelection,
        measureAnchorMode,
      ),
    [hoveredSelection, measureAnchorMode, measureTargetResolverRef, robot, robotLinks, selection],
  );

  useEffect(() => {
    if (!active) {
      setHoveredMeasurementId(null);
      lastSelectionSignatureRef.current = getSelectionSignature(selection);
      lastHoverSignatureRef.current = getSelectionSignature(hoveredSelection);
      setMeasureState((prev) => {
        if (!prev.hoverTarget) {
          return prev;
        }

        return {
          ...prev,
          hoverTarget: null,
        };
      });
    }
  }, [active, hoveredSelection, selection, setMeasureState]);

  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = active;

    if (!active || wasActive) {
      return;
    }

    lastSelectionSignatureRef.current = getSelectionSignature(selection);
    lastHoverSignatureRef.current = getSelectionSignature(hoveredSelection);

    // Point mode seeds its hover target from raw raycasts, not the selection store.
    if (measureState.mode !== 'object') {
      return;
    }

    const target = resolveMeasureTarget(hoveredSelection, hoveredSelection);
    setMeasureState((prev) => {
      if (!target && !prev.hoverTarget) {
        return prev;
      }

      return setMeasureHoverTarget(prev, target);
    });
  }, [
    active,
    hoveredSelection,
    measureState.mode,
    resolveMeasureTarget,
    selection,
    setMeasureState,
  ]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const currentSelectionSignature = getSelectionSignature(selection);
    if (currentSelectionSignature === lastSelectionSignatureRef.current) {
      return;
    }

    lastSelectionSignatureRef.current = currentSelectionSignature;

    // Free-point mode never picks from the selection store; keep the signature
    // ref synced (above) so switching back to object mode does not replay a stale pick.
    if (measureState.mode !== 'object') {
      return;
    }

    const target = resolveMeasureTarget(selection, hoveredSelection);
    if (!target) {
      return;
    }

    setMeasureState((prev) => applyMeasurePick(prev, target));
  }, [
    active,
    robot,
    measureState.mode,
    selection,
    selection?.id,
    selection?.objectIndex,
    selection?.subType,
    selection?.type,
    selection?.helperKind,
    hoveredSelection,
    hoveredSelection?.id,
    hoveredSelection?.objectIndex,
    hoveredSelection?.subType,
    hoveredSelection?.type,
    hoveredSelection?.helperKind,
    resolveMeasureTarget,
    setMeasureState,
  ]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const currentHoverSignature = getSelectionSignature(hoveredSelection);
    if (currentHoverSignature === lastHoverSignatureRef.current) {
      return;
    }

    lastHoverSignatureRef.current = currentHoverSignature;

    if (measureState.mode !== 'object') {
      return;
    }

    const target = resolveMeasureTarget(hoveredSelection, hoveredSelection);

    setMeasureState((prev) => {
      if (!target && !prev.hoverTarget) {
        return prev;
      }

      return setMeasureHoverTarget(prev, target);
    });
  }, [
    active,
    measureState.mode,
    hoveredSelection,
    hoveredSelection?.id,
    hoveredSelection?.objectIndex,
    hoveredSelection?.subType,
    hoveredSelection?.type,
    hoveredSelection?.helperKind,
    resolveMeasureTarget,
    setMeasureState,
  ]);

  useEffect(() => {
    if (!active) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMeasureState((prev) => clearActiveMeasureGroup(prev));
        return;
      }

      if (event.key === 'Backspace' || event.key === 'Delete') {
        setMeasureState((prev) => undoMeasureState(prev));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, setMeasureState]);

  // Free-point mode: place raw surface points straight from the canvas, decoupled
  // from the selection pipeline (which is short-circuited for point mode upstream).
  useEffect(() => {
    if (!active || !isPointMode || !robot) {
      return;
    }

    const domElement = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let lastClientX = 0;
    let lastClientY = 0;
    let downClientX = 0;
    let downClientY = 0;

    const updatePointerFromEvent = (event: MouseEvent): boolean => {
      const rect = domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return false;
      }
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      return true;
    };

    const raycastRobotPoint = (): THREE.Vector3 | null => {
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(robot, true)[0];
      return hit ? hit.point.clone() : null;
    };

    const buildHoverTarget = (point: THREE.Vector3) =>
      createMeasureTarget({
        linkName: '',
        objectType: 'visual',
        objectIndex: 0,
        point,
        poseWorldMatrix: null,
        key: 'point:hover',
        label: 'P',
      });

    const handleMouseMoveCore = (event: MouseEvent) => {
      const dx = event.clientX - lastClientX;
      const dy = event.clientY - lastClientY;
      if (dx * dx + dy * dy < MEASURE_POINT_MOVE_THRESHOLD_PX * MEASURE_POINT_MOVE_THRESHOLD_PX) {
        return;
      }
      lastClientX = event.clientX;
      lastClientY = event.clientY;

      const activeGroup = getActiveMeasureGroup(measureStateRef.current);
      const hasExactlyOnePoint = Boolean(activeGroup.first) !== Boolean(activeGroup.second);
      if (!hasExactlyOnePoint) {
        // No in-progress pair → nothing to preview against.
        setMeasureState((prev) => (prev.hoverTarget ? setMeasureHoverTarget(prev, null) : prev));
        return;
      }

      const point = updatePointerFromEvent(event) ? raycastRobotPoint() : null;
      setMeasureState((prev) => {
        if (!point) {
          return prev.hoverTarget ? setMeasureHoverTarget(prev, null) : prev;
        }
        return setMeasureHoverTarget(prev, buildHoverTarget(point));
      });
    };

    const throttledMouseMove = throttle(handleMouseMoveCore, MEASURE_POINT_THROTTLE_MS);

    const handleMouseDown = (event: MouseEvent) => {
      downClientX = event.clientX;
      downClientY = event.clientY;
    };

    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0) {
        return;
      }
      const targetEl = event.target as HTMLElement | null;
      if (
        targetEl &&
        MEASURE_POINTER_IGNORE_SELECTORS.some((selector) => targetEl.closest(selector))
      ) {
        return;
      }
      // Ignore the click that ends an orbit drag.
      const ddx = event.clientX - downClientX;
      const ddy = event.clientY - downClientY;
      if (
        ddx * ddx + ddy * ddy >
        MEASURE_POINT_CLICK_DRAG_THRESHOLD_PX * MEASURE_POINT_CLICK_DRAG_THRESHOLD_PX
      ) {
        return;
      }
      if (!updatePointerFromEvent(event)) {
        return;
      }
      const point = raycastRobotPoint();
      if (!point) {
        return;
      }
      setMeasureState((prev) => appendMeasurePoint(prev, point));
    };

    domElement.addEventListener('mousemove', throttledMouseMove);
    domElement.addEventListener('mousedown', handleMouseDown);
    domElement.addEventListener('click', handleClick);

    return () => {
      throttledMouseMove.cancel();
      domElement.removeEventListener('mousemove', throttledMouseMove);
      domElement.removeEventListener('mousedown', handleMouseDown);
      domElement.removeEventListener('click', handleClick);
      // Drop any lingering point-mode preview when the handler tears down.
      setMeasureState((prev) => (prev.hoverTarget ? setMeasureHoverTarget(prev, null) : prev));
    };
  }, [active, isPointMode, robot, camera, gl, setMeasureState]);

  const handleDeleteMeasurement = useCallback(
    (measurementId: string) => {
      setMeasureState((prev) => {
        const targetGroup = prev.groups.find((group) => group.id === measurementId);
        if (!targetGroup) {
          return prev;
        }

        return clearActiveMeasureGroup({
          ...prev,
          activeGroupId: targetGroup.id,
        });
      });
    },
    [setMeasureState],
  );

  const measurements = useMemo(() => getMeasureStateMeasurements(measureState), [measureState]);
  const activeGroup = useMemo(() => getActiveMeasureGroup(measureState), [measureState]);
  const hoverBadge = activeGroup.activeSlot === 'second' ? '2' : '1';
  const firstMarkerTone = isPointMode
    ? MEASURE_POINT_ENDPOINT_COLOR
    : MEASURE_SELECTION_COLORS.first;
  const secondMarkerTone = isPointMode
    ? MEASURE_POINT_ENDPOINT_COLOR
    : MEASURE_SELECTION_COLORS.second;
  const shouldShowHoverMarker = Boolean(
    active &&
    measureState.hoverTarget &&
    !areSameTarget(measureState.hoverTarget, activeGroup.first) &&
    !areSameTarget(measureState.hoverTarget, activeGroup.second),
  );
  const shouldShowFirstMarker = active && Boolean(activeGroup.first) && !activeGroup.second;
  const shouldShowSecondMarker = active && Boolean(activeGroup.second) && !activeGroup.first;
  const previewTargets = useMemo(() => {
    if (!active || !measureState.hoverTarget) {
      return null;
    }

    if (
      activeGroup.first &&
      !activeGroup.second &&
      !areSameTarget(activeGroup.first, measureState.hoverTarget)
    ) {
      return {
        start: activeGroup.first,
        end: measureState.hoverTarget,
      };
    }

    if (
      activeGroup.second &&
      !activeGroup.first &&
      !areSameTarget(activeGroup.second, measureState.hoverTarget)
    ) {
      return {
        start: measureState.hoverTarget,
        end: activeGroup.second,
      };
    }

    return null;
  }, [active, activeGroup.first, activeGroup.second, measureState.hoverTarget]);

  return (
    <group>
      {shouldShowFirstMarker && activeGroup.first ? (
        <MeasureTargetMarker target={activeGroup.first} tone={firstMarkerTone} badge="1" />
      ) : null}
      {shouldShowSecondMarker && activeGroup.second ? (
        <MeasureTargetMarker target={activeGroup.second} tone={secondMarkerTone} badge="2" />
      ) : null}
      {shouldShowHoverMarker && measureState.hoverTarget ? (
        <MeasureTargetMarker
          target={measureState.hoverTarget}
          tone={MEASURE_SELECTION_COLORS.hover}
          badge={hoverBadge}
        />
      ) : null}
      {previewTargets ? (
        <MeasurePreviewItem
          start={previewTargets.start}
          end={previewTargets.end}
          showDecomposition={showDecomposition}
        />
      ) : null}
      {active &&
        measurements.map((measurement, index) => (
          <MeasurementItem
            key={measurement.id}
            measurement={measurement}
            measurementIndex={index}
            showDecomposition={showDecomposition}
            isHovered={hoveredMeasurementId === measurement.id}
            onHover={() => setHoveredMeasurementId(measurement.id)}
            onLeave={() => setHoveredMeasurementId(null)}
            onDelete={() => handleDeleteMeasurement(measurement.id)}
            deleteTooltip={deleteTooltip}
          />
        ))}
    </group>
  );
};
