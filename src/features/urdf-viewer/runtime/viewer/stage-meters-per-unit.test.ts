import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyStageMetersPerUnitToRoot as applyStageMetersPerUnitToRootUntyped,
  extractStageMetersPerUnitFromLayerText,
  resolveStageMetersPerUnit as resolveStageMetersPerUnitUntyped,
} from './stage-meters-per-unit.js';

type StageLike = { GetRootLayer?: () => { ExportToString?: () => string } | null } | null;

const resolveStageMetersPerUnit = resolveStageMetersPerUnitUntyped as (options?: {
  reportedMetersPerUnit?: number | string | null;
  stage?: StageLike;
}) => number | null;

const applyStageMetersPerUnitToRoot = applyStageMetersPerUnitToRootUntyped as (
  root: { scale?: { x: number; y: number; z: number; setScalar?: (value: number) => void } } | null,
  options?: { reportedMetersPerUnit?: number | string | null; stage?: StageLike },
) => number;

test('extracts metersPerUnit including scientific notation from USD layer metadata', () => {
  assert.equal(
    extractStageMetersPerUnitFromLayerText('#usda 1.0\n(\n    metersPerUnit = 1e-3\n)\n'),
    0.001,
  );
  assert.equal(extractStageMetersPerUnitFromLayerText('#usda 1.0\n'), null);
});

test('prefers the OpenUSD-reported metersPerUnit over root-layer text', () => {
  assert.equal(
    resolveStageMetersPerUnit({
      reportedMetersPerUnit: 0.01,
      stage: {
        GetRootLayer: () => ({
          ExportToString: () => '#usda 1.0\n(\n    metersPerUnit = 1\n)\n',
        }),
      },
    }),
    0.01,
  );
});

test('falls back to root-layer metadata and rejects invalid unit scales', () => {
  assert.equal(
    resolveStageMetersPerUnit({
      reportedMetersPerUnit: 0,
      stage: {
        GetRootLayer: () => ({
          ExportToString: () => '#usda 1.0\n(\n    metersPerUnit = 0.001\n)\n',
        }),
      },
    }),
    0.001,
  );
  assert.equal(resolveStageMetersPerUnit({ reportedMetersPerUnit: -1 }), null);
});

test('applies a uniform stage-unit scale and resets unresolved stages to one', () => {
  const scale = {
    x: 9,
    y: 9,
    z: 9,
    setScalar(value: number) {
      this.x = value;
      this.y = value;
      this.z = value;
    },
  };

  assert.equal(applyStageMetersPerUnitToRoot({ scale }, { reportedMetersPerUnit: 0.001 }), 0.001);
  assert.deepEqual([scale.x, scale.y, scale.z], [0.001, 0.001, 0.001]);

  assert.equal(applyStageMetersPerUnitToRoot({ scale }), 1);
  assert.deepEqual([scale.x, scale.y, scale.z], [1, 1, 1]);
});
