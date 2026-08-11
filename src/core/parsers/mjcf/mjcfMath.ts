import * as THREE from 'three';

export type MJCFAngleUnit = 'radian' | 'degree';
export type MJCFQuatTuple = [number, number, number, number];
export type MJCFSymmetric3x3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

export interface MJCFPrecisionOptions {
  precision?: number;
}

export interface MJCFSymmetric3x3Diagonalization {
  values: [number, number, number];
  quat: MJCFQuatTuple;
}

function roundNumber(value: number, precision: number | undefined): number {
  return precision == null ? value : Number(value.toFixed(precision));
}

function roundQuatTuple(tuple: MJCFQuatTuple, precision: number | undefined): MJCFQuatTuple {
  return [
    roundNumber(tuple[0], precision),
    roundNumber(tuple[1], precision),
    roundNumber(tuple[2], precision),
    roundNumber(tuple[3], precision),
  ];
}

function finiteSymmetricRows(matrix: MJCFSymmetric3x3): boolean {
  return matrix.every((row) => row.every((value) => Number.isFinite(value)));
}

export function convertMjcfAngle(value: number, angleUnit: MJCFAngleUnit): number {
  return angleUnit === 'degree' ? (value * Math.PI) / 180 : value;
}

export function normalizeMjcfQuatTuple(
  value: readonly number[] | null | undefined,
  options: MJCFPrecisionOptions = {},
): MJCFQuatTuple | null {
  if (!value || value.length === 0) {
    return null;
  }

  const raw: MJCFQuatTuple = [
    roundNumber(value[0] ?? 0, options.precision),
    roundNumber(value[1] ?? 0, options.precision),
    roundNumber(value[2] ?? 0, options.precision),
    roundNumber(value[3] ?? 0, options.precision),
  ];
  const length = Math.hypot(raw[0], raw[1], raw[2], raw[3]);
  if (length <= 1e-8) {
    return [1, 0, 0, 0];
  }

  return [
    roundNumber(raw[0] / length, options.precision),
    roundNumber(raw[1] / length, options.precision),
    roundNumber(raw[2] / length, options.precision),
    roundNumber(raw[3] / length, options.precision),
  ];
}

export function mjcfQuatTupleFromQuaternion(
  quaternion: THREE.Quaternion,
  options: MJCFPrecisionOptions = {},
): MJCFQuatTuple {
  const length = Math.hypot(quaternion.w, quaternion.x, quaternion.y, quaternion.z);
  if (length <= 1e-8) {
    return [1, 0, 0, 0];
  }

  return roundQuatTuple(
    [
      quaternion.w / length,
      quaternion.x / length,
      quaternion.y / length,
      quaternion.z / length,
    ],
    options.precision,
  );
}

// MJCF stores quaternions as [w, x, y, z]; Three.js stores them as (x, y, z, w).
// This is the canonical MJCF→Three.js conversion used by both the model parser
// and the hierarchy builder.
export function mjcfQuatToThreeQuat(quat?: [number, number, number, number]): THREE.Quaternion {
  if (!quat) {
    return new THREE.Quaternion();
  }

  return new THREE.Quaternion(quat[1], quat[2], quat[3], quat[0]);
}

export function createMuJoCoFromToQuaternion(direction: THREE.Vector3): THREE.Quaternion {
  if (direction.lengthSq() <= 1e-12) {
    return new THREE.Quaternion();
  }

  const normalizedDirection = direction.clone().normalize();
  const localNegativeZ = new THREE.Vector3(0, 0, -1);
  const dot = localNegativeZ.dot(normalizedDirection);

  if (dot <= -1 + 1e-9) {
    return new THREE.Quaternion(1, 0, 0, 0);
  }

  return new THREE.Quaternion().setFromUnitVectors(localNegativeZ, normalizedDirection).normalize();
}

/**
 * Converts MuJoCo's endpoint form into the equivalent canonical primitive pose.
 *
 * MuJoCo ignores an authored `pos`/orientation when `fromto` is present. The
 * returned size keeps MuJoCo's half-length convention so format adapters can
 * map it to their own geometry representation without reimplementing the pose
 * math.
 */
export function canonicalizeMjcfFromToGeom(
  geom: {
    type: string;
    size?: readonly number[];
    fromto?: readonly number[];
  },
  options: MJCFPrecisionOptions = {},
): {
  pos: [number, number, number];
  quat: MJCFQuatTuple;
  size: [number, number];
} | null {
  if (!geom.fromto || geom.fromto.length < 6) {
    return null;
  }

  const normalizedType = geom.type.trim().toLowerCase();
  if (normalizedType !== 'capsule' && normalizedType !== 'cylinder') {
    return null;
  }

  const radius = geom.size?.[0];
  if (radius == null || !Number.isFinite(radius)) {
    return null;
  }

  const from = new THREE.Vector3(
    geom.fromto[0] ?? 0,
    geom.fromto[1] ?? 0,
    geom.fromto[2] ?? 0,
  );
  const to = new THREE.Vector3(
    geom.fromto[3] ?? 0,
    geom.fromto[4] ?? 0,
    geom.fromto[5] ?? 0,
  );
  const direction = new THREE.Vector3().subVectors(to, from);
  const center = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);

  return {
    pos: [
      roundNumber(center.x, options.precision),
      roundNumber(center.y, options.precision),
      roundNumber(center.z, options.precision),
    ],
    quat: mjcfQuatTupleFromQuaternion(createMuJoCoFromToQuaternion(direction), options),
    size: [
      roundNumber(radius, options.precision),
      roundNumber(direction.length() / 2, options.precision),
    ],
  };
}

function sortEigenvectorsByDescendingValues(
  eigenvalues: [number, number, number],
  eigenvectors: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
  precision: number | undefined,
): {
  values: [number, number, number];
  vectors: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
} {
  const pairs = eigenvalues
    .map((value, index) => ({
      value,
      vector: eigenvectors[index]!.clone(),
    }))
    .sort((left, right) => right.value - left.value);

  const vectors = pairs.map((pair) => pair.vector) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  const basis = new THREE.Matrix4().makeBasis(vectors[0], vectors[1], vectors[2]);
  if (basis.determinant() < 0) {
    vectors[2] = vectors[2].clone().multiplyScalar(-1);
  }

  return {
    values: pairs.map((pair) => roundNumber(pair.value, precision)) as [number, number, number],
    vectors,
  };
}

export function diagonalizeMjcfSymmetric3x3(
  input: MJCFSymmetric3x3,
  options: MJCFPrecisionOptions = { precision: 6 },
): MJCFSymmetric3x3Diagonalization | null {
  if (!finiteSymmetricRows(input)) {
    return null;
  }

  const matrix = input.map((row) => [...row]) as MJCFSymmetric3x3;
  const eigenvectors = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  for (let iteration = 0; iteration < 24; iteration += 1) {
    let pivotRow = 0;
    let pivotCol = 1;
    let pivotValue = Math.abs(matrix[pivotRow]![pivotCol]!);

    for (const [row, col] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ] as const) {
      const candidate = Math.abs(matrix[row]![col]!);
      if (candidate > pivotValue) {
        pivotRow = row;
        pivotCol = col;
        pivotValue = candidate;
      }
    }

    if (pivotValue <= 1e-12) {
      break;
    }

    const app = matrix[pivotRow]![pivotRow]!;
    const aqq = matrix[pivotCol]![pivotCol]!;
    const apq = matrix[pivotRow]![pivotCol]!;
    const tau = (aqq - app) / (2 * apq);
    const tangent = Math.sign(tau || 1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
    const cosine = 1 / Math.sqrt(1 + tangent * tangent);
    const sine = tangent * cosine;

    for (let row = 0; row < 3; row += 1) {
      if (row === pivotRow || row === pivotCol) {
        continue;
      }

      const arp = matrix[row]![pivotRow]!;
      const arq = matrix[row]![pivotCol]!;
      matrix[row]![pivotRow] = arp * cosine - arq * sine;
      matrix[pivotRow]![row] = matrix[row]![pivotRow]!;
      matrix[row]![pivotCol] = arp * sine + arq * cosine;
      matrix[pivotCol]![row] = matrix[row]![pivotCol]!;
    }

    matrix[pivotRow]![pivotRow] =
      app * cosine * cosine - 2 * apq * cosine * sine + aqq * sine * sine;
    matrix[pivotCol]![pivotCol] =
      app * sine * sine + 2 * apq * cosine * sine + aqq * cosine * cosine;
    matrix[pivotRow]![pivotCol] = 0;
    matrix[pivotCol]![pivotRow] = 0;

    for (let row = 0; row < 3; row += 1) {
      const vrp = eigenvectors[row]![pivotRow]!;
      const vrq = eigenvectors[row]![pivotCol]!;
      eigenvectors[row]![pivotRow] = vrp * cosine - vrq * sine;
      eigenvectors[row]![pivotCol] = vrp * sine + vrq * cosine;
    }
  }

  const sorted = sortEigenvectorsByDescendingValues(
    [matrix[0]![0]!, matrix[1]![1]!, matrix[2]![2]!],
    [
      new THREE.Vector3(eigenvectors[0]![0]!, eigenvectors[1]![0]!, eigenvectors[2]![0]!),
      new THREE.Vector3(eigenvectors[0]![1]!, eigenvectors[1]![1]!, eigenvectors[2]![1]!),
      new THREE.Vector3(eigenvectors[0]![2]!, eigenvectors[1]![2]!, eigenvectors[2]![2]!),
    ],
    options.precision,
  );
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(sorted.vectors[0], sorted.vectors[1], sorted.vectors[2]),
  );

  return {
    values: sorted.values,
    quat: mjcfQuatTupleFromQuaternion(quaternion, { precision: options.precision }),
  };
}

// --- Pose / position / quaternion conversion helpers (moved from mjcfParser.ts) ---

const tempRPYQuaternion = new THREE.Quaternion();
const tempRPYEuler = new THREE.Euler(0, 0, 0, 'ZYX');

export function toPositionObject(tuple: [number, number, number] | undefined): {
  x: number;
  y: number;
  z: number;
} {
  return {
    x: tuple?.[0] ?? 0,
    y: tuple?.[1] ?? 0,
    z: tuple?.[2] ?? 0,
  };
}

export function toQuatObject(
  tuple: [number, number, number, number] | undefined,
): { w: number; x: number; y: number; z: number } | undefined {
  if (!tuple) {
    return undefined;
  }

  return {
    w: tuple[0],
    x: tuple[1],
    y: tuple[2],
    z: tuple[3],
  };
}

export function toRPYObjectFromQuat(
  quat: { w: number; x: number; y: number; z: number } | undefined,
): { r: number; p: number; y: number } | undefined {
  if (!quat) {
    return undefined;
  }

  tempRPYQuaternion.set(quat.x, quat.y, quat.z, quat.w).normalize();
  tempRPYEuler.setFromQuaternion(tempRPYQuaternion, 'ZYX');

  return {
    r: tempRPYEuler.x,
    p: tempRPYEuler.y,
    y: tempRPYEuler.z,
  };
}

export function isNonZeroPosition(
  position: { x: number; y: number; z: number } | undefined,
): boolean {
  if (!position) {
    return false;
  }

  return Math.abs(position.x) > 1e-9 || Math.abs(position.y) > 1e-9 || Math.abs(position.z) > 1e-9;
}

export function subtractLocalOffset(
  position: { x: number; y: number; z: number } | undefined,
  localOffset: { x: number; y: number; z: number } | null,
): { x: number; y: number; z: number } | undefined {
  if (!position) {
    return undefined;
  }

  if (!localOffset) {
    return position;
  }

  return {
    x: position.x - localOffset.x,
    y: position.y - localOffset.y,
    z: position.z - localOffset.z,
  };
}

export function rotateLocalOffsetToParentFrame(
  localOffset: { x: number; y: number; z: number } | null,
  rotation: { r: number; p: number; y: number } | undefined,
): { x: number; y: number; z: number } | null {
  if (!localOffset) {
    return null;
  }

  if (!rotation) {
    return localOffset;
  }

  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rotation.r, rotation.p, rotation.y, 'ZYX'),
  );
  const rotated = new THREE.Vector3(localOffset.x, localOffset.y, localOffset.z).applyQuaternion(
    quaternion,
  );

  return {
    x: rotated.x,
    y: rotated.y,
    z: rotated.z,
  };
}
