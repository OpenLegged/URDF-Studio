import React, { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';

import type { MeasureToolProps } from '../types';
import { getMeasurementMetrics, type MeasureMeasurement } from '../utils/measurements';
import {
  buildDecompositionSegments,
  clamp,
  formatMeasurementDistance,
  formatSegmentLength,
  LABEL_OFFSET_PATTERN,
  MEASURE_AXIS_COLORS,
  MEASURE_AXIS_DASH_SIZE,
  MEASURE_AXIS_GAP_SIZE,
  MEASURE_AXIS_LABEL_DISTANCE_FACTOR,
  MEASURE_LABEL_Z_INDEX_RANGE,
  MEASURE_LINE_COLOR,
  MEASURE_MARKER_Z_INDEX_RANGE,
  MEASURE_POINT_ENDPOINT_COLOR,
  MEASURE_PREVIEW_LABEL_DISTANCE_FACTOR,
  MEASURE_PREVIEW_LINE_COLOR,
  MEASURE_RENDER_ORDER,
  MEASURE_TOTAL_LABEL_DISTANCE_FACTOR,
} from '../utils/measureToolPresentation';
import {
  resolveMeasureLabelDragOffset,
  type MeasureLabelScreenPoint,
} from '../utils/measureLabelDrag';

/**
 * Presentational leaves of the measure overlay.
 *
 * These only render what they are handed; all pointer handling, picking and
 * measure-state mutation stays in `MeasureTool.tsx`.
 */

export const MeasurePreviewItem = memo(
  ({
    start,
    end,
    showDecomposition,
  }: {
    start: NonNullable<MeasureToolProps['measureState']['hoverTarget']>;
    end: NonNullable<MeasureToolProps['measureState']['hoverTarget']>;
    showDecomposition: boolean;
  }) => {
    const metrics = useMemo(
      () => ({
        ...getMeasurementMetrics(start.point, end.point),
        first: { point: start.point },
        second: { point: end.point },
      }),
      [end.point, start.point],
    );
    const decompositionSegments = useMemo(
      () => buildDecompositionSegments(metrics as MeasureMeasurement),
      [metrics],
    );
    const midpoint = useMemo(
      () => new THREE.Vector3().addVectors(start.point, end.point).multiplyScalar(0.5),
      [end.point, start.point],
    );
    const labelPosition = useMemo(
      () =>
        midpoint.clone().add(new THREE.Vector3(0, clamp(metrics.distance * 0.1, 0.04, 0.065), 0)),
      [metrics.distance, midpoint],
    );

    return (
      <group>
        <Line
          points={[start.point, end.point]}
          color={MEASURE_PREVIEW_LINE_COLOR}
          lineWidth={1.6}
          dashed
          dashSize={0.026}
          gapSize={0.015}
          depthTest={false}
          depthWrite={false}
          transparent
          opacity={0.86}
          renderOrder={MEASURE_RENDER_ORDER + 1}
        />
        {showDecomposition &&
          decompositionSegments.map((segment) => (
            <Line
              key={`preview:${segment.axis}`}
              points={segment.points}
              color={MEASURE_AXIS_COLORS[segment.axis]}
              lineWidth={1.15}
              dashed
              dashSize={MEASURE_AXIS_DASH_SIZE}
              gapSize={MEASURE_AXIS_GAP_SIZE}
              depthTest={false}
              depthWrite={false}
              transparent
              opacity={0.72}
              renderOrder={MEASURE_RENDER_ORDER + 1}
            />
          ))}
        <Html
          center
          position={labelPosition}
          transform
          sprite
          distanceFactor={MEASURE_PREVIEW_LABEL_DISTANCE_FACTOR}
          className="pointer-events-none select-none"
          zIndexRange={MEASURE_LABEL_Z_INDEX_RANGE}
        >
          <div className="rounded-[7px] bg-slate-950/66 px-1.5 py-[3px] font-mono text-[10px] leading-none font-semibold whitespace-nowrap text-amber-50 shadow-[0_1px_8px_rgba(2,6,23,0.28)] [text-rendering:geometricPrecision]">
            {formatMeasurementDistance(metrics.distance)}
          </div>
        </Html>
      </group>
    );
  },
);

export const MeasureTargetMarker = memo(
  ({
    target,
    tone,
    badge,
  }: {
    target: NonNullable<MeasureToolProps['measureState']['hoverTarget']>;
    tone: string;
    badge: string;
  }) => {
    const outerRadius = badge === '2' ? 0.0032 : badge === '1' ? 0.0026 : 0.0024;
    const innerRadius = outerRadius * 0.45;
    const ringOpacity = badge === '2' ? 0.24 : 0.18;
    const dotSize = badge === '2' ? 11 : badge === '1' ? 10 : 9;

    return (
      <group>
        <mesh position={target.point} renderOrder={MEASURE_RENDER_ORDER + 4}>
          <sphereGeometry args={[outerRadius, 18, 18]} />
          <meshBasicMaterial
            color={tone}
            depthTest={false}
            depthWrite={false}
            transparent
            opacity={ringOpacity}
          />
        </mesh>
        <mesh position={target.point} renderOrder={MEASURE_RENDER_ORDER + 5}>
          <sphereGeometry args={[innerRadius, 18, 18]} />
          <meshBasicMaterial
            color={tone}
            depthTest={false}
            depthWrite={false}
            transparent
            opacity={0.96}
          />
        </mesh>
        <Html
          center
          position={target.point}
          className="pointer-events-none select-none"
          zIndexRange={MEASURE_MARKER_Z_INDEX_RANGE}
        >
          <span
            aria-hidden="true"
            className="block rounded-full border-2 border-white/95 shadow-[0_1px_8px_rgba(15,23,42,0.36)]"
            style={{
              width: dotSize,
              height: dotSize,
              backgroundColor: tone,
              boxShadow: `0 0 0 2px ${tone}38, 0 1px 8px rgba(15, 23, 42, 0.36)`,
            }}
          />
        </Html>
      </group>
    );
  },
);

export const MeasureEndpointMarker = memo(({ point }: { point: THREE.Vector3 }) => (
  <Html
    center
    position={point}
    className="pointer-events-none select-none"
    zIndexRange={MEASURE_MARKER_Z_INDEX_RANGE}
  >
    <span
      aria-hidden="true"
      className="block h-[11px] w-[11px] rounded-full border-2 border-white/95 shadow-[0_0_0_2px_rgba(239,68,68,0.25),0_1px_8px_rgba(15,23,42,0.36)]"
      style={{ backgroundColor: MEASURE_POINT_ENDPOINT_COLOR }}
    />
  </Html>
));

type MeasureAxis = 'x' | 'y' | 'z';
type MeasureLabelOffsets = Partial<Record<MeasureAxis, MeasureLabelScreenPoint>>;

const DraggableMeasureAxisLabel = memo(
  ({
    axis,
    text,
    offset,
    onOffsetChange,
  }: {
    axis: MeasureAxis;
    text: string;
    offset: MeasureLabelScreenPoint;
    onOffsetChange: (axis: MeasureAxis, offset: MeasureLabelScreenPoint) => void;
  }) => {
    const dragRef = useRef<{
      pointerId: number;
      pointerStart: MeasureLabelScreenPoint;
      initialOffset: MeasureLabelScreenPoint;
      screenScale: MeasureLabelScreenPoint;
    } | null>(null);

    const handlePointerDown = useCallback(
      (event: React.PointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const rect = event.currentTarget.getBoundingClientRect();
        dragRef.current = {
          pointerId: event.pointerId,
          pointerStart: { x: event.clientX, y: event.clientY },
          initialOffset: offset,
          screenScale: {
            x:
              event.currentTarget.offsetWidth > 0
                ? rect.width / event.currentTarget.offsetWidth
                : 1,
            y:
              event.currentTarget.offsetHeight > 0
                ? rect.height / event.currentTarget.offsetHeight
                : 1,
          },
        };
      },
      [offset],
    );

    const handlePointerMove = useCallback(
      (event: React.PointerEvent<HTMLButtonElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;

        event.preventDefault();
        event.stopPropagation();
        onOffsetChange(
          axis,
          resolveMeasureLabelDragOffset(
            drag.initialOffset,
            drag.pointerStart,
            {
              x: event.clientX,
              y: event.clientY,
            },
            drag.screenScale,
          ),
        );
      },
      [axis, onOffsetChange],
    );

    const finishDrag = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
      if (dragRef.current?.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      dragRef.current = null;
    }, []);

    return (
      <button
        type="button"
        data-measure-axis-label={axis}
        className="pointer-events-auto touch-none cursor-grab rounded-[7px] border-0 bg-slate-950/62 px-1.5 py-[3px] font-mono text-[9px] leading-none font-semibold whitespace-nowrap shadow-[0_1px_6px_rgba(2,6,23,0.24)] select-none active:cursor-grabbing [text-rendering:geometricPrecision]"
        style={{
          color: `${MEASURE_AXIS_COLORS[axis]}F2`,
          transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOffsetChange(axis, { x: 0, y: 0 });
        }}
        aria-label={text}
        title={text}
      >
        {text}
      </button>
    );
  },
);

export const MeasurementItem = memo(
  ({
    measurement,
    measurementIndex,
    showDecomposition,
    isHovered,
    onHover,
    onLeave,
    onDelete,
    deleteTooltip,
  }: {
    measurement: MeasureMeasurement;
    measurementIndex: number;
    showDecomposition: boolean;
    isHovered: boolean;
    onHover: () => void;
    onLeave: () => void;
    onDelete: () => void;
    deleteTooltip: string;
  }) => {
    const [decompositionLabelOffsets, setDecompositionLabelOffsets] = useState<MeasureLabelOffsets>(
      {},
    );
    const handleDecompositionLabelOffsetChange = useCallback(
      (axis: MeasureAxis, offset: MeasureLabelScreenPoint) => {
        setDecompositionLabelOffsets((current) => ({ ...current, [axis]: offset }));
      },
      [],
    );
    const midpoint = useMemo(
      () =>
        new THREE.Vector3()
          .addVectors(measurement.first.point, measurement.second.point)
          .multiplyScalar(0.5),
      [measurement.first.point, measurement.second.point],
    );
    const distance = useMemo(
      () => formatMeasurementDistance(measurement.distance),
      [measurement.distance],
    );
    const decompositionSegments = useMemo(
      () => buildDecompositionSegments(measurement),
      [measurement],
    );
    const labelLift = useMemo(
      () => clamp(measurement.distance * 0.07, 0.028, 0.05),
      [measurement.distance],
    );
    const labelOffset = useMemo(
      () =>
        LABEL_OFFSET_PATTERN[measurementIndex % LABEL_OFFSET_PATTERN.length]
          .clone()
          .multiplyScalar(labelLift * 1.25),
      [labelLift, measurementIndex],
    );
    const totalLabelPosition = useMemo(
      () =>
        midpoint
          .clone()
          .add(labelOffset)
          .add(new THREE.Vector3(0, labelLift * 1.7, 0)),
      [labelLift, labelOffset, midpoint],
    );
    const decompositionLabels = useMemo(
      () =>
        decompositionSegments.map((segment, index) => ({
          axis: segment.axis,
          text: `${segment.axis.toUpperCase()} ${formatSegmentLength(measurement.delta[segment.axis])}`,
          position: new THREE.Vector3()
            .addVectors(segment.points[0], segment.points[1])
            .multiplyScalar(0.5)
            .add(labelOffset.clone().multiplyScalar(0.28))
            .add(new THREE.Vector3(0, labelLift * (0.55 + index * 0.42), 0)),
        })),
      [decompositionSegments, labelLift, labelOffset, measurement.delta],
    );

    return (
      <group>
        <MeasureEndpointMarker point={measurement.first.point} />
        <MeasureEndpointMarker point={measurement.second.point} />
        <Line
          points={[measurement.first.point, measurement.second.point]}
          color={MEASURE_LINE_COLOR}
          lineWidth={2}
          depthTest={false}
          depthWrite={false}
          transparent
          opacity={0.96}
          renderOrder={MEASURE_RENDER_ORDER}
        />
        {showDecomposition &&
          decompositionSegments.map((segment) => (
            <Line
              key={`${measurement.id}:${segment.axis}`}
              points={segment.points}
              color={MEASURE_AXIS_COLORS[segment.axis]}
              lineWidth={1.35}
              dashed
              dashSize={MEASURE_AXIS_DASH_SIZE}
              gapSize={MEASURE_AXIS_GAP_SIZE}
              depthTest={false}
              depthWrite={false}
              transparent
              opacity={0.92}
              renderOrder={MEASURE_RENDER_ORDER + 1}
            />
          ))}
        {showDecomposition &&
          decompositionLabels.map((segmentLabel) => (
            <Html
              key={`${measurement.id}:label:${segmentLabel.axis}`}
              center
              position={segmentLabel.position}
              transform
              sprite
              distanceFactor={MEASURE_AXIS_LABEL_DISTANCE_FACTOR}
              pointerEvents="none"
              className="pointer-events-none select-none"
              zIndexRange={MEASURE_LABEL_Z_INDEX_RANGE}
            >
              <DraggableMeasureAxisLabel
                axis={segmentLabel.axis}
                text={segmentLabel.text}
                offset={decompositionLabelOffsets[segmentLabel.axis] ?? { x: 0, y: 0 }}
                onOffsetChange={handleDecompositionLabelOffsetChange}
              />
            </Html>
          ))}
        <Html
          center
          position={totalLabelPosition}
          transform
          sprite
          distanceFactor={MEASURE_TOTAL_LABEL_DISTANCE_FACTOR}
          pointerEvents="none"
          className="pointer-events-none select-none"
          zIndexRange={MEASURE_LABEL_Z_INDEX_RANGE}
        >
          <button
            type="button"
            className={`group pointer-events-auto flex cursor-pointer items-center gap-1 rounded-[7px] border-0 bg-slate-950/68 px-1.5 py-[3px] font-mono text-[10px] leading-none font-semibold whitespace-nowrap shadow-[0_1px_8px_rgba(2,6,23,0.28)] transition-colors [text-rendering:geometricPrecision] ${
              isHovered ? 'text-red-50' : 'text-red-100/96 hover:text-red-50'
            }`}
            onMouseEnter={onHover}
            onMouseLeave={onLeave}
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            title={deleteTooltip}
            aria-label={deleteTooltip}
          >
            {distance}
            <svg
              className={`h-2.5 w-2.5 transition-opacity ${isHovered ? 'opacity-100' : 'opacity-0'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </Html>
      </group>
    );
  },
);