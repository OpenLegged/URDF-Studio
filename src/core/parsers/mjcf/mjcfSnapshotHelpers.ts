import * as THREE from 'three';
import path from 'node:path';
import type { ParsedMJCFModel } from './mjcfModel';
import {
  canonicalizeMjcfFromToGeom,
  createMuJoCoFromToQuaternion,
  diagonalizeMjcfSymmetric3x3,
  mjcfQuatTupleFromQuaternion,
  normalizeMjcfQuatTuple,
  type MJCFSymmetric3x3,
} from './mjcfMath';

export interface CanonicalMJCFGeom {
  key: string;
  name: string | null;
  bodyKey: string;
  type: string;
  size: number[];
  mesh: string | null;
  material: string | null;
  mass: number | null;
  pos: [number, number, number] | null;
  quat: [number, number, number, number] | null;
  rgba: [number, number, number, number] | null;
  group: number | null;
  contype: number | null;
  conaffinity: number | null;
}

export interface CanonicalMJCFBody {
  key: string;
  name: string | null;
  parentKey: string | null;
  path: string;
  pos: [number, number, number];
  quat: [number, number, number, number] | null;
  mass: number | null;
  inertialPos: [number, number, number] | null;
  inertialQuat: [number, number, number, number] | null;
  inertia: [number, number, number] | null;
  fullinertia: [number, number, number, number, number, number] | null;
}

export const NUMBER_PRECISION = 6;

export const EPSILON = 1e-5;

export const RELAXED_NUMERIC_EPSILON = 1e-4;

export const AXISYMMETRIC_GEOM_AXIS_DOT_TOLERANCE = Math.cos(THREE.MathUtils.degToRad(1));

export const DEFAULT_MATERIAL_RGBA: [number, number, number, number] = [1, 1, 1, 1];

export const GEOM_SIZE_ARITY_BY_TYPE: Record<string, number> = {
  sphere: 1,
  capsule: 2,
  cylinder: 2,
  box: 3,
  ellipsoid: 3,
  plane: 3,
};

export function roundNumber(value: number): number {
  return Number(value.toFixed(NUMBER_PRECISION));
}

export function normalizeVector(
  value: number[] | undefined | null,
  length: number,
): number[] | null {
  if (!value || value.length === 0) {
    return null;
  }

  const normalized: number[] = [];
  for (let index = 0; index < length; index += 1) {
    normalized.push(roundNumber(value[index] ?? 0));
  }
  return normalized;
}

export function normalizeUnitVector(
  value: number[] | undefined | null,
  length: number,
): number[] | null {
  if (!value || value.length === 0) {
    return null;
  }

  const raw: number[] = [];
  for (let index = 0; index < length; index += 1) {
    raw.push(value[index] ?? 0);
  }

  const magnitude = Math.hypot(...raw);
  if (magnitude <= 1e-8) {
    return raw.map((entry) => roundNumber(entry));
  }

  return raw.map((entry) => roundNumber(entry / magnitude));
}

export function normalizeQuatFromEuler(
  euler: number[] | undefined,
  angleUnit: 'radian' | 'degree',
): [number, number, number, number] | null {
  if (!euler || euler.length < 3) {
    return null;
  }

  const [x, y, z] = euler;
  const eulerValue = new THREE.Euler(
    angleUnit === 'degree' ? THREE.MathUtils.degToRad(x ?? 0) : (x ?? 0),
    angleUnit === 'degree' ? THREE.MathUtils.degToRad(y ?? 0) : (y ?? 0),
    angleUnit === 'degree' ? THREE.MathUtils.degToRad(z ?? 0) : (z ?? 0),
    'XYZ',
  );
  const quaternion = new THREE.Quaternion().setFromEuler(eulerValue);
  return [
    roundNumber(quaternion.w),
    roundNumber(quaternion.x),
    roundNumber(quaternion.y),
    roundNumber(quaternion.z),
  ];
}

export function normalizeQuat(
  value: number[] | undefined | null,
): [number, number, number, number] | null {
  return normalizeMjcfQuatTuple(value, { precision: NUMBER_PRECISION });
}

export function normalizePos(value: number[] | undefined | null): [number, number, number] {
  return (normalizeVector(value, 3) || [0, 0, 0]) as [number, number, number];
}

export function normalizeNumber(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(value)) {
    return null;
  }
  return roundNumber(value);
}

export function normalizeScale(value: number[] | undefined | null): number[] {
  const normalized = normalizeVector(value, 3);
  if (!normalized) {
    return [1, 1, 1];
  }

  return [normalized[0] ?? 1, normalized[1] ?? 1, normalized[2] ?? 1];
}

export function normalizeGeomRGBA(
  value: number[] | undefined | null,
): [number, number, number, number] {
  const normalized = normalizeVector(value, 4);
  if (!normalized) {
    return [0.5, 0.5, 0.5, 1];
  }

  return [normalized[0] ?? 0.5, normalized[1] ?? 0.5, normalized[2] ?? 0.5, normalized[3] ?? 1];
}

export function quaternionToMjcfTuple(
  quaternion: THREE.Quaternion,
): [number, number, number, number] {
  return mjcfQuatTupleFromQuaternion(quaternion, { precision: NUMBER_PRECISION });
}

export function normalizeQuaternionFromDirection(
  direction: THREE.Vector3,
): [number, number, number, number] {
  if (direction.lengthSq() <= 1e-12) {
    return [1, 0, 0, 0];
  }

  const quaternion = createMuJoCoFromToQuaternion(direction);
  return quaternionToMjcfTuple(quaternion);
}

export function canonicalizeFromToGeom(
  geom: Pick<ParsedMJCFModel['worldBody']['geoms'][number], 'type' | 'size' | 'fromto'>,
): {
  pos: [number, number, number];
  quat: [number, number, number, number];
  size: number[];
} | null {
  return canonicalizeMjcfFromToGeom(geom, { precision: NUMBER_PRECISION });
}

export function diagonalizeFullInertia(
  fullinertia: [number, number, number, number, number, number] | null | undefined,
  boundInertia: number | undefined = undefined,
): {
  diaginertia: [number, number, number];
  quat: [number, number, number, number];
} | null {
  if (!fullinertia || fullinertia.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const matrix: MJCFSymmetric3x3 = [
    [fullinertia[0], fullinertia[3], fullinertia[4]],
    [fullinertia[3], fullinertia[1], fullinertia[5]],
    [fullinertia[4], fullinertia[5], fullinertia[2]],
  ];
  const diagonalized = diagonalizeMjcfSymmetric3x3(matrix, { precision: NUMBER_PRECISION });
  if (!diagonalized) {
    return null;
  }

  const effectiveBoundInertia =
    boundInertia != null && Number.isFinite(boundInertia) ? Math.max(boundInertia, 0) : 0;

  return {
    diaginertia: diagonalized.values.map((value) =>
      roundNumber(Math.max(value, effectiveBoundInertia)),
    ) as [number, number, number],
    quat: diagonalized.quat,
  };
}

export function quaternionsEqual(
  left: [number, number, number, number] | null | undefined,
  right: [number, number, number, number] | null | undefined,
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  if (arraysEqual(left, right)) {
    return true;
  }

  return arraysEqual(
    left.map((value) => -value),
    right,
  );
}

export function axisymmetricGeomOrientationsEqual(
  geomType: string,
  left: [number, number, number, number] | null | undefined,
  right: [number, number, number, number] | null | undefined,
): boolean {
  if (quaternionsEqual(left, right)) {
    return true;
  }

  if (geomType !== 'capsule' && geomType !== 'cylinder') {
    return false;
  }

  if (!left || !right) {
    return false;
  }

  const leftAxis = new THREE.Vector3(0, 0, -1)
    .applyQuaternion(new THREE.Quaternion(left[1], left[2], left[3], left[0]).normalize())
    .normalize();
  const rightAxis = new THREE.Vector3(0, 0, -1)
    .applyQuaternion(new THREE.Quaternion(right[1], right[2], right[3], right[0]).normalize())
    .normalize();

  return Math.abs(leftAxis.dot(rightAxis)) >= AXISYMMETRIC_GEOM_AXIS_DOT_TOLERANCE;
}

export function normalizeRange(
  value: number[] | undefined | null,
  angleUnit: 'radian' | 'degree',
): [number, number] | null {
  if (!value || value.length === 0) {
    return null;
  }

  const lower = value[0] ?? 0;
  const upper = value[1] ?? 0;
  const normalized =
    angleUnit === 'degree'
      ? [THREE.MathUtils.degToRad(lower), THREE.MathUtils.degToRad(upper)]
      : [lower, upper];
  return [roundNumber(normalized[0]), roundNumber(normalized[1])];
}

export function trimTrailingZeros(values: number[] | null): number[] | null {
  if (!values) {
    return null;
  }

  const trimmed = [...values];
  while (trimmed.length > 0 && nearlyEqual(trimmed[trimmed.length - 1], 0)) {
    trimmed.pop();
  }
  return trimmed;
}

export function canonicalizeGeomSize(type: string, value: number[] | null | undefined): number[] {
  const trimmed = trimTrailingZeros(value ? value.map((entry) => roundNumber(entry)) : null) || [];
  const arity = GEOM_SIZE_ARITY_BY_TYPE[type];
  if (!arity) {
    return trimmed;
  }

  return trimmed.slice(0, arity);
}

export function normalizeOracleJointType(value: string | undefined | null): string {
  const normalized = (value || 'hinge')
    .replace(/^mjt[A-Za-z]+_/, '')
    .replace(/^mjJNT_/, '')
    .toLowerCase();
  return normalized || 'hinge';
}

export function normalizeOracleGeomType(value: string | undefined | null): string {
  const normalized = (value || 'sphere')
    .replace(/^mjt[A-Za-z]+_/, '')
    .replace(/^mjGEOM_/, '')
    .toLowerCase();
  return normalized || 'sphere';
}

export function normalizeMeshFile(file: string | null | undefined): string | null {
  if (!file) {
    return null;
  }

  return path.posix.basename(file.replace(/\\/g, '/'));
}

export function bodyKeyFromName(name: string | null | undefined, path: string): string {
  return name?.trim() || path;
}

export function jointKeyFromName(name: string | null | undefined, fallback: string): string {
  return name?.trim() || fallback;
}

export function geomKeyFromName(name: string | null | undefined, fallback: string): string {
  return name?.trim() || fallback;
}

export function normalizeOracleAngleUnit(value: unknown): 'radian' | 'degree' {
  const normalized = String(value || '').toLowerCase();
  if (!normalized) {
    return 'degree';
  }
  return normalized.includes('degree') ? 'degree' : 'radian';
}

export function nearlyEqual(
  left: number | null | undefined,
  right: number | null | undefined,
  tolerance: number = EPSILON,
): boolean {
  if (left == null && right == null) {
    return true;
  }
  if (left == null || right == null) {
    return false;
  }
  return Math.abs(left - right) <= tolerance;
}

export function arraysEqual(
  left: number[] | null | undefined,
  right: number[] | null | undefined,
  tolerance: number = EPSILON,
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => nearlyEqual(value, right[index], tolerance));
}

export function optionalMassesEqual(
  left: number | null | undefined,
  right: number | null | undefined,
): boolean {
  if (left == null && right == null) {
    return true;
  }

  const normalizedLeft = left ?? 0;
  const normalizedRight = right ?? 0;
  return nearlyEqual(normalizedLeft, normalizedRight, RELAXED_NUMERIC_EPSILON);
}

export function applyBoundInertia(
  inertia: [number, number, number] | null | undefined,
  boundInertia: number | undefined,
): [number, number, number] | null {
  if (!inertia) {
    return null;
  }

  const effectiveBoundInertia =
    boundInertia != null && Number.isFinite(boundInertia) ? Math.max(boundInertia, 0) : 0;

  return [
    roundNumber(Math.max(inertia[0], effectiveBoundInertia)),
    roundNumber(Math.max(inertia[1], effectiveBoundInertia)),
    roundNumber(Math.max(inertia[2], effectiveBoundInertia)),
  ];
}

export function bodyHasExplicitInertial(body: CanonicalMJCFBody | null | undefined): boolean {
  if (!body) {
    return false;
  }

  return (
    body.mass != null ||
    body.inertialPos != null ||
    body.inertialQuat != null ||
    body.inertia != null ||
    body.fullinertia != null
  );
}

export function geomMassesEqual(
  leftGeom: CanonicalMJCFGeom,
  rightGeom: CanonicalMJCFGeom,
  leftBody: CanonicalMJCFBody | null | undefined,
  rightBody: CanonicalMJCFBody | null | undefined,
): boolean {
  if (optionalMassesEqual(leftGeom.mass, rightGeom.mass)) {
    return true;
  }

  // MuJoCo canonicalizes per-geom mass away when a body carries explicit
  // inertial data, so compare those geoms on body inertial truth instead of
  // preserving noisy source-level geom mass tokens.
  if (bodyHasExplicitInertial(leftBody) || bodyHasExplicitInertial(rightBody)) {
    return true;
  }

  return false;
}

export function jointAxesEqual(
  left: [number, number, number] | null | undefined,
  right: [number, number, number] | null | undefined,
): boolean {
  return arraysEqual(normalizeUnitVector(left, 3), normalizeUnitVector(right, 3));
}

export function rangesEqual(
  left: number[] | null | undefined,
  right: number[] | null | undefined,
): boolean {
  return arraysEqual(left, right, RELAXED_NUMERIC_EPSILON);
}

export function materialRGBAEqual(
  left: [number, number, number, number] | null | undefined,
  right: [number, number, number, number] | null | undefined,
): boolean {
  if (!left && !right) {
    return true;
  }

  return arraysEqual(left ?? DEFAULT_MATERIAL_RGBA, right ?? DEFAULT_MATERIAL_RGBA);
}

export function canonicalBodyInertiaTensor(body: CanonicalMJCFBody): number[] | null {
  if (!body.inertia) {
    if (body.fullinertia) {
      return body.fullinertia.map((value) => roundNumber(value));
    }
    return null;
  }

  const quaternion = body.inertialQuat || [1, 0, 0, 0];
  const rotation = new THREE.Matrix4().makeRotationFromQuaternion(
    new THREE.Quaternion(quaternion[1], quaternion[2], quaternion[3], quaternion[0]).normalize(),
  );
  const basisX = new THREE.Vector3().setFromMatrixColumn(rotation, 0);
  const basisY = new THREE.Vector3().setFromMatrixColumn(rotation, 1);
  const basisZ = new THREE.Vector3().setFromMatrixColumn(rotation, 2);
  const moments = body.inertia;

  const tensor = new THREE.Matrix3().set(
    basisX.x * basisX.x * moments[0] +
      basisY.x * basisY.x * moments[1] +
      basisZ.x * basisZ.x * moments[2],
    basisX.x * basisX.y * moments[0] +
      basisY.x * basisY.y * moments[1] +
      basisZ.x * basisZ.y * moments[2],
    basisX.x * basisX.z * moments[0] +
      basisY.x * basisY.z * moments[1] +
      basisZ.x * basisZ.z * moments[2],
    basisX.y * basisX.x * moments[0] +
      basisY.y * basisY.x * moments[1] +
      basisZ.y * basisZ.x * moments[2],
    basisX.y * basisX.y * moments[0] +
      basisY.y * basisY.y * moments[1] +
      basisZ.y * basisZ.y * moments[2],
    basisX.y * basisX.z * moments[0] +
      basisY.y * basisY.z * moments[1] +
      basisZ.y * basisZ.z * moments[2],
    basisX.z * basisX.x * moments[0] +
      basisY.z * basisY.x * moments[1] +
      basisZ.z * basisZ.x * moments[2],
    basisX.z * basisX.y * moments[0] +
      basisY.z * basisY.y * moments[1] +
      basisZ.z * basisZ.y * moments[2],
    basisX.z * basisX.z * moments[0] +
      basisY.z * basisY.z * moments[1] +
      basisZ.z * basisZ.z * moments[2],
  );
  const elements = tensor.elements;

  return [
    roundNumber(elements[0] ?? 0),
    roundNumber(elements[4] ?? 0),
    roundNumber(elements[8] ?? 0),
    roundNumber(elements[1] ?? 0),
    roundNumber(elements[2] ?? 0),
    roundNumber(elements[5] ?? 0),
  ];
}
