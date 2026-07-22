import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeApproximateCapsuleDecomposition,
  type ApproximateCapsuleDecomposition,
} from './approximateCapsuleFit.ts';
import type { Point3 } from './primitiveFit.ts';

interface TubePointOptions {
  centerX?: (axialPosition: number) => number;
  length: number;
  radius: (axialPosition: number) => number;
}

function createTubePoints({ centerX = () => 0, length, radius }: TubePointOptions): Point3[] {
  const points: Point3[] = [];
  const axialSections = 41;
  const radialSections = 20;

  for (let axialIndex = 0; axialIndex < axialSections; axialIndex += 1) {
    const z = -length / 2 + (length * axialIndex) / (axialSections - 1);
    const sectionRadius = radius(z);
    for (let radialIndex = 0; radialIndex < radialSections; radialIndex += 1) {
      const angle = (Math.PI * 2 * radialIndex) / radialSections;
      points.push({
        x: centerX(z) + Math.cos(angle) * sectionRadius,
        y: Math.sin(angle) * sectionRadius,
        z,
      });
    }
  }

  return points;
}

function requireDecomposition(
  decomposition: ApproximateCapsuleDecomposition | undefined,
): ApproximateCapsuleDecomposition {
  assert.ok(decomposition);
  return decomposition;
}

test('straight bodies keep one approximate capsule', () => {
  const decomposition = requireDecomposition(
    computeApproximateCapsuleDecomposition(createTubePoints({ length: 8, radius: () => 1 })),
  );

  assert.equal(decomposition.segments.length, 1);
  assert.ok(decomposition.segments[0]!.radius > 0.85);
  assert.ok(decomposition.segments[0]!.radius < 1.1);
});

test('a few protruding vertices do not inflate the approximate body width', () => {
  const points = createTubePoints({ length: 8, radius: () => 1 });
  points.push({ x: 3.5, y: 0, z: -0.2 }, { x: 3.5, y: 0, z: 0 }, { x: 3.5, y: 0, z: 0.2 });

  const decomposition = requireDecomposition(computeApproximateCapsuleDecomposition(points));

  assert.equal(decomposition.segments.length, 1);
  assert.ok(decomposition.segments[0]!.radius < 1.2);
});

test('large centerline and width changes use a small multi-capsule decomposition', () => {
  const points = createTubePoints({
    centerX: (z) => (Math.abs(z) < 1.5 ? 0.8 : -0.6),
    length: 9,
    radius: (z) => (Math.abs(z) < 1.5 ? 1.05 : 0.55),
  });

  const decomposition = requireDecomposition(computeApproximateCapsuleDecomposition(points));

  assert.ok(decomposition.segments.length >= 2, JSON.stringify(decomposition));
  assert.ok(decomposition.segments.length <= 3);
});
