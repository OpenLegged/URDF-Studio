import * as THREE from 'three';

import type { MeasureToolProps, ViewerProps } from '../types';
import type { MeasureMeasurement } from './measurements';

/**
 * Presentation constants and pure helpers for the measure overlay.
 *
 * Split out of `MeasureTool.tsx` because none of it touches React state or the
 * r3f scene; keeping it here lets the component file stay about interaction.
 */
export const EMPTY_MEASURE_SELECTION: NonNullable<ViewerProps['selection']> = {
  type: null,
  id: null,
};

// Point-mode pointer tuning (mirrors the classic free-point measure tool).
export const MEASURE_POINT_THROTTLE_MS = 33;
export const MEASURE_POINT_MOVE_THRESHOLD_PX = 2;
// A press that travels further than this between down and up is an orbit drag, not a placement click.
export const MEASURE_POINT_CLICK_DRAG_THRESHOLD_PX = 5;
// Click targets inside these containers must not place a measurement point.
export const MEASURE_POINTER_IGNORE_SELECTORS = [
  '.urdf-toolbar',
  '.urdf-options-panel',
  '.urdf-joint-panel',
  '.measure-context-menu',
  '.measure-panel',
];

export const MEASURE_LINE_COLOR = '#ef4444';
export const MEASURE_AXIS_COLORS = {
  x: '#f97316',
  y: '#22c55e',
  z: '#3b82f6',
} as const;
export const MEASURE_AXIS_EPSILON = 1e-6;
export const MEASURE_RENDER_ORDER = 2400;
export const MEASURE_LABEL_Z_INDEX_RANGE: [number, number] = [120, 0];
export const MEASURE_TOTAL_LABEL_DISTANCE_FACTOR = 1.05;
export const MEASURE_AXIS_LABEL_DISTANCE_FACTOR = 0.95;
export const MEASURE_AXIS_DASH_SIZE = 0.03;
export const MEASURE_AXIS_GAP_SIZE = 0.018;
export const MEASURE_SELECTION_COLORS = {
  first: '#0ea5e9',
  second: '#10b981',
  hover: '#f59e0b',
} as const;
export const MEASURE_POINT_ENDPOINT_COLOR = MEASURE_LINE_COLOR;
export const MEASURE_MARKER_Z_INDEX_RANGE: [number, number] = [132, 0];
export const MEASURE_PREVIEW_LINE_COLOR = '#f59e0b';
export const MEASURE_PREVIEW_LABEL_DISTANCE_FACTOR = 0.95;
export const SCENE_LABEL_DECIMALS = 2;
export const LABEL_OFFSET_PATTERN = [
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(1, 0.45, 0),
  new THREE.Vector3(-1, 0.75, 0),
  new THREE.Vector3(0.85, -0.1, 0),
  new THREE.Vector3(-0.85, 0.15, 0),
  new THREE.Vector3(0, -0.55, 0),
];

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
export function getSelectionSignature(selection?: ViewerProps['selection']): string {
  if (!selection?.type || !selection?.id) {
    return 'none';
  }

  return [
    selection.type,
    selection.id,
    selection.subType ?? 'none',
    selection.objectIndex ?? -1,
    selection.helperKind ?? 'none',
  ].join(':');
}

export function buildDecompositionSegments(
  measurement: MeasureMeasurement,
): Array<{ axis: 'x' | 'y' | 'z'; points: [THREE.Vector3, THREE.Vector3] }> {
  const start = measurement.first.point;
  const end = measurement.second.point;
  const afterX = new THREE.Vector3(end.x, start.y, start.z);
  const afterY = new THREE.Vector3(end.x, end.y, start.z);

  const segments: Array<{ axis: 'x' | 'y' | 'z'; points: [THREE.Vector3, THREE.Vector3] }> = [];

  if (Math.abs(measurement.delta.x) > MEASURE_AXIS_EPSILON) {
    segments.push({ axis: 'x', points: [start, afterX] });
  }

  if (Math.abs(measurement.delta.y) > MEASURE_AXIS_EPSILON) {
    segments.push({ axis: 'y', points: [afterX, afterY] });
  }

  if (Math.abs(measurement.delta.z) > MEASURE_AXIS_EPSILON) {
    segments.push({ axis: 'z', points: [afterY, end] });
  }

  return segments;
}

export function formatSegmentLength(value: number): string {
  return `${Math.abs(value).toFixed(SCENE_LABEL_DECIMALS)}m`;
}

export function formatMeasurementDistance(value: number): string {
  return `${value.toFixed(SCENE_LABEL_DECIMALS)}m`;
}

export function areSameTarget(
  left: MeasureToolProps['measureState']['hoverTarget'],
  right: MeasureToolProps['measureState']['hoverTarget'],
): boolean {
  if (!left || !right) {
    return false;
  }

  return (
    left.key === right.key &&
    left.objectType === right.objectType &&
    left.objectIndex === right.objectIndex &&
    left.point.distanceToSquared(right.point) <= 1e-12
  );
}
