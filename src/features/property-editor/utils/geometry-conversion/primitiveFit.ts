import * as THREE from 'three';

import {
  canonicalizeAxis,
  computeAxisAlignmentScore,
  computeCapsuleVolume,
  computeCylinderVolume,
  type Point3,
} from '@/core/geometry/primitiveGeometry';

export interface PrimitiveFit {
  axis: { x: number; y: number; z: number };
  center: { x: number; y: number; z: number };
  radius: number;
  length: number;
  volume: number;
}

export interface BoxFit {
  center: { x: number; y: number; z: number };
  dimensions: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  volume: number;
}

export interface PrimitiveFitSet {
  box?: BoxFit;
  cylinder?: PrimitiveFit;
  capsule?: PrimitiveFit;
  boxCandidates?: BoxFit[];
  cylinderCandidates?: PrimitiveFit[];
  capsuleCandidates?: PrimitiveFit[];
}

export type { Point3 } from '@/core/geometry/primitiveGeometry';

interface ProjectedPoint {
  t: number;
  u: number;
  v: number;
  radial: number;
}

interface Circle2D {
  cx: number;
  cy: number;
  r: number;
}

function toPositive(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function addCandidateAxis(axes: Point3[], axis: Point3): void {
  const normalized = canonicalizeAxis(axis);
  if (!normalized) return;

  const isDuplicate = axes.some(
    (existing) =>
      Math.abs(existing.x * normalized.x + existing.y * normalized.y + existing.z * normalized.z) >
      0.999,
  );

  if (!isDuplicate) {
    axes.push(normalized);
  }
}

export function computePrincipalAxes(points: Point3[]): Point3[] {
  if (points.length === 0) return [];

  let meanX = 0;
  let meanY = 0;
  let meanZ = 0;

  points.forEach((point) => {
    meanX += point.x;
    meanY += point.y;
    meanZ += point.z;
  });

  meanX /= points.length;
  meanY /= points.length;
  meanZ /= points.length;

  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;

  points.forEach((point) => {
    const dx = point.x - meanX;
    const dy = point.y - meanY;
    const dz = point.z - meanZ;
    xx += dx * dx;
    xy += dx * dy;
    xz += dx * dz;
    yy += dy * dy;
    yz += dy * dz;
    zz += dz * dz;
  });

  const invCount = 1 / Math.max(points.length, 1);
  const matrix = [
    [xx * invCount, xy * invCount, xz * invCount],
    [xy * invCount, yy * invCount, yz * invCount],
    [xz * invCount, yz * invCount, zz * invCount],
  ];
  const eigenvectors = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  for (let iteration = 0; iteration < 16; iteration += 1) {
    const candidates: Array<[number, number]> = [
      [0, 1],
      [0, 2],
      [1, 2],
    ];
    let pivot: [number, number] = [0, 1];
    let maxValue = 0;

    candidates.forEach(([row, col]) => {
      const value = Math.abs(matrix[row][col]);
      if (value > maxValue) {
        maxValue = value;
        pivot = [row, col];
      }
    });

    if (maxValue <= 1e-12) break;

    const [row, col] = pivot;
    const diff = matrix[col][col] - matrix[row][row];
    const angle = 0.5 * Math.atan2(2 * matrix[row][col], diff);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rowRow = matrix[row][row];
    const colCol = matrix[col][col];
    const rowCol = matrix[row][col];

    matrix[row][row] = cos * cos * rowRow - 2 * sin * cos * rowCol + sin * sin * colCol;
    matrix[col][col] = sin * sin * rowRow + 2 * sin * cos * rowCol + cos * cos * colCol;
    matrix[row][col] = 0;
    matrix[col][row] = 0;

    for (let index = 0; index < 3; index += 1) {
      if (index === row || index === col) continue;
      const rowValue = matrix[index][row];
      const colValue = matrix[index][col];
      matrix[index][row] = cos * rowValue - sin * colValue;
      matrix[row][index] = matrix[index][row];
      matrix[index][col] = sin * rowValue + cos * colValue;
      matrix[col][index] = matrix[index][col];
    }

    for (let index = 0; index < 3; index += 1) {
      const rowValue = eigenvectors[index][row];
      const colValue = eigenvectors[index][col];
      eigenvectors[index][row] = cos * rowValue - sin * colValue;
      eigenvectors[index][col] = sin * rowValue + cos * colValue;
    }
  }

  const sorted = [0, 1, 2]
    .map((index) => ({
      value: matrix[index][index],
      axis: {
        x: eigenvectors[0][index],
        y: eigenvectors[1][index],
        z: eigenvectors[2][index],
      },
    }))
    .sort((left, right) => right.value - left.value);

  return sorted
    .map((entry) => canonicalizeAxis(entry.axis))
    .filter((axis): axis is Point3 => axis !== null);
}

function createDeterministicRandom(seed: number): () => number {
  let current = seed >>> 0;
  return () => {
    current = (current + 0x6d2b79f5) >>> 0;
    let value = Math.imul(current ^ (current >>> 15), 1 | current);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleDeterministically<T>(values: T[], seed: number): T[] {
  const shuffled = [...values];
  const random = createDeterministicRandom(seed);

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function isPointInsideCircle(point: { x: number; y: number }, circle: Circle2D): boolean {
  const dx = point.x - circle.cx;
  const dy = point.y - circle.cy;
  return dx * dx + dy * dy <= (circle.r + 1e-8) * (circle.r + 1e-8);
}

function createCircleFromDiameter(
  pointA: { x: number; y: number },
  pointB: { x: number; y: number },
): Circle2D {
  const centerX = (pointA.x + pointB.x) / 2;
  const centerY = (pointA.y + pointB.y) / 2;
  return {
    cx: centerX,
    cy: centerY,
    r: Math.hypot(pointA.x - centerX, pointA.y - centerY),
  };
}

function createCircleFromThreePoints(
  pointA: { x: number; y: number },
  pointB: { x: number; y: number },
  pointC: { x: number; y: number },
): Circle2D | null {
  const determinant =
    2 *
    (pointA.x * (pointB.y - pointC.y) +
      pointB.x * (pointC.y - pointA.y) +
      pointC.x * (pointA.y - pointB.y));

  if (Math.abs(determinant) <= 1e-10) {
    return null;
  }

  const pointASquared = pointA.x * pointA.x + pointA.y * pointA.y;
  const pointBSquared = pointB.x * pointB.x + pointB.y * pointB.y;
  const pointCSquared = pointC.x * pointC.x + pointC.y * pointC.y;

  const centerX =
    (pointASquared * (pointB.y - pointC.y) +
      pointBSquared * (pointC.y - pointA.y) +
      pointCSquared * (pointA.y - pointB.y)) /
    determinant;
  const centerY =
    (pointASquared * (pointC.x - pointB.x) +
      pointBSquared * (pointA.x - pointC.x) +
      pointCSquared * (pointB.x - pointA.x)) /
    determinant;

  return {
    cx: centerX,
    cy: centerY,
    r: Math.hypot(pointA.x - centerX, pointA.y - centerY),
  };
}

function createSmallestEnclosingPairCircle(
  pointA: { x: number; y: number },
  pointB: { x: number; y: number },
  pointC: { x: number; y: number },
): Circle2D {
  const candidates = [
    createCircleFromDiameter(pointA, pointB),
    createCircleFromDiameter(pointA, pointC),
    createCircleFromDiameter(pointB, pointC),
  ];

  let bestCircle = candidates[0];
  candidates.forEach((candidate) => {
    if (
      isPointInsideCircle(pointA, candidate) &&
      isPointInsideCircle(pointB, candidate) &&
      isPointInsideCircle(pointC, candidate) &&
      candidate.r < bestCircle.r
    ) {
      bestCircle = candidate;
    }
  });

  return bestCircle;
}

function computeMinimumEnclosingCircle(points: Array<{ x: number; y: number }>): Circle2D {
  if (points.length === 0) {
    return { cx: 0, cy: 0, r: 0 };
  }

  const shuffled = shuffleDeterministically(points, 0x9e3779b9);
  let circle: Circle2D = { cx: shuffled[0].x, cy: shuffled[0].y, r: 0 };

  for (let i = 0; i < shuffled.length; i += 1) {
    const pointI = shuffled[i];
    if (isPointInsideCircle(pointI, circle)) continue;

    circle = { cx: pointI.x, cy: pointI.y, r: 0 };

    for (let j = 0; j < i; j += 1) {
      const pointJ = shuffled[j];
      if (isPointInsideCircle(pointJ, circle)) continue;

      circle = createCircleFromDiameter(pointI, pointJ);

      for (let k = 0; k < j; k += 1) {
        const pointK = shuffled[k];
        if (isPointInsideCircle(pointK, circle)) continue;

        const circumcircle = createCircleFromThreePoints(pointI, pointJ, pointK);
        circle = circumcircle ?? createSmallestEnclosingPairCircle(pointI, pointJ, pointK);
      }
    }
  }

  return circle;
}

function createPerpendicularBasis(axis: Point3): {
  axis: THREE.Vector3;
  basisU: THREE.Vector3;
  basisV: THREE.Vector3;
} {
  const axisVector = new THREE.Vector3(axis.x, axis.y, axis.z).normalize();
  const reference =
    Math.abs(axisVector.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const basisU = new THREE.Vector3().crossVectors(reference, axisVector).normalize();
  const basisV = new THREE.Vector3().crossVectors(axisVector, basisU).normalize();
  return { axis: axisVector, basisU, basisV };
}

interface BoxFitBasis {
  xAxis: THREE.Vector3;
  yAxis: THREE.Vector3;
  zAxis: THREE.Vector3;
}

function canonicalizeQuaternion(quaternion: THREE.Quaternion): THREE.Quaternion {
  if (
    quaternion.w < -1e-8 ||
    (Math.abs(quaternion.w) <= 1e-8 && quaternion.x < -1e-8) ||
    (Math.abs(quaternion.w) <= 1e-8 && Math.abs(quaternion.x) <= 1e-8 && quaternion.y < -1e-8) ||
    (Math.abs(quaternion.w) <= 1e-8 &&
      Math.abs(quaternion.x) <= 1e-8 &&
      Math.abs(quaternion.y) <= 1e-8 &&
      quaternion.z < 0)
  ) {
    quaternion.set(-quaternion.x, -quaternion.y, -quaternion.z, -quaternion.w);
  }

  return quaternion;
}

function createBoxFitBasis(
  primaryAxis: Point3,
  secondaryAxis: Point3,
  tertiaryAxis?: Point3,
): BoxFitBasis | null {
  const xAxis = canonicalizeAxis(primaryAxis);
  if (!xAxis) {
    return null;
  }

  const xVector = new THREE.Vector3(xAxis.x, xAxis.y, xAxis.z).normalize();
  const yVector = new THREE.Vector3(secondaryAxis.x, secondaryAxis.y, secondaryAxis.z);
  yVector.addScaledVector(xVector, -xVector.dot(yVector));

  if (yVector.lengthSq() <= 1e-12 && tertiaryAxis) {
    yVector.set(tertiaryAxis.x, tertiaryAxis.y, tertiaryAxis.z);
    yVector.addScaledVector(xVector, -xVector.dot(yVector));
  }

  if (yVector.lengthSq() <= 1e-12) {
    const fallbackReference =
      Math.abs(xVector.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    yVector.copy(fallbackReference).addScaledVector(xVector, -xVector.dot(fallbackReference));
  }

  if (yVector.lengthSq() <= 1e-12) {
    return null;
  }

  yVector.normalize();
  const zVector = new THREE.Vector3().crossVectors(xVector, yVector).normalize();
  if (zVector.lengthSq() <= 1e-12) {
    return null;
  }

  if (tertiaryAxis) {
    const tertiaryVector = new THREE.Vector3(tertiaryAxis.x, tertiaryAxis.y, tertiaryAxis.z);
    if (zVector.dot(tertiaryVector) < 0) {
      zVector.multiplyScalar(-1);
    }
  }

  yVector.crossVectors(zVector, xVector).normalize();

  return {
    xAxis: xVector,
    yAxis: yVector,
    zAxis: zVector,
  };
}

function computeBoxFitForBasis(points: Point3[], basis: BoxFitBasis): BoxFit | null {
  if (points.length === 0) {
    return null;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  points.forEach((point) => {
    const projectionX = point.x * basis.xAxis.x + point.y * basis.xAxis.y + point.z * basis.xAxis.z;
    const projectionY = point.x * basis.yAxis.x + point.y * basis.yAxis.y + point.z * basis.yAxis.z;
    const projectionZ = point.x * basis.zAxis.x + point.y * basis.zAxis.y + point.z * basis.zAxis.z;

    minX = Math.min(minX, projectionX);
    maxX = Math.max(maxX, projectionX);
    minY = Math.min(minY, projectionY);
    maxY = Math.max(maxY, projectionY);
    minZ = Math.min(minZ, projectionZ);
    maxZ = Math.max(maxZ, projectionZ);
  });

  const dimensions = {
    x: Math.max(maxX - minX, 1e-8),
    y: Math.max(maxY - minY, 1e-8),
    z: Math.max(maxZ - minZ, 1e-8),
  };
  const center = new THREE.Vector3()
    .copy(basis.xAxis)
    .multiplyScalar((minX + maxX) / 2)
    .addScaledVector(basis.yAxis, (minY + maxY) / 2)
    .addScaledVector(basis.zAxis, (minZ + maxZ) / 2);
  const rotation = canonicalizeQuaternion(
    new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(basis.xAxis, basis.yAxis, basis.zAxis),
    ),
  );

  return {
    center: { x: center.x, y: center.y, z: center.z },
    dimensions,
    rotation: {
      x: rotation.x,
      y: rotation.y,
      z: rotation.z,
      w: rotation.w,
    },
    volume: dimensions.x * dimensions.y * dimensions.z,
  };
}

function buildBoxFitCandidates(points: Point3[]): BoxFit[] {
  const candidates: BoxFit[] = [];
  const basisCandidates: BoxFitBasis[] = [
    {
      xAxis: new THREE.Vector3(1, 0, 0),
      yAxis: new THREE.Vector3(0, 1, 0),
      zAxis: new THREE.Vector3(0, 0, 1),
    },
  ];
  const principalAxes = computePrincipalAxes(points);

  if (principalAxes.length >= 2) {
    const principalBasis = createBoxFitBasis(principalAxes[0], principalAxes[1], principalAxes[2]);
    if (principalBasis) {
      basisCandidates.push(principalBasis);
    }
  }

  basisCandidates.forEach((basis) => {
    const candidate = computeBoxFitForBasis(points, basis);
    if (!candidate) {
      return;
    }

    const isDuplicate = candidates.some((existing) => {
      const volumeDelta = Math.abs(existing.volume - candidate.volume);
      const quaternionDot = Math.abs(
        existing.rotation.x * candidate.rotation.x +
          existing.rotation.y * candidate.rotation.y +
          existing.rotation.z * candidate.rotation.z +
          existing.rotation.w * candidate.rotation.w,
      );

      return volumeDelta <= 1e-8 && quaternionDot >= 0.9999;
    });

    if (!isDuplicate) {
      candidates.push(candidate);
    }
  });

  return candidates.sort(
    (left, right) =>
      left.volume - right.volume ||
      left.dimensions.x - right.dimensions.x ||
      left.dimensions.y - right.dimensions.y ||
      left.dimensions.z - right.dimensions.z,
  );
}

function evaluateCapsuleRadius(points: ProjectedPoint[], radius: number) {
  let maxStart = -Infinity;
  let minEnd = Infinity;

  for (const point of points) {
    if (point.radial > radius + 1e-8) {
      return null;
    }

    const slack = Math.sqrt(Math.max(radius * radius - point.radial * point.radial, 0));
    maxStart = Math.max(maxStart, point.t - slack);
    minEnd = Math.min(minEnd, point.t + slack);
  }

  const segmentLength = Math.max(0, maxStart - minEnd);
  const centerT = (maxStart + minEnd) / 2;
  const totalLength = segmentLength + 2 * radius;

  return {
    centerT,
    totalLength,
    volume: computeCapsuleVolume(totalLength, radius),
  };
}

function computeBestCapsuleFit(
  points: ProjectedPoint[],
  axis: THREE.Vector3,
  lineCenter: THREE.Vector3,
  minRadius: number,
): PrimitiveFit {
  let midpoint = 0;
  if (points.length > 0) {
    let minT = Infinity;
    let maxT = -Infinity;
    points.forEach((point) => {
      minT = Math.min(minT, point.t);
      maxT = Math.max(maxT, point.t);
    });
    midpoint = (minT + maxT) / 2;
  }

  let upperRadius = minRadius;
  points.forEach((point) => {
    upperRadius = Math.max(upperRadius, Math.hypot(point.radial, point.t - midpoint));
  });
  upperRadius = Math.max(upperRadius, minRadius + 1e-6);

  let bestRadius = minRadius;
  let bestResult = evaluateCapsuleRadius(points, minRadius);

  if (!bestResult) {
    bestResult = evaluateCapsuleRadius(points, upperRadius);
    bestRadius = upperRadius;
  }

  if (!bestResult) {
    return {
      axis: { x: axis.x, y: axis.y, z: axis.z },
      center: { x: lineCenter.x, y: lineCenter.y, z: lineCenter.z },
      radius: toPositive(minRadius, 0.05),
      length: Math.max(toPositive(minRadius, 0.05) * 2, 0.1),
      volume: computeCapsuleVolume(
        Math.max(toPositive(minRadius, 0.05) * 2, 0.1),
        toPositive(minRadius, 0.05),
      ),
    };
  }

  let searchMin = minRadius;
  let searchMax = upperRadius;

  for (let pass = 0; pass < 3; pass += 1) {
    const samples = pass === 0 ? 24 : 18;
    const span = searchMax - searchMin;
    if (span <= 1e-6) break;

    for (let index = 0; index <= samples; index += 1) {
      const radius = searchMin + (span * index) / samples;
      const result = evaluateCapsuleRadius(points, radius);
      if (!result) continue;
      if (!bestResult || result.volume < bestResult.volume) {
        bestResult = result;
        bestRadius = radius;
      }
    }

    const refineSpan = span / Math.max(samples, 1);
    searchMin = Math.max(minRadius, bestRadius - refineSpan * 1.5);
    searchMax = Math.min(upperRadius, bestRadius + refineSpan * 1.5);
  }

  const center = lineCenter.clone().addScaledVector(axis, bestResult.centerT);

  return {
    axis: { x: axis.x, y: axis.y, z: axis.z },
    center: { x: center.x, y: center.y, z: center.z },
    radius: bestRadius,
    length: bestResult.totalLength,
    volume: bestResult.volume,
  };
}

function computePrimitiveFitsForAxis(
  points: Point3[],
  axis: Point3,
): { cylinder: PrimitiveFit; capsule: PrimitiveFit } | null {
  if (points.length === 0) return null;

  const { axis: axisVector, basisU, basisV } = createPerpendicularBasis(axis);
  const projected = points.map((point) => ({
    t: point.x * axisVector.x + point.y * axisVector.y + point.z * axisVector.z,
    u: point.x * basisU.x + point.y * basisU.y + point.z * basisU.z,
    v: point.x * basisV.x + point.y * basisV.y + point.z * basisV.z,
    radial: 0,
  }));

  const circle = computeMinimumEnclosingCircle(
    projected.map((point) => ({ x: point.u, y: point.v })),
  );
  const lineCenter = new THREE.Vector3()
    .copy(basisU)
    .multiplyScalar(circle.cx)
    .addScaledVector(basisV, circle.cy);

  projected.forEach((point) => {
    point.radial = Math.hypot(point.u - circle.cx, point.v - circle.cy);
  });

  let minT = Infinity;
  let maxT = -Infinity;
  projected.forEach((point) => {
    minT = Math.min(minT, point.t);
    maxT = Math.max(maxT, point.t);
  });
  const cylinderLength = Math.max(0, maxT - minT);
  const cylinderCenter = lineCenter.clone().addScaledVector(axisVector, (minT + maxT) / 2);
  const cylinderRadius = Math.max(circle.r, 1e-8);
  const cylinder = {
    axis: { x: axisVector.x, y: axisVector.y, z: axisVector.z },
    center: { x: cylinderCenter.x, y: cylinderCenter.y, z: cylinderCenter.z },
    radius: cylinderRadius,
    length: cylinderLength,
    volume: computeCylinderVolume(cylinderRadius, cylinderLength),
  };

  const capsule = computeBestCapsuleFit(projected, axisVector, lineCenter, cylinderRadius);

  return { cylinder, capsule };
}

export function computeBestPrimitiveFits(points: Point3[]): PrimitiveFitSet | undefined {
  if (points.length === 0) return undefined;

  const candidateAxes: Point3[] = [];
  addCandidateAxis(candidateAxes, { x: 1, y: 0, z: 0 });
  addCandidateAxis(candidateAxes, { x: 0, y: 1, z: 0 });
  addCandidateAxis(candidateAxes, { x: 0, y: 0, z: 1 });
  computePrincipalAxes(points).forEach((axis) => addCandidateAxis(candidateAxes, axis));

  let bestCylinder: PrimitiveFit | undefined;
  let bestCapsule: PrimitiveFit | undefined;
  const boxCandidates = buildBoxFitCandidates(points);
  const cylinderCandidates: PrimitiveFit[] = [];
  const capsuleCandidates: PrimitiveFit[] = [];

  candidateAxes.forEach((axis) => {
    const fit = computePrimitiveFitsForAxis(points, axis);
    if (!fit) return;

    cylinderCandidates.push(fit.cylinder);
    capsuleCandidates.push(fit.capsule);

    if (!bestCylinder || fit.cylinder.volume < bestCylinder.volume) {
      bestCylinder = fit.cylinder;
    }
    if (!bestCapsule || fit.capsule.volume < bestCapsule.volume) {
      bestCapsule = fit.capsule;
    }
  });

  return {
    box: boxCandidates[0],
    cylinder: bestCylinder,
    capsule: bestCapsule,
    boxCandidates,
    cylinderCandidates: cylinderCandidates.sort(
      (left, right) =>
        left.volume - right.volume || left.length - right.length || left.radius - right.radius,
    ),
    capsuleCandidates: capsuleCandidates.sort(
      (left, right) =>
        left.volume - right.volume || left.length - right.length || left.radius - right.radius,
    ),
  };
}
